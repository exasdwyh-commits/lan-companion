#!/usr/bin/env node
"use strict";
// 端到端语音链路实测：一段「用户语音」→ STT → 流式 LLM → 切句 → 逐句 TTS → 排播时间轴。
//
// 覆盖不了的部分：getUserMedia 采集、端点检测、舞台播放（都在 Electron 渲染进程里，
// 需要真麦克风和真窗口）。这里从「voice-capture 交出 webm/opus 的那一刻」开始，
// 后面的每一跳都是线上同一份代码、同一批服务。
//
// 为什么要这个脚本：单测只能证明函数对，不能回答「说完到听见第一声到底几秒」。
// 而那个数字由四段串行相加决定，只有真打一次才算得出来。
//
// 用法：
//   node scripts/e2e-voice-check.js              # 默认两轮（短问 + 长问）
//   node scripts/e2e-voice-check.js --rounds 3
//   node scripts/e2e-voice-check.js --json out.json

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const ENGINE = path.join(__dirname, "..", "MALFOY-ENGINE");
const { config, MODEL_POOL, findFfmpeg } = require(path.join(ENGINE, "lib/config"));
const { createReplySplitter } = require(path.join(ENGINE, "lib/reply-splitter"));
const IDENTITY = require(path.join(ENGINE, "lib/identity"));
const { ChatRouter } = require(path.join(ENGINE, "lib/chat-router"));
const { streamOnce } = require(path.join(ENGINE, "lib/llm-stream"));
const { looksDangling } = require(path.join(ENGINE, "lib/utterance-tail"));

const FFMPEG = findFfmpeg();
const FFPROBE = path.join(path.dirname(FFMPEG), "ffprobe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-voice-"));

// 客户端把 webm 封包 + IPC 交给主进程，实测约 50~80ms。这里用常量占位，
// 免得把「音频长度」当成「说完时刻」而让结果偏乐观。
const SEND_MS = 60;

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const ROUNDS = Number(argOf("--rounds", 2));
const JSON_OUT = argOf("--json", "");

// ── 小工具 ─────────────────────────────────────────────────────────
function run(bin, argv) {
  try {
    return execFileSync(bin, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return "";
  }
}

function duration(file) {
  const out = run(FFPROBE, ["-v", "error", "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1", file]);
  const n = parseFloat(String(out).trim());
  return Number.isFinite(n) ? n : 0;
}

function postFile(url, file, mime) {
  const t0 = Date.now();
  const out = run("curl", ["-sS", "-m", "30", "--noproxy", "*", "-X", "POST",
    "-H", "Content-Type: " + mime, "--data-binary", "@" + file, url]);
  const ms = Date.now() - t0;
  try { return { json: JSON.parse(out), ms }; } catch (_) { return { json: null, ms }; }
}

/** 合成一句 → wav 路径 + 耗时 + 音频时长 */
function tts(text, instruct) {
  const body = JSON.stringify({ text, instruct });
  const wav = path.join(TMP, "tts-" + Math.random().toString(36).slice(2) + ".wav");
  const t0 = Date.now();
  run("curl", ["-f", "-sS", "-m", "25", "--noproxy", "*", "-X", "POST",
    "-H", "Content-Type: application/json", "-d", body, "-o", wav, config.ttsQwenUrl]);
  const synthMs = Date.now() - t0;
  let ok = false;
  try { ok = fs.existsSync(wav) && fs.statSync(wav).size > 2000; } catch (_) {}
  return { ok, synthMs, durSec: ok ? duration(wav) : 0, file: wav };
}

/** 和 main.js 里同源的 persona（data.js → vm） */
function personaObj() {
  try {
    const vm = require("vm");
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ENGINE, "web", "data.js"), "utf8"), sandbox);
    return (sandbox.window.MALFOY || {}).persona || {};
  } catch (_) { return {}; }
}

const VOICE_HINT = "\n\n（用户这一条是语音输入的转写：可能缺标点、有同音错字或口癖。按意思理解，别纠错，也不要反问「你是不是想说…」。）";

function buildMessages(userMsg) {
  const system = IDENTITY.buildSystemPrompt({ persona: personaObj(), mode: "world", memory: "" });
  return [{ role: "system", content: system + VOICE_HINT }, { role: "user", content: userMsg }];
}

