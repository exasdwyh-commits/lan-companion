#!/usr/bin/env bash
# DW-01 隔离验收：证明「测试不碰真实数据」这件事是真的，不是文档里写的。
#
#   bash scripts/check-electron-isolation.sh [报告路径]
#
# 四段：
#   1. 单元测试   目录解析 / 记忆库写入（纯 Node，不开窗口）
#   2. 静态扫描   main.js 里不许再有第二处 home 拼接、不许有内嵌密钥
#   3. 真实探针   用构建好的 app 打 --print-data-dir，看它自己报什么目录
#   4. 不变量     全程真实 ~/.smartcompanion 指纹不变
#
# 退出码：全通过 0，有失败 1。报告是 JSON，供 CI 和后续交接引用。
set -uo pipefail
cd "$(dirname "$0")/.."

ROOT="$PWD"
APP="${DEEPWHALE_APP:-$ROOT/dist/DeepWhale.app}"
REPORT="${1:-benchmarks/2026-10-30-DW-01/isolation.json}"
REAL_DIR="$HOME/.smartcompanion"
REAL_MEM="$REAL_DIR/memory.jsonl"
TMP="$(mktemp -d /tmp/lan-iso.XXXXXX)"

# 本机 shell 会注入两个会坏事的变量：WorkBuddy 的 NODE_OPTIONS shim（打包 app 不认）
# 和 ELECTRON_RUN_AS_NODE=1（会让 app 直接变成 node REPL）。先在本进程里清掉。
unset ELECTRON_RUN_AS_NODE LAN_DATA_DIR LINGDESK_DATA_DIR PET_DATA_DIR LAN_PROBE LAN_PROBE_TEXT
NODE_OPTIONS=; export NODE_OPTIONS
PROBE_LIMIT="${PROBE_LIMIT:-25}"

PASS=0; FAIL=0
declare -a CHECKS=()

# 跑一次 app 探针，带看门狗：旧构建不认探针开关时会一直开着窗口不退出，
# 没有超时这脚本就永远卡住。perl 的 alarm 在 exec 之后仍然有效。
run_probe() {
  perl -e 'alarm shift; exec @ARGV' "$PROBE_LIMIT" "$BIN" 2>/dev/null | grep '^{'
}

ok()   { PASS=$((PASS+1)); CHECKS+=("$(printf '{"name":"%s","ok":true,"detail":"%s"}' "$1" "$2")"); printf '  \033[32mok\033[0m   %-34s %s\n' "$1" "$2"; }
bad()  { FAIL=$((FAIL+1)); CHECKS+=("$(printf '{"name":"%s","ok":false,"detail":"%s"}' "$1" "$2")"); printf '  \033[31mFAIL\033[0m %-34s %s\n' "$1" "$2"; }

fingerprint() {
  if [ ! -e "$1" ]; then echo "absent"; else
    printf '%s:%s' "$(stat -f %z "$1")" "$(stat -f %m "$1")"
  fi
}

BEFORE="$(fingerprint "$REAL_MEM")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "DW-01 隔离验收（真实目录 $REAL_DIR 只读，不写入）"

