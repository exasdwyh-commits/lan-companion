# 2026-11-01 · AIRI-REF-01 · 参考项目 AIri 语音对话机制调研与移植

## 归属

- 负责人 / 聊天标识：WorkBuddy / 当前聊天（agent:workbuddy-chat-2026-11-01）
- 任务：VOICE-02 / VOICE-03 之后的延续（用户 2026-11-01：「airi 下载的项目，看看里面的语音对话如何更好沟通的技术能否借鉴」）。
- 开始时已有修改 / 其他负责人：无并行写入。
- 本次负责文件：
  - 新增 `MALFOY-ENGINE/lib/utterance-tail.js`
  - 新增 `MALFOY-ENGINE/test/utterance-tail.test.js`
  - 改 `MALFOY-ENGINE/web/live2d/companion-playback.js`、`web/live2d/voice-capture.js`、`web/live2d/composer.js`、`web/live2d/composer.html`
  - 改 `MALFOY-ENGINE/main.js`、`preload.js`、`test/companion-playback.test.js`、`test/voice-capture.test.js`
  - 改 `scripts/project_audit.py`（把新文件纳入语法/一致性检查）
  - 本记录

## 读的是哪一份

`ref/airi-v0.14.1`（仓库内本地副本，v0.14.1，`packages/` 下为 monorepo）。
只看语音输入端到输出端这条链路，重点文件：

| 关注点 | 文件 |
|---|---|
| 端点判定（规则层） | `packages/core-agent/src/voice/policy/rules.ts` |
| 端点判定（模型层） | `packages/agents/src/voice-end-judge/index.ts` |
| 转写清洗 | `packages/agents/src/voice-transcription-rephrase/index.ts` |
| 麦克风能力 | `packages/stage-ui/src/composables/audio/audio-device.ts`、`packages/audio/src/browser/sources.ts` |
| 分句与首音 | `packages/pipelines-audio/src/processors/tts-chunker.ts` |
| 合成/播放调度 | `packages/pipelines-audio/src/speech-pipeline.ts`、`timeline.ts` |
| 打断与淡出 | `packages/core-agent/src/voice/output/response.ts`、`packages/audio/src/browser/audio-output.ts` |
| 表演层（情绪/停顿） | `packages/pipelines-audio/src/llm-streaming-control/`、`packages/i18n/src/locales/en/base.yaml` |
| 延迟基准 | `packages/testing-audio/cases/voice-end-latency/` |

## 它靠什么让对话「顺」

按对我们有用程度排序，每条都给了文件位置。

1. **端点不是只看静音，而是「静音 + 语义判词」双闸**。
   静音 1.2s 时把当前转写丢给聊天模型判 `{"complete": boolean}`；判 complete 立刻收尾，
   判 incomplete / 超时 / 报错一律当没说完，继续录到 4.2s 兜底
   （`rules.ts:186-195`、`voice-end-judge/index.ts:12-19`、`voice-end-judge-plugin.ts:63-86`）。
   目的是让「说话中途想一下」不被当成说完。

2. **它能这么做，是因为转写是流式的**：识别在说话过程中持续出 partial，
   判定时文本已经在手，所以「多等」不额外花钱（`stores/modules/hearing.ts:589-593`、
   `libs/providers/stream-transcription/index.ts:140-172`）。

3. **打断先淡出、再 abort、最后等真正静音才开麦**。
   `response.ts:454-460` 明确固定了顺序：`playback.stop({fadeMs})` → `abort.abort()`；
   淡出在音频时钟上做 `linearRampToValueAtTime(0)`，默认 100ms
   （`audio-output.ts:116-122`）；`attempt.ts:146-153` 用 `await interruption.silenced`
   等到 `source.onended` 才恢复采集，避免把自己的尾音录进去。

4. **回声消除是「问出来的」不是「假设的」**。
   `sources.ts:135-137` 读 `track.getSettings().echoCancellation`，`stores/voice.ts:575`
   用它当门：`acceptSpeech: async () => !speaking.nowSpeaking || devices.source.echoCancellation`。
   没有 AEC 就不允许自激插话，有 AEC 才允许边说她边听。

