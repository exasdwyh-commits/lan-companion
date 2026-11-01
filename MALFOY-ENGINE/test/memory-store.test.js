"use strict";
// 记忆库的隔离测试：写临时目录，证明真实目录一个字节都没动。
// 运行：node --test MALFOY-ENGINE/test/

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createStore, MEM_MAX, PROFILE_MAX } = require("../lib/memory-store");

function tempDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lan-mem-" + tag + "-"));
}

function fingerprint(file) {
  if (!fs.existsSync(file)) return "absent";
  const st = fs.statSync(file);
  return [st.size, st.mtimeMs].join(":");
}

test("记忆写入落在指定的临时目录里", () => {
  const dir = tempDir("write");
  const store = createStore(dir);
  assert.equal(store.remember("你好", "我在"), true);
  assert.ok(fs.existsSync(path.join(dir, "memory.jsonl")), "应写到临时目录");
  const recs = store.recall(5);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].u, "你好");
  assert.equal(recs[0].a, "我在");
  assert.equal(store.count(), 1);
});

test("两个独立目录互不可见（第二次启动读回自己的）", () => {
  const a = createStore(tempDir("a"));
  const b = createStore(tempDir("b"));
  a.remember("A 的话", "A 的回复");
  assert.equal(a.count(), 1);
  assert.equal(b.count(), 0, "另一个目录不该看到别人的记忆");
});

test("超过上限裁剪，保留最新的一条", () => {
  const store = createStore(tempDir("trim"));
  for (let i = 0; i < MEM_MAX + 7; i += 1) store.remember("u" + i, "a" + i);
  assert.equal(store.count(), MEM_MAX);
  assert.equal(store.recall(1)[0].u, "u" + (MEM_MAX + 6));
});

test("坏行不会让 recall 崩掉", () => {
  const dir = tempDir("bad");
  const store = createStore(dir);
  fs.writeFileSync(path.join(dir, "memory.jsonl"), '{"u":"ok","a":"x"}\n不是json\n\n');
  const recs = store.recall(10);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].u, "ok");
});

test("画像合并去重，只收 - 开头的行", () => {
  const store = createStore(tempDir("profile"));
  store.mergeProfile("- 喜欢海\n关于她的无关内容\n- 熬夜");
  store.mergeProfile("- 喜欢海\n- 在学日语");
  const text = store.readProfile();
  const lines = text.split("\n").filter(Boolean);
  assert.deepEqual(lines.sort(), ["- 在学日语", "- 喜欢海", "- 熬夜"].sort());
  assert.ok(lines.length <= PROFILE_MAX);
});

test("隔离验收：写临时目录时，真实目录指纹不变", () => {
  const realHome = path.join(os.homedir(), ".smartcompanion");
  const realMemory = path.join(realHome, "memory.jsonl");
  const before = fingerprint(realMemory);

  const store = createStore(tempDir("isolated"));
  store.remember("测试写入", "不该出现在真实记忆里");
  store.mergeProfile("- 测试事实");

  const after = fingerprint(realMemory);
  assert.equal(after, before, "真实 memory.jsonl 不应被改写");
});

test("store 不知道自己有几份数据：目录由调用方给，模块里没有 HOME", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "memory-store.js"), "utf8");
  // 只看代码，不看注释——注释里说明「本模块不认识旧默认目录」是正常的。
  const code = source.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  assert.ok(!/process\.env\.HOME/.test(code), "memory-store 不应自己拼 HOME");
  assert.ok(!/smartcompanion/.test(code), "memory-store 不应硬编码旧默认目录");
});

// ── 画像可纠正 ────────────────────────────────────────────────
// 「我叫小明」说错了，画像里必须只剩「小林」。新旧两条同时留着，
// 她就会来回改口，而且每次召回的顺序不同，像换了个人。

test("结构化画像：同一属性后写的覆盖先写的", () => {
  const store = createStore(tempDir("fix"));
  store.mergeProfile("- 名字：小明\n- 讨厌：香菜");
  store.mergeProfile("- 名字：小林");
  const lines = store.readProfile().split("\n").filter(Boolean);
  assert.equal(lines.length, 2, "同一属性只该留一条");
  assert.ok(lines.includes("- 名字：小林"));
  assert.ok(!lines.some((l) => l.includes("小明")), "被纠正掉的旧值不能留在画像里");
  assert.ok(lines.includes("- 讨厌：香菜"), "无关条目不受影响");
});

test("覆盖时保持原位置，不打乱画像顺序", () => {
  const store = createStore(tempDir("order"));
  store.mergeProfile("- 名字：小明\n- 讨厌：香菜");
  store.mergeProfile("- 名字：小林");
  const lines = store.readProfile().split("\n").filter(Boolean);
  assert.equal(lines[0], "- 名字：小林", "覆盖应发生在原位，不是挪到最后");
});

test("英文冒号也认；没有冒号的老自由文本原样保留", () => {
  const store = createStore(tempDir("colon"));
  store.mergeProfile("- 喜欢海\n- 名字: 小明");
  store.mergeProfile("- 名字: 小林\n- 在学日语");
  const lines = store.readProfile().split("\n").filter(Boolean);
  assert.ok(lines.includes("- 喜欢海"), "老格式不能被清洗掉");
  assert.equal(lines.filter((l) => /名字/.test(l)).length, 1);
  assert.ok(lines.includes("- 名字: 小林"));
});

test("forget 按属性名精确删一条", () => {
  const store = createStore(tempDir("forget"));
  store.mergeProfile("- 名字：小林\n- 讨厌：香菜");
  assert.equal(store.forget("名字"), true);
  const lines = store.readProfile().split("\n").filter(Boolean);
  assert.deepEqual(lines, ["- 讨厌：香菜"]);
  assert.equal(store.forget("不存在"), true, "删不存在的键不算失败");
  assert.equal(store.readProfile().trim(), "- 讨厌：香菜");
});

test("纠正写临时目录时，真实画像也不变", () => {
  const realProfile = path.join(os.homedir(), ".smartcompanion", "profile.md");
  const before = fingerprint(realProfile);
  const store = createStore(tempDir("fix-isolated"));
  store.mergeProfile("- 名字：小明");
  store.mergeProfile("- 名字：小林");
  store.forget("名字");
  assert.equal(fingerprint(realProfile), before, "真实 profile.md 不应被改写");
});
