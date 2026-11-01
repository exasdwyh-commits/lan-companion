"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createIntent, GLOBAL_COOLDOWN_MS, isNight } = require("../lib/intent");

const MIN = 60 * 1000;
const at = (hour, minute = 0) => new Date(2026, 10, 1, hour, minute, 0, 0).getTime();

function fixture(t, seed = 1) {
  let a = seed >>> 0;
  const rng = () => { a = (a + 0x6d2b79f5) >>> 0; return ((a ^ (a >>> 15)) >>> 0) / 4294967296; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-intent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, create: (r = rng) => createIntent({ dir, rng: r }) };
}

const gardenRipe = { plots: [{ name: "小番茄", ready: true, withered: false }] };
const fishingOpen = { spots: [{ name: "旧码头", open: true }] };
const roomRoom = { items: [], maxItems: 24 };
const wantsGarden = [{ drive: "tendGarden", weight: 0.9 }, { drive: "rest", weight: 0.5 }];

test("花园有熟的就去摘：连动作带一句台词", (t) => {
  const f = fixture(t);
  const plan = f.create().decide({ wants: wantsGarden, context: { garden: gardenRipe, fishing: fishingOpen, room: roomRoom }, now: at(12) });
  assert.equal(plan.action, "tendGarden");
  assert.match(plan.line, /小番茄/);
});

test("可行性优先于意愿：花园没熟的，再想也去不了", (t) => {
  const f = fixture(t);
  const noRipe = { plots: [{ name: "小番茄", ready: false, withered: false }] };
  const plan = f.create().decide({
    wants: [{ drive: "tendGarden", weight: 1 }, { drive: "fish", weight: 0.2 }],
    context: { garden: noRipe, fishing: fishingOpen, room: roomRoom }, now: at(12),
  });
  assert.equal(plan.action, "fish", "退到第二想而且做得到的那个");
});

test("屋里摆满了就不再改造，而不是硬改", (t) => {
  const f = fixture(t);
  const full = { items: new Array(24).fill({}), maxItems: 24 };
  const plan = f.create().decide({
    wants: [{ drive: "decorate", weight: 1 }, { drive: "rest", weight: 0.1 }],
    context: { garden: { plots: [] }, fishing: { spots: [] }, room: full }, now: at(12),
  });
  assert.equal(plan.action, "rest");
});

test("夜里只休息：凌晨三点不该说她想去挪家具", (t) => {
  const f = fixture(t);
  assert.equal(isNight(at(3)), true);
  assert.equal(isNight(at(12)), false);
  const plan = f.create().decide({
    wants: [{ drive: "tendGarden", weight: 1 }, { drive: "decorate", weight: 1 }],
    context: { garden: gardenRipe, fishing: fishingOpen, room: roomRoom }, now: at(3),
  });
  assert.equal(plan.action, "rest");
  assert.equal(plan.reason, "night");
});

test("同一件事做完要等冷却，冷却内换别的做", (t) => {
  const f = fixture(t);
  const g = f.create();
  const ctx = { garden: gardenRipe, fishing: fishingOpen, room: roomRoom };
  const now = at(12);
  assert.equal(g.decide({ wants: wantsGarden, context: ctx, now }).action, "tendGarden");
  g.done("tendGarden", now);
  const next = g.decide({ wants: wantsGarden, context: ctx, now: now + 1 * MIN });
  assert.equal(next.action, "idle", "全局冷却未过，什么都不做");
});

test("全局冷却过后，冷却中的动作被跳过、别的动作可用", (t) => {
  const f = fixture(t);
  const g = f.create();
  const ctx = { garden: gardenRipe, fishing: fishingOpen, room: roomRoom };
  const now = at(12);
  g.done("tendGarden", now);
  const wants = [{ drive: "tendGarden", weight: 1 }, { drive: "fish", weight: 0.3 }];
  const plan = g.decide({ wants, context: ctx, now: now + GLOBAL_COOLDOWN_MS + MIN });
  assert.equal(plan.action, "fish", "花园还在冷却，改去水边");
});

test("没东西可做时给 idle，不硬造一个动作", (t) => {
  const f = fixture(t);
  const plan = f.create().decide({
    wants: [{ drive: "fish", weight: 1 }],
    context: { garden: { plots: [] }, fishing: { spots: [] }, room: { items: [] } }, now: at(12),
  });
  assert.equal(plan.action, "idle");
  assert.equal(plan.reason, "nothing-feasible");
  assert.equal(plan.line, null);
});

test("快照缺项只让动作不可行，不抛异常", (t) => {
  const f = fixture(t);
  const plan = f.create().decide({
    wants: [{ drive: "tendGarden", weight: 1 }, { drive: "fish", weight: 1 }, { drive: "rest", weight: 0.1 }],
    context: { garden: null, fishing: undefined, room: null }, now: at(12),
  });
  assert.equal(plan.action, "rest");
});

test("未知动作、非法入参一律抛错", (t) => {
  const f = fixture(t);
  const g = f.create();
  assert.throws(() => g.done("flyToMoon"), TypeError);
  assert.throws(() => g.decide({ wants: "not-an-array" }), TypeError);
  assert.throws(() => createIntent({}), TypeError);
  assert.throws(() => createIntent({ dir: f.dir, rng: 1 }), TypeError);
});

test("时钟回拨不会被当成永久冷却", (t) => {
  const f = fixture(t);
  const future = at(20);
  const past = at(12);
  const g = f.create();
  g.done("fish", future);   // 存了一个"未来"的时间戳
  const plan = g.decide({ wants: [{ drive: "fish", weight: 1 }], context: { fishing: fishingOpen }, now: past });
  assert.equal(plan.action, "fish", "时间倒退时该照常可做，而不是沉默到二十点");
});

test("冷却状态落盘，重启后仍然生效", (t) => {
  const f = fixture(t);
  const now = at(12);
  f.create().done("fish", now);
  const again = f.create().decide({ wants: [{ drive: "fish", weight: 1 }], context: { fishing: fishingOpen }, now: now + MIN });
  assert.equal(again.action, "idle");
});
