"use strict";
// 回复里的方括号标签。
//
//   [emo:happy]   驱动表情（Live2D / Q 版）
//   [move:left]   驱动桌面形态的走动（主进程转发给舞台）
//
// 两个都必须从「念出来的文本」里剥干净 —— 一旦漏进 TTS，她会把「往左」当台词念出来。
// 这是本模块唯一的存在理由，所以剥离和解析放在一起，不给人只改一半的机会。

const EMO_LIST = ["happy", "sad", "shy", "angry", "calm", "surprised", "sleepy", "thinking"];
const MOVE_LIST = ["left", "right", "center", "floor"];

// 解析用：只要第一个。
const EMO_ONE = /\[emo:([a-z]+)\]/i;
const MOVE_ONE = /\[move:(left|right|center|floor)\]/i;
// 剥离用：要全部。
const EMO_ALL = /\[emo:[a-z]+\]/ig;
const MOVE_ALL = /\[move:[a-z]+\]/ig;
// 老格式：句首光秃秃的 [happy]。
const BARE_ONE = /^\s*\[(happy|sad|shy|angry|calm|surprised|sleepy|thinking)\]\s*/i;

/** 从一段回复里取出情绪、走动指令，并返回去掉标签后的正文。 */
function parseEmotion(raw) {
  const txt = String(raw == null ? "" : raw);
  const bare = txt.match(BARE_ONE);
  const emoHit = txt.match(EMO_ONE) || bare;
  let emo = emoHit ? emoHit[1].toLowerCase() : "calm";
  if (!EMO_LIST.includes(emo)) emo = "calm";
  const moveHit = txt.match(MOVE_ONE);
  const move = moveHit ? moveHit[1].toLowerCase() : null;
  return {
    text: stripTags(txt).trim(),
    emo,
    move: MOVE_LIST.includes(move) ? move : null,
  };
}

/**
 * 去掉所有标签，保留正文。
 * 只认白名单里的标签名：`[重要]`、`[1]` 这类正常方括号内容必须原样留着。
 */
function stripTags(text) {
  return String(text == null ? "" : text)
    .replace(EMO_ALL, "")
    .replace(MOVE_ALL, "")
    .replace(BARE_ONE, "");
}

module.exports = { EMO_LIST, MOVE_LIST, parseEmotion, stripTags };
