> 历史/专题资料（2026-10-30 已统一）：当前方向、主线、状态与任务以 [统一项目中心](docs/project/README.md) 为准。下文保留原阶段记录，其中数量、运行入口和完成结论需按现状复核。

# 澜 · 桌面互动样板

## 打开

最终入口：`dist/DeepseaCompanion.app`，双击运行。当前方向是**年轻成年女性、真人写实、黑长直、自然淡妆、白色现代便装、近距离聊天构图**；人物与背景独立。早期二次元整张场景只保留为探索稿。

- 点场景：本地短句回应和轻微视觉反馈，无需模型。
- **聊一会**：输入文字，按回车或点“说”发送。
- **停止**：取消正在等待的回复。隐藏、清空对话也会取消。
- **对话**：查看和复制完整对话；气泡只展示有限行数。
- **换背景**：选本机 PNG / JPG / HEIC 图片或 MP4 / MOV 循环视频。背景视频默认静音；此次选择只用于当前运行，重开恢复默认背景。
- 右上角声音图标：静音 / 打开系统语音。
- 右上角 ⚙：设置本地 Ollama 或兼容 OpenAI 的模型地址、模型名、密钥。
- 右上角 ×：隐藏；再次双击应用或菜单栏 ✨ →“显示 / 隐藏桌宠”恢复。
- 拖动人物：单独移动人物；拖动背景：移动整个窗口。
- 右键菜单：“人物放大 / 缩小”独立调整人物；“大一点 / 小一点”调整整个窗口；还可恢复默认背景、设置和清空记录。

这是文字输入样板，尚无麦克风输入。系统语音不等于定制角色音色。当前人物是 AI 生成的真人写实静态 PNG，加轻微图层移动和点击明暗反馈，**没有真实人物录像、骨骼动作或口型同步**。默认背景是独立静态图片，可以自行换成循环视频。不具备屏幕感知、真实物理触摸或长程记忆。

## 模型和数据

沿用 `~/Library/Application Support/LingDesk/settings.json` 中已有模型设置，不更改原配置。请求时使用此素材包的人设，不把 API Key 写进素材或对话。

本次实测：本机 `deepseek-r1:7b`，Ollama 地址 `http://127.0.0.1:11434/v1`。模型服务必须运行；没有连接时仍可点场景互动，聊天会展示连接错误并提示设置。可通过已有 `/Applications/Ollama.app` 启动服务。冷启动可能慢，界面提供“停止”。

新样板对话保存在 `history-deepsea.json`，旧桌宠仍使用 `history-pet.json`。窗口位置保存在 `deepsea-window.json`，人物的位置和尺寸保存在 `deepsea-placement.json`。`--data /path` 可使用完全独立的数据目录。

## 源码 / 构建

```sh
cd /Users/exasdwyh/Documents/VScode/vidu/desktop-companion
bash scripts/build-deepsea.sh
open dist/DeepseaCompanion.app
```

包使用本机 ad-hoc 签名，未做公证。构建脚本会验证签名，并在构建、签名成功后更新产物。

素材：`assets/deepsea-sample/`。

- `reference-modern.png`：当前用户提供的现代黑长直人物风格参考。
- `reference.png`：早期蓝发二次元角色参考，保留作历史稿。
- `character-master-greenscreen.png`：当前青春写实、近景半身绿幕母版，供视频制作。
- `character.png`：对应的透明展示版，应用实际使用。
- `background.png`：无人物的独立海边房间背景。
- `scene.png` / `character-anime-v1.png`：早期二次元探索稿，不是当前视频制作母版。
- `character.json`：名字、模型人设、问候、点击短句。
- `modern-green-prompt.txt` / `modern-cutout-prompt.txt` / `YOUTH-VIDEO-PROMPTS.md`：当前现代写实妆造、生图和透明版实际提示词及可复用的视频提示词。
- `character-master-blue-fantasy-v2.png` / `character-blue-fantasy-v2.png` / `young-*-prompt.txt`：上一版蓝发幻想造型备份。
- `realistic-generation.json`：第一版成熟角色的生成记录；不作为当前人设。
- `prompt.txt` / `generation.json` / `layer-prompts.json`：早期场景和分层探索提示词。

下一步视频制作请看 `MUSE-LAYERED-HANDOFF.md`：以近景绿幕母版为统一人物，背景单独生成，人物视频抠像后再合成。**当前应用支持背景视频＋透明人物图片，尚不支持人物绿幕视频的实时抠像或透明动作视频播放**。原先全场景视频播放器继续保留给旧素材包；新分层素材包不会误把整张视频盖在人像上。说话口型还需要单独接回现有 LiveTalking 渲染链路并检查脸部一致性。

## 为什么之前不能点

马尔福 Electron 版默认是 `type: "desktop"` 的壁纸窗口，不能直接接收桌面点击；需从菜单栏打开“和她互动…”。这次样板使用独立浮窗并提供明确聊天按钮。

同时修复了原生 PetDesk 隐藏后恢复不播放、异步旧回复在取消/清空后写回、输入框结束编辑时误发消息的问题。

## 验证

```sh
bash scripts/check-pet.sh
```

隔离 fixture 检查只验证请求、状态和生命周期；不能证明模型质量。结果见 `benchmarks/deepsea-sample-2026-10-29/lifecycle.json`。真实本地模型和原生 UI 的检查另记于同目录报告。
