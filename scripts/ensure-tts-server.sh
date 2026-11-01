#!/bin/bash
# TTS 服务保活（幂等：已在跑就什么都不做）。
#
# 为什么需要它：Qwen3-TTS 是 App 依赖的外部服务，但 App 不负责启动它。
# 之前它靠手动 nohup 拉起，会话/终端一退进程就被回收，静默消失后
# 所有语音降级到 edge-tts，翻唱则直接报「Qwen 女主参考音色暂时不可用」。
#
# 本机 launchd 拒绝新 LaunchAgents（`Bootstrap failed: 5: Input/output error`，
# 重跑与沙箱外都一样），所以走「App 启动时 + 合成失败时各调一次」这条路。
#
# daemonize 用双重 fork + setsid：普通 `nohup … &` 会被工具的进程组回收杀掉，
# 实测同一次会话里起的服务下一回合就没了。
set -u

SERVER="${TTS_SERVER:-$HOME/.smartcompanion/tts_server.py}"
PY="${TTS_PYTHON:-$HOME/.smartcompanion/venv/bin/python3}"
LOG_DIR="${TTS_LOG_DIR:-$HOME/.smartcompanion/logs}"
LOG="$LOG_DIR/tts.log"
PORT="${TTS_PORT:-8091}"

# 脚本或环境不在（比如换到没有本地模型的机器）——不是错误，静默退出，
# 让调用方继续用 edge/say 兜底。
[ -f "$SERVER" ] && [ -x "$PY" ] || exit 0

# 已经在监听就什么都不做。用 nc 而不是 lsof：nc 更轻，且不依赖进程可见性。
if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then exit 0; fi

# 防止并发调用起出两个实例：mkdir 是原子的，抢到锁才启动。
LOCK="${TMPDIR:-/tmp}/dw-tts-spawn.lock"
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

mkdir -p "$LOG_DIR" 2>/dev/null || true
echo "[tts-keepalive] $(date '+%F %T') 8091 未监听，拉起服务" >> "$LOG" 2>/dev/null || true

"$PY" - "$SERVER" "$LOG" <<'PYEOF'
import os, sys
server, log = sys.argv[1], sys.argv[2]
python = os.environ.get("TTS_PYTHON") or sys.executable

if os.fork() > 0:
    sys.exit(0)                      # 父进程立刻返回，调用方不阻塞
os.setsid()                          # 脱离调用方的会话与进程组
if os.fork() > 0:
    os._exit(0)                      # 二级子进程当真正的守护进程

os.chdir("/tmp")
fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(fd, 1); os.dup2(fd, 2)
devnull = os.open("/dev/null", os.O_RDONLY); os.dup2(devnull, 0)
os.execv(python, [python, "-u", server])
PYEOF
