#!/bin/bash
# 鲸鱼娘桌宠「澜」的运行依赖检查。只读：不下载模型、不改设置、不读个人数据。
#
# 与 scripts/doctor.py 的分工：doctor.py 看的是 LiveTalking / 实时口型那条线
# （aiohttp / torch / wav2lip 等），本脚本看的是当前 PetDesk 鲸鱼路线真正要用的东西：
# 工具链、素材清单、构建产物完整性、Kokoro 语音与本地聊天端点。
#
# 用法：
#   bash scripts/check-whale-deps.sh
#
# 退出码：有 FAIL 为 1，只有 WARN 为 0。
set -uo pipefail
cd "$(dirname "$0")/.."

ASSETS="${PET_ASSETS:-assets/whale-video-test}"
APP="dist/${PET_APP_NAME:-WhaleVideoCompanion}.app"
RUNTIME="$PWD/.runtime"
VENV_PY="$RUNTIME/venv-tts/bin/python"
# 收口之前借的是隔壁 LiveTalking 的环境。留作回退：没跑过 setup-runtime.sh 的老机器
# 仍然是这个路径在出声，检查不该因此报红。
LEGACY_PY="$(cd .. && pwd)/LiveTalking/.venv/bin/python"
[ -x "$VENV_PY" ] || VENV_PY="$LEGACY_PY"
TTS_PY="${LINGDESK_TTS_PYTHON:-$VENV_PY}"
HF_DIR="${HF_HOME:-$HOME/.cache/huggingface}"
KOKORO="$HF_DIR/hub/models--mlx-community--Kokoro-82M-4bit"
# 权重跟着项目走：.runtime/models/qwen3-tts。这是 auto 链的第一层，也是唯一能
# 「演情绪」的引擎——它不在就自动掉到 edgetts，音色从 Vivian 变成微软播音腔，但不会报错。
QWEN3="${PET_TTS_MODEL:-$RUNTIME/models/qwen3-tts}"

FAILED=0
WARNED=0

# 中文标签按显示宽度算两个字符，printf 的 %-Ns 按字符数算，
# 硬对齐必然参差。改成「状态 + 标签 + 说明」，不靠列宽对齐。
say() { printf '  %-4s  %s' "$1" "$2"; [ -n "${3:-}" ] && printf ' — %s' "$3"; printf '\n'; }
pass() { say PASS "$1" "${2:-}"; }
warn() { say WARN "$1" "${2:-}"; WARNED=$((WARNED + 1)); [ -n "${3:-}" ] && printf '          ↳ %s\n' "$3"; return 0; }
fail() { say FAIL "$1" "${2:-}"; FAILED=$((FAILED + 1)); [ -n "${3:-}" ] && printf '          ↳ %s\n' "$3"; return 0; }

echo "鲸鱼娘运行依赖检查 — $(date '+%F %T')"
echo "素材: $ASSETS / 应用: $APP"
echo

# --- 构建工具链（必需）---
echo "[构建]"
if command -v swift >/dev/null 2>&1; then
    pass "swift" "$(swift --version 2>/dev/null | head -1 | cut -c1-60)"
else
    fail "swift" "找不到 swift 命令" "装 Xcode Command Line Tools：xcode-select --install"
fi

if [ -d "$ASSETS" ]; then
    pass "素材目录" "$ASSETS"
else
    fail "素材目录" "$ASSETS 不存在" "素材真源被移动了；检查 assets/ 与 build-whale-video.sh 的 PET_ASSETS"
fi

# --- 素材清单（必需）---
# 复用打包用的同一个推导器，保证「打的进去」和「检查通过」是同一份口径。
echo
echo "[素材清单]"
if [ -d "$ASSETS" ]; then
    if MAP=$(python3 scripts/pack-assets.py "$ASSETS" 2>&1); then
        COUNT=$(printf '%s\n' "$MAP" | grep -c . || true)
        pass "pack-assets.py" "${COUNT} 个文件，引用齐全"
        MANIFEST="$MAP"
    else
        fail "pack-assets.py" "清单推导失败" "$(printf '%s' "$MAP" | head -3)"
        MANIFEST=""
    fi
else
    MANIFEST=""
fi

