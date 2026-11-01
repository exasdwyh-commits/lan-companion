#!/usr/bin/env bash
# DW-02 验收：一个身份、共享会话、双音色。
#
#   bash scripts/check-dual-world.sh [报告路径]
#
# 八段：
#   1. 单元测试   身份分层 / 会话存储 / 画像可纠正
#   2. 身份实证   两形态 system 的身份段哈希相同、语气段不同、无双身份残留
#   3. 真实聊天   模型用本地桩，其余（记忆/会话/画像/TTS/落盘）全是真代码
#   4. 跨形态     她的世界说一句 → 召唤到桌面再问，上一句必须带进请求
#   5. 跨重启     新进程读回同一段会话，形态顺序 w,w,d,d
#   6. 双音色     两形态各合成同一句话，比时长与基频，不能只比配置文件
#   7. 静态       不许用全局变量冒充「这条回复的引擎」
#   8. 不变量     全程真实 ~/.smartcompanion 指纹不变
#
# 为什么要有桩：验收时外部模型可能正好额度用尽（实测 magpie 六个源全 429），
# 那时端到端根本跑不起来，只能验到「目录对了」。桩只决定「模型说了什么」，
# 下游全是真代码 —— 而且它把每次请求的形状记下来，正好证明「换形态还记得」。
#
# 退出码：全通过 0，有失败 1。
set -uo pipefail
cd "$(dirname "$0")/.."

ROOT="$PWD"
APP="${DEEPWHALE_APP:-$ROOT/dist/DeepWhale.app}"
BIN="$APP/Contents/MacOS/DeepWhale"
REPORT="${1:-benchmarks/2026-10-30-DW-02/dual-world.json}"
REAL_DIR="$HOME/.smartcompanion"
VENV_PY="$ROOT/.runtime/venv-tts/bin/python3"
TMP="$(mktemp -d /tmp/lan-dw02.XXXXXX)"

# 本机 shell 的注入会坏事：ELECTRON_RUN_AS_NODE 让 app 变 node REPL，
# NODE_OPTIONS 的 shim 会让 Electron 直接起不来。先在本进程里清掉。
unset ELECTRON_RUN_AS_NODE LAN_DATA_DIR LINGDESK_DATA_DIR PET_DATA_DIR \
      LAN_PROBE LAN_PROBE_TEXT LAN_PROBE2 LAN_PROBE_MODE
NODE_OPTIONS=; export NODE_OPTIONS
PROBE_LIMIT="${PROBE_LIMIT:-120}"
# 验收不许读真实 .env：云端 key 一被读到，本地兜底就永远测不到，
# 看起来「网络路能通」，其实离线时她不说话。
export HERMES_ENV_FILE=/dev/null

PASS=0; FAIL=0
declare -a CHECKS=()

