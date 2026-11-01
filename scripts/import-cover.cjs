#!/usr/bin/env node
"use strict";
/**
 * 把已经做好的翻唱成品导入 App 曲库。
 *
 * 为什么需要：曲库索引 `<data>/covers/library.json` 只有走 App 的 cover-jobs 才会写。
 * 用命令行管线（scripts/sing_cover_file.sh）做出来的成品躺在 assets/ 里，
 * App 完全不知道它存在 —— 用户打开曲库看到的是空的。
 *
 * 用法：
 *   node scripts/import-cover.mjs <音频文件> --title "《你我怎么两清》" [--engine xxx] [--data <目录>]
 *
 * 幂等：同一个内容（sha1 相同）重复导入会被跳过，不会攒出一堆重复条目。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const FFMPEG = process.env.FFMPEG || "/Users/exasdwyh/bin/ffmpeg";

function parseArgs(argv) {
  const out = { file: null, title: null, engine: null, data: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--title") out.title = argv[++i];
    else if (a === "--engine") out.engine = argv[++i];
    else if (a === "--data") out.data = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (!a.startsWith("--") && !out.file) out.file = a;
  }
  return out;
}

/** 秒数（浮点）。ffprobe 不一定装着，所以从 ffmpeg 的 stderr 里取。 */
function durationOf(file) {
  try {
    const err = execFileSync(FFMPEG, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] }).toString();
    const m = err.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  } catch (e) {
    const err = String(e && e.stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    return err ? Number(err[1]) * 3600 + Number(err[2]) * 60 + Number(err[3]) : null;
  }
}

function sha1(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('用法: node scripts/import-cover.mjs <音频文件> --title "歌名" [--engine 标签] [--data 目录]');
    return 2;
  }
  const src = path.resolve(args.file);
  if (!fs.existsSync(src)) { console.error("文件不存在:", src); return 2; }
  if (fs.statSync(src).size < 1000) { console.error("文件太小，不像有效音频:", src); return 2; }

  const dataDir = args.data || path.join(os.homedir(), ".smartcompanion");
  const root = path.join(dataDir, "covers");
  const indexFile = path.join(root, "library.json");
  fs.mkdirSync(root, { recursive: true });

  const rows = (() => {
    try { const v = JSON.parse(fs.readFileSync(indexFile, "utf8")); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  })();

  // 用内容 hash 判重，而不是文件名 —— 同一首歌换个路径重复导出很常见。
  const sum = sha1(src);
  const existed = rows.find((r) => r && r.sha1 === sum);
  if (existed) {
    console.log("已在曲库中，跳过:", existed.id, existed.title);
    return 0;
  }

  const id = crypto.randomUUID();
  const title = args.title || path.basename(src, path.extname(src));
  const duration = durationOf(src);
  const folder = path.join(root, id);

  const entry = {
    id,
    title,
    createdAt: new Date().toISOString(),
    engine: args.engine || "seed-vc-svc-f0-44k",
    duration,                       // 秒，UI 显示时长用；测不出就是 null，不影响播放
    sha1: sum,
    imported: true,                 // 标记来源是命令行产物，而非 App 内制作
  };

  if (args.dryRun) {
    console.log("dry-run:", JSON.stringify(entry));
    return 0;
  }

  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(src, path.join(folder, "cover.m4a"));
  // 新的排最前，和 cover-jobs 的顺序约定一致。
  fs.writeFileSync(indexFile + ".tmp", JSON.stringify([entry, ...rows]));
  fs.renameSync(indexFile + ".tmp", indexFile);

  console.log("已导入曲库:", id);
  console.log("  标题:", title);
  console.log("  时长:", duration ? duration.toFixed(2) + "s" : "未知");
  console.log("  落地:", path.join(folder, "cover.m4a"));
  return 0;
}

process.exit(main());
