'use strict';
/**
 * 音色档案：决定「谁在唱」和「她能唱多高多低」。
 *
 * 这两件事必须分开，否则永远调不好：
 *   音色 = ref 参考音频 → 决定年龄感、明亮度、气息。换参考才变。
 *   音域 = range.lo / hi → 决定整首要升几个半音。换参考不会变。
 *
 * 实测依据：ref-magnetic 的 p50 只有 163Hz，比不少男歌手还低。用它去唱
 * 115Hz 的男声原曲，就算升了 6 个半音把音高搬对了，音色本身偏暗偏沙，
 * 听感依然是「老太太」。那不是音域问题，是参考选错了 —— 升 K 只能改音高，
 * 改不了一个声音的年龄。
 *
 * 所以音域分析和音色合成是解耦的：只要标好了 range，就算还没有参考音频
 * （比如孙燕姿），也能先算出「这首歌换她唱该升几个半音」。
 */

const fs = require('fs');
const path = require('path');

/** 低于这个字节数的参考合成不出稳定音色，等同没有。 */
const MIN_REF_BYTES = 20000;
const STATE_FILE = 'voice.json';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function usableRef(file) {
  if (!file) return false;
  try {
    return fs.statSync(file).size > MIN_REF_BYTES;
  } catch (_) {
    return false;
  }
}

function createVoiceProfiles(options = {}) {
  const dir = options.dir;
  if (!dir) throw new Error('voice-profiles 需要数据目录');

  // 三处定义源，优先级从高到低：用户自建 > 打包产物 > 源码仓库。
  // 每档记住自己的 audioRoot —— ref 是相对该目录的文件名。
  const sources = [
    { file: path.join(dir, 'voices', 'voices.json'), root: path.join(dir, 'voices'), origin: 'user' },
    {
      file: options.contentDir ? path.join(options.contentDir, 'voices.json') : null,
      root: options.contentDir ? path.join(options.contentDir, 'voices') : null,
      origin: 'pack',
    },
    {
      file: options.workspace ? path.join(options.workspace, 'assets', 'voices', 'voices.json') : null,
      root: options.workspace ? path.join(options.workspace, 'assets', 'voices') : null,
      origin: 'workspace',
    },
  ].filter((s) => s.file);

  function stateFile() {
    return path.join(dir, STATE_FILE);
  }

  function currentId() {
    const saved = readJson(stateFile());
    const wanted = saved && typeof saved.current === 'string' ? saved.current : null;
    if (wanted && find(wanted)) return wanted;
    return null;
  }

  /**
   * 找参考音频的真实路径。先看定义自带的目录，再扫所有已知目录 ——
   * 这样用户把 sunyanzi.wav 丢进 ~/.smartcompanion/voices/ 之后，
   * 即使定义来自仓库也不用改任何配置。
   */
  function refPath(name, ownRoot) {
    if (!name) return null;
    const candidates = [ownRoot, ...sources.map((s) => s.root)].filter(Boolean);
    for (const root of candidates) {
      const file = path.join(root, name);
      if (usableRef(file)) return file;
    }
    return null;
  }

  /** 扁平化所有定义，同 id 时排在前面的赢（用户覆盖内置）。 */
  function all() {
    const seen = new Map();
    for (const source of sources) {
      const data = readJson(source.file);
      if (!data || !Array.isArray(data.voices)) continue;
      for (const raw of data.voices) {
        if (!raw || typeof raw.id !== 'string' || seen.has(raw.id)) continue;
        seen.set(raw.id, { raw, origin: source.origin, root: source.root });
      }
    }
    return [...seen.values()];
  }

  /** 把定义规整成对调用方友好的形状。 */
  function shape(entry) {
    const { raw, origin, root } = entry;
    const lo = Number(raw.range && raw.range.lo) || 0;
    const hi = Number(raw.range && raw.range.hi) || null;
    const ref = refPath(raw.ref, root);
    return {
      id: raw.id,
      name: raw.name || raw.id,
      tone: raw.tone || '',
      lowNote: raw.lowNote || '',
      highNote: raw.highNote || '',
      provenance: raw.provenance || '',
      range: { lo: lo || null, hi: hi && hi > lo ? hi : null },
      ref: raw.ref || null,
      refPath: ref,
      // 没有参考音频就合成不了，但音域照样能参与分析
      usable: Boolean(ref),
      default: raw.default === true,
      origin,
    };
  }

  function find(id) {
    const entry = all().find((e) => e.raw.id === id);
    return entry ? shape(entry) : null;
  }

  function list() {
    return all().map(shape);
  }

  function current() {
    const id = currentId();
    if (id) return find(id);
    // 没有存过就用标了 default 的那档；都没有就用第一档能合成出声的
    const entries = list();
    return entries.find((v) => v.default) || entries.find((v) => v.usable) || entries[0] || null;
  }

  function set(id) {
    const profile = find(id);
    if (!profile) throw new Error('没有这个音色');
    if (!profile.usable) {
      throw new Error(`「${profile.name}」还缺参考音频，先把一段干净人声放进 ${path.join(dir, 'voices', profile.ref || `${id}.wav`)}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    const file = stateFile();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ current: id }, null, 2));
    fs.renameSync(tmp, file);
    return profile;
  }

  return { list, current, set, find, currentId, dirs: sources.map((s) => s.root).filter(Boolean) };
}

module.exports = { createVoiceProfiles, MIN_REF_BYTES };
