#!/usr/bin/env python3
"""Copy only songs referenced by the canonical pack, retaining IDs/lyrics/unlocks.

顺带把每首歌的时长写进 songs.json：曲库面板要显示「3:30」，
在构建时量一次，比在运行时对每次面板刷新跑 ffprobe 便宜得多。
"""
import argparse, json, shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=root / 'MALFOY-ENGINE/web/live2d/companion-content')
args = parser.parse_args()
source = root / 'assets/whale-video-test'
pack = json.loads((source / 'pack.json').read_text())
target = args.output
target.mkdir(parents=True, exist_ok=True)


def m4a_duration(path):
    """读 MP4/M4A 的 mvhd 拿时长（秒）。只用标准库，坏文件返回 None 而不是炸构建。"""
    def box(f, start, end):
        pos = start
        while pos < end:
            f.seek(pos)
            head = f.read(8)
            if len(head) < 8:
                return
            size = int.from_bytes(head[:4], 'big')
            kind = head[4:8]
            if size == 1:
                size = int.from_bytes(f.read(8), 'big')
            if size < 8:
                return
            yield kind, pos, size
            pos += size

    try:
        with open(path, 'rb') as f:
            total = f.seek(0, 2)
            for kind, pos, size in box(f, 0, total):
                if kind != b'moov':
                    continue
                for inner, ipos, isize in box(f, pos + 8, pos + size):
                    if inner != b'mvhd':
                        continue
                    f.seek(ipos + 8)
                    version = f.read(4)[0]
                    skip = 16 if version == 1 else 8
                    f.seek(ipos + 8 + 4 + skip)
                    timescale = int.from_bytes(f.read(4), 'big')
                    dur_len = 8 if version == 1 else 4
                    duration = int.from_bytes(f.read(dur_len), 'big')
                    if not timescale or duration in (0, 0xFFFFFFFF):
                        return None
                    return duration / timescale
    except (OSError, IndexError):
        return None
    return None


for song in pack['songs']:
    rel = Path(song['file'])
    if rel.is_absolute() or '..' in rel.parts:
        raise ValueError('Unsafe song path')
    original = source / rel
    if not original.is_file():
        raise FileNotFoundError(original)
    (target / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(original, target / rel)
    seconds = m4a_duration(original)
    if seconds:
        song['duration'] = round(seconds, 2)

(target / 'songs.json').write_text(json.dumps({'songs': pack['songs']}, ensure_ascii=False, indent=2) + '\n')
print(f"Prepared {len(pack['songs'])} songs from canonical pack")
