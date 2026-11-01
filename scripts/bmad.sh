#!/bin/bash
# Project-local BMAD entry; uses installed Python only and never launches the app.
set -euo pipefail
BMAD_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export UV_CACHE_DIR="$BMAD_ROOT/.build/bmad-uv-cache"

if ! command -v uv >/dev/null 2>&1; then
  echo '需要 uv 和 Python 3.11+；请先按 docs/project/BMAD.md 准备运行环境。' >&2
  exit 127
fi

case "${1:-check}" in
  check)
    shift "$(( $# > 0 ? 1 : 0 ))"
    exec uv run --offline --python 3.12 "$BMAD_ROOT/scripts/check-bmad.py" --project-root "$BMAD_ROOT" "$@"
    ;;
  config)
    exec uv run --offline --no-cache "$BMAD_ROOT/_bmad/scripts/resolve_config.py" --project-root "$BMAD_ROOT" \
      --key core.project_name --key core.communication_language --key core.document_output_language \
      --key core.output_folder --key modules.bmm.planning_artifacts \
      --key modules.bmm.implementation_artifacts --key modules.bmm.project_knowledge
    ;;
  test)
    exec uv run --offline --python 3.12 "$BMAD_ROOT/Tests/test_bmad_setup.py" -v
    ;;
  *) echo '用法: bash scripts/bmad.sh {check [--json]|config|test}' >&2; exit 2 ;;
esac
