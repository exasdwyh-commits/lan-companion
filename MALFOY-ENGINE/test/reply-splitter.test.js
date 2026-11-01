"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createReplySplitter } = require("../lib/reply-splitter");

test("首块在第一个完整句就切出去，不等整段", () => {
  const s = createReplySplitter();
  const out = s.push("我在的，风是有点大，");
  assert.deepEqual(out, [], "半句不该切");
  const out2 = s.push("窗被吹得响。你那边呢？");
  assert.deepEqual(out2, ["我在的，风是有点大，窗被吹得响。"]);
  assert.equal(s.pending, "你那边呢？");
});

test("极短的开头会跟下一句合并，不单独合成", () => {
  const s = createReplySplitter();
  const out = s.push("嗯。我在，风把窗吹得响。");
  assert.deepEqual(out, ["嗯。我在，风把窗吹得响。"], "「嗯。」太短，应等到够长再切");
});

test("逐字喂入时切点只出现在句子闭合之后", () => {
  const s = createReplySplitter();
  const text = "海面起雾了，我先回湾里。你别站在礁石上。";
  const got = [];
  for (const ch of text) got.push(...s.push(ch));
  got.push(...s.flush());
  assert.deepEqual(got, ["海面起雾了，我先回湾里。", "你别站在礁石上。"]);
  assert.equal(got.join(""), text);
});

test("首块等不到句号时按上限硬切，保证首音不拖", () => {
  const s = createReplySplitter();
  // 16 字以上仍无句末标点 → 切在边缘，不再等
  const out = s.push("风是有点大，我把外套裹得更紧一些再去");
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 16, "应按 firstLimit 硬切，实际：" + out[0]);
});

test("一个标点都没有的超长句会硬切，不会无限等", () => {
  const s = createReplySplitter();
  const out = s.push("啊".repeat(40));
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 16, "首块按 firstLimit 硬切");
  assert.equal(s.pending.length, 24, "剩下的留着等下一块");
});

test("后续块按已切总量放大：开头短的时候不能一次切太长", () => {
  const s = createReplySplitter();
  const first = s.push("风从海面一路滚下来了。");   // 11 字，只够 cover 约 27 字
  assert.deepEqual(first, ["风从海面一路滚下来了。"]);
  const out = s.push("正好把我往深处推。我就在下面慢慢游，听浪拍在头顶的壳上，像是有人在敲门。");
  assert.ok(out.length >= 1);
  assert.ok(out[0].length <= 27, "开头只有 11 字时，第二块不该超过 27 字，实际 " + out[0].length);
  // 余量攒起来之后才放开到 maxLimit
  const later = s.push("这句话很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长。");
  assert.ok(later[0].length > 27, "播放余量够了就该切大块，实际 " + later[0].length);
});

test("块攒起来之后可以变长，不用一直碎着切", () => {
  const s = createReplySplitter();
  s.push("风从海面滚下来。正好把我往深处推。");     // 首块 8 字 + 第二块
  const out = s.push("我就在下面慢慢游，听浪一下一下拍在头顶的壳上，像是有人在很远的地方敲门。");
  assert.equal(out.length, 1);
  assert.ok(out[0].length > 20, "播放已有余量，块应该变长，实际：" + out[0]);
});

test("后续块按长句切，避免一句一次调用", () => {
  const s = createReplySplitter();
  // 首块要够 10 字才切出去
  assert.deepEqual(s.push("好，我知道了。"), []);
  const out = s.push("浪大。我在。门关好了。雾也散了。");
  assert.deepEqual(out, ["好，我知道了。浪大。", "我在。门关好了。雾也散了。"]);
});

test("连续标点整体吃掉，不拆成两条", () => {
  const s = createReplySplitter();
  const out = s.push("真的吗？！我不敢信。");
  assert.deepEqual(out, ["真的吗？！我不敢信。"]);
});

test("情绪标签被剥离并单独返回，不进正文", () => {
  const s = createReplySplitter();
  const out = s.push("[emo:shy]你、你怎么突然问这个。");
  assert.equal(s.emotion, "shy");
  assert.equal(out.join("").includes("[emo"), false);
  assert.deepEqual(out, ["你、你怎么突然问这个。"]);
});

test("标签被拆在两个增量里也能认出来", () => {
  const s = createReplySplitter();
  s.push("[em");
  const out = s.push("o:sad] 我没事。");
  assert.equal(s.emotion, "sad", "标签跨增量也要认出来");
  // 「我没事。」只有 4 字，不到首块阈值，先攒着
  assert.deepEqual(out, []);
  assert.deepEqual(s.flush(), ["我没事。"]);
});

test("流结束时剩余文本必须吐出，不能丢", () => {
  const s = createReplySplitter();
  s.push("嗯，我在");
  const rest = s.flush();
  assert.deepEqual(rest, ["嗯，我在"]);
  assert.equal(s.pending, "");
  assert.deepEqual(s.flush(), [], "重复 flush 不该重复吐");
});

test("句末引号跟着句子走", () => {
  const s = createReplySplitter();
  const out = s.push("他说了一句话「快回来。」然后就走了。");
  assert.equal(out.length, 1);
  assert.equal(out[0].slice(-1), "」", "收尾引号不该被留在下一句开头，实际：" + out[0]);
});

test("硬切时不能把句号甩到下一块开头", () => {
  const s = createReplySplitter();
  const out = s.push("风从海面滚下来。正好把我往深处推。");
  assert.equal(out[0].slice(-1), "。", "切点正好落在句号前一个字，应把句号带上，实际：" + out[0]);
});
