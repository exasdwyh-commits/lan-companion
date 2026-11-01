"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVoiceEndpoint, DEFAULTS } = require("../lib/voice-endpoint");

const SILENCE = 0.001;
const SPEECH = 0.05;
const HOP = DEFAULTS.hopMs;

// 喂 n 帧同一电平，收集期间产生的事件
function feed(ep, level, frames, sink = []) {
  for (let i = 0; i < frames; i++) {
    const event = ep.push(level);
    if (event) sink.push(event);
  }
  return sink;
}

// 跨过 500ms warmup，让检测器进入 idle
function warm(ep) {
  return Math.ceil(DEFAULTS.warmupMs / HOP);
}

test("纯静音不产生任何事件", () => {
  const ep = createVoiceEndpoint();
  const events = feed(ep, SILENCE, 200);
  assert.deepEqual(events, []);
  assert.equal(ep.snapshot().state, "idle");
});

test("说完一句：起录点正确，尾静音 450ms 收尾", () => {
  const ep = createVoiceEndpoint();
  const events = [];
  feed(ep, SILENCE, warm(ep), events);
  feed(ep, SPEECH, 50, events);   // 1000ms 有声
  feed(ep, SILENCE, 30, events);

  assert.equal(events.length, 2, "应只有 speech-start 与 utterance");
  const [start, utterance] = events;
  assert.equal(start.type, "speech-start");
  assert.equal(start.at, 500, "起录点应指回第一帧有声，而不是满足 300ms 的时刻");
  assert.equal(utterance.type, "utterance");
  assert.equal(utterance.reason, "silence");
  assert.equal(utterance.voicedMs, 1000);
  assert.equal(utterance.startAt, start.at);
  assert.equal(utterance.endAt - utterance.startAt, 1460);
});

test("短促杂音（100ms）不触发起录", () => {
  const ep = createVoiceEndpoint();
  const events = [];
  feed(ep, SILENCE, warm(ep), events);
  feed(ep, SPEECH, 5, events);
  feed(ep, SILENCE, 100, events);
  assert.deepEqual(events, [], "不足 300ms 连续有声，应当整体忽略");
});

test("有声不足 600ms 判为 discard，不当作一句话", () => {
  const ep = createVoiceEndpoint();
  const events = [];
  feed(ep, SILENCE, warm(ep), events);
  feed(ep, SPEECH, 20, events);   // 400ms
  feed(ep, SILENCE, 30, events);

  assert.equal(events.length, 2);
  assert.equal(events[0].type, "speech-start");
  assert.equal(events[1].type, "discard");
  assert.equal(events[1].reason, "too-short");
  assert.equal(events[1].voicedMs, 400);
});

test("句中换气 300ms 不切断，仍是一句话", () => {
  const ep = createVoiceEndpoint();
  const events = [];
  feed(ep, SILENCE, warm(ep), events);
  feed(ep, SPEECH, 40, events);
  feed(ep, SILENCE, 15, events);  // 300ms < 450ms 尾静音阈值
  feed(ep, SPEECH, 40, events);
  feed(ep, SILENCE, 30, events);

  const utterances = events.filter((e) => e.type === "utterance");
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].voicedMs, 1600);
});

test("说到超时被兜底切断", () => {
  const ep = createVoiceEndpoint();
  const events = [];
  feed(ep, SILENCE, warm(ep), events);
  feed(ep, SPEECH, 900, events);

  const utterances = events.filter((e) => e.type === "utterance");
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].reason, "max");
  assert.ok(utterances[0].durationMs >= DEFAULTS.maxUtteranceMs);
});

test("连续两句都能各自识别", () => {
  const ep = createVoiceEndpoint();
  const events = [];
  feed(ep, SILENCE, warm(ep), events);
  feed(ep, SPEECH, 40, events);
  feed(ep, SILENCE, 30, events);
  feed(ep, SPEECH, 40, events);
  feed(ep, SILENCE, 30, events);

  const utterances = events.filter((e) => e.type === "utterance");
  assert.equal(utterances.length, 2);
  assert.ok(utterances[1].startAt > utterances[0].endAt, "第二句应在上句之后");
});

test("环境噪声缓慢升高时噪声底跟随，不误触发", () => {
  const ep = createVoiceEndpoint();
  const events = [];
  feed(ep, 0.0015, warm(ep), events);
  // 从 0.002 缓慢升到 0.02，模拟风扇渐起
  for (let i = 0; i < 200; i++) {
    const level = 0.002 + (0.018 * i) / 200;
    const event = ep.push(level);
    if (event) events.push(event);
  }
  assert.deepEqual(events, [], "噪声渐起不该产生任何事件（含 speech-start）");
  assert.ok(ep.snapshot().floor > 0.01, "噪声底应当跟上来");
});

test("说话期间噪声底冻结，不被说话声拉高", () => {
  const ep = createVoiceEndpoint();
  feed(ep, SILENCE, warm(ep));
  const before = ep.snapshot().floor;
  feed(ep, SPEECH, 60);
  assert.equal(ep.snapshot().floor, before, "speech 状态下不得更新噪声底");
});

test("reset 后回到 warmup，可重新开始", () => {
  const ep = createVoiceEndpoint();
  const events = [];
  feed(ep, SILENCE, warm(ep), events);
  feed(ep, SPEECH, 40, events);
  ep.reset();
  assert.equal(ep.snapshot().state, "warmup");
  assert.equal(ep.snapshot().voicedMs, 0);

  const after = [];
  feed(ep, SILENCE, warm(ep), after);
  feed(ep, SPEECH, 40, after);
  feed(ep, SILENCE, 30, after);
  assert.equal(after.filter((e) => e.type === "utterance").length, 1);
});
