#!/bin/bash
# 从歌词文本生成一首「她自己唱」的歌。
#
# 三段跑，是踩出来的：
#   1) 渲染歌词语音必须在 bash 层，用一个常驻 TTS worker 一次吃完所有行；
#      在 Python 里 spawn 这个 worker 会被沙箱按内存掐掉（它无条件预热 Qwen3，2.4 GB）。
#      顺便把「参考音色」那句也塞进同一批，省一次 13 秒的冷启动。
#   2) 换音高（WORLD）不加载任何大模型，单独跑没问题。
#   3) 换音色（Seed-VC）要 1.8G 权重，也只在这里跑。
#
# 用法：
#   bash scripts/sing_from_lyrics.sh lyrics.txt out.m4a
#   TIMBRE=1 bash scripts/sing_from_lyrics.sh lyrics.txt out.m4a out.json   # 带神经音色
#   PAD=0 bash scripts/sing_from_lyrics.sh lyrics.txt out.wav               # 只要清唱
#
# 环境变量：VOICE / ENGINE / INSTRUCT / TEMPO / PAD / TIMBRE / STEPS / SING_PYTHON
set -euo pipefail
cd "$(dirname "$0")/.."

LYRICS="${1:?用法: sing_from_lyrics.sh <歌词.txt> <输出.m4a> [时间轴.json]}"
OUT="${2:?缺少输出路径}"
JSON="${3:-}"

SING_PY="${SING_PYTHON:-$PWD/../.venvs/sing/bin/python}"
# 桌宠的 TTS 依赖已经收在项目里（.runtime/venv-tts），旧路径只作回退。
TTS_PY="${LINGDESK_TTS_PYTHON:-$PWD/.runtime/venv-tts/bin/python}"
[ -x "$TTS_PY" ] || TTS_PY="$PWD/../LiveTalking/.venv/bin/python"
VOICE="${VOICE:-Vivian}"
ENGINE="${ENGINE:-auto}"
INSTRUCT="${INSTRUCT:-少女音，音调偏高，清脆干净，语气天真烂漫，语速稍快}"
TEMPO="${TEMPO:-84}"
# PAD=0 只出人声。量客观指标时必须关掉垫底琶音：静音段里 harvest 会锁到
# 那个低八度的正弦上，把中位 f0 拉到 145Hz，看起来像「音高低了一个八度」。
PAD="${PAD:-1}"
# TIMBRE=1 走完整链路：WORLD 唱出旋律 → Seed-VC 换成她的神经音色。
# 这条链路下不再加垫音，神经声码器出来的中频很满，再垫正弦反而糊。
TIMBRE="${TIMBRE:-0}"
STEPS="${STEPS:-30}"
# 参考音色用的那句话。要有元音有起伏，别用「嗯」这种两秒不到的音节。
# 不写成 ${REF_LINE:-...} 是因为默认值里带中文句号，容易和右花括号混起来看。
if [[ -z "${REF_LINE:-}" ]]; then
    REF_LINE="海风很轻，我一直在这里陪你，别怕。"
fi

[[ -x "$SING_PY" ]] || { echo "缺少唱歌环境：$SING_PY（见 docs/DEVELOPMENT.md）" >&2; exit 2; }
[[ -x "$TTS_PY" ]] || { echo "缺少 TTS 环境：$TTS_PY" >&2; exit 2; }

