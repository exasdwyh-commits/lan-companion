# Malfoy Desktop 程序架构拆解 → LingDesk 改造清单

> 配套 [MALFOY-LESSONS.md](MALFOY-LESSONS.md)（那份是**素材/视频生成**方法论）。
> 这份只看**桌面程序本身**：播放层、窗口层、状态机、数据层、留存系统、打包、测试。
> 源码参照：`op7418/malfoy-desktop` 技术文档 §6（桌面程序），2026-10-29 通读。

---

## 0. 一句话结论

Malfoy 是个 **"带状态机的四层视频合成器 + 一个数据驱动的剧情/好感/相册系统"**，
Electron 只是它的壳。LingDesk 现在是 **"单 player 换片 + 一个聊天框"**，
差距不在渲染技术，而在**"分层合成"和"生活感调度"这两件事上完全没做**。

按 ROI 排序，最该动的三件事：

| # | 改造 | 现状问题 | 感知提升 |
|---|---|---|---|
| 1 | SceneController 改四层合成 | 换片硬切、循环跳帧、尾帧糊 | ★★★★★ 立刻"像个活人" |
| 2 | 加 IdleDirector（空闲调度 + 作息） | 只在等消息时动，其余时间死循环 | ★★★★★ |
| 3 | 桌面窗改逐像素命中 → 能点她 | `ignoresMouseEvents = true`，点不到 | ★★★★★ |

其余（好感度、剧情播放器、数据驱动打包、分发）是第二梯队，见 §3–§6。

---

## 1. 播放层：单 player → 四层舞台（最核心改造）

### Malfoy 的做法

舞台从下往上叠 5 个 video/静帧元素，**永远不换片，只换谁在前**：

```
#still   静帧（锚点图，兜底）          ← 底
#amb     静止循环 A   ┐ 双元素轮换，0.6s 交叉淡化
#amb2    静止循环 B   ┘
#va      动作视频 A   ┐ 双元素轮换，0.25s 淡入
#vb      动作视频 B   ┘
```

三条硬规则，全都是踩坑踩出来的：

1. **动作片段不播到最后一帧**。抖音系视频模型尾帧画质崩（实测 blurdetect：首帧 696KB → 末帧 101KB；
   D3 从 756KB 掉到 44KB）。所以 `duration − 0.5s` 起用 0.45s 淡出，露出底下的静止循环。
2. **静止循环要"加权轮换"**，不是单段 loop。沙发场景列表是 `[D8, D8, D9]` ——
   D8 偶尔翻书、D9 完全不动，2:1 的概率让"生活感"出来；单段 loop 会看出循环点。
3. **循环片段自己做无缝**：取 0.6–14.6s，头尾 0.6s 交叉淡化（接缝差 0.75，单帧最大变化 0.93）。
   局部动态（壁炉火光）用运动热图（逐像素时间标准差）找唯一活动区域 → 羽化遮罩叠静帧（σ=60）。

### 我们的现状

`Sources/LingDesk/SceneController.swift`：一个 `AVQueuePlayer` + `AVPlayerLooper`，
`load()` 直接 `removeAllItems()` 换片。后果：

- 每次 `showIdle() / load(think) / load(reply)` 都是硬切，黑一帧
- `AVPlayerLooper` 把整段循环，首尾不接就是肉眼可见的跳
- 尾帧糊的问题已经在 `CHARACTER-SPEC-01` 记了，**代码里没实现**
- 没有静帧兜底层（`VideoSurface` 背景是黑的 → 素材缺失/解码失败 = 黑屏）

### 改造方案（Swift 版，比 JS 更好做）

```
CompositorView (NSView)
 ├─ stillLayer:  CALayer + 静帧 PNG        ← 永远在最底，alpha 1
 ├─ ambA / ambB: 两个 AVPlayerLayer         ← 轮换，opacity 用 CABasicAnimation
 └─ actA / actB: 两个 AVPlayerLayer         ← 动作，轮换
```

要点：

- **淡入淡出不要用 SwiftUI `.opacity` + `withAnimation`** —— 它跟显示刷新走，
  和 AVPlayer 的时钟对不齐，慢帧时会看出"闪一下"。直接对 `AVPlayerLayer.opacity`
  挂 `CABasicAnimation(duration: 0.6)`，由 Core Animation 在合成器里插值，稳。
