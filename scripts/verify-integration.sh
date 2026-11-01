#!/bin/bash
# 桌宠最终版验收：6 条标准逐条实测，全部留日志。
#
#   用法: verify-integration.sh [CDP端口] [日志文件]
#   前提: app 以 --remote-debugging-port=<端口> 启动
#
# 注意：系统事件(osascript)在本机没有辅助功能权限，发不了 ⌥⌘1/⌥⌘2，
#       所以全局快捷键改用「读主进程注册表 + 走同一个 openStage() 入口」验证；
#       Esc 在渲染层绑定，用真实 KeyboardEvent 触发。
set -u
PORT="${1:-9223}"
LOG="${2:-docs/integration-evidence/verify.log}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "$(dirname "$LOG")"
: > "$LOG"

CDP="node scripts/cdp-eval.js $PORT"
say() { echo "$@" | tee -a "$LOG"; }
ev()  { $CDP eval "$1" 2>&1 | tee -a "$LOG"; }
pages(){ $CDP pages 2>&1 | tee -a "$LOG"; }
die() { say "❌ $1"; FAILED=$((FAILED+1)); }
ok()  { say "✅ $1"; PASSED=$((PASSED+1)); }

PASSED=0; FAILED=0

# 屏幕此刻是锁屏态，整屏截图只能拍到锁屏；改用 Electron 自己渲染一帧（render-preview.js）
shot() {
  env -u ELECTRON_RUN_AS_NODE /tmp/electron43/Electron.app/Contents/MacOS/Electron \
    scripts/render-preview.js "$1" "$2" "docs/integration-evidence/$3" "${4:-}" \
    >>"$LOG" 2>&1
}

say "================ 验收开始 $(date '+%Y-%m-%d %H:%M:%S') ================"
say ""
say "### 0) 环境基线"
# 没在跑就拉起来（脚本自包含，谁执行都一个样）
if ! pgrep -f "dist/DeepWhale.app/Contents/MacOS/DeepWhale" >/dev/null 2>&1; then
  say "app 未运行 → 启动中"
  env -u ELECTRON_RUN_AS_NODE ./dist/DeepWhale.app/Contents/MacOS/DeepWhale --remote-debugging-port=$PORT \
    > /tmp/deepwhale-run.log 2>&1 &
  sleep 8
fi
say "app 进程:"
pgrep -fl "DeepWhale.app/Contents/MacOS/DeepWhale" | tee -a "$LOG"
say "bundle id: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' dist/DeepWhale.app/Contents/Info.plist)"
say "TTS 健康: $(curl -s --noproxy '*' -m 5 http://127.0.0.1:8091/health)"
say "记忆文件: $(wc -l < "$HOME/.smartcompanion/memory.jsonl" 2>/dev/null || echo 0) 行"
say ""

# ─────────────────────────────────────────────────────────────
say "### ① 双击启动 → 只有壁纸，不抢焦点"
D=$(ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify(d))" | tr -d '\n')
say "$D" | head -c 400; say ""
ev "JSON.stringify({页面焦点:document.hasFocus(), 聊天框可见:document.querySelectorAll('#chat.on').length, 漫游:document.body.classList.contains('roam'), 角色图:document.getElementById('ch').src.split('/').pop(), 活立绘视频:window.Character.video})"
say "窗口列表（按 layer 排序，看她贴在多底层）："
osascript -l JavaScript scripts/window-list.js 2>/dev/null \
  | /usr/bin/python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception as e: print('读取失败',e); raise SystemExit
mine=[w for w in d if '深蓝' in w['owner'] or 'DeepWhale' in w['owner']]
print('屏幕窗口总数 %d' % len(d))
for w in sorted(d, key=lambda x: x['layer'])[:8]:
    mark=' <== 本 app' if w in mine else ''
    print('   %-26s layer=%-13s %dx%d%s' % (w['owner'][:24], w['layer'], w['w'], w['h'], mark))
" 2>&1 | tee -a "$LOG"
say ""
echo "$D" | grep -qE '"wall"[[:space:]]*:[[:space:]]*true'  && echo "$D" | grep -qE '"stage"[[:space:]]*:[[:space:]]*false' \
  && ok "① 壁纸窗在、交互窗未开（dormant）" || die "① 启动态不对"
