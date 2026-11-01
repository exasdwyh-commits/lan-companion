# 开发、运行与验收

所有命令在 `/Users/exasdwyh/Documents/VScode/vidu/desktop-companion` 执行。先看 [架构](ARCHITECTURE.md)、[现状](STATUS.md)、[任务](TASKS.md)。

## 统一工程命令

```bash
bash scripts/project.sh status
bash scripts/project.sh check
bash scripts/project.sh build
bash scripts/project.sh run
bash scripts/project.sh reference-build
```

| 命令 | 实际行为 | 前提/边界 |
|---|---|---|
| status | 只读盘点源码、内容数量、包一致性与 Git 元信息 | 不读个人数据，不调模型或服务 |
| check | 检查工程路由、文档链接、内容文件引用、JS/Shell/Python 语法 | 只证明静态约定，已知产品缺口仍显示 warnings |
| build | 调现有 build-companion.sh | macOS 工具、SmartCompanion.app 母体；临时构建/校验后备份替换 |
| run | 用绝对路径 open 主线 App | 不重建、不下载、不自动启动服务；运行时会使用现有个人配置 |
| reference-build | 调 build-whale-video.sh | Swift/CLT；构建保留基线，不作为另一条新产品主线 |

wrapper 统一入口；底层已接真人视频兼容派生、安全替换及相册/剧情/歌曲入口。新增内容与源码仍需重新派生、构建并验收，不能把现有包当作最新源码。缺产物会给出构建指引。

## 本机依赖

| 功能 | 当前依赖 | 核实方式 |
|---|---|---|
| 双世界窗口 | 母体 Electron、main/preload/world 页面 | 静态检查 + 本机窗口实际操作 |
| 主线聊天 | main.js 现有模型路由与本机网关/配置 | 隔离完成后发真实请求，记录服务来源；不记录凭据 |
| 主线双音色 | Qwen3 HTTP :8091/tts、ffmpeg；edge/say 回退 | health + 两形态实际合成 + engine/profile 记录 + 听感 |
| 语音输入 | ffmpeg 录音、STT :8090 与麦克风权限 | 实际授权与转写，不以接口存在证明可用 |
| 工作 | 本机 Hermes CLI 与其配置 | 隔离任务、真实产物、失败和取消验证 |
| Swift TTS | .runtime/venv-tts、.runtime/models/qwen3-tts；旧 LiveTalking 路径回退 | check-whale-voice.sh；注意不是 Electron HTTP 服务 |
| 歌曲加工 | sing Python 环境、ffmpeg、Seed-VC/Demucs 权重 | 指定样例与客观结果，不推定所有歌曲成功 |

部分依赖仍在项目外。没有验证外部服务时只标“依赖/配置存在”，不标“全链路通过”。

## 数据隔离

- Swift 支持 LINGDESK_DATA_DIR；自检必须指定新建临时目录。
- **Electron 已支持显式数据目录（DW-01，2026-10-30）**：`main.js` 经
  `MALFOY-ENGINE/lib/data-dir.js` 解析，优先级 `--data-dir` / `--data` 参数 →
  `LAN_DATA_DIR`（兼容 `LINGDESK_DATA_DIR`、`PET_DATA_DIR`）→ 旧默认 `~/.smartcompanion`。
  显式指定时 `userData`（localStorage/IndexedDB/缓存）也搬进 `<dir>/electron`。
  未指定时行为与旧版一致。
- 跑任何会写数据的 Electron 自检：`LAN_DATA_DIR=$(mktemp -d) ./dist/DeepWhale.app/...`。
  验收入口固定为 `bash scripts/check-electron-isolation.sh`（9 项：解析优先级、写入落点、
  重启读回、真实目录指纹不变）。**独立 composer 已消费主进程 SESSION**，旧内嵌输入仅供独立预览。
- 旧 verify-integration.sh 会写示例到真实记忆、打印尾部、终止/重启进程，并调用旧 CDP/非 Ego 渲染器；保留为历史证据脚本，不作为当前默认验收入口。
- 不用修改 HOME 冒充隔离。按任务实现显式数据目录和服务配置，默认行为保持兼容，再用临时目录证明真实个人文件未变化。
- 不展示个人 settings、key、profile、history、.env 或模型服务的授权头。密钥从环境变量或
  `~/.hermes/.env` 读取（`lib/config.js`），源码里不再有明文。

## 按影响选择验证

