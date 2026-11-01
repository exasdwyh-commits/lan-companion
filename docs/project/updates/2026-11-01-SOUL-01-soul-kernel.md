# SOUL-01 · 灵魂内核（六维倾向 + 灵魂印记）

> 2026-11-01 21:50 · WorkBuddy / 本聊天
> 来源：用户提供的 `lan-companion-upgrade-pack.zip`（Gemini 生成，8 文件 2165 行）
> 用户决策：**「只救灵魂系统」** —— 其余 7 个文件一行未采用

---

## 一、为什么只取这一块

完整评审见 [WORLD-UPGRADE-REVIEW](2026-11-01-WORLD-UPGRADE-REVIEW.md)。结论是：
**6 个功能里 5 个在页面上根本不会出现**，而它的 4 条单测全绿是因为**每一条都绕开了
three.js 和 index.html**（`createLanCatManager({})` 不传 THREE，`buildCatMesh()` 直接 return）。

被否决的部分及理由：

| 模块 | 否决理由 |
|---|---|
| 动作自然化控制器 | 与 `lan-model.js` 的逐帧 IK 抢同一批骨骼；且没有躺姿分支，会把手伸出被子 |
| 6 套服装换装 | 没传 `characterMaterials`，实测材质变色数 **0** |
| 5 品种猫咪 | `THREE.CapsuleGeometry` 在本机 three **r128** 上不存在 → 整包 UI 起不来 |
| 小花园 / 钓鱼 | 逻辑可用但**无持久化**，且与本次范围无关 |
| 街机卡带 | 导出 `render`，而 `moli_arcade.js` 要 `draw` / `key` / `tap` / `release` / `done` |
| 沙盒建造 | 概念保留（见评审文档第五节），本次不做 |
| 安装脚本 | 三个挂载点全不存在，`index.html` 字节未变却打印「✅ 已自动注入」 |

保留的唯一理由：**六维灵魂是现有系统里没有的东西**。
`lib/affection.js` 只有一个标量好感度（0–100，带冷却），`lib/memory-store.js` 只存对话原文，
`lib/identity.js` 的人格是**写死的**。她会记得你、会跟你更亲近，但**不会因为你而变成另一个人**。

---

## 二、设计：四份人格不许打架

```
lib/identity.js     她是谁     身份段 + 两形态语气     逐字节稳定，任何演化都不许改
lib/memory-store.js 她记得什么 对话原文 + 用户画像
lib/affection.js    你有多近   一个标量 0..100，带冷却与收据幂等
lib/soul.js         她往哪边长 六维倾向 + 灵魂印记     ← 本次新增
```

灵魂只贡献**倾向**，不贡献规则。身份段说的「不超过 40 字、回复开头带 `[emo:xxx]`」、
world/desktop 的语气差异，全部仍然由 `identity.js` 说了算。
旁注最后一行是硬编码的护栏：`这只是倾向，不是新规矩：句长和情绪标签照旧。`

### 六维

| 维度 | 出厂 | 进 prompt 的名字 |
|---|---|---|
| curiosity | 0.68 | 好奇 |
| warmth | 0.75 | 温存 |
| playfulness | 0.62 | 俏皮 |
| poetic | 0.70 | 诗意 |
| independence | 0.58 | 自主 |
| craftsmanship | 0.64 | 动手 |

### 两条关键取舍

**① 渐近而不是加法。** 升级包用的是 `clamp(cur + delta, 0.1, 0.99)`——
一句话重复几十次就能把维度钉在 0.99，之后聊什么都不再变，人格「死掉」。
这里改成越接近边界越推不动：

```js
room = delta > 0 ? (MAX - cur) / (MAX - base) : (cur - MIN) / (base - MIN)
next = cur + delta * clamp(room, 0, 1)
```

在基准值处斜率 1（正常推进），到边界斜率 0（永远到不了）。
测试里连推 300 次：`> 0.95`（确实走远了）且 `< 0.99`（没被钉死），
且最后一步增量 `< 第一步的 1/10`。

**② 单次最多推 2 个百分点。** 升级包允许单条规则 +0.04，一句话能顶别人三句。
这里 `MAX_STEP = 0.02`，误判一次只值 2%，肉眼看不出来。

**③ 中性闲聊不落盘。** `changed === false` 时直接返回，不写文件 ——
否则每聊一句都是一次同步 fs 写，而且 `soul.json` 的 mtime 会变成噪音。

**④ `events === 0` 时旁注是空串。** 没演化过的用户，`buildSystemPrompt` 的输出
与加这个模块之前**逐字节相同**。这不是洁癖：提示词一变，她的开场白就变，老用户的手感会突然不一样。

### 印记合并

连着说同一类话不会占满整张表，而是并成一条并计数：

```js
{ at, tag: "comfort", summary: "在你最疲惫的时候守着，她学会了先不问缘由地靠近", count: 3 }
```

上限 20 条。一句话同时命中多条规则时，只记增量最大的那条。

---

## 三、接线

### `lib/identity.js`

