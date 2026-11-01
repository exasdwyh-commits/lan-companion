"use strict";
/**
 * 小花园：她自己的花圃。
 *
 * 和 lib/journey.js 同一套时间观 —— 生长是真实时间算出来的，不是定时器跑出来的。
 * 关掉 App 8 小时再打开，花该熟了就是熟了；不需要后台进程，也不需要补帧。
 * 这里只写「种下 / 浇水 / 收 / 拔」，其余状态全部由 plantedAt 推出来。
 *
 * 三条约束：
 *   1) 生长不能靠写入推进。否则一次时间回拨或一次崩溃就把节奏打乱，而且
 *      每小时写一次盘在桌宠里是不可接受的。
 *   2) 浇水是加速器不是必需品：不浇也能熟，浇了快一截。桌宠不该有惩罚机制。
 *   3) 种子必须能自循环。收了给种子，否则玩两轮就断粮，花园就废了。
 */
const fs = require("node:fs");
const path = require("node:path");

const HOUR = 60 * 60 * 1000;

/** 地块固定 6 格：够看，不会让界面挤成 Excel。 */
const PLOT_IDS = ["p0", "p1", "p2", "p3", "p4", "p5"];

const SPECIES = {
  daisy: { name: "小雏菊", growMs: 0.5 * HOUR, yield: { item: "daisy", count: 3 }, seeds: 1, seedCost: 1 },
  herb: { name: "薄荷", growMs: 0.75 * HOUR, yield: { item: "herb", count: 3 }, seeds: 1, seedCost: 1 },
  tomato: { name: "小番茄", growMs: 1.5 * HOUR, yield: { item: "tomato", count: 2 }, seeds: 1, seedCost: 1 },
  moonflower: {
    name: "月光花", growMs: 2 * HOUR, yield: { item: "moonflower", count: 1 }, seeds: 1, seedCost: 1,
    // 只在夜里开：白天能长熟，但摘不下来。给「她有作息」这件事一个具体证据。
    nightOnly: true,
  },
  sunflower: { name: "向日葵", growMs: 4 * HOUR, yield: { item: "sunflower", count: 1 }, seeds: 1, seedCost: 1 },
  seapink: { name: "海石竹", growMs: 6 * HOUR, yield: { item: "seapink", count: 1 }, seeds: 1, seedCost: 2 },
};

/** 每种各给 2 颗开局，够种一轮、又不至于一次铺满。
 *  注意：不能低于该种的 seedCost，否则这种花永远种不了（seapink 成本 2，就必须给 2）。 */
const STARTER_SEEDS = { daisy: 2, herb: 2, tomato: 2, moonflower: 2, sunflower: 2, seapink: 2 };

const WATER_SPEED = 0.6;      // 浇过水，剩余时间打六折
const WITHER_AFTER = 3;       // 熟过 3 倍生长期还没收，就枯了
const NIGHT_FROM = 20;        // 月光花的夜晚窗口（本地小时）
const NIGHT_TO = 5;

const isTime = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const isCount = (n) => Number.isSafeInteger(n) && n > 0;
const isNight = (now) => {
  const h = new Date(now).getHours();
  return h >= NIGHT_FROM || h < NIGHT_TO;
};

