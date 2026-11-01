"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../lib/memory-store");
const { createMemoryAdmin } = require("../lib/memory-admin");

function fixture() {
  // Never point these tests at a user's data directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-admin-test-"));
  return { dir, admin: createMemoryAdmin({ dir }), store: createStore(dir) };
}

test("list parses keyed profile facts, reverses source order, filters case-insensitively", () => {
  const { admin, store } = fixture();
  store.mergeProfile("- Name：Alice\n- Colour: Blue\n- Place：Moon");
  assert.deepEqual(Array.from(admin.list(), ({ key, text }) => ({ key, text })), [
    { key: "Place", text: "Moon" }, { key: "Colour", text: "Blue" }, { key: "Name", text: "Alice" },
  ]);
  assert.deepEqual(admin.list({ query: "bLu" }).map(({ key }) => key), ["Colour"]);
  assert.deepEqual(admin.list({ query: "NAME" }).map(({ key }) => key), ["Name"]);
});

test("list defaults to 50 and caps at 200; never exposes sessions or reply texts", () => {
  const { admin, dir } = fixture();
  fs.writeFileSync(path.join(dir, "profile.md"), Array.from({ length: 220 }, (_, i) => `- K${i}：V${i}\n`).join(""));
  fs.writeFileSync(path.join(dir, "memory.jsonl"), JSON.stringify({ t: 1, u: "private-session", a: "private-reply" }) + "\n");
  assert.equal(admin.list().length, 50);
  assert.equal(admin.list({ limit: 1000 }).length, 200);
  assert.deepEqual(admin.list({ limit: 2 }).map(({ key }) => key), ["K219", "K218"]);
  assert.ok(!JSON.stringify(admin.list()).includes("private-"));
});

test("correct persists across instances, preserves place and separator, does not edit recent history", () => {
  const { admin, store, dir } = fixture();
  store.mergeProfile("- Name：Wrong\n- Colour: Blue");
  store.remember("fictional-question", "fictional-answer");
  const before = fs.readFileSync(path.join(dir, "memory.jsonl"));
  assert.equal(admin.correct({ key: "Name", text: "Right" }).ok, true);
  assert.equal(fs.readFileSync(path.join(dir, "profile.md"), "utf8"), "- Name：Right\n- Colour: Blue\n");
  assert.deepEqual(fs.readFileSync(path.join(dir, "memory.jsonl")), before);
  assert.deepEqual(createMemoryAdmin({ dir }).list().map(({ text }) => text), ["Blue", "Right"]);
});

test("forget removes exactly one named fact and returns removal status", () => {
  const { admin, store, dir } = fixture();
  store.mergeProfile("- Name：Alice\n- Colour：Blue");
  assert.deepEqual(admin.forget("Name"), { ok: true, removed: true, skipped: 0 });
  assert.deepEqual(admin.forget("Name"), { ok: true, removed: false, skipped: 0 });
  assert.deepEqual(createStore(dir).readProfile(), "- Colour：Blue");
  assert.deepEqual(admin.list().map(({ key }) => key), ["Colour"]);
});

test("clearAll requires exact confirmation and backs up both formats before clearing", () => {
  const { admin, store, dir } = fixture();
  store.mergeProfile("- Name：Alice");
  store.remember("fictional-question", "fictional-answer");
  const profile = fs.readFileSync(path.join(dir, "profile.md"));
  const recent = fs.readFileSync(path.join(dir, "memory.jsonl"));
  assert.throws(() => admin.clearAll({ confirm: "true" }), /confirm/);
  assert.deepEqual(fs.readFileSync(path.join(dir, "profile.md")), profile);
  const result = admin.clearAll({ confirm: true });
  assert.equal(result.ok, true);
  assert.match(path.basename(result.backup), /^memory\.bak-/);
  assert.equal(fs.statSync(result.backup).mode & 0o777, 0o700, "backup directory must be private");
  assert.deepEqual(fs.readFileSync(path.join(result.backup, "profile.md")), profile);
  assert.deepEqual(fs.readFileSync(path.join(result.backup, "memory.jsonl")), recent);
  assert.deepEqual(admin.list(), []);
  assert.deepEqual(createStore(dir).recall(6), []);
});

test("malformed rows are skipped and counted without rewriting legacy free-form rows", () => {
  const { admin, dir } = fixture();
  fs.writeFileSync(path.join(dir, "profile.md"), "- Name：Alice\nnot-a-fact\n- Likes the sea\n- Colour：Blue\n");
  const listed = admin.list();
  assert.equal(listed.skipped, 2);
  assert.deepEqual(listed.map(({ key }) => key), ["Colour", "Name"]);
  assert.equal(admin.correct({ key: "Name", text: "Bob" }).skipped, 2);
  assert.match(fs.readFileSync(path.join(dir, "profile.md"), "utf8"), /not-a-fact\n- Likes the sea\n/);
});

test("rejects empty, multiline, overlong text and unknown key without changing disk", () => {
  const { admin, store, dir } = fixture();
  store.mergeProfile("- Name：Alice");
  const before = fs.readFileSync(path.join(dir, "profile.md"));
  assert.throws(() => admin.correct({ key: "Name", text: " " }), /empty|不能为空/i);
  assert.throws(() => admin.correct({ key: "Name", text: "x".repeat(501) }), /500/);
  assert.throws(() => admin.correct({ key: "Name", text: "a\nb" }), /newline|换行/i);
  assert.throws(() => admin.correct({ key: "Missing", text: "Bob" }), /not found|不存在/i);
  assert.deepEqual(fs.readFileSync(path.join(dir, "profile.md")), before);
});

test("writes re-read disk so one admin does not erase additions by another", () => {
  const { admin, store, dir } = fixture();
  store.mergeProfile("- Name：Alice");
  const other = createMemoryAdmin({ dir });
  admin.list();
  other.correct({ key: "Name", text: "Bob" });
  store.mergeProfile("- Colour：Blue");
  assert.equal(admin.correct({ key: "Name", text: "Carol" }).ok, true);
  assert.deepEqual(createStore(dir).readProfile(), "- Name：Carol\n- Colour：Blue");
});

test("a missing explicit data directory is rejected", () => {
  assert.throws(() => createMemoryAdmin({}), /dir/);
});
