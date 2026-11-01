"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFishing, SPOTS, FISH, CAST_COOLDOWN_MS } = require("../lib/fishing");

const at = (hour) => new Date(2026, 10, 1, hour, 0, 0, 0).getTime();

/** 确定性 PRNG：同一个种子必须走出同一串结果，否则稀有度没法调。 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fixture(t, seed = 42) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-fishing-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir, file: path.join(dir, "fishing.json"),
    create: (s = seed) => createFishing({ dir, rng: seeded(s) }),
  };
}

test("开局桶空、图鉴空、钓点按作息开关", (t) => {
  const f = fixture(t);
  const snap = f.create().snapshot(at(12));
  assert.deepEqual(snap.bag, {});
  assert.deepEqual(snap.bestiary, {});
  assert.equal(snap.casts, 0);
  const open = Object.fromEntries(snap.spots.map((s) => [s.id, s.open]));
  assert.equal(open.pier, true, "旧码头白天也能去");
  assert.equal(open.reef, false, "中午礁石区不开口");
  assert.equal(open.lake, false, "白天湖心不开口");
  assert.equal(open.estuary, false, "河口只在雨天");
});

test("同一钓点同一随机种子，结果完全可复现", (t) => {
  const a = fixture(t, 7);
  const b = fixture(t, 7);
  const first = a.create().cast({ spot: "pier", now: at(12) });
  const second = b.create().cast({ spot: "pier", now: at(12) });
  assert.equal(first.ok, true);
  assert.equal(first.fish, second.fish);
  assert.equal(first.cm, second.cm);
});

test("作息不对、天气不对一律拒绝，且不改状态", (t) => {
  const f = fixture(t);
  const g = f.create();
  const noon = at(12);
  assert.equal(g.cast({ spot: "reef", now: noon }).reason, "closed");
  assert.equal(g.cast({ spot: "estuary", weather: "clear", now: noon }).reason, "wrong-weather");
  const after = g.snapshot(noon);
  assert.equal(after.casts, 0, "被拒的抛竿不能算进次数");
  assert.deepEqual(after.bag, {});
});

test("夜里湖心能钓，雨天河口能钓", (t) => {
  const f = fixture(t);
  const g = f.create();
  assert.equal(g.cast({ spot: "lake", now: at(22) }).ok, true);
  assert.equal(g.cast({ spot: "estuary", weather: "rain", now: at(22) + 60000 }).ok, true);
});

test("连抛要看冷却", (t) => {
  const f = fixture(t);
  const g = f.create();
  const now = at(12);
  assert.equal(g.cast({ spot: "pier", now }).ok, true);
  const tooSoon = g.cast({ spot: "pier", now: now + 1000 });
  assert.equal(tooSoon.reason, "cooldown");
  assert.ok(tooSoon.cooldownMs > 0);
  assert.equal(g.cast({ spot: "pier", now: now + CAST_COOLDOWN_MS }).ok, true);
});

test("入桶、进图鉴、刷新纪录都有标记", (t) => {
  const f = fixture(t);
  const g = f.create();
  let now = at(12);
  const r1 = g.cast({ spot: "pier", now });
  assert.equal(r1.first, true);
  assert.equal(r1.bag[r1.fish], 1);
  assert.equal(r1.bestiary[r1.fish].count, 1);
  assert.equal(r1.bestiary[r1.fish].bestCm, r1.cm);

  now += CAST_COOLDOWN_MS;
  const r2 = g.cast({ spot: "pier", now });
  assert.equal(r2.first, false);
  assert.equal(r2.bag[r2.fish], r2.fish === r1.fish ? 2 : 1);
  assert.equal(r2.casts, 2);
});

test("大小落在该鱼的区间内，且只出本钓点该有的鱼", (t) => {
  const f = fixture(t);
  const g = f.create();
  let now = at(12);
  for (let i = 0; i < 20; i += 1) {
    const r = g.cast({ spot: "pier", now });
    const def = FISH[r.fish];
    assert.ok(def, `出了不存在的鱼: ${r.fish}`);
    assert.ok(def.spots.includes("pier"), `${r.fish} 不该出现在旧码头`);
    assert.ok(r.cm >= def.cm[0] && r.cm <= def.cm[1], `${r.fish} 尺寸越界: ${r.cm}`);
    now += CAST_COOLDOWN_MS;
  }
});

test("稀有鱼确实比常见的难出（1000 次抽样）", (t) => {
  const f = fixture(t, 20261031);
  const g = f.create();
  const counts = {};
  let now = at(12);
  for (let i = 0; i < 1000; i += 1) {
    const r = g.cast({ spot: "pier", now });
    counts[r.fish] = (counts[r.fish] || 0) + 1;
    now += CAST_COOLDOWN_MS;
  }
  const common = FISH.minnow.rarity;
  const rare = Object.entries(counts).filter(([id]) => FISH[id].rarity >= 3)
    .reduce((n, [, c]) => n + c, 0);
  assert.equal(FISH[Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]].rarity, common);
  assert.ok(rare / 1000 < 0.15, `稀有及以上占比过高: ${rare}`);
  assert.ok(counts.minnow > 0);
});

test("从桶里拿走一条，图鉴不倒退", (t) => {
  const f = fixture(t);
  const g = f.create();
  const r = g.cast({ spot: "pier", now: at(12) });
  const took = g.take(r.fish, 1);
  assert.equal(took.ok, true);
  assert.equal(took.bag[r.fish], 0);
  assert.equal(g.snapshot(at(12)).bestiary[r.fish].count, 1, "图鉴只增不减");
  assert.equal(g.take(r.fish, 1).reason, "empty");
  assert.throws(() => g.take("no-such-fish", 1), TypeError);
});

test("坏文件备份、非法入参抛错", (t) => {
  const f = fixture(t);
  const g = f.create();
  g.cast({ spot: "pier", now: at(12) });
  fs.writeFileSync(f.file, '{"version":1}');
  const snap = f.create().snapshot(at(12));
  assert.equal(snap.casts, 0);
  assert.equal(fs.readdirSync(f.dir).filter((n) => n.startsWith("fishing.json.bad-")).length, 1);

  const g2 = f.create();
  assert.throws(() => g2.cast({ spot: "no-such-spot" }), TypeError);
  assert.throws(() => g2.cast({ spot: "pier", weather: "acid" }), TypeError);
  assert.throws(() => createFishing({ dir: f.dir, rng: "nope" }), TypeError);
  assert.ok(Object.keys(SPOTS).length >= 4);
});