5. **首块提前切 + 多路预合成 + 按 sequence 重排**。
   开头允许在逗号处提前结束（`boost=2` 块、`minimumWords=4`、`maximumWords=12`，
   `tts-chunker.ts:27-48,178-192`）；`ttsMaxConcurrent=4` 提前合成；
   播放严格按 sequence 推进，TTS 乱序完成不会乱序播（`speech-pipeline.ts:181-205`）。

6. **表演与音频对齐**：`<|ACT {...}|>` / `<|DELAY n|>` 不进 TTS 文本，
   走 timeline 在「上一句播完、下一句开始」之间执行（`timeline.ts:57-86`）。

7. **转写清洗**：单独一个 agent 修标点、去口癖、去口误重复（`voice-transcription-rephrase/index.ts:9-17`）。

## 逐条对照我们的实现

| 机制 | AIri | 我们（本轮之前） | 结论 |
|---|---|---|---|
| 端点判据 | 32ms Silero 窗 + 迟滞 0.6/0.18 + 1.2s 判词 + 4.2s 兜底 | 20ms RMS + 自适应噪声底 + 450ms 尾静音 | 我们的更快但会切错；**判词照搬不了**（没有流式 ASR） |
| 转写 | 流式 SSE/WS，边说边出字 | 整段 POST，0.82s 固定开销 | 服务端不支持，改不动 |
| 首块切分 | boost 前 2 块可在逗号切 | 首块 ≤16 字、按播放余量推算后续 | 结构等价，我们的系数是实测出来的 |
| 预合成 | 并发 4 | 串行（服务端有全局锁，实测并发只增排队） | **不借鉴**，会变慢 |
| 打断 | 100ms 淡出 + 等静音 + 预录抢占 | `pause()` 硬停，无淡出 | **借鉴**（已做） |
| 回声消除 | 读 `getSettings()` 当门 | 断言「她说话时我不听」 | **借鉴**（已做，先用于开麦前的等待时长） |
| 表演对齐 | timeline 按播放位置派发 | 首块到达时就设情绪 | 未做，见「剩余工作」 |
| 转写清洗 | 单独 LLM 往返 | 无 | **不照搬**（多一跳 ≈ 1.5s）；改成提示词里说明 |

## 本轮实际落地

### 1. 停播改为 90ms 淡出（`companion-playback.js`）

`stop()` 不再立刻 `pause()`，而是在音频元素上把 `volume` 线性降到 0 再停；
`load()`（换台/切歌）仍然硬停，因为切换内容不该留旧声音的尾巴。
淡出途中被新句子顶替时立刻恢复音量，避免新的一句「哑着播」。
时钟可注入，所以淡出能被单测逐毫秒推进。

这是一处纯感知改动：硬切听起来像设备坏了，淡出听起来像她停下了。

### 2. 回声消除改成「向系统问」（`voice-capture.js`）

新增 `micCapabilities(stream)`，读 `track.getSettings()`；`start()` 的回包和
`capture.capabilities` 都带 `{ echoCancellation, noiseSuppression, autoGainControl }`。

`constraints` 里写 `echoCancellation: true` 只是**请求**，浏览器可以不理
（设备不支持、被别的进程独占、或系统层关掉了）。这是把 VOICE-PLAN 里
「AEC 到底有没有用」从待验证问题变成运行时事实的一步。

用途（本轮）：开麦前等她淡出尾巴的时长 —— 有 AEC 等 40ms，没有等 150ms。
每轮语音省 110ms，且不会录进她自己的尾音。

### 3. 悬空尾词续听（`lib/utterance-tail.js` + `composer.js`）

照搬 AIri 的判词需要流式 ASR，我们没有。改成**纯规则**：
转写文本如果停在连接词、介词、否定词上，或以逗号结尾，就不立刻发，
再开一次麦接着听（最多 2 轮），两段合并后一起发。

