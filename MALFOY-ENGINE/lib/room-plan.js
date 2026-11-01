"use strict";
/**
 * 小屋布局：她可以自己改造的那个空间。
 *
 * 为什么是「格子 + 家具目录」而不是自由 3D 摆放：
 * 大模型能可靠产出的东西是「在 (3,4) 放一张 2×2 的矮桌」，不是一串欧拉角。
 * 所以引擎的职责是**把它的想法变成合法布局**，而不是画得有多自由 ——
 * 它会提笨主意，引擎负责让笨主意不至于把房间叠成一团。
 *
 * 关键设计：apply(plan) 是原子的。大模型一次给「撤掉三件 + 摆五件」，
 * 要么全成，要么一件都不动。半途失败的房间比原来更难看，而且用户
 * 看到的会是「她动过但又好像没动」。
 *
 * 本模块只管规则与落盘，不管渲染。
 */
const fs = require("node:fs");
const path = require("node:path");

const GRID = { w: 14, h: 9 };
const ROTS = [0, 90, 180, 270];

/** 家具目录。w/h 以格为单位，是「未旋转」时的尺寸。 */
const CATALOG = {
  sofa: { name: "沙发", w: 3, h: 2, kind: "seat" },
  armchair: { name: "扶手椅", w: 1, h: 1, kind: "seat" },
  pouf: { name: "软垫", w: 1, h: 1, kind: "seat" },
  bed: { name: "床", w: 2, h: 3, kind: "sleep" },
  desk: { name: "书桌", w: 2, h: 2, kind: "table" },
  table: { name: "矮桌", w: 2, h: 2, kind: "table" },
  stool: { name: "木凳", w: 1, h: 1, kind: "table" },
  shelf: { name: "书架", w: 1, h: 3, kind: "storage" },
  cabinet: { name: "立柜", w: 1, h: 2, kind: "storage" },
  rug: { name: "地毯", w: 4, h: 3, kind: "floor" },
  mat: { name: "小地垫", w: 2, h: 1, kind: "floor" },
  plant: { name: "盆栽", w: 1, h: 1, kind: "plant" },
  flowerstand: { name: "花架", w: 1, h: 2, kind: "plant" },
  aquarium: { name: "鱼缸", w: 3, h: 2, kind: "pet" },
  lamp: { name: "落地灯", w: 1, h: 1, kind: "light" },
  candle: { name: "小烛台", w: 1, h: 1, kind: "light" },
  piano: { name: "小钢琴", w: 3, h: 2, kind: "music" },
  radio: { name: "收音机", w: 1, h: 1, kind: "music" },
  window: { name: "窗", w: 3, h: 1, kind: "decor" },
  picture: { name: "挂画", w: 2, h: 1, kind: "decor" },
  beachchair: { name: "沙滩椅", w: 1, h: 2, kind: "seat" },
  fishtank: { name: "水槽", w: 2, h: 1, kind: "pet" },
};

const MAX_ITEMS = 24;

const isInt = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;

/** 旋转后的实际占格。 */
function footprint(itemId, rot = 0) {
  const def = CATALOG[itemId];
  if (!def) throw new TypeError(`Unknown furniture: ${itemId}`);
  if (!ROTS.includes(rot)) throw new TypeError(`Unknown rotation: ${rot}`);
  const swapped = rot === 90 || rot === 270;
  return { w: swapped ? def.h : def.w, h: swapped ? def.w : def.h };
}

