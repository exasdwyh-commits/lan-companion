#!/usr/bin/env python3
"""把音色档案从 assets 真源铺进打包目录。

产物结构：
    <output>/voices.json
    <output>/voices/ref-magnetic.wav ...

孙燕姿这类需要用户自备参考音频的音色，在档案里没有 ref 文件，这里跳过即可 ——
她的 range 照样参与音域分析，只是合成不了。内置音色缺文件必须报错，
否则打出来的包点「做整首」才发现没声音。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "voices"
# 内置音色必须齐全；用户可以自己往后加，但缺了内置的不许构建。
REQUIRED = {"magnetic", "warm", "cool-thick"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, help="companion-content 目录")
    parser.add_argument("--source", default=str(SOURCE))
    args = parser.parse_args()

    source = Path(args.source)
    manifest = source / "voices.json"
    if not manifest.exists():
        print(f"[voices] 缺少音色档案: {manifest}", file=sys.stderr)
        return 1

    data = json.loads(manifest.read_text(encoding="utf-8"))
    voices = data.get("voices") or []
    if not voices:
        print("[voices] 档案里一首音色都没有", file=sys.stderr)
        return 1

    output = Path(args.output)
    (output / "voices").mkdir(parents=True, exist_ok=True)
    shutil.copy2(manifest, output / "voices.json")

    copied, missing = [], []
    for voice in voices:
        name = voice.get("ref")
        if not name:
            # 用户自备参考的音色：只带定义，不打包音频
            continue
        src = source / name
        if not src.exists():
            if voice.get("id") in REQUIRED:
                missing.append(voice.get("id"))
            continue
        shutil.copy2(src, output / "voices" / name)
        copied.append(voice.get("id"))

    if missing:
        print(f"[voices] 内置音色缺参考音频: {', '.join(missing)}", file=sys.stderr)
        return 1

    print(f"[voices] {len(copied)} 档音色已铺入 {output}（{', '.join(copied)}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
