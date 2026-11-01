"use strict";
/**
 * 书库：管理多本导入过的书。
 *
 * 之前只有 `reading.json` 一本，导入新的就把旧的顶掉 —— 读过的书等于丢了。
 * 现在每本单独存 `<data>/books/<id>.json`，索引只放元信息，
 * `reading.json` 继续表示「当前打开的是哪一本」，旧数据不用迁移就能用。
 *
 * 这里只管存取，不做内容校验（校验在 companion-media 的 normalizeBook 里，
 * 免得两个模块对「什么是合法的书」有两套标准）。
 */
const fs = require("fs");
const path = require("path");

const MAX_BOOKS = 200;

function createBookLibrary({ dir } = {}) {
  const root = path.join(dir, "books");
  const indexFile = path.join(root, "index.json");
  fs.mkdirSync(root, { recursive: true });

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; }
  };
  const writeJson = (file, value) => {
    fs.writeFileSync(file + ".tmp", JSON.stringify(value));
    fs.renameSync(file + ".tmp", file);
  };

  /** 索引里但文件已删的条目不算 —— 否则书库里会留一堆点不开的书。 */
  function list() {
    const rows = readJson(indexFile, []);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r && typeof r.id === "string" && r.title)
      .filter((r) => fs.existsSync(path.join(root, r.id + ".json")))
      .map((r) => ({
        id: r.id,
        title: String(r.title),
        updatedAt: r.updatedAt || null,
        paragraphs: r.paragraphs || 0,
        chapters: r.chapters || 0,
      }));
  }

  /** 保存一本书并把它排到索引最前（最近读过的在前）。 */
  function save(book) {
    if (!book || typeof book.id !== "string" || !book.id) return null;
    try {
      writeJson(path.join(root, book.id + ".json"), book);
    } catch (_) {
      return null;
    }
    const rest = list().filter((r) => r.id !== book.id);
    const entry = {
      id: book.id,
      title: String(book.title || "未命名").slice(0, 100),
      updatedAt: new Date().toISOString(),
      paragraphs: Array.isArray(book.paragraphs) ? book.paragraphs.length : 0,
      chapters: Array.isArray(book.chapters) ? book.chapters.length : 0,
    };
    writeJson(indexFile, [entry, ...rest].slice(0, MAX_BOOKS));
    return entry;
  }

  function load(id) {
    if (!id || typeof id !== "string") return null;
    return readJson(path.join(root, id + ".json"), null);
  }

  function remove(id) {
    if (!id || typeof id !== "string") return false;
    try { fs.unlinkSync(path.join(root, id + ".json")); } catch (_) { return false; }
    writeJson(indexFile, list().filter((r) => r.id !== id));
    return true;
  }

  /** 按书名搜索，空查询返回全部。 */
  function search(query) {
    const key = String(query || "").trim().toLowerCase();
    const rows = list();
    return key ? rows.filter((r) => r.title.toLowerCase().includes(key)) : rows;
  }

  return { list, save, load, remove, search, root };
}

module.exports = { createBookLibrary, MAX_BOOKS };
