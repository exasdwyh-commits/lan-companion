"use strict";
/**
 * 精读模式的「导演」：让大模型读一遍开头，给出角色表。
 *
 * 规则层（narration.js）靠名字用字和「某某说」猜角色，遇到「老陈也叫陈叔」、
 * 性别不明的名字就会出错。大模型能一次看全，但也只有开头 —— 所以这里只做
 * 角色表，段落切分仍然交给规则层：cast 里的名字会作为「已知角色」喂回去，
 * 规则层负责逐句归属。两边职责不要混。
 *
 * 网络失败、模型胡说、JSON 坏掉，一律回退到纯规则结果，不阻塞读书。
 */
const NARRATION = require("./narration");

const MAX_SAMPLE = 6000;
const MAX_ROLES = 10;
// 只看开头 6000 字的话，后出场的主角认不出来（一本书里第三章才登场的角色最典型）。
// 所以按块往后多看几块，每块带上「已经认出谁」，让模型只补新的。
const MAX_CHUNKS = 3;
const AGES = ["child", "teen", "young", "middle", "old"];
const GENDERS = ["male", "female"];

/** 挑选要送给模型的样本：开头优先，尽量截在段落边界。 */
function sampleText(text, limit = MAX_SAMPLE) {
  const s = String(text || "");
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const at = cut.lastIndexOf("\n");
  return at > limit * 0.5 ? cut.slice(0, at) : cut;
}

/**
 * 把正文切成若干块依次送模型。
 * 切点优先落在章节标题前（「第X章」），其次段落换行，最后才硬切 ——
 * 一章中间被劈开的话，模型会把同一个人当成两个角色。
 */
function chunkText(text, size = MAX_SAMPLE, maxChunks = MAX_CHUNKS) {
  const s = String(text || "");
  if (!s.trim()) return [];
  if (s.length <= size) return [s];
  const chunks = [];
  let pos = 0;
  while (pos < s.length && chunks.length < maxChunks) {
    let end = Math.min(pos + size, s.length);
    if (end < s.length) {
      const tail = s.slice(pos, end);
      const chapter = tail.search(/\n\s*第[零一二三四五六七八九十百千0-9]+[章节回卷]/);
      const para = tail.lastIndexOf("\n");
      if (chapter > size * 0.4) end = pos + chapter;
      else if (para > size * 0.5) end = pos + para;
    }
    if (end <= pos) end = Math.min(pos + size, s.length);
    chunks.push(s.slice(pos, end));
    pos = end;
  }
  return chunks;
}

function buildMessages(title, sample, known = []) {
  const head = title ? `书名：《${title}》\n` : "";
  const knownHint = known.length
    ? `\n已经认出的角色（不要重复列出，只列这一段新出现的人）：${known.join("、")}\n`
    : "";
  const scope = known.length ? "接下来的部分" : "开头部分";
  return [
    {
      role: "system",
      content:
        "你是广播剧的配音导演。你只输出 JSON，不写解释、不加 Markdown 以外的任何文字。",
    },
    {
      role: "user",
      content:
        `${head}以下是这本书的${scope}。${knownHint}\n────\n${sample}\n────\n\n` +
        "请判断这是不是虚构故事（小说、剧本、寓言、有角色的叙事文），并找出其中会说话的角色。\n" +
        "只输出这样的 JSON：\n" +
        '{"isFiction":true,"characters":[{"name":"周砚","gender":"male","age":"young","aliases":["老周"],"note":"沉稳寡言"}]}\n' +
        "规则：\n" +
        "1. characters 按出场顺序，最多 10 个；只列有对白或明显是角色的人。\n" +
        `2. gender 只能是 male / female / unknown；age 只能是 ${AGES.join(" / ")} / unknown。判断不了就写 unknown，不要猜。\n` +
        "3. 同一个人的不同称呼（老陈、陈叔、陈老板）写进 aliases，不要当成两个角色。\n" +
        "4. 不是虚构故事（散文、教材、说明书、新闻、纯知识读物）就返回 {\"isFiction\":false,\"characters\":[]}。",
    },
  ];
}

