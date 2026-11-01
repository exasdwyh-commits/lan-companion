"use strict";
// 曲库：把随包原曲与用户翻唱合成一个列表，并提供搜索。
// 用临时目录构造，不依赖真实数据与 dist。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSongLibrary } = require("../lib/song-library");

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

/** 造一个假的曲库目录：2 首原曲（含 1 首实验）+ 2 首翻唱（其中 1 首文件缺失）。 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "songlib-"));
  const contentDir = path.join(root, "content");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(path.join(contentDir, "songs"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "covers", UUID_A), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "covers", UUID_B), { recursive: true });

  const big = Buffer.alloc(2000, 1); // 实现会检查文件 >1000 字节
  fs.writeFileSync(path.join(contentDir, "songs", "tide.m4a"), big);
  fs.writeFileSync(path.join(contentDir, "songs", "demo.m4a"), big);
  fs.writeFileSync(path.join(dataDir, "covers", UUID_A, "cover.m4a"), big);
  // UUID_B 故意不写 cover.m4a —— 索引里有、文件没有，不该出现在曲库里

  fs.writeFileSync(path.join(contentDir, "songs.json"), JSON.stringify({
    songs: [
      { id: "tide", title: "岸边的潮", file: "songs/tide.m4a", credit: "原唱样例", unlockAt: 0, gain: 1, duration: 8.71, lyrics: [{ at: 0, zh: "海面把月亮揉碎" }] },
      { id: "demo", title: "旧念词实验", file: "songs/demo.m4a", credit: "历史样例", unlockAt: 0, gain: 1, experimental: true },
    ],
  }));
  fs.writeFileSync(path.join(dataDir, "covers", "library.json"), JSON.stringify([
    { id: UUID_A, title: "夜航星", createdAt: "2026-10-31T00:00:00.000Z", engine: "seed-vc-svc-f0-44k", duration: 208.5 },
    { id: UUID_B, title: "已删除的翻唱", createdAt: "2026-10-31T00:00:00.000Z" },
  ]));

  return { root, contentDir, dataDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("原曲与翻唱合成一个列表，翻唱排前面", () => {
  const f = fixture();
  try {
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    const all = lib.all();
    assert.equal(all.length, 3, "两首原曲 + 一首有效翻唱；文件缺失的那首不算");
    assert.equal(all[0].source, "cover", "用户自己做的翻唱排前面");
    assert.equal(all[0].title, "夜航星");
    assert.deepEqual(all.map((s) => s.source), ["cover", "pack", "pack"]);
  } finally { f.cleanup(); }
});

test("文件缺失的条目不会变成点了没反应的按钮", () => {
  const f = fixture();
  try {
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    assert.ok(!lib.all().some((s) => s.title === "已删除的翻唱"));
    assert.equal(lib.find(UUID_B), null);
  } finally { f.cleanup(); }
});

test("搜索按标题子串匹配，忽略大小写与空白", () => {
  const f = fixture();
  try {
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    assert.equal(lib.search("夜航").length, 1);
    assert.equal(lib.search("  夜航  ").length, 1, "首尾空白要忽略");
    assert.equal(lib.search("潮").length, 1);
    assert.equal(lib.search("不存在的歌").length, 0);
    // 空查询返回整个曲库，UI 直接展示
    assert.equal(lib.search("").length, 3);
    assert.equal(lib.search(undefined).length, 3);
  } finally { f.cleanup(); }
});

test("原曲的解锁阈值、歌词与实验标记都要透出", () => {
  const f = fixture();
  try {
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    const tide = lib.find("tide");
    assert.equal(tide.unlockAt, 0);
    assert.equal(tide.lyrics.length, 1);
    assert.equal(tide.experimental, false);
    assert.ok(tide.url.startsWith("file://"), "播放地址要统一成绝对 URL");

    const demo = lib.find("demo");
    assert.equal(demo.experimental, true, "旧念词实验要被标出来，面板折进「历史样例」");
  } finally { f.cleanup(); }
});

test("时长直接透出，曲库不自己跑 ffprobe", () => {
  const f = fixture();
  try {
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    assert.equal(lib.find(UUID_A).duration, 208.5, "翻唱的时长来自制作/导入时测好的索引");
    assert.equal(lib.find("tide").duration, 8.71, "随包原曲的时长写在 songs.json 里");
    assert.equal(lib.find("demo").duration, null, "没写就是 null，不要编一个出来");
  } finally { f.cleanup(); }
});

test("做完新翻唱后 invalidate 能立刻看到", () => {
  const f = fixture();
  try {
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    assert.equal(lib.all().length, 3);
    // 补上第二首翻唱的文件
    fs.writeFileSync(path.join(f.dataDir, "covers", UUID_B, "cover.m4a"), Buffer.alloc(2000, 1));
    lib.invalidate();
    assert.equal(lib.all().length, 4);
    assert.ok(lib.all().some((s) => s.title === "已删除的翻唱"), "文件补上后应出现在曲库里");
  } finally { f.cleanup(); }
});

// ── 歌姬模式产出的原创歌 ──────────────────────────────────────────
const UUID_C = "33333333-3333-3333-3333-333333333333";
const UUID_D = "44444444-4444-4444-4444-444444444444";

/** 在已有 fixture 上再挂两首原创歌：一首有她唱版，一首只有生成版。 */
function originalFixture() {
  const f = fixture();
  const big = Buffer.alloc(2000, 2);
  for (const id of [UUID_C, UUID_D]) fs.mkdirSync(path.join(f.dataDir, "originals", id), { recursive: true });
  fs.writeFileSync(path.join(f.dataDir, "originals", UUID_C, "song.m4a"), big);
  fs.writeFileSync(path.join(f.dataDir, "originals", UUID_C, "her.m4a"), big);
  fs.writeFileSync(path.join(f.dataDir, "originals", UUID_D, "song.m4a"), big);
  fs.writeFileSync(path.join(f.dataDir, "originals", "index.json"), JSON.stringify([
    { id: UUID_C, title: "海的信", createdAt: "2026-10-31T00:00:00.000Z", duration: 187, lyrics: "[Verse]\n潮水", model: "music-3.0", her: true },
    { id: UUID_D, title: "只有生成版", createdAt: "2026-10-31T00:00:00.000Z", model: "music-3.0", her: false },
  ]));
  return f;
}

