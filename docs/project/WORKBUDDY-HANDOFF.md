# WorkBuddy 接手单 · 2026-10-31

用户要求节省 Codex token，将实现收尾和重复验证交给 WorkBuddy。此页是工作分工，不代表 WorkBuddy 已开始执行。

## 分工

| 负责人 | 范围 | 交付 |
|---|---|---|
| WorkBuddy，优先 P0 | DW-05：真实翻唱跑通、电子书原生导入、真实聊天服务排障、打包与记录 | 可播放成品、可复现命令、失败原因、当前证据 |
| WorkBuddy，P0 完成后 | DW-03：把既有相册和图文剧情迁入当前入口 | 相册最后一排/保存、剧情 A/B、奖励幂等的真实操作记录 |
| Codex，后续需要时 | 关键方案审查、疑难代码定位、人物表现与交互优化 | 针对具体问题处理，不重复批处理、装依赖和整套测试 |
| 用户 | 翻唱听感、人物观感、剧情内容选择 | 听试听后决定是否接受；技术测试不能替代审美验收 |

本轮先只完成 DW-05；不要同时扩展成长、Agent 工作和新剧情。不要重写现有功能或另开播放器。

## 接手前

唯一根目录：`/Users/exasdwyh/Documents/VScode/vidu/desktop-companion`。
阅读 `../AGENTS.md`、本目录 README、PRODUCT、ARCHITECTURE、STATUS、TASKS，再读 [DW-05 当前记录](updates/2026-10-31-DW-05-chat-media.md)。

```bash
cd /Users/exasdwyh/Documents/VScode/vidu/desktop-companion
git status --short
bash scripts/project.sh check
```

工作树有大量前序任务修改，不能清空或整体覆盖。WorkBuddy 实际接手时在 TASKS 登记聊天标识。Codex 本轮交接后释放 DW-05 文件写入；后续修改同一文件需先协调。

交接时最新只读检查：88/88、错误 0、待办 8；Electron 核心源/包 27/28、Swift 素材/包 28/29，均有不一致，最终需构建核对，不能沿用上轮打包通过结论。

## P0-1：用用户真实原曲跑通翻唱

### 已做，不要重写

- UI：悬浮对话窗 → 唱歌 → 打开原曲 / 制作翻唱 / 取消 / 成品播放。
- `lib/cover-jobs.js` 已有原曲复制、参考音色准备、后台任务、阶段反馈、进程组取消、曲库持久化。
- `scripts/sing_cover_file.sh`：Demucs → Seed-VC → 混回伴奏。
- `scripts/sing_seedvc.py --singing` 已换为 44kHz F0 歌声模型，`auto_f0_adjust=False`，默认不移调。禁止以念歌词/TTS 冒充翻唱。
- Qwen 只生成女主参考音色短句；已有真实参考 `assets/whale-cover-test-20261030/qwen-reference.mp3`。
- 权重已下载到 `.models/seedvc`，下载日志在 `benchmarks/2026-10-30-DW-05-chat-media/svc-download.log`。先执行 `python3 scripts/fetch_svc_models.py --check`，不要盲目重下。

### 当前卡点

用户原曲已复制为 `assets/whale-cover-test-20261030/source-song.mp3`，原件保留；`source-24s.wav` 是从 35 秒开始的 24 秒片段。目录已忽略入库，不进入公开包。

第一轮加载歌声模型时缺 matplotlib，已修复，并回锁 `numpy==1.26.4`、`matplotlib==3.9.2`、`contourpy==1.3.1`。日志见该目录 `runtime-deps-pinned.log`。不要安装整套 CUDA requirements 或再拉 NumPy 2。

第二轮最后日志仍停在「[2/4] 分离人声/伴奏」，**尚无 cover 成品**。交接时旧 exec 会话已不可恢复，进程存活未知（当前沙箱 ps 被拒）。先检查实际进程、CPU 和中间文件；避免重复启动大任务。不能把模型存在或旧测试 PASS 写成真实翻唱成功。

确认没有重复任务后，使用新工作目录重跑，保留日志：

```bash
env FFMPEG=/Users/exasdwyh/bin/ffmpeg \
  SING_PYTHON=/Users/exasdwyh/Documents/VScode/vidu/.venvs/sing/bin/python \
  REF="$PWD/assets/whale-cover-test-20261030/qwen-reference.mp3" \
  WORK="$PWD/assets/whale-cover-test-20261030/work-retry-01" KEEP_WORK=1 \
  bash scripts/sing_cover_file.sh \
  assets/whale-cover-test-20261030/source-24s.wav \
  assets/whale-cover-test-20261030/cover-24s-svc.m4a \
  > assets/whale-cover-test-20261030/retry-01.log 2>&1
```