/** 从模型回复里抠出 JSON。模型爱包 ```json，也爱在前面说两句。 */
function extractJson(raw) {
  const s = String(raw || "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const slice = body.slice(start, end > -1 ? end + 1 : body.length);
  try { return JSON.parse(slice); } catch (_) {}
  try { return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1")); } catch (_) { return null; }
}

/** 模型给的角色表 → 归一化。名字空的、非字符串的、明显不是人名的都丢掉。 */
function normalizeCharacters(list) {
  if (!Array.isArray(list)) return [];
  const out = [], seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const name = String(raw.name || "").trim().slice(0, 24);
    if (!name || seen.has(name)) continue;
    if (NARRATION.NOT_NAME.test(name)) continue;
    seen.add(name);
    const gender = GENDERS.includes(raw.gender) ? raw.gender : "unknown";
    const age = AGES.includes(raw.age) ? raw.age : "unknown";
    const aliases = (Array.isArray(raw.aliases) ? raw.aliases : [])
      .map((a) => String(a || "").trim().slice(0, 24))
      .filter((a) => a && a !== name && !NARRATION.NOT_NAME.test(a));
    out.push({
      name, gender, age, aliases: [...new Set(aliases)].slice(0, 4),
      note: String(raw.note || "").slice(0, 60),
    });
    if (out.length >= MAX_ROLES) break;
  }
  return out;
}

function parseAnalysis(raw) {
  const json = extractJson(raw);
  if (!json || typeof json !== "object") return { ok: false, error: "模型没有返回可解析的角色表" };
  return {
    ok: true,
    isFiction: json.isFiction !== false,
    characters: normalizeCharacters(json.characters),
  };
}

/** 一个角色该用哪些音色，按可信度排。 */
function candidateKeys(c) {
  if (c.age === "old") return ["old"];
  if (c.age === "child") return ["child"];
  if (c.age === "teen") return c.gender === "female" ? ["f1", "f3"] : ["m3", "m1"];
  if (c.gender === "male") return ["m1", "m2", "m3"];
  if (c.gender === "female") return ["f2", "f3", "f1"];
  return ["f2", "m1", "f3", "m2", "f1", "m3"];
}

const POOL_KEYS = ["f1", "f2", "f3", "m1", "m2", "m3", "old", "child"];

/**
 * 角色表 → cast（{ 名字: {voice,label,...} }）。
 * 同一个人的别名指向同一个音色；池子用完了就按名字散列，至少别全挤一个声音。
 */
function assignVoices(characters) {
  const cast = {};
  const taken = new Set();
  const pick = (c) => {
    const keys = candidateKeys(c);
    const free = keys.find((k) => !taken.has(k));
    if (free) return free;
    const rest = POOL_KEYS.find((k) => !taken.has(k));
    if (rest) return rest;
    let h = 0;
    for (const ch of String(c.name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return POOL_KEYS[h % POOL_KEYS.length];
  };
  for (const c of characters) {
    const voice = pick(c);
    taken.add(voice);
    const meta = { voice, label: NARRATION.VOICE_POOL[voice].label, gender: c.gender, age: c.age, note: c.note };
    cast[c.name] = meta;
    for (const alias of Array.isArray(c.aliases) ? c.aliases : []) {
      if (alias && alias !== c.name) cast[alias] = { ...meta, aliasOf: c.name };
    }
  }
  return cast;
}

/**
 * 分析一本书。request 由调用方注入（主进程走多源路由），这里不碰网络。
 * 任何一步失败都返回 {ok:false}，调用方继续用规则结果。
 */
async function analyze({ request, title, text, signal, maxChunks = MAX_CHUNKS }) {
  if (typeof request !== "function") return { ok: false, error: "没有可用的模型通道" };
  const chunks = chunkText(text, MAX_SAMPLE, maxChunks);
  if (!chunks.length) return { ok: false, error: "没有可分析的正文" };

  const merged = [];
  const seen = new Map();
  let via = "", isFiction = null, lastError = "";

  for (let i = 0; i < chunks.length; i++) {
    let r;
    try {
      // 把已认出的名字带进去，模型就只补这一段新出现的人
      r = await request(
        buildMessages(String(title || ""), chunks[i], merged.map((c) => c.name)),
        signal
      );
    } catch (e) {
      lastError = String((e && e.message) || e).slice(0, 80);
      break; // 通道挂了就别继续烧后面的块
    }
    if (!r || !r.ok || !r.text) {
      lastError = "模型服务暂时不可用";
      via = (r && r.via) || via;
      break;
    }
    via = r.via || via;
    const parsed = parseAnalysis(r.text);
    if (!parsed.ok) { lastError = parsed.error; continue; } // 单块 JSON 坏了，试下一块
    if (isFiction === null) isFiction = parsed.isFiction;
    for (const c of parsed.characters) {
      const hit = seen.get(c.name);
      if (hit) {
        // 后面才给出别名时补进去：模型第二次提到同一个人常会带新称呼
        for (const a of c.aliases) if (!hit.aliases.includes(a)) hit.aliases.push(a);
        if (hit.gender === "unknown" && c.gender !== "unknown") hit.gender = c.gender;
        if (hit.age === "unknown" && c.age !== "unknown") hit.age = c.age;
        continue;
      }
      if (merged.length >= MAX_ROLES) break;
      seen.set(c.name, c);
      merged.push(c);
    }
    if (merged.length >= MAX_ROLES) break;
  }

  if (!merged.length) {
    return { ok: false, error: lastError || "模型没有返回可解析的角色表", via };
  }
  return {
    ok: true,
    via: via || "llm",
    isFiction: isFiction !== false,
    characters: merged,
    cast: assignVoices(merged),
    chunks: chunks.length,
  };
}

module.exports = {
  analyze, buildMessages, parseAnalysis, assignVoices,
  sampleText, chunkText, extractJson, normalizeCharacters,
  MAX_SAMPLE, MAX_ROLES, MAX_CHUNKS,
};
