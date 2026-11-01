"use strict";
/**
 * 钓鱼：她出去玩的时候会做的事，也是用户能陪她做的事。
 *
 * 设计要点：
 *   1) 钓点是有作息的。旧码头什么时候都能去；礁石区只在早晚开口；湖心只有夜里；
 *      河口只在雨天。这样「什么时候去钓」本身就是玩法，而不是换个背景图。
 *   2) 概率不给伪随机。rng 由调用方注入，测试里能完全复现；线上用 Math.random。
 *      一个钓鱼系统如果连「同一条件两次出鱼比例」都验不了，就没法调稀有度。
 *   3) 图鉴只增不减，记最大尺寸。鱼可以进桶、可以下锅、可以送她 —— 但图鉴是记录。
 */
const fs = require("node:fs");
const path = require("node:path");

const CAST_COOLDOWN_MS = 8 * 1000;
const WEATHERS = ["clear", "rain", "snow", "fog"];

/**
 * 钓点。hours 用左闭右开的本地小时区间，跨零点要拆成两段写清楚。
 */
const SPOTS = {
  pier: { name: "旧码头", hours: [[0, 24]], weathers: null, bonus: {} },
  reef: { name: "礁石区", hours: [[5, 9], [16, 20]], weathers: null, bonus: { rare: 1.6 } },
  lake: { name: "湖心", hours: [[20, 24], [0, 5]], weathers: null, bonus: { legend: 1.8 } },
  estuary: { name: "雨后的河口", hours: [[0, 24]], weathers: ["rain"], bonus: { uncommon: 1.5, rare: 1.3 } },
};

/** rarity: 1 常见 / 2 少见 / 3 稀有 / 4 传说。 */
const FISH = {
  minnow: { name: "小银鱼", rarity: 1, cm: [4, 9], spots: ["pier", "reef", "lake", "estuary"] },
  crab: { name: "招潮蟹", rarity: 1, cm: [3, 8], spots: ["pier", "reef"] },
  bass: { name: "石斑", rarity: 2, cm: [18, 42], spots: ["pier", "reef"] },
  eel: { name: "青鳗", rarity: 2, cm: [30, 70], spots: ["lake", "estuary"] },
  moonfish: { name: "月纹鱼", rarity: 3, cm: [12, 26], spots: ["lake"] },
  seahorse: { name: "海马", rarity: 3, cm: [5, 14], spots: ["reef", "estuary"] },
  lanternfish: { name: "灯笼鱼", rarity: 3, cm: [8, 18], spots: ["lake"] },
  whalelet: { name: "小鲸影", rarity: 4, cm: [40, 90], spots: ["lake", "reef"] },
};

const BASE_WEIGHT = { 1: 100, 2: 34, 3: 9, 4: 1 };
const KEY = { 1: null, 2: "uncommon", 3: "rare", 4: "legend" };

const isTime = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const isCount = (n) => Number.isSafeInteger(n) && n > 0;

function hourIn(now, ranges) {
  const h = new Date(now).getHours();
  return ranges.some(([a, b]) => h >= a && h < b);
}

