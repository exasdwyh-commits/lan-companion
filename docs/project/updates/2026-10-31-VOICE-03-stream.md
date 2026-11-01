# 2026-10-31 · VOICE-03 · 流式对话链：首句优先合成 + 播放队列

## 归属

- 负责人 / 聊天标识：WorkBuddy / 当前聊天（agent: workbuddy-chat-2026-10-31）
- 任务：[TASKS.md](../TASKS.md) 的 VOICE-03（前置 VOICE-02 已完成代码）
- 开始时已有修改 / 其他负责人：VOICE-02 的采集层（`web/live2d/voice-capture.js`、`lib/voice-endpoint.js`）已在上一轮接线完成，本轮不改它。
- 本次负责文件：
  - **新增** `MALFOY-ENGINE/lib/llm-stream.js`、`MALFOY-ENGINE/lib/reply-splitter.js`
  - **新增测试** `test/llm-stream.test.js`、`test/reply-splitter.test.js`、`test/chat-stream-router.test.js`、`test/companion-playback.test.js`
  - `MALFOY-ENGINE/lib/chat-router.js`（加 `runStream`）、`lib/config.js`（模型顺序）
  - `MALFOY-ENGINE/main.js`（`streamChat` / `llmChat` / `chatProviders` / `synthesizeVoice` 的 wav 分支 / 事件转发）
  - `MALFOY-ENGINE/preload.js`、`web/live2d/composer.js`、`composer.css`、`web/live2d/world.html`、`web/live2d/companion-playback.js`
  - `scripts/project_audit.py`（把两个新 lib 纳入「源码与包一致」清单）

## 完成内容

- **改了什么、为什么**：原来一句话要「整段生成完 → 整段合成完」才开始出声。现在改成三段流水：SSE 逐字收 → 按播放余量切句 → 每句合成好就接在播放队尾。
  - `lib/llm-stream.js`：用 `spawn` 跑 `curl -N` 逐行读 `data:`。**只认 `delta.content`**，`reasoning_content` 一律丢弃（实测 `qoder/qfmodel` 会先吐 12s 思考过程，那段被念出来就是灾难）。同时处理了网关的 `: keepalive` 注释行、半行跨 chunk、以及「网关忽略 `stream:true` 直接回整段 JSON」三种情况。
  - `lib/reply-splitter.js`：增量切句。块长度不是拍的，是解不等式：实测**合成耗时 ≈ 0.47 × 播放时长**（12/16/22/30/46 字各两遍，重复性 <0.02s），串行合成下「不断档」等价于「下一块 ≤ 2.1 × 已切总量 + 4 字」。4 字是留给 400ms 自然换气的余量。
  - `chat-router.runStream`：与非流式同一套顺序和熔断，但闸门换成「首个**正文** token」，默认 5s。一旦开始出正文就不再换源，中途失败也把已有内容交出去（`truncated`）——用户已经听见前半段，换源重播等于重复。
  - `companion-playback` 加 `enqueue()`：`load()` 仍是「换台」（打断 + 清队列），`enqueue()` 是「接着说」。中间那句不调 `active(false)`，否则她每句之间会掉回 idle，表情和动作跟着抖。
  - 聊天每句改 **wav 直传**（`synthesizeVoice({wav:true})`）：每句都跑一次 ffmpeg 要 0.3–0.5s，而每句播放只有 2–5s。体积换来的是每句提前 0.3s 出声。
  - `lib/config.js`：模型顺序按实测重排，把「先吐思考再出正文」的 `qoder/qfmodel` 压到最后；`ollama/local27b` 从「网关第 2、3 位之间」挪到最后（原来前两个云端源一 429，就会先落到本机 7b 上，一句话十几秒）。