function createRoomPlan({ dir } = {}) {
  if (typeof dir !== "string" || !dir) throw new TypeError("Invalid room dir");
  const file = path.join(dir, "room-plan.json");

  const empty = () => ({ version: 1, seq: 0, items: [], receipts: [] });

  const validItem = (it) => it && !Array.isArray(it) && typeof it === "object" &&
    typeof it.uid === "string" && /^r\d+$/.test(it.uid) &&
    Object.hasOwn(CATALOG, it.item) && isInt(it.x, 0, GRID.w - 1) && isInt(it.y, 0, GRID.h - 1) &&
    ROTS.includes(it.rot);

  const valid = (s) => s && !Array.isArray(s) && typeof s === "object" && s.version === 1 &&
    Number.isSafeInteger(s.seq) && s.seq >= 0 &&
    Array.isArray(s.items) && s.items.length <= MAX_ITEMS && s.items.every(validItem) &&
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
      if (!valid(state)) throw new TypeError("Invalid room state");
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

  /** 占格表。返回冲突的 uid（没冲突就是空数组）。 */
  function conflicts(items) {
    const grid = new Map();
    const bad = [];
    for (const it of items) {
      const { w, h } = footprint(it.item, it.rot);
      if (it.x + w > GRID.w || it.y + h > GRID.h) { bad.push({ uid: it.uid, reason: "out-of-bounds" }); continue; }
      for (let y = it.y; y < it.y + h; y += 1) {
        for (let x = it.x; x < it.x + w; x += 1) {
          const key = `${x},${y}`;
          const owner = grid.get(key);
          if (owner && owner !== it.uid) bad.push({ uid: it.uid, reason: "overlap", with: owner });
          else grid.set(key, it.uid);
        }
      }
    }
    return bad;
  }

  function view(state) {
    const items = state.items.map((it) => ({
      ...it,
      name: CATALOG[it.item].name,
      kind: CATALOG[it.item].kind,
      ...footprint(it.item, it.rot),
    }));
    return {
      grid: { ...GRID },
      items,
      count: items.length,
      maxItems: MAX_ITEMS,
      catalog: Object.entries(CATALOG).map(([id, d]) => ({ id, ...d })),
      conflicts: conflicts(state.items),
    };
  }

  function snapshot() {
    return view(load());
  }

  /**
   * 原子应用一份改造计划。
   *
   * plan = { remove?: [uid...], place?: [{ item, x, y, rot? }...] }
   *
   * 校验全过才写盘；任何一条不合法就整份驳回，并把原因带回给调用方 ——
   * 调用方（接大模型那层）应该把 errors 原样塞回去让它自己改，而不是替它猜。
   */
  function apply(plan, { receiptId = null } = {}) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new TypeError("Invalid room plan");
    if (receiptId !== null && (typeof receiptId !== "string" || !receiptId)) {
      throw new TypeError("Invalid room receipt");
    }
    const remove = plan.remove === undefined ? [] : plan.remove;
    const place = plan.place === undefined ? [] : plan.place;
    if (!Array.isArray(remove) || !remove.every((u) => typeof u === "string")) {
      throw new TypeError("Invalid room plan.remove");
    }
    if (!Array.isArray(place)) throw new TypeError("Invalid room plan.place");

    const state = load();
    if (receiptId && state.receipts.includes(receiptId)) {
      return { ok: true, duplicate: true, errors: [], ...view(state) };
    }

    const errors = [];
    const unknown = remove.filter((u) => !state.items.some((it) => it.uid === u));
    if (unknown.length) errors.push({ reason: "unknown-uid", uids: unknown });

    const kept = state.items.filter((it) => !remove.includes(it.uid));
    let seq = state.seq;
    const added = [];
    for (const [i, p] of place.entries()) {
      if (!p || typeof p !== "object" || Array.isArray(p)) { errors.push({ reason: "bad-place", index: i }); continue; }
      if (!Object.hasOwn(CATALOG, p.item)) { errors.push({ reason: "unknown-item", index: i, item: p.item }); continue; }
      const rot = p.rot === undefined ? 0 : p.rot;
      if (!ROTS.includes(rot)) { errors.push({ reason: "bad-rot", index: i }); continue; }
      if (!isInt(p.x, 0, GRID.w) || !isInt(p.y, 0, GRID.h)) { errors.push({ reason: "bad-coord", index: i }); continue; }
      seq += 1;
      added.push({ uid: `r${seq}`, item: p.item, x: p.x, y: p.y, rot });
    }

    if (kept.length + added.length > MAX_ITEMS) {
      errors.push({ reason: "too-many", count: kept.length + added.length, max: MAX_ITEMS });
    }
    const merged = [...kept, ...added];
    errors.push(...conflicts(merged));
    if (errors.length) return { ok: false, reason: "invalid", errors, ...view(state) };

    const next = { ...state, seq, items: merged, receipts: receiptId ? [...state.receipts, receiptId] : state.receipts };
    write(next);
    return { ok: true, duplicate: false, errors: [], applied: { removed: remove.length, placed: added.length }, ...view(next) };
  }

  /**
   * 顺手版：不删东西，只摆。
   *
   * 注意这里的错误口径和 apply 不同：apply 是给大模型用的，输了就返回结构化
   * errors 让它自己改；place/remove 是给代码用的，拼错家具名属于程序员错误，
   * 直接抛 —— 否则一个错别字会被静默当成「放不下」，查半天。
   * 但几何冲突（越界/重叠）仍然是返回值，那是运行时就会发生的事。
   */
  function place(itemId, x, y, rot = 0) {
    if (!Object.hasOwn(CATALOG, itemId)) throw new TypeError(`Unknown furniture: ${itemId}`);
    if (!ROTS.includes(rot)) throw new TypeError(`Unknown rotation: ${rot}`);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new TypeError("Invalid room coordinate");
    return apply({ place: [{ item: itemId, x, y, rot }] });
  }

  function remove(uid) {
    if (typeof uid !== "string" || !uid) throw new TypeError("Invalid room uid");
    if (!load().items.some((it) => it.uid === uid)) throw new TypeError(`Unknown room uid: ${uid}`);
    return apply({ remove: [uid] });
  }

  /** 清空（她决定推倒重来）。 */
  function clear() {
    return apply({ remove: load().items.map((it) => it.uid) });
  }

  return { snapshot, apply, place, remove, clear };
}

module.exports = { createRoomPlan, CATALOG, GRID, ROTS, MAX_ITEMS, footprint };
