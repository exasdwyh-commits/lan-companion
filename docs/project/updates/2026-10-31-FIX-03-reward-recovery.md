# FIX-03 · R2 通关奖励可恢复，恰好结算一次

- 日期：2026-10-31
- 负责人：Hermes 002 / 本聊天（agent:hermes-002-2026-10-31）
- 缺陷（FIX-01 注入复现）：`gallery.finish` 先持久化 rewarded，适配器再写 affection；第二步失败后重试 `reward=0`，10 分永久丢失。

## 结算协议（收据 + 幂等入账）

1. **gallery 状态 v2**（`lib/gallery.js`）：新增 `receipts{chapterId:{reward,state:"pending"|"granted"}}`；`finish` 在同一次原子写入里落 pending 收据并返回 `receiptId`；新增 `pendingReceipts()` / `settle()`。v1 数据读入即迁移——历史 rewarded 一律记 granted，**不补发旧奖励**。
2. **好感收据入账**（`lib/affection.js`）：状态新增 `receipts[]`（旧文件缺省兼容）；新 `grant(receiptId, amount)` 把**分数与收据 ID 在同一次原子写入**提交，重放命中收据即 no-op（幂等）。
3. **补结算**（`lib/content-pages.js`）：`settlePending()` 在创建时与每次 `action()` 开头把 pending 收据补进好感并确认；任一步失败留 pending，下次/重启继续，不丢奖励、不重复加。`complete` 改用 grant+settle，不再裸 `set(value+reward)`。

## 验证证据（`MALFOY-ENGINE/test/gallery-reward.test.js`，7/7）

| 场景 | 结果 |
|---|---|
| 正常通关+重看 | 入账一次；重看 reward=0 不加 |
| 崩溃窗口一（gallery 落收据后 affection 写失败）| 重启补齐 `before+REWARD`，再重启不加 |
| 崩溃窗口二（affection 入账后 settle 落盘失败）| 重启重放幂等，不重复加 |
| 好感封顶 | 只补到 max，收据记 granted，重启不加 |
| v1 迁移 | 历史奖励不补发；旧章节重看 reward=0 |
| gallery 写失败 | finish 抛错无半状态；恢复后重试成功 |
| 落盘格式 | gallery.json v2 + receipts；affection.json receipts 含章节 ID |

故障注入方式：按文件名定向让 `fs.writeFileSync` 失败（可设成功次数阈值），真实 tmp 目录、真实 pack。

## 边界与限制

- **未重建包**：并行会话（用户指派 GPT）19:34 起正在改 `world-video.js`，其 6 项 world-video 测试当前红（中间态）。为避免把他人半成品打进 `dist/`，本轮只交付源码+测试；下一次统一构建（工作树稳定后）自然带入本修复。
- 全量回归：除上述 6 项他人区域失败外全部通过（本任务相关 306-6=300 中 300 绿，含新增 7 项）。
- 未引入新数据库；touch/chat 等日常好感路径维持原逻辑（本协议只覆盖章节奖励）。
