> 历史/专题资料（2026-10-30 已统一）：当前方向、主线、状态与任务以 [统一项目中心](docs/project/README.md) 为准。下文保留原阶段记录，其中数量、运行入口和完成结论需按现状复核。

# 数字女友 × Live2D 整合方案

> 2026-10-30 · 已在本机跑通渲染与参数驱动（附验证记录）

## 一、已验证的事实（不是推测）

| 项目 | 结果 | 证据 |
|---|---|---|
| Live2D 渲染 | ✅ | Hiyori 模型在 Electron 内完整渲染，居中无裁切 |
| 动作播放 | ✅ | `Idle` 9 个动作 + `TapBody` 1 个，可调用 |
| 视线跟随 | ✅ | `model.focus(x,y)` → `ParamAngleX` 实时变化 |
| 口型参数 | ✅ | 手动写 `ParamMouthOpenY` 生效（0.42→0.75→0.07→0.91） |
| 表情 | ⚠️ | Hiyori 无 `.exp3.json`，需换带表情的模型或自定义参数组合 |
| 内置 lipsync | ❌ | 该 fork 的 `attachAnalyzer`/`startLipSync` 未暴露 → 改为自建驱动 |
| **TTS→口型** | ✅ | Qwen3-TTS 音频驱动 `ParamMouthOpenY` 采样：0.04→0.14→0.34→0.45→0，跟随振幅 |
| **透明背景** | ✅ | `backgroundAlpha:0` 生效，可直接叠加桌面 |
| **角色层 API** | ✅ | `Character.ready/setEmotion/playMotion/lookAt/speak` 全部可用 |

## 二、技术栈（选定）

```
渲染:  pixi.js 7.4.2
插件:  pixi-live2d-display (cubism4 build, MIT)
内核:  live2dcubismcore.min.js (Cubism 4/5)
壳:    Electron（复用现有 SmartCompanion 运行时）
```

文件清单（已就位）：
```
web/live2d/
  index.html                  原型页
  pixi.min.js                 (456KB)
  cubism4.min.js              (155KB)
  live2dcubismcore.min.js     (207KB)
  Hiyori/                     示例模型（24MB 全套，含 motions）
```

## 三、驱动架构（核心设计）

```
LLM 输出 [emo:happy]  ──→ 表情层
TTS 音频 ──→ WebAudio Analyser ──→ RMS ──→ ParamMouthOpenY
鼠标位置 ──→ model.focus(x,y)  ──→ ParamAngleX/Y
空闲计时 ──→ motion('Idle', n)  ──→ 随机动作
点击命中 ──→ motion('TapBody', 0)
```

### 关键代码骨架

```js
// 1) 口型：自建分析器（不依赖 fork 的 lipsync）
const ctx = new AudioContext();
const src = ctx.createMediaElementSource(audioEl);
const analyser = ctx.createAnalyser();
analyser.fftSize = 512;
src.connect(analyser);
src.connect(ctx.destination);

const buf = new Uint8Array(analyser.frequencyBinCount);
function pumpMouth() {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
  const rms = Math.sqrt(sum / buf.length);          // 0..1
  const open = Math.min(1, rms * 4.5);              // 放大到合适幅度
  model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', open);
  requestAnimationFrame(pumpMouth);
}
```

```js
// 2) 情绪映射（无 exp3 时用参数组合）
const EMO_PARAMS = {
  happy:     { ParamEyeLOpen: 0.6, ParamEyeROpen: 0.6, ParamMouthForm: 0.8, ParamBrowLY: 0.6, ParamBrowRY: 0.6 },
  sad:       { ParamEyeLOpen: 0.7, ParamMouthForm: -0.8, ParamBrowLY: -0.6, ParamBrowRY: -0.6 },
  angry:     { ParamBrowLY: -0.9, ParamBrowRY: -0.9, ParamMouthForm: -0.5 },
  surprised: { ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0, ParamMouthOpenY: 0.6, ParamBrowLY: 0.8 },
  shy:       { ParamCheek: 1.0, ParamEyeLOpen: 0.5, ParamMouthForm: 0.4 },
  calm:      {},
};
function applyEmotion(name) {
  const p = EMO_PARAMS[name] || {};
  const core = model.internalModel.coreModel;
  for (const [k, v] of Object.entries(p)) {
    try { core.setParameterValueById(k, v); } catch (e) {}
  }
}
```

```js
// 3) 动作与命中
model.on('hit', (areas) => {
  if (areas.includes('Body')) model.motion('TapBody', 0);
});
setInterval(() => {
  if (idleLongEnough) model.motion('Idle', Math.floor(Math.random() * 9));
}, 15000);
```

## 四、与现有系统的接法

```
┌─────────────────────────────────────────┐
│ Electron 窗口                            │
│  ┌───────────────────────────────────┐  │
│  │ 背景层：malfoy 场景视频 / 静态图    │  │
│  ├───────────────────────────────────┤  │
│  │ 角色层：Live2D canvas（透明）       │  │
│  │   ← 情绪标签 / 口型 / 视线 / 动作   │  │
│  ├───────────────────────────────────┤  │
│  │ UI 层：气泡、聊天条、🎤、👁        │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
        ↑ IPC
   主进程：LLM 池 / Hermes / TTS / STT
```

