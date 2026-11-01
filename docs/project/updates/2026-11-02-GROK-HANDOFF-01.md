# GROK-HANDOFF-01 · Grok 接手与部署

日期：2026-11-02。执行：Codex / 01a191bf。

## 请求与交付

用户希望让 Grok Bot 接手，询问 GitHub 或上传，并要求部署文档。推荐可执行 agent 用 GitHub 新分支与 PR；仅聊天客户端则上传公开仓库 ZIP，返回补丁。没有假定特定 Grok 客户端已具备终端/仓库写权限。

- `docs/project/GROK-HANDOFF.md`：产品、代码图、启动、隔离、构建/服务缺口、素材边界、第一 PR 与验收。
- `docs/project/GROK-START.md`：可直接复制的接手任务。
- README/GITHUB 增加入口与最新动作数说明；STATUS/TASKS/CHANGELOG 同步。
- `scripts/github-snapshot.py` 导出规则排除 `shunguai-reference-*` 与 `shunguai-hum.m4a`；原文件及本机原音设置保留，不改业务模块。

## 版本与同步

GitHub API 实查公开仓库 `exasdwyh-commits/lan-companion`，默认 main；接手前 main 为 `a0a1427c2199b7085323e8271bb032f436adc4ac`，明显落后本地。PR #1 仍 open，但其功能与本地修复已被 WorkBuddy 导入，接手者不得再次盲合。

本轮从当前工作树准备新的独立源码快照并同步 GitHub，不把原开发分支历史推到远端，不 force push，不改当前 HEAD/暂存区。精确提交由 GitHub 最新提交和本地 `.build/github-snapshot/commit.json` 记录；扫描清单在同目录 `manifest.json`，不将潜在凭据内容写日志。公开 ZIP 以该快照为准，不打包整个原工作区。

## 检查口径

执行 `project.sh check`、导出凭据扫描、排除规则/原文件保留检查；提交后逐文件核对导出哈希。结果在本任务本地证据目录 `benchmarks/2026-11-02-GROK-HANDOFF-01/`。本轮无业务修改，不重建、不重启 App、不操作个人记忆、不调用模型或麦克风。GitHub 上传结果由远端 SHA 与公开文件查询核对。

当前执行结果：只读检查 **93/93，错误0，待办7**；包含原始引用缺件、Swift旧包与Electron源包不一致等既有/当前状态提示，本轮没有重建包。导出扫描无凭据规则命中；1193个候选文件，约257.7MB（未压缩），三份原参考视频/音轨排除且本机仍存在，两份合成轨和接手文档进入清单。

## 必须随交接保留的限制

- 公开源码不是可独立安装发行包；构建仍依赖 `SmartCompanion.app` 与未完整发布的媒体/外部服务。
- 当前 `package.json` 无通用 dev/build 脚本；不能给出虚构的 npm 一键部署。
- 抖音原音只在本机；公开 clone 选择原音会缺件，应选合成轨并后续完善缺件提示。公开版不能通过本机原片哈希测试，应做测试分层。
- 125动作中含低帧率生成序列。历史专项与视觉证据不代表新机器或原生设备已验收。
- WorkBuddy 的语音真机批次尚有独立边界；禁止自动运行翻唱。
