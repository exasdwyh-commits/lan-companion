#!/bin/bash
# Unified project entry. status/check never launch the app or touch user data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  echo '用法: bash scripts/project.sh {status|check|build|run|reference-build}'
}

case "${1:-help}" in
  status) python3 scripts/project_audit.py ;;
  check) python3 scripts/project_audit.py --check ;;
  build)
    BUILD_SCRIPT="$(python3 scripts/project_audit.py --route primary.buildScript)"
    echo '构建 Electron 主线；当前仍依赖本机母体 App，临时构建、校验后备份并替换旧产物。'
    bash "$BUILD_SCRIPT"
    ;;
  run)
    APP_PATH="$(python3 scripts/project_audit.py --route primary.app)"
    open "$APP_PATH"
    ;;
  reference-build)
    BUILD_SCRIPT="$(python3 scripts/project_audit.py --route reference.buildScript)"
    bash "$BUILD_SCRIPT"
    ;;
  help|-h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