ok()  { PASS=$((PASS+1)); CHECKS+=("$(printf '{"name":"%s","ok":true,"detail":"%s"}' "$1" "$2")"); printf '  \033[32mok\033[0m   %-26s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); CHECKS+=("$(printf '{"name":"%s","ok":false,"detail":"%s"}' "$1" "$2")"); printf '  \033[31mFAIL\033[0m %-26s %s\n' "$1" "$2"; }

fingerprint() {
  if [ ! -e "$1" ]; then echo "absent"; else
    printf '%s:%s' "$(stat -f %z "$1")" "$(stat -f %m "$1")"
  fi
}

# 从 stdin 的 JSON 里取一个字段（避免把带引号的 JSON 塞进 argv）
field() { python3 -c "import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
v=d.get('$1','')
print(v if isinstance(v,str) else json.dumps(v,ensure_ascii=False))" 2>/dev/null; }

MEM_BEFORE="$(fingerprint "$REAL_DIR/memory.jsonl")"
PROF_BEFORE="$(fingerprint "$REAL_DIR/profile.md")"
SESS_BEFORE="$(fingerprint "$REAL_DIR/session.json")"

MOCK_PIDS=""
cleanup() { for p in $MOCK_PIDS; do kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT

start_mock() {  # $1=名字 $2=失败前 N 次 $3=前几次延迟 $4=延迟毫秒 → 打印 URL
  local name="$1" fail="$2" dfirst="${3:-0}" dms="${4:-0}"
  MOCK_LOG="$TMP/mock-$name.jsonl" MOCK_FAIL_FIRST="$fail" \
    MOCK_DELAY_FIRST="$dfirst" MOCK_DELAY_MS="$dms" \
    node scripts/mock-chat-server.js > "$TMP/mock-$name.out" 2>/dev/null &
  MOCK_PIDS="$MOCK_PIDS $!"
  local i=0
  while [ $i -lt 100 ]; do
    [ -s "$TMP/mock-$name.out" ] && break
    sleep 0.1; i=$((i+1))
  done
  python3 -c "import json;print(json.load(open('$TMP/mock-$name.out'))['url'])" 2>/dev/null
}

# 跑一次探针。变量只在子 shell 里 export，不污染外层。
run_probe() {  # $1=probe $2=mode $3=text $4=magpie $5=llm $6=key $7=out $8=dataroot
  (
    export LAN_DATA_DIR="${8:-$TMP/data}" LAN_PROBE2="$1" LAN_PROBE_MODE="$2" LAN_PROBE_TEXT="$3"
    [ -n "${4:-}" ] && export MAGPIE_URL="$4"
    [ -n "${5:-}" ] && export LLM_URL="$5"
    [ -n "${6:-}" ] && export AGENS_API_KEY="$6"
    [ -n "${7:-}" ] && export LAN_PROBE_OUT="$7"
    perl -e "alarm $PROBE_LIMIT; exec @ARGV" "$BIN" 2>/dev/null | grep '^{'
  )
}

echo "DW-02 验收（真实目录 $REAL_DIR 只读；模型用本地桩，其余全真）"

# ── 1. 单元测试 ────────────────────────────────────────────────
if OUT=$(node --test MALFOY-ENGINE/test/*.test.js 2>&1); then
  ok "unit-tests" "$(printf '%s' "$OUT" | grep -c '^ok ') 项通过"
else
  bad "unit-tests" "$(printf '%s' "$OUT" | grep -E '^# (pass|fail)' | tr '\n' ' ')"
fi

if [ ! -x "$BIN" ]; then
  bad "app-present" "构建产物不存在：${APP}（先跑 scripts/build-companion.sh）"
  echo; printf '结果：%d 通过，%d 失败\n' "$PASS" "$FAIL"
  exit 1
fi
ok "app-present" "$(basename "$(dirname "$(dirname "$(dirname "$BIN")")")") 可执行"

# ── 2. 身份实证 ────────────────────────────────────────────────
ID=$(run_probe identity world "")
ID_VERDICT=$(printf '%s' "$ID" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('探针无输出'); raise SystemExit
bad=[]
if not d.get('systemsDiffer'): bad.append('两形态 prompt 完全相同')
if (d.get('sharedPrefixChars') or 0) < 100: bad.append('共享前缀只有 %s 字' % d.get('sharedPrefixChars'))
if d.get('malfoyInCore'): bad.append('身份段仍含旧角色名')
if not d.get('voicesDiffer'): bad.append('两形态音色配置相同')
print('FAIL ' + '；'.join(bad) if bad else 'OK %s 字共享身份 + %s/%s 字形态语气，音色 %s / %s' % (
    d.get('sharedPrefixChars'), d.get('worldToneChars'), d.get('desktopToneChars'),
    (d.get('worldVoice') or {}).get('hash'), (d.get('desktopVoice') or {}).get('hash')))
" 2>&1)
case "$ID_VERDICT" in
  OK*) ok "identity-single-core" "${ID_VERDICT#OK }" ;;
  *)   bad "identity-single-core" "${ID_VERDICT#FAIL }" ;;
esac

# ── 3. 真实聊天：外部额度挂掉时，本机 ollama 顶上 ────────────────
MOCK_A=$(start_mock a 0)
MOCK_B=$(start_mock b 6)           # 前 6 次 429 → 模型池全挂 → 云端回退
MOCK_C=$(start_mock c 6)           # 前 6 次 429 + 无云端 key → 落到本地 ollama
MOCK_D=$(start_mock d 0 1 1500)    # 第一次慢 1.5s → 验叠播仲裁（旧的后到）
if [ -n "$MOCK_A" ] && [ -n "$MOCK_B" ] && [ -n "$MOCK_C" ] && [ -n "$MOCK_D" ]; then
  ok "mock-ready" "四个桩已就绪"
else
  bad "mock-ready" "桩没起来"
fi

T1=$(run_probe turn world "你还记得我叫什么吗？我叫小林。" "$MOCK_C" "" "")
VIA1=$(printf '%s' "$T1" | field via)
TTS1=$(printf '%s' "$T1" | field tts)
S1=$(printf '%s' "$T1" | field sessionCount)
M1=$(printf '%s' "$T1" | field memCount)
VB1=$(printf '%s' "$T1" | field voiceBytes)
case "$VIA1" in
  ollama:*)
    if [ "$S1" = "2" ] && [ "$M1" = "1" ] && [ "${VB1:-0}" -gt 2000 ] 2>/dev/null; then
      ok "chat-local-llm" "${VIA1} 应答并合成 ${VB1}B 语音，写入 ${S1} 条会话 / ${M1} 条记忆"
    else
      bad "chat-local-llm" "${T1:-（无输出）}"
    fi ;;
  *)
    bad "chat-local-llm" "via=${VIA1:-none}，期望落到本地 ollama（外部额度挂掉时她仍要说话）" ;;
esac
# 引擎标注必须说真话：这一段真是合成的，就该标 qwen3
if [ "$TTS1" = "qwen3" ]; then
  ok "tts-engine-truthful" "合成引擎标 qwen3，与实跑一致"
else
  bad "tts-engine-truthful" "tts=${TTS1:-（空）}，期望 qwen3"
fi

# ── 4. 跨形态：换世界再问，上一句必须带过去 ─────────────────────
T2=$(run_probe turn desktop "我刚才跟你说了什么？" "$MOCK_B" "$MOCK_B" "test-key")
VIA2=$(printf '%s' "$T2" | field via)
S2=$(printf '%s' "$T2" | field sessionCount)
if [ "$S2" = "4" ]; then
  ok "session-not-reset" "换形态后会话 4 条，未重置"
else
  bad "session-not-reset" "sessionCount=${S2:-?}，期望 4（${T2:-无输出}）"
fi
if [ "$VIA2" = "agens" ]; then
  ok "fallback-records-too" "模型池全 429 时走云端回退（via=agens），照常记录"
else
  bad "fallback-records-too" "via=${VIA2:-?}，期望 agens"
fi

# 桩日志是「她真的看到了上一句」的物证
if [ -s "$TMP/mock-b.jsonl" ]; then
  CARRY=$(python3 - "$TMP/mock-b.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip().startswith("{")]
last = rows[-1] if rows else {}
users = last.get("users") or []
tone = "desktop" if last.get("hasDesktopTone") else ("world" if last.get("hasWorldTone") else "none")
print(json.dumps({"userTurn": last.get("userTurn"), "tone": tone,
                  "carried": any("我叫小林" in u for u in users)}, ensure_ascii=False))
PY
)
  if [ "$(printf '%s' "$CARRY" | field carried)" = "true" ] && [ "$(printf '%s' "$CARRY" | field tone)" = "desktop" ]; then
    ok "cross-mode-recall" "桌面形态请求带着 $(printf '%s' "$CARRY" | field userTurn) 句历史，含世界形态里说的那句"
  else
    bad "cross-mode-recall" "$CARRY"
  fi
else
  bad "cross-mode-recall" "桩没有记录到请求"
fi

# ── 5. 跨重启读回 ──────────────────────────────────────────────
SR=$(run_probe session world "")
SC=$(printf '%s' "$SR" | field count)
LM=$(printf '%s' "$SR" | field lastMode)
MODES=$(printf '%s' "$SR" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
seq=[t.get('mode') for t in d.get('turns',[]) if t.get('mode')]
print(','.join(['w' if m=='world' else 'd' if m=='desktop' else '?' for m in seq]))" 2>/dev/null)
if [ "$SC" = "4" ] && [ "$MODES" = "w,w,d,d" ]; then
  ok "session-after-restart" "新进程读回 4 条，形态顺序 ${MODES}，最近 ${LM}"
else
  bad "session-after-restart" "count=${SC:-?} 顺序=${MODES:-?}"
fi

# ── 5b. 叠播：晚到的旧回答必须被丢掉 ────────────────────────────
RC=$(run_probe race world "叠播测试" "$MOCK_D" "" "" "" "$TMP/race")
R_OLD=$(printf '%s' "$RC" | field oldSuperseded)
R_OLD_TTS=$(printf '%s' "$RC" | field oldTts)
R_NEW_TTS=$(printf '%s' "$RC" | field newTts)
if [ "$R_OLD" = "true" ] && [ "$R_OLD_TTS" = "skipped" ] && [ "$R_NEW_TTS" = "qwen3" ]; then
  ok "no-overlapping-playback" "先发的慢回答到得晚，被丢弃且不合成；新回答正常播报"
else
  bad "no-overlapping-playback" "${RC:-（无输出）}"
fi

# ── 6. 双音色：同一句话，两副嗓子 ───────────────────────────────
SAY_TEXT="今天海面很静，我在这儿。你要不要过来坐一会儿？"
SW=$(run_probe say world "$SAY_TEXT" "" "" "" "$TMP/world.mp3")
SD=$(run_probe say desktop "$SAY_TEXT" "" "" "" "$TMP/desktop.mp3")
WB=$(printf '%s' "$SW" | field bytes)
DB=$(printf '%s' "$SD" | field bytes)
WV=$(printf '%s' "$SW" | field via)
DV=$(printf '%s' "$SD" | field via)
WH=$(printf '%s' "$SW" | field instructHash)
DH=$(printf '%s' "$SD" | field instructHash)
if [ "${WB:-0}" -gt 5000 ] 2>/dev/null && [ "${DB:-0}" -gt 5000 ] 2>/dev/null \
   && [ "$WV" = "qwen3" ] && [ "$DV" = "qwen3" ] && [ "$WH" != "$DH" ]; then
  ok "two-voices-rendered" "同一句话两份成品：${WB}B / ${DB}B，引擎均 qwen3"
else
  bad "two-voices-rendered" "world=${WB:-?}B/${WV:-?} desktop=${DB:-?}B/${DV:-?}"
fi

if [ -x "$VENV_PY" ] && [ -s "$TMP/world.mp3" ] && [ -s "$TMP/desktop.mp3" ]; then
  MET=$("$VENV_PY" scripts/voice-metrics.py "$TMP/world.mp3" "$TMP/desktop.mp3" 2>&1)
  VOICE_VERDICT=$(printf '%s' "$MET" | python3 -c "
import json,sys
try: w,d = json.load(sys.stdin)
except Exception as e: print('FAIL 指标解析失败：%s' % e); raise SystemExit
bad=[]
if not d['sec'] < w['sec']: bad.append('语速没更快（%ss vs %ss）' % (d['sec'], w['sec']))
if not d['f0_p50'] >= w['f0_p50'] * 1.05: bad.append('基频没更高（%sHz vs %sHz）' % (d['f0_p50'], w['f0_p50']))
if not d['zcr'] > w['zcr']: bad.append('音色没更亮（zcr %s vs %s）' % (d['zcr'], w['zcr']))
if bad: print('FAIL ' + '；'.join(bad))
else: print('OK %ss→%ss，%sHz→%sHz，p90 %sHz→%sHz' % (
    w['sec'], d['sec'], w['f0_p50'], d['f0_p50'], w['f0_p90'], d['f0_p90']))
" 2>&1)
  case "$VOICE_VERDICT" in
    OK*) ok "two-voices-measured" "桌面形态更快更高：${VOICE_VERDICT#OK }" ;;
    *)   bad "two-voices-measured" "${VOICE_VERDICT#FAIL }" ;;
  esac
  mkdir -p "$(dirname "$REPORT")"
  cp -f "$TMP/world.mp3" "$TMP/desktop.mp3" "$(dirname "$REPORT")/" 2>/dev/null
  printf '%s' "$MET" > "$TMP/voice-metrics.json"
  printf '%s' "$MET" > "$(dirname "$REPORT")/voice-metrics.json"
else
  bad "two-voices-measured" "缺少 numpy 环境（${VENV_PY}）或音频未生成"
fi

# ── 7. 静态：不许再用全局变量冒充「这条回复的引擎」──────────────
if grep -qE 'tts:\s*LAST_TTS_VIA' MALFOY-ENGINE/main.js; then
  bad "no-global-tts-via" "main.js 仍拿 LAST_TTS_VIA 当本条的引擎"
else
  ok "no-global-tts-via" "引擎随回复返回，并发时不会串"
fi
if grep -q 'tray.setToolTip("Miss Malfoy")' MALFOY-ENGINE/main.js 2>/dev/null; then
  bad "tray-identity" "托盘仍叫 Miss Malfoy"
else
  ok "tray-identity" "托盘身份已统一"
fi

# ── 8. 不变量 ──────────────────────────────────────────────────
if [ "$MEM_BEFORE" = "$(fingerprint "$REAL_DIR/memory.jsonl")" ] \
   && [ "$PROF_BEFORE" = "$(fingerprint "$REAL_DIR/profile.md")" ] \
   && [ "$SESS_BEFORE" = "$(fingerprint "$REAL_DIR/session.json")" ]; then
  ok "real-data-untouched" "memory / profile / session 三项指纹均未变"
else
  bad "real-data-untouched" "真实目录被改动了"
fi

echo
printf '结果：%d 通过，%d 失败\n' "$PASS" "$FAIL"
mkdir -p "$(dirname "$REPORT")"
{
  printf '{"task":"DW-02","when":"%s","app":"%s","realDir":"%s","checks":[%s]' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$APP" "$REAL_DIR" "$(IFS=,; echo "${CHECKS[*]}")"
  printf ',"turnMain":%s,"turnFallback":%s,"voices":%s}\n' \
    "${T1:-null}" "${T2:-null}" "$([ -s "$TMP/voice-metrics.json" ] && cat "$TMP/voice-metrics.json" || echo null)"
} > "$REPORT"
echo "报告：$REPORT"
[ "$FAIL" -eq 0 ]
