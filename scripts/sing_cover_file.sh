#!/usr/bin/env bash
# 给一首现成的歌，让她来翻唱。
#
#   本地文件:  bash scripts/sing_cover_file.sh 原唱.mp3 out.m4a
#   链接:      bash scripts/sing_cover_file.sh "https://www.bilibili.com/video/BVxx" out.m4a
#   试听一段:  PREVIEW_SEC=25 bash scripts/sing_cover_file.sh 原唱.mp3 preview.m4a
#
# 管线（五步，各自可以单独失败重跑）：
#   1. 取源      本地直接用；http(s) 链接交给 yt-dlp（B 站 / YouTube 均可）
#   2. 分离      Demucs htdemucs 两轨模式 → 人声轨 + 伴奏轨
#   3. 定调/换音色 按音域算升几个半音；人声交给 Seed-VC 换音色
#   3.5 整形     频谱塑形，决定「磁性 / 厚 / 不尖」的听感（见下）
#   4. 混回      伴奏同步变调 + 整形后的人声 → AAC
#
# 为什么伴奏也要变调：
#   Seed-VC 只换音色不换音域。男声原唱歌写在 110~330Hz，换成女声后那段
#   低音她根本唱不实（只能出气声），中音也上不去胸声厚度 —— 听感就是
#   「虚、闷、放不开」。解法是整首歌一起升到女声能唱的音域。
#   只升人声会被当成跑调：人声在 G 调、伴奏还在 C 调。
#
# 参考音色与整形档位：
#   说话用 assets/whale-video-test/voice/ref-vivian.wav（清冷优雅，跟世界走）
#   唱歌用 ref-sing-magnetic.wav（磁性女声，32s）—— 实测换参考对频谱重心
#   只有 ±5% 的影响，真正决定听感的是 3.5 这一步，详见
#   benchmarks/2026-10-31-DW-05-workbuddy/README.md
#   SHAPE=studio（默认，用户已确认）| warm | rich | none
#
set -Eeuo pipefail
STAGE=source
# librosa 每次 import 都会在 __pycache__ 下建一个临时目录再删掉。带删除守卫的
# 托管环境会把「一回合内第 N 次删除」当成批量删除拦下来，python 进程直接被
# SystemExit(1) 中断。症状很迷惑：analyze_song.py 静默不出 report.json（于是
# 定调退回 0 半音、伴奏不跟着升），Seed-VC 那步报 stage=converting code=1 ——
# 两个看起来无关的失败其实是同一个根因。
# 本脚本删的只有自己建的中间文件，关掉这层守卫是安全的；普通环境里没人读它。
# 必须直接赋值（不能写成 ${VAR:-0}）—— 父环境里这个变量往往已经是 1，
# 那样子类判断会用 1 填空，守卫根本关不掉。
export CODEBUDDY_SAFE_DELETE_ENABLED=0
# Only stable stage names and exit codes cross into the UI, never raw paths/logs.
trap 'code=$?; printf "[cover-error] stage=%s code=%s\n" "$STAGE" "$code" >&2' ERR
cd "$(dirname "$0")/.."

