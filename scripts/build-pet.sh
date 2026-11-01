#!/bin/bash
# 把 PetDesk 打成可直接双击的 .app。
# 素材一并塞进 Contents/Resources/PetAssets，这样换台机器拷过去也能跑。
set -euo pipefail
cd "$(dirname "$0")/.."
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"

CONFIG="${1:-debug}"
swift build --disable-sandbox --product PetDesk -c "$CONFIG"
BIN_DIR=$(swift build --disable-sandbox -c "$CONFIG" --show-bin-path)

APP_NAME="${PET_APP_NAME:-PetDesk}"
[[ "$APP_NAME" =~ ^[A-Za-z][A-Za-z0-9-]*$ ]] || { echo 'Invalid app name' >&2; exit 1; }
APP="dist/$APP_NAME.app"
STAGE=$(mktemp -d /tmp/pet-package.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT
BUILD_APP="$STAGE/$APP_NAME.app"
mkdir -p "$BUILD_APP/Contents/MacOS" "$BUILD_APP/Contents/Resources"

cp "$BIN_DIR/PetDesk" "$BUILD_APP/Contents/MacOS/PetDesk"

# 素材打包：默认整目录复制（保持旧行为）。设 PET_ASSETS_SELECTIVE=1 时只复制
# character.json / pack.json 真正引用的文件，避免把原片和中间成品塞进 .app。
# 清单由 scripts/pack-assets.py 推导；推导失败或引用文件缺失会让构建直接失败。
PET_ASSETS_DIR="${PET_ASSETS:-assets/malfoy-pack}"
if [[ "${PET_ASSETS_SELECTIVE:-0}" == "1" ]]; then
  mkdir -p "$BUILD_APP/Contents/Resources/PetAssets"
  # Resolve first: process-substitution failures do not propagate through while.
  # A missing video must fail the build before replacing the working app.
  python3 scripts/pack-assets.py "$PET_ASSETS_DIR" > "$STAGE/assets-list.txt"
  COUNT=0
  while read -r asset; do
    # 必须保留相对路径：`songs/tide.m4a` 要是被拍平到 PetAssets 根目录，
    # pack.json 里的 "songs/tide.m4a" 就找不到文件，表现为「歌单加载了但点不动」
    # （nextSong 会静默过滤掉文件不存在的歌）。
    mkdir -p "$BUILD_APP/Contents/Resources/PetAssets/$(dirname "$asset")"
    cp "$PET_ASSETS_DIR/$asset" "$BUILD_APP/Contents/Resources/PetAssets/$asset"
    COUNT=$((COUNT + 1))
  done < "$STAGE/assets-list.txt"
  echo "选择性打包素材: ${COUNT} 个文件 (${PET_ASSETS_DIR})"
else
  cp -R "$PET_ASSETS_DIR" "$BUILD_APP/Contents/Resources/PetAssets"
fi
cp scripts/pet_tts.py "$BUILD_APP/Contents/Resources/pet_tts.py"

cat > "$BUILD_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>桌宠</string>
  <key>CFBundleDisplayName</key><string>桌宠</string>
  <key>CFBundleIdentifier</key><string>com.lingdesk.petdesk</string>
  <key>CFBundleExecutable</key><string>PetDesk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>桌宠用麦克风听你说话，说完就停，音频默认在本机识别，不上传。</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>把你说的中文转成文字，桌宠才能听懂并回答。</string>
</dict>
</plist>
PLIST

/usr/libexec/PlistBuddy -c "Set :CFBundleName ${PET_DISPLAY_NAME:-桌宠}" "$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${PET_DISPLAY_NAME:-桌宠}" "$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${PET_BUNDLE_ID:-com.lingdesk.petdesk}" "$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :PetHistoryFile string ${PET_HISTORY_FILE:-history-pet.json}" "$BUILD_APP/Contents/Info.plist"

# 本地 ad-hoc 签名：够满足系统对可执行文件的要求，不做公证。
codesign --force --sign - --timestamp=none "$BUILD_APP"
codesign --verify --strict "$BUILD_APP"
mkdir -p dist
if [[ -d "$APP" ]]; then mv "$APP" "$STAGE/previous.app"; fi
mv "$BUILD_APP" "$APP"

du -sh "$APP"
echo "打包完成：$APP"
