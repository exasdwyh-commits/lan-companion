"use strict";
/**
 * 灵魂：她自己会变的那部分。
 *
 * lib/identity.js 是「她是谁」——那份文本在两形态之间逐字节相同，永远不动。
 * 这个模块是「她变成了谁」——五个性情轴随互动缓慢偏移，没有互动就往原位漂回。
 *
 * 三条设计约束，缺一条这个系统就会变成假的：
 *
 * 1) 必须会漂回去。只增不减的数值最后全顶到 100，性格就退化成「什么都最高」，
 *    等于没有性格。所以每次读取都按真实时间向 baseline 收敛，互动只是把偏移
 *    推出去 —— 你长期怎么对她，才决定她停在哪儿。
 * 2) 必须落盘成「她自己的记录」，不是用户设置。所以写入走 DATA.dir，
 *    和好感度、旅行日记同级；用户改不动它，只能通过相处影响它。
 * 3) 必须能被读到提示词里，否则再怎么算都只是给界面看的数字。
 *    prompt() 输出的就是 40 字以内、能直接塞进 system prompt 的那一段。
 *
 * 本模块不认识路径、不认识窗口，也不发 IPC：调用方给 dir，自己发事件。
 */
const fs = require("node:fs");
const path = require("node:path");

/** 五轴。顺序即 prompt 里的固定顺序，改顺序等于改输出。 */
const TRAITS = ["curiosity", "warmth", "play", "order", "calm"];

const LABEL = {
  curiosity: "好奇",
  warmth: "温柔",
  play: "俏皮",
  order: "秩序",
  calm: "沉静",
};

const MIN = 0;
const MAX = 100;
const DEFAULT_BASELINE = 50;

/**
 * 事件 → 性情偏移。
 *
 * 数值刻意小：一次聊天只 +1~2，跑满一格（50→60）要几十次互动。
 * 一晚上就能刷满的性格不叫性格，叫成就系统。
 */
const EVENTS = {
  chat: { warmth: 1, curiosity: 2, label: "聊天" },
  touch: { play: 2, warmth: 1, label: "戳她" },
  gift: { warmth: 3, play: 1, label: "收到礼物" },
  song: { play: 2, calm: 1, label: "一起听歌" },
  read: { curiosity: 2, calm: 2, order: 1, label: "读书" },
  garden: { order: 2, calm: 2, warmth: 1, label: "照料花园" },
  fish: { calm: 3, curiosity: 1, label: "去钓鱼" },
  decorate: { order: 3, play: 2, label: "改造小屋" },
  travel: { curiosity: 3, play: 1, label: "出门旅行" },
  // 长时间没被理会：她会往安静那一侧退一点。这不是惩罚，是让「疏远」有痕迹。
  quiet: { calm: 2, warmth: -1, play: -1, label: "独处" },
  // 被叫回来：反差更明显一点。
  return: { warmth: 3, play: 1, curiosity: 1, label: "被叫回来" },
};

/** 独处推进的判定间隔：超过这个时长没互动，才计一次 quiet。 */
const QUIET_AFTER_MS = 12 * 60 * 60 * 1000;

/** 偏移的半衰期：12 小时漂掉一半，一天后基本回到原位。 */
const DRIFT_HALF_LIFE_H = 12;

/** 她自己写下的关于自己的话，最多留 8 条 —— 再多挤占提示词预算。 */
const MAX_NOTES = 8;
const MAX_NOTE_LEN = 40;

/** 想做点什么的倾向。全部由性情派生，不单独存。 */
const DRIVES = {
  tendGarden: { label: "去小花园看看", w: { order: 0.4, calm: 0.3, warmth: 0.3 } },
  fish: { label: "去水边坐一会儿", w: { calm: 0.5, curiosity: 0.3, play: 0.2 } },
  decorate: { label: "想动一动小屋的摆设", w: { order: 0.5, play: 0.3, curiosity: 0.2 } },
  travel: { label: "想出门走走", w: { curiosity: 0.6, play: 0.2, calm: 0.2 } },
  rest: { label: "想安静待着", w: { calm: 0.6, warmth: 0.4 } },
  chat: { label: "想和你说话", w: { warmth: 0.5, play: 0.3, curiosity: 0.2 } },
};

const clamp = (n) => Math.max(MIN, Math.min(MAX, Math.round(n)));

const isInt = (n) => Number.isSafeInteger(n) && n >= MIN && n <= MAX;
const isTime = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * 向 baseline 收敛：半衰期内漂掉一半，向下取整保证单调、可重放，
 * 且不会因为浮点误差在 50.0001 上永远停不下来。
 */
