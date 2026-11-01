#!/usr/bin/env python3
"""把一个素材目录扫成 pack.json —— 换角色只换素材，不碰代码。

桌宠运行时要的东西全在素材目录里：几段 mp4 + 一张静帧 + 一份 pack.json。
手工写 JSON 最大的坑不是语法，是**文件名和字段对不上**（写错一个字母，
开机就是空场景，还不报错）。这个脚本按固定命名规则认文件，直接生成能跑的配置。

命名规则（认不出来就跳过，不会瞎填）：

    character-master.png / .jpg   静帧兜底，也当相册第一张
    idle-01.mp4 idle-02.mp4 ...   待机循环，按序号轮播；前两段同时当小动作
    touch-01.mp4 ...              被点到时的反应
    sleep-01.mp4                  久无人理时的睡姿（配 sleep-01.jpg 更好）
    clip-01.mp4 / story-01.mp4    剧情片段，进 clips（字幕要自己补）
    *.jpg / *.png（其他）          相册图

用法：
    python3 scripts/make_pack.py --src assets/malfoy-pack
    python3 scripts/make_pack.py --src ~/Pictures/newgirl --name "苏晚" --force
    python3 scripts/make_pack.py --src assets/malfoy-pack --dry-run   # 只看会生成什么

生成后建议直接跑一次自检，确认窗口里真有画面：
    ./dist/PetDesk.app/Contents/MacOS/PetDesk --assets <素材目录> --selftest --out /tmp/p.json
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

VIDEO_EXT = {".mp4", ".mov", ".m4v"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}

DEFAULT_PERSONA = (
    "你是住在用户桌面上的伙伴。用自然、口语、简短的中文聊天，一次一到三句话。"
    "不编造现实中的行动和记忆，不假装能看见屏幕。"
)
DEFAULT_GREETING = ["回来了。"]
DEFAULT_TOUCHES = ["别戳我。", "痒。", "有事说事。"]
DEFAULT_IDLES = ["……发什么呆。"]


def probe_duration(path):
    """拿片长，用于提示字幕该写哪一段。ffprobe 不在就算了，不影响主流程。"""
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=20,
        )
        return round(float(out.stdout.strip()), 3)
    except (ValueError, subprocess.SubprocessError):
        return None


def natural_key(name):
    """idle-2 排在 idle-10 前面，别按字典序。"""
    return [int(chunk) if chunk.isdigit() else chunk for chunk in re.split(r"(\d+)", name)]


def scan(src):
    files = [f for f in os.listdir(src) if not f.startswith(".")]
    buckets = {"idle": [], "touch": [], "sleep": [], "clip": [], "image": [], "other": []}

    for name in sorted(files, key=natural_key):
        stem, ext = os.path.splitext(name)
        ext = ext.lower()
        low = stem.lower()
        if ext in VIDEO_EXT:
            if low.startswith("idle"):
                buckets["idle"].append(name)
            elif low.startswith("touch"):
                buckets["touch"].append(name)
            elif low.startswith("sleep"):
                buckets["sleep"].append(name)
            elif low.startswith("clip") or low.startswith("story"):
                buckets["clip"].append(name)
            else:
                buckets["other"].append(name)  # 留给人工判断，不硬塞
        elif ext in IMAGE_EXT:
            if low.startswith("character-master") or low in ("master", "main", "anchor"):
                buckets["image"].insert(0, name)
            else:
                buckets["image"].append(name)
    return buckets


def build_pack(buckets, name):
    images = buckets["image"]
    still = images[0] if images else None

    scene = {}
    if still:
        scene["still"] = still
    # 只有一段就重复写两遍：ambient 是按权重抽的，重复即加权。
    ambient = buckets["idle"]
    if len(ambient) == 1:
        ambient = ambient * 2
    if ambient:
        scene["ambient"] = ambient
    if buckets["idle"]:
        scene["actions"] = buckets["idle"][:2]
        scene["touch"] = buckets["touch"][0] if buckets["touch"] else buckets["idle"][0]
    if buckets["sleep"]:
        scene["sleep"] = buckets["sleep"][0]
        still_guess = os.path.splitext(buckets["sleep"][0])[0] + ".jpg"
        if still_guess in images:
            scene["sleepStill"] = still_guess

    pack = {
        "format": 1,
        "name": name,
        "persona": DEFAULT_PERSONA,
        "greeting": list(DEFAULT_GREETING),
        "touches": list(DEFAULT_TOUCHES),
        "idles": list(DEFAULT_IDLES),
        "addresses": [
            {"affinity": 0, "call": "你"},
            {"affinity": 30, "call": "喂"},
            {"affinity": 70, "call": "笨蛋"},
        ],
        "scene": scene,
    }

    if buckets["clip"]:
        pack["clips"] = [{"id": f"c{i + 1}", "file": f} for i, f in enumerate(buckets["clip"])]

    # 除静帧之外的照片进相册，按好感度阶梯解锁。
    album_source = images[1:] if len(images) > 1 else []
    if album_source:
        steps = [0, 10, 25, 40, 55, 70, 85]
        pack["album"] = [
            {
                "id": f"p{i + 1}",
                "file": f,
                "unlockAt": steps[i] if i < len(steps) else 85,
                "zh": "",
                "where": "",
                "date": "",
            }
            for i, f in enumerate(album_source)
        ]

    pack["affection"] = {
        "max": 100, "touch": 1, "touchCooldown": 45, "dailyVisit": 3,
        "chat": 1, "chatCooldown": 20, "chapterReward": 10,
    }
    return pack


def merge_lines(pack, src):
    """素材目录里有 lines.json 就用它盖掉默认台词，省得改脚本。"""
    path = os.path.join(src, "lines.json")
    if not os.path.exists(path):
        return False
    with open(path, encoding="utf-8") as handle:
        overrides = json.load(handle)
    allowed = {"name", "persona", "greeting", "touches", "idles", "addresses",
               "chapters", "album", "scene", "clips", "affection"}
    for key, value in overrides.items():
        if key in allowed:
            pack[key] = value
    return True


def main():
    ap = argparse.ArgumentParser(description="把素材目录扫成 pack.json")
    ap.add_argument("--src", required=True, help="素材目录")
    ap.add_argument("--name", help="角色名，默认取目录名")
    ap.add_argument("--out", help="写到别的目录（会连素材一起拷过去）")
    ap.add_argument("--force", action="store_true", help="覆盖已有的 pack.json")
    ap.add_argument("--dry-run", action="store_true", help="只打印，不写文件")
    args = ap.parse_args()

    src = os.path.abspath(os.path.expanduser(args.src))
    if not os.path.isdir(src):
        sys.exit(f"素材目录不存在：{src}")

    target = os.path.abspath(os.path.expanduser(args.out)) if args.out else src
    pack_path = os.path.join(target, "pack.json")
    if os.path.exists(pack_path) and not args.force and not args.dry_run:
        sys.exit(f"{pack_path} 已存在。确认要覆盖就加 --force（建议先备份）。")

    buckets = scan(src)
    name = args.name or os.path.basename(src.rstrip("/"))
    pack = build_pack(buckets, name)
    merged = merge_lines(pack, src)

    print(f"素材目录：{src}")
    for key in ("idle", "touch", "sleep", "clip", "image", "other"):
        count = len(buckets[key])
        mark = " " if count else "·"
        print(f"  {mark} {key:<6}{count:>3}  {', '.join(buckets[key][:4])}"
              + (" …" if count > 4 else ""))

    if not pack.get("scene"):
        print("\n警告：没认出任何画面素材。桌宠会开成空窗口。"
              "\n至少需要一张 character-master.png 或一段 idle-01.mp4。", file=sys.stderr)

    if buckets["other"]:
        print(f"\n没归类：{', '.join(buckets['other'])}"
              "\n（名字不是 idle-/touch-/sleep-/clip- 开头，脚本不替你猜。）")

    if buckets["clip"]:
        print("\n剧情片段（字幕要自己补，下面是每段可用的时间范围）：")
        for clip in pack["clips"]:
            duration = probe_duration(os.path.join(src, clip["file"]))
            span = f"0 – {duration}s" if duration else "时长未知"
            print(f"  {clip['id']:<4}{clip['file']:<20}{span}")
        print("  在 pack.json 的 caps 里按 {\"from\": .., \"to\": .., \"zh\": ..} 写台词。")

    if merged:
        print("\n已合并 lines.json 里的台词覆盖。")

    if args.dry_run:
        print("\n--- 预览（未写入）---")
        print(json.dumps(pack, ensure_ascii=False, indent=2))
        return

    if target != src:
        os.makedirs(target, exist_ok=True)
        for bucket in buckets.values():
            for name_ in bucket:
                dest = os.path.join(target, name_)
                if not os.path.exists(dest):
                    shutil.copy2(os.path.join(src, name_), dest)

    with open(pack_path, "w", encoding="utf-8") as handle:
        json.dump(pack, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"\n写好：{pack_path}")
    print("自检一遍确认真有画面：")
    print(f"  ./dist/PetDesk.app/Contents/MacOS/PetDesk --assets {target} "
          "--selftest --out /tmp/p.json")


if __name__ == "__main__":
    main()
