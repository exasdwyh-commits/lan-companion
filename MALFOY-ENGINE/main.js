// 深蓝 · macOS 动态桌面（引擎目录沿用 MALFOY-ENGINE，角色身份已是「深蓝」）
// 壁纸窗口：type "desktop"，位于桌面图标之下，只负责播放；
// 真人世界默认 640×360 小窗；Q 版使用透明桌面层；聊天是独立悬浮窗口。
const { app, BrowserWindow, Tray, Menu, screen, nativeImage, ipcMain, dialog, protocol, net } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const fs = require("fs");
const { execFile, spawn } = require("child_process");
const { resolveDataDir, userDataDirFor } = require("./lib/data-dir");
const { createStore } = require("./lib/memory-store");
const { createSession } = require("./lib/session-store");
const IDENTITY = require("./lib/identity");
const { createVoiceScript } = require("./lib/voice-script");
const { createReplySplitter } = require("./lib/reply-splitter");
const { streamOnce } = require("./lib/llm-stream");
const { toSpeech } = require("./lib/narration");
const WINDOW_POLICY = require("./lib/window-policy");
const { config, MODEL_POOL, findFfmpeg } = require("./lib/config");
const { createContentPages } = require("./lib/content-pages");

// 小屋（moli-room）要 fetch 取 GLB 和逐顶点 .bin，`file://` 下这些请求会被 CORS 直接拒掉 ——
// 表现是「房间画出来了，澜不在里面」。所以给 web/ 单开一个协议。
// 这一步必须在 app ready 之前做，之后 protocol.handle 才拿得到权限。
const LANROOM_SCHEME = "lanroom";
try {
  protocol.registerSchemesAsPrivileged([{
    scheme: LANROOM_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  }]);
} catch (_) {}

// 探针跑在没有 GPU 的沙箱/CI 里，Chromium 会因 GPU 子进程起不来直接 FATAL 退出，
// 耗时长的探针（真实聊天）就会在中途被干掉。只对探针关硬件加速，正常启动不受影响。
if (process.env.LAN_PROBE2 || process.env.LAN_PROBE) {
  try {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("no-sandbox");
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("in-process-gpu");
  } catch (e) {}
}

// ── 数据目录 ──────────────────────────────────────────────────────
// 显式传（--data-dir / LAN_DATA_DIR）才隔离，否则沿用 ~/.smartcompanion。
// 所有用户数据都必须经过 DATA.dir，别再出现第二个 home 拼接。
const DATA = resolveDataDir({ argv: process.argv.slice(1) });
if (DATA.warning) console.warn("[data] " + DATA.warning);
if (DATA.explicit) {
  // Chromium 自己的 localStorage/IndexedDB/缓存也搬走：只改记忆路径不够，
  // 渲染进程那边仍会写 ~/Library/Application Support 下的真实配置。
  try { app.setPath("userData", userDataDirFor(DATA.dir)); } catch (e) {}
}
const STORE = createStore(DATA.dir);
// 会话也归主进程：换形态要重建窗口，history 留在渲染层就丢了。
const SESSION = createSession(path.join(DATA.dir, "session.json"));

// 读写探针：真往解析出来的目录写一条、再另起进程读回来。
// 只断言路径解析不够 —— 「隔离」的实质是写入落到临时目录且重启能读回。
// 输出只含「是否匹配」，不回显记忆原文：对着真实目录误跑时不能把用户的话打到终端。
if (process.env.LAN_PROBE) {
  const mode = process.env.LAN_PROBE;
  const marker = process.env.LAN_PROBE_TEXT || "隔离探针";
  if (mode === "write") {
    STORE.remember(marker, "probe");
  }
  const last = STORE.recall(1)[0] || null;
  console.log(JSON.stringify({
    probe: mode, dataDir: DATA.dir, count: STORE.count(),
    matches: !!(last && last.u === marker),
  }));
  app.exit(0);
}

// 用环境变量触发而不是命令行参数——Chromium 的开关解析会把不认识的 --xxx 当
// bad option 直接拒掉（实测：DeepWhale --data-dir /tmp/x 报 "bad option"）。
const PROBE = process.env.LAN_PRINT_DATA_DIR === "1" || process.argv.includes("--print-data-dir");
if (PROBE) {
  console.log(JSON.stringify({
    dataDir: DATA.dir,
    source: DATA.source,
    explicit: DATA.explicit,
    isDefault: DATA.isDefault,
    userData: DATA.explicit ? userDataDirFor(DATA.dir) : null,
    memoryFile: STORE.memoryFile,
  }));
  app.exit(0);
}

// ── 语音输入：麦克风 → faster-whisper :8090 转写 ───────────────────
const STT_URL = config.sttUrl;
const VOICE_MAX_BYTES = 12 * 1024 * 1024;

// 转写只有一条实现：不管音频来自主进程录音还是渲染进程采集，都走这里。
function postStt(filePath) {
  return new Promise((resolve) => {
    const args = ["-sS", "-m", "25", "--noproxy", "*", "-X", "POST",
      "--data-binary", "@" + filePath, "-H", "Content-Type: application/octet-stream", STT_URL];
    execFile("curl", args, { maxBuffer: 2 * 1024 * 1024, timeout: 30000 }, (err, out) => {
      if (err) return resolve({ ok: false, text: "", err: "STT 服务没响应" });
      try {
        const j = JSON.parse(String(out));
        const text = (j.text || "").trim();
        resolve(text ? { ok: true, text, ms: j.ms } : { ok: false, text: "", err: "没听清" });
      } catch (e) { resolve({ ok: false, text: "", err: "STT 返回异常" }); }
    });
  });
}

// 渲染进程用 MediaRecorder 交上来的是 webm/ogg。服务端本来就先过一遍 ffmpeg
// 解成 16k 单声道，所以这里不需要转码，只要给临时文件一个对得上的后缀。
function transcribeAudioBuffer(buffer, mime) {
  const os = require("os");
  const type = String(mime || "");
  const suffix = /mpeg|mp4|m4a|aac/.test(type) ? ".m4a"
    : /\bogg\b/.test(type) ? ".ogg"
    : /wav/.test(type) ? ".wav" : ".webm";
  const file = path.join(os.tmpdir(), "pet-voice-" + Date.now() + suffix);
  try { fs.writeFileSync(file, buffer); } catch (e) {
    return Promise.resolve({ ok: false, text: "", err: "写临时文件失败" });
  }
  return postStt(file).finally(() => { try { fs.unlinkSync(file); } catch (e) {} });
}

function recordAndTranscribe(seconds) {
  seconds = Math.max(1, Math.min(10, Number(seconds) || 4));
  return new Promise((resolve) => {
    const os = require("os");
    const wav = path.join(os.tmpdir(), "pet-mic-" + Date.now() + ".wav");
    const rec = spawn(findFfmpeg(), [
      "-y", "-f", "avfoundation", "-i", ":0",
      "-t", String(seconds || 4), "-ar", "16000", "-ac", "1", wav,
    ], { stdio: ["ignore", "ignore", "ignore"] });
    const killTimer = setTimeout(() => { try { rec.kill("SIGKILL"); } catch (e) {} }, ((seconds || 4) + 8) * 1000);
    rec.on("error", () => { clearTimeout(killTimer); resolve({ ok: false, text: "", err: "ffmpeg 启动失败" }); });
    rec.on("close", () => {
      clearTimeout(killTimer);
      try {
        if (!fs.existsSync(wav) || fs.statSync(wav).size < 2000) {
          return resolve({ ok: false, text: "", err: "没录到声音（检查麦克风权限）" });
        }
        postStt(wav).then((result) => {
          try { fs.unlinkSync(wav); } catch (x) {}
          resolve(result);
        });
      } catch (e) { resolve({ ok: false, text: "", err: String(e).slice(0, 80) }); }
    });
  });
}

// ── 屏幕视觉：截图 → 多模态模型看懂屏幕 ────────────────────────────
function captureScreen() {
  return new Promise((resolve) => {
    const os = require("os");
    const png = path.join(os.tmpdir(), "pet-screen-" + Date.now() + ".png");
    execFile("screencapture", ["-x", "-t", "png", png], { timeout: 15000 }, (err) => {
      try {
        if (err || !fs.existsSync(png) || fs.statSync(png).size < 5000) {
          return resolve({ ok: false, err: "截不了屏（检查屏幕录制权限）" });
        }
        // 缩到 1280 宽，省 token
        const small = png.replace(".png", "-s.jpg");
        execFile("ffmpeg", ["-y", "-i", png, "-vf", "scale=1280:-1", "-q:v", "4", small], { timeout: 20000 }, () => {
          const src = fs.existsSync(small) ? small : png;
          try {
            const b64 = fs.readFileSync(src).toString("base64");
            try { fs.unlinkSync(png); } catch (e) {}
            try { fs.unlinkSync(small); } catch (e) {}
            resolve({ ok: true, b64 });
          } catch (e) { resolve({ ok: false, err: "读图失败" }); }
        });
      } catch (e) { resolve({ ok: false, err: String(e).slice(0, 80) }); }
    });
  });
}

