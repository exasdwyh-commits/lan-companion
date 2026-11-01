"use strict";
// 小屋里的 3D 相册：照片 + 记录文字，可以贴到墙上（有槽位上限）。
//
// 只有这一份数据决定「墙上挂什么」——页面不去猜，渲染层也不存状态。
// 落盘：{dir}/album.json；用户加的照片拷进 {dir}/images/。
// 随包的示例照片用 seed 字段指相对路径，不拷贝：重装/重建 App 之后墙上不至于空着。
//
// 本模块不认协议、不认 URL：给出去的 entry 只有 file / seed，
// 由调用方决定怎么变成页面能加载的地址。

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_ENTRIES = 40;
const MAX_TITLE = 40;
const MAX_NOTE = 180;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
// 墙上能挂几张。渲染层的槽位表必须和这个数一致，多出来的贴不上去。
const WALL_SLOTS = 6;

function createAlbum({ dir, seed = [], slots = WALL_SLOTS } = {}) {
  if (typeof dir !== "string" || !dir) throw new Error("相册需要数据目录。");
  const imagesDir = path.join(dir, "images");
  const stateFile = path.join(dir, "album.json");
  const slotCount = Math.max(1, Math.min(24, Math.floor(slots) || WALL_SLOTS));

  const blank = () => ({ version: 1, entries: [] });
  let state = blank();

  function text(value, limit) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
  }
  function isEntry(item) {
    return !!item && typeof item === "object"
      && typeof item.id === "string" && item.id
      && (typeof item.seed === "string" && item.seed ? true : typeof item.file === "string" && item.file)
      && Number.isInteger(item.slot);
  }
  function normalize(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries)) return blank();
    const seen = new Set();
    const usedSlots = new Set();
    const entries = [];
    for (const item of raw.entries) {
      if (!isEntry(item) || seen.has(item.id)) continue;
      seen.add(item.id);
      let slot = item.slot;
      // 槽位冲突/越界时重新分配，宁可挪个位置也不要整份相册失效
      if (item.pinned && (slot < 0 || slot >= slotCount || usedSlots.has(slot))) {
        slot = firstFree(usedSlots);
        if (slot < 0) continue;
      }
      if (!item.pinned) slot = -1;
      if (slot >= 0) usedSlots.add(slot);
      entries.push({
        id: item.id.slice(0, 40),
        seed: typeof item.seed === "string" && item.seed ? item.seed : null,
        file: typeof item.file === "string" && item.file ? path.basename(item.file) : null,
        title: text(item.title, MAX_TITLE),
        note: text(item.note, MAX_NOTE),
        pinned: !!item.pinned,
        slot,
        addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now(),
      });
      if (entries.length >= MAX_ENTRIES) break;
    }
    return { version: 1, entries };
  }
  function firstFree(used) {
    for (let i = 0; i < slotCount; i++) if (!used.has(i)) return i;
    return -1;
  }
  function usedSlots(exceptId) {
    const used = new Set();
    for (const e of state.entries) if (e.pinned && e.slot >= 0 && e.id !== exceptId) used.add(e.slot);
    return used;
  }

  function save() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = stateFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, stateFile);
  }

  function seeds() {
    return (Array.isArray(seed) ? seed : []).map((item, i) => ({
      id: `seed-${i}`,
      seed: String(item.seed || ""),
      file: null,
      title: text(item.title, MAX_TITLE),
      note: text(item.note, MAX_NOTE),
      pinned: true,
      slot: Math.min(i, slotCount - 1),
      addedAt: 0,
    })).filter((e) => e.seed);
  }

  function load() {
    try {
      state = normalize(JSON.parse(fs.readFileSync(stateFile, "utf8")));
    } catch (_) {
      // 第一次运行（或文件被删/写坏）：用随包示例铺满墙，但只有真的没有文件时。
      state = blank();
    }
    if (!state.entries.length && !fs.existsSync(stateFile)) {
      state = { version: 1, entries: seeds() };
      try { save(); } catch (_) { /* 只读环境：内存里照样能看 */ }
    }
    // 照片被手工删掉之后，墙上不该留一个空白框
    const alive = state.entries.filter((e) => e.seed || (e.file && fileExists(e.file)));
    if (alive.length !== state.entries.length) { state.entries = alive; try { save(); } catch (_) {} }
    return state;
  }
  function fileExists(name) {
    try { return fs.statSync(path.join(imagesDir, path.basename(name))).size > 0; } catch (_) { return false; }
  }

  function view() {
    return {
      slots: slotCount,
      entries: state.entries.map((e) => ({ ...e })),
      pinned: state.entries.filter((e) => e.pinned).length,
    };
  }

  function find(id) {
    const hit = state.entries.find((e) => e.id === id);
    if (!hit) throw new Error("相册里没有这一张。");
    return hit;
  }

  /** 把一张本地图片收进相册。src 由主进程从文件对话框给出。 */
  function add({ src, title, note } = {}) {
    if (typeof src !== "string" || !src) throw new Error("没有选择照片。");
    if (state.entries.length >= MAX_ENTRIES) throw new Error(`相册最多放 ${MAX_ENTRIES} 张。`);
    const ext = path.extname(src).toLowerCase();
    if (!EXT.has(ext)) throw new Error("只支持 jpg / png / webp / gif。");
    const stat = fs.statSync(src);
    if (!stat.isFile() || stat.size <= 0) throw new Error("这个文件读不出来。");
    if (stat.size > MAX_FILE_BYTES) throw new Error("照片请小于 16MB。");
    fs.mkdirSync(imagesDir, { recursive: true });
    const id = crypto.randomUUID();
    const name = id + ext;
    fs.copyFileSync(src, path.join(imagesDir, name));
    const entry = {
      id, seed: null, file: name,
      title: text(title || path.basename(src, ext), MAX_TITLE),
      note: text(note, MAX_NOTE),
      pinned: false, slot: -1, addedAt: Date.now(),
    };
    state.entries.push(entry);
    save();
    return { ...entry };
  }

  function update({ id, title, note } = {}) {
    const entry = find(String(id || ""));
    if (title !== undefined) entry.title = text(title, MAX_TITLE);
    if (note !== undefined) entry.note = text(note, MAX_NOTE);
    save();
    return { ...entry };
  }

  /** 贴到墙上 / 从墙上取下。贴的时候自动找一个空槽。 */
  function pin({ id, pinned = true } = {}) {
    const entry = find(String(id || ""));
    if (pinned) {
      if (entry.pinned) return { ...entry };
      const slot = firstFree(usedSlots(entry.id));
      if (slot < 0) throw new Error(`墙上最多挂 ${slotCount} 张，先取下一张。`);
      entry.pinned = true;
      entry.slot = slot;
    } else {
      entry.pinned = false;
      entry.slot = -1;
    }
    save();
    return { ...entry };
  }

  /** 换位置：把这张挪到指定槽位，原来占着的那张退回去（两边交换）。 */
  function move({ id, slot } = {}) {
    const entry = find(String(id || ""));
    if (!entry.pinned) throw new Error("先贴到墙上再换位置。");
    const target = Math.floor(Number(slot));
    if (!Number.isInteger(target) || target < 0 || target >= slotCount) throw new Error("位置无效。");
    const occupant = state.entries.find((e) => e.pinned && e.slot === target && e.id !== entry.id);
    const from = entry.slot;
    entry.slot = target;
    if (occupant) occupant.slot = from;
    save();
    return { ...entry };
  }

  function remove({ id } = {}) {
    const key = String(id || "");
    const index = state.entries.findIndex((e) => e.id === key);
    if (index < 0) throw new Error("相册里没有这一张。");
    const [entry] = state.entries.splice(index, 1);
    if (entry.file) {
      try { fs.unlinkSync(path.join(imagesDir, path.basename(entry.file))); } catch (_) {}
    }
    save();
    return { ...entry };
  }

  function command(payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    switch (p.action) {
      case undefined:
      case "state": return view();
      case "add": add(p); return view();
      case "update": update(p); return view();
      case "pin": pin(p); return view();
      case "move": move(p); return view();
      case "remove": remove(p); return view();
      default: throw new Error("不支持的相册操作：" + String(p.action));
    }
  }

  load();
  return { view, command, imagesDir, fileExists, slots: slotCount };
}

module.exports = { createAlbum, WALL_SLOTS, MAX_ENTRIES };
