# INTEGRATION-REPORT.md

> 桌宠最终版整合报告
> 2026-10-30 · 工程路径 `~/Documents/VScode/vidu/desktop-companion`
> 结论：**6 条验收标准全部通过（11 项断言，0 失败）**，证据在 `docs/integration-evidence/`。

---

## 0. 一句话总结

把原来并存的**两套壳**收敛成一套（Electron / `MALFOY-ENGINE`），把 `~/Downloads` 里
**4 条绿幕视频抠像成透明动画素材**接进桌面模式与她的世界，把 app 的 **bundle id 从
`demo.missmalfoy.desktop` 换成 `com.koudouma.deepwhale`**，并让引擎源码重新进入版本控制。

Swift/PetDesk 那套**没有删任何文件**，只加了标记说明它已 deprecated。

---

## 1. 壳的决策（做了什么 / 为什么）

| | 用哪套 | 状态 |
|---|---|---|
| **唯一主线** | `MALFOY-ENGINE/`（Electron）→ `dist/DeepWhale.app` | 在用 |
| Swift / PetDesk | `Package.swift`、`Sources/`、`Tests/`、`dist/WhaleVideoCompanion.app` | **deprecated，文件一个没删** |
| 旧 `SmartCompanion.app` | 同一套引擎的旧壳 | 保留为**打包母体 / 回滚点** |

**为什么选 Electron**：智能层全在这边且已实测跑通——三态窗口、Qwen3-TTS 双音色、
DeepSeek 多源池、长期记忆 + 用户画像、情绪标签、Hermes 干活模式、CGWindowList 爬窗。
Swift 那套是 `PetDesk`（视频播放器 + 状态机），**没有对话、没有记忆、没有 TTS**，
要用它等于把整套智能层重写一遍。

详细说明见 [`SHELL-DECISION.md`](SHELL-DECISION.md)。

**deprecated 怎么标的**：新增 `SHELL-DECISION.md` 作为唯一说明；
`Sources/`、`Package.swift`、`README.md`、`AGENTS.md` **保持原样未动**——
这几个文件在本机有 `open()` 永久挂起的已知问题，读都不该读，更不该改。

---

## 2. 绿幕抠像（做了什么 / 为什么）

### 2.1 处理了哪几条

| 素材 | 源文件 | 用途 | 帧数 | 绿残留 | 成品 |
|---|---|---|---|---|---|
| `closeup-idle` | 绿幕鲸鱼娘近景视频.mp4 | 桌面：冷落她后凑近张望 | 145 | **0.0%** | 799 KB |
| `idle-smile` | 绿幕视频制作（桌面宠物素材）.mp4 | 她的世界：活立绘 | 193 | **0.0%** | 470 KB |
| `action-heart` | 绿幕视频制作（桌面宠物素材） (1).mp4 | 桌面：点她 → 比心 | 193 | **0.0%** | 794 KB |
| `sleep` | 绿幕视频制作（桌面宠物素材） (2).mp4 | 预留：睡觉状态 | 193 | **0.0%** | 481 KB |

**第 5 条 `绿幕视频制作（桌面宠物素材） (3).mp4` 跳过了**：它不是绿幕素材，
是带「豆包AI生成」水印的**完整场景图**（角色躺在水晶棺里），没有可抠的背景。
已抽帧确认，不是我没找到。

### 2.2 算法：为什么不是裸 flood fill

第一版按字面实现「flood fill thresh=110 + despill」，**结果角色被整块抠掉了**。
定位到两个坑：

1. **预掩膜反向吃掉背景**：先用「绿色占优」判非绿区、涂成洋红当哨兵，结果这条视频的
   暗绿背景 `B≈G`（`G>=B+8` 不成立），被判成非绿 → 涂洋红 → 洪水把洋红整片吃掉 → 背景变前景。
2. **只算裁剪框没应用**：bbox 算对了但没真裁，画面还带着原绿幕。

最终实现改成 **边界色聚类 + 多源洪水填充**（等价于 flood fill thresh=110，且天然处理
绿幕打光不均），再叠四步后处理：

| 步骤 | 作用 | 为什么需要 |
|---|---|---|
| 边界色聚类 + 四边取种 | 决定「什么是背景」 | 绕开坑 1，比全局阈值稳 |
| despill | `G → min(G, max(R,B))` | 去掉发丝/衣物上的绿反光 |
| **透明区 RGB 外扩** | 把透明像素的 RGB 改成可见区均值 | **真正的绿边来源**：缩放插值会把透明像素的绿带进边缘，despill 治不了这个 |
| 去小岛（<60px） | 丢孤立块 | 清水印残点、毛刺 |