- **尾帧淡出的触发点用 `addPeriodicTimeObserver`**（0.05s 粒度），条件
  `currentTime >= duration - 0.5` 就启动淡出，并立刻把 amb 层切到目标场景的循环。
  不要用 `AVPlayerItemDidPlayToEndTime` —— 那时候已经晚了，尾帧已经显示了。
- **`AVPlayerLooper` 只用于 amb 层**（本来就是循环语义），act 层永远不用 looper。
- **静帧层必须有**。它同时解决三件事：首次冷启动的黑场、素材缺失兜底、循环生成失败兜底。
- **静帧层不能直接塞 jpg。**（2026-10-29 实测）锚点图是 full-range JPEG，
  视频帧是 limited-range yuv420p，同一画面两者亮度差约 **4.3/255**。
  淡出时动作层露出静帧，整体会突然亮一档，在暗部场景（这套素材平均 luma 只有 50）肉眼可见。
  解法二选一：
  ① 把锚点图封成 1 帧的 mp4 / HEVC 视频，走和视频完全相同的解码管线；
  ② 保留 PNG，但用 CIFilter 或 `AVVideoComposition` 做 16–235 → 0–255 的映射补偿。
  **建议 ①**，省掉后续所有色彩对齐的心智负担。

### 顺带要改的素材侧

- 我们桌宠窗口是小窗（不是全屏壁纸），**待机循环做 1080p 足够，不要 4K**。
  Malfoy 用 4K 是因为 `type:"desktop"` 全屏铺桌面；我们铺满屏也不到 1440p 逻辑像素。
  实测：`ambient-sofa-a` 4K 43MB → 1080p crf20 **3.9MB（1/11）**，肉眼无损。
- 出片后加一道 `blurdetect` 检查：首末帧清晰度差 > 30% 就重生成，别指望播放端兜。

---

## 2. 窗口与交互：我们现在是"能看不能碰"

### Malfoy 的妥协

macOS 壁纸层 `type:"desktop"` 的点击会被 **Finder 接走**，所以它干脆放弃交互：
壁纸窗只播（`?mode=wallpaper`，无菜单无点击区），
菜单栏 🐍 选「和她互动…」→ 关壁纸窗、开一个**铺满工作区的普通窗口**跑 `?mode=interactive`，
Esc 或菜单切回。两窗同源共用 localStorage，靠 `storage` 事件同步。

这是个**为了绕开 Finder 而做的产品级妥协** —— 用户想点她，得先点菜单栏、再进全屏模式，体验断裂。

### 我们其实不用妥协

`SceneController.showDesktop()` 现在 `ignoresMouseEvents = true` —— 整个窗口穿透，
所以现在完全点不到。但 AppKit 能做 Electron 做不了的事：**逐像素命中测试**。

改造：把桌面窗换成 **浮动窗 + alpha mask 命中**

```swift
window.isOpaque = false
window.backgroundColor = .clear
window.hasShadow = false
window.level = .floating            // 或 .statusBar-1，看要不要压住普通窗口
window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
window.ignoresMouseEvents = false   // 关键：不整体穿透
```

然后 `contentView` 的 `hitTest(_:)` 里做点查询：

```swift
override func hitTest(_ point: NSPoint) -> NSView? {
    guard bounds.contains(point) else { return nil }
    guard alphaMask.hit(convert(point, to: maskView)) else { return nil }  // 透明处返回 nil
    return super.hitTest(point)   // 命中人物 → 我可以收点击
}
```

- alpha mask 从 `character-master.png` 生成一次（阈值 alpha > 0.05，转 1-bit 位图缓存），
  每帧点查询 O(1)。视频播放时人物位置基本固定，用静帧 mask 近似足够；
  位置变化大就按 clip 存一份 mask（`idle-01.mask`）。
- 透明区域返回 `nil` → 点击直接落到桌面/下层 App，桌面图标照常能点。
- 这样得到的是**真正的桌宠**：她站在桌面上、能点、能拖、不挡操作。
  比 Malfoy 的"壁纸模式 / 互动模式"两段式体验高一档。

### 建议的产品分层

| 模式 | 窗口 | 交互 | 用途 |
|---|---|---|---|
| 桌宠模式（默认） | floating 透明窗 + alpha 命中 | 点/拖/右键菜单 | 日常陪伴 |
| 壁纸模式 | desktop level，全穿透 | 无 | 不想被打扰、纯氛围 |
| 沉浸模式 | 全屏普通窗 | 全交互 + 剧情 | 看章节 |

