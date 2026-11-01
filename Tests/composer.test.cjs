const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function boot() {
  class Element {
    constructor() {
      this.value = ''; this.textContent = ''; this.children = []; this.focuses = 0;
      const classes = new Set(); this.classList = { toggle: (key, on) => on ? classes.add(key) : classes.delete(key) };
    }
    appendChild(child) { child.parent = this; this.children.push(child); }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    querySelector(selector) { return this.children.find(x => selector === '.line' ? x.className?.startsWith('line ') : x.className === 'empty'); }
    get firstElementChild() { return this.children[0]; }
    get scrollHeight() { return this.children.length * 30; }
    focus() { this.focuses++; }
    requestSubmit() { return this.onsubmit({ preventDefault() {} }); }
  }
  const ids = ['status', 'send', 'mic', 'orb', 'messages', 'mode', 'open', 'collapse', 'stop-voice', 'draft', 'form'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const events = {}, calls = { chats: [], toggles: [], listens: 0, audio: 0 };
  const host = {
    composerToggle: async value => calls.toggles.push(value),
    stopVoice: () => calls.audio++,
    chat: (...args) => { calls.chats.push(args); return new Promise(resolve => calls.resolveChat = resolve); },
    listen: () => { calls.listens++; return new Promise(resolve => calls.resolveListen = resolve); },
  };
  for (const name of ['ComposerState', 'CharacterMode', 'CharacterSession']) host['on' + name] = callback => events[name] = callback;
  const context = vm.createContext({
    window: { malfoyHost: host, addEventListener() {} },
    document: { getElementById: id => elements[id], createElement: () => new Element(), body: new Element() },
    setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../MALFOY-ENGINE/web/live2d/composer.js'), 'utf8'), context);
  return { elements, calls, events };
}
test('separate composer restores shared turns and submits no private renderer history', async () => {
  const { elements: e, calls, events } = boot();
  events.CharacterSession({ mode: 'world', turns: [{ role: 'user', content: 'fixture history' }] });
  assert.equal(e.messages.children[0].textContent, 'fixture history');
  e.draft.value = 'hello'; const pending = e.form.requestSubmit();
  assert.equal(calls.chats.length, 1); assert.deepEqual(calls.chats[0], ['hello']);
  assert.equal(e.send.disabled, true);
  calls.resolveChat({ text: '<b>fixture reply</b>', voice: 'fixture audio', via: 'fixture' }); await pending;
  assert.equal(e.messages.children.at(-1).textContent, '<b>fixture reply</b>');
  assert.equal(calls.audio, 0); assert.equal(e.send.disabled, false);
});
test('collapse and mode switching retain pending reply and draft without duplicate submission', async () => {
  const { elements: e, calls, events } = boot();
  events.ComposerState({ expanded: true, mode: 'world' }); e.draft.value = 'hello'; const pending = e.form.requestSubmit();
  e.draft.value = 'next draft'; e.form.requestSubmit();
  await e.collapse.onclick(); events.ComposerState({ expanded: false, mode: 'desktop' });
  events.CharacterMode({ mode: 'desktop' }); assert.match(e.mode.textContent, /活泼/);
  calls.resolveChat({ text: 'reply', voice: null, via: 'fixture' }); await pending;
  assert.equal(calls.chats.length, 1); assert.equal(e.draft.value, 'next draft');
  assert.equal(e.messages.children.at(-1).textContent, 'reply'); assert.deepEqual(calls.toggles, [false]);
});
test('microphone creates a reviewable draft and never sends automatically', async () => {
  const { elements: e, calls } = boot(); const recording = e.mic.onclick();
  e.mic.onclick(); assert.equal(calls.listens, 1); assert.equal(e.send.disabled, true);
  calls.resolveListen({ ok: true, text: 'recognized fixture' }); await recording;
  assert.equal(e.draft.value, 'recognized fixture'); assert.equal(calls.chats.length, 0);
  assert.equal(e.send.disabled, false); assert.match(e.status.textContent, /确认/);
});
test('IME Enter never submits half-composed Chinese text', () => {
  const { elements: e, calls } = boot(); e.draft.value = 'ni';
  e.draft.onkeydown({ key: 'Enter', isComposing: true }); assert.equal(calls.chats.length, 0);
});