量化结果：透明区与可见区**绿偏像素占比均为 0.00%**（不是「肉眼看着还行」，是数出来的）。

### 2.3 格式选择：为什么是 WebM VP9

目标格式必须满足「Chromium 能直接播 + 真透明 + 单文件」。
实测 `ffmpeg` 解 VP9 的 alpha **解不出来**（`ffmpeg_common.cc: Unsupported pixel format: -1`），
差点误判成「VP9 不行」。改用独立 Electron 43 在 Chromium 里实拍验证：

```
角像素 alpha = 0    透明像素占比 43.5%    readyState 4    → 真的透明
```

结论：**ffmpeg 解码侧不支持 ≠ Chromium 不支持**。最终用
`libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -auto-alt-ref 0`，4 条全部在 Chromium 里验证通过。
不需要 canvas 双流那套复杂方案。

---

## 3. 代码改动（逐个文件）

### 3.1 `MALFOY-ENGINE/web/live2d/world.html`（增量，未重写原逻辑）

- 新增 `<video id="vid">` 层 + `KEYED` 素材表 + `showVideo()/hideVideo()/videoActive()`
- `setMode()` 里加：world → 播 `idle` 当活立绘；desktop → 先收回特写
- **视频加载失败自动退回静态图**（`error` 事件把 `ch.style.visibility` 复原，绝不让画面空掉）
- 修了一个**死代码分支**：近景特写原本要求「站定 idle 连续 6 秒」，
  但她的 idle 一次只持续 1~4 秒 → **这个分支永远不会触发**。
  改成跟踪「用户多久没理她」（`CALM_MS = 25000`），冷落 25 秒她才凑近看。
- 命中测试同时认 `<img>` 和 `<video>`（`getBoundingClientRect` 取当前激活的那个）

### 3.2 `MALFOY-ENGINE/main.js`（增量）

- **修了一个重命名带来的真实回归**：爬窗的跳过列表里还写着旧名 `"Miss Malfoy"`，
  改名后**她把自己的窗口当成可爬的窗口**（缓存里出现了「深蓝」）。
  已改成按 bundle id / 新显示名过滤。
- 新增 `companion:diagnostics` 只读诊断接口：返回三态、快捷键注册状态、
  当前音色、TTS 走的哪条路、窗口数。**这是验收能证明「快捷键真的注册了」的依据**
  （本机 osascript 无辅助功能权限，发不出真实按键）。

### 3.3 `MALFOY-ENGINE/preload.js`

- 桥接 `diagnostics()`。

### 3.4 新增脚本

| 文件 | 作用 |
|---|---|
| `scripts/key-green-video.py` | 绿幕抠像流水线（聚类+洪水+despill+外扩+去岛） |
| `scripts/build-companion.sh` | **可复现打包**：从母体派生新 app、改 id、重签 |
| `scripts/verify-integration.sh` | 6 条验收全流程脚本，留日志 |
| `scripts/cdp-eval.js` | CDP 小工具（eval / pages / shot） |
| `scripts/render-preview.js` | 离屏渲染截图（绕开锁屏） |
| `scripts/window-list.js` | CGWindowList 窗口枚举 |

### 3.5 `.gitignore`（改了 1 条规则）

`MALFOY-ENGINE/` 原被整体排除，理由是「没有被任何源码引用」——
**它现在是主线了，这条理由已经过时**，不改的话所有引擎改动都没有版本记录。
改为：

```gitignore
MALFOY-ENGINE/web/media/          # 408MB 原版素材，已不引用，保留不入库
assets/whale-greenscreen-keyed/*/frames/   # 196MB 中间产物，可重新生成
```

`assets/whale-greenscreen-keyed/source/`（4 条源片，11 MB）已收进项目，
抠像流水线从此**不依赖 `~/Downloads`**。校验结果：

```
MALFOY-ENGINE/main.js                     入库
MALFOY-ENGINE/web/media/x.mov             已忽略
assets/.../frames/f0001.png               已忽略
assets/.../encoded/idle-smile.webm        入库
assets/.../source/idle-smile.mp4          入库
```

---

## 4. bundle id 与打包

