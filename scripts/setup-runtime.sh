#!/bin/bash
# 把桌宠的运行时一次性收进项目里：Python 环境 + Qwen3 语音权重。
#
# 背景：这个项目原来借两样外面的东西——隔壁 `LiveTalking/.venv` 的解释器，
# 和 `~/.cache/pet-tts` 里的 Qwen3 权重。于是「拷到新机器就能跑」是假的：
# 声音照样出，但会静默掉到 edgetts，音色从 Vivian 变成微软播音腔。
# 这个脚本把两者都搬进 `.runtime/`，之后 `desktop-companion/` 就是自包含的。
#
# 用法：
#   bash scripts/setup-runtime.sh            # 缺什么补什么，已有的跳过
#   bash scripts/setup-runtime.sh --check    # 只报告缺什么，不动手
#
# 幂等：重复跑不会重装、不会重下。
set -uo pipefail
cd "$(dirname "$0")/.."

RUNTIME="$PWD/.runtime"
VENV="$RUNTIME/venv-tts"
MODELS="$RUNTIME/models"
QWEN3="$MODELS/qwen3-tts"
FP16="$MODELS/qwen3-tts-fp16-source"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

fail() { printf '  FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '        ↳ %s\n' "$2"; exit 1; }
ok()   { printf '  ok    %s' "$1"; [ -n "${2:-}" ] && printf ' — %s' "$2"; printf '\n'; }
todo() { printf '  待办  %s' "$1"; [ -n "${2:-}" ] && printf ' — %s' "$2"; printf '\n'; }

echo "[1/4] Python 解释器"
if [ -x "$VENV/bin/python" ]; then
    ok "venv" "$("$VENV/bin/python" -V 2>&1)"
else
    todo "venv" "需要 python3.12 建venv"
    [ "$CHECK_ONLY" = 1 ] || {
        # mlx 对 Python 版本敏感，必须和已验证的 3.12 对齐，不能随手用 3.13。
        PY="${PYTHON312:-$(command -v python3.12 || echo /Users/exasdwyh/.local/bin/python3.12)}"
        [ -x "$PY" ] || fail "找不到 python3.12" "装一个，或用 PYTHON312=/path/to/python3.12 指定"
        mkdir -p "$RUNTIME"
        "$PY" -m venv "$VENV" || fail "建 venv 失败"
        "$VENV/bin/python" -m pip install -q --upgrade pip
        ok "venv" "$("$VENV/bin/python" -V 2>&1)"
    }
fi

echo "[2/4] 依赖包"
if [ "$CHECK_ONLY" = 1 ]; then
    [ -x "$VENV/bin/python" ] && "$VENV/bin/python" - <<'PY'
import importlib.util
missing = [m for m in ("mlx_audio", "edge_tts", "soundfile", "numpy")
           if importlib.util.find_spec(m) is None]
print("  待办  依赖 — 缺 " + " ".join(missing) if missing else "  ok    依赖 已齐")
PY
else
    [ -x "$VENV/bin/python" ] || fail "venv 未就绪" "去掉 --check 重跑"
    # 版本对齐本机验证过的那套（mlx 0.32.4 / mlx-audio 0.6.2）。
    if "$VENV/bin/python" -m pip install -q \
        "mlx-audio==0.6.2" "edge-tts==7.3.1" "soundfile==0.12.1" "numpy==2.5.4"; then
        ok "依赖" "mlx-audio / edge-tts / soundfile / numpy"
    else
        fail "依赖安装失败" "看 pip 输出；这一步要联网"
    fi
fi

echo "[3/4] Qwen3 语音权重"
if [ -f "$QWEN3/model.safetensors" ]; then
    ok "权重" "$(du -sh "$QWEN3" | cut -f1)"
else
    todo "权重" "要从 ModelScope 下 4.5 GB 再转 8bit（这台机器 HuggingFace 不通）"
    if [ "$CHECK_ONLY" = 0 ]; then
        mkdir -p "$MODELS"
        if [ ! -f "$FP16/model.safetensors" ]; then
            echo "        下载 bf16 权重（约 4.5 GB，可断点续传）…"
            python3 scripts/fetch_qwen_tts.py --out "$FP16" || fail "下载失败" "网络问题；重跑本脚本会续传"
        fi
        [ -x "$VENV/bin/python" ] || fail "venv 未就绪" "先装依赖再转权重"
        echo "        转 8bit MLX（约 2.4 GB）…"
        "$VENV/bin/python" -m mlx_audio.convert \
            --hf-path "$FP16" --mlx-path "$QWEN3" -q --q-bits 8 --model-domain tts \
            || fail "转换失败"
        ok "权重" "$(du -sh "$QWEN3" | cut -f1)"
    fi
fi

echo "[4/4] ffmpeg"
# 没有它就只能跳过响度归一化（-20 LUFS 那层），声音会明显偏响。
if command -v ffmpeg >/dev/null 2>&1; then
    ok "ffmpeg" "$(command -v ffmpeg)"
elif [ -x /Users/exasdwyh/bin/ffmpeg ]; then
    ok "ffmpeg" "/Users/exasdwyh/bin/ffmpeg（不在 PATH，worker 会自己找这个位置）"
else
    todo "ffmpeg" "缺了音量归一化会跳过，声音偏响。brew install ffmpeg"
fi

echo
if [ "$CHECK_ONLY" = 1 ]; then
    echo "只检查，没动任何东西。去掉 --check 开始补齐。"
else
    echo "运行时已收在 $RUNTIME"
    echo "验一遍：bash scripts/check-whale-voice.sh"
fi
