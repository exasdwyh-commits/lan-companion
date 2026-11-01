# WORLD-UPGRADE-REVIEW：Gemini 升级包评审

> 来源：`~/Downloads/lan-companion-upgrade-pack.zip`（8 文件 / 2,165 行 / 30 KB）
> 评审方式：**不靠读代码猜，全部在真实小屋页面 + 真 three r128 上跑一遍**
> 取证：`benchmarks/2026-11-01-WORLD-UPGRADE-REVIEW/`

---

## 一句话结论

**想法可以用，代码不能直接落。** 6 个功能里 **5 个在页面上根本不会出现**，
脚本自检却打印「全部模块安装并验证通过」。它的 4 条测试之所以全绿，
是因为**每一条都绕开了 three.js 和 index.html**——被测的是数据层，出问题的是集成层。

---

## 一、按承诺逐项核验

| 承诺 | 实际 | 证据 |
|---|---|---|
| 3D 动作自然化（呼吸/眨眼/重心/步态） | 代码完整，但**与现有 IK 逐帧抢骨骼** | `root.position.y` 0 → 0.034；手臂 Euler 0 → (−0.939, 0.551)，都是 IK 独占的骨骼 |
| 6 套服装换装 | **零变化**：材质变色数 = 0 | `applyOutfit()` 返回 `ok:true`，模型上 3 个网格颜色 `changed: 0` |
| 5 品种猫咪 | **抛异常**：`THREE.CapsuleGeometry is not a constructor` | 本机 three 为 **r128**，`CapsuleGeometry` 到 r140 才有 |
| 6 格小花园种植 | 逻辑可用，**无持久化**（刷新即清空） | 内存数组，无 IPC / 无文件 |
| 钓鱼系统 | 逻辑可用，**无持久化**；UI 只是把按钮文字改成「钓到了」 | 同一个问题 |
| 2 款街机新卡带 | **接口不符**：卡带给 `render`，街机要 `draw` | `moli_arcade.js:893` 调 `ext.draw(live)`，还会调 `key/tap/release/done` |
| 6 维灵魂内核 | 数据层干净，**但从未接入 LLM** | `buildSoulPromptDescriptor` 全仓库只有定义和自己那条测试调用 |
| 类 Minecraft 小屋沙盒 | 体素数据层可用（确实是新东西，现有只有俄罗斯方块） | `moli_blocks.js` 是街机卡带，不是建造器 |
| 一键安装脚本 | **注入 0 处**，`index.html` 字节未变 | 副本上实跑，`diff` 为空，但仍打印「✅ 已自动注入」 |

---

## 二、四处硬伤（为什么它一定跑不起来）

### 1. `CapsuleGeometry` 让整个 UI 不启动

```js
// lan-living-presence.js:751
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.16, 8, 16), bodyMat);
```

本机 `vendor/three.min.js` 是 **r128**（2021，`REVISION` 实测 128），`CapsuleGeometry` 在 r140 才加入。
`grep -c CapsuleGeometry vendor/three.min.js` → **0**。

而 `lan-upgrade-ui.js:13` 在初始化时无条件调用 `createLanCatManager`：

```js
const catManager = global.LanLivingPresence.createLanCatManager({ THREE: global.THREE });
```

异常从这一行抛出 → `initLanUpgradeUI()` 整体中断 →
**百宝箱按钮不出现，换装 / 猫 / 花园 / 钓鱼 / 灵魂 / 沙盒 六个页签一个都进不去。**

实测：
```
== 注入结果 ==
{ "errors": ["lan-upgrade-ui.js: TypeError - THREE.CapsuleGeometry is not a constructor"],
  "living": true, "world": true, "ui": false, "dockInDom": false }
```

### 2. 安装脚本什么都没做

`apply-lan-upgrades.sh` 的两个挂载点在这份 `index.html` 上都不存在：

| 脚本假设 | 实际 |
|---|---|
| 有 `</head>` 放 CSS | **没有** `</head>`（文件是 `<meta>` 直开的片段式 HTML） |
| 有 `</body>` 兜底 | **没有** `</body>`（文件以 `</script>` 结尾） |
| 有 `<script src="./lan-companion.js">` | 实际是 `<script src="lan-companion.js?v=20261101-ux20">`（无 `./`，带版本号） |

三个条件全否 → Python 什么都没替换 → **但 `print` 照样输出「✅ 已自动注入」**。
在副本上实跑，`index.html` 与原件 `diff` 为空。

### 3. 换装是个空壳

```js
// lan-upgrade-ui.js:12
const wardrobe = global.LanLivingPresence.createLanWardrobe({ THREE: global.THREE });
```

