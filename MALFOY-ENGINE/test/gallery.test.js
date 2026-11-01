"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createGallery } = require("../lib/gallery");

const packPath = path.resolve(__dirname, "../../assets/whale-video-test/pack.json");
const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
const hash = () => crypto.createHash("sha256").update(fs.readFileSync(packPath)).digest("hex");
function gallery(t, affection = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, g: createGallery({ packPath, dir, affection }) };
}
function reachBranch(g) {
  g.command({ action: "start-chapter", id: "ch-01" });
  for (let i = 0; i < 4; i++) g.command({ action: "advance" });
}

test("相册张数、章节及好感边界从 pack 读取，setAffection 即时生效", (t) => {
  const { g } = gallery(t);
  const s = g.snapshot();
  // 断言与 pack 自洽，而不是写死张数：相册从 20 张迁到 26 张时，
  // 写死的数字会让「实现正确」看起来像失败。张数本身由素材检查守卫。
  assert.equal(s.album.length, pack.album.length);
  assert.equal(s.chapters.length, 1);
  assert.deepEqual(s.progress, null);
  // 只校验必需字段存在，不锁死字段全集：实现新增 title / desktopFile 这类字段时，
  // 「精确等于」会让合理演进看起来像失败，而缺字段仍然要报错。
  for (const key of ["id", "file", "zh", "where", "date", "unlockAt", "unlocked"]) {
    assert.ok(key in s.album[0], `相册条目缺少字段 ${key}`);
  }
  assert.equal(
    s.album.filter((p) => p.unlocked).length,
    pack.album.filter((a) => (a.unlockAt || 0) === 0).length
  );
  assert.equal(s.album[4].unlocked, false);
  g.setAffection(7);
  assert.equal(g.snapshot().album[4].unlocked, false);
  g.setAffection(8);
  assert.equal(g.snapshot().album[4].unlocked, true);
  g.setAffection(89);
  assert.equal(g.snapshot().album[19].unlocked, false);
  g.setAffection(pack.affection.max);
  assert.equal(g.snapshot().album[19].unlocked, true);
  assert.equal(g.snapshot().album[19].id, "20-anniversary-dress");
  assert.throws(() => g.setAffection(NaN), /好感度/);
  assert.throws(() => g.setAffection(pack.affection.max + 1), /好感度/);
});

test("章节解锁门槛不满足时拒绝开始，达到门槛后开放", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-chapter-lock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const altered = JSON.parse(fs.readFileSync(packPath, "utf8"));
  altered.chapters[0].unlockAt = 10;
  const copy = path.join(dir, "pack.json");
  fs.writeFileSync(copy, JSON.stringify(altered));
  const g = createGallery({ packPath: copy, dir: path.join(dir, "state"), affection: 9 });
  assert.equal(g.snapshot().chapters[0].unlocked, false);
  assert.throws(() => g.command({ action: "start-chapter", id: "ch-01" }), /未解锁/);
  g.setAffection(10);
  assert.equal(g.snapshot().chapters[0].unlocked, true);
  assert.equal(g.command({ action: "start-chapter", id: "ch-01" }).clip.id, "s1");
});

test("保存第 20 张照片只返回绝对路径，不能在锁定时保存", (t) => {
  const { dir, g } = gallery(t);
  assert.throws(() => g.command({ action: "save-photo", id: "20-anniversary-dress" }), /未解锁/);
  g.setAffection(90);
  const result = g.command({ action: "save-photo", id: "20-anniversary-dress" });
  assert.deepEqual(result, { ok: true, source: path.resolve(path.dirname(packPath), "album-20-anniversary-dress.jpg") });
  assert.ok(path.isAbsolute(result.source));
  assert.ok(fs.statSync(result.source).isFile());
  assert.equal(fs.existsSync(path.join(dir, "gallery.json")), false);
});

test("剧情推进到分支必须等待 choose，重启后恢复进度", (t) => {
  const { dir, g } = gallery(t);
  assert.equal(g.command({ action: "start-chapter", id: "ch-01" }).clip.id, "s1");
  for (const id of ["s2", "s3", "s4"]) assert.equal(g.command({ action: "advance" }).clip.id, id);
  const waiting = g.command({ action: "advance" });
  assert.equal(waiting.progress.index, 4);
  assert.equal(waiting.progress.branch, null);
  assert.equal(waiting.awaitingChoice, true);
  assert.throws(() => g.command({ action: "advance" }), /选择/);
  assert.throws(() => g.command({ action: "finish" }), /选择|完成/);
  const reopened = createGallery({ packPath, dir });
  assert.equal(reopened.snapshot().progress.index, 4);
  assert.equal(reopened.snapshot().awaitingChoice, true);
  assert.equal(reopened.command({ action: "choose", branch: "A" }).clip.id, "s5a");
  assert.equal(reopened.snapshot().progress.branch, "A");
});

