// 唤醒词识别：从一句转写文本里判断「她是不是被叫到了」，并剥出真正的指令。
//
// 为什么不用编辑距离：中文编辑距离对「小艾同学」这种 4 字词几乎无意义 ——
// 改一个字就可能是另一个意思（「小爱豆」「小同学」）。这里用的是**同音字组 +
// 定向容错**：只允许唤醒词里每个字命中它自己音组内的字，且最多漏一个字。
// 好处是误触发的来源是枚举得出的、可解释的，而不是「距离算出来刚好 2」。
//
// 为什么不在渲染进程里调模型判唤醒：唤醒是常驻链路上最高频的一步，
// 每说一句话就跑一次模型，等于把闲聊天变成计费对话。本地 whisper 已经给出
// 文本了，正则级判断是零成本。
//
// 双端可用（UMD）：渲染进程 <script> 拿到 window.WakeWord，Node 里 require 进单测。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WakeWord = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 音组。只收唤醒词里出现的字，别做成通用拼音表 —— 覆盖面越大，
  // 误触发就越多，而唤醒词只有这么几个字，没必要。
  const HOMOPHONE_GROUPS = [
    ["小", "晓", "筱", "肖"],
    ["艾", "爱", "哎", "唉", "矮"],
    ["同", "桐", "童", "铜", "彤", "佟", "瞳"],
    ["学", "雪", "穴", "薛", "血"],
    ["深", "申", "身", "神", "沈"],
    ["蓝", "兰", "篮", "澜", "拦"],
  ];

  const groupOf = new Map();
  for (const group of HOMOPHONE_GROUPS) {
    for (const ch of group) {
      if (!groupOf.has(ch)) groupOf.set(ch, new Set(group));
    }
  }

  const DEFAULTS = {
    // 「小艾同学」是用户习惯的叫法；「深蓝」是她自己的名字。
    // 短的放后面：同一起点要优先匹配更长的词，否则「小艾同学」会被拆成「小艾」+「同学」。
    words: ["小艾同学", "深蓝", "小艾"],
    maxMissing: 1,      // 最多漏说一个字（「艾同学」）
    minLenForMissing: 3,// 两个字的词不许漏，否则「深蓝」会退化成只认一个字
    // 唤醒后如果紧跟着说了内容（「小艾同学，今天吃什么」），这段内容就是第一句。
    maxRestChars: 120,
  };

  const PUNCT = /[\s，。！？、；：,.!?;:"""''（）()《》【】\[\]—…~～·]/g;

  // 繁体 → 简体。
  //
  // 这不是「顺手做国际化」，是被实测逼出来的：whisper 的多语言模型对中文经常
  // 直接输出繁体（「小愛同學」「深藍」「幫我」），而唤醒词是按简体写的。
  // 不转这一步，实测 7 句正例里有 2 句完全唤不醒 —— 而且失败是随机的，
  // 用户会觉得「时好时坏」，比一直失败更难排查。
  //
  // 只收口语高频字，不做完整繁简库：换算只影响唤醒判定和交给模型的那句话，
  // 缺字最多退回原文，不会出错。
  const T2S = (() => {
    const pairs = (
      "愛爱 幫帮 這这 樣样 說说 別别 結结 學学 藍蓝 蘭兰 個个 麼么 們们 來来 時时 間间 會会 " +
      "對对 過过 還还 開开 關关 現现 從从 經经 無无 聲声 聽听 見见 週周 電电 腦脑 記记 帶带 " +
      "覺觉 點点 給给 變变 讓让 發发 號号 東东 裡里 邊边 後后 長长 難难 壞坏 錯错 話话 問问 " +
      "題题 願愿 該该 應应 寫写 讀读 書书 買买 賣卖 錢钱 車车 門门 報报 導导 連连 續续 檔档 " +
      "視视 頻频 軟软 體体 網网 線线 燈灯 陽阳 陰阴 準准 備备 計计 劃划 畫画 圖图 實实 際际 " +
      "簡简 單单 複复 雜杂 價价 費费 誤误 總总 夠够 興兴 謝谢 氣气 擔担 係系 為为 熱热 溫温 " +
      "濕湿 寶宝 貝贝 頁页 風风 雲云 貓猫 雞鸡 魚鱼 鳥鸟 馬马 龍龙 訊讯 幾几 嗎吗 園园 圓圆 " +
      "遠远 選选 適适 讚赞 賞赏 資资 質质 額额 顏颜 類类 顧顾 驚惊 驗验 齊齐 著着 樣样 開开 " +
      // 真机前补的一批：都是日常口语高频，但上一版漏了。
      // 「沒關係」「請你」「認識」「幾歲」「師父」「記憶」「態度」「幹嘛」「誰」「調小一點」——
      // 漏了不会唤不醒（名字那几个字在表里），但气泡和喂给模型的话会半简半繁。
      "沒没 調调 誰谁 請请 認认 識识 鐘钟 歲岁 師师 憶忆 態态 幹干"
    ).split(" ");
    const map = new Map();
    for (const pair of pairs) if (pair.length === 2 && pair[0] !== pair[1]) map.set(pair[0], pair[1]);
    return map;
  })();

  // 只做繁体→简体，保留标点空白。给用户的文字和给模型的文字都用这个版本：
  // 转写本身是繁体，但界面和人格都是简体，混着出现会显得「不是她说的」。
  function toSimplified(text) {
    const s = String(text == null ? "" : text);
    if (!T2S.size) return s;
    let out = "";
    for (const ch of s) out += (T2S.get(ch) || ch);
    return out;
  }

  // 归一化：去标点与空白，全角字母数字转半角，繁体转简体，英文小写。
  // 注意不能去掉汉字以外的全部内容 —— 「小艾同学 3 点叫我」里的 3 要留着。
  function normalize(text) {
    let s = String(text == null ? "" : text);
    s = s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    s = s.replace(/\u3000/g, " ");
    s = s.replace(PUNCT, "").toLowerCase();
    return toSimplified(s);
  }

  function sameChar(a, b) {
    if (a === b) return true;
    const ga = groupOf.get(a);
    return !!(ga && ga.has(b));
  }

  /**
   * 在 text 的 i 位置尝试对齐 word，允许漏掉 word 的**首字或尾字**。
   * 返回 { consumed, skipped } 或 null。
   *
   * 为什么只允许首尾，不允许中间：
   * 「小艾同学」漏掉中间的「艾」会变成「小同学」—— 这个词在日常中文里是真实存在的另一句话。
   * 一旦允许跳中间字，教室里随便一句「小同学」都会把她叫起来。
   * 首尾则安全得多：「艾同学」「小艾同」不是正常词，出现就说明是转写吞字。
   *
   * 不跳过 text 里的字：文本是连续的，中间插进来的字属于另一句话，不该算命中。
   */
  function alignAt(text, i, word, maxMissing) {
    const m = word.length;
    const limit = Math.min(maxMissing, Math.max(0, m - 1));
    const tries = [[]];
    if (limit >= 1 && m >= 2) {
      tries.push([0]);
      tries.push([m - 1]);
    }
    let best = null;
    for (const skip of tries) {
      const rest = [];
      for (let k = 0; k < m; k++) if (skip.indexOf(k) < 0) rest.push(word[k]);
      if (!rest.length) continue;
      if (i + rest.length > text.length) continue;
      let ok = true;
      for (let k = 0; k < rest.length; k++) {
        if (!sameChar(text[i + k], rest[k])) { ok = false; break; }
      }
      if (!ok) continue;
      // 跳得越少越好：优先「全部字都在」的对齐，避免把完整词切掉一段。
      if (!best || skip.length < best.skipped) best = { consumed: rest.length, skipped: skip.length };
    }
    return best;
  }

  function createWakeWordMatcher(options = {}) {
    const cfg = { ...DEFAULTS, ...options };
    const words = (cfg.words || []).map((w) => normalize(w)).filter(Boolean);
    // 长的优先，同一起点时先命中长词。
    const ordered = [...words].sort((a, b) => b.length - a.length);

    /**
     * @returns {{hit:boolean, word:string, index:number, end:number, rest:string}}
     * rest 是唤醒词之后跟着说的内容（已去前导标点）；只喊了名字时为空串。
     */
    function match(text) {
      const s = normalize(text);
      if (!s) return { hit: false, word: "", index: -1, end: -1, rest: "" };
      for (let i = 0; i < s.length; i++) {
        for (const word of ordered) {
          const allow = word.length >= cfg.minLenForMissing ? cfg.maxMissing : 0;
          const hit = alignAt(s, i, word, allow);
          if (!hit) continue;
          const end = i + hit.consumed;
          // 短词后面只跟一个字就结束 —— 更可能是别的词的后半截，不是有人在叫名字。
          // 「小爱豆」「小爱情」都长这样；正常叫名字只会是「小艾」或「小艾，帮我关灯」。
          // 这条规则只对 ≤3 字的词生效，长词不受影响（「小艾同学你说」很正常）。
          if (word.length <= 3 && s.length - end === 1) continue;
          let rest = s.slice(end);
          if (rest.length > cfg.maxRestChars) rest = rest.slice(0, cfg.maxRestChars);
          return { hit: true, word, index: i, end, rest };
        }
      }
      return { hit: false, word: "", index: -1, end: -1, rest: "" };
    }

    /**
     * 连续喊两遍（「小艾同学，小艾同学」）或者唤醒词后面还跟着唤醒词时，
     * 把开头的唤醒词全剥掉，剩下的才是真指令。
     */
    function strip(text) {
      let rest = String(text == null ? "" : text).trim();
      const first = match(rest);
      if (!first.hit) return { hit: false, text: rest };
      // 用原始文本切，不要用 normalized 切：否则空格标点全没了，交给模型的话会挤成一坨。
      rest = cutAfterFirstCall(rest, first);
      for (let guard = 0; guard < 2; guard++) {
        const again = match(rest);
        if (!again.hit || again.index !== 0) break;
        rest = cutAfterFirstCall(rest, again);
      }
      return { hit: true, text: rest, word: first.word };
    }

    // 在原文里数够 normalized 的 index+consumed 个有效字符，从那里切开。
    function cutAfterFirstCall(raw, hit) {
      let seen = -1;
      let i = 0;
      for (; i < raw.length; i++) {
        const piece = normalize(raw[i]);
        if (!piece) continue; // 标点空白不计入
        seen += piece.length;
        if (seen >= hit.end - 1) { i += 1; break; }
      }
      return toSimplified(raw.slice(i).replace(/^[\s，。！？、；：,.!?;:…~～·—]+/, "").trim());
    }

    /** 对话态里的「我不想说了」——命中就退回待机，省得她一直监听。 */
    function matchExit(text) {
      const s = normalize(text);
      for (const w of EXIT_WORDS) if (s.indexOf(w) >= 0) return w;
      return "";
    }

    return { match, strip, matchExit, words: [...words] };
  }

  // 只认短而明确的收尾语。刻意不收「没事」「算了」—— 这两句在聊天里
  // 更常是「回答」而不是「结束」，误判会让她突然不理人。
  const EXIT_WORDS = ["先这样", "不聊了", "别说了", "退下", "结束了", "拜拜"];

  return { createWakeWordMatcher, normalize, toSimplified, sameChar, DEFAULTS, EXIT_WORDS, HOMOPHONE_GROUPS };
});
