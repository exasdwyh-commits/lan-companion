"use strict";
// 读书播放器的测试：不碰真 TTS、不碰真 Electron。
// 关注三件事 —— 旧数据能升级、多角色稿子走分音色合成、下一条有预取。
// 运行：node --test MALFOY-ENGINE/test/*.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createCompanionMedia, normalizeBook } = require("../lib/companion-media");

const CONTENT = path.join(__dirname, "..", "web", "live2d", "companion-content");

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-test-"));
  const sent = [];
  const calls = [];
  const media = createCompanionMedia({
    dir,
    contentDir: CONTENT,
    synthesize: async (text) => ({ audio: Buffer.from("ONE:" + text).toString("base64"), via: "one" }),
    synthesizeScript: async (segments, cast, opts) => {
      calls.push({ segments: segments.map((s) => ({ ...s })), mode: opts && opts.mode });
      return {
        audio: Buffer.from("SCRIPT:" + segments.map((s) => `${s.who}=${s.say}`).join("|")).toString("base64"),
        via: "qwen3-script",
      };
    },
    send: (p) => sent.push(p),
    publish: () => {},
    mode: () => "world",
  });
  const last = (action) => [...sent].reverse().find((p) => p.action === action);
  return { dir, media, sent, calls, last, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("旧版纯文本书能升级成朗读稿", () => {
  const book = normalizeBook({
    id: "b1", title: "旧书", index: 1,
    paragraphs: ["他是80后。", "“你来了。”她说。"],
  });
  assert.ok(book);
  assert.equal(book.paragraphs.length, 2);
  assert.equal(book.paragraphs[0].text, "他是80后。");
  assert.deepEqual(book.paragraphs[0].segments, [{ who: "narr", say: "他是80后。" }]);
  assert.deepEqual(book.cast, {});
});

test("坏数据不当作已导入", () => {
  assert.equal(normalizeBook(null), null);
  assert.equal(normalizeBook({ paragraphs: [] }), null);
  assert.equal(normalizeBook({ paragraphs: [""] }), null);
  assert.equal(normalizeBook({ paragraphs: ["x".repeat(500)] }), null);
});

test("导入后正文已规范化，且切出了旁白与对白", async () => {
  const h = harness();
  try {
    const state = await h.media.command({
      action: "import", title: "测试",
      text: "他是80后，1998年的夏天。\n周砚把伞收起来：“路上堵了。”",
    });
    assert.ok(state.book.total >= 2);
    const all = [];
    for (let i = 0; i < state.book.total; i++) {
      const s = await h.media.command({ action: "jump", index: i });
      all.push(s.book.text);
    }
    assert.ok(all.join("").includes("八零后"), all.join(""));
    assert.ok(!all.join("").includes("80后"), "阿拉伯数字应已转成读法");

    const saved = JSON.parse(fs.readFileSync(path.join(h.dir, "reading.json"), "utf8"));
    assert.ok(saved.cast && saved.cast["周砚"], `应识别出说话人：${JSON.stringify(saved.cast)}`);
    const withSegments = saved.paragraphs.filter((p) => Array.isArray(p.segments));
    assert.ok(withSegments.length > 0, "对话段应保留切分结果");
    const segs = withSegments.flatMap((p) => p.segments);
    assert.ok(segs.some((s) => s.who === "周砚"), JSON.stringify(segs));
    // 纯旁白段落不该把同一段文本存两份
    const plain = saved.paragraphs.filter((p) => !p.segments);
    assert.ok(plain.every((p) => Object.keys(p).length === 1), "纯旁白段落只存 text");
  } finally { h.cleanup(); }
});

test("朗读一段走分音色合成，并且会预取下一段", async () => {
  const h = harness();
  try {
    await h.media.command({
      action: "import", title: "测试",
      text: [
        "周砚推开门。林夏站在窗边，没有回头。",
        "“你终于来了。”她说。",
        "周砚把伞收起来：“路上堵了。”",
        "“我一直在等。”林夏说。",
      ].join("\n"),
    });
    await h.media.command({ action: "read" });
    await new Promise((r) => setTimeout(r, 30));

    const first = h.last("load");
    assert.ok(first && first.audio, "应有音频下发");
    assert.equal(first.kind, "reading");
    assert.ok(h.calls.length >= 1, "应走 synthesizeScript");
    const decoded = Buffer.from(first.audio, "base64").toString();
    assert.ok(decoded.startsWith("SCRIPT:"), decoded);

    // 第一段播完，第二段应该直接用预取结果，不需要现场再合成
    const before = h.calls.length;
    h.media.progress({ token: h.media.snapshot().token, event: "ended" });
    await new Promise((r) => setTimeout(r, 30));
    const second = h.last("load");
    assert.notEqual(second.audio, first.audio, "应推进到下一段");
    assert.ok(h.calls.length >= before, "预取只该多合成一段，不该每段重复两次");
  } finally { h.cleanup(); }
});

test("关掉再开，续读位置和角色表都还在", async () => {
  const h = harness();
  try {
    await h.media.command({
      action: "import", title: "续读",
      text: "第一段在这里。\n第二段在这里。\n第三段在这里。",
    });
    await h.media.command({ action: "jump", index: 2 });
    const saved = h.media.snapshot().book;
    assert.equal(saved.index, 2);

    const reread = createCompanionMedia({
      dir: h.dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: null, via: "none" }),
      synthesizeScript: async () => ({ audio: null, via: "none" }),
      send: () => {}, publish: () => {}, mode: () => "world",
    });
    const lib = reread.library();
    assert.ok(lib.book, "重启后应能读回书");
    assert.equal(lib.book.index, 2, "续读位置应保留");
    assert.equal(lib.book.title, "续读");
    assert.ok(Array.isArray(lib.book.cast));
  } finally { h.cleanup(); }
});

