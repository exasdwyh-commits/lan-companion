"use strict";

// Administer only structured profile facts. memory.jsonl is legacy chat history:
// never expose its full records as "facts" or edit individual history lines.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Match memory-store's keyed profile syntax (- 属性：值 / - 属性: 值).
const FACT = /^-\s*([^：:]{1,20})[：:]\s*(\S.*)$/;
const SLEEP = new Int32Array(new SharedArrayBuffer(4));

function createMemoryAdmin({ dir } = {}) {
  if (typeof dir !== "string" || !dir.trim()) throw new TypeError("dir is required");
  const profileFile = path.join(dir, "profile.md");
  const memoryFile = path.join(dir, "memory.jsonl");
  const lockFile = path.join(dir, ".memory-admin.lock");

  function read(file) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw error;
    }
  }

  function rows() {
    const raw = read(profileFile);
    const lines = raw.split("\n");
    if (raw.endsWith("\n")) lines.pop();
    let skipped = 0;
    const facts = [];
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const match = line.match(FACT);
      if (!match || !match[1].trim()) {
        skipped++;
        return;
      }
      facts.push({ index, key: match[1].trim(), text: match[2] });
    });
    return { raw, lines, facts, skipped };
  }

  function withSkipped(items, skipped) {
    // Keep list() an ordinary array for consumers while reporting bad rows.
    Object.defineProperty(items, "skipped", { value: skipped, enumerable: false });
    return items;
  }

  function atomicWrite(file, data) {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(tmp, data, { flag: "wx", mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch (_) { /* tmp may not have been created */ }
      throw error;
    }
  }

  // Serialize administrator writes across processes; re-read only after lock.
  // Legacy memory-store does not take this lock, so its own writes cannot be
  // made fully transactional without changing that existing module.
  function locked(action) {
    fs.mkdirSync(dir, { recursive: true });
    let fd;
    const deadline = Date.now() + 3000;
    while (fd === undefined) {
      try {
        fd = fs.openSync(lockFile, "wx", 0o600);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() >= deadline) throw new Error("Memory admin is busy; retry shortly");
        Atomics.wait(SLEEP, 0, 0, 10);
      }
    }
    try {
      return action();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lockFile);
    }
  }

  function list({ query = "", limit = 50 } = {}) {
    const { facts, skipped } = rows();
    const needle = String(query ?? "").toLocaleLowerCase();
    const cap = Number.isFinite(limit) ? Math.max(0, Math.min(200, Math.trunc(limit))) : 50;
    // profile.md contains no timestamps; newest means most recently placed
    // in source order, not a fabricated wall-clock time.
    const items = facts.reverse()
      .filter(({ key, text }) => (key + "\n" + text).toLocaleLowerCase().includes(needle))
      .slice(0, cap)
      .map(({ key, text }) => ({ key, text }));
    return withSkipped(items, skipped);
  }

  function correct({ key, text } = {}) {
    if (typeof key !== "string" || !key.trim()) throw new TypeError("key is required");
    if (typeof text !== "string" || !text.trim()) throw new TypeError("text cannot be empty");
    if (/[\r\n]/.test(text)) throw new TypeError("text cannot contain a newline");
    const value = text.trim();
    if (Array.from(value).length > 500) throw new RangeError("text must be at most 500 characters");
    return locked(() => {
      const { lines, facts, skipped } = rows();
      const found = facts.find((row) => row.key === key);
      if (!found) throw new Error("Memory key not found");
      const original = lines[found.index];
      // Replace only the value; retain key, separator, position and other rows.
      const prefix = original.slice(0, original.length - found.text.length);
      lines[found.index] = prefix + value;
      atomicWrite(profileFile, lines.join("\n") + "\n");
      return { ok: true, skipped };
    });
  }

  function forget(key) {
    if (typeof key !== "string" || !key.trim()) throw new TypeError("key is required");
    return locked(() => {
      const { lines, facts, skipped } = rows();
      const found = facts.find((row) => row.key === key);
      if (found) {
        lines.splice(found.index, 1);
        atomicWrite(profileFile, lines.length ? lines.join("\n") + "\n" : "");
      }
      return { ok: true, removed: !!found, skipped };
    });
  }

  function clearAll({ confirm } = {}) {
    if (confirm !== true) throw new Error("clearAll requires confirm === true");
    return locked(() => {
      const { skipped } = rows();
      const backup = path.join(dir, `memory.bak-${Date.now()}-${randomUUID()}`);
      fs.mkdirSync(backup, { mode: 0o700 });
      // Back up raw bytes, including any malformed rows, before either clear.
      for (const file of [profileFile, memoryFile]) {
        try {
          atomicWrite(path.join(backup, path.basename(file)), fs.readFileSync(file));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      atomicWrite(profileFile, "");
      atomicWrite(memoryFile, "");
      return { ok: true, backup, skipped };
    });
  }

  return { list, correct, forget, clearAll };
}

module.exports = { createMemoryAdmin };
