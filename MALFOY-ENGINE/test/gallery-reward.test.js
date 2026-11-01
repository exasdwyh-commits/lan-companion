"use strict";
// FIX-03 / R2：通关奖励恰好结算一次。覆盖各写入边界的故障注入与重启恢复。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createContentPages } = require("../lib/content-pages");

const contentDir = path.resolve(__dirname, "../../assets/whale-video-test");
const pack = JSON.parse(fs.readFileSync(path.join(contentDir, "pack.json"), "utf8"));
const CHAPTER = pack.chapters[0];
const REWARD = CHAPTER.reward;

function makePages(t, dir) {
  const d = dir || fs.mkdtempSync(path.join(os.tmpdir(), "reward-test-"));
  if (!dir) t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return {
    dir: d,
    pages: createContentPages({
      dataDir: d, contentDir, preload: "",
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: { handle: () => {} },
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
    }),
  };
}
function completeChapter(pages) {
  // ch-01 flow：s1 起步 → 三次 advance → 第四次 advance 停在分支 → 选 A → 完成。
  pages.action({ action: "start", chapterId: CHAPTER.id });
  for (let i = 0; i < 4; i += 1) pages.action({ action: "advance" });
  pages.action({ action: "choose", option: "A" });
  return pages.action({ action: "complete" });
}
/** 只对包含指定文件名的写入抛错；failAfter 次成功后开始失败；restore() 恢复。 */
function injectWriteFailure(t, filename, failAfter = 0) {
  const real = fs.writeFileSync;
  let ok = 0;
  const patched = function (file, ...rest) {
    if (String(file).includes(filename)) {
      if (ok >= failAfter) throw Object.assign(new Error("injected write failure"), { code: "EIO" });
      ok += 1;
    }
    return real.call(fs, file, ...rest);
  };
  patched.restore = () => { fs.writeFileSync = real; };
  fs.writeFileSync = patched;
  t.after(() => { fs.writeFileSync = real; });
  return patched;
}

test("正常通关：奖励入账一次，收据确认，重复通关不再加", (t) => {
  const { pages } = makePages(t);
  const before = pages.view().affection;
  const done = completeChapter(pages);
  assert.equal(done.reward, REWARD);
  assert.equal(done.state.affection, before + REWARD);
  // 重看再完成：reward 0，分数不变。
  pages.action({ action: "start", chapterId: CHAPTER.id });
  const replay = completeChapter(pages);
  assert.equal(replay.reward, 0);
  assert.equal(replay.state.affection, before + REWARD);
  assert.deepEqual(pages.gallery.pendingReceipts(), []);
});

test("崩溃窗口一：gallery 已落收据、affection 写入失败 → 重启按收据补齐且只加一次", (t) => {
  const { dir, pages } = makePages(t);
  const before = pages.view().affection;
  const failA = injectWriteFailure(t, "affection.json", 0);
  const done = completeChapter(pages); // finish 落收据成功，入账失败留 pending
  assert.equal(done.reward, REWARD);
  assert.equal(pages.view().affection, before); // 尚未入账
  failA.restore && failA.restore();
  const revived = makePages(t, dir).pages;       // 模拟重启
  assert.equal(revived.view().affection, before + REWARD);
  assert.deepEqual(revived.gallery.pendingReceipts(), []);
  const again = makePages(t, dir).pages;         // 再重启不重复
  assert.equal(again.view().affection, before + REWARD);
});

test("崩溃窗口二：affection 已入账、gallery 确认失败 → 重启重放幂等不加第二次", (t) => {
  const { dir, pages } = makePages(t);
  const before = pages.view().affection;
  const failB = injectWriteFailure(t, "gallery.json", 7); // start+4×advance+choose+finish 共 7 次成功，settle 失败
  const done = completeChapter(pages); // 入账成功；settle 落盘失败
  assert.equal(done.reward, REWARD);
  failB.restore && failB.restore();
  const revived = makePages(t, dir).pages; // settlePending 重放 grant → duplicate
  assert.equal(revived.view().affection, before + REWARD);
  assert.deepEqual(revived.gallery.pendingReceipts(), []);
});

test("好感封顶：奖励只加到上限，收据仍记为已结算", (t) => {
  const { dir, pages } = makePages(t);
  const max = pack.affection.max;
  pages.affection.set(max - 2);
  const done = completeChapter(makePages(t, dir).pages);
  assert.equal(done.reward, REWARD);
  assert.equal(done.state.affection, max); // 只补 2 分到顶
  const revived = makePages(t, dir).pages;
  assert.equal(revived.view().affection, max); // 重启不再加
  assert.deepEqual(revived.gallery.pendingReceipts(), []);
});

test("v1 旧数据迁移：历史 rewarded 记为已结算，不补发旧奖励", (t) => {
  const { dir, pages } = makePages(t);
  const before = pages.view().affection;
  // 手工构造 v1 状态：章节已完成已奖励、无收据字段。
  fs.writeFileSync(path.join(dir, "gallery.json"), JSON.stringify({
    version: 1, completed: [CHAPTER.id], rewarded: [CHAPTER.id], progress: null,
  }));
  const revived = makePages(t, dir).pages;
  assert.equal(revived.view().affection, before); // 没有再发历史奖励
  assert.deepEqual(revived.gallery.pendingReceipts(), []);
  // 旧章节重看也不发。
  revived.action({ action: "start", chapterId: CHAPTER.id });
  const replay = completeChapter(revived);
  assert.equal(replay.reward, 0);
});

test("gallery 写入失败：finish 抛错不产生半状态，恢复后可重试", (t) => {
  const { dir, pages } = makePages(t);
  const before = pages.view().affection;
  const failC = injectWriteFailure(t, "gallery.json", 0);
  assert.throws(() => {
    pages.action({ action: "start", chapterId: CHAPTER.id });
  }, /injected|写入|EIO/);
  failC.restore && failC.restore();
  const retry = makePages(t, dir).pages;
  const done = completeChapter(retry);
  assert.equal(done.reward, REWARD);
  assert.equal(done.state.affection, before + REWARD);
});

test("gallery.json 落盘为 v2 且带收据结构", (t) => {
  const { dir, pages } = makePages(t);
  completeChapter(pages);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "gallery.json"), "utf8"));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.receipts[CHAPTER.id], { reward: REWARD, state: "granted" });
  const savedAffection = JSON.parse(fs.readFileSync(path.join(dir, "affection.json"), "utf8"));
  assert.ok(Array.isArray(savedAffection.receipts) && savedAffection.receipts.includes(CHAPTER.id));
});
