"use strict";
// 精读模式的「导演」测试：不联网。重点验证 JSON 解析的健壮性和音色分配不撞车。
// 运行：node --test MALFOY-ENGINE/test/book-analysis.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const BA = require("../lib/book-analysis");
const N = require("../lib/narration");

const JSON_REPLY = '```json\n{"isFiction":true,"characters":[' +
  '{"name":"周砚","gender":"male","age":"middle","aliases":["老周"],"note":"沉稳"},' +
  '{"name":"林夏","gender":"female","age":"young","aliases":[],"note":""},' +
  '{"name":"老陈","gender":"male","age":"old","aliases":["陈叔","陈老板"],"note":"店主"}],' +
  '"terms":[{"from":"砚","to":"艳"}]}\n```';

test("能从带围栏、带前言的回复里抠出 JSON", () => {
  const parsed = BA.parseAnalysis(`好的，我看看。\n${JSON_REPLY}\n需要别的再告诉我。`);
  assert.ok(parsed.ok);
  assert.equal(parsed.isFiction, true);
  assert.deepEqual(parsed.characters.map((c) => c.name), ["周砚", "林夏", "老陈"]);
  assert.deepEqual(parsed.characters[2].aliases, ["陈叔", "陈老板"]);
});

test("坏 JSON 与空回复都判失败，不抛异常", () => {
  assert.equal(BA.parseAnalysis("").ok, false);
  assert.equal(BA.parseAnalysis("我不知道").ok, false);
  assert.equal(BA.parseAnalysis("{\"isFiction\":").ok, false);
  // 尾逗号这种常见手误要能救回来
  assert.ok(BA.parseAnalysis('{"isFiction":true,"characters":[{"name":"甲","gender":"male",}]}').ok);
});

test("角色表归一化：非法取值归 unknown，重复名与代词丢掉", () => {
  const chars = BA.normalizeCharacters([
    { name: "周砚", gender: "男的", age: "中年" },      // 非法值 → unknown
    { name: "周砚", gender: "male", age: "young" },      // 重复 → 丢
    { name: "她", gender: "female", age: "young" },      // 代词 → 丢
    { name: "", gender: "male" },                        // 空名 → 丢
    { name: "林夏", gender: "female", age: "young", aliases: ["林夏", ""] },
  ]);
  assert.deepEqual(chars.map((c) => c.name), ["周砚", "林夏"]);
  assert.equal(chars[0].gender, "unknown");
  assert.equal(chars[0].age, "unknown");
  assert.deepEqual(chars[1].aliases, []);
});

test("音色按性别与年龄分配，别名共用同一个音色", () => {
  const cast = BA.assignVoices(BA.normalizeCharacters([
    { name: "周砚", gender: "male", age: "young" },
    { name: "林夏", gender: "female", age: "young" },
    { name: "老陈", gender: "male", age: "old", aliases: ["陈叔"] },
    { name: "小豆", gender: "female", age: "child" },
  ]));
  assert.equal(cast["周砚"].voice, "m1");
  assert.equal(cast["林夏"].voice, "f2");
  assert.equal(cast["老陈"].voice, "old");
  assert.equal(cast["小豆"].voice, "child");
  assert.equal(cast["陈叔"].voice, cast["老陈"].voice, "别名必须和本名同一个声音");
  assert.equal(cast["陈叔"].aliasOf, "老陈");
  // 场上不能有两人共用同一音色
  const voices = ["周砚", "林夏", "老陈", "小豆"].map((n) => cast[n].voice);
  assert.equal(new Set(voices).size, voices.length, JSON.stringify(cast));
});

test("同性别角色多了会在同性音色里轮换，不会全挤一个", () => {
  const cast = BA.assignVoices([
    { name: "甲", gender: "female", age: "young" },
    { name: "乙", gender: "female", age: "young" },
    { name: "丙", gender: "female", age: "young" },
  ]);
  const voices = ["甲", "乙", "丙"].map((n) => cast[n].voice);
  assert.equal(new Set(voices).size, 3, JSON.stringify(cast));
  for (const v of voices) assert.ok(/woman|female/.test(N.VOICE_POOL[v].instruct), `${v}: ${N.VOICE_POOL[v].instruct}`);
});

test("analyze：模型给什么就解析什么，并带上来源", async () => {
  const r = await BA.analyze({
    title: "潮汐书店",
    text: "正文".repeat(200),
    request: async () => ({ ok: true, text: JSON_REPLY, via: "deepseek" }),
  });
  assert.ok(r.ok);
  assert.equal(r.via, "deepseek");
  assert.equal(r.cast["老陈"].voice, "old");
  assert.ok(r.cast["陈叔"], "别名要进 cast");
});

test("analyze：模型不可用 / 返回空 / 没注入通道，一律失败且不抛", async () => {
  const cases = [
    { request: async () => ({ ok: false, text: "" }) },
    { request: async () => ({ ok: true, text: "" }) },
    { request: async () => { throw new Error("boom"); } },
    {},
  ];
  for (const extra of cases) {
    const r = await BA.analyze({ title: "x", text: "正文", ...extra });
    assert.equal(r.ok, false, JSON.stringify(extra));
    assert.ok(r.error);
  }
});

test("样本按段落边界截断，不会切在句子中间", () => {
  const text = Array.from({ length: 400 }, (_, i) => `第${i}行的内容，说完了。`).join("\n");
  const sample = BA.sampleText(text, 500);
  assert.ok(sample.length <= 500);
  assert.ok(sample.endsWith("。") || sample.length === 500, JSON.stringify(sample.slice(-20)));
});