test("原创歌排在最前面：那是完全属于她的东西", () => {
  const f = originalFixture();
  try {
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    const all = lib.all();
    assert.equal(all.length, 5, "两首原创 + 一首翻唱 + 两首原曲");
    assert.deepEqual(all.slice(0, 2).map((s) => s.source), ["original", "original"]);
  } finally { f.cleanup(); }
});

test("有她唱版时优先播她唱版，原版留在 altUrl 里", () => {
  const f = originalFixture();
  try {
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    const her = lib.find(UUID_C);
    assert.equal(her.her, true);
    assert.match(her.url, /her\.m4a$/, "她会唱了，就该播她唱的");
    assert.match(her.altUrl, /song\.m4a$/, "生成的原版要留着做对照");
    assert.equal(her.credit, "她写的");

    const plain = lib.find(UUID_D);
    assert.equal(plain.her, false);
    assert.match(plain.url, /song\.m4a$/);
    assert.equal(plain.altUrl, null, "没有第二个版本时不要编一个地址出来");
  } finally { f.cleanup(); }
});

test("原创歌的歌词和来源模型要透出，面板才有东西可显示", () => {
  const f = originalFixture();
  try {
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    const song = lib.find(UUID_C);
    assert.match(song.lyrics, /潮水/);
    assert.equal(song.engine, "minimax-music-3.0");
    assert.equal(song.duration, 187);
    assert.equal(song.experimental, false);
  } finally { f.cleanup(); }
});

test("原创歌的音频文件都丢了就不显示 —— 不做点了没反应的按钮", () => {
  const f = originalFixture();
  try {
    fs.rmSync(path.join(f.dataDir, "originals", UUID_C, "song.m4a"));
    fs.rmSync(path.join(f.dataDir, "originals", UUID_C, "her.m4a"));
    const lib = createSongLibrary({ dir: f.dataDir, contentDir: f.contentDir });
    assert.equal(lib.find(UUID_C), null);
  } finally { f.cleanup(); }
});
