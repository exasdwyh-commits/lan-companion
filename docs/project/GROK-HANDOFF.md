# 澜 · Grok Bot 接手与部署手册

更新：2026-11-02。任务 GROK-HANDOFF-01。本文面向执行开发的 agent；项目仍在整合，不是已完成的一键安装产品。

## 1. 推荐接手方式

**优先使用 GitHub，建分支、提交 PR；不能操作仓库时，再上传源码 ZIP。**

仓库：<https://github.com/exasdwyh-commits/lan-companion>，公开、默认分支 `main`。GitHub 便于持续同步、审查、回退，避免聊天里反复上传大文件。Grok 的具体客户端能力尚未核实：能读网页链接不代表能拉代码、运行终端或提交 PR。若只有聊天与文件上传功能，用 GitHub 的 **Code → Download ZIP**，连同本文上传，并要求返回补丁与改动文件。

不要打包整个原开发目录：其中有本机依赖、App、个人数据、未获再分发许可的参考媒体。使用公开仓库的 ZIP；不要上传个人配置、密钥、聊天、记忆或模型权重。完整 Mac App 和云端网页预览是不同交付。

本次接手前核实：远端旧 `main` 为 `a0a1427c2199b7085323e8271bb032f436adc4ac`，落后本地；这不是最新功能验收版本。应使用包含本手册与 `GROK-START.md` 的更新快照，先记录 `git rev-parse HEAD`。精确同步提交与核对结果见 [本次记录](updates/2026-11-02-GROK-HANDOFF-01.md)。

## 2. 产品目标与不能丢的已有功能

澜是同一个异界结契伙伴，不是主人与宠物关系。三板块优先级：

1. **茉莉小屋为当前主场景**：复用 `norsizu/moli-room`，保留生活系统和四款电视小游戏，继续完善相册、冒险手账、小说书架、聊天、读书、自主生活。
2. **桌面 Q 版**：沿用当前蓝发、鳍耳、鲸尾小鲸鱼造型；读书、唱歌、聊天、撒娇、表情、顺拐舞、坐窗口，共享身份与业务状态。
3. **真人视频**：保留旧功能，当前只修缺陷，不扩大范围。

小屋已有混元生成角色、连续蒙皮及动作修复，不要换回程序拼的怪物或上游小黑怪物；不要重写整个小屋。Live2D、实时视频、世界模型都不是首版依赖。轮回瓶设定已撤销。生成的冒险、共同创作草稿和真实共同事件必须区分，不能把模型提案直接写成真实记忆或正式剧情。

## 3. 第一次接手

```bash
git clone https://github.com/exasdwyh-commits/lan-companion.git
cd lan-companion
git switch -c grok/bootstrap

git status --short
git rev-parse HEAD
bash scripts/project.sh status
bash scripts/project.sh check
```

环境基础：Git、Python 3、Node.js（支持 `node:test`；建议 Node 22 LTS）。这些是接手建议，不代表已完成跨平台版本矩阵。网页使用现代 WebGL 浏览器；自动化验收按项目约定只用 Ego Lite / ego-browser。

先读仓库根 `AGENTS.md`，再读 `docs/project/README.md` → `PRODUCT.md` → `ARCHITECTURE.md` → `STATUS.md` → `TASKS.md`，按任务补读 `DEVELOPMENT.md`、`ASSETS.md`、`ROADMAP-BOARDS.md`。在 TASKS 登记 agent、任务、文件归属与验收范围，保留未知修改。本文的仓库内路径以 clone 根目录为基准；原机器开发根是 `/Users/exasdwyh/Documents/VScode/vidu/desktop-companion`。

GitHub PR #1 `feat/soul-homestead-engines` 在接手前仍是 open；其功能已由 WorkBuddy 导入本地并修过三处问题。更新快照含这份整合代码。**不要盲目再次合并 PR #1 或覆盖灵魂引擎**；先比较当前代码和 [整合记录](updates/2026-11-01-PR1-MERGE.md)。

## 4. 跑起来：分清网页预览与完整 App

### A. 任意开发机：先看小屋

在 clone 根目录运行：

```bash
python3 -m http.server 8947 --bind 127.0.0.1
```

小屋：<http://127.0.0.1:8947/MALFOY-ENGINE/web/moli-room/?lang=zh>

桌面视觉预览：<http://127.0.0.1:8947/MALFOY-ENGINE/web/live2d/world.html?mode=desktop>

