// 「这句话说完了吗」——只看转写文本的尾部，不调模型。
//
// 为什么需要它：端点是「450ms 没声音就收工」，这个判据对**想事情**的人是错的。
// 「我想想……然后那个」这种半句，用户只是停了一下，她会当成问完了立刻接话。
//
// 参考项目 AIri（ref/airi-v0.14.1）的做法是：静音 1.2s 时把当前转写丢给聊天模型
// 判 complete/incomplete，判没说完就继续等，最长兜底 4.2s
// （packages/agents/src/voice-end-judge/index.ts + core-agent/src/voice/policy/rules.ts）。
// 那套能成立的前提是**流式 ASR**：判定时文本已经在手，所以「多等」不额外花钱。
//
// 我们是整段转写（0.8s/次，服务端串行），照搬会变成「每句话多花一次模型往返」，
// 而且拿不到 partial 文本，模型无从判断。所以这里改成**不需要模型的替代**：
//   1) 转写回来后只看尾部：是不是停在连接词/介词/否定词上，或以逗号结尾；
//   2) 是的话，再开一次采集接着听（composer 负责，最多续一次）；
//   3) 不是就直接发。
// 单次最多多花「一次静音等待」，且只在真的没说完时才付。
//
// 刻意保守：误判成「没说完」的代价是白等 3 秒，误判成「说完了」的代价是打断用户。
// 所以宁可多判几个悬空词，也不为了准确率去猜语气。

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UtteranceTail = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 句末标点：出现就一定说完了。省略号除外——「我……」是话没说完，不是收尾。
  const SENTENCE_END = /[。！？!?~～]+["'”’」』）)]*$/;
  // 分句标点：逗号结尾几乎必然是「还要往下说」。
  const CLAUSE_END = /[，,、；;：:]+$/;

  // 这些词落在句尾，说明后面还有话。
  // 只收「单独出现也不成句」的词；「好的」「不要」「现在」这类会被误伤的单字（的/要/在）
  // 刻意排除在外 —— 它们当结尾比当连接词更常见。
  const DANGLING_WORDS = [
    // 连词/转折
    "因为", "所以", "然后", "但是", "可是", "不过", "而且", "并且", "还有", "于是",
    "或者", "反正", "如果", "虽然", "要是", "就是", "以及", "比如", "例如", "否则",
    // 指代/口头填充
    "那个", "这个", "那么", "这么", "什么", "怎么", "怎么样",
    // 动词后接宾语的位置
    "觉得", "知道", "认为", "打算", "想要", "准备", "看看", "说说", "想想",
    // 介词/结构助词
    "跟", "把", "被", "让", "给", "对", "从", "往", "向", "比", "像", "和",
    // 副词/否定
    "就", "也", "还", "又", "才", "都", "更", "最", "挺", "很", "不", "没",
    // 断在半句的谓词
    "说", "想", "是", "有", "而",
  ].sort((a, b) => b.length - a.length);

  function tidy(text) {
    return String(text == null ? "" : text).replace(/^[\s\p{P}]+/u, "").trim();
  }

  /**
   * 这句话看起来说完了吗？
   * @returns {boolean} true = 可能没说完，值得再听一段
   */
  function looksDangling(text) {
    const s = String(text == null ? "" : text).trim();
    if (!s) return false;                       // 空串不是「悬空」，是没听清
    if (SENTENCE_END.test(s)) return false;     // 有句号感叹号问号 → 说完
    if (CLAUSE_END.test(s)) return true;        // 停在逗号 → 还要说

    // 去掉句末的引号/括号再判断词尾：「他说“然后”」不该当成悬空
    const bare = s.replace(/["'”’」』）)]+$/g, "");
    for (const word of DANGLING_WORDS) {
      if (bare.endsWith(word)) {
        // 「就是」在「就是」两个字单独成句时也算悬空，这里不额外开洞
        return true;
      }
    }
    return false;
  }

  /**
   * 把续听到的第二段接回第一段。
   * 会去掉上一段结尾的分句标点，并消掉 ASR 常见的尾部重复
   * （上一段「我想去海边，」+ 下一段「海边看看」→「我想去海边看看」）。
   */
  function mergeTail(head, tail) {
    let a = String(head == null ? "" : head).trim();
    let b = String(tail == null ? "" : tail).trim();
    if (!a) return b;
    if (!b) return a;
    a = a.replace(/[，,、；;：:\s]+$/g, "");
    if (!a) return b;

    // 尾部重复：从长到短找重合，最长认 6 个字，最短 2 个
    const max = Math.min(6, a.length, b.length);
    for (let n = max; n >= 2; n--) {
      if (a.slice(-n) === b.slice(0, n)) { b = b.slice(n); break; }
    }
    if (!b) return a;

    const cjk = /[\u4e00-\u9fff]/;
    const needSpace = !cjk.test(a.slice(-1)) && !cjk.test(b[0]);
    return a + (needSpace ? " " : "") + b;
  }

  return { looksDangling, mergeTail, tidy, DANGLING_WORDS };
});
