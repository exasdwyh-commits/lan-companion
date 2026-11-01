"use strict";
// 澜的旅行：按真实时间自己出门，回来带一张明信片和一段见闻，日记必须落盘。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createJourney, MAX_CATCHUP } = require("../lib/journey");

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-10-31T00:00:00.000Z");

function fixture(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "journey-"));
  const make = (extra = {}) => createJourney({
    dir,
    photos: () => ["album-01-tide-meeting.jpg", "album-03-rain-library.jpg"],
    ...opts,
    ...extra,
  });
  return { dir, make, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("第一次调用只记起点，不会立刻产生一趟旅行", async () => {
  const f = fixture();
  try {
    const j = f.make();
    const created = await j.tick(T0);
    assert.deepEqual(created, []);
    const snap = j.snapshot(T0);
    assert.equal(snap.trips, 0);
    assert.equal(snap.diary.length, 0);
    assert.ok(snap.dueInMs > 0, "应给出距离下一趟还有多久");
  } finally { f.cleanup(); }
});

test("到点后产生一趟旅行，带回明信片与见闻", async () => {
  const f = fixture();
  try {
    const j = f.make();
    await j.tick(T0);
    const created = await j.tick(T0 + 2 * HOUR);
    assert.equal(created.length, 1);
    const entry = created[0];
    assert.ok(entry.place, "要有地点");
    assert.ok(entry.note, "要有见闻");
    assert.ok(entry.photo, "要有明信片");
    assert.equal(entry.source, "template", "没有模型时退回本地模板");
    // 时间戳是「本该发生的时刻」，不是补算时刻
    assert.equal(entry.at, new Date(T0 + 2 * HOUR).toISOString());
  } finally { f.cleanup(); }
});

test("久未打开时补算，但一次最多补 MAX_CATCHUP 趟，时间推进到最新", async () => {
  const f = fixture();
  try {
    const j = f.make();
    await j.tick(T0);
    // 过了 10 趟的时间才打开
    const created = await j.tick(T0 + 20 * HOUR);
    assert.equal(created.length, MAX_CATCHUP, "补算要有上限，否则开 app 就刷屏");
    const snap = j.snapshot(T0 + 20 * HOUR);
    assert.equal(snap.trips, 10, "次数要如实记 10 趟");
    // 关键：时间要推进到最新，否则下次打开会重复补同样这些
    const again = await j.tick(T0 + 20 * HOUR);
    assert.deepEqual(again, [], "同一时刻再补算不应重复产生");
  } finally { f.cleanup(); }
});

test("日记落盘，重启后能读回", async () => {
  const f = fixture();
  try {
    const first = f.make();
    await first.tick(T0);
    await first.tick(T0 + 2 * HOUR);
    const written = first.snapshot(T0 + 2 * HOUR).diary;
    assert.equal(written.length, 1);

    const restarted = f.make();
    const back = restarted.snapshot(T0 + 2 * HOUR);
    assert.equal(back.diary.length, 1);
    assert.equal(back.diary[0].place, written[0].place);
    assert.equal(back.diary[0].note, written[0].note);
    assert.equal(back.trips, 1);
  } finally { f.cleanup(); }
});

test("模型可用时用模型写的见闻，失败时退回模板", async () => {
  const f = fixture();
  try {
    const good = createJourney({
      dir: f.dir,
      photos: () => [],
      generate: async (place) => `我去了${place}，风很好。`,
    });
    await good.tick(T0);
    const [ok] = await good.tick(T0 + 2 * HOUR);
    assert.equal(ok.source, "model");
    assert.ok(ok.note.includes("风很好"));

    const bad = createJourney({
      dir: path.join(f.dir, "b"),
      photos: () => [],
      generate: async () => { throw new Error("模型挂了"); },
    });
    await bad.tick(T0);
    const [fallback] = await bad.tick(T0 + 2 * HOUR);
    assert.equal(fallback.source, "template", "模型挂了也要能带回见闻");
    assert.ok(fallback.note.length > 0);
  } finally { f.cleanup(); }
});

test("新的排在最前，日记有上限", async () => {
  const f = fixture();
  try {
    const j = f.make();
    await j.tick(T0);
    await j.tick(T0 + 2 * HOUR);
    const first = j.snapshot(T0 + 2 * HOUR).diary[0];
    await j.tick(T0 + 4 * HOUR);
    const diary = j.snapshot(T0 + 4 * HOUR).diary;
    assert.equal(diary.length, 2);
    assert.notEqual(diary[0].at, first.at, "最新的一条排在最前");
    assert.ok(diary[0].at > diary[1].at);
  } finally { f.cleanup(); }
});
