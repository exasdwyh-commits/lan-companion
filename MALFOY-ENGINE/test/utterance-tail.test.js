"use strict";
// 端点续接的判据。这些用例大多来自「真实会踩的坑」，而不是为了凑覆盖率：
// 「好的」不能当悬空（误判就白等 3 秒），「然后」必须当悬空（漏判就会打断人）。
const test = require("node:test");
const assert = require("node:assert");

const { looksDangling, mergeTail, DANGLING_WORDS } = require("../lib/utterance-tail");

test("有句末标点就一定算说完", () => {
  for (const s of ["我知道了。", "真的吗？", "太好了！", "嗯～～", "「快回来。」"]) {
    assert.equal(looksDangling(s), false, s);
  }
});

test("停在逗号上算没说完", () => {
  for (const s of ["我今天去了海边，", "风很大,", "先说这个；", "我想说："]) {
    assert.equal(looksDangling(s), true, s);
  }
});

test("停在连接词上算没说完", () => {
  for (const s of ["因为", "我今天不想出门然后", "他本来要来的但是", "是这样的，那个"]) {
    assert.equal(looksDangling(s), true, s);
  }
});

test("短小的完整回答不能被当成没说完", () => {
  // 这些如果被判成悬空，用户说完「好的」得白等三秒才等到回复
  for (const s of ["好的", "行", "不要", "现在", "可以", "没问题", "谢谢"]) {
    assert.equal(looksDangling(s), false, s);
  }
});

test("没有标点的整句算说完", () => {
  for (const s of ["我今天去了海边", "帮我查一下明天的天气", "你叫什么名字"]) {
    assert.equal(looksDangling(s), false, s);
  }
});

test("空输入不算悬空（那是没听清，交给上层报错）", () => {
  assert.equal(looksDangling(""), false);
  assert.equal(looksDangling("   "), false);
  assert.equal(looksDangling(null), false);
});

test("末尾引号不影响判断", () => {
  assert.equal(looksDangling("他说“然后”"), true);
  assert.equal(looksDangling("他说“快回来。”"), false);
});

test("续接时去掉上一段结尾的逗号", () => {
  assert.equal(mergeTail("我想去海边，", "看看日落"), "我想去海边看看日落");
});

test("续接时消掉 ASR 常见的尾部重复", () => {
  assert.equal(mergeTail("我想去海边，", "海边看看"), "我想去海边看看");
  assert.equal(mergeTail("他说那个", "那个事情"), "他说那个事情");
});

test("续接不会把正常重复的词吃掉", () => {
  // 「我们」+「我们走吧」——重合 2 个字，按规则应该合并成「我们走吧」
  assert.equal(mergeTail("我们", "我们走吧"), "我们走吧");
  // 但单个字的重复不合并：「看」+「看看」保持原样更安全
  assert.equal(mergeTail("我想看", "看看"), "我想看看看");
});

test("英文续接补空格，中文不补", () => {
  assert.equal(mergeTail("I want to", "see the sea"), "I want to see the sea");
  assert.equal(mergeTail("我想", "见你"), "我想见你");
});

test("两段有一边为空时原样返回另一边", () => {
  assert.equal(mergeTail("", "后半句"), "后半句");
  assert.equal(mergeTail("前半句", ""), "前半句");
  assert.equal(mergeTail(null, undefined), "");
});

test("悬空词表按长度倒序，长词优先匹配", () => {
  for (let i = 1; i < DANGLING_WORDS.length; i++) {
    assert.ok(DANGLING_WORDS[i - 1].length >= DANGLING_WORDS[i].length, "词表应长度倒序");
  }
});
