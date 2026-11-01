"use strict";
/**
 * 她想做什么 —— 把 lib/soul.js 的「想要」变成「真的去做了」。
 *
 * 没有这层，soul.js 只是一组数字；有了这层，她会在你干别的事的时候自己去浇水、
 * 去水边坐着、去挪家具。三件事决定了这层能不能用：
 *
 * 1) 可行性优先于意愿。她「最想改造小屋」，但小屋已经摆满 24 件 —— 那就不是意愿
 *    问题而是没有位置。所以每个动作都要带 feasibility，不能只按分数排序。
 * 2) 夜里有夜里该做的事。凌晨三点她说「想动一动小屋的摆设」是错的，
 *    这不是性格问题，是可读性问题。
 * 3) 不能刷屏。每个动作各自有冷却，另外全局还有一道闸；桌宠一晚上弹八条
 *    自言自语比不说话更吵。
 *
 * 本模块只做决策和记录，执行留给调用方（主进程里的 intent 时钟）。
 */
const fs = require("node:fs");
const path = require("node:path");

/** 夜间窗口：只有 rest 可行。 */
const NIGHT_FROM = 23;
const NIGHT_TO = 7;

/** 全局最短间隔：两次主动行为之间至少隔这么久。 */
const GLOBAL_COOLDOWN_MS = 20 * 60 * 1000;

const isNight = (now) => {
  const h = new Date(now).getHours();
  return h >= NIGHT_FROM || h < NIGHT_TO;
};

/**
 * 动作表。feasible 拿到的 context 是调用方攒好的只读快照，
 * 这里不许抛异常：任何一个快照缺字段都只应该让这个动作不可行。
 */
const ACTIONS = {
  tendGarden: {
    label: "去小花园",
    cooldownMs: 25 * 60 * 1000,
    nightOk: false,
    feasible: (ctx) => !!ctx.garden && Array.isArray(ctx.garden.plots) &&
      ctx.garden.plots.some((p) => p.ready && !p.withered),
    line: (ctx) => {
      const plot = ctx.garden.plots.find((p) => p.ready && !p.withered);
      return `${plot.name}熟了，我去摘一下。`;
    },
  },
  fish: {
    label: "去水边",
    cooldownMs: 40 * 60 * 1000,
    nightOk: false,
    feasible: (ctx) => !!ctx.fishing && Array.isArray(ctx.fishing.spots) &&
      ctx.fishing.spots.some((s) => s.open),
    line: (ctx) => {
      const spot = ctx.fishing.spots.find((s) => s.open);
      return `${spot.name}这会儿正合适，我去坐一会儿。`;
    },
  },
  decorate: {
    label: "改一改小屋",
    cooldownMs: 90 * 60 * 1000,
    nightOk: false,
    feasible: (ctx) => !!ctx.room && Array.isArray(ctx.room.items) &&
      ctx.room.items.length < (ctx.room.maxItems || 24),
    line: () => "想把家具挪一挪，换个位置看看。",
  },
  rest: {
    label: "安静待着",
    cooldownMs: 30 * 60 * 1000,
    nightOk: true,
    feasible: () => true,
    line: () => "我在这儿安静待一会儿。",
  },
  // chat 不在主进程自己执行：主动开口交给渲染层的 companion:proactive，
  // 否则同一个入口会有两个声源。
  chat: {
    label: "想说话",
    cooldownMs: 0,
    nightOk: false,
    feasible: () => false,
    line: () => null,
  },
};

function createIntent({ dir, rng = Math.random } = {}) {
  if (typeof dir !== "string" || !dir) throw new TypeError("Invalid intent dir");
  if (typeof rng !== "function") throw new TypeError("Invalid intent rng");
  const file = path.join(dir, "intent.json");

  const empty = () => ({ version: 1, lastAt: {}, lastAnyAt: 0 });

  const isTime = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const valid = (s) => s && !Array.isArray(s) && typeof s === "object" && s.version === 1 &&
    s.lastAt && !Array.isArray(s.lastAt) &&
    Object.entries(s.lastAt).every(([k, v]) => Object.hasOwn(ACTIONS, k) && isTime(v)) &&
    isTime(s.lastAnyAt);

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
      if (!valid(state)) throw new TypeError("Invalid intent state");
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

  /**
   * 决定下一步。
   *
   * @param {object} o
   * @param {Array}  o.wants   soul().wants(now, n) 的结果（已按权重排序）
   * @param {object} o.context { garden, fishing, room } 快照，缺项等于不可行
   * @param {number} [o.now]
   * @returns {{action:string, label:string, line:string|null, score:number, reason:string|null}}
   */
  function decide({ wants = [], context = {}, now = Date.now() } = {}) {
    if (!Array.isArray(wants)) throw new TypeError("Invalid intent wants");
    const state = load();
    const ctx = context || {};
    const night = isNight(now);

    // since < 0 说明时钟回拨过（改系统时间、夏令时、或拿未来时间戳测过）。
    // 这时候不能当成"还在冷却"—— 否则她会永久沉默，直到时间追上那个未来点。
    const since = now - state.lastAnyAt;
    if (since >= 0 && since < GLOBAL_COOLDOWN_MS) {
      return { action: "idle", label: "", line: null, score: 0, reason: "global-cooldown" };
    }

    const candidates = [];
    for (const want of wants) {
      const name = want && want.drive;
      if (!name || !Object.hasOwn(ACTIONS, name)) continue;
      const def = ACTIONS[name];
      if (night && !def.nightOk) continue;
      const last = state.lastAt[name] || 0;
      const gap = now - last;
      if (def.cooldownMs > 0 && last > 0 && gap >= 0 && gap < def.cooldownMs) continue;
      let ok = false;
      try { ok = def.feasible(ctx); } catch (_) { ok = false; }
      if (!ok) continue;
      const weight = typeof want.weight === "number" && Number.isFinite(want.weight) ? want.weight : 0;
      if (weight <= 0) continue;
      // 抖动只用来打破平局，不能盖过意愿差距：±15%。
      const score = weight * (0.85 + 0.3 * rng());
      candidates.push({ def, name, score });
    }

    // 夜里没人可做的时候她就是在休息，不是「无事可做」。
    if (!candidates.length) {
      if (night) {
        return { action: "rest", label: ACTIONS.rest.label, line: ACTIONS.rest.line(ctx), score: 0, reason: "night" };
      }
      return { action: "idle", label: "", line: null, score: 0, reason: "nothing-feasible" };
    }

    candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const top = candidates[0];
    return {
      action: top.name,
      label: top.def.label,
      line: top.def.line(ctx),
      score: Math.round(top.score * 1000) / 1000,
      reason: null,
    };
  }

  /** 做完了记一笔：下次冷却从这里算。 */
  function done(action, now = Date.now()) {
    if (!Object.hasOwn(ACTIONS, action)) throw new TypeError(`Unknown intent action: ${action}`);
    const state = load();
    write({ ...state, lastAt: { ...state.lastAt, [action]: now }, lastAnyAt: now });
    return snapshot();
  }

  function snapshot() {
    const state = load();
    return { lastAt: { ...state.lastAt }, lastAnyAt: state.lastAnyAt };
  }

  return { decide, done, snapshot };
}

module.exports = { createIntent, ACTIONS, GLOBAL_COOLDOWN_MS, NIGHT_FROM, NIGHT_TO, isNight };
