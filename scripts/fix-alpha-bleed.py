#!/usr/bin/env python3
"""消除透明视频的绿幕渗色（matte bleed）

问题：抠像后 alpha=0 的区域仍保留绿幕 RGB。播放器按 .resizeAspect 缩放或
用户拖动缩放时，双线性滤波会把透明区的绿色混进发丝边缘，出现绿边。

实测（assets/whale-video-test，2026-10-30）：
  idle-matched.mov   全透明区 58.1%，平均 RGB (47,156,72) 纯绿幕，100% 偏绿
  touch-matched.mov  全透明区 58.5%，平均 RGB (47,157,72) 同上
  quiet-idle-loop.mov 全透明区 49.0%，RGB (61,92,92) 青灰，无绿渗色

做法：
  1. 边缘外扩（edge extend）：把不透明像素的颜色逐圈膨胀进透明区，
     透明处不再是绿幕色，而是紧邻的真实颜色 → 缩放时混出来的也是正确颜色。
  2. 边缘去溢色（despill）：半透明边缘上 G 压到 max(R,B)，蓝发/肤色不受影响
     （蓝发的 B 本来就高于 G，压不到）。

用法：
  ../LiveTalking/.venv/bin/python scripts/fix-alpha-bleed.py 输入.mov 输出.mov
  ../LiveTalking/.venv/bin/python scripts/fix-alpha-bleed.py 输入.mov 输出.mov --bleed-px 24 --despill

约定：不覆盖原片，输出用新文件名（见 AGENTS.md）。
"""
import argparse
import json
import subprocess
import sys

import cv2
import numpy as np

ALPHA_CONTENT = 0.02   # 认为"有内容"的 alpha 下限（占满量程比例）
ALPHA_EDGE_LO = 0.02   # 去溢色作用的半透明区间
ALPHA_EDGE_HI = 0.98


def probe(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,nb_frames,pix_fmt",
        "-show_entries", "format=duration", "-of", "json", path])
    d = json.loads(out)
    s = d["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return {
        "w": int(s["width"]), "h": int(s["height"]),
        "fps": float(num) / float(den),
        "frames": int(s.get("nb_frames") or 0),
        "pix_fmt": s.get("pix_fmt"),
        "duration": float(d["format"]["duration"]),
    }


def edge_extend(rgb, alpha_u16, bleed_px):
    """把最近的不透明像素颜色填进透明区（精确最近邻，不是取最大值）。

    不能用 cv2.dilate 迭代：dilate 取邻域最大值，而绿幕的 G 恰好最高，
    越扩越绿，实测反而把偏绿比例从 99% 扩到 78% 且颜色更假。
    用 distanceTransformWithLabels 得到每个透明像素最近的实心像素，
    再直接复制那个像素的颜色。
    """
    # 种子必须是"实心"像素：半透明边缘本身是绿幕混合色，拿它当种子会把绿带出去
    content = alpha_u16 > int(0.5 * 65535)
    if not content.any() or content.all():
        return rgb

    src = (~content).astype(np.uint8)
    dist, labels = cv2.distanceTransformWithLabels(
        src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)

    # DIST_LABEL_PIXEL 按行优先给每个零像素编号 1..N
    seed_y, seed_x = np.where(content)
    idx = labels - 1                      # 0-based 种子下标
    idx = np.clip(idx, 0, len(seed_y) - 1)

    fill_mask = (alpha_u16 <= int(ALPHA_CONTENT * 65535)) & (dist <= bleed_px)
    if not fill_mask.any():
        return rgb

    out = rgb.copy()
    out[fill_mask] = rgb[seed_y[idx[fill_mask]], seed_x[idx[fill_mask]]]
    return out


def detect_bg(rgb, alpha_u16):
    """从全透明像素估计绿幕底色（用于反解）"""
    zero = alpha_u16 <= int(ALPHA_CONTENT * 65535)
    if not zero.any():
        return None
    bg = rgb[zero].astype(np.float32).mean(axis=0)   # 顺序 B,G,R
    return bg


def unmix_green(rgb, alpha_u16, bg_bgr):
    """绿幕反解：C = a*F + (1-a)*Bg  =>  F = (C - (1-a)*Bg) / a

    只作用于半透明带。这是绿幕边缘的正确还原方式，
    单纯 despill 只能压掉绿，压不掉"半透明边缘混了背景色"这个事实。
    """
    a = alpha_u16.astype(np.float32) / 65535.0
    band = (a > ALPHA_EDGE_LO) & (a < ALPHA_EDGE_HI)
    if not band.any():
        return rgb
    out = rgb.astype(np.float32).copy()
    src = rgb.astype(np.float32)
    for c in range(3):
        ch = src[:, :, c]
        f = (ch - (1.0 - a) * bg_bgr[c]) / np.maximum(a, 1e-3)
        out[:, :, c] = np.where(band, f, ch)
    out = np.clip(out, 0, 65535)
    return out.astype(np.uint16)


