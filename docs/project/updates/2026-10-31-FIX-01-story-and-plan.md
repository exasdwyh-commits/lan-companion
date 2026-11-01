# 2026-10-31 · FIX-01 · 剧情交互修复与升级规划

## 归属

- 负责人：Codex / BMAD 安装与修复聊天。
- 任务：[TASKS FIX-01](../TASKS.md)。用户授权“继续修复或者整理一份修复规划”。
- 起始工作树有 BMAD、Hermes 相册/视频、WorkBuddy 音频/读书、Q 版等大量修改；本轮保留，未提交混合工作树。
- 负责：`MALFOY-ENGINE/web/live2d/gallery.js`、`Tests/gallery-interaction.test.cjs`、[REPAIR-PLAN](../REPAIR-PLAN.md)、当前项目文档及本记录。本轮未修改 main/preload、内容源包、音频业务或 dist，未重启现有 App。

## 完成内容

1. 修复剧情开始后“继续”、进入 A/B 后选择按钮、选择后“继续”可能持续 disabled 的问题。请求结束统一恢复控制，失败可重试，请求中阻止关闭与重复操作。
2. 修复选择分支后前端比后端多推进一幕；只在 advance 时递增，后续还有普通幕时不提前结算。
3. 接受后端 chapter.done，通关后明确显示“已看完 / 重看”，沿用整章重看与首次奖励规则。
4. 新增真实 renderer 脚本接真实 content-pages/gallery/affection 的隔离交互回归。DOM 为替身，不伪装浏览器/原生验收。
5. 逐项复核用户原差距清单：点击台词、称呼广播、视频锚点/尾淡出已有实现；常驻 HUD、片段历史、夜间时钟、随机真人动作、环境音等仍有缺口。完整优先级、文件边界、依赖和验收写入修复规划。
6. 修正文档“相册/剧情仍未接入”“音频仲裁未实现”等旧描述；保留历史报告及其他聊天的交付结论。

## 验证证据

| 命令 / 操作 | 结果 | 证据 | 边界 |
|---|---|---|---|
| 修复前 `node --test Tests/gallery-interaction.test.cjs` | 0/6 通过，首个断言复现开始后按钮未恢复，后续交互随之阻塞 | [before.tap](../../../benchmarks/2026-10-31-FIX-01/before.tap) | 真实页面脚本，DOM 替身 |
| 修复后同命令 | 6/6 通过 | [after.tap](../../../benchmarks/2026-10-31-FIX-01/after.tap) | A/B、重看幂等、分支后续幕、失败重试、防连点；不证明渲染观感 |
| 关联 gallery/content-pages/affection/world-video 回归，共 5 个文件 | 最新 40/42 通过；两处失败是 gallery/content-pages 测试仍断言 20 张，实际 26 张 | [regression.tap](../../../benchmarks/2026-10-31-FIX-01/regression.tap) | 保留红灯，未覆盖其他聊天内容契约；详见 R1 |
| 注入通关第二步关系存储失败，然后重试 | **确认未修缺陷**：chapterDone=true、retryReward=0、好感仍 3，预期 13 | [reward-recovery.json](../../../benchmarks/2026-10-31-FIX-01/reward-recovery.json) | 仅临时数据与故障注入，无个人数据损失结论；列入 R2 |
| 源/运行派生/现有包的 pack 读取 | 初查 26/20/20；收尾并行更新为 26/26/26 | [content-snapshot.json](../../../benchmarks/2026-10-31-FIX-01/content-snapshot.json) | 最后保存的是 26/26/26 快照，数量不代替 ID/规格/哈希验收 |
| 剧情 renderer 源/包 SHA-256 比对 | 字节不同 | [renderer-package.json](../../../benchmarks/2026-10-31-FIX-01/renderer-package.json) | 不假定其他聊天打包覆盖了本次全部修改 |
| `bash scripts/project.sh check` | 88/88，0 错误、6 项待办提示 | [project-check.txt](../../../benchmarks/2026-10-31-FIX-01/project-check.txt) | 不代替全部 Node 回归或原生交互 |

## 剩余工作与交接

- **本聊天未重建 App**：其他聊天并行更新过内容包，收尾比对确认最新剧情源码与包的字节仍不同，不能标为已完整纳入。由内容负责人收口 R1 测试/一致性，再统一构建并做隔离原生 A/B/保存/重看验收。
- 优先 R1 内容一致性、R2 奖励失败恢复、R3 内容页实时刷新，然后 R4 关系 HUD、R5 倒计时与配置奖励、R6 片段回看。R2 的奖励格式迁移需单独设计，不临时改失败断言掩盖。
- 无新素材/新个人数据依赖。本轮不声称完成真实服务、听感或视觉验收。
- STATUS、TASKS、CHANGELOG 已更新；入口在项目 README 的“修复升级”。
