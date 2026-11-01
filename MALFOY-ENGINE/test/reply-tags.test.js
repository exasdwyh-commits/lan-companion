"use strict";
// [emo:x] / [move:x] 标签的解析与剥离。
//
// 这一组断言的重点不是「能取出来」，而是**剥得干净**：
// 只要有一个标签漏进 TTS，她就会把「往左」当台词念出来，用户会听见一句莫名其妙的指令。

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseEmotion, stripTags, EMO_LIST, MOVE_LIST } = require("../lib/reply-tags");

test("情绪标签：取出并剥掉，正文不变", () => {
  assert.deepEqual(parseEmotion("[emo:happy]今天海面很平"), {
    text: "今天海面很平", emo: "happy", move: null,
  });
});

test("走动标签：取出并剥掉，语气词留在正文里", () => {
  const r = parseEmotion("[emo:calm]好，我过去 [move:left]");
  assert.equal(r.move, "left");
  assert.equal(r.text, "好，我过去");
  assert.equal(r.emo, "calm");
});

test("两个标签同时出现、顺序颠倒也能各自取对", () => {
  const r = parseEmotion("[move:floor][emo:shy]我下来啦");
  assert.equal(r.move, "floor");
  assert.equal(r.emo, "shy");
  assert.equal(r.text, "我下来啦");
});

test("四种走动方向都认得，未知方向一律当作没有", () => {
  for (const side of MOVE_LIST) {
    assert.equal(parseEmotion(`走 [move:${side}]`).move, side);
  }
  assert.equal(parseEmotion("走 [move:up]").move, null);
  assert.equal(parseEmotion("走 [move:]").move, null);
});

test("没有标签时：默认 calm，正文原样", () => {
  assert.deepEqual(parseEmotion("只是随便聊聊"), {
    text: "只是随便聊聊", emo: "calm", move: null,
  });
});

test("老格式 [happy] 在句首仍然认，并且从正文里去掉", () => {
  const r = parseEmotion("[happy]你来啦");
  assert.equal(r.emo, "happy");
  assert.equal(r.text, "你来啦");
});

test("stripTags：全部标签剥干净，一个不留（这是给 TTS 用的）", () => {
  const raw = "[emo:happy]好的[move:right]我挪一下[emo:calm]";
  const out = stripTags(raw);
  assert.equal(out, "好的我挪一下");
  assert.equal(/\[(emo|move):/i.test(out), false);
});

test("stripTags：正常方括号内容必须原样保留", () => {
  assert.equal(stripTags("[重要]记得吃药"), "[重要]记得吃药");
  assert.equal(stripTags("第[1]项"), "第[1]项");
});

test("stripTags：白名单外的 [emo:xxx] 也照剥 —— 剥不干净会被念出来", () => {
  // 解析层只认白名单（[emo:whatever] 会退回 calm），但剥离层要更狠：
  // 宁可少一个字，也不能让 TTS 把标签名念成台词。
  assert.equal(stripTags("[emo:whatever]嗯"), "嗯");
  assert.equal(stripTags("[move:sideways]嗯"), "嗯");
});

test("大小写混写也认（模型不总是守规矩）", () => {
  const r = parseEmotion("[EMO:Happy]嗯 [Move:LEFT]");
  assert.equal(r.emo, "happy");
  assert.equal(r.move, "left");
  assert.equal(r.text, "嗯");
});

test("空值 / null 不炸", () => {
  assert.deepEqual(parseEmotion(""), { text: "", emo: "calm", move: null });
  assert.deepEqual(parseEmotion(null), { text: "", emo: "calm", move: null });
  assert.equal(stripTags(undefined), "");
});

test("白名单本身不许悄悄变长", () => {
  assert.deepEqual(EMO_LIST, ["happy", "sad", "shy", "angry", "calm", "surprised", "sleepy", "thinking"]);
  assert.deepEqual(MOVE_LIST, ["left", "right", "center", "floor"]);
});
