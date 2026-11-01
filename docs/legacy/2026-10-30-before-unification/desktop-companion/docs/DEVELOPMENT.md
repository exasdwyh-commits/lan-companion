# 开发交接（2026-10-29）

## 唯一目录与启动

开发根目录：`/Users/exasdwyh/Documents/VScode/vidu/desktop-companion`。
构建：`bash scripts/build-whale-video.sh`；启动：`open dist/WhaleVideoCompanion.app`。
Bundle ID：`com.lingdesk.whalevideo`，执行文件：`Contents/MacOS/PetDesk`，界面显示名“澜 · 视频测试”。

不再创建平行工程。既有文件保留原位，避免破坏脚本、TTS 路径和历史证据。

## 源码地图

| 文件 / 目录 | 职责 |
|---|---|
| `Package.swift` | 两个可执行目标：当前 `PetDesk`，另一路 `LingDesk`；共享 `CompanionCore` |
| `Sources/PetDesk/main.swift` | AppKit 应用、状态栏、启动与自检入口 |
| `Sources/PetDesk/PetController.swift` | 点击、聊天、好感、闲置计时、趴屏/睡眠/唤醒、菜单 |
| `Sources/PetDesk/Stage.swift` | StageView 视频图层、透明角色循环、动作切换、整场景睡眠播放器 |
| `Sources/PetDesk/PetContentView.swift` | 面板 UI、鼠标交互、播放器代理 |
| `Sources/PetDesk/PetIdentity.swift` | character.json、角色与媒体路径校验 |
| `Sources/PetDesk/PetPack.swift` | pack.json、互动台词、好感、剧情与相册结构、歌曲与歌词时间码 |
| `Sources/PetDesk/PetSongPlayer.swift` | 唱歌用的独立音频播放器：AVAudioPlayer + 0.1s 定时器驱动歌词行号，与 TTS 生命周期解耦 |
| `Sources/PetDesk/PetNeuralSpeech.swift` | Kokoro Python 常驻进程、取消、音频播放、失败回退回调 |
| `Sources/PetDesk/PetSettingsWindow.swift`、`PetPanels.swift` | 设置、对话、剧情与相册面板 |
| `Sources/CompanionCore/` | 设置与本地存储、模型客户端、另一条口型引擎协议与进程管理 |
| `scripts/pet_tts.py` | 离线 MLX Kokoro TTS worker |
| `scripts/build-whale-video.sh` → `build-pet.sh` | 构建、复制指定素材目录、ad-hoc 签名；不要直接改打包副本 |
| `scripts/pack-assets.py` | 从 character.json / pack.json 推导运行必需素材清单，供选择性打包使用 |
| `scripts/fix-alpha-bleed.py` | 透明视频去绿边：绿幕反解 + 边缘去溢色 + 最近邻颜色外扩；输出新文件名 |
| `scripts/check-whale-deps.sh` | 鲸鱼路线运行依赖检查：工具链、素材清单、构建产物一致性、签名、Qwen3/Kokoro 语音、本地聊天端点 |
| `scripts/check-whale-voice.sh` | 对话语音实测：真正出声的是不是 `qwen3`（静默降级到 edgetts 会让音色变掉却不报错），并断言解释器/权重都在 `.runtime/` |
| `scripts/setup-runtime.sh` | 重建 `.runtime/`（venv-tts + Qwen3 权重）。幂等，新机器一条命令复原 |
| `scripts/check-whale-degrade.sh` | 素材降级检查：缺失/解码失败/动作缺失/动作被打断时是否黑屏、卡住或静默 |
| `scripts/sing_from_lyrics.sh` | 唱歌主入口：TTS → WORLD 换基频 →（`TIMBRE=1`）Seed-VC 换音色 |
| `scripts/sing_cover.py` | 歌词换音高：WORLD harvest/cheaptrick/d4c/synthesize，不拉伸、旋律贴说话时长 |
| `scripts/sing_seedvc.py` | Seed-VC 音色转换；把 HF 仓库名全部改指 `.models/seedvc` 本地权重 |
| `scripts/sing_report.py` | 客观体检：浊音占比 / f0 跨度 / 帧间抖动 / 音色相似度 |
| `scripts/sing_cover_file.sh` | 翻唱现成歌曲：mp3/链接 → Demucs 分离 → Seed-VC 换她的音色 → 混回伴奏 |
| `scripts/add_song_to_pack.py` | 把成品歌登记进 pack.json 的 songs（含文件拷贝与去重） |
| `scripts/fetch_sing_models.py` | 从 ModelScope 拉 Seed-VC 权重到 `.models/seedvc`（约 1.9 GB） |
| `third_party/seed-vc/` | Seed-VC v1 源码（MIT）。权重不进库，见 `.gitignore` |
| `Tests/`、`benchmarks/` | 可运行检查与按日期保存的结果；不能用历史 PASS 证明新修改已通过 |

