"use strict";
/**
 * 把朗读稿合成成一条音轨。
 *
 * 单段 → 直接交给 synthesizeVoice；多段 → 逐句用不同音色合成，再用 ffmpeg 拼起来。
 * 抽成独立模块是为了能在不启动 Electron 的情况下拿真 TTS 跑验收。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const NARRATION = require("./narration");

/** 角色 → VoiceDesign 的 instruct。旁白返回 undefined，由调用方用她自己的音色。 */
function scriptInstruct(who, cast) {
  if (!who || who === "narr") return undefined;
  const entry = cast && cast[who];
  const voice = entry && NARRATION.VOICE_POOL[entry.voice];
  return voice ? voice.instruct : undefined;
}

/**
 * 拼音轨。TTS 每条尾巴会带 0~1 秒不等的静音，直接 concat 会让角色之间停顿越来越长，
 * 所以每段先裁掉首尾静音（留 0.05s 头 / 0.28s 尾当作换气的间隔），再一次拼起来。
 * 裁尾巴用「倒放 → 裁头 → 再倒放」这个写法，比 stop_periods 可控，不会误伤句中的停顿。
 */
function concatMp3(ffmpeg, files, out) {
  return new Promise((resolve, reject) => {
    if (!files.length) return reject(new Error("没有可拼接的音频"));
    const args = [];
    for (const f of files) args.push("-i", f);
    const graph = files.map((_, i) =>
      `[${i}:a]silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,` +
      `areverse,silenceremove=start_periods=1:start_silence=0.28:start_threshold=-45dB,areverse[a${i}]`
    ).join(";") + ";" + files.map((_, i) => `[a${i}]`).join("") +
      `concat=n=${files.length}:v=0:a=1[out]`;
    args.push("-filter_complex", graph, "-map", "[out]", "-codec:a", "libmp3lame", "-q:a", "4", "-y", out);
    execFile(ffmpeg, args, { timeout: 120000 }, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * 受控并发：一次最多跑 limit 个，结果仍按输入顺序返回。
 * 不用 Promise.all(list.map(...)) 全丢 —— 本地 TTS 服务并发一高就顶到显存。
 */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const lanes = [];
  const width = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < width; i++) {
    lanes.push((async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await worker(items[index], index);
      }
    })());
  }
  await Promise.all(lanes);
  return out;
}

function createVoiceScript({ synthesize, ffmpeg }) {
  if (typeof synthesize !== "function") throw new Error("缺少 synthesize");
  return async function synthesizeScript(segments, cast, options = {}) {
    const list = (Array.isArray(segments) ? segments : [])
      .filter((s) => s && typeof s.say === "string" && s.say.trim());
    if (!list.length) return { audio: null, via: "none", ms: 0 };
    const T0 = Date.now();
    if (list.length === 1) {
      const sp = await synthesize(list[0].say, { ...options, instruct: scriptInstruct(list[0].who, cast) });
      return { ...sp, ms: sp.ms || Date.now() - T0 };
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "narr-"));
    try {
      const files = [];
      const parts = [];
      // 实测结论（2026-10-31，真实 Qwen3-TTS 而非 mock 计时）：
      // 服务端推理已加串行锁（MLX/MPS 并发推理不安全），客户端并发不再有收益 ——
      // 3 句并发要排队 7.8s，串行只要约 6s，反而更慢。
      // 之前「6 句 900ms → 333ms」是 mock（setTimeout 150ms）测出来的，不成立。
      // 保留 mapLimit 是为将来服务端支持批处理时能直接调大，默认走串行。
      const lanes = Math.max(1, Math.min(Number(options.concurrency) || 1, list.length));
      const spoken = await mapLimit(list, lanes, (seg) =>
        synthesize(seg.say, { ...options, instruct: scriptInstruct(seg.who, cast) }),
      );
      for (let i = 0; i < spoken.length; i++) {
        const sp = spoken[i];
        if (!sp || !sp.audio) return { audio: null, via: (sp && sp.via) || "none", ms: Date.now() - T0, error: `第 ${i + 1} 句没能合成` };
        const file = path.join(dir, String(i).padStart(3, "0") + ".mp3");
        fs.writeFileSync(file, Buffer.from(sp.audio, "base64"));
        files.push(file);
        parts.push(list[i].who);
      }
      const out = path.join(dir, "out.mp3");
      await concatMp3(ffmpeg, files, out);
      return { audio: fs.readFileSync(out).toString("base64"), via: "qwen3-script", ms: Date.now() - T0, parts };
    } catch (e) {
      return { audio: null, via: "none", ms: Date.now() - T0, error: e.message };
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
  };
}

module.exports = { createVoiceScript, scriptInstruct, concatMp3 };
