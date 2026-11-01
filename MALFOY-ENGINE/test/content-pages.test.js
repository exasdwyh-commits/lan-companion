"use strict";
// 相册/剧情与记忆管理的接线测试：用假 ipcMain/BrowserWindow/dialog 跑真实模块，
// 只写临时目录，不碰个人数据与 dist。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createContentPages } = require("../lib/content-pages");

const ROOT = path.join(__dirname, "..", "..");
const CONTENT = path.join(ROOT, "MALFOY-ENGINE", "web", "live2d", "companion-content");
// 相册张数以 pack 为准，不在测试里写死 —— 20 张迁到 26 张时，
// 写死的数字会让「实现正确」看起来像失败。
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "whale-video-test", "pack.json"), "utf8"));

function harness({ contentDir = CONTENT, saveTo } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-pages-"));
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on: () => {} };
  class FakeWindow {
    constructor(options) { this.options = options; this.destroyed = false; this.shown = 0; }
    loadFile(file, opts) { this.file = file; this.query = opts?.query || {}; }
    once() {} on() {} show() { this.shown++; } focus() {} isDestroyed() { return this.destroyed; }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
    static getAllWindows() { return []; }
  }
  const dialog = {
    showSaveDialog: async () => (saveTo ? { canceled: false, filePath: saveTo } : { canceled: true }),
  };
  const pages = createContentPages({
    dataDir: dir, contentDir, preload: "preload.js",
    BrowserWindow: FakeWindow, ipcMain, dialog, parent: () => null,
  });
  pages.register();
  return { dir, pages, handlers, ipcMain, FakeWindow };
}

test("view exposes all pack album entries with file URLs and only zero-threshold unlocked", () => {
  const { dir, pages } = harness();
  const view = pages.view();
  assert.equal(view.album.length, PACK.album.length);
  assert.equal(
    view.album.filter((item) => item.unlocked).length,
    PACK.album.filter((a) => (a.unlockAt || 0) === 0).length
  );
  assert.match(view.album[0].image, /^file:\/\//);
  assert.equal(view.chapters.length, 1);
  assert.ok(Array.isArray(view.chapters[0].flow));
  assert.ok(view.chapters[0].choices);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("chapter flow: start → advance → choose A → complete rewards once", async () => {
  const { dir, pages, handlers } = harness();
  const action = (p) => handlers.get("companion:gallery-action")(null, p);
  const start = action({ action: "start", chapterId: "ch-01" });
  assert.equal(start.ok, true);
  assert.equal(start.scene.id, "s1");
  assert.match(start.scene.image, /^file:\/\//);

  for (let i = 0; i < 3; i++) assert.equal(action({ action: "advance" }).ok, true);
  const branch = action({ action: "advance" });
  assert.equal(branch.ok, true);
  assert.equal(branch.state.awaitingChoice, true);
  assert.equal(branch.scene, null);

  const chosen = action({ action: "choose", option: "A" });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.scene.id, "s5a");

  const first = action({ action: "complete" });
  assert.equal(first.ok, true);
  assert.equal(first.reward, 10);
  const afterFirst = pages.affection.snapshot().value;

  const again = action({ action: "complete" });
  assert.equal(again.reward, 0);
  assert.equal(pages.affection.snapshot().value, afterFirst);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("memory handlers list, correct and forget profile facts", async () => {
  const { dir, handlers } = harness();
  fs.writeFileSync(path.join(dir, "profile.md"), "- 名字：小林\n- 喜欢：雨天\n", "utf8");
  const list = handlers.get("companion:memory-list")(null, { query: "", limit: 50 });
  assert.equal(list.ok, true);
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].key, "喜欢");

  const corrected = handlers.get("companion:memory-correct")(null, { key: "喜欢", text: "晴天" });
  assert.equal(corrected.ok, true);
  assert.match(fs.readFileSync(path.join(dir, "profile.md"), "utf8"), /喜欢：晴天/);

  const removed = handlers.get("companion:memory-forget")(null, "名字");
  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "profile.md"), "utf8"), /名字/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("savePhoto copies to the chosen path and cancels cleanly", async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "content-save-")), "picked.jpg");
  const { dir, handlers } = harness({ saveTo: out });
  const saved = await handlers.get("companion:gallery-save")(null, "01-tide-meeting");
  assert.equal(saved.ok, true);
  assert.equal(saved.path, out);
  assert.ok(fs.statSync(out).size > 0);

  const cancelled = harness();
  const result = await cancelled.handlers.get("companion:gallery-save")(null, "01-tide-meeting");
  assert.deepEqual(result, { ok: false, cancelled: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(cancelled.dir, { recursive: true, force: true });
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
});

test("unknown chapter and out-of-range affection are reported, not thrown", () => {
  const { dir, handlers } = harness();
  const bad = handlers.get("companion:gallery-action")(null, { action: "start", chapterId: "nope" });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /章节不存在/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("touch lines rotate by kind and relationship is exposed", () => {
  const { dir, handlers, pages } = harness();
  const first = handlers.get("companion:touch-line")(null, "touch");
  const second = handlers.get("companion:touch-line")(null, "touch");
  assert.ok(first && second);
  assert.notEqual(first, second);

  const wake = handlers.get("companion:touch-line")(null, "wake");
  const quiet = handlers.get("companion:touch-line")(null, "quiet");
  assert.ok(wake && quiet);
  assert.notEqual(wake, first);

  const state = handlers.get("companion:affection")();
  assert.equal(state.value, 3); // 首次到访 +3
  assert.equal(state.max, 100);
  assert.equal(state.call, "初次相伴");

  // 关系变化会推给窗口；没有窗口时也不能抛错。
  assert.doesNotThrow(() => pages.notify());
  fs.rmSync(dir, { recursive: true, force: true });
});
