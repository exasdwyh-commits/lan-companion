# 2026-11-01 · SOUL-HOMESTEAD-01 · 灵魂与家园六引擎（规则层落地，界面未接）

## 归属

- 负责人 / 聊天标识：Arena Agent（用户授权 GitHub 写权限，分支 `feat/soul-homestead-engines`）
- 任务：对应 TASKS 中的 `SOUL-HOMESTEAD-01`；覆盖用户本轮需求里的「人物有灵魂、能通过互动调整」「小花园种花草」「外出钓鱼」「她可以自己改造小屋（类似我的世界）」四项的**规则层**。
- 开始时已有修改 / 其他负责人：无。基于 `main` 快照 `a0a1427`。
- 本次负责文件：
  - 新增 `lib/soul.js`、`lib/garden.js`、`lib/fishing.js`、`lib/room-plan.js`
  - 新增 `lib/intent.js`、`lib/decorator.js`（第二批：把前四个引擎接成会自己动的行为）
  - 新增对应 6 个测试文件
  - 新增 `docs/project/AGENT-SCOPE.md`（可独立完成 / 必须本机验收的分界）
  - 修改 `lib/identity.js`（性格段插入）、`main.js`（实例化 + 提示词注入 + 事件埋点 + 12 个 IPC）
  - 修改 `scripts/project_audit.py`（自检在干净 clone 上崩溃的两处根因）

## 完成内容

### 1. 灵魂 `lib/soul.js`

- 五条性情轴：好奇 / 温柔 / 俏皮 / 秩序 / 沉静，各 0–100，默认 50。
- **会漂回去**：每次读取按真实时间向 baseline 半衰回归（12 小时衰减一半，三天归位）。没有互动的性格不算性格；只增不减最后会全顶到 100，等于没有性格。
- **越到极端越难推**：baseline 处全强度，80 上下只剩六成，顶到天花板推不动。避免几百次互动后五轴一起锁死。
- 事件表：聊天 / 戳 / 礼物 / 听歌 / 读书 / 花园 / 钓鱼 / 改造 / 旅行 / 独处 / 被叫回来。独处超过 12 小时且当天未记过，退一格温柔与俏皮 —— 让「疏远」有痕迹，但一天最多一次，关掉一天回来不会变成另一个人。
- 自我描述：`note()` 最多留 8 条 40 字以内，重复自动合并。
- `prompt()` 输出 ≤120 字、可直接塞进 system prompt 的性格段；`wants()` 按性情派生「此刻最想做什么」，供后续主动行为调度。
- 落盘 `DATA.dir/soul.json`，原子写 + 坏文件先备份再重置 + 收据幂等，与 `lib/affection.js` 同一口径。

### 2. 花园 `lib/garden.js`

- 6 块地、6 种植物（小雏菊 / 薄荷 / 小番茄 / 月光花 / 向日葵 / 海石竹）。
- **生长靠真实时间算，不靠写盘推进**：只写「种下 / 浇水 / 收 / 拔」，其余状态由 `plantedAt` 推出。关掉 8 小时再打开，该熟就是熟了，不需要后台进程。
- 浇水把剩余时间打六折；不浇也能熟（桌宠不该有惩罚机制）。
- 收获给产物**并还 1 颗种子**，保证自循环 —— 否则玩两轮就断粮。
- 月光花白天熟了也摘不下，只在 20:00–05:00 可收：给「她有作息」一个具体证据。
- 熟过 3 倍生长期没收就枯死，只能拔。

### 3. 钓鱼 `lib/fishing.js`

- 4 个钓点各有作息：旧码头全天、礁石区只在早晚、湖心只在夜里、河口只在雨天。**什么时候去钓本身是玩法**，不是换背景图。
- 8 种鱼，4 档稀有度；雨雪天与钓点各自修正权重。
- `rng` 由调用方注入：测试可完全复现，线上用 `Math.random`。一个钓鱼系统如果验不了「同条件出鱼比例」，稀有度就没法调。
- 图鉴只增不减并记最大尺寸；鱼可入桶、可取用、可下锅。

### 4. 小屋布局 `lib/room-plan.js`

