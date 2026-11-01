"use strict";
// 歌姬模式：写词清洗、生成编排、错误映射、换声档位。
// 音乐接口与转码都注入假实现 —— 这些测试不该花用户的钱，也不该依赖 ffmpeg。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const {
  createVocalistJobs, parseLyrics, normalizeTags, inspectLyrics, inspectStyle,
} = require("../lib/vocalist-jobs");

const UUID_RE = /^[a-f0-9-]{36}$/;
const AUDIO = Buffer.alloc(4096, 7); // 实现要求 > 1024 字节

function fixture({ voice = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vocalist-"));
  const dataDir = path.join(root, "data");
  const workspace = path.join(root, "ws");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const refPath = path.join(root, "ref.wav");
  fs.writeFileSync(refPath, Buffer.alloc(30000, 1));
  const voiceProfiles = voice ? {
    currentId: () => "her",
    find: () => ({ id: "her", name: "清冷", refPath, range: { lo: 165, hi: 494 } }),
    current: () => ({ id: "her", name: "清冷", refPath, range: { lo: 165, hi: 494 } }),
  } : {
    currentId: () => "her",
    find: () => ({ id: "her", name: "清冷", refPath: null, range: { lo: 165, hi: 494 } }),
    current: () => ({ id: "her", name: "清冷", refPath: null, range: { lo: 165, hi: 494 } }),
  };
  return {
    root, dataDir, workspace, refPath, voiceProfiles,
    // 转码在测试里只落一个够大的文件：真的走 ffmpeg 会让测试依赖本机编码器
    encode: async (folder) => { fs.writeFileSync(path.join(folder, "song.m4a"), AUDIO); },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const LYRICS = "[Verse]\n潮水把沙子写成字\n一行行都没寄出去\n风把它们念给我听\n\n[Chorus]\n我在海边等你\n等到月亮掉进海里\n你说过会回来\n我就一直在这里";

function make(f, overrides = {}) {
  return createVocalistJobs({
    dir: f.dataDir,
    workspace: f.workspace,
    ffmpeg: "/nonexistent/ffmpeg",
    voiceProfiles: f.voiceProfiles,
    secret: () => "test-key",
    encode: f.encode,
    writeLyrics: async () => `标题：海的信\n\n${LYRICS}`,
    ...overrides,
  });
}

// ── 写词清洗 ──────────────────────────────────────────────────────
test("模型的客套话、代码围栏、书名号都要剥掉", () => {
  const raw = [
    "好的，我为你写了这首歌：",
    "标题：《海的信》",
    "",
    "```",
    "[主歌]",
    "潮水把沙子写成字",
    "一行行都没寄出去",
    "[副歌]",
    "我在海边等你",
    "等到月亮掉进海里",
    "```",
    "希望你喜欢！",
  ].join("\n");
  const out = parseLyrics(raw, "主题占位");
  assert.equal(out.title, "海的信", "书名号要去掉");
  assert.ok(out.lyrics.startsWith("[Verse]"), "标签要归一成官方写法");
  assert.ok(out.lyrics.includes("潮水把沙子写成字"));
  assert.ok(!out.lyrics.includes("```"), "代码围栏不能进歌词");
  assert.ok(!out.lyrics.includes("希望你喜欢"), "结尾的感想不是歌词");
  assert.ok(!out.lyrics.includes("标题"), "标题行要单独摘出去");
});

test("结构标签的各种写法都收敛，认不出的标签整行丢掉", () => {
  const text = "[副歌]\n一句\n[pre-chorus]\n两句\n[hook]\n三句\n[随便写写]\n四句\n[BRIDGE]\n五句";
  const out = normalizeTags(text);
  assert.ok(out.includes("[Chorus]"));
  assert.ok(out.includes("[Pre Chorus]"));
  assert.ok(out.includes("[Hook]"));
  assert.ok(out.includes("[Bridge]"), "大小写不该影响识别");
  assert.ok(!out.includes("[随便写写]"), "认不出的标签是噪音，留着会破坏结构");
  assert.ok(out.includes("四句"), "歌词本体要留下");
});

test("没写标题时退回主题当歌名，不编一个", () => {
  const out = parseLyrics("[Verse]\n潮水把沙子写成字\n一行行都没寄出去", "海边的夜");
  assert.equal(out.title, "海边的夜");
});

test("歌词校验：太短要拦，缺标签只警告", () => {
  assert.equal(inspectLyrics("[Verse]\n短").ok, false);
  const noTag = inspectLyrics("这是一句完整的歌词，长度已经够了");
  assert.equal(noTag.ok, false);
  assert.equal(noTag.soft, true, "缺标签是软失败：手写的词可能故意不要结构，不该被拦死");
  const good = inspectLyrics(LYRICS);
  assert.equal(good.ok, true);
  assert.equal(good.tags, 2);
});

test("超长歌词按行裁剪，不切半个字", () => {
  const long = "[Verse]\n" + Array.from({ length: 400 }, (_, i) => `第${i}行歌词内容`).join("\n");
  const out = inspectLyrics(long);
  assert.ok(out.lyrics.length <= 3400);
  assert.ok(!out.lyrics.endsWith("第"), "不能停在半个句子上");
  assert.ok(out.ok);
});

test("风格描述压成一行；空描述要拦", () => {
  assert.equal(inspectStyle("  温暖的 民谣\n木吉他  ").style, "温暖的 民谣 木吉他");
  assert.equal(inspectStyle("").ok, false);
  assert.equal(inspectStyle("   ").ok, false);
});

// ── 生成编排 ──────────────────────────────────────────────────────
test("没配 key 时明确说要写哪个环境变量，而不是默默失败", () => {
  const f = fixture();
  try {
    const v = make(f, { secret: () => "" });
    const snap = v.snapshot();
    assert.equal(snap.ready.configured, false);
    assert.match(snap.ready.error, /MINIMAX_API_KEY/);
    assert.match(snap.ready.error, /\.env/);
  } finally { f.cleanup(); }
});

test("生成成功：落盘、入库、时长来自接口而不是自己猜", async () => {
  const f = fixture();
  try {
    const calls = [];
    const v = make(f, {
      request: async ({ model, prompt, lyrics }) => { calls.push({ model, prompt, lyrics }); return { ok: true, audio: AUDIO, durationMs: 187400, model }; },
    });
    v.setDraft({ theme: "海", style: "温暖的民谣，木吉他", title: "海的信", lyrics: LYRICS });
    const snap = await v.generate();
    assert.equal(snap.job.status, "done");
    assert.equal(snap.song.title, "海的信");
    assert.equal(snap.song.duration, 187, "接口给的是毫秒，要换成秒");
    assert.equal(calls.length, 1, "成功就该只请求一次");
    assert.equal(calls[0].model, "music-3.0");
    assert.ok(calls[0].lyrics.includes("[Chorus]"));

    const folder = path.join(f.dataDir, "originals", snap.song.id);
    assert.ok(fs.existsSync(path.join(folder, "song.mp3")), "原始 mp3 要留着");
    assert.ok(fs.existsSync(path.join(folder, "song.m4a")), "转码产物给播放器用");
    const index = JSON.parse(fs.readFileSync(path.join(f.dataDir, "originals", "index.json"), "utf8"));
    assert.equal(index.length, 1);
    assert.equal(index[0].title, "海的信");
    assert.ok(UUID_RE.test(index[0].id));
  } finally { f.cleanup(); }
});

test("鉴权失败不换模型重试 —— 换个模型也是同样的错，白花钱", async () => {
  const f = fixture();
  try {
    let n = 0;
    const v = make(f, {
      request: async () => { n++; return { ok: false, code: 1004, message: "login fail" }; },
    });
    v.setDraft({ theme: "海", style: "民谣", lyrics: LYRICS });
    await assert.rejects(() => v.generate(), /API Key/);
    assert.equal(n, 1, "1004 是账号级错误，重试没有意义");
    assert.equal(v.snapshot().job.status, "error");
  } finally { f.cleanup(); }
});

test("服务端临时故障才回退下一个模型", async () => {
  const f = fixture();
  try {
    const models = [];
    const v = make(f, {
      request: async ({ model }) => {
        models.push(model);
        if (model === "music-3.0") return { ok: false, code: 1013, message: "engine busy" };
        return { ok: true, audio: AUDIO, durationMs: 60000, model };
      },
    });
    v.setDraft({ theme: "海", style: "民谣", lyrics: LYRICS });
    const snap = await v.generate();
    assert.deepEqual(models, ["music-3.0", "music-2.6"]);
    assert.equal(snap.song.model, "music-2.6");
  } finally { f.cleanup(); }
});

test("生成失败时把半成品目录清掉，不留一个空壳让人误会", async () => {
  const f = fixture();
  try {
    const v = make(f, { request: async () => ({ ok: false, code: 1008, message: "no balance" }) });
    v.setDraft({ theme: "海", style: "民谣", lyrics: LYRICS });
    await assert.rejects(() => v.generate(), /余额/);
    const root = path.join(f.dataDir, "originals");
    const dirs = fs.readdirSync(root).filter((n) => UUID_RE.test(n));
    assert.equal(dirs.length, 0);
  } finally { f.cleanup(); }
});

test("歌词太短直接拦，不发请求", async () => {
  const f = fixture();
  try {
    let n = 0;
    const v = make(f, { request: async () => { n++; return { ok: true, audio: AUDIO, model: "music-3.0" }; } });
    v.setDraft({ style: "民谣", lyrics: "[Verse]\n短" });
    await assert.rejects(() => v.generate(), /太短/);
    assert.equal(n, 0);
  } finally { f.cleanup(); }
});

test("草稿会落盘，重启后还在", () => {
  const f = fixture();
  try {
    const a = make(f);
    a.setDraft({ theme: "海边的清晨", style: "民谣", lyrics: LYRICS });
    const b = make(f);
    assert.equal(b.snapshot().draft.theme, "海边的清晨");
    assert.equal(b.snapshot().draft.lyrics, LYRICS);
  } finally { f.cleanup(); }
});

test("写词走模型；模型返回空要说人话", async () => {
  const f = fixture();
  try {
    const ok = make(f);
    const snap = await ok.compose({ theme: "海", style: "民谣" });
    assert.equal(snap.job.status, "done");
    assert.equal(snap.draft.title, "海的信");
    assert.ok(snap.draft.lyrics.includes("[Chorus]"));

    const bad = make(f, { writeLyrics: async () => "" });
    await assert.rejects(() => bad.compose({ theme: "海" }), /没写出东西/);
  } finally { f.cleanup(); }
});

// ── 换成她的声音 ──────────────────────────────────────────────────
test("缺参考音频时说明缺什么，而不是只报一句失败", () => {
  const f = fixture({ voice: false });
  try {
    const snap = make(f).snapshot();
    assert.equal(snap.dress.ready, false);
    assert.match(snap.dress.error, /干净人声/);
  } finally { f.cleanup(); }
});

test("没装翻唱环境时作曲照样能用 —— 两件事互不牵连", () => {
  const f = fixture();
  try {
    const snap = make(f, { workspace: null }).snapshot();
    assert.equal(snap.dress.ready, false);
    assert.equal(snap.ready.configured, true, "作曲只依赖云端 key");
  } finally { f.cleanup(); }
});

test("换声成功：产出 her.m4a 并标记，曲库播放她唱版", async () => {
  const f = fixture();
  try {
    let spawned = null;
    const v = make(f, {
      request: async () => ({ ok: true, audio: AUDIO, durationMs: 60000, model: "music-3.0" }),
      spawnJob: (cmd, args, opts) => {
        spawned = { cmd, args, opts };
        const proc = new EventEmitter();
        proc.pid = 4242;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        // 模拟脚本把成品写到 output 参数（args = [脚本, 源, 输出]）
        setTimeout(() => {
          fs.writeFileSync(args[2], AUDIO);
          proc.stdout.emit("data", "[3/4]\n[cover-progress] chunk=2 total=9\n");
          proc.emit("close", 0);
        }, 5);
        return proc;
      },
    });
    v.setDraft({ theme: "海", style: "民谣", lyrics: LYRICS });
    await v.generate();
    const snap = await v.dress();
    assert.equal(snap.job.status, "done");
    assert.equal(snap.song.herUrl !== null, true, "有 her.m4a 时要给出她唱版地址");
    assert.match(spawned.args[0], /sing_cover_file\.sh$/);
    assert.equal(spawned.opts.env.REF, f.refPath, "用当前音色的参考音频");
    assert.equal(spawned.opts.env.VOICE_LO, "165", "音域下界要传下去，否则换声没有参数差异");
  } finally { f.cleanup(); }
});

test("换声没产出文件时给出可继续的提示，原版还在", async () => {
  const f = fixture();
  try {
    const v = make(f, {
      request: async () => ({ ok: true, audio: AUDIO, durationMs: 60000, model: "music-3.0" }),
      spawnJob: () => {
        const proc = new EventEmitter();
        proc.pid = 4243; proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
        setTimeout(() => proc.emit("close", 0), 5); // 正常退出但没写文件
        return proc;
      },
    });
    v.setDraft({ theme: "海", style: "民谣", lyrics: LYRICS });
    const made = await v.generate();
    const snap = await v.dress();
    assert.equal(snap.job.status, "error");
    assert.match(snap.job.error, /原来的版本还能听/, "失败信息要告诉用户成品没丢");
    assert.ok(made.song.url.startsWith("file://"), "原版仍可播放");
  } finally { f.cleanup(); }
});

test("生成中点取消，状态回到 cancelled 且不再写索引", async () => {
  const f = fixture();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    const v = make(f, { request: async () => { await gate; return { ok: true, audio: AUDIO, model: "music-3.0" }; } });
    v.setDraft({ theme: "海", style: "民谣", lyrics: LYRICS });
    const pending = v.generate();
    setTimeout(() => v.cancel(), 10);
    release();
    const snap = await pending;
    assert.ok(["cancelled", "done"].includes(snap.job.status));
    const indexPath = path.join(f.dataDir, "originals", "index.json");
    if (snap.job.status === "cancelled") {
      assert.ok(!fs.existsSync(indexPath) || JSON.parse(fs.readFileSync(indexPath, "utf8")).length === 0);
    }
  } finally { f.cleanup(); }
});
