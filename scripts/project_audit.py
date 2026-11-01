#!/usr/bin/env python3
"""Read-only inventory/static checks; explicit --write-report is the only write.

Never reads home config/history, evaluates application JS, starts services, or
claims runtime acceptance. File hashes are streamed; reports contain paths and
counts, never source/config bodies or remote URLs.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent


def route(value):
    candidate = ROOT / value
    if Path(value).is_absolute() or not candidate.resolve().is_relative_to(ROOT):
        raise ValueError(f"工程路由必须位于开发目录内: {value}")
    return candidate


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path):
    if not path.is_file():
        return None
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def command(args, input_text=None):
    return subprocess.run(args, cwd=ROOT, input=input_text, text=True,
                          capture_output=True, timeout=60)


def compare(source, packaged, label):
    original_hash, packaged_hash = digest(source), digest(packaged)
    return {"path": label, "sourceExists": original_hash is not None,
            "packagedExists": packaged_hash is not None,
            "matches": original_hash is not None and original_hash == packaged_hash}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--write-report", type=Path)
    parser.add_argument("--route", help="Print a configured existing path, e.g. primary.app")
    parser.add_argument("--json", action="store_true")
    options = parser.parse_args()
    config = read_json(ROOT / "docs/project/project.json")
    if options.route:
        value = config
        for key in options.route.split("."):
            value = value[key]
        target = route(value)
        if not target.exists():
            parser.error(f"路径不存在: {value}；缺少 App 时先执行 project.sh build")
        print(target)
        return 0

    errors, warnings, checks = [], [], []

    def check(label, success, details=None):
        checks.append({"name": label, "passed": bool(success)})
        if not success:
            errors.append(label + (f": {details}" if details else ""))

    check("project schema", config.get("schemaVersion") == 1)
    required = list(config["guides"]) + [config["primary"][key] for key in
               ("source", "buildScript", "page")] + [config["reference"][key] for key in
               ("source", "buildScript", "assets")] + [config["styleReferences"]]
    for relative in required:
        check(f"exists {relative}", route(relative).exists())

    git = {}
    for label, args in {
        "branch": ["git", "branch", "--show-current"],
        "head": ["git", "rev-parse", "--short", "HEAD"],
        "remotes": ["git", "remote"],
    }.items():
        result = command(args)
        git[label] = result.stdout.strip() if result.returncode == 0 else None
    git["remoteCount"] = len((git.pop("remotes") or "").splitlines())

    assets = route(config["reference"]["assets"])
    pack = read_json(assets / "pack.json")
    content = {key: len(pack.get(key, [])) for key in ("album", "chapters", "clips", "songs")}
    refs_result = command([sys.executable, "scripts/pack-assets.py", str(assets)])
    check("reference pack file references", refs_result.returncode == 0,
          refs_result.stderr.strip() if refs_result.returncode else None)
    refs = refs_result.stdout.splitlines() if refs_result.returncode == 0 else []
    packaged_assets = route(config["reference"]["app"]) / "Contents/Resources/PetAssets"
    integrity = [compare(assets / name, packaged_assets / name, name) for name in refs]
    if any(not item["matches"] for item in integrity):
        warnings.append("Swift 包缺失或与当前素材不一致；需要重建/核查，不能按包验收。")

    album_dir = ROOT / "assets/whale-album-2026-10-29"
    album = {"pngCounts": {name: len(list((album_dir / name).glob("*.png")))
                           for name in ("originals", "model-v2", "final-v3")}}
    album["manifests"] = {}
    for filename in ("generation.json", "generation-v3.json"):
        items = read_json(album_dir / filename)["items"]
        missing = [item["original"] for item in items
                   if not (album_dir / item["original"]).is_file()]
        missing_runtime = [item["runtime"] for item in items
                           if not (album_dir / item["runtime"]).is_file()]
        album["manifests"][filename] = {"items": len(items), "missingOriginals": missing,
                                          "missingRuntime": missing_runtime}
        if missing:
            warnings.append(f"{filename}: 缺 {len(missing)} 个原图引用，导入前需选版/补齐（DW-03）。")
    if content["album"] != album["pngCounts"]["originals"]:
        warnings.append(f"相册已接 {content['album']} 张，初版原图 {album['pngCounts']['originals']} 张（DW-03）。")

    primary_app = route(config["primary"]["app"])
    engine = route(config["primary"]["source"])
    electron_refs = ("main.js", "preload.js", "web/data.js", "web/live2d/world.html",
                     "web/live2d/chibi-motion.js", "web/live2d/chibi-renderer.js",
                     "web/live2d/chibi-texture.js", "web/live2d/chibi-performance.js",
                     "web/live2d/chibi-atlas.js", "web/live2d/chibi-face.js",
                     "web/live2d/chibi-presence.js", "lib/window-policy.js",
                     "web/live2d/world-video.js", "web/live2d/composer.html", "web/live2d/composer.js",
                     "web/live2d/companion-panel.js", "web/live2d/companion-playback.js",
                     "web/live2d/voice-capture.js", "lib/voice-endpoint.js", "lib/utterance-tail.js",
                     "lib/chat-router.js", "lib/llm-stream.js", "lib/reply-splitter.js",
                     "lib/companion-media.js", "lib/cover-jobs.js", "lib/read-ebook.py")
    electron_integrity = [compare(engine / name, primary_app / "Contents/Resources/app" / name,
                                 name) for name in electron_refs]
    if any(not item["matches"] for item in electron_integrity):
        warnings.append("Electron 核心源码与包不一致或包不存在；需构建后另验。")
    whale_in_electron = {}
    for label, base in (("source", engine), ("packaged", primary_app / "Contents/Resources/app")):
        whale_in_electron[label] = {
            "packCount": len(list(base.rglob("pack.json"))) if base.exists() else 0,
            "albumJpegCount": len(list(base.rglob("album-*.jpg"))) if base.exists() else 0,
            "tideAudioCount": len(list(base.rglob("tide.m4a"))) if base.exists() else 0,
        }
    check("Electron chibi sample", (engine / "web/live2d/whale-chibi.png").is_file())
    check("chibi texture source/runtime match",
          digest(ROOT / "assets/whale-chibi-rig-v2/texture.png") is not None and
          digest(ROOT / "assets/whale-chibi-rig-v2/texture.png") == digest(engine / "web/live2d/whale-chibi.png"))
    for name in ("background.png", "idle.webm", "touch.webm", "quiet.webm", "sleep.webm", "manifest.json", "config.js"):
        source_media = ROOT / "assets/whale-world-web-v1" / name
        check(f"world media source/runtime {name}", digest(source_media) is not None and digest(source_media) == digest(engine / "web/live2d/world-media" / name))
        electron_integrity.append(compare(source_media, primary_app / "Contents/Resources/app/web/live2d/world-media" / name, "world-media/" + name))
    for name in ("idle-smile.webm", "closeup-idle.webm", "action-heart.webm", "sleep.webm"):
        check(f"Electron video {name}", (engine / "web/live2d/keyed" / name).is_file())
    warnings.extend([
        "相册/剧情已接入当前入口（HERMES-01）；26 张 v2/v3 与歌曲好感解锁进度仍待迁入（DW-03/05）。",
        "Electron 个人数据：本静态检查不运行聊天/记忆/工作；写入隔离改用 "
        "`bash scripts/check-electron-isolation.sh` 验收（DW-01）。",
        "静态检查不验证窗口行为、模型/音色、视觉听感或公开发行条件。",
    ])

    archive_dir = ROOT / "docs/legacy/2026-10-30-before-unification"
    archive_manifest = read_json(archive_dir / "manifest.json")
    check("26 document snapshots", len(archive_manifest) == 26)
    for item in archive_manifest:
        check(f"snapshot hash {item['path']}", digest(archive_dir / item["path"]) == item["sha256"])

    if options.check:
        embedded = command([sys.executable, "scripts/prepare-chibi-texture.py", "--check"])
        check("origin-clean embedded texture matches source", embedded.returncode == 0)
        # Current guidance only. Historical snapshots deliberately retain their old links.
        documents = list((ROOT / "docs/project").rglob("*.md"))
        documents += [ROOT / "README.md", ROOT.parent / "README.md", ROOT.parent / "AGENTS.md",
                      ROOT / "docs/DEVELOPMENT.md", ROOT / "docs/ASSETS.md",
                      assets / "README.md", album_dir / "README.md",
                      route(config["styleReferences"]) / "README.md"]
        # 上面这批里有几份是"父工作区"才有的（ROOT.parent 的 README/AGENTS）：
        # 单独 clone 这个仓库时它们根本不存在。原来直接 read_text，一个不存在
        # 的路径就让整轮 check 以 FileNotFoundError 收场 —— 外部 clone 永远跑不了
        # 自检。存在才检查，是这里唯一正确的口径。
        documents = [document for document in documents if document.is_file()]
        bad_links = []
        for document in documents:
            body = re.sub(r"```.*?```", "", document.read_text(encoding="utf-8"), flags=re.S)
            for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", body):
                target = target.strip().strip("<>")
                if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
                    continue
                target = unquote(target.split("#", 1)[0])
                if not target:
                    continue
                resolved = (document.parent / target).resolve()
                # 只校验仓库内的链接。docs 里大量 ../../benchmarks/ 指向本地工作区的
                # 体检产物，本来就不随仓库发布；把它们算成坏链，等于让 check 在
                # 任何一份干净的 clone 上永远失败 —— 检查器该管的是仓库自己不散架。
                if not resolved.is_relative_to(ROOT.resolve()):
                    continue
                if not resolved.exists():
                    bad_links.append(f"{document.relative_to(ROOT.parent)} -> {target}")
        check("current documentation link targets", not bad_links, "; ".join(bad_links))
        node = shutil.which("node")
        check("node available for syntax checks", node is not None)
        if node:
            for name in electron_refs:
                if not name.endswith(".js"):
                    continue
                result = command([node, "--check", str(engine / name)])
                check(f"JS syntax {name}", result.returncode == 0)
            html = (engine / "web/live2d/world.html").read_text(encoding="utf-8")
            scripts = re.findall(r"<script\b[^>]*>(.*?)</script\s*>", html, re.S | re.I)
            inline = [script for script in scripts if script.strip()]
            check("world inline script found", bool(inline))
            for index, script in enumerate(inline):
                result = command([node, "--check"], script)
                check(f"world inline JS syntax {index + 1}", result.returncode == 0)
        for filename in ("project.sh", "build-companion.sh", "build-whale-video.sh", "build-pet.sh"):
            result = command(["bash", "-n", str(ROOT / "scripts" / filename)])
            check(f"shell syntax {filename}", result.returncode == 0)
        ast.parse(Path(__file__).read_text(encoding="utf-8"))
        check("audit Python syntax", True)

    report = {
        "generatedAt": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
        "scope": "static checks and repository/asset/package inventory; no runtime acceptance",
        "root": str(ROOT), "primary": config["primary"], "reference": config["reference"],
        "git": git, "contentCounts": content, "referenceAssetFiles": len(refs),
        "referenceBundleIntegrity": integrity, "electronBundleIntegrity": electron_integrity,
        "whaleContentInElectron": whale_in_electron, "album": album,
        "localDependencyExists": {name: (ROOT / name).exists() for name in
                                  (config["primary"]["runtimeDonor"], ".runtime/venv-tts/bin/python",
                                   ".runtime/models/qwen3-tts")},
        "documentSnapshots": len(archive_manifest), "checks": checks,
        "staticCheckRequested": options.check, "errors": errors, "warnings": warnings,
    }
    if options.write_report:
        report_path = options.write_report.resolve()
        if not report_path.is_relative_to(ROOT / "docs/project/reports"):
            parser.error("报告必须写入 docs/project/reports/，避免覆盖业务或个人文件")
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if options.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"主线: {config['primary']['source']} → {config['primary']['app']}")
        print(f"Git: {git['branch']} @ {git['head']}，remote={git['remoteCount']}")
        print("鲸鱼内容: " + ", ".join(f"{name}={count}" for name, count in content.items()))
        print(f"Swift 素材/包: {sum(item['matches'] for item in integrity)}/{len(integrity)} 一致")
        print(f"Electron 核心/包: {sum(item['matches'] for item in electron_integrity)}/{len(electron_integrity)} 一致")
        print(f"检查: {sum(item['passed'] for item in checks)}/{len(checks)}；错误={len(errors)}，待办提示={len(warnings)}")
        for error in errors:
            print("ERROR: " + error)
        for warning in warnings:
            print("待办: " + warning)
        if options.write_report:
            print(f"报告: {options.write_report}")
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(f"盘点失败: {error}", file=sys.stderr)
        raise SystemExit(1)