- 14×9 格 + 22 件家具目录（占地、类别、旋转后交换占地）。
- **`apply(plan)` 是原子的**：一次「撤三件 + 摆五件」要么全成、要么一件不动，并把结构化 `errors` 带回给调用方。半途失败的房间比原来更难看，用户会觉得「她动过但又好像没动」。
- 这是给大模型用的接口：它能可靠产出「在 (3,4) 放一张 2×2 的矮桌」，产出不了一串欧拉角。引擎负责让它的笨主意不至于把房间叠成一团。
- 错误口径分层：`apply()` 对模型输入返回结构化错误（不抛），`place()/remove()` 对代码调用直接抛（拼错家具名是程序员错误，不该被静默当成「放不下」）。

### 5. 主动行为 `lib/intent.js`（第二批）

前四个引擎只是"她有什么"，这个模块回答"她这会儿想做什么、做不做得了"。

- 动作表：去花园 / 去水边 / 改小屋 / 安静待着 / 想说话；每个带**可行性判定**和**独立冷却**。
- **可行性优先于意愿**：她最想改造小屋，但屋里已经 24 件摆满 —— 那不是意愿问题，是没位置，退到第二想而且做得到的那个。
- **夜里只休息**：凌晨三点说"想动一动小屋的摆设"不是性格问题，是可读性问题。
- **时钟回拨有防护**：`since < 0` 视为回拨而不是"还在冷却"，否则改一次系统时间她会永久沉默。
- 全局最短间隔 20 分钟，避免自言自语刷屏 —— 桌宠一晚上弹八条比不说话更吵。

### 6. 大模型改造小屋的闭环 `lib/decorator.js`（第二批）

- `buildPrompt()` 把网格尺寸、现有 uid、家具目录、输出格式写成模型能照做的一段话。
- `extractPlan()` 找**第一个括号配平的 JSON 对象**，不是宽松解析 —— 宽松解析会接受半截对象，然后让引擎去报一堆莫名其妙的错。
- 失败时 `describeErrors()` 把结构化错误翻成人话（"r3 压到了 r1 身上，换一个空位，或者先在 remove 里撤掉它"）回灌，最多 3 轮。
- 三次不成当这次没改造，房间保持原样（`apply` 本身原子，不会留半成品）。
- `generate` 由调用方注入，所以整条回路**没有网络也能测完** —— 测试里用的是假模型。

### 7. 接入（不只是躺着的模块）

- `lib/identity.js`：`buildSystemPrompt` 增加可选 `soul` 段，插在身份段之后、此刻段之前。两形态**共用同一段**：她有两个形态，但不是两个灵魂。不传 `soul` 时输出逐字节不变（已验证）。
- `main.js`：
  - 注入 `getPersona()` → 真实影响每一轮对话的 system prompt；
  - `character:tap` 记触碰、聊天成功记聊天（与既有 `contentPages.bump` 同点）；
  - 启动时 `soul().settle()` 对账关掉这段时间的独处漂移；
  - 12 个 IPC：`soul:snapshot/soul:note/homestead:snapshot/garden:plant|water|harvest|clear/fishing:cast|take/room:snapshot|apply`。窗口校验与麦克风权限同一口径（只认 composer 与 stage），异常一律返回 `{ok:false,error}` 不跨 IPC 抛。
  - 第二批再补两个只读/手动 IPC：`intent:peek`（问"她现在会做什么"但不执行）、`intent:run`（立刻执行一次，验收不用等 5 分钟）。
  - `startIntentClock()`：默认 5 分钟一轮（`INTENT_TICK_MS` 可调），启动后 90 秒第一次。执行的是**真实后果**——真的摘掉番茄、真的钓上鱼、真的让模型改家具，不做动效假装。
  - 台词走既有 `character:say`，**不碰 `seq`**：渲染层只认 `text/emo/voice`，所以主动开口不会打断正在进行的对话。

### 8. 自检修复 `scripts/project_audit.py`