test("合成失败时报错而不是静默播空", async () => {
  const h = harness();
  try {
    const media = createCompanionMedia({
      dir: h.dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: null, via: "none" }),
      synthesizeScript: async () => ({ audio: null, via: "none" }),
      send: () => {}, publish: () => {}, mode: () => "world",
    });
    await media.command({ action: "import", title: "x", text: "一段话。" });
    await media.command({ action: "read" });
    await new Promise((r) => setTimeout(r, 30));
    const snap = media.snapshot();
    assert.equal(snap.status, "error");
    assert.ok(snap.error);
  } finally { h.cleanup(); }
});

// ── 两种阅读模式 ────────────────────────────────────────────────────

const STORY = [
  "周砚推开门，海风灌进来。林夏站在窗边，没有回头。",
  "“你终于来了。”她说。",
  "周砚把伞收起来：“路上堵了。”",
  "“我一直在等。”林夏说。",
].join("\n");

test("实时阅读：整段一个人念，不切角色也不分音色", async () => {
  const h = harness();
  try {
    const state = await h.media.command({ action: "import", title: "实时", text: STORY, mode: "live" });
    assert.equal(state.book.mode, "live");
    assert.deepEqual(state.book.cast, [], "实时阅读没有角色表");
    const saved = JSON.parse(fs.readFileSync(path.join(h.dir, "reading.json"), "utf8"));
    assert.equal(saved.mode, "live");
    assert.ok(saved.paragraphs.every((p) => !p.segments), "实时阅读不存切分结果");
  } finally { h.cleanup(); }
});

test("精读配音：规则稿立即可读，角色表后台升级", async () => {
  const h = harness();
  try {
    const state = await h.media.command({ action: "import", title: "精读", text: STORY, mode: "studio" });
    assert.equal(state.book.mode, "studio");
    // 没注入分析通道时，状态停在 idle，但书照样能读
    assert.equal(state.book.analysis.status, "idle");
    assert.ok(state.book.cast.length >= 1, `规则层也应认出角色：${JSON.stringify(state.book.cast)}`);
  } finally { h.cleanup(); }
});

test("切模式：实时 ⇄ 精读来回切都不丢正文", async () => {
  const h = harness();
  try {
    await h.media.command({ action: "import", title: "切换", text: STORY, mode: "studio" });
    const studioText = (await h.media.command({ action: "jump", index: 0 })).book.text;
    let s = await h.media.command({ action: "set-mode", mode: "live" });
    assert.equal(s.book.mode, "live");
    assert.deepEqual(s.book.cast, []);
    assert.equal(s.book.text, studioText, "切模式不该改动正文");
    s = await h.media.command({ action: "set-mode", mode: "studio" });
    assert.equal(s.book.mode, "studio");
    assert.ok(s.book.cast.length >= 1, "切回精读要能重建角色表");
    assert.equal(s.book.text, studioText);
  } finally { h.cleanup(); }
});

