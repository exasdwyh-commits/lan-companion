"use strict";
// 服务端点与本机路径集中在这里。
//
// 目的（DW-01）：① 换机器/换端口只改一处；② 源码里不再躺内嵌密钥 ——
// 原来 main.js 里写死过一个本地 llama-server 的 key，仓库一旦公开就是泄露。
// 现在一律「环境变量 → ~/.hermes/.env → 空」，取不到就自然走下一个回退源。
//
// 注意：这里只集中「能改的常量」，不搬业务逻辑。

const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = process.env.HOME || os.homedir();

function env(key, fallback) {
  const value = process.env[key];
  return value !== undefined && value !== "" ? value : fallback;
}

const ENV_FILE = env("HERMES_ENV_FILE", path.join(HOME, ".hermes/.env"));

/** 从 ~/.hermes/.env 里读一个 KEY=value。只读，不回写，不打印值。 */
function envFileValue(key) {
  try {
    const matched = fs.readFileSync(ENV_FILE, "utf8").match(new RegExp("^" + key + "=(\\S+)", "m"));
    return matched ? matched[1].trim() : "";
  } catch (e) {
    return "";
  }
}

/** 密钥解析顺序：环境变量 → .env 文件 → 空串（调用方自己决定没有密钥时怎么办）。 */
function secret(key) {
  return env(key, "") || envFileValue(key);
}

const config = {
  home: HOME,
  envFile: ENV_FILE,

  // 本地服务
  sttUrl: env("STT_URL", "http://127.0.0.1:8090/stt"),
  ttsQwenUrl: env("TTS_QWEN_URL", "http://127.0.0.1:8091/tts"),
  magpieUrl: env("MAGPIE_URL", "http://127.0.0.1:3425/v1/chat/completions"),
  // 本地兜底有两套部署方式，都在本机常见：llama-server 与 ollama（OpenAI 兼容端点）。
  // ollama 先试：它的 OpenAI 兼容层稳定，且 /api/tags 能列出真装了的模型。
  ollamaUrl: env("OLLAMA_URL", "http://127.0.0.1:11434/v1/chat/completions"),
  ollamaModel: env("OLLAMA_MODEL", "deepseek-r1:7b"),
  localLlmUrl: env("LOCAL_LLM_URL", "http://127.0.0.1:18434/v1/chat/completions"),
  localLlmModel: env("LOCAL_LLM_MODEL", "Qwen3.8-27B-UD-Q4_K_M"),

  // 云侧
  llmUrl: env("LLM_URL", "https://apihub.agnes-ai.com/v1/chat/completions"),
  llmModel: env("LLM_MODEL", "agnes-3.0-flash"),

  // 外部程序
  hermesBin: env("HERMES_BIN", path.join(HOME, ".local/bin/hermes")),
  hermesSession: env("HERMES_SESSION", "pet"),
  edgeTtsBin: env("EDGE_TTS_BIN", path.join(HOME, "Documents/VScode/selfmedia/venv-tts/bin/edge-tts")),

  secret,
};

// 按实测速度排序；timeout 秒数给慢源短超时，失败快速跳过。
//
// 2026-10-31 流式实测（首字正文 / 整段）：
//   qoder/dfmodel          2.0–2.3s / 2.4s   ← 稳，适合当第一梯队
//   qoder/qfmodel         12.3s / 12.6s      ← 先吐 reasoning_content，聊天用不了
//   workbuddy-ai/*        配额打满时 429（0.1s 快速失败，不占时间）
// 顺序就是延迟：慢源排在前面，每次对话都要白等一个超时。
const MODEL_POOL = [
  { id: "workbuddy-ai/deepseek-v4.1-flash", timeout: 25 },
  { id: "workbuddy-ai/deepseek-v4.1-flash-sg", timeout: 25 },
  { id: "qoder/dfmodel", timeout: 10 },
  { id: "auto/deepseek-v4.1-flash", timeout: 25 },
  { id: "123/deepseek-v4.1-flash", timeout: 10 },
  // 推理型模型：正文要等思考结束才出，压到最后一档
  { id: "qoder/qfmodel", timeout: 10 },
];

// ffmpeg 绝对路径（launchd/Electron 环境 PATH 不可靠）
function findFfmpeg() {
  const candidates = [
    env("FFMPEG_BIN", ""),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    path.join(HOME, ".hermes/tools/ffmpeg-9.0.1-darwin-arm64/ffmpeg"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (e) { /* 继续找 */ }
  }
  return "ffmpeg";
}

module.exports = { config, MODEL_POOL, findFfmpeg, envFileValue };