ev "JSON.stringify({文档有焦点:document.hasFocus()})" | grep -qE '"文档有焦点"[[:space:]]*:[[:space:]]*false' \
  && ok "① 渲染层没有抢到键盘焦点" || die "① 抢了焦点"
shot world 0 01-dormant-wallpaper.png
say ""

# ─────────────────────────────────────────────────────────────
say "### ② ⌥⌘1 → 她的世界，有聊天输入框"
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify(d.shortcuts))"
ev "window.malfoyHost.enterWorld().then(()=>'ok')"
sleep 2.5
pages
ev "JSON.stringify({聊天框显示:getComputedStyle(document.getElementById('chat')).display, 输入框存在:!!document.querySelector('#chat input'), 发送按钮:!!document.getElementById('send'), 提示条:document.getElementById('hint').style.display, 活立绘:window.Character.video})"
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify({stageMode:d.stageMode, wall:d.wall, stage:d.stage, stageFocused:d.stageFocused}))"
ev "document.getElementById('chat').classList.contains('on')" | grep -q "true" \
  && ok "② 聊天输入框已挂载" || die "② 没有聊天输入框"
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify(d.stageMode))" | grep -qE '"world"' \
  && ok "② 主进程已切到 world 态" || die "② 主进程没切到 world"
shot world 1 02-world-chat.png
say ""

# ─────────────────────────────────────────────────────────────
say "### ③ ⌥⌘2 → Q版满屏，会爬上其他窗口边沿"
ev "window.malfoyHost.summon().then(()=>'ok')"
sleep 4
pages
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify({stageMode:d.stageMode, wall:d.wall, stage:d.stage, 可爬窗口数:d.windows}))"
ev "window.malfoyHost.windows().then(w=>JSON.stringify(w.map(x=>x.app+'@'+x.x+','+x.y+' '+x.w+'x'+x.h)))"
say "-- 每 1.2s 采样她的位置/状态/脚下窗口 --"
for i in $(seq 1 12); do
  ev "JSON.stringify({state:window.Character.pet.state, x:Math.round(window.Character.pet.x), y:Math.round(window.Character.pet.y), perch:window.Character.pet.perch, wins:window.Character.pet.wins})"
  sleep 1.2
done
SAMPLED=$(ev "JSON.stringify({state:window.Character.pet.state,x:Math.round(window.Character.pet.x),y:Math.round(window.Character.pet.y),perch:window.Character.pet.perch})")
say "$SAMPLED"
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify(d.stageMode))" | grep -qE '"desktop"' \
  && ok "③ 已切到 desktop 态（Q版满屏 + 透明窗）" || die "③ 没切到 desktop"
ev "document.body.classList.contains('roam')" | grep -q "true" \
  && ok "③ 渲染层进入漫游（爬窗）状态" || die "③ 没进漫游"
shot desktop 0 03-desktop-roam.png
say ""

# ─────────────────────────────────────────────────────────────
say "### ④ Esc → 回壁纸"
ev "(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 'esc-dispatched'})()"
sleep 2.5
pages
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify({stageMode:d.stageMode, wall:d.wall, stage:d.stage}))"
ev "JSON.stringify({聊天框可见:document.querySelectorAll('#chat.on').length, 漫游:document.body.classList.contains('roam')})"
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify(d.wall))" | grep -qE '^true$' \
  && ok "④ Esc 后回到壁纸（壁纸窗重建）" || die "④ Esc 没回到壁纸"
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify(d.stage))" | grep -qE '^false$' \
  && ok "④ 交互窗已关闭" || die "④ 交互窗还开着"
say ""

# ─────────────────────────────────────────────────────────────
say "### ⑤ 说一句话 → 有声音（Qwen3，不是 edge-tts）"
ev "window.malfoyHost.enterWorld().then(()=>'ok')"
sleep 2
say "-- 直接压 TTS 服务（证明 Qwen3 端点活着并能出波形）--"
T0=$(date +%s)
curl -s --noproxy '*' -m 90 -X POST -H "Content-Type: application/json" \
  -d '{"text":"我是深蓝，你听到我的声音了吗？","instruct":"A cool, elegant young female voice. Soft timbre with a slight sense of distance, calm and composed."}' \
  -o /tmp/verify-qwen.wav -w "http=%{http_code} bytes=%{size_download} t=%{time_total}s\n" \
  http://127.0.0.1:8091/tts 2>&1 | tee -a "$LOG"
