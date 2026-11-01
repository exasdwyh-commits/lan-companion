#!/bin/bash
# 打包最终版桌宠：从已验证可跑的 Electron 运行时派生，换成自己的 bundle id
#
# 母体：SmartCompanion.app（Miss Malfoy 二进制 + 同源 Electron Framework，实测可跑）
# 产物：dist/DeepWhale.app
#
# 为什么用母体复制而不是重新下载 Electron：
#   这台机器上跑通过的运行时本身就是最重要的一致性保证；从缓存 zip 重新铺
#   会引入版本差异（缓存里有 40 / 43 两个版本，主程序又是第三份），
#   一旦出问题很难判断是壳的问题还是代码的问题。
#
# 用法: build-companion.sh [输出路径]   # 默认 dist/DeepWhale.app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_APP="$ROOT/SmartCompanion.app"
OUT_APP="${1:-$ROOT/dist/DeepWhale.app}"
ENGINE="$ROOT/MALFOY-ENGINE"
KEYED_SRC="$ROOT/assets/whale-greenscreen-keyed/encoded"

EXEC_NAME="DeepWhale"                 # 可执行文件名（ASCII，Helper 名要靠它推导）
DISPLAY_NAME="深蓝"                    # 菜单栏/Finder 显示名
BUNDLE_ID="com.koudouma.deepwhale"     # 自己的 id，不再挂在 missmalfoy 下
OLD_EXEC="Miss Malfoy"