function createGarden({ dir } = {}) {
  if (typeof dir !== "string" || !dir) throw new TypeError("Invalid garden dir");
  const file = path.join(dir, "garden.json");

  const emptyPlot = (id) => ({ id, species: null, plantedAt: 0, watered: false });
  const empty = () => ({
    version: 1,
    plots: PLOT_IDS.map(emptyPlot),
    seeds: { ...STARTER_SEEDS },
    produce: {},
    receipts: [],
  });

  const validBag = (bag) => bag && !Array.isArray(bag) && typeof bag === "object" &&
    Object.entries(bag).every(([k, v]) => typeof k === "string" && Number.isSafeInteger(v) && v >= 0);

  const valid = (s) => s && !Array.isArray(s) && typeof s === "object" && s.version === 1 &&
    Array.isArray(s.plots) && s.plots.length === PLOT_IDS.length &&
    s.plots.every((p, i) => p && p.id === PLOT_IDS[i] && isTime(p.plantedAt) &&
      typeof p.watered === "boolean" &&
      (p.species === null || Object.hasOwn(SPECIES, p.species))) &&
    validBag(s.seeds) && validBag(s.produce) &&
    (s.receipts === undefined || (Array.isArray(s.receipts) && s.receipts.every((id) => typeof id === "string")));

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
      if (!valid(state)) throw new TypeError("Invalid garden state");
      return Array.isArray(state.receipts) ? state : { ...state, receipts: [] };
    } catch (_) {
      let backup = `${file}.bad-${Date.now()}`;
      for (let n = 1; fs.existsSync(backup); n += 1) backup = `${file}.bad-${Date.now()}-${n}`;
      fs.renameSync(file, backup);
      const fresh = empty();
      write(fresh);
      return fresh;
    }
  }

  /** 单格推进：纯函数，只依赖 plantedAt 和 watered。 */
  function grow(plot, now) {
    if (!plot.species) return { id: plot.id, species: null, stage: 0, ready: false, withered: false, remainingMs: 0 };
    const spec = SPECIES[plot.species];
    const total = spec.growMs * (plot.watered ? WATER_SPEED : 1);
    const elapsed = Math.max(0, now - plot.plantedAt);
    const stage = Math.min(1, elapsed / total);
    const over = elapsed - total;
    const withered = over > spec.growMs * WITHER_AFTER;
    const ripe = stage >= 1 && !withered;
    // 月光花：熟了也要等夜里才摘得下。
    const ready = ripe && (!spec.nightOnly || isNight(now));
    return {
      id: plot.id,
      species: plot.species,
      name: spec.name,
      stage: Math.round(stage * 1000) / 1000,
      ripe,
      ready,
      withered,
      nightOnly: !!spec.nightOnly,
      remainingMs: Math.max(0, total - elapsed),
    };
  }

  function view(state, now) {
    return {
      plots: state.plots.map((p) => grow(p, now)),
      seeds: { ...state.seeds },
      produce: { ...state.produce },
      night: isNight(now),
      plants: Object.entries(SPECIES).map(([id, s]) => ({
        id, name: s.name, growMs: s.growMs, seedCost: s.seedCost, nightOnly: !!s.nightOnly,
      })),
    };
  }

  function snapshot(now = Date.now()) {
    return view(load(), now);
  }

  function plotOf(state, plotId) {
    const plot = state.plots.find((p) => p.id === plotId);
    if (!plot) throw new TypeError(`Unknown garden plot: ${plotId}`);
    return plot;
  }

  function plant(plotId, speciesId, now = Date.now()) {
    if (!Object.hasOwn(SPECIES, speciesId)) throw new TypeError(`Unknown species: ${speciesId}`);
    const state = load();
    const plot = plotOf(state, plotId);
    if (plot.species) {
      const g = grow(plot, now);
      if (!g.withered) return { ok: false, reason: "occupied", ...view(state, now) };
      // 已经枯掉的格子可以直接翻新，不必先拔。
    }
    const cost = SPECIES[speciesId].seedCost;
    const have = state.seeds[speciesId] || 0;
    if (have < cost) return { ok: false, reason: "no-seed", ...view(state, now) };
    const next = {
      ...state,
      plots: state.plots.map((p) => p.id === plotId
        ? { id: plotId, species: speciesId, plantedAt: now, watered: false }
        : p),
      seeds: { ...state.seeds, [speciesId]: have - cost },
    };
    write(next);
    return { ok: true, ...view(next, now) };
  }

  function water(plotId, now = Date.now()) {
    const state = load();
    const plot = plotOf(state, plotId);
    if (!plot.species) return { ok: false, reason: "empty", ...view(state, now) };
    if (plot.watered) return { ok: false, reason: "watered", ...view(state, now) };
    const g = grow(plot, now);
    if (g.ripe) return { ok: false, reason: "ripe", ...view(state, now) };
    const next = {
      ...state,
      plots: state.plots.map((p) => (p.id === plotId ? { ...p, watered: true } : p)),
    };
    write(next);
    return { ok: true, ...view(next, now) };
  }

  /**
   * 收获：产物 + 1 颗种子（自循环）。receiptId 可选，重放不重复进账。
   */
  function harvest(plotId, now = Date.now(), { receiptId = null } = {}) {
    if (receiptId !== null && (typeof receiptId !== "string" || !receiptId)) {
      throw new TypeError("Invalid garden receipt");
    }
    const state = load();
    if (receiptId && state.receipts.includes(receiptId)) {
      return { ok: true, duplicate: true, gained: null, ...view(state, now) };
    }
    const plot = plotOf(state, plotId);
    const g = grow(plot, now);
    if (!g.ready) return { ok: false, reason: g.withered ? "withered" : (g.ripe ? "not-night" : "growing"), ...view(state, now) };
    const spec = SPECIES[plot.species];
    const produce = { ...state.produce };
    produce[spec.yield.item] = (produce[spec.yield.item] || 0) + spec.yield.count;
    const seeds = { ...state.seeds };
    seeds[plot.species] = (seeds[plot.species] || 0) + spec.seeds;
    const next = {
      ...state,
      plots: state.plots.map((p) => (p.id === plotId ? emptyPlot(plotId) : p)),
      produce,
      seeds,
      receipts: receiptId ? [...state.receipts, receiptId] : state.receipts,
    };
    write(next);
    return {
      ok: true,
      duplicate: false,
      gained: { item: spec.yield.item, count: spec.yield.count, name: spec.name },
      ...view(next, now),
    };
  }

  /** 拔掉（含枯死）。种子不退 —— 枯了就是枯了。 */
  function clear(plotId, now = Date.now()) {
    const state = load();
    plotOf(state, plotId);
    const next = { ...state, plots: state.plots.map((p) => (p.id === plotId ? emptyPlot(plotId) : p)) };
    write(next);
    return { ok: true, ...view(next, now) };
  }

  return { snapshot, plant, water, harvest, clear };
}

module.exports = { createGarden, SPECIES, PLOT_IDS, STARTER_SEEDS, WATER_SPEED, WITHER_AFTER, isNight };