- **复用了哪些已有实现**：`narration.toSpeech` 做数字/日期的读音清洗（没另写一套）；`AUDIO_EPOCH` 与 `CHAT_SEQ` 作废机制原样沿用；`synthesizeVoice` 的多级回退（qwen3 → edge → say）不变，只多了一个 `wav` 分支。
- **可运行入口**：`⌥⌘J` 打开对话窗，打字或点「说话」。`CHAT_STREAM=0` 可一键退回整段请求。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `node --test`（MALFOY-ENGINE） | PASS 243/243 | 本轮新增 37 项：`test/reply-splitter.test.js` 14、`test/llm-stream.test.js` 9、`test/chat-stream-router.test.js` 7、`test/companion-playback.test.js` 7 | 纯逻辑 + 真实 HTTP/真实 curl 子进程。**不能证明** Electron 窗口里的实际表现 |
| `bash scripts/project.sh check` | PASS 92/92，错误 0 | 待办提示 6 条，均为既有项 | 静态与包一致性 |
| `bash scripts/project.sh build` + 逐文件 `cmp` | PASS | `dist/DeepWhale.app`，10 个改动文件与源码逐字节一致 | 证明打包正确，不证明运行正确 |
| 临时脚本 `/tmp/measure-chat.js`：同机对比「整段等完」vs「流式逐句」 | 首音 2.96s（旧 6.27–8.02s）、句间间隙 **0.00s**、整段说完 11.44s（旧 16.34–17.89s） | 本记录下方数据表 | 真实模型 + 真实 TTS + 真实音频时长。**不含** Electron IPC、扬声器、麦克风与 STT |
| TTS 合成耗时随字数的实测 | 12/16/22/30/46 字 → 1.03/1.91/2.29/3.05/4.95s，播放 2.08/4.08/4.96/6.56/10.88s | 推导出「合成≈0.47×播放」这条比例 | 单机 Qwen3-TTS 1.7B；换模型/换机器需要重测 |
| 网关流式可用性 | `qoder/dfmodel` 首字 1.82–2.73s；`workbuddy-ai/*` 当时 429；`qoder/qfmodel` 首字正文 12.3s；一次观测到 38s | 见下文「网关抖动」 | 证明必须保留首字闸门与多源；不证明长期稳定 |

一次典型对比（同一问题、同一模型）：

| | 文字到齐 | 首音 | 整段说完 |
|---|---|---|---|
| 旧：整段等完再合成 | 2.88s | 6.27s | 15.07s |
| 新：流式逐句 | 1.82s（首字） | **2.96s** | **11.44s** |

## 剩余工作与交接

- **当前限制或失败**：
  1. **Electron 里一次没跑过**。编排 `main.js:streamChat` 只有语法检查与「同构逻辑的 node 复现」，没有真窗口验证。真机第一次跑要看的：句子之间有没有叠播、停止后队列是否真的清空、气泡是否在两个阶段之间闪。
  2. **网关抖动会吃掉收益**。本轮观测到同一条请求 38s 才出首字；闸门 5s 能救回来，但会退化成「5s 后换下一个源」。这不是代码能根治的问题。
  3. **STT 那 0.82s 固定开销没动**（实测与音频长度无关，两请求并发会翻倍，不能并发）。所以「说完到首音」= 0.45s 尾静音 + 0.82s 转写 + 2.96s ≈ **4.2s**，这是当前地板。
  4. 句中的硬切偶尔会落在词中间（如「上面的浪再大」｜「深海里也只是…」），因为那一块没有逗号可回退。听起来是换气，不是错误，但不够自然。
- **下一项**：VOICE-04（打断）。它现在唯一的前置就是 `VOICE-PLAN.md` 第四节那个 30 分钟 AEC 验证——这一步必须在本机带麦克风跑，我这边跑不了（会弹系统授权框）。
- **是否更新 STATUS / TASKS / CHANGELOG**：三处均已更新。
- **是否影响素材来源、外部依赖或运行入口**：不新增外部依赖；TTS 服务仍由 `scripts/ensure-tts-server.sh` 保活（本轮为测量而拉起过，当前在听）。运行入口不变。
