#!/bin/bash
# 唱歌功能检查：播放 / 歌词时间码 / 点击停止 / 本地意图 / 听完奖励 / 缺素材。
# 夹具是一段 ffmpeg 合成的 6 秒音轨，不联网、不调 TTS。
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK_DIR=$(mktemp -d /tmp/whale-songs.XXXXXX)
trap 'rm -rf "$CHECK_DIR"' EXIT
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
OUT="${1:-benchmarks/sing-$(date +%F)/songs.json}"
mkdir -p "$(dirname "$OUT")"

# 夹具音轨在这里生成：测试进程里 exec ffmpeg 会被沙箱 terminate，只能由脚本先做好。
WORK="$CHECK_DIR/work"
mkdir -p "$WORK/pack/songs"
FFMPEG=$(command -v ffmpeg || echo /Users/exasdwyh/bin/ffmpeg)
"$FFMPEG" -v error -y \
    -f lavfi -i "sine=frequency=440:duration=2" \
    -f lavfi -i "sine=frequency=554:duration=2" \
    -f lavfi -i "sine=frequency=659:duration=2" \
    -filter_complex "[0][1][2]concat=n=3:v=0:a=1,afade=t=out:st=5.4:d=0.6[a]" \
    -map "[a]" -c:a aac -b:a 96k "$WORK/pack/songs/demo.m4a"

swiftc -emit-library -emit-module -module-name CompanionCore Sources/CompanionCore/*.swift \
    -emit-module-path "$CHECK_DIR/CompanionCore.swiftmodule" -o "$CHECK_DIR/libCompanionCore.dylib"
SOURCES=()
for source in Sources/PetDesk/*.swift; do
    [[ "$source" == */main.swift ]] || SOURCES+=("$source")
done
swiftc -parse-as-library "${SOURCES[@]}" Tests/PetSongChecks.swift \
    -I "$CHECK_DIR" -L "$CHECK_DIR" -lCompanionCore \
    -Xlinker -rpath -Xlinker "$CHECK_DIR" -o "$CHECK_DIR/check"
"$CHECK_DIR/check" "$WORK" "$OUT"
