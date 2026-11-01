"use strict";
/**
 * 浴缸养鱼：从钓鱼背包挪进缸里的展示层。
 * 图鉴仍在 fishing.bestiary；这里只管理「缸里有几条、最多 6」。
 */
const fs = require("node:fs");
const path = require("node:path");

const MAX_TANK = 6;
const isCount = (n) => Number.isSafeInteger(n) && n > 0;

function createAquarium({ dir, fishing } = {}) {
  if (typeof dir !== "string" || !dir) throw new TypeError("Invalid aquarium dir");
  if (!fishing || typeof fishing.take !== "function" || typeof fishing.snapshot !== "function") {
    throw new TypeError("aquarium needs a fishing store");
  }
  const file = path.join(dir, "aquarium.json");
  const empty = () => ({ version: 1, tank: [] });

  const valid = (s) => s && s.version === 1 && Array.isArray(s.tank) && s.tank.length <= MAX_TANK &&
    s.tank.every((row) => row && typeof row.fish === "string" && typeof row.name === "string" &&
      Number.isFinite(row.cm) && row.cm > 0 && Number.isSafeInteger(row.rarity));

  function write(state) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* rename consumed */ }
    }
  }

  function load() {
    let raw;
    try { raw = fs.readFileSync(file, "utf8"); }
    catch (e) {
      if (e.code === "ENOENT") return empty();
      throw e;
    }
    try {
      const state = JSON.parse(raw);
      if (!valid(state)) throw new TypeError("Invalid aquarium state");
      return state;
    } catch (_) {
      let backup = `${file}.bad-${Date.now()}`;
      for (let n = 1; fs.existsSync(backup); n += 1) backup = `${file}.bad-${Date.now()}-${n}`;
      try { fs.renameSync(file, backup); } catch (_) { /* keep going */ }
      const fresh = empty();
      write(fresh);
      return fresh;
    }
  }

  function snapshot() {
    const state = load();
    return { tank: state.tank.slice(), max: MAX_TANK, free: Math.max(0, MAX_TANK - state.tank.length) };
  }

  /** 从钓鱼背包放一条进缸。消耗 bag，不改图鉴。 */
  function put(fishId) {
    const { FISH } = require("./fishing");
    if (!Object.hasOwn(FISH, fishId)) throw new TypeError(`Unknown fish: ${fishId}`);
    const state = load();
    if (state.tank.length >= MAX_TANK) return { ok: false, reason: "full", ...snapshot() };
    const taken = fishing.take(fishId, 1);
    if (!taken.ok) return { ok: false, reason: taken.reason || "empty", ...snapshot() };
    const def = FISH[fishId];
    const fishSnap = fishing.snapshot();
    const best = fishSnap.bestiary[fishId];
    const cm = best && best.bestCm ? best.bestCm : (def.cm[0] + def.cm[1]) / 2;
    state.tank.push({ fish: fishId, name: def.name, rarity: def.rarity, cm, at: Date.now() });
    write(state);
    return { ok: true, ...snapshot(), bag: taken.bag };
  }

  /** 从缸里取出一条，放回钓鱼背包（不改图鉴计数）。 */
  function remove(index) {
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError("Invalid tank index");
    const state = load();
    if (index >= state.tank.length) return { ok: false, reason: "missing", ...snapshot() };
    const [row] = state.tank.splice(index, 1);
    write(state);
    const deposited = fishing.deposit(row.fish, 1);
    return { ok: true, fish: row, ...snapshot(), bag: deposited.bag };
  }

  return { snapshot, put, remove, MAX_TANK };
}

module.exports = { createAquarium, MAX_TANK };
