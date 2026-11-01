# 2026-10-31 · DW-06 · 工作状态机核心

## 归属

- Codex / 当前聊天（agent:codex-dw06-2026-10-31）；[任务](../TASKS.md)。
- 工作区已有大量未提交改动；`main.js`、`preload.js` 属于进行中的 DW-05，`world.html` 有进行中的 DW-03/04。未覆盖这些文件。
- 本次新增 `MALFOY-ENGINE/lib/work-status.js`、`MALFOY-ENGINE/test/work-status.test.js`；更新 TASKS、STATUS、CHANGELOG 和本记录。

## 完成内容

- 独立实现 thinking / working / result / waiting / success / error 展示状态，任务排队、运行、等待、恢复、成功、失败、超时和取消；中间轮 result、终轮成功及 blocked 的映射有单测。
- 单一活动任务、唯一 ID、终态不可变；取消或超时后及替换任务后的迟到事件被拒绝。快照复制，成功可带产物路径元数据；不声称验证路径或打开文件。
- 未复制参考项目代码或素材。模块未接入现有 Hermes、界面或构建包。

## 验证证据

| 命令 | 结果 | 范围 |
|---|---|---|
| `node --test MALFOY-ENGINE/test/work-status.test.js` | 4/4 通过 | 独立状态机和模拟事件；不证明真实进程终止或 App 交互 |
| `bash scripts/project.sh check` | 见本轮最终运行结果 | 静态工程检查，不验证真实工作或用户界面 |

## 剩余工作与交接

- 接线受文件归属阻塞：须协调 WorkBuddy 释放或共同完成 `main.js` / `preload.js`，并与 `world.html` 当前负责人协调。DW-05 音频仲裁及参考表 #7 不在本任务范围。
- 当前 `hermesChat` 把 stderr 拼成非空文本后以 `!!text` 判断成功，且不依据退出码；接线时需修复失败判断。现有外层超时不终止子进程。需实现进程取消、超时终止、状态广播、等待用户的真实事件来源、进度和安全的产物打开入口；禁止将模型声称完成当作实际文件交付。
- 验收仍需隔离数据下真实本地文件任务、打开产物、失败/取消/超时及迟到结果，跨形态不重复执行；未做打包、原生操作或真实 Hermes 验证。
- STATUS、TASKS、CHANGELOG 已更新；无素材和外部依赖变化。