# --- 构建产物（存在才校验，没构建只是提醒）---
echo
echo "[构建产物]"
if [ -d "$APP" ]; then
    pass "应用已构建" "$APP ($(du -sh "$APP" | cut -f1))"
    RES="$APP/Contents/Resources/PetAssets"
    if [ -d "$RES" ]; then
        if [ -n "${MANIFEST:-}" ]; then
            MISSING=""
            while read -r file; do
                [ -n "$file" ] || continue
                [ -f "$RES/$file" ] || MISSING="$MISSING $file"
            done <<<"$MANIFEST"
            if [ -z "$MISSING" ]; then
                pass "包内素材与清单一致" "无缺失"
            else
                fail "包内素材缺失" "$MISSING" "重跑 bash scripts/build-whale-video.sh"
            fi
            EXTRA=$(cd "$RES" && ls -A | grep -v -x -F -f <(printf '%s\n' "$MANIFEST") | tr '\n' ' ')
            if [ -n "$EXTRA" ]; then
                # 多余文件不致命，但说明白名单没生效或有人手改了包内素材
                warn "包内有多余文件" "$EXTRA" "通常是白名单未生效；不要直接改 dist/ 里的素材"
            fi
        fi
        # 签名：ad-hoc 签名掉了，首次启动会被 Gatekeeper 拦
        if codesign --verify --strict "$APP" >/dev/null 2>&1; then
            pass "签名有效" "ad-hoc"
        else
            warn "签名无效" "codesign 校验失败" "重跑构建脚本会重新签名"
        fi
    else
        fail "包内缺少 PetAssets" "$RES" "重跑 bash scripts/build-whale-video.sh"
    fi
else
    warn "尚未构建" "$APP 不存在" "bash scripts/build-whale-video.sh"
fi

# --- 语音（可降级：失败会回退系统语音，不是致命）---
echo
echo "[语音引擎]"
if [ -x "$TTS_PY" ]; then
    pass "TTS 解释器" "$TTS_PY"
    if MODS=$("$TTS_PY" -c "import importlib.util,json;print(json.dumps({n:importlib.util.find_spec(n) is not None for n in ['numpy','soundfile','mlx_audio']}))" 2>/dev/null); then
        BAD=$(printf '%s' "$MODS" | python3 -c "import json,sys;d=json.load(sys.stdin);print(' '.join(k for k,v in d.items() if not v))")
        if [ -z "$BAD" ]; then
            pass "TTS 模块" "numpy / soundfile / mlx_audio"
        else
            warn "TTS 模块缺失" "$BAD" "在该 venv 里重装 mlx-audio；期间语音回退系统语音"
        fi
    else
        warn "TTS 模块检查失败" "解释器无法执行导入探测"
    fi
else
    warn "TTS 解释器不可用" "$TTS_PY" "语音会回退系统语音。设 LINGDESK_TTS_PYTHON 指向可用解释器"
fi

# 权重只查「在不在」和「主文件够不够大」。加载一次 2.4 GB 要十几秒，
# 依赖检查不该干这个 —— 真调用哪一层，交给 check-whale-voice.sh 实测。
QWEN_WEIGHT="$QWEN3/model.safetensors"
if [ -f "$QWEN_WEIGHT" ]; then
    QWEN_SIZE=$(stat -f%z "$QWEN_WEIGHT" 2>/dev/null || echo 0)
    if [ "$QWEN_SIZE" -gt 1000000000 ]; then
        pass "Qwen3 权重" "$(echo "$QWEN_SIZE" | awk '{printf "%.1f GB", $1/1e9}')"
    else
        warn "Qwen3 权重不完整" "$QWEN_WEIGHT" "只有 $(echo "$QWEN_SIZE" | awk '{printf "%.0f MB", $1/1e6}')，下载中断了。重跑 scripts/fetch_qwen_tts.py；现在语音会掉到 edgetts"
    fi
else
    warn "Qwen3 权重缺失" "$QWEN3" "首选引擎不可用，音色会从 Vivian 变成 edgetts 的微软播音腔。见 PET-DESK.md「换成 Qwen3 音色」"
fi

if [ -d "$KOKORO" ]; then
    pass "Kokoro 模型缓存" "$KOKORO"
else
    warn "Kokoro 模型缓存缺失" "$KOKORO" "worker 强制离线，不会自动下载；语音会回退系统语音"
fi

# --- 可选工具 ---
echo
echo "[可选]"
for tool in ffmpeg ffprobe; do
    if command -v "$tool" >/dev/null 2>&1; then
        pass "$tool" "$(command -v "$tool")"
    else
        warn "$tool" "未安装" "只影响素材重建，已打包的 app 不需要它"
    fi
done

# 本地地址必须绕过系统代理，否则开着梯子会误判成服务挂了
if CODE=$(curl -s -m 3 --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:11434/v1/models 2>/dev/null) && [ "$CODE" = "200" ]; then
    pass "本地聊天端点" "127.0.0.1:11434 可用"
else
    warn "本地聊天端点" "127.0.0.1:11434 不可达" "聊天会失败；改设置里的服务地址，或先启动 Ollama"
fi

echo
if [ "$FAILED" -gt 0 ]; then
    echo "结果：$FAILED 项 FAIL，$WARNED 项 WARN —— 必需项不过，先修 FAIL 再谈运行。"
    exit 1
fi
echo "结果：0 项 FAIL，$WARNED 项 WARN —— 必需依赖齐全（WARN 可降级运行）。"