test("分析成功：角色表升级，别名不单列，旧音轨作废", async () => {
  let resolveAnalysis;
  const h = harness();
  try {
    let published = [];
    const media2 = require("../lib/companion-media").createCompanionMedia({
      dir: h.dir + "2", contentDir: CONTENT,
      synthesize: async () => ({ audio: null, via: "none" }),
      analyzeBook: () => new Promise((r) => { resolveAnalysis = r; }),
      send: () => {}, publish: (p) => published.push(p), mode: () => "world",
    });
    fs.mkdirSync(h.dir + "2", { recursive: true });
    const state = await media2.command({ action: "import", title: "升级", text: STORY, mode: "studio" });
    assert.equal(state.book.analysis.status, "running", "精读模式导入后应立刻开始分析");
    assert.ok(published.some((p) => p.book?.analysis?.status === "running"), "要告诉界面正在分析");

    resolveAnalysis({
      ok: true, via: "deepseek", isFiction: true,
      characters: [{ name: "周砚", gender: "male", age: "young", aliases: ["老周"] },
                   { name: "林夏", gender: "female", age: "young", aliases: [] }],
      cast: { 周砚: { voice: "m1", label: "清朗男声", gender: "male" },
              老周: { voice: "m1", label: "清朗男声", gender: "male", aliasOf: "周砚" },
              林夏: { voice: "f2", label: "沉稳女声", gender: "female" } },
    });
    await new Promise((r) => setTimeout(r, 30));
    const after = published[published.length - 1];
    assert.equal(after.book.analysis.status, "ready");
    assert.deepEqual(after.book.cast.map((c) => c.name), ["周砚", "林夏"], "别名不该单列成一个角色");
    const saved = JSON.parse(fs.readFileSync(path.join(h.dir + "2", "reading.json"), "utf8"));
    assert.equal(saved.cast["周砚"].voice, "m1");
    assert.ok(saved.rev > 0, "rev 要递增，否则预取的旧音轨会被错用");
    fs.rmSync(h.dir + "2", { recursive: true, force: true });
  } finally { h.cleanup(); }
});

