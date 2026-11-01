const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Lifecycle, Player, tailFadeActive } = require('../MALFOY-ENGINE/web/live2d/world-video');

test('normal -> quiet at 60s -> sleep at 300s; a tap wakes her', () => {
  const m = new Lifecycle();
  m.tick(59); assert.equal(m.state, 'idle');
  m.tick(1); assert.equal(m.state, 'quiet');
  m.tick(239); assert.equal(m.state, 'quiet');
  m.tick(1); assert.equal(m.state, 'sleep');
  m.interact(true); assert.equal(m.state, 'idle'); assert.equal(m.idle, 0);
});
test('hidden, paused, inactive and conversation time never count as idle', () => {
  for (const flag of ['hidden', 'paused', 'busy']) {
    const m = new Lifecycle(); m.tick(30); m[flag] = true; m.tick(600);
    assert.equal(m.state, 'idle'); assert.equal(m.idle, 30);
  }
  const m = new Lifecycle(); m.active = false; m.tick(600); assert.equal(m.idle, 0);
  m.tick(NaN); m.tick(-1); assert.equal(m.idle, 0);
});
test('touch does not restart on repeated taps; completed reaction returns to idle', () => {
  const m = new Lifecycle(); let changes = 0; m.onchange = () => changes++;
  m.interact(true); m.interact(true); assert.equal(changes, 1); assert.equal(m.state, 'touch');
  m.finishTouch(); assert.equal(m.state, 'idle');
  m.set('quiet'); m.interact(true); assert.equal(m.state, 'idle');
  assert.equal(m.set('bogus'), false);
});
class Video extends EventEmitter {
  constructor() { super(); this.dataset = {}; this.style = {}; this.currentTime = .4; this.duration = 2; this.paused = true; this.ready = false; }
  addEventListener(...args) { this.on(args[0], args[1]); }
  removeEventListener(...args) { this.off(args[0], args[1]); }
  load() { this.ready = false; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  decode() { this.ready = true; this.emit('loadeddata'); }
  getBoundingClientRect() { return { width: 320, height: 180 }; }
}
function fixture() {
  const slots = [new Video(), new Video()];
  const anchor = { style: {} };
  const config = { clips: Object.fromEntries(['idle', 'touch', 'quiet', 'sleep'].map(s => [s, { file: s + '.webm' }])) };
  const container = { querySelectorAll: () => slots, querySelector: (sel) => sel === '#world-anchor' ? anchor : null, dataset: {}, hidden: true };
  const player = new Player(container, config);
  return { player, slots, container, anchor };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function started() { const f = fixture(); f.player.activate(true); f.slots[0].decode(); await flush(); return f; }

test('tail fade only applies to the touch clip near its end', () => {
  assert.equal(tailFadeActive('touch', 0.3, 0.4), true);
  assert.equal(tailFadeActive('touch', 0.8, 0.4), false);
  assert.equal(tailFadeActive('idle', 0.2, 0.4), false);
  assert.equal(tailFadeActive('touch', NaN, 0.4), false);
});

test('touch clip fades to the anchor still before its blurry tail', async () => {
  const { player, slots, anchor } = await started();
  player.interact(true); slots[1].decode(); await flush();
  slots[0].currentTime = 1.9; slots[0].emit('timeupdate');
  assert.equal(player.current, slots[1]);
  slots[1].duration = 8; slots[1].currentTime = 7.7; slots[1].emit('timeupdate');
  assert.equal(slots[1].style.opacity, '0');
  assert.equal(anchor.style.opacity, '1');
});

test('first video stays unpainted until decoded', async () => {
  const { player, slots } = fixture(); player.activate(true);
  assert.equal(player.current, null); assert.equal(slots[0].style.opacity, '0');
  slots[0].decode(); await flush(); assert.equal(player.current, slots[0]); assert.equal(slots[0].paused, false);
});
test('touch waits for idle loop boundary and plays through to completion', async () => {
  const { player, slots } = await started(); player.interact(true); slots[1].decode(); await flush();
  assert.equal(player.current, slots[0]); assert.equal(player.snapshot.loading, true);
  slots[0].currentTime = 1.9; slots[0].emit('timeupdate');
  assert.equal(player.current, slots[1]); assert.equal(slots[1].loop, false); assert.equal(slots[0].paused, true);
  slots[1].emit('ended'); assert.equal(player.machine.state, 'idle');
  assert.equal(player.current, slots[1]); // holds the last frame until idle is decoded
  slots[0].decode(); await flush(); assert.equal(player.current, slots[0]);
});
test('late load cannot overwrite a newer sleep request', async () => {
  const { player, slots } = await started(); player.set('quiet'); player.set('sleep');
  slots[1].decode(); await flush(); assert.equal(player.snapshot.playing, 'sleep');
  assert.equal(player.snapshot.state, 'sleep'); assert.equal(player.snapshot.error, null);
});
test('failed decode retains the previous picture and reports the failure', async () => {
  const { player, slots } = await started(); player.set('sleep'); slots[1].emit('error'); await flush();
  assert.equal(player.current, slots[0]); assert.match(player.snapshot.error, /解码/);
  assert.equal(player.machine.state, 'idle');
});
test('hide/resume preserves time and manual pause across visibility changes', async () => {
  const { player, slots, container } = await started(); slots[0].currentTime = 1.1;
  player.hide(true); assert.equal(slots[0].paused, true);
  player.hide(false); assert.equal(slots[0].paused, false); assert.equal(slots[0].currentTime, 1.1);
  player.pause(true); player.hide(true); player.hide(false); assert.equal(slots[0].paused, true);
  player.activate(false); assert.equal(container.hidden, true);
  player.activate(true); assert.equal(slots[0].paused, true);
});
