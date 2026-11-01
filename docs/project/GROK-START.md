# 复制给 Grok Bot 的接手任务

你接手“澜”macOS 伙伴项目。仓库：
https://github.com/exasdwyh-commits/lan-companion

请先确认你能否实际 clone、运行终端、编辑并提交 PR；若只有文件分析能力，请明确说明，按上传 ZIP 输出补丁，不要声称部署成功。

1. 使用最新 main，确认存在 docs/project/GROK-HANDOFF.md，记录提交 SHA。先读根 AGENTS.md 和该手册，再依次读 README、PRODUCT、ARCHITECTURE、STATUS、TASKS、DEVELOPMENT、ROADMAP-BOARDS。
2. 在新分支 grok/bootstrap 开发。在 TASKS 登记 GROK-BOOTSTRAP-01 的文件归属和验收范围，保留他人改动，先提交简短现状与执行计划，然后继续实施。
3. 首个 PR 做干净 clone 的可复现接手：静态检查、HTTP 小屋预览、模型/动作加载、Electron 依赖与构建入口、服务配置说明、公开版原哼唱缺件提示及测试分层。当前依赖本机 SmartCompanion.app，不能把 npm run dev 或一键打包写成已有能力。缺少 Mac 时完成可做的源码工作，单列原生验收。
4. 保留茉莉小屋和原小游戏、当前混元鲸鱼娘与蒙皮修复、dsh 桌面造型和125个可选动作。小屋是主场景，其次桌面，真人视频暂只修问题。不要重写项目或随意换模型，不要新增第二人格。参考原音未入公开仓库，不能冒充已打包；不要自动下载权重或跑 COVER-03 翻唱。
5. 所有写数据的测试用新的 LAN_DATA_DIR，不复制个人 settings/密钥/聊天/记忆。不直接改 App Resources。浏览器验收只用 Ego Lite/ego-browser。WorkBuddy 的语音批次先协调，不覆盖。
6. 提交 PR，附实际命令、结果、截图或日志及限制，更新项目状态/任务/CHANGELOG与任务记录。先完成可复现闭环，再按路线图完善相册、小说书架、续读与共同创作。
