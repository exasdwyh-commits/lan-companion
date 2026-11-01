#!/usr/bin/env python3
"""把长人声轨切成 Seed-VC 在 MPS 上吃得下的片段。

背景：Seed-VC 自带分片处理（源 >30 秒时按 30s chunk 切语义特征），
但 `inference.py` 里 `mel = mel_fn(source_audio...)` 是**整条**算的，没有分片。
所以 210 秒的歌在 M5 Pro 上照样 OOM（实测
`Insufficient Memory ... kIOGPUCommandBufferCallbackErrorOutOfMemory`），
而 24 秒的片段走不到这个分支，问题就被藏住了。

解决办法是在外面先切段，每段 ≤ CHUNK 秒 —— 正好落在它「不分片」的简单路径上。
切点不硬取 CHUNK 秒整，而是在边界附近找能量最低的一帧，尽量落在句间停顿，
减少拼接处的咔哒声。

用法：
    python3 scripts/split_vocals.py --in vocals.wav --out-dir chunks --plan chunk-plan.json

输出片段到 --out-dir（vocal-00.wav ...），并把切点计划写到 --plan 供拼接用。
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import librosa
import numpy as np

FFMPEG = os.environ.get("FFMPEG", "/Users/exasdwyh/bin/ffmpeg")

CHUNK = 29.0    # 每段目标长度（秒），留 1 秒余量确保 ≤30
SEARCH = 2.5    # 在理想边界前后多长范围内找最安静的点
MIN_GAP = 5.0   # 相邻切点最小间隔，避免最后剩一个碎渣


def probe_duration(path: str) -> float:
    """用 ffmpeg 读时长，避免为了一个数字把整条音频读进内存。"""
    proc = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, check=False,
    )
    for line in (proc.stderr or "").splitlines():
        if "Duration:" in line:
            hms = line.split("Duration:")[1].split(",")[0].strip()
        else:
            continue
        hh, mm, ss = hms.split(":")
        return int(hh) * 3600 + int(mm) * 60 + float(ss)
    raise SystemExit(f"读不出时长: {path}")


def plan_bounds(rms: np.ndarray, times: np.ndarray, total: float,
                chunk: float = CHUNK, search: float = SEARCH,
                min_gap: float = MIN_GAP) -> list[float]:
    bounds = [0.0]
    if not np.isfinite(total) or total <= 0 or not np.isfinite(chunk) or not 0 < chunk < 30:
        raise ValueError('音频时长必须为正，分片上限必须在 0 到 30 秒之间。')
    while total - bounds[-1] > chunk:
        # 段长硬上限：切点只能在 ±search 内浮动，否则会退回 >30 秒的分片路径，
        # 而那条路径的 mel 是整条算的，照样 OOM。
        hi = min(bounds[-1] + chunk, total - min_gap)
        lo = max(hi - search, bounds[-1] + min_gap)
        sel = (times >= lo) & (times <= hi)
        cut = float(times[int(np.argmin(np.where(sel, rms, np.inf)))]) if sel.any() else hi
        if cut <= bounds[-1]:
            cut = min(bounds[-1] + chunk, total)
        bounds.append(cut)
    bounds.append(total)
    return bounds


def main() -> int:
    parser = argparse.ArgumentParser(description="切分长人声轨")
    parser.add_argument("--in", dest="src", required=True, help="人声 wav")
    parser.add_argument("--out-dir", dest="outdir", required=True, help="片段输出目录")
    parser.add_argument("--plan", dest="plan", required=True, help="切点计划 json")
    parser.add_argument("--chunk", type=float, default=CHUNK, help="每段目标秒数")
    parser.add_argument("--search", type=float, default=SEARCH, help="边界搜索范围秒数")
    parser.add_argument("--min-gap", type=float, default=MIN_GAP, help="切点最小间隔")
    args = parser.parse_args()

    if not os.path.isfile(args.src):
        raise SystemExit(f"文件不存在: {args.src}")
    os.makedirs(args.outdir, exist_ok=True)

    total = probe_duration(args.src)
    y, sr = librosa.load(args.src, sr=44100, mono=True)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)

    bounds = plan_bounds(rms, times, total, args.chunk, args.search, args.min_gap)
    plan = []
    for i in range(len(bounds) - 1):
        start, end = bounds[i], bounds[i + 1]
        plan.append({
            "index": i,
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(end - start, 3),
            "chunk": os.path.join(args.outdir, f"vocal-{i:02d}.wav"),
        })

    for item in plan:
        subprocess.run(
            [FFMPEG, "-y", "-v", "error", "-i", args.src,
             "-ss", str(item["start"]), "-to", str(item["end"]),
             "-ar", "44100", "-ac", "1", item["chunk"]],
            check=True,
        )
        print(f"  [{item['index']}] {item['duration']:.2f}s  {os.path.basename(item['chunk'])}")

    os.makedirs(os.path.dirname(os.path.abspath(args.plan)) or ".", exist_ok=True)
    with open(args.plan, "w", encoding="utf-8") as handle:
        json.dump(plan, handle, ensure_ascii=False, indent=2)
    print(f"共 {len(plan)} 段，源总长 {total:.2f}s，计划已写入 {args.plan}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