# ── 1. 单元测试 ────────────────────────────────────────────────
if OUT=$(node --test MALFOY-ENGINE/test/*.test.js 2>&1); then
  N=$(printf '%s' "$OUT" | grep -c '^ok ')
  ok "unit-tests" "$N 项通过"
else
  bad "unit-tests" "$(printf '%s' "$OUT" | grep -E '^# (pass|fail)' | tr '\n' ' ')"
fi

# ── 2. 静态扫描 ────────────────────────────────────────────────
MAIN="MALFOY-ENGINE/main.js"
if grep -q 'MEM_DIR = path.join(process.env.HOME' "$MAIN" 2>/dev/null; then
  bad "no-second-home-path" "main.js 仍在拼 ~/.smartcompanion"
else
  ok "no-second-home-path" "数据目录只经 lib/data-dir.js"
fi

# 内嵌密钥：形如 KEY = "长串"，排除明显的 URL/路径
if SECRETS=$(grep -nE '(KEY|TOKEN|SECRET)[A-Z_]*\s*=\s*"[A-Za-z0-9_\-]{16,}"' MALFOY-ENGINE/main.js MALFOY-ENGINE/lib/*.js 2>/dev/null | grep -v 'http'); then
  bad "no-embedded-secret" "$(printf '%s' "$SECRETS" | wc -l | tr -d ' ') 处硬编码密钥"
else
  ok "no-embedded-secret" "密钥只从环境/.env 取"
fi

if [ -f MALFOY-ENGINE/lib/data-dir.js ] && [ -f MALFOY-ENGINE/lib/memory-store.js ]; then
  ok "modules-present" "data-dir.js / memory-store.js"
else
  bad "modules-present" "缺少隔离模块"
fi

# ── 3. 真实探针 ────────────────────────────────────────────────
BIN="$APP/Contents/MacOS/DeepWhale"
if [ ! -x "$BIN" ]; then
  bad "app-probe-explicit" "构建产物不存在：$APP（先跑 scripts/build-companion.sh）"
  bad "app-probe-default" "同上"
else
  PROBE=$(LAN_DATA_DIR="$TMP/data" LAN_PRINT_DATA_DIR=1 run_probe)
  if printf '%s' "$PROBE" | grep -q "\"dataDir\":\"$TMP/data\""; then
    ok "app-probe-explicit" "app 自报 $TMP/data"
  else
    bad "app-probe-explicit" "app 报的是：${PROBE:-（${PROBE_LIMIT}s 内无输出，可能没识别探针开关）}"
  fi

  # 不传任何数据目录时，应回到旧默认且标记为不隔离
  DEF=$(LAN_PRINT_DATA_DIR=1 run_probe)
  if printf '%s' "$DEF" | grep -q '"explicit":false'; then
    ok "app-probe-default" "未指定时回落 ~/.smartcompanion 且标记 explicit=false"
  else
    bad "app-probe-default" "${DEF:-（无输出）}"
  fi
fi

# ── 4. 真写一次，另起进程读回来（这才是「隔离」的实质）──────────
if [ -x "$BIN" ]; then
  MARK="隔离探针-$$-$RANDOM"
  W=$(LAN_DATA_DIR="$TMP/data" LAN_PROBE=write LAN_PROBE_TEXT="$MARK" run_probe)
  R=$(LAN_DATA_DIR="$TMP/data" LAN_PROBE=read LAN_PROBE_TEXT="$MARK" run_probe)
  VERDICT=$(printf '%s\n%s' "$W" "$R" | python3 -c "
import json, sys
mark = '''$MARK'''
rows = []
for line in sys.stdin.read().splitlines():
    line = line.strip()
    if line.startswith('{'):
        try: rows.append(json.loads(line))
        except Exception: pass
if len(rows) < 2:
    print('探针没有输出两段 JSON'); raise SystemExit
w, r = rows[0], rows[1]
if w.get('count') != 1:
    print(f\"写入后 count={w.get('count')}，应为 1\")
elif not r.get('matches'):
    print('重启后读回的不是刚写的那条')
else:
    print('OK 写入计数 1，重启读回同一句')
" 2>&1)
  case "$VERDICT" in
    OK*) ok "write-then-reread" "${VERDICT#OK }" ;;
    *)   bad "write-then-reread" "$VERDICT" ;;
  esac

  if [ -s "$TMP/data/memory.jsonl" ]; then
    ok "temp-memory-file" "$(wc -l < "$TMP/data/memory.jsonl" | tr -d ' ') 行落在临时目录"
  else
    bad "temp-memory-file" "临时目录没有 memory.jsonl"
  fi
else
  bad "write-then-reread" "构建产物不存在"
  bad "temp-memory-file" "构建产物不存在"
fi

# ── 5. 不变量：跑完所有探针后，真实目录仍未被改动 ────────────────
# 放在最后，是因为前面任何一步写错地方，这条都能抓出来。
AFTER="$(fingerprint "$REAL_MEM")"
if [ "$BEFORE" = "$AFTER" ]; then
  ok "real-data-untouched" "memory.jsonl 指纹未变（${AFTER}）"
else
  bad "real-data-untouched" "$BEFORE → $AFTER"
fi

echo
printf '结果：%d 通过，%d 失败\n' "$PASS" "$FAIL"
mkdir -p "$(dirname "$REPORT")"
{
  printf '{"task":"DW-01","when":"%s","app":"%s","realDir":"%s","realFingerprint":"%s","checks":{%s}}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$APP" "$REAL_DIR" "$AFTER" "$(IFS=,; echo "${CHECKS[*]}")"
} > "$REPORT"
echo "报告：$REPORT"
[ "$FAIL" -eq 0 ]
