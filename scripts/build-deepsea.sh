#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
PET_APP_NAME=DeepseaCompanion PET_BUNDLE_ID=com.lingdesk.deepsea \
PET_DISPLAY_NAME='澜 · 桌面伙伴' PET_HISTORY_FILE=history-deepsea.json \
PET_ASSETS=assets/deepsea-sample bash scripts/build-pet.sh "${1:-release}"
