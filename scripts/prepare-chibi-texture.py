#!/usr/bin/env python3
"""Serialize the canonical PNG for origin-clean WebGL under Electron file://.

This changes no pixels. Do not disable webSecurity or enable file cross-origin
access to work around canvas/texture restrictions. No user files are read.
"""
import argparse
import base64
import hashlib
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "MALFOY-ENGINE/web/live2d/chibi-texture.js")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT):
        parser.error("输出必须在当前开发目录内")
    data = (ROOT / "assets/whale-chibi-rig-v2/texture.png").read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        parser.error("纹理必须是 PNG")
    width, height = struct.unpack(">II", data[16:24])
    payload = {"sha256": hashlib.sha256(data).hexdigest(), "width": width, "height": height,
               "url": "data:image/png;base64," + base64.b64encode(data).decode("ascii")}
    atlas_dir = ROOT / "assets/whale-chibi-performance-v1"
    atlas = json.loads((atlas_dir / "source.json").read_text(encoding="utf-8"))
    atlas_data = (atlas_dir / "atlas.png").read_bytes()
    if hashlib.sha256(atlas_data).hexdigest() != atlas["sha256"]:
        parser.error("表演图集与来源记录哈希不一致")
    if not atlas_data.startswith(b"\x89PNG\r\n\x1a\n") or struct.unpack(">II", atlas_data[16:24]) != (atlas["width"], atlas["height"]):
        parser.error("表演图集的 PNG 尺寸与元数据不一致")
    if len(atlas["frames"]) != 16:
        parser.error("当前表演映射需要 16 幅姿态")
    for frame in atlas["frames"]:
        x, y, w, h = frame["rect"]
        if min(x, y) < 0 or min(w, h) <= 0 or x+w > atlas["width"] or y+h > atlas["height"]:
            parser.error("图集取样区域超出 PNG")
        if not all(math.isfinite(value) for value in frame["layout"].values()):
            parser.error("图集锚点必须为有限数值")
    atlas_payload = {key: atlas[key] for key in ("sha256", "width", "height", "frames")}
    atlas_payload["url"] = "data:image/png;base64," + base64.b64encode(atlas_data).decode("ascii")
    if "faceBase" in atlas:
        record = atlas["faceBase"]
        face_data = (atlas_dir / record["file"]).read_bytes()
        if hashlib.sha256(face_data).hexdigest() != record["sha256"] or struct.unpack(">II", face_data[16:24]) != (atlas["width"], atlas["height"]):
            parser.error("独立面部底图与记录不一致")
        atlas_payload["faceBase"] = {"sha256": record["sha256"],
                                    "url": "data:image/png;base64," + base64.b64encode(face_data).decode("ascii")}
    # Optional walk-cycle atlas (CHIBI-02): absent directory simply means the
    # runtime keeps the existing atlas/skeletal gait; nothing else changes.
    # CHIBI-03: prefer the style-upgraded walk sheet when present.
    walk_dir = next((d for d in (ROOT / "assets/whale-chibi-style-v1/walk", ROOT / "assets/whale-chibi-walk-v1")
                     if (d / "source.json").is_file()), None)
    walk_output = output.with_name("chibi-walk.js")
    walk_payload = None
    if walk_dir is not None:
        walk = json.loads((walk_dir / "source.json").read_text(encoding="utf-8"))
        walk_data = (walk_dir / walk.get("texture", "atlas.png")).read_bytes()
        if hashlib.sha256(walk_data).hexdigest() != walk["sha256"]:
            parser.error("走路图集与来源记录哈希不一致")
        if not walk_data.startswith(b"\x89PNG\r\n\x1a\n") or struct.unpack(">II", walk_data[16:24]) != (walk["width"], walk["height"]):
            parser.error("走路图集的 PNG 尺寸与元数据不一致")
        if not 4 <= len(walk["frames"]) <= 8:
            parser.error("走路循环需要 4-8 幅帧")
        rects = []
        for frame in walk["frames"]:
            x, y, w, h = frame["rect"]
            if min(x, y) < 0 or min(w, h) <= 0 or x+w > walk["width"] or y+h > walk["height"]:
                parser.error("走路帧取样区域超出 PNG: " + str(frame.get("name")))
            rects.append((x, y, w, h))
        for i in range(len(rects)):
            for j in range(i+1, len(rects)):
                a, b = rects[i], rects[j]
                if a[0] < b[0]+b[2] and b[0] < a[0]+a[2] and a[1] < b[1]+b[3] and b[1] < a[1]+a[3]:
                    parser.error("走路帧取样区域重叠: %s / %s" % (walk["frames"][i].get("name"), walk["frames"][j].get("name")))
        walk_payload = {"sha256": walk["sha256"], "width": walk["width"], "height": walk["height"],
                        "frames": walk["frames"],
                        "url": "data:image/png;base64," + base64.b64encode(walk_data).decode("ascii")}
    # Optional dance atlas (CHIBI-03): same contract as walk, own module/global.
    dance_dir = ROOT / "assets/whale-chibi-style-v1/dance"
    dance_output = output.with_name("chibi-dance.js")
    dance_payload = None
    if (dance_dir / "source.json").is_file():
        dance = json.loads((dance_dir / "source.json").read_text(encoding="utf-8"))
        dance_data = (dance_dir / dance.get("texture", "atlas.png")).read_bytes()
        if hashlib.sha256(dance_data).hexdigest() != dance["sha256"]:
            parser.error("舞蹈图集与来源记录哈希不一致")
        if not dance_data.startswith(b"\x89PNG\r\n\x1a\n") or struct.unpack(">II", dance_data[16:24]) != (dance["width"], dance["height"]):
            parser.error("舞蹈图集的 PNG 尺寸与元数据不一致")
        if not 4 <= len(dance["frames"]) <= 8:
            parser.error("舞蹈循环需要 4-8 幅帧")
        drects = []
        for frame in dance["frames"]:
            x, y, w, h = frame["rect"]
            if min(x, y) < 0 or min(w, h) <= 0 or x+w > dance["width"] or y+h > dance["height"]:
                parser.error("舞蹈帧取样区域超出 PNG: " + str(frame.get("name")))
            drects.append((x, y, w, h))
        for i in range(len(drects)):
            for j in range(i+1, len(drects)):
                a, b = drects[i], drects[j]
                if a[0] < b[0]+b[2] and b[0] < a[0]+a[2] and a[1] < b[1]+b[3] and b[1] < a[1]+a[3]:
                    parser.error("舞蹈帧取样区域重叠: %s / %s" % (dance["frames"][i].get("name"), dance["frames"][j].get("name")))
        dance_payload = {"sha256": dance["sha256"], "width": dance["width"], "height": dance["height"],
                         "frames": dance["frames"],
                         "url": "data:image/png;base64," + base64.b64encode(dance_data).decode("ascii")}
    # Optional synthesized humming loop for the dance state (CHIBI-03).
    hum_file = dance_dir / "hum.m4a"
    if dance_payload is not None and hum_file.is_file():
        hum_data = hum_file.read_bytes()
        dance_payload["audio"] = {
            "url": "data:audio/mp4;base64," + base64.b64encode(hum_data).decode("ascii"),
            "sha256": hashlib.sha256(hum_data).hexdigest()}
    def serialize(name, value):
        return ("// Generated by scripts/prepare-chibi-texture.py; do not hand-edit.\n"
                + "globalThis." + name + " = Object.freeze(" + json.dumps(value, separators=(",", ":")) + ");\n")
    outputs = {output: serialize("ChibiTexture", payload),
               output.with_name("chibi-atlas.js"): serialize("ChibiAtlas", atlas_payload)}
    if walk_payload is not None:
        outputs[walk_output] = serialize("ChibiWalk", walk_payload)
    if dance_payload is not None:
        outputs[dance_output] = serialize("ChibiDance", dance_payload)
    if args.check:
        for path, body in outputs.items():
            if not path.is_file() or path.read_text(encoding="utf-8") != body:
                parser.exit(1, "纹理/图集运行数据缺失或过期；运行 python3 scripts/prepare-chibi-texture.py\n")
        if walk_payload is None and walk_output.is_file():
            parser.exit(1, "存在过期的 chibi-walk.js 但走路图集真源缺失；运行生成模式清理\n")
        if dance_payload is None and dance_output.is_file():
            parser.exit(1, "存在过期的 chibi-dance.js 但舞蹈图集真源缺失；运行生成模式清理\n")
        print("PASS: embedded texture and 16-frame performance atlas match canonical sources"
              + (" + walk atlas" if walk_payload is not None else " (walk atlas absent, optional)")
              + (" + dance atlas" if dance_payload is not None else ""))
    else:
        for path, body in outputs.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
            print("Generated origin-clean module: " + str(path.relative_to(ROOT)))
        if walk_payload is None and walk_output.is_file():
            walk_output.unlink()
            print("Removed stale generated module: " + str(walk_output.relative_to(ROOT)))
        if dance_payload is None and dance_output.is_file():
            dance_output.unlink()
            print("Removed stale generated module: " + str(dance_output.relative_to(ROOT)))


if __name__ == "__main__":
    main()