```js
function buildSystemPrompt({ persona, mode, memory, soul } = {}) {
  ...
  return core + "\n\n【此刻】" + tone + (sl ? "\n" + sl : "") + (mem ? "\n" + mem : "");
}
```

灵魂段插在**记忆段之前**：记忆是最具体的东西，放最后才不会被前面的描述冲淡。
`main.js:1681` 那个 identity 探针不传 soul，所以两形态的 `sysW`/`sysD` 比较逻辑不受影响。

### `main.js`（4 处）

| 位置 | 改动 |
|---|---|
| require | `const { createSoul } = require("./lib/soul");` |
| 常量 | `const SOUL = createSoul({ dir: DATA.dir });`（紧跟 `STORE`，同一目录、独立文件） |
| `remember()` | 先 `SOUL.evolve({ text, kind:"chat" })` 再 `STORE.remember()`，包在 `try/catch` 里 |
| `getPersona()` | 增加 `soul: soulDescriptor()`；`soulDescriptor()` 读盘失败返回空串 |
| IPC | `ipcMain.handle('companion:soul', () => SOUL.snapshot())`（只读） |

`remember()` 是**三条真实聊天路径的唯一收口**（`lookAtScreen` 的视觉问答、`deliverReply`、
`streamChat`），所以挂在它上面不用改任何一条链路。
灵魂出错绝不连累记忆 —— 人格是旁注，记忆是主数据。

---

## 四、验收

### 单元测试

`test/soul.test.js` **17 条**，全绿。覆盖：出厂状态、规则命中、中性不落盘、
`MAX_STEP` 封顶、300 次渐近不钉死、印记合并与上限、多规则只记最大增量、
持久化读回、**损坏文件先备份 `.bad-*` 再重建**、越界夹住与非法报错、
`reset`、`dominant` 排序、旁注内容与长度、**identity 逐字节不变**、
灵魂段插在记忆段之前且不动身份段、两形态不被拉平。

### 用打包产物本身跑一遍

```
未演化时提示词含灵魂段: false
演化后含灵魂段: true
--- 灵魂段 ---
【你正在变成的样子】
- 现在最明显的是：温存 77%、诗意 70%、好奇 68%
- 你自己记得的变化：被你鼓励着动手改造小屋，她越来越想自己拿主意；在你最疲惫的时候守着，她学会了先不问缘由地靠近
- 这只是倾向，不是新规矩：句长和情绪标签照旧。
--- 维度 --- {"curiosity":0.68,"warmth":0.77,"playfulness":0.62,"poetic":0.7,"independence":0.6,"craftsmanship":0.66}
--- 印记 --- makex1,comfortx1
--- 身份段未被改动 --- true
```

### 门禁

| 项 | 结果 |
|---|---|
| `node --test test/*.test.js` | **312/312**（原 295 + 17） |
| `bash scripts/project.sh check` | **93/93**，错误 **0**，待办提示 **6**（比上次少 1：Electron 包一致性已随构建消掉） |
| `bash scripts/project.sh build` | `pass: true`，**67/67** 文件一致（原 66 + `lib/soul.js`） |
| `.app` 内 `lib/soul.js` / `lib/identity.js` / `main.js` | sha256 **全部 SAME** |
| 真机 | 已重启为新构建（pid 27494）；`~/.smartcompanion/soul.json` **尚未生成**，符合预期（还没聊过） |

---

## 五、尚未验证 / 已知边界

- **真实对话链路未跑**：本机屏幕会话锁屏，Electron 探针起不来（直接跑二进制只得到 SIGTERM）。
  上面那段输出是用**打包产物里的 `lib/soul.js` + `lib/identity.js`** 跑的，证明的是模块与拼装正确，
  **不是**「App 里聊一句就会写 soul.json」。这条要等用户聊一句后看文件是否出现。
- **`companion:soul` 还没有消费方**：IPC 已通，但小屋面板没接（WORLD-UX-20 在改
  `lan-companion.js` / `.css`，本次不碰）。
- **六维目前只进提示词，不影响行为**：不会因为「动手 66%」就自己去收拾房间。
  自主行动需要沙盒/日程那条线，属于评审文档第五节的重做范围。
- **规则是关键词正则**，会误判（「海」也算诗意）。代价被 `MAX_STEP` 限制在 2%，
  但如果实测发现某个词频繁误触发，改 `SHAPERS` 的 `match` 即可，不用动结构。

---

## 六、给后续的接口

```js
const SOUL = createSoul({ dir });      // dir 必传，模块不认识 ~/.smartcompanion
SOUL.evolve({ text, kind, deltas });   // 推进；无变化返回 changed:false 且不落盘
SOUL.snapshot();                       // 只读：dimensions / imprints / events / dominant / labels
SOUL.descriptor();                     // 拼进 system prompt 的旁注；events===0 时是空串
SOUL.setDimension(dim, value);         // 调试 / 将来的「重置她」
SOUL.reset();
```

`deltas` 是给活动和读书链路留的口子：`{ poetic: 0.02 }`，同样受 `MAX_STEP` 约束。
