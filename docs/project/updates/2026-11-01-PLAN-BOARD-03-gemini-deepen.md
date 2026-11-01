# PLAN-BOARD-03 Gemini 工程深化并入改造方案

- 日期：2026-11-01
- 负责人：Hermes 002 / 本聊天
- 范围：`docs/project/LAN-COMPANION-REBUILD-PLAN.md` 整体升级 + 本记录 + CHANGELOG；未改运行代码。合并前原版备份于 `/tmp/lan-plan-before-gemini.md`（会话内），diff 基准 60 行新增 / 25 行改写。

## 来源

用户提供 Gemini 重写的方案全文（来源文件 `~/Downloads/code_artifact.md`，本机路径非仓库链接；含 PLAN-BOARD-02 的全部内容并工程化展开）。

## Gemini 新增并已采纳

| 机制 | 内容 | 落点 |
|---|---|---|
| 状态数值与冷却硬约束 | `energy 0..100`、`mood: focused/idle/tired/inspired`、`cooldowns: {actionType→unlock_time}`；拒绝后默认 4h 冷却或本会话不再发起 | §4.1 |
| 桌面非侵入轻确认 | 透明桌面禁模态/禁抢焦点（`setIgnoreMouseEvents(true,{forward:true})`），微气泡 3 分钟无响应自动转为"独处备忘"，下次主动打开面板再自然提起；免打扰/会议麦/全屏自动挂起 | §4.2 |
| 软失效（Tombstone）撤销 | 事件加 `invalidatedBy`；`undo` 追加 `event.retracted` 补偿事件；衍生品级联软失效，首版只支持最近正典节点与独立挂载物，不做全图重算 | §4.3 |
| 上下文编译器与输出校验 | 所有 LLM 入口过统一纯函数编译器：System（规则卡+角色卡）/State（只注入 observed 且未失效事件，硬滤 simulated/proposal/undone）/Workspace（按需注入书页片段或草稿段）；故事导演结构化输出必须带 `referencedEventIds`，代码校验存在且未失效，捏造即拦截降级 | §4.4 |
| 视图世代号 + 音频租约 | 渲染层无状态（Dumb Views）；`viewGenerationId` 单调递增，旧世代异步响应一律丢弃；全局单一音频租约，优先级 唤醒/打断>对话>共读TTS>唱歌环境音，抢占时 `pauseAndSaveOffset` 断点续播 | §4.5 |
| P1-0 契约冻结切片 | 先冻结 Event/Snapshot/Proposal/ContentPack/viewGenerationId/AudioLease 的 JSON Schema，各 agent 基于 Mock 并行单测，之后才许碰 main.js | §5 |

## 合并时的修正（非原文照搬）

1. **补回被改写丢掉的两句纪律**：LLM 不得任意调 shell/改 pack/访问真实用户目录（§4.3 LLM 边界）；数据保留/派生摘要处理 + 隔离目录迁移演练再接真实数据（§4.3 事实与迁移纪律）。
2. **`viewGenerationId` 注记与现有 `AUDIO_EPOCH` 同型**：代码里 stopVoice 的 `AUDIO_EPOCH++` 已是同机制实践，接线时统一命名，不是从零发明。
3. 修订史写入文件头，PLAN-LAN-01 → BOARD-02 → BOARD-03 链路可追溯。

## 评估结论

- Gemini 版是 PLAN-BOARD-02 的超集（核心价值、两原则、PILOT-REUNION-01 全保留），六项新增均为可直接实施的机制设计，与三板块架构和现有代码实践（AUDIO_EPOCH、收据幂等）方向一致，**全部采纳**。
- 数值默认（4h 冷却、3 分钟气泡、5–15 分钟 tick、energy 0..100）标注为待真机调参的初值，不写死为产品承诺。
- `energy/mood` 仅作内部状态与行为选择输入，不做成用户可见数值面板，防止滑向刷数值玩法（PRODUCT「简单成长」既有边界）。
