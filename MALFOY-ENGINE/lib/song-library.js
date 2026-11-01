"use strict";
/**
 * 统一的曲库：随包发布的原曲 + 用户自己做出来的翻唱。
 *
 * 之前这是两个数据源（companion-content/songs.json 与 <data>/covers/library.json）、
 * 两条播放路径（playSong 与 cover({action:'play'})），UI 要渲染两个列表。
 * 用户眼里「歌」就是一个东西，所以在这里合成一个。
 *
 * 只做「有什么歌、怎么找到它」，不管播放 —— 播放仲裁归 media-session。
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const CACHE_TTL_MS = 1000;

function createSongLibrary({ dir, contentDir }) {
  const packFile = path.join(contentDir, "songs.json");
  const coverRoot = path.join(dir, "covers");
  const coverIndex = path.join(coverRoot, "library.json");
  // 原创歌（歌姬模式生成）单独一个索引与目录：covers 认 cover.m4a，
  // 原创歌叫 song.m4a，混在一起会让「翻唱」分组里冒出不是翻唱的东西。
  const originalRoot = path.join(dir, "originals");
  const originalIndex = path.join(originalRoot, "index.json");

  let cache = null, cachedAt = 0;

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; }
  };

  /** 随包原曲。文件缺失的条目直接跳过，不让它变成一个点了没反应的按钮。 */
  function packSongs() {
    const pack = readJson(packFile, { songs: [] });
    const list = Array.isArray(pack.songs) ? pack.songs : [];
    return list
      .filter((s) => s && s.id && s.title)
      .filter((s) => { try { return fs.statSync(path.join(contentDir, s.file)).size > 1000; } catch (_) { return false; } })
      .map((s) => ({
        id: s.id,
        title: String(s.title),
        source: "pack",
        url: pathToFileURL(path.join(contentDir, s.file)).href,
        lyrics: Array.isArray(s.lyrics) ? s.lyrics : [],
        unlockAt: s.unlockAt || 0,
        gain: s.gain ?? 1,
        credit: s.credit || "",
        createdAt: null,
        engine: null,
        // 时长在 songs.json 里手写（随包歌曲不会变）。
        // 不在这里跑 ffprobe：曲库每次面板刷新都要读，探测音频头是几百毫秒级的开销。
        duration: Number.isFinite(s.duration) ? s.duration : null,
        // 旧念词实验：面板里折在「历史实验样例」里，不混进正常曲库
        experimental: Boolean(s.experimental),
      }));
  }

  /** 用户做出来的翻唱。索引里有但文件已删的不算。 */
  function coverSongs() {
    const rows = readJson(coverIndex, []);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r && typeof r.id === "string" && /^[a-f0-9-]{36}$/.test(r.id))
      .filter((r) => {
        try { return fs.statSync(path.join(coverRoot, r.id, "cover.m4a")).size > 1000; } catch (_) { return false; }
      })
      .map((r) => ({
        id: r.id,
        title: String(r.title || "未命名翻唱"),
        source: "cover",
        url: pathToFileURL(path.join(coverRoot, r.id, "cover.m4a")).href,
        lyrics: [],
        unlockAt: 0,
        gain: 1,
        credit: "",
        createdAt: r.createdAt || null,
        engine: r.engine || null,
        // 时长由制作完成时（或命令行导入时）测好存进索引，
        // 读取时不再跑 ffmpeg —— 曲库每次面板刷新都会走这里。
        duration: Number.isFinite(r.duration) ? r.duration : null,
        imported: Boolean(r.imported),
        experimental: false,
      }));
  }

  /**
   * 她自己创作的歌（歌姬模式）。
   * 一首歌可能有两个版本：MiniMax 生成的成品，和「换成她的声音」的她唱版。
   * 曲库里只算一首 —— 用户眼里这是同一首歌的两个唱法，不是两首歌。
   * 默认播她唱版（那才是「她」），原版留在 altUrl 里给面板做对照。
   */
  function originalSongs() {
    const rows = readJson(originalIndex, []);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r && typeof r.id === "string" && /^[a-f0-9-]{36}$/.test(r.id))
      .map((r) => {
        const folder = path.join(originalRoot, r.id);
        const main = path.join(folder, "song.m4a");
        const her = path.join(folder, "her.m4a");
        const ok = (f) => { try { return fs.statSync(f).size > 1000; } catch (_) { return false; } };
        const hasHer = ok(her);
        if (!ok(main) && !hasHer) return null;
        return {
          id: r.id,
          title: String(r.title || "无题"),
          source: "original",
          url: pathToFileURL(hasHer ? her : main).href,
          altUrl: hasHer && ok(main) ? pathToFileURL(main).href : null,
          her: hasHer,
          lyrics: typeof r.lyrics === "string" ? r.lyrics : "",
          style: r.style || "",
          unlockAt: 0,
          gain: 1,
          credit: "她写的",
          createdAt: r.createdAt || null,
          engine: r.model ? `minimax-${r.model}` : null,
          duration: Number.isFinite(r.duration) ? r.duration : null,
          experimental: false,
        };
      })
      .filter(Boolean);
  }

  /** 自己的翻唱排在原曲前面 —— 那才是用户自己攒下的东西。 */
  function all() {
    const now = Date.now();
    if (cache && now - cachedAt < CACHE_TTL_MS) return cache;
    // 原创排最前：那是完全属于她的东西，比翻唱更「她的」。
    cache = [...originalSongs(), ...coverSongs(), ...packSongs()];
    cachedAt = now;
    return cache;
  }

  /**
   * 搜索：标题子串匹配，忽略大小写和首尾空白。
   * 空查询返回全部（UI 直接展示整个曲库）。
   */
  function search(query) {
    const q = String(query || "").trim().toLowerCase();
    const list = all();
    if (!q) return list;
    return list.filter((song) => String(song.title).toLowerCase().includes(q));
  }

  function find(id) {
    return all().find((song) => song.id === id) || null;
  }

  /** 曲库变了（做完一首翻唱）时调用，让下一次读取重新扫盘。 */
  function invalidate() { cache = null; cachedAt = 0; }

  return { all, search, find, invalidate, packSongs, coverSongs, originalSongs };
}

module.exports = { createSongLibrary };
