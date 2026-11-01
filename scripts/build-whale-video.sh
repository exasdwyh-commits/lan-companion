#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
PET_APP_NAME=WhaleVideoCompanion PET_BUNDLE_ID=com.lingdesk.whalevideo \
PET_DISPLAY_NAME='澜 · 视频测试' PET_HISTORY_FILE=history-whale-video.json \
PET_ASSETS=assets/whale-video-test PET_ASSETS_SELECTIVE=1 \
bash scripts/build-pet.sh "${1:-release}"
