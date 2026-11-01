"use strict";
// 会话由主进程持有，落盘到 <dataDir>/session.json。
//
// 为什么不能留在渲染层：换形态要重建窗口，窗口一关 history 就没了；
// 重启更不用说。主进程持有才能做到「换形态不重置会话、重启还认得」。
//
// 落盘用临时文件 + rename，避免半截 JSON；读坏不崩，改名留证据后重开。

const fs = require("fs");
const path = require("path");

const MAX_ENTRIES = 40; // 20 轮（问 + 答）
const MAX_CHARS = 400;

function clean(entry) {
  if (!entry || typeof entry !== "object") return null;
  const role = entry.role === "user" || entry.role === "assistant" ? entry.role : null;
  const content = typeof entry.content === "string" ? entry.content.trim() : "";
  if (!role || !content) return null;
  const out = { role, content: content.slice(0, MAX_CHARS), ts: Number(entry.ts) || Date.now() };
  if (entry.mode) out.mode = String(entry.mode).slice(0, 16);
  if (entry.via) out.via = String(entry.via).slice(0, 32);
  if (entry.tts) out.tts = String(entry.tts).slice(0, 16);
  return out;
}

function createSession(file) {
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      if (!fs.existsSync(file)) return (cache = []);
      const arr = JSON.parse(fs.readFileSync(file, "utf8"));
      cache = Array.isArray(arr) ? arr.map(clean).filter(Boolean) : [];
      return cache;
    } catch (e) {
      // 损坏：留证据，重新开始。绝不因为一行坏 JSON 就让聊天崩掉。
      try { fs.renameSync(file, file + ".bad"); } catch (x) {}
      return (cache = []);
    }
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(load()));
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      return false;
    }
  }

  function trim() {
    const arr = load();
    while (arr.length > MAX_ENTRIES) arr.shift();
    // 开头必须是「用户说的」：从中间截断会让模型看到孤立的回答。
    while (arr.length && arr[0].role === "assistant") arr.shift();
  }

  /** 追加一条；返回是否落盘成功。 */
  function append(entry) {
    const ok = clean(entry);
    if (!ok) return false;
    load().push(ok);
    trim();
    return save();
  }

  /** 追加一问一答，一次落盘（避免只写进去半轮）。 */
  function appendTurn(user, assistant, meta) {
    const u = clean({ role: "user", content: user, ...(meta || {}) });
    const a = clean({ role: "assistant", content: assistant, ...(meta || {}) });
    if (!u || !a) return false;
    load().push(u, a);
    trim();
    return save();
  }

  /** 给模型用的最近 n 条（只含 role/content，不带内部元信息）。 */
  function history(n) {
    return load().slice(-(n || 6)).map((e) => ({ role: e.role, content: e.content }));
  }

  /** 给窗口恢复用的最近 n 条（带 mode/via/tts，界面上可以标形态）。 */
  function recent(n) {
    return load().slice(-(n || 20)).map((e) => ({ ...e }));
  }

  function count() {
    return load().length;
  }

  /** 最近一次出现过的形态 —— 重启后回到同一个世界。 */
  function lastMode() {
    const arr = load();
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].mode) return arr[i].mode;
    return null;
  }

  function clear() {
    cache = [];
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return true;
    } catch (e) {
      return false;
    }
  }

  return { file, append, appendTurn, history, recent, count, lastMode, clear, reload: () => { cache = null; return load(); } };
}

module.exports = { createSession, MAX_ENTRIES, MAX_CHARS };