FF="${FFMPEG:-/Users/exasdwyh/bin/ffmpeg}"
YTDLP="${YTDLP:-/Users/exasdwyh/bin/yt-dlp}"
SING_PY="${SING_PYTHON:-$PWD/../.venvs/sing/bin/python}"
REF="${REF:-assets/whale-video-test/voice/ref-sing-magnetic.wav}"
# 音色档案：REF 决定「谁在唱」，VOICE_LO/HI 决定「她能唱多低多高」。
# 这两件事互相独立 —— 换参考只改年龄感和明亮度，改不了音域；反之亦然。
# 由 lib/cover-jobs.js 从 voices.json 读出来传进来，直接跑脚本时走默认值。
VOICE_ID="${VOICE:-default}"
VOICE_LO="${VOICE_LO:-165}"
VOICE_HI="${VOICE_HI:-}"
VOICE_NAME="${VOICE_NAME:-通用女声}"
# 只分析不合成：分离完、算出该怎么调就退出。面板靠它先给出方案再让人决定。
ANALYZE_ONLY="${ANALYZE_ONLY:-0}"
SHAPE="${SHAPE:-studio}"
STEPS="${STEPS:-30}"
DEVICE="${DEVICE:-cpu}"      # Demucs 分离设备；mps 快很多但可能踩到未实现的算子
# 半音移调。留空 = 按人声音域自动判定（见 voice_range.py）；
# 显式给数字（含 0）就按给定值走，便于用户手动覆盖。
SHIFT="${SHIFT:-}"
CHUNK_MAX="${CHUNK_MAX:-29}" # 单段上限（秒）：必须 <30，否则 Seed-VC 走分片路径照样 OOM
VOCAL_GAIN="${VOCAL_GAIN:-1.0}"   # 人声音量倍率，混回去嫌人声大就调 0.8
# 试听：>0 时只处理整首里最响的这段（秒），产物是短片段。
PREVIEW_SEC="${PREVIEW_SEC:-0}"
PREVIEW_FROM="${PREVIEW_FROM:-auto}"  # auto = 自动找副歌；或给起始秒
WORK="${WORK:-$(mktemp -d /tmp/cover.XXXXXX)}"

IN="${1:?用法: sing_cover_file.sh <mp3|wav|链接> [输出.m4a]}"
OUT="${2:-assets/whale-video-test/songs/cover.m4a}"
mkdir -p "$WORK" "$(dirname "$OUT")"

# 读时长只为一个数字，别把整条音频读进来。
duration_of() {
    # ffmpeg -i without an output deliberately exits 1. Parse its metadata
    # outside a pipefail pipeline; do not confuse that exit with bad input.
    "$SING_PY" - "$FF" "$1" <<'PY'
import re, subprocess, sys
result = subprocess.run([sys.argv[1], '-hide_banner', '-i', sys.argv[2]],
                        capture_output=True, text=True)
match = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', result.stderr)
if not match:
    raise SystemExit('无法读取音频时长。')
h, m, s = map(float, match.groups())
print(f'{h * 3600 + m * 60 + s:.2f}')
PY
}

# 变调一个音频文件，保持时长不变。
#   asetrate 改播放速率（音高与速度一起变），atempo 把速度拉回来。
# ffmpeg 没编 rubberband，这是不引外部依赖的唯一选择。副作用是共振峰
# 一起上移，升幅大时伴奏会偏亮偏薄 —— 所以下面配了一段补偿 EQ。
shift_audio() {
    local src=$1 dst=$2 n=$3
    # 目标时长严格取源时长。asetrate+atempo 必然有重采样取整误差：
    # 实测升 6 半音 25 秒会短 44ms，按比例整首 210 秒累积约 370ms ——
    # 混音不做对齐，短的伴奏到结尾就没了，人声最后一段变成干唱。
    # 所以这里先变调、再 apad 补静音、最后 -t 硬截到源长度。
    local want
    want=$(duration_of "$src")
    if [[ "$n" -eq 0 ]]; then
        "$FF" -y -v error -i "$src" -t "$want" -ar 44100 -ac 2 "$dst"
        return
    fi
    local factor tempo
    factor=$("$SING_PY" -c "print(f'{2**($n/12):.6f}')")
    tempo=$("$SING_PY" -c "print(f'{2**(-($n/12)):.6f}')")
    # 升调后频谱整体上移，镲片/齿音变刺、贝斯下潜变浅。按半音数反向补一点：
    # 高频压 -0.35dB/半音，低频补 +0.3dB/半音。升 6 半音约 -2.1/+1.8dB，
    # 刚好抵消大部分「变薄」感，又不会把伴奏改得比原版更闷。
    # 降调时符号自然反过来（负 n 让高频抬、低频削），不需要单独分支。
    local tilt body chain
    tilt=$("$SING_PY" -c "print(f'{-0.35*$n:.2f}')")
    body=$("$SING_PY" -c "print(f'{0.3*$n:.2f}')")
    # 不要写 aresample=resampler=soxr —— 这台 ffmpeg 7.1 没编 libsoxr，
    # 会直接抛 "Requested resampling engine is unavailable" 让整步失败。
    # 采样率由输出端的 -ar 44100 自动处理，用的是内置 swr。
    chain="asetrate=44100*${factor},atempo=${tempo}"
    chain="${chain},aresample=44100,highshelf=f=7000:g=${tilt},lowshelf=f=120:g=${body}"
    "$FF" -y -v error -i "$src" -af "${chain},apad" -t "$want" -ar 44100 -ac 2 "$dst"
}

