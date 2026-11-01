# HERMES-01 · 相册/剧情接入与记忆管理（任务领取）

日期：2026-10-31；负责人：Hermes 002 / 本聊天（agent:hermes-002-2026-10-31）。
用户要求：今晚修好，连续工作，可并行子 agent，前提是不破坏现有功能。

## 与 WorkBuddy 的协调（重要）

- WorkBuddy 正在执行 DW-05（agent:workbuddy-chat-2026-10-31），近 20 分钟内仍在写
  `MALFOY-ENGINE/main.js`、`lib/{narration,voice-script,companion-media}.js`、
  `web/live2d/composer.*`、`docs/project/{STATUS,TASKS,CHANGELOG}.md`。
- 本任务**不修改**上述文件，直到 WorkBuddy 空闲（文件 mtime 稳定且无新写入）。
- 按 WORKBUDDY-HANDOFF 的分工，DW-03 原本排在 DW-05 之后由 WorkBuddy 领取；
  本轮由 Hermes 先行实现，**WorkBuddy 不再重复领取 DW-03**，避免双写。
- 本任务的接线（main.js / preload.js / world.html）在 WorkBuddy 空闲后一次性应用，
  并在应用前重新比对 sha256，确认期间无人改动。

## 文件归属

| 文件 | 归属 |
|---|---|
| `MALFOY-ENGINE/lib/gallery.js`、`test/gallery.test.js` | Hermes（新建） |
| `MALFOY-ENGINE/web/live2d/gallery.{html,js,css}` | Hermes（新建） |
| `MALFOY-ENGINE/lib/memory-admin.js`、`test/memory-admin.test.js` | Hermes（新建） |
| `MALFOY-ENGINE/web/live2d/memory.{html,js,css}` | Hermes（新建） |
| `main.js` / `preload.js` / `world.html` | Hermes 在 WorkBuddy 空闲后接线 |
| DW-05 相关文件与 `composer.*` | WorkBuddy，禁改 |

## 范围

1. 相册：pack 已登记的 20 张，按 `unlockAt` 解锁；灯箱、保存到本地、最后一排可达。
2. 剧情：「潮汐初遇」1 章、6 段静帧、A/B 分支、+10 奖励幂等。
3. 记忆管理：查看、搜索、纠正、删除、清空（带备份与二次确认）。
4. 文档：修正 STATUS 中「读书未发现阅读器」的过期结论；补 CHANGELOG/TASKS。

## 不做

- 不补齐 26 张相册、不新增「轮回瓶」剧情。
- 不改 `dist/*.app`、不重写播放器、不动 Swift 工程。
- 不实现 DW-06 工作进度、DW-07 完整成长（记忆管理只是 DW-07 的第一步）。

## 验收

- 新增逻辑单测全绿；既有 123 项测试不新增失败（基线 121/123，2 项为 narration 既有红）。
- `bash scripts/project.sh check` 无新增错误。
- 隔离数据目录（`LAN_DATA_DIR=$(mktemp -d)`）启动 App 冒烟：窗口能开、相册/记忆页能加载。
- 原生视觉与真实试听由用户验收，不把技术检查写成已完成。