say() { printf '\033[36m[build]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[build] %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$SRC_APP" ] || die "母体不存在: $SRC_APP"
[ -d "$ENGINE" ] || die "引擎目录不存在: $ENGINE"
WORLD_MEDIA="$ROOT/assets/whale-world-web-v1"
for media in background.png idle.webm touch.webm quiet.webm sleep.webm manifest.json config.js; do
  [ -f "$WORLD_MEDIA/$media" ] || die "缺少世界视频素材: ${media}（运行 prepare-world-video.py）"
done
CHIBI_TEXTURE="$ROOT/assets/whale-chibi-rig-v2/texture.png"
[ -f "$CHIBI_TEXTURE" ] || die "缺少 Q 版骨骼原图: $CHIBI_TEXTURE"
[ -f "$ROOT/assets/whale-chibi-performance-v1/atlas.png" ] || die "缺少情境表演图集"
for motion_file in chibi-motion.js chibi-renderer.js chibi-performance.js chibi-face.js chibi-presence.js; do
  [ -f "$ENGINE/web/live2d/$motion_file" ] || die "缺少动作模块: $motion_file"
done
case "$OUT_APP" in
  "$ROOT"/dist/*) ;;
  *) die "输出路径必须在 dist/ 下，避免误伤源码: $OUT_APP" ;;
esac

# Build and verify beside the final bundle. A failure must leave the last good
# application intact; never clean the user's only runnable product first.
FINAL_APP="$OUT_APP"
BUILD_TOKEN="$(date +%Y%m%d-%H%M%S)-$$"
OUT_APP="$ROOT/dist/.DeepWhale-build-$BUILD_TOKEN.app"
mkdir -p "$ROOT/dist"
cleanup() { [ ! -d "$OUT_APP" ] || rm -rf "$OUT_APP"; }
trap cleanup EXIT

say "复制运行时（母体 → 产物）"
ditto "$SRC_APP" "$OUT_APP"

# ── 1) 主可执行文件改名 ────────────────────────────────────────────
say "主可执行文件: $OLD_EXEC → $EXEC_NAME"
if [ -f "$OUT_APP/Contents/MacOS/$OLD_EXEC" ]; then
  mv "$OUT_APP/Contents/MacOS/$OLD_EXEC" "$OUT_APP/Contents/MacOS/$EXEC_NAME"
fi

# ── 2) Helper 改名（Chromium 按「主可执行名 + Helper」去找子进程）──
for h in "$OUT_APP/Contents/Frameworks/"*.app; do
  [ -d "$h" ] || continue
  base="$(basename "$h")"
  case "$base" in
    "$OLD_EXEC"*) newbase="${base//$OLD_EXEC/$EXEC_NAME}" ;;
    Electron*)    continue ;;
    *)            continue ;;
  esac
  newpath="$OUT_APP/Contents/Frameworks/$newbase"
  say "Helper: $base → $newbase"
  mv "$h" "$newpath"
  # 里面的二进制
  for bin in "$newpath/Contents/MacOS/"*; do
    [ -f "$bin" ] || continue
    bn="$(basename "$bin")"
    mv "$bin" "$newpath/Contents/MacOS/${bn//$OLD_EXEC/$EXEC_NAME}"
  done
  # helper 自己的 Info.plist
  HP="$newpath/Contents/Info.plist"
  if [ -f "$HP" ]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable ${newbase%.app}" "$HP" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :CFBundleName ${newbase%.app}" "$HP" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID.helper" "$HP" 2>/dev/null || true
  fi
  rm -rf "$newpath/Contents/_CodeSignature"
done

# ── 3) 主 Info.plist ──────────────────────────────────────────────
say "改写 Info.plist → $BUNDLE_ID"
P="$OUT_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $EXEC_NAME" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $EXEC_NAME" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $DISPLAY_NAME" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 1.0.0" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion 1.0.0" "$P"
/usr/libexec/PlistBuddy -c "Set :NSHumanReadableCopyright Copyright © 2026 深蓝" "$P"
/usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string 与澜语音对话时录制你的声音，用于转成文字。" "$P" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :NSMicrophoneUsageDescription 与澜语音对话时录制你的声音，用于转成文字。" "$P"
plutil -lint "$P" >/dev/null || die "Info.plist 语法错误"

# ── 4) 引擎文件（排除旧页面媒体；当前 world 入口不使用它们）──────
say "铺引擎文件（web/media 已排除）"
rm -rf "$OUT_APP/Contents/Resources/app"
mkdir -p "$OUT_APP/Contents/Resources/app"
cp "$ENGINE/main.js" "$ENGINE/preload.js" "$OUT_APP/Contents/Resources/app/"
# lib/ 是 main.js 的依赖（数据目录、记忆库、服务配置）。漏了它的表现是启动即崩、
# 屏幕上什么都不出现 —— 探针会超时无输出，很难看出是「少拷了一个目录」。
rsync -a "$ENGINE/lib/" "$OUT_APP/Contents/Resources/app/lib/"
rsync -a --exclude 'media/' "$ENGINE/web/" "$OUT_APP/Contents/Resources/app/web/"
mkdir -p "$OUT_APP/Contents/Resources/app/web/live2d/world-media"
rsync -a "$WORLD_MEDIA/" "$OUT_APP/Contents/Resources/app/web/live2d/world-media/"
python3 "$ROOT/scripts/prepare-companion-songs.py" --output "$OUT_APP/Contents/Resources/app/web/live2d/companion-content"
# 音色档案 + 参考音频。缺内置音色时构建直接失败 —— 否则打出来的包点「做整首」
# 才发现没有参考音色，而错误会显示在用户面前。
python3 "$ROOT/scripts/prepare-voices.py" --output "$OUT_APP/Contents/Resources/app/web/live2d/companion-content"
# 相册/剧情引用 pack.json 与图片；从 assets 真源铺进内容目录，缺文件时构建直接失败。
python3 "$ROOT/scripts/prepare-gallery-content.py" --output "$OUT_APP/Contents/Resources/app/web/live2d/companion-content"
# 原图真源在 assets；不直接手改 dist，也不把运行副本当下一轮加工原件。
cp "$CHIBI_TEXTURE" "$OUT_APP/Contents/Resources/app/web/live2d/whale-chibi.png"
python3 "$ROOT/scripts/prepare-chibi-texture.py" \
  --output "$OUT_APP/Contents/Resources/app/web/live2d/chibi-texture.js"

# 抠像视频素材（引擎里没有就从 assets 补齐）
if [ ! -f "$OUT_APP/Contents/Resources/app/web/live2d/keyed/idle-smile.webm" ]; then
  [ -d "$KEYED_SRC" ] || die "缺少抠像视频: $KEYED_SRC"
  mkdir -p "$OUT_APP/Contents/Resources/app/web/live2d/keyed"
  cp "$KEYED_SRC"/*.webm "$OUT_APP/Contents/Resources/app/web/live2d/keyed/"
fi

cat > "$OUT_APP/Contents/Resources/app/package.json" <<JSON
{
  "name": "deepwhale",
  "productName": "$EXEC_NAME",
  "version": "1.0.0",
  "description": "$DISPLAY_NAME · 双世界桌宠（她的世界 / 你的世界）",
  "main": "main.js",
  "private": true
}
JSON

# ── 5) ad-hoc 重签（改了 plist 和资源，旧签名必然失效）─────────────
say "ad-hoc 重签"
rm -rf "$OUT_APP/Contents/_CodeSignature"
codesign --force --deep --sign - "$OUT_APP"
codesign --verify --deep --strict --verbose=1 "$OUT_APP"
# Verify required payload bytes before replacing the canonical app.
python3 "$ROOT/scripts/check-world-payload.py" "$OUT_APP"
BACKUP_DIR="$ROOT/.build/app-backups/DW-03-video-float-$BUILD_TOKEN"
if [ -d "$FINAL_APP" ]; then
  mkdir -p "$BACKUP_DIR"
  mv "$FINAL_APP" "$BACKUP_DIR/DeepWhale.app"
fi
if ! mv "$OUT_APP" "$FINAL_APP"; then
  [ ! -d "$BACKUP_DIR/DeepWhale.app" ] || mv "$BACKUP_DIR/DeepWhale.app" "$FINAL_APP"
  die "替换失败，已尝试恢复上一版"
fi
OUT_APP="$FINAL_APP"
trap - EXIT
P="$OUT_APP/Contents/Info.plist"
say "完成（上一版备份: ${BACKUP_DIR}）"
echo "  app        : $OUT_APP"
echo "  bundle id  : $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$P")"
echo "  executable : $(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$P")"
echo "  体积       : $(du -sh "$OUT_APP" | cut -f1)"