不要直接双击 HTML；模型加载需要 HTTP。这一步可看场景、模型、小游戏、桌面动作；真实聊天、个人书库/照片导入、麦克风、系统窗口停靠、来到桌面等需要 Electron 宿主和服务。网页能打开不能写成完整 App 已部署。局域网/公网部署需单独设计宿主 API、权限与私有数据边界，不要把个人 HTTP 服务直接暴露出去。

### B. 原开发 Mac：构建原生 App

```bash
bash scripts/project.sh build
```

输出 `dist/DeepWhale.app`。**干净 clone 当前不能保证构建**：现有脚本依赖未入库的 `SmartCompanion.app` 母体、本地原始视频/纹理等资源，检查失败应列缺件，不要新建空占位文件骗过检查。

`MALFOY-ENGINE/package.json` 当前没有 `scripts` 和完整依赖声明，`npm install && npm run dev` 不是现成启动方式。`build-companion.sh` 是本机派生打包脚本，不是可移植 Electron 安装器。云端/Linux agent 可先处理源码和网页，无法验收 macOS 窗口与声音。

已有 App 时，用新数据目录试运行：

```bash
lan_test_data="$(mktemp -d /tmp/lan-grok-data.XXXXXX)"
LAN_DATA_DIR="$lan_test_data" ./dist/DeepWhale.app/Contents/MacOS/DeepWhale
```

先退出原 App，避免单实例把新启动转交旧进程。不要直接运行 `project.sh run` 做隔离测试：它默认打开正常 App。新数据目录没有个人配置是正常的，应自行配置测试服务，不能复制用户真实 settings、画像或历史。不要直接修改 `dist/*.app/Contents/Resources`，改源码再构建。

### C. 模型与语音服务

| 能力 | 当前接口/配置入口 | 接手时要做的事 |
|---|---|---|
| LLM | `MALFOY-ENGINE/lib/config.js`，`LLM_URL` / `LLM_MODEL` 及本机多路 provider | 读实际路由后选一个测试 provider，凭据只存本机；先测真实回复再谈可用 |
| STT | 默认 `http://127.0.0.1:8090/stt`，`STT_URL`；根目录 `stt_server.py` | 查依赖与麦克风授权；接口健康不代表录音转写成功 |
| Qwen3-TTS | 默认 `http://127.0.0.1:8091/tts`，`TTS_QWEN_URL` | 当前 HTTP 服务实现/虚拟环境可能在原机器 `~/.smartcompanion/`，没有完整随仓库交付 |
| 本地工具 | ffmpeg/ffprobe、部分功能的 Hermes CLI | 按实际任务补齐；不自动下载大权重或触发歌曲加工 |

`scripts/ensure-tts-server.sh` 默认依赖项目外的服务脚本和 Python 环境；脚本退出不代表 TTS 已启动。旧 Swift TTS worker 也不是 Electron 的 HTTP 服务。先将外部依赖、版本与接口写清，再做可复现安装；目前没有已验证的 Docker/云端完整部署方案。

## 5. 修改位置

| 功能 | 主要文件 |
|---|---|
| Electron 窗口、IPC、服务接线 | `MALFOY-ENGINE/main.js`、`preload.js` |
| 小屋入口、人物、生活与动作 | `MALFOY-ENGINE/web/moli-room/index.html`、`lan-model.js`、`lan-room.js` |
| 小屋相册/书架/聊天面板 | `MALFOY-ENGINE/web/moli-room/lan-companion.js`、`lan-companion.css` |
| 桌面动作/选择器/闲置舞蹈 | `MALFOY-ENGINE/web/live2d/world.html`、`dsh-motion.js`、`dsh-actions.js`、`dsh-idle-dance.js`、`window-perch.js` |
| 动作真源与运行镜像 | `assets/dsh-pet-desktop-v1/`、`MALFOY-ENGINE/web/live2d/dsh-motion/` |
| 共享业务 | `MALFOY-ENGINE/lib/` 的 identity、memory、album、book-library、companion-media 等 |
| 浮动聊天与语音输入 | `MALFOY-ENGINE/web/live2d/composer.*`、`voice-capture.js` |
| 验证与构建 | `Tests/`、`MALFOY-ENGINE/test/`、`scripts/project.sh`、`scripts/build-companion.sh` |
| 旧版参考 | `Sources/PetDesk`、`Sources/CompanionCore`，不继续做平行产品 |