async function lookAtScreen(question) {
  const shot = await captureScreen();
  if (!shot.ok) return { ok: false, text: shot.err };
  const msgs = [
    { role: "system", content: "你是一个桌面宠物，能看到用户的屏幕。用第一人称、简短（40字内）、带角色感地描述或回答，不要念出网址和代码。" },
    { role: "user", content: [
      { type: "text", text: question || "看看我屏幕上在干什么，一句话点评" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64," + shot.b64 } },
    ] },
  ];
  const body = JSON.stringify({ model: MODEL_POOL[0].id, messages: msgs, max_tokens: 800, temperature: 0.85 });
  const r = await llmOnce(MAGPIE_URL, "magpie", body, null, 40);
  if (!r.ok) return { ok: false, text: "（看不清屏幕）" };
  const { text, emo } = parseEmotion(r.text);
  // 看屏幕也是聊天路径：她看到的东西要进记忆，否则「你还记得我昨天在写什么吗」永远答不上来。
  const userMsg = question || "（看了看我的屏幕）";
  remember(userMsg, text);
  SESSION.appendTurn(userMsg, text, { mode: currentMode, via: "magpie:vision" });
  const sp = await synthesizeVoice(text);
  return { ok: true, text, emo, voice: sp.audio, tts: sp.via, mode: currentMode };
}

// ── Hermes 桥：真干活（spawn 传参, 中文无损）───────────────────────
const HERMES_BIN = config.hermesBin;
const HERMES_SESSION = config.hermesSession;

function hermesChat(userMsg, budgetSec) {
  return new Promise((resolve) => {
    if (!userMsg || !String(userMsg).trim()) return resolve({ ok: false, text: "（要做什么？）" });
    if (!fs.existsSync(HERMES_BIN)) return resolve({ ok: false, text: "Hermes 没装" });
    const args = [
      "chat", "-q", userMsg, "-Q",
      "--source", "tool",
      "--continue", HERMES_SESSION, "--create-if-missing",
      "--run-budget", String(budgetSec || 120),
      "--max-turns", "20",
    ];
    const child = spawn(HERMES_BIN, args, {
      env: (() => {
        const e = { ...process.env };
        ["http_proxy","https_proxy","HTTP_PROXY","HTTPS_PROXY","all_proxy","ALL_PROXY"].forEach((k) => delete e[k]);
        e.NO_PROXY = "*"; e.no_proxy = "*"; e.HG_TERM = "1";
        e.PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:" + path.join(config.home, ".local/bin");
        // 子进程也认这个目录：否则它自己回落到真实 ~/.smartcompanion，隔离就漏了。
        e.LAN_DATA_DIR = DATA.dir; e.LINGDESK_DATA_DIR = DATA.dir;
        return e;
      })(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (e) {} }, (budgetSec || 120) * 1000 + 15000);
    child.on("close", (code) => {
      clearTimeout(killer);
      let text = out.trim();
      // 剥掉 session_id 行
      text = text.split("\n").filter((l) => !l.startsWith("session_id:")).join("\n").trim();
      if (!text && err) text = "（干活时出错：" + err.slice(0, 120) + "）";
      resolve({ ok: !!text, text: text || "（Hermes 没有返回内容）", code });
    });
    child.on("error", (e) => { clearTimeout(killer); resolve({ ok: false, text: "启动 Hermes 失败：" + e.message }); });
  });
}
// 端点与外部程序路径集中在 lib/config.js；密钥走「环境变量 → ~/.hermes/.env → 空」。
const ENV_FILE = config.envFile;
const TTS_BIN = config.edgeTtsBin;
const LLM_URL = config.llmUrl;
const LLM_MODEL = config.llmModel;
// ── DeepSeek v4.1 模型池（magpie 本地网关聚合, 失败自动切下一个）──
const MAGPIE_URL = config.magpieUrl;
// 本地 fallback：darkbloom llama-server（离线可用，抢不了就静默跳过）
const LOCAL_LLM_URL = config.localLlmUrl;
// 这个 key 原来直接写在源码里，仓库一公开就是泄露。改成从环境/.env 取。
// 取不到就是空串——本地服务多半不校验，校验时也只是这一路静默失败回退。
const LOCAL_LLM_KEY = config.secret("LOCAL_LLM_KEY");
const LOCAL_LLM_MODEL = config.localLlmModel;
// 本机 ollama：OpenAI 兼容端点（/v1/chat/completions），装了模型就能当离线兜底。
// 与 llama-server 是两条独立的本地路线，谁在跑就用谁。
const OLLAMA_URL = config.ollamaUrl;
const OLLAMA_MODEL = config.ollamaModel;

function getLLMKey() {
  return config.secret("AGENS_API_KEY");
}

// ── 长期记忆（借鉴 AIRI / Firefly-Companion 的关系记忆）──
// 读写全在 lib/memory-store.js，目录由 DATA 决定；调用点保持原函数名，行为不变。
const MEM_FILE = STORE.memoryFile;
const MEM_MAX = 200;

function remember(userText, replyText) {
  return STORE.remember(userText, replyText);
}

function recall(n) {
  return STORE.recall(n);
}

// ── 用户画像（结构化长期记忆, 比流水账更懂你）──
const PROFILE_FILE = STORE.profileFile;

function readProfile() {
  return STORE.readProfile();
}

// 每 N 轮对话提炼一次画像（异步, 不阻塞回复）
let chatTurnCount = 0;
async function maybeUpdateProfile() {
  chatTurnCount++;
  if (chatTurnCount % 5 !== 0) return;
  const mems = recall(10);
  if (mems.length < 3) return;
  const old = readProfile();
  const dialog = mems.map((m) => `用户：${m.u}\n我：${m.a}`).join("\n");
  const prompt = `从下面的对话里，提取关于【用户本人】的稳定事实（名字、喜好、习惯、作息、正在做的事、讨厌的东西）。
每条一行，格式必须是「- 属性：值」，属性名不超过6个字，例如「- 名字：小林」「- 讨厌：香菜」。
用户在这段对话里明确纠正过的（如"不是小明，是小林"），以纠正后的为准，重新输出该属性。
同一个属性只写一条 —— 后写的会覆盖已有画像里的旧值，不要新旧两条都写。
没有新事实就输出"无"。
已有画像：
${old || "（空）"}

对话：
${dialog}`;
  try {
    const body = JSON.stringify({ model: MODEL_POOL[0].id, messages: [{ role: "user", content: prompt }], max_tokens: 600, temperature: 0.3 });
    const r = await llmOnce(MAGPIE_URL, "magpie", body, null, 30);
    if (r.ok && r.text && !/^无$/.test(r.text.trim())) {
      STORE.mergeProfile(r.text);
    }
  } catch (e) {}
}

// ── 情绪标签解析（为 Live2D 表情驱动预留）──
const EMO_LIST = ["happy","sad","shy","angry","calm","surprised","sleepy","thinking"];
function parseEmotion(raw) {
  const txt = String(raw || "");
  const bare = txt.match(/^\s*\[(happy|sad|shy|angry|calm|surprised|sleepy|thinking)\]\s*/i);
  const m = txt.match(/\[emo:([a-z]+)\]/i) || bare;
  let emo = m ? m[1].toLowerCase() : "calm";
  if (!EMO_LIST.includes(emo)) emo = "calm";
  const clean = txt.replace(/\[emo:[a-z]+\]/ig, "").replace(/^\s*\[(happy|sad|shy|angry|calm|surprised|sleepy|thinking)\]\s*/i, "").trim();
  return { text: clean, emo };
}

// data.js 里的 persona。带 mtime 缓存：原来每轮聊天要读三次文件再编译三次 vm。
let _personaCache = { m: -1, v: {} };
function getPersonaObj() {
  try {
    const file = path.join(__dirname, "web", "data.js");
    const m = fs.statSync(file).mtimeMs;
    if (_personaCache.m === m) return _personaCache.v;
    const vm = require("vm");
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: "data.js" });
    const v = (sandbox.window.MALFOY || {}).persona || {};
    _personaCache = { m, v };
    return v;
  } catch (e) { return {}; }
}

// 音色跟着世界走：world=清冷优雅，desktop=萌娘活泼。
// 两形态的默认值在 lib/identity.js 里是分开的两条，不会一起回落到同一条。
//
// 用户 2026-11-01 定：小屋（现在的 world 页）先统一用萝莉音 —— 聊天、朗读、
// 主动开口都听同一副声音。两形态的音色区分等世界语气定稿后再打开，
// 设 HOUSE_VOICE=world 就能切回清冷那条，不用改代码。
const HOUSE_VOICE = process.env.HOUSE_VOICE === "world" ? "world" : "desktop";
function voiceSceneMode(mode) {
  return mode === "world" ? HOUSE_VOICE : mode;
}
function getTtsInstruct() {
  return IDENTITY.voiceProfile(getPersonaObj(), voiceSceneMode(currentMode)).instruct;
}

function memoryDigest() {
  const mems = recall(6);
  if (!mems.length) return "";
  const d = new Date();
  const when = `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}点`;
  const lines = mems.map((m) => `- 你说：${m.u.slice(0, 60)}｜我答：${m.a.slice(0, 60)}`).join("\n");
  const prof = readProfile();
  const profBlock = prof ? `\n【你了解的用户】\n${prof}\n` : "";
  return `${profBlock}\n【你记得的最近对话（现在是${when}）】\n${lines}\n（自然地带入记忆和画像，别生硬复述。）`;
}

function getPersona() {
  return IDENTITY.buildSystemPrompt({
    persona: getPersonaObj(),
    mode: currentMode,
    memory: memoryDigest(),
    // 性格段：只放"她此刻偏向什么"，身份段（她是谁）仍然逐字节不变。
    soul: soulPrompt(),
  });
}

function llmOnce(url, key, body, proxy, timeoutSec, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ok:false,code:'cancelled',text:''});
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(url);
    const args = ["-sS", "-m", String(timeoutSec || 45), "-w", "\n%{http_code}", url];
    if (isLocal) args.push("--noproxy", "*");
    else if (proxy) args.push("-x", proxy);
    args.push(
      "-H", "Content-Type: application/json",
      "-H", "Authorization: Bearer " + key,
      "-d", body
    );
    const child = execFile("curl", args, { maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      signal?.removeEventListener('abort',cancel);
      if (err) return resolve({ ok: false, code: "0", text: "" });
      const lines = String(out).split("\n");
      const code = lines.pop().trim();
      let reply = "";
      try {
        const j = JSON.parse(lines.join("\n"));
        const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
        reply = msg.content || "";
      } catch (e) {}
      resolve({ ok: code === "200" && !!reply, code, text: reply });
    });
    const cancel=()=>{child.kill('SIGTERM');resolve({ok:false,code:'cancelled',text:''});};
    signal?.addEventListener('abort',cancel,{once:true});
  });
}

const CHAT_ROUTER = new (require('./lib/chat-router').ChatRouter)({
  request: (p,messages,ms,signal)=>llmOnce(p.url,p.key,JSON.stringify({model:p.model,messages,max_tokens:256,temperature:.8,stream:false}),p.proxy,Math.max(1,ms/1000),signal),
});

// 流式路由：和非流式同一套顺序与熔断，区别在等的不是「整段答案」，
// 而是「第一个正文 token」。等不到就换下一个源，等到了就让它说完。
const STREAM_ROUTER = new (require('./lib/chat-router').ChatRouter)({
  request: (p,messages,ms,signal)=>llmOnce(p.url,p.key,JSON.stringify({model:p.model,messages,max_tokens:256,temperature:.8,stream:false}),p.proxy,Math.max(1,ms/1000),signal),
  streamRequest: (p,messages,o)=>streamOnce({
    url:p.url, key:p.key, proxy:p.proxy, signal:o.signal,
    timeoutSec:o.timeoutSec, firstTokenMs:o.firstTokenMs, onDelta:o.onDelta,
    body:JSON.stringify({model:p.model,messages,max_tokens:256,temperature:.8,stream:true}),
  }),
});
// 兜底开关：流式万一在某台机器上不可用，CHAT_STREAM=0 就能退回整段请求。
const CHAT_STREAM = process.env.CHAT_STREAM !== "0";

let EDGE_TTS_COOLDOWN_UNTIL = 0; // edge-tts 熔断截止时间
// ffmpeg 绝对路径（launchd/Electron 环境 PATH 不可靠）
const FFMPEG_BIN = findFfmpeg();
const TTS_QWEN_URL = config.ttsQwenUrl;
// 鲸鱼娘音色描述（VoiceDesign 模型生效；可在 data.js 的 persona.ttsInstruct 覆盖）
const TTS_DEFAULT_INSTRUCT =
  "A cool, elegant young female voice. Soft timbre with a slight sense of distance, " +
  "calm and composed, medium-slow pace, subtle upward inflection at sentence ends, " +
  "gentle and slightly mysterious, like a quiet girl who rarely shows emotion.";
let QWEN_TTS_COOLDOWN_UNTIL = 0;
// Qwen3-TTS 是 App 依赖、但不负责启动的外部服务。它一旦被回收（本机 launchd 拒绝新
// LaunchAgents，手动 nohup 又活不过会话），所有语音就静默降级到 edge-tts，
// 翻唱还会直接报「女主参考音色不可用」。所以这里主动保活：
// 启动时拉一次，Qwen 请求失败时再拉一次。60s 内不重复 spawn。
let TTS_KEEPALIVE_AT = 0;
function ensureTtsServer() {
  const now = Date.now();
  if (now - TTS_KEEPALIVE_AT < 60000) return;
  TTS_KEEPALIVE_AT = now;
  try {
    const ws = require("./lib/cover-jobs").findWorkspace(__dirname);
    const script = ws && path.join(ws, "scripts/ensure-tts-server.sh");
    // 脚本自带幂等（端口在监听就直接退出），所以可以无脑调。
    if (script && fs.existsSync(script)) {
      require("child_process").spawn("/bin/bash", [script], { detached: true, stdio: "ignore" }).unref();
    }
  } catch (e) {}
}
// 只作「最近一次」的诊断快照。**不可**用来判断某条回复是谁合成的：
// 两条请求并发时它会互相覆盖，A 明明是 qwen3，读回来却是 B 的 edge。
// 每条回复的引擎走 synthesizeVoice 的返回值。
let LAST_TTS_VIA = "none";

