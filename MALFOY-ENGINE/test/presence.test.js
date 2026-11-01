"use strict";
// 桌面形态的自我定位：她在哪、被谁挡住、被挡住多少。
//
// 最要紧的两条：
//   1. **y 是脚底**，不是头顶 —— 搞错的话整段位置描述会差一个身位；
//   2. 站在窗口**顶边**要判成「没被挡」，站在窗口**底边**要判成「被挡」——
//      后者是现有 perch 逻辑里真实存在的情况（perchLine 在顶边放不下时返回 w.y+w.h），
//      她的身体正好落在窗口里，用户其实看不见她。

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib/presence");

const SCREEN = { sw: 1440, sh: 900 };

test("bodyRect：y 是脚底，矩形往上长", () => {
  const r = P.bodyRect({ x: 300, y: 900, w: 100, h: 180 });
  assert.deepEqual(r, { x: 250, y: 720, w: 100, h: 180 });
});

test("bodyRect：缺字段或尺寸为 0 时返回 null", () => {
  assert.equal(P.bodyRect({ x: 1, y: 2, w: 0, h: 10 }), null);
  assert.equal(P.bodyRect({ x: 1, y: 2 }), null);
  assert.equal(P.bodyRect(null), null);
});

test("overlapArea：不相交为 0", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(P.overlapArea(a, { x: 20, y: 20, w: 5, h: 5 }), 0);
  assert.equal(P.overlapArea(a, { x: 5, y: 5, w: 10, h: 10 }), 25);
});

test("occluders：算占比并按大小排序，同一 app 多窗口只留最大的", () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 };
  const wins = [
    { app: "Safari", x: 0, y: 0, w: 100, h: 100 },   // 全盖
    { app: "Code", x: 0, y: 50, w: 100, h: 50 },     // 盖一半
    { app: "Code", x: 0, y: 90, w: 100, h: 10 },     // 同一 app，更小
    { app: "Finder", x: 500, y: 500, w: 100, h: 100 }, // 不沾边
    { app: "坏数据", x: NaN, y: 0, w: 1, h: 1 },
  ];
  const out = P.occluders(rect, wins);
  assert.deepEqual(out.map((o) => o.app), ["Safari", "Code"]);
  assert.equal(out[0].ratio, 1);
  assert.equal(out[1].ratio, 0.5);
});

test("severityOf：0.8 以上算看不见，0.2 以上算部分遮挡", () => {
  assert.equal(P.severityOf(0.9), "hidden");
  assert.equal(P.severityOf(0.8), "hidden");
  assert.equal(P.severityOf(0.5), "partial");
  assert.equal(P.severityOf(0.2), "partial");
  assert.equal(P.severityOf(0.1), "clear");
});

test("describe：左上被挡死 → 说清位置和「基本看不见」", () => {
  const d = P.describe({
    ...SCREEN, x: 200, y: 200, w: 100, h: 180, state: "idle", perch: null,
    wins: [{ app: "Safari", x: 0, y: 0, w: 700, h: 600 }],
  });
  assert.ok(d.includes("【你此刻在哪】"));
  assert.ok(d.includes("左侧"));
  assert.ok(d.includes("偏上"));
  assert.ok(d.includes("「Safari」"));
  assert.ok(d.includes("基本看不见"));
  assert.ok(d.includes("1440×900"));
});

test("describe：右下且没窗口 → 明确说「用户能完整看见」", () => {
  const d = P.describe({
    ...SCREEN, x: 1200, y: 900, w: 100, h: 180, state: "idle", perch: null, wins: [],
  });
  assert.ok(d.includes("右侧"));
  assert.ok(d.includes("偏下"));
  assert.ok(d.includes("桌面地面上"));
  assert.ok(d.includes("没有窗口挡住"));
});

test("describe：站在窗口顶边时，身体在窗口之上 → 判成没被挡", () => {
  // 窗口顶边 y=500，她脚底也 500 → 身体 320..500，与窗口 500..800 不相交
  const d = P.describe({
    ...SCREEN, x: 700, y: 500, w: 100, h: 180, state: "idle", perch: "Safari",
    wins: [{ app: "Safari", x: 400, y: 500, w: 600, h: 300 }],
  });
  assert.ok(d.includes("站在「Safari」窗口的顶边上"));
  assert.ok(d.includes("没有窗口挡住"));
});

test("describe：站在窗口底边时身体落进窗口里 → 必须报被挡（现有 perch 真会出现）", () => {
  // 顶边放不下（w.y < 身高），perchLine 返回 w.y + w.h = 400；身体 220..400 全在窗口 100..400 内
  const d = P.describe({
    ...SCREEN, x: 700, y: 400, w: 100, h: 180, state: "idle", perch: "Code",
    wins: [{ app: "Code", x: 400, y: 100, w: 600, h: 300 }],
  });
  assert.ok(d.includes("「Code」"));
  assert.ok(d.includes("基本看不见") || d.includes("还看得见一部分"));
  // 措辞不能自相矛盾：站在底边时说成「顶边上」会让人以为她看得见
  assert.ok(d.includes("下沿"), "站在底边要如实说下沿");
  assert.equal(d.includes("顶边"), false, "底边不许说成顶边");
});

test("wherePhrase：纵向正好在中间时不带后缀，不许出现「中间中部」", () => {
  assert.equal(P.wherePhrase(700, 450, 1440, 900), "屏幕中间");
  assert.equal(P.wherePhrase(100, 800, 1440, 900), "屏幕左侧偏下");
  assert.equal(P.wherePhrase(1300, 100, 1440, 900), "屏幕右侧偏上");
});

test("describe：数据不全时返回空串，宁可不写也别写错", () => {
  assert.equal(P.describe({ x: 1, y: 2, w: 3, h: 4 }), "");
  assert.equal(P.describe({ sw: 1440, sh: 900 }), "");
  assert.equal(P.describe(null), "");
});

test("describe：脚底贴屏幕底边算站在地面，悬空则如实说", () => {
  const ground = P.describe({ ...SCREEN, x: 700, y: 898, w: 100, h: 180, perch: null, wins: [] });
  assert.ok(ground.includes("桌面地面上"));
  const air = P.describe({ ...SCREEN, x: 700, y: 500, w: 100, h: 180, perch: null, wins: [] });
  assert.ok(air.includes("悬在半空"));
});
