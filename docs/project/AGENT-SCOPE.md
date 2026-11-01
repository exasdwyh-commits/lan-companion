# 可分派范围：哪些能交给 agent 独立做完，哪些必须在本机验

> 写这份的原因：用户问「你自己能做的写在 github 里」。
> 一份诚实的边界清单比一份漂亮的路线图有用 —— 它决定哪些 PR 可以闭着眼合，哪些必须人眼过。
>
> 判定标准只有一条：**这件事的验收能不能在没有 macOS / 没有母体 App / 没有 WebGL 的环境里完成。**
> 能，就归 A 类；不能，就归 B 类。B 类不是不能写，是写完没法证明它对。

---

## A 类：可以独立完成，验收靠 `node --test`

共同特征：纯逻辑、无渲染、无外部服务、状态落盘在 `DATA.dir`。合入风险低，因为每一条都有单测。

| 事项 | 状态 | 落点 | 验收 |
|---|---|---|---|
| 灵魂五轴 + 半衰回归 + 自我描述 | ✅ 已交付 | `lib/soul.js` | `test/soul.test.js` 11/11 |
| 花园（生长推算 / 浇水 / 枯萎 / 夜间窗口 / 种子自循环） | ✅ 已交付 | `lib/garden.js` | `test/garden.test.js` 11/11 |
| 钓鱼（钓点作息 / 稀有度 / 可注入 rng / 图鉴） | ✅ 已交付 | `lib/fishing.js` | `test/fishing.test.js` 10/10 |
| 小屋布局（格子 / 目录 / 原子 apply / 结构化错误） | ✅ 已交付 | `lib/room-plan.js` | `test/room-plan.test.js` 9/9 |
| 主动行为调度（想做什么 + 可行性 + 冷却 + 夜间规则） | ✅ 已交付 | `lib/intent.js` | `test/intent.test.js` 11/11 |
| 大模型改造小屋闭环（出计划→校验→错误回灌→重试≤3） | ✅ 已交付 | `lib/decorator.js` | `test/decorator.test.js` 10/10 |
| 性格段注入 system prompt | ✅ 已交付 | `lib/identity.js` + `main.js` | 不传时逐字节不变 |
| `project.sh check` 在干净 clone 上崩溃 | ✅ 已修 | `scripts/project_audit.py` | 能跑完整轮 |
| 画面元素：窗光柱 / 浮尘 / 玻璃雨 / 夜萤 | ✅ 已交付 | `web/moli-room/scene-extras.js` | `tools/room-fx-probe.py` 4/4；真实房间页无头渲染 |

### 还能在 A 类里继续做（不需要你任何输入）

这些我判断可以继续独立交付，每条都能先写测试再写实现：

1. **服装系统**：`lib/wardrobe.js` —— 服装定义（部件 / 场合 / 季节 / 解锁条件）+ 穿脱状态机 + 与性情联动（秩序高 → 整洁套装，俏皮高 → 花哨）。渲染器只需要读 `current()` 拿部件 id，切换是它自己的事。验收：单测覆盖解锁、互斥、持久化。
2. **多款猫**：`lib/cats.js` —— 猫的品种表（毛色 / 体型 / 性格 / 出现条件）+ 亲密度 + 行为倾向。同一套 intent 机制可以复用，猫也有自己的作息。
3. **小游戏的规则层**：像 `moli_blocks` 那样把玩法逻辑与绘制分开，先交付 `rules`（状态机、计分、胜负、随机种子可注入）。渲染层留在 B 类。
4. **库存与合成**：花园产物 + 钓到的鱼 → 做菜 / 送她，`lib/kitchen.js`。这是把已有两条产出线接上的最短路径。
5. **记忆检索**：`lib/memory-store.js` 已有写入，补一层按情绪/主题的召回排序。
6. **`main.js` 按 `// ──` 分区拆模块**：纯机械搬运，每搬一块跑一次全量测试。

### A 类的边界（不该往这里塞的东西）

- 任何需要「看起来对不对」的判断：动画手感、配色、布局美观。这些进 B 类。
- 需要真机字体/编解码能力的：字宽测量、alpha 通道解码、视频容器行为。
- 素材清权结论：只有你能决定某个素材能不能发。

---

## B 类：必须在本机做，我只能出方案和诊断

原因：这些改动最终要由**人眼**判定"对不对"，而在没有 macOS + `SmartCompanion.app` 母体的环境里，我看不到你看到的画面。