**改造步骤**（对现有 SmartCompanion）：
1. 新建 `web/character.html`：全屏透明 Live2D 渲染页
2. `main.js` 增一个 `character` BrowserWindow（`transparent: true`, `frame: false`, `alwaysOnTop: true`）
3. 聊天回复时通过 IPC 推送 `{text, emo, audioB64}` → 渲染层播放音频并驱动口型
4. 原视频场景降级为「背景模式」，Live2D 为「角色模式」，可切换

## 五、美术资源路线（关键瓶颈）

Live2D 不是"给一张图就能动"，需要**分层 PSD + 绑定**：

| 阶段 | 工作 | 成本 |
|---|---|---|
| 立绘 | 分层 PSD（20-30 层：前发/后发/眼白/瞳/眉/嘴/脸/身体/衣/饰） | 画师 1-3 天 |
| 绑定 | Cubism Editor 建变形器/参数/物理 | 1-2 天/角色 |
| 动作 | idle/tap/sleep 等 motion3.json | 半天/个 |
| 表情 | exp3.json（可选） | 1 小时/个 |

**开源可白嫖的替代**：
- 官方示例模型（Hiyori/Haru/Mao/Mark/Natori/Ren/Rice/Wanko）——**仅限测试，不可商用分发**
- 社区免费模型（需逐个核对授权）

**产品化建议**：
- 先用示例模型跑通全链路（现在已做到）
- 定制款 = 客户提供形象 → 画师出分层 PSD → 绑定 → 打包成模板
- 或做「2D 骨骼轻量版」：用 Spine 或自研 canvas 骨骼（成本更低但表现力弱于 Live2D）

## 六、授权（必须注意）

| 对象 | 条款 |
|---|---|
| Cubism SDK | 个人 + 年营收 < 1000 万日元（约 67,000 美元）的企业**免费商用** |
| 官方示例模型 | 仅供测试/学习，**不可随产品分发** |
| pixi-live2d-display | MIT（代码可商用） |

用户当前阶段（个人/小规模）落在免费区间内，可放心用 SDK；但**示例模型必须换成自有美术**才能卖。

## 七、下一步

1. ✅ 渲染 + 参数驱动已验证
2. ⬜ 接 TTS 音频 → 口型（自建 analyser）
3. ⬜ 接情绪标签 → 表情参数
4. ⬜ 透明窗口 + alwaysOnTop 叠加到桌面
5. ⬜ 换自有角色立绘（需美术）
6. ⬜ 数字女友功能：好感度事件、纪念日、主动关心、关系阶段

## 八、参考

- pixi-live2d-display (Jannchie, Pixi v8): https://github.com/Jannchie/pixi-live2d-display
- pixi-live2d-display (Sekai-World, v7 + mulmotion): https://github.com/Sekai-World/pixi-live2d-display
- pixi-live2d-display (RaSan147, lipsync patch): https://github.com/RaSan147/pixi-live2d-display
- CubismWebSamples: https://github.com/Live2D/CubismWebSamples
- hermes-fern-avatar（Hermes→Live2D 事件桥参考）: https://github.com/zadptor/hermes-fern-avatar
- Cubism SDK 授权: https://www.live2d.com/en/sdk/license/


## 九、已验证的角色层 API（character.html）

```js
await Character.ready                  // 初始化完成
Character.setEmotion('happy')          // 8 种情绪
Character.getEmotion()                 // 当前情绪
Character.playMotion('Idle', 3)        // 动作
Character.lookAt(x, y)                 // 视线跟随
Character.speak(base64Mp3)             // 播放语音 + 自动口型
Character.stopSpeaking()
Character.mouth                        // 当前口型值（调试用）
```

实测记录：
- `CHARACTER-READY` 加载成功
- 情绪切换 `happy` 生效
- `speak()` 播放 3.04s 音频，`speaking` 状态准确跟随
- 口型采样：0.04, 0.06, 0.05, 0.14, 0.28, 0.34, 0.21, 0.04, 0.28, 0.45, 0.17, 0


## 十、角色悬浮窗（已实现并端到端验证）

### 功能
- 托盘菜单「打开 Live2D 角色（悬浮窗）」→ 透明置顶窗口
- 位置：屏幕右下，520×760（随屏幕自适应）
- 特性：`transparent: true`、`alwaysOnTop: floating`、全工作区可见、可拖动
- 聊天回复时自动推送：**情绪标签 → 表情**、**TTS 音频 → 口型**

### 端到端验证记录（2026-10-30）
```
角色窗初始情绪: calm
发送: "我今天特别开心！"
LLM 回复: [emo:thinking] 开心什么？中彩票了？……哼，说来听听，别是牛肉面打折这种小事
角色窗情绪: thinking          ← 自动同步 ✓
角色窗 speaking: true         ← 音频播放中 ✓
角色窗口型采样: 0.9, 0.21, 0.06, 0.89, 0.05, 0.86, 0.96, 0.83   ← 跟语音振幅 ✓
```

