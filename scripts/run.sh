#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x dist/LingDesk.app/Contents/MacOS/LingDesk ]; then bash scripts/build.sh; fi
open dist/LingDesk.app
