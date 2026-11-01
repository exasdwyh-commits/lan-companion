# 项目开发约定

更新：2026-10-30，依据用户最新双世界方向及本次统一整理。

## 所有 agent 从这里接手

1. 唯一开发根：`/Users/exasdwyh/Documents/VScode/vidu/desktop-companion`。
2. 唯一交接入口：[docs/project/README.md](docs/project/README.md)。依次读 PRODUCT、ARCHITECTURE、STATUS、TASKS，按任务读 DEVELOPMENT、ASSETS。
3. 在 [TASKS.md](docs/project/TASKS.md) 登记任务、agent/聊天标识、文件归属和验收范围；保留他人修改，不覆盖未知改动。
4. 工程路由见 [project.json](docs/project/project.json)。核对：`bash scripts/project.sh check`。

## 唯一制作方向

- 免费、非营利、拟开源的 macOS 双世界伙伴；当前尚未完成开源发布。
- 同一女主：她的世界为年轻成年、真人写实鲸鱼娘；桌面为蓝发、鳍耳、鲸尾的 Q 版神识。两态共享身份、记忆、关系。
- 真人世界：视频背景、相册、剧情、主动互动；Qwen3-TTS 清冷音色。保持蓝长发、鳍耳、蓝白银服装。
- 桌面：Q 版 2D 小人，聊天、陪伴、读书、唱歌、agent 工作入口；Qwen3-TTS 活泼音色。Q 版参考已在 assets/whale-chibi-reference-2026-10-30/。
- 成长先用稳定人设、可纠正记忆、关系变化实现；首版不以世界模型、实时视频生成或 Live2D 为前提。
- **轮回瓶已撤销**。澜就是“小肥鱼”，修仙界小透明被打回原形后从头开始；苦修或躺平由她自身行动及与用户的互动影响。用户是异界结契伙伴，不是主人；双空间仍保留，转换机制未定。实施蓝图见 [LAN-COMPANION-REBUILD-PLAN.md](docs/project/LAN-COMPANION-REBUILD-PLAN.md)，正式章节仍需用户审定。

## 工程主线

- **后续唯一集成主线：Electron `MALFOY-ENGINE/` → `dist/DeepWhale.app`。** 暂保留旧目录/包名；产品暂称“澜”，包内“深蓝”等名称另行统一。
- 统一命令：`bash scripts/project.sh status|check|build|run`。当前 build 仍调本机母体派生脚本，不是独立分发已完成。
- **Swift `Sources/PetDesk` / `CompanionCore` 是迁移来源和回归基线。** 已有聊天、TTS、视频状态机、相册、图文剧情、歌曲，不能写成“只有播放器”。不要继续给它平行增加双世界产品功能。
- 修复 Swift 回归或提取能力时沿用 PetController / StageView，不另建播放器或复制工程。构建：`bash scripts/project.sh reference-build`。
- `Sources/LingDesk`、其他 App、LiveTalking、云端直播是保留参考或实验，不按主线重写。
- 旧 SHELL-DECISION、整合报告和路线图不能覆盖本文件与 docs/project 的现行决策。

## 素材、数据和依赖

- 真源在 assets/；已有鲸鱼配置为 assets/whale-video-test/{character,pack}.json。Electron 尚未接完整鲸鱼内容包，任务表跟踪迁移，不能写成已完成。
- 不直接改 dist/*.app/Contents/Resources。保留原片，新加工结果新命名；外部素材复制进项目并登记来源，不只引用 Downloads 或临时目录。
- 免费、开源不代替素材授权。代码/素材许可分开记录；Q 版参考不是已授权动画资产包；未核实素材不进入公开发布包。
- 不打印、复制或提交个人 settings.json、密钥、聊天历史、画像、.env；文档不收集真实凭据。
- Electron 数据目录隔离已在 DW-01 接入，使用 `LAN_DATA_DIR` 或 `--data-dir` 明确指定；任何会写数据的自检仍必须在隔离目录执行，绝不直接碰个人记忆。细节以 [DEVELOPMENT.md](docs/project/DEVELOPMENT.md) 为准。
- 保留 .runtime、模型目录和 LiveTalking 相对位置。Swift 的 TTS worker 与 Electron HTTP 服务是不同接口，不能混报就绪状态。
- Git 实查根目录为 desktop-companion/，截至本次无 remote。先看 git status，不声称已推送、已开源或父目录也是仓库。

## 验证与汇总

- 浏览器只用 Ego Lite / ego-browser，不用旧 CDP 或其他 Chromium 渲染脚本替代。
- 默认跑 `bash scripts/project.sh check`（只读）。按 DEVELOPMENT.md 追加影响范围内验证。
- 修改 Swift 播放器/状态机必须跑 check-whale-modes.sh，输出到本任务新目录，不覆盖历史证据。
- 现有 verify-integration.sh 会读写真实记忆、重启进程并调用非 Ego 渲染器；隔离与验收改造前不作为默认测试运行。
- 每次完成更新 STATUS、TASKS，在 docs/project/updates/ 写改动/证据/限制，追加 CHANGELOG 索引。新开发方案集中 docs/project/，不再散落“最终版”“唯一主线”。
- 区分源码存在、素材存在、已打包、入口可用、真实服务实测与视觉验收；历史 PASS、fixture、静态检查不等于当前全链路成功。
