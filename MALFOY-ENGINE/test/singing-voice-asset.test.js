"use strict";
/**
 * 唱歌参考音色是翻唱的硬依赖。
 *
 * 它之前是每次做翻唱时现场用 TTS 生成的，于是翻唱成功与否取决于 TTS 服务状态 ——
 * 而这条链路有三重脆弱点（15s 超时、失败熔断 5 分钟、服务并发无锁）。
 * 现在改成优先读本机定稿资产，只有资产缺失才回退现场生成。
 *
 * 所以这里守的是两件事：
 *   1. 资产必须存在，且开发目录与包内资源目录两处都有（缺一处另一处会静默漂移）；
 *   2. 时长必须够长。Seed-VC 的音色统计吃参考长度，实测 3.7 秒的参考会让
 *      输出"薄、尖"，所以这里给一个下限，防止有人换成短样本当"更省事"的资产。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const ASSET_REL = path.join("assets", "whale-video-test", "voice", "ref-sing-magnetic.wav");
const DEV_ASSET = path.join(ROOT, ASSET_REL);
const PACKED_ASSET = path.join(ROOT, "MALFOY-ENGINE", "web", "live2d", "companion-content", "ref-sing-magnetic.wav");

/** 从 WAV 头算时长，不依赖 ffmpeg。 */
function wavSeconds(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.slice(0, 4).toString("ascii"), "RIFF", `${file} 不是 RIFF 容器`);
  assert.equal(buf.slice(8, 12).toString("ascii"), "WAVE", `${file} 不是 WAVE`);
  let off = 12, byteRate = 0, dataBytes = 0;
  while (off + 8 <= buf.length) {
    const id = buf.slice(off, off + 4).toString("ascii");
    const size = buf.readUInt32LE(off + 4);
    // fmt 块布局：+8 编码 / +10 声道 / +12 采样率 / +16 每秒字节数
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") dataBytes = size;
    off += 8 + size + (size % 2); // RIFF 块按 2 字节对齐
  }
  assert.ok(byteRate > 0, `${file} 缺 fmt 块或每秒字节数为 0`);
  assert.ok(dataBytes > 0, `${file} 缺 data 块`);
  return dataBytes / byteRate;
}

test("唱歌参考音色资产存在，且开发目录与包内资源各有一份", () => {
  assert.ok(fs.existsSync(DEV_ASSET), `缺少 ${ASSET_REL} —— 翻唱会退化成依赖 TTS 现场生成`);
  assert.ok(fs.existsSync(PACKED_ASSET), "companion-content 下没有兜底副本，分发版会找不到音色");
});

test("两处副本内容一致（改一处忘另一处会静默漂移）", () => {
  if (!fs.existsSync(DEV_ASSET) || !fs.existsSync(PACKED_ASSET)) return;
  const a = fs.readFileSync(DEV_ASSET), b = fs.readFileSync(PACKED_ASSET);
  assert.equal(Buffer.compare(a, b), 0, "开发目录与包内的唱歌音色不是同一份");
});

test("唱歌参考音色够长：Seed-VC 吃参考长度，短样本会让输出变薄变尖", () => {
  const secs = wavSeconds(DEV_ASSET);
  // 实测 3.74 秒的参考只能提供约 15% 的可用信息量，音色明显偏薄；
  // Seed-VC 内部截断在 25 秒，所以 15s 是「明显好于旧问题」的下限。
  assert.ok(secs >= 15, `唱歌参考只有 ${secs.toFixed(2)} 秒，音色会偏薄（要求 ≥15 秒）`);
  assert.ok(secs <= 120, `唱歌参考 ${secs.toFixed(2)} 秒过长，Seed-VC 会截断且推理变慢`);
});
