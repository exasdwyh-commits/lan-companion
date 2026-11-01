// 曲库/书架面板：分组、空态、播放态不能被一次重构悄悄弄丢。
// 没有 jsdom，用一个够用的最小 DOM 桩（只实现 companion-panel.js 用到的几个方法）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.attrs = {}; this.dataset = {};
    this.textContent = ''; this.className = ''; this.id = '';
    this.hidden = false; this.disabled = false; this.value = ''; this.open = false;
    this.onclick = null; this.onchange = null; this.title = ''; this.type = '';
  }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  append(...kids) { for (const k of kids) this.appendChild(k); }
  replaceChildren(...kids) { this.children = []; for (const k of kids) this.appendChild(k); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return key in this.attrs ? this.attrs[key] : null; }
  querySelectorAll(selector) { return queryAll(this, selector); }
  querySelector(selector) { return queryAll(this, selector)[0] || null; }
}

/** 只认 tag / #id / .class / [attr] 及其后代组合，够本文件用。 */
function matchPart(el, part) {
  const m = part.match(/^([a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/);
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  for (const token of (m[2] || '').match(/[#.][\w-]+|\[[^\]]+\]/g) || []) {
    if (token[0] === '#') { if (el.id !== token.slice(1)) return false; }
    else if (token[0] === '.') { if (!String(el.className || '').split(/\s+/).includes(token.slice(1))) return false; }
    else {
      const key = token.slice(1, -1).split('=')[0];
      if (!(key in el.attrs) && !(key in el.dataset)) return false;
    }
  }
  return true;
}

function walk(el, out = []) { for (const kid of el.children) { out.push(kid); walk(kid, out); } return out; }

function queryAll(root, selector) {
  const parts = String(selector).trim().split(/\s+/);
  let hits = [root, ...walk(root)].filter((el) => matchPart(el, parts[0]));
  for (let i = 1; i < parts.length; i++) {
    const next = [];
    for (const hit of hits) for (const deep of walk(hit)) if (matchPart(deep, parts[i])) next.push(deep);
    hits = next;
  }
  return hits;
}

function boot(library) {
  const ids = new Map();
  const document = {
    body: { dataset: {}, classList: { add() {}, remove() {}, toggle() {} } },
    getElementById(id) {
      if (!ids.has(id)) { const el = new El('div'); el.id = id; ids.set(id, el); }
      return ids.get(id);
    },
    createElement(tag) { return new El(tag); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const seen = new Set(); const out = [];
      for (const root of ids.values()) for (const el of queryAll(root, selector)) if (!seen.has(el)) { seen.add(el); out.push(el); }
      return out;
    },
  };
  let tab, media;
  const host = {
    library: async (query) => ({ ...library, query: String(query || '') }),
    media: async () => ({ ok: true, state: { kind: null, status: 'idle', book: library.book } }),
    journey: async () => ({ diary: [] }),
    cover: async () => ({ ok: true, state: { selected: null, model: { ready: true }, job: null } }),
    openBook: async () => ({ ok: false, cancelled: true }),
    onComposerTab: (cb) => { tab = cb; },
    onMediaState: (cb) => { media = cb; },
    onCoverState() {}, onJourneyState() {},
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../MALFOY-ENGINE/web/live2d/companion-panel.js'), 'utf8'),
    { window: { malfoyHost: host }, document, setTimeout, clearTimeout, Date, Number, String, Boolean, Math },
  );
  return { $: (id) => document.getElementById(id), open: async (name) => { tab(name); await new Promise((r) => setTimeout(r, 0)); }, media: (p) => media(p) };
}

const library = {
  songs: [
    { id: 'c1', title: '夜航星', source: 'cover', duration: 210.46, engine: 'seed-vc-svc-f0-44k', experimental: false, locked: false },
    { id: 'p1', title: '岸边的潮', source: 'pack', duration: 8.71, credit: '原唱样例', experimental: false, locked: false },
    { id: 'x1', title: '旧念词实验', source: 'pack', duration: 8.73, experimental: true, locked: false },
  ],
  books: [],
  currentBookId: null,
  book: null,
};

test('曲库按来源分组：自己的翻唱在前，实验样例不混进正片', async () => {
  const ui = boot(library); await ui.open('singing');
  const rows = ui.$('song-list').children;
  assert.equal(rows[0].className, 'track-group');
  assert.equal(rows[0].textContent, '她自己的翻唱');
  assert.equal(rows[1].dataset.songId, 'c1');
  assert.equal(rows[2].textContent, '随包原曲');
  assert.equal(rows[3].dataset.songId, 'p1');
  assert.equal(rows.length, 4, '只有两首正片，实验样例进另一个折叠区');
  assert.equal(ui.$('songs').children.length, 1);
  assert.match(ui.$('song-count').textContent, /2 首 · 3:39/);
});

test('播放态落在对应那一行，暂停后动画停住但不是换行重建', async () => {
  const ui = boot(library); await ui.open('singing');
  const list = ui.$('song-list').children;
  ui.media({ kind: 'singing', songId: 'c1', status: 'playing' });
  assert.equal(list[1].getAttribute('aria-current'), 'true');
  assert.equal(list[1].dataset.live, 'true');
  assert.equal(list[3].getAttribute('aria-current'), 'false');
  ui.media({ kind: 'singing', songId: 'c1', status: 'paused' });
  assert.equal(list[1].dataset.live, 'false', '暂停时柱子不再动');
  assert.equal(ui.$('song-list').children, list, '状态更新不能重建列表');
});

test('空曲库说清楚下一步，并把「学新歌」摊开', async () => {
  const ui = boot({ songs: [], books: [], currentBookId: null, book: null }); await ui.open('singing');
  assert.equal(ui.$('song-list').children.length, 0);
  assert.match(ui.$('song-hint').textContent, /还没唱过歌/);
  assert.equal(ui.$('cover-studio').open, true);
  assert.equal(ui.$('song-search').hidden, true, '没有歌时搜索框没有意义');
});

test('搜不到东西时搜索框还在，否则连清空都做不到', async () => {
  const ui = boot({ songs: [], books: [], currentBookId: null, book: null });
  await ui.open('singing');
  assert.equal(ui.$('song-search').hidden, true, '曲库真的空，搜索没意义');
  ui.$('song-search').value = '不存在的歌';
  ui.$('song-search').oninput();
  await new Promise((r) => setTimeout(r, 260)); // 防抖 200ms
  assert.equal(ui.$('song-list').children[0].className, 'shelf-empty');
  assert.equal(ui.$('song-search').hidden, false, '有查询词时不能把搜索框藏掉');
});

test('空书架不消失，常驻一句怎么加书', async () => {
  const ui = boot({ songs: [], books: [], currentBookId: null, book: null }); await ui.open('reading');
  const shelf = ui.$('book-shelf');
  assert.equal(shelf.children.length, 1);
  assert.equal(shelf.children[0].className, 'shelf-empty');
  assert.match(shelf.children[0].textContent, /打开电子书/);
});

test('书架标出在读，非在读的可移出', async () => {
  const ui = boot({
    songs: [], book: null, currentBookId: 'b1',
    books: [
      { id: 'b1', title: '爱如灰烬', paragraphs: 686, chapters: 0, updatedAt: '2026-10-31T06:26:33.794Z' },
      { id: 'b2', title: '藏相思-161430859933', paragraphs: 210, chapters: 3, updatedAt: '2026-10-31T06:03:11.325Z' },
    ],
  });
  await ui.open('reading');
  const cards = ui.$('book-shelf').children;
  assert.equal(cards.length, 2);
  assert.equal(cards[0].getAttribute('aria-current'), 'true');
  assert.equal(cards[0].children.find((c) => c.className === 'book-tag').textContent, '在读');
  assert.equal(cards[0].children.some((c) => c.className === 'book-remove'), false, '在读的不能移出');
  assert.equal(cards[1].children.some((c) => c.className === 'book-remove'), true);
  assert.match(cards[1].children[0].children[0].textContent, /^藏相思$/, '发布号不是书名，上架时剥掉');
  assert.equal(ui.$('shelf-count').textContent, '2 本');
});