function synthesizeVoice(text, options = {}) {
  return new Promise((resolve) => {
    if (!text) return resolve({ audio: null, via: "none", ms: 0 });
    const T0 = Date.now();
    const os = require("os");
    let finished = false;
    const finish = (b64, via, mime) => {
      if (finished) return;
      finished = true;
      const ok = !!b64;
      LAST_TTS_VIA = ok ? via : "none";
      resolve({ audio: ok ? b64 : null, via: ok ? via : "none", ms: Date.now() - T0,
        mime: ok ? (mime || "audio/mp3") : null });
    };

    // ── 1) Qwen3-TTS 本地服务（主用，约 3s，音色可定制）──
    // force：关键路径（如翻唱参考音色）忽略熔断。熔断本是防止连续失败拖慢交互，
    // 但读书预取失败一次就让翻唱也失败 5 分钟，是错误连坐。
    if (options.force || Date.now() > QWEN_TTS_COOLDOWN_UNTIL) {
      const stamp = require('crypto').randomUUID();
      const wav = path.join(os.tmpdir(), "qwen-" + stamp + ".wav");
      const mp3 = path.join(os.tmpdir(), "qwen-" + stamp + ".mp3");
      const body = JSON.stringify({
        text: String(text).slice(0, 300),
        // 读书时按角色覆盖音色（多角色配音）；其余场景沿用她自己当前形态的音色
        instruct: options.instruct || IDENTITY.voiceProfile(getPersonaObj(), voiceSceneMode(options.mode || currentMode)).instruct,
      });
      execFile("curl", [
        // 25s：服务端推理加了串行锁，并发时会排队。15s 在读书预取 + 翻唱同时打时
        // 实测会被排队顶穿（单条 2s，排到第 8 位就超）。
        "-f", "-sS", "-m", options.interactive ? "25" : "60", "--noproxy", "*", "-X", "POST",
        "-H", "Content-Type: application/json", "-d", body, "-o", wav, TTS_QWEN_URL,
      ], { timeout: options.interactive ? 26000 : 70000 }, (err) => {
        const clean = () => { try { fs.unlinkSync(wav); } catch (e) {} try { fs.unlinkSync(mp3); } catch (e) {} };
        try {
          if (!err && fs.existsSync(wav) && fs.statSync(wav).size > 2000) {
            // 流式聊天的一句只播一次、不落盘，没必要转 mp3 —— 每句都跑一次
            // ffmpeg 要 0.3~0.5s，而每句的播放时长也就 2~5s，这笔钱占比太高。
            // 代价是 base64 体积大约 4 倍（100KB 级），本机 IPC 无感。
            if (options.wav) {
              const b64 = fs.readFileSync(wav).toString("base64");
              clean();
              return finish(b64, "qwen3", "audio/wav");
            }
            return execFile(FFMPEG_BIN, ["-y", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "4", mp3],
              { timeout: 20000 }, (e2) => {
                try {
                  if (!e2 && fs.existsSync(mp3) && fs.statSync(mp3).size > 500) {
                    const b64 = fs.readFileSync(mp3).toString("base64");
                    clean();
                    return finish(b64, "qwen3");
                  }
                } catch (e) {}
                clean();
                tryEdge();
              });
          }
        } catch (e) {}
        // 失败 → 熔断 5 分钟后走 edge。同时尝试把服务拉回来：
        // 熔断只是「这段时间别再等它」，不该等于「放弃修复」。
        QWEN_TTS_COOLDOWN_UNTIL = Date.now() + 5 * 60 * 1000;
        ensureTtsServer();
        clean();
        tryEdge();
      });
    } else {
      tryEdge();
    }

    // ── 2) edge-tts（云端兜底，失败熔断 10 分钟）──
    function tryEdge() {
      if (!fs.existsSync(TTS_BIN) || Date.now() <= EDGE_TTS_COOLDOWN_UNTIL) return fallbackSay();
      const out = path.join(os.tmpdir(), "companion-tts-" + Date.now() + ".mp3");
      const p = spawn(TTS_BIN, ["--voice", "zh-CN-XiaoxiaoNeural", "--text", text, "--write-media", out], {
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env, HTTPS_PROXY: "http://127.0.0.1:10808", https_proxy: "http://127.0.0.1:10808" },
      });
      const timer = setTimeout(() => {
        try { p.kill("SIGKILL"); } catch (e) {}
        EDGE_TTS_COOLDOWN_UNTIL = Date.now() + 10 * 60 * 1000;
        fallbackSay();
      }, 6000);
      p.on("error", () => { clearTimeout(timer); fallbackSay(); });
      p.on("close", () => {
        clearTimeout(timer);
        try {
          if (fs.existsSync(out) && fs.statSync(out).size > 1000) {
            const b64 = fs.readFileSync(out).toString("base64");
            fs.unlinkSync(out);
            return finish(b64, "edge");
          }
        } catch (e) {}
        EDGE_TTS_COOLDOWN_UNTIL = Date.now() + 10 * 60 * 1000;
        fallbackSay();
      });
    }

    // ── 3) 离线兜底：macOS say → aiff → mp3 ──
    function fallbackSay() {
      const stamp = Date.now();
      const aiff = path.join(os.tmpdir(), "companion-say-" + stamp + ".aiff");
      const mp3 = path.join(os.tmpdir(), "companion-say-" + stamp + ".mp3");
      const s = spawn("/usr/bin/say", ["-v", "Ting-Ting", "-o", aiff, text], { stdio: ["ignore", "ignore", "ignore"] });
      s.on("error", () => finish(null, "none"));
      s.on("close", () => {
        execFile(FFMPEG_BIN, ["-y", "-i", aiff, "-codec:a", "libmp3lame", "-q:a", "5", mp3], { timeout: 15000 }, (err) => {
          try {
            if (!err && fs.existsSync(mp3) && fs.statSync(mp3).size > 500) {
              finish(fs.readFileSync(mp3).toString("base64"), "say");
            } else finish(null, "none");
          } catch (e) { finish(null, "none"); }
          try { fs.unlinkSync(aiff); } catch (e) {}
          try { fs.unlinkSync(mp3); } catch (e) {}
        });
      });
      setTimeout(() => finish(null, "none"), 20000);
    }
  });
}

// 多角色朗读：按稿逐句合成、各用各的音色、再拼成一条音轨（实现在 lib/voice-script.js）
const synthesizeScript = createVoiceScript({ synthesize: synthesizeVoice, ffmpeg: FFMPEG_BIN });

// ── 一次对话的完整交付：所有成功路径都走这里 ─────────────────────
// 以前只有主路会记记忆、解析情绪、推给窗口；agnes / local27b 是「哑」的 ——
// 答了话却不记得、不出表情、不报引擎。fallback 也是聊天，必须同一套策略。
let CHAT_SEQ = 0;     // 提交序号，越大越新
let SPOKEN_SEQ = 0;   // 已经念出去的最大序号
let AUDIO_EPOCH = 0;  // chat / song / reading share one audible owner

async function deliverReply({ raw, via, userMsg, seq, opts }) {
  const o = opts || {};
  const { text, emo } = parseEmotion(raw);
  const mode = currentMode;
  if (o.cancelled) return { text, voice: null, via, emo, mode, tts: "skipped", superseded: true };
  // 1) 记录：不看走的是哪条路
  if (o.noMemory) {
    // 她主动开口 / 由系统提示触发的回应：话要进会话，但不能当成「用户说过」污染长期记忆
    SESSION.appendTurn(o.label || "（她先开口）", text, { mode, via });
  } else {
    remember(userMsg, text);
    SESSION.appendTurn(userMsg, text, { mode, via });
    maybeUpdateProfile();
  }
  // 2) 仲裁：晚到的旧回答不许盖掉新的。否则会叠播，还会让她前后自相矛盾。
  if (seq < SPOKEN_SEQ || o.cancelled) {
    return { text, voice: null, via, emo, mode, tts: "skipped", superseded: true };
  }
  SPOKEN_SEQ = seq;
  const epoch = AUDIO_EPOCH;
  const voiceJob = async () => {
    const sp = await synthesizeVoice(text, {mode:voiceSceneMode(mode),interactive:!!o.detachedVoice});
    if (seq < SPOKEN_SEQ || o.cancelled || epoch !== AUDIO_EPOCH) return {text,voice:null,via,emo,mode,tts:"skipped",superseded:true};
    const voice = mode === currentMode && presentation !== "hidden" ? sp.audio : null;
    pushToCharacter({text:o.detachedVoice?null:text,emo,voice,mode,seq});
    o.onVoice?.({seq,ready:!!voice,tts:sp.via,ms:sp.ms});
    return {text,voice,via,emo,mode,tts:sp.via,ttsMs:sp.ms,superseded:false,deliveredToStage:true,
      voiceProfile:IDENTITY.voiceProfile(getPersonaObj(),mode).label};
  };
  if (o.detachedVoice) {
    pushToCharacter({text,emo,voice:null,mode,seq});
    void voiceJob().catch(()=>o.onVoice?.({seq,ready:false,tts:"none"}));
    return {text,voice:null,voicePending:true,via,emo,mode,seq,deliveredToStage:true};
  }
  return await voiceJob();
}

// 网关优先、本地垫底。以前 ollama / local27b 是插在网关第 2、3 位之间的，
// 结果前两个云端源一旦 429，就先落到本机 7b 上 —— 那句话要十几秒。
// 顺序本身就是延迟：本地模型应该是「都连不上」时的兜底，不是常规路径。
function chatProviders() {
  const gateways=MODEL_POOL.map(m=>({id:m.id,model:m.id,url:MAGPIE_URL,key:"magpie"}));
  const providers=[...gateways];
  const key=getLLMKey();
  if(key)providers.push({id:"agens",model:LLM_MODEL,url:LLM_URL,key,proxy:"http://127.0.0.1:10808"});
  if(OLLAMA_URL)providers.push({id:"ollama:"+OLLAMA_MODEL,model:OLLAMA_MODEL,url:OLLAMA_URL,key:"ollama"});
  if(LOCAL_LLM_URL)providers.push({id:"local27b",model:LOCAL_LLM_MODEL,url:LOCAL_LLM_URL,key:LOCAL_LLM_KEY});
  return providers;
}

// 语音转写会吞标点、改错同音字、留下「呃/那个」。
// 让模型自己按意思理解，比事后再花一次模型往返去「清洗转写」便宜——
// AIri 那边是单独跑一个 rephrase agent（agents/src/voice-transcription-rephrase），
// 我们没有那个延迟预算（实测 STT 0.8s + 首字 2s，再多一跳就回到 5 秒）。
const VOICE_HINT = "\n\n（用户这一条是语音输入的转写：可能缺标点、有同音错字或口癖。按意思理解，别纠错，也不要反问「你是不是想说…」。）";

function chatMessages(userMsg, hist, voice) {
  const persona = getPersona() + (voice ? VOICE_HINT : "");
  return [{ role: "system", content: persona }]
    .concat(hist.map((h) => ({ role: h.role, content: h.content })))
    .concat([{ role: "user", content: userMsg }]);
}

// 送进 TTS 前把不能念的东西去掉：表情符号、标签残留。
// 数字/日期的读法和读书链路共用同一份 toSpeech，不另写一套。
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;
function speechText(piece) {
  const raw = String(piece == null ? "" : piece).replace(EMOJI_RE, "");
  let out;
  try { out = toSpeech(raw, false); } catch (_) { out = raw; }
  return out.replace(/\[emo:[a-z]+\]/ig, "").trim();
}

/**
 * 流式的一轮对话：模型边写、这里边切句、边合成、边往舞台上送。
 * 返回 null 表示「一个字都没拿到」——调用方可以退回原来的整段请求。
 */
async function streamChat({ userMsg, msgs, providers, seq, opts }) {
  const o = opts || {};
  const mode = currentMode, epoch = AUDIO_EPOCH, T0 = Date.now();
  const splitter = createReplySplitter();
  // 任何一项变了（被新对话顶替 / 被叫停 / 换台）就立刻停手，别让旧句子继续合成
  const stale = () => o.cancelled || seq !== CHAT_SEQ || epoch !== AUDIO_EPOCH;
  let full = "", chunks = 0, bubble = false, lastTextPush = 0;
  let firstTextMs = 0, firstAudioMs = 0;
  // 合成串成一条链：服务端本来就是串行的，并发只会把队列排长，
  // 串行还能保证「第一句一定最先合成」。
  let chain = Promise.resolve();

  const say = (piece) => {
    const text = speechText(piece);
    if (!text) return;
    chain = chain.then(async () => {
      if (stale()) return;
      const sp = await synthesizeVoice(text, { mode:voiceSceneMode(mode), interactive: true, wav: true });
      if (!sp.audio || stale()) return;
      chunks += 1;
      if (!firstAudioMs) firstAudioMs = Date.now() - T0;
      // chunk 标记：舞台把这一句接到队列尾巴，而不是打断上一句
      pushToCharacter({ mode, voice: sp.audio, mime: sp.mime, chunk: { seq, i: chunks } });
      o.onVoice?.({ seq, ready: true, tts: sp.via, ms: sp.ms, chunk: chunks, i: chunks, firstAudioMs });
    }).catch(() => {});
  };

  const result = await STREAM_ROUTER.runStream(providers, msgs, {
    signal: o.signal,
    onDelta: (delta) => {
      if (stale()) return;
      full += delta;
      if (!firstTextMs) firstTextMs = Date.now() - T0;
      for (const piece of splitter.push(delta)) say(piece);
      if (!bubble && splitter.emitted) {
        bubble = true;
        // 第一句出来就把气泡挂上：否则她会先有声音、几秒后才出现字。
        // partial 告诉她「这只是文字更新，别再做一个互动动作」。
        pushToCharacter({ text: parseEmotion(full).text, emo: splitter.emotion || "calm", mode, partial: true });
      }
      const now = Date.now();
      if (now - lastTextPush > 80) { lastTextPush = now; o.onText?.(full); }
    },
  });

  if (result.cancelled || stale()) {
    return { text: parseEmotion(full).text, voice: null, via: "cancelled", emo: "calm", mode,
      tts: "none", superseded: true, ms: Date.now() - T0 };
  }
  for (const piece of splitter.flush()) say(piece);
  if (!full.trim()) return null;  // 一个字都没有 → 交给下面的整段请求兜底

  const { text, emo } = parseEmotion(full);
  SPOKEN_SEQ = seq;  // 让晚到的非流式回答知道这轮已经念过了
  if (o.noMemory) {
    SESSION.appendTurn(o.label || "（她先开口）", text, { mode, via: result.via });
  } else {
    remember(userMsg, text);
    SESSION.appendTurn(userMsg, text, { mode, via: result.via });
    maybeUpdateProfile();
  }
  // 用完整文本替换掉先出的半句。已经在念了，就不必再触发一次互动动作。
  pushToCharacter({ text, emo, mode, partial: chunks > 0 });
  o.onText?.(text);
  // 剩下的句子还在后台合成：这里不能 await，否则一轮对话要等到最后一句合成完才返回
  chain.then(() => { if (!stale()) o.onVoice?.({ seq, ready: chunks > 0, done: true, chunks, firstAudioMs }); });
  return { text, voice: null, voicePending: chunks === 0, via: result.via, emo, mode, seq,
    deliveredToStage: true, chunks, firstTextMs, firstAudioMs, ms: Date.now() - T0,
    truncated: !!result.truncated, attempts: result.attempts };
}