Malfoy 只有后两种，第一种才是"桌宠"。

---

## 3. 状态机：从"换片"到"生活感"

### Malfoy 的状态机（技术文档 §6.3）

```
启动 ─(有入场)─► 黑场 → 空房间静帧 → 入场片段 → 淡入静止循环
     └(noenter)──────────────────────────────► 静止循环
静止循环 ──每 10–24s──► 23 点后且有睡眠片段？ ─是─► 睡眠片段 → 睡眠循环（sleeping）
                                              └否─► 随机待机动作（D2/D3/D7）→ 静止循环
点她（非动作中）─► 冷却外：播反应片段 + 台词气泡 + 好感 +1
                  冷却内：只出台词气泡
剧情/冥想盆 ─► 播放器（暂停静止循环与 BGM）─► 关闭后恢复
换装 ─► 黑场 → 新场景入场片段 → 新场景循环
```

### 我们的现状

`CompanionModel` 只有三个"状态"的函数：`showIdle()` / `load(.think)` / `load(reply)`。
**没有空闲调度，没有时间感知，没有入场，没有点击反应，没有冷却。**
所以现在的观感是"一段视频在循环"，不是"她在过日子"。

### 改造：加 `IdleDirector`

```swift
@MainActor final class IdleDirector {
    enum State { case booting, entering, ambient, acting, sleeping, replying, story }
    private(set) var state: State = .booting
    private var timer: Timer?
    // 场景配置来自素材包（见 §4），不写死
}
```

必须有的参数（照抄 Malfoy 的量级，别自己拍）：

| 参数 | 值 | 说明 |
|---|---|---|
| 待机动作间隔 | 10–24s 随机 | 均匀分布即可，别用固定 15s |
| 点击冷却 | 45s | 冷却内仍出台词气泡，只是不放动作片段 |
| 睡眠触发 | 23:00 后 且 有 sleep 素材 | 醒来点她 → 黑场 → 回循环 |
| 动作片段权重 | 常见动作 2 : 完全不动 1 | 太爱动反而假 |
| 回复后回位 | 播完 → idle，不叠加 | 用 `onFinish`，我们已有 |

**时间感知是低成本高感知的**：早上「你醒了」、深夜压低音量、23 点后困。
一行 `Calendar.current.component(.hour, from: .now)` 换一句台词，成本几行代码。

---

## 4. 数据层：data.js 的思路值得抄，但别抄它"全塞一个文件"

### Malfoy

`data.js` 一个文件装：素材路径、台词、字幕时间、解锁阈值、章节 flow。
程序（`app.js`）只做解释。好处是换角色 = 改数据，不用碰逻辑。

### 我们的现状

`AssetSlot` 是**硬编码枚举**（7 个 slot，固定文件名），`persona` 是一个字符串。
换角色 = 换文件夹，但**换行为 = 改代码**。

### 改造：素材包里加两个数据文件

```
character-pack/
 ├─ character-master.png
 ├─ idle-01.mp4
 ├─ character.json          （已有：engine_avatar）
 ├─ scenes.json             ← 新增
 └─ dialogue.json           ← 新增
```

`scenes.json`（对应 §1 的合成器 + §3 的调度）：

```json
{
  "schema_version": 1,
  "scenes": [
    { "id": "livingroom", "anchor": "anchor-sofa.png",
      "ambient": ["amb-sofa-a.mp4", "amb-sofa-a.mp4", "amb-sofa-b.mp4"],
      "actions": [
        { "clip": "act-read.mp4", "weight": 2, "tailFade": 0.45 },
        { "clip": "act-stretch.mp4", "weight": 1, "tailFade": 0.45 }
      ],
      "sleep": "act-sleep.mp4", "sleepEndAt": 5.0 },
    { "id": "armchair", "anchor": "anchor-chair.png",
      "ambient": ["amb-chair.mp4"], "actions": [], "unlock": 20 }
  ]
}
```

`dialogue.json`（事件 → 台词）：

```json
{ "schema_version": 1,
  "lines": [
    { "on": "tap", "cooldown": 45, "when": { "hourRange": [9, 22] },
      "text": ["……嗯？", "又戳我。", "在的。"] },
    { "on": "idle", "when": { "hourRange": [23, 24] }, "text": ["困了……"] },
    { "on": "firstSeenToday", "text": ["你回来了。"] }
  ] }
```

