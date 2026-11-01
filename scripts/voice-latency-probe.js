#!/usr/bin/env node
"use strict";
// 延迟常量探针：把 STT 与 TTS 的「固定开销 / 每字斜率」测出来。
// 端到端首音 = STT + 首字 + 首块合成，前两项靠选源，第三项只能靠这两个系数算。
const path = require("path"), fs = require("fs"), os = require("os");
const { execFileSync } = require("child_process");

const ENGINE = path.join(__dirname, "..", "MALFOY-ENGINE");
const { config, findFfmpeg } = require(path.join(ENGINE, "lib/config"));
const IDENTITY = require(path.join(ENGINE, "lib/identity"));
const FFMPEG = findFfmpeg();
const FFPROBE = path.join(path.dirname(FFMPEG), "ffprobe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "probe-"));

function sh(bin, argv) {
  try { return execFileSync(bin, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (_) { return ""; }
}
function dur(f) {
  const n = parseFloat(sh(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]));
  return Number.isFinite(n) ? n : 0;
}
function persona() {
  try {
    const vm = require("vm"); const s = { window: {} }; vm.createContext(s);
    vm.runInContext(fs.readFileSync(path.join(ENGINE, "web", "data.js"), "utf8"), s);
    return (s.window.MALFOY || {}).persona || {};
  } catch (_) { return {}; }
}
const INSTRUCT = IDENTITY.voiceProfile(persona(), "world").instruct;

function tts(text) {
  const wav = path.join(TMP, "t" + Math.random().toString(36).slice(2) + ".wav");
  const t0 = Date.now();
  sh("curl", ["-f", "-sS", "-m", "25", "--noproxy", "*", "-X", "POST",
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ text, instruct: INSTRUCT }), "-o", wav, config.ttsQwenUrl]);
  const ms = Date.now() - t0;
  return { ms, dur: dur(wav) };
}

const CASES = [
  "嗯",
  "我在呢，你说。",
  "今天你在做什么呀",
  "屏幕光太亮的话，会累得更快一点。",
  "今天的海面很安静，风从东边来，带着一点咸味，我在这里坐了很久，也没有人经过。",
];

(async () => {
  console.log("TTS 特性曲线（world 音色，单条串行）");
  console.log("  字数   合成     音频长   比率");
  const rows = [];
  for (const text of CASES) {
    const a = tts(text), b = tts(text);          // 各两次：a 常含预热，b 更接近稳态
    const stable = Math.min(a.ms, b.ms);
    const d = b.dur || a.dur;
    rows.push({ chars: Array.from(text.replace(/[，。！？、]/g, "")).length, ms: stable, dur: d });
    console.log(`  ${String(rows[rows.length - 1].chars).padStart(3)}  ${(stable / 1000).toFixed(2)}s  ` +
      `${(a.ms / 1000).toFixed(2)}/${(b.ms / 1000).toFixed(2)}  ${d.toFixed(2)}s   ${(stable / 1000 / d).toFixed(2)}`);
  }
  // 最小二乘拟合 ms = a + b*chars（用稳态值）
  const n = rows.length;
  const sx = rows.reduce((s, r) => s + r.chars, 0), sy = rows.reduce((s, r) => s + r.ms, 0);
  const sxx = rows.reduce((s, r) => s + r.chars * r.chars, 0), sxy = rows.reduce((s, r) => s + r.chars * r.ms, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const inter = (sy - slope * sx) / n;
  console.log(`  拟合: 合成 ${(inter / 1000).toFixed(2)}s + ${(slope / 1000).toFixed(3)}s/字`);

  // STT：同一段音频重复，看抖动；不同长度看是否随长度增长
  console.log("\nSTT 重复性（small/int8，VAD 开）");
  const ask = tts("我今天写代码写得好累，你陪我说说话好不好");
  const base = path.join(TMP, "ask.wav");
  fs.copyFileSync(path.join(TMP, fs.readdirSync(TMP).find((f) => f.endsWith(".wav"))), base);
  for (const secs of [2, 4, 8]) {
    const f = path.join(TMP, `s${secs}.wav`);
    sh(FFMPEG, ["-y", "-i", base, "-t", String(secs), "-ar", "16000", "-ac", "1", f]);
    const times = [];
    for (let k = 0; k < 3; k++) {
      const t0 = Date.now();
      const out = sh("curl", ["-sS", "-m", "30", "--noproxy", "*", "-X", "POST",
        "-H", "Content-Type: audio/wav", "--data-binary", "@" + f, "http://127.0.0.1:8090/stt"]);
      times.push(Date.now() - t0);
      if (k === 0) {
        try { const j = JSON.parse(out); console.log(`  ${secs}s 音频 → ${times[0]}ms  「${j.text}」`); }
        catch (_) { console.log(`  ${secs}s 音频 → ${times[0]}ms  (解析失败)`); }
      }
    }
    console.log(`     三次: ${times.map((t) => t + "ms").join(" / ")}`);
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
})();