- `ROOT.parent / "README.md"`、`ROOT.parent / "AGENTS.md"` 是本地工作区才有的文件，干净 clone 上不存在，原代码直接 `read_text` → 整轮 `project.sh check` 以 `FileNotFoundError` 收场。改为存在才检查。
- 文档链接检查只校验仓库内目标：`../../benchmarks/` 这类指向本地工作区产物的链接不再算坏链。检查器该管的是仓库自己不散架。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `node --test test/soul.test.js` | PASS 11/11 | 本文件表格 | 覆盖衰减、封顶、收据幂等、坏文件备份、非法入参；不覆盖真实 LLM 输出观感 |
| `node --test test/garden.test.js` | PASS 11/11 | 同上 | 覆盖生长推算、浇水、枯萎、夜间窗口、种子自循环；不覆盖渲染 |
| `node --test test/fishing.test.js` | PASS 10/10 | 同上 | 含 1000 次抽样校验稀有度分布；不覆盖真实手感 |
| `node --test test/room-plan.test.js` | PASS 9/9 | 同上 | 覆盖原子性、越界/重叠、旋转、件数上限；不覆盖 3D 摆位观感 |
| `node --test test/intent.test.js` | PASS 11/11 | 同上 | 覆盖可行性压过意愿、夜间规则、冷却、时钟回拨；不覆盖真机触发时机体感 |
| `node --test test/decorator.test.js` | PASS 10/10 | 同上 | 用假模型覆盖重试闭环、非 JSON 兜底、幂等；**不覆盖真实模型成功率** |
| `node --test --test-timeout=30000 test/`（全量） | 357 用例，346 PASS，11 FAIL | 失败项 86–91/120/224/226/301/304 | 11 项全为**既有**缺 fixture（`companion-content/pack.json`、`ref-sing-magnetic.wav`、`ref-warm.wav`、照片样本），与本次改动无关；本次新增 62 项全绿 |
| `node --check main.js` / `lib/*.js` | PASS | — | 仅语法 |
| `bash scripts/project.sh check` | 不再崩溃，可完整跑完 83/93 | 本次输出 | 修复前以 `FileNotFoundError: /tmp/README.md` 中止；剩余 10 项错误为**未发布素材缺失**（相册 26 张 jpg、world media、内嵌纹理），属既有状态 |
| `identity.buildSystemPrompt` 不传 `soul` 与旧版对比 | PASS 逐字节相同 | — | 保证双形态身份段约束没被破坏 |

未验证：**所有视觉/交互层**。本环境无 macOS、无 `SmartCompanion.app` 母体、无 GPU/WebGL，App 无法启动，因此 3D 动作、场景、服装、猫、小游戏的观感一条都未测。

## 剩余工作与交接

- 当前限制或失败：四个引擎只有规则与落盘，**渲染层一行没写**。要在真实产品里看见，还需：
  - 小屋/花园/钓鱼的界面：`MALFOY-ENGINE/web/moli-room/` 下新增面板，走上面 12 个 IPC；
  - 灵魂驱动主动行为：把 `soul().wants()` 接进 `world` 页的闲置调度（她自己去浇花/钓鱼/摆家具），建议新建 `lib/intent.js` 承接，不要在 `main.js` 里再长一块；
  - 大模型改造小屋的回路：模型输出 `plan` → `room:apply` → 失败时把 `errors` 原样回灌让它自己改，最多重试 2 次。
- 还能继续独立做（不需要任何本机输入）：服装 `lib/wardrobe.js`、多款猫 `lib/cats.js`、小游戏规则层、库存与合成 `lib/kitchen.js`、记忆召回排序、`main.js` 按 `// ──` 分区拆模块。判据与验收见 [AGENT-SCOPE.md](../AGENT-SCOPE.md)。
- 下一项、依赖与负责文件建议：
  - `SOUL-HOMESTEAD-02`：小屋与花园的界面层（依赖本次 IPC）。
  - 3D 动作自然度、场景/服装/猫/新小游戏四项**不在本次范围**，原因见 TASKS 备注：均需真机 WebGL 迭代，本环境无法验证，硬写等于交付不可测代码。
- 是否更新 STATUS / TASKS / CHANGELOG：已加 TASKS 条目；STATUS/CHANGELOG 建议在界面层可见后一次性更新。
- 是否影响素材来源、外部依赖或运行入口：**无新增外部依赖**，无新素材，运行入口不变。新增 4 个 `DATA.dir` 下的 JSON 状态文件（`soul.json`、`garden.json`、`fishing.json`、`room-plan.json`），随数据目录迁移/删除。
