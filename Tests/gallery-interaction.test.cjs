const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createContentPages } = require('../MALFOY-ENGINE/lib/content-pages');
const root = path.resolve(__dirname, '..');

// Run the actual renderer against the actual content adapter/state machine.
// The DOM double models disabled buttons; no browser, services or personal data.
async function boot(t, { followingScene = false, unsubscribe = true, notifyDuringInit = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-renderer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const contentDir = path.join(dir, 'content');
  fs.mkdirSync(contentDir);
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'assets/whale-video-test/pack.json')));
  if (followingScene) pack.chapters[0].flow.push({ clip: 's1' });
  fs.writeFileSync(path.join(contentDir, 'pack.json'), JSON.stringify(pack));
  const observers = new Set(), lifecycle = {};
  const pages = createContentPages({ dataDir: path.join(dir, 'data'), contentDir,
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: {
      send: (event, state) => { if (event === 'affection:changed') for (const callback of observers) callback(state); },
    } }] }, ipcMain: {}, dialog: {} });
  const calls = [];
  let intercept = async () => {}, readState = () => pages.view(), reads = 0;
  const host = { state: async () => {
    reads++;
    if (reads === 1 && notifyDuringInit) {
      const stale = pages.view(); pages.affection.set(100); pages.notify(); return stale;
    }
    return readState();
  }, action: async payload => {
    calls.push(payload);
    await intercept(payload);
    try { return pages.action(payload); }
    catch (error) { return { ok: false, error: error.message }; }
  } };
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.listeners = {}; this.style = {};
      this.dataset = {}; this.attributes = {};
      this.hidden = false; this.disabled = false; this.textContent = '';
    }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    click() { if (!this.disabled && !this.hidden) return this.listeners.click?.(); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    focus() { document.activeElement = this; }
    querySelectorAll() { return this.children.flatMap(child =>
      [...(child.tag === 'button' ? [child] : []), ...child.querySelectorAll()]); }
  }
  const elements = new Map();
  const document = { body: new Element(), activeElement: null,
    createElement: tag => new Element(tag), addEventListener() {},
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'MALFOY-ENGINE/web/live2d/gallery.js'), 'utf8'), {
    document, window: { malfoyHost: { gallery: host, onAffection: callback => {
      observers.add(callback);
      return unsubscribe ? () => observers.delete(callback) : {};
    } }, addEventListener: (event, callback) => { lifecycle[event] = callback; } },
    location: { search: '' }, URLSearchParams,
  });
  await new Promise(resolve => setImmediate(resolve));
  const el = id => elements.get(id);
  const start = () => el('chapter-list').querySelectorAll()[0].click();
  const next = () => el('story-continue').click();
  return { el, calls, pages, start, next, document, lifecycle, observers,
    reads: () => reads, readState: fn => { readState = fn; },
    intercept: fn => { intercept = fn; } };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('starting a chapter releases the continue button after the host responds', async t => {
  const h = await boot(t);
  await h.start();
  assert.equal(h.el('story-overlay').hidden, false);
  assert.equal(h.el('story-continue').disabled, false);
  await h.next();
  assert.equal(h.pages.gallery.snapshot().progress.index, 1);
});

for (const option of ['A', 'B']) test(`renderer can continue, select ${option}, finish and replay without duplicate reward`, async t => {
  const h = await boot(t);
  for (let replay = 0; replay < 2; replay++) {
    await h.start();
    for (let i = 0; i < 4; i++) await h.next();
    const choices = h.el('story-choices').querySelectorAll();
    assert.equal(choices.length, 2);
    assert.equal(choices[0].disabled, false);
    assert.equal(choices[1].disabled, false);
    await choices[option === 'A' ? 0 : 1].click();
    assert.equal(h.pages.gallery.snapshot().progress.branch, option);
    assert.equal(h.el('story-continue').disabled, false);
    await h.next();
    assert.equal(h.el('story-progress').textContent, 'THE END');
    assert.equal(h.pages.gallery.snapshot().progress.done, true);
    assert.equal(h.pages.affection.snapshot().value, 13); // daily 3 + first chapter 10
    assert.equal(h.el('chapter-list').querySelectorAll()[0].textContent, '重看');
    h.el('story-close').click();
  }
});

