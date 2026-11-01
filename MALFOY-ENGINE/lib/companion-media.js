"use strict";
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const NARRATION = require('./narration');
const { createAudioCache } = require('./audio-cache');
const { createSongLibrary } = require('./song-library');
const { createBookLibrary } = require('./book-library');

const MAX_TEXT = 2000000;
const MAX_PARA_TEXT = 400;
const MAX_SEG_SAY = 400;
const MAX_CHAPTERS = 500;

/** 兼容旧调用：纯文本 → 朗读段落（已经过读音规范化）。 */
function paragraphs(text) {
  return NARRATION.splitParagraphs(NARRATION.toSpeech(typeof text === 'string' ? text : ''));
}

/** 角色表里的条目统一成 {voice,label,...}；坏音色退回 f1，别名标记要留着（UI 不显示别名）。 */
function normalizeCast(rawCast) {
  const cast = {};
  if (!rawCast || typeof rawCast !== 'object') return cast;
  for (const [name, v] of Object.entries(rawCast)) {
    if (typeof name !== 'string' || !name || !v || typeof v !== 'object') continue;
    const voice = NARRATION.VOICE_POOL[v.voice] ? String(v.voice) : 'f1';
    cast[name.slice(0, 24)] = {
      voice,
      label: String(v.label || NARRATION.VOICE_POOL[voice].label).slice(0, 24),
      gender: ['male', 'female', 'unknown'].includes(v.gender) ? v.gender : undefined,
      age: typeof v.age === 'string' ? v.age.slice(0, 12) : undefined,
      note: typeof v.note === 'string' ? v.note.slice(0, 60) : undefined,
      aliasOf: typeof v.aliasOf === 'string' ? v.aliasOf.slice(0, 24) : undefined,
    };
  }
  return cast;
}

/** v1（字符串数组）与 v2（{text, segments}）统一成 v2；坏数据一律当没读过。 */
function normalizeBook(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.paragraphs) || !raw.paragraphs.length) return null;
  const paras = [];
  for (const item of raw.paragraphs) {
    if (typeof item === 'string') {
      if (!item || item.length > MAX_PARA_TEXT) return null;
      paras.push({ text: item, segments: [{ who: 'narr', say: item }] });
      continue;
    }
    if (!item || typeof item.text !== 'string' || !item.text || item.text.length > MAX_PARA_TEXT) return null;
    const rawSegs = Array.isArray(item.segments) && item.segments.length ? item.segments : null;
    const segments = rawSegs
      ? rawSegs
          .filter((s) => s && typeof s.say === 'string' && s.say.trim() && s.say.length <= MAX_SEG_SAY)
          .map((s) => ({ who: String(s.who || 'narr').slice(0, 24), say: s.say }))
      : [];
    paras.push({
      text: item.text,
      segments: segments.length ? segments : [{ who: 'narr', say: item.text }],
    });
  }
  if (!paras.length) return null;
  if (paras.reduce((n, p) => n + p.text.length, 0) > MAX_TEXT) return null;
  const analysis = raw.analysis && typeof raw.analysis === 'object'
    ? {
        status: ['idle', 'running', 'ready', 'failed'].includes(raw.analysis.status) ? raw.analysis.status : 'idle',
        via: typeof raw.analysis.via === 'string' ? raw.analysis.via.slice(0, 24) : '',
        isFiction: raw.analysis.isFiction !== false,
        error: typeof raw.analysis.error === 'string' ? raw.analysis.error.slice(0, 120) : '',
        characters: Array.isArray(raw.analysis.characters) ? raw.analysis.characters.slice(0, 10) : [],
      }
    : { status: 'idle', via: '', isFiction: true, error: '', characters: [] };
  // 章节表跟着段落走。旧 reading.json 没有这个字段，就按段落文本现算 ——
  // 不要求用户重新导入一遍才能用上目录。
  // reading.json 是用户可写文件，章节表可能被手工改乱。先按 startParagraph 排序去重 ——
  // 下面的回填循环只往前走，遇到乱序条目会卡死，后面所有段落都拿不到章号。
  const sorted = (Array.isArray(raw.chapters) ? raw.chapters : [])
    .filter((c) => c && Number.isInteger(c.startParagraph)
      && c.startParagraph >= 0 && c.startParagraph < paras.length)
    .sort((a, b) => a.startParagraph - b.startParagraph)
    .slice(0, MAX_CHAPTERS);
  const fromRaw = [];
  for (const c of sorted) {
    const last = fromRaw[fromRaw.length - 1];
    if (last && last.startParagraph === c.startParagraph) continue;
    fromRaw.push(c);
  }
  const chapters = fromRaw.length
    ? fromRaw.map((c, i) => ({ index: i, title: String(c.title || '').slice(0, 40), startParagraph: c.startParagraph }))
    : NARRATION.markChapters(paras).chapters;
  // 段落上的章号统一按章节表重算，别让旧数据里残留的过期归属混进来
  let chapterAt = -1, nextChapter = 0;
  for (let i = 0; i < paras.length; i++) {
    while (nextChapter < chapters.length && chapters[nextChapter].startParagraph === i) chapterAt = nextChapter++;
    paras[i].chapter = chapterAt;
  }
  return {
    id: raw.id || null, title: String(raw.title || '我的阅读').slice(0, 100), paragraphs: paras,
    cast: normalizeCast(raw.cast),
    mode: raw.mode === 'live' ? 'live' : 'studio',
    analysis, rev: Number.isFinite(raw.rev) ? raw.rev : 0,
    chapters,
  };
}

