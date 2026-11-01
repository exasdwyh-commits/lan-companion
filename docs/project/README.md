# 统一项目中心

更新：2026-10-31。所有开发 agent 从这里开始。

当前执行交接：[WorkBuddy 接手单](WORKBUDDY-HANDOFF.md)。用户要求将 DW-05 实现收尾、真实翻唱和导入测试交给 WorkBuddy；已有代码和卡点在单内，接手时登记任务归属。

公开源码快照与后续同步：[GitHub说明](GITHUB.md)。当前没有独立安装包发行，软件与素材继续分别遵守原有许可。

## 当前决定

**一个共创型伙伴、三个板块、一份可纠正的记忆（2026-11-01 定版）。** ① 茉莉小屋为主场景（当前主线）→ ② 桌面 Q 版为二阶段模块 → ③ 真人视频（旧马尔福线）为三阶段；三板块同一身份，具体转换叙事尚待定。首版先做免费、非营利版本，拟开源；现阶段重点验收真正可读的本地书与双空间切换，后续让共同创作进入剧情与小屋。实时真人互动是未来第三模式候选，非首版依赖；详见 [产品决定](PRODUCT.md) 与 [整体改造方案](LAN-COMPANION-REBUILD-PLAN.md)。

唯一开发根：`/Users/exasdwyh/Documents/VScode/vidu/desktop-companion`。
后续集成主线：`MALFOY-ENGINE/` → `dist/DeepWhale.app`。Swift `PetDesk` 保留完整成果，逐项迁入，不新建第三套工程。

本次统一的是方向、工程入口和交接；完整运行产品尚在整合中，不能把文档整理视为所有功能迁移完成。

## Grok 接手

- [接手与部署手册](GROK-HANDOFF.md)：GitHub/ZIP、网页预览、原生构建、外部依赖与下一步任务。
- [可复制给 Grok 的任务](GROK-START.md)：直接复制全文，要求新分支与 PR。

## 阅读顺序

场景开发决定（2026-11-01）：[完整复用茉莉的小房间](updates/2026-11-01-WORLD-MOLI-05-reuse.md)，含四款电视小游戏和生活系统。源码入口 `MALFOY-ENGINE/web/moli-room/`；当前真实混元鲸鱼娘已接连续蒙皮与动作，RIG-15/16/17 续修接地/贴床/被子；小屋已通过 `lanroom://` 接进 App，LAN-08 加入相册/读书/聊天。本次源包核对 180/180 一致，真机声音与加照片对话框仍待验，详见[最新同步](updates/2026-11-01-WORLD-RIG-14-skin-and-app-sync.md)与[功能接入](updates/2026-11-01-WORLD-LAN-08-house-companion.md)。此前程序造型撤回见[纠正记录](updates/2026-11-01-WORLD-LAN-07-model-correction.md)。原[潮汐居规划](WORLD-SCENE-PLAN.md)仅作主题改造参考。

