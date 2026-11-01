"use strict";
// One relationship score for both forms. The caller supplies an isolated data dir.
const fs = require("node:fs");
const path = require("node:path");

function createAffection({ dir, packPath }) {
  const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
  const rules = pack.affection;
  if (!rules || !Number.isSafeInteger(rules.max) || rules.max < 0 ||
      !["touch", "chat", "song", "dailyVisit"].every((key) => Number.isSafeInteger(rules[key]) && rules[key] >= 0) ||
      !["touchCooldown", "chatCooldown"].every((key) => typeof rules[key] === "number" && Number.isFinite(rules[key]) && rules[key] >= 0) ||
      !Array.isArray(pack.addresses)) {
    throw new TypeError("Invalid affection pack");
  }
  const addresses = pack.addresses.slice().sort((a, b) => a.affinity - b.affinity);
  if (addresses.some((a) => !a || !Number.isSafeInteger(a.affinity) || a.affinity < 0 || typeof a.call !== "string")) {
    throw new TypeError("Invalid affection addresses");
  }
  const file = path.join(dir, "affection.json");
  const empty = () => ({ version: 1, value: 0, today: null, lastAt: { touch: 0, chat: 0 }, receipts: [] });
  const validTime = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const valid = (s) => s && !Array.isArray(s) && typeof s === "object" && s.version === 1 &&
    Number.isSafeInteger(s.value) && s.value >= 0 && s.value <= rules.max &&
    (s.today === null || (typeof s.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.today))) &&
    s.lastAt && !Array.isArray(s.lastAt) && validTime(s.lastAt.touch) && validTime(s.lastAt.chat) &&
    // 收据列表旧文件可缺省；存在时必须是字符串数组（结算幂等的关键）。
    (s.receipts === undefined || (Array.isArray(s.receipts) && s.receipts.every((id) => typeof id === "string")));

  function write(state) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* rename consumed it, or writing failed */ }
    }
  }

  function load() {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return empty();
      throw e;
    }
    try {
      const state = JSON.parse(raw);
      if (!valid(state)) throw new TypeError("Invalid affection state");
      // 旧文件没有 receipts 字段：读入时补空列表，下一次写入带上。
      return Array.isArray(state.receipts) ? state : { ...state, receipts: [] };
    } catch (_) {
      // Never silently discard malformed progress; keep the original bytes.
      let backup = `${file}.bad-${Date.now()}`;
      for (let n = 1; fs.existsSync(backup); n += 1) backup = `${file}.bad-${Date.now()}-${n}`;
      fs.renameSync(file, backup);
      const state = empty();
      write(state);
      return state;
    }
  }

  function view(state) {
    let level = -1;
    for (let i = 0; i < addresses.length; i += 1) {
      if (state.value >= addresses[i].affinity) level = i;
    }
    return {
      value: state.value, max: rules.max, level,
      call: level < 0 ? null : addresses[level].call,
      today: state.today, lastAt: { ...state.lastAt },
    };
  }

  function snapshot() { return view(load()); }

  function localDay(now) {
    const day = new Date(now);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  }

  function add(kind) {
    const state = load();
    const denied = (reason) => ({ ok: false, value: state.value, added: 0, reason });
    const amounts = { touch: rules.touch, chat: rules.chat, song: rules.song, daily: rules.dailyVisit };
    if (!Object.hasOwn(amounts, kind)) return denied("unknown");
    if (state.value >= rules.max) return denied("capped");
    const now = Date.now();
    if (kind === "daily" && state.today === localDay(now)) return denied("daily-done");
    if ((kind === "touch" || kind === "chat") && state.lastAt[kind] > 0 &&
        now - state.lastAt[kind] < rules[`${kind}Cooldown`] * 1000) return denied("cooldown");
    const added = Math.min(amounts[kind], rules.max - state.value);
    state.value += added;
    if (kind === "daily") state.today = localDay(now);
    if (kind === "touch" || kind === "chat") state.lastAt[kind] = now;
    write(state);
    return { ok: true, value: state.value, added, reason: null };
  }

  function set(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Invalid affection value");
    const state = load();
    state.value = Math.max(0, Math.min(rules.max, Math.trunc(value)));
    write(state);
    return view(state);
  }

  /** 按收据幂等入账：分数与收据 ID 在同一次原子写入提交，重放不重复加分。 */
  function grant(receiptId, amount) {
    if (typeof receiptId !== "string" || !receiptId || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new TypeError("Invalid receipt grant");
    }
    const state = load();
    if (state.receipts.includes(receiptId)) {
      return { ok: true, value: state.value, added: 0, duplicate: true };
    }
    const added = Math.min(amount, rules.max - state.value);
    const next = { ...state, value: state.value + added, receipts: [...state.receipts, receiptId] };
    write(next);
    return { ok: true, value: next.value, added, duplicate: false };
  }

  return { snapshot, add, set, grant };
}

module.exports = { createAffection };
