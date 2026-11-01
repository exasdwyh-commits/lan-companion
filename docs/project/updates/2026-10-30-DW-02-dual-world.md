# 2026-10-30 · DW-02 · 一个身份、共享会话与双音色

## 归属

- 负责人 / 聊天标识：WorkBuddy 聊天（2026-10-30 晚，agent:workbuddy-chat）
- 任务：[TASKS](../TASKS.md) 中的 DW-02，依赖 DW-01。
- 开始时已有修改 / 其他负责人：Codex 正在进行 DW-04（`web/live2d/world.html`、`chibi-*`、纹理与骨骼素材）。
  本次**不碰**这些文件，也不改 `web/data.js` 与任何个人数据。
- 本次负责文件：`MALFOY-ENGINE/lib/identity.js`（新）、`lib/session-store.js`（新）、
  `lib/memory-store.js`、`lib/config.js`、`MALFOY-ENGINE/main.js`、`MALFOY-ENGINE/preload.js`、
  `MALFOY-ENGINE/test/{identity,session-store,memory-store}.test.js`、
  `scripts/{check-dual-world.sh,mock-chat-server.js,voice-metrics.py}`（新）。

## 完成内容

### 1. 一个身份（`lib/identity.js`）

身份段（名字、来历、性格、说话方式、情绪标签协议）只有一份，两形态逐字节相同；
形态只追加一段「【此刻】」，写她身处哪里、神态收放多少，并明确「判断、好恶、记得的事完全一致，
不是另一个人格」。实测共享前缀 305 字（身份 298 + 段落头 7），形态段 80 / 122 字。

顺带把可见的旧角色残留清掉：托盘提示 `Miss Malfoy` → `深蓝 · 鲸鱼娘`，托盘符号 🐍 → 🐋，
文件头注释同步。`data.js` 里的 persona 本来就是「深蓝」，未改。

### 2. 会话归主进程（`lib/session-store.js`）

会话落 `<数据目录>/session.json`，带 `mode / via / tts` 元信息，上限 40 条、原子写（tmp + rename）、
坏文件改名 `.bad` 后重开。换形态要重建窗口，history 留在渲染层就随窗口一起丢了 —— 这是「同一个人」
断掉的主因。`openStage` 的 `did-finish-load` 现在把最近 20 条推给窗口（`character:session`），
`preload.js` 已暴露 `onCharacterSession`；**渲染层尚未消费该事件**，见「剩余工作」。

### 3. 统一交付出口（`main.js` `deliverReply`）

以前只有主路会记记忆、解析情绪、推给窗口；`agens` / `local27b` 是「哑」的：答了话却不记得、
不出表情、不报引擎。现在任何一条路成功都走同一函数：解析情绪 → 写 `memory.jsonl` →
写会话 → 触发画像提炼 → 仲裁 → 合成 → 推送。
她主动开口（`companion:proactive`）走 `noMemory` 分支：话进会话，但不把系统提示当成「用户说过」污染记忆。

### 4. 引擎标注不再撒谎

`synthesizeVoice` 原来把引擎写进模块级 `LAST_TTS_VIA`，返回值只给音频。两条请求并发时这个变量互相覆盖——
A 明明是 qwen3，读回来却是 B 的 edge。现在返回 `{audio, via, ms}`，引擎跟着这条回复走；
`LAST_TTS_VIA` 只留作「最近一次」诊断快照。

### 5. 叠播仲裁

`CHAT_SEQ` 记提交序号，`SPOKEN_SEQ` 记已播最大序号。晚到的旧回答直接丢弃（不合成）；
**合成要几秒，这几秒里用户可能又问了新的**，所以推送前再判一次，否则「已经开始合成」的那条
合成完照样会播出来。

### 6. 画像可纠正（`lib/memory-store.js`）

结构化条目 `- 属性：值` 按属性名去重，同属性**后写覆盖先写**，位置不变；没有冒号的老自由文本
原样保留、整行去重。新增 `forget(key)`。提炼 prompt 改成要求输出该格式，并声明「用户明确纠正过的以纠正后为准」。
原来只做整行去重：说错的名字会新旧两条一起留在画像里，她来回改口。

### 7. 本地模型兜底改走 ollama（`lib/config.js` + `main.js`）

