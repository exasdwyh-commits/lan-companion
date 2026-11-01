#!/usr/bin/env python3
"""从 LiveTalking 现有形象生成 LingDesk 素材包，并可直接装进桌宠数据目录。

背景：桌宠按下述固定文件名认素材（见 CompanionCore/Domain.swift 的 AssetSlot）：
    character-master.png   主形象（待机静图 / 无素材时的兜底画面）
    idle-01.mp4            待机循环
    talk-base-01.mp4       说话底片（口型走引擎时不需要）

最小可用 = 前两个文件。说话由 LiveTalking 的 MuseTalk 实时生成，
因此不再需要 talk-base-01.mp4，也就不必为它单独拍一段底片。

用法：
    # 用自带形象生成一套，并直接装进桌宠
    python3 scripts/make_starter_pack.py --install

    # 只生成，不安装
    python3 scripts/make_starter_pack.py --out /tmp/mypack

    # 换成自己的形象（一张正面清晰人像即可）
    python3 scripts/make_starter_pack.py --image ~/Pictures/me.png --muse-avatar my_face --install
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LT = os.path.abspath(os.path.join(ROOT, "..", "LiveTalking"))
DATA_DIR = os.path.expanduser("~/Library/Application Support/LingDesk")

# 桌宠认的固定文件名，不要改
MASTER = "character-master.png"
IDLE = "idle-01.mp4"

# 上游 LiveTalking 会在每帧左上角画 "LiveTalking" 灰色小字：
#   avatars/base_avatar.py（实时输出）、wav2lip/genavatar.py 与 musetalk/genavatar.py（抽帧）
# 这三处已在源码里注释掉，新素材不会再带水印。但仓库里现成的抽帧是改源码之前生成的，
# 仍带水印，所以打包时用 delogo 抹掉。坐标对应 putText 的 (10, 20) + fontScale 0.3。
DELOGO = "delogo=x=4:y=3:w=80:h=30"


def run(cmd, **kw):
    print("$", " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if not exe:
        sys.exit("缺少 ffmpeg：brew install ffmpeg")
    return exe


def build_idle(frames_dir, out_mp4, seconds, fps, tmp_dir, delogo):
    """把抽帧合成待机视频，用正放+倒放保证首尾同帧、可无缝循环。"""
    names = sorted(n for n in os.listdir(frames_dir) if n.endswith(".png"))
    if not names:
        sys.exit(f"{frames_dir} 里没有 png 抽帧")

    half = max(1, int(seconds * fps / 2))
    take = names[:half]
    if len(take) < 2:
        sys.exit("抽帧太少，无法合成待机视频")

    # 正放 + 倒放（去掉首尾重复的那一帧），结尾自然回到起始帧
    pingpong = take + take[-2::-1]

    os.makedirs(tmp_dir, exist_ok=True)
    for i, name in enumerate(pingpong):
        src = os.path.join(frames_dir, name)
        dst = os.path.join(tmp_dir, f"{i:08d}.png")
        if os.path.lexists(dst):
            os.remove(dst)
        os.symlink(os.path.abspath(src), dst)

    vf = [DELOGO] if delogo else []
    run([ffmpeg(), "-v", "error", "-y",
         "-framerate", fps, "-start_number", 0,
         "-i", os.path.join(tmp_dir, "%08d.png"),
         *(["-vf", ",".join(vf)] if vf else []),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
         "-movflags", "+faststart", out_mp4])
    return len(pingpong)


def make_muse_avatar(image, avatar_id):
    """用同一张脸生成 MuseTalk 资产，保证待机和说话不串脸。"""
    script = os.path.join(LT, "_make_muse_avatar.py")
    py = os.path.join(LT, ".venv", "bin", "python")
    if not (os.path.exists(script) and os.path.exists(py)):
        print("! 跳过 MuseTalk 资产生成：找不到 LiveTalking/_make_muse_avatar.py 或其 venv")
        return False
    run([py, script, os.path.abspath(image), avatar_id], cwd=LT)
    return True


def install(pack_dir, avatar_id):
    """拷进桌宠数据目录，并更新 settings.json 的 packID。"""
    settings_path = os.path.join(DATA_DIR, "settings.json")
    settings = {}
    if os.path.exists(settings_path):
        try:
            with open(settings_path, encoding="utf-8") as f:
                settings = json.load(f)
            if not isinstance(settings, dict):
                raise ValueError("settings.json 需要为 JSON 对象")
        except (ValueError, OSError) as exc:
            sys.exit(f"设置无法读取，保留原文件并停止安装：{exc}")
    os.makedirs(DATA_DIR, exist_ok=True)
    pack_id = str(uuid.uuid4()).upper()
    dest = os.path.join(DATA_DIR, "Assets", pack_id)
    os.makedirs(dest, exist_ok=True)
    for name in (MASTER, IDLE, "character.json"):
        src = os.path.join(pack_dir, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest, name))

    settings["packID"] = pack_id
    if avatar_id:
        settings["engineAvatar"] = avatar_id
    else:
        settings["useEngine"] = False
    settings.setdefault("useEngine", True)
    settings.setdefault("engineBaseURL", "http://127.0.0.1:8010")
    pending = settings_path + ".pending"
    with open(pending, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
    os.chmod(pending, 0o600)
    os.replace(pending, settings_path)

    print(f"\n已安装：{dest}")
    print(f"settings.json packID = {pack_id}")
    if avatar_id:
        print(f"\n启动引擎时请用同一形象，否则待机和说话会变成两个人：")
        print(f"  --avatar_id {avatar_id}")
    return pack_id


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--avatar", default="wav2lip256_avatar1",
                    help="LiveTalking 里已有抽帧的形象（默认自带，550 帧）")
    ap.add_argument("--image", help="直接用这张图当主形象（优先于 --avatar）")
    ap.add_argument("--out", default=os.path.join(ROOT, "assets", "starter-pack"))
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--fps", type=int, default=25)
    ap.add_argument("--muse-avatar", help="顺便用主图生成同名的 MuseTalk 说话形象")
    ap.add_argument("--install", action="store_true", help="生成后装进桌宠数据目录")
    ap.add_argument("--keep-watermark", action="store_true",
                    help="保留水印（默认会抹掉左上角 LiveTalking 字样）")
    args = ap.parse_args()
    delogo = not args.keep_watermark and not args.image

    os.makedirs(args.out, exist_ok=True)
    tmp_dir = os.path.join(args.out, "_pingpong")

    if args.image:
        src = os.path.abspath(os.path.expanduser(args.image))
        if not os.path.exists(src):
            sys.exit(f"找不到图片：{src}")
        shutil.copy2(src, os.path.join(args.out, MASTER))
        out_master = os.path.join(args.out, MASTER)
        if delogo:  # 覆盖式去水印，需要经 ffmpeg 重编码
            run([ffmpeg(), "-v", "error", "-y", "-i", out_master, "-vf", DELOGO, out_master + ".tmp.png"])
            os.replace(out_master + ".tmp.png", out_master)
        # 单图没有连续动作，待机就用这张静止图撑满时长
        vf = ["-vf", DELOGO] if delogo else []
        run([ffmpeg(), "-v", "error", "-y", "-loop", "1", "-i", out_master,
             "-t", args.seconds, "-r", args.fps, *vf,
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
             "-movflags", "+faststart", os.path.join(args.out, IDLE)])
        print(f"[1] 主形象 {MASTER}（静止待机 {args.seconds}s）")
    else:
        frames = os.path.join(LT, "data", "avatars", args.avatar, "full_imgs")
        if not os.path.isdir(frames):
            sys.exit(f"找不到抽帧目录：{frames}")
        shutil.copy2(os.path.join(frames, sorted(os.listdir(frames))[0]),
                     os.path.join(args.out, MASTER))
        out_master = os.path.join(args.out, MASTER)
        if delogo:
            run([ffmpeg(), "-v", "error", "-y", "-i", out_master, "-vf", DELOGO, out_master + ".tmp.png"])
            os.replace(out_master + ".tmp.png", out_master)
        n = build_idle(frames, os.path.join(args.out, IDLE), args.seconds, args.fps, tmp_dir, delogo)
        print(f"[1] 主形象 {MASTER} + 待机 {IDLE}（{n} 帧 pingpong 循环，{args.seconds}s）")

    shutil.rmtree(tmp_dir, ignore_errors=True)

    manifest = os.path.join(args.out, "character.json")
    if os.path.exists(manifest):
        os.remove(manifest)
    if args.muse_avatar:
        ok = make_muse_avatar(os.path.join(args.out, MASTER), args.muse_avatar)
        if not ok:
            sys.exit("未能生成说话形象，停止安装。")
        with open(os.path.join(args.out, "character.json"), "w", encoding="utf-8") as f:
            json.dump({"schema_version": 1, "engine_avatar": args.muse_avatar}, f)
        print(f"[2] MuseTalk 形象 {'已生成' if ok else '跳过'}：{args.muse_avatar}")

    for name in (MASTER, IDLE, "character.json"):
        p = os.path.join(args.out, name)
        if os.path.exists(p):
            print(f"  {name}: {os.path.getsize(p)} B")

    print(f"\n素材包：{args.out}")
    if delogo:
        print("已抹掉左上角 LiveTalking 水印（源码里那三处 putText 也已注释，新素材不再产生）。")
    else:
        print("保留了水印。")

    if args.install:
        install(args.out, args.muse_avatar)

    quality_gate(args.out)


def quality_gate(pack_dir):
    """打包后跑质量门槛：脸高 ≥320px（口型模型内部 256×256，小于就是放大变糊）。

    校验器在 LiveTalking/tools/check_assets.py（本仓库不复制，保持单一来源）。
    门槛不过只告警不中断：素材能继续装，但桌宠说话时嘴部会是软的。
    """
    check_path = os.path.join(LT, "tools", "check_assets.py")
    py = os.path.join(LT, ".venv", "bin", "python")
    if not (os.path.exists(check_path) and os.path.exists(py)):
        print(f"\n! 质量门槛跳过：找不到 {check_path}")
        return
    import subprocess
    print("\n[3] 质量门槛（脸高 ≥320px / 256 内部工作尺寸）：")
    res = subprocess.run([py, check_path, "--pack", pack_dir],
                         capture_output=True, text=True)
    print(res.stdout.strip())
    if res.returncode != 0:
        print("  ⚠️ 门槛未过：嘴部口型会是软的。要么换脸更大的源素材，"
              "要么接受 demo 级画质。")


if __name__ == "__main__":
    main()