T1=$(date +%s)
say "TTS 直连耗时: $((T1-T0))s"
say "音频文件头: $(head -c 4 /tmp/verify-qwen.wav | xxd -p 2>/dev/null) (52494646=RIFF/wav)"
/opt/homebrew/bin/ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,sample_rate -of default=nw=1 /tmp/verify-qwen.wav 2>&1 | tee -a "$LOG"
say ""
say "-- 走完整对话链路（LLM + TTS + 记忆落盘）--"
ev "(async()=>{const t0=Date.now();const r=await window.malfoyHost.chat('记住一件事：我家的蓝鲸住在冰箱里',[]);return JSON.stringify({耗时ms:Date.now()-t0, 她说:r.text, 模型来源:r.via, TTS引擎:r.tts, 音色:r.voiceProfile, 模式:r.mode, 音频base64长度:r.voice?r.voice.length:0})})()"
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify({lastTtsVia:d.lastTtsVia, 当前音色:d.ttsInstruct.slice(0,60)}))"
ev "window.malfoyHost.diagnostics().then(d=>JSON.stringify(d.lastTtsVia))" | grep -qE '"qwen3"' \
  && ok "⑤ 语音走的是 Qwen3-TTS（不是 edge-tts）" || die "⑤ TTS 走的不是 Qwen3"
shot world 1 05-world-speaking.png
say ""

# ─────────────────────────────────────────────────────────────
say "### ⑥ 重启 app 后记忆还在"
say "重启前记忆文件尾部:"
tail -n 2 "$HOME/.smartcompanion/memory.jsonl" 2>/dev/null | tee -a "$LOG"
MEM_BEFORE=$(wc -l < "$HOME/.smartcompanion/memory.jsonl" | tr -d ' ')
say "重启前记忆行数: $MEM_BEFORE"
say "-- 杀掉 app --"
pkill -f "dist/DeepWhale.app/Contents/MacOS/DeepWhale"
sleep 2.5
pgrep -fl "DeepWhale.app/Contents/MacOS/DeepWhale" | tee -a "$LOG" || say "（进程已退出）"
say "-- 重新启动 --"
env -u ELECTRON_RUN_AS_NODE ./dist/DeepWhale.app/Contents/MacOS/DeepWhale --remote-debugging-port=$PORT \
  > /tmp/deepwhale-run.log 2>&1 &
sleep 8
pages
MEM_AFTER=$(wc -l < "$HOME/.smartcompanion/memory.jsonl" | tr -d ' ')
say "重启后记忆行数: $MEM_AFTER"
[ "$MEM_AFTER" -ge "$MEM_BEFORE" ] && ok "⑥ 记忆文件在重启后仍然存在（${MEM_BEFORE} → ${MEM_AFTER} 行）" || die "⑥ 记忆丢了"
say "-- 重启后问她记不记得（必须靠 memory.jsonl 回答）--"
ev "window.malfoyHost.enterWorld().then(()=>'ok')"
sleep 2
ev "(async()=>{const r=await window.malfoyHost.chat('我家的蓝鲸住在哪儿？',[]);return JSON.stringify({她答:r.text, 模型:r.via, TTS:r.tts})})()" | tee -a "$LOG"
ANSWER=$(ev "(async()=>{const r=await window.malfoyHost.chat('我家的蓝鲸住在哪儿？',[]);return r.text})()")
say "$ANSWER"
echo "$ANSWER" | grep -q "冰箱" \
  && ok "⑥ 重启后她还记得「蓝鲸住在冰箱里」" || die "⑥ 重启后没想起来"
say ""

say "================ 验收结束 $(date '+%Y-%m-%d %H:%M:%S') ================"
say "通过 $PASSED 项，失败 $FAILED 项"
say "日志: $LOG"
exit $((FAILED > 0))
