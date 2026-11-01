#!/usr/bin/env python3
"""从 character.json / pack.json 推导运行必需的素材清单。

用途：打包时只复制配置真正引用的文件，避免把原片、中间成品、
上一版素材一起塞进 .app（当前鲸鱼包因此多带了 437MB 死重）。

    python3 scripts/pack-assets.py assets/whale-video-test

输出：每行一个文件名，可直接被 while read 消费。
解析不到任何媒体引用、或引用的文件不存在时，以非零退出码失败，
避免打出一个看起来正常但缺素材的包。
"""
import json
import os
import sys

MEDIA_EXT = {
    ".png", ".jpg", ".jpeg", ".heic", ".tiff", ".gif",
    ".mp4", ".mov", ".m4v", ".webm",
    ".wav", ".m4a", ".mp3", ".aiff", ".caf",
}
CONFIG_FILES = ("character.json", "pack.json")


def collect(node, out):
    if isinstance(node, str):
        if os.path.splitext(node)[1].lower() in MEDIA_EXT:
            out.add(node)
    elif isinstance(node, dict):
        for value in node.values():
            collect(value, out)
    elif isinstance(node, list):
        for value in node:
            collect(value, out)


def main():
    if len(sys.argv) < 2:
        sys.exit("用法: pack-assets.py <素材目录>")
    asset_dir = sys.argv[1]
    if not os.path.isdir(asset_dir):
        sys.exit(f"素材目录不存在: {asset_dir}")

    refs = set()
    parsed = []
    for name in CONFIG_FILES:
        path = os.path.join(asset_dir, name)
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                collect(json.load(fh), refs)
        except json.JSONDecodeError as exc:
            sys.exit(f"{name} 解析失败: {exc}")
        refs.add(name)
        parsed.append(name)

    if not parsed:
        sys.exit(f"{asset_dir} 里没有 character.json / pack.json，无法推导素材清单")

    media = refs - set(CONFIG_FILES)
    if not media:
        sys.exit(f"{' / '.join(parsed)} 里没有任何媒体引用，拒绝打出空素材包")

    missing = [r for r in sorted(refs) if not os.path.exists(os.path.join(asset_dir, r))]
    if missing:
        sys.exit("配置引用了不存在的文件: " + ", ".join(missing))

    for name in sorted(refs):
        print(name)


if __name__ == "__main__":
    main()
