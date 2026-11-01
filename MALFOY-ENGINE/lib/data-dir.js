"use strict";
// 数据目录解析：Electron 侧所有用户数据的唯一入口。
//
// 为什么单独抽一个模块：真跑 Electron 要开窗口、要屏幕会话，验收成本高且会碰真实记忆。
// 把「目录从哪来」做成纯函数，就能用 node --test 直接断言，不必启动 app。
//
// 优先级（高 → 低）：
//   命令行 --data-dir=/tmp/x   →  环境变量 LAN_DATA_DIR  →  ~/.smartcompanion（旧默认）
// 保留旧默认是为了不打断现有用户；测试一律显式传，不靠改 HOME 绕过。

const path = require("path");
const os = require("os");

const FLAGS = ["--data-dir", "--data"];
const ENV_KEYS = ["LAN_DATA_DIR", "LINGDESK_DATA_DIR", "PET_DATA_DIR"];

function argValue(argv) {
  const list = Array.isArray(argv) ? argv.map(String) : [];
  for (let i = 0; i < list.length; i += 1) {
    for (const flag of FLAGS) {
      if (list[i] === flag) {
        const next = list[i + 1];
        if (next && !next.startsWith("-")) return { value: next, source: "argv" };
        return { value: "", source: "argv", broken: flag };
      }
      if (list[i].startsWith(flag + "=")) {
        return { value: list[i].slice(flag.length + 1), source: "argv" };
      }
    }
  }
  return { value: "", source: "" };
}

/**
 * @param {{argv?: string[], env?: Record<string,string>, home?: string, cwd?: string}} options
 * @returns {{dir: string, source: "argv"|"env"|"default", explicit: boolean,
 *            isDefault: boolean, home: string, warning?: string}}
 */
function resolveDataDir(options = {}) {
  const argv = options.argv || process.argv.slice(1);
  const env = options.env || process.env;
  const home = options.home || env.HOME || os.homedir();
  const cwd = options.cwd || process.cwd();
  const fallback = path.join(home, ".smartcompanion");

  const fromArgv = argValue(argv);
  let raw = fromArgv.value;
  let source = fromArgv.value ? "argv" : "";

  if (!raw) {
    for (const key of ENV_KEYS) {
      const value = env[key];
      if (value && String(value).trim()) {
        raw = String(value).trim();
        source = "env";
        break;
      }
    }
  }

  if (!raw) {
    return { dir: fallback, source: "default", explicit: false, isDefault: true, home };
  }

  const trimmed = String(raw).trim();
  if (!trimmed) {
    return { dir: fallback, source: "default", explicit: false, isDefault: true, home };
  }
  const dir = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(cwd, trimmed);
  // 显式传了默认目录 = 测试看起来隔离了、实际还在写真数据。给出明确警告而不是静默接受。
  const warning = dir === fallback
    ? "显式数据目录等于旧默认目录，隔离无效"
    : undefined;
  return { dir, source, explicit: true, isDefault: dir === fallback, home, warning };
}

/** Electron 自己的 Chromium 状态（localStorage/IndexedDB/缓存）落在 userData，也一起搬走。 */
function userDataDirFor(dir) {
  return path.join(dir, "electron");
}

/** 子进程（Hermes、TTS、ffmpeg）该继承的环境：把数据目录带出去，避免它们各自回落到真实路径。 */
function childEnv(dataDir, base = process.env) {
  const env = { ...base };
  env.LAN_DATA_DIR = dataDir;
  env.LINGDESK_DATA_DIR = dataDir;
  return env;
}

module.exports = { resolveDataDir, userDataDirFor, childEnv, FLAGS, ENV_KEYS };
