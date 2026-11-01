#!/usr/bin/env node
"use strict";
// STT 模型对比：同一批音频分别打两个端口，比速度与字错率。
// 为什么需要：STT 是首音里唯一「换个小模型就能省一半」环节，
// 但降模型会掉准确率，而准确率掉了会直接改变她回什么。必须两个一起量。
//
// 用法：node scripts/stt-compare.js --a http://127.0.0.1:8090/stt --b http://127.0.0.1:8092/stt
const path = require("path"), fs = require("fs"), os = require("os");
const { execFileSync } = require("child_process");

const ENGINE = path.join(__dirname, "..", "MALFOY-ENGINE");
const { config, findFfmpeg } = require(path.join(ENGINE, "lib/config"));
const IDENTITY = require(path.join(ENGINE, "lib/identity"));
const FFMPEG = findFfmpeg();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sttcmp-"));

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const A = argOf("--a", "http://127.0.0.1:8090/stt");
const B = argOf("--b", "http://127.0.0.1:8092/stt");

function sh(b, a) { try { return execFileSync(b, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (_) { return ""; } }
function persona() {
  try { const vm = require("vm"), s = { window: {} }; vm.createContext(s); vm.runInContext(fs.readFileSync(path.join(ENGINE, "web", "data.js"), "utf8"), s); return (s.window.MALFOY || {}).persona || {}; } catch (_) { return {}; }
}
const INSTRUCT = IDENTITY.voiceProfile(persona(), "world").instruct;

function say(text) {
  const wav = path.join(TMP, "s" + Math.random().toString(36).slice(2) + ".wav");
  sh("curl", ["-f", "-sS", "-m", "25", "--noproxy", "*", "-X", "POST", "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ text, instruct: INSTRUCT }), "-o", wav, config.ttsQwenUrl]);
  return wav;
}
function toWav16(src, dst) { sh(FFMPEG, ["-y", "-i", src, "-ar", "16000", "-ac", "1", dst]); return dst; }
/** 混入粉红噪声，模拟风扇/键盘（SNR 约 15dB） */
function addNoise(src, dst) {
  sh(FFMPEG, ["-y", "-i", src, "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.03",
    "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:weights=1 0.6", "-ar", "16000", "-ac", "1", dst]);
  return dst;
}
function post(url, file) {
  const t0 = Date.now();
  const out = sh("curl", ["-sS", "-m", "30", "--noproxy", "*", "-X", "POST",
    "-H", "Content-Type: audio/wav", "--data-binary", "@" + file, url]);
  const ms = Date.now() - t0;
  let text = "";
  try { text = (JSON.parse(out).text || "").trim(); } catch (_) {}
  return { text, ms };
}
/** 归一化：去掉标点空格，繁转简的粗略映射（只处理常见字） */
const T2S = { "寫": "写", "碼": "码", "說": "说", "話": "话", "麼": "么", "這": "这", "個": "个", "們": "们", "對": "对", "會": "会", "來": "来", "時": "时", "間": "间", "覺": "觉", "開": "开", "關": "关", "還": "还", "過": "过", "樣": "样", "給": "给", "點": "点", "現": "现", "實": "实", "從": "从", "經": "经", "無": "无", "聲": "声", "聽": "听", "見": "见" };
function norm(s) {
  return Array.from(String(s).replace(/[，。！？、,.!?；;：:\s「」"'']/g, "")).map((c) => T2S[c] || c).join("");
}
/** 编辑距离 → 字错率 */
function cer(ref, hyp) {
  const a = Array.from(ref), b = Array.from(hyp);
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return a.length ? dp[a.length][b.length] / a.length : 0;
}

const SENTENCES = [
  "今天你在做什么呀",
  "我今天写代码写得好累，你陪我说说话好不好",
  "外面好像下雨了，你听得到吗",
  "帮我想一个周五晚上吃什么的答案",
  "这个报错是空指针异常，我该怎么改",
  "算了先不聊这个，你最近有没有什么想说的",
];
const CONDS = [
  { name: "干净", make: (w) => toWav16(w, w.replace(/\.wav$/, "-16k.wav")) },
  { name: "带噪", make: (w) => addNoise(toWav16(w, w.replace(/\.wav$/, "-16k.wav")), w.replace(/\.wav$/, "-noise.wav")) },
];

(async () => {
  console.log(`A = ${A}\nB = ${B}\n`);
  const stat = {};
  for (const cond of CONDS) {
    stat[cond.name] = { A: { ms: [], cer: [] }, B: { ms: [], cer: [] } };
    console.log(`── ${cond.name} ──`);
    for (const s of SENTENCES) {
      const f = cond.make(say(s));
      const ra = post(A, f), rb = post(B, f);
      const ref = norm(s);
      const ca = cer(ref, norm(ra.text)), cb = cer(ref, norm(rb.text));
      stat[cond.name].A.ms.push(ra.ms); stat[cond.name].A.cer.push(ca);
      stat[cond.name].B.ms.push(rb.ms); stat[cond.name].B.cer.push(cb);
      console.log(`  「${s}」`);
      console.log(`    A ${String(ra.ms).padStart(4)}ms CER ${(ca * 100).toFixed(0)}%  ${ra.text}`);
      console.log(`    B ${String(rb.ms).padStart(4)}ms CER ${(cb * 100).toFixed(0)}%  ${rb.text}`);
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log("\n汇总");
  for (const cond of CONDS) {
    const s = stat[cond.name];
    console.log(`  ${cond.name}: A ${avg(s.A.ms).toFixed(0)}ms / CER ${(avg(s.A.cer) * 100).toFixed(1)}%   ` +
      `B ${avg(s.B.ms).toFixed(0)}ms / CER ${(avg(s.B.cer) * 100).toFixed(1)}%`);
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
})();
