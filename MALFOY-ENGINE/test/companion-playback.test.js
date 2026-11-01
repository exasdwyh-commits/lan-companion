"use strict";
// 播放器只做一件事：保证同一时刻只有一个声音，并且逐句播报时不断档
// —— 断档会让她在句子之间掉回 idle，表情和动作跟着抖。
const test = require("node:test");
const assert = require("node:assert");

class FakeAudio {
  constructor() {
    this.listeners = {}; this.played = []; this.paused = true;
    this.src = ""; this.volume = 1; this.currentTime = 0; this.duration = 1;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  emit(type) { for (const fn of [...(this.listeners[type] || [])]) fn(); }
  play() { this.paused = false; this.played.push(this.src); return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute(name) { if (name === "src") this.src = ""; }
  load() {}
}

const { Player, DEFAULTS } = require("../web/live2d/companion-playback");

// 可推进的假时钟：淡出靠定时器，用真实毫秒去等会让测试变慢且不稳。
function makeClock() {
  let now = 0, next = 1;
  const timers = new Map();
  return {
    now: () => now,
    setInterval: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    advance(ms) {
      for (let elapsed = 0; elapsed < ms; elapsed += 10) {
        now += 10;
        for (const [id, timer] of [...timers]) if (timers.has(id)) timer.fn();
      }
    },
    get pending() { return timers.size; },
  };
}

function makePlayer(options) {
  const audio = new FakeAudio();
  const events = [];
  const clock = makeClock();
  const player = new Player({
    audio,
    active: (kind, on) => events.push([kind, on]),
    prepare: () => {},
    clock,
    ...(options || {}),
  });
  return { audio, player, events, clock };
}

const flush = () => new Promise((r) => setImmediate(r));

test("enqueue 第一条立刻播，不等队列周期", async () => {
  const { player, audio } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await flush();
  assert.equal(audio.played.length, 1);
  assert.ok(audio.src.includes("AAA"));
  assert.equal(player.snapshot.queued, 0);
});

test("第二条排队等待，不打断正在播的第一条", async () => {
  const { player, audio } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await player.enqueue({ kind: "speaking", audio: "BBB" });
  await flush();
  assert.equal(audio.played.length, 1, "第二条不该抢播");
  assert.ok(audio.src.includes("AAA"));
  assert.equal(player.snapshot.queued, 1);
});

test("一条播完自动接下一条，且中途不掉回 idle", async () => {
  const { player, audio, events } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await player.enqueue({ kind: "speaking", audio: "BBB" });
  audio.emit("ended");
  await flush();
  assert.ok(audio.src.includes("BBB"), "应已切到第二句");
  // 中间那次 active(false) 会让她的口型和动作抖一下，必须没有
  assert.deepEqual(events.filter((e) => e[1] === false), []);
});

test("最后一条播完才收起「正在说话」", async () => {
  const { player, audio, events } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await player.enqueue({ kind: "speaking", audio: "BBB" });
  audio.emit("ended");
  await flush();
  audio.emit("ended");
  await flush();
  assert.deepEqual(events.at(-1), ["speaking", false]);
  assert.equal(player.snapshot.kind, null);
});

test("stop 必须把排队里的句子一起丢掉（否则停止后还会自说自话）", async () => {
  const { player, audio } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await player.enqueue({ kind: "speaking", audio: "BBB" });
  player.stop();
  await flush();
  audio.emit("ended");
  await flush();
  assert.equal(player.snapshot.queued, 0);
  const playedAfterStop = audio.played.filter((s) => s.includes("BBB"));
  assert.deepEqual(playedAfterStop, [], "停止后不该再播排队的句子");
});

test("load 换台要清空排队：歌/朗读不能被聊天碎片插进来", async () => {
  const { player, audio } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await player.enqueue({ kind: "speaking", audio: "BBB" });
  await player.load({ kind: "song", audio: "SONG" });
  await flush();
  assert.ok(audio.src.includes("SONG"));
  assert.equal(player.snapshot.queued, 0);
  audio.emit("ended");
  await flush();
  assert.equal(audio.played.length, 2, "换台后只该播新内容");
});

test("播放失败不会把后面的句子一起吞掉", async () => {
  const { player, audio } = makePlayer();
  audio.play = () => Promise.reject(new Error("nope"));
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await player.enqueue({ kind: "speaking", audio: "BBB" });
  await flush();
  // 第一句播不出去 → finish('error') → 自动接第二句；这里只要求不抛异常、队列被消费
  assert.equal(player.snapshot.queued, 0);
});

// ── 淡出：打断要「听起来像她停了」，不是「设备坏了」 ──────────────

test("stop 不是硬切：先降音量，降完才真的停", async () => {
  const { player, audio, clock } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await flush();
  player.stop();
  assert.equal(audio.paused, false, "刚点停止时不能立刻静音，否则就是硬切");
  assert.equal(audio.volume, 1, "这一瞬间还是原音量");
  clock.advance(50);
  assert.ok(audio.volume < 1 && audio.volume > 0, "中途应在 0~1 之间，实际 " + audio.volume);
  clock.advance(60);
  assert.equal(audio.paused, true, "淡出结束后才停");
  assert.equal(clock.pending, 0, "定时器必须清掉，否则会一直空转");
});

test("淡出时长按 fadeMs 走，90ms 是默认值", async () => {
  const { player, audio, clock } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await flush();
  player.stop();
  clock.advance(DEFAULTS.fadeMs - 20);
  assert.equal(audio.paused, false, "还没到时间就停了 = 时长算错");
  clock.advance(40);
  assert.equal(audio.paused, true);
});

test("淡出途中来了新句子：音量要立刻恢复，不能让她哑着说完", async () => {
  const { player, audio } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await flush();
  player.stop();
  assert.equal(audio.paused, false);
  await player.enqueue({ kind: "speaking", audio: "BBB" });
  await flush();
  assert.equal(audio.volume, 1, "新的一句必须满音量开始");
  assert.ok(audio.src.includes("BBB"));
  assert.equal(player.snapshot.queued, 0, "停止后队列已清空，新句子该立刻播而不是排队");
});

test("load 换台不淡出：切歌不该留一段旧声音的尾巴", async () => {
  const { player, audio, clock } = makePlayer();
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await flush();
  await player.load({ kind: "song", audio: "SONG" });
  assert.equal(clock.pending, 0, "换台不该排一个淡出定时器");
  assert.ok(audio.src.includes("SONG"));
  assert.equal(player.snapshot.queued, 0);
});

test("fadeMs=0 退化为硬停（给不支持音量的环境兜底）", async () => {
  const { player, audio, clock } = makePlayer({ fadeMs: 0 });
  await player.enqueue({ kind: "speaking", audio: "AAA" });
  await flush();
  player.stop();
  assert.equal(audio.paused, true);
  assert.equal(clock.pending, 0);
});
