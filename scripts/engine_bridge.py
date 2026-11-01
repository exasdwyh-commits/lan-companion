#!/usr/bin/env python3
"""engine_bridge.py — 桌面应用与 LiveTalking 引擎之间的离线出片桥。

为什么需要它：
LiveTalking 是推流服务器，它的会话只能通过 WebRTC（WHEP）建立；而桌面端要的是
「生成后播放」的一整个 mp4。让 Swift 去实现 WebRTC 客户端代价过高，所以这里用一个
Python 常驻进程替它做完信令与收帧，再通过 stdin/stdout 的 JSON 行协议提供三个动作：

    {"op":"render","id":"<uuid>","text":"...","out":"/abs/reply.mp4"}
    {"op":"cancel","id":"<uuid>"}
    {"op":"quit"}

回给桌面端的事件（每行一个 JSON，stdout 只放事件，日志一律走 stderr）：

    {"event":"ready","session":"ab12cd","model":"musetalk","fps":25}
    {"event":"accepted","id":"..."}
    {"event":"speaking","id":"..."}        引擎开始出声
    {"event":"done","id":"...","video":"/abs/reply.mp4","seconds":3.4}
    {"event":"error","id":"...","message":"..."}

用法（必须用 LiveTalking 的虚拟环境，它才有 aiortc）：
    LiveTalking/.venv/bin/python engine_bridge.py --base-url http://127.0.0.1:8010

自检（不连引擎，用 ffmpeg 造一段假片验证协议与文件链路）：
    ... engine_bridge.py --stub

调试单次出片（连真引擎，跑完即退）：
    ... engine_bridge.py --once "你好，我是灵儿"
"""

import argparse
import contextlib
from urllib.parse import urlencode, urlsplit
import asyncio
import atexit
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

LOG = sys.stderr


def log(message):
    print("[bridge] " + str(message), file=LOG, flush=True)


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class BridgeError(Exception):
    pass


# 只记录「本桥自己拉起的引擎」。用户手动起的引擎不归我们管，退出时不能动它。
_launched_engine = None


def stop_launched_engine():
    """停掉本桥拉起的引擎。

    引擎是以 start_new_session 启动的，和桥不在同一个进程组，桥退出不会连带收掉它。
    不收的话关掉桌宠还留着一个吃 5GB 显存的进程，用户根本不知道它在。
    """
    global _launched_engine
    proc, _launched_engine = _launched_engine, None
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=3)
        log("已停止由本桥拉起的引擎（pid %d）" % proc.pid)
    except Exception as exc:
        log("停止引擎失败：%s" % exc)


# ── WebRTC 会话 ────────────────────────────────────────────────────────────


