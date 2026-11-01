"use strict";
/**
 * 澜的旅行：她按真实时间自己出门，回来带一张明信片和一段见闻。
 *
 * 这个模块的意义不是"随机文案生成器"，而是让她**有自己的行程** ——
 * 所以见闻必须落盘成旅行日记。每次都是新生成的话，攒不下任何东西，
 * 用户也不会觉得"她真的出去过"。
 *
 * 时间用「补算」而不是「真的等」：app 关着 8 小时再打开，应该一次性补出
 * 这几趟旅行，而不是从打开那一刻开始重新计时。补算上限 3 趟，避免久未打开时刷屏。
 *
 * 模型不可用时退回本地模板 —— 旅行本身不该因为模型挂了就停摆。
 */
const fs = require("fs");
const path = require("path");

const TRIP_INTERVAL_MS = 2 * 60 * 60 * 1000; // 每 2 小时一趟
const MAX_CATCHUP = 3;                        // 一次最多补 3 趟
const MAX_DIARY = 60;                         // 日记最多留 60 条

/** 本地兜底见闻。模型不可用时用这些，读起来仍然像"她去了个地方"。 */
const PLACES = [
  { name: "海边的旧码头", tail: "潮水退了，露出很多小石子。我捡了一颗最圆的，放在口袋里。" },
  { name: "雨后的图书馆", tail: "书架之间有股旧纸的味道。有人把书放错了位置，我帮他放回去了。" },
  { name: "山顶的观景台", tail: "风很大，云跑得比平时快。我在栏杆边站了很久，没说话。" },
  { name: "夜市的尽头", tail: "有个卖糖水的小摊，热气一直往上飘。我没买，只是看了一会儿。" },
  { name: "城郊的废弃车站", tail: "铁轨上长了草。时刻表还挂着，最后一班是很多年前。" },
  { name: "临街的旧书店", tail: "老板在打瞌睡。我翻到一本讲鲸鱼的书，扉页有人写过字。" },
  { name: "涨潮前的礁石区", tail: "水刚没到脚踝，凉的。远处有人在喊，听不清喊什么。" },
  { name: "深夜的便利店", tail: "只有收银员和我。灯光很白，外面的雨还在下。" },
];

function createJourney({ dir, photos = () => [], generate = null, intervalMs = TRIP_INTERVAL_MS } = {}) {
  const root = path.join(dir, "journey");
  const stateFile = path.join(root, "journey.json");
  fs.mkdirSync(root, { recursive: true });

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; }
  };
  const writeJson = (file, value) => {
    fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2));
    fs.renameSync(file + ".tmp", file);
  };

  const stored = readJson(stateFile, null);
  const state = {
    lastTripAt: stored && Number.isFinite(stored.lastTripAt) ? stored.lastTripAt : null,
    trips: stored && Number.isFinite(stored.trips) ? stored.trips : 0,
    diary: stored && Array.isArray(stored.diary) ? stored.diary.slice(0, MAX_DIARY) : [],
  };

  const save = () => writeJson(stateFile, state);

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /** 一条见闻：模型优先，失败退回模板。 */
  async function makeNote(place) {
    if (typeof generate === "function") {
      try {
        const text = await generate(place.name);
        const clean = String(text || "").trim().replace(/\s+/g, " ");
        if (clean) return { note: clean.slice(0, 200), source: "model" };
      } catch (_) { /* 模型挂了就用模板，旅行不该因此停摆 */ }
    }
    return { note: place.tail, source: "template" };
  }

  async function makeEntry(at) {
    const place = pick(PLACES);
    const album = typeof photos === "function" ? photos() : [];
    const photo = album.length ? pick(album) : null;
    const { note, source } = await makeNote(place);
    return {
      at: new Date(at).toISOString(),
      place: place.name,
      note,
      photo,
      source,
    };
  }

  /**
   * 补算到期的旅行。返回这次新增的条目（可能为空）。
   * 第一次调用只记下起点，不会立刻产生一趟 —— 否则刚装好就"她刚回来"。
   */
  async function tick(now = Date.now()) {
    if (!Number.isFinite(state.lastTripAt)) {
      state.lastTripAt = now;
      save();
      return [];
    }
    const elapsed = now - state.lastTripAt;
    if (elapsed < intervalMs) return [];
    const due = Math.floor(elapsed / intervalMs);
    const count = Math.min(due, MAX_CATCHUP);
    const created = [];
    for (let i = 0; i < count; i++) {
      // 时间戳按「本该发生的时刻」算，不是补算的时刻
      const entry = await makeEntry(state.lastTripAt + intervalMs * (i + 1));
      state.diary.unshift(entry);
      created.push(entry);
    }
    // 时间推进到最新，而不是 +count：否则错过太多趟时会一直反复补
    state.lastTripAt += due * intervalMs;
    state.trips += due;
    state.diary = state.diary.slice(0, MAX_DIARY);
    save();
    return created;
  }

  function snapshot(now = Date.now()) {
    const elapsed = Number.isFinite(state.lastTripAt) ? now - state.lastTripAt : 0;
    const nextAt = Number.isFinite(state.lastTripAt) ? state.lastTripAt + intervalMs : now + intervalMs;
    return {
      trips: state.trips,
      lastTripAt: Number.isFinite(state.lastTripAt) ? new Date(state.lastTripAt).toISOString() : null,
      nextTripAt: new Date(nextAt).toISOString(),
      // 距离下一趟还有多久（毫秒），UI 可以直接显示"她还有 40 分钟回来"
      dueInMs: Math.max(0, nextAt - now),
      diary: state.diary.map((entry) => ({ ...entry })),
    };
  }

  return { tick, snapshot, intervalMs };
}

module.exports = { createJourney, PLACES, TRIP_INTERVAL_MS, MAX_CATCHUP, MAX_DIARY };