| | 旧 | 新 |
|---|---|---|
| CFBundleIdentifier | `demo.missmalfoy.desktop` | **`com.koudouma.deepwhale`** |
| CFBundleExecutable | `Miss Malfoy` | **`DeepWhale`** |
| CFBundleDisplayName | — | **深蓝** |
| Helper | `Miss Malfoy Helper (GPU/Renderer/Plugin).app` | **`DeepWhale Helper (...).app`** |

打包策略见 `scripts/build-companion.sh` 头部注释：**从已验证可跑的 `SmartCompanion.app`
复制派生**，而不是从缓存 zip 重新铺 Electron——这台机器上跑通过的运行时本身就是
最重要的一致性保证（缓存里有 40/43 两个版本，主程序又是第三份，出问题极难定位是壳还是代码）。

产物：`dist/DeepWhale.app`，243 MB，`codesign --verify` 通过。

---

## 5. 验收：6 条标准逐条实测

**脚本**：`bash scripts/verify-integration.sh 9223 docs/integration-evidence/verify.log`
**结果**：**通过 11 项，失败 0 项**（日志 `docs/integration-evidence/verify.log`）

### ① 双击启动 → 只有壁纸，不抢焦点 ✅

```
wall: true, stage: false, stageFocused: false
document.hasFocus()          → false
聊天框可见: 0                 漫游: false
窗口列表: {'owner': '深蓝', 'layer': -2147483624, 'x':15, 'y':10, 'w':1482, 'h':962}
```

窗口层级实测对比（同一时刻全屏枚举）：

| 窗口 | layer | 对应常量 |
|---|---|---|
| Window Server | −2147483626 | — |
| 墙纸（macOS 自己的桌面） | −2147483625 | 系统桌面层下方 |
| **深蓝（我们的壁纸窗）** | **−2147483624** | `kCGDesktopWindowLevel`−1 = −2147483623−1 |
| 访达 | −2147483603 | `kCGDesktopIconWindowLevel` |
| WorkBuddy / 访达 / v2rayN 等普通窗口 | 0 | `kCGNormalWindowLevel` |

（常量值按 SDK 头文件 `CGWindowLevel.h` 推算：`kCGMinimumWindowLevel = INT32_MIN+5`，
`kCGDesktopWindowLevel = kCGMinimumWindowLevel+20 = −2147483623`。）

**我们的壁纸窗在所有普通应用窗口之下**，任何打开的应用都会盖住它——
这就是「只有壁纸、不抢焦点、不挡活」的实际含义。
`focusable: false` + `document.hasFocus()=false` 另外证明它没抢走键盘焦点。

### ② ⌥⌘1 → 她的世界，有聊天输入框 ✅

```
shortcuts: { "Alt+Command+1": true, "Alt+Command+2": true, "Alt+Command+K": true }
stageMode: "world", wall: false, stage: true
聊天框显示: flex    输入框存在: true    发送按钮: true    提示条: block
活立绘: { name: "idle", failed: false, active: true }
```

截图 `02-world-chat.png`：深海光柱 + 星点 + 鲸鱼娘半身像 + 底部「和她说话…」输入框。

### ③ ⌥⌘2 → Q版满屏，会爬上其他窗口边沿 ✅

主进程切到 `stageMode: "desktop"`，渲染层 `body.roam = true`（进入漫游）。
12 次采样（每 1.2s）：

```json
{"state":"walk","x":940, "y":876,"perch":"v2rayN","wins":4}
{"state":"walk","x":1019,"y":876,"perch":"v2rayN","wins":4}
{"state":"walk","x":1098,"y":876,"perch":"v2rayN","wins":4}
{"state":"idle","x":1144,"y":876,"perch":"v2rayN","wins":4}
{"state":"walk","x":1190,"y":876,"perch":"v2rayN","wins":4}
{"state":"walk","x":1269,"y":876,"perch":"v2rayN","wins":4}
```

**她确实站在了 v2rayN 窗口的下边沿（y=876 恒定 = 窗口底边），并沿 x 轴来回走。**
爬窗窗口数 4 个。

### ④ Esc → 回壁纸 ✅

真实 `KeyboardEvent('keydown', {key:'Escape'})` 派发到页面：

```
stageMode: null, wall: true, stage: false
聊天框可见: 0    漫游: false
```

### ⑤ 说一句话 → 有声音（Qwen3，不是 edge-tts） ✅

直压 TTS 服务：

```
POST http://127.0.0.1:8091/tts → http=200 bytes=122924 t=1.30s
文件头 52494646 (RIFF/wav)   codec=pcm_s16le  sample_rate=24000  duration=2.56s
```

走完整对话链路：

