#!/bin/bash
# 准备本地聊天模型（Ollama），并把桌宠设置里的模型名对齐到本机实际可用的那个。
#
# 桌宠只读 http://127.0.0.1:11434/v1，模型名写在 settings.json 的 model 字段。
# 名字对不上会直接报「本地服务返回 HTTP 404」，所以这个脚本负责拉模型 + 改名字。
#
# 默认用 deepseek-r1:7b，因为本机 ~/.ollama 里已经有它的 4.36GB 权重，不必再下载。
# 它是推理模型，理论上会先想后答；实测在本机走 /v1 接口时输出里不含 <think>，
# 且 Swift 侧本来就会剥离 <think> 块，所以可以直接用。
# 想要更干脆的对话模型（网络好时）：MODEL=qwen2.5:7b-instruct bash scripts/setup_llm.sh
set -euo pipefail

SETTINGS="$HOME/Library/Application Support/LingDesk/settings.json"
MODEL="${MODEL:-deepseek-r1:7b}"
GUI_APP=/Applications/Ollama.app
CLI="$GUI_APP/Contents/Resources/ollama"

# Ollama.app 里有两个可执行文件：MacOS/Ollama 是 GUI 主程序，不接受 serve/run；
# 真正的 CLI 在 Resources/ollama。别搞混。
if [[ ! -x "$CLI" ]]; then
  for c in /opt/homebrew/bin/ollama /usr/local/bin/ollama; do
    [[ -x "$c" ]] && { CLI="$c"; break; }
  done
fi
if [[ ! -x "$CLI" ]]; then
  echo "找不到 ollama。装法：从 https://ollama.com/download/Ollama-darwin.zip 下，"
  echo "解压后把 Ollama.app 拖进 /Applications。" >&2
  exit 1
fi

alive() { curl -s --max-time 3 --noproxy '*' http://127.0.0.1:11434/api/tags >/dev/null 2>&1; }

if ! alive; then
  echo "启动 Ollama 服务..."
  # 用 GUI 启动而不是裸跑 serve：Ollama.app 自带常驻机制，
  # 裸跑的 serve 进程会在终端会话结束时被回收。
  open "$GUI_APP" 2>/dev/null || nohup "$CLI" serve >/tmp/ollama-serve.log 2>&1 &
  for _ in $(seq 1 30); do alive && break; sleep 1; done
fi
if ! alive; then
  echo "Ollama 没起来，看日志：tail -50 /tmp/ollama-serve.log" >&2
  exit 1
fi

echo "本机已有模型："
curl -s --noproxy '*' http://127.0.0.1:11434/api/tags \
  | python3 -c 'import sys,json;[print("  -",m["name"]) for m in json.load(sys.stdin).get("models",[])]'

if ! curl -s --noproxy '*' http://127.0.0.1:11434/api/tags \
     | python3 -c "import sys,json;sys.exit(0 if any(m['name'].startswith('$MODEL') for m in json.load(sys.stdin).get('models',[])) else 1)"; then
  echo "拉取 $MODEL（首次较慢）..."
  "$CLI" pull "$MODEL"
fi

python3 - "$SETTINGS" "$MODEL" <<'PY'
import json, os, sys
path, model = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(path), exist_ok=True)
s = {}
if os.path.exists(path):
    try:
        s = json.load(open(path, encoding="utf-8"))
    except json.JSONDecodeError:
        sys.exit("settings.json 无法解析，保留原文件并停止更新。")
if not isinstance(s, dict):
    sys.exit("settings.json 必须为 JSON 对象，保留原文件并停止更新。")
s["model"] = model
s.setdefault("baseURL", "http://127.0.0.1:11434/v1")
s.setdefault("useEngine", True)
s.setdefault("engineBaseURL", "http://127.0.0.1:8010")
with open(path + ".pending", "w", encoding="utf-8") as f:
    json.dump(s, f, ensure_ascii=False, indent=2)
os.chmod(path + ".pending", 0o600)
os.replace(path + ".pending", path)
print("settings.json model =", model)
PY

echo
echo "试一句："
curl -s --noproxy '*' --max-time 120 http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"用一句话打个招呼\"}],\"max_tokens\":256}" \
  | python3 -c 'import sys,json,re;c=json.load(sys.stdin)["choices"][0]["message"]["content"];print(" ",re.sub(r"(?s)<think>.*?</think>","",c).strip())'
