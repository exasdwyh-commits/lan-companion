"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSoul, TRAITS } = require("../lib/soul");

const HOUR = 60 * 60 * 1000;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-soul-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, "soul.json"), create: () => createSoul({ dir }) };
}

test("空状态从 baseline 起步，五轴齐全", (t) => {
  const f = fixture(t);
  const s = f.create();
  const snap = s.snapshot(0);
  assert.deepEqual(Object.keys(snap.traits).sort(), TRAITS.slice().sort());
  for (const key of TRAITS) assert.equal(snap.traits[key], 50);
  assert.equal(snap.labels.length, 2);
  assert.equal(snap.wants.length, 3);
});

test("聊一次会推动性情，并且落盘", (t) => {
  const f = fixture(t);
  const s = f.create();
  const r = s.feel("chat", { now: 1000 });
  assert.equal(r.ok, true);
  assert.ok(r.traits.curiosity > 50, "好奇应当上升");
  assert.ok(r.traits.warmth > 50, "温柔应当上升");
  assert.equal(r.delta.curiosity, 2);
  // 换一个实例读同一个目录，值必须还在
  const snap = f.create().snapshot(1000);
  assert.equal(snap.traits.curiosity, r.traits.curiosity);
});

test("同一张收据第二次不加分", (t) => {
  const f = fixture(t);
  const s = f.create();
  const first = s.feel("travel", { now: 1000, receiptId: "trip:1" });
  assert.equal(first.duplicate, false);
  const second = s.feel("travel", { now: 2000, receiptId: "trip:1" });
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.delta, {});
  assert.equal(second.traits.curiosity, first.traits.curiosity);
});

test("没有互动会向 baseline 漂回，但不会瞬间归位", (t) => {
  const f = fixture(t);
  const s = f.create();
  let now = 0;
  for (let i = 0; i < 10; i += 1) {
    now += 1000;
    s.feel("read", { now });
  }
  const peak = s.snapshot(now).traits.curiosity;
  assert.ok(peak > 60, `十次读书应明显推高好奇，实际 ${peak}`);

  const oneHour = s.snapshot(now + 1 * HOUR).traits.curiosity;
  assert.ok(oneHour < peak && oneHour > 50, "一小时只该漂掉一点");
  const threeDays = s.snapshot(now + 72 * HOUR).traits.curiosity;
  assert.equal(threeDays, 50, "三天后应完全回到原位");
});

test("越接近极值越难推动，但封顶在 100", (t) => {
  const f = fixture(t);
  const s = f.create();
  let now = 0;
  let prevFirstStep = Infinity;
  for (let i = 0; i < 200; i += 1) {
    now += 1000;
    const r = s.feel("decorate", { now });
    const step = r.delta.order || 0;
    assert.ok(step <= prevFirstStep, "步长不该越来越大");
    prevFirstStep = step;
  }
  const snap = s.snapshot(now);
  assert.equal(snap.traits.order, 100);
  assert.ok(snap.traits.order <= 100);
});

test("她自己写的话最多留 8 条，重复的合并，过长的拒收", (t) => {
  const f = fixture(t);
  const s = f.create();
  for (let i = 0; i < 12; i += 1) {
    const r = s.note(`第${i}句话`);
    assert.equal(r.ok, true);
  }
  assert.equal(s.snapshot().notes.length, 8);
  assert.equal(s.snapshot().notes[7], "第11句话");

  const dup = s.note("第11句话");
  assert.equal(dup.duplicate, true);
  assert.equal(s.snapshot().notes.length, 8);

  const tooLong = s.note("啊".repeat(41));
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.reason, "too-long");
});

test("prompt 片段可读、带性情与自我描述、长度可控", (t) => {
  const f = fixture(t);
  const s = f.create();
  s.feel("fish", { now: 1000 });
  s.note("我喜欢水边的声音");
  const p = s.prompt(1000);
  assert.equal(typeof p, "string");
  assert.ok(p.length > 0 && p.length <= 120);
  assert.match(p, /性情/);
  assert.match(p, /我喜欢水边的声音/);
});

test("独处推进：刚互动过不算，隔天只算一次", (t) => {
  const f = fixture(t);
  const s = f.create();
  const now = 100 * HOUR;
  s.feel("chat", { now });
  assert.equal(s.settle(now + 1 * HOUR).ok, false);
  assert.equal(s.settle(now + 1 * HOUR).reason, "recent");

  const later = s.settle(now + 13 * HOUR);
  assert.equal(later.ok, true);
  assert.equal(s.settle(now + 26 * HOUR).reason, "daily-done");
});

test("坏文件先备份再重置，不静默丢进度", (t) => {
  const f = fixture(t);
  const s = f.create();
  s.feel("chat", { now: 1000 });
  fs.writeFileSync(f.file, "{ 这不是 json");
  const snap = f.create().snapshot(0);
  assert.equal(snap.traits.curiosity, 50);
  const backups = fs.readdirSync(f.dir).filter((n) => n.startsWith("soul.json.bad-"));
  assert.equal(backups.length, 1, "坏文件必须留下一份");
  assert.match(fs.readFileSync(path.join(f.dir, backups[0]), "utf8"), /这不是 json/);
});

test("非法输入一律抛错，不静默降级", (t) => {
  const f = fixture(t);
  const s = f.create();
  assert.throws(() => s.feel("no-such-event"), TypeError);
  assert.throws(() => s.feel("chat", { intensity: 0 }), TypeError);
  assert.throws(() => s.feel("chat", { intensity: 9 }), TypeError);
  assert.throws(() => s.feel("chat", { receiptId: "" }), TypeError);
  assert.throws(() => s.set("nope", 10), TypeError);
  assert.throws(() => s.set("calm", 101), TypeError);
  assert.throws(() => s.wants(0, 0), TypeError);
});

test("set 能把某一轴直接钉住，读回一致", (t) => {
  const f = fixture(t);
  const s = f.create();
  const snap = s.set("play", 80);
  assert.equal(snap.traits.play, 80);
  assert.equal(f.create().snapshot(snap.updatedAt).traits.play, 80);
});
