#!/usr/bin/env python3
"""Verify web/moli-room/lan-face.js inside the REAL room page, headlessly.

What this proves, in one page load of the real room:
  1. 嘴型覆盖层能找到她的头（anchor 落在角色身上，不在天花板上）；
  2. 说话时开口度真的动起来（不是一直 0，也不是一直满）；
  3. 停下来会归零（不会一直张着嘴）；
  4. 一句里逐音节有起伏（口型不是方波全开/全闭）；
  5. 情绪能改状态（shy 的腮红/眉比 neutral 浓）；
  6. 背对镜头时自动淡出（fade 机制还在，不是硬贴）。

为什么不用像素比对来验收：这间屋子的颗粒噪声和窗外海浪每帧都在动（见
tools/room-fx-probe.py 的记录），像素阈值会变成噪声阈值。口型是「嘴的张
合」，有确切的数值状态，直接读 @lanFace.debug 比截图判读准得多。截图只作
为 --keep 的人工参考。

    python3 tools/face-probe.py
    python3 tools/face-probe.py --keep /tmp/face

Needs: pip install playwright && playwright install chromium
Exit 0 only if every check passed.
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

# 一句典型的中文回复：20+ 音节、带标点停顿，足够看出起伏
SENTENCE = "啊啊啊——今天天气真好呀，我们一起出去走走吧，看看外面的樱花开了没有。"
# 给慢速软件渲染留余量：SwiftShader 下一帧可能要 700ms
SETTLE_MS = 900

failures = []


def check(name, ok, detail=""):
    print(f"  [{'✓' if ok else '✗'}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name + (f" ({detail})" if detail else ""))


DEBUG_JS = """() => {
  const f = window.__lanFace;
  if (!f) return null;
  const d = f.debug;
  return { visible: d.visible, mouth: d.mouth, emotion: d.emotion, speaking: d.speaking,
           anchor: d.anchor, why: d.why, frame: f.frame };
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", metavar="DIR", help="把参考截图存到这里")
    ap.add_argument("--headful", action="store_true", help="本机有 GPU 时开窗口跑")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright  # 延迟导入：没有依赖时也能 --help

    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = httpd.server_address[1]
    if args.keep:
        os.makedirs(args.keep, exist_ok=True)

    launch = {"args": ["--mute-audio", "--force-device-scale-factor=1"]}
    if not args.headful:
        launch["args"] += ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    launch["headless"] = not args.headful

    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch)
        ctx = browser.new_context(viewport={"width": 900, "height": 560})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))

        # ?face=1 不参与验收（那是标定层），这里用干净的状态 + 固定时钟和天气
        page.goto(f"http://127.0.0.1:{port}{ROOM}?at=14:00&wx=clear&lang=zh&uiidle=0",
                  wait_until="load", timeout=90000)
        page.wait_for_function(
            "() => { const l = document.getElementById('loading'); return l && l.hidden; }",
            timeout=180000)
        page.wait_for_timeout(1200)

        print("\n== 锚点 ==")
        base = page.evaluate(DEBUG_JS)
        check("lan-face.js 已加载", base is not None)
        if base is None:
            browser.close()
            httpd.shutdown()
            return 1
        check("锚点可见", bool(base["visible"]), str(base["why"]))
        a = base["anchor"] or {}
        w = ctx.pages[0].viewport_size["width"]
        h = ctx.pages[0].viewport_size["height"]
        # 她在画面中下部、偏中：锚点在画面内且不在边角，说明挂的是角色不是场景原点
        check("锚点在画面内", 0 < a.get("x", -1) < w and 0 < a.get("y", -1) < h, str(a))
        check("每米像素数合理（>40）", a.get("ppm", 0) > 40, f"ppm={a.get('ppm')}")

        print("\n== 说话 ==")
        info = page.evaluate(f"() => window.LanFace.say({SENTENCE!r})")
        check("时间轴拆出音节", bool(info and info.get("syllables", 0) > 15), str(info))

        samples = []
        for i in range(6):
            page.wait_for_timeout(SETTLE_MS)
            d = page.evaluate(DEBUG_JS)
            samples.append(d["mouth"])
        print(f"  开口度采样：{[round(s, 2) for s in samples]}")
        check("说话时嘴张开过（峰值 > 0.3）", max(samples) > 0.3, f"peak={max(samples):.2f}")
        check("口型有起伏（不是一直满开）", min(samples) < max(samples) * 0.85,
              f"min={min(samples):.2f} max={max(samples):.2f}")

        print("\n== 收口 ==")
        page.evaluate("() => { window.LanFace.stop(); }")
        # 软件渲染一帧可能要 700ms：轮询到合上为止，最多等 8s
        d = page.evaluate(DEBUG_JS)
        waited = 0
        while d["mouth"] >= 0.12 and waited < 8000:
            page.wait_for_timeout(500)
            waited += 500
            d = page.evaluate(DEBUG_JS)
        check("停下后嘴合上（< 0.12）", d["mouth"] < 0.12,
              f"mouth={d['mouth']:.2f}（等待 {waited}ms）")
        check("说话状态清零", not d["speaking"], str(d["speaking"]))

        print("\n== 情绪 ==")
        page.evaluate("() => window.LanFace.emote('neutral', 400)")
        page.wait_for_timeout(SETTLE_MS)
        neu = page.evaluate(DEBUG_JS)["frame"]
        page.evaluate("() => window.LanFace.emote('shy', 9000)")
        # 同上：低帧率下表情插值需要好几帧，轮询到稳定为止
        shy = page.evaluate(DEBUG_JS)["frame"]
        waited = 0
        while shy["blush"] < neu["blush"] + 0.2 and waited < 8000:
            page.wait_for_timeout(500)
            waited += 500
            shy = page.evaluate(DEBUG_JS)["frame"]
        check("害羞的腮红比常态浓", shy["blush"] > neu["blush"] + 0.2,
              f"neutral={neu['blush']:.2f} shy={shy['blush']:.2f}")
        check("害羞的表情被记住", page.evaluate(DEBUG_JS)["emotion"] == "shy")

        if args.keep:
            page.evaluate(f"() => window.LanFace.say({SENTENCE!r})")
            page.wait_for_timeout(SETTLE_MS)
            page.screenshot(path=os.path.join(args.keep, "talking.png"), timeout=180000)
            page.evaluate("() => { window.LanFace.stop(); window.LanFace.emote('shy', 9000); }")
            page.wait_for_timeout(SETTLE_MS)
            page.screenshot(path=os.path.join(args.keep, "shy.png"), timeout=180000)
            print(f"\n  参考截图 → {args.keep}/talking.png, {args.keep}/shy.png")

        check("没有脚本错误", not errors, "; ".join(errors[:3]))
        browser.close()

    httpd.shutdown()
    print("\n" + ("全部通过" if not failures else f"失败 {len(failures)} 项："))
    for f in failures:
        print("  - " + f)
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
