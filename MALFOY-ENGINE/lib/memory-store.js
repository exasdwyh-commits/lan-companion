"use strict";
// 记忆与画像的读写。目录由调用方给，模块自己不认识 ~/.smartcompanion ——
// 这样同一个模块既能写真实目录，也能在测试里写临时目录。
//
// 保持与迁移前完全相同的落盘格式（memory.jsonl 一行一条 {t,u,a}，profile.md 一行一条 "- 事实"），
// 旧数据不用迁移就能继续读。

const fs = require("fs");
const path = require("path");

const MEM_MAX = 200;
const PROFILE_MAX = 40;
// `- 属性：值` / `- 属性: 值`；属性名限 20 字，值必须有内容。
const KEYED = /^-\s*([^：:]{1,20})[：:]\s*(\S.*)$/;

function keyOf(line) {
  const m = String(line || "").match(KEYED);
  return m ? m[1].trim() : null;
}

function createStore(dir) {
  const memoryFile = path.join(dir, "memory.jsonl");
  const profileFile = path.join(dir, "profile.md");

  function ensureDir() {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function remember(userText, replyText) {
    try {
      ensureDir();
      const rec = JSON.stringify({
        t: Date.now(),
        u: String(userText).slice(0, 300),
        a: String(replyText).slice(0, 400),
      }) + "\n";
      fs.appendFileSync(memoryFile, rec);
      const lines = fs.readFileSync(memoryFile, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length > MEM_MAX) {
        fs.writeFileSync(memoryFile, lines.slice(-MEM_MAX).join("\n") + "\n");
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function recall(n) {
    try {
      if (!fs.existsSync(memoryFile)) return [];
      const lines = fs.readFileSync(memoryFile, "utf8").trim().split("\n").filter(Boolean);
      return lines.slice(-(n || 6))
        .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function count() {
    try {
      if (!fs.existsSync(memoryFile)) return 0;
      return fs.readFileSync(memoryFile, "utf8").trim().split("\n").filter(Boolean).length;
    } catch (e) {
      return 0;
    }
  }

  function readProfile() {
    try {
      return fs.existsSync(profileFile) ? fs.readFileSync(profileFile, "utf8").trim() : "";
    } catch (e) {
      return "";
    }
  }

  /**
   * 合并后写回：只保留以 "- " 开头的行，最多 40 条。
   *
   * 结构化条目（`- 名字：小林`）按冒号前的属性名去重，同属性**后写的覆盖先写的** ——
   * 说错的事实才能被纠正，而不是新旧两条一起留在画像里互相打架。
   * 没有冒号的老条目（历史自由文本）仍按整行去重追加，不清洗、不丢。
   */
  function mergeProfile(extra) {
    try {
      ensureDir();
      const pick = (text) => String(text || "").split("\n").map((x) => x.trim()).filter((x) => x.startsWith("- "));
      const out = [];
      const pos = new Map();
      for (const line of pick(readProfile()).concat(pick(extra))) {
        const k = keyOf(line);
        if (k && pos.has(k)) {
          out[pos.get(k)] = line; // 覆盖，位置不变
        } else if (k) {
          pos.set(k, out.length);
          out.push(line);
        } else if (!out.includes(line)) {
          out.push(line);
        }
      }
      fs.writeFileSync(profileFile, out.slice(-PROFILE_MAX).join("\n") + "\n");
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 按属性名删一条。用户说「忘掉这个」时用，不做模糊匹配。 */
  function forget(key) {
    try {
      const want = String(key || "").trim();
      if (!want) return false;
      const kept = readProfile().split("\n").filter((line) => keyOf(line.trim()) !== want);
      fs.writeFileSync(profileFile, kept.join("\n").trim() + (kept.length ? "\n" : ""));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try {
      for (const file of [memoryFile, profileFile]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  return { dir, memoryFile, profileFile, remember, recall, count, readProfile, mergeProfile, forget, clear };
}

module.exports = { createStore, MEM_MAX, PROFILE_MAX, keyOf };
