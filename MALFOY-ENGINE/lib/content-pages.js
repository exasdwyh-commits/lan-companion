"use strict";
// 相册/剧情与记忆管理的窗口与 IPC 适配层。
// 逻辑在 lib/gallery.js / lib/memory-admin.js / lib/affection.js；这里只做：
//   1) 内容包路径 → file:// URL
//   2) 页面动作名 → 逻辑层动作名
//   3) 单例窗口与保存对话框
// 不改动主舞台状态机，窗口打不开也不影响世界/桌面两态。

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createGallery } = require("./gallery");
const { createAffection } = require("./affection");
const { createMemoryAdmin } = require("./memory-admin");

function createContentPages({ dataDir, contentDir, preload, BrowserWindow, ipcMain, dialog, parent = () => null }) {
  const packPath = path.join(contentDir, "pack.json");
  if (!fs.existsSync(packPath)) throw new Error("缺少内容包 pack.json：" + packPath);

  const affection = createAffection({ dir: dataDir, packPath });
  const gallery = createGallery({ packPath, dir: dataDir, affection: affection.snapshot().value });
  const memory = createMemoryAdmin({ dir: dataDir });
  const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
  const clips = new Map(pack.clips.map((clip) => [clip.id, clip]));
  const windows = { gallery: null, memory: null };
  const lineCursor = { touch: 0, wake: 0, quiet: 0 };

  /** 关系变化推给所有窗口：舞台的称呼、已打开的内容页都要跟上，不能各看各的。 */
  function notify() {
    const state = affection.snapshot();
    try {
      for (const win of BrowserWindow.getAllWindows ? BrowserWindow.getAllWindows() : []) {
        if (!win.isDestroyed()) win.webContents.send("affection:changed", state);
      }
    } catch (_) { /* 窗口正在关闭时忽略 */ }
    return state;
  }
  function bump(kind) {
    const result = affection.add(kind);
    if (result && result.ok) notify();
    return result;
  }
  // 每天第一次打开应用给一次到访好感，规则来自 pack.affection.dailyVisit。
  bump("daily");

  /** 收据结算协议（R2）：把 gallery 里的 pending 收据补进好感度并确认。
   *  affection.grant 幂等（分数+收据 ID 同一次原子写入），崩溃在任一步
   *  之后重放都恰好结算一次；写入仍失败则留待下次再补，不丢奖励。 */
  function settlePending() {
    let changed = false;
    for (const { id, reward } of gallery.pendingReceipts()) {
      try {
        const granted = affection.grant(id, reward);
        if (granted.added > 0) changed = true;
        gallery.settle(id);
      } catch (_) { /* 存储暂不可用：收据仍为 pending，下次调用/重启继续补。 */ }
    }
    if (changed) notify();
  }
  settlePending();

  /** 点击台词轮换；没有对应数组时退回 touches，绝不返回空。 */
  function nextLine(kind) {
    const list = kind === "wake" ? pack.wakeLines : kind === "quiet" ? pack.quietLines : pack.touches;
    const source = Array.isArray(list) && list.length ? list : (pack.touches || []);
    if (!source.length) return "";
    const key = kind === "wake" || kind === "quiet" ? kind : "touch";
    const line = source[lineCursor[key] % source.length];
    lineCursor[key] += 1;
    return line;
  }

  const url = (rel) => (typeof rel === "string" && rel ? pathToFileURL(path.resolve(contentDir, rel)).href : "");
  const sceneOf = (clip) => (clip ? { id: clip.id, text: clip.text || "", image: url(clip.image) } : null);

  /** 页面需要的完整视图：解锁态 + 图片 URL + 章节 flow/choices。 */
  function view() {
    const value = affection.snapshot().value;
    gallery.setAffection(value);
    const snap = gallery.snapshot();
    return {
      ...snap,
      affection: value,
      album: snap.album.map((item) => ({
        ...item, image: url(item.file), ...(item.desktopFile ? { desktopImage: url(item.desktopFile) } : {}),
      })),
      chapters: pack.chapters.map((chapter) => {
        const state = snap.chapters.find((item) => item.id === chapter.id) || {};
        return { ...state, flow: chapter.flow || [], choices: chapter.choices || null };
      }),
      clips: Object.fromEntries(pack.clips.map((clip) => [clip.id, { ...clip, image: url(clip.image) }])),
      progress: { ...(snap.progress || {}), affection: value },
    };
  }

  function action(payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    // 每次操作先补历史收据：上一次崩溃遗留的奖励在这里恢复。
    settlePending();
    switch (p.action) {
      case "start": {
        const result = gallery.command({ action: "start-chapter", id: p.chapterId });
        return { ok: true, scene: sceneOf(result.clip), state: view() };
      }
      case "advance": {
        const result = gallery.command({ action: "advance" });
        return { ok: true, scene: sceneOf(result.clip), state: view() };
      }
      case "choose": {
        if (p.option !== "A" && p.option !== "B") throw new Error("分支只能选择 A 或 B。");
        const result = gallery.command({ action: "choose", branch: p.option });
        return { ok: true, scene: sceneOf(result.clip), state: view() };
      }
      case "complete": {
        const result = gallery.command({ action: "finish" });
        // 首次通关发收据奖励：先入账（幂等）再确认收据；任一步失败都由
        // settlePending 按收据补齐，重复通关 reward 为 0 不重复加。
        if (result.reward > 0 && result.receiptId) {
          try {
            const granted = affection.grant(result.receiptId, result.reward);
            gallery.settle(result.receiptId);
            if (granted.added > 0) notify();
          } catch (_) { /* 收据已落盘为 pending，下次操作/重启补发。 */ }
        }
        return { ok: true, reward: result.reward, state: view() };
      }
      default:
        throw new Error("不支持的相册操作：" + String(p.action));
    }
  }

  function savePhoto(id, variant = "mobile") {
    const photo = pack.album.find((item) => item.id === id);
    if (!photo) throw new Error("照片不存在。");
    const checked = gallery.command({ action: "save-photo", id, variant });
    const file = variant === "desktop" ? photo.desktopFile : photo.file;
    if (!file) throw new Error("这张照片没有电脑壁纸版本。");
    const win = windows.gallery;
    return dialog
      .showSaveDialog(win || undefined, {
        title: variant === "desktop" ? "保存电脑壁纸" : "保存手机壁纸",
        defaultPath: path.join(require("os").homedir(), "Pictures", path.basename(file)),
        filters: [{ name: "图片", extensions: [path.extname(file).replace(".", "") || "jpg"] }],
      })
      .then((picked) => {
        if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
        fs.copyFileSync(checked.source, picked.filePath);
        return { ok: true, path: picked.filePath };
      });
  }

  function openWindow(kind, tab, size) {
    const key = kind === "memory" ? "memory" : "gallery";
    let win = windows[key];
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      return win;
    }
    const box = size || {};
    win = new BrowserWindow({
      width: box.width || 960,
      height: box.height || 680,
      minWidth: box.width ? 320 : 640,
      minHeight: box.height ? 240 : 420,
      title: key === "memory" ? "她记得的事" : "澜 · 相册与剧情",
      backgroundColor: "#0b1524",
      autoHideMenuBar: true,
      parent: parent() || undefined,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    windows[key] = win;
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const query = tab ? { tab } : {};
    win.loadFile(path.join(__dirname, "../web/live2d", key + ".html"), { query });
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => { if (windows[key] === win) windows[key] = null; });
    return win;
  }

  function open(kind, tab) {
    openWindow(kind, tab);
    return { ok: true };
  }

  // 验收用：真实 Electron 渲染 + 真实 preload/IPC，截一张图后关窗。
  // 只在 LAN_CONTENT_PROBE=1 时由主进程调用，正常运行不触发。
  async function capture(kind, outPath, tab, size) {
    const win = openWindow(kind, tab, size);
    const wc = win.webContents;
    if (wc.isLoading()) await new Promise((resolve) => wc.once("did-finish-load", resolve));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const image = await wc.capturePage();
    fs.writeFileSync(outPath, image.toPNG());
    if (!win.isDestroyed()) win.close();
    return outPath;
  }

  return { register, open, view, action, savePhoto, capture, affection, bump, nextLine, notify, gallery, memory };

  function register() {
    ipcMain.handle("companion:affection", () => affection.snapshot());
    ipcMain.handle("companion:touch-line", (_e, kind) => nextLine(kind));
    ipcMain.handle("companion:gallery-state", () => view());
    ipcMain.handle("companion:gallery-action", (_e, p) => {
      try { return action(p); } catch (error) { return { ok: false, error: String(error && error.message || error) }; }
    });
    ipcMain.handle("companion:gallery-save", async (_e, request) => {
      try {
        const p = request && typeof request === "object" ? request : { id: request };
        return await savePhoto(p.id, p.variant || "mobile");
      } catch (error) { return { ok: false, error: String(error && error.message || error) }; }
    });
    ipcMain.handle("companion:memory-list", (_e, p) => {
      try { return { ok: true, items: memory.list(p || {}) }; } catch (error) { return { ok: false, error: String(error && error.message || error) }; }
    });
    ipcMain.handle("companion:memory-correct", (_e, p) => {
      try { return memory.correct(p || {}); } catch (error) { return { ok: false, error: String(error && error.message || error) }; }
    });
    ipcMain.handle("companion:memory-forget", (_e, key) => {
      try { return memory.forget(key); } catch (error) { return { ok: false, error: String(error && error.message || error) }; }
    });
    ipcMain.handle("companion:memory-clear", (_e, p) => {
      try { return memory.clearAll(p || {}); } catch (error) { return { ok: false, error: String(error && error.message || error) }; }
    });
    ipcMain.handle("companion:open-content", (_e, kind, tab) => open(kind, tab));
  }

  return { register, open, view, action, savePhoto, affection, gallery, memory };
}

module.exports = { createContentPages };
