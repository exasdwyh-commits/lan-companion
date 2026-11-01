/* Lan's house · companion features: 3D photo album, reading, chat.
 *
 * Everything here is additive: the room keeps its own choreography, and this
 * file only owns (a) one album object on the desk and (b) its own overlay UI.
 * Wiring points in index.html are three one-liners marked LAN-COMPANION.
 *
 * Data ownership:
 *   相册  主进程 lib/album.js 说了算（墙上挂哪张），这里只负责画和发指令
 *   读书  main 的 companion-media 说了算（读到第几段），音频走 scene:media
 *   聊天  走 malfoyHost.chat，语音回复从 character:say 回来，不自己合成
 */
(function () {
'use strict';

window.createLanCompanion = function ({ scene, THREE, say, lanRoom, pose }) {
  const host = window.malfoyHost || null;
  const T = THREE;
  const color = (h) => new T.Color(h).convertSRGBToLinear();
  const list = [];
  let ui = null;                       // built lazily on first open
  let albumState = null;               // {slots, entries, pinned}
  let readingState = null;             // media snapshot
  let chatHistory = [];
  let busy = false;
  let diary = [];
  let albumFilter = 'all';
  let activeReply = null;
  let chatOpen = false;
  let stoppedReply = false;
  const SOUND_KEY = 'lan.house.sound.v1';
  let sound = { voice: true, voiceVolume: .8 };
  try { const saved = JSON.parse(localStorage.getItem(SOUND_KEY)); if (saved) sound = { voice: saved.voice !== false, voiceVolume: Math.max(0, Math.min(1, Number(saved.voiceVolume) || 0)) }; } catch (_) {}
  const saveSound = () => { try { localStorage.setItem(SOUND_KEY, JSON.stringify(sound)); } catch (_) {} };
  const voiceAllowed = () => sound.voice && sound.voiceVolume > 0 && !stoppedReply;


  /* ───────────────────────── 3D：桌上的相册 ───────────────────────── */
  // Sits on the small desk by the window, next to the e-reader. The desk top is
  // y = 0.4875 and its local x/z is ±0.41 / ±0.20, so the book clears the laptop
  // (local x -0.05) and the pens (local x 0.30, z -0.10).
  const book = new T.Group();
  book.name = 'lan-album';
  book.position.set(1.23, 0.4875, -1.62);
  book.rotation.y = 0.34;
  scene.add(book);
  {
    const leather = new T.MeshStandardMaterial({ color: color(0x4b3b6b), roughness: 0.62, metalness: 0.04 });
    const paper = new T.MeshStandardMaterial({ color: color(0xf6efe0), roughness: 0.94 });
    const gold = new T.MeshStandardMaterial({ color: color(0xd5b680), roughness: 0.34, metalness: 0.55 });
    const slab = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; book.add(m); return m; };
    slab(new T.BoxGeometry(0.215, 0.010, 0.275), leather, 0, 0.005, 0);       // back cover
    slab(new T.BoxGeometry(0.203, 0.016, 0.262), paper, 0.004, 0.018, 0);     // page block
    slab(new T.BoxGeometry(0.216, 0.008, 0.276), leather, 0, 0.030, 0);       // front cover
    slab(new T.BoxGeometry(0.012, 0.034, 0.276), leather, -0.104, 0.017, 0);  // spine
    const band = slab(new T.BoxGeometry(0.028, 0.004, 0.028), gold, 0.055, 0.035, -0.06);
    band.rotation.y = 0.2;
    // 封面上的小相片：不靠形状也能一眼看出「这是相册」
    const cover = new T.MeshStandardMaterial({ color: color(0xf2e7d2), roughness: 0.72 });
    slab(new T.BoxGeometry(0.105, 0.0016, 0.125), cover, 0.012, 0.0348, 0.02);
    const photoCorner = new T.MeshStandardMaterial({ color: color(0x9fb8d8), roughness: 0.55 });
    slab(new T.BoxGeometry(0.09, 0.0012, 0.105), photoCorner, 0.012, 0.0356, 0.02);
    book.userData.tag = 'lan-album';
    book.userData.lanPick = true;
  }
  list.push(book);

  /* ───────────────────────── 播报（朗读 / 聊天语音） ───────────────────────── */
  const audio = new Audio();
  audio.preload = 'auto';
  audio.muted = !sound.voice;
  audio.volume = sound.voiceVolume;
  let speaking = false;
  const player = window.CompanionPlayback
    ? new window.CompanionPlayback.Player({
        audio,
        prepare: () => { audio.muted = !sound.voice; },
        active: (kind, on) => {
          speaking = on;
          if (ui) ui.setSpeaking(on ? kind : null);
          if (!on && kind === 'speaking') setTimeout(() => { if (!speaking && ui) ui.clearBubbleSoon(); }, 1200);
        },
        text: (text) => { if (ui) ui.bubble(text, 9000); },
        progress: (p) => { if (host && host.mediaProgress) host.mediaProgress(p); },
      })
    : null;

  // 说话的 RMS 包络要给口型用，但 createMediaElementSource 一旦建在 suspended 的
  // AudioContext 上，<audio> 会变成哑的。所以等第一次真实点击再接。
  let audioHooked = false;
  function hookFaceAudio() {
    if (audioHooked) return;
    audioHooked = true;
    if (window.LanFace && window.LanFace.attachAudio) window.LanFace.attachAudio(audio, { resume: true });
  }
  window.addEventListener('pointerdown', hookFaceAudio, { once: true, passive: true });
  window.addEventListener('keydown', hookFaceAudio, { once: true });

  function stopVoice() {
    if (player) player.stop();
    else { try { audio.pause(); } catch (_) {} }
    speaking = false;
    if (ui) ui.setSpeaking(null);
  }

  /* ───────────────────────── 宿主调用封装 ───────────────────────── */
  const call = async (fn, fallback) => {
    try { return await fn(); } catch (e) { return fallback === undefined ? { ok: false, error: String(e && e.message || e) } : fallback; }
  };

  /* ───────────────────────── DOM 外壳 ───────────────────────── */
  const CSS = `
  .lc-root{position:fixed;inset:0;pointer-events:none;z-index:40;font-family:var(--body,"PingFang SC",sans-serif);}
  .lc-root *{box-sizing:border-box;}
  .lc-panel{position:absolute;right:18px;top:18px;width:min(430px,calc(100vw - 36px));max-height:calc(100vh - 146px);
    display:none;flex-direction:column;pointer-events:auto;background:rgba(252,249,242,.97);color:#2a2437;
    border:2px solid #1d1a22;border-radius:14px;box-shadow:6px 6px 0 rgba(29,26,34,.55);overflow:hidden;}
  .lc-panel.on{display:flex;}
  .lc-head{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#f5c518;border-bottom:2px solid #1d1a22;}
  .lc-tabs{display:flex;gap:4px;flex:1;}
  .lc-tab{border:0;background:rgba(255,255,255,.55);border-radius:8px;padding:5px 12px;font:inherit;font-size:13px;
    font-weight:600;color:#2a2437;cursor:pointer;}
  .lc-tab.on{background:#1d1a22;color:#fdf7e6;}
  .lc-x{border:0;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:#2a2437;padding:2px 6px;}
  .lc-body{padding:10px 12px 14px;overflow:auto;display:none;}
  .lc-body.on{display:block;}
  .lc-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;}
  .lc-note{font-size:12px;color:#6b6480;}
  .lc-btn{border:1.5px solid #1d1a22;background:#fffdf7;border-radius:9px;padding:5px 11px;font:inherit;font-size:12.5px;
    cursor:pointer;color:#2a2437;}
  .lc-btn:hover{background:#f7e6b6;}
  .lc-btn:disabled{opacity:.42;cursor:default;}
  .lc-btn.pri{background:#1d1a22;color:#fdf7e6;}
  .lc-btn.pri:hover{background:#3a3350;}
  .lc-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;}
  .lc-card{border:1.5px solid #d8cfc0;border-radius:11px;background:#fffdf8;padding:7px;display:flex;flex-direction:column;gap:5px;}
  .lc-card.pin{border-color:#1d1a22;box-shadow:2px 2px 0 rgba(29,26,34,.22);}
  .lc-thumb{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:7px;background:#e9e2d5;cursor:zoom-in;}
  .lc-card input,.lc-card textarea{width:100%;border:1px solid #ddd4c4;border-radius:6px;font:inherit;font-size:11.5px;
    padding:3px 5px;background:#fffefb;color:#2a2437;resize:none;}
  .lc-card input{font-weight:600;}
  .lc-card textarea{height:34px;line-height:1.35;}
  .lc-acts{display:flex;gap:4px;flex-wrap:wrap;}
  .lc-acts .lc-btn{padding:3px 8px;font-size:11.5px;}
  .lc-badge{font-size:10.5px;background:#1d1a22;color:#fdf7e6;border-radius:6px;padding:1px 5px;align-self:flex-start;}
  .lc-empty{border:1.5px dashed #c9bfae;border-radius:11px;padding:18px;text-align:center;color:#6b6480;font-size:12.5px;}
  .lc-read{font-size:13px;line-height:1.65;background:#fffdf6;border:1.5px solid #e2d9c8;border-radius:10px;
    padding:9px 11px;max-height:150px;overflow:auto;white-space:pre-wrap;color:#332d42;}
  .lc-books{display:flex;flex-direction:column;gap:5px;margin-top:6px;}
  .lc-book{display:flex;align-items:center;gap:8px;border:1px solid #e2d9c8;border-radius:8px;padding:5px 8px;font-size:12.5px;background:#fffdf8;}
  .lc-book span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .lc-chat{position:absolute;left:50%;bottom:calc(74px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);
    width:min(520px,calc(100vw - 150px));display:flex;gap:7px;pointer-events:auto;align-items:center;}
  .lc-chat input{flex:1;min-width:0;border:2px solid #1d1a22;border-radius:12px;padding:9px 13px;font:inherit;font-size:13.5px;
    background:rgba(255,253,247,.96);color:#2a2437;box-shadow:3px 3px 0 rgba(29,26,34,.5);outline:none;}
  .lc-chat input::placeholder{color:#8b8296;}
  .lc-chat button{border:2px solid #1d1a22;border-radius:12px;background:#1d1a22;color:#fdf7e6;font:inherit;font-size:13px;
    padding:9px 14px;cursor:pointer;box-shadow:3px 3px 0 rgba(245,197,24,.9);}
  .lc-chat button:disabled{opacity:.5;cursor:default;}
  .lc-bubble{position:absolute;left:50%;bottom:calc(136px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);
    width:min(560px,calc(100vw - 120px));
    background:rgba(255,253,247,.97);border:2px solid #1d1a22;border-radius:13px;padding:9px 13px;font-size:13.5px;
    line-height:1.6;color:#2a2437;box-shadow:4px 4px 0 rgba(29,26,34,.45);display:none;white-space:pre-wrap;
    max-height:34vh;overflow:auto;}
  .lc-bubble.on{display:block;}
  .lc-bubble b{display:block;font-size:11px;letter-spacing:.1em;color:#8b8296;font-weight:600;margin-bottom:3px;}
  .lc-toast{position:absolute;left:50%;top:14px;transform:translateX(-50%);background:#1d1a22;color:#fdf7e6;
    border-radius:9px;padding:6px 13px;font-size:12.5px;opacity:0;transition:opacity .25s;pointer-events:none;max-width:70vw;}
  .lc-toast.on{opacity:1;}
  .lc-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#8b8296;margin-left:5px;animation:lcp 1s infinite;}
  @keyframes lcp{0%,100%{opacity:.25}50%{opacity:1}}
  /* 宽屏时面板贴右，聊天栏居中会压到面板下沿：面板一开就把聊天栏挪到左边。 */
  @media (min-width: 781px){
    .lc-root.panel-open .lc-chat{left:20px;transform:none;width:min(470px,calc(100vw - 500px));}
    .lc-root.panel-open .lc-bubble{left:20px;transform:none;width:min(470px,calc(100vw - 500px));}
  }
  /* 小屋窗口默认 960×540，也能被拖到 640×360：窄的时候面板改整幅、聊天栏收窄，
     不然左右两侧的 3D 画面会被挡掉大半。 */
  @media (max-width: 780px), (max-height: 460px){
    .lc-panel{left:8px;right:8px;top:8px;width:auto;max-height:calc(100vh - 138px);}
    .lc-chat{width:calc(100vw - 32px);bottom:calc(68px + env(safe-area-inset-bottom,0px));}
    .lc-bubble{bottom:calc(124px + env(safe-area-inset-bottom,0px));width:calc(100vw - 32px);max-height:26vh;}
    .lc-grid{grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:7px;}
    .lc-thumb{aspect-ratio:16/10;}
    .lc-card textarea{height:24px;}
  }
  /* 窗口被拖到 360 高时，一张卡片塞不下「照片+标题+记录+按钮」四层。
     先保住按钮（贴到墙上 / 删掉），记录文字在正常尺寸里改。 */
  @media (max-height: 420px){
    .lc-thumb{height:84px;aspect-ratio:auto;}
    .lc-card textarea{display:none;}
    .lc-card input{font-size:11px;padding:2px 4px;}
  }
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildUI() {
    if (ui) return ui;
    const style = el('style'); style.textContent = CSS; document.head.prepend(style);
    const root = el('div', 'lc-root');

    // ── 面板 ──
    const panel = el('div', 'lc-panel');
    const head = el('div', 'lc-head');
    const tabs = el('div', 'lc-tabs');
    const tabAlbum = el('button', 'lc-tab on', '相册');
    const tabRead = el('button', 'lc-tab', '小说书架');
    const tabChat = el('button', 'lc-tab', '对话');
    const tabSound = el('button', 'lc-tab', '声音');
    tabs.append(tabAlbum, tabRead, tabChat, tabSound);
    const close = el('button', 'lc-x', '×');
    close.setAttribute('aria-label', '关闭');
    head.append(tabs, close);

    const bodyAlbum = el('div', 'lc-body on');
    const bodyRead = el('div', 'lc-body');
    panel.setAttribute('aria-label', '澜的小屋');
    const bodyChat = el('div', 'lc-body lc-conversation');
    const transcript = el('div', 'lc-transcript');
    transcript.setAttribute('role', 'log'); transcript.setAttribute('aria-label', '和澜的对话');
    bodyChat.append(el('p', 'lc-note', '同一段对话，从小屋继续到桌面。'), transcript);
    const bodySound = el('div', 'lc-body');
    panel.append(head, bodyAlbum, bodyRead, bodyChat, bodySound);

    // ── 相册 ──
    const albumTop = el('div', 'lc-row');
    const addBtn = el('button', 'lc-btn pri', '＋ 加照片');
    const pinCount = el('span', 'lc-note', '');
    const manageHint = el('span', 'lc-note', '');
    albumTop.append(addBtn, pinCount, manageHint);
    const grid = el('div', 'lc-grid');
    const albumEmpty = el('div', 'lc-empty', '还没照片。点「加照片」把喜欢的放进来，再贴到墙上。');
    const albumHero = el('div', 'lc-album-hero');
    albumHero.append(el('span', 'lc-eyebrow', 'LAN’S FIELD NOTES / 01'), el('h2', null, '把路上的光，带回家。'), el('p', null, '收藏照片，也留一页她的冒险。'));
    const filters = el('div', 'lc-filters');
    for (const [key, label] of [['all', '所有收藏'], ['wall', '照片墙'], ['journey', '冒险手账']]) {
      const b = el('button', 'lc-filter', label); b.dataset.filter = key; b.onclick = () => { albumFilter = key; applyAlbum(albumState); }; filters.append(b);
    }
    bodyAlbum.append(albumHero, albumTop, filters, grid, albumEmpty);

    // ── 读书 ──
    const bookRow = el('div', 'lc-row');
    const bookTitle = el('strong', null, '没有打开的书');
    const bookPos = el('span', 'lc-note', '');
    bookRow.append(bookTitle, bookPos);
    const readText = el('div', 'lc-read', '点「打开电子书」选一个 TXT / Markdown / EPUB，或者把文字粘进来。');
    const readActs = el('div', 'lc-row');
    const bPlay = el('button', 'lc-btn pri', '读给我听');
    const bPause = el('button', 'lc-btn', '暂停');
    const bPrev = el('button', 'lc-btn', '上一段');
    const bNext = el('button', 'lc-btn', '下一段');
    readActs.append(bPlay, bPause, bPrev, bNext);
    const readMore = el('div', 'lc-row');
    const bOpen = el('button', 'lc-btn', '打开电子书');
    const bPaste = el('button', 'lc-btn', '粘贴文字');
    readMore.append(bOpen, bPaste);
    const books = el('div', 'lc-books');
    const readHeading = el('div', 'lc-section-title');
    readHeading.append(el('span', 'lc-eyebrow', 'THE QUIET LIBRARY'), el('h2', null, '再读一章，就睡。'));
    const bookSearch = el('input', 'lc-search'); bookSearch.placeholder = '在书架上找一本…'; bookSearch.setAttribute('aria-label', '搜索书架');
    const readingProgress = el('progress', 'lc-progress'); readingProgress.max = 100; readingProgress.value = 0; readingProgress.setAttribute('aria-label', '当前阅读进度');
    const readingCard = el('details', 'lc-reading-card'); const readingSummary = el('summary'); readingSummary.append(bookRow, el('span', 'lc-note', '展开阅读 ↓')); readingCard.append(readingSummary, readingProgress, readText, readActs);
    bodyRead.append(readHeading, readingCard, readMore, bookSearch, books);
    bookSearch.oninput = () => void refreshBooks();

    // ── 聊天 ──
    const chat = el('div', 'lc-chat');
    const input = el('input');
    input.type = 'text';
    input.placeholder = '跟她说点什么…';
    input.setAttribute('aria-label', '跟澜说话');
    input.maxLength = 500;
    const send = el('button', null, '发送');
    send.type = 'button';
    const historyBtn = el('button', 'lc-history-btn', '对话'); historyBtn.setAttribute('aria-label', '展开对话记录');
    chat.append(historyBtn, input, send);
    const chatStatus = el('span', 'lc-chat-status', '澜在小屋里'); chatStatus.setAttribute('role', 'status');
    chat.append(chatStatus);

    const bubble = el('div', 'lc-bubble');
    const toast = el('div', 'lc-toast');
    const hud = el('div', 'lc-hud');
    const home = el('div', 'lc-home'); home.append(el('span', 'lc-home-dot'), el('span', null, '澜的小屋'));
    const soundBtn = el('button', 'lc-hud-btn', '声音'); soundBtn.setAttribute('aria-label', '声音设置');
    const desktopBtn = el('button', 'lc-hud-btn lc-desktop', '来到桌面 ↗');
    desktopBtn.onclick = async () => {
      if (!host || !host.summon) { api.toast('请在 App 中召唤到桌面'); return; }
      desktopBtn.disabled = true;
      try { await host.summon(); } catch (_) { api.toast('没有切换成功，请再试一次'); }
      finally { desktopBtn.disabled = false; }
    };
    hud.append(home, soundBtn, desktopBtn);
    root.append(hud, panel, bubble, chat, toast);
    document.body.append(root);

    let bubbleTimer = 0;
    const api = {
      panel, input, transcript, send, chatStatus, readingProgress, bookSearch, filters,
      open(tab) {
        panel.classList.add('on');
        root.classList.add('panel-open'); document.body.classList.add('lc-panel-open');
        select(['read', 'chat', 'sound'].includes(tab) ? tab : 'album');
      },
      close() { panel.classList.remove('on'); root.classList.remove('panel-open'); document.body.classList.remove('lc-panel-open'); chatOpen = false; },
      get isOpen() { return panel.classList.contains('on'); },
      bubble(text, ms) {
        if (!text) return;
        bubble.innerHTML = '';
        bubble.append(el('b', null, '澜'), document.createTextNode(text));
        if (!chatOpen) bubble.classList.add('on');
        clearTimeout(bubbleTimer);
        if (ms) bubbleTimer = setTimeout(() => bubble.classList.remove('on'), ms);
      },
      clearBubbleSoon() { clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => bubble.classList.remove('on'), 1600); },
      setSpeaking(kind) { chat.classList.toggle('busy', !!kind); chatStatus.textContent = kind ? '澜正在说话 · 可在声音中停止' : busy ? '澜正在想…' : '澜在小屋里'; },
      setBusy(on) {
        send.disabled = on; chat.setAttribute('aria-busy', String(on));
        chatStatus.textContent = on ? '澜正在想…' : speaking ? '澜正在说话' : '澜在小屋里';
        if (on) window.LanFace?.emote?.('think', 8000);
        else if (!speaking) window.LanFace?.emote?.('neutral', 1200);
      },
      renderChat() {
        transcript.replaceChildren();
        if (!chatHistory.length) transcript.append(el('div', 'lc-empty', '今天想聊些什么？也可以点书架，接着上次那一章。'));
        for (const turn of chatHistory) {
          const line = el('div', 'lc-message ' + (turn.role === 'user' ? 'from-me' : 'from-lan'));
          line.append(el('small', null, turn.role === 'user' ? '你' : '澜'), el('p', null, turn.content || '…')); transcript.append(line);
        }
        transcript.scrollTop = transcript.scrollHeight;
      },
      toast(text) {
        toast.textContent = text; toast.classList.add('on');
        clearTimeout(api._tt); api._tt = setTimeout(() => toast.classList.remove('on'), 2400);
      },
      renderAlbum: () => {},
      renderReading: () => {},
    };

    function select(tab) {
      chatOpen = tab === 'chat';
      const pairs = [['album', tabAlbum, bodyAlbum], ['read', tabRead, bodyRead], ['chat', tabChat, bodyChat], ['sound', tabSound, bodySound]];
      for (const [key, button, body] of pairs) { button.classList.toggle('on', tab === key); button.setAttribute('aria-selected', String(tab === key)); body.classList.toggle('on', tab === key); }
      panel.dataset.tab = tab;
      if (tab === 'read') void refreshReading();
      if (tab === 'album') { void refreshAlbum(); void refreshJourney(); }
      if (chatOpen) { bubble.classList.remove('on'); api.renderChat(); }
      if (tab === 'sound') renderSound();
    }
    tabAlbum.onclick = () => select('album');
    tabRead.onclick = () => select('read');
    tabChat.onclick = () => select('chat');
    tabSound.onclick = () => select('sound');
    historyBtn.onclick = () => api.open('chat');
    soundBtn.onclick = () => api.open('sound');

    function renderSound() {
      bodySound.replaceChildren();
      const heading = el('div', 'lc-section-title'); heading.append(el('span', 'lc-eyebrow', 'SOUND & SILENCE'), el('h2', null, '让小屋安静一点。')); bodySound.append(heading);
      const voiceRow = el('div', 'lc-sound-row');
      const voiceLabel = el('div'); voiceLabel.append(el('strong', null, '澜的声音'), el('p', 'lc-note', '聊天回复、朗读和歌曲'));
      const voiceToggle = el('button', 'lc-btn', sound.voice ? '已开启' : '已静音'); voiceToggle.setAttribute('aria-pressed', String(sound.voice));
      voiceToggle.onclick = () => { sound.voice = !sound.voice; audio.muted = !sound.voice; saveSound(); renderSound(); };
      voiceRow.append(voiceLabel, voiceToggle);
      const voiceVol = el('input', 'lc-volume'); voiceVol.type = 'range'; voiceVol.min = 0; voiceVol.max = 100; voiceVol.value = Math.round(sound.voiceVolume * 100); voiceVol.setAttribute('aria-label', '澜的音量');
      const voiceValue = el('output', 'lc-volume-value', voiceVol.value + '%');
      voiceVol.oninput = () => { sound.voiceVolume = Number(voiceVol.value) / 100; audio.volume = sound.voiceVolume; voiceValue.textContent = voiceVol.value + '%'; saveSound(); };
      const stop = el('button', 'lc-btn', '停止当前播音'); stop.onclick = () => { stoppedReply = true; stopVoice(); host?.stopVoice?.(); void mediaCmd({ action: 'pause' }); api.toast('已停止，下一条回复会恢复'); };
      bodySound.append(voiceRow, voiceVol, voiceValue, stop);
      const env = window.LAN_ROOM_AUDIO;
      const envState = env?.get() || { on: false, volume: 0 };
      const envRow = el('div', 'lc-sound-row');
      const envLabel = el('div'); envLabel.append(el('strong', null, '小屋环境声'), el('p', 'lc-note', '风雨、鸟鸣、收音机、电视与游戏音效'));
      const envToggle = el('button', 'lc-btn', envState.on ? '已开启' : '已静音'); envToggle.setAttribute('aria-pressed', String(envState.on));
      envToggle.disabled = !env; envToggle.onclick = () => { env.set({ on: !env.get().on }); renderSound(); };
      envRow.append(envLabel, envToggle);
      const envVol = el('input', 'lc-volume'); envVol.type = 'range'; envVol.min = 0; envVol.max = 100; envVol.value = Math.round(envState.volume * 100); envVol.setAttribute('aria-label', '小屋环境音量'); envVol.disabled = !env;
      const envValue = el('output', 'lc-volume-value', envVol.value + '%');
      envVol.oninput = () => { env.set({ volume: Number(envVol.value) / 100 }); envValue.textContent = envVol.value + '%'; envToggle.textContent = env.get().on ? '已开启' : '已静音'; envToggle.setAttribute('aria-pressed', String(env.get().on)); };
      const detail = el('button', 'lc-btn', '细调风雨与自然声音'); detail.onclick = () => { api.close(); document.getElementById('bSound')?.click(); };
      bodySound.append(envRow, envVol, envValue, detail);
    }
    close.onclick = () => api.close();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && api.isOpen) { api.close(); }
    });

    // 聊天提交
    const submit = () => {
      const text = input.value.trim();
      if (!text || busy) return;
      input.value = '';
      void sendChat(text);
    };
    send.onclick = submit;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); }
      if (e.key === 'Escape') input.blur();
    });

    addBtn.onclick = async () => {
      if (!host || !host.album) { api.toast('在 App 里才能加照片'); return; }
      addBtn.disabled = true;
      const r = await call(() => host.album.action({ action: 'add' }));
      addBtn.disabled = false;
      if (r && r.cancelled) return;
      if (!r || r.ok === false) { api.toast((r && r.error) || '没加成'); return; }
      applyAlbum(r);
      api.toast('放进相册了，贴到墙上试试');
    };
    bPlay.onclick = async () => { await mediaCmd({ action: readingState && readingState.status === 'paused' ? 'resume' : 'read' }); };
    bPause.onclick = async () => { await mediaCmd({ action: 'pause' }); };
    bPrev.onclick = async () => { await jumpRelative(-1); };
    bNext.onclick = async () => { await jumpRelative(1); };
    bOpen.onclick = async () => {
      if (!host) { api.toast('在 App 里才能选文件'); return; }
      bOpen.disabled = true;
      const r = await call(() => host.openBook());
      bOpen.disabled = false;
      if (r && r.cancelled) return;
      if (!r || r.ok === false) { api.toast((r && r.error) || '这本书没读进来'); return; }
      applyReading(r.state);
      api.toast('打开好了，点「读给我听」');
    };
    bPaste.onclick = async () => {
      const text = window.prompt('把要读的文字粘到这里（也可以先粘一半，之后再续）：');
      if (!text || !text.trim()) return;
      const title = window.prompt('给这段起个名字：', '我的阅读') || '我的阅读';
      const r = await call(() => host.media({ action: 'import', title, text, mode: 'live' }));
      if (!r || r.ok === false) { api.toast((r && r.error) || '没读进来'); return; }
      applyReading(r.state);
      api.toast('可以读了');
    };

    ui = Object.assign(api, {
      select, addBtn, grid, albumEmpty, pinCount, manageHint,
      bookTitle, bookPos, readText, books, bPlay, bPause, bPrev, bNext,
    });
    return ui;
  }

  let photoDialog = null;
  function openPhoto(entry) {
    photoDialog?.remove();
    const dialog = el('dialog', 'lc-lightbox'); photoDialog = dialog;
    const close = el('button', 'lc-btn lc-lightbox-close', '关闭 ×'); close.onclick = () => dialog.close();
    const img = el('img'); img.src = entryUrl(entry); img.alt = entry.title || '旅行照片';
    const caption = el('div', 'lc-lightbox-caption'); caption.append(el('span', 'lc-eyebrow', entry.journey ? 'ADVENTURE JOURNAL · 旅途故事 / 馆藏配图' : 'COLLECTED MOMENTS'), el('h2', null, entry.title || '未命名照片'), el('p', null, entry.note || '留白也是一段回忆。'));
    dialog.append(close, img, caption); document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); photoDialog = null; });
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    dialog.showModal();
  }
  async function refreshJourney() {
    if (!host?.journey) return;
    const r = await call(() => host.journey(), null);
    if (r) { diary = Array.isArray(r.diary) ? r.diary : []; if (albumState) applyAlbum(albumState); }
  }
  function renderDiary() {
    for (const [i, trip] of diary.entries()) {
      const card = el('article', 'lc-card lc-postcard');
      // Existing trip photo IDs point into the shipped gallery, not arbitrary external URLs.
      const place = String(trip.place || '');
      const illustration = /图书|书店/.test(place) ? 1 : /码头|礁石|海/.test(place) ? 0 : /山|林/.test(place) ? 2 : 3;
      const url = typeof trip.photo === 'string' && /^album-[a-z0-9_-]+\.jpg$/i.test(trip.photo) ? '../live2d/companion-content/' + encodeURIComponent(trip.photo) : 'assets/lan-room/journey-' + illustration + '.jpg';
      const photo = { title: place || '路上的一站', note: trip.note || '', url, journey: true };
      const img = el('img', 'lc-thumb'); img.src = photo.url; img.alt = photo.title + ' · 馆藏配图'; img.loading = 'lazy';
      const open = el('button', 'lc-photo-open'); open.setAttribute('aria-label', '查看冒险手账：' + photo.title); open.append(img); open.onclick = () => openPhoto(photo);
      const at = new Date(trip.at); const date = Number.isFinite(at.getTime()) ? at.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) : '';
      card.append(open, el('small', 'lc-eyebrow', date + ' · 旅途故事'), el('strong', null, photo.title), el('p', 'lc-trip-note', photo.note), el('span', 'lc-note', '澜的冒险见闻 · 馆藏配图'));
      ui.grid.append(card);
    }
  }

  /* ───────────────────────── 相册 ───────────────────────── */
  // 没有宿主（浏览器预览）时用随包的三张，只读。
  const FALLBACK = [
    { id: 'seed-0', pinned: true, slot: 0, title: '抱着小鲸鱼的晴天', note: '第一次抱她的时候，她比鲸鱼还小一点。', url: 'assets/lan-room/portrait-whale.jpg' },
    { id: 'seed-1', pinned: true, slot: 1, title: '一起等海风', note: '咖啡凉了也没走。', url: 'assets/lan-room/morning-cafe.jpg' },
    { id: 'seed-2', pinned: true, slot: 2, title: '晚安，星光与海', note: '', url: 'assets/lan-room/starlight-balcony.jpg' },
  ];

  function entryUrl(entry) {
    if (!entry) return '';
    if (entry.url) return entry.url;                       // 浏览器预览用的内置示例
    if (entry.seed) return entry.seed;                     // 随包照片：相对 moli-room/
    return 'lanroom://album/' + encodeURIComponent(entry.file || '');
  }

  function pushWall(entries) {
    const photos = [];
    for (const e of entries) {
      if (e.pinned && e.slot >= 0 && e.slot < lanRoom.slotCount) photos[e.slot] = { url: entryUrl(e), title: e.title, note: e.note };
    }
    lanRoom.setPhotos(photos);
  }

  // quiet=true：只换墙上的照片与计数，不重建列表 —— 否则「边打字边存」会把
  // 正在输入的那个框整个换掉，光标和输入法状态全丢。
  function applyAlbum(state, quiet) {
    if (!state) return;
    albumState = state;
    const entries = Array.isArray(state.entries) ? state.entries : [];
    pushWall(entries);
    if (!ui) return;
    ui.pinCount.textContent = `墙上 ${entries.filter((e) => e.pinned).length}/${state.slots || lanRoom.slotCount}`;
    ui.manageHint.textContent = '照片留在相册，喜欢的挂到墙上';
    for (const b of ui.filters.children) { const on = b.dataset.filter === albumFilter; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    if (quiet) return;
    ui.grid.innerHTML = '';
    ui.albumEmpty.style.display = entries.length ? 'none' : 'block';
    for (const entry of entries.filter(e => albumFilter !== 'journey' && (albumFilter !== 'wall' || e.pinned))) {
      const card = el('div', 'lc-card' + (entry.pinned ? ' pin' : ''));
      const img = el('img', 'lc-thumb');
      img.src = entryUrl(entry); img.alt = entry.title || '照片'; img.loading = 'lazy';
      img.tabIndex = 0; img.setAttribute('role', 'button'); img.setAttribute('aria-label', '查看照片：' + (entry.title || '未命名'));
      img.onclick = () => openPhoto(albumState?.entries.find(e => e.id === entry.id) || entry);
      img.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); img.onclick(); } };
      img.onerror = () => { img.style.opacity = '.35'; };
      const title = el('input');
      title.value = entry.title || '';
      title.placeholder = '给这张起个名字';
      title.maxLength = 40; title.setAttribute('aria-label', '照片标题');
      const note = el('textarea');
      note.value = entry.note || '';
      note.placeholder = '记一句当时的事…';
      note.maxLength = 180; note.setAttribute('aria-label', '照片记录');
      const save = debounce(async () => {
        const r = await call(() => host.album.action({ action: 'update', id: entry.id, title: title.value, note: note.value }));
        if (r && r.ok === false) ui.toast(r.error || '没存上');
        else { applyAlbum(r, true); img.alt = title.value || '照片'; img.setAttribute('aria-label', '查看照片：' + (title.value || '未命名')); }
      }, 600);
      title.disabled = note.disabled = !host?.album;
      title.oninput = save; note.oninput = save;
      title.onblur = save.flush; note.onblur = save.flush;
      const acts = el('div', 'lc-acts');
      const pinBtn = el('button', 'lc-btn', entry.pinned ? '取下' : '贴墙上');
      pinBtn.disabled = !host?.album;
      pinBtn.onclick = async (ev) => {
        ev.stopPropagation();
        // 先记住「这次要贴还是要取」：返回的对象可能是同一引用，事后读 entry.pinned 会反。
        const wantPin = !entry.pinned;
        const r = await call(() => host.album.action({ action: 'pin', id: entry.id, pinned: wantPin }));
        if (r && r.ok === false) ui.toast(r.error || '贴不上去');
        else { applyAlbum(r); ui.toast(wantPin ? '挂到墙上了' : '取下来了'); }
      };
      const delBtn = el('button', 'lc-btn', '删掉');
      delBtn.disabled = !host?.album;
      delBtn.onclick = async (ev) => {
        ev.stopPropagation();
        if (!window.confirm('这张照片和它的记录都会删掉，确定吗？')) return;
        const r = await call(() => host.album.action({ action: 'remove', id: entry.id }));
        if (r && r.ok === false) ui.toast(r.error || '删不掉');
        else applyAlbum(r);
      };
      acts.append(pinBtn, delBtn);
      if (entry.pinned) acts.append(el('span', 'lc-badge', '墙上'));
      card.append(img, title, note, acts);
      ui.grid.append(card);
    }
    if (albumFilter !== 'wall') renderDiary();
    ui.albumEmpty.style.display = ui.grid.children.length ? 'none' : 'block';
    ui.albumEmpty.textContent = albumFilter === 'journey' ? '她还没带回新的手账。下次旅行归来，见闻会收在这里。' : albumFilter === 'wall' ? '墙上还没有照片。去所有收藏里，选一张贴上来。' : '收藏一张照片，给它留一句话。';
  }

  function debounce(fn, ms) {
    let timer = 0;
    const wrapped = (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
    wrapped.flush = () => { if (timer) { clearTimeout(timer); timer = 0; fn(); } };
    return wrapped;
  }

  async function refreshAlbum() {
    if (!host || !host.album) { applyAlbum({ slots: lanRoom.slotCount, entries: FALLBACK }); return; }
    const r = await call(() => host.album.state());
    applyAlbum(r && r.ok !== false && Array.isArray(r.entries) ? r : { slots: lanRoom.slotCount, entries: FALLBACK });
  }

  /* ───────────────────────── 读书 ───────────────────────── */
  function applyReading(state) {
    if (!state) return;
    readingState = state;
    if (!ui) return;
    const book = state.book;
    ui.readingProgress.value = book?.total ? Math.round((book.index + 1) / book.total * 100) : 0;
    if (!book) {
      ui.bookTitle.textContent = '没有打开的书';
      ui.bookPos.textContent = '';
      ui.readText.textContent = '点「打开电子书」选一个 TXT / Markdown / EPUB，或者把文字粘进来。';
      ui.bPlay.disabled = true; ui.bPause.disabled = true; ui.bPrev.disabled = true; ui.bNext.disabled = true;
      ui.bPlay.textContent = '读给我听';
    } else {
      ui.bookTitle.textContent = book.title || '我的阅读';
      const chapter = Array.isArray(book.chapters) && book.chapter >= 0 ? (book.chapters[book.chapter] || {}).title : '';
      ui.bookPos.textContent = `${book.index + 1}/${book.total} 段${chapter ? ' · ' + chapter : ''} · ${book.mode === 'live' ? '实时阅读' : '精读配音'}`;
      ui.readText.textContent = book.text || '';
      ui.bPlay.disabled = false; ui.bPause.disabled = false;
      ui.bPrev.disabled = book.index <= 0;
      ui.bNext.disabled = book.index >= book.total - 1;
      const playing = state.status === 'playing' || state.status === 'loading';
      ui.bPlay.textContent = playing ? '正在读…' : state.status === 'paused' ? '接着读' : '读给我听';
    }
    void refreshBooks();
  }

  let booksRequest = 0;
  async function refreshBooks() {
    if (!ui || !host) return;
    const own = ++booksRequest;
    const lib = await call(() => host.library(''), null);
    if (!lib || own !== booksRequest) return;
    ui.books.replaceChildren();
    const query = ui.bookSearch.value.trim().toLocaleLowerCase();
    const all = Array.isArray(lib.books) ? lib.books : [];
    const items = all.filter(b => !query || String(b.title).toLocaleLowerCase().includes(query));
    if (!items.length) { ui.books.append(el('div', 'lc-empty', query ? '没有找到这本书，换个名字试试。' : '书架空着，留一个位置给你的第一本小说。')); return; }
    const palette = ['#456f78', '#9d635c', '#757395', '#9a7d49', '#507d6c', '#826684'];
    for (const b of items) {
      const row = el('button', 'lc-book'); row.type = 'button';
      let hash = 0; for (const ch of String(b.id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      row.style.setProperty('--book-color', palette[hash % palette.length]);
      const current = b.id === lib.currentBookId;
      row.classList.toggle('current', current);
      row.setAttribute('aria-label', (current ? '继续阅读：' : '打开书籍：') + b.title);
      const cover = el('div', 'lc-book-cover'); cover.append(el('small', null, current ? '正在阅读' : '澜的藏书'), el('strong', null, b.title || '未命名'), el('span', 'lc-book-ornament', '✧'), el('small', null, `${b.chapters || 1} 章 · ${b.paragraphs || 0} 段`));
      row.append(cover, el('span', 'lc-book-name', b.title || '未命名'), el('small', 'lc-note', current ? '接着上次那一页 →' : '翻开这本书 →'));
      row.onclick = async () => {
        if (!current) {
          row.disabled = true;
          const r = await call(() => host.media({ action: 'open-book', id: b.id }));
          if (r?.ok === false) { ui.toast(r.error || '打不开'); row.disabled = false; return; }
          if (r?.state) applyReading(r.state);
        }
        ui.readText.closest('details').open = true;
        ui.readText.closest('details').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      };
      ui.books.append(row);
    }
  }

  async function mediaCmd(payload) {
    if (!host) return;
    if (['read', 'resume'].includes(payload.action)) stoppedReply = false;
    const r = await call(() => host.media(payload));
    if (r && r.ok === false) { if (ui) ui.toast(r.error || '播放失败'); return; }
    if (r && r.state) applyReading(r.state);
  }
  async function jumpRelative(delta) {
    if (!readingState || !readingState.book) return;
    const target = readingState.book.index + delta;
    if (target < 0 || target >= readingState.book.total) return;
    await mediaCmd({ action: 'jump', index: target });
  }
  async function refreshReading() {
    if (!host) {
      if (!ui) return;
      ui.readText.textContent = '读书要在 App 里用：浏览器预览没有朗读引擎。';
      for (const b of [ui.bPlay, ui.bPause, ui.bPrev, ui.bNext]) b.disabled = true;
      return;
    }
    const lib = await call(() => host.library(''), null);
    if (lib) applyReading(lib);
  }

  /* ───────────────────────── 聊天 ───────────────────────── */
  function setReply(text) {
    if (!text || !ui) return;
    if (!activeReply) { activeReply = { role: 'assistant', content: text }; chatHistory.push(activeReply); }
    else activeReply.content = text;
    ui.renderChat(); ui.bubble(text, 12000);
  }
  async function sendChat(text) {
    if (!host) { ui?.toast('在 App 里才能聊'); return; }
    busy = true; stoppedReply = false;
    chatHistory.push({ role: 'user', content: text });
    activeReply = { role: 'assistant', content: '…' }; chatHistory.push(activeReply);
    ui.setBusy(true); ui.renderChat(); ui.bubble('…', 0);
    stopVoice();
    try {
      const r = await host.chat(text, [], { voice: false }); // canonical session belongs to main
      if (r?.ok === false || !r?.text) throw new Error(r?.error || '没有收到回复');
      setReply(r.text);
      if (r.voice && !r.deliveredToStage && player && voiceAllowed()) player.load({ kind: 'speaking', audio: r.voice, mime: 'audio/mp3', gain: sound.voiceVolume });
      if (r.emo && window.LAN_EMOTE) window.LAN_EMOTE(r.emo);
    } catch (e) {
      setReply('这次没有收到回复，请稍后再试。'); ui.toast(String(e?.message || e).slice(0, 80));
    } finally {
      busy = false; activeReply = null;
      if (chatHistory.length > 80) chatHistory = chatHistory.slice(-80);
      ui.setBusy(false); if (document.activeElement === ui.send) ui.input.focus();
    }
  }

  /* ───────────────────────── 宿主事件 ───────────────────────── */
  function wire() {
    if (!host) return;
    // 她的每一句话（聊天回复 / 语音唤醒的回答 / 流式片段）都会从这里回来
    if (host.onCharacterSay) host.onCharacterSay((p) => {
      if (!p) return;
      if (p.text) { if (!ui) buildUI(); setReply(p.text); if (!busy && !p.partial) activeReply = null; }
      const audioB64 = p.voice || p.audio;
      // 口型：整句（非流式片段）才起一条时间轴；带音频的片段逐句接上
      if (p.text && window.LanFace && (audioB64 || !p.partial)) window.LanFace.say(p.text);
      if (audioB64 && player && voiceAllowed()) {
        const payload = { kind: 'speaking', audio: audioB64, mime: p.mime || 'audio/wav', gain: sound.voiceVolume };
        if (p.chunk) player.enqueue(payload); else player.load(payload);
      }
    });
    if (host.onChatStream) host.onChatStream((p) => {
      if (p && p.text) { if (!ui) buildUI(); if (busy) setReply(p.text); else ui.bubble(p.text, 12000); }
    });
    // 朗读 / 唱歌：同一套 <audio>，换台语义
    if (host.onSceneMedia) host.onSceneMedia((p) => {
      if (!p || !player) return;
      if (p.action === 'load') { stoppedReply = false; player.load({ ...p, gain: sound.voiceVolume }); if (!ui) buildUI(); if (p.text) ui.bubble(p.text, 0); }
      else if (p.action === 'stop') { player.stop(); if (ui) ui.clearBubbleSoon(); }
      else player.command(p);
    });
    if (host.onMediaState) host.onMediaState((p) => { if (p) applyReading(p); });
    host.onCharacterActivity?.(activity => { if (activity === 'thinking') { stoppedReply = false; if (!busy) activeReply = null; } if (activity === 'idle' && !busy) activeReply = null; });
    host.onCharacterSession?.(p => { if (!busy && Array.isArray(p?.turns)) { chatHistory = p.turns.filter(t => ['user', 'assistant'].includes(t.role)).map(t => ({ role: t.role, content: String(t.content || '') })); ui?.renderChat(); } });
    host.onJourneyState?.(p => { diary = Array.isArray(p?.diary) ? p.diary : []; if (albumState) applyAlbum(albumState); });
    if (host.onStopVoice) host.onStopVoice(() => stopVoice());
  }

  /* ───────────────────────── 对外接口 ───────────────────────── */
  const api = {
    pickables: [book],
    label(tag) {
      if (tag === 'lan-album') return '翻开相册';
      return null;
    },
    click(tag) {
      if (tag === 'lan-album') { buildUI(); ui.open('album'); void refreshAlbum(); return true; }
      if (tag === 'dev') {
        // 书桌上的阅读器：她坐过去看书，同时把读书面板叫出来
        if (typeof pose === 'function') pose('read_desk');
        buildUI(); ui.open('read'); void refreshReading();
        return true;
      }
      return false;
    },
    open(tab) { buildUI(); ui.open(tab); },
    close() { if (ui) ui.close(); },
    refreshAlbum,
    refreshReading,
    stopVoice,
    get state() { return { album: albumState, reading: readingState, sound: { ...sound }, chat: chatHistory.map(t => ({ ...t })), diary: diary.length }; },
  };

  // 先按示例铺墙，宿主数据回来后再换（避免开屏时墙上空着）
  pushWall(FALLBACK);
  // 覆盖层一次建好：聊天输入框要一直在，不然「接上聊天」等于还得先点开什么。
  buildUI();
  wire();
  if (host) setTimeout(() => { void refreshAlbum(); void refreshJourney(); }, 600);

  // 底部导航条加两个入口：桌上的书要看得见才想得到，图标按钮不够直白
  const nav = document.querySelector('nav.bar');
  if (nav) {
    const mk = (label, tip, fn) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.title = tip;
      b.setAttribute('aria-label', tip);
      b.onclick = fn;
      nav.prepend(b);
      return b;
    };
    mk('相册', '翻相册，贴到墙上', () => api.open('album'));
    mk('书架', '接着上次读的地方', () => api.open('read'));
  }

  window.LAN_COMPANION = api;
  return api;
};
})();
