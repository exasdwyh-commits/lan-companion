#!/usr/bin/env python3
"""绿幕视频 → 透明素材（flood fill thresh=110 + despill）

和 key_asset.py 的区别
  key_asset.py      : ffmpeg colorkey，全屏按颜色抠，快但会把角色身上的绿色饰品一起抠掉
  本脚本            : 真洪水填充 —— 从画面四边种子出发，只吃掉与背景「连通」的绿色像素
                      角色轮廓内部的绿色不会被误伤（不连通）

算法（每帧）
  1. 预掩膜 allowed = (G >= R+8) & (G >= B+8)
     绿色占优才可能是背景。皮肤 R>G、蓝发 B>G、白裙 R≈G≈B 全部挡在洪水之外，
     防止 thresh=110 这么大的容差从抗锯齿边缘渗进角色本体。
  2. cv2.floodFill，浮动范围（loDiff=upDiff=thresh），4 连通
     浮动范围 = 与「相邻像素」比而不是与种子比 → 能顺着绿幕的明暗渐变一路吃过去
     （v4 那种暗绿背景不会被亮绿种子漏掉）
  3. alpha 形态学收 1px + 轻微羽化，去边缘绿边
  4. despill：G = min(G, max(R,B))，把半透明边缘的绿溢压掉
  5. 整条视频共用一个裁剪框（逐帧各自裁会导致抖动），输出 RGBA PNG 序列

用法
  key-green-video.py <src.mp4> <outdir> [--thresh 110] [--width 640]
                     [--crop] [--probe N]
  key-green-video.py --stats <outdir>          # 复验已产出的序列
"""
import os
import sys
import json
import shutil
import tempfile
import subprocess

import numpy as np
import cv2

GREEN_MARGIN = 8      # 「绿色占优」的最小领先量
FEATHER_PX = 0.8      # alpha 羽化半径
ERODE_PX = 1          # 收边像素数（去绿边）
MIN_AREA = 60         # 小于这个面积的孤立块直接丢掉（水印残点/毛刺）
BLEED_PX = 20         # 颜色向透明区外扩的圈数（防缩放时绿幕混进边缘）


def log(*a):
    print(*a, flush=True)


def ffmpeg_frames(src, tmpdir, width=None):
    """把视频拆成 PNG 帧，返回 (帧路径列表, fps, 原始尺寸)"""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,avg_frame_rate",
         "-of", "json", src],
        capture_output=True, text=True,
    )
    info = json.loads(probe.stdout)["streams"][0]
    W, H = info["width"], info["height"]
    num, den = info["avg_frame_rate"].split("/")
    fps = float(num) / float(den) if float(den) else 24.0
    if fps <= 0 or fps > 120:
        fps = 24.0

    vf = f"scale={width}:-2" if width else "null"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", vf,
         os.path.join(tmpdir, "f%04d.png")],
        check=True,
    )
    frames = sorted(
        os.path.join(tmpdir, f) for f in os.listdir(tmpdir) if f.endswith(".png")
    )
    return frames, fps, (W, H)