test('a branch followed by another scene keeps renderer and backend at the same step', async t => {
  const h = await boot(t, { followingScene: true });
  await h.start();
  for (let i = 0; i < 4; i++) await h.next();
  await h.el('story-choices').querySelectorAll()[0].click();
  await h.next();
  assert.equal(h.pages.gallery.snapshot().progress.index, 5);
  assert.equal(h.pages.gallery.snapshot().progress.done, false);
  assert.equal(h.el('story-progress').textContent, '第 6 幕');
  await h.next();
  assert.equal(h.pages.gallery.snapshot().progress.done, true);
});

test('failed advance, choice and completion can be retried through enabled controls', async t => {
  const h = await boot(t);
  await h.start();
  const failOnce = action => h.intercept(payload => {
    if (payload.action === action) { h.intercept(async () => {}); throw new Error('fixture failure'); }
  });
  failOnce('advance'); await h.next();
  assert.match(h.el('story-status').textContent, /fixture failure/);
  assert.equal(h.el('story-continue').disabled, false);
  for (let i = 0; i < 4; i++) await h.next();
  failOnce('choose'); await h.el('story-choices').querySelectorAll()[0].click();
  assert.match(h.el('story-status').textContent, /fixture failure/);
  assert.equal(h.el('story-choices').querySelectorAll()[0].disabled, false);
  await h.el('story-choices').querySelectorAll()[0].click();
  failOnce('complete'); await h.next();
  assert.match(h.el('story-status').textContent, /fixture failure/);
  assert.equal(h.el('story-continue').disabled, false);
  await h.next();
  assert.equal(h.pages.gallery.snapshot().progress.done, true);
});

test('a pending request blocks double clicks and closing, then releases the controls', async t => {
  const h = await boot(t);
  await h.start();
  let release;
  h.intercept(() => new Promise(resolve => { release = resolve; }));
  const pending = h.next();
  h.next(); h.el('story-close').click();
  assert.equal(h.calls.filter(p => p.action === 'advance').length, 1);
  assert.equal(h.el('story-overlay').hidden, false);
  release(); await pending;
  assert.equal(h.el('story-continue').disabled, false);
  h.el('story-close').click();
  assert.equal(h.el('story-overlay').hidden, true);
});

test('relationship broadcasts unlock an already open gallery and preserve focused card', async t => {
  const h = await boot(t);
  const before = h.el('photo-count').textContent;
  h.el('album-grid').children[0].focus();
  h.pages.affection.set(100); h.pages.notify();
  await settle();
  assert.notEqual(h.el('photo-count').textContent, before);
  assert.equal(h.el('album-grid').children.every(button => !button.disabled), true);
  assert.equal(h.document.activeElement, h.el('album-grid').children[0]);
  assert.equal(h.calls.length, 0); // receiving a notification must not perform a story action
});

test('a relationship change during initial loading is fetched again after initialization', async t => {
  const h = await boot(t, { notifyDuringInit: true });
  assert.equal(h.reads(), 2);
  assert.equal(h.el('album-grid').children.every(button => !button.disabled), true);
});

test('refresh preserves the open photo, desktop variant, status and focus return target', async t => {
  const h = await boot(t);
  h.pages.affection.set(100); h.pages.notify(); await settle();
  const photo = h.pages.view().album.findIndex(item => item.desktopImage);
  const card = h.el('album-grid').children[photo]; card.focus(); card.click();
  h.el('photo-desktop').click();
  const image = h.el('photo-image').src;
  h.el('photo-status').textContent = 'fixture saved';
  h.el('photo-desktop').focus();
  h.pages.affection.set(99); h.pages.notify(); await settle();
  assert.equal(h.el('lightbox').hidden, false);
  assert.equal(h.el('photo-image').src, image);
  assert.equal(h.el('photo-desktop').attributes['aria-pressed'], 'true');
  assert.equal(h.el('photo-status').textContent, 'fixture saved');
  assert.equal(h.document.activeElement, h.el('photo-desktop'));
  h.el('photo-close').click();
  assert.equal(h.document.activeElement, h.el('album-grid').children[photo]);
});