## 本机依赖

- macOS 14+，Swift / Xcode Command Line Tools；当前是 Apple Silicon 本机测试。
- 构建无需启动 LLM；预制视频播放无需启动口型引擎。
- 聊天通过设置中的 OpenAI 兼容接口；本机默认地址 `http://127.0.0.1:11434/v1`，实际模型以用户设置为准。
- 鲸鱼 TTS 的解释器和权重都在项目内 `.runtime/`：`venv-tts`（Python 3.12 + mlx-audio 0.6.2）
  与 `models/qwen3-tts`（2.4 GB，8bit MLX）。引擎链 `qwen3 → edgetts → kokoro → 系统语音`；
  兜底的 Kokoro 仍在 Hugging Face 缓存 `mlx-community/Kokoro-82M-4bit`。worker 强制离线，不自动下载。
- `.runtime/` 共约 7 GB，不进版本库。新机器用 `bash scripts/setup-runtime.sh` 重建（幂等，缺什么补什么）。
- **`.app` 里不含运行时。** 只拷 app 不跑 setup-runtime，声音照样出，音色会静默换成 edgetts
  的微软播音腔——这是最容易「以为是 bug」的一处。`bash scripts/check-whale-voice.sh` 会断言
  app 实际用的解释器和权重都在 `.runtime/` 里，而不只是「有声音」。
- Python 覆盖变量：`LINGDESK_TTS_PYTHON`；权重覆盖变量：`PET_TTS_MODEL`。
- 素材重建需要 ffmpeg / ffprobe、Python OpenCV / NumPy。只打包已有素材不需要重新处理视频。
- `LiveTalking` 的 MuseTalk/wav2lip 与 `ai-live-avatar` 的 Vidu 是保留的独立路线，当前鲸鱼预制视频不会自动获得真实口型。

## 数据与测试隔离

用户数据默认 `~/Library/Application Support/LingDesk/`；可用 `LINGDESK_DATA_DIR` 覆盖。
`settings.json` 可能含密钥，不输出内容。鲸鱼包历史文件名由 Info.plist 的 PetHistoryFile 指定为 `history-whale-video.json`。
源码直接运行 / 测试可用 `LINGDESK_PET_ASSETS` 覆盖素材目录。测试必须使用临时数据目录，不能清空真实聊天历史。

## 检查入口

在本开发根目录执行：

```bash
# 素材引用完整性：打印打包会复制的文件清单，引用缺失会非零退出
python3 scripts/pack-assets.py assets/whale-video-test

# 当前鲸鱼：模拟闲置、真实 AVPlayer 跨循环播放、隐藏恢复、唤醒、位置恢复；不调用聊天或 TTS
bash scripts/check-whale-modes.sh

# 素材坏掉之后的行为：缺失 / 解码失败 / 动作缺失 / 动作被打断（19 项，约 20 秒）
bash scripts/check-whale-degrade.sh

# 唱歌行为：播放 / 歌词时间码 / 点击停止 / 本地意图 / 听完奖励 / 缺素材（17 项）
# 夹具是 ffmpeg 合成的 6 秒音轨，不联网、不调 TTS
bash scripts/check-whale-songs.sh

# 正式包里真播一遍歌（验的是 assets/whale-video-test/pack.json 里登记的那首）
./dist/WhaleVideoCompanion.app/Contents/MacOS/PetDesk --check-song

# 唱出来到底是不是在唱：浊音占比 / f0 跨度 / 帧间抖动 / 音色相似度
../.venvs/sing/bin/python scripts/sing_report.py out.m4a out.json 她的说话样本.wav

# 生成一首歌（TIMBRE=1 才走 Seed-VC 换音色；不带就是 WORLD 直出）
TIMBRE=1 bash scripts/sing_from_lyrics.sh lyrics.txt out.m4a out.json

# 对话语音实测：配置 / Qwen3 权重 / mlx_audio / 冷启动真出一句话
# 判的是 engine（真正出声的那一层）是不是 qwen3，不是「有没有声音」
# 因为 auto 链静默降级：声音还在，音色从 Vivian 变成微软播音腔
bash scripts/check-whale-voice.sh

# 重建运行时（.runtime/ 不进版本库）。新机器或换了 Python 之后跑，幂等
bash scripts/setup-runtime.sh --check    # 先看缺什么
bash scripts/setup-runtime.sh            # 再补

# 鲸鱼运行依赖：工具链、素材清单、构建产物与清单是否一致、签名、Kokoro 语音、本地聊天端点
# 必需项缺失非零退出；TTS / ffmpeg / 聊天端点只 WARN，因为它们失败时能降级运行
bash scripts/check-whale-deps.sh

# 通用桌宠生命周期、fixture 聊天、角色绑定（需要本机 HTTP 监听）
bash scripts/check-pet.sh

# 共享 Core / 引擎进程相关修改
bash scripts/check_core.sh

# Python 口型桥相关修改，使用已配置的本地 Python
../LiveTalking/.venv/bin/python -m unittest discover -s Tests -v
```

