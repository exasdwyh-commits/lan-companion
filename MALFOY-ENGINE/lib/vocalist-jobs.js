'use strict';
/**
 * 歌姬模式：让她自己写词、作曲、唱一首不存在的歌。
 *
 * 与 covers 的分工：
 *   - covers    = 「她已经有的歌，换成她的声音」（保留原曲，改音色）
 *   - vocalist  = 「本来没有这首歌，由她造出来」（词、曲、唱都是新的）
 * 两条链路的产物都进同一个曲库，但目录与索引分开：
 * covers/library.json 只认 cover.m4a，原创歌放在 originals/ 下另建 index.json，
 * 免得原创歌被当成「翻唱」出现在错误的分组里。
 *
 * 三段可独立失败：
 *   1. 写词 —— 走本机模型池（main.js 注入）。失败不影响手写。
 *   2. 作曲 —— 走 MiniMax 音乐生成。**不依赖本机 SVC 环境**，没装歌声模型也能出歌。
 *   3. 换成她的声音 —— 可选。把 MiniMax 的成品当「原曲」再走一遍 seed-vc，
 *      所以它才需要本机环境；环境不在时这一档显示为不可用，但歌已经能听。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');

const DEFAULT_ENDPOINT = 'https://api.minimaxi.com/v1/music_generation';
// 3.0 是当前主力，2.6 留作回退：账号权限还没跟上的时候先别整个功能不可用。
const DEFAULT_MODELS = ['music-3.0', 'music-2.6'];
// 官方上限：lyrics 1–3500（3.0 系），prompt 0–2000。按行裁剪，不切半个字。
const LYRICS_MAX = 3400;
const PROMPT_MAX = 1900;
// 一次生成的墙钟上限。实测 3 分钟左右的歌出片在 40–90 秒，给到 5 分钟兜底。
const GENERATE_TIMEOUT_SEC = 300;

/**
 * 这些码是 MiniMax base_resp.status_code，不是 HTTP 状态码（HTTP 经常照样 200）。
 * 只映射真正能指导操作的几个，其余统一回显原文 —— 编造提示比不提示更坏。
 */
const CODE_HINTS = {
  1002: 'MiniMax 限流了，等一两分钟再试',
  1004: 'MiniMax API Key 没配或无效（写进 ~/.hermes/.env 的 MINIMAX_API_KEY）',
  1008: 'MiniMax 账户余额不足',
  1013: 'MiniMax 服务端临时故障，稍后重试',
  1026: '歌词或风格描述触发了内容审核，换个说法再试',
  1027: '歌词或风格描述触发了内容审核，换个说法再试',
  2013: '参数不合规（歌词太短或风格描述为空）',
};

// 官方认的结构标签。模型写词时大小写、连字符、中文混着来，
// 标签写错等于结构信号没了 —— 统一成白名单里的写法。
const TAG_ALIASES = {
  'intro': 'Intro', '前奏': 'Intro',
  'verse': 'Verse', '主歌': 'Verse',
  'prechorus': 'Pre Chorus', 'pre-chorus': 'Pre Chorus', 'pre chorus': 'Pre Chorus', '预副歌': 'Pre Chorus',
  'chorus': 'Chorus', '副歌': 'Chorus',
  'bridge': 'Bridge', '桥段': 'Bridge',
  'interlude': 'Interlude', '间奏': 'Interlude',
  'outro': 'Outro', '尾奏': 'Outro',
  'hook': 'Hook',
  'solo': 'Solo', '间奏solo': 'Solo',
  'inst': 'Inst', 'instrumental': 'Inst',
  'break': 'Break',
  'buildup': 'Build Up', 'build-up': 'Build Up', 'build up': 'Build Up',
  'postchorus': 'Post Chorus', 'post-chorus': 'Post Chorus', 'post chorus': 'Post Chorus',
  'transition': 'Transition',
};

const normKey = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/^\[|\]$/g, '');

/** 把任意写法的结构标签收敛成官方写法。认不出的标签整行丢掉（它是噪音，不是歌词）。 */
function normalizeTags(text) {
  return String(text)
    .split('\n')
    .map((line) => {
      const m = line.match(/^\s*[\[【]([^\]】]{1,24})[\]】]\s*$/);
      if (!m) return line;
      const hit = TAG_ALIASES[normKey(m[1])] || TAG_ALIASES[normKey(m[1]).replace(/[\s-]/g, '')];
      return hit ? `[${hit}]` : '';
    })
    .join('\n');
}