def border_palette(bgr, k=16):
    """绿幕背景色板：整圈边框像素就是「全部种子」，聚成 k 个代表色。
    比只取四角更稳 —— 打光渐变、暗角、边角偏色都能覆盖。"""
    h, w = bgr.shape[:2]
    t = max(2, min(h, w) // 64)          # 边框厚度
    px = np.concatenate([
        bgr[:t, :, :].reshape(-1, 3), bgr[-t:, :, :].reshape(-1, 3),
        bgr[:, :t, :].reshape(-1, 3), bgr[:, -t:, :].reshape(-1, 3),
    ]).astype(np.float32)
    if len(px) > 20000:
        px = px[np.random.choice(len(px), 20000, replace=False)]
    k = min(k, len(px))
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    _, _, centers = cv2.kmeans(px, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    return centers


def key_frame(bgr, thresh):
    """返回 (rgba, 统计)

    等价于「以整圈边框为种子的洪水填充」，但用色板距离 + 连通域实现：
      candidate = 与最近边框代表色的最大通道差 <= thresh
      bg        = candidate 中与画面边缘连通的部分
    这样既保留 flood fill 的「只吃连通区」语义，又能一次算完整帧（不漏渐变）。
    """
    from scipy import ndimage

    h, w = bgr.shape[:2]
    b, g, r = bgr[:, :, 0], bgr[:, :, 1], bgr[:, :, 2]

    # 1) 与边框色板的距离（chebyshev），取最近代表色
    pal = border_palette(bgr)
    flat = bgr.reshape(-1, 3).astype(np.int16)
    best = np.full(len(flat), 32767, np.int16)
    for c in pal:
        ci = np.rint(c).astype(np.int16)
        d = np.abs(flat - ci).max(axis=1)
        np.minimum(best, d, out=best)
    near = best.reshape(h, w) <= thresh

    # 2) 绿色占优护栏：皮肤/蓝发/白裙挡在洪水之外
    guard = (g.astype(np.int16) >= r.astype(np.int16) + 5) & \
            (g.astype(np.int16) >= b.astype(np.int16) - 5)

    cand = near & guard

    # 3) 只保留与画面边缘连通的候选（洪水语义）
    lab, n = ndimage.label(cand, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]]))
    if n:
        edge_ids = np.unique(np.concatenate([
            lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1],
        ]))
        edge_ids = edge_ids[edge_ids > 0]
        bg = np.isin(lab, edge_ids)
    else:
        bg = np.zeros((h, w), bool)
    fg = ~bg

    # 3) alpha：收边 + 羽化
    a = (fg * 255).astype(np.uint8)
    if ERODE_PX:
        a = cv2.erode(a, np.ones((3, 3), np.uint8), iterations=ERODE_PX)

    # 3.5) 去碎屑：抠剩的极小孤立块（水印残点、抗锯齿毛刺）
    if MIN_AREA:
        nlab, lab, stats, _ = cv2.connectedComponentsWithStats((a > 24).astype(np.uint8), 4)
        for i in range(1, nlab):
            if stats[i, cv2.CC_STAT_AREA] < MIN_AREA:
                a[lab == i] = 0

    if FEATHER_PX:
        a = cv2.GaussianBlur(a, (3, 3), FEATHER_PX)

    # 4) despill：绿通道压到 max(R,B)
    rgb = np.dstack([r, g, b]).astype(np.int16)
    cap = np.maximum(rgb[:, :, 0], rgb[:, :, 2])
    rgb[:, :, 1] = np.minimum(rgb[:, :, 1], cap)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)

    # 5) 边缘外扩：把可见像素的颜色推进透明区
    #    否则 alpha=0 的地方还留着绿幕 RGB，播放器双线性缩放时会把绿色
    #    混进发丝边缘（scripts/fix-alpha-bleed.py 里记录的同一个坑）
    rgb = edge_extend(rgb, a)

    rgba = np.dstack([rgb, a])
    stats = frame_stats(rgba)
    return rgba, stats


def edge_extend(rgb, alpha, px=None):
    """把不透明像素的颜色逐圈扩散进透明区。

    先在透明区填上可见像素的平均色（立刻去掉绿幕色），再一圈圈往外扩散真实颜色。
    这样缩放/滤波时混进来的都是角色自己的颜色，不会再出现绿边。
    """
    px = BLEED_PX if px is None else px
    known = alpha > 8
    if not known.any():
        return rgb
    out = rgb.astype(np.float32).copy()
    out[~known] = out[known].mean(axis=0)
    k = np.ones((3, 3), np.uint8)
    grown = known.copy()
    for _ in range(px):
        blur = cv2.blur(out, (3, 3))
        g2 = cv2.dilate(grown.astype(np.uint8), k).astype(bool)
        new = g2 & ~grown
        if not new.any():
            break
        out[new] = blur[new]
        grown = g2
    return np.clip(out, 0, 255).astype(np.uint8)


