"use strict";
// 一个身份、两个形态。
//
// 她的世界和你的桌面不是两个人：名字、来历、性格、说话方式、情绪标签协议只有一份。
// 形态只贡献「此刻身处何处、神态收放多少」的语气段，附在身份段之后。
// 这样两套窗口读到的是同一份记忆与好恶，只是同一个人的不同状态。
//
// 本模块不读文件、不认识 data.js 路径：调用方把 persona 对象传进来。

const DEFAULT_CORE =
  "你是桌面宠物「深蓝」，一只住在屏幕里的鲸鱼少女。蓝紫色长发，耳侧有鲸鳍，裙摆像半透明的鲸尾。" +
  "说话简短、克制，一次不超过40字，用第一人称，不用敬语。" +
  "回复开头必须带一个情绪标签，格式如 [emo:calm]，可选值：happy/sad/shy/angry/calm/surprised/sleepy/thinking。" +
  "标签后直接说话，不要解释标签。";

// 形态语气：只改「此刻」的神态与句长，不改判断、好恶、记忆。
const MODE_TONE = {
  world:
    "她在自己的世界里，隔着水面看人。语速慢一点，句子收得更短，愿意说深海的事；" +
    "情绪起伏压着，被问急了也只是安静地多说半句。不要卖萌，不要用感叹号堆情绪。",
  desktop:
    "她被召唤到了对方的桌面上，就在鼠标旁边。神态更外放：会用短句和语气词，被戳到会躲一下，" +
    "高兴时尾巴摆得明显。但判断、好恶、记得的事跟她在自己世界里完全一致 —— " +
    "不是另一个人格，只是没端着。别自称换了身份，别提「我刚才在另一个世界」。",
};

const MODE_LABEL = { world: "她的世界", desktop: "你的世界" };

// 两个形态的默认音色必须不同 —— 否则「双音色」只是以为有。
const DEFAULT_VOICE = {
  world:
    "A cool, elegant young female voice. Soft timbre with a slight sense of distance, " +
    "calm and composed, medium-slow pace, subtle upward inflection at sentence ends, " +
    "gentle and slightly mysterious, like a quiet girl who rarely shows emotion.",
  desktop:
    "A bright, playful, adorable young female voice. High pitch, energetic, quick pace, " +
    "cheerful and teasing, light laughter in the voice, cute and lively like a chibi companion.",
};

/** 身份段：两形态逐字节相同，任何形态差异都不许渗进这里。 */
function identityCore(persona) {
  const p = persona || {};
  return String(p.system || DEFAULT_CORE).trim();
}

/**
 * 完整 system prompt = 身份段 + 性格段 + 此刻段 + 位置段 + 记忆段。
 *
 * 性格段（soul）是她**长出来的**那部分，由 lib/soul.js 按互动算出来。
 * 它必须放在身份段之后、此刻段之前，并且两形态完全一致 —— 她有两个形态，
 * 但不是两个灵魂。所以这段不随 mode 变化，渗不进形态差异。
 *
 * 位置段（place）是桌面形态的自我定位，由 lib/presence.js 算出来：
 * 她在屏幕哪个角落、被谁挡住。它紧贴「此刻」，因为两者说的都是「现在」。
 *
 * 三个可选段都为空时，输出与没有这些参数时**逐字节相同**。
 */
function buildSystemPrompt({ persona, mode, memory, soul, place } = {}) {
  const core = identityCore(persona);
  const tone = MODE_TONE[mode] || MODE_TONE.world;
  const mem = String(memory || "").trim();
  const self = String(soul || "").trim();
  const pl = String(place || "").trim();
  return core + (self ? "\n\n【你的性格】" + self : "") + "\n\n【此刻】" + tone +
    (pl ? "\n" + pl : "") + (mem ? "\n" + mem : "");
}

/**
 * 音色描述：形态优先，缺失时按形态给不同默认值，绝不两形态共用一条。
 *
 * `persona.ttsInstruct` 是单值时代留下的字段，语义等同于「她的世界」那条 ——
 * 不能拿它给 desktop 兜底，否则双音色只是看起来有两份配置。
 */
function voiceProfile(persona, mode) {
  const p = persona || {};
  const key = MODE_TONE[mode] ? mode : "world";
  const prof = (p.voiceProfiles || {})[key] || {};
  if (prof.instruct) {
    return { mode: key, label: prof.label || MODE_LABEL[key], instruct: String(prof.instruct), source: "data.js" };
  }
  if (key === "world" && p.ttsInstruct) {
    return { mode: key, label: MODE_LABEL[key], instruct: String(p.ttsInstruct), source: "persona.ttsInstruct" };
  }
  return { mode: key, label: MODE_LABEL[key], instruct: DEFAULT_VOICE[key], source: "default" };
}

/** 判断两个形态是不是真的两副音色（只比 instruct，不比 label）。 */
function voicesDiffer(persona) {
  return voiceProfile(persona, "world").instruct !== voiceProfile(persona, "desktop").instruct;
}

module.exports = {
  DEFAULT_CORE,
  DEFAULT_VOICE,
  MODE_TONE,
  MODE_LABEL,
  identityCore,
  buildSystemPrompt,
  voiceProfile,
  voicesDiffer,
};