验收顺序：24 秒成品可解码、有可听人声和伴奏、时长/节奏匹配 → 给用户试听 → 若技术无故障再处理整首。记录硬件/耗时/实际模型；不要用改变默认音高来掩盖模型问题。最终还需通过应用入口制作、取消、播放一次，不能只做 CLI。

涉及文件：`scripts/{sing_cover_file.sh,sing_seedvc.py,fetch_svc_models.py}`、`MALFOY-ENGINE/lib/cover-jobs.js`、main/preload、companion-panel/composer、相关测试。

## P0-2：电子书原生导入验收

- 已支持 TXT/MD/EPUB，编码 UTF-8、UTF-16、GB18030；EPUB 按 spine 顺序读取。解析器 `MALFOY-ENGINE/lib/read-ebook.py`，4 项 Python 检查通过。
- 已有按段朗读、暂停/继续、停止、前后段，播放器真正 ended 才前进；reading.json 保存书，reading-progress.json 保存位置。
- 原生已验证粘贴两段 → 真实 Qwen 朗读 → 到第 2 段 → 重启读回；**打开电子书按钮可见，但原生文件选择器操作超时，尚未走完选择文件路径**。
- 用自建无隐私 TXT、EPUB 完成原生打开、导入、读完一段、暂停、重启续读。若窗口遮挡，先查原生文件对话框父窗口/焦点，不要另加 Web 文件选择路线。

## P0-3：聊天真实服务与打包

- 文字先返回、TTS 后到已改；chat-router 总预算 18 秒、单源 4.5 秒、失败冷却；IPC 外层 20 秒且取消 curl。
- 最近真实结果是 **18,012ms 连接失败**。Gateway 有 429/404/超时，本机 Ollama 当时未启动。不要宣称真实成功响应已优化到某个速度。
- 排查实际可用模型、端点、模型名与本机运行情况，不读取/打印个人凭据，不把失败伪装成聊天成功。记录成功回复延迟和 TTS 延迟各自数值。
- 当前 App 已构建包含新媒体入口。最新代码仍需核对源/包；构建继续用项目脚本，不修改 dist 内文件。

## 验证与交付约束

测试用 `LAN_DATA_DIR` 指向新临时目录；无个人配置时设 `HERMES_ENV_FILE=/dev/null`，启动前 unset NODE_OPTIONS、ELECTRON_RUN_AS_NODE。不要把 Swift 的 LINGDESK_DATA_DIR 当 Electron 隔离开关。禁止运行旧 verify-integration.sh。

上轮记录：Node 81/81、电子书 Python 4/4；它们不证明真实翻唱效果或文件选择器已通过。只为确认修复重跑相关检查，不反复跑大套测试耗时。

```bash
node --test Tests/chat-router.test.cjs Tests/cover-jobs.test.cjs Tests/companion-media.test.cjs Tests/reply-delivery.test.cjs Tests/companion-windows.test.cjs Tests/composer.test.cjs Tests/world-video.test.cjs MALFOY-ENGINE/test/*.test.js
python3 -m unittest discover -s Tests -p test_read_ebook.py
bash scripts/project.sh check
```

浏览器只用 Ego Lite；Electron 原生文件对话框需原生操作验证，不用其他浏览器替代。不要批量杀其他 App 或进程。

结果集中到 `docs/project/updates/` 和 `benchmarks/2026-10-31-DW-05-workbuddy/`，更新 STATUS、TASKS、CHANGELOG；按需补 DEVELOPMENT/ASSETS 的依赖、模型路径和本地素材说明。每项明确「已做/真实验证/未过」，给一个最终 App 路径和可试听文件路径。不要发散成新的整合方案。

## 可直接发给 WorkBuddy

> 接手 `/Users/exasdwyh/Documents/VScode/vidu/desktop-companion/docs/project/WORKBUDDY-HANDOFF.md`。用户已要求交接，先登记 DW-05 归属，按 P0-1 → P0-2 → P0-3 执行。代码和权重已有，先定位当前 Demucs 步骤，再用用户真实原曲完成翻唱，不重写系统、不用念歌词交差。同步验电子书原生打开和真实聊天服务；最后打包、更新统一文档并交付可试听成品。保留所有已有修改和个人数据隔离。DW-05 完成后才领取 DW-03 相册/剧情迁移。
