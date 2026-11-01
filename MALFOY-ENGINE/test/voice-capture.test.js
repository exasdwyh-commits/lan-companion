"use strict";

// voice-capture 的状态机测试。
//
// 这些分支真麦克风验不出来：超时要等 12 秒、取消要赶在授权弹窗中途、
// 噪声底漂移要靠特定电平序列。所以 env 全部用假的，只推电平与时间。
const test = require("node:test");
const assert = require("node:assert");

const { createVoiceCapture, classifyMicError } = require("../web/live2d/voice-capture");

const QUIET = 0.001;
const VOICE = 0.05;

function flush() {
  // finish() 里有两层 await（recorder.stop 的 promise + 自身），一轮宏任务足够。
  return new Promise((resolve) => setImmediate(resolve));
}

function makeEnv({ mic = "ok", levelOf = () => 0 } = {}) {
  const timers = new Map();
  let nextId = 1;
  const env = {
    time: 0,
    stopped: 0,
    closedMeters: 0,
    levelOf,
    pendingMic: null,
    now() { return env.time; },
    setInterval(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
    get activeTimers() { return timers.size; },
    advance(ms) { env.time += ms; for (const fn of [...timers.values()]) fn(); },
    run(steps, stepMs = 20) { for (let i = 0; i < steps; i++) env.advance(stepMs); },
    makeStream() {
      return {
        getTracks: () => [{ stop() { env.stopped += 1; } }],
      };
    },
    requestMic() {
      if (mic === "denied") {
        const error = new Error("Permission denied");
        error.name = "NotAllowedError";
        return Promise.reject(error);
      }
      if (mic === "deferred") {
        return new Promise((resolve) => { env.pendingMic = () => resolve(env.makeStream()); });
      }
      return Promise.resolve(env.makeStream());
    },
    releaseMic() { env.pendingMic(); env.pendingMic = null; },
    pickMime() { return "audio/webm;codecs=opus"; },
    createMeter() {
      return {
        ready: Promise.resolve(),
        read: () => env.levelOf(env.time),
        close() { env.closedMeters += 1; },
      };
    },
    createRecorder() {
      return {
        start() {},
        stop() { return Promise.resolve({ blob: { size: 8000 }, mime: "audio/webm;codecs=opus" }); },
        close() {},
      };
    },
    stopStream(stream) { stream.getTracks().forEach((track) => track.stop()); },
  };
  return env;
}

function makeCapture(env, extra = {}) {
  const events = [];
  const capture = createVoiceCapture({
    env,
    endpointOptions: { warmupMs: 200 },
    onState: (state) => events.push({ type: "state", state }),
    onSpeechStart: () => events.push({ type: "speech-start" }),
    onUtterance: (payload) => events.push({ type: "utterance", payload }),
    onDiscard: (payload) => events.push({ type: "discard", payload }),
    onEnd: (payload) => events.push({ type: "end", payload }),
    onError: (payload) => events.push({ type: "error", payload }),
    ...extra,
  });
  return { capture, events };
}

test("点了麦克风一直不说话：超时收兵并释放麦克风", async () => {
  const env = makeEnv({ levelOf: () => QUIET });
  const { capture, events } = makeCapture(env);
  // start() 现在还会带回麦克风能力，所以只断言成功与否
  assert.equal((await capture.start()).ok, true);
  assert.equal(capture.state, "listening");

  env.run(700); // 14 秒，越过 silenceTimeoutMs(12000)
  await flush();

  assert.equal(capture.state, "idle");
  assert.equal(events.filter((e) => e.type === "utterance").length, 0);
  assert.equal(events.find((e) => e.type === "end").payload.reason, "silence-timeout");
  assert.equal(env.stopped, 1, "超时后必须停 track，否则系统麦克风灯一直亮");
  assert.equal(env.closedMeters, 1);
  assert.equal(env.activeTimers, 0, "定时器必须清掉");
});

test("说完一句：判定端点、交出音频、释放麦克风", async () => {
  // 底噪 0.001 → 起录阈值 0.004；说话 0.05 远高于它
  const env = makeEnv({ levelOf: (t) => (t < 1000 ? QUIET : t < 2000 ? VOICE : QUIET) });
  const { capture, events } = makeCapture(env);
  await capture.start();

  env.run(65);   // 到 1.3s：200ms 预热 + 300ms 起录判定，应已 speech-start
  assert.equal(events.filter((e) => e.type === "speech-start").length, 1);

  env.run(60);   // 到 2.5s：说话 2.0s 结束 + 尾部静音 > 450ms
  await flush();

  const utterance = events.find((e) => e.type === "utterance");
  assert.ok(utterance, "应当交出一句话");
  assert.equal(utterance.payload.mime, "audio/webm;codecs=opus");
  assert.ok(utterance.payload.voicedMs >= 600, "有声时长应被累计");
  assert.ok(utterance.payload.durationMs > 0);
  assert.equal(events.find((e) => e.type === "end").payload.reason, "utterance");
  assert.equal(capture.state, "idle");
  assert.equal(env.stopped, 1);
});

test("太短的一声（咳嗽、碰麦）不提交，之后正常说话仍能识别", async () => {
  // 350ms 有声 → 不够 600ms 累计，判为 discard；然后静音；再说 1 秒
  const env = makeEnv({
    levelOf: (t) => {
      if (t < 400) return QUIET;
      if (t < 750) return VOICE;    // 350ms
      if (t < 2000) return QUIET;
      return t < 3000 ? VOICE : QUIET;
    },
  });
  const { capture, events } = makeCapture(env);
  await capture.start();

  env.run(65);   // 到 1.3s：discard 已发生
  await flush();
  assert.equal(events.filter((e) => e.type === "discard").length, 1);
  assert.equal(events.filter((e) => e.type === "utterance").length, 0);
  assert.equal(capture.state, "listening", "丢弃一次不等于结束，应该继续听");

  env.run(110);  // 到 3.5s：第二句收尾
  await flush();
  assert.equal(events.filter((e) => e.type === "utterance").length, 1);
});

test("取消：不交出音频，但状态与麦克风都要收干净", async () => {
  const env = makeEnv({ levelOf: () => VOICE });
  const { capture, events } = makeCapture(env);
  await capture.start();
  env.run(30);

  assert.equal(capture.cancel(), true);
  await flush();

  assert.equal(capture.state, "idle");
  assert.equal(events.filter((e) => e.type === "utterance").length, 0);
  assert.equal(events.find((e) => e.type === "end").payload.reason, "cancelled");
  assert.equal(env.stopped, 1);
  assert.equal(env.activeTimers, 0);
});

test("授权弹窗还没回就取消：不会再偷偷把采集开起来", async () => {
  const env = makeEnv({ mic: "deferred", levelOf: () => VOICE });
  const { capture, events } = makeCapture(env);

  const starting = capture.start();
  assert.equal(capture.state, "starting");
  capture.cancel();
  env.releaseMic();

  assert.deepEqual(await starting, { ok: false, err: "cancelled" });
  assert.equal(capture.state, "idle");
  assert.equal(env.stopped, 1, "拿到的流必须立刻停掉");
  assert.equal(events.filter((e) => e.type === "state" && e.state === "listening").length, 0);
});

test("麦克风被拒绝：报明确的错误码，状态回到 idle", async () => {
  const env = makeEnv({ mic: "denied" });
  const { capture, events } = makeCapture(env);
  const result = await capture.start();
  assert.equal(result.ok, false);
  assert.equal(events.find((e) => e.type === "error").payload.code, "denied");
  assert.equal(capture.state, "idle");

  // 拒绝之后还能再试一次，不能卡在 starting
  assert.equal((await capture.start()).ok, false);
});

test("重复调用 start 不会开出第二路采集", async () => {
  const env = makeEnv({ levelOf: () => QUIET });
  const { capture } = makeCapture(env);
  await capture.start();
  assert.deepEqual(await capture.start(), { ok: false, err: "busy" });
  assert.equal(env.stopped, 0);
  capture.cancel();
  await flush();
});

test("错误码归类覆盖常见权限异常", () => {
  assert.equal(classifyMicError({ name: "NotAllowedError" }), "denied");
  assert.equal(classifyMicError({ name: "SecurityError" }), "denied");
  assert.equal(classifyMicError({ name: "NotFoundError" }), "no-device");
  assert.equal(classifyMicError({ name: "NotReadableError" }), "busy");
  assert.equal(classifyMicError(new Error("no-media-devices")), "unsupported");
  assert.equal(classifyMicError(new Error("boom")), "unknown");
});

// ── AEC 能力探测 ────────────────────────────────────────────────
// constraints 里写 echoCancellation:true 只是「请求」，浏览器可以不理。
// 上层要靠这个结果决定能不能「她说话时也听着」，所以它必须是真实设置的回读。

test("开麦后拿到真实的 AEC 状态，并随 start 一起返回", async () => {
  const env = makeEnv({ levelOf: () => QUIET });
  env.micCapabilities = () => ({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  const { capture } = makeCapture(env);
  const started = await capture.start();
  assert.equal(started.ok, true);
  assert.equal(started.capabilities.echoCancellation, true);
  assert.equal(capture.capabilities.echoCancellation, true);
  capture.cancel();
  await flush();
});

test("没有能力探测接口时默认按「没有 AEC」处理", async () => {
  const env = makeEnv({ levelOf: () => QUIET });
  delete env.micCapabilities;
  const { capture } = makeCapture(env);
  const started = await capture.start();
  assert.equal(started.capabilities.echoCancellation, false, "拿不到就当没有，不能乐观假设");
  capture.cancel();
  await flush();
});

test("能力探测抛错不能把开麦搞挂", async () => {
  const env = makeEnv({ levelOf: () => QUIET });
  env.micCapabilities = () => { throw new Error("getSettings 不可用"); };
  const { capture } = makeCapture(env);
  const started = await capture.start();
  assert.equal(started.ok, true, "探测失败只是缺信息，不该阻止录音");
  assert.equal(started.capabilities.echoCancellation, false);
  capture.cancel();
  await flush();
});