| 修改范围 | 必需验证 |
|---|---|
| 本次文档/工程入口 | project.sh check；检查清单与来源，确认无业务文件或 App 改动 |
| Q 版骨骼/动作 | node Tests/chibi-performance.test.cjs；node Tests/chibi-face-presence.test.cjs；node Tests/chibi-motion.test.cjs；python3 scripts/prepare-chibi-texture.py --check；Ego 检查实际 world 页面和包内 file 地址、GL 降级/透明命中/拖拽，视觉查连接和形变；见 CHIBI-MOTION.md |
| Electron 窗口/模式 | node --test Tests/world-video.test.cjs Tests/companion-windows.test.cjs Tests/composer.test.cjs Tests/reply-delivery.test.cjs；JS 语法；Ego 可行路径下检查当前入口；本机验证启动不抢焦点、world/desktop/返回、角色与输入框命中、空白穿透；多屏未验则说明 |
| 内容适配/打包 | pack-assets.py 引用完整性；路径/文件校验；当前入口打开相册、最后一排、保存、剧情 A/B、奖励幂等、歌曲停止；构建后核对字节与签名 |
| 剧情页面交互 | node --test Tests/gallery-interaction.test.cjs；真实脚本接真实状态机、临时数据覆盖开始/继续/分支/结算/重看与失败重试；另做原生窗口点击，不能仅靠截图或后端测试验收 |
| 双音色 | 同一句清冷/活泼真实样例、engine、降级提示、异步切形态、停止和叠播 |
| 记忆/成长 | 临时数据跨重启回忆、fallback 落盘、纠正/删除、共享身份；不得读取真实记忆作为夹具 |
| 阅读/工作 | 续读/暂停；真实任务文件；超时/取消/失败与晚到结果；切换形态不重复执行 |
| Swift 视频/状态机 | check-whale-modes.sh，必要时 degrade；本机看切换和画面，技术 PASS 不替代观感 |

### 保留基线检查示例

输出到当前任务目录，避免覆盖历史结果：

```bash
python3 scripts/pack-assets.py assets/whale-video-test
bash scripts/check-whale-modes.sh benchmarks/2026-10-30-任务ID/modes.json
bash scripts/check-whale-album.sh benchmarks/2026-10-30-任务ID/album.json
bash scripts/check-whale-songs.sh benchmarks/2026-10-30-任务ID/songs.json
```

2026-10-31 FIX-01 收尾：并行工作把源/运行派生/包相册数量从 26/20/20 更新为 26/26/26；原版/v2/v3 选版与本轮新增图要分别核实。关联 Node 测试仍有两处旧 20 张断言失败，最新剧情源码也与包不同。按 [R1](REPAIR-PLAN.md) 核对 ID/文件与选版，收口测试并重新纳入源码修复；不只改数量断言。

其他既有检查：check-whale-deps.sh、check-whale-voice.sh、check-whale-degrade.sh、check-pet.sh、check_core.sh，按改动范围阅读脚本后运行。会调真实服务/产生声音的检查需明确环境和数据隔离。

## 浏览器

只用 Ego Lite / ego-browser；先读其技能并执行 ego-browser skill。当前 Electron 专属 IPC 不能直接在普通网页复现；若 Ego 无法操作打包窗口，自动网页检查用无个人数据的适配夹具，本机 App 窗口由实际交互验证并如实标注边界。不能借此启动另一个 Chrome/Chromium 代替。

相册/记忆页可以用 App 自身渲染验收，不引入第二个浏览器：

```bash
LAN_DATA_DIR=$(mktemp -d) LAN_CONTENT_PROBE=1 LAN_CONTENT_PROBE_NARROW=1 \
  LAN_CONTENT_PROBE_OUT=/tmp/probe ./dist/DeepWhale.app/Contents/MacOS/DeepWhale
```

会依次截 `probe-gallery.png`、`probe-chapters.png`、`probe-memory.png`、`probe-narrow.png` 后退出；正常启动不受影响。加 `LAN_CONTENT_PROBE_WORLD=1` 会额外截 `probe-world.png`（用于关系称呼/舞台视觉检查）。

## 当前真人小窗与悬浮对话

默认真人 640×360，悬停显示顶栏，可拖顶栏/等比缩放；平常、趴屏、睡眠、暂停/继续及正常人物位置/大小可调。Q 版仍用透明桌面层，空白穿透。64px 悬浮图标可拖外圈，点击展开；⌥⌘J 开关；录音 4 秒后进草稿确认发送。壁纸从托盘显式开启。当前运行中的旧包须退出并打开新包才更新；本轮未自动重启它。

素材再生：`python3 scripts/prepare-world-video.py`。构建前已有派生素材才可打包；`python3 scripts/check-world-payload.py dist/DeepWhale.app` 校验来源/包字节。该脚本同时从待机原片首帧生成 `anchor-idle.png`，用于触摸片段尾部 0.4 秒淡出（`config.js` 的 `fadeOutSeconds`）。上次自动审批额度错误已解除；新版隔离启动和原生聊天图标展开已验证，完整原生视觉与麦克风仍待验，见 [运行复查](updates/2026-10-30-DW-03-runtime-size-face.md)。

## agent 每次交付

开发方法可使用已安装的 BMAD 6.12.4（Codex/CodeBuddy），入口和演示见 [BMAD.md](BMAD.md)。日常运行 `bash scripts/bmad.sh check`、`config` 或 `test`；首次依赖准备见该说明。BMAD 产物集中 `docs/project/bmad/`，仍按下列任务和交付规则收尾。

1. 领取任务，声明文件范围，先查 git status；本目录有 Git，但无 remote 不等于已经备份远程。
2. 按范围实施，不复制工程，不改未知文件，不触碰个人数据。
3. 跑必要检查，失败保留原因；新结果放本任务目录。
4. 更新 STATUS、TASKS；在 [updates](updates/TEMPLATE.md) 记改动、复用来源、命令、结果、限制和下一步。
5. CHANGELOG 加索引。交付给用户时给可打开的文档/产物，明确是否真正完成运行整合。