- 判据只看文本尾部，不调模型，零额外延迟；
- 只在真的没说完时才付「多等一次静音」的代价；
- 误判成「没说完」= 白等 3 秒；误判成「说完了」= 打断用户。所以词表刻意保守，
  排除了「的 / 要 / 在」这类当结尾比当连接词更常见的字（「好的」「不要」「现在」不会被误判）。

写的时候踩到一个坑，记下来：最初把采集的 `onDiscard`（太短的一声）当成「这轮结束」，
一 resolve 就把 `capture` 置空 —— 而 discard 只是「听到了但不算数」，采集还在继续。
置空之后就再没人能停那路录音，麦克风会一直开着。改成 discard 只更新文案、不结束这一轮。

### 4. 语音输入在提示词里标注（`main.js`、`preload.js`、`composer.js`）

`host.chat(text, history, { voice:true })` → 主进程在这一轮 system prompt 末尾补一句
「这是语音转写，可能缺标点/有同音错字，按意思理解，不要纠错也不要反问」。

AIri 用的是单独一次 rephrase 模型往返（`voice-transcription-rephrase`）；
我们首音预算只有 4.2s，多一跳就回到 5 秒以上，所以改成零成本的做法。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `node --test`（MALFOY-ENGINE 全量） | **PASS 268/0** | `/tmp/full6.log`（本轮） | 证明纯逻辑与状态机；**不含**窗口/扬声器/麦克风 |
| `node --test test/utterance-tail.test.js` | PASS 13/13 | 同上 | 判据与合并规则；不含真机识别质量 |
| `node --test test/companion-playback.test.js` | PASS 12/12 | 同上 | 淡出曲线、换台不淡出、淡出被顶替时恢复音量 |
| `node --test test/voice-capture.test.js` | PASS 11/11 | 同上 | 能力探测的成功/缺失/抛错三条分支 |
| `bash scripts/project.sh check` | **93/93，错误 0** | 本轮输出 | 语法、链接、源码与包一致性 |
| `bash scripts/project.sh build` | PASS，337M | `dist/DeepWhale.app` | 打包成功；未启动验证 |
| 包内 8 个改动文件与源码 `cmp` | 全部一致 | 本轮输出 | 包内确实是本轮代码 |

## 剩余工作与交接

- **当前限制**：
  - 真麦克风端到端仍未跑过（权限弹窗 + 本人在场）。淡出、续听、AEC 探测都只到「逻辑已验证」。
  - 续听有约 50~200ms 的重开麦空档；用户若在 450ms 静音后**立刻**接着说，
    第一两个字可能落在空档里。实测方式：连续说「我想想，然后我们去」看开头是否被吞。
  - 判据是启发式的：词表里的「不 / 没 / 很 / 是」在少数完整句里也会命中，代价是白等 3 秒。
- **没做的（有明确理由）**：
  - **4 路并发预合成**：本机 TTS 服务有全局串行锁，实测两并发 1.43/1.62s vs 单请求 0.82s，
    并发只会把队列排长。
  - **语义端点判词**：需要流式 ASR；否则每句话多一次模型往返，首音会退到 5s 以上。
  - **表演对齐 timeline**：我们的情绪只在首块设定一次，情绪变化落在句子边界上需要
    把 `emo` 随 chunk 下发并在 `audio` 真正 `play` 时应用，涉及 `world.html` 的舞台状态机，
    单独一项做更稳。
- **下一项建议**：把 AEC 探测结果用起来，做真正的「边说她边听」（VOICE-04）——
  前提是先实测 `getSettings().echoCancellation` 在 macOS 内置麦/蓝牙耳机上到底是不是 true。
  这个值现在可以直接在开麦后读到，不必再单独写探针。
- 是否更新 STATUS / TASKS / CHANGELOG：已更新。
- 是否影响素材来源、外部依赖或运行入口：不影响。新增一个纯 JS 文件，
  无新依赖、无新端口、无模型下载。