/**
 * 从模型输出里剥出干净的歌词 + 标题。
 * 模型一定会加戏：代码围栏、书名号、开头的「好的」、结尾的解释。
 * 这里只留能直接喂给作曲接口的东西，宁可少一行也不要把解释喂进去。
 */
function parseLyrics(text, fallbackTitle = '') {
  let raw = String(text || '');
  raw = raw.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '');
  let title = '';
  const titled = raw.match(/^[ \t]*(?:标题|歌名|title)[ \t]*[:：][ \t]*(.+)$/im);
  if (titled) {
    title = titled[1].replace(/[《》"'“”]/g, '').trim().slice(0, 60);
    raw = raw.replace(titled[0], '');
  }
  raw = raw
    .replace(/^[ \t]*(?:好的|当然|没问题)[，,。:：].*$/gm, '')
    // 「歌词：」这种引导词不是歌词本体
    .replace(/^[ \t]*(?:歌词|lyrics)[ \t]*[:：][ \t]*$/gim, '')
    .replace(/^[ \t]*[（(][^）)]{0,20}[）)][ \t]*$/gm, '');
  raw = normalizeTags(raw)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: title || String(fallbackTitle || '').slice(0, 60), lyrics: stripTailNoise(raw) };
}

/**
 * 模型几乎一定会在歌词后面补一句「希望你喜欢！」「需要我再改吗」。
 * 直接删最后一行太危险（那可能就是最后一句副歌），所以只认客套话的开头词，
 * 而且只在它是整个末行时才删 —— 宁可偶尔漏一句，也不能把歌吃了。
 */
const TAIL_NOISE = /^(希望|祝(你|愿)?|愿你|如果(你)?(喜欢|需要)|需要我|有什么(需要|问题|想)|这首歌(希望|送给)|请(享受|欣赏)|enjoy|hope (you|this))/i;
function stripTailNoise(lyrics) {
  const lines = String(lyrics).split('\n');
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (!last) { lines.pop(); continue; }
    if (TAIL_NOISE.test(last) && last.length < 60) { lines.pop(); continue; }
    break;
  }
  return lines.join('\n').trim();
}

/** 按行裁到上限，不切半个字；标签行永远保留在前面。 */
function clampLines(text, max) {
  const lines = String(text || '').split('\n');
  let out = '', used = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (used + cost > max) break;
    out += (out ? '\n' : '') + line;
    used += cost;
  }
  return out.trim();
}

