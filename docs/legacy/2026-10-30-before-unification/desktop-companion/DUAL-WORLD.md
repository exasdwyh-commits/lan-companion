# 双世界系统（Dual World）

> 设计：她的世界 ↔ 你的世界。召唤与归位，两套形象、两套音色、两套对话风格。

## 概念

| | 她的世界（world） | 你的世界（desktop） |
|---|---|---|
| 画面 | **程序化深海场景**（`world.html` canvas 实时渲染） | 2D Q版萌娘，全屏透明窗漫游 |
| 形象 | `whale.png`（半写实插画，96vh） | `whale-chibi.png`（Q版，40vh） |
| 音色 | 清冷优雅（`voiceProfiles.world`） | 活泼俏皮（`voiceProfiles.desktop`） |
| 对话 | 更精致、更有距离感 | 更跳脱、更闹 |
| 状态 | 她回去时"世界醒来" | 她来时"她的世界沉睡" |

## 交互

- **召唤她到桌面**（托盘菜单 / `malfoyHost.summon()`）
  - 关闭场景壁纸窗 → 她的世界沉睡
  - 开全屏透明角色窗 → 她出现在你的世界
  - 音色切到 `desktop`
- **让她回去休息**（托盘菜单 / `malfoyHost.returnHome()`）
  - 关闭角色窗
  - 重建场景壁纸窗 → 她的世界醒来
  - 音色切到 `world`

## 实现要点

### 场景：程序化渲染，不用视频
`web/live2d/world.html` 用 canvas 实时画，**纯 f(t)，天然无缝循环，零磁盘**：
- 5 段垂直渐变（`#16406e` → `#04060f`）＋顶部径向光
- 7 道柔化光柱（`ctx.filter = "blur(22px)"` + `lighter` 混合，正弦摆动）
- 26 个水面焦散椭圆（顶部横带，呼吸缩放）
- 190 个上漂微粒 + 26 个浮游光晕（确定性 hash，wrap 保证循环）
- 远处鲸影（贝塞尔：身体/尾鳍/胸鳍，alpha 0.055 + blur 6px）
- 海床微光 + 暗角

实测：2 秒间隔两帧差异 22.4% 像素（光柱/粒子/呼吸都在动）。

> 为什么不用 AI 视频：Agnes `agnes-video-2.5-flash` free 档任务排队 60s+ progress 恒为 0，且
> 生成的 5s 片段要额外做首尾帧对齐才能循环。程序化渲染确定性、免费、完美循环、可实时响应情绪。

### 窗口
- 场景窗：`type:"desktop"` 壁纸层（压在桌面图标下），不可交互
- 角色窗：`frame:false + transparent + hasShadow:false`，尺寸 = `display.bounds`（全屏覆盖）
  - **不要用 `setFullScreen(true)`** —— macOS 会切一个独立 Space，桌宠会跑到另一个桌面去
  - `setAlwaysOnTop(true,"floating")` + `setVisibleOnAllWorkspaces`
  - `setIgnoreMouseEvents(true,{forward:true})` 默认鼠标穿透，不挡桌面操作

### 漫游
`whale.html` 内 `setRoam(true)`：
- 每 4.2~7.2s 随机选目标 `(x:0.12~0.88, y:0.72~0.98)`
- 每帧缓动 `pos += (target-pos)*0.035/0.05`
- 到达后 `hop` 衰减 → 落地弹跳
- 位置写 `left/bottom` 百分比，`translate(-50%,...)` 居中

### 音色切换
`data.js` 的 `persona.voiceProfiles.{world,desktop}.instruct`；
`main.js` 的 `getTtsInstruct()` 按 `currentMode` 取；
Qwen3-TTS 1.7B **VoiceDesign** 用这段文字描述实时生成音色，所以切换是"换描述"而非"换模型"。

### 形象切换
`whale.html` 的 `setMode(mode)`：`desktop → whale-chibi.png`，`world → whale.png`。
主进程在角色窗 `did-finish-load` 时推 `character:mode`。

## 美术规格

Q版立绘（`whale-chibi.png`）—— 以 DeepSeek 鲸鱼娘官方 Q 版为参考：
- 角色设定（必须保持）：深海军蓝长发、白色蕾丝头饰、侧边蓝蝴蝶结、鲸鳍耳、鲸尾、
  海军蓝女仆装+白色蕾丝边、白围裙上有蓝色鲸鱼徽、黑鞋
- 生成：Agnes `agnes-image-2.5-flash`，**图生图**（`/v1/images/generations` 的 `image` 字段传 data URI）
  - 注意：`image_url` / `reference_image` 字段会报 "not supported by text image queue"，只有 `image` 可用
  - `/v1/images/edits` 端点返回 503，不可用
- 抠像：边界种子 flood fill（`thresh=110`，种子要覆盖四角+四边中点+底边两侧）+ 全局 despill（G 压到 max(R,B)）
- 模型会在脚下偷偷加投影，阈值不够大会留深绿椭圆
- 成品：544×952，透明 PNG

## 已验证

| 项 | 结果 |
|---|---|
| world 模式聊天 | `mode:world, voice:她的世界, tts:qwen3` ✅ |
| summon 后 | 场景窗关闭，chibi 全屏 1512×859，`roaming:true` ✅ |
| 漫游轨迹 | `33.8%→35.5%→49.9%` 横向移动 ✅ |
| desktop 模式聊天 | `mode:desktop, voice:你的世界, tts:qwen3` ✅ |
| return 后 | chibi 窗关闭，场景壁纸窗重建 ✅ |
| 归位后聊天 | `mode:world, voice:她的世界` ✅ |
| 透明背景 | `getComputedStyle(body).backgroundColor = rgba(0,0,0,0)` ✅ |

## 待办

- [ ] 场景视频（她的世界）还没接进这套 —— 现在 `wall` 用的是 malfoy 原始场景，需要换成鲸鱼娘的海底场景
- [ ] Q版只有 1 个姿势（standing），需要补：走路、坐下、睡觉、开心、被戳
- [ ] 角色窗鼠标穿透时点不到她 —— 需要 hover 检测切回 `setIgnoreMouseEvents(false)`