`createLanWardrobe` 靠 `characterMaterials[matKey].color.setHex()` 改色，
但这里**没传 `characterMaterials`**（整个调包处只有 `{ THREE }`）。
`characterMaterials` 为 `undefined` → 循环里每次 `characterMaterials[matKey]` 都是 `undefined` → 全部跳过。

实测材质变化数 **0**。另外 UI 里 `applyOutfit(id, 100)` 把好感写死 100，
`unlockAffection: 15/25/35/50/80` 的门槛永远命中，**解锁机制也形同不存在**。

### 4. 动作控制器会和现有骨架打架

`lan-model.js` 的 `pose(C, look, time, dt)` **每帧**被调用（`index.html:3252`），
它用 IK 从手/脚目标点反解 `armUp/armLo/legUp/legLo`，并仔细算接地高度 `rootYm`。

升级包的做法是往同一批骨骼写**绝对 Euler 角**和**常量根高度**：

```js
bonesByName.root.position.y = pose.rootOffsetY + breathPrimary * 0.25;
bonesByName.armUp[0].rotation.set(pose.armUpL[0] + …, …);
```

实测步进 90 帧后：`root.position.y` 0 → 0.034，`armUp[0].rotation` (0,0) → (−0.939, 0.551)。
两者只要同时跑，就是**每帧互相覆盖 → 抖动**；谁后跑谁赢，取决于插入位置。

更要紧的是**它没有躺姿/坐姿分支**。现有 `pose()` 用 `lying = smooth(.8, 1.45, |pitch|)` 专门把手臂收进被子；
控制器的姿态库都是站姿参数，一旦它赢，**手臂会重新张开穿出被子**——正是 RIG 系列花了几轮才修好的东西。

---

## 三、次要问题

- **`whale-soul-sandbox.js` 直接 `fs.writeFileSync`**，没有 `.tmp` + rename。
  项目既有约定（`album.js` / `affection.js`）都是原子写，这里崩溃会留下半截 JSON。
- **灵魂系统未接线**：`main.js` 没 require 它，`identity.js` 没读它，`buildSoulPromptDescriptor()` 零调用。
- **旅行新目的地 3 张配图不存在**（`assets/journey/*.jpg`，该目录根本没有）。
- **重复现有实现**：小屋已有手搭的猫（`index.html:1731`，含 `catBody` / `catWalk` / 尾巴），
  升级包会**在原点多出第二只猫**；`lib/journey.js`、`lib/affection.js` 也已存在。
- **测试位置与门禁不匹配**：放在仓库根 `Tests/*.cjs`，而项目门禁跑的是
  `node --test test/*.test.js`（`MALFOY-ENGINE/test/`）→ 这 4 条**永远不进 CI**。

---

## 四、值得留下的三样

1. **`whale-soul-sandbox.js` 的灵魂模型**：6 维 + 蓝图 + `decideAutonomousAction()`。
   概念是本包唯一真正新增且与现有系统互补的东西（现有 `affection.js` 只有一个标量好感度）。
2. **花园 / 钓鱼的状态机**（`createGardenSystem` / `createFishingSystem`）：纯函数式、无 DOM，42 条断言级别的东西可以照搬。
3. **四张数据表**：`OUTFIT_CATALOG`（6 套配色 + 文案）、`CAT_BREEDS`（5 品种 + 特技）、
   `SEED_CATALOG`、`INDOOR_ZONES`。文案质量不错，重写外壳时可以直接拿来当内容源。

---

## 五、如果要做，正确的顺序

1. 数据层搬进 `MALFOY-ENGINE/lib/`，按项目规范补：原子写、`data-dir` 注入、`.test.js` 放 `test/`。
2. 灵魂系统接 `identity.js` 的 `buildSystemPrompt`，让 `HOUSE_VOICE` 那一套之外多一层人格演化。
3. UI **不要独立 dock**，并进已有的 `lan-companion.js` 面板（相册 / 读书 / 换装 / 花园 …同一套 tab），
   否则会出现两套浮层抢位置。
4. 动作层**不重写骨骼**，改为给 `lan-model.js` 的 `pose()` 增加「程序化叠加量」输入
   （呼吸/眨眼/重心各一个偏移量），让 IK 仍然是唯一写入者。
5. 猫复用已有的 `catBody`，只换材质 + 加品种参数，不新建第二只。
6. 街机卡带按 `{ step, draw, key, tap, release, done, music }` 重写导出面。

---

## 六、结论

这份包是**「设计文档 + 数据层」级别的产物**，不是可运行的集成。
它的自检（4/4 绿、打印「全部验证通过」）给人一个**错误的完成感**——这是最危险的部分。

要么按上面第五节重做外壳，要么只取第四节的灵魂内核 + 两张数据表。
直接 `unzip -o` 覆盖 + 跑脚本，结果是一个**看不见任何变化、但会静默抛异常**的仓库。
