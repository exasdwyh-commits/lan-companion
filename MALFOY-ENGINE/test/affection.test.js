"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAffection } = require("../lib/affection");

function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-affection-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const packPath = path.join(dir, "pack.json");
  fs.writeFileSync(packPath, JSON.stringify({
    affection: { max: 12, touch: 2, touchCooldown: 45, chat: 1, chatCooldown: 20, song: 3, dailyVisit: 4, ...overrides },
    addresses: [
      { affinity: 9, call: "close" },
      { affinity: 0, call: "new" },
      { affinity: 4, call: "friend" },
    ],
  }));
  return { dir, packPath, file: path.join(dir, "affection.json"), create: () => createAffection({ dir, packPath }) };
}

function atTime(time, action) {
  const original = Date.now;
  Date.now = () => time;
  try { return action(); } finally { Date.now = original; }
}

test("initial snapshot is zero and picks the first address", (t) => {
  const a = fixture(t).create();
  assert.deepEqual(a.snapshot(), { value: 0, max: 12, level: 0, call: "new", today: null, lastAt: { touch: 0, chat: 0 } });
});

test("touch adds configured amount, enforces seconds cooldown and unlocks levels", (t) => {
  const a = fixture(t).create();
  assert.deepEqual(atTime(100000, () => a.add("touch")), { ok: true, value: 2, added: 2, reason: null });
  assert.deepEqual(atTime(144999, () => a.add("touch")), { ok: false, value: 2, added: 0, reason: "cooldown" });
  assert.deepEqual(atTime(145000, () => a.add("touch")), { ok: true, value: 4, added: 2, reason: null });
  assert.equal(a.snapshot().level, 1);
  assert.equal(a.snapshot().call, "friend");
});

test("chat has its own independent cooldown", (t) => {
  const a = fixture(t).create();
  atTime(100000, () => a.add("touch"));
  assert.equal(atTime(100000, () => a.add("chat")).added, 1);
  assert.equal(atTime(119999, () => a.add("chat")).reason, "cooldown");
  assert.equal(atTime(120000, () => a.add("chat")).added, 1);
  assert.equal(a.snapshot().value, 4);
});

test("song adds the configured amount without a cooldown", (t) => {
  const a = fixture(t).create();
  assert.equal(a.add("song").added, 3);
  assert.equal(a.add("song").value, 6);
});

test("daily awards once per local calendar day, including across instances", (t) => {
  const f = fixture(t);
  const a = f.create();
  assert.equal(a.add("daily").added, 4);
  const first = a.snapshot().today;
  assert.match(first, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(f.create().add("daily"), { ok: false, value: 4, added: 0, reason: "daily-done" });
  const saved = JSON.parse(fs.readFileSync(f.file, "utf8"));
  saved.today = "2000-01-01";
  fs.writeFileSync(f.file, JSON.stringify(saved));
  assert.equal(f.create().add("daily").value, 8);
  assert.equal(f.create().snapshot().today, first);
});

test("cap truncates awards and rejects additional awards", (t) => {
  const a = fixture(t).create();
  a.set(11);
  assert.deepEqual(a.add("song"), { ok: true, value: 12, added: 1, reason: null });
  assert.deepEqual(a.add("touch"), { ok: false, value: 12, added: 0, reason: "capped" });
  assert.equal(a.snapshot().call, "close");
});

test("unknown kind does not change state", (t) => {
  const a = fixture(t).create();
  assert.deepEqual(a.add("chapter"), { ok: false, value: 0, added: 0, reason: "unknown" });
});

test("set clamps values, persists and rejects invalid input", (t) => {
  const f = fixture(t);
  const a = f.create();
  assert.equal(a.set(-5).value, 0);
  assert.equal(a.set(500).value, 12);
  assert.equal(f.create().snapshot().value, 12);
  assert.throws(() => a.set(NaN), TypeError);
});

test("malformed JSON and invalid fields are backed up and reset", (t) => {
  for (const [name, raw] of [["json", "{bad"], ["fields", JSON.stringify({ value: "9", today: null, lastAt: { touch: 0, chat: 0 } })]]) {
    const f = fixture(t);
    fs.writeFileSync(f.file, raw);
    const a = f.create();
    assert.equal(a.snapshot().value, 0, name);
    const backups = fs.readdirSync(f.dir).filter((entry) => entry.startsWith("affection.json.bad-"));
    assert.equal(backups.length, 1, name);
    assert.equal(fs.readFileSync(path.join(f.dir, backups[0]), "utf8"), raw);
    assert.equal(a.add("touch").value, 2);
    assert.equal(f.create().snapshot().value, 2);
  }
});

test("a new instance reads persisted values and cooldown", (t) => {
  const f = fixture(t);
  atTime(100000, () => f.create().add("touch"));
  assert.equal(f.create().snapshot().value, 2);
  assert.equal(atTime(101000, () => f.create().add("touch")).reason, "cooldown");
  assert.equal(atTime(145000, () => f.create().add("touch")).value, 4);
});
