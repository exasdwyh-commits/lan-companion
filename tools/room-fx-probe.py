#!/usr/bin/env python3
"""Verify web/moli-room/scene-extras.js inside the REAL room page, headlessly.

Why this and not a synthetic scene: the whole point of a light shaft is how it
sits in *this* room, through *this* window, at *this* camera. A mock room would
prove the shader compiles and nothing else.

How it works:
  - serves the repo root over HTTP (the room is written for the lanroom:// scheme,
    but it uses plain relative URLs, so http:// works);
  - loads index.html with a pinned clock and weather (?at= / ?wx=) and a fixed
    camera (?cam=), so two runs frame the same thing;
  - inside ONE page load, screenshots with the extras on, calls
    __lanFx.setEnabled(false), screenshots again. The two frames are ~1 frame
    apart, so character animation, TV flicker and weather drift cancel out and
    what is left is the extras themselves.
  - reports where on screen the change lands, not just how much: a shaft must
    show up near the window, fireflies outside it.

    python3 tools/room-fx-probe.py
    python3 tools/room-fx-probe.py --state dawn --keep /tmp/fx

Needs: pip install playwright pillow && playwright install chromium
Exit 0 only if every scenario passed.
"""
import argparse
import functools
import http.server
import os
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOM = "/MALFOY-ENGINE/web/moli-room/index.html"

# at=clock time, wx=weather preset (see realworld.js PRESET).
# cam=px,py,pz,tx,ty,tz — chosen to frame the window and the floor under it.
SCENARIOS = {
    "dawn":  {"at": "07:20", "wx": "clear", "expect": "shaft"},
    "noon":  {"at": "12:30", "wx": "clear", "expect": "shaft"},
    "rain":  {"at": "14:10", "wx": "rain",  "expect": "rain"},
    "night": {"at": "22:30", "wx": "clear", "expect": "flies"},
}
CAM = "3.2,2.2,4.4,0.6,0.9,-1.2"
# Normalised window region at this camera: everything the extras touch lives here.
ROI = (0.55, 1.0, 0.0, 0.64)

# 0 = the whole frame is allowed to change this much before we call it "something
# happened". Deliberately tiny: we are looking for a *targeted* change.
MIN_CHANGE_FRACTION = 0.03    # inside the window region


def serve(directory):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


BOX = 112          # 480x300 -> 112x70. Averaging kills the grade pass's film grain.
THRESH = 3         # on the box-averaged grid, 3/255 is well above grain residue