def frame_stats(rgba):
    a = rgba[:, :, 3]
    tot = a.size
    vis = a > 10
    gre = 0.0
    if vis.sum():
        v = rgba[:, :, :3][vis].astype(int)
        rr, gg, bb = v[:, 0], v[:, 1], v[:, 2]
        gre = 100.0 * ((gg > rr + 30) & (gg > bb + 30) & (gg > 120)).sum() / vis.sum()
    ys, xs = np.nonzero(a > 24)
    bbox = None
    if len(ys):
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    return {
        "opaque": round(100.0 * (a >= 200).sum() / tot, 2),
        "semi": round(100.0 * ((a > 0) & (a < 200)).sum() / tot, 2),
        "trans": round(100.0 * (a == 0).sum() / tot, 2),
        "green_residue": round(gre, 3),
        "bbox": bbox,
    }


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "--stats":
        d = sys.argv[2]
        rows = []
        for f in sorted(os.listdir(d)):
            if f.endswith(".png"):
                im = cv2.imread(os.path.join(d, f), cv2.IMREAD_UNCHANGED)
                if im is not None and im.shape[2] == 4:
                    rows.append((f, frame_stats(im)))
                elif im is not None:
                    rows.append((f, {"NO_ALPHA": True}))
        if not rows:
            log("没有 PNG"); sys.exit(2)
        gr = [r[1].get("green_residue", 0) for r in rows]
        op = [r[1].get("opaque", 0) for r in rows]
        log(f"帧数 {len(rows)}")
        log(f"绿残留 max {max(gr):.2f}%  mean {sum(gr)/len(gr):.2f}%")
        log(f"不透明 max {max(op):.1f}%  mean {sum(op)/len(op):.1f}%  min {min(op):.1f}%")
        log(f"首帧 {rows[0][1]}")
        log(f"末帧 {rows[-1][1]}")
        sys.exit(0)

    src = sys.argv[1]
    outdir = sys.argv[2]
    thresh = 110
    width = 640
    do_crop = "--crop" in sys.argv
    probe_n = 0
    if "--thresh" in sys.argv:
        thresh = int(sys.argv[sys.argv.index("--thresh") + 1])
    if "--width" in sys.argv:
        width = int(sys.argv[sys.argv.index("--width") + 1])
    if "--probe" in sys.argv:
        probe_n = int(sys.argv[sys.argv.index("--probe") + 1])

    tmp = tempfile.mkdtemp(prefix="gskey-")
    try:
        frames, fps, orig = ffmpeg_frames(src, tmp, width)
        log(f"源 {os.path.basename(src)}  {orig[0]}x{orig[1]}  {fps:.2f}fps  抽帧 {len(frames)}")

        if probe_n:
            idx = np.linspace(0, len(frames) - 1, probe_n).astype(int)
            for i in idx:
                bgr = cv2.imread(frames[i])
                rgba, st = key_frame(bgr, thresh)
                log(f"  probe#{i}: {st}")
            # 存一张预览给肉眼检查
            os.makedirs("/tmp/gskey-preview", exist_ok=True)
            bgr = cv2.imread(frames[int(len(frames) * 0.4)])
            rgba, _ = key_frame(bgr, thresh)
            out = f"/tmp/gskey-preview/{os.path.basename(src).replace('.mp4','')}-keyed.png"
            cv2.imwrite(out, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
            log("预览:", out)
            return

        os.makedirs(outdir, exist_ok=True)
        results, boxes = [], []
        for i, f in enumerate(frames):
            bgr = cv2.imread(f)
            rgba, st = key_frame(bgr, thresh)
            results.append(st)
            if st["bbox"]:
                boxes.append(st["bbox"])
            cv2.imwrite(os.path.join(outdir, "f%04d.png" % (i + 1)),
                        cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
            if (i + 1) % 24 == 0:
                log(f"  {i+1}/{len(frames)}  residue={st['green_residue']}%  opaque={st['opaque']}%")

        crop = None
        fw, fh = rgba.shape[1], rgba.shape[0]
        if do_crop and boxes:
            pad = 8
            crop = [max(0, min(b[0] for b in boxes) - pad),
                    max(0, min(b[1] for b in boxes) - pad),
                    min(fw - 1, max(b[2] for b in boxes) + pad),
                    min(fh - 1, max(b[3] for b in boxes) + pad)]
            # 整条视频共用同一个裁剪框（逐帧各裁会抖动）
            for i in range(len(frames)):
                p = os.path.join(outdir, "f%04d.png" % (i + 1))
                cv2.imwrite(p, cv2.imread(p, cv2.IMREAD_UNCHANGED)[
                    crop[1]:crop[3] + 1, crop[0]:crop[2] + 1])
        out_w = crop[2] - crop[0] + 1 if crop else fw
        out_h = crop[3] - crop[1] + 1 if crop else fh

        gr = [r["green_residue"] for r in results]
        op = [r["opaque"] for r in results]
        meta = {
            "src": os.path.basename(src), "fps": round(fps, 3), "frames": len(results),
            "src_size": [fw, fh], "size": [out_w, out_h], "thresh": thresh,
            "green_residue_max": max(gr), "green_residue_mean": round(sum(gr) / len(gr), 3),
            "opaque_mean": round(sum(op) / len(op), 2), "opaque_min": min(op),
            "crop": crop,
        }
        with open(os.path.join(outdir, "meta.json"), "w") as fh:
            json.dump(meta, fh, ensure_ascii=False, indent=2)
        log("完成:", json.dumps(meta, ensure_ascii=False))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