Swift 侧只做解释器 + 缺省兜底（文件不存在 → 回落到现在的单 idle 行为，不能崩）。
这样"换角色/换场景/调语气"变成素材活，**不用重编译**。

注意别学 Malfoy 把所有东西塞一个 `data.js` —— 它自己 520MB 的包已经说明
"数据与素材混在一起"的代价。我们分文件，且数据文件要能被素材作者独立改。

---

## 5. 留存系统：好感度不是数值，是"关系阶段"

Malfoy 的结构（技术文档 §6.5）：

| 规则 | 数值 |
|---|---|
| 每天第一次见面 | +3（首次启动不加） |
| 点她 | +1，冷却 45s |
| 第一次看完一章 | +10 |
| 首次做选择 | 选 B +3 / 选 A +1 |
| 解锁 | 20 居家装扮 / 40 第二章 / 60 睡衣 |
| 称呼 | 0 转学生 → 20 你 → 40 你的名字 |

存档是 `localStorage` 一个 JSON：`{aff, seen, chapterDone, picks, notified, lastVisit, scene, lastTouch, sound}`。

### 我们的机会（这是 LLM 时代的优势）

Malfoy 的 `aff` 只是个**解锁用数字**，对白是写死的。
我们有本地 LLM，可以做它做不到的：**把关系阶段注入 persona，让她"记得"关系**。

改造：

```swift
struct RelationshipState: Codable {
    var affinity: Int = 0
    var firstSeenToday: Date?
    var lastTap: Date?
    var lastVisit: Date?
    var unlocked: Set<String> = []
    // 派生，不存：stage / 称呼 / 语气强度
}
```

三段注入：

1. **system prompt 追加关系段**：`亲密阶段 2/3，她叫你"{称呼}"，语气{克制/放松/依赖}`
2. **记忆**：把 `affinity` 变化事件（不是全量聊天）写成 3–5 条摘要塞进上下文，
   比塞 20 轮历史省 token 且更像"记得"。
3. **行为**：`affinity` 决定 §3 待机动作里"看向你"类动作的权重（低好感冷淡、高好感黏人）。

数值别抄他的绝对值，抄**结构**：每日首见 / 交互冷却 / 里程碑 / 阈值解锁资产。
关键是 `notified` 字段 —— **解锁提示只弹一次**，不然像 bug。

---

## 6. 剧情播放器：可选，但价值最高

Malfoy §6.4 的实现细节值得整段抄：

- flow 是一张图：`1-1 → 1-2（then: choice）→ {A: 1-2A, B: 1-2B} → 1-3 → 1-4`，
  分支后**汇合**，不是树
- 选项 **12s 倒计时，超时默认选 A**（"沉默也是一种回答"）—— 这条很妙，
  既防挂机又给了叙事理由
- 字幕用 `rAF` 按 `currentTime` 匹配时间段（我们是 `addPeriodicTimeObserver` 同理）
- 进入剧情 → 暂停静止循环和 BGM；退出 → 恢复
- 章节结束显示片尾卡 3.5s 再回桌面

对我们：`StoryPlayer` 是独立 layer（Z 最高），flow 用 JSON，素材就是现在这条
`engine_bridge` 链路出的 1080P 片段。**但优先级低于 §1–§3** ——
没有生活感的桌宠，塞剧情也只是"视频播放器"。

---

## 7. 打包与分发：这是最大的商业化阻塞

### Malfoy 的数字

- `electron-builder 25.1.8`，`dmg` / `arm64`，`asar: false`（视频要按路径流式读），
  `LSUIElement: true`（不显示 Dock），`identity: null`（不签名 → 用户右键打开）
- 包 **520MB**，主要是 4K 视频；Windows 版转 WebM 后 409MB → 87MB

### 我们的现实

`README` 已经写了：`LingDesk.app` 依赖工作区里的 `LiveTalking/.venv`、模型和桥脚本，
**不是独立分发包**。这个死结不解，产品就永远只能是开发者自用。

必须做的三层切分：

| 层 | 内容 | 体积 | 分发方式 |
|---|---|---|---|
| 客户端 | Swift app + 素材包（1080p） | 20–80MB | dmg，签名 + 公证 |
| 引擎 | LiveTalking + torch + 模型 | 数 GB | 首次启动引导下载/单独安装包 |
| 模型 | LLM（Ollama 等） | GB 级 | 用户自备，app 只做探测 |

