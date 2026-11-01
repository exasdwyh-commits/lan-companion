"use strict";
/**
 * 朗读稿：把电子书原文变成「能念对、能换人念」的稿子。
 *
 * 三层职责：
 *   1. toSpeech()      读音规范化 —— 80后 → 八零后，1998年 → 一九九八年，3.5% → 百分之三点五
 *   2. splitParagraphs()  语义分段 —— 句末对齐、单段不超过 TTS 稳定区间
 *   3. splitScript()    旁白/对白切分 + 角色识别，给多音色合成用
 *
 * 纯规则、零网络。做不了多音字与生僻字的长尾，那部分留给可选的大模型精修。
 */

const { ebookText } = require('./ebook-text');
const LIMIT = 100;        // 单个语音片段字数上限（TTS 服务端 slice 到 300，留余量）
const PARA_TARGET = 100;  // 一段显示的朗读文本目标长度
const PARA_HARD = 160;    // 单段硬上限

const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 整数读法（0 ~ 万亿）。100 → 一百，100000 → 十万。 */
function toChineseInt(num) {
  const n = Math.trunc(Math.abs(Number(num)));
  if (!Number.isFinite(n)) return String(num);
  if (n === 0) return "零";
  const U = ["", "十", "百", "千"];
  const B = ["", "万", "亿", "兆"];
  const str = String(n);
  const groups = [];
  for (let i = str.length; i > 0; i -= 4) groups.unshift(str.slice(Math.max(0, i - 4), i));
  let out = "";
  groups.forEach((g, gi) => {
    const bi = groups.length - 1 - gi;
    let seg = "", pendingZero = false;
    for (let i = 0; i < g.length; i++) {
      const d = +g[i], u = g.length - 1 - i;
      if (d === 0) { pendingZero = true; continue; }
      if (pendingZero) { if (seg) seg += "零"; else if (out) out += "零"; pendingZero = false; }
      // 组内以「一十」开头时读「十」：12 → 十二
      if (!(d === 1 && u === 1 && !seg && !out)) seg += DIGITS[d];
      seg += U[u];
    }
    if (seg) out += seg + B[bi];
    else if (out && bi > 0 && !out.endsWith("零")) out += "零";
  });
  out = out.replace(/零+/g, "零").replace(/零$/g, "");
  return out.replace(/^一十(?=万|亿|兆)/, "十");
}

/** 逐字读数字：1998 → 一九九八，13800138000 → 一三八零零一三八零零零 */
function readOut(str) {
  return String(str).replace(/\d/g, (d) => DIGITS[+d]);
}

/** 数字串按「整数部分中文 + 小数部分逐字」读：3.5 → 三点五 */
function readNumber(str) {
  const [int, dec] = String(str).split(".");
  const head = toChineseInt(int);
  return dec ? head + "点" + readOut(dec) : head;
}

