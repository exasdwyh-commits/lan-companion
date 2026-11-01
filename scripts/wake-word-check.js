#!/usr/bin/env node
"use strict";
// 唤醒词验收：合成人声 → 走真实 STT → 跑匹配器。
//
// 为什么不只跑单测：单测只能证明「给定文本时判定正确」，证明不了
// 「whisper 转出来的文本长什么样」。唤醒这个词的失败几乎全发生在
// 转写那一层（小艾→小爱、同学→桐学），参数要对着真实转写结果调。
//
// 用法：node scripts/wake-word-check.js
// 前置：stt_server.py 在 8090；本机有 say 与 ffmpeg（macOS）。
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { createWakeWordMatcher } = require(path.join(ROOT, "MALFOY-ENGINE/lib/wake-word"));

const STT = process.env.STT_URL || "http://127.0.0.1:8090/stt";
const matcher = createWakeWordMatcher();

// 正例要包含这几种真实说话方式：只喊名字、名字+指令、换称呼、口语化。
const POSITIVE = [
  "小艾同学",
  "小艾同学，今天天气怎么样",
  "小艾，帮我把音量调小一点",
  "深蓝，你在吗",
  "小爱同学，我想听歌",
  "艾同学，你睡了吗",
  "小艾同学，帮我看看这个报错",
];

// 负例是环境里的正常对话。误唤醒比漏唤醒更烦人，所以这一组必须全过。
const NEGATIVE = [
  "今天下午开会记得带电脑",
  "这个方案我觉得不太行",
  "小同学你好",
  "把那个文件发我一下",
  "蓝色那件衣服在哪",
  "他说明天再来",
];

function ttsWav(text, out) {
  const aiff = out.replace(/\.wav$/, ".aiff");
  execFileSync("say", ["-v", "Ting-Ting", "-o", aiff, text], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-v", "quiet", "-i", aiff, "-ar", "16000", "-ac", "1", out]);
  try { fs.unlinkSync(aiff); } catch (_) {}
}

function transcribe(file) {
  const out = execFileSync("curl", [
    "-sS", "-m", "40", "--noproxy", "*", "-X", "POST",
    "-H", "Content-Type: audio/wav", "--data-binary", "@" + file, STT,
  ], { maxBuffer: 4 * 1024 * 1024 }).toString();
  try { return JSON.parse(out).text || ""; } catch (_) { return ""; }
}

function run(list, expectHit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wake-"));
  let pass = 0;
  for (const sentence of list) {
    const wav = path.join(dir, "s" + Math.random().toString(36).slice(2) + ".wav");
    let heard = "";
    try { ttsWav(sentence, wav); } catch (e) { console.log("  ! 合成失败：" + sentence); continue; }
    heard = transcribe(wav);
    try { fs.unlinkSync(wav); } catch (_) {}
    const hit = matcher.strip(heard);
    const ok = hit.hit === expectHit;
    if (ok) pass += 1;
    const mark = ok ? "✓" : "✗";
    const detail = hit.hit ? `→ 名字「${hit.word}」 内容「${hit.text}」` : "→ 未唤醒";
    console.log(`  ${mark} 说「${sentence}」`);
    console.log(`     听成「${heard || "(空)"}」 ${detail}`);
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  return { pass, total: list.length };
}

console.log("=== 该唤醒的 ===");
const a = run(POSITIVE, true);
console.log("\n=== 不该唤醒的 ===");
const b = run(NEGATIVE, false);
console.log(`\n合计 ${a.pass + b.pass}/${a.total + b.total}（正例 ${a.pass}/${a.total}，负例 ${b.pass}/${b.total}）`);
process.exit(a.pass === a.total && b.pass === b.total ? 0 : 1);