async function llmChat(userMsg, history, opts) {
  const seq = ++CHAT_SEQ;
  // 会话归主进程：渲染层传了就用它的（旧页面仍这么调），没传就用主进程的，
  // 换形态重建窗口后也接得上。
  const hist = Array.isArray(history) && history.length ? history.slice(-6) : SESSION.history(6);
  const messages = chatMessages(userMsg, hist, opts?.voice);
  const providers = chatProviders();
  const meta = { userMsg, seq, opts };

  // 1) 先走流式：声音跟着第一个句子出来，不用等整段
  if (CHAT_STREAM) {
    const streamed = await streamChat({ userMsg, msgs: messages, providers, seq, opts });
    if (streamed) return streamed;
    if (opts?.cancelled || seq !== CHAT_SEQ) {
      return { text: "这条对话已停止。", voice: null, via: "cancelled", emo: "calm", mode: currentMode, tts: "none", superseded: true };
    }
  }

  // 2) 一个字都没拿到（网关不支持流 / 全源失败）→ 退回整段请求
  const result=await CHAT_ROUTER.run(providers,messages,{signal:opts?.signal});
  if(result.ok)return {...await deliverReply({raw:result.text,via:result.via,...meta}),modelMs:result.ms};
  return {text:result.cancelled?"这条对话已停止。":"暂时连不上模型服务，稍后再试。唱歌和已导入的阅读仍可使用。",voice:null,via:result.cancelled?"cancelled":"none",emo:"calm",mode:currentMode,tts:"none",superseded:!!result.cancelled,modelMs:result.ms};
}

/**
 * 不带人格、不带记忆的一次性问答，给工具用（现在只有「分析书」）。
 * 与聊天分开建 router：这里要更大的 max_tokens（角色表比一句闲聊长得多），
 * 温度也压到 0.2 —— 要的是稳定的 JSON，不是灵感。
 */
async function llmRaw(messages, { budgetMs = 30000, attemptMs = 15000, maxTokens = 1200, temperature = 0.2, signal } = {}) {
  const providers=chatProviders();
  const router=new (require('./lib/chat-router').ChatRouter)({
    request:(p,msgs,ms,sig)=>llmOnce(p.url,p.key,JSON.stringify({model:p.model,messages:msgs,max_tokens:maxTokens,temperature,stream:false}),p.proxy,Math.max(1,ms/1000),sig),
    budgetMs,attemptMs,
  });
  return router.run(providers,messages,{signal});
}

const PAGE = path.join(__dirname, "web", "index.html");
const WORLD_PAGE = path.join(__dirname, "web", "live2d", "world.html");
// 澜的小屋。走自定义协议而不是 loadFile：moli-room 用 fetch 读 GLB 与逐顶点数据，
// file:// 下全被 CORS 拒掉（房间照画、人不在）。`?v=` 是给三个 vendor 脚本防缓存用的。
const ROOM_PAGE = LANROOM_SCHEME + "://app/moli-room/index.html?v=20261101-1612";
const PRELOAD = path.join(__dirname, "preload.js");
let wall = null, tray = null, composer = null, composerExpanded = false;
let presentation = "hidden", previousWorldBounds = null, listening = false;
let currentMode = "world"; // world=她的世界(精致场景) | desktop=你的世界(2D萌娘)

function bounds() {
  return screen.getPrimaryDisplay().bounds;
}