| 顺序 | 文档 | 回答的问题 |
|---|---|---|
| 0 | [AGENTS.md](../../../AGENTS.md) | 所有 agent 的规则 |
| 1 | [PRODUCT.md](PRODUCT.md) | 产品、双形态、身份、首版范围 |
| 2 | [ARCHITECTURE.md](ARCHITECTURE.md) | 主线选择、代码位置、迁移边界 |
| 3 | [STATUS.md](STATUS.md) | 已有成果、待整合项、证据与限制 |
| 4 | [TASKS.md](TASKS.md) | 任务顺序、归属、验收 |
| 改造总图 | [LAN-COMPANION-REBUILD-PLAN.md](LAN-COMPANION-REBUILD-PLAN.md) | 现状缺口、角色/事件/故事契约、分期、文件归属与验收闸门 |
| 功能路线图 | [ROADMAP-BOARDS.md](ROADMAP-BOARDS.md) | 三板块 H1/H2/H3 功能优先级、验收与分工建议 |
| 按需 | [DEVELOPMENT.md](DEVELOPMENT.md) | 启动、检查、隔离与交接 |
| 按需 | [ASSETS.md](ASSETS.md) | 视频、相册、Q 版、语音与来源 |
| BMAD 工作流 | [BMAD.md](BMAD.md) | 官方稳定版安装、Codex/CodeBuddy 配置、需求到实现与测试示例 |
| 修复升级 | [REPAIR-PLAN.md](REPAIR-PLAN.md) |
| 竞品集成 | [INTEGRATION-REF.md](INTEGRATION-REF.md) | dsh-pet/AIRI 优秀能力的集成工作单（给执行 agent） 当前源码差距复核、剧情交互修复、奖励恢复与内容一致性优先级 |
| 语音互动 | [VOICE-PLAN.md](VOICE-PLAN.md) | 预生成互动语音、本地控制与连续聊天；源码核查和实施规划，尚未实现 |
| Q 版 B 方向优化 | [CHIBI-OPTIMIZATION.md](CHIBI-OPTIMIZATION.md) | 用户已选 B；舞蹈串格修复、两段实看参考、Live2D 与真人哼唱实施顺序 |
| Q 版动作 | [CHIBI-MOTION.md](CHIBI-MOTION.md) | 情境表情/姿态/道具、独立五官、边框与世界过渡、业务接口 |
| 历史视频提案 | [VIDEO-PLAN.md](VIDEO-PLAN.md) | 已撤销的轮回瓶分镜，仅供追溯；勿按它制作新剧情 |
| 收尾 | [CHANGELOG.md](CHANGELOG.md) | 所有 agent 的交付总索引 |
| 独立素材生成工具 | [H3 Video Studio](../../tools/h3-video-studio/README.md) | 使用 h3.c 的本地视频生成界面，不并入 Electron 主线 |
| 查历史 | [ARCHIVE.md](ARCHIVE.md) | 历史报告、研究、生成记录 |

机器可读工程路由：[project.json](project.json)。它不取代人物或内容配置。

## 十分钟接手

```bash
cd /Users/exasdwyh/Documents/VScode/vidu/desktop-companion
git status --short
bash scripts/project.sh status
bash scripts/project.sh check
```

领取任务时写 agent/聊天标识、负责文件与验收标准；遇到未知改动先协调，不覆盖。旧报告的“全部通过”只对原任务有效。

## 成果集中规则

| 成果 | 归属 |
|---|---|
| 新开发文档、方案 | 本目录，并从此页链接 |
| 任务领取、进度与依赖 | [TASKS.md](TASKS.md) |
| 每个 agent 的交付总结 | `updates/YYYY-MM-DD-任务ID-短名.md`，用 [模板](updates/TEMPLATE.md) |
| 交付总索引 | [CHANGELOG.md](CHANGELOG.md) |
| 验证证据 | `benchmarks/YYYY-MM-DD-任务ID/`，交付记录中链接 |
| 本次整理证据 | [整合报告](reports/2026-10-30-consolidation.md) 与 [盘点快照](reports/inventory-2026-10-30.json) |
| 素材原件与成品 | `assets/`；不为汇报重复复制大素材 |
| 应用输出 | `dist/`，只由构建生成 |

集中的是入口与事实；原代码、素材和证据保留原路径，避免破坏依赖。

## 给下一位 agent 的任务开头

> 在 `/Users/exasdwyh/Documents/VScode/vidu/desktop-companion` 开发“澜”双世界伙伴。先读 `../AGENTS.md`、`docs/project/README.md`，依次核对 PRODUCT、ARCHITECTURE、STATUS、TASKS。以 Electron 双世界为集成主线，复用 Swift 的视频/相册/剧情/唱歌，不另开平行工程。登记任务和文件归属，保留他人修改。结果写入 docs/project/updates，更新任务、状态和 CHANGELOG，提供当前验证证据。