外部额度用尽时（实测 magpie 六个源全 429）原来只能等本地 27B，而本机并没起 llama-server。
现在多一路 ollama（OpenAI 兼容端点，默认 `deepseek-r1:7b`，可用 `OLLAMA_URL` / `OLLAMA_MODEL` 覆盖），
排在 agens 之后、llama-server 之前，`via` 如实标 `ollama:<模型名>`。thinking 模型会把预算烧在推理上，
这一路给 900 token。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `node --test MALFOY-ENGINE/test/*.test.js` | PASS 37/37 | 控制台 | 身份分层、会话存储、画像纠正、数据目录隔离；纯 Node |
| `bash scripts/check-dual-world.sh` | PASS 16/16 | [dual-world.json](../../../benchmarks/2026-10-30-DW-02/dual-world.json) | 见下逐项 |
| ├ 身份分层 | PASS | 同上 `identity-single-core` | 305 字共享身份、语气段 80/122 字、无双身份残留、两形态音色配置不同 |
| ├ 真实聊天（本地模型） | PASS | `turnMain`：`via=ollama:deepseek-r1:7b`、`tts=qwen3`、14.99s、语音 36020B | 模型池全 429 时她仍答话并合成；**模型是真跑的 ollama，不是桩** |
| ├ 回退路径也记录 | PASS | `turnFallback`：`via=agens`、会话 2→4 | 非主路同样写会话与记忆 |
| ├ 换形态不重置 | PASS | 同上 `session-not-reset` | 会话 4 条，未重置 |
| ├ 跨形态回忆 | PASS | 桩请求日志 `userTurn=2`、`tone=desktop`、含「我叫小林」 | 桌面形态的请求确实带着世界形态里那句话 |
| ├ 跨重启读回 | PASS | `session-after-restart` | 新进程读回 4 条，形态顺序 w,w,d,d |
| ├ 叠播仲裁 | PASS | `no-overlapping-playback` | 先发的慢回答到得晚 → `superseded`、`tts=skipped`；新回答正常播 |
| ├ 双音色（成品） | PASS | [world.mp3](../../../benchmarks/2026-10-30-DW-02/world.mp3) / [desktop.mp3](../../../benchmarks/2026-10-30-DW-02/desktop.mp3) | 同一句话两份，引擎均 qwen3，可直接试听 |
| ├ 双音色（客观指标） | PASS | [voice-metrics.json](../../../benchmarks/2026-10-30-DW-02/voice-metrics.json) | 4.80s→3.84s（快 20%），F0 中位 262.3→296.3Hz，90 分位 290.9→400.0Hz，过零率 0.133→0.148 |
| ├ 真实数据未动 | PASS | `real-data-untouched` | memory/profile/session 三项指纹全程未变 |
| 负向验证：临时把 desktop 语气改成等于 world | 按预期报红 | 同上判定脚本 | 脚本真会失败，不是恒绿；还原后恢复 `systemsDiffer=true` |

未测或不能证明的：`world.html` 画面侧（读不到按钮、本机常锁屏，且该文件归 DW-04）；
`character:session` 事件在渲染层的消费；真机点按/拖拽交互。

## 剩余工作与交接

- **渲染层要消费 `character:session`**：`world.html` 归 DW-04，本次只在 `preload.js` 备好接口。
  接上之后，「换形态」才在视觉上看得出来是同一段对话。
- **ollama thinking 模型的 reasoning 兜底不稳**：`llmOnce` 在 `content` 为空时取 `reasoning` 最后一行，
  那是思考过程不是回答。当前给足 900 token 后 `content` 正常有值，但换更小的预算就会漏。建议后续
  在 `llmOnce` 里对 ollama 请求显式关掉 thinking（`chat_template_kwargs`）或按模型能力分流。
- **画像提炼仍靠「每 5 轮」触发**，纠正生效依赖模型愿意输出同属性名。`forget` 已具备，但没有
  「用户说忘掉」的自然语言入口 —— 属 DW-07。
- DW-05（唱歌/阅读/统一音频）依赖本项的双音色与会话，现在可以开始。
- 是否更新 STATUS / TASKS / CHANGELOG：是，已更新。
- 素材来源 / 外部依赖：新增对 ollama 的**可选**依赖（不在就跑原路径），无新增素材、无新增密钥。
