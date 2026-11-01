#!/usr/bin/env python3
"""出片验收器：判断一条件环视频能不能进桌面合成器。

针对小云雀 / 即梦 / Seedance 这类"图生视频 + 首尾帧"出的素材，量五个东西：

  1. 规格      分辨率 / 时长 / fps / 编码 / 有无音轨
 2. 锚点      首帧 vs 尾帧的灰度平均绝对差（能不能无缝循环）
 3. 绿幕      外圈背景的绿色纯净度（能不能干净抠像）
 4. 水印      四角有没有压在绿底上的静止叠加物（小云雀非会员有固定水印）
 5. 尾帧清晰度 用拉普拉斯方差比首帧/末帧（模型尾帧普遍糊）

绿幕和水印这两项只对"打算抠像"的素材有意义。默认按画面自动判断：
外圈一半以上是近绿就当绿幕素材，否则当普通素材，只报信息不判死。

用法：
    ../LiveTalking/.venv/bin/python scripts/check_clip.py clip.mp4
    ../LiveTalking/.venv/bin/python scripts/check_clip.py *.mp4 --json out.json
    ../LiveTalking/.venv/bin/python scripts/check_clip.py clip.mp4 --anchor anchor.png

需要 numpy + ffmpeg/ffprobe。没装 numpy 时锚点/绿幕会跳过，只报规格。
退出码：全部通过 0；有 FAIL 1；只有 WARN 2。
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path

try:
    import numpy as np
except ModuleNotFoundError:  # 允许只做规格检查
    np = None

# ---- 阈值（依据 Malfoy 实测：锚点帧差 0.30–0.32，尾帧清晰度掉到 1/7）----
ANCHOR_IDEAL = 1.0      # 灰度 0–255 平均绝对差，越小越接得上
ANCHOR_MAX = 2.5        # 超过这个值循环一定看得出跳
GREEN_NEAR_RATIO = 0.95  # 外圈背景里"近绿像素"占比下限
GREEN_DOM_MEDIAN = 70   # G - max(R,B) 的中位数下限
GREEN_DOM_P10 = 35      # 第 10 百分位下限，挡住渐变/阴影
SHARPNESS_DROP = 0.30   # 尾帧比首帧糊超过 30% 就警告
MIN_DURATION, MAX_DURATION = 2.0, 12.0
MIN_HEIGHT = 700        # 720p 起


def run(cmd: list[str], binary: bool = False) -> bytes:
    out = subprocess.run(cmd, capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(f"{cmd[0]} 失败：{out.stderr.decode('utf-8', 'ignore')[:400]}")
    return out.stdout if binary else out.stdout.decode("utf-8", "ignore")


def probe(path: Path) -> dict:
    data = json.loads(run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]))
    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    if not video:
        raise RuntimeError("没有视频轨")
    num, _, den = video.get("avg_frame_rate", "0/1").partition("/")
    fps = float(num) / float(den) if float(den or 0) else 0.0
    return {
        "width": int(video["width"]),
        "height": int(video["height"]),
        "duration": round(float(data["format"].get("duration", 0)), 3),
        "fps": round(fps, 2),
        "codec": video.get("codec_name"),
        "pix_fmt": video.get("pix_fmt"),
        "bitrate_mbps": round(int(data["format"].get("bit_rate", 0)) / 1e6, 2),
        "has_audio": audio is not None,
        "size_mb": round(path.stat().st_size / 1048576, 2),
    }


def grab(path: Path, at: float | None, out: Path, width: int = 480,
         tail: bool = False) -> "np.ndarray":
    """抽一帧成 RGB 数组。at=None 取第一帧；tail=True 从尾部往前取。"""
    cmd = ["ffmpeg", "-v", "error", "-y"]
    if tail:
        # 用 -sseof 从尾部倒推，比直接算 duration-fps 准：末帧时间戳可能不在网格上
        cmd += ["-sseof", "-0.20"]
    elif at is not None:
        cmd += ["-ss", f"{max(at, 0):.3f}"]
    cmd += ["-i", str(path), "-frames:v", "1",
            "-vf", f"scale={width}:-2:flags=area", "-pix_fmt", "rgb24",
            "-f", "rawvideo", str(out)]
    run(cmd)
    raw = out.read_bytes()
    if not raw:
        raise RuntimeError(f"{path.name} 抽不到帧")
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, width, 3)


def gray(frame: "np.ndarray") -> "np.ndarray":
    return frame.astype(np.float32) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)


def laplacian_variance(frame: "np.ndarray") -> float:
    g = gray(frame)
    lap = (g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
           - 4 * g[1:-1, 1:-1])
    return float(lap.var())


def green_stats(frame: "np.ndarray") -> dict:
    """外圈 12% 边框当作"应该是背景"的区域。"""
    h, w = frame.shape[:2]
    band_x, band_y = int(w * 0.12), int(h * 0.12)
    f = frame.astype(np.int16)
    mask = np.ones((h, w), dtype=bool)
    mask[band_y:h - band_y, band_x:w - band_x] = False
    px = f[mask]
    dom = px[:, 1] - np.maximum(px[:, 0], px[:, 2])
    near = (dom > 60) & (px[:, 1] > 90)
    return {
        "near_green_ratio": round(float(near.mean()), 4),
        "dom_median": int(np.median(dom)),
        "dom_p10": int(np.percentile(dom, 10)),
    }


def corner_static(path: Path, workdir: Path, samples: int = 6) -> dict:
    """四角的时间方差。静止 + 不是绿色 = 疑似水印/叠加物。"""
    dur = probe(path)["duration"]
    idx = [dur * (i + 0.5) / samples for i in range(samples)]
    frames = [grab(path, t, workdir / f"t{i}.raw") for i, t in enumerate(idx)]
    stack = np.stack(frames).astype(np.float32)  # (n, h, w, 3)
    h, w = stack.shape[1:3]

    def region(y0, y1, x0, x1):
        sub = stack[:, int(h * y0):int(h * y1), int(w * x0):int(w * x1)]
        return float(sub.std(axis=0).mean()), sub[0]

    corners = {
        "左上": region(0.0, 0.14, 0.0, 0.22),
        "右上": region(0.0, 0.14, 0.78, 1.0),
        "左下": region(0.86, 1.0, 0.0, 0.22),
        "右下": region(0.86, 1.0, 0.78, 1.0),
    }
    center_std = float(stack[:, int(h * 0.35):int(h * 0.65),
                           int(w * 0.35):int(w * 0.65)].std(axis=0).mean())
    suspects = []
    for name, (std, frame) in corners.items():
        px = frame.reshape(-1, 3).astype(np.int16)
        dom = px[:, 1] - np.maximum(px[:, 0], px[:, 2])
        is_green = float(((dom > 60) & (px[:, 1] > 90)).mean()) > 0.6
        # 静止（std 远小于画面中心）却又不绿 → 有东西压在上面
        if std < max(center_std * 0.15, 3.0) and not is_green:
            suspects.append(name)
    return {"center_std": round(center_std, 2), "suspects": suspects}


def check(path: Path, anchor: Path | None, expect: str = "auto") -> dict:
    result: dict = {"file": str(path), "verdict": "PASS", "checks": [], "notes": []}

    def verdict(level: str, name: str, detail: str):
        result["checks"].append({"level": level, "name": name, "detail": detail})
        if level == "FAIL" or (level == "WARN" and result["verdict"] == "PASS"):
            result["verdict"] = level

    try:
        info = probe(path)
    except Exception as exc:
        verdict("FAIL", "规格", f"读不出来：{exc}")
        return result
    result["spec"] = info

    if info["height"] < MIN_HEIGHT:
        verdict("FAIL", "分辨率", f"{info['width']}x{info['height']} 低于 720p，抠像后会很糊")
    elif info["height"] > 2200:
        verdict("WARN", "分辨率", f"{info['height']}p 偏高，桌宠小窗用不上，包体会爆")
    else:
        verdict("PASS", "分辨率", f"{info['width']}x{info['height']}")

    if not (MIN_DURATION <= info["duration"] <= MAX_DURATION):
        verdict("WARN", "时长", f"{info['duration']}s 不在 {MIN_DURATION}–{MAX_DURATION}s")
    else:
        verdict("PASS", "时长", f"{info['duration']}s")

    if info["has_audio"]:
        result["notes"].append("带音轨：待机素材应静音，或播放端强制 isMuted")
    if info["pix_fmt"] not in ("yuv420p", "yuv422p", "yuv444p"):
        result["notes"].append(f"pix_fmt={info['pix_fmt']}，AVPlayer 对非 yuv420p 兼容性较差")

    if np is None:
        result["notes"].append("没装 numpy，跳过画面分析")
        return result

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        first = grab(path, None, work / "first.raw")
        last = grab(path, None, work / "last.raw", tail=True)

        if first.shape != last.shape:
            verdict("FAIL", "锚点", "首尾帧尺寸不一致，无法比较")
        else:
            diff = float(np.abs(gray(first) - gray(last)).mean())
            result["anchor_diff"] = round(diff, 3)
            if diff <= ANCHOR_IDEAL:
                verdict("PASS", "锚点", f"首尾帧差 {diff:.2f}（≤{ANCHOR_IDEAL}，可无缝循环）")
            elif diff <= ANCHOR_MAX:
                verdict("WARN", "锚点", f"首尾帧差 {diff:.2f}，接缝可能看得见")
            else:
                verdict("FAIL", "锚点", f"首尾帧差 {diff:.2f}，循环一定跳")

        if anchor and anchor.exists():
            ref = grab(anchor, None, work / "ref.raw")
            if ref.shape == first.shape:
                d = float(np.abs(gray(first) - gray(ref)).mean())
                result["anchor_image_diff"] = round(d, 3)
                verdict("PASS" if d <= ANCHOR_MAX else "WARN",
                        "锚点图", f"首帧 vs 指定锚点图 差 {d:.2f}")

        g = green_stats(first)
        result["green"] = g
        mode = expect
        if mode == "auto":
            mode = "chroma" if g["near_green_ratio"] >= 0.5 else "plain"
        result["mode"] = mode
        if mode == "plain":
            verdict("PASS", "背景", (f"非绿幕素材（外圈近绿 {g['near_green_ratio']:.0%}），"
                                     "整图直接用，不抠像"))
        elif g["near_green_ratio"] < GREEN_NEAR_RATIO or g["dom_p10"] < GREEN_DOM_P10:
            verdict("FAIL", "绿幕", (f"外圈近绿占比 {g['near_green_ratio']:.0%}、"
                                     f"绿色优势 p10={g['dom_p10']}：背景不纯，"
                                     "抠像会有绿边/灰边"))
        elif g["dom_median"] < GREEN_DOM_MEDIAN:
            verdict("WARN", "绿幕", f"绿色优势中位数 {g['dom_median']} 偏低，边缘易泛绿")
        else:
            verdict("PASS", "绿幕", f"外圈近绿 {g['near_green_ratio']:.0%}，"
                                    f"绿色优势中位 {g['dom_median']}")

        s_first, s_last = laplacian_variance(first), laplacian_variance(last)
        drop = 1 - (s_last / s_first) if s_first else 0.0
        result["sharpness"] = {"first": round(s_first, 1), "last": round(s_last, 1),
                               "drop": round(drop, 3)}
        if drop > SHARPNESS_DROP:
            verdict("WARN", "尾帧", f"尾帧清晰度比首帧低 {drop:.0%}，"
                                    "播放端要在 duration-0.45s 起淡出")
        else:
            verdict("PASS", "尾帧", "首尾清晰度接近")

        if mode == "chroma":
            try:
                c = corner_static(path, work)
                result["corners"] = c
                if c["suspects"]:
                    verdict("FAIL", "水印", f"{'、'.join(c['suspects'])}角有压在绿底上的"
                                            "静止叠加物，抠像/裁切都去不掉，必须换无水印档位")
                else:
                    verdict("PASS", "水印", "四角是干净绿底")
            except Exception as exc:
                result["notes"].append(f"水印检查跳过：{exc}")

    return result


ICON = {"PASS": "·", "WARN": "!", "FAIL": "x"}


def main() -> int:
    ap = argparse.ArgumentParser(description="出片验收：循环素材能不能进桌面合成器")
    ap.add_argument("clips", nargs="+", type=Path)
    ap.add_argument("--anchor", type=Path, help="可选：锚点参考图")
    ap.add_argument("--json", type=Path, help="把结果写成 JSON")
    ap.add_argument("--expect", choices=["auto", "chroma", "plain"], default="auto",
                    help="素材类型：chroma=要做抠像（严查绿幕/水印），plain=整图直接用")
    args = ap.parse_args()

    if not shutil.which("ffprobe"):
        print("找不到 ffprobe，先装 ffmpeg", file=sys.stderr)
        return 1

    results = []
    for clip in args.clips:
        if not clip.exists():
            print(f"跳过（不存在）：{clip}", file=sys.stderr)
            continue
        r = check(clip, args.anchor, args.expect)
        results.append(r)
        print(f"\n{clip.name}  →  {r['verdict']}")
        spec = r.get("spec", {})
        if spec:
            print(f"  {spec['width']}x{spec['height']} · {spec['duration']}s · "
                  f"{spec['fps']}fps · {spec['codec']} · {spec['size_mb']}MB")
        for c in r["checks"]:
            print(f"  {ICON[c['level']]} {c['name']:<6} {c['detail']}")
        for n in r["notes"]:
            print(f"    * {n}")

    if args.json:
        args.json.write_text(json.dumps(results, ensure_ascii=False, indent=2))
        print(f"\n已写入 {args.json}")

    levels = {r["verdict"] for r in results}
    return 1 if "FAIL" in levels else (2 if "WARN" in levels else 0)


if __name__ == "__main__":
    sys.exit(main())
