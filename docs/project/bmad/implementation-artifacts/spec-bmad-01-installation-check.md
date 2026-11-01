---
title: 'BMAD-01：可重复验证的项目安装检查'
type: 'chore'
created: '2026-10-31'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: ['{project-root}/docs/project/DEVELOPMENT.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**问题：** 用户要求在当前 Codex 项目安装兼容 BMAD，并演示从需求到实现与测试。安装器显示成功不能证明技能文件、中文配置与既有文档路由都可用；未来更新也需要可重复检查。

**方案：** 提供只读命令 `bash scripts/bmad.sh check`，检查官方 6.12.4 安装版本、Codex 技能清单与关键技能、四层合并后的中文配置和产物路径。提供 `config` 与 `test` 子命令，分别展示非敏感配置及运行隔离回归。失败退出非零，诊断明确且不输出个人资料。Python 使用 uv 选择已安装的 3.11+，不修改系统解释器。

验收：Given 当前完整安装，When 运行 check，Then 成功并报告实际技能数量；Given 缺技能、坏清单、错误版本或错误路径，When 检查临时夹具，Then 非零且指出错误；Given 从项目外调用 wrapper，When 执行 check/test，Then 使用唯一工程根并通过；Given 回归测试，When 执行，Then 不读写真实聊天、配置密钥或应用数据。

</frozen-after-approval>

## Implementation Notes

- 调查：官方 CLI 6.12.4 的 Codex 目标为 `.agents/skills`，core+bmm 共 29 项；运行脚本要求 Python 3.11+（系统 3.9 不足），本机 uv 已可自动选择托管解释器。
- 实现范围：新增 `scripts/bmad.sh`、`scripts/check-bmad.py`、`Tests/test_bmad_setup.py`。复用 `_bmad/scripts/resolve_config.py` 的四层配置合并，保留所有安装器管理文件。
- 无待用户决定的功能差异，无不可逆行为；这是一个开发工具目标，使用官方 Build 的 oneshot 路径。未生成虚假的完整产品 PRD 或 sprint。
- 工作区原本存在大量修改；依据上级项目规则保留既有修改，只在登记范围内实施。现有个人 BMAD 回答在安装期间有外部修改，保留其当前值，不把它复制进证据。
- 基线提交：`983e80a2721734d2a00268253c12b97e984d0f1e`。未要求提交或推送；演示不把整个混合工作区提交。
- 实现：三个目标文件已完成；额外固定 PyYAML 6.0.3，使用 safe_load 代替脆弱的 YAML 正则；运行环境在 `.build` 缓存，wrapper 固定兼容的托管 Python 3.12。网络获取超时后，复用本机既有同版本公开分发缓存，未修改原运行环境。
- 验证：项目外调用 check/test 成功；15 项隔离回归通过；官方技能校验覆盖 Codex/CodeBuddy 各 29 项，0 个发现项。工程检查 88/88，0 错误，原有 7 个待办提示保留。
- 独立复查确认原 4 项修复，并从 `/private/tmp` 实跑 15/15 PASS；本任务范围无延期审查项。

## Review Triage Log

| 发现 | 判定与证据 | 处理 |
|---|---|---|
| 未覆盖 CodeBuddy | medium：旧夹具只有 Codex 也通过，无法守住双工具要求 | patch：检查两种工具登记及两套文件；缺 CodeBuddy 登记/技能均有回归 |
| 在整个 YAML 搜索 codex | medium：其他字段出现 codex 会被误认为 IDE 已配置 | patch：safe_load 后仅检查 ides 列表；错位字段回归通过 |
| 带引号版本被误拒绝 | low：合法 YAML 变体被当成版本不同 | 与 YAML 解析根因一并 patch；带引号及注释版本通过 |
| 空描述或未闭合引号通过 | medium：损坏技能被误报完整，影响发现与使用 | patch：safe_load frontmatter，要求正确名称及非空字符串描述；两项故障回归通过 |