当前工具链的 XCTest 支持存在限制，直接 Swift 编译检查是现有路径。播放器修改后还应本机打开鲸鱼 app，核对右键切换、点击唤醒和画面观感。

## 最近验证与边界

本次整理后已重新运行 `bash scripts/check-whale-modes.sh benchmarks/project-handoff-2026-10-29/modes.json`，13 项全部通过；文档链接与五个当前配置媒体引用也已检查存在。

- 打包白名单已落地（2026-10-29）：`PET_ASSETS_SELECTIVE=1` 只复制 character.json / pack.json 引用的 7 个文件，
  应用 748 MB → 331 MB；素材源目录未删除任何文件。记录见 `benchmarks/pack-whitelist-2026-10-29/`。
- character.json 与 pack.json 的 persona 已统一为当前真实能力（文字聊天 + Kokoro 语音；待机/撒娇/趴屏/睡眠为预制视频切换；
  尚无视觉感知、麦克风输入、语音驱动口型）。此前两份都写着“系统语音”“没有肢体动画”，与实际不符。
- `benchmarks/quiet-sleep-2026-10-29/modes.json`：13 项趴屏/睡眠状态检查通过。
- `benchmarks/whale-transition-2026-10-29/player-checks.json`：既有点击动作锚点切换检查（历史结果，播放器修改后应重跑相关验证）。
- 已在本机实际菜单切到趴屏与床上睡眠，点击睡眠画面恢复趴屏。
- 待机与点击动画为预制视频，聊天语音不驱动实时嘴型。
- 睡眠是已经侧卧睡着的场景；没有躺下、起身动作，切换仍直接切画面。
- **绿边已修（2026-10-30）**：idle-matched / touch-matched 的透明区原先保留纯绿幕 RGB(47,157,47)，
  播放器按 `.resizeAspect` 缩放时渗进发丝。已用 `scripts/fix-alpha-bleed.py` 生成 `-clean` 版：
  模拟 40% 缩放后绿边像素 idle 0.13%→0.01%、touch 0.12%→0.02%，规格（尺寸/帧数/帧率/时长）与原片完全一致。
- **"趴屏发丝绿边"这条结论经实测不成立**：quiet-idle-loop.mov 透明区是青灰 RGB(61,92,92)，
  缩放后绿边 0.000%，无需处理。它的冷色边缘来自蓝发本身，不是渗色。
- 局部水印修补可能削弱布料或环境运动；0.5 秒循环混合不保证绝对无重影。
- 应用体积已从 748 MB 降到 331 MB：`build-whale-video.sh` 设 `PET_ASSETS_SELECTIVE=1`，只复制 character.json / pack.json 引用的 7 个文件（原片与中间成品不再进包，源目录文件全部保留）。加素材后体积会回升，需要的话按引用清理而不是删原片。
- **切换稳定性加固（2026-10-30）**：素材缺失、内容解不出来、动作素材缺失、动作卡住这四种情况不再黑屏/卡住/静默。
  起播前先查可用性（解析符号链接，否则链接会被当成空文件拒播）；解码失败把上一层推回来（`idle.recoveries` 计数）；
  内容层缺失由 `missingAmbientNames` 报出并压过问候语；动作开场有 4 秒看门狗（等锚点时按待机循环长度放宽）。
  检查入口 `bash scripts/check-whale-degrade.sh`，19 项通过；记录见 `benchmarks/degrade-2026-10-30/`。
