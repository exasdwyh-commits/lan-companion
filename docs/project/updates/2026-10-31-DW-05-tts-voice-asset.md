# DW-05 · 修复「Qwen 女主参考音色暂时不可用」

日期：2026-10-31 · 负责人：WorkBuddy / 当前聊天（agent:workbuddy-chat-2026-10-31）

## 用户报的现象

在 App 里做翻唱，报错：**「Qwen 女主参考音色暂时不可用，请稍后再试。」**

## 根因：一条依赖链上有四个脆弱点

这句话来自 `main.js` 里 `covers()` 的 `reference` 回调 —— 每次做翻唱，它都会**现场调 TTS**
生成一段女主参考音色，然后检查返回值：

```js
if (sp.via !== 'qwen3' || !sp.audio) throw new Error('Qwen 女主参考音色暂时不可用，请稍后再试。');
```

只要这条链上任何一环出问题，翻唱就整体失败。实际有四环都脆弱：

| # | 脆弱点 | 后果 |
|---|---|---|
| 1 | **服务没有持久化机制**。`~/.smartcompanion/tts_server.py` 靠手动 `nohup` 拉起，会话/终端一退进程就被回收 | 服务静默消失，App 完全不知道 |
| 2 | **App 不负责启动它**，只连 8091；不在就悄悄降级到 edge-tts（`via='edge'`） | 翻唱这里 `via!=='qwen3'` 直接判定失败 |
| 3 | **失败一次熔断 5 分钟**，且熔断是全局的 | 读书预取失败一次，翻唱跟着连坐 5 分钟 |
| 4 | **服务端推理没有锁**。`ThreadingHTTPServer` 每请求一线程，而 MLX 的 GPU 执行是异步交错的 | 实测 3 路并发单条从 2.05s 涨到 4.7s；再叠排队就顶穿 15s 超时 |

外加 `interactive` 的 curl 超时只给了 **15 秒**。

## 修复

### 1. 翻唱参考音色改读定稿资产（决定性的那一步）

唱歌音色早就定稿在 `assets/whale-video-test/voice/ref-sing-magnetic.wav`（2.70 MB / 44.1 kHz
单声道 / 32.14 秒，就是用户认可的 studio 版的音色来源）。它不该每次翻唱都现场重造。

`main.js` 新增 `singRefAsset()`，两个候选路径（项目根 `assets/` → 包内 `companion-content/`），
`reference` 回调改成**资产优先**，只有资产缺失才回退现场生成；回退时用 `force` 绕过熔断。

### 2. 服务端加串行锁

`~/.smartcompanion/tts_server.py` 的 `synth()` 用全局 `threading.Lock()` 包住模型推理，
并新增 `X-Queue-Ms` 响应头暴露排队时间。改前已备份 `tts_server.py.bak-20261031`。

### 3. 客户端超时 15s → 25s

服务端串行化后并发请求会排队，25s 覆盖到十几路排队。

### 4. TTS 服务保活（launchd 在本机不可用，改由 App 拉起）

写了 `scripts/ensure-tts-server.sh`：幂等（`nc -z` 探端口，在监听就退出）、
双重 fork + `setsid` 真正 daemonize、`mkdir` 原子锁防并发重复起。

`main.js` 新增 `ensureTtsServer()`，在 **App 启动时**和 **Qwen 请求失败设熔断时**各调一次
（60s 去抖）。

> **为什么不用 launchd**：已按现有 `com.smartcompanion.stt.plist` 写好
> `~/Library/LaunchAgents/com.smartcompanion.tts.plist`（`plutil -lint` 通过），但
> `launchctl bootstrap`/`load -w` 一律报 `5: Input/output error`，沙箱外执行同样失败，
> 日志里能看到进程起来过又 shutdown。这台机器的 GUI domain 不接受新 LaunchAgents。
> 结论：不跟系统配置较劲，改由 App 自己保活 —— 反而更贴合「谁依赖谁负责」。

### 5. 修正我上一轮的错误优化：合成并发 3 → 1

`voice-script.js` 上一轮把逐句合成改成并发 3，理由是「6 句 900ms → 333ms」。
**那个数字是 mock 测的**（`setTimeout(150ms)`），真实 TTS 单条 2 秒，完全不成立。

服务端加锁后的真实测量：3 路并发总耗时 **7.8s**（排队 0 / 3915 / 5762 ms），
而串行只要约 **6s** —— 并发是**负收益**。默认改回 1，保留 `mapLimit` 与 `options.concurrency`
入口，将来服务端支持批处理时可直接调大。

## 验证

| 项 | 结果 |
|---|---|
| 集成：`cover-jobs.start()` 全流程（mock spawnJob） | reference 调用 1 次、**走 TTS 0 次**；`status=preparing` 不报错；REF 落盘 2834478 bytes / RIFF 头 |
| REF 扩展名是 `.mp3` 而内容是 WAV | librosa 按内容嗅探，读得动（32.14 s / 16 kHz）——不是缺陷 |
| 服务端串行锁 | 并发 3 路 `X-Queue-Ms` = 0 / 3915 / 5762，严格排队 |
| 保活幂等 | 服务在跑时调用 → 进程数不变 |
| 保活拉起 | 杀掉服务后调用 → 1s 返回、11.0s 就绪 |
| **端到端** | 手动杀 TTS + 杀 App → **只启动 App** → 服务被自动拉起（pid 69113，`/health` 200） |
| 资产守卫测试 | 新增 3 项：两处副本存在、内容一致、时长 ≥15s（防有人换成短样本让音色退回「薄、尖」） |
| Node 全量 | 211 → **214/214** |
| `project.sh check` | **88/88，错误 0**；Electron 核心/包 **28/28** |
| 产物 | 已重建 287 MB，包内含 `ensureTtsServer`（3 处）与音色资产副本 |

## 未覆盖 / 已知限制

- **翻唱成品未人耳试听**（本轮只验证「不再报音色错误」这条链路，没有重跑完整翻唱出成品）。
- **真实 GUI 内的翻唱按钮未点过**：集成验证是在 Node 里复刻 `reference` 回调 + mock `spawnJob`，
  不是从面板点出来的。
- **launchd 方案落空**：服务现在靠 App 拉起。若 App 没启动、又有别的东西要连 8091，仍需手动跑
  `bash scripts/ensure-tts-server.sh`。
- 唱歌音色资产在 `assets/` 与 `MALFOY-ENGINE/web/live2d/companion-content/` 各存一份（2.7 MB ×2），
  是为了包内也能命中兜底路径；新增测试守两处一致，避免静默漂移。
- 读书音轨缓存（上一轮）与本轮改动叠加后，**串行合成**下长段落首次等待会变长
  （6 句 ≈12 s）。这是稳定性换的速度；要快需要服务端批处理或流式逐句播放，未做。
