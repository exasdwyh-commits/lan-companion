"use strict";
// 桌面模式里「她在哪、被谁挡住」的推断。
//
// 为什么需要这个模块：桌面形态下舞台窗口是 `type:"desktop"`（壁纸层），
// 任何普通应用窗口都盖在她上面 —— 她走到哪、是不是被挡住，渲染层知道，
// 但**主进程不知道**，而拼提示词的是主进程。结果就是「让她去左边，自己被挡住
// 了她也不知道」，因为她拿到的上下文里根本没有位置这回事。
//
// 本模块只做纯计算：输入渲染层上报的自述 + 窗口列表，输出一段可以塞进
// system prompt 的中文。不读文件、不碰 Electron，所以能直接 node --test。
//
// 坐标约定（务必对齐，否则整段都是错的）：
//   - `x/y/w/h` 是**她的身体矩形**，y 是**脚底**（world.html 里 pet.y 就是脚底，
//     站着时 pet.y = H-2，站在窗口顶边时 pet.y = 窗口的 y）。
//   - 窗口矩形来自 CGWindowList，全局屏幕坐标、y 向下、单位是点（pt）。
//   - 舞台窗口铺满主屏且原点 (0,0)，所以 CSS px == 点 == CG 坐标，可以直接比。

// 遮住多少算「看不见」。0.8 是实拍的观感：露出两成（比如半个头）用户还能注意到她。
const HIDDEN_AT = 0.8;
const PARTIAL_AT = 0.2;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function bodyRect(self) {
  const x = Number(self && self.x);
  const y = Number(self && self.y);
  const w = Math.max(0, Number(self && self.w) || 0);
  const h = Math.max(0, Number(self && self.h) || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !w || !h) return null;
  return { x: x - w / 2, y: y - h, w, h };
}

function overlapArea(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox <= 0 || oy <= 0) return 0;
  return ox * oy;
}

/**
 * 她的身体被哪些窗口盖住、各占多少。
 *
 * 只按面积算，不做 z 序判断：桌面形态的舞台在壁纸层，**任何**普通窗口都在她上面，
 * 所以「有重叠 = 被挡」是成立的，不需要看前后顺序。
 */
function occluders(rect, wins) {
  if (!rect) return [];
  const area = rect.w * rect.h;
  if (!area) return [];
  const out = [];
  for (const w of Array.isArray(wins) ? wins : []) {
    if (!w || ![w.x, w.y, w.w, w.h].every(Number.isFinite)) continue;
    const ratio = clamp01(overlapArea(rect, w) / area);
    if (ratio < 0.02) continue;
    out.push({ app: String(w.app || "某个窗口"), ratio });
  }
  // 同一个 app 开多个窗口时合并，只报最大的那个占比
  const byApp = new Map();
  for (const o of out) {
    const prev = byApp.get(o.app);
    if (!prev || o.ratio > prev.ratio) byApp.set(o.app, o);
  }
  return [...byApp.values()].sort((a, b) => b.ratio - a.ratio);
}

function severityOf(ratio) {
  if (ratio >= HIDDEN_AT) return "hidden";
  if (ratio >= PARTIAL_AT) return "partial";
  return "clear";
}

function horizontalOf(x, sw) {
  const k = x / (sw || 1);
  if (k < 0.33) return "左侧";
  if (k < 0.67) return "中间";
  return "右侧";
}

function verticalOf(y, sh) {
  const k = y / (sh || 1);
  if (k < 0.33) return "上";
  if (k < 0.75) return "中";
  return "下";
}

/** 「屏幕左侧偏下」这种说法；纵向正好在中间时不带后缀，免得出现「中间中部」。 */
function wherePhrase(x, y, sw, sh) {
  const v = verticalOf(y, sh);
  return `屏幕${horizontalOf(x, sw)}${v === "中" ? "" : `偏${v}`}`;
}

/**
 * 她踩在什么上面。
 *
 * `perch` 只说明「挂在哪个窗口上」，不说明是顶边还是底边 —— 而这两者观感完全不同：
 * 顶边她整个人在窗口之上（看得见），底边她整个人落进窗口里（看不见）。
 * 现有 perchLine() 在顶边放不下时会退回底边，所以这里必须按坐标判，不能照抄字段。
 */
function surfaceOf(self) {
  const perch = self && self.perch;
  const y = Number(self && self.y);
  const sh = Number(self && self.sh);
  if (perch) {
    const w = (Array.isArray(self.wins) ? self.wins : []).find((v) => v && v.app === perch);
    if (w) {
      if (Math.abs(y - w.y) <= 6) return `站在「${perch}」窗口的顶边上`;
      if (Math.abs(y - (w.y + w.h)) <= 6) return `贴在「${perch}」窗口的下沿，人在窗口里面`;
      return `在「${perch}」窗口附近`;
    }
    return `在「${perch}」窗口边上`;
  }
  if (Number.isFinite(y) && Number.isFinite(sh) && y >= sh - 8) return "站在桌面地面上";
  return "悬在半空";
}

/**
 * 生成给模型看的一段话。
 *
 * 只陈述事实，不写行动建议 —— 行动指令统一放在 main.js 的 `DESKTOP_MOVE_HINT`，
 * 两处都写会互相打架，而且这里每次位置变化都要重算，越短越省 token。
 *
 * @returns {string} 空串表示数据不够，宁可不写也别写错
 */
function describe(self) {
  const rect = bodyRect(self);
  if (!rect) return "";
  const sw = Number(self.sw) || 0;
  const sh = Number(self.sh) || 0;
  if (!sw || !sh) return "";

  const where = wherePhrase(self.x, self.y, sw, sh);
  const lines = [
    "【你此刻在哪】",
    `- 屏幕 ${Math.round(sw)}×${Math.round(sh)}，你在${where}（脚底 x≈${Math.round(self.x)}, y≈${Math.round(self.y)}），${surfaceOf(self)}。`,
  ];

  const hits = occluders(rect, self.wins);
  const top = hits[0];
  const severity = top ? severityOf(top.ratio) : "clear";
  if (severity === "hidden") {
    const apps = hits.slice(0, 2).map((h) => `「${h.app}」`).join("");
    lines.push(`- ${apps}把你挡住了大约 ${Math.round(top.ratio * 100)}%，用户现在基本看不见你。`);
  } else if (severity === "partial") {
    lines.push(`- 「${top.app}」挡住了你大约 ${Math.round(top.ratio * 100)}%，还看得见一部分。`);
  } else {
    lines.push("- 现在没有窗口挡住你，用户能完整看见。");
  }
  return lines.join("\n");
}

module.exports = {
  HIDDEN_AT,
  PARTIAL_AT,
  bodyRect,
  overlapArea,
  occluders,
  severityOf,
  horizontalOf,
  verticalOf,
  wherePhrase,
  surfaceOf,
  describe,
};