function createWall() {
  const b = bounds();
  const window = new BrowserWindow({
    ...b,
    type: "desktop",
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    backgroundColor: "#000000",
    webPreferences: { preload: PRELOAD, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" },
  });
  wall = window;
  window.setIgnoreMouseEvents(true);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  window.loadFile(WORLD_PAGE, { query: { mode: "world", wallpaper: "1" } });
  window.on("closed", () => { if (wall === window) wall = null; });
}


// ── 窗口边缘互动：用 CGWindowList 拿其他 app 的窗口坐标（不需要录屏权限）──
const WINDOW_JXA = `
ObjC.import("CoreGraphics");
var l = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID);
var a = ObjC.deepUnwrap(ObjC.castRefToObject(l));
var out = [];
for (var i = 0; i < a.length; i++) {
  var w = a[i];
  var b = w.kCGWindowBounds || {};
  if (w.kCGWindowLayer !== 0) continue;
  var ww = b.Width || 0, hh = b.Height || 0;
  if (ww < 420 || hh < 260) continue;
  var app = w.kCGWindowOwnerName || "?";
  var skip = ["Miss Malfoy","SmartCompanion","DeepWhale","深蓝","universalAccessAuthWarn","Window Server",
              "Dock","Control Center","Notification Center","Spotlight","SystemUIServer",
              "TextInputMenuAgent","WiFi","Battery","tmux"];
  if (skip.indexOf(app) >= 0) continue;
  out.push({app: app, x: Math.round(b.X), y: Math.round(b.Y), w: Math.round(ww), h: Math.round(hh), pid: w.kCGWindowOwnerPID});
}
JSON.stringify(out);
`;
const WIN_SCRIPT = path.join(require("os").tmpdir(), "sc-winlist.js");
let winCache = [], winTimer = null;

function refreshWindows() {
  try { fs.writeFileSync(WIN_SCRIPT, WINDOW_JXA); } catch (e) {}
  require("child_process").execFile("osascript", ["-l", "JavaScript", WIN_SCRIPT],
    { timeout: 4000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return;
      try {
        const list = JSON.parse(stdout.trim() || "[]");
        // 按 pid 再兜一层：改过名的 app 光靠名字过滤会漏掉自己的窗口
        if (Array.isArray(list)) winCache = list.filter((w) => w && w.pid !== process.pid);
      } catch (e) {}
    });
}

function startWindowPolling() {
  if (winTimer) return;
  refreshWindows();
  winTimer = setInterval(refreshWindows, 2500);
}
function stopWindowPolling() {
  if (winTimer) { clearInterval(winTimer); winTimer = null; }
}

// ── 三态：dormant(休眠/壁纸) | world(她的世界) | desktop(你的世界) ──
let stage = null, stageMode = null;
let contentPages = null;
// ── 她自己的四个状态：灵魂 / 花园 / 钓鱼 / 小屋布局 ────────────────
// 全部落在 DATA.dir 下，和好感度、旅行日记同级；都不认识窗口，只管规则与落盘。
let soulStore = null, gardenStore = null, fishingStore = null, roomStore = null;
function soul() {
  if (!soulStore) soulStore = require('./lib/soul').createSoul({ dir: DATA.dir });
  return soulStore;
}
function garden() {
  if (!gardenStore) gardenStore = require('./lib/garden').createGarden({ dir: DATA.dir });
  return gardenStore;
}
function fishing() {
  if (!fishingStore) fishingStore = require('./lib/fishing').createFishing({ dir: DATA.dir });
  return fishingStore;
}
function roomPlan() {
  if (!roomStore) roomStore = require('./lib/room-plan').createRoomPlan({ dir: DATA.dir });
  return roomStore;
}
// 灵魂计算失败不该影响聊天：提示词少一段，比整轮报错好。
function soulPrompt() {
  try { return soul().prompt(); } catch (_) { return ""; }
}
function feelSoul(kind, options) {
  try { return soul().feel(kind, options); } catch (_) { return null; }
}
let desktopSize = 180;
let mediaController = null, coverController = null, currentChatRequest = null, albumStore = null;
function media() {
  if (!mediaController) mediaController = require('./lib/companion-media').createCompanionMedia({
    dir: DATA.dir, contentDir:path.join(__dirname,'web/live2d/companion-content'),
    synthesize:synthesizeVoice,synthesizeScript,mode:()=>voiceSceneMode(currentMode),
    analyzeBook:({title,text})=>require('./lib/book-analysis').analyze({
      request:(messages,signal)=>llmRaw(messages,{signal}),title,text,
    }),
    send:p=>sendToScene('scene:media',p),
    // 读书面板现在住在小屋里（渲染进程就是舞台窗口），状态也要发给它，
    // 否则面板上的「正在读 / 暂停 / 第几段」永远停在初始值。
    publish:p=>{
      if(composer&&!composer.isDestroyed())composer.webContents.send('media:state',p);
      if(stage&&!stage.isDestroyed())stage.webContents.send('media:state',p);
    },
  });
  return mediaController;
}
// 小屋的相册。随包的三张照片用 seed（相对 moli-room/ 的路径），用户加的照片
// 拷进 <data>/album/images/，页面通过 lanroom://album/<文件名> 取。
function album() {
  if (!albumStore) albumStore = require('./lib/album').createAlbum({
    dir: path.join(DATA.dir, 'album'),
    seed: [
      { seed: 'assets/lan-room/portrait-whale.jpg', title: '抱着小鲸鱼的晴天', note: '' },
      { seed: 'assets/lan-room/morning-cafe.jpg', title: '一起等海风', note: '' },
      { seed: 'assets/lan-room/starlight-balcony.jpg', title: '晚安，星光与海', note: '' },
    ],
  });
  return albumStore;
}
const ALBUM_IMAGES = () => path.join(DATA.dir, 'album', 'images');
function cancelChat(stop = true) {
  if(currentChatRequest){currentChatRequest.cancelled=true;currentChatRequest.controller?.abort();}
  AUDIO_EPOCH++;
  if(stop)sendToScene('character:stop-voice');
}
// 唱歌音色是**定稿资产**，不该每次翻唱都现场合成：
// 实时合成有三重脆弱点 —— interactive 只有 15s 超时、失败一次就熔断 5 分钟、
// 服务端推理无锁会跟读书预取抢 MPS。三者任一发生，翻唱就报「参考音色不可用」。
// 所以优先读资产，只有资产缺失（分发版没带）时才回退实时生成。
function singRefAsset(){
  const ws=require('./lib/cover-jobs').findWorkspace(__dirname);
  return [ws&&path.join(ws,'assets/whale-video-test/voice/ref-sing-magnetic.wav'),
          path.join(__dirname,'web/live2d/companion-content/ref-sing-magnetic.wav')]
    .filter(Boolean)
    .find(p=>{try{return fs.statSync(p).size>20000;}catch(_){return false;}})||null;
}
let voiceProfiles=null;
// 音色档案：谁在唱（参考音频）+ 她能唱多低多高（range）。两者独立。
// 档案定义在 voices.json，参考音频可以来自 ~/.smartcompanion/voices/（用户自备）
// 或打包内的 companion-content/voices/（随包内置）。
function voices(){
  if(!voiceProfiles){
    const {createVoiceProfiles}=require('./lib/voice-profiles');
    voiceProfiles=createVoiceProfiles({
      dir:DATA.dir,
      contentDir:path.join(__dirname,'web/live2d/companion-content'),
      workspace:require('./lib/cover-jobs').findWorkspace(__dirname),
    });
  }
  return voiceProfiles;
}
function covers(){
  if(!coverController){const c=require('./lib/cover-jobs');coverController=c.createCoverJobs({dir:DATA.dir,workspace:c.findWorkspace(__dirname),ffmpeg:FFMPEG_BIN,
    voiceProfiles:voices(),
    reference:async()=>{
      // 兜底路径：音色档案里的参考音频都不可用时才走这里（现场合成一段）。
      // 正常情况下 cover-jobs 直接从档案拿 refPath，不会调到这里。
      const mode=currentMode;
      const asset=singRefAsset();
      if(asset){
        try{return {audio:fs.readFileSync(asset).toString('base64'),via:'asset',voice:mode};}catch(_){}
      }
      // force：参考音色是关键路径，不能被读书合成失败留下的熔断连累
      const sp=await synthesizeVoice('海风轻轻吹过窗前，我会在这里陪你。',{mode,interactive:true,force:true});
      if(sp.via!=='qwen3'||!sp.audio)throw new Error('女主参考音色暂时生成失败，请稍后再试。');
      return {...sp,voice:mode};
    },
    publish:p=>{if(composer&&!composer.isDestroyed())composer.webContents.send('cover:state',p);}});}
  return coverController;
}
let journeyController = null;
let vocalistController = null;
/**
 * 歌姬模式：她自己写词作曲唱一首新的。
 * 作曲走云端（MiniMax），写词走本机模型池，换声复用 seed-vc。
 * 三段互相独立 —— 缺本机歌声模型时，写词和作曲照样能用。
 */
function vocalists(){
  if(vocalistController)return vocalistController;
  const {createVocalistJobs}=require('./lib/vocalist-jobs');
  vocalistController=createVocalistJobs({
    dir:DATA.dir,
    workspace:require('./lib/cover-jobs').findWorkspace(__dirname),
    ffmpeg:FFMPEG_BIN,
    voiceProfiles:voices(),
    secret:config.secret,
    // 写词不是通用问答：要的是能唱的短句和重复的副歌，不是漂亮散文。
    // 所以温度拉到 0.9（宁可跑偏也别四平八稳），并且明确禁止它附赠解释。
    writeLyrics:async({theme,style})=>{
      const brief=[theme?`主题：${theme}`:'主题：自己定，写你最近在想的、或者海边的事',
        style?`曲风：${style}`:'曲风：温暖的中文流行'].join('\n');
      const r=await llmRaw([
        {role:'system',content:'你是「澜」，住在海边的鲸鱼娘。现在你要写一首自己唱的歌。只输出歌名和歌词：不要解释、不要寒暄、不要代码块、不要在结尾说感想。'},
        {role:'user',content:`${brief}\n\n写法要求：\n- 第一行写「标题：歌名」，歌名不超过 12 个字\n- 之后是歌词，用 [Verse] [Chorus] [Bridge] 标出段落\n- 主歌 4 行、副歌 4 行，全歌 3 到 4 段\n- 副歌要重复，句子短、能唱出来\n- 用中文，口语一点，别堆形容词和比喻`},
      ],{budgetMs:45000,attemptMs:18000,maxTokens:900,temperature:0.9});
      if(!r||!r.ok||!String(r.text||'').trim())throw new Error('她这会儿想不出词（模型暂时不可用）。自己写几句也行，或者稍后再点一次。');
      return r.text;
    },
    publish:p=>{if(composer&&!composer.isDestroyed())composer.webContents.send('vocalist:state',p);},
  });
  return vocalistController;
}
function journeys() {
  if (!journeyController) {
    const contentDir = path.join(__dirname, 'web/live2d/companion-content');
    journeyController = require('./lib/journey').createJourney({
      dir: DATA.dir,
      // 测试用：JOURNEY_INTERVAL_MS=60000 可以让她一分钟就回来一趟
      intervalMs: Number(process.env.JOURNEY_INTERVAL_MS) || undefined,
      // 明信片复用相册图：她带回来的是新照片，不占剧情相册的解锁位
      photos: () => {
        try {
          return fs.readdirSync(contentDir).filter((n) => /^album-\d+.*\.jpg$/i.test(n));
        } catch (_) { return []; }
      },
      generate: async (place) => {
        const r = await llmRaw([
          { role: 'system', content: '你是「澜」，住在海边的鲸鱼娘。用第一人称写旅行见闻，只写正文，不要解释、不要加引号。' },
          { role: 'user', content: `你今天去了「${place}」。写你看到的、或者做的一件小事，30 到 60 字。` },
        ], {});
        return r && r.ok ? r.text : '';
      },
    });
  }
  return journeyController;
}
// 每 10 分钟对一次账。时间用补算，所以 app 关着的时候也照样"出去过"。
function startJourneyClock() {
  // 检查频率跟着旅行间隔走：默认 2 小时一趟，10 分钟看一次就够；
  // 测试时把间隔调成 1 分钟，这里也要跟着变快，否则设了也看不到。
  const trip = journeys().intervalMs || 2 * 60 * 60 * 1000;
  const checkMs = Math.min(10 * 60 * 1000, Math.max(5000, Math.floor(trip / 2)));
  const timer = setInterval(() => {
    journeys().tick().then((created) => {
      if (!created.length) return;
      const snap = journeys().snapshot();
      if (composer && !composer.isDestroyed()) composer.webContents.send('journey:state', snap);
    }).catch(() => {});
  }, checkMs);
  timer.unref?.();
  // 启动时先补算一次，别等 10 分钟
  journeys().tick().catch(() => {});
}

function openCompanionPanel(tab) {
  toggleComposer(true);
  if(composer.webContents.isLoadingMainFrame())composer.webContents.once('did-finish-load',()=>composer?.webContents.send('composer:tab',tab));
  else composer.webContents.send('composer:tab',tab);
}

function setDesktopSize(value) {
  if (![140, 180, 220].includes(value)) return;
  desktopSize = value;
  if (stageMode === "desktop") sendToScene("character:size", desktopSize);
  buildMenu();
}

function closeStage() {
  stopWindowPolling();
  if (stage && !stage.isDestroyed()) {
    stage.removeAllListeners("closed");
    stage.close();
  }
  stage = null; stageMode = null;
}

function workAreaFor(rect) {
  return (rect ? screen.getDisplayMatching(rect) : screen.getPrimaryDisplay()).workArea;
}
function notifyComposer() {
  if (!composer || composer.isDestroyed()) return;
  composer.webContents.send("composer:state", { expanded: composerExpanded, mode: currentMode });
}
function ensureComposer(options = {}) {
  const show = options.show !== false;
  if (composer && !composer.isDestroyed()) { if (show) composer.showInactive(); return composer; }
  composerExpanded = false;
  const window = new BrowserWindow({
    ...WINDOW_POLICY.composerBounds(workAreaFor(), false),
    frame: false, transparent: true, hasShadow: false, resizable: false,
    visualEffectState: "active",
    movable: true, maximizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: true, focusable: false, show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  composer = window;
  window.setAlwaysOnTop(true, "floating", 1);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  window.loadFile(path.join(__dirname, "web/live2d/composer.html"));
  window.webContents.on("did-finish-load", () => {
    notifyComposer();
    window.webContents.send("character:session", { mode: currentMode, turns: SESSION.recent(20) });
    window.webContents.send('media:state',media().snapshot());
    if (show) window.showInactive();
  });
  window.on("closed", () => { if (composer === window) composer = null; });
  return window;
}
/**
 * 静默预创建对话窗口。
 *
 * 唤醒监听住在对话窗里 —— 采集、转写、串行提问那套逻辑都在它身上，没必要再写一份。
 * 代价是这个窗口必须在开机时就存在且不显示：否则用户喊第一声时窗口还没建，
 * 那一声就白喊了（而且第一次唤醒必然发生在「用户还什么都没点过」的时候）。
 */
function prewarmComposer() {
  // 麦克风权限要在这里主动问一次。
  // 唤醒监听住在隐藏窗口里，用户第一次喊名字时 getUserMedia 才第一次被调用 ——
  // 而系统权限弹窗跟着的是一个不可见的窗口，结果就是「喊了没反应，也没有任何提示」。
  // 开机时问掉，用户看得见弹窗，拒了也知道自己拒了什么。
  try {
    const { systemPreferences } = require("electron");
    if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("microphone") === "unknown") {
      systemPreferences.askForMediaAccess("microphone").catch(() => {});
    }
  } catch (_) {}
  try { return ensureComposer({ show: false }); } catch (error) {
    console.warn("[wake] 预创建对话窗失败：" + (error && error.message));
    return null;
  }
}
// 语音唤醒的开关要跨重启保留：用户关掉它通常是因为「不想让麦克风一直开着」，
// 每次开机都替他打开，等于没得选。
const WAKE_PREF = path.join(DATA.dir, "wake.json");
let wakeEnabled = (() => {
  try { return JSON.parse(fs.readFileSync(WAKE_PREF, "utf8")).enabled !== false; }
  catch (_) { return true; }
})();
function setWakeEnabled(on) {
  wakeEnabled = !!on;
  try { fs.writeFileSync(WAKE_PREF, JSON.stringify({ enabled: wakeEnabled })); } catch (_) {}
  const window = wakeEnabled ? prewarmComposer() : (composer && !composer.isDestroyed() ? composer : null);
  if (window && !window.isDestroyed()) window.webContents.send("wake:set", { enabled: wakeEnabled });
  buildMenu();
}
function toggleComposer(expanded) {
  const window = ensureComposer();
  composerExpanded = !!expanded;
  if (process.platform === "darwin") window.setVibrancy(composerExpanded ? "popover" : null);
  window.setHasShadow(composerExpanded);
  window.setBounds(WINDOW_POLICY.composerBounds(workAreaFor(window.getBounds()), composerExpanded, window.getBounds()));
  window.setFocusable(composerExpanded);
  notifyComposer();
  if (composerExpanded) { window.show(); window.focus(); }
  else window.showInactive();
  return { expanded: composerExpanded };
}
// 她的两个窗口（对话窗 / 舞台）。凡是对「她」做的操作都只认这两个来源，
// 别用 isDestroyed() 猜——窗口关掉后 webContents 会变成 null，比较要稳。
function isCompanionWindow(sender) {
  if (!sender) return false;
  if (composer && !composer.isDestroyed() && sender === composer.webContents) return true;
  if (stage && !stage.isDestroyed() && sender === stage.webContents) return true;
  return false;
}
function sendToScene(channel, payload) {
  const target = stage && !stage.isDestroyed() ? stage : wall;
  if (!target || target.isDestroyed()) return;
  const send = () => { if (!target.isDestroyed() && (target === stage || target === wall)) target.webContents.send(channel, payload); };
  if (target.webContents.isLoadingMainFrame()) target.webContents.once("did-finish-load", send);
  else send();
}
function openStage(mode) {
  mode = mode === "desktop" ? "desktop" : "world";
  // Reopening a hidden scene resumes it; it does not restart the film.
  if (stage && !stage.isDestroyed() && stageMode === mode) {
    presentation = mode; stage.showInactive();
    stage.webContents.send("scene:visible", true);
    if (mode === "desktop") startWindowPolling();
    ensureComposer(); notifyComposer(); buildMenu();
    return { mode };
  }
  if(stage){cancelChat();mediaController?.detach();}
  closeStage();
  if (wall) { wall.close(); wall = null; }
  const isDesktop = mode === "desktop";
  const geometry = isDesktop ? bounds() : WINDOW_POLICY.worldBounds(workAreaFor(previousWorldBounds), previousWorldBounds);
  const window = new BrowserWindow({
    ...geometry,
    frame: false, hasShadow: !isDesktop, resizable: !isDesktop, movable: !isDesktop,
    maximizable: false, fullscreenable: false, show: false,
    minWidth: isDesktop ? undefined : 360, minHeight: isDesktop ? undefined : 203,
    skipTaskbar: true, alwaysOnTop: true, transparent: isDesktop,
    backgroundColor: isDesktop ? "#00000000" : "#04070f",
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" },
  });
  stage = window; stageMode = currentMode = mode; presentation = mode;
  window.setAlwaysOnTop(true, "floating");
  if (isDesktop) {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    window.setIgnoreMouseEvents(true, { forward: true });
  } else {
    window.setAspectRatio(16 / 9);
    const rememberBounds = () => { previousWorldBounds = window.getBounds(); };
    window.on("move", rememberBounds); window.on("resize", rememberBounds);
  }
  // world 模式进小屋；desktop 模式仍是 Q 版叠在桌面上（world.html）。
  // 两者共用这个窗口和 preload，只是页面不同。
  if (isDesktop) window.loadFile(WORLD_PAGE, { query: { mode } });
  else window.loadURL(ROOM_PAGE);
  window.webContents.on("did-finish-load", () => {
    if (stage !== window) return;
    window.webContents.send("character:mode", { mode });
    if (isDesktop) window.webContents.send("character:size", desktopSize);
    window.webContents.send("character:session", { mode, turns: SESSION.recent(20) });
    window.webContents.send("scene:visible", presentation === mode);
    if (presentation === mode) window.showInactive();
  });
  window.on("closed", () => { if (stage === window) { stage = null; stageMode = null; presentation = "hidden"; buildMenu(); } });
  if (isDesktop) startWindowPolling(); else stopWindowPolling();
  ensureComposer(); notifyComposer(); buildMenu();
  return { mode, voice: ((getPersonaObj().voiceProfiles || {})[mode] || {}).label || "?" };
}
function goDormant() {
  cancelChat();mediaController?.detach();
  stopWindowPolling();
  sendToScene("scene:visible", false); sendToScene("character:stop-voice");
  if (stage && !stage.isDestroyed()) stage.hide();
  if (wall && !wall.isDestroyed()) wall.hide();
  presentation = "hidden"; buildMenu();
  return { mode: "dormant" };
}
function showWallpaper() {
  cancelChat();mediaController?.detach();
  closeStage();
  if (!wall || wall.isDestroyed()) createWall();
  wall.showInactive(); wall.webContents.send("scene:visible", true);
  currentMode = "world"; presentation = "wallpaper";
  ensureComposer(); notifyComposer(); buildMenu();
}
function setSceneVideo(state) {
  if (presentation === "hidden" || currentMode !== "world") openStage("world");
  sendToScene("scene:video", state);
}
// Exactly one audio owner: the visible character scene. The chat window only renders text.
function pushToCharacter(payload) { sendToScene("character:say", payload); }

function buildMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "深蓝 · 鲸鱼娘", enabled: false },
      { type: "separator" },
      { label: (stageMode === "world" ? "● " : "　") + "进入她的小屋  ⌥⌘1", click: () => openStage("world") },
      { label: (stageMode === "desktop" ? "● " : "　") + "召唤她到桌面  ⌥⌘2", click: () => openStage("desktop") },
      { label: "桌宠大小", submenu: [
        { label: "小巧 · 140", type: "radio", checked: desktopSize === 140, click: () => setDesktopSize(140) },
        { label: "标准 · 180", type: "radio", checked: desktopSize === 180, click: () => setDesktopSize(180) },
        { label: "稍大 · 220", type: "radio", checked: desktopSize === 220, click: () => setDesktopSize(220) },
      ] },
      { label: "收起角色  Esc", enabled: presentation !== "hidden", click: () => goDormant() },
      { label: "设为桌面背景", click: showWallpaper },
      { label: "视频姿态", submenu: [
        { label: "正常陪伴", click: () => setSceneVideo("idle") },
        { label: "趴着陪我", click: () => setSceneVideo("quiet") },
        { label: "回床上睡觉", click: () => setSceneVideo("sleep") },
      ] },
      { label: "和她说话  ⌥⌘J", click: () => toggleComposer(!composerExpanded) },
      // 语音唤醒是「麦克风常开」的功能，必须给一个能关的入口 ——
      // 打开麦克风是隐私决定，不该只藏在面板里的一个按钮上。
      { label: (wakeEnabled ? "● " : "　") + "语音唤醒 · 叫名字就能聊", click: () => setWakeEnabled(!wakeEnabled) },
      { label: "唱歌 · 曲库", click: () => openCompanionPanel('singing') },
      { label: "读书 · 导入与续读", click: () => openCompanionPanel('reading') },
      ...(contentPages ? [
        { label: "相册与剧情", click: () => contentPages.open("gallery") },
        { label: "她记得的事", click: () => contentPages.open("memory") },
      ] : []),
      { type: "separator" },
      { label: "开机时自动启动", type: "checkbox", checked: login, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
      { label: "退出", role: "quit" },
    ])
  );
}

