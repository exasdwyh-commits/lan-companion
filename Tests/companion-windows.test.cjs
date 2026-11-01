const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const policy = require('../MALFOY-ENGINE/lib/window-policy');

test('world remains compact and reachable on small/offset displays', () => {
  for (const area of [{ x: 0, y: 25, width: 1440, height: 875 }, { x: -1440, y: 0, width: 1440, height: 900 }, { x: 0, y: 0, width: 320, height: 180 }]) {
    const r = policy.worldBounds(area, { x: 9000, y: -5000, width: 640 });
    assert.ok(r.width <= 960 && r.width <= area.width);
    assert.ok(r.x >= area.x && r.y >= area.y);
    assert.ok(r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height);
    assert.ok(Math.abs(r.width / r.height - 16 / 9) < .01);
  }
});
test('composer expands toward the screen interior and collapses to the same corner', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const icon = policy.composerBounds(area, false);
  const panel = policy.composerBounds(area, true, icon);
  assert.equal(panel.x + panel.width, icon.x + icon.width);
  assert.equal(panel.y + panel.height, icon.y + icon.height);
  assert.deepEqual(policy.composerBounds(area, false, panel), icon);
});

// Exercise the real window/IPC orchestration with fake Electron surfaces. No
// native windows, user settings, model calls, microphone, or browser are opened.
async function boot() {
  const windows = [], handlers = new Map(), listeners = new Map(), shortcuts = new Map();
  class Contents extends EventEmitter {
    constructor() { super(); this.messages = []; this.loading = true; }
    send(channel, payload) { this.messages.push({ channel, payload }); }
    isLoadingMainFrame() { return this.loading; }
    finish() { this.loading = false; this.emit('did-finish-load'); }
  }
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.rect = { x: options.x, y: options.y, width: options.width, height: options.height }; this.webContents = new Contents(); this.destroyed = false; this.visible = false; this.focuses = 0; windows.push(this); }
    loadFile(file, options) { this.file = file; this.query = options?.query; }
    getBounds() { return { ...this.rect }; } setBounds(rect) { this.rect = { ...rect }; }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setAspectRatio(ratio) { this.ratio = ratio; }
    setIgnoreMouseEvents(value) { this.ignores = value; }
    setFocusable(value) { this.focusable = value; }
    setHasShadow(value) { this.shadow = value; }
    setVibrancy(value) { this.vibrancy = value; }
    showInactive() { this.visible = true; } show() { this.visible = true; }
    hide() { this.visible = false; } focus() { this.focuses++; }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isFocused() { return false; }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
  const electron = {
    globalShortcut: { register: (key, cb) => shortcuts.set(key, cb), isRegistered: key => shortcuts.has(key), unregisterAll() {} },
  };
  const context = vm.createContext({
    __dirname: path.resolve(__dirname, '../MALFOY-ENGINE'), path,
    app: { whenReady: () => Promise.resolve(), dock: { hide() {} }, getLoginItemSettings: () => ({}), on() {} },
    BrowserWindow: Window, Tray: class { setTitle() {} setToolTip() {} setContextMenu(menu) { this.menu = menu; } },
    Menu: { buildFromTemplate: x => x }, screen: { getPrimaryDisplay: () => display, getDisplayMatching: () => display, on() {} },
    nativeImage: { createEmpty: () => ({}) }, WINDOW_POLICY: policy,
    AUDIO_EPOCH:0, AbortController, DATA:{dir:'/tmp/deepwhale-window-fixture'},
    synthesizeVoice:async()=>({audio:null,via:'none'}),
    // main.js 里 synthesizeScript 定义在 `const PAGE =` 之前，本切片取不到，
    // 所以和 synthesizeVoice 一样在这里注入替身（多角色配音，非本文件验收对象）。
    synthesizeScript:async()=>({audio:null,via:'none'}),
    ipcMain: { handle: (name, cb) => handlers.set(name, cb), on: (name, cb) => listeners.set(name, cb) },
    fs: { writeFileSync() {} }, process: { pid: 101, env: {}, platform: 'darwin' },
    require: name => name === 'electron' ? electron : name === 'child_process' ? { execFile() {} } : name === './lib/companion-media' ? {createCompanionMedia:()=>({snapshot:()=>({status:'idle'}),detach(){},stop(){},library:()=>({songs:[]})})} : require(name),
    SESSION: { recent: () => [{ role: 'user', content: 'fixture' }], count: () => 1 },
    getPersonaObj: () => ({ voiceProfiles: {} }),
    llmChat: async () => ({ text: 'fixture answer', via: 'fixture' }),
    recordAndTranscribe: () => new Promise(resolve => { context.finishRecording = resolve; }),
    setInterval: () => 1, clearInterval() {},
    setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; },
  });
  const source = fs.readFileSync(path.join(__dirname, '../MALFOY-ENGINE/main.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('const PAGE ='), source.indexOf('// ── DW-02 探针')), context);
  await Promise.resolve();
  return { windows, handlers, listeners, shortcuts, context };
}
test('startup opens a small world and a separate icon without forcing focus or full screen', async () => {
  const { windows } = await boot(); assert.equal(windows.length, 2);
  const [world, icon] = windows;
  assert.equal(world.options.width, 640); assert.equal(world.options.height, 360);
  assert.equal(world.options.fullscreenable, false); assert.equal(world.options.resizable, true);
  assert.equal(icon.options.width, 64); assert.equal(icon.options.height, 64);
  assert.equal(world.query.chat, undefined);
  world.webContents.finish(); icon.webContents.finish();
  assert.equal(world.visible, true); assert.equal(icon.visible, true); assert.equal(world.focuses, 0);
});
test('independent composer survives shape changes; only the stage can disable click-through', async () => {
  const { windows, handlers, listeners } = await boot(); const icon = windows[1];
  windows.forEach(w => w.webContents.finish());
  handlers.get('composer:toggle')({ sender: icon.webContents }, true);
  assert.equal(icon.rect.width, 340); assert.equal(icon.focusable, true);
  assert.equal(icon.vibrancy, 'popover'); assert.equal(icon.shadow, true);
  handlers.get('composer:toggle')({ sender: icon.webContents }, false);
  assert.equal(icon.vibrancy, null); assert.equal(icon.shadow, false);
  await handlers.get('companion:summon')(); const desktop = windows[2]; desktop.webContents.finish();
  assert.equal(desktop.options.transparent, true); assert.equal(desktop.ignores, true);
  assert.equal(windows[1], icon); assert.equal(icon.destroyed, false);
  listeners.get('stage:hit')({ sender: icon.webContents }, true); assert.equal(desktop.ignores, true);
  listeners.get('stage:hit')({ sender: desktop.webContents }, true); assert.equal(desktop.ignores, false);
});
test('hide/resume preserves the scene and keeps the icon usable', async () => {
  const { windows, handlers, listeners } = await boot(); const [world, icon] = windows;
  windows.forEach(w => w.webContents.finish()); listeners.get('stage:dormant')();
  assert.equal(world.visible, false); assert.equal(world.destroyed, false); assert.equal(icon.visible, true);
  await handlers.get('companion:world')(); assert.equal(windows.length, 2); assert.equal(world.visible, true);
  assert.equal(world.webContents.messages.at(-1).channel, 'scene:visible');
});
test('voice input is single-flight and concurrent microphone requests fail clearly', async () => {
  const { windows, handlers, context } = await boot(); windows.forEach(w => w.webContents.finish());
  const first = handlers.get('companion:listen')({}, { seconds: 4 });
  const second = await handlers.get('companion:listen')({}, { seconds: 4 });
  assert.equal(second.ok, false); assert.match(second.err, /录音/);
  context.finishRecording({ ok: true, text: 'fixture' }); assert.equal((await first).ok, true);
});
test('tray video command waits for the new scene to load', async () => {
  const { windows, handlers, context } = await boot(); windows.forEach(w => w.webContents.finish());
  await handlers.get('companion:summon')(); windows[2].webContents.finish();
  vm.runInContext('setSceneVideo("sleep")', context);
  const world = windows[3]; assert.equal(world.webContents.messages.length, 0);
  world.webContents.finish(); assert.ok(world.webContents.messages.some(m => m.channel === 'scene:video' && m.payload === 'sleep'));
});
test('desktop size follows the next desktop window without changing world geometry', async () => {
  const { windows, handlers, context } = await boot();
  windows.forEach(w => w.webContents.finish());
  vm.runInContext('setDesktopSize(140); setDesktopSize(999)', context);
  await handlers.get('companion:summon')();
  const desktop = windows.at(-1); desktop.webContents.finish();
  assert.equal(desktop.webContents.messages.find(m => m.channel === 'character:size').payload, 140);
  vm.runInContext('setDesktopSize(220)', context);
  assert.equal(desktop.webContents.messages.at(-1).payload, 220);
  await handlers.get('companion:world')(); const world = windows.at(-1); world.webContents.finish();
  assert.equal(world.rect.width, 640); assert.equal(world.rect.height, 360);
  assert.ok(!world.webContents.messages.some(m => m.channel === 'character:size'));
  await handlers.get('companion:summon')(); windows.at(-1).webContents.finish();
  assert.equal(windows.at(-1).webContents.messages.find(m => m.channel === 'character:size').payload, 220);
});
