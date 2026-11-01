#!/bin/bash
# 启动本地口型引擎（LiveTalking / MuseTalk），桌宠通过它生成说话片段。
#
# 注意两个必须显式指定的参数，缺一个就会失败：
#   --avatar_id desk_muse_1  必须和桌宠素材包里的脸是同一个，否则待机和说话会变成两个人
#   --tts saytts             使用 macOS 系统语音，不依赖联网语音服务
set -euo pipefail

# 被 GUI 应用（桌宠）拉起时环境很受限：PATH 里没有 /usr/sbin，lsof 不仅找不到，
# 在某些情况下还会直接挂住——脚本卡在第一行，既不起引擎也不报错，最难排查。
# 所以端口探测一律用 bash 内置的 /dev/tcp，不碰任何外部命令。
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

HERE="$(cd "$(dirname "$0")" && pwd)"
LT="$(cd "$HERE/../../LiveTalking" && pwd)"

AVATAR_ID="${AVATAR_ID:-desk_muse_1}"
PORT="${PORT:-8010}"
TTS="${TTS:-saytts}"
case "$TTS" in
  saytts) DEFAULT_VOICE=Tingting ;;
  edgetts) DEFAULT_VOICE=zh-CN-XiaoxiaoNeural ;;
  kokorotts) DEFAULT_VOICE=zf_xiaobei ;;
  *) echo "不支持的 TTS: $TTS" >&2; exit 1 ;;
esac
VOICE="${VOICE:-$DEFAULT_VOICE}"

if [[ ! -x "$LT/.venv/bin/python" ]]; then
  echo "找不到 $LT/.venv，请先按 LiveTalking/_mac_port/README-MAC.md 建环境" >&2
  exit 1
fi

# 端口被占时不能直接复用：占着的可能是别的形象、甚至 tts 配置是错的引擎，
# 桌宠连上去会静默用错形象还查不出原因。所以先比对配置，不一致就报错让人处理。
if port_busy "$PORT"; then
  CFG=$(curl -s --max-time 3 --noproxy '*' "http://127.0.0.1:$PORT/api/admin/config" 2>/dev/null || true)
  CUR=$(printf '%s' "$CFG" | "$LT/.venv/bin/python" -c '
import sys,json
try:
    c=json.load(sys.stdin)["data"]["config"]
    print("%s %s %s" % (c.get("model","?"), c.get("avatar_id","?"), c.get("tts","?")))
except Exception:
    print("? ? ?")
' 2>/dev/null)
  read -r CUR_MODEL CUR_AVATAR CUR_TTS <<<"$CUR"
  if [[ "$CUR_MODEL" == "musetalk" && "$CUR_AVATAR" == "$AVATAR_ID" && "$CUR_TTS" == "$TTS" ]]; then
    echo "端口 $PORT 上已有配置正确的引擎在运行（musetalk / $AVATAR_ID / $TTS）。"
    exit 0
  fi
  echo "端口 $PORT 上已经有一个引擎，但配置不是我们要的：" >&2
  echo "  当前: model=$CUR_MODEL avatar=$CUR_AVATAR tts=$CUR_TTS" >&2
  echo "  期望: model=musetalk avatar=$AVATAR_ID tts=$TTS" >&2
  echo "先停掉它再重跑本脚本（用活动监视器或 lsof -ti tcp:$PORT | xargs kill）：" >&2
  exit 1
fi

echo "启动引擎：avatar=$AVATAR_ID port=$PORT tts=$TTS voice=$VOICE"
cd "$LT"
exec "$LT/.venv/bin/python" app.py \
  --transport webrtc \
  --model musetalk \
  --avatar_id "$AVATAR_ID" \
  --tts "$TTS" \
  --REF_FILE "$VOICE" \
  --listenport "$PORT"
