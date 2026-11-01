// 离屏渲染悬浮面板实拍：把 composer.html 的某个 tab 渲染成 PNG，用于留证/自查。
// 用法: node scripts/render-panel-preview.js [tab] [输出png] [宽] [高] [state]
//   tab   : chat | singing | reading
//   state : play（默认，一首歌在播）| idle
//
// 为什么要有这个脚本：面板只有 340x440，靠看代码判断"曲库/书架长得怎么样"
// 判断不了。窗口在锁屏会话里截不到，就让 Electron 自己渲染一帧。
//
// 数据用真的：直接调 lib/song-library 与 lib/book-library 读 ~/.smartcompanion，
// 所以曲库里有几首歌、书架上有几本，截出来就是几首。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const [, , tab = 'singing', out = '/tmp/panel.png', W = '340', H = '440', mode = 'play'] = process.argv;

const ROOT = path.join(__dirname, '..');
// PANEL_PAGE 可指向打包产物里的 composer.html，用来确认构建真的把改动带进去了
const PAGE = process.env.PANEL_PAGE || path.join(ROOT, 'MALFOY-ENGINE/web/live2d/composer.html');
const contentDir = path.join(ROOT, 'MALFOY-ENGINE/web/live2d/companion-content');
// PANEL_DATA_DIR 可指向一个空目录，用来看「刚装上、什么都没有」时的空态
const dataDir = process.env.PANEL_DATA_DIR || path.join(os.homedir(), '.smartcompanion');

const { createSongLibrary } = require(path.join(ROOT, 'MALFOY-ENGINE/lib/song-library'));
const { createBookLibrary } = require(path.join(ROOT, 'MALFOY-ENGINE/lib/book-library'));

const songs = createSongLibrary({ dir: dataDir, contentDir })
  .search('').map((s) => ({ ...s, locked: (s.unlockAt || 0) > 0 }));
const books = createBookLibrary({ dir: dataDir }).list();

const nowPlaying = mode === 'play' ? songs.find((s) => !s.locked) || songs[0] : null;
const base = {
  token: 1,
  kind: nowPlaying ? 'singing' : null,
  status: nowPlaying ? 'playing' : 'idle',
  songId: nowPlaying ? nowPlaying.id : undefined,
  title: nowPlaying ? nowPlaying.title : undefined,
  time: 12,
  duration: nowPlaying?.duration || 0,
};
const first = books[0];
const state = {
  ...base,
  book: first ? {
    title: first.title, index: 0, total: first.paragraphs, text: '',
    cast: [], voices: [], mode: 'studio',
    analysis: { status: 'ready', characters: [], chunks: 1, isFiction: true, via: 'deepseek' },
    chapters: [], chapter: -1,
  } : null,
};

const diary = [
  { place: '海边旧灯塔', at: Date.now() - 3600e3, note: '风把盐吹在玻璃上，像一层薄雾。我在台阶上坐了很久，想着你会不会也喜欢这种安静。' },
  { place: '雨后的便利店', at: Date.now() - 7200e3, note: '买了热牛奶。收银的阿姨说"小姑娘一个人啊"，我点点头，其实不是一个人。' },
];

// PANEL_COVER=demo 时喂一份「试听刚做完」的状态，用来检查音域控件长什么样。
const coverState = process.env.PANEL_COVER === 'demo' ? {
  selected: { title: '我好像在哪见过你' },
  job: { status: 'preview-done', kind: 'preview', shift: 6 },
  model: { ready: true }, songs: [],
  // 音色档位：孙燕姿那档故意做成「缺参考」，好看清不可用状态长什么样
  voices: [
    { id: 'magnetic', name: '磁性', tone: '低音厚、略带沙，成熟感最强', usable: true, current: true },
    { id: 'warm', name: '温暖', tone: '中音饱满，明亮度中等', usable: true, current: false },
    { id: 'cool-thick', name: '清冷厚实', tone: '偏冷、有厚度，咬字清楚', usable: true, current: false },
    { id: 'sunyanzi', name: '孙燕姿', tone: '锥形波明亮，中低音带颗粒感', usable: false, current: false },
  ],
  // 真实跑出来的报告：A# 小调 / 123 BPM / 音域 18.2 个半音
  analysis: {
    duration: 279.15, tempo: 123,
    key: { label: 'A# 小调' },
    vocal: { p05: 115.2, p50: 232.5, p90: 329.1, span: 18.2 },
    advice: ['节奏和速度不用调：变调用 asetrate + atempo 补偿，伴奏时长与源严格相等。'],
  },
  tune: {
    semitones: null, applied: 6, recommended: 6, floor: 165, keyAfter: 'E 小调', conflict: false,
    reason: '原唱低音区 115Hz，该音色实唱下界约 165Hz，升 6 个半音（+6.2 取整）。',
    source: { p05: 115.2, p50: 232.5, p90: 329.1 },
  },
  preview: { semitones: 6, url: 'file:///tmp/cover-shift6.m4a' },
} : { selected: null, job: null, model: { ready: true }, songs: [], voices: [], analysis: null, tune: { semitones: null } };

