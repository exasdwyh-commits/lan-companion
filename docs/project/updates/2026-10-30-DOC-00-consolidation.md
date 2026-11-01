# 2026-10-30 · DOC-00 · 工程与文档统一

## 归属

- 负责人：Codex / 当前项目整理聊天。
- 任务：[DOC-00](../TASKS.md)。
- 开始状态：desktop-companion 的本地 Git 工作树干净，main，无 remote；未发现已登记的其他文件负责人。
- 文件范围：工作区 AGENTS/README、app README/历史文档标记、docs/project 与文档快照、两份素材说明、Q 版附件参考、scripts/project.sh / project_audit.py、.gitignore 说明注释（忽略规则未变）。
- 未变更：Electron/Swift 业务源码、内容配置、既有视频/音频、模型、构建器与 dist 产物。

## 完成内容

1. 按双世界需求统一到现有 Electron 工程；Swift 的视频、相册、剧情、歌曲、聊天与 TTS 均保留，不再误写成没有实现。
2. 建立产品/架构/状态/素材/开发/任务/历史/总索引及交付模板；根入口统一指向该目录。
3. 将任务拆成数据隔离、共享身份、内容迁移、Q 版动作、音频阅读、agent 工作、成长和发布，明确顺序、文件领取与验收。
4. 原有 26 份文档留快照；旧说明保留内容并标明历史，两个 docs 旧入口跳转。修正相册、剧情、TTS 和 Git 过期说明。
5. 用户 Q 版附件复制进 assets 并登记来源；没有宣称动作集或再分发授权已完成。
6. 新增工程路由与统一命令；静态检查不接触个人设置/记忆、不启动模型、不用旧浏览器渲染脚本。

复用来源：原 MALFOY-ENGINE 双世界、Swift PetDesk/CompanionCore、现有鲸鱼内容包、原素材制作与 benchmarks。原件位置不变，集中入口与事实。

## 验证证据

| 命令 / 操作 | 结果与证据 | 边界 |
|---|---|---|
| bash scripts/project.sh status | [盘点快照](../reports/inventory-2026-10-30.json) | 20 图/1 章/6 镜头/2 首；不证明 Electron 已迁入 |
| bash scripts/project.sh check | 63/63 通过，[检查输出](../reports/project-check-2026-10-30.txt) | 工程路由、引用、当前文档、快照及静态语法；6 条待办提示仍保留 |
| project_audit --route primary.app / primary.buildScript / reference.buildScript | 返回现有工程绝对路径 | 未执行构建或启动 |
| project.sh 未知命令、audit 未知路由 | 非零退出，不启动任何应用 | 只验证命令错误处理 |
| 素材/包 SHA-256、快照 SHA-256 | Swift 29/29、Electron 4/4、原文档 26/26 一致；逐项看快照 | 字节一致不等于视觉/听感通过 |
| git diff --check、变更路径复核 | 见检查输出及本记录文件范围 | 父目录 AGENTS/README 不在 app Git 根内；无提交/远程同步 |

## 剩余工作与交接

- 本轮没有迁移业务功能。Electron 当前页面仍缺完整鲸鱼相册、剧情、歌曲与视频状态链。
- 已知相册 v2/v3 输入缺失，运行仍 20/26；音色/模型、窗口和视觉本轮未重验。
- 先从 DW-01 开始；在个人数据隔离完成前不跑真实聊天/记忆自动回归。
- STATUS、TASKS、CHANGELOG 已更新；后续交付继续追加本目录，不另写散落的“最终整合版”。