/** 校验：歌词至少 10 字（官方下限），且不能只剩标签。 */
function inspectLyrics(text) {
  const lyrics = clampLines(text, LYRICS_MAX);
  const body = lyrics.split('\n').filter((l) => l.trim() && !/^\s*[\[【]/.test(l)).join('');
  const tags = (lyrics.match(/^\s*\[[A-Za-z ]+\]\s*$/gm) || []).length;
  if (body.length < 10) return { ok: false, lyrics, body, tags, error: '歌词太短了，至少写一句完整的（10 个字以上）。' };
  if (!tags) return { ok: false, lyrics, body, tags, error: '至少要有一个结构标签（[Verse] / [Chorus]），否则整首歌会平着唱完。', soft: true };
  return { ok: true, lyrics, body, tags };
}

/** 风格描述清洗：换行会破坏提示词权重，压成一行；太短的补默认值。 */
function inspectStyle(style) {
  const one = String(style || '').replace(/\s+/g, ' ').trim();
  if (one.length < 1) return { ok: false, style: '', error: '写一句风格描述，比如「温暖的民谣，木吉他和弦乐」。' };
  return { ok: true, style: one.slice(0, PROMPT_MAX) };
}

function codeHint(code, msg) {
  const hint = CODE_HINTS[Number(code)];
  return hint ? `${hint}（${code}${msg ? '：' + String(msg).slice(0, 60) : ''}）` : `生成失败（${code}${msg ? '：' + String(msg).slice(0, 80) : ''}）`;
}

/** mp3 → m4a：曲库里所有音源统一是 m4a，播放器不必按格式分支。失败的原始 mp3 保留。 */
function transcodeWith(ffmpeg, folder) {
  const src = path.join(folder, 'song.mp3');
  const dest = path.join(folder, 'song.m4a');
  return new Promise((resolve, reject) => {
    execFile(ffmpeg || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-c:a', 'aac', '-b:a', '192k', dest],
      { timeout: 120000 }, (err) => {
        if (err) return reject(new Error('音频转码失败：' + String(err.message || '').slice(0, 80)));
        try { if (fs.statSync(dest).size < 1000) throw new Error('empty'); } catch (_) { return reject(new Error('转码后的文件是空的。')); }
        resolve(dest);
      });
  });
}

function createVocalistJobs({
  dir, workspace, ffmpeg,
  voiceProfiles,
  writeLyrics,                      // 注入：async ({theme,style}) => string
  publish = () => {},
  secret = () => '',
  request = null,                   // 注入：仅测试用，默认走 curl
  encode = null,                    // 注入：仅测试用，默认 ffmpeg 转码
  spawnJob = spawn,
  killGroup = (pid, signal) => process.kill(-pid, signal),
  now = () => Date.now(),
}) {
  const root = path.join(dir, 'originals');
  const index = path.join(root, 'index.json');
  const draftFile = path.join(root, 'draft.json');
  fs.mkdirSync(root, { recursive: true });

  const endpoint = process.env.MINIMAX_MUSIC_URL || DEFAULT_ENDPOINT;
  const models = [...new Set((process.env.MINIMAX_MUSIC_MODEL || '').trim()
    ? [process.env.MINIMAX_MUSIC_MODEL.trim(), ...DEFAULT_MODELS]
    : DEFAULT_MODELS)];

  let rows = [];
  let draft = { theme: '', style: '', title: '', lyrics: '' };
  let job = null;          // 当前任务
  let song = null;         // 最近一首成品
  let child = null;        // dress 时的 bash
  let curl = null;         // 生成时的 curl
  let cancelled = false;
  let generation = 0;

  try {
    const raw = JSON.parse(fs.readFileSync(index, 'utf8'));
    if (Array.isArray(raw)) {
      rows = raw.filter((r) => r && /^[a-f0-9-]{36}$/.test(String(r.id)))
        .filter((r) => { try { return fs.statSync(path.join(root, r.id, 'song.m4a')).size > 1000; } catch (_) { return false; } });
    }
  } catch (_) { /* 第一次跑，还没有索引 */ }
  try {
    const saved = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
    if (saved && typeof saved === 'object') draft = { ...draft, ...saved };
  } catch (_) { /* 没有草稿 */ }

  const apiKey = () => String(secret('MINIMAX_API_KEY') || '').trim();

  function readiness() {
    if (!apiKey()) {
      return { configured: false, model: models[0], error: '还没配 MiniMax 的 API Key。写进 ~/.hermes/.env 的 MINIMAX_API_KEY=... 就能用。' };
    }
    return { configured: true, model: models[0], error: '' };
  }

  /** 换声档位是否可用。和作曲无关 —— 缺它只是少一个「她本人唱」的版本。 */
  function dressReady() {
    if (!workspace) return { ready: false, error: '没找到本机翻唱环境（scripts/sing_cover_file.sh）。' };
    if (!voiceProfiles) return { ready: false, error: '音色档案还没加载。' };
    const voice = voiceProfiles.currentId() ? voiceProfiles.find(voiceProfiles.currentId()) : voiceProfiles.current();
    if (!voice) return { ready: false, error: '还没有可用的音色。' };
    if (!voice.refPath) return { ready: false, error: `「${voice.name}」还缺一段干净人声参考，放进去才能唱。` };
    return { ready: true, error: '', voice: voice.name };
  }

  function snapshot() {
    const last = song ? songView(rows.find((r) => r.id === song.id) || song) : null;
    return {
      ready: readiness(),
      dress: dressReady(),
      draft: { ...draft },
      job: job ? { id: job.id, status: job.status, error: job.error || null, ...(job.progress ? { progress: { ...job.progress } } : {}) } : null,
      writing: job?.status === 'writing',
      song: last,
      songs: rows.slice(0, 20).map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt || null, duration: r.duration ?? null, her: Boolean(r.her) })),
    };
  }
  function emit() { try { publish(snapshot()); } catch (_) { /* 面板可能已经关了 */ } }

  function saveDraft() {
    try { fs.writeFileSync(draftFile, JSON.stringify(draft, null, 2)); } catch (_) { /* 草稿丢了不致命 */ }
  }
  function saveRows() {
    try { fs.writeFileSync(index + '.tmp', JSON.stringify(rows, null, 2)); fs.renameSync(index + '.tmp', index); } catch (_) { /* 下次启动会重扫目录，索引坏了也不丢音频 */ }
  }

  function songView(row) {
    if (!row) return null;
    const folder = path.join(root, row.id);
    const main = path.join(folder, 'song.m4a');
    const her = path.join(folder, 'her.m4a');
    const hasHer = (() => { try { return fs.statSync(her).size > 1000; } catch (_) { return false; } })();
    return {
      id: row.id,
      title: row.title,
      url: pathToFileURL(main).href,
      herUrl: hasHer ? pathToFileURL(her).href : null,
      lyrics: row.lyrics || '',
      style: row.style || '',
      theme: row.theme || '',
      model: row.model || '',
      duration: row.duration ?? null,
      createdAt: row.createdAt || null,
    };
  }

  // ── 草稿 ──────────────────────────────────────────────────────
  function setDraft(patch = {}) {
    if (job && !['done', 'error', 'cancelled'].includes(job.status)) throw new Error('正在生成，等这首出来或先取消。');
    for (const key of ['theme', 'style', 'title', 'lyrics']) {
      if (typeof patch[key] === 'string') draft[key] = patch[key];
    }
    saveDraft(); emit(); return snapshot();
  }

  /** 让模型写词。主题空了就让她自由发挥 —— 「随便写一首」是合理请求。 */
  async function compose(patch = {}) {
    if (job && !['done', 'error', 'cancelled'].includes(job.status)) throw new Error('正在生成，等这首出来或先取消。');
    if (patch && Object.keys(patch).length) setDraftQuiet(patch);
    if (!writeLyrics) throw new Error('写词能力还没接上。');
    const own = ++generation;
    job = { id: crypto.randomUUID(), status: 'writing' }; emit();
    try {
      const text = await writeLyrics({ theme: draft.theme, style: draft.style });
      if (own !== generation) return snapshot();
      if (!text || !String(text).trim()) throw new Error('她这次没写出东西（模型返回空）。自己写几句也行，或者再点一次。');
      const parsed = parseLyrics(text, draft.theme);
      draft.lyrics = parsed.lyrics;
      draft.title = draft.title || parsed.title;
      saveDraft();
      job = { id: job.id, status: 'done' };
    } catch (error) {
      if (own !== generation) return snapshot();
      job = { id: job.id, status: 'error', error: error.message };
      emit();
      throw error;
    }
    emit(); return snapshot();
  }
  function setDraftQuiet(patch) {
    for (const key of ['theme', 'style', 'title', 'lyrics']) {
      if (typeof patch[key] === 'string') draft[key] = patch[key];
    }
  }

  // ── 生成 ──────────────────────────────────────────────────────
  function cancel() {
    if (!job || ['done', 'error', 'cancelled'].includes(job.status)) return snapshot();
    cancelled = true; generation++;
    const oldBash = child, oldCurl = curl;
    child = null; curl = null;
    if (oldBash) { try { killGroup(oldBash.pid, 'SIGTERM'); } catch (_) {} }
    if (oldCurl) { try { oldCurl.kill('SIGTERM'); } catch (_) {} }
    job = { ...job, status: 'cancelled', error: null };
    emit(); return snapshot();
  }

  async function generate(patch = {}) {
    if (job && !['done', 'error', 'cancelled'].includes(job.status)) throw new Error('上一首还在做，等它出来或先取消。');
    if (patch && Object.keys(patch).length) setDraftQuiet(patch);
    const ready = readiness();
    if (!ready.configured) throw new Error(ready.error);
    const style = inspectStyle(draft.style || '温暖的中文流行，女声，钢琴与弦乐');
    if (!style.ok) throw new Error(style.error);
    const check = inspectLyrics(draft.lyrics);
    // 标签缺失只警告不拦 —— 用户手写的词可能故意不要结构，硬拦会让人没法用。
    if (!check.ok && !check.soft) throw new Error(check.error);
    draft.lyrics = check.lyrics; draft.style = style.style; saveDraft();

    cancelled = false;
    const id = crypto.randomUUID();
    const folder = path.join(root, id);
    fs.mkdirSync(folder, { recursive: true });
    const own = ++generation;
    job = { id, status: 'composing' }; emit();

    const api = request || defaultRequest({ endpoint, timeoutSec: GENERATE_TIMEOUT_SEC });
    let result = null, lastError = null;
    for (const model of models) {
      if (own !== generation || cancelled) return snapshot();
      job = { id, status: 'composing' }; emit();
      let r;
      try {
        r = await api({ key: apiKey(), model, prompt: style.style, lyrics: check.lyrics, endpoint });
      } catch (error) {
        lastError = error; continue;
      }
      if (own !== generation || cancelled) return snapshot();
      if (r && r.ok && r.audio && r.audio.length > 1024) { result = { ...r, model }; break; }
      lastError = new Error(codeHint(r?.code ?? '0', r?.message || r?.raw));
      // 鉴权/余额/审核类错误换模型也一样，直接停，别把同一个错误试三遍。
      if ([1004, 1008, 1026, 1027, 2013].includes(Number(r?.code))) break;
    }
    if (!result) {
      job = { id, status: 'error', error: lastError?.message || '生成失败，没有拿到音频。' };
      emit();
      try { fs.rmSync(folder, { recursive: true, force: true }); } catch (_) {}
      throw lastError || new Error('生成失败。');
    }

    job = { id, status: 'encoding' }; emit();
    try {
      const mp3 = path.join(folder, 'song.mp3');
      fs.writeFileSync(mp3, result.audio);
      const row = {
        id,
        title: (draft.title || draft.theme || '无题').slice(0, 60),
        createdAt: new Date(now()).toISOString(),
        theme: draft.theme || '',
        style: style.style,
        lyrics: check.lyrics,
        model: result.model,
        // 时长优先用接口回报的（毫秒），拿不到再留空 —— 面板会自己隐藏。
        duration: Number.isFinite(result.durationMs) ? Math.round(result.durationMs / 1000) : null,
        her: false,
      };
      await doEncode(folder);
      rows.unshift(row); saveRows();
      song = row; job = { id, status: 'done' }; emit();
      return snapshot();
    } catch (error) {
      job = { id, status: 'error', error: error.message };
      emit(); throw error;
    }
  }

  /** mp3 → m4a：曲库里所有音源统一是 m4a，播放器不必按格式分支。失败的原始 mp3 保留。 */
  const doEncode = encode || ((folder) => transcodeWith(ffmpeg, folder));

  /**
   * 换成她的声音。把刚生成的成品当「原曲」再走一遍 seed-vc 链路 ——
   * 这一步才需要本机歌声模型，缺了也不影响上面已经能听的版本。
   */
  async function dress() {
    if (!song) throw new Error('先生成一首歌。');
    const ready = dressReady();
    if (!ready.ready) throw new Error(ready.error);
    if (child) throw new Error('已经在做她唱版了。');
    const folder = path.join(root, song.id);
    const source = fs.existsSync(path.join(folder, 'song.mp3')) ? path.join(folder, 'song.mp3') : path.join(folder, 'song.m4a');
    if (!fs.existsSync(source)) throw new Error('这首歌的音频文件不见了。');
    const voice = voiceProfiles.currentId() ? voiceProfiles.find(voiceProfiles.currentId()) : voiceProfiles.current();
    const env = {
      ...process.env,
      FFMPEG: ffmpeg || 'ffmpeg',
      WORK: path.join(folder, 'work'),
      KEEP_WORK: '1',
      STEPS: '30',
      REF: voice.refPath,
      VOICE: voice.id || '',
      VOICE_NAME: voice.name || '',
    };
    if (voice.range?.lo) env.VOICE_LO = String(voice.range.lo);
    if (voice.range?.hi) env.VOICE_HI = String(voice.range.hi);
    const python = process.env.SING_PYTHON || path.resolve(workspace, '../.venvs/sing/bin/python');
    if (fs.existsSync(python)) env.SING_PYTHON = python;

    const output = path.join(folder, 'her.m4a');
    cancelled = false;
    const own = ++generation;
    job = { id: song.id, status: 'dressing' }; emit();
    const proc = spawnJob('/bin/bash', [path.join(workspace, 'scripts/sing_cover_file.sh'), source, output], {
      cwd: workspace, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env,
    });
    child = proc;
    let buffer = '';
    proc.stdout.on('data', (data) => {
      if (child !== proc) return;
      buffer += String(data);
      const lines = buffer.split('\n'); buffer = lines.pop().slice(-1000);
      for (const line of lines) {
        const stage = line.match(/^\[([1-4])\/4\]/);
        if (stage) { job = { ...job, status: 'dressing', progress: { stage: Number(stage[1]) } }; emit(); }
        const chunk = line.match(/^\[cover-progress\] chunk=(\d{1,5}) total=(\d{1,5})\r?$/);
        if (chunk) {
          const current = Number(chunk[1]), total = Number(chunk[2]);
          if (current > 0 && current <= total) { job = { ...job, progress: { current, total } }; emit(); }
        }
      }
    });
    // 原始日志一律不留：里面会有源文件路径。
    proc.stderr.on('data', () => {});
    await new Promise((resolve) => {
      proc.once('error', () => resolve());
      proc.once('close', (code) => resolve(code));
    });
    if (child !== proc) return snapshot();
    child = null;
    if (cancelled || own !== generation) { job = { ...job, status: 'cancelled' }; emit(); return snapshot(); }
    let size = 0;
    try { size = fs.statSync(output).size; } catch (_) { size = 0; }
    if (size < 1000) {
      job = { ...job, status: 'error', error: '她唱版没做出来（歌声模型可能还没就绪）。原来的版本还能听。' };
      emit(); return snapshot();
    }
    const row = rows.find((r) => r.id === song.id);
    if (row) { row.her = true; saveRows(); }
    song = row || song;
    job = { id: song.id, status: 'done' }; emit();
    return snapshot();
  }

  /**
   * 播哪个版本。默认「她唱版」优先 —— 用户点播放要听的是她，
   * 生成版是拿来对照的，得显式要（which='main'）。
   */
  function audio(id, which = 'auto') {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error('找不到这首歌。');
    const main = path.join(root, id, 'song.m4a');
    const her = path.join(root, id, 'her.m4a');
    const file = which === 'main' ? main : which === 'her' ? her : (fs.existsSync(her) ? her : main);
    if (!fs.existsSync(file)) throw new Error('这个版本还没生成。');
    return { id: `${id}${which === 'main' ? '' : ':her'}`, title: row.title, url: pathToFileURL(file).href };
  }

  return { snapshot, setDraft, compose, generate, dress, cancel, audio, root, index, inspectLyrics, inspectStyle };
}