test('relationship refresh keeps the current choice and failed action message', async t => {
  const h = await boot(t);
  await h.start(); for (let i = 0; i < 4; i++) await h.next();
  h.el('story-choices').querySelectorAll()[1].focus();
  h.el('story-status').textContent = 'fixture retry message';
  const progress = h.el('story-progress').textContent;
  const focused = h.document.activeElement;
  h.pages.affection.set(80); h.pages.notify(); await settle();
  assert.equal(h.reads(), 2);
  assert.equal(h.el('story-progress').textContent, progress);
  assert.equal(h.el('story-status').textContent, 'fixture retry message');
  assert.equal(h.document.activeElement, focused);
  await h.el('story-choices').querySelectorAll()[1].click();
  assert.equal(h.pages.gallery.snapshot().progress.branch, 'B');
});

test('bursts coalesce, discard an outdated read and use the latest authoritative state', async t => {
  const h = await boot(t);
  let release; const stale = h.pages.view();
  h.readState(() => new Promise(resolve => { release = () => resolve(stale); }));
  h.pages.notify(); await settle();
  const reads = h.reads();
  h.pages.affection.set(100);
  for (let i = 0; i < 10; i++) h.pages.notify();
  assert.equal(h.reads(), reads);
  h.readState(() => h.pages.view()); release(); await settle();
  assert.equal(h.reads(), reads + 1);
  assert.equal(h.el('album-grid').children.every(button => !button.disabled), true);
});

test('a stale background read cannot roll back a successful story action', async t => {
  const h = await boot(t);
  await h.start();
  const stale = h.pages.view(); let release;
  h.readState(() => new Promise(resolve => { release = () => resolve(stale); }));
  h.pages.notify(); await settle();
  await h.next();
  h.readState(() => h.pages.view()); release(); await settle();
  assert.equal(h.el('story-progress').textContent, '第 2 幕');
  assert.equal(h.pages.gallery.snapshot().progress.index, 1);
  assert.equal(h.el('story-continue').disabled, false);
});

test('notifications during a pending action wait and do not overwrite a failure', async t => {
  const h = await boot(t); await h.start();
  let reject;
  h.intercept(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = h.next(), reads = h.reads();
  h.pages.affection.set(100); h.pages.notify(); await settle();
  assert.equal(h.reads(), reads);
  reject(new Error('fixture action failure')); await pending; await settle();
  assert.equal(h.el('album-grid').children.every(button => !button.disabled), true);
  assert.match(h.el('story-status').textContent, /fixture action failure/);
  assert.equal(h.el('story-continue').disabled, false);
});

test('a failed refresh keeps visible content and recovers on the next notification', async t => {
  const h = await boot(t);
  const before = h.el('photo-count').textContent;
  h.readState(() => { throw new Error('fixture state failure'); });
  h.pages.notify(); await settle();
  assert.equal(h.el('photo-count').textContent, before);
  assert.match(h.el('error').textContent, /fixture state failure/);
  h.readState(() => h.pages.view()); h.pages.affection.set(100); h.pages.notify(); await settle();
  assert.equal(h.el('error').hidden, true);
  assert.equal(h.el('album-grid').children.every(button => !button.disabled), true);
});

test('a photo that becomes locked closes and returns focus to an available card', async t => {
  const h = await boot(t);
  h.pages.affection.set(100); h.pages.notify(); await settle();
  const index = h.pages.view().album.findIndex(item => item.unlockAt > 0);
  const card = h.el('album-grid').children[index]; card.focus(); card.click();
  h.pages.affection.set(0); h.pages.notify(); await settle();
  assert.equal(h.el('lightbox').hidden, true);
  assert.equal(h.el('album-grid').children[index].disabled, true);
  assert.equal(h.document.activeElement.disabled, false);
  assert.ok(h.el('album-grid').children.includes(h.document.activeElement));
});

for (const unsubscribe of [true, false]) test(`closing the page ignores pending reads and future notifications (unsubscribe=${unsubscribe})`, async t => {
  const h = await boot(t, { unsubscribe });
  let release;
  h.readState(() => new Promise(resolve => { release = resolve; }));
  h.pages.notify(); await settle();
  const before = h.el('photo-count').textContent;
  h.lifecycle.pagehide();
  h.pages.affection.set(100); h.pages.notify();
  release(h.pages.view()); await settle();
  assert.equal(h.el('photo-count').textContent, before);
  assert.equal(h.reads(), 2);
  if (unsubscribe) assert.equal(h.observers.size, 0);
});
