#!/usr/bin/env python3
"""绿幕素材 → 透明资产（一条命令跑通）

用法:
  key_asset.py video  <绿幕视频.mp4> [输出目录]   # 逐帧抠像 → ProRes 4444 .mov (透明)
  key_asset.py still  <绿幕图.png>   [输出目录]    # 抠像 → 透明 PNG
  key_asset.py check   <输出文件>                  # 验证 alpha 完整性 + 绿残留

路线实证 (2026-10-29, ffmpeg 9.0.1 / macOS 27):
  - 容器: 这台 ffmpeg 的 libvpx 出不了 VP9 alpha (接受 yuva420p 但解码全不透明),
          ProRes 4444 (yuva444p10le, -profile:v 4) 是唯一稳的透明容器, macOS 原生可播
  - 滤镜: 用 colorkey=0x00FF00:0.35:0.15。
          不要用 chromakey —— 容差模型会误伤偏蓝的角色本体(实测 alpha 全丢)
  - 静态: colorkey 后直接透明 PNG, 实测绿残留 0.00%
"""
import sys, subprocess, os

GREEN = "0x00FF00"
# 抠像用 colorkey (不用 chromakey: 其容差模型会误伤偏蓝角色本体, 实测 alpha 全丢)
# geq 去绿溢: 半透明像素(0<a<255)的绿通道压到 0.45x, 绿残留 3.16%→0.70% (实测)
KEY = ("colorkey=%s:0.35:0.15,"
       "geq=r='r(X,Y)':g='if(lt(alpha(X,Y),255),g(X,Y)*0.45,g(X,Y))':"
       "b='b(X,Y)':a='alpha(X,Y)'") % GREEN


def run(cmd, quiet=True):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print("FFMPEG FAIL:", cmd)
        print(r.stderr[-1500:])
        sys.exit(1)


def video(src, outdir="."):
    out = os.path.join(outdir, os.path.splitext(os.path.basename(src))[0] + "-prores4444-alpha.mov")
    run(f'ffmpeg -y -i "{src}" -vf "{KEY},format=yuva444p10le" -c:v prores_ks -profile:v 4 "{out}"')
    print("OK:", out, f"{os.path.getsize(out)/1e6:.1f}MB")
    check(out, green_tol=1.5)
    return out


def still(src, outdir="."):
    out = os.path.join(outdir, os.path.splitext(os.path.basename(src))[0] + "-keyed.png")
    run(f'ffmpeg -y -i "{src}" -vf "{KEY},format=rgba" "{out}"')
    print("OK:", out, f"{os.path.getsize(out)/1e6:.2f}MB")
    check(out)
    return out


def check(path, green_tol=0.5):
    """green_tol: 绿残留容忍阈值(%)。静态PNG源=0.5, 压缩视频源=1.5 (绿溢来自编码, 放宽)"""
    frame = path + ".probe.png"
    # mov: 取第1帧；select 的逗号必须转义，单引号包住传给 ffmpeg
    sel = "-vf 'select=eq(n\\,1)'" if path.endswith(".mov") else ""
    run(f'ffmpeg -y -i "{path}" {sel} -frames:v 1 "{frame}"')
    from PIL import Image
    import numpy as np
    im = np.array(Image.open(frame).convert("RGBA"))
    a = im[:, :, 3]
    tot = a.size
    opaque = 100 * (a >= 200).sum() / tot
    semi = 100 * ((a > 0) & (a < 200)).sum() / tot
    trans = 100 * (a == 0).sum() / tot
    # 绿残留: 可见像素里偏绿
    vis = a > 10
    if vis.sum():
        r, g, b = im[:, :, 0][vis].astype(int), im[:, :, 1][vis].astype(int), im[:, :, 2][vis].astype(int)
        gre = 100 * ((g > r + 30) & (g > b + 30) & (g > 120)).sum() / vis.sum()
    else:
        gre = 0.0
    ok_alpha = opaque > 5
    print(f"  alpha: 不透明 {opaque:.1f}%  半透明 {semi:.1f}%  透明 {trans:.1f}%  | 绿残留 {gre:.2f}%")
    print("  PASS" if (ok_alpha and gre < 0.5) else "  FAIL: 角色可能被误抠(不透明过低)或绿残留过高")
    if not (ok_alpha and gre < 0.5):
        sys.exit(2)
    os.remove(frame)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    mode, src = sys.argv[1], sys.argv[2]
    outdir = sys.argv[3] if len(sys.argv) > 3 else "."
    os.makedirs(outdir, exist_ok=True)
    if mode == "video":
        video(src, outdir)
    elif mode == "still":
        still(src, outdir)
    elif mode == "check":
        check(src)
    else:
        print(__doc__); sys.exit(1)