> **2026-11-01 更正**：B 类里有一半其实可以验，我一开始判断错了。
> `web/moli-room/index.html` 是纯相对 URL 的普通网页，只要用 HTTP 服务起来（不能用 `file://`），
> headless Chromium + SwiftShader 就能把**真实房间含完整后处理链**渲染出来，房间自己的
> `?at=` / `?wx=` / `?cam=` 还提供了确定性。于是"元素有没有画在画面里、该亮的时候亮不亮"
> 是可以无头断言的（见 `tools/room-fx-probe.py`，4/4 场景通过）。
> 仍然不能验的只剩一件事：**量感和美感**。所以 B 类现在细分为「可无头验的几何/状态」与
> 「必须人眼的美术」两半，前者我可以独立做。

| 事项 | 为什么必须本机 | 我能提供什么 |
|---|---|---|
| 3D 动作自然度 | 手感只能看，不能断言 | 下面那套诊断脚本 + 逐项改法（**仍必须人眼**）|
| 场景 / 室内元素更丰富 | 需要美术取舍 | 结构我能加（已加四个元素），取舍与量感要你看 |
| 外出旅行的表现层 | 需要看转场 | `lib/journey.js` 已有数据层，我补表现层规格 |
| 服装的显示 | 需要看穿模 | `lib/wardrobe.js` 我写完，渲染接线你验 |
| 多款猫的显示 | 同上 | `lib/cats.js` 我写完，渲染接线你验 |
| 小游戏的绘制与手感 | 同上 | 规则层我写完 |
| 真机音色 / 语音自然度 | 需要耳朵 | 只能给你 A/B 对照清单 |

### 3D 动作自然度：建议这么分工

不要让我盲改 `lan-model.js` 的姿势常数 —— 那里面有 `LYING_SLIDE=.42`、`rootYm`、裙骨旋转这类**按实测数字定死**的值，盲改一定把已经调好的躺姿弄坏（`LOCAL-CHANGES.md` 第 58 条记了当初为什么要那么改）。

建议流程：

1. 先跑一次诊断，把「哪里不自然」变成数字：

```bash
cd MALFOY-ENGINE
LAN_MOTION_PROBE=1 <App 内打开 world 页>
# 预期输出每帧：躯干/四肢关节角、角速度、脚底离地高度、相位
```

2. 把输出给我，判断不自然属于哪一类：

| 症状 | 通常是这类问题 | 改法 |
|---|---|---|
| 动作切换有顿挫 | 姿势之间是线性插值，没有缓动 | 在 `blendPose` 换成 `smoothstep` + 加过渡帧 |
| 走路像滑冰 | 位移速度与步频不匹配 | `walk` 的步长常数对齐 `roam` 速度 |
| 脚穿地 / 悬空 | 没有 IK 兜底 | 落地处加 `footIK`，用 `smooth(.32,.50,…)` 那套已有阈值 |
| 转身生硬 | 朝向是瞬切 | 朝向角走最短弧 + 角速度上限 |
| 头发/裙摆不动 | 没有次级运动 | 给 `strand`/裙骨加阻尼弹簧，跟随主骨速度 |

3. 每次只改一类，改完立刻用同一份诊断脚本对比数字，再回来看画面。

这样每轮我交付的是「一处可控改动 + 可对比的指标」，而不是「我猜这样更顺」。

---

## 判断规则（给以后的自己）

- **A 类 PR**：只有 `lib/` + `test/` + `docs/` 改动，全量测试无新增失败 → 可以合并。
- **B 类改动**：只要碰了 `web/` 下的 renderer 或 `lan-model.js` 的姿势数值 → 必须本机跑过再合。
- **越界信号**：如果一次改动既动了 `lib/` 又动了 `web/`，把它拆成两个提交，A 类那个先合。

---

## 当前 A 类交付的验收命令

```bash
cd MALFOY-ENGINE
node --test test/soul.test.js test/garden.test.js test/fishing.test.js \
             test/room-plan.test.js test/intent.test.js test/decorator.test.js
# 期望：62 tests, 62 pass
node --test --test-timeout=30000 test/     # 全量：336 + 21 = 357，失败 11 项均为既有缺 fixture
```

画面元素的验收（不需要 GPU，也不需要 macOS）：

```bash
pip install playwright pillow && playwright install chromium
python3 tools/room-fx-probe.py            # 真实房间页，四个时刻/天气场景
python3 tools/room-fx-probe.py --state rain --keep /tmp/fx   # 只跑一个并留截图
```

真机上想让主动行为立刻发生，不用等 5 分钟：

```bash
INTENT_TICK_MS=60000 open dist/DeepWhale.app     # 一分钟一轮
# 或在开发者工具里调 window 侧 IPC：intent:peek（只看不执行）/ intent:run（立刻执行一次）
```
