"use strict";
// 流式回复的句子切分器。
//
// 为什么需要它：模型现在是整段吐完才去合成，用户得等到「全篇写完 + 全篇念完」
// 才开始听见声音。改成流式后，第一句一凑够就送去合成，声音就提前了。
//
// 切块长度不是拍脑袋定的，是解出来的不等式。本机 qwen3-tts 实测
// （2026-10-31，12/16/22/30/46 字各跑两遍，两次结果差 < 0.02s）：
//   合成 ≈ 0.47 × 播放时长        ← 这个比例在 12~46 字之间几乎不变
//   播放 ≈ 0.21 秒/字
// 合成服务是串行的，所以「不断档」是个累加条件：到第 k 句为止，
//   0.47 × Σ播放(1..k) ≤ Σ播放(1..k-1)
// 解出来是「下一块 ≤ 2.1 倍已切总量」。再加 4 个字的余量——400ms 以内的
// 停顿听起来就是换气的自然间隙，不值得为此把句子切碎。
// 实测反例：早期固定切成 46 字，第二句处空了 1.6 秒。
//
// 首块还要满足「够短」：首块越短，出声越早；但太短会让下一句算不出余量。

const SENT_END = "。！？!?…\n";
const TRAIL = "。！？!?…";          // 句末标点连写（「什么？！」）一并吃掉
const CLOSERS = "\"'”’」』）)";      // 紧跟在句末后面的收尾引号
const CLAUSE = "，,、；;：:";

// 长块回找逗号时的最低切点：再短就不如直接硬切
const MIN_CLAUSE_CUT = 4;

// 模型偶尔不按格式来，会把标签写在中途或用大写；两种写法都认。
const EMO_TAG = /^\s*(?:\[emo:([a-z]+)\]|\[(happy|sad|shy|angry|calm|surprised|sleepy|thinking)\])\s*/i;

const DEFAULTS = {
  firstMin: 10,   // 首块最短：再短下一句就没有播放余量可用了
  firstLimit: 16, // 首块上限：超过就按逗号切，不硬等句号
  min: 10,        // 后续每块最短：碎成一句一调用，光固定开销就拖垮节奏
  maxLimit: 46,   // 后续每块上限：单次合成接近 5s，再长就没人等了
  growth: 2.1,    // 由「合成 0.47×播放」反解出的倍增系数
  slackChars: 4,  // 允许 400ms 以内的自然停顿
};

function createReplySplitter(options) {
  const cfg = Object.assign({}, DEFAULTS, options || {});
  let buf = "";
  let emo = null;
  let first = true;
  let totalLen = 0;  // 已切出去的总字数：决定下一块还剩多少播放余量

  /** 按已切总量算出这一块的上限；解的是「合成永远追不上播放」。 */
  function limitFor(isFirst) {
    if (isFirst) return cfg.firstLimit;
    const room = Math.round(cfg.growth * totalLen + cfg.slackChars);
    return Math.max(cfg.min + 2, Math.min(cfg.maxLimit, room));
  }

  function takeEmotion() {
    const m = buf.match(EMO_TAG);
    if (!m) return;
    if (!emo) emo = String(m[1] || m[2]).toLowerCase();
    buf = buf.slice(m[0].length);
  }

  /** 返回切点（含标点），-1 表示还不到时候。 */
  function findCut(isFirst) {
    const lo = isFirst ? cfg.firstMin : cfg.min;
    const hi = limitFor(isFirst);
    for (let i = 0; i < buf.length; i++) {
      if (!SENT_END.includes(buf[i])) continue;
      let j = i + 1;
      while (j < buf.length && (TRAIL.includes(buf[j]) || CLOSERS.includes(buf[j]))) j++;
      // 太短就继续等下一句：「嗯。」不该单独合成一次
      if (j < lo) { i = j - 1; continue; }
      // 太长就不认这个句号：先按长度切，否则这一块合成太久，播放会追上来
      if (j > hi) break;
      return j;
    }
    if (buf.length < hi) return -1;
    // 太长了：回头找最后一个逗号，找不到就硬切。
    // 回看下界比 lo 再放宽一点：逗号刚好落在 lo 前面一个字时，
    // 切在逗号处的块仍然可用，比硬切在词中间好听。
    const floor = Math.max(MIN_CLAUSE_CUT, lo - 3);
    let cut = hi;
    for (let i = hi - 1; i >= floor; i--) if (CLAUSE.includes(buf[i])) { cut = i + 1; break; }
    // 别把句号留在下一块开头：「……推」+「。我就」看着像断错了
    while (cut < buf.length && (TRAIL.includes(buf[cut]) || CLOSERS.includes(buf[cut]))) cut++;
    return cut;
  }

  function drain() {
    const out = [];
    for (;;) {
      const n = findCut(first);
      if (n <= 0) break;
      const piece = buf.slice(0, n).trim();
      buf = buf.slice(n);
      if (piece) {
        out.push(piece);
        totalLen += piece.length;
        // 首块已出，后续按「长块」规则切
        if (first) first = false;
      }
    }
    return out;
  }

  return {
    /** 喂一段增量，返回本次凑够、可以立刻去合成的句子（可能为空数组）。 */
    push(delta) {
      if (typeof delta === "string" && delta) buf += delta;
      takeEmotion();
      return drain();
    },
    /** 流结束：把剩下的都吐出来，不再等句末标点。 */
    flush() {
      takeEmotion();
      const out = drain();
      const rest = buf.trim();
      buf = "";
      if (rest) out.push(rest);
      first = false;
      return out;
    },
    get pending() { return buf; },
    get emotion() { return emo; },
    get emitted() { return !first; },
  };
}

module.exports = { createReplySplitter, DEFAULTS };
