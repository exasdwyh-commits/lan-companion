#!/usr/bin/env python3
"""给翻唱人声做音色整形。

为什么需要这一步：Seed-VC 只负责「把源人声换成参考的音色」，它不管成品好不好听。
实测下来（见 benchmarks/2026-10-31-DW-05-workbuddy/），换参考对频谱重心的
影响只有 ±5%，输出音色基本还是跟着源人声走。用户反馈的「太尖、不够磁性」
只能靠频谱塑形来解。

三刀分别对应三个听感问题：
  削 4~6kHz   去刺耳的「尖」（人耳最敏感的齿音区就在这）
  抬 180~300Hz 加厚度与胸腔感，磁性的主要来源
  抬 10~13kHz 补回空气感，避免削完高频后发闷
  压缩         气息与咬字力度更稳定，就是所谓的「唱功感」

用法:
    python3 scripts/shape_vocal.py --in her.wav --out her-warm.wav --preset warm
    python3 scripts/shape_vocal.py --list
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile

FFMPEG = os.environ.get("FFMPEG", "/Users/exasdwyh/bin/ffmpeg")


def eq(freq: int, gain: float, octaves: float = 1.0) -> str:
    return f"equalizer=f={freq}:t=q:width_type=o:w={octaves}:g={gain}"


# 每档都是「高频削多少 / 低频抬多少 / 压多狠」的组合，强度递增。
PRESETS: dict[str, dict] = {
    "warm": {
        "desc": "温和磁性：略微增厚，压掉一点刺耳感，保留原本的角色辨识度",
        "chain": [
            "highpass=f=70",
            eq(250, 4.5, 1.2),
            eq(5000, -4.5, 1.2),
            eq(12000, 1.5, 1.0),
            "acompressor=threshold=-18dB:ratio=3:attack=12:release=160",
        ],
    },
    "rich": {
        "desc": "厚暗：明显增厚压暗，磁性最强，但角色会更「成熟」一些",
        "chain": [
            "highpass=f=70",
            eq(180, 5.5, 1.0),
            eq(450, 2.0, 1.0),
            eq(4200, -5.5, 1.5),
            eq(8000, -3.0, 1.0),
            "acompressor=threshold=-20dB:ratio=3.5:attack=15:release=180",
        ],
    },
    "studio": {
        "desc": "录音棚人声：削刺 + 补谐波 + 压缩，最接近商业女歌手的成品质感",
        "chain": [
            "highpass=f=80",
            eq(240, 4.0, 1.0),
            eq(700, 1.5, 1.0),
            eq(3000, -2.0, 1.0),
            eq(5500, -5.0, 1.2),
            # 削齿音后再补谐波：exciter 只在 10kHz 以上加空气感，
            # 不会把刚削掉的 5~6kHz 刺耳段补回来。
            "aexciter=freq=10000:drive=2:amount=0.3:blend=0.5",
            "acompressor=threshold=-16dB:ratio=2.5:attack=10:release=140",
        ],
    },
}


def measure_mean_db(path: str) -> float | None:
    """用 ffmpeg 的 volumedetect 读平均电平。

    不引第三方依赖，系统 python 也能跑。
    """
    proc = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True, check=False,
    )
    match = re.search(r"mean_volume:\s*(-?[\d.]+)\s*dB", proc.stderr)
    return float(match.group(1)) if match else None


def run_chain(src: str, out: str, chain: list[str]) -> None:
    cmd = [
        FFMPEG, "-y", "-v", "error", "-i", src,
        "-af", ",".join(chain),
        "-ar", "44100", "-ac", "1", out,
    ]
    subprocess.run(cmd, check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="src", help="输入人声 wav")
    parser.add_argument("--out", help="输出 wav")
    parser.add_argument("--preset", help=f"预设: {', '.join(PRESETS)}")
    parser.add_argument("--list", action="store_true", help="列出预设")
    parser.add_argument("--no-match-level", dest="match_level", action="store_false",
                        help="不做响度补偿（默认补回整形掉的电平）")
    args = parser.parse_args()

    if args.list:
        for name, cfg in PRESETS.items():
            print(f"--- {name} ---\n{cfg['desc']}\n")
        return 0

    if not args.src or not args.out:
        raise SystemExit("需要 --in 与 --out")
    preset = PRESETS.get(args.preset or "")
    if not preset:
        raise SystemExit(f"未知预设 {args.preset}，可选: {', '.join(PRESETS)}")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    chain = list(preset["chain"])

    # 削齿音会把瞬态峰值一起削掉（实测 RMS 掉约 7dB）。不补回来，
    # 混音后人声偏小 —— 听起来像「变柔和了」，其实是变小声了，会误判。
    src_db = measure_mean_db(args.src)
    if args.match_level and src_db is not None:
        tmpdir = tempfile.mkdtemp(prefix="shape-")
        try:
            probe = os.path.join(tmpdir, "probe.wav")
            run_chain(args.src, probe, chain)
            probe_db = measure_mean_db(probe)
            if probe_db is None:
                chain.append("dynaudnorm=f=200:g=15")
            else:
                gain = max(-6.0, min(18.0, src_db - probe_db))
                chain.append(f"volume={gain:.2f}dB")
                print(f"  响度补偿 {gain:+.2f} dB  ({probe_db:.1f} -> {src_db:.1f} dB)")
        finally:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)

    run_chain(args.src, args.out, chain)
    final_db = measure_mean_db(args.out)
    suffix = f"  电平 {final_db:.1f} dB" if final_db is not None else ""
    print(f"{args.preset}: {args.out}{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
