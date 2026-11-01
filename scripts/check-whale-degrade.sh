#!/bin/bash
# 素材坏了之后的收敛检查：缺失 / 解码失败 / 动作缺失 / 动作被打断。
# 只读本地文件，不调聊天也不调 TTS；用户数据全部走临时目录。
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK_DIR=$(mktemp -d /tmp/whale-degrade.XXXXXX)
trap 'rm -rf "$CHECK_DIR"' EXIT
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
OUT="${1:-benchmarks/degrade-$(date +%F)/degrade.json}"
mkdir -p "$(dirname "$OUT")"
swiftc -emit-library -emit-module -module-name CompanionCore Sources/CompanionCore/*.swift \
    -emit-module-path "$CHECK_DIR/CompanionCore.swiftmodule" -o "$CHECK_DIR/libCompanionCore.dylib"
SOURCES=()
for source in Sources/PetDesk/*.swift; do
    [[ "$source" == */main.swift ]] || SOURCES+=("$source")
done
swiftc -parse-as-library "${SOURCES[@]}" Tests/PetDegradeChecks.swift \
    -I "$CHECK_DIR" -L "$CHECK_DIR" -lCompanionCore \
    -Xlinker -rpath -Xlinker "$CHECK_DIR" -o "$CHECK_DIR/check"
"$CHECK_DIR/check" "$CHECK_DIR/work" "$OUT" "$PWD/assets/whale-video-test"