WORK=$(mktemp -d /tmp/sing-lyrics.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/lines"

# 每行一个固定 UUID（...0001、...0002），排序即歌词顺序。
# 参考音色那行用全 f 的 UUID：pet_tts 要求 id 必须是合法 UUID，所以不能用
# "ref" 这种字符串；而全 0 开头会和歌词的 ...0001 撞前缀，摘不干净。
REF_ID="ffffffff-ffff-ffff-ffff-ffffffffffff"
python3 - "$LYRICS" "$WORK/jobs.jsonl" "$ENGINE" "$VOICE" "$INSTRUCT" "$REF_LINE" "$REF_ID" <<'PY'
import json, sys, uuid
source, target, engine, voice, instruct, ref_line, ref_id = sys.argv[1:8]
lines = [line.strip() for line in open(source, encoding="utf-8") if line.strip()]
def job(uid, text):
    return {"id": uid, "text": text, "engine": engine, "voice": voice,
            "speed": 1.0, "pitch": 1.0, "instruct": instruct}
with open(target, "w", encoding="utf-8") as out:
    out.write(json.dumps(job(ref_id, ref_line), ensure_ascii=False) + "\n")
    for index, line in enumerate(lines):
        out.write(json.dumps(job(str(uuid.UUID(int=index + 1)), line), ensure_ascii=False) + "\n")
print(f"{len(lines)} 行歌词 + 1 句参考音色")
PY

echo "[tts] $ENGINE / $VOICE"
"$TTS_PY" scripts/pet_tts.py "$WORK/lines" --engine "$ENGINE" --warm \
    < "$WORK/jobs.jsonl" > "$WORK/manifest.jsonl" 2> "$WORK/tts.log" || {
        echo "TTS 失败，尾部日志：" >&2
        tail -5 "$WORK/tts.log" >&2
        exit 1
    }

# 拆出参考句和歌词句。参考句单独一份清单，不参与 sing_cover 的对齐校验。
python3 - "$WORK/manifest.jsonl" "$WORK/lyrics.jsonl" "$WORK/ref.jsonl" "$REF_ID" <<'PY'
import json, sys
src, lyrics_out, ref_out, ref_id = sys.argv[1:5]
entries = [json.loads(line) for line in open(src, encoding="utf-8") if line.strip()]
ref = [e for e in entries if e.get("path") and e["id"] == ref_id]
rest = [e for e in entries if e.get("path") and e["id"] != ref_id]
if not rest:
    sys.exit("TTS 没有产出音频")
open(lyrics_out, "w", encoding="utf-8").writelines(json.dumps(e, ensure_ascii=False) + "\n" for e in rest)
open(ref_out, "w", encoding="utf-8").writelines(json.dumps(e, ensure_ascii=False) + "\n" for e in ref)
PY

ACAPELLA="$WORK/acapella.wav"
echo "[sing] 换音高"
# 注意 ${EXTRA[@]+...}：macOS 自带 bash 3.2 在 `set -u` 下把空数组的 "${EXTRA[@]}"
# 当成未绑定变量，直接写会炸 "EXTRA[@]: unbound variable"。
EXTRA=()
if [[ "$TIMBRE" == "1" || "$PAD" == "0" ]]; then EXTRA+=(--no-pad); fi
if [[ -n "$JSON" ]]; then
    "$SING_PY" scripts/sing_cover.py --lyrics "$LYRICS" --out "$ACAPELLA" --json "$JSON" \
        --spoken-manifest "$WORK/lyrics.jsonl" --tempo "$TEMPO" --voice "$VOICE" \
        ${EXTRA[@]+"${EXTRA[@]}"}
else
    "$SING_PY" scripts/sing_cover.py --lyrics "$LYRICS" --out "$ACAPELLA" \
        --spoken-manifest "$WORK/lyrics.jsonl" --tempo "$TEMPO" --voice "$VOICE" \
        ${EXTRA[@]+"${EXTRA[@]}"}
fi

FINAL="$ACAPELLA"
if [[ "$TIMBRE" == "1" ]]; then
    REF=$(python3 - "$WORK/ref.jsonl" <<'PY'
import json, sys
try:
    first = next(json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip())
except StopIteration:
    sys.exit("没有参考音色")
print(first["path"])
PY
)
    echo "[timbre] Seed-VC 换音色（$STEPS 步）"
    "$SING_PY" scripts/sing_seedvc.py --source "$ACAPELLA" --ref "$REF" \
        --out "$WORK/timbre.wav" --steps "$STEPS"
    FINAL="$WORK/timbre.wav"
fi

echo "[out] $OUT"
case "$OUT" in
    *.m4a|*.mp3|*.aac)
        FFMPEG="${FFMPEG:-/Users/exasdwyh/bin/ffmpeg}"
        "$FFMPEG" -v error -y -i "$FINAL" -c:a aac -b:a 160k "$OUT"
        ;;
    *)
        cp "$FINAL" "$OUT"
        ;;
esac
echo "完成：$OUT"