for (const [branch, clip] of [["A", "s5a"], ["B", "s5b"]]) {
  test(`剧情 ${branch} 分支进入 ${clip}，首次完成奖励且重复/重启不再奖励`, (t) => {
    const { dir, g } = gallery(t);
    reachBranch(g);
    assert.equal(g.command({ action: "choose", branch }).clip.id, clip);
    const first = g.command({ action: "finish" });
    assert.equal(first.reward, pack.chapters[0].reward);
    assert.deepEqual(first.progress, { chapterId: "ch-01", index: 4, branch, done: true, rewarded: true });
    assert.equal(g.command({ action: "finish" }).reward, 0);
    assert.equal(g.snapshot().chapters[0].done, true);
    const reopened = createGallery({ packPath, dir });
    assert.deepEqual(reopened.snapshot().progress, first.progress);
    assert.equal(reopened.command({ action: "finish" }).reward, 0);
    reopened.command({ action: "reset-chapter", id: "ch-01" });
    assert.equal(reopened.snapshot().progress.done, false);
    assert.equal(reopened.snapshot().progress.rewarded, true);
    reachBranchFromReset(reopened);
    reopened.command({ action: "choose", branch });
    assert.equal(reopened.command({ action: "finish" }).reward, 0);
  });
}
function reachBranchFromReset(g) {
  for (let i = 0; i < 4; i++) g.command({ action: "advance" });
}

test("未知 id、无效分支与未知命令均抛出中文错误", (t) => {
  const { g } = gallery(t);
  assert.throws(() => g.command({ action: "start-chapter", id: "missing" }), /章节.*不存在/);
  assert.throws(() => g.command({ action: "reset-chapter", id: "missing" }), /章节.*不存在/);
  assert.throws(() => g.command({ action: "save-photo", id: "missing" }), /照片.*不存在/);
  assert.throws(() => g.command({ action: "advance" }), /章节/);
  g.command({ action: "start-chapter", id: "ch-01" });
  assert.throws(() => g.command({ action: "choose", branch: "A" }), /选择/);
  reachBranchFromReset(g);
  assert.throws(() => g.command({ action: "choose", branch: "C" }), /分支/);
  assert.throws(() => g.command({ action: "choose", branch: "a" }), /分支/);
  assert.throws(() => g.command({ action: "unexpected" }), /不支持/);
});

test("损坏 JSON 和字段非法均备份并重置，不崩溃", (t) => {
  const { dir } = gallery(t);
  const file = path.join(dir, "gallery.json");
  for (const bad of [
    "{broken",
    JSON.stringify({ version: 1, progress: { chapterId: "evil", index: 999, branch: "C", done: true, rewarded: true }, completed: ["evil"], rewarded: ["evil"] }),
    JSON.stringify({ version: 1, progress: { chapterId: "ch-01", index: 4, branch: "A", done: true, rewarded: false }, completed: ["ch-01"], rewarded: [] }),
    JSON.stringify({ version: 1, progress: { chapterId: "ch-01", index: -1, branch: null, done: false, rewarded: false }, completed: [], rewarded: [] }),
  ]) {
    fs.writeFileSync(file, bad);
    const g = createGallery({ packPath, dir });
    assert.equal(g.snapshot().progress, null);
    assert.equal(g.snapshot().chapters[0].done, false);
    const backups = fs.readdirSync(dir).filter((name) => name.startsWith("gallery.json.bad-"));
    assert.ok(backups.some((name) => fs.readFileSync(path.join(dir, name), "utf8") === bad));
  }
});

test("恶意照片相对路径无法越过 pack 目录，也不允许符号链接逃逸", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "pack");
  fs.mkdirSync(dir);
  const source = JSON.parse(fs.readFileSync(packPath, "utf8"));
  const copy = path.join(dir, "pack.json");
  source.album[0].file = "../outside.jpg";
  fs.writeFileSync(copy, JSON.stringify(source));
  const g = createGallery({ packPath: copy, dir: path.join(dir, "state") });
  assert.throws(() => g.command({ action: "save-photo", id: source.album[0].id }), /路径|目录/);
  source.album[0].file = "link.jpg";
  fs.writeFileSync(copy, JSON.stringify(source));
  const outside = path.join(root, "outside.jpg");
  fs.writeFileSync(outside, "x");
  fs.symlinkSync(outside, path.join(dir, "link.jpg"));
  const linked = createGallery({ packPath: copy, dir: path.join(dir, "state") });
  assert.throws(() => linked.command({ action: "save-photo", id: source.album[0].id }), /路径|目录/);
});

test("pack.json 在完整测试进程前后字节哈希一致", () => {
  assert.equal(hash(), originalPackHash);
});
const originalPackHash = hash();
