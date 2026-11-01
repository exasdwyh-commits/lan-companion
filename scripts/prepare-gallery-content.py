#!/usr/bin/env python3
"""把相册/剧情需要的文件从 assets 真源铺到运行内容目录。

只复制 pack.json 里登记的文件（album[].file / album[].desktopFile、clips[].image），
按内容哈希跳过未变化的文件；不移动、不删除原片。
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "whale-video-test"
DEFAULT_TARGET = ROOT / "MALFOY-ENGINE" / "web" / "live2d" / "companion-content"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_TARGET)
    args = parser.parse_args()
    target = args.output
    target.mkdir(parents=True, exist_ok=True)

    pack = json.loads((SOURCE / "pack.json").read_text())
    wanted = ["pack.json"]
    wanted += [item["file"] for item in pack.get("album", [])]
    wanted += [item["desktopFile"] for item in pack.get("album", []) if item.get("desktopFile")]
    wanted += [clip["image"] for clip in pack.get("clips", []) if clip.get("image")]

    copied = skipped = missing = 0
    for rel in dict.fromkeys(wanted):
        src = SOURCE / rel
        if not src.is_file():
            print(f"missing: {rel}")
            missing += 1
            continue
        dst = target / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.is_file() and digest(dst) == digest(src):
            skipped += 1
            continue
        shutil.copy2(src, dst)
        copied += 1

    print(f"gallery content: copied={copied} unchanged={skipped} missing={missing} target={target}")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
