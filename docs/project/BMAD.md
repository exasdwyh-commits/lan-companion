# BMAD：项目配置与使用

安装日期：2026-10-31；任务 BMAD-01。官方稳定版 **bmad-method@6.12.4**，模块 `core` + `bmm`，关闭旧命令 shims。

## 版本选择

核对了[官方 README](https://github.com/bmad-code-org/BMAD-METHOD)、[V6.12 稳定分支说明](https://github.com/bmad-code-org/BMAD-METHOD/blob/V6.12/README.md)、[v6.12.4 发布记录](https://github.com/bmad-code-org/BMAD-METHOD/releases/tag/v6.12.4)，以及该 npm 包的安装器、Codex 适配器和技能源文件。

官方主分支已经提供 v7 预览，当前在线部分安装说明也专属 v7。这个项目固定到已发布的 v6.12.4，使用它自带的技能与工作流。不要混入 v7 的 setup/migrate 或老版 quick-spec/quick-dev 教程。

## 安装位置与配置检查

| 位置 | 用途 |
|---|---|
| `.agents/skills/bmad-*` | Codex：29 个技能 |
| `.codebuddy/skills/bmad-*` | CodeBuddy：同样 29 个技能；按用户要求保留 |
| `_bmad/_config/manifest.yaml` | 版本、模块、已配置工具 |
| `_bmad/config.toml` | 安装器生成的团队默认值；更新会重建 |
| `_bmad/config.user.toml` | 本机个人回答；已忽略，不复制到证据 |
| `_bmad/custom/config.toml` | 团队中文输出覆盖；升级保留 |
| `_bmad/custom/bmad-build.toml` | Build 加载既有项目规则，完成后更新统一交接文档 |
| `_bmad/custom/*.user.toml` | 个人覆盖；已忽略，优先级最高 |
| `docs/project/bmad/` | BMAD 产物；不替代 PRODUCT/ARCHITECTURE/STATUS/TASKS |

官方四层合并顺序：基础 → 个人回答 → 团队 custom → 个人 custom。交流和文档语言均为 `Chinese`；知识路径为 `docs/project`；规划与实现分别落在 `docs/project/bmad/{planning-artifacts,implementation-artifacts}`。

本次安装前未发现 BMAD 配置。安装过程中工具被另一写入方改成 CodeBuddy 并移除 Codex 技能，本次检查发现该漂移；用户明确要求保留两者后，已通过官方安装器配置 `codex,codebuddy`，保留自定义项与现有个人回答。

## 使用入口

**重启 Codex，并从唯一工程根开启新会话**，让 Codex 重新发现本地技能；当前聊天的技能目录不保证热刷新。不要从父目录 `vidu` 推断子目录技能已经被加载。

```bash
cd /Users/exasdwyh/Documents/VScode/vidu/desktop-companion
bash scripts/bmad.sh check
bash scripts/bmad.sh config
bash scripts/bmad.sh test
# 使用 Codex CLI 时，可在这个目录运行 codex；桌面端也选择这个工程根。
```

Node 要求 ≥20.12；BMAD Python 脚本实际要求 ≥3.11（使用标准库 tomllib）；需要 uv。当前 Node 22.22.3、uv 0.11.17，已有托管 Python 满足要求。系统 `python3` 仍为 3.9.6，调用 BMAD 脚本使用 `uv run`。项目 wrapper 使用已安装的 Python 3.12，不更改系统 Python；检查器固定依赖 [PyYAML 6.0.3](https://pypi.org/project/PyYAML/6.0.3/)，通过 `safe_load` 解析清单与 frontmatter，缓存只在被忽略的 `.build/bmad-uv-cache`。

新机器首次准备环境需要网络；当前机器已经准备完成：

```bash
uv python install 3.12
UV_CACHE_DIR="$PWD/.build/bmad-uv-cache" uv run --python 3.12 scripts/check-bmad.py
UV_CACHE_DIR="$PWD/.build/bmad-uv-cache" uv run --python 3.12 Tests/test_bmad_setup.py -v
```

准备后 `bmad.sh check/test` 均离线运行；清除 `.build` 后需重新准备依赖。本次下载遇到超时，复用本机已有的 PyYAML 6.0.3 分发缓存，在项目缓存完成安装；未改 TTS 环境或系统包。

`check` 是项目约定的只读检查，不自动修复；`--json` 返回机器可读结果。`config` 只输出项目名、语言及文档路径。`test` 用新建临时安装夹具，不运行应用或模型服务。

## 从需求推进到实现与测试

### 小功能、修复或开发工具：直接 Build

在新会话输入以下自然语言，或用 `$bmad-build` 选择技能：

```text
使用 bmad-build，为“澜”实现 <具体目标>。
先读项目文档与代码，给出范围、验收条件及验证命令。
保留工作区已有修改；先在 TASKS 登记文件归属。
```

Build 会澄清、调查、形成 spec，再实现、验证、审查。小且可逆、无需求空缺的任务可走 oneshot；较大任务会停在 spec 确认点。文件存在不代表某阶段已完成。

**本次已实际完成的演示：**

1. 需求与验收写入 [BMAD-01 spec](bmad/implementation-artifacts/spec-bmad-01-installation-check.md)。
2. 按官方 `bmad-build/SKILL.md` 运行渲染器，加载带项目规则的工作流快照，选择 oneshot。
3. 实现 `scripts/bmad.sh` 和 `scripts/check-bmad.py`，检查固定版本、技能、中文及文档路由。
4. `Tests/test_bmad_setup.py` 的 15 项测试验证缺失技能、版本漂移、坏清单、路径、配置覆盖和 YAML 变体等情况。
5. 按 Build 要求独立审查，修正 4 个发现项；证据见 [BMAD-01 交付记录](updates/2026-10-31-BMAD-01-installation.md)。

这是实际工具代码的闭环，不是产品功能或 UI 验收。工作区已有大量未提交修改；本次遵循上级项目规则，仅改登记范围，未按工作流默认行为提交整个工作区。

同日 WorkBuddy 另以「读书按章跳转」演示了产品功能流程；[PRD](bmad/planning-artifacts/prds/prd-desktop-companion-2026-10-31/prd.md) 与[实现 spec/审查记录](bmad/implementation-artifacts/spec-read-chapter-jump.md) 已存在。功能验证归属和本聊天独立验证边界见交付记录末节。

### 大需求：先规划，再按故事 Build

每一步建议用新会话，明确引用上一步产物路径：

| 阶段 | 技能 | 输入 / 输出 |
|---|---|---|
| 定需求 | `bmad-prd` | 现有 PRODUCT、真实诉求、首版边界 → PRD 与未决事项 |
| 定设计 | `bmad-architecture` | PRD、现有 ARCHITECTURE、代码事实 → 本次架构决策 |
| 拆任务 | `bmad-create-epics-and-stories` | PRD + 架构 → 有验收标准的 stories |
| 排期与就绪检查 | `bmad-sprint-planning` | 已确认规划 → sprint 状态 |
| 实现与验证 | `bmad-build` | 单个 story/spec → 实现、测试、内建审查 |
| 按需补端到端测试 | `bmad-qa-generate-e2e-tests` | 已实现入口和验收条件 → 自动化测试 |
| 查下一步 | `bmad-help` | 当前目标及已有产物 → 下一技能 |

QA 技能产出的浏览器方案必须服从本项目 Ego Lite 限制，使用隔离数据；不能照搬其他浏览器方案。完成状态仍以当前测试、真实服务和视觉证据分别判断。

## 重装 / 升级

先检查工作区；固定版本重装如下。保留两种工具，避免只指定一种时移除另一种：

```bash
npx --yes bmad-method@6.12.4 install \
  --directory /Users/exasdwyh/Documents/VScode/vidu/desktop-companion \
  --modules bmm --tools codex,codebuddy --no-shims --yes --action update
bash scripts/bmad.sh check
bash scripts/bmad.sh test
```

不自动切换 `latest`；升级时先看官方 release，更新检查器的版本约定并重新验证工作流。直接改 `.agents`/`.codebuddy` 的官方技能会被覆盖；持久定制放 `_bmad/custom`。

BMAD 的 MIT 许可原文保存在 [许可副本](bmad/BMAD-METHOD-LICENSE.txt)，只覆盖 BMAD 代码，不改变产品素材许可。