function providers() {
  return MODEL_POOL.map((m) => ({ id: m.id, model: m.id, url: config.magpieUrl, key: "magpie", timeoutMs: m.timeout * 1000 }));
}

const STREAM_ROUTER = new ChatRouter({
  request: () => Promise.resolve({ ok: false, code: "unused" }),
  streamRequest: (p, messages, o) => streamOnce({
    url: p.url, key: p.key, proxy: p.proxy, signal: o.signal,
    timeoutSec: o.timeoutSec, firstTokenMs: o.firstTokenMs, onDelta: o.onDelta,
    body: JSON.stringify({ model: p.model, messages, max_tokens: 256, temperature: 0.8, stream: true }),
  }),
});

// ── 一轮完整对话 ────────────────────────────────────────────────────
async function oneRound(idx, askText) {
  const instruct = IDENTITY.voiceProfile(personaObj(), "world").instruct;

  // ① 造一段「用户语音」：用 TTS 念出问句，再压成 64k opus/webm
  //    （voice-capture 用的就是这个码率；32k 会把「海风很轻」听成「海峰很清」）
  const spoken = tts(askText, instruct);
  if (!spoken.ok) throw new Error("无法生成用户语音（TTS 服务异常？）");
  const webm = path.join(TMP, `ask-${idx}.webm`);
  run(FFMPEG, ["-y", "-i", spoken.file, "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", webm]);
  const askDur = duration(webm);
  const speakEnd = askDur; // 时间轴原点 T=0 = 用户张嘴

  // ② STT：等价于 main.js 的 companion:transcribe
  const sttStart = speakEnd + SEND_MS / 1000;
  const { json: sttJson, ms: sttMs } = postFile("http://127.0.0.1:8090/stt", webm, "audio/webm");
  const heard = (sttJson && sttJson.text || "").trim();
  const sttDone = sttStart + sttMs / 1000;

  // ③ LLM 流式 + 逐句切分
  const splitter = createReplySplitter();
  const pieces = [];   // { text, at }  at = 相对 STT 完成秒数
  let full = "";
  const t1 = Date.now();
  const result = await STREAM_ROUTER.runStream(providers(), buildMessages(heard), {
    onDelta: (d) => {
      full += d;
      const at = (Date.now() - t1) / 1000;
      for (const p of splitter.push(d)) pieces.push({ text: p, at });
    },
  });
  for (const p of splitter.flush()) pieces.push({ text: p, at: (Date.now() - t1) / 1000 });

  // ④ 逐句合成（串行，和 main.js 的 chain 一致）+ 排播
  let synthFree = 0;   // 合成队列空闲时刻（相对 STT 完成）
  let playFree = 0;    // 播放队列空闲时刻
  const timeline = [];
  for (const piece of pieces) {
    const clean = piece.text.replace(/\[emo:[a-z]+\]/ig, "").replace(/[\u{1F300}-\u{1FAFF}]/gu, "").trim();
    if (!clean) continue;
    const synthStart = Math.max(synthFree, piece.at);
    const sp = tts(clean, instruct);
    const synthDone = synthStart + sp.synthMs / 1000;
    synthFree = synthDone;
    const playStart = Math.max(synthDone, playFree);
    const playEnd = playStart + sp.durSec;
    playFree = playEnd;
    timeline.push({
      text: clean, chars: clean.length, cutAt: piece.at,
      synthStart, synthMs: sp.synthMs / 1000, durSec: sp.durSec,
      playStart, playEnd, gap: playStart - (timeline.length ? timeline[timeline.length - 1].playEnd : playStart),
      ok: sp.ok,
    });
  }

  // 时间轴原点统一到「用户说完」，口径才对得上体验：
  // 说话时长是她等你说话的时间，不该算进「说完到听见第一声」。
  const firstAudioAt = timeline.length ? sttDone + timeline[0].playStart - speakEnd : null;
  const lastEnd = timeline.length ? sttDone + timeline[timeline.length - 1].playEnd - speakEnd : null;
  const gaps = timeline.slice(1).map((t) => t.gap);

  return {
    askText, askDur, heard, sttMs, sttDone,
    via: result.via, ok: !!result.ok, truncated: !!result.truncated,
    firstTokenMs: result.firstTokenMs, llmMs: result.ms,
    replyText: (result.text || "").replace(/\[emo:[a-z]+\]/ig, "").trim(),
    dangling: looksDangling(heard),
    pieces: pieces.length, timeline,
    firstAudioAt,            // 用户说完 → 听见第一声（秒）
    totalSec: lastEnd,       // 用户说完 → 最后一句播完（秒）
    maxGap: gaps.length ? Math.max(...gaps) : 0,
    gaps,
  };
}