function createFishing({ dir, rng = Math.random } = {}) {
  if (typeof dir !== "string" || !dir) throw new TypeError("Invalid fishing dir");
  if (typeof rng !== "function") throw new TypeError("Invalid fishing rng");

  const file = path.join(dir, "fishing.json");
  const empty = () => ({ version: 1, bag: {}, bestiary: {}, casts: 0, lastCastAt: 0 });

  const validBag = (bag) => bag && !Array.isArray(bag) && typeof bag === "object" &&
    Object.entries(bag).every(([k, v]) => Object.hasOwn(FISH, k) && Number.isSafeInteger(v) && v >= 0);
  const validBestiary = (b) => b && !Array.isArray(b) && typeof b === "object" &&
    Object.entries(b).every(([k, v]) => Object.hasOwn(FISH, k) && v && typeof v === "object" &&
      Number.isSafeInteger(v.count) && v.count > 0 && Number.isFinite(v.bestCm) && v.bestCm > 0);
  const valid = (s) => s && !Array.isArray(s) && typeof s === "object" && s.version === 1 &&
    validBag(s.bag) && validBestiary(s.bestiary) &&
    Number.isSafeInteger(s.casts) && s.casts >= 0 && isTime(s.lastCastAt);

  function write(state) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* rename 已消费 */ }
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
      if (!valid(state)) throw new TypeError("Invalid fishing state");
      return state;
    } catch (_) {
      let backup = `${file}.bad-${Date.now()}`;
      for (let n = 1; fs.existsSync(backup); n += 1) backup = `${file}.bad-${Date.now()}-${n}`;
      fs.renameSync(file, backup);
      const fresh = empty();
      write(fresh);
      return fresh;
    }
  }

  /** 当前这个钓点、这种天气下能出哪些鱼，各自权重多少。 */
  function table(spotId, weather) {
    const spot = SPOTS[spotId];
    const rows = [];
    for (const [id, fish] of Object.entries(FISH)) {
      if (!fish.spots.includes(spotId)) continue;
      const bonus = spot.bonus[KEY[fish.rarity]] || 1;
      // 雨雪天整体往稀有推一档：让天气真的改变结果，而不只是换张图。
      const weatherBonus = weather === "rain" && fish.rarity >= 3 ? 1.4
        : weather === "snow" && fish.rarity <= 2 ? 0.7
        : 1;
      rows.push({ fish: id, rarity: fish.rarity, weight: BASE_WEIGHT[fish.rarity] * bonus * weatherBonus });
    }
    // 权重高的排前面：同权重时结果稳定，便于复现。
    return rows.sort((a, b) => b.weight - a.weight || a.fish.localeCompare(b.fish));
  }

  function view(state, now) {
    return {
      casts: state.casts,
      bag: { ...state.bag },
      bestiary: JSON.parse(JSON.stringify(state.bestiary)),
      lastCastAt: state.lastCastAt,
      cooldownMs: Math.max(0, state.lastCastAt + CAST_COOLDOWN_MS - now),
      spots: Object.entries(SPOTS).map(([id, s]) => ({
        id, name: s.name, open: s.weathers ? false : hourIn(now, s.hours),
        hours: s.hours, weathers: s.weathers,
      })),
    };
  }

  function snapshot(now = Date.now()) {
    return view(load(), now);
  }

  /**
   * 抛一竿。
   * @param {object} o
   * @param {string} o.spot     SPOTS 的键
   * @param {string} [o.weather] clear | rain | snow | fog
   * @param {number} [o.now]
   */
  function cast({ spot, weather = "clear", now = Date.now() } = {}) {
    if (!Object.hasOwn(SPOTS, spot)) throw new TypeError(`Unknown fishing spot: ${spot}`);
    if (!WEATHERS.includes(weather)) throw new TypeError(`Unknown weather: ${weather}`);

    const def = SPOTS[spot];
    const state = load();
    if (def.weathers && !def.weathers.includes(weather)) {
      return { ok: false, reason: "wrong-weather", ...view(state, now) };
    }
    if (!hourIn(now, def.hours)) return { ok: false, reason: "closed", ...view(state, now) };
    if (now - state.lastCastAt < CAST_COOLDOWN_MS && state.lastCastAt > 0) {
      return { ok: false, reason: "cooldown", ...view(state, now) };
    }

    const rows = table(spot, weather);
    const total = rows.reduce((sum, r) => sum + r.weight, 0);
    let roll = rng() * total;
    let hit = rows[rows.length - 1];
    for (const row of rows) {
      roll -= row.weight;
      if (roll <= 0) { hit = row; break; }
    }
    const fish = FISH[hit.fish];
    const size = Math.round((fish.cm[0] + rng() * (fish.cm[1] - fish.cm[0])) * 10) / 10;

    const bag = { ...state.bag };
    bag[hit.fish] = (bag[hit.fish] || 0) + 1;
    const prev = state.bestiary[hit.fish];
    const bestiary = {
      ...state.bestiary,
      [hit.fish]: { count: (prev ? prev.count : 0) + 1, bestCm: prev ? Math.max(prev.bestCm, size) : size },
    };
    const next = { ...state, bag, bestiary, casts: state.casts + 1, lastCastAt: now };
    write(next);

    return {
      ok: true,
      fish: hit.fish,
      name: fish.name,
      rarity: fish.rarity,
      cm: size,
      record: !!prev && size > prev.bestCm,
      first: !prev,
      ...view(next, now),
    };
  }

  /** 从桶里拿一条出来（做菜/送她）。不消耗图鉴记录。 */
  function take(fishId, count = 1) {
    if (!Object.hasOwn(FISH, fishId)) throw new TypeError(`Unknown fish: ${fishId}`);
    if (!isCount(count)) throw new TypeError("Invalid take count");
    const state = load();
    const have = state.bag[fishId] || 0;
    if (have < count) return { ok: false, reason: "empty", bag: { ...state.bag } };
    const bag = { ...state.bag, [fishId]: have - count };
    write({ ...state, bag });
    return { ok: true, bag };
  }

  /** 把鱼放回桶（浴缸取出等）。不改图鉴。 */
  function deposit(fishId, count = 1) {
    if (!Object.hasOwn(FISH, fishId)) throw new TypeError(`Unknown fish: ${fishId}`);
    if (!isCount(count)) throw new TypeError("Invalid deposit count");
    const state = load();
    const bag = { ...state.bag, [fishId]: (state.bag[fishId] || 0) + count };
    write({ ...state, bag });
    return { ok: true, bag };
  }

  return { snapshot, cast, take, deposit, table };
}

module.exports = { createFishing, SPOTS, FISH, WEATHERS, CAST_COOLDOWN_MS, BASE_WEIGHT };
