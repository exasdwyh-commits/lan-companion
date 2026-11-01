// 语音采集：getUserMedia → RMS 电平 → 端点判定 → 交出「一句话」的音频。
//
// 为什么从主进程搬到这里：`ffmpeg -f avfoundation` 只能整段录固定时长，
// 既拿不到 WebAudio 的回声消除/降噪，也不可能做端点检测。要在渲染进程采集，
// 才能「说完就发」而不是「录满 4 秒」。
//
// 分层：本模块只做状态机（何时开录、何时收尾、何时释放麦克风），
// 浏览器 API 全部藏在 env 后面。这样状态机可以在 Node 里用假 env 单测——
// 真麦克风只能验证「有声」，验证不了超时、取消、并发这类分支。
//
// 刻意不做的事：
// - 不裁剪音频首尾静音（要解 webm 再编码，代价大于收益；服务端 vad_filter 会滤）
// - 不做打断（V1 用「她说话时不采集」绕开回声消除，见 VOICE-PLAN 第三节）
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VoiceCapture = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULTS = {
    hopMs: 20,              // 与 voice-endpoint 的帧长一致
    silenceTimeoutMs: 12000,// 点了麦克风却一直不说话，自动收兵（别让指示灯常亮）
    maxListenMs: 60000,     // 冷启动兜底，防止状态机卡在 listening
    minBytes: 2000,         // 小于这个基本是空气，发了也只会转出空串
    constraints: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  };

  // 浏览器侧实现。全部从 scope 取，测试里换成假对象即可。
  function browserEnv(scope) {
    return {
      requestMic(constraints) {
        const devices = scope.navigator && scope.navigator.mediaDevices;
        if (!devices || typeof devices.getUserMedia !== "function") {
          return Promise.reject(new Error("no-media-devices"));
        }
        // 带上 AEC/降噪：V1 不靠它做打断，但能让她说话时残留更少，顺便给 V2 留数据。
        return devices.getUserMedia({ audio: constraints });
      },
      pickMime() {
        const Rec = scope.MediaRecorder;
        if (!Rec || typeof Rec.isTypeSupported !== "function") return "";
        const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
        return candidates.find((type) => Rec.isTypeSupported(type)) || "";
      },
      createMeter(stream) {
        const Ctx = scope.AudioContext || scope.webkitAudioContext;
        const ctx = new Ctx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        // 48k 下 1024 样本约 21ms，正好覆盖一个 20ms 的 hop；再长就会把上一个窗口重复算两次。
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0; // RMS 自己算，别让浏览器再平滑一次
        source.connect(analyser);
        const frame = new Float32Array(analyser.fftSize);
        // 窗口不可见或没有用户手势时 AudioContext 会是 suspended，读出来全是 0。
        // 这里不等 resume()：正常是毫秒级，但万一它挂住，整个 start 就被卡死了；
        // 真挂住的话端点不会触发，12 秒后按超时收兵，用户再点一次即可。
        if (ctx.state === "suspended" && typeof ctx.resume === "function") {
          try { ctx.resume().catch(() => {}); } catch (_) {}
        }
        return {
          ready: Promise.resolve(),
          read() {
            analyser.getFloatTimeDomainData(frame);
            let sum = 0;
            for (let i = 0; i < frame.length; i++) { const v = frame[i]; sum += v * v; }
            return Math.sqrt(sum / frame.length);
          },
          close() {
            try { source.disconnect(); } catch (_) {}
            try { ctx.close(); } catch (_) {}
          },
        };
      },
      createRecorder(stream, mime) {
        const Rec = scope.MediaRecorder;
        if (!Rec) return null;
        // 不能吃默认码率：Chromium 的 opus 默认约 32kbps，实测同一条
        // 「海风很轻 我一直在这里陪你」会被转成「海峰很清」，64k 起才和 wav 一致。
        // 12 秒的 64k webm 约 96KB，不值得为了体积牺牲识别率。
        const options = { audioBitsPerSecond: 64000 };
        if (mime) options.mimeType = mime;
        let recorder;
        try { recorder = new Rec(stream, options); }
        catch (_) { recorder = new Rec(stream, mime ? { mimeType: mime } : undefined); }
        const chunks = [];
        let settle = null;
        const finished = new Promise((resolve) => { settle = resolve; });
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onstop = () => {
          const type = recorder.mimeType || mime || "audio/webm";
          settle({ blob: new scope.Blob(chunks, { type }), mime: type });
        };
        // 出错也要 settle，否则 stop() 永远等不到结果。
        recorder.onerror = () => settle({ blob: null, mime: null });
        return {
          start() { recorder.start(); },
          stop() {
            if (recorder.state === "inactive") return finished;
            try { recorder.stop(); } catch (_) { return Promise.resolve({ blob: null, mime: null }); }
            return finished;
          },
          close() {
            try { if (recorder.state !== "inactive") recorder.stop(); } catch (_) {}
          },
        };
      },
      stopStream(stream) {
        try { stream.getTracks().forEach((track) => track.stop()); } catch (_) {}
      },
      /**
       * 这只麦克风**实际**有没有开回声消除。
       *
       * 为什么不能信 constraints：传 `echoCancellation: true` 只是「请求」，浏览器可以
       * 忽略（设备不支持、系统层被别的进程独占、或者只有单声道以外的情况下拒绝）。
       * 参考实现 AIri 就是这么做的 —— 读 track 的真实设置，有 AEC 才允许「边说话边听」
       * （ref/airi-v0.14.1 packages/audio/src/browser/sources.ts:135-137，
       * 以及 stage-ui/src/stores/voice.ts:575 的 acceptSpeech 门）。
       * 这是把「AEC 到底有没有用」从待验证的问题，变成一个运行时能问出来的事实。
       */
      micCapabilities(stream) {
        try {
          const track = stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
          const s = track && typeof track.getSettings === "function" ? (track.getSettings() || {}) : {};
          return {
            echoCancellation: s.echoCancellation === true,
            noiseSuppression: s.noiseSuppression === true,
            autoGainControl: s.autoGainControl === true,
            sampleRate: s.sampleRate || 0,
            channelCount: s.channelCount || 0,
          };
        } catch (_) {
          return { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        }
      },
      now() {
        const perf = scope.performance;
        return perf && typeof perf.now === "function" ? perf.now() : Date.now();
      },
      setInterval(fn, ms) { return scope.setInterval(fn, ms); },
      clearInterval(id) { return scope.clearInterval(id); },
    };
  }

  function classifyMicError(error) {
    const name = (error && error.name) || "";
    if (name === "NotAllowedError" || name === "SecurityError") return "denied";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "no-device";
    if (name === "NotReadableError") return "busy";
    if (String((error && error.message) || "").indexOf("no-media-devices") >= 0) return "unsupported";
    return "unknown";
  }

  // options.env       自定义环境（测试用）
  // options.endpoint  已有端点实例（不传则按 endpointOptions 新建）
  function createVoiceCapture(options = {}) {
    const cfg = { ...DEFAULTS, ...options };
    const env = cfg.env || browserEnv(typeof globalThis !== "undefined" ? globalThis : {});
    const emit = {
      state: cfg.onState || (() => {}),
      speechStart: cfg.onSpeechStart || (() => {}),
      utterance: cfg.onUtterance || (() => {}),
      discard: cfg.onDiscard || (() => {}),
      end: cfg.onEnd || (() => {}),
      error: cfg.onError || (() => {}),
    };

    let state = "idle";   // idle → starting → listening → stopping → idle
    let session = null;
    let capabilities = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    // 每次 start 领一个号，cancel 时作废它。没有这个的话，
    // 「点了麦克风又立刻取消」会等 getUserMedia 慢慢返回、然后把采集又开起来。
    let generation = 0;

    function resolveEndpoint() {
      if (cfg.endpoint) return cfg.endpoint;
      // 渲染进程靠 <script> 注入的全局；Node 里（测试/主进程复用）走相对路径：
      // 本文件在 web/live2d/，端点在 lib/，所以是 ../../lib。
      const api = typeof VoiceEndpoint !== "undefined" ? VoiceEndpoint
        : (typeof require === "function" ? require("../../lib/voice-endpoint") : null);
      if (!api) throw new Error("voice-endpoint 未加载：请先引入 voice-endpoint.js");
      return api.createVoiceEndpoint({ hopMs: cfg.hopMs, ...(cfg.endpointOptions || {}) });
    }

    function teardown() {
      if (!session) return;
      const current = session;
      session = null;
      if (current.timer) { try { env.clearInterval(current.timer); } catch (_) {} }
      try { current.meter && current.meter.close(); } catch (_) {}
      try { current.recorder && current.recorder.close(); } catch (_) {}
      // 必须停 track：macOS 的麦克风指示灯只认这个，不 close 会一直亮着。
      try { env.stopStream(current.stream); } catch (_) {}
    }

    function setState(next) {
      if (state === next) return;
      state = next;
      emit.state(next);
    }

    async function finish(reason, detail) {
      if (state === "stopping" || state === "idle" || !session) return;
      setState("stopping");
      const current = session;
      if (current.timer) { try { env.clearInterval(current.timer); } catch (_) {} current.timer = null; }
      const grab = current.discard ? Promise.resolve({ blob: null, mime: null }) : current.recorder.stop();
      let audio = null;
      try { audio = await grab; } catch (_) { audio = { blob: null, mime: null }; }
      const elapsed = Math.max(0, Math.round(env.now() - current.startedAt));
      teardown();
      setState("idle");
      const usable = audio && audio.blob && audio.blob.size >= cfg.minBytes;
      if (reason === "utterance" && usable) {
        emit.utterance({
          blob: audio.blob,
          mime: audio.mime,
          durationMs: elapsed,
          voicedMs: detail ? detail.voicedMs : 0,
        });
      } else if (reason === "utterance") {
        emit.discard({ reason: "empty", durationMs: elapsed });
      }
      emit.end({ reason: usable && reason === "utterance" ? "utterance" : reason, durationMs: elapsed });
    }

    function tick() {
      if (!session || state !== "listening") return;
      const now = env.now();
      let level = 0;
      try { level = session.meter.read(); } catch (_) { level = 0; }
      let event = null;
      try { event = session.endpoint.push(level, now - session.startedAt); } catch (_) { event = null; }

      if (event) {
        if (event.type === "speech-start") {
          session.spokeAt = now;
          emit.speechStart({ at: now - session.startedAt });
        } else if (event.type === "utterance") {
          finish("utterance", event);
          return;
        } else if (event.type === "discard") {
          // 太短的一声不提交，但要告诉上层「听到了、没算数」——
          // 否则用户会以为麦克风坏了，而实际上只是他咳了一下。
          session.discards += 1;
          emit.discard({ reason: event.reason || "too-short", durationMs: event.durationMs });
        }
      }
      // 说完了就不再等：从「最后一次有声」算起，不是从开始录音算。
      const idleSince = session.spokeAt || session.startedAt;
      if (now - idleSince > cfg.silenceTimeoutMs) { finish("silence-timeout"); return; }
      if (now - session.startedAt > cfg.maxListenMs) { finish("max"); return; }
    }

    async function start() {
      if (state !== "idle") return { ok: false, err: "busy" };
      const own = ++generation;
      setState("starting");
      let stream = null;
      try {
        stream = await env.requestMic(cfg.constraints);
      } catch (error) {
        setState("idle");
        emit.error({ code: classifyMicError(error), message: String((error && error.message) || error) });
        return { ok: false, err: classifyMicError(error) };
      }
      // 授权弹窗可能停好几秒，期间用户完全可能已经放弃。
      if (own !== generation) {
        try { env.stopStream(stream); } catch (_) {}
        return { ok: false, err: "cancelled" };
      }
      // 每次拿到流都重新问一次：换设备、插耳机、系统改设置都会变。
      if (typeof env.micCapabilities === "function") {
        try { capabilities = env.micCapabilities(stream) || capabilities; } catch (_) {}
      }
      let meter = null;
      let recorder = null;
      let endpoint = null;
      try {
        endpoint = resolveEndpoint();
        meter = env.createMeter(stream);
        if (meter && meter.ready) await meter.ready;
        recorder = env.createRecorder(stream, env.pickMime ? env.pickMime() : "");
        if (!recorder) throw new Error("no-recorder");
      } catch (error) {
        try { env.stopStream(stream); } catch (_) {}
        setState("idle");
        emit.error({ code: "unsupported", message: String((error && error.message) || error) });
        return { ok: false, err: "unsupported" };
      }
      if (own !== generation) {
        try { env.stopStream(stream); } catch (_) {}
        return { ok: false, err: "cancelled" };
      }
      session = {
        stream, meter, recorder, endpoint,
        startedAt: env.now(),
        spokeAt: 0,
        discards: 0,
        discard: false,
        timer: null,
      };
      try { recorder.start(); } catch (_) {}
      session.timer = env.setInterval(tick, cfg.hopMs);
      setState("listening");
      return { ok: true, capabilities };
    }

    function cancel() {
      if (state === "idle") return false;
      if (state === "stopping") return true;
      generation += 1;
      if (state === "starting") { setState("idle"); return true; }
      if (session) session.discard = true;
      finish("cancelled");
      return true;
    }

    return {
      start,
      cancel,
      get state() { return state; },
      get listening() { return state === "listening"; },
      /** 这只麦克风的真实能力（echoCancellation 是否真的生效）。开麦前是默认值。 */
      get capabilities() { return { ...capabilities }; },
    };
  }

  return { createVoiceCapture, browserEnv, classifyMicError, DEFAULTS };
});
