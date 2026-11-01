const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("malfoyHost", {
  cover: (p) => ipcRenderer.invoke('companion:cover',p),
  onCoverState: (cb) => ipcRenderer.on('cover:state',(_e,p)=>cb(p)),
  openBook: () => ipcRenderer.invoke('companion:open-book'),
  // 歌姬模式：写词 → 作曲 → 换成她的声音
  vocalist: (p) => ipcRenderer.invoke('companion:vocalist',p),
  onVocalistState: (cb) => ipcRenderer.on('vocalist:state',(_e,p)=>cb(p)),
  library: (query) => ipcRenderer.invoke('companion:library', query),
  journey: () => ipcRenderer.invoke('companion:journey'),
  media: (command) => ipcRenderer.invoke('companion:media',command),
  mediaProgress: (state) => ipcRenderer.send('media:progress',state),
  onMediaState: (cb) => ipcRenderer.on('media:state',(_e,p)=>cb(p)),
  onJourneyState: (cb) => ipcRenderer.on('journey:state',(_e,p)=>cb(p)),
  onSceneMedia: (cb) => ipcRenderer.on('scene:media',(_e,p)=>cb(p)),
  onComposerTab: (cb) => ipcRenderer.on('composer:tab',(_e,p)=>cb(p)),
  onComposerVoice: (cb) => ipcRenderer.on('composer:voice',(_e,p)=>cb(p)),
  // 流式回复的逐字推送。返回取消订阅：一次提问结束后必须摘掉，
  // 否则下一轮的文字会同时写进上一轮那个已经结束的段落里。
  onChatStream: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('chat:stream', handler);
    return () => ipcRenderer.removeListener('chat:stream', handler);
  },
  composerToggle: (expanded) => ipcRenderer.invoke("composer:toggle", !!expanded),
  stopVoice: () => ipcRenderer.send("character:stop-voice"),
  setVideoMode: (state) => ipcRenderer.send("scene:video", state),
  onComposerState: (cb) => ipcRenderer.on("composer:state", (_e, p) => cb(p)),
  onSceneVideo: (cb) => ipcRenderer.on("scene:video", (_e, p) => cb(p)),
  onDesktopSize: (cb) => ipcRenderer.on("character:size", (_e, p) => cb(p)),
  onSceneVisible: (cb) => ipcRenderer.on("scene:visible", (_e, p) => cb(p)),
  onCharacterActivity: (cb) => ipcRenderer.on("character:activity", (_e, p) => cb(p)),
  onStopVoice: (cb) => ipcRenderer.on("character:stop-voice", () => cb()),
  exitInteractive: () => ipcRenderer.send("exit-interactive"),
  // opts 可选：{ voice:true } 表示这条来自语音转写，主进程会补一句「按意思理解」的提示。
  chat: (text, history, opts) => ipcRenderer.invoke("companion:chat", { text, history, voice: !!(opts && opts.voice) }),
  work: (text) => ipcRenderer.invoke("companion:work", { text }),
  proactive: () => ipcRenderer.invoke("companion:proactive"),
  listen: (seconds) => ipcRenderer.invoke("companion:listen", { seconds }),
  // 采集在渲染进程做完（端点检测），主进程只负责把这段音频送去转写。
  transcribe: (audio, mime) => ipcRenderer.invoke("companion:transcribe", { audio, mime }),
  // 被叫到名字时先应一声（不走模型，直接合成固定短句）。
  wakeAck: (text) => ipcRenderer.invoke("companion:wake-ack", { text }),
  // 菜单里的「语音唤醒」开关。关掉要真的停止采集，不能只是不再触发。
  onWakeSet: (cb) => ipcRenderer.on("wake:set", (_e, p) => cb(p)),
  wakeEnabled: () => ipcRenderer.invoke("companion:wake-enabled"),
  voiceActivity: (state) => ipcRenderer.send("voice:activity", state),
  see: (question) => ipcRenderer.invoke("companion:see", { question }),
  setHover: (over) => ipcRenderer.send("character:hover", !!over),
  windows: () => ipcRenderer.invoke("companion:windows"),
  // 桌面形态的自我定位：她在哪、屏幕上盖着哪些窗口。主进程据此拼进提示词，
  // 也据此判断她是不是被挡住了。单向 send，不需要回执。
  presence: (p) => ipcRenderer.send("character:presence", p),
  // 主进程让她挪位置（模型在回复里写 [move:left] 时触发）。
  onCharacterMove: (cb) => ipcRenderer.on("character:move", (_e, p) => cb(p)),
  diagnostics: () => ipcRenderer.invoke("companion:diagnostics"),
  enterWorld: () => ipcRenderer.invoke("companion:world"),
  summon: () => ipcRenderer.invoke("companion:summon"),
  dormant: () => ipcRenderer.send("stage:dormant"),
  stageHit: (on) => ipcRenderer.send("stage:hit", !!on),
  returnHome: () => ipcRenderer.invoke("companion:return"),
  toggleCharacter: () => ipcRenderer.invoke("companion:toggle-character"),
  onCharacterMode: (cb) => ipcRenderer.on("character:mode", (_e, p) => cb(p)),
  onCharacterSay: (cb) => ipcRenderer.on("character:say", (_e, payload) => cb(payload)),
  // 换形态时主进程把会话交回来：同一个人的上一段对话，不该因为换了窗口就忘掉。
  onCharacterSession: (cb) => ipcRenderer.on("character:session", (_e, p) => cb(p)),
  gallery: {
    state: () => ipcRenderer.invoke("companion:gallery-state"),
    action: (p) => ipcRenderer.invoke("companion:gallery-action", p),
    savePhoto: (id, variant = "mobile") => ipcRenderer.invoke("companion:gallery-save", { id, variant }),
  },
  // 小屋墙上的相册：state/update/pin/move/remove 都是纯数据，add 会弹文件对话框。
  album: {
    state: () => ipcRenderer.invoke("companion:album", { action: "state" }),
    action: (p) => ipcRenderer.invoke("companion:album", p),
  },
  memory: {
    list: (p) => ipcRenderer.invoke("companion:memory-list", p),
    correct: (p) => ipcRenderer.invoke("companion:memory-correct", p),
    forget: (key) => ipcRenderer.invoke("companion:memory-forget", key),
    clearAll: (p) => ipcRenderer.invoke("companion:memory-clear", p),
  },
  openContent: (kind, tab) => ipcRenderer.invoke("companion:open-content", kind, tab),
  affection: () => ipcRenderer.invoke("companion:affection"),
  touchLine: (kind) => ipcRenderer.invoke("companion:touch-line", kind),
  onAffection: (cb) => ipcRenderer.on("affection:changed", (_e, p) => cb(p)),
  tap: () => ipcRenderer.send("character:tap"),
  // 家园四引擎：花园 / 钓鱼 / 改造 / 浴缸（舞台窗与对话窗都可调）
  homestead: () => ipcRenderer.invoke("homestead:snapshot"),
  garden: {
    plant: (plot, species) => ipcRenderer.invoke("garden:plant", { plot, species }),
    water: (plot) => ipcRenderer.invoke("garden:water", { plot }),
    harvest: (plot, receiptId) => ipcRenderer.invoke("garden:harvest", { plot, receiptId }),
    clear: (plot) => ipcRenderer.invoke("garden:clear", { plot }),
  },
  fishing: {
    cast: (p) => ipcRenderer.invoke("fishing:cast", p || {}),
    take: (fish, count) => ipcRenderer.invoke("fishing:take", { fish, count }),
  },
  aquarium: {
    state: () => ipcRenderer.invoke("aquarium:snapshot"),
    put: (fish) => ipcRenderer.invoke("aquarium:put", { fish }),
    remove: (index) => ipcRenderer.invoke("aquarium:remove", { index }),
  },
  room: {
    state: () => ipcRenderer.invoke("room:snapshot"),
    apply: (plan, receiptId) => ipcRenderer.invoke("room:apply", { plan, receiptId }),
  },
  onRoomChanged: (cb) => ipcRenderer.on("room:changed", (_e, p) => cb(p)),
  intent: {
    peek: () => ipcRenderer.invoke("intent:peek"),
    run: () => ipcRenderer.invoke("intent:run"),
  },
});
