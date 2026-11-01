"use strict";
// 这些用例都是「真实 HTTP + 真实 curl 子进程」，因为 SSE 解析的坑
// （keepalive 注释行、半行跨 chunk、非流式兜底）都只在真实管道里才出现。
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { streamOnce, deltaOf } = require("../lib/llm-stream");

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function sse(res, obj) {
  res.write("data: " + JSON.stringify(obj) + "\n\n");
}
function chunk(content) {
  return { choices: [{ index: 0, delta: { content } }] };
}

test("正常 SSE：正文逐段拼起来，首字时间可测", async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    sse(res, chunk("风是有点大"));
    sse(res, chunk("，我先回湾里。"));
    res.write("data: [DONE]\n\n");
    res.end();
  });
  const seen = [];
  const r = await streamOnce({
    url: `http://127.0.0.1:${port}/v1/chat/completions`, key: "k", body: "{}",
    onDelta: (d) => seen.push(d),
  });
  server.close();
  assert.equal(r.ok, true);
  assert.equal(r.text, "风是有点大，我先回湾里。");
  assert.deepEqual(seen, ["风是有点大", "，我先回湾里。"]);
  assert.ok(r.firstTokenMs >= 0, "应记录首字耗时");
  assert.equal(r.code, "200");
});

test("keepalive 注释行不会打断整条流", async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": keepalive\n\n");
    res.write(": keepalive\n\n");
    sse(res, chunk("在的。"));
    res.end();
  });
  const r = await streamOnce({ url: `http://127.0.0.1:${port}/x`, key: "k", body: "{}" });
  server.close();
  assert.equal(r.ok, true);
  assert.equal(r.text, "在的。");
});

test("reasoning_content 是思考过程，绝不能进正文", async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    sse(res, { choices: [{ delta: { reasoning_content: "用户问我在做什么，我应该" } }] });
    sse(res, { choices: [{ delta: { reasoning_content: "回答得温柔一点" } }] });
    sse(res, chunk("在浪里翻跟头呢。"));
    res.end();
  });
  const r = await streamOnce({ url: `http://127.0.0.1:${port}/x`, key: "k", body: "{}" });
  server.close();
  assert.equal(r.text, "在浪里翻跟头呢。");
  assert.equal(r.text.includes("用户问"), false);
});

test("首字闸门只认正文：一直吐思考的源会被掐掉", async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const timer = setInterval(() => {
      res.write(": keepalive\n\n");
      sse(res, { choices: [{ delta: { reasoning_content: "想" } }] });
    }, 100);
    res.on("close", () => clearInterval(timer));
  });
  const t0 = Date.now();
  const r = await streamOnce({ url: `http://127.0.0.1:${port}/x`, key: "k", body: "{}", firstTokenMs: 400 });
  server.close();
  const spent = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.code, "first-token-timeout");
  assert.ok(spent < 2000, "应在闸门附近返回，实际 " + spent + "ms");
});

test("半行跨 chunk 也能正确拼回来", async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const full = "data: " + JSON.stringify(chunk("海面起雾了。")) + "\n\n";
    res.write(full.slice(0, 18));
    setTimeout(() => { res.write(full.slice(18)); res.end(); }, 80);
  });
  const r = await streamOnce({ url: `http://127.0.0.1:${port}/x`, key: "k", body: "{}" });
  server.close();
  assert.equal(r.text, "海面起雾了。");
});

test("网关忽略 stream 直接回整段 JSON 时也要能用", async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "我在。" } }] }));
  });
  const r = await streamOnce({ url: `http://127.0.0.1:${port}/x`, key: "k", body: "{}" });
  server.close();
  assert.equal(r.ok, true);
  assert.equal(r.text, "我在。");
});

test("HTTP 429 要回报状态码，不能当成空回答", async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "usage exceeds frequency limit" } }));
  });
  const r = await streamOnce({ url: `http://127.0.0.1:${port}/x`, key: "k", body: "{}" });
  server.close();
  assert.equal(r.ok, false);
  assert.equal(r.code, "429");
});

test("中途取消：保留已收到的内容并标记 cancelled", async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    sse(res, chunk("我在"));
    const timer = setInterval(() => sse(res, chunk("……")), 100);
    res.on("close", () => clearInterval(timer));
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 250);
  const r = await streamOnce({ url: `http://127.0.0.1:${port}/x`, key: "k", body: "{}", signal: controller.signal });
  server.close();
  assert.equal(r.code, "cancelled");
  assert.ok(r.text.startsWith("我在"));
});

test("deltaOf 只认正文", () => {
  assert.equal(deltaOf("[DONE]"), null);
  assert.equal(deltaOf(""), null);
  assert.equal(deltaOf("not json"), null);
  assert.equal(deltaOf(JSON.stringify({ choices: [{ delta: { reasoning_content: "想" } }] })), null);
  assert.equal(deltaOf(JSON.stringify(chunk("好。"))), "好。");
});
