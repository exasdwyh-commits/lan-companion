#!/bin/bash
# Current whale quiet/sleep lifecycle checks; isolated data, no model/TTS calls.
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK_DIR=$(mktemp -d /tmp/whale-modes.XXXXXX)
trap 'rm -rf "$CHECK_DIR"' EXIT
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
OUT="${1:-benchmarks/quiet-sleep-2026-10-29/modes.json}"
mkdir -p "$(dirname "$OUT")"
swiftc -emit-library -emit-module -module-name CompanionCore Sources/CompanionCore/*.swift \
    -emit-module-path "$CHECK_DIR/CompanionCore.swiftmodule" -o "$CHECK_DIR/libCompanionCore.dylib"
SOURCES=()
for source in Sources/PetDesk/*.swift; do
    [[ "$source" == */main.swift ]] || SOURCES+=("$source")
done
swiftc -parse-as-library "${SOURCES[@]}" Tests/PetModeChecks.swift \
    -I "$CHECK_DIR" -L "$CHECK_DIR" -lCompanionCore \
    -Xlinker -rpath -Xlinker "$CHECK_DIR" -o "$CHECK_DIR/check"
"$CHECK_DIR/check" "$CHECK_DIR/data" "$PWD/assets/whale-video-test" "$OUT"
