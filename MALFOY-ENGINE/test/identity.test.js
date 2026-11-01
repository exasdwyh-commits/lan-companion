"use strict";
// 一个身份的测试：两形态的 system prompt 必须共享同一段身份，
// 只允许「此刻」语气段不同。共用的身份段一旦被形态污染，记忆就会开始分叉。
// 运行：node --test MALFOY-ENGINE/test/*.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const IDENTITY = require("../lib/identity");

const PERSONA = {
  name: "深蓝",
  system: "你是桌面宠物「深蓝」，住在屏幕里的鲸鱼少女。回复开头带 [emo:calm]。",
  voiceProfiles: {
    world: { label: "她的世界", instruct: "cool elegant quiet voice" },
    desktop: { label: "你的世界", instruct: "bright playful chibi voice" },
  },
};

test("两形态的身份段逐字节相同", () => {
  const a = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "world", memory: "" });
  const b = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "desktop", memory: "" });
  const core = IDENTITY.identityCore(PERSONA);
  assert.ok(a.startsWith(core), "她的世界应以身份段开头");
  assert.ok(b.startsWith(core), "你的桌面也应从同一段身份开头");
  assert.equal(a.slice(0, core.length), b.slice(0, core.length), "身份段不许有形态差异");
});

test("两形态确实不同，差异只出现在身份段之后", () => {
  const a = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "world", memory: "" });
  const b = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "desktop", memory: "" });
  const core = IDENTITY.identityCore(PERSONA);
  assert.notEqual(a, b, "两个形态的 prompt 不该一模一样");
  assert.equal(a.slice(0, core.length), b.slice(0, core.length));
  // 差异段里不许重新定义身份
  const tailD = b.slice(core.length);
  assert.ok(!/你是(桌面|一只|另一个)/.test(tailD), "语气段不许另立身份");
});

test("记忆段接在最后，不会挤进身份段", () => {
  const mem = "\n【你记得的最近对话】\n- 你说：我叫小林";
  const a = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "world", memory: mem });
  const core = IDENTITY.identityCore(PERSONA);
  assert.ok(a.startsWith(core));
  assert.ok(a.endsWith("我叫小林"), "记忆应在末尾");
});

test("persona 缺失时用兜底身份，且兜底里没有旧角色名", () => {
  const core = IDENTITY.identityCore({});
  assert.equal(core, IDENTITY.DEFAULT_CORE);
  assert.ok(core.length > 20);
  assert.ok(!/malfoy|马尔福/i.test(core), "兜底身份不该残留旧角色");
  const p = IDENTITY.buildSystemPrompt({ persona: null, mode: "desktop", memory: "" });
  assert.ok(p.startsWith(IDENTITY.DEFAULT_CORE));
});

// ── 可选段：性格（soul）/ 位置（place） ────────────────────────────
// 这两段都是「后加的旁注」。它们不许改动身份段，也不许在两个形态之间分叉 ——
// 她有两个形态，但不是两个灵魂。

test("三个可选段都为空时，输出与没有这些参数时逐字节相同", () => {
  const a = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "world", memory: "M" });
  const b = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "world", memory: "M", soul: "" });
  const c = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "world", memory: "M", soul: "  ", place: "   " });
  assert.equal(a, b);
  assert.equal(a, c);
});

test("性格段在身份段之后、此刻段之前，且两形态共用同一份", () => {
  const soul = "你的性情偏向温柔、好奇。";
  const w = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "world", memory: "", soul });
  const d = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "desktop", memory: "", soul });
  const core = IDENTITY.identityCore(PERSONA);
  assert.ok(w.startsWith(core));
  assert.ok(w.indexOf("【你的性格】") > core.length, "性格段要接在身份段之后");
  assert.ok(w.indexOf("【你的性格】") < w.indexOf("【此刻】"), "性格段在此刻段之前");
  // 性格段本身不许随形态变化
  const slice = (t) => t.slice(t.indexOf("【你的性格】"), t.indexOf("【此刻】"));
  assert.equal(slice(w), slice(d));
});

test("位置段紧贴此刻段，且在记忆段之前", () => {
  const place = "【你此刻在哪】\n- 屏幕 1440×900，你在屏幕左侧偏下。";
  const p = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "desktop", memory: "【记忆】X", place });
  assert.ok(p.indexOf("【此刻】") < p.indexOf("【你此刻在哪】"));
  assert.ok(p.indexOf("【你此刻在哪】") < p.indexOf("【记忆】X"));
  assert.ok(p.startsWith(IDENTITY.identityCore(PERSONA)));
});


test("没有配置音色时，两形态的默认音色也必须不同", () => {
  assert.equal(IDENTITY.voicesDiffer({}), true, "空 persona 也不能两形态同一条音色");
  assert.notEqual(IDENTITY.DEFAULT_VOICE.world, IDENTITY.DEFAULT_VOICE.desktop);
});

test("只配了 world 音色时，desktop 不许回落成同一条", () => {
  const p = { ttsInstruct: "one single voice" };
  const w = IDENTITY.voiceProfile(p, "world");
  const d = IDENTITY.voiceProfile(p, "desktop");
  assert.equal(w.instruct, "one single voice", "world 应优先用 persona.ttsInstruct");
  assert.notEqual(d.instruct, w.instruct, "desktop 不能跟 world 用同一条");
  assert.equal(IDENTITY.voicesDiffer(p), true);
});

test("data.js 配了 voiceProfiles 时按形态取，标签与来源可追溯", () => {
  const w = IDENTITY.voiceProfile(PERSONA, "world");
  const d = IDENTITY.voiceProfile(PERSONA, "desktop");
  assert.equal(w.instruct, "cool elegant quiet voice");
  assert.equal(d.instruct, "bright playful chibi voice");
  assert.equal(w.label, "她的世界");
  assert.equal(d.label, "你的世界");
  assert.equal(w.source, "data.js");
});

test("未知形态当作她的世界，不会掉进空音色", () => {
  const x = IDENTITY.voiceProfile(PERSONA, "noon");
  assert.equal(x.mode, "world");
  assert.ok(x.instruct.length > 0);
  const s = IDENTITY.buildSystemPrompt({ persona: PERSONA, mode: "noon", memory: "" });
  assert.ok(s.includes(IDENTITY.MODE_TONE.world));
});
