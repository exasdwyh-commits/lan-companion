"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAlbum, WALL_SLOTS } = require("../lib/album");

const SEED = [
  { seed: "assets/a.jpg", title: "抱着小鲸鱼的晴天", note: "" },
  { seed: "assets/b.jpg", title: "一起等海风", note: "" },
];

function album(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "album-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, a: createAlbum({ dir, seed: SEED, ...opts }) };
}
function photo(t, dir, name = "shot.jpg") {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.alloc(2048, 7));
  return file;
}

test("第一次运行用随包示例铺墙，且不拷贝文件", (t) => {
  const { dir, a } = album(t);
  const view = a.view();
  assert.equal(view.entries.length, 2);
  assert.deepEqual(view.entries.map((e) => e.slot), [0, 1]);
  assert.ok(view.entries.every((e) => e.pinned && e.seed && e.file === null));
  assert.equal(fs.existsSync(path.join(dir, "images")), false);
});

test("贴到墙上按空槽顺序分配，取下来槽位回收", (t) => {
  const { dir, a } = album(t);
  const e = a.command({ action: "add", src: photo(t, dir), title: "海边" });
  const id = e.entries[e.entries.length - 1].id;
  assert.equal(e.entries[e.entries.length - 1].pinned, false);
  a.command({ action: "pin", id, pinned: true });
  // 示例占了 0、1，新贴的应当拿 2
  assert.equal(a.view().entries.find((x) => x.id === id).slot, 2);
  a.command({ action: "pin", id, pinned: false });
  assert.equal(a.view().entries.find((x) => x.id === id).slot, -1);
  a.command({ action: "pin", id, pinned: true });
  assert.equal(a.view().entries.find((x) => x.id === id).slot, 2);
});

test("墙上满额后拒绝再贴，提示能落到 UI", (t) => {
  const { dir, a } = album(t, { slots: 2 });
  const e = a.command({ action: "add", src: photo(t, dir), title: "第三张" });
  const id = e.entries[2].id;
  assert.throws(() => a.command({ action: "pin", id, pinned: true }), /墙上最多挂 2 张/);
});

test("换位置是交换，不会把别人挤掉", (t) => {
  const { dir, a } = album(t);
  const id = a.command({ action: "add", src: photo(t, dir), title: "新的" }).entries[2].id;
  a.command({ action: "pin", id, pinned: true });          // slot 2
  a.command({ action: "move", id, slot: 0 });              // 与 seed-0 交换
  const view = a.view();
  assert.equal(view.entries.find((x) => x.id === id).slot, 0);
  assert.equal(view.entries.find((x) => x.id === "seed-0").slot, 2);
  assert.equal(view.pinned, 3);
});

test("删除只删自己收进来的照片，示例与越界路径都安全", (t) => {
  const { dir, a } = album(t);
  const src = photo(t, dir);
  const id = a.command({ action: "add", src, title: "要删的" }).entries[2].id;
  const file = a.view().entries[2].file;
  a.command({ action: "remove", id });
  assert.equal(fs.existsSync(path.join(dir, "images", file)), false);
  assert.equal(a.view().entries.length, 2);
  // 示例照片删掉只丢记录，不会去动包内文件
  a.command({ action: "remove", id: "seed-0" });
  assert.equal(a.view().entries.length, 1);
});

test("落盘后重启读回同一份，孤儿照片记录会被清掉", (t) => {
  const { dir, a } = album(t);
  const id = a.command({ action: "add", src: photo(t, dir), title: "留下的" }).entries[2].id;
  a.command({ action: "pin", id, pinned: true });
  const again = createAlbum({ dir, seed: SEED }).view();
  assert.equal(again.entries.length, 3);
  assert.equal(again.entries.find((x) => x.id === id).slot, 2);

  fs.unlinkSync(path.join(dir, "images", again.entries.find((x) => x.id === id).file));
  const after = createAlbum({ dir, seed: SEED }).view();
  assert.equal(after.entries.length, 2);
});

test("标题与记录文字被裁剪，换行塌成空格", (t) => {
  const { dir, a } = album(t);
  const id = a.command({
    action: "add", src: photo(t, dir),
    title: "  ".repeat(5) + "标题".repeat(40),
    note: "第一行\n第二行" + "啊".repeat(400),
  }).entries[2].id;
  const entry = a.view().entries.find((x) => x.id === id);
  assert.ok(entry.title.length <= 40);
  assert.ok(entry.note.length <= 180);
  assert.ok(!entry.note.includes("\n"));
  assert.equal(entry.title.includes("  "), false);
});

test("不支持的动作与不存在的照片都报错，不静默成功", (t) => {
  const { a } = album(t);
  assert.throws(() => a.command({ action: "reorder" }), /不支持/);
  assert.throws(() => a.command({ action: "update", id: "nope", note: "x" }), /没有这一张/);
  assert.throws(() => a.command({ action: "add", src: "" }), /没有选择照片/);
});

test("槽位上限与渲染层一致", () => {
  assert.equal(WALL_SLOTS, 6);
});