def despill(rgb, alpha_u16):
    """半透明边缘：G 压到 max(R,B)。返回修改后的 rgb（uint16）。"""
    a = alpha_u16.astype(np.float32) / 65535.0
    edge = (a > ALPHA_EDGE_LO) & (a < ALPHA_EDGE_HI)
    if not edge.any():
        return rgb
    r = rgb[:, :, 2].astype(np.int32)
    g = rgb[:, :, 1].astype(np.int32)
    b = rgb[:, :, 0].astype(np.int32)
    cap = np.maximum(r, b)
    need = edge & (g > cap)
    if need.any():
        out = rgb.copy()
        gfix = np.minimum(g, cap)
        ch = out[:, :, 1]
        ch[need] = gfix[need].astype(np.uint16)
    return out


def measure(rgb, alpha_u16, label, near_px=10):
    """只统计会真正渗色的区域：半透明边缘 + 距内容 near_px 内的透明像素。

    整幅透明区的颜色无关紧要——缩放滤波的取样足迹只在边缘附近，
    远处透明像素永远进不了合成结果。
    """
    a = alpha_u16.astype(np.float32) / 65535.0 * 255
    b = rgb[:, :, 0].astype(np.float32) / 65535 * 255
    g = rgb[:, :, 1].astype(np.float32) / 65535 * 255
    r = rgb[:, :, 2].astype(np.float32) / 65535 * 255

    content = (a > 5).astype(np.uint8)
    near = cv2.dilate(content, np.ones((near_px * 2 + 1,) * 2, np.uint8)).astype(bool)
    transparent_near = (a <= 5) & near
    edge = (a > 5) & (a < 250)

    gn = (g[transparent_near] - np.maximum(r[transparent_near], b[transparent_near])) \
        if transparent_near.sum() else np.zeros(1)
    ge = (g[edge] - np.maximum(r[edge], b[edge])) if edge.sum() else np.zeros(1)

    rgbn = f"({r[transparent_near].mean():.0f},{g[transparent_near].mean():.0f},{b[transparent_near].mean():.0f})" \
        if transparent_near.sum() else "-"
    print(f"  {label:10} 近边缘透明区 RGB{rgbn} 偏绿>20 {(gn>20).mean():6.1%} ({transparent_near.sum():,}px)"
          f"  | 半透明边缘 绿超出 {ge.mean():6.1f} 偏绿>20 {(ge>20).mean():6.1%}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--bleed-px", type=int, default=24, help="颜色外扩圈数（像素）")
    ap.add_argument("--despill", action="store_true", help="同时做半透明边缘去溢色")
    ap.add_argument("--unmix", action="store_true",
                    help="同时做绿幕反解（半透明边缘按 a 还原前景色，效果最好）")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 帧（调试用）")
    args = ap.parse_args()

    info = probe(args.src)
    w, h, fps = info["w"], info["h"], info["fps"]
    total = info["frames"] or int(round(info["duration"] * fps))
    n = min(total, args.limit) if args.limit else total
    print(f"输入 {args.src}")
    print(f"  {w}x{h} @{fps:.2f}fps  {total} 帧  {info['duration']:.2f}s  源格式 {info['pix_fmt']}")
    print(f"  处理 {n} 帧  bleed={args.bleed_px}px  despill={args.despill}")

    dec = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", args.src,
         "-f", "rawvideo", "-pix_fmt", "rgba64le", "-"],
        stdout=subprocess.PIPE)
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgba64le", "-s", f"{w}x{h}", "-r", f"{fps}",
         "-i", "-",
         "-an", "-c:v", "prores_ks", "-profile:v", "4", "-alpha_bits", "16",
         "-pix_fmt", "yuva444p12le", args.dst],
        stdin=subprocess.PIPE)

    frame_bytes = w * h * 8
    bg = None
    i = 0
    while i < n:
        buf = dec.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        fr = np.frombuffer(buf, np.uint16).reshape(h, w, 4)
        rgb = fr[:, :, :3].copy()
        alpha = fr[:, :, 3]

        if i == 0:
            print("\n  首帧对比：")
            measure(rgb, alpha, "处理前")

        if bg is None:
            bg = detect_bg(rgb, alpha)
            if bg is not None and i == 0:
                print(f"  检测到绿幕底色 BGR=({bg[0]:.0f},{bg[1]:.0f},{bg[2]:.0f})")

        # 顺序要紧：先反解半透明边缘的颜色，再去溢色，最后把实心色外扩进全透明区
        out_rgb = unmix_green(rgb, alpha, bg) if (args.unmix and bg is not None) else rgb
        if args.despill or args.unmix:
            out_rgb = despill(out_rgb, alpha)
        out_rgb = edge_extend(out_rgb, alpha, args.bleed_px)

        if i == 0:
            measure(out_rgb, alpha, "处理后")

        out = np.dstack([out_rgb, alpha]).astype(np.uint16)
        enc.stdin.write(out.tobytes())
        i += 1
        if i % 40 == 0:
            print(f"    {i}/{n} 帧")

    enc.stdin.close()
    dec.stdout.close()
    dec.wait()
    enc.wait()
    if enc.returncode != 0:
        sys.exit(f"编码失败 rc={enc.returncode}")
    print(f"\n输出 {args.dst}  ({i} 帧)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
