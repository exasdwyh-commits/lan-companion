#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK_DIR=$(mktemp -d /tmp/whale-album.XXXXXX)
trap 'rm -rf "$CHECK_DIR"' EXIT
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
OUT="${1:-benchmarks/whale-album-2026-10-30/checks.json}"
mkdir -p "$(dirname "$OUT")"
swiftc -parse-as-library Sources/PetDesk/PetPack.swift Sources/PetDesk/PetPanels.swift \
    Tests/PetAlbumChecks.swift -o "$CHECK_DIR/check"
"$CHECK_DIR/check" "$PWD/assets/whale-video-test" "$OUT" "${2:-}"