// ── 主流程 ─────────────────────────────────────────────────────────
const ASKS = [
  "今天你在做什么呀",
  "我今天写代码写得好累，你陪我说说话好不好",
  "如果有一天我不来找你了，你会怎么样",
];

(async () => {
  console.log("═".repeat(68));
  console.log("端到端语音链路实测（跳过麦克风，从 webm/opus 开始）");
  console.log(`TTS=${config.ttsQwenUrl}  STT=:8090  网关=${config.magpieUrl}`);
  console.log("═".repeat(68));
  const rounds = [];
  for (let i = 0; i < Math.min(ROUNDS, ASKS.length); i++) {
    process.stdout.write(`\n【第 ${i + 1} 轮】…`);
    let r;
    try {
      r = await oneRound(i, ASKS[i]);
    } catch (e) {
      console.log(` 失败：${e.message}`);
      continue;
    }
    rounds.push(r);
    console.log(" 完成");

    console.log(`  我说（${r.askDur.toFixed(2)}s）: ${r.askText}`);
    console.log(`  STT ${(r.sttMs / 1000).toFixed(2)}s 听到 : ${r.heard}${r.dangling ? "  ⚠ 悬空尾词（会触发续听）" : ""}`);
    console.log(`  LLM ${((r.llmMs) / 1000).toFixed(2)}s 首字 ${((r.firstTokenMs || 0) / 1000).toFixed(2)}s 源 ${r.via}${r.truncated ? " (截断)" : ""}`);
    console.log(`  回复（${r.replyText.length} 字，切 ${r.timeline.length} 块）: ${r.replyText.slice(0, 60)}${r.replyText.length > 60 ? "…" : ""}`);
    console.log("  ┌ 块  字  切出   合成   时长   开播   间隙");
    r.timeline.forEach((t, k) => {
      console.log(`  │ ${String(k + 1).padStart(2)}  ${String(t.chars).padStart(2)}  ` +
        `${t.cutAt.toFixed(2).padStart(5)}s ${t.synthMs.toFixed(2).padStart(5)}s ` +
        `${t.durSec.toFixed(2).padStart(5)}s ${t.playStart.toFixed(2).padStart(5)}s ` +
        `${k === 0 ? "  —" : (t.gap > 0.35 ? `${t.gap.toFixed(2)}s ⚠` : `${t.gap.toFixed(2)}s`)}`);
    });
    console.log(`  └ 说完→首音 ${r.firstAudioAt.toFixed(2)}s ｜ 整段说完 ${r.totalSec.toFixed(2)}s ｜ 最大句间空隙 ${r.maxGap.toFixed(2)}s`);
  }

  if (rounds.length) {
    const avg = (f) => rounds.reduce((s, r) => s + f(r), 0) / rounds.length;
    const worstGap = Math.max(...rounds.map((r) => r.maxGap));
    console.log("\n" + "═".repeat(68));
    console.log(`汇总（${rounds.length} 轮）`);
    console.log(`  说完→首音   平均 ${avg((r) => r.firstAudioAt).toFixed(2)}s  ` +
      `最好 ${Math.min(...rounds.map((r) => r.firstAudioAt)).toFixed(2)}s  ` +
      `最差 ${Math.max(...rounds.map((r) => r.firstAudioAt)).toFixed(2)}s`);
    console.log(`  STT         平均 ${(avg((r) => r.sttMs) / 1000).toFixed(2)}s`);
    console.log(`  首字        平均 ${(avg((r) => r.firstTokenMs || 0) / 1000).toFixed(2)}s`);
    console.log(`  句间空隙    最大 ${worstGap.toFixed(2)}s ${worstGap > 0.35 ? "⚠ 有断档" : "✓ 无断档"}`);
    console.log("═".repeat(68));
    if (JSON_OUT) {
      fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), rounds }, null, 2));
      console.log(`明细已写入 ${JSON_OUT}`);
    }
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
})();
