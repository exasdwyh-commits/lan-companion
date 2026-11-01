"use strict";
// 流式路由的行为约束：先出字的源胜出，出过字就不换源，失败要有记忆。
const test = require("node:test");
const assert = require("node:assert");
const { ChatRouter } = require("../lib/chat-router");

const P = [
  { id: "a", timeout: 10 },
  { id: "b", timeout: 10 },
  { id: "c", timeout: 10 },
];

function routerWith(respond) {
  return new ChatRouter({
    request: async () => ({ ok: false }),
    streamRequest: async (p, _m, o) => respond(p, o),
    budgetMs: 20000,
  });
}

test("首字超时的源会被跳过，下一个源接管", async () => {
  const r = routerWith((p) => p.id === "a"
    ? { ok: false, code: "first-token-timeout", text: "", ms: 2600 }
    : { ok: true, code: "200", text: "在的。", ms: 900, firstTokenMs: 600 });
  const out = await r.runStream(P, []);
  assert.equal(out.ok, true);
  assert.equal(out.via, "b");
  assert.equal(out.text, "在的。");
  assert.deepEqual(out.attempts.map((a) => a.id), ["a", "b"]);
  assert.equal(out.attempts[0].code, "first-token-timeout");
});

test("已经出过正文就不再换源：留下半段也比重复播一遍好", async () => {
  const r = routerWith((p) => p.id === "a"
    ? { ok: false, code: "network", text: "风是有点大，", ms: 1200, firstTokenMs: 400 }
    : { ok: true, text: "不该走到这里", ms: 100 });
  const out = await r.runStream(P, []);
  assert.equal(out.ok, true);
  assert.equal(out.via, "a");
  assert.equal(out.text, "风是有点大，");
  assert.equal(out.truncated, true, "要标记这是被截断的半段");
});

test("429 之后短时间内不再重试同一个源", async () => {
  let hitA = 0;
  const r = routerWith((p) => {
    if (p.id === "a") { hitA++; return { ok: false, code: "429", text: "", ms: 50 }; }
    return { ok: true, code: "200", text: "嗯。", ms: 500 };
  });
  const first = await r.runStream(P, []);
  assert.equal(first.attempts[0].code, "429");
  const second = await r.runStream(P, []);
  assert.equal(hitA, 1, "两次对话里 a 只该被真实请求一次");
  assert.equal(second.ok, true);
});

test("全部源都失败时明确返回失败，不带任何正文", async () => {
  const r = routerWith(() => ({ ok: false, code: "network", text: "", ms: 30 }));
  const out = await r.runStream(P, []);
  assert.equal(out.ok, false);
  assert.equal(out.text, undefined);
  assert.equal(out.attempts.length, 3);
});

test("上次成功的源会被提到最前面（省掉一次无谓等待）", async () => {
  const r = routerWith((p) => p.id === "c"
    ? { ok: true, code: "200", text: "好。", ms: 400, firstTokenMs: 300 }
    : { ok: false, code: "timeout", text: "", ms: 2600 });
  await r.runStream(P, []);
  const again = await r.runStream(P, []);
  assert.equal(again.via, "c");
  assert.equal(again.attempts[0].id, "c", "第二次应直接命中上次可用的源");
  assert.equal(again.attempts.length, 1);
});

test("没有注入流式实现时明确回报 unsupported，而不是静默失败", async () => {
  const r = new ChatRouter({ request: async () => ({ ok: false }) });
  const out = await r.runStream(P, []);
  assert.equal(out.ok, false);
  assert.equal(out.unsupported, true);
});

test("取消信号让整轮立刻停下", async () => {
  const controller = new AbortController();
  const r = routerWith(async () => { controller.abort(); return { ok: false, code: "cancelled", text: "", ms: 10 }; });
  const out = await r.runStream(P, [], { signal: controller.signal });
  assert.equal(out.cancelled, true);
  assert.equal(out.attempts.length, 1, "取消后不该再试下一个源");
});
