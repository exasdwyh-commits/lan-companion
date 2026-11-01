#!/usr/bin/env python3
"""常驻语音转写服务（faster-whisper）
POST /stt   body=音频二进制  → {"text": "...", "ms": 123}
GET  /health                 → {"ok": true, "model": "small"}
"""
import json, time, sys, os, tempfile, shutil, subprocess
import numpy as np
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_SIZE = os.environ.get("STT_MODEL", "small")
PORT = int(os.environ.get("STT_PORT", "8090"))
MODEL_DIR = os.path.expanduser(os.environ.get("STT_MODEL_DIR", "~/.smartcompanion/models"))


def resolve_model(name: str) -> str:
    """本地目录存在就用路径，不要传模型名。

    faster-whisper 传 "small" 这种名字会先调 huggingface_hub 查 revision，
    缓存明明躺在磁盘上，断网（或 HF 被墙）时启动直接抛 SSLError 起不来。
    2026-11-01 实测：base 模型两次启动都死在这一步。
    """
    if os.sep in name or os.path.isdir(name):
        return name
    local = os.path.join(MODEL_DIR, f"faster-whisper-{name}")
    return local if os.path.isdir(local) else name


def find_ffmpeg():
    """ffmpeg 绝对路径。launchd 下 PATH 不可靠，和 main.js 的探测顺序保持一致。"""
    cands = [os.environ.get("FFMPEG_BIN", ""), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg",
             os.path.expanduser("~/.hermes/tools/ffmpeg-9.0.1-darwin-arm64/ffmpeg"),
             shutil.which("ffmpeg") or ""]
    for c in cands:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


FFMPEG = find_ffmpeg()

print(f"[stt] loading {MODEL_SIZE} ...", flush=True)
t0 = time.time()
from faster_whisper import WhisperModel
model = WhisperModel(resolve_model(MODEL_SIZE), device="cpu", compute_type="int8")
print(f"[stt] model ready in {time.time()-t0:.1f}s", flush=True)
print(f"[stt] decode via {'ffmpeg ' + FFMPEG if FFMPEG else 'PyAV（回退）'}", flush=True)


def decode(path: str):
    """ffmpeg → 16k 单声道 float32。返回 None 表示交给 faster-whisper 自己解。

    自己解的两条理由：
      1) faster-whisper 1.2.1 调 av.open(metadata_errors=...) 传了 PyAV 19 已移除的参数，
         传路径必抛 TypeError。2026-11-01 实测：新起的进程全部 500，只有 10-30 启动的
         老进程（内存里还是旧 av）活着 —— 也就是「重启即失效」。
      2) 走 PyAV 解 opus/webm 比 ffmpeg 慢 0.5~0.7s（实测 1.6s vs 0.85s）。
    """
    if not FFMPEG:
        return None
    try:
        p = subprocess.run(
            [FFMPEG, "-v", "quiet", "-nostdin", "-i", path,
             "-ar", "16000", "-ac", "1", "-f", "s16le", "-"],
            capture_output=True, timeout=30)
        # 少于 0.1s 的音频当没录到，别让 whisper 对着噪声编句台词
        if p.returncode == 0 and len(p.stdout) > 3200:
            return np.frombuffer(p.stdout, np.int16).astype(np.float32) / 32768.0
    except Exception:
        pass
    return None


def transcribe(data: bytes) -> str:
    fd, path = tempfile.mkstemp(suffix=".wav")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        audio = decode(path)
        segs, info = model.transcribe(
            audio if audio is not None else path,
            language="zh", beam_size=1, vad_filter=True)
        return "".join(s.text for s in segs).strip()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "model": MODEL_SIZE})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/stt":
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return self._json(400, {"error": "empty body"})
        data = self.rfile.read(n)
        t0 = time.time()
        try:
            text = transcribe(data)
        except Exception as e:
            return self._json(500, {"error": str(e)[:200]})
        self._json(200, {"text": text, "ms": int((time.time() - t0) * 1000)})


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[stt] listening on 127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
