"use strict";
// 验收用的本地 LLM 桩。只做一件事：把「她说了一句带情绪标签的话」交给真的下游。
//
// 为什么需要它：验收时外部模型额度可能正好用尽（实测 magpie 全部源 429、
// 云端不通、本地 27B 没起），这时端到端链路根本跑不起来，只能验到「数据目录对了」。
// 桩把「模型说了什么」变成确定输入，其余环节（记忆、会话、画像、TTS、落盘）全是真的。
//
// 它同时是一份证据：把每次请求的 system prompt 长度、是否带形态段、以及用户话
// 都记进 MOCK_LOG —— 下一次请求里能不能看到上一次的话，这才是「跨形态记得」。
//
// 用法：
//   MOCK_LOG=/tmp/x.jsonl node scripts/mock-chat-server.js   # 打印端口后常驻
// 环境：
//   MOCK_PORT      固定端口（默认 0 = 随机）
//   MOCK_FAIL_FIRST 前 N 次请求返回 429，用来验模型池逐源切换
//   MOCK_REPLY     固定回复（默认带 [emo:calm]）

const http = require("http");
const fs = require("fs");

const LOG = process.env.MOCK_LOG || "";
const FAIL_FIRST = Number(process.env.MOCK_FAIL_FIRST || 0);
// 让前几次请求慢一点：用来验「晚到的旧回答不许盖掉新的」（叠播）。
const DELAY_FIRST = Number(process.env.MOCK_DELAY_FIRST || 0);
const DELAY_MS = Number(process.env.MOCK_DELAY_MS || 0);
const REPLY = process.env.MOCK_REPLY || "[emo:calm] 嗯，我记着你说的话。";
let hits = 0;

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, hits, failFirst: FAIL_FIRST });
  if (req.method !== "POST") return send(res, 404, { error: "only POST /v1/chat/completions" });

  let raw = "";
  req.on("data", (d) => { raw += d; });
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(raw); } catch (e) { return send(res, 400, { error: "bad json" }); }
    hits += 1;

    const msgs = Array.isArray(body.messages) ? body.messages : [];
    const system = String((msgs.find((m) => m.role === "system") || {}).content || "");
    const users = msgs.filter((m) => m.role === "user").map((m) => String(m.content || ""));

    // 记录请求形状，不记录完整对话：验收脚本要比对的是「上次的话有没有带过来」。
    if (LOG) {
      const rec = {
        i: hits,
        model: String(body.model || ""),
        msgCount: msgs.length,
        systemChars: system.length,
        hasToneBlock: system.includes("【此刻】"),
        hasWorldTone: system.includes("她在自己的世界里"),
        hasDesktopTone: system.includes("被召唤到了对方的桌面"),
        userTurn: users.length,
        users: users.map((u) => u.slice(0, 80)),
      };
      try { fs.appendFileSync(LOG, JSON.stringify(rec) + "\n"); } catch (e) {}
    }

    if (FAIL_FIRST && hits <= FAIL_FIRST) {
      return send(res, 429, { error: { message: "mock rate limit", type: "rate_limit_error" } });
    }
    const reply = () => send(res, 200, {
      id: "mock-" + hits,
      object: "chat.completion",
      model: body.model || "mock",
      choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }],
    });
    if (DELAY_FIRST && hits <= DELAY_FIRST) return setTimeout(reply, DELAY_MS);
    reply();
  });
});

server.listen(Number(process.env.MOCK_PORT || 0), "127.0.0.1", () => {
  const port = server.address().port;
  process.stdout.write(JSON.stringify({ mock: "ready", port, url: "http://127.0.0.1:" + port + "/v1/chat/completions" }) + "\n");
});
