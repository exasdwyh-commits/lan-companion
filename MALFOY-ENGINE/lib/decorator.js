"use strict";
/**
 * 她自己改造小屋：模型出计划 → 引擎校验 → 失败把错误喂回去让它自己改。
 *
 * 为什么必须闭环而不是一次性：
 * 大模型摆家具几乎一定会压到东西或越界。一次失败就放弃，用户看到的是
 * 「她说要动一动摆设，然后就没了」；而把结构化 errors 原样回灌，第二次
 * 成功率极高 —— 因为它能看懂「(2,2) 的 2×2 书桌压到了 r1 地毯」这种句子。
 *
 * 为什么重试次数要卡死：
 * 无限重试会烧钱、会把启动拖长，而且第三轮还错说明这个模型当时就是不行。
 * 三次之内不成，就当成这次没改造，房间保持原样（apply 本来就是原子的）。
 *
 * 本模块不认识窗口、不认识模型客户端：generate 由调用方注入，
 * 这样整条回路可以在没有网络的情况下用假模型测完。
 */
const fs = require("node:fs");
const path = require("node:path");

const MAX_ATTEMPTS = 3;
const MAX_PROMPT_ITEMS = 24;

/** 把结构化 errors 翻成模型能直接照做的一句句中文。 */
function describeErrors(errors) {
  if (!Array.isArray(errors) || !errors.length) return "";
  const lines = [];
  for (const e of errors) {
    if (!e || typeof e !== "object") continue;
    switch (e.reason) {
      case "out-of-bounds":
        lines.push(`- ${e.uid || "其中一件"} 放不下：坐标加上它的占地超出了网格右下角。x 取 0–13，y 取 0–8，且 x+宽 ≤ 14、y+高 ≤ 9。`);
        break;
      case "overlap":
        lines.push(`- ${e.uid || "其中一件"} 压到了 ${e.with || "已有家具"} 身上。换一个空位，或者先在 remove 里撤掉它。`);
        break;
      case "unknown-item":
        lines.push(`- 目录里没有 "${e.item}"，只能用 catalog 里列出的 id。`);
        break;
      case "unknown-uid":
        lines.push(`- 要撤的 ${(e.uids || []).join("、")} 不存在，请只用 items 里给出的真实 uid。`);
        break;
      case "too-many":
        lines.push(`- 摆完会到 ${e.count} 件，超过上限 ${e.max} 件，先多撤几件。`);
        break;
      case "bad-coord":
        lines.push(`- 第 ${(e.index ?? 0) + 1} 件的位置不是整数坐标。`);
        break;
      case "bad-rot":
        lines.push(`- 第 ${(e.index ?? 0) + 1} 件的 rot 只能是 0 / 90 / 180 / 270。`);
        break;
      default:
        lines.push(`- 第 ${(e.index ?? 0) + 1} 件不合格（${e.reason}）。`);
    }
  }
  return lines.join("\n");
}

/**
 * 从模型输出里抠出计划对象。
 *
 * 模型经常把 JSON 包在 ```json 里、或者前后带一句解释。这里做的是
 * 「找到第一个括号配平的 JSON 对象」，不是宽松解析 —— 宽松解析会把
 * 半截对象当成合法输入，然后让引擎去报一堆莫名其妙的错。
 */
function extractPlan(text) {
  if (text && typeof text === "object" && !Array.isArray(text)) return text;
  if (typeof text !== "string") return null;
  const s = text.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(s.slice(start, i + 1));
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

/** 组装给模型的提示词。errors 非空时追加「上一次哪里不对」。 */
function buildPrompt({ room, goal = "", errors = [] } = {}) {
  if (!room || !Array.isArray(room.items) || !Array.isArray(room.catalog)) {
    throw new TypeError("Invalid room snapshot for prompt");
  }
  const items = room.items.slice(0, MAX_PROMPT_ITEMS)
    .map((it) => `  ${it.uid}: ${it.item}（${it.name} ${it.w}×${it.h}）@ (${it.x},${it.y})`)
    .join("\n") || "  （空房间）";
  const catalog = room.catalog
    .map((c) => `${c.id}(${c.name} ${c.w}×${c.h})`)
    .join("、");
  const head = [
    `你是澜，住在这个房间里。现在是你在自己动手改造它。`,
    `房间是 ${room.grid.w}×${room.grid.h} 的格子，坐标 (x,y) 从左上是 (0,0)，右下是 (${room.grid.w - 1},${room.grid.h - 1})。`,
    `现在房间里（uid: 家具 @ 位置）：`,
    items,
    `可选家具目录：${catalog}`,
    goal ? `这一次的想法：${goal}` : `这一次的想法：让它更像"你住的地方"。`,
    `请只输出一个 JSON 对象，不要解释、不要代码块以外的文字，格式：`,
    `{"remove":["要撤掉的 uid"],"place":[{"item":"目录里的 id","x":0,"y":0,"rot":0}]}`,
    `最多动 4 件；不能越界、不能互相压住；remove 和 place 可以只有其中一个。`,
  ].join("\n");
  const repair = describeErrors(errors);
  return repair ? `${head}\n\n上一次的计划被拒绝了，原因：\n${repair}\n请据此修正后重新输出。` : head;
}

/**
 * 跑一轮改造闭环。
 *
 * @param {object} o
 * @param {object} o.roomPlan    lib/room-plan.js 的实例
 * @param {Function} o.generate  async (prompt) => string|object
 * @param {string} [o.goal]
 * @param {number} [o.maxAttempts=3]
 * @param {string|null} [o.receiptId]  幂等收据，重放不会改两次
 * @returns {Promise<{ok:boolean, attempts:number, room:object, errors:Array, plan:object|null, reason?:string}>}
 */
async function decorate({ roomPlan, generate, goal = "", maxAttempts = MAX_ATTEMPTS, receiptId = null } = {}) {
  if (!roomPlan || typeof roomPlan.snapshot !== "function" || typeof roomPlan.apply !== "function") {
    throw new TypeError("Invalid roomPlan");
  }
  if (typeof generate !== "function") throw new TypeError("Invalid generate");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("Invalid maxAttempts");

  let errors = [];
  let lastPlan = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const prompt = buildPrompt({ room: roomPlan.snapshot(), goal, errors });
    const raw = await generate(prompt);
    const plan = extractPlan(raw);
    if (!plan) {
      errors = [{ reason: "unparsable" }];
      continue;
    }
    lastPlan = plan;
    const result = roomPlan.apply(plan, { receiptId });
    if (result.ok) {
      return { ok: true, attempts: attempt, room: result, errors: [], plan };
    }
    errors = result.errors || [];
    // 同一份计划原样再交一遍没有意义，直接判死这一轮。
    if (result.reason === "invalid" && !errors.length) break;
  }
  return { ok: false, attempts: maxAttempts, room: roomPlan.snapshot(), errors, plan: lastPlan, reason: "gave-up" };
}

module.exports = { decorate, buildPrompt, extractPlan, describeErrors, MAX_ATTEMPTS };