class Session:
    """维持一个到 LiveTalking 的 WHEP 会话，并持续排空轨道。

    引擎在 offer 建立后就开始渲染；如果客户端不 recv，aiortc 侧缓冲会堆积，
    所以即使我们只要录制文件，也必须把帧读掉。
    """

    def __init__(self, base_url, avatar=None, tts=None, voice=None):
        self.parameters = {k: v for k, v in {"avatar": avatar, "tts": tts, "refaudio": voice}.items() if v}
        self.base_url = base_url.rstrip("/")
        self.sid = None
        self.pc = None
        self.frames = {"video": 0, "audio": 0}
        self._drain = []

    async def connect(self):
        from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration

        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        self.pc.addTransceiver("video", direction="recvonly")
        self.pc.addTransceiver("audio", direction="recvonly")

        @self.pc.on("track")
        def on_track(track):
            async def drain():
                while True:
                    try:
                        frame = await asyncio.wait_for(track.recv(), timeout=30)
                    except Exception:
                        return
                    if frame is not None:
                        self.frames[track.kind] = self.frames.get(track.kind, 0) + 1

            self._drain.append(asyncio.ensure_future(drain()))

        offer = await self.pc.createOffer()
        await self.pc.setLocalDescription(offer)
        async with self.http() as http, http.post(
            self.base_url + "/whep?" + urlencode(self.parameters),
            data=self.pc.localDescription.sdp,
            headers={"Content-Type": "application/sdp"},
        ) as response:
            body = await response.text()
            if response.status not in (200, 201):
                raise BridgeError("引擎拒绝了 WebRTC 会话（HTTP %d）：%s" % (response.status, body[:200]))
            self.sid = response.headers.get("X-Session-ID")
            if not self.sid:
                raise BridgeError("引擎没有返回 X-Session-ID。")
        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=body, type="answer"))
        log("会话已建立 sessionid=%s" % self.sid)

    def http(self):
        import aiohttp

        return aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120))

    async def post(self, path, payload):
        import aiohttp

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as http:
            async with http.post(self.base_url + path, json=payload) as response:
                text = await response.text()
                if response.status != 200:
                    raise BridgeError("%s 返回 HTTP %d：%s" % (path, response.status, text[:200]))
                try:
                    data = json.loads(text)
                except ValueError as exc:
                    raise BridgeError("%s 返回的不是 JSON：%s" % (path, text[:200])) from exc
                if data.get("code", 0) != 0:
                    raise BridgeError("%s 失败：%s" % (path, data.get("msg")))
                return data.get("data")

    async def speaking(self):
        return bool(await self.post("/is_speaking", {"sessionid": self.sid}))

    @property
    def state(self):
        return str(self.pc.connectionState) if self.pc is not None else "none"

    async def wait_media(self, timeout=45):
        """等到音视频真的有帧在流。

        只凭「会话已建立」判断引擎就绪是不够的：会话握手成功后引擎仍可能在加载模型，
        或者进程已经被外部杀掉。实测踩过这个坑——握手成功但一帧没有，随后所有请求
        都表现为「引擎不说话」，很难分辨。所以就绪信号必须以真实帧为准。
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.state in ("failed", "closed"):
                raise BridgeError("引擎连接已断开（%s），进程可能已退出。" % self.state)
            if self.frames.get("video", 0) > 0 and self.frames.get("audio", 0) > 0:
                log("媒体流已就绪 video=%d audio=%d" % (self.frames["video"], self.frames["audio"]))
                return True
            await asyncio.sleep(0.25)
        raise BridgeError(
            "引擎握手成功但 %.0f 秒内没有出流（video=%d audio=%d），通常是模型还在加载或进程已退出。"
            % (timeout, self.frames.get("video", 0), self.frames.get("audio", 0))
        )

    async def close(self):
        for task in self._drain:
            task.cancel()
        if self._drain:
            await asyncio.gather(*self._drain, return_exceptions=True)
        if self.pc is not None:
            await self.pc.close()


# ── 出片 ──────────────────────────────────────────────────────────────────


async def download(session, out_path, timeout=60):
    """从引擎把录制好的 mp4 取回来。引擎只提供 /record/{sessionid}，路径由它决定。"""
    import aiohttp

    url = "%s/record/%s" % (session.base_url, session.sid)
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120)) as http:
                async with http.get(url) as response:
                    if response.status == 200:
                        data = await response.read()
                        if len(data) > 2048:
                            with open(out_path, "wb") as handle:
                                handle.write(data)
                            return len(data)
                        last = "文件还没写完（%d 字节）" % len(data)
                    else:
                        last = "HTTP %d" % response.status
        except Exception as exc:  # 录制文件落盘有延迟，重试
            last = "%s: %s" % (type(exc).__name__, exc)
        await asyncio.sleep(0.3)
    raise BridgeError("取回录制文件超时：%s" % last)


async def render(session, text, out_path, wait_speech=20, wait_done=180):
    """一次完整的「说话 → 录 → 取回」。

    录制是整段时间窗（含说话前的静置帧），这是 LiveTalking 录制接口的固有行为。
    实测一段 3 秒的台词会录成 9.6 秒：前面 3.6 秒是等 TTS 起声、后面 2.8 秒是收尾。
    桌宠上一半等待都花在这段静音里，所以取回后要掐掉。
    """
    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)

    try:
        await session.post("/record", {"sessionid": session.sid, "type": "start_record"})
        await session.post(
            "/human",
            {"sessionid": session.sid, "type": "echo", "text": text, "interrupt": True},
        )
        started = await wait_until(session, True, wait_speech, "引擎始终没有开始说话")
        if started:
            emit_if(session, "speaking")
        await wait_until(session, False, wait_done, "说话超过 %d 秒仍未结束" % wait_done)
    finally:
        await asyncio.wait_for(session.post("/record", {"sessionid": session.sid, "type": "end_record"}), 5)

    await asyncio.sleep(0.6)
    size = await download(session, out_path)
    log("录制完成 %s（%d 字节）" % (out_path, size))
    if await trim_silence(out_path):
        log("已裁掉首尾静音，剩余 %.2f 秒" % (await probe_duration(out_path) or 0))
    return out_path


async def speech_bounds(path, noise="-35dB", min_silence=0.30):
    """用 ffmpeg 的 silencedetect 找真正说话的时间窗。

    返回 (start, end) 秒；判断不出来就返回 None，宁可不裁也不要裁坏音画同步。
    """
    ffmpeg = shutil.which("ffmpeg")
    total = await probe_duration(path)
    if not ffmpeg or not total:
        return None
    try:
        proc = await run_process(
            [ffmpeg, "-hide_banner", "-nostats", "-i", path, "-vn",
             "-af", "silencedetect=noise=%s:d=%s" % (noise, min_silence),
             "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        )
    except Exception:
        return None
    starts = [float(v) for v in re.findall(r"silence_start: (-?[\d.]+)", proc.stderr)]
    ends = [float(v) for v in re.findall(r"silence_end: ([\d.]+)", proc.stderr)]
    if not starts and not ends:
        return None  # 全程有声，或全程静音

    # 按出现顺序配对：silencedetect 是交替输出的，不能用两边数量去猜。
    # 结尾那段静音会带一个等于文件总长的 silence_end，看着像「配平了」，
    # 其实它就是尾部静音——按数量推会把它误判成有声区。
    segments = []
    current = None
    for line in proc.stderr.splitlines():
        found = re.search(r"silence_start: (-?[\d.]+)", line)
        if found:
            current = float(found.group(1))
            continue
        found = re.search(r"silence_end: ([\d.]+)", line)
        if found and current is not None:
            segments.append((current, float(found.group(1))))
            current = None
    if current is not None:
        segments.append((current, total))
    if not segments:
        return None

    lead = segments[0][1] if segments[0][0] < 0.05 else 0.0
    tail = segments[-1][0] if segments[-1][1] >= total - 0.1 else total
    if lead >= tail or tail - lead < 0.3:
        return None
    return lead, tail


async def trim_silence(path):
    """就地裁掉首尾静音。前后各留一点呼吸，避免字头字尾被切掉。"""
    bounds = await speech_bounds(path)
    if not bounds:
        return False
    lead, tail = bounds
    total = await probe_duration(path) or tail
    start = max(0.0, lead - 0.15)
    end = min(total, tail + 0.25)
    if end - start < 0.4 or (start < 0.1 and total - end < 0.1):
        return False

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    temp = path + ".trim.mp4"
    try:
        await run_process(
            [ffmpeg, "-v", "error", "-y", "-i", path,
             "-ss", "%.3f" % start, "-t", "%.3f" % (end - start),
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
             "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "128k",
             "-movflags", "+faststart", temp],
            capture_output=True, timeout=180, check=True,
        )
        os.replace(temp, path)
        return True
    except Exception as exc:
        log("裁剪静音失败，保留原片：%s" % exc)
        if os.path.exists(temp):
            os.remove(temp)
        return False


_emit_speaking_hook = None


def emit_if(session, event):
    if _emit_speaking_hook:
        _emit_speaking_hook(event)


async def wait_until(session, target, timeout, failure):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if session.state in ("failed", "closed"):
            raise BridgeError("引擎在生成过程中断开了（%s）。请检查引擎进程是否还在运行。" % session.state)
        if await session.speaking() == target:
            return True
        await asyncio.sleep(0.2)
    raise BridgeError(failure)


# ── 桩模式：只为验证协议与文件链路，不产出任何真人画面 ────────────────────


async def probe_duration(path):
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        raw = (await run_process(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
            capture_output=True, timeout=30, check=True,
        )).stdout
        return float(json.loads(raw)["format"]["duration"])
    except Exception:
        return None


async def stub_render(text, out_path):
    """造一段 2 秒的纯色视频 + 静音音轨。带 stub 标记，绝不冒充真实生成结果。"""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise BridgeError("桩模式需要 ffmpeg。")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    command = [
        ffmpeg, "-nostdin", "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=c=0x1a2624:s=576x768:r=25:d=2",
        "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
        "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out_path,
    ]
    await run_process(command, check=True, timeout=120)
    return out_path


# ── 主循环 ────────────────────────────────────────────────────────────────


async def serve(session, args, inbox=None):
    """命令读取和生成分开运行；取消时等录制收尾后才接受下一段。"""
    if inbox is None:
        loop = asyncio.get_running_loop()
        inbox = asyncio.Queue()

        def reader():
            for line in sys.stdin:
                if line.strip():
                    loop.call_soon_threadsafe(inbox.put_nowait, line)
            loop.call_soon_threadsafe(inbox.put_nowait, None)

        import threading
        threading.Thread(target=reader, daemon=True).start()

    active = None
    active_id = None

    async def interrupt():
        nonlocal active, active_id
        if active is None:
            return
        job = active_id
        if not active.done():
            active.cancel()
            if session is not None:
                try:
                    await asyncio.wait_for(session.post("/interrupt_talk", {"sessionid": session.sid}), 5)
                except Exception as exc:
                    log("取消时打断失败：%s" % exc)
            with contextlib.suppress(asyncio.CancelledError):
                await active
            emit({"event": "cancelled", "id": job})
        active = active_id = None

    async def generate(job, text, target):
        global _emit_speaking_hook
        _emit_speaking_hook = lambda name: emit({"event": name, "id": job})
        try:
            if args.stub:
                await stub_render(text, target)
            else:
                await render(session, text, target, args.wait_speech, args.wait_done)
            seconds = await probe_duration(target)
            emit({"event": "done", "id": job, "video": os.path.abspath(target),
                  "seconds": seconds, "stub": bool(args.stub)})
        except asyncio.CancelledError:
            for path in (target, target + ".trim.mp4"):
                with contextlib.suppress(FileNotFoundError):
                    os.remove(path)
            raise
        except Exception as exc:
            emit({"event": "error", "id": job, "message": str(exc)})
        finally:
            _emit_speaking_hook = None

    try:
        while True:
            line = await inbox.get()
            if line is None:
                break
            try:
                command = json.loads(line)
                if not isinstance(command, dict):
                    raise ValueError()
            except (ValueError, TypeError):
                emit({"event": "error", "id": None, "message": "命令不是合法 JSON 对象"})
                continue
            op, job = command.get("op"), command.get("id")
            if op == "quit":
                break
            if op == "ping":
                emit({"event": "pong", "id": job})
                continue
            if op == "cancel":
                if job == active_id:
                    await interrupt()
                continue
            if op != "render":
                emit({"event": "error", "id": job, "message": "未知操作"})
                continue
            text = command.get("text")
            if not isinstance(text, str) or not 0 < len(text.strip()) <= 2000:
                emit({"event": "error", "id": job, "message": "单段文本需要为 1–2000 字。"})
                continue
            target = command.get("out") or os.path.join(args.out_dir, "%s.mp4" % uuid.uuid4())
            if not isinstance(target, str):
                emit({"event": "error", "id": job, "message": "输出路径无效。"})
                continue
            await interrupt()
            active_id = job
            emit({"event": "accepted", "id": job})
            active = asyncio.create_task(generate(job, text.strip(), target))
    finally:
        await interrupt()


async def engine_model(session):
    """读引擎实际加载的模型，让界面能说清当前是什么画质档位。"""
    import aiohttp

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as http:
            async with http.get(session.base_url + "/api/admin/config") as response:
                config = (await response.json()).get("data", {}).get("config", {})
                return "%s/%s@%sfps" % (
                    config.get("model", "?"), config.get("avatar_id", "?"), config.get("fps", "?"),
                )
    except Exception as exc:
        log("读引擎配置失败：%s" % exc)
        return "unknown"


def port_of(base_url):
    from urllib.parse import urlparse
    return urlparse(base_url).port or 8010


def engine_alive(base_url):
    """用 TCP 探端口，不走 HTTP：本机地址被系统代理拦掉时会假失败。"""
    import socket
    from urllib.parse import urlparse
    host = urlparse(base_url).hostname or "127.0.0.1"
    try:
        with socket.create_connection((host, port_of(base_url)), timeout=1):
            return True
    except OSError:
        return False


def live_talking_dir():
    """解释器是 <root>/.venv/bin/python，往上退三级就是仓库根。"""
    path = os.path.abspath(sys.executable)
    for _ in range(3):
        path = os.path.dirname(path)
    return path if os.path.exists(os.path.join(path, "app.py")) else None


def normalize_path():
    """补齐常见可执行目录。

    GUI 应用拉起子进程时 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin 这一套，而本机
    ffmpeg 装在 ~/bin。引擎录制要用 ffmpeg 合音视频，找不到时它不报「缺依赖」，
    而是抛 `[Errno 2] No such file or directory: 'ffmpeg'`，看着像文件不存在。
    桥自己也用 ffmpeg 裁静音，所以这里统一改一次，子进程继承同一份环境。
    """
    home = os.path.expanduser("~")
    wanted = ["/opt/homebrew/bin", "/usr/local/bin", os.path.join(home, "bin"),
              "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    parts = [p for p in (os.environ.get("PATH") or "").split(":") if p]
    for item in wanted:
        if item not in parts:
            parts.append(item)
    os.environ["PATH"] = ":".join(parts)
    os.environ["PYTHONUNBUFFERED"] = "1"


async def edge_tts_reachable(timeout=8):
    """探一下神经语音能不能用。

    edge-tts 走微软的在线接口，断网或接口被拦时它内部只是记一条日志就返回，
    上层看到的是「画面在动但没有任何声音」，很难归因。所以起引擎前先验一次。
    """
    try:
        import edge_tts

        async def probe():
            async for chunk in edge_tts.Communicate("嗯", "zh-CN-XiaoxiaoNeural").stream():
                if chunk.get("type") == "audio":
                    return True
            return False

        return await asyncio.wait_for(probe(), timeout)
    except Exception as exc:
        log("神经语音探测失败：%s: %s" % (type(exc).__name__, exc))
        return False


async def ensure_engine(args):
    """引擎没在跑就拉起它，并等到端口可连。

    必须在 Python 侧做，不能交给桌面端：实测 GUI 应用用 Process 起一个带
    currentDirectoryURL 的子进程会卡在启动阶段——连 app.py 都打不开，也不报错，
    同样的命令交给 Python subprocess 却完全正常。
    """
    # 断网时自动退回系统语音：宁可音色差一点，也别给出一个没声音的回复。
    if args.tts == "edgetts" and not await edge_tts_reachable():
        log("神经语音不可达，本次改用系统语音 saytts")
        emit({"event": "notice",
              "message": "神经语音连不上（可能没联网），这次改用系统语音"})
        args.tts, args.voice = "saytts", "Tingting"
    if engine_alive(args.base_url):
        import aiohttp
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5), trust_env=False) as http:
            async with http.get(args.base_url.rstrip("/") + "/api/admin/config") as response:
                if response.status != 200:
                    raise BridgeError("引擎端口被其他服务占用。")
                config = (await response.json()).get("data", {}).get("config", {})
                expected = getattr(args, "model", "musetalk")
                if config.get("model") != expected:
                    raise BridgeError("正在运行的引擎模型是 %s，需要 %s；请停止旧引擎后重试。" % (config.get("model"), expected))
        return True
    root = live_talking_dir()
    if not root:
        log("找不到 LiveTalking 目录，无法自动拉起引擎")
        return False
    command = [sys.executable, "app.py", "--transport", "webrtc", "--model", getattr(args, "model", "musetalk"),
               "--avatar_id", args.avatar,
               # 仓库 config.yaml 默认 kokorotts，本机没有那个模型，必须显式指定。
               "--tts", args.tts, "--REF_FILE", args.voice,
               "--listenport", str(port_of(args.base_url))]
    logfile = os.path.join(tempfile.gettempdir(), "lingdesk-engine.log")
    log("引擎未运行，拉起：%s" % " ".join(command))
    # stdout 只能放事件，引擎的输出必须落到别的文件，否则协议会被冲垮。
    global _launched_engine
    with open(logfile, "ab", 0) as sink:
        _launched_engine = subprocess.Popen(
            command, cwd=root, stdin=subprocess.DEVNULL,
            stdout=sink, stderr=subprocess.STDOUT, start_new_session=True,
            env=dict(os.environ))
    deadline = time.time() + args.boot_timeout
    while time.time() < deadline:
        await asyncio.sleep(2)
        if _launched_engine.poll() is not None:
            raise BridgeError("口型引擎提前退出，请检查 /tmp/lingdesk-engine.log。")
        if engine_alive(args.base_url):
            log("引擎已就绪（日志 %s）" % logfile)
            return True
    log("等待引擎超时（%ss），日志见 %s" % (args.boot_timeout, logfile))
    return False


async def main_async(args):
    validate_base_url(args.base_url)
    session = None
    try:
        if not args.stub:
            if not await ensure_engine(args):
                raise BridgeError("口型引擎未能启动，请检查 /tmp/lingdesk-engine.log。")
            session = Session(args.base_url, args.avatar, args.tts, args.voice)
            await session.connect()
            await session.wait_media(args.media_timeout)
            emit({"event": "ready", "session": session.sid, "base": session.base_url,
                  "model": await engine_model(session)})
        else:
            emit({"event": "ready", "session": "stub", "model": "stub"})
        if args.once:
            target = args.once_out or os.path.join(tempfile.gettempdir(), "lingdesk-once.mp4")
            if args.stub:
                await stub_render(args.once, target)
            else:
                await render(session, args.once, target, args.wait_speech, args.wait_done)
            emit({"event": "done", "id": "once", "video": os.path.abspath(target),
                  "seconds": await probe_duration(target), "stub": bool(args.stub)})
            return 0
        await serve(session, args)
        return 0
    finally:
        if session is not None:
            await session.close()


def validate_base_url(value):
    url = urlsplit(value)
    if (url.scheme != "http" or url.hostname not in ("localhost", "127.0.0.1", "::1")
            or url.username or url.password or url.query or url.fragment or url.path not in ("", "/")):
        raise BridgeError("引擎地址必须为本机 HTTP 地址，例如 http://127.0.0.1:8010。")


async def run_process(argv, timeout=120, check=False, capture_output=True, text=False):
    """可取消的本地工具调用，超时和取消都收掉整个子进程组。"""
    proc = await asyncio.create_subprocess_exec(
        *argv, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            await asyncio.wait_for(proc.wait(), 2)
        except asyncio.TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            await proc.wait()
        raise
    if check and proc.returncode:
        raise subprocess.CalledProcessError(proc.returncode, argv, stdout, stderr)
    if text:
        stdout, stderr = stdout.decode(errors="replace"), stderr.decode(errors="replace")
    return subprocess.CompletedProcess(argv, proc.returncode, stdout, stderr)


def main(argv=None):
    normalize_path()
    atexit.register(stop_launched_engine)
    # 桌宠退出时会 terminate 桥（SIGTERM）。默认处理会直接结束进程、不跑 atexit，
    # 所以自己接管一次，保证引擎跟着走。
    def terminated(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, terminated)
    parser = argparse.ArgumentParser(description="LingDesk ↔ LiveTalking 出片桥")
    parser.add_argument("--base-url", default="http://127.0.0.1:8010")
    parser.add_argument("--out-dir", default=os.path.join(tempfile.gettempdir(), "lingdesk-replies"))
    parser.add_argument("--wait-speech", type=int, default=20, help="等待引擎开口的秒数")
    parser.add_argument("--wait-done", type=int, default=180, help="等待说完的秒数")
    parser.add_argument("--media-timeout", type=int, default=45, help="等待音视频出流的秒数")
    parser.add_argument("--avatar", default="desk_muse_1", help="引擎形象，必须和素材包是同一张脸")
    parser.add_argument("--model", default="musetalk", choices=["musetalk", "wav2lip"])
    parser.add_argument("--tts", default="saytts", help="TTS 实现：edgetts（神经语音）或 saytts（系统语音）")
    parser.add_argument("--voice", default="Tingting", help="音色名，命名随 TTS 不同")
    parser.add_argument("--boot-timeout", type=int, default=120, help="自动拉起引擎时最多等多少秒")
    parser.add_argument("--stub", action="store_true", help="不连引擎，用假片验证协议")
    parser.add_argument("--once", help="只跑一段就退出，用于调试")
    parser.add_argument("--once-out", help="配合 --once 的输出路径")
    args = parser.parse_args(argv)
    try:
        return asyncio.run(main_async(args))
    except BridgeError as exc:
        emit({"event": "error", "id": None, "message": str(exc)})
        return 1
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        # 连不上引擎属于最常见的失败，不能让它变成一段 Python traceback 糊在界面上。
        emit({"event": "error", "id": None,
              "message": "无法连接引擎 %s（%s）。先确认 LiveTalking 已启动并监听该端口。"
                         % (args.base_url, exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
