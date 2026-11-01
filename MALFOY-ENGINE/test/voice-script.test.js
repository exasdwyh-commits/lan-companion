"use strict";
// 稿件合成的测试：不依赖真 ffmpeg、不依赖真 TTS。
// 关注「旁白用她自己的音色」「角色各用各的」「拼装顺序对得上」。
// 运行：node --test MALFOY-ENGINE/test/*.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const N = require("../lib/narration");
const { createVoiceScript, scriptInstruct } = require("../lib/voice-script");

/** 假 ffmpeg：把最后一个参数当成输出文件写掉，同时把调用参数记到旁边的 .args 里。 */
function fakeFfmpeg(dir) {
  const bin = path.join(dir, "fake-ffmpeg.sh");
  fs.writeFileSync(bin,
    `#!/bin/sh\nfor a in "$@"; do last="$a"; done\nfor a in "$@"; do printf '%s|' "$a" >> "${bin}.args"; done\nprintf 'CONCAT' > "$last"\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

const CAST = { 林夏: { voice: "f2", label: "沉稳女声" } };

test("旁白不指定音色，角色指定自己的音色", () => {
  assert.equal(scriptInstruct("narr", CAST), undefined);
  assert.equal(scriptInstruct("", CAST), undefined);
  assert.equal(scriptInstruct("路人甲", CAST), undefined, "没登记的角色退回她的声音");
  assert.equal(scriptInstruct("林夏", CAST), N.VOICE_POOL.f2.instruct);
});

test("单段直接合成，不经过 ffmpeg", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-script-"));
  try {
    const seen = [];
    const synth = createVoiceScript({
      ffmpeg: fakeFfmpeg(dir),
      synthesize: async (text, opts) => { seen.push({ text, opts }); return { audio: "QQ==", via: "qwen3" }; },
    });
    const r = await synth([{ who: "narr", say: "你好。" }], CAST, { mode: "world" });
    assert.equal(r.audio, "QQ==");
    assert.equal(r.via, "qwen3");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].text, "你好。");
    assert.equal(seen[0].opts.instruct, undefined, "旁白要用她自己当前形态的音色");
    assert.equal(seen[0].opts.mode, "world");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("多段按顺序逐句合成，拼成一条音轨", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-script-"));
  try {
    const bin = fakeFfmpeg(dir);
    const seen = [];
    const synth = createVoiceScript({
      ffmpeg: bin,
      synthesize: async (text, opts) => {
        seen.push({ text, instruct: opts.instruct });
        return { audio: Buffer.from(text).toString("base64"), via: "qwen3" };
      },
    });
    const segments = [
      { who: "林夏", say: "你终于来了。" },
      { who: "narr", say: "她说。" },
    ];
    const r = await synth(segments, CAST, { mode: "world" });
    assert.equal(r.via, "qwen3-script");
    assert.deepEqual(r.parts, ["林夏", "narr"]);
    assert.ok(r.audio, "应产出合成后的音轨");
    assert.deepEqual(seen.map((s) => s.text), ["你终于来了。", "她说。"], "顺序不能乱");
    assert.equal(seen[0].instruct, N.VOICE_POOL.f2.instruct);
    assert.equal(seen[1].instruct, undefined);

    const args = fs.readFileSync(bin + ".args", "utf8").split("|").filter(Boolean);
    assert.ok(args.join(" ").includes("concat=n=2"), "应把两段拼起来");
    assert.ok(args.join(" ").includes("silenceremove"), "应裁掉首尾静音");
    assert.ok(args[args.length - 1].endsWith("out.mp3"), "最后一个参数是输出路径");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("某一句合成失败就整体报错，不播半截", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-script-"));
  try {
    const synth = createVoiceScript({
      ffmpeg: fakeFfmpeg(dir),
      synthesize: async (text) => (text === "她说。" ? { audio: null, via: "none" } : { audio: "QQ==", via: "qwen3" }),
    });
    const r = await synth([{ who: "林夏", say: "你来了。" }, { who: "narr", say: "她说。" }], CAST, {});
    assert.equal(r.audio, null);
    assert.match(r.error, /第 2 句/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("空稿子不调合成", async () => {
  let called = 0;
  const synth = createVoiceScript({ ffmpeg: "/bin/false", synthesize: async () => { called++; return { audio: null }; } });
  const r = await synth([], CAST, {});
  assert.equal(r.audio, null);
  assert.equal(called, 0);
});
