"use strict";
// 书库：导入过的书各自留一份，reading.json 只表示「当前打开哪一本」。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createBookLibrary } = require("../lib/book-library");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booklib-"));
  return { dir, lib: createBookLibrary({ dir }), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const book = (id, title, paragraphs = 3, chapters = 1) => ({
  id, title,
  paragraphs: Array.from({ length: paragraphs }, (_, i) => ({ text: `第${i}段。` })),
  chapters: Array.from({ length: chapters }, (_, i) => ({ index: i, title: `第${i + 1}章`, startParagraph: i })),
});

test("存进去的书能列出来，最近存的排最前", () => {
  const f = fixture();
  try {
    f.lib.save(book("a", "潮汐"));
    f.lib.save(book("b", "暗流"));
    const rows = f.lib.list();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "b", "最近保存的排前面");
    assert.equal(rows[0].paragraphs, 3);
    assert.equal(rows[0].chapters, 1);
  } finally { f.cleanup(); }
});

test("同一本书重复保存不会在书库里出现两次", () => {
  const f = fixture();
  try {
    f.lib.save(book("a", "潮汐"));
    f.lib.save(book("a", "潮汐（改名）"));
    const rows = f.lib.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "潮汐（改名）");
  } finally { f.cleanup(); }
});

test("书文件被删掉后，索引里不再出现（不留点不开的书）", () => {
  const f = fixture();
  try {
    f.lib.save(book("a", "潮汐"));
    f.lib.save(book("b", "暗流"));
    fs.unlinkSync(path.join(f.dir, "books", "a.json"));
    const rows = f.lib.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "b");
    assert.equal(f.lib.load("a"), null);
  } finally { f.cleanup(); }
});

test("按书名搜索，空查询返回全部", () => {
  const f = fixture();
  try {
    f.lib.save(book("a", "潮汐"));
    f.lib.save(book("b", "暗流"));
    assert.equal(f.lib.search("潮").length, 1);
    assert.equal(f.lib.search("  潮  ").length, 1, "首尾空白忽略");
    assert.equal(f.lib.search("不存在").length, 0);
    assert.equal(f.lib.search("").length, 2);
  } finally { f.cleanup(); }
});

test("删除会同时清掉文件与索引", () => {
  const f = fixture();
  try {
    f.lib.save(book("a", "潮汐"));
    assert.equal(f.lib.remove("a"), true);
    assert.equal(f.lib.list().length, 0);
    assert.equal(fs.existsSync(path.join(f.dir, "books", "a.json")), false);
    assert.equal(f.lib.remove("a"), false, "删不存在的书要返回 false");
  } finally { f.cleanup(); }
});

test("存进去的内容能原样读回来", () => {
  const f = fixture();
  try {
    const src = book("a", "潮汐", 5, 2);
    f.lib.save(src);
    const back = f.lib.load("a");
    assert.equal(back.title, "潮汐");
    assert.equal(back.paragraphs.length, 5);
    assert.equal(back.chapters.length, 2);
    assert.equal(back.paragraphs[4].text, "第4段。");
  } finally { f.cleanup(); }
});