// PANEL_VOCALIST=demo 时喂一份「刚做完一首原创」的状态：结果块、两个版本、
// 歌词折叠区都会展开，用来确认歌姬这一块在 340 宽的面板里排得下。
const vocalistState = process.env.PANEL_VOCALIST === 'demo' ? {
  ready: { configured: true, model: 'music-3.0', error: '' },
  dress: { ready: true, error: '', voice: '磁性' },
  draft: {
    theme: '海边的清晨',
    style: '温暖的民谣，木吉他与弦乐，女声',
    title: '海的信',
    lyrics: '[Verse]\n潮水把沙子写成字\n一行行都没寄出去\n风把它们念给我听\n\n[Chorus]\n我在海边等你\n等到月亮掉进海里',
  },
  job: { status: 'done' },
  song: {
    id: 'demo-vocalist', title: '海的信', url: 'file:///tmp/song.m4a', herUrl: 'file:///tmp/her.m4a',
    lyrics: '[Verse]\n潮水把沙子写成字\n一行行都没寄出去\n风把它们念给我听\n\n[Chorus]\n我在海边等你\n等到月亮掉进海里',
    style: '温暖的民谣，木吉他与弦乐，女声', theme: '海边的清晨', model: 'music-3.0', duration: 187,
  },
  songs: [],
} : null;

const payload = JSON.stringify({
  library: { songs, books, currentBookId: first?.id || null, query: '', ...state },
  state,
  diary,
  cover: coverState,
  vocalist: vocalistState,
});

const preload = path.join(os.tmpdir(), `panel-mock-${process.pid}.js`);
fs.writeFileSync(preload, `
const data = ${payload};
const noop = () => {};
window.malfoyHost = {
  library: async () => data.library,
  media: async () => ({ ok: true, state: data.state }),
  journey: async () => ({ diary: data.diary }),
  cover: async () => ({ ok: true, state: data.cover }),
  vocalist: async () => ({ ok: true, state: data.vocalist }),
  openBook: async () => ({ ok: false, cancelled: true }),
  composerToggle: async () => ({ expanded: true }),
  chat: async () => ({ text: '' }),
  onMediaState: noop, onJourneyState: noop, onCoverState: noop, onComposerTab: noop,
  onVocalistState: (cb) => { data.vocalist && cb(data.vocalist); },
  onComposerState: noop, onComposerVoice: noop, onCharacterSay: noop, onCharacterMode: noop,
  onCharacterSession: noop, onStopVoice: noop,
  stopVoice: noop, tap: noop, setHover: noop, mediaProgress: noop,
};
`);

// 这台机器上 GPU 进程起不来（沙箱里 seatbelt 初始化被拒），
// 软件合成足以渲染面板；必须在 ready 之前关掉硬件加速。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: Number(W), height: Number(H), show: true, frame: false, useContentSize: true,
    backgroundColor: '#dfe9f2',
    // 关掉上下文隔离，preload 里挂的 window.malfoyHost 才能被页面脚本看到（只为预览）
    webPreferences: { preload, contextIsolation: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  await win.loadFile(PAGE);
  await new Promise((r) => setTimeout(r, 500));
  await win.webContents.executeJavaScript(`
    document.body.classList.add('expanded');
    document.querySelector('[data-tab="${tab}"]').click();
    1
  `, true);
  await new Promise((r) => setTimeout(r, 700));
  if (process.env.PANEL_COVER === 'demo') {
    // 音域控件在「让她学一首新歌」折叠区里，默认在可视区之外。
    await win.webContents.executeJavaScript(`
      const studio = document.getElementById('cover-studio');
      if (studio) { studio.open = true; studio.scrollIntoView({ block: 'end' }); }
      1
    `, true);
    await new Promise((r) => setTimeout(r, 500));
  } else if (process.env.PANEL_VOCALIST === 'demo') {
    // 歌姬模式同理：它在「让她写一首新歌」折叠区里，默认不在可视区。
    await win.webContents.executeJavaScript(`
      const v = document.getElementById('vocalist');
      if (v) { v.open = true; v.scrollIntoView({ block: 'end' }); }
      1
    `, true);
    await new Promise((r) => setTimeout(r, 500));
  } else {
    await new Promise((r) => setTimeout(r, 200));
  }
  const img = await win.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('saved', out, img.getSize(), 'songs=' + songs.length, 'books=' + books.length);
  try { fs.unlinkSync(preload); } catch (_) {}
  app.quit();
});
