# 2026-10-30 工程统一报告

## 结论

后续统一制作“一个女主、两个世界、一份记忆”的 macOS 桌面伙伴。保留现有 Electron 双世界窗口作为集成主线，保留 Swift PetDesk 的已完成能力作为迁移来源与回归基线。唯一工作目录不变，现有代码、原片、模型和历史证据不移动，不重建第三套工程。

本次完成工程组织、文档和检查入口；没有修改业务源码、重建 App 或声称运行能力全部迁移。

## 混乱的实际来源

| 原问题 | 实查 | 本次处理 |
|---|---|---|
| 多份文档各称唯一主线 | 根约定称 Swift，SHELL-DECISION 称 Electron | 根 AGENTS / 两级 README / project.json 统一路由；旧文档标历史或跳转 |
| 做好的功能被报缺失 | Swift 内容包已有 20 图、1 章/6 静帧剧情、2 首歌 | STATUS 按 Electron/Swift/入口与证据分列，迁移进入 DW-03/05 |
| 旧页面实现被当当前入口 | Electron 活跃窗口加载 world.html，旧 index/app.js 面板未接回 | 架构标注当前页面，任务验收要求从真实主入口访问 |
| 素材数量和版本混写 | originals 26、v2 14、v3 6；运行包 20 | 列出制作清单缺图与导入预检，保留 26 张目标 |
| 记忆/TTS 判断冲突 | 两边都有聊天/TTS；Electron 主路有持久记忆，fallback 未统一 | 分别记录接口、上下文/持久层与限制，排数据隔离和共享状态任务 |
| 旧自检会影响真实资料 | verify-integration 写真实记忆、读历史、重启，并用旧渲染工具 | 不执行；新增只读工程检查，DW-01 负责隔离回归入口 |
| “无 Git”过期 | app 目录已有 main，本轮开始干净，无 remote | 文档纠正；未提交、未推送或公开发布 |
| 成果散落、无法追溯 | 根目录专题文档与 benchmarks 多批结果 | 项目中心 + ARCHIVE 索引 + 统一 TASKS/updates/CHANGELOG |

## 交付位置

- [统一项目中心](../README.md)：产品、架构、现状、开发、素材、任务、历史与交付总索引。
- [本次交付记录](../updates/2026-10-30-DOC-00-consolidation.md)：负责范围、复用内容与后续交接。
- [盘点 JSON](inventory-2026-10-30.json)：源与包的逐文件一致性、相册缺图、路由与静态检查。
- [检查输出](project-check-2026-10-30.txt)：实际执行结果；warnings 是已知产品缺口，不能作为全功能通过。
- [整理前 26 份文档快照](../../legacy/2026-10-30-before-unification/INDEX.md)：原路径与 SHA-256 可追溯。
- [Q 版参考](../../../assets/whale-chibi-reference-2026-10-30/README.md)：用户两张附件已复制进项目，登记来源与用途。
- [工程命令](../../../scripts/project.sh) 与 [只读盘点器](../../../scripts/project_audit.py)：统一 status/check/build/run/reference-build；不复制播放器。

## 验证范围

本次只运行只读盘点、静态检查、路由/错误处理检查与差异检查。63/63 项通过，保留 6 条产品待办提示；覆盖当前文档链接、必需工程路径、JS/内联脚本/Shell/Python 语法、配置引用完整性、快照哈希。Swift 素材包 29/29 必需文件一致；Electron 4/4 核心文件一致。

真实窗口、模型、TTS 听感、视觉观感、麦克风权限和跨机器分发未在本次重验；没有运行会读写真实记忆的旧集成自检。更多原始结果属于历史证据，边界见 STATUS。

## 下一步

先领取 DW-01，落实 Electron 显式数据目录与服务配置；随后 DW-02 统一身份/会话，DW-03 迁移已完成的鲸鱼内容。每位 agent 在 TASKS 登记归属，完成写 updates，并追加 CHANGELOG，统一入口不再分叉。