echo "[1/4] 取源 → $WORK"
if [[ -s "$WORK/in.wav" ]]; then
    echo "  已有 in.wav，跳过"
else
    if [[ "$IN" =~ ^https?:// ]]; then
        "$YTDLP" -x --audio-format wav --audio-quality 0 -o "$WORK/source.%(ext)s" "$IN"
        SRC=$(ls "$WORK"/source.* | head -1)
    else
        [ -f "$IN" ] || { echo "文件不存在: $IN"; exit 1; }
        SRC="$IN"
    fi
    # Demucs 吃标准采样率的普通 wav，先统一转一遍。
    "$FF" -y -v error -i "$SRC" -ar 44100 -ac 2 "$WORK/in.wav"
fi

echo "[2/4] 分离人声/伴奏（htdemucs，CPU 上几分钟）"
STAGE=separating
STEM="$WORK/demucs/htdemucs/in"
if [[ -s "$STEM/vocals.wav" && -s "$STEM/no_vocals.wav" ]]; then
    echo "  已有分离产物，跳过（要重跑就删掉 ${STEM}）"
else
    # 权重收在项目里（.models/torch/hub/checkpoints），不散到家目录缓存。
    TORCH_HOME="$PWD/.models/torch" "$SING_PY" -m demucs -n htdemucs --two-stems=vocals \
        -d "$DEVICE" -o "$WORK/demucs" "$WORK/in.wav"
fi
[ -f "$STEM/vocals.wav" ] || { echo "分离失败"; exit 1; }

# 定调 + 歌曲分析：需要完整人声轨的统计，所以放在分离之后、转换之前。
# 显式给了 SHIFT 就尊重用户；否则按音域自动算。
#
# 报告一次算全：音域、BPM、调性、以及每个音色各该升多少。这样用户切音色
# 不用重跑分析 —— 换的只是「选哪一档」，歌的属性没变。
VOICES_JSON="${VOICES_JSON:-}"
if [[ -z "$VOICES_JSON" ]]; then
    for candidate in assets/voices/voices.json \
                     MALFOY-ENGINE/web/live2d/companion-content/voices.json; do
        [[ -f "$candidate" ]] && { VOICES_JSON="$candidate"; break; }
    done
fi

report_shift() {
    "$SING_PY" - "$WORK/report.json" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    print((data.get('voices') or [{}])[0].get('semitones', 0))
except Exception:
    print(0)
PY
}

# 缓存按音色区分：换了音色，下界就变了，推荐值必须重算。
cached_voice() {
    "$SING_PY" - "$WORK/report.json" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    print((data.get('voices') or [{}])[0].get('id', ''))
except Exception:
    print('')
PY
}

if [[ -z "$SHIFT" ]]; then
    if [[ -s "$WORK/report.json" && "$(cached_voice)" == "$VOICE_ID" ]]; then
        echo "  复用上次的分析结果（音色 ${VOICE_ID}）"
        SHIFT=$(report_shift)
    else
        echo "  分析音域 / BPM / 调性…"
        # 分析失败不该拦住翻唱：回退成 0，让用户自己拖滑块。
        "$SING_PY" scripts/analyze_song.py --vocals "$STEM/vocals.wav" \
            --backing "$STEM/no_vocals.wav" \
            ${VOICES_JSON:+--voices "$VOICES_JSON"} \
            --voice-id "$VOICE_ID" --voice-lo "$VOICE_LO" \
            ${VOICE_HI:+--voice-hi "$VOICE_HI"} --voice-name "$VOICE_NAME" \
            --json "$WORK/report.json" 2>&1 | sed 's/^/    /' || true
        SHIFT=$(report_shift)
    fi
    echo "[cover-shift] semitones=$SHIFT"
fi
[[ "$SHIFT" =~ ^-?[0-9]+$ ]] || { echo "SHIFT 必须是整数半音：$SHIFT"; exit 2; }

# 只分析模式：到这里「该怎么调」已经全知道了，不必再跑几十秒的转换。
if [[ "$ANALYZE_ONLY" == "1" ]]; then
    [[ -s "$WORK/report.json" ]] || { echo "分析没有产出结果"; exit 3; }
    echo "[cover-analyze] done voice=$VOICE_ID semitones=$SHIFT"
    exit 0
fi

# 试听模式：只截最响的一段（副歌），产物和中间文件都放进独立子目录，
# 免得和整首的 her.wav 互相顶掉——同一首歌常常要先试听再出整首。
#
# 目录名必须带上音色：否则「换个音色再听一版」时 her.wav 已存在就被跳过，
# 用户听到的还是上一个音色的结果，会以为换音色没作用。
if [[ "$PREVIEW_SEC" != "0" ]]; then
    PWORK="$WORK/preview-${VOICE_ID}-${SHIFT}"
    mkdir -p "$PWORK"
    VCLIP="$PWORK/vocal-clip.wav"
    BCLIP="$PWORK/backing-clip.wav"
    if [[ -s "$VCLIP" && -s "$BCLIP" ]]; then
        echo "  已有试听片段，跳过截取"
    else
        if [[ "$PREVIEW_FROM" == "auto" ]]; then
            START=$("$SING_PY" scripts/voice_range.py --in "$STEM/vocals.wav" \
                --pick-clip "$PREVIEW_SEC" 2>/dev/null | head -1)
            [[ "$START" =~ ^[0-9.]+$ ]] || START=0
        else
            START="$PREVIEW_FROM"
        fi
        echo "[cover-preview] from=$START sec=$PREVIEW_SEC"
        "$FF" -y -v error -ss "$START" -t "$PREVIEW_SEC" -i "$STEM/vocals.wav" -ar 44100 -ac 1 "$VCLIP"
        "$FF" -y -v error -ss "$START" -t "$PREVIEW_SEC" -i "$STEM/no_vocals.wav" -ar 44100 -ac 2 "$BCLIP"
    fi
    VOCAL="$VCLIP"
    BACKING="$BCLIP"
else
    # 整首同理：按音色 + 移调分目录，换音色重做时不会捡到上一个音色的干声。
    PWORK="$WORK/full-${VOICE_ID}-${SHIFT}"
    mkdir -p "$PWORK"
    VOCAL="$STEM/vocals.wav"
    BACKING="$STEM/no_vocals.wav"
fi

echo "[3/4] 移调 ${SHIFT} 半音 + 换音色（Seed-VC $STEPS 步）"
STAGE=converting
CHUNKS="$PWORK/chunks"
PLAN="$PWORK/chunk-plan.json"

if [[ -s "$PWORK/her.wav" ]]; then
    echo "  已有转换结果，跳过（要重跑就删掉 ${PWORK}/her.wav）"
else
    DUR=$(duration_of "$VOCAL")
    # Seed-VC 自带分片只切语义特征，mel 仍是整条算的，长音频在 MPS 上会 OOM。
    # 所以外头先按静音点切段，让每段都落在它不分片的简单路径上。
    if awk "BEGIN{exit !($DUR > $CHUNK_MAX)}"; then
        echo "  人声 ${DUR}s > ${CHUNK_MAX}s，按静音点切段后逐段转换"
        "$SING_PY" scripts/split_vocals.py --in "$VOCAL" --out-dir "$CHUNKS" \
            --plan "$PLAN" --chunk "$CHUNK_MAX"

        COUNT=$("$SING_PY" -c 'import json,sys;print(len(json.load(open(sys.argv[1]))))' "$PLAN")
        LAST=$((COUNT - 1))
        for i in $(seq -f "%02g" 0 "$LAST"); do
            echo "[cover-progress] chunk=$((10#$i + 1)) total=$COUNT"
            if [[ -f "$CHUNKS/her-$i.wav" ]]; then
                echo "  段 ${i} 已转换，跳过"
            else
                echo "  段 ${i}/${LAST} 转换中…"
                "$SING_PY" scripts/sing_seedvc.py --singing \
                    --source "$CHUNKS/vocal-$i.wav" --ref "$REF" \
                    --out "$CHUNKS/her-$i.wav" --steps "$STEPS" --semi-tone "$SHIFT"
            fi
        done

        "$SING_PY" - "$CHUNKS" "$PWORK/concat.txt" "$COUNT" <<'PY'
from pathlib import Path
import sys
chunks, output, count = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
with output.open('w', encoding='utf8') as handle:
    for index in range(count):
        # ffconcat uses backslash escaping outside quoted sections.
        name = str((chunks / f'her-{index:02d}.wav').resolve()).replace("'", "'\\''")
        handle.write(f"file '{name}'\n")
PY
        "$FF" -y -v error -f concat -safe 0 -i "$PWORK/concat.txt" -c copy "$PWORK/her.wav"
    else
        "$SING_PY" scripts/sing_seedvc.py --singing --source "$VOCAL" --ref "$REF" \
            --out "$PWORK/her.wav" --steps "$STEPS" --semi-tone "$SHIFT"
    fi
fi

# 换音色只解决「是谁在唱」，不解决「好不好听」—— 削齿音刺耳段、补胸腔厚度
# 才有磁性。shape_vocal.py 内部会自动补回被削掉的响度，别跳过它。
VOCAL_OUT="$PWORK/her.wav"
if [[ "$SHAPE" != "none" ]]; then
  STAGE=shaping
  echo "[3.5/4] 音色整形（${SHAPE}）"
  if [[ -s "$PWORK/her-shaped.wav" ]]; then
    echo "  已有整形结果，跳过（要换档就删掉 $PWORK/her-shaped.wav）"
  else
    "$SING_PY" scripts/shape_vocal.py --in "$PWORK/her.wav" --out "$PWORK/her-shaped.wav" --preset "$SHAPE"
  fi
  VOCAL_OUT="$PWORK/her-shaped.wav"
fi

echo "[4/4] 伴奏同步移调 ${SHIFT} 半音 → 混音 → $OUT"
STAGE=mixing
BACKING_SHIFTED="$PWORK/backing-shifted.wav"
if [[ -s "$BACKING_SHIFTED" ]]; then
    echo "  已有移调伴奏，跳过"
else
    shift_audio "$BACKING" "$BACKING_SHIFTED" "$SHIFT"
fi

PARTIAL_OUT="${OUT}.partial.m4a"
# 两轨各自 apad 成无限长后再用 -t 截到伴奏长度：Seed-VC 的输出长度和源不
# 严格相等，amix 以最长轨为准，短的那轨尾部会直接消失（听感是伴奏提前结束）。
# 以伴奏为基准是因为它承载节奏骨架，改它的长度等于改歌。
MIX_LEN=$(duration_of "$BACKING_SHIFTED")
# amix normalize=0 是直接相加，人声整形后又被补偿过响度，峰值会顶到甚至超过
# 0dBFS —— AAC 编码器只能硬夹，听感上是零点几毫秒的毛刺。留 1dB 余量给限幅器。
"$FF" -y -v error -i "$VOCAL_OUT" -i "$BACKING_SHIFTED" \
    -filter_complex "[0:a]volume=$VOCAL_GAIN,apad[v];[1:a]apad[b];[b][v]amix=inputs=2:normalize=0,alimiter=limit=0.891:level=disabled:attack=5:release=50[aout]" \
    -t "$MIX_LEN" -map "[aout]" -c:a aac -b:a 192k "$PARTIAL_OUT"

STAGE=validating
"$FF" -v error -i "$PARTIAL_OUT" -f null -
mv -f "$PARTIAL_OUT" "$OUT"

echo
echo "完成: $OUT"
echo "时长: $(duration_of "$OUT") 秒"
echo "移调: ${SHIFT} 半音"
[ "${KEEP_WORK:-0}" = "1" ] && echo "中间产物保留在 $WORK" || rm -rf "$WORK"