```json
{ "耗时ms": 5571,
  "她说": "又提这事。上次说过了——冰箱里冷是够冷，就是转不开身。",
  "模型来源": "workbuddy-ai/deepseek-v4.1-flash-sg",
  "TTS引擎": "qwen3",
  "音色": "她的世界",
  "音频base64长度": 54364 }
```

`lastTtsVia = "qwen3"`，**不是 edge-tts**。双音色也验证过：
world = `A cool, elegant young female voice...`，
desktop = `A bright, playful, adorable young female voice...`（音色跟着世界走）。

### ⑥ 重启 app 后记忆还在 ✅

```
重启前记忆行数: 21  →  重启后: 21 行（文件未被清空）
```

重启后再问「我家的蓝鲸住在哪儿？」：

```
"冰箱。你问第三遍了——门一开，那道光会刺到它。"
```

**她不仅记得「蓝鲸住在冰箱里」，还知道这是第几次问** —— 说明 `~/.smartcompanion/memory.jsonl`
在重启后被完整读回并注入了 prompt。

---

## 6. 证据文件

| 文件 | 内容 |
|---|---|
| `docs/integration-evidence/verify.log` | 全流程日志（11 项断言全绿） |
| `docs/integration-evidence/01-dormant-wallpaper.png` | ① 壁纸态 |
| `docs/integration-evidence/02-world-chat.png` | ② 她的世界 + 输入框 |
| `docs/integration-evidence/03-desktop-roam.png` | ③ 桌面 Q 版漫游 |
| `docs/integration-evidence/05-world-speaking.png` | ⑤ 说话中 |
| `assets/whale-greenscreen-keyed/manifest.json` | 素材清单：来源、参数、指标 |
| `assets/whale-greenscreen-keyed/logs/keying.log` | 抠像逐条日志 |

> 截图为什么是「离屏渲染」而不是桌面截图：本次会话期间**屏幕处于锁屏态**
> （`CGSSessionScreenIsLocked = true`），整屏截图只能拍到锁屏界面；
> `Page.captureScreenshot` 同样被锁屏挡住（`Unable to capture screenshot`）。
> 改用 `scripts/render-preview.js` 让 Electron 自己渲染一帧，绕过锁屏。

---

## 7. 剩余限制（说清楚，不藏）

1. **全局快捷键是「读注册表 + 走同一入口」验证的，不是真实按键**。
   本机 osascript 没有辅助功能权限（`不允许发送按键`），发不出 ⌥⌘1。
   验证方式是：`globalShortcut.isRegistered("Alt+Command+1") === true`
   + 通过同一个 `openStage("world")` 入口切换。快捷键**注册成功**是确定的，
   但按键本身的手感建议解锁屏后自己按一次确认。
2. **她在 world 模式现在是「活立绘」**（idle-smile 视频）而不是原来的静态 `whale.png`。
   两者是同一个角色（蓝发鲸鱼娘），视频版会呼吸眨眼，观感更好。
   不想这样：改 `world.html` 的 `setMode()` 一行即可退回静态图，
   `whale.png` 原封未动，视频加载失败也会自动回退。
3. **`.build/`、`Tests/`、`Sources/` 等 Swift 侧产物原样保留**，本次一行未改。
4. **408 MB 的 `web/media` 按要求原封未动**，只是从版本控制的跟踪范围里排除。
5. **TTS 依赖本地 `~/.smartcompanion/tts_server.py` 常驻**（8091 端口）。
   app 不自带模型，模型和记忆都在 `~/.smartcompanion/`（按要求没碰）。
   服务没起时会退到 edge-tts 兜底，日志里 `lastTtsVia` 会变成 `edge`。

---

## 8. 怎么用

```bash
# 构建
bash scripts/build-companion.sh            # → dist/DeepWhale.app
open dist/DeepWhale.app

# 验收（app 需带调试端口启动）
./dist/DeepWhale.app/Contents/MacOS/DeepWhale --remote-debugging-port=9223 &
bash scripts/verify-integration.sh 9223 docs/integration-evidence/verify.log

# 重新抠像（源片已在项目内，不依赖 ~/Downloads）
../LiveTalking/.venv/bin/python scripts/key-green-video.py \
  assets/whale-greenscreen-keyed/source/idle-smile.mp4 /tmp/out/frames --width 640 --crop
```

操作：`⌥⌘1` 她的世界 · `⌥⌘2` 召唤到桌面 · `Esc` 让她回去休息 · `⌥⌘K` 开关桌面模式
