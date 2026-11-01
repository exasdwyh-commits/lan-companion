"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** 只管理内容包的相册与章节状态；数据目录和好感度由调用者显式提供。 */
function createGallery({ packPath, dir, affection = 0 }) {
  if (typeof packPath !== "string" || !packPath || typeof dir !== "string" || !dir) {
    throw new Error("请提供内容包路径和相册状态目录。");
  }
  const packFile = path.resolve(packPath);
  const packDir = path.dirname(packFile);
  const pack = JSON.parse(fs.readFileSync(packFile, "utf8"));
  if (!Array.isArray(pack.album) || !Array.isArray(pack.chapters) || !Array.isArray(pack.clips)
      || !Number.isFinite(pack.affection?.max) || pack.affection.max < 0) {
    throw new Error("内容包缺少有效的相册、章节、镜头或好感度上限。");
  }
  const albums = new Map(pack.album.map((item) => [item.id, item]));
  const chapters = new Map(pack.chapters.map((item) => [item.id, item]));
  const clips = new Map(pack.clips.map((item) => [item.id, item]));
  const stateFile = path.join(path.resolve(dir), "gallery.json");
  const empty = () => ({ version: 2, completed: [], rewarded: [], receipts: {}, progress: null });
  let state = empty();
  let currentAffection = 0;

  function setAffection(n) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > pack.affection.max) {
      throw new Error(`好感度必须在 0 到 ${pack.affection.max} 之间。`);
    }
    currentAffection = n;
    return snapshot();
  }

  function validState(s) {
    if (!s || typeof s !== "object" || Array.isArray(s) || s.version !== 2
        || !Array.isArray(s.completed) || !Array.isArray(s.rewarded)
        || ![s.completed, s.rewarded].every((ids) => ids.every((id) => chapters.has(id) && typeof id === "string" && ids.indexOf(id) === ids.lastIndexOf(id)))
        || !s.rewarded.every((id) => s.completed.includes(id))
        || !s.completed.every((id) => s.rewarded.includes(id))
        || !s.receipts || typeof s.receipts !== "object" || Array.isArray(s.receipts)) return false;
    const receiptIds = Object.keys(s.receipts);
    if (!receiptIds.every((id) => chapters.has(id) && s.rewarded.includes(id) && s.receipts[id]
        && (s.receipts[id].state === "pending" || s.receipts[id].state === "granted")
        && Number.isSafeInteger(s.receipts[id].reward) && s.receipts[id].reward >= 0)) return false;
    // rewarded 与收据一一对应：结算协议的幂等基础。
    if (!s.rewarded.every((id) => s.receipts[id])) return false;
    if (s.progress === null) return true;
    const p = s.progress;
    const chapter = p && chapters.get(p.chapterId);
    if (!chapter || !Array.isArray(chapter.flow) || !Number.isInteger(p.index)
        || p.index < 0 || p.index >= chapter.flow.length
        || (p.branch !== null && p.branch !== "A" && p.branch !== "B")
        || typeof p.done !== "boolean" || typeof p.rewarded !== "boolean"
        || p.rewarded !== s.rewarded.includes(p.chapterId)
        || (p.done && (!p.rewarded || !s.completed.includes(p.chapterId)
          || (p.index !== chapter.flow.length - 1)
          || (!p.branch && chapter.flow.some((step) => step.branch))))) return false;
    const step = chapter.flow[p.index];
    if (!step || (p.branch !== null && (!step.branch || !clips.has(step.branch[p.branch])))) return false;
    return p.branch === null || Boolean(step.branch);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    // v1 → v2 迁移：历史 rewarded 一律记为已结算收据，绝不补发旧奖励。
    state = parsed && parsed.version === 1 ? {
      ...parsed,
      version: 2,
      receipts: Object.fromEntries(parsed.rewarded.map((id) => [
        id, { reward: (chapters.get(id) || {}).reward || 0, state: "granted" },
      ])),
    } : parsed;
    if (!validState(state)) throw new Error("相册状态字段无效");
  } catch (error) {
    if (error.code !== "ENOENT" && fs.existsSync(stateFile)) {
      // 损坏数据保留现场；备份失败时仍用空状态继续运行。
      try {
        let backup = `${stateFile}.bad-${Date.now()}`;
        for (let n = 1; fs.existsSync(backup); n++) backup = `${stateFile}.bad-${Date.now()}-${n}`;
        fs.renameSync(stateFile, backup);
      } catch (_) { /* 目录不可写时无法备份，仍避免启动崩溃。 */ }
    }
    state = empty();
  }

  function persist(next) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const temp = `${stateFile}.tmp-${process.pid}-${require("node:crypto").randomUUID()}`;
    fs.writeFileSync(temp, JSON.stringify(next));
    fs.renameSync(temp, stateFile);
    state = next;
  }

  function snapshot() {
    return {
      album: pack.album.map(({ id, file, desktopFile, zh, where, date, unlockAt, title }) => ({
        id, file, ...(desktopFile ? { desktopFile } : {}), zh, where, date, unlockAt, title, unlocked: currentAffection >= unlockAt,
      })),
      chapters: pack.chapters.map(({ id, title, unlockAt, reward }) => ({
        id, title, unlockAt, unlocked: currentAffection >= unlockAt,
        done: state.completed.includes(id), reward,
      })),
      progress: state.progress ? { ...state.progress } : null,
      awaitingChoice: Boolean(state.progress && !state.progress.done
        && pack.chapters.find((c) => c.id === state.progress.chapterId)?.flow[state.progress.index]?.branch
        && state.progress.branch === null),
    };
  }

  function chapterById(id) {
    if (typeof id !== "string" || !chapters.has(id)) throw new Error(`章节不存在：${String(id)}`);
    return chapters.get(id);
  }
  function photoById(id) {
    if (typeof id !== "string" || !albums.has(id)) throw new Error(`照片不存在：${String(id)}`);
    return albums.get(id);
  }
  function active() {
    if (!state.progress) throw new Error("请先开始章节。");
    if (state.progress.done) throw new Error("章节已经完成，请重看章节后再推进。");
    return chapters.get(state.progress.chapterId);
  }
  function clipResult(clipId) {
    const clip = clips.get(clipId);
    if (!clip) throw new Error(`剧情镜头不存在：${String(clipId)}`);
    return { ...snapshot(), clip: { ...clip } };
  }
  function savePhoto(id, variant = "mobile") {
    const photo = photoById(id);
    if (currentAffection < photo.unlockAt) throw new Error("这张照片尚未解锁。");
    if (variant !== "mobile" && variant !== "desktop") throw new Error("壁纸规格无效。");
    const file = variant === "desktop" ? photo.desktopFile : photo.file;
    if (typeof file !== "string" || !file || path.isAbsolute(file)) throw new Error("照片路径无效。");
    const source = path.resolve(packDir, file);
    const inside = (root, target) => {
      const relative = path.relative(root, target);
      return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    };
    if (!inside(packDir, source)) throw new Error("照片路径不能超出内容包目录。");
    let realSource;
    try { realSource = fs.realpathSync(source); }
    catch (_) { throw new Error("照片文件不存在或无法读取。"); }
    if (!inside(fs.realpathSync(packDir), realSource)) throw new Error("照片路径不能超出内容包目录。");
    if (!fs.statSync(source).isFile()) throw new Error("照片路径不是文件。");
    return { ok: true, source };
  }

  function command(p) {
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("相册操作无效。");
    switch (p.action) {
      case "save-photo": return savePhoto(p.id, p.variant);
      case "start-chapter": {
        const chapter = chapterById(p.id);
        if (currentAffection < chapter.unlockAt) throw new Error("章节尚未解锁。");
        if (!Array.isArray(chapter.flow) || !chapter.flow.length) throw new Error("章节没有可播放的剧情。");
        const progress = { chapterId: chapter.id, index: 0, branch: null, done: false, rewarded: state.rewarded.includes(chapter.id) };
        const first = chapter.flow[0];
        if (!first.clip) throw new Error("章节起点不是剧情镜头。");
        const result = clips.get(first.clip);
        if (!result) throw new Error("章节起点镜头不存在。");
        persist({ ...state, progress });
        return clipResult(first.clip);
      }
      case "reset-chapter": {
        const chapter = chapterById(p.id);
        if (currentAffection < chapter.unlockAt) throw new Error("章节尚未解锁。");
        if (!chapter.flow?.length || !clips.has(chapter.flow[0].clip)) throw new Error("章节没有可播放的剧情。");
        persist({ ...state, progress: { chapterId: chapter.id, index: 0, branch: null, done: false, rewarded: state.rewarded.includes(chapter.id) } });
        return snapshot();
      }
      case "advance": {
        const chapter = active();
        const p0 = state.progress;
        const step = chapter.flow[p0.index];
        if (step.branch && !p0.branch) throw new Error("请先选择剧情分支。");
        if (p0.index >= chapter.flow.length - 1) throw new Error("剧情已到末尾，请完成章节。");
        const nextIndex = p0.index + 1;
        const nextStep = chapter.flow[nextIndex];
        if (!nextStep || (!nextStep.branch && !clips.has(nextStep.clip))) throw new Error("下一段剧情镜头不存在。");
        persist({ ...state, progress: { ...p0, index: nextIndex, branch: null } });
        return nextStep.branch ? snapshot() : clipResult(nextStep.clip);
      }
      case "choose": {
        if (p.branch !== "A" && p.branch !== "B") throw new Error("分支只能选择 A 或 B。");
        const chapter = active();
        const step = chapter.flow[state.progress.index];
        if (!step.branch || state.progress.branch) throw new Error("当前没有等待选择的剧情分支。");
        const clipId = step.branch[p.branch];
        if (!clips.has(clipId)) throw new Error("剧情分支镜头不存在。");
        persist({ ...state, progress: { ...state.progress, branch: p.branch } });
        return clipResult(clipId);
      }
      case "finish": {
        const chapter = state.progress && chapters.get(state.progress.chapterId);
        if (!chapter) throw new Error("请先开始章节。");
        const p0 = state.progress;
        if (!p0.done && (p0.index !== chapter.flow.length - 1 || (chapter.flow[p0.index].branch && !p0.branch))) {
          throw new Error("剧情还未完成，请先推进并选择分支。");
        }
        const already = Boolean(state.receipts[chapter.id]);
        const reward = already ? 0 : chapter.reward;
        if (!p0.done) persist({
          ...state,
          completed: state.completed.includes(chapter.id) ? state.completed : [...state.completed, chapter.id],
          rewarded: state.rewarded.includes(chapter.id) ? state.rewarded : [...state.rewarded, chapter.id],
          // 先落 pending 收据再由调用方入账：崩溃后按收据补齐，恰好结算一次。
          receipts: already ? state.receipts
            : { ...state.receipts, [chapter.id]: { reward: chapter.reward, state: "pending" } },
          progress: { ...p0, done: true, rewarded: true },
        });
        return { ...snapshot(), reward, receiptId: reward > 0 ? chapter.id : null };
      }
      default: throw new Error(`不支持的相册操作：${String(p.action)}`);
    }
  }

  /** 待入账收据：重启/重试时由调用方补结算。 */
  function pendingReceipts() {
    return Object.keys(state.receipts)
      .filter((id) => state.receipts[id].state === "pending")
      .map((id) => ({ id, reward: state.receipts[id].reward }));
  }
  /** 收据入账确认；幂等，未知/已结算返回 false。 */
  function settle(id) {
    if (typeof id !== "string" || !state.receipts[id] || state.receipts[id].state !== "pending") return false;
    persist({ ...state, receipts: { ...state.receipts, [id]: { ...state.receipts[id], state: "granted" } } });
    return true;
  }

  setAffection(affection);
  return { snapshot, command, setAffection, pendingReceipts, settle };
}

module.exports = { createGallery };