function drift(value, baseline, hours) {
  if (!(hours > 0)) return value;
  const gap = value - baseline;
  if (gap === 0) return value;
  const remain = Math.pow(0.5, hours / DRIFT_HALF_LIFE_H);
  const next = baseline + gap * remain;
  // 四舍五入而不是向下取整：耗时只有几毫秒时 gap*remain 仍然是 0.99997，
  // 向下取整会立刻白掉一格 —— 每次读盘都掉一分，性格就成了沙漏。
  const stepped = Math.round(next);
  if (Math.abs(stepped - baseline) < 1) return baseline;
  return stepped;
}

function createSoul({ dir, packPath = null } = {}) {
  if (typeof dir !== "string" || !dir) throw new TypeError("Invalid soul dir");

  // pack 可选：主要给测试和以后做「性情预设」用；不给就用内置默认值。
  let pack = null;
  if (packPath) {
    pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
    if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw new TypeError("Invalid soul pack");
  }
  const baseline = {};
  for (const key of TRAITS) {
    const v = pack && pack.baseline ? pack.baseline[key] : undefined;
    baseline[key] = isInt(v) ? v : DEFAULT_BASELINE;
  }
  const events = pack && pack.events ? pack.events : EVENTS;
  for (const [name, def] of Object.entries(events)) {
    if (!def || typeof def !== "object" || Array.isArray(def)) throw new TypeError(`Invalid soul event: ${name}`);
    for (const key of Object.keys(def)) {
      if (key === "label") continue;
      if (!TRAITS.includes(key) || !Number.isFinite(def[key])) throw new TypeError(`Invalid soul event weight: ${name}.${key}`);
    }
  }

  const file = path.join(dir, "soul.json");

  const empty = (now = 0) => ({
    version: 1,
    traits: { ...baseline },
    notes: [],
    lastAt: {},
    receipts: [],
    updatedAt: now,
  });

  const validTraits = (t) => t && !Array.isArray(t) && typeof t === "object" &&
    TRAITS.every((key) => isInt(t[key]));

  const valid = (s) => s && !Array.isArray(s) && typeof s === "object" && s.version === 1 &&
    validTraits(s.traits) && isTime(s.updatedAt) &&
    Array.isArray(s.notes) && s.notes.every((n) => typeof n === "string" && n.length <= MAX_NOTE_LEN) &&
    s.lastAt && !Array.isArray(s.lastAt) && Object.values(s.lastAt).every(isTime) &&
    (s.receipts === undefined || (Array.isArray(s.receipts) && s.receipts.every((id) => typeof id === "string")));

  function write(state) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* rename 已消费，或写入本身失败 */ }
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
      if (!valid(state)) throw new TypeError("Invalid soul state");
      return Array.isArray(state.receipts) ? state : { ...state, receipts: [] };
    } catch (_) {
      // 坏文件不静默丢弃：她"变成什么样"不该被一次解析失败抹掉。
      let backup = `${file}.bad-${Date.now()}`;
      for (let n = 1; fs.existsSync(backup); n += 1) backup = `${file}.bad-${Date.now()}-${n}`;
      fs.renameSync(file, backup);
      const state = empty();
      write(state);
      return state;
    }
  }

  /** 把落盘的 traits 按 elapsed 推到 now，返回新 traits（不写盘）。 */
  function aged(state, now) {
    const hours = Math.max(0, (now - state.updatedAt) / 3600000);
    const traits = {};
    for (const key of TRAITS) traits[key] = drift(state.traits[key], baseline[key], hours);
    return traits;
  }

  function drives(traits) {
    const out = {};
    for (const [name, def] of Object.entries(DRIVES)) {
      let score = 0;
      for (const [key, w] of Object.entries(def.w)) score += (traits[key] / MAX) * w;
      out[name] = { label: def.label, weight: Math.round(score * 1000) / 1000 };
    }
    return out;
  }

  function view(state, now) {
    const traits = aged(state, now);
    const ranked = TRAITS.slice().sort((a, b) => traits[b] - traits[a] || TRAITS.indexOf(a) - TRAITS.indexOf(b));
    const wants = Object.entries(drives(traits))
      .map(([name, d]) => ({ drive: name, ...d }))
      .sort((a, b) => b.weight - a.weight || a.drive.localeCompare(b.drive));
    return {
      traits,
      baseline: { ...baseline },
      // 最突出的两条：提示词只提两条，说多了她自己都记不住。
      dominant: ranked.slice(0, 2),
      labels: ranked.slice(0, 2).map((k) => LABEL[k]),
      wants: wants.slice(0, 3),
      notes: state.notes.slice(),
      updatedAt: state.updatedAt,
    };
  }

  function snapshot(now = Date.now()) {
    return view(load(), now);
  }

  /**
   * 记一次互动。receiptId 可选：同一个收据第二次来不加分（重放安全）。
   * 返回加了哪些轴、加了多少，便于界面做即时反馈。
   */
  function feel(kind, { now = Date.now(), receiptId = null, intensity = 1 } = {}) {
    const def = events[kind];
    if (!def) throw new TypeError(`Unknown soul event: ${kind}`);
    if (receiptId !== null && (typeof receiptId !== "string" || !receiptId)) {
      throw new TypeError("Invalid soul receipt");
    }
    if (!Number.isFinite(intensity) || intensity <= 0 || intensity > 4) {
      throw new TypeError("Invalid soul intensity");
    }
    const state = load();
    if (receiptId && state.receipts.includes(receiptId)) {
      return { ok: true, duplicate: true, delta: {}, ...view(state, now) };
    }
    const traits = aged(state, now);
    const delta = {};
    for (const key of TRAITS) {
      const w = def[key];
      if (!w) continue;
      const before = traits[key];
      // 越往极端越难推：在 baseline 上是全强度，走到 80 只剩六成，
      // 到顶就完全推不动。这样五轴不会几百次互动后一起顶到 100 ——
      // 全都最高等于没有性格。
      const span = w > 0 ? MAX - baseline[key] : baseline[key] - MIN;
      const pos = span > 0 ? Math.abs(before - baseline[key]) / span : 1;
      const room = 1 - Math.min(1, pos) ** 2;
      const step = Math.sign(w) * Math.max(1, Math.round(Math.abs(w) * intensity * room));
      const next = clamp(before + step);
      if (next !== before) delta[key] = next - before;
      traits[key] = next;
    }
    const nextState = {
      ...state,
      traits,
      updatedAt: now,
      lastAt: { ...state.lastAt, [kind]: now },
      receipts: receiptId ? [...state.receipts, receiptId] : state.receipts,
    };
    write(nextState);
    return { ok: true, duplicate: false, delta, ...view(nextState, now) };
  }

  /** 她自己写下的一句话（由模型生成，调用方裁好长度再进来）。 */
  function note(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return { ok: false, reason: "empty", notes: load().notes };
    if ([...clean].length > MAX_NOTE_LEN) return { ok: false, reason: "too-long", notes: load().notes };
    const state = load();
    // 同一句话重复记没有意义。
    if (state.notes.includes(clean)) return { ok: true, duplicate: true, notes: state.notes.slice() };
    const notes = [...state.notes, clean].slice(-MAX_NOTES);
    write({ ...state, notes, updatedAt: Date.now() });
    return { ok: true, duplicate: false, notes };
  }

  /**
   * 塞进 system prompt 的那一段。控制在 60 字内：她是谁已经由身份段说完了，
   * 这里只补"她此刻偏什么、想干什么"。
   */
  function prompt(now = Date.now()) {
    const v = view(load(), now);
    const traits = v.labels.join("、");
    const want = v.wants[0];
    const last = v.notes.length ? v.notes[v.notes.length - 1] : "";
    const base = `你的性情偏向${traits}。`;
    const wantText = want ? `此刻更想${want.label.replace(/^想/, "")}。` : "";
    return (base + wantText + (last ? `你曾这样描述过自己：${last}` : "")).slice(0, 120);
  }

  /** 现在最想做的一件事（给主动行为调度用）。 */
  function wants(now = Date.now(), limit = 3) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid soul wants limit");
    return view(load(), now).wants.slice(0, limit);
  }

  /**
   * 独处推进：距上次任何互动超过 QUIET_AFTER_MS 才计一次，
   * 并且一天最多计一次 —— 否则关掉一天回来会被扣成另一个人。
   */
  function settle(now = Date.now()) {
    const state = load();
    const lastAny = Math.max(0, ...Object.values(state.lastAt), state.updatedAt);
    if (now - lastAny < QUIET_AFTER_MS) return { ok: false, reason: "recent" };
    const lastQuiet = state.lastAt.quiet || 0;
    if (now - lastQuiet < 24 * 60 * 60 * 1000) return { ok: false, reason: "daily-done" };
    return feel("quiet", { now });
  }

  /** 测试/诊断用：直接设定某一轴，也会写盘。 */
  function set(key, value) {
    if (!TRAITS.includes(key)) throw new TypeError("Unknown soul trait");
    if (!isInt(value)) throw new TypeError("Invalid soul trait value");
    const state = load();
    write({ ...state, traits: { ...aged(state, Date.now()), [key]: value }, updatedAt: Date.now() });
    return snapshot();
  }

  return { snapshot, feel, note, prompt, wants, settle, set };
}

module.exports = { createSoul, TRAITS, LABEL, EVENTS, DRIVES, DEFAULT_BASELINE, QUIET_AFTER_MS };
