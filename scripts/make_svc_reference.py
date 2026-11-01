#!/usr/bin/env python3
"""给 Seed-VC 造一条参考音色样本。

参考音频决定翻唱输出的音色，这里有两个相互矛盾的约束：
  1. Qwen3-TTS 一次只肯吐一句短的（实测 3~4 秒）；
  2. Seed-VC 要从参考里学音色统计，参考太短就只能抓到粗糙的包络，
     听起来就是「尖、薄、没有厚度」。

所以做法是：多段合成 → 逐段裁掉首尾静音 → 拼成一条长的 → 重采样到 44.1kHz
（歌声模型跑 44kHz，而 TTS 只出 24kHz，奈奎斯特截止 12kHz）。

用法:
    python3 scripts/make_svc_reference.py --preset magnetic --out ref-magnetic.wav
    python3 scripts/make_svc_reference.py --list
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

FFMPEG = os.environ.get("FFMPEG", "/Users/exasdwyh/bin/ffmpeg")
TTS_URL = os.environ.get("TTS_URL", "http://127.0.0.1:8091/tts")

# 所有预设共用同一批句子，这样对比出来的差异只来自 instruct，不受文本影响。
# 挑的都是带停顿、气息和情绪的句子 —— 干巴巴的陈述句学不出「唱功感」。
TEXTS = [
    "夜色落下来的时候，我习惯把灯调得很暗，听一首老歌。",
    "你知道吗，有些话说得太早，就会变得没有重量。",
    "风从窗缝里挤进来，带着一点海的咸味。",
    "我数着潮汐的声音，一遍，又一遍。",
    "如果可以的话，我想把这首歌，唱给很远很远的人听。",
]

PRESETS = {
    # 主打：磁性 + 女歌手质感。磁性主要来自气声和低频共鸣，不是靠压低音高。
    "magnetic": (
        "A mature female singer's voice, warm and magnetic with a slightly husky, "
        "breathy texture. Rich chest resonance, dark and velvety low-mid range, "
        "smooth and controlled with natural vibrato, intimate and emotional, "
        "unhurried medium-slow pace, like a woman singing softly late at night."
    ),
    # 稳妥版：保留角色辨识度，但把亮度压下来、厚度加上去。
    "warm": (
        "A gentle young woman's speaking voice, warm and rounded rather than bright "
        "or thin. Lower register with a soft, full-bodied tone, calm and intimate, "
        "slightly breathy, relaxed medium pace, gentle and comforting."
    ),
    # 保辨识度版：维持清冷气质，只是把音色重心往下挪。
    "cool-thick": (
        "A cool, elegant young female voice with a noticeably lower and fuller "
        "register. Velvety and composed rather than bright, subtle breathiness, "
        "calm and slightly mysterious, medium-slow pace, restrained emotion."
    ),
}


def tts(text: str, instruct: str) -> bytes:
    body = json.dumps({"text": text, "instruct": instruct}).encode("utf-8")
    req = urllib.request.Request(
        TTS_URL, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read()


def concat(files: list[str], out: str) -> None:
    """裁掉每段首尾静音再拼起来。

    TTS 每条尾巴都拖着 0~1 秒不等的静音，直接 concat 会让段与段之间越来越拖。
    倒放 → 裁头 → 再倒放，比 stop_periods 可控，不会误伤句内的自然停顿。
    """
    args: list[str] = []
    for f in files:
        args += ["-i", f]
    per = ";".join(
        f"[{i}:a]silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,"
        f"areverse,silenceremove=start_periods=1:start_silence=0.30:start_threshold=-45dB,"
        f"areverse[a{i}]"
        for i in range(len(files))
    )
    graph = (
        per
        + ";"
        + "".join(f"[a{i}]" for i in range(len(files)))
        + f"concat=n={len(files)}:v=0:a=1[out]"
    )
    args += [
        "-filter_complex", graph,
        "-map", "[out]",
        "-ar", "44100", "-ac", "1", "-y", out,
    ]
    subprocess.run([FFMPEG, "-v", "error", *args], check=True)


def duration(path: str) -> float:
    out = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path],
        capture_output=True, text=True, check=False,
    ).stderr
    for line in out.splitlines():
        if "Duration:" in line:
            clock = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = clock.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preset", help=f"预设名之一: {', '.join(PRESETS)}")
    parser.add_argument("--list", action="store_true", help="列出所有预设及其描述")
    parser.add_argument("--instruct", help="自定义音色描述（覆盖 preset）")
    parser.add_argument("--texts", nargs="*", help="自定义文本（覆盖默认句子）")
    parser.add_argument("--out", help="输出 wav 路径")
    args = parser.parse_args()

    if args.list:
        for name, text in PRESETS.items():
            print(f"--- {name} ---\n{text}\n")
        return 0

    if not args.out:
        raise SystemExit("需要 --out")
    instruct = args.instruct or PRESETS.get(args.preset or "", "")
    if not instruct:
        raise SystemExit(f"未知预设 {args.preset}，可选: {', '.join(PRESETS)}")
    texts = args.texts or TEXTS

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    work = tempfile.mkdtemp(prefix="svcref-")
    try:
        files = []
        for i, text in enumerate(texts):
            path = os.path.join(work, f"{i:02d}.wav")
            with open(path, "wb") as handle:
                handle.write(tts(text, instruct))
            files.append(path)
            print(f"  [{i + 1}/{len(texts)}] {duration(path):.2f}s  {text[:20]}", flush=True)
        concat(files, out)
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)

    print(f"参考样本: {out}  {duration(out):.2f}s")
    if duration(out) < 10:
        print("警告: 参考不足 10 秒，Seed-VC 可能学不到稳定音色")
    return 0


if __name__ == "__main__":
    sys.exit(main())