function createCompanionMedia({ dir, contentDir, synthesize, synthesizeScript, analyzeBook, send, publish, mode }) {
  const file = path.join(dir, 'reading.json');
  const progressFile = path.join(dir, 'reading-progress.json');
  // 合成过的音轨落盘，重听/回退/重启都不用再等 TTS
  const audioCache = createAudioCache({ dir });
  let book = null, token = 0;
  let state = { kind: null, status: 'idle', time: 0, duration: 0 };
  let pausedAudio = null, preparing = null, lastSong = null;
  // prefetch = 已完成的下一段音轨；inflight = 还在合成中的那一个 Promise。
  // 必须两个都记：只记 prefetch 的话，上一段一播完就调 read() 时预取还没落地，
  // 缓存查不到就会对同一段再发一次合成请求（重复计费，且可能叠播）。
  let prefetch = null, prefetching = false, inflight = null, analyzing = false;
  // 曲库统一：原曲（随包）+ 翻唱（用户产出）来自一个模块，UI 只渲染一个列表
  const songLibrary = createSongLibrary({ dir, contentDir });
  // 书库：导入过的书各自留一份，reading.json 只表示「当前打开哪一本」
  const bookLibrary = createBookLibrary({ dir });

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const b = normalizeBook(raw);
    if (b) book = { ...b, index: Math.min(Math.max(0, Math.floor(raw.index) || 0), b.paragraphs.length - 1) };
  } catch (_) {}
  try {
    const p = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    if (book?.id && p.bookId === book.id && Number.isInteger(p.index)) {
      book.index = Math.min(Math.max(0, p.index), book.paragraphs.length - 1);
    }
  } catch (_) {}

  const atomic = (target, value) => { fs.writeFileSync(target + '.tmp', JSON.stringify(value)); fs.renameSync(target + '.tmp', target); };
  // 纯旁白段落不必存两份文本；整本书大部分是旁白，这样 reading.json 能小一半以上
  const compact = () => ({
    ...book,
    // 章号不落盘：它完全由 chapters 表 + startParagraph 重算得出（见 normalizeBook）。
    // 存了反而会变成「有对白的段落带 chapter、纯旁白段落不带」的半截数据，
    // 直接读盘的脚本（导出、迁移）就会拿到缺字段的段落。
    paragraphs: book.paragraphs.map((p) => {
      if (p.segments.length === 1 && p.segments[0].who === 'narr' && p.segments[0].say === p.text) {
        return { text: p.text };
      }
      const { chapter, ...rest } = p;
      return rest;
    }),
  });
  const save = (sourceChanged = false) => {
    fs.mkdirSync(dir, { recursive: true });
    if (sourceChanged || !book.id) {
      book.id = book.id || require('crypto').randomUUID();
      const snap = compact();
      atomic(file, snap);
      // 同一份内容也进书库：reading.json 只代表「当前这本」，书库才是全部
      bookLibrary.save(snap);
    }
    atomic(progressFile, { bookId: book.id, index: book.index });
  };
  // 别名不单独显示成「一个角色」，但合成时仍然认得（它们共用同一个音色）
  const castList = () => book ? Object.entries(book.cast)
    .filter(([, v]) => !v.aliasOf)
    // voice 是音色 id，UI 要拿它当下拉框的当前选中项；label 只是给人看的。
    .map(([name, v]) => ({ name, voice: v.voice, label: v.label, gender: v.gender, age: v.age, note: v.note })) : [];
  const snapshot = () => ({
    ...state, token,
    book: book ? {
      title: book.title, index: book.index, total: book.paragraphs.length,
      text: book.paragraphs[book.index].text, cast: castList(),
      voices: Object.entries(NARRATION.VOICE_POOL).map(([id, v]) => ({ id, label: v.label })),
      mode: book.mode, analysis: book.analysis,
      // 没有章节的书这里是空数组，面板据此不渲染目录（不能给空目录或「第 0 章」）
      chapters: (book.chapters || []).map((c) => ({ index: c.index, title: c.title, startParagraph: c.startParagraph })),
      chapter: Number.isInteger(book.paragraphs[book.index].chapter) ? book.paragraphs[book.index].chapter : -1,
    } : null,
  });
  const emit = () => publish(snapshot());
  function stop() { token++; pausedAudio = null; send({ action: 'stop', token }); state = { ...state, status: 'stopped' }; emit(); }

  // rev 每次重切 +1，所以换模式或分析完成后旧音轨自动失效
  const cacheKey = (index, profile) => `${book?.id || 'x'}:${book?.rev || 0}:${index}:${profile}`;
  const bookText = () => (book ? book.paragraphs.map((p) => p.text).join('\n') : '');
  const bumpRev = () => { if (book) { book.rev = (book.rev || 0) + 1; prefetch = null; inflight = null; } };

  /**
   * 让大模型读一遍开头，拿回角色表，再按这张表重切朗读稿。
   * 分析期间书照样能读（用的是规则稿），结果回来了再静默升级。
   */
  async function runAnalysis() {
    if (analyzing) return;
    if (!book || book.mode !== 'studio' || typeof analyzeBook !== 'function') return;
    const owner = book;
    analyzing = true;
    owner.analysis = { status: 'running', via: '', isFiction: true, error: '', characters: [] };
    emit();
    let result;
    try {
      result = await analyzeBook({ title: owner.title, text: bookText() });
    } catch (e) {
      result = { ok: false, error: String(e && e.message || e).slice(0, 120) };
    } finally {
      analyzing = false;
    }
    if (!book || book !== owner) return; // 中途换了书，结果作废
    if (!result || !result.ok) {
      owner.analysis = { status: 'failed', via: result?.via || '', isFiction: true, error: result?.error || '没能读到角色表', characters: [] };
      emit(); return;
    }
    owner.cast = result.cast || {};
    owner.paragraphs = NARRATION.applyCast(owner.paragraphs, owner.cast);
    owner.index = Math.min(owner.index, owner.paragraphs.length - 1);
    owner.analysis = {
      status: 'ready', via: result.via || '', isFiction: result.isFiction !== false,
      error: result.isFiction === false ? '这本书看起来不像小说，角色配音可能用不上' : '',
      characters: result.characters || [],
      // 长文是按块增量分析的，告诉用户看了多少，免得以为全书都读过了
      chunks: result.chunks || 1,
    };
    bumpRev();
    save(true);
    emit();
  }

  /**
   * 一段稿子 → 一条音轨。有 synthScript 就按角色分音色，否则退回单音色。
   * 传了 index 就走落盘缓存：同一本书、同一个 rev、同一个形态，重听不必再合成。
   */
  function render(para, profile, index) {
    if (!para) return Promise.resolve({ audio: null, via: 'none' });
    const key = Number.isInteger(index) ? cacheKey(index, profile) : null;
    if (key) {
      const hit = audioCache.get(key);
      if (hit) return Promise.resolve({ audio: hit.toString('base64'), via: 'cache' });
    }
    const segments = Array.isArray(para.segments) && para.segments.length
      ? para.segments : [{ who: 'narr', say: para.text }];
    const run = synthesizeScript
      ? Promise.resolve(synthesizeScript(segments, book?.cast || {}, { mode: profile, interactive: true }))
      : Promise.resolve(synthesize(para.text, { mode: profile, interactive: true }));
    if (!key) return run;
    return run.then((sp) => {
      if (sp && sp.audio) audioCache.put(key, Buffer.from(sp.audio, 'base64'));
      return sp;
    });
  }

  /** 播这一条的同时把下一条合成好，否则每段之间都会空等一两倍的时间。 */
  function prefetchNext(profile) {
    if (prefetching || !book) return;
    const target = book.index + 1;
    if (target >= book.paragraphs.length) return;
    const owner = book, key = cacheKey(target, profile);
    if (prefetch && prefetch.key === key) return;
    if (inflight && inflight.key === key) return;
    prefetching = true;
    const p = render(owner.paragraphs[target], profile, target)
      .then((sp) => {
        if (sp && sp.audio && book === owner && key === cacheKey(target, profile)) {
          prefetch = { key, audio: sp.audio, via: sp.via };
        }
        return sp;
      })
      .catch(() => null);
    inflight = { key, promise: p };
    p.finally(() => {
      prefetching = false;
      if (inflight && inflight.key === key) inflight = null;
    });
    return p;
  }

  async function read() {
    if (!book) throw new Error('先导入一本书，或粘贴想读的文字。');
    stop();
    const own = token, profile = mode();
    preparing = own;
    const para = book.paragraphs[book.index];
    state = { kind: 'reading', status: 'loading', time: 0, duration: 0 };
    emit();
    try {
      const key = cacheKey(book.index, profile);
      let sp = null;
      if (prefetch && prefetch.key === key) { sp = { audio: prefetch.audio, via: prefetch.via }; prefetch = null; }
      // 预取还在飞：复用那一个 Promise，不要重复发起合成。
      else if (inflight && inflight.key === key) {
        sp = await inflight.promise;
        prefetch = null;
        if (inflight && inflight.key === key) inflight = null;
      }
      if (!sp) sp = await render(para, profile, book.index);
      if (own !== token || profile !== mode()) return;
      if (!sp.audio) throw new Error(sp.error || '这段暂时没能生成语音，请重试。');
      const payload = { action: 'load', token, kind: 'reading', audio: sp.audio, text: para.text, paused: state.status === 'paused' };
      pausedAudio = payload;
      state = { ...state, status: payload.paused ? 'paused' : 'playing', engine: sp.via };
      send(payload);
      emit();
      if (state.status === 'playing') prefetchNext(profile);
    } catch (e) {
      if (own === token) { state.status = 'error'; state.error = e.message; emit(); }
    } finally {
      if (preparing === own) preparing = null;
    }
  }

  function playAudio(p) {
    stop(); state = { kind: "singing", status: "playing", songId: p.id, title: p.title, time: 0, duration: 0 };
    pausedAudio = { action: "load", token, kind: "singing", url: p.url, lyrics: p.lyrics || [], gain: p.gain ?? 1 };
    lastSong = { ...pausedAudio };
    send(pausedAudio); emit();
  }
  function playSong(id) {
    // 原曲与翻唱走同一条播放路径：曲库已经把 url 统一成绝对地址
    const song = songLibrary.find(id);
    if (!song) throw new Error('找不到这首歌。');
    // Shared affection progression has not migrated yet. Preserve pack unlocks.
    if ((song.unlockAt || 0) > 0) throw new Error(`这首歌需要 ${song.unlockAt} 好感，解锁进度尚待迁入。`);
    stop(); state = { kind: 'singing', status: 'playing', songId: id, title: song.title, time: 0, duration: 0 };
    const payload = { action: 'load', token, kind: 'singing', url: song.url, lyrics: song.lyrics || [], gain: song.gain ?? 1 };
    pausedAudio = payload; lastSong = { ...payload }; send(payload); emit();
  }
  function pause() { if (!['playing', 'loading'].includes(state.status)) return; state.status = 'paused'; send({ action: 'pause', token }); emit(); }
  function resume() {
    if (!['paused', 'stopped', 'error', 'ended'].includes(state.status)) return;
    if (state.kind === 'reading') {
      if (preparing === token) { state.status = 'loading'; emit(); }
      else if (pausedAudio) { state.status = 'playing'; send({ action: 'resume', token }); emit(); }
      else void read();
    } else if (state.kind === 'singing' && state.songId) {
      if (pausedAudio) { state.status = 'playing'; send({ action: 'resume', token }); emit(); }
      else if (lastSong) { token++; pausedAudio = { ...lastSong, token, time: state.status === 'ended' ? 0 : state.time }; state.status = 'playing'; send(pausedAudio); emit(); }
    }
  }
  function detach() { if (['playing', 'loading', 'paused'].includes(state.status)) { token++; state.status = 'paused'; pausedAudio = null; send({ action: 'stop', token }); emit(); } }
  function progress(p) {
    if (p.token !== token || !state.kind) return;
    if (p.event === 'error') { pausedAudio = null; state.status = 'error'; state.error = '音频无法播放，请重试。'; emit(); return; }
    if (Number.isFinite(p.time)) state.time = Math.max(0, p.time);
    if (Number.isFinite(p.duration)) state.duration = Math.max(0, p.duration);
    if (p.event === 'ended' && state.status === 'playing') {
      pausedAudio = null;
      if (state.kind === 'reading' && book.index < book.paragraphs.length - 1) { book.index++; save(); void read(); }
      else { state.status = 'ended'; if (state.kind === 'reading') save(); emit(); }
    } else emit();
  }
  async function command(p = {}) {
    switch (p.action) {
      case 'song': playSong(p.id); break;
      case 'import': {
        const raw = typeof p.text === 'string' ? p.text : '';
        if (!raw.trim()) throw new Error('请先选择或粘贴要读的文字。');
        if (raw.length > MAX_TEXT) throw new Error('请导入 200 万字以内的文本。');
        const wantMode = p.mode === 'live' ? 'live' : 'studio';
        const built = NARRATION.buildBook(raw, { mode: wantMode });
        if (!built.paragraphs.length) throw new Error('没有可朗读的正文。');
        stop(); prefetch = null;
        book = {
          id: null, title: String(p.title || '我的阅读').slice(0, 100),
          paragraphs: built.paragraphs, cast: built.cast, index: 0,
          chapters: built.chapters || [],
          mode: wantMode, rev: 0,
          analysis: { status: 'idle', via: '', isFiction: true, error: '', characters: [] },
        };
        save(true);
        state = { kind: 'reading', status: 'ready', time: 0, duration: 0 };
        emit();
        // 精读模式立刻能读（规则稿），角色表在后台升级
        if (wantMode === 'studio') void runAnalysis();
        break;
      }
      case 'open-book': {
        // 从书库打开一本旧书，reading.json 随之替换成它
        const id = String(p.id || '');
        if (!id) throw new Error('要给书的 id。');
        const raw = bookLibrary.load(id);
        if (!raw) throw new Error('书库里没有这本书。');
        const restored = normalizeBook(raw);
        if (!restored) throw new Error('这本书的数据不完整，无法打开。');
        stop();
        book = restored;
        const want = Number.isInteger(raw.index) ? raw.index : 0;
        book.index = Math.min(Math.max(0, want), book.paragraphs.length - 1);
        prefetch = null; inflight = null;
        atomic(file, compact());
        atomic(progressFile, { bookId: book.id, index: book.index });
        state = { kind: 'reading', status: 'ready', time: 0, duration: 0 };
        emit();
        break;
      }
      case 'remove-book': {
        const id = String(p.id || '');
        if (!id) throw new Error('要给书的 id。');
        if (book && book.id === id) throw new Error('这本正在读，先换一本再删。');
        if (!bookLibrary.remove(id)) throw new Error('书库里没有这本书。');
        emit();
        break;
      }
      case 'set-mode': {
        if (!book) throw new Error('先导入一本书，或粘贴想读的文字。');
        const next = p.mode === 'live' ? 'live' : 'studio';
        if (book.mode === next) break;
        stop();
        book.mode = next;
        if (next === 'live') {
          // 段落数不变，章号要跟着保留，否则切回实时阅读目录就没了
          book.paragraphs = book.paragraphs.map((para) => ({
            text: para.text, segments: [{ who: 'narr', say: para.text }], chapter: para.chapter,
          }));
          book.cast = {};
          book.analysis = { status: 'idle', via: '', isFiction: true, error: '', characters: [] };
        } else {
          const keep = Object.keys(book.cast).length ? book.cast : null;
          const built = NARRATION.buildBook(bookText(), { mode: 'studio', cast: keep });
          book.paragraphs = built.paragraphs;
          book.cast = built.cast;
          // 重切可能改变段落数，章节表跟着重算
          book.chapters = built.chapters || [];
        }
        book.index = Math.min(Math.max(0, book.index), book.paragraphs.length - 1);
        bumpRev();
        save(true);
        state = { kind: 'reading', status: 'ready', time: 0, duration: 0 };
        emit();
        if (next === 'studio' && !Object.keys(book.cast).length) void runAnalysis();
        break;
      }
      case 'analyze': {
        if (!book) throw new Error('先导入一本书，或粘贴想读的文字。');
        if (book.mode !== 'studio') {
          // 实时阅读不分角色，让它自己切成精读再分析，省得用户点两次
          await command({ action: 'set-mode', mode: 'studio' });
        }
        void runAnalysis();
        break;
      }
      case 'set-cast': {
        if (!book) throw new Error('先导入一本书，或粘贴想读的文字。');
        // 实时阅读整个一段都是她自己的声音，没有角色可改
        if (book.mode !== 'studio') throw new Error('实时阅读不分角色；先切成精读配音。');
        const name = String(p.name || '').slice(0, 24);
        if (!name || !book.cast[name]) throw new Error('角色表里没有这个角色。');
        const voice = String(p.voice || '');
        if (!NARRATION.VOICE_POOL[voice]) throw new Error('没有这个音色。');
        // 换音色就得按新表重切朗读稿；rev+1 同时让已缓存的旧音轨失效。
        // 正在播的这段是旧音色，继续放没有意义，直接停掉。
        if (['playing', 'loading'].includes(state.status)) stop();
        book.cast[name] = { ...book.cast[name], voice, label: NARRATION.VOICE_POOL[voice].label };
        book.paragraphs = NARRATION.applyCast(book.paragraphs, book.cast);
        book.index = Math.min(book.index, book.paragraphs.length - 1);
        bumpRev();
        save(true);
        emit();
        break;
      }
      case 'read': if (!book) throw new Error('先导入一本书，或粘贴想读的文字。'); void read(); break;
      case 'jump': {
        if (!book) throw new Error('先导入一本书，或粘贴想读的文字。');
        let target = p.index;
        // 按章跳转：给的是章序号，落到该章首段。没识别到章节时明确报错，不静默回退。
        if (Number.isInteger(p.chapter)) {
          if (!book.chapters || !book.chapters.length) throw new Error('这本书没有识别到章节。');
          // -1 是「当前段不属于任何章」（章前引言）的哨兵值，客户端可能把它原样回传，
          // 报「序号无效」会让人以为是 bug，说清楚它是什么意思。
          if (p.chapter < 0) throw new Error('当前不在任何章节内，请指定具体的章。');
          const hit = book.chapters[p.chapter];
          if (!hit) throw new Error('章节序号无效。');
          target = hit.startParagraph;
        }
        if (!Number.isInteger(target) || target < 0 || target >= book.paragraphs.length) throw new Error('段落位置无效。');
        stop(); book.index = target; save();
        state = { kind: 'reading', status: 'ready', time: 0, duration: 0 };
        emit(); break;
      }
      case 'pause': pause(); break;
      case 'resume': resume(); break;
      case 'stop': stop(); break;
      default: throw new Error('不支持的播放操作。');
    }
    return snapshot();
  }
  return {
    snapshot, command, stop, detach, progress, playAudio,
    // query 可选：面板的搜索框直接透传，空查询返回整个曲库
    library: (query) => ({
      songs: songLibrary.search(query).map((s) => ({ ...s, locked: (s.unlockAt || 0) > 0 })),
      // 书数量少，整份给出，搜索在前端做即可
      books: bookLibrary.list(),
      currentBookId: book ? book.id : null,
      query: String(query || ''),
      ...snapshot(),
    }),
    refreshSongs: () => songLibrary.invalidate(),
  };
}
module.exports = { createCompanionMedia, paragraphs, normalizeBook };
