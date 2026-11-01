// 语音端点检测：把逐帧 RMS 变成「说完一句」的事件流。
//
// 双端可用：主进程 require 得到对象；渲染进程用 <script> 加载后得到
// window.VoiceEndpoint。与 companion-playback.js 同一套 UMD 写法——阈值逻辑
// 只该有一份，浏览器侧再抄一遍必然漂。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VoiceEndpoint = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 纯逻辑、无浏览器 API、无 I/O —— 只吃电平，吐事件。
  // 采集层（web/live2d/voice-capture.js）负责 getUserMedia 与录音，这里只判边界。
  //
  // 为什么不直接用 Silero VAD：本机安静房间用 RMS + 自适应噪声底就够，
  // 引 onnxruntime-web（10MB+）对发布包太重。误触发率不够时再换，接口不变。
  //
  // 阈值策略（滞回，避免话音刚落就复触发）：
  //   起录  = max(minAbsRms, 噪声底 × startRatio)
  //   续录  = max(minAbsRms × 0.8, 噪声底 × holdRatio)   —— 比起录低，说话中间的换气不切断
  //   噪声底在 warmup 取中位数，之后只在「安静帧」上慢速跟随；说话期间冻结，
  //   否则她会把自己说话的尾巴学成噪声底，越说越钝。

  const DEFAULTS = {
    hopMs: 20,            // 每帧时长
    warmupMs: 500,        // 用前 500ms 估噪声底
    startHoldMs: 300,     // 连续有声多久才算「开始说话」
    endSilenceMs: 450,    // 尾部静音多久算「说完了」
    minUtteranceMs: 600,  // 累计有声不足则丢弃（咳嗽、碰麦）
    maxUtteranceMs: 15000,// 兜底，防止一直说下去不切断
    startRatio: 2.6,
    holdRatio: 1.7,
    minAbsRms: 0.004,     // 绝对下限，避免死寂时噪声底接近 0 导致任何抖动都触发
    floorRiseAlpha: 0.02, // 噪声底上升慢（风扇渐起）；时间常数约 1 秒，跟得上 4 秒内的渐变
    floorFallAlpha: 0.05, // 下降快（环境突然安静）
  };

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function createVoiceEndpoint(options = {}) {
    const cfg = { ...DEFAULTS, ...options };
    const hop = cfg.hopMs;

    let state = "warmup";        // warmup → idle → speech → idle
    let t = 0;                   // 当前帧结束时刻（ms）
    let floor = 0;
    let warmupSamples = [];

    let candidateVoicedMs = 0;
    let candidateStartAt = 0;

    let utteranceStartAt = 0;
    let voicedMs = 0;
    let trailingSilenceMs = 0;
    let frozenFloor = 0;

    function startThreshold() { return Math.max(cfg.minAbsRms, floor * cfg.startRatio); }
    function holdThreshold() { return Math.max(cfg.minAbsRms * 0.8, frozenFloor * cfg.holdRatio); }

    function reset() {
      state = "warmup";
      t = 0;
      floor = 0;
      warmupSamples = [];
      candidateVoicedMs = 0;
      candidateStartAt = 0;
      utteranceStartAt = 0;
      voicedMs = 0;
      trailingSilenceMs = 0;
      frozenFloor = 0;
    }

    function finish(reason) {
      const event = {
        type: voicedMs >= cfg.minUtteranceMs ? "utterance" : "discard",
        startAt: utteranceStartAt,
        endAt: t,
        durationMs: t - utteranceStartAt,
        voicedMs,
        reason: voicedMs >= cfg.minUtteranceMs ? reason : "too-short",
      };
      state = "idle";
      candidateVoicedMs = 0;
      voicedMs = 0;
      trailingSilenceMs = 0;
      return event;
    }

    // push(rms) → 事件或 null。rms 为归一化到 0..1 的均方根电平。
    function push(rms, atMs) {
      const level = Number.isFinite(rms) && rms > 0 ? rms : 0;
      t = Number.isFinite(atMs) ? atMs : t + hop;

      if (state === "warmup") {
        warmupSamples.push(level);
        if (t >= cfg.warmupMs || warmupSamples.length * hop >= cfg.warmupMs) {
          floor = median(warmupSamples);
          warmupSamples = [];
          state = "idle";
        }
        return null;
      }

      if (state === "idle") {
        // 只在「不会触发起录」的安静帧上跟随噪声底。
        // 早先按 holdThreshold 判，结果环境音缓慢升高时门槛跟着抬高、跟随即刻停止，
        // 噪声底会锁死在低位，风扇一起就误触发。改按 startThreshold 判才对。
        if (level < startThreshold()) {
          floor += (level - floor) * (level > floor ? cfg.floorRiseAlpha : cfg.floorFallAlpha);
        }
        if (level > startThreshold()) {
          if (candidateVoicedMs === 0) candidateStartAt = t - hop;
          candidateVoicedMs += hop;
          if (candidateVoicedMs >= cfg.startHoldMs) {
            state = "speech";
            utteranceStartAt = candidateStartAt;
            voicedMs = candidateVoicedMs;
            trailingSilenceMs = 0;
            frozenFloor = floor;
            candidateVoicedMs = 0;
            return { type: "speech-start", at: utteranceStartAt };
          }
        } else {
          candidateVoicedMs = 0;
        }
        return null;
      }

      // state === "speech"：噪声底冻结，只判续录与收尾
      if (level > holdThreshold()) {
        voicedMs += hop;
        trailingSilenceMs = 0;
      } else {
        trailingSilenceMs += hop;
      }

      if (trailingSilenceMs >= cfg.endSilenceMs) return finish("silence");
      if (t - utteranceStartAt >= cfg.maxUtteranceMs) return finish("max");
      return null;
    }

    function snapshot() {
      return {
        state,
        t,
        floor: Number(floor.toFixed(5)),
        startThreshold: Number(startThreshold().toFixed(5)),
        holdThreshold: Number(holdThreshold().toFixed(5)),
        candidateVoicedMs,
        voicedMs,
        trailingSilenceMs,
        utteranceStartAt,
      };
    }

    return { push, reset, snapshot, config: { ...cfg } };
  }

  return { createVoiceEndpoint, DEFAULTS };
});