app.whenReady().then(() => {
  // 小屋的静态资源服务：
  //   lanroom://app/<web 下的相对路径>   房间本身、模型、随包照片
  //   lanroom://album/<文件名>           用户自己加进相册的照片
  // 两个根都只读、都拦穿越。图片单独走 album 主机名，是因为用户照片必须放在
  // 数据目录（重装/重建 App 不丢），而数据目录不能整个暴露给页面。
  try {
    const WEB_ROOT = path.join(__dirname, "web");
    const serve = (root, rel) => {
      const target = path.normalize(path.join(root, rel));
      if (target !== root && !target.startsWith(root + path.sep)) return null;
      return target;
    };
    protocol.handle(LANROOM_SCHEME, (request) => {
      let url = null;
      try { url = new URL(request.url); } catch (_) { return new Response("bad url", { status: 400 }); }
      let rel = "";
      try { rel = decodeURIComponent(url.pathname); } catch (_) { return new Response("bad url", { status: 400 }); }
      if (url.hostname === "album") {
        const file = path.basename(rel);          // 只认文件名，不认子目录
        if (!/^[A-Za-z0-9-]+\.(jpg|jpeg|png|webp|gif)$/i.test(file)) return new Response("forbidden", { status: 403 });
        const root = ALBUM_IMAGES();
        const target = serve(root, "/" + file);
        if (!target) return new Response("forbidden", { status: 403 });
        return net.fetch(pathToFileURL(target).toString());
      }
      const target = serve(WEB_ROOT, rel);
      if (!target) return new Response("forbidden", { status: 403 });
      return net.fetch(pathToFileURL(target).toString());
    });
  } catch (error) { console.warn("[room] 小屋协议注册失败：" + (error && error.message)); }
  // 采集搬到渲染进程后，Chromium 每次 getUserMedia 都会先问一遍权限。
  // Electron 默认把 media 一律放行，对常驻桌面应用来说太宽：这里只认本应用
  // 自己的窗口，并且只认音频——不能顺带把摄像头也开出来。
  try {
    const { session } = require("electron");
    const ownWindow = (contents) => !!contents &&
      (contents === composer?.webContents || contents === stage?.webContents);
    const audioOnly = (types) => types.length > 0 && types.every((type) => type === "audio");
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission !== "media") return callback(false);
      callback(ownWindow(contents) && audioOnly((details && details.mediaTypes) || []));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => {
      if (permission !== "media" || !ownWindow(contents)) return false;
      const type = details && details.mediaType;
      return !type || type === "audio";
    });
  } catch (error) { console.warn("[voice] 麦克风权限策略安装失败：" + (error && error.message)); }
  // 先把 TTS 服务确认一遍：它在不在只影响音色质量，不该让功能报错。
  try { ensureTtsServer(); } catch (_) {}
  // 语音唤醒：常驻监听住在对话窗里，所以这个窗口要开机就存在（显示为不显示）。
  // 延后 1.2 秒，让舞台先画出来，别让一个隐藏窗口跟启动动画抢首帧。
  setTimeout(() => { if (wakeEnabled) prewarmComposer(); }, 1200);
  // 她的旅行：按真实时间对账，app 关着的时候也照样"出去过"
  try { startJourneyClock(); } catch (_) {}
  // 她自己也会变：app 关着的这段时间，性格会往原位漂一点（一天最多记一次）。
  try { soul().settle(); } catch (_) {}
  // 相册/剧情与记忆管理：独立窗口，失败只影响这两页，不阻断主舞台。
  try {
    contentPages = createContentPages({
      dataDir: DATA.dir,
      contentDir: path.join(__dirname, "web", "live2d", "companion-content"),
      preload: PRELOAD,
      BrowserWindow, ipcMain, dialog,
      parent: () => stage,
    });
    contentPages.register();
  } catch (error) {
    console.warn("[content] " + (error && error.message || error));
  }
  // 渲染验收：LAN_CONTENT_PROBE=1 时截相册/记忆页后退出，不影响正常启动。
  if (process.env.LAN_CONTENT_PROBE === "1" && contentPages) {
    const out = process.env.LAN_CONTENT_PROBE_OUT || path.join(require("os").tmpdir(), "content-probe");
    (async () => {
      try {
        // 世界窗先截：关系称呼只在启动后 6 秒内出现，排在内容页后面会错过。
        // 探针块比 openStage 先执行，这里等舞台窗口创建出来。
        if (process.env.LAN_CONTENT_PROBE_WORLD === "1") {
          for (let waited = 0; waited < 5000 && (!stage || stage.isDestroyed()); waited += 100) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          if (stage && !stage.isDestroyed()) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            const image = await stage.webContents.capturePage();
            fs.writeFileSync(out + "-world.png", image.toPNG());
            if (process.env.LAN_CONTENT_PROBE_TOUCH === "1") {
              // 触摸片段约 8 秒；中段截一张，尾部淡出后再截一张，验证锚点静帧接住。
              setSceneVideo("touch");
              await new Promise((resolve) => setTimeout(resolve, 3000));
              fs.writeFileSync(out + "-touch-mid.png", (await stage.webContents.capturePage()).toPNG());
              await new Promise((resolve) => setTimeout(resolve, 4700));
              fs.writeFileSync(out + "-touch-fade.png", (await stage.webContents.capturePage()).toPNG());
              await new Promise((resolve) => setTimeout(resolve, 700));
              fs.writeFileSync(out + "-touch-end.png", (await stage.webContents.capturePage()).toPNG());
            }
          }
        }
        await contentPages.capture("gallery", out + "-gallery.png");
        // 同一窗口已存在时 capture 会复用；章节图需要新窗口，先等前一张关窗。
        await new Promise((resolve) => setTimeout(resolve, 300));
        await contentPages.capture("gallery", out + "-chapters.png", "chapters");
        await new Promise((resolve) => setTimeout(resolve, 300));
        await contentPages.capture("memory", out + "-memory.png");
        if (process.env.LAN_CONTENT_PROBE_NARROW === "1") {
          await new Promise((resolve) => setTimeout(resolve, 300));
          await contentPages.capture("gallery", out + "-narrow.png", null, { width: 640, height: 360 });
        }
        console.log("[content-probe] " + out);
        app.exit(0);
      } catch (error) {
        console.error("[content-probe] " + (error && error.message || error));
        app.exit(1);
      }
    })();
  }
  if (app.dock) app.dock.hide();
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("🐋");
  tray.setToolTip("深蓝 · 鲸鱼娘");
  buildMenu();
  openStage("world");
  // 全局快捷键：⌥⌘1 她的世界 / ⌥⌘2 召唤到桌面 / ⌥⌘K 开关
  const { globalShortcut } = require("electron");
  globalShortcut.register("Alt+Command+1", () => openStage("world"));
  globalShortcut.register("Alt+Command+2", () => openStage("desktop"));
  globalShortcut.register("Alt+Command+K", () => { presentation !== "hidden" ? goDormant() : openStage("desktop"); });
  globalShortcut.register("Alt+Command+J", () => toggleComposer(!composerExpanded));
  app.on("will-quit", () => globalShortcut.unregisterAll());
  const withTimeout = (p, ms, fallback) => {
    let timer;
    return Promise.race([p,new Promise(resolve=>{timer=setTimeout(()=>resolve(fallback),ms);})]).finally(()=>clearTimeout(timer));
  };
  ipcMain.handle("companion:chat", async (e, { text, history, voice }) => {
    if (typeof text !== "string" || !text.trim() || text.length > 4000) return { text: "消息为空或太长了。", via: "none" };
    if (presentation === "hidden") openStage(currentMode);
    const message=text.trim();
    if(/^(?:请|给我|帮我|你)?唱(?:一?首)?歌(?:吧|听听)?[。！!~～]?$/.test(message)){
      cancelChat();openCompanionPanel('singing');
      const song=covers().snapshot().songs[0];
      if(song)media().playAudio(covers().audio(song.id));
      return {text:song?'开始唱《'+song.title+'》。曲库里可以暂停或停止。':'翻唱面板已打开。先选择原曲，制作完成后就能听她唱。',via:'companion',voice:null};
    }
    if(/^(?:请|给我|帮我|你)?(?:读书|念书|读给我听)(?:吧)?[。！!~～]?$/.test(message)){
      openCompanionPanel('reading');return {text:'读书面板已打开。点「打开电子书」选择 TXT / Markdown / EPUB，或粘贴文字，就可以朗读和续读。',via:'companion',voice:null};
    }
    cancelChat();mediaController?.stop();
    const t0 = Date.now();
    sendToScene("character:activity", "thinking");
    const controller=new AbortController();
    const request = { cancelled:false,controller,signal:controller.signal,detachedVoice:true,
      // voice：这一条来自语音转写。只影响提示词，不影响链路。
      voice:!!voice,
      onVoice:p=>{if(!request.cancelled&&!e.sender.isDestroyed())e.sender.send('composer:voice',p);},
      // 流式文字：让她的话一个字一个字出现在输入框里，别等整段。
      // 节流已经在 streamChat 里做过，这里只管转发。
      onText:text=>{if(!request.cancelled&&!e.sender.isDestroyed())e.sender.send('chat:stream',{text});},
    };
    currentChatRequest=request;
    try {
      const r = await withTimeout(llmChat(message, history, request), 20000, { text: "模型连接超时，请稍后再试。", voice: null, via: "timeout", timedOut: true });
      if (r.timedOut) {request.cancelled=true;controller.abort();}
      r.ms = Date.now() - t0;
      // 真实聊天成功才加好感（冷却由 pack.affection.chatCooldown 控制）；超时/失败不算。
      if (!r.timedOut && r.text) { contentPages?.bump("chat"); feelSoul("chat"); }
      return r;
    } finally {if(currentChatRequest===request)sendToScene("character:activity", "idle");}
  });
  ipcMain.handle("composer:toggle", (e, expanded) => {
    if (e.sender !== composer?.webContents) return { expanded: composerExpanded };
    return toggleComposer(expanded);
  });
  ipcMain.on("character:stop-voice", () => {cancelChat();mediaController?.stop();});
  ipcMain.on("character:tap", () => { contentPages?.bump("touch"); feelSoul("touch"); });
  // query 可选：面板的搜索框透传过来，空查询返回整个曲库
  ipcMain.handle('companion:library',(e,query)=>media().library(query));
  ipcMain.handle('companion:journey',()=>journeys().snapshot());
  // ── 灵魂 / 花园 / 钓鱼 / 小屋 ──────────────────────────────────
  // 只认自己的两个窗口（和麦克风权限同一口径），失败一律返回 {ok:false}
  // 而不是把异常抛过 IPC —— 渲染层拿到的是一个能直接显示的对象。
  const ownSender = (e) => !!e && !!e.sender && !e.sender.isDestroyed() &&
    (e.sender === composer?.webContents || e.sender === stage?.webContents);
  const homesteadHandle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => {
    if (!ownSender(e)) return { ok: false, error: '无效窗口' };
    try { return fn(...args); } catch (error) { return { ok: false, error: String((error && error.message) || error) }; }
  });
  homesteadHandle('soul:snapshot', () => ({ ok: true, ...soul().snapshot() }));
  homesteadHandle('soul:note', (text) => soul().note(text));
  homesteadHandle('homestead:snapshot', () => ({
    ok: true, soul: soul().snapshot(), garden: garden().snapshot(),
    fishing: fishing().snapshot(), room: roomPlan().snapshot(),
  }));
  homesteadHandle('garden:plant', (p = {}) => garden().plant(p.plot, p.species));
  homesteadHandle('garden:water', (p = {}) => garden().water(p.plot));
  homesteadHandle('garden:harvest', (p = {}) => garden().harvest(p.plot, Date.now(), { receiptId: p.receiptId || null }));
  homesteadHandle('garden:clear', (p = {}) => garden().clear(p.plot));
  homesteadHandle('fishing:cast', (p = {}) => {
    const result = fishing().cast({ spot: p.spot, weather: p.weather || 'clear' });
    // 钓上来就记一笔：钓鱼是她的性情来源之一。
    if (result.ok) feelSoul('fish');
    return result;
  });
  homesteadHandle('fishing:take', (p = {}) => fishing().take(p.fish, p.count || 1));
  homesteadHandle('room:snapshot', () => ({ ok: true, ...roomPlan().snapshot() }));
  homesteadHandle('room:apply', (p = {}) => roomPlan().apply(p.plan, { receiptId: p.receiptId || null }));
  ipcMain.handle('companion:cover',async(e,p={})=>{
    if(e.sender!==composer?.webContents)return {ok:false,error:'无效窗口'};
    try{
      if(p.action==='choose'){
        const pick=await dialog.showOpenDialog(composer,{title:'打开要翻唱的原曲',properties:['openFile'],filters:[{name:'歌曲音频',extensions:['mp3','wav','m4a','flac','ogg','aac']}]});
        if(pick.canceled)return {ok:false,cancelled:true};covers().select(pick.filePaths[0]);
      }else if(p.action==='start')await covers().start();
      else if(p.action==='preview'){
        await covers().runPreview();
        // 试听做完立刻播：用户点这个按钮要的就是「马上听一耳朵」，不该再让他找播放键。
        if(covers().snapshot().preview){cancelChat();if(presentation==='hidden')openStage(currentMode);media().playAudio(covers().previewAudio());}
      }
      else if(p.action==='preview-play'){cancelChat();if(presentation==='hidden')openStage(currentMode);media().playAudio(covers().previewAudio());}
      else if(p.action==='tune')covers().setTune(p.semitones??null);
      // 换音色不改音高：分析时已经把每个音色的方案算全了，这里只换选哪一档。
      else if(p.action==='voice')covers().setVoice(p.id);
      // 只分离 + 分析，不合成。让用户先看「这首歌该怎么调」再决定做不做。
      else if(p.action==='analyze')await covers().analyze();
      else if(p.action==='cancel')covers().cancel();
      else if(p.action==='play'){const audio=covers().audio(p.id);cancelChat();if(presentation==='hidden')openStage(currentMode);media().playAudio(audio);}
      else if(p.action!=='state')throw new Error('不支持的翻唱操作。');
      return {ok:true,state:covers().snapshot()};
    }catch(error){return {ok:false,error:error.message};}
  });
  app.on('before-quit',()=>coverController?.cancel());

  // 歌姬模式：写词 → 作曲 → （可选）换成她的声音。三个阶段各自能失败，
  // 所以每个动作都只回「现在到哪一步」，由面板决定显示什么。
  ipcMain.handle('companion:vocalist',async(e,p={})=>{
    if(e.sender!==composer?.webContents)return {ok:false,error:'无效窗口'};
    try{
      if(p.action==='draft')vocalists().setDraft(p.patch||{});
      else if(p.action==='write')await vocalists().compose(p.patch||{});
      else if(p.action==='generate')await vocalists().generate(p.patch||{});
      else if(p.action==='dress')await vocalists().dress();
      else if(p.action==='cancel')vocalists().cancel();
      else if(p.action==='play'){
        const audio=vocalists().audio(p.id,p.which==='main'?'main':'auto');
        cancelChat();if(presentation==='hidden')openStage(currentMode);media().playAudio(audio);
      }
      else if(p.action!=='state')throw new Error('不支持的创作操作。');
      // 刚做出来的歌要立刻进曲库：曲库有 1 秒缓存，不主动失效的话
      // 面板紧接着的刷新会读到生成之前的列表。
      if(['generate','dress'].includes(p.action))media().refreshSongs();
      return {ok:true,state:vocalists().snapshot()};
    }catch(error){return {ok:false,error:error.message};}
  });
  app.on('before-quit',()=>vocalistController?.cancel());

  ipcMain.handle('companion:open-book',async e=>{
    // 小屋的书桌阅读器也会点这个按钮：舞台窗口同样有权选书。
    if(!isCompanionWindow(e.sender))return {ok:false,error:'无效窗口'};
    const parentWin = e.sender === composer?.webContents ? composer : (stage && !stage.isDestroyed() ? stage : composer);
    const pick=await dialog.showOpenDialog(parentWin,{title:'打开文本电子书',properties:['openFile'],filters:[{name:'文本电子书',extensions:['txt','md','epub']}]});
    if(pick.canceled)return {ok:false,cancelled:true};
    const result=await new Promise(resolve=>execFile('/usr/bin/python3',[path.join(__dirname,'lib/read-ebook.py'),pick.filePaths[0]],{timeout:20000,maxBuffer:16*1024*1024},(err,out)=>{
      try{resolve(JSON.parse(out));}catch(_){resolve({ok:false,error:'电子书读取失败，请检查文件。'});}
    }));
    if(!result.ok)return result;
    cancelChat();return {ok:true,state:await media().command({action:'import',title:result.title,text:result.text})};
  });

  ipcMain.handle('companion:media',async (e,p)=>{
    // 读书面板在小屋里（舞台窗口），不再只有对话窗能控制播放。
    if(!isCompanionWindow(e.sender))return {ok:false,error:'无效窗口'};
    try{if(!p||typeof p!=='object')throw new Error('无效操作');
      if(['song','read','resume','import','jump','stop'].includes(p.action)){cancelChat(p.action!=='resume');}
      if(['song','read','resume'].includes(p.action)&&presentation==='hidden')openStage(currentMode);
      return {ok:true,state:await media().command(p)};
    }catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.on('media:progress',(e,p)=>{if(e.sender===stage?.webContents||e.sender===wall?.webContents)mediaController?.progress(p||{});});
  /* ── 小屋相册：一份数据，墙上的照片由它决定 ────────────────────────
     state/update/pin/move/remove 直接落到 lib/album.js；只有 add 要走文件
     对话框（渲染进程拿不到真实路径），选完再交给同一套校验。 */
  ipcMain.handle('companion:album', async (e, p) => {
    if (!isCompanionWindow(e.sender)) return { ok: false, error: '无效窗口' };
    const action = p && typeof p === 'object' ? String(p.action || 'state') : 'state';
    try {
      if (action === 'add') {
        const parentWin = e.sender === composer?.webContents ? composer : (stage && !stage.isDestroyed() ? stage : composer);
        const pick = await dialog.showOpenDialog(parentWin, {
          title: '选一张放进相册的照片', properties: ['openFile'],
          filters: [{ name: '照片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
        });
        if (pick.canceled || !pick.filePaths.length) return { cancelled: true };
        album().command({ action: 'add', src: pick.filePaths[0], title: p.title });
      } else {
        album().command(p || { action: 'state' });
      }
      return album().view();
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
  ipcMain.on("scene:video", (e, state) => {
    if (e.sender === stage?.webContents && ["idle", "quiet", "sleep", "pause"].includes(state)) sendToScene("scene:video", state);
  });
  // ── 双世界：召唤她到桌面 / 让她回去休息 ──
  ipcMain.handle("companion:windows", async () => winCache);
  ipcMain.handle("companion:world", async () => openStage("world"));
  ipcMain.handle("companion:summon", async () => openStage("desktop"));
  ipcMain.handle("companion:return", async () => goDormant());
  // 渲染层按 Esc / 点空白 请求回到休眠
  ipcMain.on("stage:dormant", () => goDormant());
  // 萌娘模式鼠标命中：角色或输入框上才接收点击，其余穿透
  ipcMain.on("stage:hit", (e, interactive) => {
    if (!stage || stage.isDestroyed()) return;
    if (stageMode !== "desktop" || e.sender !== stage.webContents) return;
    try { stage.setIgnoreMouseEvents(!interactive, { forward: true }); } catch (err) {}
  });
  // 角色窗开关（兼容旧调用）
  ipcMain.handle("companion:toggle-character", async () => {
    if (stageMode === "desktop") { goDormant(); return { open: false }; }
    openStage("desktop");
    return { open: true };
  });
  // 屏幕视觉：她能看你屏幕
  ipcMain.handle("companion:see", async (e, { question }) => {
    return await withTimeout(lookAtScreen(question), 60000, { ok: false, text: "（看屏幕超时）" });
  });
  // 语音输入（旧路）：固定录 N 秒 → 转文字。
  // 保留作回退：渲染进程拿不到麦克风（权限被拒、无 getUserMedia）时还能用。
  ipcMain.handle("companion:listen", async (e, { seconds }) => {
    if (listening) return { ok: false, err: "正在录音，请稍等。" };
    listening = true;
    if (presentation === "hidden") openStage(currentMode);
    sendToScene("character:activity", "listening");
    try { return await recordAndTranscribe(seconds || 4); }
    finally { listening = false; sendToScene("character:activity", "idle"); }
  });
  // 语音输入（新路）：渲染进程已经用端点检测决定「说完了」，只把音频交给这里转写。
  // 录音本身不进主进程，是为了拿到 WebAudio 的降噪与端点检测——这两样 ffmpeg 给不了。
  ipcMain.handle("companion:transcribe", async (e, payload) => {
    if (e.sender !== composer?.webContents) return { ok: false, err: "无效窗口" };
    const { audio, mime } = payload || {};
    if (!audio || typeof audio.byteLength !== "number" || audio.byteLength < 1000) {
      return { ok: false, err: "没录到声音" };
    }
    if (audio.byteLength > VOICE_MAX_BYTES) return { ok: false, err: "这段太长了，分开说吧。" };
    if (presentation === "hidden") openStage(currentMode);
    sendToScene("character:activity", "thinking");
    try { return await transcribeAudioBuffer(Buffer.from(audio), mime); }
    finally { sendToScene("character:activity", "idle"); }
  });
  // 唤醒总开关的当前值。渲染进程每次加载都问一次：窗口重建后不能自作主张又开麦。
  ipcMain.handle("companion:wake-enabled", () => ({ enabled: wakeEnabled }));
  // 唤醒应答：被叫到名字时先应一声，让用户知道麦克风真的听见了。
  // 这里不走模型 ——「嗯？」是反馈不是回答，为这两个字等一次模型往返（2 秒起）
  // 用户会以为她没反应，转头去点麦克风。直接合成一句固定短句更快也更准。
  ipcMain.handle("companion:wake-ack", async (e, payload) => {
    if (e.sender !== composer?.webContents) return { ok: false, err: "无效窗口" };
    const text = (String((payload && payload.text) || "嗯？").trim() || "嗯？").slice(0, 20);
    const mode = currentMode;
    const seq = ++CHAT_SEQ;
    try {
      const sp = await synthesizeVoice(text, { mode, interactive: true, force: true, wav: true });
      if (!sp.audio) return { ok: false, err: "语音服务没响应" };
      pushToCharacter({ text, emo: "calm", voice: sp.audio, mime: sp.mime, mode, seq });
      return { ok: true, ms: sp.ms, chars: text.length };
    } catch (error) {
      return { ok: false, err: String((error && error.message) || error).slice(0, 80) };
    }
  });
  // 采集期间的角色状态：只接受两个白名单值，别让渲染层随意改舞台。
  ipcMain.on("voice:activity", (e, state) => {
    if (e.sender !== composer?.webContents) return;
    if (state !== "listening" && state !== "idle") return;
    sendToScene("character:activity", state);
  });
  // 主动开口：她先找你说话（借鉴 Open-LLM-VTuber 的 proactive）
  ipcMain.handle("companion:proactive", async () => {
    const d = new Date();
    const h = d.getHours();
    const period = h < 6 ? "凌晨" : h < 11 ? "早上" : h < 14 ? "中午" : h < 18 ? "下午" : h < 23 ? "晚上" : "深夜";
    const prompt = `现在是${period}。你主动开口找用户说话，一句话，20字内，符合你的性格，可以关心他或分享一个小念头。不要问"在吗"。`;
    const r = await withTimeout(llmChat(prompt, [], { noMemory: true, label: "（她主动开口）" }), 40000, { text: "（…）", voice: null });
    return { text: r.text, voice: r.voice || null };
  });
  // 诊断快照：只读，用来证明「三态真的切了 / 快捷键真的注册了 / 语音走的是哪条路」
  ipcMain.handle("companion:diagnostics", async () => {
    const { globalShortcut } = require("electron");
    const p = getPersonaObj();
    const hash = (s) => require("crypto").createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
    const core = IDENTITY.identityCore(p);
    const vw = IDENTITY.voiceProfile(p, "world");
    const vd = IDENTITY.voiceProfile(p, "desktop");
    return {
      currentMode, stageMode, presentation,
      stageBounds: stage && !stage.isDestroyed() ? stage.getBounds() : null,
      composer: { open: !!composer, expanded: composerExpanded },
      wall: !!(wall && !wall.isDestroyed()),
      stage: !!(stage && !stage.isDestroyed()),
      stageVisible: !!(stage && !stage.isDestroyed() && stage.isVisible()),
      stageFocused: !!(stage && !stage.isDestroyed() && stage.isFocused()),
      shortcuts: {
        "Alt+Command+1": globalShortcut.isRegistered("Alt+Command+1"),
        "Alt+Command+2": globalShortcut.isRegistered("Alt+Command+2"),
        "Alt+Command+K": globalShortcut.isRegistered("Alt+Command+K"),
      },
      lastTtsVia: LAST_TTS_VIA,
      ttsInstruct: getTtsInstruct(),
      // 一个身份的实证：两形态的身份段哈希相同，语气段哈希不同。
      identity: {
        name: p.name || "深蓝",
        coreHash: hash(core),
        coreChars: core.length,
        toneHash: { world: hash(IDENTITY.MODE_TONE.world), desktop: hash(IDENTITY.MODE_TONE.desktop) },
        toneDiffers: IDENTITY.MODE_TONE.world !== IDENTITY.MODE_TONE.desktop,
      },
      voices: {
        world: { label: vw.label, source: vw.source, chars: vw.instruct.length, hash: hash(vw.instruct) },
        desktop: { label: vd.label, source: vd.source, chars: vd.instruct.length, hash: hash(vd.instruct) },
        differ: IDENTITY.voicesDiffer(p),
      },
      session: { count: SESSION.count(), lastMode: SESSION.lastMode(), file: SESSION.file },
      windows: winCache.length,
      ttsUrl: TTS_QWEN_URL,
    };
  });
  // 干活模式：走 Hermes（真执行, 慢但能办事）
  ipcMain.handle("companion:work", async (e, { text }) => {
    const t0 = Date.now();
    const r = await withTimeout(hermesChat(text, 180), 230000, { ok: false, text: "（这活太久没干完，我先停了。要我重试吗？）" });
    // 干活结果也念出来（长文本截断, 只念前 200 字）
    const spoken = r.text.replace(/```[\s\S]*?```/g, "（代码见屏幕）").slice(0, 200);
    const sp = r.ok ? await synthesizeVoice(spoken) : { audio: null, via: "none" };
    // 干活的话进会话（不进长期记忆：工具输出会把画像刷成日志）。
    if (r.ok && r.text) SESSION.appendTurn(text, String(r.text).slice(0, 400), { mode: currentMode, via: "hermes" });
    return { text: r.text, voice: sp.audio, tts: sp.via, ok: r.ok, ms: Date.now() - t0 };
  });
  screen.on("display-metrics-changed", () => {
    if (wall) wall.setBounds(bounds());
    if (stage && !stage.isDestroyed()) {
      stage.setBounds(stageMode === "desktop" ? bounds() : WINDOW_POLICY.worldBounds(workAreaFor(stage.getBounds()), stage.getBounds()));
    }
    if (composer && !composer.isDestroyed()) composer.setBounds(WINDOW_POLICY.composerBounds(workAreaFor(composer.getBounds()), composerExpanded, composer.getBounds()));
  });
});

app.on("window-all-closed", () => {}); // 常驻菜单栏，不随窗口关闭退出

// ── DW-02 探针：绕开窗口和 IPC 直接跑身份 / 会话 / 语音三条链路 ──────────
// 本机常处于锁屏态，截图全黑、点不到按钮，所以验收只能看数据结构而不是画面。
// 放在文件末尾执行，确保 currentMode 等 let 声明已经初始化。
if (process.env.LAN_PROBE2) {
  const P2 = process.env.LAN_PROBE2;
  const pmode = process.env.LAN_PROBE_MODE === "desktop" ? "desktop" : "world";
  currentMode = pmode;
  const emit = (o) => console.log(JSON.stringify(o));
  const h = (s) => require("crypto").createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
  const commonPrefix = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  };
  // 会写长期记忆的探针只许跑在显式目录里：对着真实目录误跑一次就污染她的记忆。
  if (P2 === "turn" && !DATA.explicit) {
    emit({ probe: P2, error: "这个探针会写记忆，必须显式指定 LAN_DATA_DIR" });
    app.exit(2);
  } else (async () => {
    const p = getPersonaObj();
    if (P2 === "identity") {
      const core = IDENTITY.identityCore(p);
      const sysW = IDENTITY.buildSystemPrompt({ persona: p, mode: "world", memory: "" });
      const sysD = IDENTITY.buildSystemPrompt({ persona: p, mode: "desktop", memory: "" });
      const vw = IDENTITY.voiceProfile(p, "world");
      const vd = IDENTITY.voiceProfile(p, "desktop");
      emit({
        probe: "identity", personaName: p.name || null,
        coreChars: core.length, coreHash: h(core),
        sharedPrefixChars: commonPrefix(sysW, sysD).length,
        systemsDiffer: sysW !== sysD,
        worldToneChars: sysW.length - core.length, desktopToneChars: sysD.length - core.length,
        worldVoice: { label: vw.label, source: vw.source, hash: h(vw.instruct) },
        desktopVoice: { label: vd.label, source: vd.source, hash: h(vd.instruct) },
        voicesDiffer: IDENTITY.voicesDiffer(p),
        malfoyInCore: /malfoy|马尔福/i.test(core),
        dataDir: DATA.dir,
      });
    } else if (P2 === "session") {
      emit({
        probe: "session", mode: pmode, dataDir: DATA.dir,
        count: SESSION.count(), lastMode: SESSION.lastMode(),
        turns: SESSION.recent(20).map((e) => ({
          role: e.role, mode: e.mode || null, via: e.via || null,
          chars: e.content.length, sha: h(e.content),
        })),
      });
    } else if (P2 === "say") {
      const text = process.env.LAN_PROBE_TEXT || "今天海面很静，我在这儿。";
      const sp = await synthesizeVoice(text);
      let bytes = 0;
      if (sp.audio && process.env.LAN_PROBE_OUT) {
        const buf = Buffer.from(sp.audio, "base64");
        try { fs.writeFileSync(process.env.LAN_PROBE_OUT, buf); bytes = buf.length; } catch (e) {}
      }
      emit({
        probe: "say", mode: pmode, via: sp.via, ms: sp.ms, bytes,
        textChars: text.length, instructHash: h(getTtsInstruct()), instructChars: getTtsInstruct().length,
        lastTtsVia: LAST_TTS_VIA,
      });
    } else if (P2 === "race") {
      // 叠播验证：先发一个慢的，再发一个快的。慢的那个晚到，必须被丢掉 ——
      // 否则用户会先听到新回答，再被旧回答打断，而且两句可能互相矛盾。
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const pOld = llmChat("第一个问题（慢）", [], { noMemory: true, label: "（旧）" });
      await sleep(80);
      const pNew = llmChat("第二个问题（快）", [], { noMemory: true, label: "（新）" });
      const [a, b] = await Promise.all([pOld, pNew]);
      emit({
        probe: "race",
        oldSuperseded: !!a.superseded, oldTts: a.tts || null,
        newSuperseded: !!b.superseded, newTts: b.tts || null,
        newVoiceBytes: b.voice ? Buffer.from(b.voice, "base64").length : 0,
      });
    } else if (P2 === "turn") {
      const t0 = Date.now();
      const r = await llmChat(process.env.LAN_PROBE_TEXT || "用一句话说说你现在在哪儿。", []);
      emit({
        probe: "turn", mode: r.mode, via: r.via, tts: r.tts, emo: r.emo,
        superseded: !!r.superseded, textChars: (r.text || "").length, textHash: h(r.text || ""),
        voiceBytes: r.voice ? Buffer.from(r.voice, "base64").length : 0,
        ms: Date.now() - t0, sessionCount: SESSION.count(), memCount: STORE.count(),
      });
    } else {
      emit({ probe: P2, error: "未知探针，可选 identity / session / say / turn" });
    }
    app.exit(0);
  })().catch((e) => { emit({ probe: P2, error: String(e).slice(0, 160) }); app.exit(1); });
}