已有动作目录为 **125 个可选动作**；19 组为生成序列，包含低帧率动作，不能声称都是连续高质量动画。顺拐舞控制已含音量、静音、偶发闲置、业务打断。

## 6. 素材缺口与公开版边界

- dsh-pet 原造型与动画保留署名、CC BY-NC-SA 4.0；小屋保留上游 CC BY-NC 4.0 及各素材说明。代码、模型、音频许可分开；仓库公开不等于统一商业授权。
- **抖音参考原视频与提取原哼唱仅在本机使用，未核实公开再分发许可，因此公开快照排除** `shunguai-reference-*.mp4` 与 `shunguai-hum.m4a`（包括运行镜像）。本地原文件保留。
- 公开代码仍保留原音元数据和本机默认选择，公开 clone 不能播放缺失的原哼唱；手动选择菜单中的“原有合成哼唱”可检查替代轨道。不要把 404 误当成 OAuth、自动播放权限或模型错误。后续应做“可用素材探测 + 缺件提示 + 明确回退”，且不擅自替换本机用户选定的原音。
- `Tests/dsh-idle-dance.test.cjs` 最后一项校验本机原视频/音轨哈希，公开 clone 缺这些文件会失败。应区分纯逻辑测试与本地素材集成测试，不能删断言伪造全绿。
- `scripts/prepare-dsh-desktop.py` 当前依赖项目外的 `ref/dsh-pet` 源素材路径；已提交运行成品可直接播，干净机器不要先运行脚本覆盖成品。把路径改为可配置并记录上游版本，是后续可移植性工作。
- GitHub 不含本机 App、权重、全部视频原件、历史运行证据。文档中的历史 PASS 是对应任务证据，不是干净 clone 的通过承诺。

## 7. 推荐 Grok 的第一个 PR：可复现接手

任务名建议 `GROK-BOOTSTRAP-01`，先用小 PR 解决以下闭环，再扩展新功能：

1. 在全新 clone 跑 `project.sh check`，列出必需/可选缺件；网页入口能加载当前模型与动作，无新增控制台错误。
2. 梳理 Electron 真正依赖，新增明确的安装/启动/构建入口与锁定版本；替代 `SmartCompanion.app` 母体依赖。遇原素材缺件就保留可操作说明，不伪称一键打包完成。
3. 整理 STT/TTS 配置示例与依赖；示例只含占位符，不搬用户配置。拆分本地模型与可选服务，未安装时有明确降级提示。
4. 完善公开版原音缺件提示和逻辑/素材测试分层，确保不会把合成轨冒充抖音原音。
5. 更新文档，交付实际运行命令、截图/日志、测试结果、剩余缺口；再给用户 Mac 做原生确认。

完成后按 [ROADMAP-BOARDS](ROADMAP-BOARDS.md) 推进：小屋书架与相册可视化 → 读书暂停/重启续读 → 读书触发共创草稿、用户确认后收进纪念物 → 有依据的自主生活与轻邀请。保持原娱乐与现模型造型，先完善已有闭环。

**协作边界**：WorkBuddy 已领取 H1-3 真机语音批次。先看 TASKS，修改其语音文件、main/preload 等共享入口前协调归属。真实麦克风批次须用户在场并说“开始”；**禁止自动重跑 COVER-03 翻唱管线**。

## 8. 验收与提交

```bash
bash scripts/project.sh check
node --test Tests/dsh-motion.test.cjs Tests/dsh-actions.test.cjs Tests/window-perch.test.cjs
# 公开版先验证控制器逻辑，明确排除需要本机原音的素材项：
node --test --test-name-pattern='^(?!reference source)' Tests/dsh-idle-dance.test.cjs
```

以上是接手命令，不是提前宣称新环境已通过；缺件/失败需列出路径和原因。涉及其他模块，按 DEVELOPMENT 增加对应测试。视觉改动需要真实页面检查；声音需真服务和实际听感；窗口停靠/透明点击/多屏必须 Mac 原生检查。避免 `verify-integration.sh`：它尚有真实数据写入与非 Ego 渲染路径。

每次交付更新 `STATUS.md`、`TASKS.md`、`CHANGELOG.md`，写 `docs/project/updates/YYYY-MM-DD-任务ID.md`。PR 说明目标、改动、验证、限制，提供可审查 diff。不要直推原开发目录的脏主分支，也不要 force push。云端跑过静态测试不能标成 Mac 全链路验收。

可复制的启动任务见 [GROK-START.md](GROK-START.md)。
