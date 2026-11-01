#!/bin/bash
# 对话语音实测：她开口的时候，到底是哪一层引擎在出声。
#
# 为什么单独一个脚本：`auto` 链是 qwen3 → edgetts → kokoro → 系统语音，
# 前三层任何一层挂了都**静默降级**——声音还在，只是从 Vivian 变成微软播音腔。
# 客户不会看诊断字段，只会觉得「和样品不一样」。所以「引擎对不对」必须实测，
# 不能靠「能出声」推断。
#
# 测的是冷路径：app 启动 1.5s 就说话，早于 2.0s 的预热。这比热路径更严格，
# 也更接近「用户双击完立刻开口」的真实情况。
#
# 用法：
#   bash scripts/check-whale-voice.sh              # 结果写到 benchmarks/voice-<日期>/
#   bash scripts/check-whale-voice.sh /tmp/out.json
#
# 退出码：有 FAIL 为 1。
set -uo pipefail
cd "$(dirname "$0")/.."

APP="dist/${PET_APP_NAME:-WhaleVideoCompanion}.app"
ASSETS="${PET_ASSETS:-assets/whale-video-test}"
BIN="$APP/Contents/MacOS/PetDesk"
OUT="${1:-benchmarks/voice-$(date +%F)/voice.json}"
RUNTIME="$PWD/.runtime"
QWEN3="${PET_TTS_MODEL:-$RUNTIME/models/qwen3-tts}"
# 和 PetNeuralSpeech.locatePython 保持同一顺序：项目自带 → 隔壁旧 venv。
VENV_PY="$RUNTIME/venv-tts/bin/python"
[ -x "$VENV_PY" ] || VENV_PY="$(cd .. && pwd)/LiveTalking/.venv/bin/python"
TTS_PY="${LINGDESK_TTS_PYTHON:-$VENV_PY}"

FAILED=0
pass() { printf '  PASS  %s' "$1"; [ -n "${2:-}" ] && printf ' — %s' "$2"; printf '\n'; }
fail() { printf '  FAIL  %s' "$1"; [ -n "${2:-}" ] && printf ' — %s' "$2"; printf '\n';
         [ -n "${3:-}" ] && printf '        ↳ %s\n' "$3"; FAILED=$((FAILED + 1)); }

mkdir -p "$(dirname "$OUT")"

echo "[配置]"
# character.json 决定「用哪条链」，是最容易被手改错的地方：
# 改了 speechBackend 或 neuralVoice，后面实测出来的结果就不是预期那一个。
CONFIG=$(python3 - "$ASSETS/character.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(json.dumps({k: d.get(k) for k in
                  ("speechBackend", "neuralVoice", "neuralInstruct", "neuralSpeed", "neuralGain")},
                 ensure_ascii=False))
PY
)
python3 - "$CONFIG" <<'PY' || exit 1
import json, sys
c = json.loads(sys.argv[1])
print(f"  speechBackend = {c['speechBackend']}")
print(f"  neuralVoice   = {c['neuralVoice']}")
print(f"  neuralInstruct= {c['neuralInstruct']}")
if c["speechBackend"] not in ("auto", "qwen3"):
    print(f"  ⚠ speechBackend 不是 auto/qwen3，下面实测会照它走，不是 Qwen3")
PY

echo
echo "[前置]"
if [ ! -x "$BIN" ]; then
    fail "正式包" "$BIN 不存在" "先跑 bash scripts/build-whale-video.sh release"
    echo; echo "结论：FAIL（没有可测的包）"; exit 1
fi
pass "正式包" "$BIN"

if [ -f "$QWEN3/model.safetensors" ]; then
    pass "Qwen3 权重" "$QWEN3"
else
    fail "Qwen3 权重缺失" "$QWEN3" "auto 会掉到 edgetts；音色不是 Vivian"
fi

if [ -x "$TTS_PY" ] && "$TTS_PY" -c "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('mlx_audio') else 1)" 2>/dev/null; then
    pass "mlx_audio" "$TTS_PY"
else
    fail "mlx_audio 不可用" "$TTS_PY" "Qwen3 加载会抛 ImportError，静默降级"
fi

echo
echo "[实测] 冷启动说一句（约 30 秒）"
SAID="今天的海很安静，我一直在这里。"
RESULT=$("$BIN" --say "$SAID" 2>/dev/null | grep -o '{"backend".*' | tail -1)

if [ -z "$RESULT" ]; then
    fail "语音产出" "app 没有打印诊断" "看 --say 是否需要 26s 以上，或 app 崩了"
    echo; echo "结论：FAIL"; exit 1
fi
echo "  $RESULT"

ENGINE=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('engine','none'))" "$RESULT")
VOICE=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('voice',''))" "$RESULT")
BACKEND=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('backend',''))" "$RESULT")

case "$ENGINE" in
    qwen3) pass "出声引擎" "qwen3" ;;
    none)  fail "出声引擎" "none（退到系统语音）" "worker 三层全挂。看上面 mlx_audio / 权重检查" ;;
    *)     fail "出声引擎" "$ENGINE（静默降级）" "预期 qwen3。声音还在，但音色和样品不一致" ;;
esac

if [ "$VOICE" = "Vivian" ]; then
    # 这是「请求给 worker 的音色」，不是「实际出声的音色」——
    # 降级到 edgetts 时 Vivian 对微软那边毫无意义，worker 会换成默认中文女声。
    # 所以真正判音色靠上面那条 engine：engine 错，这一项 PASS 也没意义。
    pass "请求音色" "Vivian"
else
    fail "请求音色" "$VOICE" "character.json 里 neuralVoice 应为 Vivian"
fi

# 收口是否真的生效：解释器和权重都得在项目自己的 .runtime 里。
# 只看 engine=qwen3 是不够的——隔壁 LiveTalking 的环境同样能出 qwen3，
# 而那正是「换台机器就散架」的原因。
PY_USED=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('python') or '')" "$RESULT")
MODEL_USED=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('model') or '')" "$RESULT")

case "$PY_USED" in
    "$PWD/.runtime/"*) pass "解释器在项目内" "${PY_USED#$PWD/}" ;;
    "")                fail "解释器路径" "app 没报出来" "诊断字段 speech.python 为空" ;;
    *)                 fail "解释器在项目外" "$PY_USED" "跑 bash scripts/setup-runtime.sh 收口" ;;
esac

case "$MODEL_USED" in
    "$PWD/.runtime/models/"*) pass "权重在项目内" "${MODEL_USED#$PWD/}" ;;
    "")                       fail "权重路径" "app 没报出来" "诊断字段 speech.model 为空，worker 会去翻旧缓存" ;;
    *)                        fail "权重在项目外" "$MODEL_USED" "跑 bash scripts/setup-runtime.sh 收口" ;;
esac

python3 - "$OUT" "$RESULT" "$FAILED" "$SAID" <<'PY'
import json, sys, datetime
out, raw, failed, said = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
data = json.loads(raw)
data.update({"checkedAt": datetime.datetime.now().isoformat(timespec="seconds"),
             "say": said, "failed": failed,
             "expect": {"engine": "qwen3", "voice": "Vivian"}})
json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"  → {out}")
PY

echo
if [ "$FAILED" -eq 0 ]; then
    echo "结论：PASS（对话语音走 Qwen3-TTS + Vivian）"
else
    echo "结论：FAIL（$FAILED 项）"
fi
exit $([ "$FAILED" -eq 0 ] && echo 0 || echo 1)