/**
 * 默认请求实现。刻意只要一次计费：
 * 先要 url（响应小），万一服务端只给 hex 就当场解码，绝不为了「拿不到 url」再请求一遍。
 */
function defaultRequest({ endpoint, timeoutSec }) {
  return function musicRequest({ key, model, prompt, lyrics }) {
    const body = JSON.stringify({
      model,
      prompt,
      lyrics,
      stream: false,
      output_format: 'url',
      audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
    });
    const args = ['-sS', '-m', String(timeoutSec), '-H', 'Content-Type: application/json',
      '-H', 'Authorization: Bearer ' + key, '-w', '\n%{http_code}', '-d', body, endpoint];
    return new Promise((resolve) => {
      execFile('curl', args, { maxBuffer: 48 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve({ ok: false, code: 'curl', message: '网络请求失败' });
        const lines = String(stdout).split('\n');
        const http = lines.pop().trim();
        let parsed = null;
        try { parsed = JSON.parse(lines.join('\n')); } catch (_) { return resolve({ ok: false, code: http, message: '返回不是 JSON' }); }
        const base = parsed.base_resp || {};
        if (String(http) !== '200' || Number(base.status_code) !== 0) {
          return resolve({ ok: false, code: base.status_code ?? http, message: base.status_msg || '' });
        }
        const audio = parsed.data?.audio;
        if (!audio) return resolve({ ok: false, code: 'empty', message: '返回里没有音频' });
        const extra = parsed.extra_info || {};
        const done = (buffer) => resolve({ ok: true, audio: buffer, durationMs: Number(extra.music_duration) || null, model });
        if (/^https?:\/\//.test(audio)) {
          return execFile('curl', ['-sS', '-L', '-m', String(timeoutSec), '-o', '-', audio], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (e2, buf) => {
            if (e2 || !buf || buf.length < 1024) return resolve({ ok: false, code: 'download', message: '音频下载失败' });
            done(buf);
          });
        }
        done(Buffer.from(String(audio), 'hex'));
      });
    });
  };
}

module.exports = { createVocalistJobs, parseLyrics, normalizeTags, inspectLyrics, inspectStyle, clampLines, codeHint, DEFAULT_MODELS, TAG_ALIASES };
