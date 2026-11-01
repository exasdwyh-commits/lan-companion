# BMAD-01：官方稳定版安装、双工具配置与实现演示

日期：2026-10-31。负责人：Codex / 本聊天。

## 改动

- 阅读官方 README、稳定分支与 release，并核对 npm 安装器和技能实现；安装 `bmad-method@6.12.4` 的 core+bmm，关闭旧 shims。
- Codex `.agents/skills`、CodeBuddy `.codebuddy/skills` 各 29 个技能。安装过程中检测到另一写入方切换到 CodeBuddy；经用户明确回复，使用官方安装器同时配置两个工具，保留原有 custom 和个人回答。
- `_bmad/custom` 固定中文输出，为 Build 加入既有项目文档和交付约定。个人 TOML 与渲染缓存排除入库。
- 新增 [使用说明](../BMAD.md)、只读检查器与 wrapper，保留 BMAD 原始 MIT 许可；未修改产品业务或应用包。

## 需求 → 代码 → 测试演示

本次实际调用官方 Build 入口的渲染器，读取渲染后的工作流与 clarify/plan/oneshot 步骤；[spec](../bmad/implementation-artifacts/spec-bmad-01-installation-check.md) 明确目标及 Given/When/Then 验收。实现 `scripts/bmad.sh`、`scripts/check-bmad.py`，再以 `Tests/test_bmad_setup.py` 验证。

选择 oneshot 的原因：目标单一、变更小且可逆、无需要用户补充的需求差异。保留已有脏工作区是上级项目规则，本次只处理登记范围；未执行官方工作流默认的混合工作区提交步骤。没有伪造完整产品 PRD、架构评审或 sprint 完成状态。

## 验证证据

证据目录：[benchmarks/2026-10-31-BMAD-01](../../../benchmarks/2026-10-31-BMAD-01/)。

| 命令 / 检查 | 结果 |
|---|---|
| 官方安装器 `6.12.4 --modules bmm --tools codex,codebuddy --no-shims` | core+bmm 安装完成，29+29 技能；custom 保留 |
| 官方 `tools/validate_skills.py` 的 `validate_skill` 检查每个已安装技能 | Codex 29、CodeBuddy 29，发现项均为 0；见 official-skill-validation.json |
| `uv run --no-cache _bmad/scripts/render_skill.py ... --skill .../bmad-build` | 成功生成工作流快照，中文与项目 persistent facts 已解析 |
| `bash scripts/bmad.sh check --json`（从项目外调用也通过） | 固定版本、技能、语言与路径检查通过；见 check.json |
| `bash scripts/bmad.sh test`（从 /private/tmp 调用） | 15/15 隔离回归通过；见 tests.log |
| `bash scripts/bmad.sh config` | 官方四层合并成功；证据仅保留非敏感路径及语言字段 |
| `bash -n scripts/bmad.sh` | 通过 |
| `bash scripts/project.sh check` | 88/88，错误 0，现有待办 7；见 project-check.log |

独立代码审查发现并修正 4 项：补 CodeBuddy 登记与文件检查；限定 `ides` 字段，防止其他字段误认；用标准 YAML 解析接受合法带引号版本；解析 frontmatter 并拒绝空描述和损坏引号。相应新增 6 项回归，全部通过；审查逐项记录在 spec 中。

独立复查确认原 4 项已消除，并再次从 `/private/tmp` 运行 15/15 PASS；本聊天无未处理审查项。

依赖使用固定 PyYAML 6.0.3（safe_load），Python 3.12 与依赖缓存均在项目工具入口明确配置。联网下载超时后，从本机既有同版本分发缓存准备项目缓存，随后正常 check/test 均在离线模式通过。新机器和清除 `.build` 后的准备命令见使用说明。

## 边界

- 结构校验与代表性工作流实做不证明所有 29 个技能都已完整运行一遍。
- 重启 Codex，并从 `desktop-companion` 开启新会话刷新技能发现；当前会话不声称热加载成功。
- 本次未运行客户端、真实 LLM/TTS 或浏览器，没有读写真实用户记忆；未构建/重启 App，也未提交或推送。
- 工程检查中的素材、源码/包差异及听感待验继续由现有任务跟踪，本次不把它们标成已完成。

## 同日 WorkBuddy 的功能演示（独立归属）

共享 TASKS/STATUS/CHANGELOG 在本聊天执行期间收到 WorkBuddy 的同任务补充。保留其记录与代码：

- [读书按章跳转 PRD](../bmad/planning-artifacts/prds/prd-desktop-companion-2026-10-31/prd.md)
- [功能 spec、实现文件清单与盲审处理](../bmad/implementation-artifacts/spec-read-chapter-jump.md)

WorkBuddy 在上述 spec 与共享状态中记录了 PRD → 实现 → 审查的功能闭环及 174 项测试、包校验结果，并接入 `.workbuddy/skills` 软链。本聊天已读取这些产物确认存在；没有重跑该功能的全部测试或复验其签名、视觉。本文的 15 项安装工具回归和官方 29+29 技能校验是本聊天直接验证的独立结果，不混报为同一测试总数。

## 后续修补（WorkBuddy，同日 12:25 起）

在上面 174 项的基础上继续修，测试 **174 → 181**，`check` 88/88，产物 28/28 + 签名通过。

### 修掉的两条「断言滞后」

相册从 20 张迁到 26 张后，两条断言仍写死 20，看起来像实现坏了：

- `gallery.test.js` / `content-pages.test.js` 的 `album.length === 20`、`unlocked === 4`
  → 改为**与 `pack.json` 自洽**（`pack.album.length`、`unlockAt===0` 的条数）。
  先确认过 26 个条目对应文件**全部存在、零缺失**，才判定是断言该改而不是数据有错。
  「pack 该有多少张」由素材检查守卫，不在功能测试里写死。
- `album[0]` 的字段断言原为「精确等于固定字段列表」，实现新增 `title` 后就红
  → 改为「必需字段都存在」，缺字段仍报错，合理新增不再误伤。

### 真实排版压测后补的识别

构造数据全绿之后，用真实小说排版压了一遍，发现**最常用的几种写法全漏**：

| 写法 | 压测前 | 压测后 |
|---|---|---|
| `卷一　风起`（多卷本不带「第」） | ✗ | ✓ |
| `楔子` / `序章` / `尾声` / `终章` | ✗ | ✓ |
| `Part I` / `Interlude` | ✗ | ✓ |

同时确认没有扩大误判面：「卷子发下来了」「序列号是三」「序」「章」单字仍被拒绝。
全角空格、段首缩进、楔子段归属 `-1` 都已验证，固化为 15 项应识别 + 11 项应拒绝。

### 清洗链路验证

`read-ebook.py` 会剥目录行、页眉、页码，担心它把章节标题一起删掉。实测：
带 `第一章 归港 ........ 1` 的目录行**被正确删除**，正文里的 `第一章 归港` **完整保留**，
缩进被 trim，章节识别在清洗后的文本上照常工作。
已知残留：单页页码（单独一行 `15`）不删 —— 既有策略要求至少 2 行纯数字才判定为页码噪音，
是为避免误删正文里的数字行，权衡后不动。

### 仍然没做的

- 窗口内目录的实际视觉（没有本地 Electron，只能做 DOM id 交叉检查，24 个引用 id 全部对得上）。
- 真实长篇电子书（项目里没有样本，用的是仿真排版）。
- 未提交：工作树混着 DW-05 的改动，需分开提交。
