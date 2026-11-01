#!/usr/bin/env python3
"""从一首成品歌里做出一档可用的音色参考。

为什么需要这个：音色档案（`assets/voices/voices.json`）里每一档都要一条
`ref-*.wav` 才能用。现有的三条是用 Qwen3-TTS VoiceDesign 合成的 ——
那只是「按文字描述想象出来的声音」，不是任何真人。

要真的像某个歌手，唯一的办法是拿到**这个人的声音本身**。给一首她的歌，
这个脚本负责把其中的「她的声音」榨出来：

    ffmpeg 解码 → demucs 去掉伴奏 → 挑最唱得实的一段 → 44.1k 单声道 → 归一化

挑片段复用 `voice_range.loudest_window()`：它按 0.5s 窗算 RMS 再做滑窗平均，
选的是「整段都唱得满」的位置，而不是单个爆音。主歌不能当参考 —— 音域窄、
编曲薄、气声多，克隆出来会又虚又薄。

用法:
    python3 scripts/voice-from-song.py --in 孙燕姿-某首歌.mp3 --id sunyanzi --name 孙燕姿
    python3 scripts/voice-from-song.py --in song.flac --id sunyanzi --seconds 30 --dry-run

产出默认落在 `~/.smartcompanion/voices/<id>.wav`（音色档案的第一优先查找位置）。
脚本最后会把该写进 voices.json 的 range 字段打印出来。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from voice_range import analyze, loudest_window  # noqa: E402  同目录的工具，复用而不是重写

DEFAULT_VOICE_ROOT = os.path.expanduser("~/.smartcompanion/voices")
DEFAULT_SING_PY = os.path.join(ROOT, "..", ".venvs/sing/bin/python")
DEMUCS_MODEL = "htdemucs"


def find_tool():
    """找能跑 demucs 的解释器。优先项目自带的 sing venv，其次当前解释器。

    顺带要求 numpy / soundfile —— 本脚本自己要算 RMS 和基频，
    光有 demucs 不够，不然会在分析那一步才炸（实测：系统 python3 没 numpy）。
    """
    probes = "import demucs, torch, numpy, soundfile"
    candidates = [os.environ.get("SING_PYTHON", ""), os.path.abspath(DEFAULT_SING_PY), sys.executable]
    for py in candidates:
        if not py or not os.path.exists(py):
            continue
        probe = subprocess.run([py, "-c", probes], capture_output=True)
        if probe.returncode == 0:
            return py
    raise SystemExit(
        "找不到装齐 demucs/torch/numpy/soundfile 的 Python。\n"
        "装法：项目下的 .venvs/sing 应该有；或用 SING_PYTHON=/path/to/python 指定。"
    )


def ensure_runtime():
    """当前解释器不够用时，换成能找到的那个重跑自己。

    调用方不必知道该用哪个 python —— 直接 `python3 scripts/voice-from-song.py ...` 就该能跑。
    """
    try:
        import numpy, soundfile  # noqa: F401
        return
    except ImportError:
        pass
    py = find_tool()
    if os.path.abspath(py) == os.path.abspath(sys.executable):
        raise SystemExit("当前 Python 缺 numpy/soundfile，且找不到替代解释器。")
    os.execv(py, [py, os.path.abspath(__file__), *sys.argv[1:]])


def run(cmd, what, **kwargs):
    """外部命令失败时给出「哪一步失败」，而不是让用户对着 traceback 猜。"""
    result = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip().splitlines()[-6:]
        raise SystemExit(f"{what}失败：\n  " + "\n  ".join(tail))
    return result


def main() -> int:
    ensure_runtime()
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="src", required=True, help="一首歌（mp3/m4a/wav/flac 都行）")
    parser.add_argument("--id", required=True, help="音色档案 id，例如 sunyanzi")
    parser.add_argument("--name", default="", help="界面显示的名字，只用于打印提示")
    parser.add_argument("--seconds", type=float, default=25.0, help="参考片段长度（默认 25 秒）")
    parser.add_argument("--out", default="", help="输出 wav 路径（默认为音色库目录下 <id>.wav）")
    parser.add_argument("--voice-root", default=DEFAULT_VOICE_ROOT, help="音色库目录")
    parser.add_argument("--python", default="", help="跑 demucs 的 Python（默认自动找）")
    parser.add_argument("--highpass", type=float, default=90.0,
                        help="分离后先切掉多少 Hz 以下的残留（默认 90。demucs 会漏底鼓/贝斯进 vocals，"
                             "不切的话基频分析会把 60-80Hz 的低频当成人声最低音，"
                             "推荐变调就会偏低。女声 120 也安全，男低音别超过 70）")
    parser.add_argument("--f0-min", type=float, default=130.0,
                        help="基频搜索下限（默认 130，适用女声）。harvest 会在弱信号处把音高判成低八度，"
                             "设下限比加高通有效。测男声用 70~85")
    parser.add_argument("--keep", action="store_true", help="保留分离出来的中间文件，便于排查")
    parser.add_argument("--dry-run", action="store_true", help="只分析并打印，不写文件")
    args = parser.parse_args()

    src = os.path.abspath(args.src)
    if not os.path.exists(src):
        raise SystemExit(f"找不到输入文件：{src}")
    ffmpeg = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    if not os.path.exists(ffmpeg):
        raise SystemExit("找不到 ffmpeg。")
    py = args.python or find_tool()
    out = args.out or os.path.join(args.voice_root, f"{args.id}.wav")

    work = tempfile.mkdtemp(prefix="voice-from-song-")
    try:
        print(f"[1/4] 解码 {os.path.basename(src)}")
        plain = os.path.join(work, "in.wav")
        # demucs 吃标准采样率与声道数最稳，先统一一遍
        run([ffmpeg, "-v", "error", "-y", "-i", src, "-ar", "44100", "-ac", "2", plain], "解码")

        print(f"[2/4] 分离人声（{DEMUCS_MODEL}，CPU 上几分钟）")
        env = dict(os.environ)
        # 权重收在项目里，不散到家目录缓存 —— 与 sing_cover_file.sh 保持一致
        env["TORCH_HOME"] = os.path.join(os.path.abspath(ROOT), ".models/torch")
        run([py, "-m", "demucs", "-n", DEMUCS_MODEL, "--two-stems=vocals",
             "-o", os.path.join(work, "demucs"), plain], "人声分离", env=env)
        vocals = os.path.join(work, "demucs", DEMUCS_MODEL, "in", "vocals.wav")
        if not os.path.exists(vocals):
            raise SystemExit("分离没有产出 vocals.wav。")

        # demucs 的 two-stems 不是保险箱：底鼓和贝斯会漏一点进 vocals。
        # 不切掉，analyze 的 p05 会落在 60~80Hz（实测孙燕姿那首给出 76Hz，
        # 而她的实唱最低约 165Hz），据此推荐变调会整体偏低一截。
        if args.highpass > 0:
            clean = os.path.join(work, "vocals-clean.wav")
            run([ffmpeg, "-v", "error", "-y", "-i", vocals,
                 "-af", f"highpass=f={args.highpass:g}:poles=2", clean], "去低频残留")
            vocals = clean
            print(f"      已切掉 {args.highpass:g}Hz 以下的残留")

        print(f"[3/4] 挑最唱得实的 {args.seconds:.0f} 秒")
        start = loudest_window(vocals, args.seconds)
        stats = analyze(vocals, f0_min=args.f0_min)
        print(f"      起点 {start:.1f}s · 音域 p05={stats.get('p05', 0):.0f}Hz "
              f"p50={stats.get('p50', 0):.0f}Hz p90={stats.get('p90', 0):.0f}Hz")

        print("[4/4] 裁剪 + 归一化")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        # 参考音频只看音色统计，峰值压到 -1.5dB 够用且不会削波；
        # 用 loudnorm 会改动动态，对「学音色」没有好处。
        run([ffmpeg, "-v", "error", "-y", "-ss", f"{start}", "-t", f"{args.seconds}",
             "-i", vocals, "-ac", "1", "-ar", "44100",
             "-af", "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,"
                    "dynaudnorm=f=250:g=9:p=0.9,alimiter=limit=0.84",
             out], "裁剪归一")
        if args.dry_run:
            print(f"\n(dry-run) 本会写到 {out}")
        else:
            size = os.path.getsize(out)
            if size < 40000:
                raise SystemExit(f"产物只有 {size} 字节，太短了 —— 这首歌的人声可能没分离出来。")
            print(f"\n已写出 {out}（{size / 1024:.0f} KB，{args.seconds:.0f} 秒）")
    finally:
        if args.keep:
            print(f"中间文件留在 {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)

    # 直接把该填的字段打出来，省得再去看文档
    # 上限从 p90 外扩：p90 已经是「这首歌高音区的 90 分位」，不是极限。
    # 外扩 1.5 倍太松（实测 415Hz×1.5=622Hz，比孙燕姿的 B4=494 高了四个半音），
    # 1.25 倍更贴实际能唱到的头声区。
    lo = round(stats["p05"]) if stats.get("p05") else None
    hi = round(stats["p90"] * 1.25) if stats.get("p90") else None
    block = {
        "id": args.id,
        "name": args.name or args.id,
        "ref": os.path.basename(out),
        "range": {"lo": lo, "hi": hi},
    }
    print("\n把这条加进 assets/voices/voices.json 的 voices 数组：")
    print(json.dumps(block, ensure_ascii=False, indent=2))
    print("\n说明：lo/hi 是从这首歌的实唱音域估的（p05 / p90×1.5），")
    print("      它反映的是「这首歌她唱到哪里」，不等于她的极限音域。")
    print("      要更准就多给几首不同音域的歌，取各自 p05 的最低与 p90 的最高。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
