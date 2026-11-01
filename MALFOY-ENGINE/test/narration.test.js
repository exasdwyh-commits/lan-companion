"use strict";
// 朗读稿的测试：读音、分段、旁白/对白切分。
// 用户的原始反馈是「80后 被念成 八十后」，这条是最不能回退的。
// 运行：node --test MALFOY-ENGINE/test/*.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const N = require("../lib/narration");

test("数字与年代按中文习惯读", () => {
  assert.equal(N.toSpeech("他是80后。"), "他是八零后。");
  assert.equal(N.toSpeech("90年代的老歌"), "九零年代的老歌");
  assert.equal(N.toSpeech("1998年的夏天"), "一九九八年的夏天");
  assert.equal(N.toSpeech("1990—2000年间"), "一九九零年到二零零零年间");
  assert.equal(N.toSpeech("2024-10-30"), "二零二四年十月三十日");
  assert.equal(N.toSpeech("上午10:30"), "上午十点三十分");
});

test("数量、比例、金额、单位", () => {
  assert.equal(N.toSpeech("3.5%"), "百分之三点五");
  assert.equal(N.toSpeech("他走了1/3的路"), "他走了三分之一的路");
  assert.equal(N.toSpeech("￥120"), "一百二十元");
  assert.equal(N.toSpeech("5km/h"), "5公里每小时");
  assert.equal(N.toSpeech("第3-5章"), "第三章到第五章");
});

test("链接、网址不会进到朗读里", () => {
  const s = N.toSpeech("详见 https://example.com/a?b=1 以及 [说明](https://x.io)");
  assert.ok(!/https?:|example\.com|x\.io/.test(s), s);
  assert.ok(s.includes("说明"), s);
});

test("整数读法边界", () => {
  assert.equal(N.toChineseInt(0), "零");
  assert.equal(N.toChineseInt(10), "十");
  assert.equal(N.toChineseInt(12), "十二");
  assert.equal(N.toChineseInt(105), "一百零五");
  assert.equal(N.toChineseInt(100000), "十万");
  assert.equal(N.toChineseInt(1000000), "一百万");
});

test("分段在句末断开，不超过硬上限", () => {
  const text = "第一句话在这里。".repeat(40);
  const paras = N.splitParagraphs(text);
  assert.ok(paras.length > 1);
  for (const p of paras) {
    assert.ok(p.length <= N.PARA_HARD, `段落过长：${p.length}`);
    assert.ok(/[。！？…；]$/.test(p), `段落没有断在句末：${p}`);
  }
  assert.equal(paras.join("").replace(/\s/g, ""), text);
});

test("旁白与对白分开，说了「X 说」就认得出 X", () => {
  const segs = N.splitScript("周砚把伞收起来：“路上堵了。”");
  const spoken = segs.filter((s) => s.who !== "narr");
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].who, "周砚");
  assert.equal(spoken[0].say, "路上堵了。");
});

test("代词靠旁白里最近提到的角色落地", () => {
  const book = [
    "周砚推开门。林夏站在窗边，没有回头。",
    "“你终于来了。”她说。",
    "周砚把伞收起来：“路上堵了。”",
    "“我一直在等。”林夏说。",
  ].join("\n");
  const { paragraphs, cast } = N.buildBook(book);
  const spoken = paragraphs.flatMap((p) => p.segments).filter((s) => s.who !== "narr").map((s) => s.who);
  assert.ok(spoken.includes("林夏"), `她说 应落到林夏：${spoken}`);
  assert.ok(spoken.includes("周砚"), `“路上堵了”应是周砚说的：${spoken}`);
  assert.ok(cast["林夏"], "林夏应进角色表");
  assert.ok(cast["周砚"], "周砚应进角色表");
});

test("性别对不上就不硬套，退回通用男女声", () => {
  const segs = N.splitScript("周砚推开门。林夏站在窗边。\n“你来了。”她说。",
    { known: new Set(["周砚"]), lastNamed: "周砚", votes: {} });
  const spoken = segs.find((s) => s.who !== "narr");
  assert.equal(spoken.who, "女声");
});

test("每个角色拿到不同音色，旁白不在角色表里", () => {
  const book = [
    "周砚走进屋。林夏抬头看他。",
    "“你回来了。”林夏说。",
    "“嗯。”周砚答。",
    "“晚饭在锅里。”林夏说。",
  ].join("\n");
  const { cast } = N.buildBook(book);
  const voices = Object.values(cast).map((c) => c.voice);
  assert.equal(new Set(voices).size, voices.length, `音色重复：${voices.join(",")}`);
  assert.ok(!cast["narr"], "旁白不该占角色音色");
});

test("单音色模式不切对白", () => {
  const { paragraphs, cast } = N.buildBook("“你来了。”她说。", { multiVoice: false });
  assert.deepEqual(Object.keys(cast), []);
  assert.equal(paragraphs[0].segments.length, 1);
  assert.equal(paragraphs[0].segments[0].who, "narr");
});
