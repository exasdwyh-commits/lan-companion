"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createGarden, SPECIES, PLOT_IDS, STARTER_SEEDS, WATER_SPEED } = require("../lib/garden");

const HOUR = 60 * 60 * 1000;

/** 本地时间构造：晚上 10 点 / 中午 12 点。用本地时间而不是 UTC，避免机器时区让测试翻脸。 */
const at = (hour) => new Date(2026, 10, 1, hour, 0, 0, 0).getTime();

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-garden-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, "garden.json"), create: () => createGarden({ dir }) };
}

test("开局有种子，地块全空", (t) => {
  const f = fixture(t);
  const snap = f.create().snapshot(at(12));
  assert.equal(snap.plots.length, PLOT_IDS.length);
  assert.ok(snap.plots.every((p) => p.species === null && p.stage === 0));
  for (const [id, n] of Object.entries(STARTER_SEEDS)) assert.equal(snap.seeds[id], n);
  assert.equal(snap.plants.length, Object.keys(SPECIES).length);
});

test("种下扣种子，时间走完才熟", (t) => {
  const f = fixture(t);
  const g = f.create();
  const now = at(12);
  const planted = g.plant("p0", "daisy", now);
  assert.equal(planted.ok, true);
  assert.equal(planted.seeds.daisy, STARTER_SEEDS.daisy - 1);
  assert.equal(planted.plots[0].stage, 0);
  assert.equal(planted.plots[0].ready, false);

  const half = g.snapshot(now + SPECIES.daisy.growMs / 2);
  assert.ok(half.plots[0].stage > 0.4 && half.plots[0].stage < 0.6);
  assert.equal(half.plots[0].ready, false);

  const done = g.snapshot(now + SPECIES.daisy.growMs);
  assert.equal(done.plots[0].ready, true);
  assert.equal(done.plots[0].stage, 1);
  assert.equal(done.plots[0].remainingMs, 0);
});

test("生长不靠写盘推进：同一个 plantedAt 隔多久读都算得出来", (t) => {
  const f = fixture(t);
  const now = at(12);
  f.create().plant("p0", "sunflower", now);
  // 中间一次都不写，直接跳到 4 小时后
  const snap = f.create().snapshot(now + SPECIES.sunflower.growMs);
  assert.equal(snap.plots[0].ready, true);
});

test("浇水打六折，重复浇水被拒", (t) => {
  const f = fixture(t);
  const g = f.create();
  const now = at(12);
  g.plant("p0", "sunflower", now);
  const half = now + SPECIES.sunflower.growMs / 2;
  assert.equal(g.snapshot(half).plots[0].ready, false);

  const watered = g.water("p0", now);
  assert.equal(watered.ok, true);
  assert.equal(watered.plots[0].ready, false);
  // 一半时间 × 0.6 → 应该在 growMs*0.6 之前就熟
  const after = g.snapshot(now + SPECIES.sunflower.growMs * WATER_SPEED);
  assert.equal(after.plots[0].ready, true);
  assert.equal(f.create().water("p0", now).reason, "watered");
});

test("收获给产物也还给种子，地块清空", (t) => {
  const f = fixture(t);
  const g = f.create();
  const now = at(12);
  g.plant("p0", "tomato", now);
  const seedsBefore = g.snapshot(now).seeds.tomato;
  const r = g.harvest("p0", now + SPECIES.tomato.growMs);
  assert.equal(r.ok, true);
  assert.equal(r.gained.item, "tomato");
  assert.equal(r.gained.count, 2);
  assert.equal(r.produce.tomato, 2);
  assert.equal(r.seeds.tomato, seedsBefore + 1, "必须还种子，否则两轮就断粮");
  assert.equal(r.plots[0].species, null);
});

test("没收成之前摘不下来", (t) => {
  const f = fixture(t);
  const g = f.create();
  const now = at(12);
  g.plant("p0", "tomato", now);
  const early = g.harvest("p0", now + 1000);
  assert.equal(early.ok, false);
  assert.equal(early.reason, "growing");
});

test("月光花白天熟也摘不下，夜里才行", (t) => {
  const f = fixture(t);
  const g = f.create();
  const dusk = at(17);
  g.plant("p0", "moonflower", dusk);
  const ripeAtDusk = g.snapshot(dusk + SPECIES.moonflower.growMs);
  assert.equal(ripeAtDusk.plots[0].ripe, true);
  assert.equal(ripeAtDusk.plots[0].ready, false, "白天不该能摘");
  const dayHarvest = g.harvest("p0", dusk + SPECIES.moonflower.growMs);
  assert.equal(dayHarvest.reason, "not-night");

  // 挪到当天 22 点再摘（3 小时后，还在枯萎期之内）
  const night = g.harvest("p0", at(22));
  assert.equal(night.ok, true);
});

test("熟太久会枯，枯了只能拔", (t) => {
  const f = fixture(t);
  const g = f.create();
  const now = at(12);
  g.plant("p0", "daisy", now);
  const late = now + SPECIES.daisy.growMs * 5;
  const snap = g.snapshot(late);
  assert.equal(snap.plots[0].withered, true);
  assert.equal(snap.plots[0].ready, false);
  const r = g.harvest("p0", late);
  assert.equal(r.reason, "withered");
  assert.equal(g.clear("p0", late).ok, true);
  assert.equal(g.snapshot(late).plots[0].species, null);
});

test("没种子就种不了；已占用的格子种不了（枯了可以直接翻新）", (t) => {
  const f = fixture(t);
  const g = f.create();
  const now = at(12);
  g.plant("p0", "seapink", now);
  assert.equal(g.plant("p1", "seapink", now).reason, "no-seed");
  assert.equal(g.plant("p0", "daisy", now).reason, "occupied");
  // 枯死之后可以直接重新种
  const late = now + SPECIES.seapink.growMs * 5;
  assert.equal(g.plant("p0", "daisy", late).ok, true);
});

test("收获收据幂等：重放不会多给一份", (t) => {
  const f = fixture(t);
  const g = f.create();
  const now = at(12);
  g.plant("p0", "tomato", now);
  const ripe = now + SPECIES.tomato.growMs;
  const first = g.harvest("p0", ripe, { receiptId: "h:1" });
  assert.equal(first.duplicate, false);
  const again = g.harvest("p0", ripe, { receiptId: "h:1" });
  assert.equal(again.duplicate, true);
  assert.equal(again.produce.tomato, first.produce.tomato);
});

test("坏文件备份后重置，非法输入抛错", (t) => {
  const f = fixture(t);
  const g = f.create();
  g.plant("p0", "daisy", at(12));
  fs.writeFileSync(f.file, "null");
  const snap = f.create().snapshot(at(12));
  assert.ok(snap.plots.every((p) => p.species === null));
  assert.equal(fs.readdirSync(f.dir).filter((n) => n.startsWith("garden.json.bad-")).length, 1);

  const g2 = f.create();
  assert.throws(() => g2.plant("p0", "no-such-plant"), TypeError);
  assert.throws(() => g2.plant("p9", "daisy"), TypeError);
  assert.throws(() => g2.harvest("p0", at(12), { receiptId: "" }), TypeError);
  assert.throws(() => createGarden({}), TypeError);
});
