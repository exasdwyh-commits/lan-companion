#!/bin/bash
# 在只有 Command Line Tools、没有 XCTest 的机器上运行真正的核心及桥进程检查。
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/lingdesk-check.XXXXXX")
trap 'rm -rf "$CHECK_DIR"' EXIT
export CLANG_MODULE_CACHE_PATH="$CHECK_DIR/module-cache"
swiftc -emit-library -emit-module -module-name CompanionCore Sources/CompanionCore/*.swift \
  -emit-module-path "$CHECK_DIR/CompanionCore.swiftmodule" -o "$CHECK_DIR/libCompanionCore.dylib"
swiftc -parse-as-library Sources/LingDesk/EngineBridge.swift Tests/SmokeChecks.swift \
  -I "$CHECK_DIR" -L "$CHECK_DIR" -lCompanionCore -Xlinker -rpath -Xlinker "$CHECK_DIR" -o "$CHECK_DIR/check"
"$CHECK_DIR/check" "${PYTHON:-/usr/bin/python3}" "$PWD/Tests/fake_engine.py"
