"use strict";
/**
 * 朗读音轨的落盘缓存。
 *
 * 之前合成出来的音轨只在内存里过一手就丢了，于是「往回翻一段」「重启后继续读」
 * 都要重新合成。实测 TTS 约 1.06 秒一次，一本 300 段的书从头听一遍就是 300 次调用。
 * 音轨本来就已经生成了，缺的只是存下来。
 *
 * 键用调用方给的字符串（读书侧是 `bookId:rev:index:profile`），
 * 文件名取它的 sha1 —— rev 变了键就变，旧音轨自然不命中，不需要额外的失效逻辑。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

function createAudioCache({ dir, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const root = path.join(dir, "audio-cache");
  fs.mkdirSync(root, { recursive: true });

  const nameOf = (key) => crypto.createHash("sha1").update(String(key)).digest("hex");
  const fileOf = (key) => path.join(root, nameOf(key) + ".mp3");

  const scan = () => {
    let total = 0;
    try {
      for (const name of fs.readdirSync(root)) {
        if (!name.endsWith(".mp3")) continue;
        try { total += fs.statSync(path.join(root, name)).size; } catch (_) {}
      }
    } catch (_) {}
    return total;
  };

  let total = scan();

  /**
   * 淘汰按 mtime 从旧到新。不用 atime：很多挂载点是 noatime，读一次不会更新时间戳，
   * 拿它做 LRU 会把最常用的文件先删掉。
   */
  function evict() {
    if (total <= maxBytes) return;
    let entries = [];
    try {
      entries = fs.readdirSync(root)
        .filter((n) => n.endsWith(".mp3"))
        .map((n) => {
          const full = path.join(root, n);
          try {
            const st = fs.statSync(full);
            return { full, at: st.mtimeMs, size: st.size };
          } catch (_) { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => a.at - b.at);
    } catch (_) { return; }
    for (const item of entries) {
      if (total <= maxBytes) break;
      try { fs.unlinkSync(item.full); total -= item.size; } catch (_) {}
    }
    if (total < 0) total = 0;
  }

  function get(key) {
    if (!key) return null;
    const file = fileOf(key);
    let buf;
    try { buf = fs.readFileSync(file); } catch (_) { return null; }
    if (!buf.length) { try { fs.unlinkSync(file); } catch (_) {} return null; }
    // 命中就把 mtime 刷新成现在，作为 LRU 的「最近使用」标记
    const now = new Date();
    try { fs.utimesSync(file, now, now); } catch (_) {}
    return buf;
  }

  function put(key, buf) {
    if (!key || !Buffer.isBuffer(buf) || !buf.length) return false;
    const file = fileOf(key);
    try {
      fs.writeFileSync(file + ".tmp", buf);
      fs.renameSync(file + ".tmp", file);
    } catch (_) { return false; }
    total += buf.length;
    evict();
    return true;
  }

  function clear() {
    try {
      for (const name of fs.readdirSync(root)) {
        if (name.endsWith(".mp3") || name.endsWith(".tmp")) {
          try { fs.unlinkSync(path.join(root, name)); } catch (_) {}
        }
      }
    } catch (_) {}
    total = 0;
  }

  return { get, put, clear, size: () => total, root };
}

module.exports = { createAudioCache, DEFAULT_MAX_BYTES };