const toHalfWidth = (s) =>
  s.replace(/[\uff10-\uff19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
   .replace(/\uff0e/g, ".");

const UNITS = [
  [/km\/h|km·h⁻¹/gi, "公里每小时"],
  [/m\/s|m·s⁻¹/gi, "米每秒"],
  [/km²|平方千米|km2/gi, "平方千米"],
  [/m²|平方米|m2/gi, "平方米"],
  [/cm²/gi, "平方厘米"],
  [/km/gi, "公里"],
  [/cm/gi, "厘米"],
  [/mm/gi, "毫米"],
  [/kg/gi, "千克"],
  [/mg/gi, "毫克"],
  [/ml|mL/gi, "毫升"],
  [/GB\b/gi, "GB"],
  [/℃|°C/gi, "摄氏度"],
  [/°F/gi, "华氏度"],
];

/**
 * 读音规范化。顺序有讲究：先吃掉区间/日期/百分比这类「复合结构」，
 * 再处理孤立年份，最后处理普通小数 —— 否则 1990—2000 会被年份规则拆坏。
 *
 * keepSpaces：正文要显示给人看时保留原有空格（「第一章 潮汐」不该粘成一坨），
 * 只有真正送去合成的文本才把中文字之间的空格抹掉。
 */
function toSpeech(input, keepSpaces = false) {
  if (typeof input !== "string") return "";
  let s = toHalfWidth(ebookText(input));

  // Markdown 残留
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
       .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
       .replace(/^#{1,6}\s*/gm, "")
       .replace(/^\s*>\s?/gm, "")
       .replace(/\*\*([^*]+)\*\*/g, "$1")
       .replace(/\*([^*]+)\*/g, "$1")
       .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
       .replace(/^\s*\|?[\s:|-]{6,}\|?\s*$/gm, "")
       .replace(/\|/g, " ");
  // 链接/网址：正文里出现网址就是噪音，直接挖掉
  s = s.replace(/(?:https?:\/\/|ftp:\/\/|www\.)\S+/gi, "").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "");

  // ① 年份区间 / 数字区间（1000-2000元 是数量不是年份，别念成「一零零零年到…」）
  s = s.replace(/(\d{4})\s*[-—–~～至到]+\s*(\d{4})(\s*年)?/g, (_, a, b, yr) => {
    const isYear = !!yr || (+a >= 1900 && +a <= 2099 && +b >= 1900 && +b <= 2099);
    return isYear ? `${readOut(a)}年到${readOut(b)}年` : `${readNumber(a)}到${readNumber(b)}`;
  });
  s = s.replace(/第\s*(\d+)\s*[-—–~～至到]\s*(\d+)\s*([章节卷回部篇])/g,
    (_, a, b, unit) => `第${readNumber(a)}${unit}到第${readNumber(b)}${unit}`);

  // ② 完整日期 2024-10-30 / 2024年10月30日
  s = s.replace(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?/g,
    (_, y, m, d) => `${readOut(y)}年${readNumber(m)}月${readNumber(d)}日`);

  // ③ 时段 10:30 / 10:30:20
  s = s.replace(/(\d{1,2}):(\d{2})(?::(\d{2}))?/g,
    (_, h, m, sec) => `${readNumber(h)}点${readNumber(m)}分${sec ? readNumber(sec) + "秒" : ""}`);

  // ④ 百分比、千分比
  s = s.replace(/(\d+(?:\.\d+)?)\s*[%％]/g, (_, n) => `百分之${readNumber(n)}`);
  s = s.replace(/(\d+(?:\.\d+)?)\s*‰/g, (_, n) => `千分之${readNumber(n)}`);

  // ⑤ 分数 1/3（分母在前读法）
  s = s.replace(/(\d+)\s*\/\s*(\d+)/g, (_, a, b) => `${readNumber(b)}分之${readNumber(a)}`);

  // ⑥ 金额
  s = s.replace(/[￥¥]\s*(\d+(?:\.\d+)?)/g, (_, n) => `${readNumber(n)}元`);
  s = s.replace(/(\d+(?:\.\d+)?)\s*元/g, (_, n) => `${readNumber(n)}元`);

  // ⑦ 年代 / 年份 / XX 后（用户踩过的坑：80后 被念成「八十后」）
  s = s.replace(/(\d{2})\s*(?=年代)/g, (_, n) => readOut(n));
  s = s.replace(/(?<![第\d])(\d{4})\s*(?=年(?![代级]))/g, (_, n) => readOut(n));
  s = s.replace(/(?<![第\d])(\d{2})\s*(?=[后前])/g, (_, n) => readOut(n));

  // ⑧ 编号：No.3 → 第三；长数字（电话/编号）逐字
  s = s.replace(/No\.?\s*(\d+)/gi, (_, n) => `第${readNumber(n)}`);
  s = s.replace(/\b\d{7,}\b/g, (n) => readOut(n));

  // ⑨ 单位
  for (const [re, cn] of UNITS) s = s.replace(re, cn);

  // ⑩ 残留小数
  s = s.replace(/(?<![\d.])(\d+)\.(\d+)(?![\d.])/g, (_, a, b) => `${toChineseInt(a)}点${readOut(b)}`);

  // ⑪ 数学/排版符号
  s = s.replace(/[×✕]/g, "乘").replace(/÷/g, "除以")
       .replace(/±/g, "正负").replace(/≈/g, "约等于")
       .replace(/[≥＞]=?/g, "大于等于").replace(/[≤＜]=?/g, "小于等于")
       .replace(/&/g, "和").replace(/→/g, "变成").replace(/[#~^*|\\_<>]/g, " ");

  // ⑫ 标点收敛：破折号/重复标点交给 TTS 只会被念出来
  s = s.replace(/[—–－]{2,}|—{1,}/g, "，")
       .replace(/[…]|\.{3,}/g, "…")
       .replace(/[。]{2,}/g, "。").replace(/[！!]{2,}/g, "！").replace(/[？?]{2,}/g, "？")
       .replace(/([，、,])\1+/g, "$1");
  // 括号：短注释保留内容，长注释整段删（读出来没人听得懂）
  s = s.replace(/[（(]([^（()）]{1,12})[）)]/g, "，$1，");
  s = s.replace(/[（(][^（()）]{13,}[）)]/g, "");
  s = s.replace(/[【\[]([^】\]]{1,20})[】\]]/g, "，$1，");

  // 空白与标点悬空
  s = s.replace(/\s+/g, " ").replace(/\s+([。，、；：！？…])/g, "$1").replace(/([，、；：])\s*([，、；：。！？])/g, "$2");
  if (!keepSpaces) s = collapseSpaces(s);
  s = s.replace(/[，、]{2,}/g, "，").replace(/^[，、；：\s]+/, "").replace(/[，、；：\s]+$/, "");
  return s.trim();
}

/** 中文字之间、数字与中文之间的空格，TTS 会在那里硬停顿。 */
function collapseSpaces(s) {
  return s.replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "$1")
    .replace(/(\d)\s+(?=[\u4e00-\u9fa5])/g, "$1")
    .replace(/([\u4e00-\u9fa5])\s+(?=\d)/g, "$1");
}

/** 按句切（保留标点），过长的句子再按逗号二级切，最后才硬切。 */
function splitSentences(line) {
  if (!line) return [];
  const parts = line.match(/[^。！？…；!?;]+[。！？…；!?;]*|[。！？…；!?;]+/g) || [line];
  const out = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (part.length <= PARA_HARD) { out.push(part); continue; }
    const clauses = part.match(/[^，、,]+[，、,]?|[，、,]+/g) || [part];
    let buf = "";
    for (const c of clauses) {
      if (buf.length + c.length > LIMIT && buf) { out.push(buf); buf = ""; }
      if (c.length > LIMIT) {
        if (buf) { out.push(buf); buf = ""; }
        const chars = Array.from(c);
        for (let i = 0; i < chars.length; i += LIMIT) out.push(chars.slice(i, i + LIMIT).join(""));
      } else buf += c;
    }
    if (buf) out.push(buf);
  }
  return out;
}

/** 语义分段：逐行按句累积，句子说完了就断开。 */
function splitParagraphs(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const out = [];
  for (const line of text.replace(/\r/g, "").split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
    let buf = "";
    for (const sent of splitSentences(line)) {
      // 先判断「加上下一句会不会超硬上限」：超了就把攒好的这段先吐出去。
      // 只在追加之后才检查的话，长句会被切出接近两倍上限的段落。
      if (buf && buf.length + sent.length > PARA_HARD) { out.push(buf); buf = ""; }
      buf += sent;
      const done = buf.length >= PARA_TARGET && /[。！？…；!?;]$/.test(buf);
      if (done || buf.length >= PARA_HARD) { out.push(buf); buf = ""; }
    }
    if (buf) out.push(buf);
  }
  return out;
}

// ── 章节 ──────────────────────────────────────────────────────────────

/**
 * 章节标题判定。只认强模式，宁可漏也不要误判 ——
 * 正文里「他说第一章写得不好」这种行内提及不算，纯数字行（「1」）也不算：
 * 后者在正文里太常见，认成标题会把书切碎成几百「章」。
 * 标题本身不会很长，超过 40 字的一律当正文。
 */
// 真实小说的标题写法比「第X章」杂得多：多卷本常用「卷一」不带「第」，
// 中文小说有「楔子 / 序章 / 尾声」，英文有「Part I / Prologue」。
// 这些都按平铺一层处理（PRD 明确不做卷→章嵌套）。
const CHAPTER_RE = new RegExp(
  "^(?:" +
    "第\\s*[0-9零一二三四五六七八九十百千两]+\\s*[章节卷回部篇]" +   // 第一章 / 第3卷
    "|[卷章][\\s　]*[0-9零一二三四五六七八九十百千两]+" +            // 卷一 / 章三
    "|chapter\\s+[0-9ivxlc]+|part\\s+[0-9ivxlc]+" +                   // Chapter 12 / Part I
    "|prologue|epilogue|interlude" +
    "|楔子|序章|引子|尾声|终章|后记" +
  ")",
  "i"
);
const CHAPTER_TITLE_MAX = 40;

function isChapterTitle(text) {
  const s = String(text || "").trim();
  if (!s || s.length > CHAPTER_TITLE_MAX) return false;
  const m = s.match(CHAPTER_RE);
  if (!m) return false;
  const rest = s.slice(m[0].length);
  // 章号后面直接结束，或跟分隔符/空白 —— 标准标题写法（「第一章」「第一章 潮汐」「第一章：潮汐」）
  if (!rest || /^[\s　:：·、.\-—()（）【】\[\]]/.test(rest)) return true;
  // 紧凑写法（「第一章潮汐」）也认，但必须是短标题且不带标点。
  // 这一条是为了挡住「第一章写得不好，我读不下去。」这类以章号开头的正文句子 ——
  // 光有 ^ 锚不够，它会整段命中。
  return rest.length <= 8 && !/[。！？；，,…]/.test(s);
}

/**
 * 给段落标章号，并返回章节表。
 * 章节标题在分段时天然独立成段，所以这里只看每段文本，不重写正文解析。
 * 第一章之前的引言段落 chapter 为 -1（没有归属）。
 */
function markChapters(paragraphs) {
  const chapters = [];
  let current = -1;
  const marked = (Array.isArray(paragraphs) ? paragraphs : []).map((p, i) => {
    if (isChapterTitle(p.text)) {
      current = chapters.length;
      chapters.push({ index: current, title: String(p.text).trim().slice(0, CHAPTER_TITLE_MAX), startParagraph: i });
    }
    return { ...p, chapter: current };
  });
  return { paragraphs: marked, chapters };
}

// ── 多角色 ────────────────────────────────────────────────────────────

/**
 * 音色池。instruct 走 Qwen3-TTS VoiceDesign，是「描述」不是「音色 ID」，
 * 所以同一池子里的人听起来会明显不同；旁白不在此列，用她自己当前形态的声音。
 *
 * 这些措辞是实测过的（2026-10-31，Qwen3-TTS-1.7B-VD，同一句话的基频中位数）：
 *   f1 251Hz / f3 198Hz / f2 170Hz / m3 143Hz / m1 106Hz / m2 79Hz / child 375Hz
 * 旁白约 218Hz。同一段描述重复合成结果是逐字节一致的，所以角色音色不会中途换人；
 * 换句子音高只浮动 ±8%。改描述前请重新量一遍，别把两个角色写成同一个声音。
 */
const VOICE_POOL = {
  f1: { label: "清亮少女", pitch: 251, instruct: "A young woman in her early twenties, bright clear light voice, lively and quick, playful smile in the tone." },
  f2: { label: "沉稳女声", pitch: 170, instruct: "A mature woman in her late forties, noticeably lower pitch, warm and grounded, slightly husky, slow and steady." },
  f3: { label: "冷冽女声", pitch: 198, instruct: "A cool, low-pitched young assertive woman, precise clipped speech, restrained, faintly aloof." },
  m1: { label: "清朗男声", pitch: 106, instruct: "A clear young male voice, mid pitch, calm and steady, friendly but reserved." },
  m2: { label: "低沉男声", pitch: 79, instruct: "A deep, low adult male voice, slow deliberate pace, resonant, with quiet authority." },
  m3: { label: "少年音", pitch: 143, instruct: "A boy around fifteen, mid-high male pitch, cracking slightly, impatient and quick." },
  old: { label: "苍老声音", pitch: 95, instruct: "An old man in his seventies, low gravelly voice, slightly hoarse, measured unhurried pace, quiet and tired." },
  child: { label: "童声", pitch: 375, instruct: "A six year old girl, very high tiny voice, simple and direct, slightly lisping." },
};

const FEMALE_HINT = /[姐母女妃娘姑婆姨婶嫂妹她婷芳娜莉琳瑶静雯雅雪柔月荷莲霞雁薇婉姬姝妍颜蓉琴珍玲洁琪琦珊妮媛缇纭]|太太|夫人|姑娘|小姐/;
const MALE_HINT = /[哥弟父爷伯叔舅他强军刚波伟磊峰涛勇豪杰斌宇轩然鹏辉毅晨阳浩郎砚舟川野戈]|先生|老板|师父|老师傅/;
const OLD_HINT = /[爷奶翁姥婆]|老头|老太|老先|师父|^老(?!婆|板|虎|鼠|百姓|外|天|娘)/;
const CHILD_HINT = /[童儿娃]|小孩|孩子|宝宝/;

/**
 * 给一个角色名挑音色。第一次见到就固定下来，之后不再变。
 * 性别优先信「书里用哪个代词称呼他」——那是真实证据；其次才看名字用字。
 */
/**
 * 这个角色该用男声还是女声。
 * 大模型分析出的性别最可信，其次是书里用哪个代词称呼他，最后才看名字用字。
 * 都判不出来就空着 —— 之后代词归属宁可退回通用音色，也不要把一个男角色叫成「她」。
 */
function voiceGender(name, votes, cast) {
  const g = cast && cast[name] && cast[name].gender;
  if (g === "male") return "m";
  if (g === "female") return "f";
  const v = votes && votes[name];
  if (v && v.f !== v.m) return v.f > v.m ? "f" : "m";
  const hf = FEMALE_HINT.test(name), hm = MALE_HINT.test(name);
  if (hf && !hm) return "f";
  if (hm && !hf) return "m";
  return "";
}

function genderFits(name, female, votes, cast) {
  const g = voiceGender(name, votes, cast);
  return !!g && g === (female ? "f" : "m");
}

const POOL_KEYS = ["f1", "f2", "f3", "m1", "m2", "m3", "old", "child"];

/**
 * 给一个角色名挑音色。第一次见到就固定下来，之后不再变。
 * 分配顺序：性别对得上的先给，池子用完就同性别内轮换 —— 男配女比撞声音更难听。
 */
function pickVoice(name, taken, votes, cast) {
  const free = (k) => !taken || !taken.has(k);
  const g = voiceGender(name, votes, cast);
  const order = [];
  if (OLD_HINT.test(name)) order.push("old");
  else if (CHILD_HINT.test(name)) order.push("child");
  else if (g === "f") order.push("f2", "f3", "f1");
  else if (g === "m") order.push("m1", "m2", "m3");
  else order.push("f1", "m1", "f2", "m2", "f3", "m3");
  order.push(...POOL_KEYS);
  const hit = order.find(free);
  if (hit) return hit;
  const same = g === "f" ? ["f1", "f2", "f3"] : g === "m" ? ["m1", "m2", "m3"] : POOL_KEYS;
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return same[h % same.length];
}

const QUOTE_RE = /[“「『]([^”」』]{1,300})[”」』]/g;
// 名字和说话动词之间常夹副词（「老陈又问了一遍」「她才说道」）。
// 这些副词必须落在捕获组**外面**：放在里面的话，非贪婪匹配为满足后面的动词
// 会一路回溯把它们吞进名字，凭空认出「老陈又」这种不存在的角色。
const SAY_ADVERB = "又|也|便|却|就|才|还|都|只|再|忽|突|终|于|是|立马|赶忙|连忙|随即|于是|然后|接着|忽然|突然|终于|只是|可是|但是|而且|因为|所以";
const SAY_AFTER_RE = new RegExp(
  "^[。，,]?\\s*([\\u4e00-\\u9fa5]{1,4}?)" +
  "(?:轻声|低声|大声|冷冷地|淡淡地|笑着|苦笑|冷笑|喃喃|嘀咕|" + SAY_ADVERB + ")*" +
  "(?:说|道|问|答|喊|叫|嚷|吼|笑|应|嘟囔|反驳|补充)"
);
const SAY_BEFORE_RE = /([\u4e00-\u9fa5]{1,4}?)(?:轻声|低声|冷冷地|淡淡地|笑着|叹气)?(?:说|道|问|答|喊|叫|吩咐|解释)\s*[:：]\s*$/;
const NOT_NAME = /^(?:他|她|它|我|你|我们|他们|她们|自己|大家|众人|有人|那人|这人|男人|女人|少年|少女|老人|孩子|对方|两人|二人|一人|所有人|随即|于是|然后|接着|忽然|突然|终于|只是|可是|但是|而且|因为|所以)$/;

// 「X 做了点什么：“……”」这种没有「说」字的写法，靠句末冒号认主语。
// 冒号前整段汉字都抓下来，再从中挑已知角色里最长的那个（避免「克里斯」被切成「克里」）。
const CLAUSE_SUBJECT_RE = /^([\u4e00-\u9fa5]{2,12})[：:]\s*$/;

/**
 * 取最后一个断句之后的部分，再从里面认主语。
 * 「克里斯笑了笑：」不能认成「克里」——已知角色里最长的那个才算数。
 */
function clauseSubject(before, known) {
  const tail = String(before || "").replace(/[\s\S]*[。！？；\n“”"]/, "").trim();
  const m = tail.match(CLAUSE_SUBJECT_RE);
  if (!m) return "";
  const head = m[1];
  let best = "";
  if (known) {
    for (const name of known) {
      if (head.startsWith(name) && name.length > best.length) best = name;
    }
  }
  if (best) return best;
  const short = head.match(/^([\u4e00-\u9fa5]{2,3}?)/);
  const name = short ? short[1] : "";
  if (NAME_STOP.test(name) || NOT_NAME.test(name) || COMMON_WORDS.has(name)) return "";
  return name;
}

/** 这个角色的性别提示。代词票最可信，其次才看名字用字。 */

// 句首 + 动词 = 疑似人名。「林夏站在窗边」「周砚推开门」都是这个形状。
const NAME_SLOT_RE = /(?:^|[。！？；\n“”"])\s*([\u4e00-\u9fa5]{2,3}?)(?=[说道问答喊叫笑看站走跑坐躺推抬低皱叹愣转点摇想听望盯握把将被从在已没不也都就还又便却])/g;
const NAME_STOP = /[的了在是有不没也都就还又便却很把被从向对与及等过说这那我你他她它们个些么之乎者也]/;
const COMMON_WORDS = new Set(["声音", "空气", "时候", "地方", "东西", "心里", "眼里", "脸上", "手里", "身上", "外面", "里面", "远处", "周围", "眼前", "身后", "桌上", "门口", "窗外", "天空", "海风", "夜色", "阳光", "雨水", "目光", "嘴角", "肩膀", "世界", "时间", "一切", "什么", "怎么", "为什", "虽然", "如果", "只是", "于是", "然后", "接着", "可是", "但是"]);

/**
 * 从全书正文里捞出重复出现的疑似人名。
 * 只出现一次的多半是普通短语（「海风灌进来」），要求出现 ≥2 次才算角色。
 */
function collectNames(text) {
  const tally = new Map();
  let m;
  NAME_SLOT_RE.lastIndex = 0;
  while ((m = NAME_SLOT_RE.exec(text))) {
    const name = m[1];
    if (!name || NAME_STOP.test(name) || NOT_NAME.test(name) || COMMON_WORDS.has(name)) continue;
    tally.set(name, (tally.get(name) || 0) + 1);
  }
  return new Set([...tally.entries()].filter(([, n]) => n >= 2).map(([name]) => name));
}

/**
 * 把一段文字切成 [{who, say}]。
 * who === 'narr' 表示旁白（用她自己的声音）；其余是角色名。
 * 识别不到说话人就退回旁白 —— 宁可听不出角色，也不要张冠李戴。
 *
 * ctx 是全书上下文：{ known:Set<角色名>, lastNamed:string }。
 * 「她/他」这类代词靠旁白里最近出现过的角色名落地，
 * 否则男女主角会被拆成四个声音。
 */
function splitScript(paragraph, ctx) {
  const book = ctx || {};
  const known = book.known instanceof Set && book.known.size ? book.known : null;
  const votes = book.votes || null;
  const cast = book.cast || null;
  // 最近被提到过的角色，末尾是最近的。代词「她/他」从这里倒着找性别对得上的那个，
  // 不至于落到上一句刚开口的异性身上。
  const recent = Array.isArray(book.recent) ? book.recent : [];
  const remember = (name) => {
    if (!name) return;
    const at = recent.indexOf(name);
    if (at > -1) recent.splice(at, 1);
    recent.push(name);
    if (recent.length > 8) recent.shift();
  };
  let lastNamed = book.lastNamed || "";
  // 最近一次开口的人。段内跟着走，跨段由 book 带过来 —— 旁白不会把它清空，
  // 所以「“……。”他把缸子放下，“……”」后半句还是同一个人在说。
  let lastSpeaker = book.lastSpeaker || "";
  const text = String(paragraph || "");
  if (!text.trim()) return [];
  const segs = [];
  const push = (who, say) => {
    // 旁白以冒号收尾时（「周砚把伞收起来：」后面紧跟对白），冒号念出来很怪
    const clean = collapseSpaces(say.trim()).replace(/[：:]\s*$/, "");
    if (!clean || !/[\u4e00-\u9fa5A-Za-z0-9]/.test(clean)) return;
    for (const piece of splitSentences(clean)) {
      const last = segs[segs.length - 1];
      if (last && last.who === who && (last.say.length + piece.length) <= LIMIT) last.say += piece;
      else segs.push({ who, say: piece });
    }
  };
  /** 旁白里「最后被提到」的角色名 —— 按文本位置取最靠后的，不是按集合顺序。 */
  const nearestName = (narration) => {
    if (!known || !narration) return null;
    let best = null, bestAt = -1;
    for (const name of known) {
      const at = narration.lastIndexOf(name);
      if (at > bestAt) { bestAt = at; best = name; }
    }
    return best && bestAt > -1 ? { name: best, at: bestAt } : null;
  };
  const noteNames = (narration) => {
    const hit = nearestName(narration);
    if (hit) { lastNamed = hit.name; remember(hit.name); }
  };
  const vote = (name, gender) => {
    if (!votes) return;
    votes[name] = votes[name] || { f: 0, m: 0 };
    votes[name][gender]++;
  };
  /**
   * 引号后面紧跟的旁白里出现了谁 —— 「“慢一点？”林夏转过身」这种，
   * 说话人写在动作里而不是「某某说」里。只看引号后到第一个句号为止。
   */
  const postName = (afterText) => {
    if (!known) return "";
    const head = String(afterText || "").split(/[。！？；\n]/)[0].slice(0, 18);
    if (!head) return "";
    let best = "", bestAt = -1;
    for (const name of known) {
      const at = head.indexOf(name);
      if (at > -1 && (bestAt === -1 || at < bestAt)) { bestAt = at; best = name; }
    }
    return best;
  };
  /** 整段就只有这一句对白（连「某某说」都没有）——换行通常表示同一人继续说。 */
  const isBareQuote = (para, quote) => {
    const stripped = String(para || "").trim().replace(/[.,，。！？…]/g, "");
    return stripped.replace(/[“「『”」』"']/g, "") === quote.replace(/[.,，。！？…]/g, "").replace(/[“「『”」』"']/g, "");
  };
  let cursor = 0;
  let m;
  QUOTE_RE.lastIndex = 0;
  while ((m = QUOTE_RE.exec(text))) {
    const before = text.slice(cursor, m.index);
    const quote = m[1];
    const after = text.slice(m.index + m[0].length);
    noteNames(before);
    push("narr", before);
    let who = "narr";
    const afterName = (after.match(SAY_AFTER_RE) || [])[1];
    const beforeName = (before.match(SAY_BEFORE_RE) || [])[1];
    const cand = afterName || beforeName || "";
    if (cand && !NOT_NAME.test(cand)) who = cand;
    else if (/^(他|那人|男人|少年)$/.test(cand)) who = "他";
    else if (/^(她|女人|少女)$/.test(cand)) who = "她";
    else {
      // 没有「某某说」，按可信度依次找线索
      const subject = clauseSubject(before, known);
      const post = postName(after);
      const near = nearestName(before.slice(-40));
      const pronoun = (after.match(/^[。，,]?\s*(她|他)/) || [])[1];
      if (subject) who = subject;
      else if (post) who = post;
      else if (near) who = near.name;
      // 「我从来不后悔。」她把盒子藏在身后 —— 言说标记没了，只剩代词
      else if (pronoun) who = pronoun;
      // 沿用上一个人。两个前提：最近确实有人在说话，且本句不是「换行=换人」的段首。
      // 整段只有一句光秃秃的对白时允许沿用 —— 那是小说里同一人继续说的写法。
      else if (lastSpeaker && (m.index > 0 || isBareQuote(text, quote))) who = lastSpeaker;
    }
    if (who === "他" || who === "她") {
      const female = who === "她";
      // 从最近提过的人里倒着找性别对得上的；一个都配不上就退回通用音色，不硬套
      const hit = [...recent].reverse().find((n) => genderFits(n, female, votes, cast))
        || (genderFits(lastNamed, female, votes, cast) ? lastNamed : "");
      if (hit) { vote(hit, female ? "f" : "m"); who = hit; }
      else who = female ? "女声" : "男声";
    }
    if (who !== "narr") { lastNamed = who; lastSpeaker = who; remember(who); }
    push(who, quote);
    cursor = m.index + m[0].length;
  }
  noteNames(text.slice(cursor));
  push("narr", text.slice(cursor));
  if (book) {
    book.lastNamed = lastNamed;
    // 整段都是旁白说明对话断了，之后的裸对白不该再沿用上一人
    book.lastSpeaker = segs.some((s) => s.who !== "narr") ? lastSpeaker : "";
  }
  return segs;
}

/** 全书角色表：{ 角色名: { voice, label } }。按出场顺序分配，稳定不漂。 */
function buildCast(chapters, known, votes) {
  const order = [];
  const seen = new Set();
  const ctx = { known: known || null, votes: votes || null, lastNamed: "" };
  for (const para of chapters) {
    for (const seg of splitScript(para, ctx)) {
      if (seg.who === "narr" || seen.has(seg.who)) continue;
      seen.add(seg.who);
      order.push(seg.who);
      if (order.length >= 12) break;
    }
    if (order.length >= 12) break;
  }
  const cast = {};
  const taken = new Set();
  const fallbacks = ["女声", "男声"];
  for (const name of order.filter((n) => !fallbacks.includes(n))) {
    const voice = pickVoice(name, taken, votes);
    taken.add(voice);
    cast[name] = { voice, label: VOICE_POOL[voice].label };
  }
  for (const name of order.filter((n) => fallbacks.includes(n))) {
    const voice = name === "女声" ? "f1" : "m1";
    cast[name] = { voice, label: VOICE_POOL[voice].label };
  }
  return cast;
}

/**
 * 用一份外部角色表重切段落。分析出的名字（含别名）进入 known，
 * 之后「老陈」「陈叔」都能被认出来，代词也能落到具体的人身上。
 */
function applyCast(paragraphs, cast) {
  const known = new Set(Object.keys(cast || {}).filter((n) => n && !NOT_NAME.test(n)));
  const ctx = { known, votes: null, cast, recent: [], lastNamed: "", lastSpeaker: "" };
  return paragraphs.map((p) => {
    const segments = splitScript(p.text, ctx);
    // 段落被重建时章号要跟着走，否则模型分析完成后目录就没了
    return { text: p.text, segments: segments.length ? segments : [{ who: "narr", say: collapseSpaces(p.text) }], chapter: p.chapter };
  });
}

/**
 * 整本书 → 朗读稿。paragraphs[i] = { text（展示用）, segments（合成用） }
 *
 * mode: 'live' 实时阅读（不分角色，整段她自己的声音，导入即读）
 *       'studio' 精读配音（分角色；cast 可由大模型分析给出，没有就用规则推断）
 */
function buildBook(rawText, opts = {}) {
  const text = ebookText(rawText);
  const mode = opts.mode === "live" ? "live" : opts.multiVoice === false ? "live" : "studio";
  // 章节标题必须在读音规范化之前认出来并保留原文：toSpeech 会把「1984」念成「一九八四」、
  // 把括号改成逗号，直接拿规范化后的文本当标题，目录里就是「第一章 一九八四年，上」。
  const rawParas = splitParagraphs(text);
  const rawMarks = markChapters(rawParas.map((t) => ({ text: t })));
  const chapterOf = rawMarks.paragraphs.map((p) => p.chapter);
  const spoken = rawParas.map((para) => toSpeech(para, true)).filter(Boolean);
  // 段号与章号靠索引对齐。万一规范化把某段变成空串被滤掉，长度就对不上，
  // 这时退回按规范化文本重算 —— 标题可能变形，但章节索引不会指向错地方。
  const aligned = spoken.length === rawParas.length;
  // 章节跟着段落走。三个出口都要带上 —— 漏一个就会出现「有的书有目录、有的没有」。
  const finish = (paragraphs, cast, m) => {
    const marked = paragraphs.map((p, i) => ({ ...p, chapter: aligned ? chapterOf[i] : -1 }));
    return {
      paragraphs: marked,
      chapters: aligned ? rawMarks.chapters : markChapters(paragraphs).chapters,
      cast, mode: m,
    };
  };
  if (mode === "live") {
    const paragraphs = spoken.map((t) => ({ text: t, segments: [{ who: "narr", say: collapseSpaces(t) }] }));
    return finish(paragraphs, {}, "live");
  }
  if (opts.cast && Object.keys(opts.cast).length) {
    const base = spoken.map((t) => ({ text: t, segments: [{ who: "narr", say: collapseSpaces(t) }] }));
    return finish(applyCast(base, opts.cast), opts.cast, "studio");
  }
  // 第一遍：句首动词槽 + 对话归属，两边一起捞真实角色名
  const known = collectNames(spoken.join("\n"));
  for (const para of spoken) {
    for (const seg of splitScript(para)) {
      if (seg.who !== "narr" && seg.who !== "他" && seg.who !== "她" &&
          seg.who !== "女声" && seg.who !== "男声") known.add(seg.who);
    }
  }
  // 第二遍：带着角色表重切，代词才能落到具体的人
  const votes = {};
  const ctx = { known, votes, recent: [], lastNamed: "" };
  const paragraphs = spoken.map((t) => {
    const segments = splitScript(t, ctx);
    return { text: t, segments: segments.length ? segments : [{ who: "narr", say: t }] };
  });
  const cast = buildCast(spoken, known, votes);
  return finish(paragraphs, cast, "studio");
}

module.exports = {
  toSpeech, collapseSpaces, splitParagraphs, splitScript, buildBook, buildCast, collectNames,
  applyCast, markChapters, isChapterTitle,
  toChineseInt, readNumber, splitSentences,
  VOICE_POOL, LIMIT, PARA_TARGET, PARA_HARD, NOT_NAME,
};