两条具体建议：

1. **素材降到 1080p**。桌宠显示区域撑死 800×800 逻辑像素，4K 是纯浪费。
   Malfoy 的 4K 是被"全屏壁纸"逼的，我们不是。
2. **签名 + 公证是必须提前算的成本**。Malfoy 直接放弃签名（`identity: null`），
   代价是用户要右键 → 打开、还可能要去「隐私与安全性」点「仍要打开」。
   自用无所谓，**对外分发这是转化率杀手**。Apple Developer $99/年 + `notarytool`，
   要做就早点做，别等上线前才发现。

---

## 8. 测试：我们缺"播放时序"的自动验证

Malfoy 没有单元测试，但有一套**很实用的运行时验证**（技术文档 §6.8）：
Electron 跑脚本 → `executeJavaScript` 模拟操作、`sendInputEvent` 模拟悬停、
`capturePage` 截图，同时打印每个 video 的
`currentSrc / currentTime / opacity / paused`。它验证过：

- 入场 → 静止循环的交接时序（能抓到 `opacity 0.82 / 0.18` 的中间态）
- 静止循环在 D8/D9 之间轮换
- 剧情 → 选项 → 分支 → 好感 +14 → 解锁
- 法阵悬停与点击

**这套思路我们直接能用，而且更简单**：AppKit 不用截图，直接读 layer 状态。
加一个 `--selftest` 模式，把合成器状态 dump 成 JSON：

```json
{ "t": 1.2, "state": "acting", "front": "act-read", "actA": {"opacity": 0.82, "time": 4.9}, ... }
```

脚本跑一遍 `idle → tap → think → reply → idle`，断言：
动作层在 `duration-0.5` 附近开始降 opacity、淡出结束时 amb 层已是目标场景、
reply 结束后 state 回到 ambient。**这是我们现在完全没有覆盖的部分**
（`check_core.sh` 只测桥进程重连，不测播放时序）。

---

## 9. 小而值得抄的细节

| 细节 | 为什么值得抄 |
|---|---|
| 声音**默认静音** | 壁纸/桌宠不该主动出声，打扰即卸载 |
| 对话时 BGM 暂停 | 否则和 TTS 抢频段 |
| 音量 = 0.35 × 系统音量 | 固定音量在不同机器上要么太吵要么听不见 |
| 解锁提示只弹一次（`notified`） | 重复弹 = 像 bug |
| 相册解锁态：虚化 + 压暗 + "好感 X 解锁" | 极低成本的期待感，比灰块好 |
| 录屏后门：连点 5 次 / Shift+Alt+M 加好感 | 做 Demo 视频时救命（我们已经有类似测试入口，别删） |
| 解码失败 `error` → 直接收尾回循环 | 绝不留在黑屏；Malfoy 剧情段失败还会 1.2s 后跳下一段 |
| 冷启动并行预热引擎 | 我们已做（`ensureEngine()`），继续保留 |

## 10. 明确不抄的

| 不抄 | 理由 |
|---|---|
| Electron 壳 | 原生 Swift 的体积/性能/系统集成全面更好，没必要为跨平台引入 CEF |
| 4K 素材 | 桌宠小窗不需要，纯拖累包体积 |
| 「壁纸模式 / 互动模式」两段式 | 那是绕 Finder 的妥协；我们用 alpha 命中能做真桌宠 |
| `identity: null` 不签名 | 自用可以，对外分发必须公证 |
| 所有数据塞一个 `data.js` | 素材作者改不动，且和素材 520MB 混在一起 |
| localStorage 存档 | Swift 侧已有 `LocalStore` + 0600 权限，更安全 |

---

## 11. 落地顺序建议

| 阶段 | 做什么 | 产出 |
|---|---|---|
| P0 | 合成器四层化 + 尾帧淡出 + 静帧兜底 | 观感从"循环视频"变"活着" |
| P0 | 桌面窗 alpha 命中 → 能点她 | 从"壁纸"变"桌宠" |
| P1 | `IdleDirector` + `scenes.json`（含作息） | 有节奏感，不再是死循环 |
| P1 | `--selftest` 时序断言 | 敢改合成器了 |
| P2 | `RelationshipState` + 注入 persona | 关系有延续感 |
| P2 | 素材降到 1080p + 签名公证流程 | 能给别人用 |
| P3 | `StoryPlayer` + flow JSON | 章节内容 |
