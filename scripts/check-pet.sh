#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK_DIR=$(mktemp -d /tmp/pet-check.XXXXXX)
trap 'if [[ -n "${FIXTURE_PID:-}" ]]; then kill "$FIXTURE_PID" 2>/dev/null || true; fi; rm -rf "$CHECK_DIR"' EXIT
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x180:rate=15 -t 2 -c:v libx264 -pix_fmt yuv420p "$CHECK_DIR/background.mp4"
python3 Tests/pet_fixture.py "$CHECK_DIR/port" "$CHECK_DIR/request.json" &
FIXTURE_PID=$!
swiftc -emit-library -emit-module -module-name CompanionCore Sources/CompanionCore/*.swift \
    -emit-module-path "$CHECK_DIR/CompanionCore.swiftmodule" -o "$CHECK_DIR/libCompanionCore.dylib"
swiftc -parse-as-library Sources/PetDesk/Stage.swift Sources/PetDesk/PetContentView.swift \
    Sources/PetDesk/PetIdentity.swift Sources/PetDesk/PetNeuralSpeech.swift Sources/PetDesk/PetController.swift Sources/PetDesk/PetSettingsWindow.swift Tests/PetChecks.swift \
    -I "$CHECK_DIR" -L "$CHECK_DIR" -lCompanionCore -Xlinker -rpath -Xlinker "$CHECK_DIR" -o "$CHECK_DIR/check"
OUT="${1:-benchmarks/deepsea-sample-2026-10-29/lifecycle.json}"
"$CHECK_DIR/check" "$CHECK_DIR/data" "$PWD/assets/deepsea-sample" "$(cat "$CHECK_DIR/port")" "$PWD/assets/malfoy-pack" "$OUT" "$CHECK_DIR/background.mp4"
python3 - "$CHECK_DIR/request.json" <<'PY'
import json, sys
messages=json.load(open(sys.argv[1]))['messages']
assert messages[0]['role']=='system' and '澜' in messages[0]['content']
assert messages[-1]['content']=='停止时应丢弃的回复'
print('PASS: character identity and complete Chinese input reached fixture')
PY