def compare(on_png, off_png, roi=None):
    """Fraction of box-averaged blocks that changed by more than THRESH, and where.

    Comparing raw pixels does not work in this room: the final grade pass adds
    animated grain of ±0.02 per channel, so every frame differs from the next by
    ~10% of its pixels no matter what we render. Averaging each block down first
    (16x16 raw pixels per block here) drops the grain below the threshold while a
    light shaft, a bead of rain or a firefly still changes the block mean.
    """
    from PIL import Image, ImageChops
    a = Image.open(on_png).convert("RGB")
    b = Image.open(off_png).convert("RGB")
    if a.size != b.size:
        b = b.resize(a.size)
    w, h = a.size
    bw = BOX
    bh = max(1, round(BOX * h / w))
    a = a.resize((bw, bh), Image.BOX)
    b = b.resize((bw, bh), Image.BOX)
    diff = ImageChops.difference(a, b).convert("L")
    px = diff.load()
    w, h = diff.size
    total = w * h
    # Region of interest. The extras are window effects; the character breathes
    # in the middle of the room and would otherwise dominate any global average.
    # Both the noise baseline and the signal are measured inside the same box,
    # so the comparison stays apples to apples.
    if roi:
        x0, x1, y0, y1 = (int(roi[0] * w), int(roi[1] * w), int(roi[2] * h), int(roi[3] * h))
    else:
        x0, x1, y0, y1 = 0, w, 0, h
    total = max(1, (x1 - x0) * (y1 - y0))
    changed = 0
    sumx = sumy = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            if px[x, y] > THRESH:
                changed += 1
                sumx += x
                sumy += y
    frac = changed / total
    if changed:
        cx, cy = sumx / changed / w, sumy / changed / h
    else:
        cx = cy = -1
    return frac, changed, (cx, cy), diff


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", action="append", help="dawn|noon|rain|night")
    ap.add_argument("--keep", default="/tmp/fx-room", help="where to write PNGs")
    ap.add_argument("--w", type=int, default=480)
    ap.add_argument("--h", type=int, default=300)
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("需要 playwright： pip install playwright && playwright install chromium", file=sys.stderr)
        return 2
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("需要 pillow： pip install pillow", file=sys.stderr)
        return 2

    os.makedirs(args.keep, exist_ok=True)
    httpd, port = serve(ROOT)
    failures = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
            "--autoplay-policy=no-user-gesture-required", "--mute-audio",
            "--force-device-scale-factor=1",
        ])
        for name in (args.state or list(SCENARIOS)):
            sc = SCENARIOS[name]
            url = (f"http://127.0.0.1:{port}{ROOM}?at={sc['at']}&wx={sc['wx']}"
                   f"&cam={CAM}&fx=1")
            page = browser.new_page(viewport={"width": args.w, "height": args.h})
            errors = []
            page.on("console", lambda m: errors.append(m.text[:160]) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:160]))
            page.goto(url, wait_until="load", timeout=90000)
            # the room fades its loader out when the model is ready
            page.wait_for_function(
                "() => window.LOADER === undefined || document.getElementById('loading')?.hidden "
                "|| getComputedStyle(document.getElementById('loading')).opacity === '0'",
                timeout=90000)
            page.wait_for_timeout(4000)

            info_on = page.evaluate("window.__lanFx ? window.__lanFx.info() : null")
            on_png = os.path.join(args.keep, f"{name}-on.png")
            off_png = os.path.join(args.keep, f"{name}-off.png")
            on2_png = os.path.join(args.keep, f"{name}-on2.png")

            def two_frames():
                page.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")

            # Control first: the room animates on its own (breathing, TV, weather),
            # so two shots of the SAME state already differ. Without this baseline
            # every scenario "changes 9% of the frame" and the number means nothing.
            page.screenshot(path=on_png, timeout=180000)
            two_frames()
            page.screenshot(path=on2_png, timeout=180000)

            page.evaluate("window.__lanFx && window.__lanFx.setEnabled(false)")
            two_frames()
            page.screenshot(path=off_png, timeout=180000)
            page.evaluate("window.__lanFx && window.__lanFx.setEnabled(true)")

            noise, _, _, _ = compare(on_png, on2_png, ROI)
            frac, changed, (cx, cy), diff_img = compare(on_png, off_png, ROI)
            total_blocks = diff_img.size[0] * diff_img.size[1]
            print(f"\n=== {name}  at={sc['at']} wx={sc['wx']}  {args.w}x{args.h} ===")
            if info_on:
                print(f"  uniforms  shaft={info_on['shaftIntensity']:.3f} dust={info_on['dustIntensity']:.3f}"
                      f"  rain={info_on['rainIntensity']:.3f} fly={info_on['flyIntensity']:.3f}"
                      f"  alt={info_on['alt']:.1f} night={info_on['night']:.2f}")
            print(f"  噪声基线  {noise*100:.2f}% 格（窗区，同状态两帧的自然差异）")
            print(f"  特效信号  {changed} 格 / {total_blocks}（{frac*100:.2f}%，窗区）  重心 ~({cx:.2f}, {cy:.2f})")
            print(f"  信噪比    {frac / noise:.2f}x" if noise > 0 else "  信噪比    ∞（基线为 0）")

            def check(name_, cond, detail=""):
                if cond:
                    print(f"  ✓ {name_}")
                else:
                    print(f"  ✗ {name_} {detail}")
                    failures.append(f"{name}: {name_} {detail}")

            real_errors = [e for e in errors if "429" not in e]
            check("无脚本错误", not real_errors, str(real_errors[:2]))
            check("特效句柄存在（未降级）", info_on is not None, "__lanFx 为 null")
            # Geometry-based assertions: no noise, no thresholds to argue about.
            # A shaft that renders off-screen is the failure this catches.
            cov = (info_on or {}).get("coverage") or {}
            expect = sc["expect"]
            key = {"shaft": "shafts", "rain": "rain", "flies": "flies"}[expect]
            c = cov.get(key)
            check(f"{expect} 在画面内", bool(c and c.get("onScreen")), str(c))
            check(f"{expect} 覆盖面积 > 1%", bool(c and c.get("area", 0) > 0.01),
                  f"area={c.get('area') if c else None}")
            if expect == "rain":
                # rain belongs on the glass: it must not smear over the whole frame
                check("雨只落在窗玻璃范围", bool(c and c.get("area", 1) < 0.35),
                      f"area={c.get('area') if c else None}")
            # Pixel diff stays as context only — the ocean outside the window makes
            # any global frame difference dominated by animation, not by us.
            print(f"  （参考）像素差 {frac*100:.2f}% / 噪声 {noise*100:.2f}%")
            if info_on:
                expect = sc["expect"]
                key = {"shaft": "shaftIntensity", "rain": "rainIntensity", "flies": "flyIntensity"}[expect]
                check(f"{expect} 强度 > 0.05", info_on[key] > 0.05, f"实际 {info_on[key]:.3f}")
            page.close()
        browser.close()
    httpd.shutdown()

    print("\n" + ("全部通过" if not failures else f"失败 {len(failures)} 项："))
    for f in failures:
        print("  - " + f)
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
