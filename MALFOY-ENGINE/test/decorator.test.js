"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRoomPlan } = require("../lib/room-plan");
const { decorate, buildPrompt, extractPlan, describeErrors, MAX_ATTEMPTS } = require("../lib/decorator");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-deco-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, create: () => createRoomPlan({ dir }) };
}

test("第一次就给对：一步到位", async (t) => {
  const f = fixture(t);
  const room = f.create();
  const r = await decorate({
    roomPlan: room,
    generate: async () => ({ place: [{ item: "sofa", x: 0, y: 0 }] }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.equal(r.room.items.length, 1);
});

test("第一次压到家具，第二次照着错误提示改好", async (t) => {
  const f = fixture(t);
  const room = f.create();
  room.place("rug", 0, 0);
  const seen = [];
  const r = await decorate({
    roomPlan: room,
    generate: async (prompt) => {
      seen.push(prompt);
      if (seen.length === 1) return { place: [{ item: "sofa", x: 1, y: 1 }] };  // 压地毯
      return { place: [{ item: "sofa", x: 6, y: 0 }] };                          // 换空位
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.room.items.length, 2);
  assert.match(seen[1], /上一次的计划被拒绝了/);
  assert.match(seen[1], /压到了/, "第二次的提示词里必须带上具体冲突");
});

test("三次都不成才放弃，房间保持原样", async (t) => {
  const f = fixture(t);
  const room = f.create();
  room.place("rug", 0, 0);
  const before = JSON.stringify(room.snapshot().items);
  let calls = 0;
  const r = await decorate({
    roomPlan: room,
    generate: async () => { calls += 1; return { place: [{ item: "sofa", x: 0, y: 0 }] }; },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "gave-up");
  assert.equal(calls, MAX_ATTEMPTS);
  assert.equal(JSON.stringify(room.snapshot().items), before, "失败的改造不能留下半成品");
});

test("模型输出被 ```json 包住也能抠出来", () => {
  const plan = extractPlan('好的，我这样摆：\n```json\n{"place":[{"item":"lamp","x":1,"y":1}]}\n```\n可以吗？');
  assert.deepEqual(plan, { place: [{ item: "lamp", x: 1, y: 1 }] });
});

test("括号不配平或不是对象就返回 null，不猜", () => {
  assert.equal(extractPlan('{"place":[{"item":"lamp"'), null);
  assert.equal(extractPlan("我摆好了。"), null);
  assert.equal(extractPlan("[1,2,3]"), null);
  assert.equal(extractPlan(null), null);
});

test("模型吐了非 JSON，也会重试而不是当场炸", async (t) => {
  const f = fixture(t);
  const room = f.create();
  let n = 0;
  const r = await decorate({
    roomPlan: room,
    generate: async (prompt) => {
      n += 1;
      if (n === 1) return "我想把沙发放在窗边。";
      assert.match(prompt, /上一次的计划被拒绝了/);
      return { place: [{ item: "sofa", x: 0, y: 0 }] };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

test("收据幂等：同一份改造重放不会摆两遍", async (t) => {
  const f = fixture(t);
  const room = f.create();
  const gen = async () => ({ place: [{ item: "bed", x: 0, y: 0 }] });
  const first = await decorate({ roomPlan: room, generate: gen, receiptId: "deco:1" });
  assert.equal(first.ok, true);
  const again = await decorate({ roomPlan: room, generate: gen, receiptId: "deco:1" });
  assert.equal(again.ok, true);
  assert.equal(again.room.items.length, 1, "重放不该多摆一件");
});

test("提示词里有网格尺寸、现有 uid、目录和格式要求", (t) => {
  const f = fixture(t);
  const room = f.create();
  room.place("rug", 0, 0);
  const prompt = buildPrompt({ room: room.snapshot(), goal: "让窗边更亮堂" });
  assert.match(prompt, /14×9/);
  assert.match(prompt, /r1:/);
  assert.match(prompt, /sofa\(沙发 3×2\)/);
  assert.match(prompt, /只输出一个 JSON 对象/);
  assert.match(prompt, /让窗边更亮堂/);
});

test("错误翻译成人话：越界/重叠/未知/超限各有各的说法", () => {
  assert.match(describeErrors([{ reason: "out-of-bounds", uid: "r2" }]), /r2.*放不下/);
  assert.match(describeErrors([{ reason: "overlap", uid: "r3", with: "r1" }]), /压到了 r1/);
  assert.match(describeErrors([{ reason: "unknown-item", item: "tv" }]), /没有 "tv"/);
  assert.match(describeErrors([{ reason: "unknown-uid", uids: ["r9"] }]), /r9 不存在/);
  assert.match(describeErrors([{ reason: "too-many", count: 30, max: 24 }]), /超过上限 24/);
  assert.equal(describeErrors([]), "");
  assert.equal(describeErrors(null), "");
});

test("非法入参抛错", async (t) => {
  const f = fixture(t);
  const room = f.create();
  await assert.rejects(() => decorate({ roomPlan: null, generate: async () => ({}) }), TypeError);
  await assert.rejects(() => decorate({ roomPlan: room, generate: "nope" }), TypeError);
  await assert.rejects(() => decorate({ roomPlan: room, generate: async () => ({}), maxAttempts: 0 }), TypeError);
  assert.throws(() => buildPrompt({ room: {} }), TypeError);
});
