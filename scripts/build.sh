#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$PWD/.build/module-cache"
swift build --disable-sandbox -c release
BIN_DIR=$(swift build --disable-sandbox -c release --show-bin-path)
mkdir -p dist/LingDesk.app/Contents/MacOS
cp "$BIN_DIR/LingDesk" dist/LingDesk.app/Contents/MacOS/LingDesk
cp Info.plist dist/LingDesk.app/Contents/Info.plist
codesign --force --sign - dist/LingDesk.app
printf 'Built: %s/dist/LingDesk.app\n' "$PWD"
