# 竞品优秀能力集成方案（给执行 agent 的工作单）

- 日期：2026-10-31
- 作者：Hermes 002 / 本聊天（调研+源码核实）
- 参考源（均已 clone 到本地，许可证已核）：
  - `~/Documents/VScode/ref/dsh-pet`（MIT，327 commits，109 段透明动画，516 个 TS 文件）
  - `~/Documents/VScode/ref/airi-v0.14.1`（MIT，62 包 monorepo，Electron+Vue3）
- **执行前必读**：仓库 `../AGENTS.md` 与 `docs/project/README.md`；在 `TASKS.md` 登记领取；遵守文件边界（WorkBuddy 持有 DW-05 的 main/preload 写入权；world-video.js 当前有人并行修改）。
- **许可边界修正**：dsh-pet 的代码为 MIT，但其 [README 许可段](https://github.com/PC2005-cloud/dsh-pet#许可)另行允许动画/提示词/源视频**非商用开源使用**，公开二创需署名原作者；角色为社区二创「大肥鱼」，上游标注 CC BY-NC-SA 4.0，并非澜的原创形象。首版可在隔离区研究素材和非商用发行可行性；**公开包仍需逐项核对视频权利链、署名及相同方式共享条件，不自动打入发布包**；未来商用必须换授权原创。AIRI 角色、模型、音色仍需另核授权。见[八条动作隔离样本](../../assets/dsh-pet-motion-pilot/README.md)。

## 优先级总表

| # | 能力 | 来源 | 落到我们哪 | 优先级 | 依赖 |
|---|---|---|---|---|---|
| 1 | 工作状态六档状态机 | dsh-pet | DW-06 | P0 | **并行会话已落地 lib/work-status.js+测试（22:44），接线进行中** |
| 2 | Q 版图集切换交叉淡入 | dsh-pet | DW-04 补强 | **已完成（Hermes 002，2026-10-31）** |
| 3 | 碎碎念周期参数设计 | dsh-pet | VOICE-01 | **轻量版已完成（Hermes 002）：world.html 周期气泡+?whisper=秒 验收参数；语音化留 VOICE-01** |
| 4 | 素材配方文档化+CI 转码 | dsh-pet | DW-08/素材管线 | P2 | 无 |
| 5 | 对外 HTTP API 驱动桌宠 | dsh-pet | DW-06 扩展 | P2 | #1 |
| 6 | Live2D 工程化渲染 | AIRI | CHIBI 后续（澜 Live2D 切换）| P2 | 分层 PSD（未开工）|
| 7 | 音频仲裁/打断 | AIRI | DW-05 收口 | P1 | WorkBuddy 协调 |

---

## 1. 工作状态六档状态机（DW-06 蓝本）★最高价值

**参考实现**：`ref/dsh-pet/dsh-pet/src/host/work-status.ts`（+ `work-status-lifecycle.test.ts`、`src/shared/work-status.ts`）

他们把宿主（DSH）的会话事件流压缩成六档：`thinking / working / result / waiting / success / error`。可直接抄的设计决策：

1. **回合结束原因→档位映射**：`completed→success`；`error/max-tokens/timeout→error`；`blocked→waiting`；`aborted 等→null（清档回 idle）`——注释里点明"残留上一档会让回合被打断后永远卡在 working"，这是我们 DW-06 验收里"取消后不误庆祝"的同款问题。
2. **多轮任务不中途庆祝**：自动续跑轮的中间轮只给 `result`（本轮完成≠任务完成），只有 `update_goal action=complete` 收尾轮才 `success`、`blocked→error`（诚实沮丧）。对应我们 HERMES-02 已落地的 `react("task-complete")` 只在真实结果时发。
3. **等待用户答复归 waiting**：模型调用 `ask_user_question` → `waiting` 档而非 working。我们对应：Hermes 任务需要用户确认/输密码时。
4. **档位=动画数组索引**：`animations.events.workStatus[]` 索引即档位，只可追加不可插中间——内容与代码解耦，pack 思路与我们 pack.json 一致。
5. **聚合快照**：按会话维护 `state/task`，对外只暴露一个展示快照（`/work-status` 端点）。

**落到我们**：
- 主进程 `companion:work`（main.js，**需与 WorkBuddy 协调写入权**）产出事件流：`queued/running/waiting-user/succeeded/failed/cancelled`（比他们多 queued/cancelled，比他们少 thinking/result 的中间档——先五档起步）。
- 状态→表演映射走现有接口：`setActivity("working")` + 新增 `react("task-waiting")`；气泡文案走 `world.html` 现有 bubble。
- 验收照抄他们测试：`work-status.test.ts` 的事件压缩用例 + 我们 REPAIR 里的"取消后晚到结果不覆盖"。

## 2. Q 版图集切换交叉淡入

**参考实现**：`ref/dsh-pet/dsh-pet/src/client/pet/animation/animation.ts`（A/B 双缓冲）

核心机制：两个 video/canvas 槽位轮换前台；换源不是立即切，而是**后台槽加载到首帧就绪后才交接**，期间前台继续播旧动画（零空白帧）；带**世代号**丢弃迟到的旧加载、blob 生命周期管理、冻结门禁。

**落到我们**：`chibi-renderer.js` 的图集路径目前整帧硬切（walk/dance 四边形路径同样）。最小改法：
- `render()` 保持每帧决策，但场景切换时记录 `pendingScene`，用 2 个 opacity 渐变（0.15s）交叉：旧场景 alpha 1→0、新场景 0→1，各自画一次。
- WebGL 实现提示：两次 drawElements、第二个 uniform opacity（我们的 shader 已有 `uOpacity`，CHIBI-02 刚修过它必须显式设 1 的坑）。
- 验收：motion-preview 里活动切换/摸头/跳舞开始瞬间无跳帧；录屏逐帧看。

## 3. 碎碎念周期参数（VOICE-01 参考）

**参考实现**：`ref/dsh-pet` 的 `eventsRefreshSec.whisper`（默认 300s，每只独立周期、独立文案；手动触发不受开关门控）。

**落到我们**：VOICE-PLAN.md 已规划预生成语音包；抄参数结构——`pack.json` 加 `whisperPeriodSec`（默认 300）+ `whisperLines[]`；主进程定时轮换（像 touches 轮换一样主进程持 index）；**默认低频**，产品原则"有分寸的主动"（参考 Nomi 调研：久未响应自动降频）。

## 4. 素材配方文档化 + CI 转码

**参考**：`ref/dsh-pet/MAKE-YOUR-OWN-PET.md`（2895 行完整可复现文档：提示词配方→绿幕规范→逐秒分解→Safari/HEVC 转码 CI）。

**落到我们**：我们的生成管线能力都在（agnes i2i 一次过、chroma skill、prepare 脚本），但**文档散在 skill 和我的会话里**。DW-08 开源准备时照它写一份 `docs/project/ASSET-PIPELINE.md`（提示词模板+质检数字阈值+派生命令），CI 转码（VP9/HEVC 双格式）可作为发布流水线一部分。

## 5. 对外 API 驱动桌宠（"她是所有 agent 的实体"）

**参考**：`ref/dsh-pet/API.md` + `openapi.yaml`——第三方能让桌宠说话/播动画/读状态，本机回环无鉴权。

**落到我们**：DW-06 完成后的自然扩展——`companion:work` 之外暴露 `POST /say /play /state`（Electron 主进程起 127.0.0.1 端口）。价值：任何本地 agent（Hermes/Codex/GPT）都能借澜的身体说话，这是两个竞品都没有我们的"真人世界"加持的差异化。

## 6. Live2D 工程化（AIRI）

**参考**：`ref/airi-v0.14.1/packages/stage-ui-live2d` + `model-driver-magic-live2d` + `packages/memory-pgvector`（不引入，见下）。

我们的 LIVE2D-POC.md 已验证技术栈可行+26 层 PSD 规格成文。AIRI 的工程化要点：参数驱动的口型（`ParamMouthOpenY` 每帧覆盖 motion）、情绪参数表、模型加载生命周期。**瓶颈仍是分层 PSD 美术（3-5 天工）**，代码参考随时可查，不急。

## 7. 音频仲裁/打断（AIRI，需 WorkBuddy 协调）

**参考**：`ref/airi-v0.14.1/packages/stream-kit`（语音流打断处理）。对应 DW-05 的"聊天/歌曲/读书/桌宠哼唱统一仲裁"——我们哼唱目前是渲染层简单互斥（chibi-hum.js，注释已注明留给 DW-05 收口）。**此项写入权在 WorkBuddy，只移交本参考，不动手**。

## 不抄清单（明确决策）

- AIRI 的 62 包 monorepo 架构——重一个量级，我们单工程+lib 拆分够用（`ARCHITECTURE.md` 现行决策）。
- `memory-pgvector` 向量库——PRODUCT.md 明确"延续 JSON/JSONL，无实际需要不引入新数据库"。
- dsh-pet 的余额动画/DSH 宿主绑定/React 技术栈——场景不通用。
- 任何素材文件。
