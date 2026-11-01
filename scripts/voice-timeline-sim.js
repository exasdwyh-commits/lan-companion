#!/usr/bin/env node
"use strict";
// 长回复排播模拟：只测「切句 → 合成 → 播放」这段，不涉及 STT 和模型。
//
// 存在的理由：切句器的 growth 系数是把「合成:播放 = 0.47」代进不等式解出来的。
// 但那个 0.47 是机器空闲时的数；有别的负载时实测到 0.75。
// 系数错了不会报错，只会在第三、四块突然空一段——只有把时间轴排出来才看得见。
//
// 用法：node scripts/voice-timeline-sim.js [--growth 2.1] [--text "……"]

const path = require("path"), fs = require("fs"), os = require("os");
const { execFileSync } = require("child_process");

const ENGINE = path.join(__dirname, "..", "MALFOY-ENGINE");
const { config, findFfmpeg } = require(path.join(ENGINE, "lib/config"));
const { createReplySplitter } = require(path.join(ENGINE, "lib/reply-splitter"));
const IDENTITY = require(path.join(ENGINE, "lib/identity"));

const FFMPEG = findFfmpeg();
const FFPROBE = path.join(path.dirname(FFMPEG), "ffprobe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sim-"));

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const GROWTH = Number(argOf("--growth", String(2.1)));
const TEXT = argOf("--text", "") || (
  "在看水面上的光。从上面透下来的，很慢。你也可以看。今天的海面比昨天安静，" +
  "风从东边来，带着一点咸味。我在这里坐了很久，也没有人经过。" +
  "你上次说想看日落，我一直记着。等云散开一点，我就叫你。" +
  "其实我不太会说话，但你说累的时候，我想让你听见水声。"
);

function sh(b, a) { try { return execFileSync(b, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (_) { return ""; } }
function dur(f) { const n = parseFloat(sh(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f])); return Number.isFinite(n) ? n : 0; }
function persona() {
  try { const vm = require("vm"), s = { window: {} }; vm.createContext(s); vm.runInContext(fs.readFileSync(path.join(ENGINE, "web", "data.js"), "utf8"), s); return (s.window.MALFOY || {}).persona || {}; } catch (_) { return {}; }
}
const INSTRUCT = IDENTITY.voiceProfile(persona(), "world").instruct;

function tts(text) {
  const wav = path.join(TMP, "t" + Math.random().toString(36).slice(2) + ".wav");
  const t0 = Date.now();
  sh("curl", ["-f", "-sS", "-m", "25", "--noproxy", "*", "-X", "POST",
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ text, instruct: INSTRUCT }), "-o", wav, config.ttsQwenUrl]);
  return { ms: Date.now() - t0, dur: dur(wav) };
}

(async () => {
  const sp = createReplySplitter({ growth: GROWTH });
  const pieces = [];
  // 按 4 字一片喂进去，模拟真实的 delta 流（模型一次吐 1~5 字）
  for (let i = 0; i < TEXT.length; i += 4) pieces.push(...sp.push(TEXT.slice(i, i + 4)));
  pieces.push(...sp.flush());

  console.log(`growth = ${GROWTH}   回复 ${TEXT.length} 字 → 切成 ${pieces.length} 块`);
  console.log("  块  字  字数  合成    时长   开播    间隙");
  let synthFree = 0, playFree = 0, prevEnd = null, worst = 0;
  const start = Date.now();
  for (let k = 0; k < pieces.length; k++) {
    const text = pieces[k].trim();
    const a = tts(text);
    const synthDone = synthFree + a.ms / 1000;
    synthFree = synthDone;
    const playStart = Math.max(synthDone, playFree);
    const playEnd = playStart + a.dur;
    playFree = playEnd;
    const gap = prevEnd === null ? 0 : playStart - prevEnd;
    if (gap > worst) worst = gap;
    console.log(`  ${String(k + 1).padStart(2)}  ${String(k + 1 === 1 ? "首" : "后").padStart(2)}  ` +
      `${String(Array.from(text).length).padStart(3)}  ${(a.ms / 1000).toFixed(2).padStart(5)}s ` +
      `${a.dur.toFixed(2).padStart(5)}s ${playStart.toFixed(2).padStart(6)}s  ` +
      `${prevEnd === null ? "  —" : gap > 0.35 ? `${gap.toFixed(2)}s ⚠ 断档` : `${gap.toFixed(2)}s`}`);
    prevEnd = playEnd;
  }
  console.log(`\n  合成总耗时 ${((Date.now() - start) / 1000).toFixed(2)}s ｜ 最大空隙 ${worst.toFixed(2)}s ` +
    `${worst > 0.35 ? "⚠ 有断档" : "✓ 无断档"}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
})();