- 相册当前是 **20 张**（`album-01..20`，4 张初始开放、16 张按好感度解锁），不是 26 张：
  `assets/whale-album-2026-10-29/generation.json` 声明 26 条，缺的 21–26（`-v2` 命名）从未生成到磁盘。
  `bash scripts/check-whale-album.sh` 的 `twenty_six_*` 两项因此为红——那是目标值，缺的是素材不是代码。
  重导入仍用 `python3 scripts/import-whale-album.py`（会按清单重新编码 jpg）。
- **唱歌已能跑通（2026-10-30）**：行为层 17 项通过（`check-whale-songs.sh`）；
  生成链路是 TTS → WORLD 换基频 → Seed-VC 换音色，成品 `songs/tide.m4a` 8.7 秒四句；
  正式包实测 `--check-song` 播放正常（position 2.50s / line 1 / 歌词「我把它捧在手心」）。
  客观指标：浊音 70%、跨度 11.5 半音、帧间抖动 0.11 半音、音色相似度 0.883（WORLD 直出是 0.723）。
  记录见 `benchmarks/sing-2026-10-30/README.md`。
  **不做真人歌手翻唱**：声音权益 + 录音制作者权 + 词曲著作权三条同时踩，商业模板里放不得。
- 唱歌这块还差：旋律是程序随机游走（没有作曲意图）、没有正经伴奏、逐句语速由 TTS 决定（1.28~2.55 秒不匀）。
- **打包器修了一个静默 bug（2026-10-30）**：`build-pet.sh` 的选择性打包把所有素材拍平到
  `PetAssets/` 根目录，`songs/tide.m4a` 因此找不到；而 `nextSong()` 会静默过滤掉文件不存在的歌，
  表现是「歌单有 1 首、点唱没反应、也不报错」。已改成保留相对路径，回归用 `--check-song`。
- 未完成独立安装包、跨机器运行验收、语音输入、视觉感知或真实模型质量全面验收。

## 推荐后续开发顺序

1. 生成自然长待机、躺下与醒来衔接素材；继续修整透明视频发丝边缘。
2. 切换稳定性已完成一版（降级路径 19 项通过）。仍未实测：动作看门狗「真的卡住」的分支、睡眠场景的失败路径。
   下一步可以把这两条补成夹具，再往「换素材热重载」走。
3. 统一 character.json 与 pack.json 的过期能力描述；正式化素材包 schema 和动作首尾锚点。
4. 打包素材白名单已完成（331 MB）。剩余：运行依赖检查、Python/TTS 可迁移配置，推进独立分发。
5. 唱歌已经能跑通，但要当卖点还缺三件：**人工写的旋律**（现在是程序随机游走，听不出作曲意图）、
   **伴奏**（现在只有一层正弦琶音垫底）、**逐句语速对齐**（同一批里 1.28~2.55 秒，节奏不匀）。
   换 v2 模型（whisper + bigvgan）能再提音色相似度，但权重比现在这套贵得多。
5. 补齐相册缺的 6 张（21–26）、填入剧情 chapters，再评估真实口型与麦克风接入成本。

## 可直接给其他 agent 的任务开头

> 在 `/Users/exasdwyh/Documents/VScode/vidu/desktop-companion` 继续开发鲸鱼娘桌宠“澜”。先读工作区 AGENTS.md、README.md、docs/DEVELOPMENT.md 和 docs/ASSETS.md。当前目标为 PetDesk，构建入口 scripts/build-whale-video.sh，应用 dist/WhaleVideoCompanion.app。沿用现有工程，保留其他人的修改。请先确认任务涉及哪些文件，再实现并按影响范围检查；汇报真实验证和剩余限制。

## 其他目录的定位

`Sources/LingDesk/`：早期实时口型客户端；`MALFOY-ENGINE/`、`SmartCompanion.app/`、`_testonly/`：马尔福参考/引擎/测试材料，不是当前入口。`MALFOY-*.md`、`PRODUCT-PLAN.md`、`CHARACTER-*.md`、`DEEPSEA-SAMPLE.md` 等保留为研究/阶段记录，其功能描述必须以当前源码与素材配置核对。
旧 README 原文在 `docs/legacy/`，避免将早期系统语音默认值、旧 app 路径当成鲸鱼当前配置。
