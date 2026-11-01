"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRoomPlan, CATALOG, GRID, MAX_ITEMS, footprint } = require("../lib/room-plan");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-room-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, "room-plan.json"), create: () => createRoomPlan({ dir }) };
}

test("空房间：网格尺寸、目录、无冲突", (t) => {
  const f = fixture(t);
  const snap = f.create().snapshot();
  assert.deepEqual(snap.grid, { w: 14, h: 9 });
  assert.equal(snap.items.length, 0);
  assert.equal(snap.catalog.length, Object.keys(CATALOG).length);
  assert.deepEqual(snap.conflicts, []);
});

test("摆一件合法家具，uid 递增且可读回", (t) => {
  const f = fixture(t);
  const r = f.create().place("sofa", 1, 1);
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].uid, "r1");
  assert.equal(r.items[0].name, "沙发");
  assert.equal(r.items[0].w, 3);
  assert.equal(f.create().snapshot().items[0].uid, "r1");
});

test("越界与重叠都被拦下，且不落盘", (t) => {
  const f = fixture(t);
  const g = f.create();
  const oob = g.place("sofa", GRID.w - 1, 1);         // 3 格宽摆到最后一列
  assert.equal(oob.ok, false);
  assert.ok(oob.errors.some((e) => e.reason === "out-of-bounds"));
  assert.equal(g.snapshot().items.length, 0, "被拒的改造不能留下半成品");

  assert.equal(g.place("rug", 0, 0).ok, true);
  const overlap = g.place("sofa", 1, 1);              // 压在地毯上
  assert.equal(overlap.ok, false);
  assert.ok(overlap.errors.some((e) => e.reason === "overlap"));
  assert.equal(g.snapshot().items.length, 1);
});

test("旋转会交换占地", (t) => {
  assert.deepEqual(footprint("shelf", 0), { w: 1, h: 3 });
  assert.deepEqual(footprint("shelf", 90), { w: 3, h: 1 });
  const f = fixture(t);
  const g = f.create();
  // 1×3 的书架贴着底墙放不下，转 90° 就能放
  assert.equal(g.place("shelf", 0, GRID.h - 3).ok, true);
  assert.equal(g.place("shelf", 5, GRID.h - 1, 90).ok, true);
});

test("批量改造是原子的：一条不合法就整份驳回", (t) => {
  const f = fixture(t);
  const g = f.create();
  g.place("rug", 0, 0);
  const uid = g.snapshot().items[0].uid;

  const bad = g.apply({
    remove: [uid],
    place: [
      { item: "lamp", x: 10, y: 0 },
      { item: "no-such-item", x: 11, y: 0 },
    ],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.reason === "unknown-item"));
  const after = g.snapshot();
  assert.equal(after.items.length, 1, "撤掉的地毯必须还在");
  assert.equal(after.items[0].uid, uid);

  const good = g.apply({
    remove: [uid],
    place: [{ item: "lamp", x: 10, y: 0 }, { item: "plant", x: 11, y: 0 }],
  });
  assert.equal(good.ok, true);
  assert.equal(good.applied.removed, 1);
  assert.equal(good.applied.placed, 2);
  assert.equal(good.items.length, 2);
});

test("撤一件不存在的家具会被指出来", (t) => {
  const f = fixture(t);
  const r = f.create().apply({ remove: ["r99"] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.reason === "unknown-uid"));
});

test("改造收据幂等：同一份计划重放不会摆两遍", (t) => {
  const f = fixture(t);
  const g = f.create();
  const plan = { place: [{ item: "bed", x: 0, y: 0 }] };
  const first = g.apply(plan, { receiptId: "deco:1" });
  assert.equal(first.duplicate, false);
  assert.equal(first.items.length, 1);
  const again = g.apply(plan, { receiptId: "deco:1" });
  assert.equal(again.duplicate, true);
  assert.equal(again.items.length, 1);
});

test("件数上限与清空", (t) => {
  const f = fixture(t);
  const g = f.create();
  let placed = 0;
  for (let y = 0; y < GRID.h && placed < MAX_ITEMS; y += 1) {
    for (let x = 0; x < GRID.w && placed < MAX_ITEMS; x += 1) {
      if (g.place("plant", x, y).ok) placed += 1;
    }
  }
  assert.equal(placed, MAX_ITEMS);
  const over = g.place("plant", 0, 0);
  assert.equal(over.ok, false);
  assert.ok(over.errors.some((e) => e.reason === "too-many" || e.reason === "overlap"));

  const cleared = g.clear();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.items.length, 0);
});

test("坏文件备份、非法入参抛错", (t) => {
  const f = fixture(t);
  const g = f.create();
  g.place("sofa", 0, 0);
  fs.writeFileSync(f.file, "[]");
  assert.equal(f.create().snapshot().items.length, 0);
  assert.equal(fs.readdirSync(f.dir).filter((n) => n.startsWith("room-plan.json.bad-")).length, 1);

  const g2 = f.create();
  assert.throws(() => g2.place("no-such-item", 0, 0), TypeError);
  assert.throws(() => g2.place("sofa", 0, 0, 45), TypeError);
  assert.throws(() => g2.apply(null), TypeError);
  assert.throws(() => g2.apply({ remove: [1] }), TypeError);
  assert.throws(() => footprint("sofa", 10), TypeError);
});