test("提示词里带书名和样本，并要求严格 JSON", () => {
  const msgs = BA.buildMessages("潮汐书店", "周砚推开门。");
  const body = JSON.stringify(msgs);
  assert.ok(body.includes("潮汐书店"));
  assert.ok(body.includes("周砚推开门"));
  assert.ok(body.includes("只输出这样的 JSON"));
  assert.ok(body.includes("aliases"));
});

test("分析出的角色表能让规则层认出别名，并纠正代词归属", () => {
  const book = [
    "“把它给我。”克里斯说。",
    "“不给。”安妮抱紧了盒子。",
    "克里斯笑了笑：“你会后悔的。”",
    "“我从来不后悔。”她把盒子藏在身后。",
  ].join("\n");
  const rule = N.buildBook(book, { mode: "studio" });
  // 规则层认不出外国音译名的性别，会退回通用音色
  assert.ok(rule.paragraphs[3].segments.every((s) => s.who === "narr" || s.who === "女声"),
    JSON.stringify(rule.paragraphs[3].segments));

  const cast = {
    克里斯: { voice: "m1", label: "清朗男声", gender: "male" },
    安妮: { voice: "f2", label: "沉稳女声", gender: "female" },
  };
  const up = N.applyCast(rule.paragraphs, cast);
  const said = up.flatMap((p) => p.segments).filter((s) => s.who !== "narr");
  assert.ok(said.some((s) => s.who === "安妮"), JSON.stringify(said));
  assert.ok(said.every((s) => s.who !== "女声"), "有了角色表就不该再退回通用音色");
  // 「克里斯笑了笑：」的主语不能被切成「克里」
  assert.ok(!said.some((s) => s.who === "克里"), JSON.stringify(said));
});

test("实时阅读：整段一个人念，不切角色", () => {
  const text = [
    "周砚推开门。林夏站在窗边。",
    "“你终于来了。”她说。",
    "周砚把伞收起来：“路上堵了。”",
  ].join("\n");
  const live = N.buildBook(text, { mode: "live" });
  assert.equal(live.mode, "live");
  assert.deepEqual(live.cast, {});
  assert.ok(live.paragraphs.length >= 3);
  for (const p of live.paragraphs) {
    assert.equal(p.segments.length, 1);
    assert.equal(p.segments[0].who, "narr");
    assert.equal(p.segments[0].say, N.collapseSpaces(p.text));
  }
});

test("精读模式默认仍走规则推断（没有分析也能读）", () => {
  const studio = N.buildBook("周砚推开门。“你来了。”他说。\n“嗯。”她说。", { mode: "studio" });
  assert.equal(studio.mode, "studio");
  assert.ok(Object.keys(studio.cast).length > 0);
});

// 只送开头 6000 字的话，第三章才登场的主角永远认不出来。
// 现在按块往后多看几块，每块带上已认出的名字，只让模型补新的。
test("长文按块增量分析，后出场角色也能认出，别名跨块合并", async () => {
  const A = require("../lib/book-analysis");
  const chapter = (n) => `第${n}章\n${"内容。".repeat(1200)}\n`;
  const text = chapter("一") + chapter("二") + chapter("三");
  assert.ok(text.length > A.MAX_SAMPLE, "样本要够长才会分块");

  const prompts = [];
  let call = 0;
  const request = async (msgs) => {
    prompts.push(msgs[1].content);
    call++;
    const chars = call === 1
      ? [{ name: "老陈", gender: "male", age: "old", aliases: ["陈叔"] }]
      : call === 2
        // 同一个角色第二次出现，带了新别名；同时补一个后出场的人
        ? [{ name: "老陈", gender: "male", age: "old", aliases: ["陈老板"] },
           { name: "林晚", gender: "female", age: "young", aliases: [] }]
        // 第三次只给 unknown，不该覆盖已认出的性别
        : [{ name: "林晚", gender: "unknown", age: "unknown", aliases: ["晚晚"] },
           { name: "周砚", gender: "male", age: "young", aliases: [] }];
    return { ok: true, via: "mock", text: JSON.stringify({ isFiction: true, characters: chars }) };
  };

  const r = await A.analyze({ request, title: "长书", text });
  assert.ok(r.ok);
  assert.equal(r.chunks, 3);
  assert.equal(call, 3, "应该把三块都送出去");

  // 后续块必须带上已知角色，否则模型会把老人当新角色重复列
  assert.ok(!prompts[0].includes("已经认出的角色"), "第一块没有已知角色");
  assert.ok(prompts[1].includes("老陈"));
  assert.ok(prompts[2].includes("老陈") && prompts[2].includes("林晚"));

  const byName = Object.fromEntries(r.characters.map((c) => [c.name, c]));
  assert.deepEqual(byName["老陈"].aliases.sort(), ["陈叔", "陈老板"].sort());
  assert.equal(byName["林晚"].gender, "female", "unknown 不该覆盖已知性别");
  assert.deepEqual(byName["林晚"].aliases, ["晚晚"]);
  assert.ok(byName["周砚"], "后出场的角色要能认出来");
  assert.ok(r.cast["陈老板"], "别名要进 cast，合成时才认得出是同一人");
});

test("分块切点落在章节标题前，不会把一章劈成两半", () => {
  const A = require("../lib/book-analysis");
  const chapter = (n) => `第${n}章\n${"内容。".repeat(1200)}\n`;
  const chunks = A.chunkText(chapter("一") + chapter("二") + chapter("三"), 6000, 3);
  assert.equal(chunks.length, 3);
  assert.ok(chunks[1].includes("第二章"), "第二块应从章节标题开始");
  for (const c of chunks) assert.ok(c.trim().length > 0);
});