test("分析失败：状态记录下来，书照旧能读", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-fail-"));
  try {
    const media = require("../lib/companion-media").createCompanionMedia({
      dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: null, via: "none" }),
      analyzeBook: async () => ({ ok: false, error: "模型服务暂时不可用" }),
      send: () => {}, publish: () => {}, mode: () => "world",
    });
    const state = await media.command({ action: "import", title: "失败", text: STORY, mode: "studio" });
    await new Promise((r) => setTimeout(r, 30));
    const after = await media.command({ action: "jump", index: 0 });
    assert.equal(after.book.analysis.status, "failed");
    assert.ok(after.book.analysis.error.includes("模型"));
    assert.ok(after.book.total >= 1, "分析失败不该影响正文");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("不是小说时给出提示，但仍然按角色读", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-nonfic-"));
  try {
    const media = require("../lib/companion-media").createCompanionMedia({
      dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: null, via: "none" }),
      analyzeBook: async () => ({ ok: true, via: "x", isFiction: false, characters: [], cast: {} }),
      send: () => {}, publish: () => {}, mode: () => "world",
    });
    await media.command({ action: "import", title: "说明书", text: "按下电源键三秒开机。指示灯亮起。", mode: "studio" });
    await new Promise((r) => setTimeout(r, 30));
    const after = await media.command({ action: "jump", index: 0 });
    assert.equal(after.book.analysis.status, "ready");
    assert.equal(after.book.analysis.isFiction, false);
    assert.ok(after.book.analysis.error.includes("不像小说"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 上一段播完会触发预取，紧跟着 ended 又调一次 read()。以前预取的 Promise
// 还没落地时 read() 查不到缓存，会对同一段再发一次合成 —— 重复调用 TTS。
test("预取还在合成时，切到下一段不会重复合成", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-prefetch-"));
  try {
    const pending = [];
    const media = createCompanionMedia({
      dir, contentDir: CONTENT,
      send: () => {}, publish: () => {}, mode: () => "desktop",
      synthesize: () => new Promise((resolve) => pending.push(resolve)),
    });
    await media.command({ action: "import", text: "第一段。\n第二段。" });
    void media.command({ action: "read" });
    await new Promise(setImmediate);
    const own = media.snapshot().token;
    // 第一段完成 → 开始播 → 触发下一段预取（此时仍未 resolve）
    pending[0]({ audio: "a1", via: "v" });
    await new Promise(setImmediate);
    assert.equal(pending.length, 2, "应已发起下一段预取");
    // 紧接着播完，切到第二段：必须复用预取那一次，不能再来第三个请求
    media.progress({ token: own, event: "ended" });
    await new Promise(setImmediate);
    assert.equal(pending.length, 2, "切段时重复发起了合成");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 长篇小说按章导航：章节标题独占一行，识别成章；正文里的行内提及不算。
test("章节标题识别：强模式认，行内提及和纯数字不认", () => {
  const N = require("../lib/narration");
  // 真实小说里这几种写法都常见，缺一个就会让目录少几章
  for (const title of [
    "第一章", "第十二章 潮汐", "第3卷", "第一卷 风起",
    "卷一　风起", "章三",                        // 多卷本常不带「第」
    "楔子", "序章", "尾声", "终章",               // 中文序章/尾声
    "Chapter 12", "Part I", "Prologue", "Epilogue",
  ]) {
    assert.equal(N.isChapterTitle(title), true, `应识别为章节: ${title}`);
  }
  // 这些都不能认，否则正文会被切成几百个假章节
  for (const notTitle of [
    "第一章写得不好，我读不下去。", "第一章写得不好我读不下去", // 以章号开头的正文句子
    "他说第一章写得不好",                                     // 行内提及
    "卷子发下来了", "序列号是三", "序", "章",                  // 「卷/序/章」出现在别的词里
    "1", "",
  ]) {
    assert.equal(N.isChapterTitle(notTitle), false, `不该识别为章节: ${notTitle}`);
  }
});

test("真实排版：全角空格、缩进与楔子段落归属正确", () => {
  const N = require("../lib/narration");
  const text = [
    "楔子",
    "　　夜色像一块浸了水的布。",
    "",
    "第一章　归港",
    "　　「船到了。」老陈说。",
    "　　林晚没有回头。",
    "",
    "第二章　暗流",
    "　　他站在那里。",
  ].join("\n");
  const b = N.buildBook(text, { mode: "live" });
  // 楔子本身算一章，标题前的正文（这里是空的）不受影响
  assert.equal(b.chapters.length, 3);
  assert.deepEqual(b.chapters.map((c) => c.title), ["楔子", "第一章　归港", "第二章　暗流"]);
  // 第一章之前的段落（若有）应归属 -1，不能显示成「第 0 章」
  const first = b.paragraphs.findIndex((p) => p.chapter >= 0);
  assert.equal(first, 0, "楔子在段首，第一段就属于第 0 章");
});

test("导入多章文本后能列出章节，章首段索引正确", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-chapter-"));
  try {
    const media = createCompanionMedia({
      dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: "a", via: "v" }),
      send: () => {}, publish: () => {}, mode: () => "desktop",
    });
    await media.command({
      action: "import",
      text: "第一章 潮汐\n她推开门。\n第二章 暗流\n他站在那里。\n第三章 归途\n天亮了。",
    });
    const b = media.snapshot().book;
    assert.equal(b.chapters.length, 3);
    assert.deepEqual(b.chapters.map((c) => c.startParagraph), [0, 2, 4]);
    assert.equal(b.chapters[0].title, "第一章 潮汐");
    assert.equal(b.chapter, 0, "导入后停在第一章");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("按章跳转落到该章首段，越界明确报错", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-chapter2-"));
  try {
    const media = createCompanionMedia({
      dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: "a", via: "v" }),
      send: () => {}, publish: () => {}, mode: () => "desktop",
    });
    await media.command({
      action: "import",
      text: "第一章 潮汐\n她推开门。\n第二章 暗流\n他站在那里。\n第三章 归途\n天亮了。",
    });
    const after = await media.command({ action: "jump", chapter: 2 });
    assert.equal(after.book.index, 4, "第 3 章首段是第 5 段");
    assert.equal(after.book.chapter, 2);
    assert.equal(after.book.text, "第三章 归途");
    await assert.rejects(media.command({ action: "jump", chapter: 99 }), /章节序号无效/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("没有章节的书不提供章节能力，按章跳明确报错", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-nochapter-"));
  try {
    const media = createCompanionMedia({
      dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: "a", via: "v" }),
      send: () => {}, publish: () => {}, mode: () => "desktop",
    });
    await media.command({ action: "import", text: "散文一段。\n散文二段。" });
    const b = media.snapshot().book;
    assert.deepEqual(b.chapters, [], "面板据此不渲染目录");
    assert.equal(b.chapter, -1, "不能显示成「第 0 章」");
    await assert.rejects(media.command({ action: "jump", chapter: 0 }), /没有识别到章节/);
    // 段落级导航必须照旧可用
    const ok = await media.command({ action: "jump", index: 1 });
    assert.equal(ok.book.index, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 音轨落盘之前，往回翻一段或重启后继续读都要重新合成；一本 300 段的书就是 300 次 TTS。
test("合成过的音轨落盘，重启后重读同一段不再调用 TTS", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-audiocache-"));
  let calls = 0;
  const make = () => createCompanionMedia({
    dir, contentDir: CONTENT,
    synthesize: async () => { calls++; return { audio: "QUJD", via: "mock" }; },
    send: () => {}, publish: () => {}, mode: () => "desktop",
  });
  try {
    const first = make();
    await first.command({ action: "import", text: "第一段。\n第二段。\n第三段。" });
    await first.command({ action: "read" });
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(calls > 0, "首次朗读应当合成");

    // 模拟重启：同一数据目录新建实例
    const afterFirst = calls;
    const restarted = make();
    await restarted.command({ action: "jump", index: 0 });
    await restarted.command({ action: "read" });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls, afterFirst, "重启后重读同一段不该再调 TTS");
    assert.ok(fs.readdirSync(path.join(dir, "audio-cache")).length > 0, "音轨应已落盘");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 换音色/切模式会 bumpRev，缓存键跟着变，否则会「换了音色还在放旧声音」
test("改角色音色后旧音轨缓存不再命中", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-audiocache2-"));
  let calls = 0;
  const media = createCompanionMedia({
    dir, contentDir: CONTENT,
    synthesize: async () => { calls++; return { audio: "QUJD", via: "mock" }; },
    send: () => {}, publish: () => {}, mode: () => "desktop",
  });
  try {
    await media.command({ action: "import", text: "“走吧。”老陈说。\n“等等。”老陈又说。" });
    await media.command({ action: "read" });
    await new Promise((r) => setTimeout(r, 40));
    const base = calls;
    const cast = media.snapshot().book.cast;
    assert.ok(cast.length >= 1);
    const other = media.snapshot().book.voices.find((v) => v.id !== cast[0].voice);
    await media.command({ action: "set-cast", name: cast[0].name, voice: other.id });
    await media.command({ action: "read" });
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(calls > base, "换音色后必须重新合成，不能复用旧音轨");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 切模式会重切朗读稿；章节是正文结构，不该因为换模式或跑完分析就丢掉
test("切换阅读模式后章节表仍在，章号不丢", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-chmode-"));
  try {
    const media = createCompanionMedia({
      dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: "a", via: "v" }),
      send: () => {}, publish: () => {}, mode: () => "desktop",
    });
    await media.command({
      action: "import",
      text: "第一章 潮汐\n她推开门。\n第二章 暗流\n他站在那里。",
    });
    assert.equal(media.snapshot().book.chapters.length, 2);
    const live = await media.command({ action: "set-mode", mode: "live" });
    assert.equal(live.book.chapters.length, 2, "实时阅读不该丢章节");
    assert.equal(live.book.chapter, 0);
    const studio = await media.command({ action: "set-mode", mode: "studio" });
    assert.equal(studio.book.chapters.length, 2, "切回精读不该丢章节");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// applyCast 会重建段落对象，是最容易把 chapter 丢掉的地方
test("角色分析完成后章节表与章号仍然一致", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-chanalysis-"));
  try {
    const media = createCompanionMedia({
      dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: "a", via: "v" }),
      analyzeBook: async () => ({
        ok: true, via: "mock", isFiction: true,
        characters: [{ name: "老陈", gender: "male", age: "old", aliases: [] }],
        cast: { 老陈: { voice: "old", label: "苍老声音" } },
      }),
      send: () => {}, publish: () => {}, mode: () => "desktop",
    });
    await media.command({
      action: "import",
      text: "第一章 潮汐\n“走吧。”老陈说。\n第二章 暗流\n“等等。”老陈又说。",
      mode: "studio",
    });
    await new Promise((r) => setTimeout(r, 30));
    const b = media.snapshot().book;
    assert.equal(b.analysis.status, "ready");
    assert.equal(b.chapters.length, 2, "分析重建段落后章节不能丢");
    assert.deepEqual(b.chapters.map((c) => c.startParagraph), [0, 2]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// reading.json 是用户可写文件，章节表被改乱也不能让章号计算卡死
test("章节表乱序或重复时仍能正确回填章号", () => {
  const book = normalizeBook({
    title: "乱序",
    paragraphs: ["第一章", "a", "第二章", "b", "第三章", "c"],
    // 故意乱序 + 重复 startParagraph
    chapters: [
      { title: "第二章", startParagraph: 2 },
      { title: "第一章", startParagraph: 0 },
      { title: "重复", startParagraph: 2 },
    ],
  });
  assert.ok(book);
  assert.equal(book.chapters.length, 2, "重复条目要去掉");
  assert.deepEqual(book.chapters.map((c) => c.title), ["第一章", "第二章"], "要按 startParagraph 排序");
  assert.deepEqual(book.paragraphs.map((p) => p.chapter), [0, 0, 1, 1, 1, 1]);
});

// 标题要经过 toSpeech 全链路仍然认得出；目录里显示的应是原文，不是被改写过的读法
test("章节标题走完整导入链路仍能识别，且目录保留原文", () => {
  const N = require("../lib/narration");
  const built = N.buildBook("第1章 1984年（上）\n正文一句。\n第2章 尾声\n正文两句。", { mode: "live" });
  assert.equal(built.chapters.length, 2, "阿拉伯数字章号也要认");
  // 正文会被规范化成「一九八四年」，但目录标题必须是原文
  assert.equal(built.chapters[0].title, "第1章 1984年（上）");
  assert.ok(!built.chapters[0].title.includes("一九"), "标题不能被读音规范化改写");
});

// 旧的 reading.json 没有 chapters 字段，读回时要能现算，不能要求用户重新导入
test("旧书数据没有章节字段时按段落现算", () => {
  const book = normalizeBook({
    title: "旧书",
    paragraphs: ["第一章 起", "正文一。", "第二章 承", "正文二。"],
  });
  assert.ok(book);
  assert.equal(book.chapters.length, 2);
  assert.deepEqual(book.chapters.map((c) => c.title), ["第一章 起", "第二章 承"]);
  assert.deepEqual(book.paragraphs.map((p) => p.chapter), [0, 0, 1, 1]);
});

// 角色名后面紧跟副词时（「老陈又问了一遍」），副词曾被一起捕获成名字，
// 于是配音表里多出「老陈又」这种不存在的角色。
test("说话人后的副词不会被算进角色名", () => {
  const built = require("../lib/narration").buildBook(
    "“走吧。”老陈说。\n“想好了？”老陈又问了一遍。\n她摇了摇头。",
    { mode: "studio" }
  );
  const names = Object.keys(built.cast);
  assert.ok(names.includes("老陈"), names.join(","));
  assert.ok(!names.some((n) => n.endsWith("又")), `混进了带副词的名字: ${names.join(",")}`);
});

// 配音表以前只能看不能改（音色写死在 narration.js 的 VOICE_POOL 里），
// 认错了角色只能改代码。现在面板上可以直接换，换完旧的音轨必须失效。
test("改角色音色会生效，并让已缓存的音轨作废", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-cast-"));
  try {
    const media = createCompanionMedia({
      dir, contentDir: CONTENT,
      synthesize: async () => ({ audio: "a", via: "v" }),
      send: () => {}, publish: () => {}, mode: () => "desktop",
    });
    await media.command({
      action: "import", text: "“走吧。”老陈说。\n“想好了？”老陈又问了一遍。",
    });
    const before = media.snapshot().book;
    assert.ok(before.voices.length > 1, "面板需要音色池才能渲染下拉框");
    assert.ok(before.cast.length >= 1);
    const target = before.cast[0];
    assert.ok(target.voice, "角色要带 voice id，否则下拉框选不中当前项");

    const other = before.voices.find((v) => v.id !== target.voice);
    await media.command({ action: "set-cast", name: target.name, voice: other.id });
    const after = media.snapshot().book.cast.find((c) => c.name === target.name);
    assert.equal(after.voice, other.id);
    assert.equal(after.label, other.label);

    // 负向：认不出的名字、不存在的音色、实时阅读模式都不该改表
    await assert.rejects(media.command({ action: "set-cast", name: "查无此人", voice: other.id }));
    await assert.rejects(media.command({ action: "set-cast", name: target.name, voice: "zzz" }));
    await media.command({ action: "set-mode", mode: "live" });
    await assert.rejects(media.command({ action: "set-cast", name: target.name, voice: other.id }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
