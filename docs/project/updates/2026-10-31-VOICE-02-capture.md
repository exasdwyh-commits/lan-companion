# 2026-10-31 · VOICE-02 · 采集搬进渲染进程，说完自动发

## 归属

- 负责人 / 聊天标识：WorkBuddy / 当前聊天（agent:workbuddy-chat-2026-10-31）
- 任务：[TASKS](../TASKS.md) 的 VOICE-02；设计依据 [VOICE-PLAN](../VOICE-PLAN.md) 第三节 V1。
- 开始时已有修改 / 其他负责人：`lib/voice-endpoint.js` 与 `test/voice-endpoint.test.js`（本聊天上一轮产出，判定逻辑已绿但无调用方）。
- 本次负责文件：`web/live2d/voice-capture.js`（新增）、`web/live2d/composer.js`、`web/live2d/composer.html`、`web/live2d/composer.css`、`preload.js`、`main.js`、`lib/voice-endpoint.js`、`test/voice-capture.test.js`（新增）、`scripts/project_audit.py`。

## 完成内容

**把「点麦克风 → 固定录 4 秒 → 转文字填草稿」换成「点麦克风 → 说完自动发」。**

原来那条录音路径是主进程 `ffmpeg -f avfoundation -t 4`（`main.js` 的 `recordAndTranscribe`）。它有两个死结：只能录固定时长，且拿不到 WebAudio 的降噪。所以采集整体搬到渲染进程，主进程只保留「音频 → 文字」这一件事。

改动分四层：

| 层 | 文件 | 做了什么 |
|---|---|---|
| 判定 | `lib/voice-endpoint.js` | 由 CommonJS 改为 UMD，渲染进程直接 `<script>` 用同一份阈值逻辑，不再抄第二份 |
| 采集 | `web/live2d/voice-capture.js`（新） | `getUserMedia` → `AnalyserNode` 取 RMS → 喂端点 → `MediaRecorder` 出 webm/opus；状态机（超时、取消、重复启动）与浏览器 API 解耦 |
| 接线 | `main.js` / `preload.js` | 新 IPC `companion:transcribe`（只收聊天窗口的音频）+ `voice:activity`（采集期角色状态）；抽出 `postStt()` 供新旧两条路复用；安装只放行音频、只放行自家窗口的权限策略 |
| 交互 | `composer.js` / `.html` / `.css` | 麦克风变成开关（再点=取消），转写完直接发送；说太短/没听到/超时各有提示；听的时候按钮转红并呼吸 |

刻意的取舍：

- **V1 用「她说话时我不采集」代替回声消除**。点麦克风先 `stopVoice()` 再开麦。这不是打断（V2 才做），只是不让她听到自己。
- **不裁剪音频首尾静音**。裁剪要解 webm 再重编码，而实测（见下）服务端 `vad_filter` 对 5 秒前置静音的输出与原音频完全一致——省掉这段复杂度。
- **旧路保留**。`companion:listen`（固定秒数 ffmpeg）没有删，作为拿不到麦克风时的回退。

### 顺带定下的一个参数

`MediaRecorder` 吃默认码率会把话听错。同一条「海风很轻 我一直在这里陪你」：

| 编码 | 字节 | 转写结果 |
|---|---|---|
| opus 32k（Chromium 默认档） | 12839 | 海峰很清 我一直在这里陪你 ❌ |
| opus 64k | 26980 | 海风很轻 我一直在这里陪你 ✅ |
| opus 96k / 128k | 38853 / 51651 | 同上 ✅ |
| 原始 wav（16k 单声道） | 96078 | 海风很轻 我一直在这里陪你 ✅ |

因此 `createRecorder` 固定 `audioBitsPerSecond: 64000`。12 秒的 64k webm 约 96KB，用不着为体积牺牲识别率。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `node --test test/voice-capture.test.js` | PASS 8/8 | 测试文件在本仓库 | 假 env 驱动状态机：超时、取消、授权中途取消、麦克风拒绝、重复启动、discard 后继续听。**不能**证明真麦克风电平/阈值合适 |
| `node --test test/voice-endpoint.test.js` | PASS 10/10 | 同上 | UMD 改造后原判定逻辑未回退 |
| `node --test`（全量） | PASS 206/206 | — | 原有 198 项无回归（新增 8 项） |
| `bash scripts/project.sh check` | PASS 90/90，错误 0 | — | 新增 `voice-capture.js` / `voice-endpoint.js` 已纳入 `electron_refs`，语法检查覆盖 |
| `POST http://127.0.0.1:8090/stt`（webm/opus 3s，64k） | PASS 200，817ms | 临时文件，未入库 | **真实服务往返**：服务端能解 MediaRecorder 格式，64k 结果与 wav 一致 |
| 同上（5s 静音 + 3s 语音） | PASS 200，831ms，内容未被静音污染 | 同上 | 证明「不裁剪首尾静音」可行；也再次印证 STT 耗时与长度无关 |
| 真麦克风端到端点一次 | **未验证** | — | 需要系统授权弹窗与本人在场，本轮环境跑不完 |

## 剩余工作与交接

- **必须由人验一次**：启动后点麦克风，确认 ①系统授权弹窗出现 ②说完一句自动发出 ③她回答时麦克风指示灯灭。这三件事没有一条能用单测代替。
- 已知风险：`composer` 窗口是 `focusable: false`，若 `AudioContext` 因缺用户手势一直挂起，表现为「一直没听到你说话」（12 秒超时）。点按钮本身是用户手势，预期不会发生，但需要实测确认。
- 阈值可能偏保守：安静房间起点 0.004 RMS。若实测「说话不触发」，先调 `voice-endpoint.js` 的 `minAbsRms` 与 `startRatio`，不要改采集层。
- 下一项：VOICE-03（SSE 流式 + 播放队列）。**VOICE-02 单独把首音从约 10.3s 拉到约 6.8s**，剩余收益全在 03。
- 已更新 STATUS / TASKS / CHANGELOG；VOICE-PLAN 第三节追加了「已实施」指针。
- 不影响素材来源与外部依赖；新增 IPC 两个，旧 IPC 全部保留。
