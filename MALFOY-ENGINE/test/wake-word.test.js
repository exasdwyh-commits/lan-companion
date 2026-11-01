"use strict";
// 唤醒词的判据。这里的每个用例都对着一个真实会踩的点：
// 转写吞字、同音字、以及「小同学」这种把误唤醒变成日常噪音的坑。
const test = require("node:test");
const assert = require("node:assert");

const { createWakeWordMatcher, normalize, toSimplified } = require("../lib/wake-word");

const m = createWakeWordMatcher();

test("一字不差地喊名字", () => {
  for (const s of ["小艾同学", "小艾同学。", "小艾同学！", "  小艾同学  "]) {
    const r = m.match(s);
    assert.equal(r.hit, true, s);
    assert.equal(r.word, "小艾同学", s);
    assert.equal(r.rest, "", s);
  }
});

test("同音字也算叫到了", () => {
  // whisper 对「艾」和「爱」几乎总会混，不认同音就等于每两次唤醒失败一次。
  for (const s of ["小爱同学", "晓艾同学", "筱爱同学", "小艾桐学", "小艾同雪"]) {
    assert.equal(m.match(s).hit, true, s);
  }
});

test("口误漏首字或尾字还能认出来", () => {
  assert.equal(m.match("艾同学").hit, true, "漏首字");
  assert.equal(m.match("小艾同").hit, true, "漏尾字");
});

test("漏中间一个字不算 —— 否则「小同学」会把每间教室都叫醒", () => {
  assert.equal(m.match("小同学").hit, false);
  assert.equal(m.match("小同学们好").hit, false);
});

test("近音但不对的词不能命中", () => {
  for (const s of ["小爱豆", "小爱情", "同学们", "蓝色", "小巷同学", "小学同学"]) {
    assert.equal(m.match(s).hit, false, s);
  }
});

test("名字后面直接接字也认，剩下的字当内容", () => {
  // 「深蓝色」= 叫了深蓝 + 说了个「色」。这种口语很常见，别把它判成没叫到。
  const r = m.strip("深蓝色好看吗");
  assert.equal(r.hit, true);
  assert.equal(r.text, "色好看吗");
});

test("两字的名字不做容错：只认全中", () => {
  assert.equal(m.match("深蓝").hit, true);
  assert.equal(m.match("申蓝").hit, true); // 同音可以
  assert.equal(m.match("深").hit, false);  // 少一个字不行，太容易误触发
});

test("唤醒词后面的内容要被切出来当第一句", () => {
  const r = m.strip("小艾同学，今天中午吃什么");
  assert.equal(r.hit, true);
  assert.equal(r.text, "今天中午吃什么");

  const r2 = m.strip("小艾同学帮我把音量调小一点");
  assert.equal(r2.text, "帮我把音量调小一点");

  // 中间插一个语气词也不影响后面的内容
  const r3 = m.strip("小艾同学，那个，你把灯关一下");
  assert.equal(r3.text, "那个，你把灯关一下");
});

test("只喊名字时留下空串，不要凭空造一句话", () => {
  assert.equal(m.strip("小艾同学").text, "");
  assert.equal(m.strip("小艾同学，").text, "");
  assert.equal(m.strip("小艾同学……").text, "");
});

test("长词优先：不要把小艾同学拆成小艾 + 同学", () => {
  const r = m.match("小艾同学");
  assert.equal(r.word, "小艾同学");
  // 只有「小艾」时也该命中（用户可能就这么叫）
  assert.equal(m.match("小艾").word, "小艾");
});

test("名字出现在句子中间也算被叫到", () => {
  const r = m.strip("我说小艾同学你能不能听见");
  assert.equal(r.hit, true);
  // 名字前面那句是用户在自言自语，剥掉之后应该只留名字后面的内容
  assert.equal(r.text, "你能不能听见");
});

test("连喊两遍不会把第二遍当成内容", () => {
  const r = m.strip("小艾同学，小艾同学，你在吗");
  assert.equal(r.hit, true);
  assert.equal(r.text, "你在吗");
});

test("收尾语能识别出来", () => {
  assert.equal(m.matchExit("好，先这样吧"), "先这样");
  assert.equal(m.matchExit("不聊了，我去吃饭"), "不聊了");
  // 「算了」「没事」在聊天里更常是回答，不能当成结束
  assert.equal(m.matchExit("算了"), "");
  assert.equal(m.matchExit("没事的"), "");
});

test("归一化去掉标点但保留数字", () => {
  assert.equal(normalize("小艾同学，３点叫我！"), "小艾同学3点叫我");
  assert.equal(normalize("ＡＢＣ 小艾"), "abc小艾");
});

test("whisper 输出繁体时也要能唤醒", () => {
  // 实测：7 句合成音里有 3 句被转成繁体（小愛/深藍/幫我）。不转简体会随机唤不醒，
  // 那种「时好时坏」比一直坏更难排查。
  const cases = ["小愛同學", "深藍，你在嗎", "小愛，幫我把音量調小一點"];
  for (const s of cases) assert.equal(m.match(s).hit, true, s);

  const r = m.strip("小愛同學，幫我看看這個報錯");
  assert.equal(r.hit, true);
  assert.equal(r.text, "帮我看看这个报错", "切出来的内容也要转成简体");
});

test("繁体收尾语也能结束对话", () => {
  assert.equal(m.matchExit("好，先這樣吧"), "先这样");
  assert.equal(m.matchExit("不聊了"), "不聊了");
});

test("toSimplified 保留标点与空白，只换字", () => {
  assert.equal(toSimplified("小愛，幫我看看。"), "小爱，帮我看看。");
});

test("高频繁体口语字要转干净（气泡和喂模型的话不能半简半繁）", () => {
  // 真机前实测漏的 12 个：「小愛,幫我把音量調小一點」切出来是「帮我把音量調小一点」——
  // 幫/點都转了，唯独「調」漏在表外。漏字不会唤不醒（名字那几个字一直在表里），
  // 但气泡和交给模型的文本会半简半繁，看起来不像她说的。
  const pairs = "沒没 調调 誰谁 請请 認认 識识 鐘钟 歲岁 師师 憶忆 態态 幹干".split(" ");
  for (const p of pairs) {
    const [t, s] = [...p];
    assert.equal(toSimplified(t), s, `缺 ${t}→${s}`);
  }
  assert.equal(toSimplified("沒關係，請你小聲點，我認識這裡"), "没关系，请你小声点，我认识这里");
  assert.equal(toSimplified("幾歲了，別調那麼大聲"), "几岁了，别调那么大声");
});