### 新增 IPC
```js
ipcMain.handle("companion:toggle-character")  // 开关角色窗
charWin.webContents.send("character:say", { text, emo, audio })  // 推送
```

### preload 桥
```js
toggleCharacter: () => ipcRenderer.invoke("companion:toggle-character"),
onCharacterSay: (cb) => ipcRenderer.on("character:say", (_e, p) => cb(p)),
```

### 文件
```
MALFOY-ENGINE/web/live2d/
  character.html              角色层（API: ready/setEmotion/playMotion/lookAt/speak/mouth）
  index.html                  调试页（带按钮）
  pixi.min.js / cubism4.min.js / live2dcubismcore.min.js
  Hiyori/                     示例模型（仅测试，不可商用分发）
```


## 十一、点击穿透 + 悬停激活（已实现并验证）

### 行为
- 角色窗默认 **鼠标穿透**（`setIgnoreMouseEvents(true, { forward: true })`）→ 不挡桌面操作
- 鼠标移到角色身上 → 自动关闭穿透，可点击/拖动
- 非悬停时角色**半透明（0.55）**，悬停恢复不透明（1.0），0.28s 过渡

### 验证记录
```
初始 opacity: 0.55 | hot: false
角色中心 → hot: true  | opacity: 1
移到角落 → hot: false | opacity: 0.55
```

### IPC
```js
// renderer → main（节流 800ms）
ipcRenderer.send("character:hover", over)
// main
charWin.setIgnoreMouseEvents(!over, { forward: true })
```

### 实现要点
- `forward: true` 让窗口在穿透状态下仍能收到 mousemove，才能检测悬停
- 命中判定用模型实际显示尺寸：`model.width * model.scale.x` 与 `model.x/y`（anchor 0.5）


## 十二、鲸鱼娘角色层（2.5D，已实现）

### 为什么是 2.5D 而不是 Live2D
现有素材 `assets/characters/01-deepseek-whale/keyed/deepsea-greenscreen-front-v2-keyed.png`
是**单张平图**（400×1024，72.7% 透明，绿残留 0%），没有分层。

Live2D 要动嘴/动眼必须有分层 PSD（前发/后发/眼白/瞳/嘴/脸/身体/衣…）。
平图做不到口型，所以做了 **2.5D 程序化动画**：
- 呼吸（纵向正弦缩放）
- 摆动（整体旋转 ±1.1°）
- 鼠标跟随倾斜（skew + rotate）
- 说话时身体随音量起伏（WebAudio RMS）
- 情绪：亮度/饱和度 + 爱心粒子（happy/shy）

### 已实现文件
```
MALFOY-ENGINE/web/live2d/
  whale.html      鲸鱼娘角色页（API 与 Live2D 版一致）
  whale.png       透明立绘（从 assets 拷入）
  character.html  Live2D 版（Hiyori，备用）
```

### API（与 Live2D 版完全一致，可无缝切换）
```js
await Character.ready
Character.setEmotion('shy')     // 8 种，带粒子特效
Character.playMotion('nod')
Character.lookAt(x, y)
Character.speak(base64Mp3)      // 播放 + 身体随音量起伏
Character.energy                // 当前说话能量（调试）
```

### 端到端验证
```
初始情绪: calm
聊天: "你今天真好看"
LLM: [emo:shy] 哼…突然说这个干嘛。不过你眼光倒是比牛肉面品味好
情绪同步: shy ✓ | speaking: true ✓
说话能量采样: 0.60, 0.77, 0.59, 0.04, 0.09, 0.94, 0.80, 0.84  ← 身体起伏跟随 ✓
```

### 踩坑
- **透明 PNG 上禁用 `drop-shadow` 滤镜**：会在 alpha 边缘产生蓝白描边伪影。
  改用 `brightness/saturate` 或独立发光层。

### 升级到真 Live2D 的路径
1. 画师按鲸鱼娘设定出**分层 PSD**（20-30 层）
2. Cubism Editor 绑定变形器 + 参数 + 物理
3. 导出 `*.model3.json` + `*.moc3` + 贴图 + `motion3.json`
4. 直接替换 `character.html` 的模型路径即可，上层 API 不用改

### 与现有项目的融合位置
```
desktop-companion/
├── SmartCompanion.app          ← 产品壳（Electron，当前可用）
├── MALFOY-ENGINE/              ← 源码
│   └── web/
│       ├── index.html          ← 主桌宠（场景/剧情/相册/聊天）
│       └── live2d/
│           ├── whale.html      ← 鲸鱼娘角色层（默认）
│           └── character.html  ← Live2D 角色层（备用）
├── assets/characters/01-deepseek-whale/   ← 角色素材源
└── Sources/                    ← LingDesk 原生 Swift（WorkBuddy 线）
```
角色层是**独立窗口**，与主桌宠并存，通过 IPC `character:say` 单向推送，
不改动主桌宠的任何现有逻辑 —— 这是低风险融合方式。
