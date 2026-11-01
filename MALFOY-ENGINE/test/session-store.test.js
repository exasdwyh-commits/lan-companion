"use strict";
// 会话的测试：换形态、重启之后，她还是记得刚才说到哪儿。
// 运行：node --test MALFOY-ENGINE/test/*.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSession, MAX_ENTRIES } = require("../lib/session-store");

function tempFile(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-sess-" + tag + "-"));
  return path.join(dir, "session.json");
}

test("一问一答落盘，同进程读回", () => {
  const file = tempFile("basic");
  const s = createSession(file);
  assert.equal(s.appendTurn("我在写代码", "嗯，别熬太晚", { mode: "world", via: "deepseek" }), true);
  assert.equal(s.count(), 2);
  assert.deepEqual(s.history(6), [
    { role: "user", content: "我在写代码" },
    { role: "assistant", content: "嗯，别熬太晚" },
  ]);
  assert.ok(fs.existsSync(file));
});

test("换形态不重置会话：两个形态写在同一条会话线上", () => {
  const file = tempFile("mode");
  const s = createSession(file);
  s.appendTurn("在她的世界里说的话", "我听见了", { mode: "world" });
  s.appendTurn("召唤到桌面后说的话", "我在你旁边", { mode: "desktop" });
  const turns = s.recent(10);
  assert.equal(turns.length, 4);
  assert.deepEqual(turns.map((t) => t.mode).filter(Boolean), ["world", "world", "desktop", "desktop"]);
  assert.equal(s.lastMode(), "desktop");
});

test("重启后读回：新进程拿到的是上一段对话", () => {
  const file = tempFile("restart");
  const a = createSession(file);
  a.appendTurn("我叫小林", "记住了", { mode: "world" });
  const b = createSession(file); // 模拟重启
  assert.equal(b.count(), 2);
  assert.equal(b.history(6)[0].content, "我叫小林");
});

test("超过上限时从头裁，且开头必须是用户说的", () => {
  const file = tempFile("trim");
  const s = createSession(file);
  for (let i = 0; i < MAX_ENTRIES; i += 1) {
    s.append({ role: i % 2 === 0 ? "user" : "assistant", content: "第" + i + "条" });
  }
  assert.equal(s.count(), MAX_ENTRIES);
  s.append({ role: "user", content: "新的一句" });
  const h = s.history(MAX_ENTRIES);
  assert.ok(h.length <= MAX_ENTRIES);
  assert.equal(h[0].role, "user", "截断后第一句不能是她的回答");
  assert.equal(h[h.length - 1].content, "新的一句");
});

test("坏 JSON 不让聊天崩掉，旧文件改名留证据", () => {
  const file = tempFile("bad");
  fs.writeFileSync(file, "{这不是 json");
  const s = createSession(file);
  assert.equal(s.count(), 0);
  assert.ok(fs.existsSync(file + ".bad"), "坏文件应改名留存，方便事后看");
  s.appendTurn("还能继续聊", "嗯");
  assert.equal(s.count(), 2);
});

test("空内容与非法角色被丢弃，不会写进会话", () => {
  const file = tempFile("invalid");
  const s = createSession(file);
  assert.equal(s.append({ role: "system", content: "偷偷改设定" }), false);
  assert.equal(s.append({ role: "user", content: "   " }), false);
  assert.equal(s.appendTurn("", "只有回答"), false);
  assert.equal(s.count(), 0);
});

test("元信息里能查到每条是谁合成的、哪个形态说的，用于举证", () => {
  const file = tempFile("meta");
  const s = createSession(file);
  s.appendTurn("你好", "嗯", { mode: "desktop", via: "deepseek-v4", tts: "qwen3" });
  const last = s.recent(1)[0];
  assert.equal(last.role, "assistant");
  assert.equal(last.mode, "desktop");
  assert.equal(last.via, "deepseek-v4");
  assert.equal(last.tts, "qwen3");
  // 但交给模型的历史里不许带这些内部字段
  assert.deepEqual(Object.keys(s.history(1)[0]).sort(), ["content", "role"]);
});

test("clear 之后是干净的开始", () => {
  const file = tempFile("clear");
  const s = createSession(file);
  s.appendTurn("记着", "好");
  s.clear();
  assert.equal(s.count(), 0);
  assert.equal(createSession(file).count(), 0);
});
