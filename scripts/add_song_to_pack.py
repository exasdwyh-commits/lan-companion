#!/usr/bin/env python3
"""把一首歌登记进内容包的 songs 数组。

用法:
    python3 scripts/add_song_to_pack.py <音频文件> --title 潮汐 --unlock 12
    python3 scripts/add_song_to_pack.py cover.m4a --title 潮汐 --lyrics tide.json

歌词时间轴可选（sing_from_lyrics.sh 产出的 json）。翻唱现成歌曲没有逐句
时间轴，就不传 --lyrics：她唱的时候不显示逐句歌词，只出声。
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys

FFPROBE = os.environ.get("FFPROBE", "/opt/homebrew/bin/ffprobe")


def probe_seconds(path: str) -> float:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path], capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        sys.exit(f"读不出时长（文件是音频吗）: {path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--pack", default="assets/whale-video-test/pack.json")
    ap.add_argument("--title", required=True)
    ap.add_argument("--unlock", type=int, default=0, help="好感度解锁门槛，0 = 一开始就能点")
    ap.add_argument("--credit", default="", help="显示的署名/来源说明")
    ap.add_argument("--lyrics", default="", help="逐句歌词时间轴 json（可选）")
    args = ap.parse_args()

    src = os.path.abspath(args.audio)
    if not os.path.isfile(src):
        sys.exit(f"不存在: {src}")
    pack_path = os.path.abspath(args.pack)
    songs_dir = os.path.join(os.path.dirname(pack_path), "songs")
    os.makedirs(songs_dir, exist_ok=True)

    stem = hashlib.sha1((args.title + str(os.path.getmtime(src))).encode()).hexdigest()[:8]
    dest = os.path.join(songs_dir, f"{stem}.m4a")
    if os.path.realpath(src) != os.path.realpath(dest):
        shutil.copy2(src, dest)

    with open(pack_path, encoding="utf-8") as f:
        pack = json.load(f)
    songs = pack.setdefault("songs", [])
    if any(s.get("file") == f"songs/{os.path.basename(dest)}" for s in songs):
        print("已在包里，跳过:", dest)
        return 0

    song = {
        "id": f"song-{stem}",
        "title": args.title,
        "file": f"songs/{os.path.basename(dest)}",
        "unlockAt": args.unlock,
        "volume": 0.8,
    }
    if args.credit:
        song["credit"] = args.credit
    if args.lyrics:
        with open(args.lyrics, encoding="utf-8") as f:
            timeline = json.load(f)
        # pack.json 的歌词是数组形式；时间轴文件可能是 {"lines":[...]} 或裸数组。
        lines = timeline["lines"] if isinstance(timeline, dict) else timeline
        song["lyrics"] = lines

    songs.append(song)
    with open(pack_path, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, indent=2)
        f.write("\n")

    seconds = probe_seconds(dest)
    print(f"已登记: {args.title}  {seconds:.1f}s  unlockAt={args.unlock}")
    print(f"  音频: {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
