# 开发任务总表

> **GROK-HANDOFF-01（Codex / 01a191bf，2026-11-02）：完成**
> 用户要求Grok Bot接手与部署文档。负责交接/部署说明、接手提示词、最小交接包与源码快照导出检查（如需排除原哼唱等未核实再分发素材，限导出规则）；不改业务主线、main/preload、小屋/声音模块。核对远端版本差异、启动/构建依赖与隔离命令，交付可读可上传文档，区分浏览器预览/原生App/真实模型声音。已交付 [接手部署手册](GROK-HANDOFF.md) 与 [启动提示词](GROK-START.md)，公开快照排除原参考视频/原音；验证及同步见 [记录](updates/2026-11-02-GROK-HANDOFF-01.md)。


唯一任务入口。**2026-11-01 用户定版三板块：① 茉莉小屋（`web/moli-room/`）为主场景与当前主线 → ② 桌面 Q 版为二阶段模块 → ③ 真人视频（旧马尔福线）为三阶段，见 [PRODUCT](PRODUCT.md#三板块结构2026-11-01-用户定版) 与 [定版记录](updates/2026-11-01-PRODUCT-BOARD-01-three-boards.md)。新功能默认先服务小屋；真人视频板块只修缺陷不加新范围。** 功能路线图见 [ROADMAP-BOARDS](ROADMAP-BOARDS.md)（H1 小屋接入→H2 接续与自主→H3 故事与发布）。主线关键路径：WORLD-RIG-14/15/16/17（骨骼/接地/睡姿已续写，用户认可记录见下方协调声明）→ WORLD-LAN-07/08（小屋入口及相册/读书/聊天已打包；180/180 当前源包一致）→ H1-3 真机语音批次；P1-0 契约冻结（[REBUILD-PLAN §5](LAN-COMPANION-REBUILD-PLAN.md)）可并行领取。跨板块共享受益的语音链路真机验收保持高优：**WAKE-01（代码完成待真机）** → VOICE-02 / VOICE-03 / VOICE-05 / AIRI-REF-01（同批真机验收）→ VOICE-04。其余：DW-01 → DW-02 / DW-03 → DW-04 / DW-05 / DW-06 → DW-07 → DW-08。有明确文件边界、依赖已满足时可并行；本表不代表已分派 agent。

> **DESKTOP-MOTION-22（Codex / 01a191bf，2026-11-01）：完成，原生听感/多屏待复验**
> 用户要求尽可能多补动作表情。负责 dsh 动作目录/元数据、准备脚本、`dsh-motion.js`、`world.html` 动作搜索分类及闲暇情绪联动、新生成表情序列与专项证据/文档。不改 main/preload、语音/灵魂/小屋骨骼。验收：素材身份/透明/QC，目录全量可播、优先级与坐姿保持、搜索分类、静态检查、构建源包一致；序列帧与连续原片分别标注。 交付125个可选动作（新绘16组），原抖音哼唱已提取，3～6分钟偶发闲置彩蛋及静音/音量/立即播放/打断接好；25专项、125实际解码、16隔离交互、check93/93，414MiB新包与140文件哈希一致。[记录](updates/2026-11-01-DESKTOP-MOTION-22-catalog-idle.md)。


> **DESKTOP-MOTION-21（Codex / 01a191bf，2026-11-01）：完成，原生系统窗口待用户复验**
> 用户要求沿用当前 dsh 桌面造型扩展读书、唱歌、聊天、撒娇、顺拐舞与窗口坐姿。负责 `live2d/world.html`、`dsh-motion.js`、新窗口停靠模块、dsh 真源/运行素材与准备脚本、专项测试/证据/本任务文档。不改 main/preload、SOUL-01、WorkBuddy 语音链路和小屋骨骼。验收：动作匹配、业务活动抢占/恢复、透明与锚点、窗口移动/关闭、隔离浏览器与构建；真实听感、原生多屏另列边界。交付：[桌面动作与窗口坐姿](updates/2026-11-01-DESKTOP-MOTION-21-actions-perch.md)；14项专项与13项隔离浏览器检查通过，新包已构建。


> **当前领取：H1-3 语音链路真机验收批次（WorkBuddy / 本聊天 2026-11-01）**
>
> 一次收口 WAKE-01 / VOICE-02 / VOICE-03 / VOICE-05 / AIRI-REF-01 五项——它们代码都已完成，
> 但**从未在真机上跑过一次**。阶段一（环境预检，不需用户）：8090 STT 探活 + `e2e-voice-check.js`
> 与 VOICE-05 的 4.60s 基线对比 + 核对 `dist/DeepWhale.app` 是否当前构建 + 写验收清单页；
> 阶段二（用户在场 15 分钟，说「开始」才跑）：唤醒 10 轮 / 连续对话 10 轮 / AEC 真值三设备 /
> 悬空尾词续听 / 45s 待机与「先这样」退出与断网兜底。
>
> **文件范围（仅这些可写）**：`web/live2d/voice-capture.js`、`lib/wake-word.js`、`lib/llm-stream.js`、
> `lib/reply-splitter.js`、`web/live2d/composer.*`、`stt_server.py`、`scripts/e2e-*`、
> 新建 `tools/voice-acceptance.md`、`benchmarks/2026-11-01-H1-3-voice/`、本任务 updates 与本表/STATUS/CHANGELOG。
> **`main.js` / `preload.js` / `world.html` 有 Codex 的 WORLD-LAN-07 并行改动，本任务不动**；
> 确需接线先在本表登记协调。**绝不触发 COVER-03 翻唱管线**（用户明令禁止自动重跑）。
> 验收口径：唤醒延迟 ≈2.1s 为基线；漏唤醒/误唤醒逐条记录；不叠播；打断 90ms 淡出；
> 不接自己的话；AEC 只读不改。

> **协调声明（2026-11-01 16:10，WorkBuddy / 本聊天）：接下 WORLD-LAN-07 的最小入口**
>
> 用户要求「打开 App 就进澜的房间，不是图像版」。查证：`main.js` 全文 grep 不到 moli-room，
> `WORLD_PAGE` 硬指向 `world.html`，所以**这不是重建能解决的，是入口没写**。
> 本聊天临时取得 **`main.js` 写入权**，只做入口，不改窗口策略与聊天/音频接线：
> ① 注册 `lanroom://` 协议（moli-room 里 `fetch` GLB/bin 在 `file://` 下会被 CORS 挡死，
> 必须换协议）；② `openStage("world")` 改载 `moli-room/index.html`；
> ③ 托盘「进入她的世界」改文案为「进入她的小屋」。`desktop` 模式与 `world.html` 壁纸**保持原样**。
>
> **Codex 注意**：改动期间请不要写 `main.js`。`web/moli-room/` 我不动（15:24 后的版本原样用）。
> 用户已确认澜的形象（RIG-17 后）可用，H1-1 闸门按「已认可」记录。

> **协调声明（2026-11-01 16:45，WorkBuddy / 本聊天）：WORLD-LAN-08 小屋接入相册/读书/聊天**
>
> 用户要求把小屋做成主界面：3D 相册（记录可贴墙）、读书模块、聊天对话，声音先用萝莉音。
> 本聊天在 `main.js` 已有的写入权内继续，**新增写入 `moli-room/lan-companion.js`（新文件）
> 与 `moli-room/lan-room.js`**，并对 `moli-room/index.html` 做了 **5 处一行级接线**，
> 全部用 `/* LAN-COMPANION */` 标出（script ×2、`createLanCompanion` 调用、`PICKABLE` 增一项、
> `tagLabelZh`/`clickTag` 各一行转发）。
>
> **Codex（RIG-14）注意**：`index.html` 已改动，写之前请重新读取；你的 `lan-model.js` 一行未动，
> 我的接线只在 834 行附近与 4016/4021/4034 行，不碰骨骼、姿态、毯子、相机与日程。
> **`lan-room.js` 由我改写**（固定 6 槽位 + `setPhotos()`），其他任务不要同时改这个文件。
>
> 交付：[WORLD-LAN-08 记录](updates/2026-11-01-WORLD-LAN-08-house-companion.md)。

> **协调声明（2026-11-01 17:15，WorkBuddy / 本聊天）：WORLD-RIG-18 裙装走光（动了 `lan-model.js`）**
>
> 用户反馈「穿裙子在床上就走光了」。查证根因是**裙片单面**（反面被剔除，视线从裙口穿过去
> 落到皮肤上），不是姿态问题。修法：在同一份几何上抠出裙骨主导的 36,277 面，用 `BackSide`
> 深色材质画成**裙内衬**；再在裙骨下挂一件**安全裤**椭球填住锥口。
>
> **Codex（RIG-14）注意**：`lan-model.js` 本次有改动，但**只在 `boot()` 里、`skinnedMesh.bind()`
> 之后新增约 45 行**（`buildSkirtLining()` + 内衬 + 安全裤 + 一行 `info.costume`），
> `pose()` / IK / 权重加载 / 分区 / `syncBlanketProxy` / `focus()` **一行未动**。
> `index.html` 只改了一个 `?v=` 缓存号（44→45）。
>
> 交付：[WORLD-RIG-18 记录](updates/2026-11-01-WORLD-RIG-18-skirt-exposure.md)，
> 证据 `benchmarks/2026-11-01-WORLD-RIG-18/`（含按骨骼分组染色的决定性图 `90-tag-bones.jpg`）。

> **协调声明（2026-11-01 17:40，WorkBuddy / 本聊天）：WORLD-RIG-19 裙内改打码（再动 `lan-model.js`）**
>
> 用户要求「你改成模糊马赛克就行」——RIG-18 的几何遮挡保留，**外观换成马赛克**。
> 改动仍在 `boot()` 内、`skinnedMesh.bind()` 之后同一段：新增 `skirtMosaicTexture()`
> （128×128 CanvasTexture，8×8 方块，Nearest 放大），内衬材质加 `map + emissiveMap`
> （裙内收不到光，纯 map 会全黑），安全裤换成**低多边形球 + 正交投影 UV + `MeshBasicMaterial`**
> （不受光，打码块不该被灯照）。**几何顶点、权重、姿态、毯子、相机一行未动**，
> `index.html` 只把 `?v=` 从 45 提到 46。
>
> **Codex（RIG-14）注意**：`lan-model.js` 的改动全部落在 RIG-18 新增的那 45 行内，
> `pose()` / IK / 分区 / `syncBlanketProxy` / `focus()` 依旧未动。动手前请重新读取该段。
>
> 交付：[WORLD-RIG-19 记录](updates/2026-11-01-WORLD-RIG-19-skirt-mosaic.md)，
> 证据 `benchmarks/2026-11-01-WORLD-RIG-19/`（`41-legs-red-mid.png` 是决定性断言：
> 腿染纯红时裙口内零红色，红色只出现在裙外膝盖）。

> **协调声明（2026-11-01 21:50，WorkBuddy / 本聊天）：SOUL-01 灵魂内核（动了 `main.js` / `lib/identity.js`）**
>
> 用户给了一份 Gemini 生成的「升级包」（`lan-companion-upgrade-pack.zip`，8 文件 2165 行）。
> 评审结论：**想法可用、代码不能直接落**（6 个功能 5 个在页面上不出现，自检却打印「全部验证通过」）。
> 用户拍板「只救灵魂系统」。评审记录见 [WORLD-UPGRADE-REVIEW](updates/2026-11-01-WORLD-UPGRADE-REVIEW.md)。
>
> 本次只做灵魂内核，**升级包的其余 7 个文件一行未采用**（含动作控制器 / 换装 / 猫 / 花园 / 钓鱼 /
> 沙盒 / 街机卡带 / 安装脚本）。改动范围：
> - 新增 `lib/soul.js`（六维倾向 + 灵魂印记 + 提示词旁注，原子写、目录由调用方给）
> - 新增 `test/soul.test.js`（17 条）
> - `lib/identity.js`：`buildSystemPrompt` 增加**可选** `soul` 参数；不传时输出**逐字节不变**
> - `main.js`：`createSoul(DATA.dir)`、`remember()` 里推进灵魂、`getPersona()` 带旁注、
>   新增只读 IPC `companion:soul`
>
> **Codex 注意**：`main.js` 的改动只有 4 处（require / 常量 / `remember()` / `getPersona()` + 一行 IPC），
> 不碰窗口策略、聊天链路、音频、翻唱。**没动 `web/moli-room/` 任何文件**（WORLD-UX-20 的
> `lan-companion.js` / `.css` 原样）。`lib/identity.js` 只加了一个可选参数，身份段与两形态语气一字未改。
>
> 交付：[SOUL-01 记录](updates/2026-11-01-SOUL-01-soul-kernel.md)。

> **协调声明（2026-11-01 22:05，WorkBuddy / 本聊天）：DESKTOP-SELF-01 桌面形态的自我定位（动了 `world.html`）**
>
> 用户反馈「桌面模式，AI 不能识别自己在哪，让她去左边被遮挡了也不知道，看来它只能对话」。
> 根因不是模型笨：桌面舞台是 `type:"desktop"` 壁纸层，渲染层知道 `pet.x/y` 和窗口列表，
> **但拼提示词的主进程完全不知道她位置**。
>
> 改动：新增 `lib/presence.js`（纯函数，遮挡/方位推断）与 `lib/reply-tags.js`
> （`[emo:x]`+`[move:x]` 解析与剥离同源）；`world.html` 加上报 `character:presence`
> 与 `moveTo()`；`main.js` 加 `SELF_AT` 状态、`presenceDescriptor()`、`DESKTOP_MOVE_HINT`、
> `applyMove()` 与 `character:presence` 接收；`preload.js` 加 `presence` / `onCharacterMove`；
> `identity.js` 的 `buildSystemPrompt` 再加**可选** `place` 参数（不传时逐字节不变）。
>
> **Codex 注意**：`live2d/world.html` 本次有改动（WORLD-UX-20 你已释放写入权）。
> 改动集中在四处：`startJump` 之后新增的「听指令走动」段（`coverAt`/`pickSpot`/`moveTo`/`reportPresence`）、
> `updatePet` 的 3 处判断（早退条件、`held`、`jump` 分支、`walk`/`idle` 分支）、
> `loop` 的 desktop 块加一行 `reportPresence()`、`Character` 调试对象加 `self`/`moveTo`。
> **`motion` / `performer` / `presence`（travel 动画）内部一行未动**，`main.js` 不碰窗口策略与音频。
>
> 交付：[DESKTOP-SELF-01 记录](updates/2026-11-01-DESKTOP-SELF-01-desktop-self-awareness.md)，
> 证据 `benchmarks/2026-11-01-DESKTOP-SELF-01/`。

> **协调声明（2026-11-01 23:15，WorkBuddy / 本聊天）：合并 PR #1（Arena Agent 的四引擎 + 口型 + 界面收口）**
>
> 用户把 PR #1（`feat/soul-homestead-engines` → `main`，4 commits / 33 文件 / +4983−9，HEAD `31af97b`）
> 合进本地工作区。**PR 的基线 `a0a1427` 与本地的 `index.html` / `lan-companion.js` /
> `project_audit.py` 逐字节相同**，所以这三份直接取 PR 版本；`identity.js` / `main.js` 手工合并。
>
> **关键决定：灵魂用 PR 那份，我 21:50 写的那份删除。** 理由：PR 版有**真实时间漂回 baseline**
> （12h 半衰）、receipts 幂等、自我描述 note、drives/wants 派生、settle 独处推进，而且下游
> （花园/钓鱼/改造）已经接上；我那份是单调渐近，长期只会往一个方向走。两份灵魂并存正是
> SOUL-01 记录里写的「四份人格互相打架」。删掉 `lib/soul.js` 旧版与对应测试，测试换成 PR 的 11 条。
>
> 合并时改的三处 PR 代码（都在 `main.js`）：
> ① `runIntent` 的 decorate 生成从 `llmChat` 换成 `llmRaw` —— `llmChat` 会把模型回复
> 当台词送进 `character:say` 念出来，等于让她把一坨 JSON 念给用户听；且 `llmChat` 不返回 `ok`，
> PR 里 `r.ok` 永远 false，改造分支其实**从来没成功过**。
> ② `rest` 分支改静默 —— 夜里 `decide()` 返回 rest，只受 20 分钟全局冷却约束，整夜每 20 分钟
> 说一句「我在这儿安静待一会儿」是打扰不是陪伴。
> ③ `ui-skin.css` 补 `nav.bar button.ic` —— `.bar button.ic` 在 `index.html` 里写死 46px
> （两个类，优先级高于 `nav.bar button`），不点名就是 38/46 混排，正是这次要收掉的毛病。
>
> 我保留的：`lib/presence.js` + `lib/reply-tags.js` + `world.html` 的上报与 `moveTo`
> + `identity.js` 的 `place` 参数（PR 的 soul 段放身份段之后、此刻段之前，place 段接在此刻段之后）。
>
> 交付：[PR1 合并记录](updates/2026-11-01-PR1-MERGE.md)。

> **协调声明（2026-11-01 23:55，WorkBuddy / 本聊天）：ROOM-DIALOG-01 小屋面板遮挡（动了 `lan-companion.css`）**
>
> 用户反馈「对话/读书那个对话框遮挡，关了还直接停止了」。实测 960×540 下面板 x=432/w=510、
> 她的投影位置 x=457（半宽 17）—— **整个人被盖住**。改 `.lc-panel{width:min(400px,40vw)}`，
> 左边缘推到 558，`overlapsHero:false`。
>
> **「关了还停止」没有复现**：包了 `CompanionPlayback.Player` 的全部方法记录调用，
> 关面板后没有任何额外 `stop`，也没有 `host.media` / `host.stopVoice` —— 关面板不会停播。
> 但「播放状态只存在于面板里」本身是缺陷，故新增常驻状态胶囊「正在朗读 4/120 · 停止」，
> 面板关着也看得见。顺带把 `body.lc-panel-open nav.bar{display:none}` 改成 `display:flex`
> （面板一开底栏整条消失，只能靠 × 找回）。
>
> **Codex / WORLD-UX-20 注意**：`lan-companion.css` 本次改三处（`.lc-panel` 宽度注释、`≤780` 的
> `nav.bar`、文件末尾新增 `.lc-status` 段）；`lan-companion.js` 改四处（`buildUI` 建胶囊、
> `api.setStatus`、`applyReading` 里驱动它、`stopVoice` 里清掉）。
> **`lan-companion.js` 里那套 `CSS` 常量是用 `head.prepend()` 注入的，排在 `lan-companion.css` 之前，
> 同属性一律被覆盖** —— 以后改尺寸/颜色请直接改 `.css`，别改 JS 里那段（我第一次就改错了）。
>
> 交付：[ROOM-DIALOG-01 记录](updates/2026-11-01-ROOM-DIALOG-01.md)，
> 证据 `benchmarks/2026-11-01-ROOM-DIALOG/`。

 > **WORLD-UX-20（Codex / 01a191bf，2026-11-01）：完成，释放本轮 UI 写入权**
>
> 用户授权丰富小屋相册/小说书架、梳理聊天、分层声音控制、来到桌面，以及直接复用 dsh-pet 动作。接续已交付 WORLD-LAN-08，取得 `moli-room/lan-companion.js` 的本轮 UI 写入权；`lan-room.js` 不动。文件：新增 `moli-room/lan-companion.css`，`index.html` 仅样式引入/音量接线/键盘输入保护；`live2d/world.html` 及新 `dsh-motion.js`、`dsh-motion/`；素材真源 `assets/dsh-pet-desktop-v1/`、派生脚本及本任务回归/证据/文档。不改骨骼/相机、main/preload、WorkBuddy H1-3 语音文件，不触发翻唱。验收：隔离宿主下相册编辑/贴墙/预览、书架/阅读、会话续接/输入法、语音与环境音控制、桌面往返、透明动作与睡眠链，构建和工程检查；原生与夹具证据分别记录。

> 交付：[小屋与桌面记录](updates/2026-11-01-WORLD-UX-20-room-desktop.md)；已构建，211/211源码/包内文件一致；33项专项与17项隔离浏览器通过。原生听感与窗口往返待实测，扩展回归20项失败单列。

> **GITHUB-01（Codex / 01a191bf，2026-11-01）：完成，私有源码已上传**
>
> 用户授权上传 GitHub。负责上传脚本/文件清单、仓库AGENTS/README、GitHub 交付说明、任务/状态/索引文档；不改业务文件或他人暂存区。按私有仓库备份当前源码与运行素材，排除个人数据/凭据/测试运行数据/模型权重/大原片；使用独立临时索引生成发布快照，保留本地 HEAD 和未提交改动。验收敏感内容/大小检查、远程私有性、提交/文件哈希、工程只读检查。

> 交付：[GitHub私有源码记录](updates/2026-11-01-GITHUB-01-private-source.md)；origin 为 `exasdwyh-commits/lan-companion`，使用 `github/main:main` 快照同步；保留本地HEAD/暂存区，不含原片/权重/个人数据。

> **GITHUB-PUBLIC-02（Codex / 01a191bf，2026-11-01）：完成，仓库已公开**
>
> 用户明确授权把现有仓库改成公开。负责GitHub可见性、README/AGENTS及项目GitHub说明/状态/交付索引同步；不改运行素材、业务代码、当前HEAD或原暂存区。沿用GITHUB-01已排除个人数据/凭据/大原片的快照，保留现有第三方署名与许可。验收GitHub实际PUBLIC状态、文档快照提交/完整树核对和只读工程检查。

> 交付：[公开可见性与核对](updates/2026-11-01-GITHUB-PUBLIC-02-visibility.md)；用户已明确授权公开现有仓库，匿名访问实查；当前说明已同步，保留既有素材许可与个人数据排除规则。

## 领取规则

1. 开始前核对当前代码与 STATUS，更新下表的负责人、状态、文件范围；负责人使用 agent/聊天标识，不写“已有人处理”。
2. 同一文件只能有一个当前写入负责人；其他 agent 先协调。保留未知修改，不直接覆盖或回退。
3. 状态用：待领取、进行中、待验证、完成、阻塞。遇到缺素材或服务，记录具体阻塞，不把功能存在写成已验收。
4. 完成需有交付记录、命令及结果、剩余限制，并更新 STATUS 与 CHANGELOG。交付记录从 [模板](updates/TEMPLATE.md) 复制。

## 排期与归属

**WORLD-RIG-14（Codex / 01a191bf，基础修复完成；已同步最新 App）**：修复父子骨坐标/旋转重复应用，按实际人形重定位与姿态重定向；离线表面测地四权重、UV 重复点一致、渲染副本切除 2070 个衣发/手指粘连面。六姿势 p99 边长比由 6.56–16.62 降到 1.11–1.89；极端袖口仍有局部折叠，非完整重拓扑。后续 **RIG-15/16/17 接地/贴床/被子及 LAN-07/08 小屋相册/读书/聊天** 全部保留；本次实查小屋+接线 **180/180 文件与 App 相同**，最新骨骼回归 4/4、check 93/93。释放 `lan-model.js/index.html` 写入权，以当前版本为准；本轮没有重建/重启 App。详见[修复与同步](updates/2026-11-01-WORLD-RIG-14-skin-and-app-sync.md)。

**WORLD-RIG-18（本聊天，完成：裙装走光已修）**：修用户反馈「穿裙子在床上就走光了」。根因**不是姿态而是拓扑**：裙片是单面网格，反面被 `FrontSide` 剔除，**从裙摆下方看进去时视线穿过裙壁直接落到皮肤上**；躺下锥口正对床尾、坐下锥口朝前下方，都是直视。RIG-16/17 两轮都以**外部轮廓**为准（"床尾看不出裙底"），漏掉了"绕视角看进去"。修法：① 在同一份几何上抠出**三个顶点全由裙骨主导**的 36,277 面，用 `side: BackSide` + 深藏青材质重画成**裙内衬**（共享 skin 属性 ⇒ 变形与裙片完全一致、外轮廓零变化）；② 裙骨下挂一件 **0.128×0.100×0.112 m 的安全裤**椭球（中心距裙骨原点 0.072 m），半径远小于该高度裙片半径，物理上戳不出去。判定用**按骨骼分组染色**：腿红 15,181 面 / 臂绿 15,009 面 / 裙蓝 36,277 面，床尾正对锥口拍摄时**画面里没有任何红色**。另用"内衬染品红 + 身体染青"排除残留粉色是花边而非皮肤。单测 295/295、check 93/93、打包 66/66，真机已重启为新构建。[记录](updates/2026-11-01-WORLD-RIG-18-skirt-exposure.md)。

**WORLD-RIG-17（本聊天，完成：躺姿再下沉、被子贴合、裙摆铺平；待用户观感）**：修用户反馈「上床上就可以接受穿模了，人可以往下点」。① 重测床垫顶面为 **0.53**（RIG-16 记的 0.46 是床架边缘），她躯干底面 0.66，仍悬空 0.13 m；躺姿 `rootYm` +0.06 → **−0.07**。② 被子覆盖盒原来只有 8 个角点，楔形 taper 后峰值厚度仅 **0.31 m**，小于躯干 0.33 m，永远差一点盖不住——改 `BoxGeometry(...,1,8,1)` 沿长轴细分并按「头顶 0.06／胸口 1.0／脚端 0.70」的曲线给厚度，同时加宽到 1.14（裙摆铺开后超过肩宽）、中心沿世界 Y 抬 0.05（骨骼走中轴、布料要护背）、`len` 收到 `dist−0.12` 让头端停在肩膀。③ 裙骨躺姿转角实测定表（0→0.866、−0.28→0.893、−1.1→0.826），**改为零旋转**：站立时裙摆沿局部 −Y，身体转 −90° 后正好映射到世界 +Z，本来就沿床面朝脚摊开，任何额外扭转都会把裙撑立起来戳穿被面。实测躯干底面 0.66→0.451（压进床垫 0.08），被子峰值 0.949→0.904，裙摆最高点 0.893→0.866（被面 0.904 之下），头露在被子边界之外，床尾看不出裙底，站/坐鞋底仍为 0。十张实拍，check 93/93。[记录](updates/2026-11-01-WORLD-RIG-17-lower-sleep.md)。

**WORLD-RIG-16（本聊天，完成：躺姿贴床、入被、遮裙底；待用户观感）**：修用户反馈「还是有点穿模，睡觉的人物太高了，人没在被子里，躺着裙底也不美观」。四处根因都是「0.78 m 墨水体的躺姿常数套在这具 1.30 m 的 Q 版上」：①`PL.lie` 锚点 z=−0.78 让她头顶冲到 −2.03，而床头板在 −2.02（穿出床外）；②`rootYm` 0.105 使髋停在 y=0.808，离床垫（实测顶面 0.46）0.35 m 悬空——上一轮误把 moli 的「地板平面 0.64」当成床面，把散开的头发的最低点当成"背贴床"；③毯子覆盖盒 0.40×1.07×0.30 远小于身体（宽 0.95、厚 0.72），只抬起被子中间一条，两侧塌在床边；④裙骨躺姿 +1.26 rad 把裙摆轴转到朝上 72°，等于把她架在裙撑上，同时露出裙底；⑤双腿沿身体轴伸直，髋距 0.176 而腿长 0.146 → 张开 31°、脚底悬空 0.25 m；⑥手臂沿用站立偏移，手腕穿出被子两侧。修法：躺姿沿床面滑 `LYING_SLIDE=.42`、`rootYm` 改 0.06 落到床垫、裙骨 −1.15 折向床面、双腿收向中线并压低（`hint` 膝朝床面）、双臂按模型自身「肩→腕」向量折到身侧、`syncBlanketProxy` 覆盖盒改**楔形**（头端收薄、脚端收窄）使被子像"盖着人"而不是"扣着筐"。实测头顶 −2.03→−1.36 回到床内，髋离床 0.35→0.03 m，床尾低角度**看不到裙底**，站/坐鞋底仍为 0。五姿态实拍，check 93/93。[记录](updates/2026-11-01-WORLD-RIG-16-bed-sleep.md)。

**WORLD-RIG-15（本聊天，完成：地面接触与躺姿腿型；待用户观感）**：修用户反馈「躺下、坐着起身脚下穿到地板」。① 坐/起身穿地——根骨沿用上游公式 `(C.y-.19)*.78`，坐姿下沉 0.148 m，而 Q 版整条腿只有 0.1115 m，髋降得比腿还低，脚只能插进地板；起身要 0.5 s 才爬回地面。修法：臀部落地限制（`HIP_SEATED=0.072`）+ 脚目标接地钳制 + 坐姿按 `seated` 权重强制踩地（行走踏步不受影响）+ 腿长不够时抬身体兜底。② 躺姿腿翘 11.8°——bind 姿势本身脚比髋靠前 3 cm，绕 X 转 −90° 后「前」变「上」；同时目标距离略短于腿长，IK 必须弯膝而 `hint` 也指向正上方。修法：去前倾 + 按腿全长 0.998 伸展，使膝弯项 `h→0`。实测全程最低鞋底 −0.029 → **0**，腿倾角 11.8° → **0°**，七姿态实拍，check 93/93。新增 `?bones=1` 骨骼可视化与 `lanModel.dbg` 导出。**基于 Codex WORLD-RIG-14 的连续权重版本续写，未回退其任何实现**。负责 `moli-room/{lan-model.js,index.html}` 与 `benchmarks/2026-11-01-WORLD-RIG-15/`。[记录](updates/2026-11-01-WORLD-RIG-15-ground-contact.md)。

**WORLD-RIG-13（本聊天，完成：蒙皮真正生效；待用户观感）**：修「她不能走不能坐不能睡」——根因是 three r128 按**材质**决定是否编译蒙皮（`skinning: material.skinning && bones>0`），而 GLTFLoader 给静态网格的材质 `skinning=false`，于是骨骼数值、`boneMatrices` 全部正确变化但 GPU 永远画绑定姿势（上一轮 WORLD-RIG-12 只验状态值、没验画面，被骗过；`benchmarks/.../05-lie-sleep.jpg` 实为站姿配 zzz 气泡）。修法：clone 材质 + `skinning=true` + `needsUpdate`。顺带：分区由方框改为**离肢体轴最近**（宽袖被误判给头骨导致抬手撕裂）、手臂 IK 留 10% 余量、躺姿禁用转头、GLB 失败回退墨水体、`createLanModel` 缺失兜底。实拍六动作 + 躺姿特写，check 93/93。**未接 Electron**（`dist/DeepWhale.app` 内 moli-room 仍是 00:44 旧资源）。负责 `moli-room/{lan-model.js,index.html}` 与 `benchmarks/2026-11-01-WORLD-RIG-13/`。[记录](updates/2026-11-01-WORLD-RIG-13-skinning-material.md)。

**WORLD-RIG-12（Codex / 本聊天，完成：运行时骨骼绑定；待用户观感）**：为新版混元 GLB（单网格、无骨骼、17.4 万顶点）运行时建骨并蒙皮——烘焙节点 X+90° 旋转、建 12 根平铺骨骼（root/spine/head/skirt/臂×4/腿×4）、按几何空间分区**硬归属**蒙皮（头发只归头骨、袖子只归臂骨、裙摆独立、腿各归各骨，顶点绝不同时挂两骨 → 头发和四肢物理上不可能联动）；每帧把上游姿态记录 `C` 经同一套两段 IK 回放到骨骼。恢复被 MODEL-11 禁用的自主日程（idle 拦截已撤）。Ego 实拍七种状态：站立/挥手（头发裙摆零联动）/运动/坐毯看电视/躺睡/坐毯打游戏/书桌读书，全部正常；check 93/93。**未接 Electron/打包**；蒙皮按几何分区在极端姿势（深蹲、双臂后摆）可能有裙-腿接缝。负责 `moli-room/{lan-model.js,index.html,LOCAL-CHANGES.md}` 与 `benchmarks/2026-11-01-WORLD-RIG-12/`。[记录](updates/2026-11-01-WORLD-RIG-12-runtime-rig.md)。

**WORLD-MODEL-11（Codex / 本聊天，完成：浏览器造型接入；待用户观感）**：新版混元 GLB 已换入默认小屋，隐藏原版整套可视 rig，校正 1.248 世界高度、脚底 Y=0.012；新增“看澜”近景按钮、加载与失败提示。Ego 实看全屋/近景，实点电视进入游戏 intro、Esc 返回；check 93/93。~~默认站立，未绑骨/坐卧/持物/步态~~（骨骼绑定已由 WORLD-RIG-12 补齐）；未接 Electron 或打包。本轮负责 `moli-room/{index.html,lan-model.js,LOCAL-CHANGES.md,assets/lan-room/}` 和证据/文档，保留他人修改，释放文件写入。[记录](updates/2026-11-01-WORLD-MODEL-11-room-preview.md)。

**WORLD-MODEL-10（Codex / 本聊天，候选制作完成，待用户视觉确认）**：实看新视频，重做 B 版造型与独立正/侧/背参考，混元 3.1 多视图实际生成并下载原始 GLB（54.31MiB / 497,910 三角面）；另做柔和材质 8.79MiB / 199,999 三角面 / 2K 贴图副本，两份均经 Blender 四视角实看。后脑厚度、背发层次与尾轮廓改善，旧白色背部鼓包消失；手指/发丝/裙边仍有生成噪点。无骨骼/动作/表情形变，未替换房间、未打包。负责 `assets/lan-3d-model-design-v2/`、`benchmarks/2026-11-01-WORLD-MODEL-10/` 与本任务文档，保留旧模型与他人修改；本轮释放文件写入。[记录](updates/2026-11-01-WORLD-MODEL-10-multiview.md)。

**WORLD-HY3D-09（Codex / 本聊天，下载完成；背面修形未验收）**：混元 3.1 已生成并实际下载 54MB GLB，消耗 1 积分、剩余 19；Blender 原始工程与四视角已落盘。副本降至约 9MB / 10 万面，背发修形仍有接缝、材质分界及下缘问题，未进入房间；无骨骼/动作/表情形变。下一步用独立侧背参考重新约束模型。负责 `assets/lan-3d-hunyuan-v1/`、`scripts/review-lan-model.py`、`scripts/refine-lan-model.py` 及本任务证据/文档，未改房间与主线共享文件。[记录](updates/2026-11-01-WORLD-HY3D-09.md)。

**WORLD-MODEL-DL-08（Codex / 本聊天，待用户处理平台导出权限）**：下载既有 B 版鲸鱼娘，恢复 CLI 登录并核对真实导出响应；只负责 `assets/lan-3d-hyper3d-v1/`、本轮证据与交付文档，不改房间/main/preload/dist，保留所有他人修改。

**WORLD-LAN-06（历史试作，角色验收撤回；海边主题独立保留）**：曾在复用小屋里试作程序拼接三维鲸鱼娘并用 Ego 截图；用户随后否定形象，角色已从入口移除，恢复原版茉莉临时占位。此前的 93/93 仅是静态检查，不能再以试作截图宣称澜 3D 已交付；海边主题改动保留。详见[当时记录](updates/2026-11-01-WORLD-LAN-06-seaside-theme.md)及[纠正](updates/2026-11-01-WORLD-LAN-07-model-correction.md)。

**WORLD-LAN-07（本聊天，入口已接；场景交互余项待领取）**：把 `MALFOY-ENGINE/web/moli-room/` 接进 Electron 世界窗口。已完成：`lanroom://` 协议（GLB/`.bin` 在 `file://` 下被 CORS 挡死）、`openStage("world")` 改载小屋、托盘文案改「进入她的小屋」、世界窗默认尺寸 640×360 → **960×540**。**真机已确认**：App 启动即进小屋，相册 IPC 黑盒探针通过（见 WORLD-LAN-08）。用户已认可澜的形象（H1-1 闸门按「已认可」记录）。仍余：场景物件逐个加点击交互（电视/游戏机之外的音频、台灯等已有）、`world.html` 与旧壁纸路径的最终去留。

**WORLD-LAN-08（本聊天，完成：三件功能已接入；声音待用户听感确认）**：按用户要求把小屋做成主界面——① **3D 相册**：书桌上一本相册，点开可改标题/记录、贴到墙上/取下、删、加照片；墙上是 6 个固定 3D 槽位，数据在 `~/.smartcompanion/album/`，随包三张用 `seed` 不拷贝。② **读书**：点桌上阅读器 → 她坐过去 + 面板（书名/进度/正文/接着读·暂停·上一段·下一段/打开电子书/粘贴文字/书库），音频仍走 `companion-media` → `scene:media` → `companion-playback`（未复制第二份播放器）。③ **聊天**：底部输入栏 + 她上方的气泡，`character:say` 也接进来，所以**语音唤醒的回答在小屋里终于看得见字**；流式片段排队接播。音色按用户要求统一用萝莉（`HOUSE_VOICE=desktop` 默认，可切回 world）。新增 `lib/album.js`（9 条单测）、`moli-room/lan-companion.js`；`lan-room.js` 改写为 6 槽位 + `setPhotos()`；`index.html` 只加 5 处一行级接线。验证：单测 295/295、check 93/93、打包 66/66；浏览器用假宿主跑通聊天/读书/贴墙三路（附 960×540 与 640×360 两档实拍）。**未验证：真机听感（锁屏截不到画面）与「加照片」对话框**。[记录](updates/2026-11-01-WORLD-LAN-08-house-companion.md)。

**PRODUCT-COCREATE-01（Hermes 002 / 本聊天，方向记录完成；功能未领取）**：用户确认非商业版默认关系为共创型伙伴，剧情可接共同创作；眼下差异化优先读书真实体验与双空间切换，Vidu 第三种实时真人模式仅做远期研究。范围仅 `docs/project/{PRODUCT,COMPANION-STRATEGY-DRAFT,README,STATUS,TASKS,CHANGELOG}.md` 与本任务更新记录；不动主线代码、素材及正在并行的场景文件。设计边界：一段共创作品/一次剧情选择经确认保存，世界变更可撤销，虚构与真实记忆分离；真机验收与功能开发另行领取。

**LAN-CONTRACT-01 / P1-0（待领取：契约与 Schema 冻结）**：冻结 `Event`、`Snapshot`、`Proposal`、`ContentPack` 与跨窗口 `viewGenerationId`/`AudioLease` 的 JSON Schema（落 `docs/contracts/` 或 `lib/lan-schema.js` 纯定义＋静态校验测试）。各业务分支基于 Mock 并行单测，**契约未冻结前不得向 main.js 塞私有 IPC**；范围仅新文件与测试，不碰共享接线。见 [REBUILD-PLAN §5 P1-0](LAN-COMPANION-REBUILD-PLAN.md) 与 [Gemini 并入记录](updates/2026-11-01-PLAN-BOARD-03-gemini-deepen.md)。

**PILOT-REUNION-01（待领取：首个整合试玩）**：跨重启接续小体验——真实朗读读一段书 → 澜提出与自身处境有关的想法（引用书中位置）→ 用户选/改/拒，同意则共写一小段进草稿 → 定稿后小屋留纪念物 → 重启/切形态后准确接续。依赖 P0-1（VOICE 真机验收）与 P1-3/P1-4 切片就绪；小屋未接 Electron 时纪念物降级为预览页可见。任何一环断链即整个试玩不通过；见 [REBUILD-PLAN §5](LAN-COMPANION-REBUILD-PLAN.md) 与 [并入记录](updates/2026-11-01-PLAN-BOARD-02-gpt-review-merge.md)。

**STORY-BASE-01（Hermes 002 / 本聊天，方向记录完成；剧情开发未领取）**：澜即“小肥鱼”；开局被打回原形、从头开始；轮回瓶撤销。苦修反击或躺平成为“大肥鱼”由角色自主行为与用户互动共同影响，不是预设的两选一奖励/惩罚。标准化底子仅固定身份、冲突和世界边界；剧情、小说、剧本由澜讲述/创作并随选择发展。已在 `PRODUCT.md` 更新口径、给旧 `VIDEO-PLAN.md` 标过时；不修改代码、素材或现有章节。后续正式分镜先设计双空间新解释，再经用户确认。

**PLAN-LAN-01（Hermes 002 / 本聊天，文档完成；下列执行任务待领取）**：[澜的自主共创伙伴整体改造方案](LAN-COMPANION-REBUILD-PLAN.md)按 P0 真实体验与事实边界 → P1 事件账本/自主独处/共创故事/小屋痕迹 → P2 非商业开源许可闸门与 Vidu 研究排序。只负责新方案文档、README/TASKS/STATUS/CHANGELOG 入口与交付记录；**没有修改主线代码或运行产品**。实际接线需在本表单独登记负责人并协调 `main.js/preload.js/world.html`。

**DSH-MOTION-01（Hermes 002 / 本聊天，隔离素材试验完成；舞台接线未领取）**：按用户建议从本地 dsh-pet 提取 8 条动作（待机/走路/点击/拖拽/睡眠起承转/思考），存 `assets/dsh-pet-motion-pilot/`，含来源 revision、SHA-256 和许可说明；所有文件复制一致、ffmpeg 解码通过。上游 README 允许动画非商用开源使用，公开二创署名；角色「大肥鱼」为 CC BY-NC-SA 4.0 二创，**不得当澜原创、不得自动放入公开/商业包**。后续隔离播放器实测、形象取舍及完整权利核对后才能由 DW-04 单一负责人接入。见[交接](updates/2026-11-01-DSH-MOTION-01-pilot.md)。

**WORLD-MOLI-05（Codex / 本聊天，完成：复用底座）**：完整导入 `MALFOY-ENGINE/web/moli-room/`，保留 156 个原文件、四款游戏及署名许可；旧独立原型入口转向复用版，旧几何实验保留。Ego 验房间、四游戏启动/暂停/返回、方块和马戏团移动、夜景/混音面板；工程检查 92/92。当前仍为原版角色，后续澜外形/主题/App 集成待领取。[记录](updates/2026-11-01-WORLD-MOLI-05-reuse.md)。本任务未改 main/preload、真实记忆或 dist。

**WORLD-PLAN-04（Codex / 本聊天，完成：规划提案）**：[潮汐居场景规划](WORLD-SCENE-PLAN.md) 已整理小屋布局、美术、角色活动及分期；具体方案待用户反馈，开发未执行。[记录](updates/2026-10-31-WORLD-PLAN-04.md)。

**WORLD-SCENE-03（Codex / 本聊天，原型完成）**：独立潮汐小屋增加生活细节、日夜窗景与直接点击家具；基础交互已验证，完整资产和角色动作待续。[记录](updates/2026-10-31-WORLD-SCENE-03.md)。

**WORLD-LIFE-02（Codex / 本聊天，原型完成）**：独立 Three.js 小屋增加网格避让、场景反馈及日夜切换，基本交互已验证；不触碰个人数据或应用包。[记录](updates/2026-10-31-WORLD-LIFE-02.md)。

**WORLD-LIFE-01（Codex / 01a191bf，进行中）**：B 版 Hyper3D 预览及人形骨架已生成，Walking 预览变形明显，Medium GLB 导出需要订阅；后续需解决模型导出和绑定质量，范围为 Hyper3D 生成、`assets/lan-3d-hyper3d-v1/`、`MALFOY-ENGINE/web/world-prototype/` 与交接文档。保留他人修改，不改 Electron 主线或个人数据；模型、骨骼和行为按实测记录。[进度](updates/2026-10-31-WORLD-LIFE-01.md)。

**WORLD-3D-POC-01（Codex / 01a191bf，原型完成，待角色与主线接入）**：独立 Three.js 小屋、地面/地点移动与视角操作已在 Ego 实测；角色是二维贴图平移，没有真实步态或坐下，不接记忆及主线。[交付与参考](updates/2026-10-31-WORLD-3D-POC-01.md)。本轮释放 `MALFOY-ENGINE/web/world-prototype/` 和文档写入。

**LIVE2D-LAN-01（Codex / 01a191bf，待续）**：B 母图拆件补绘参考已归档；尚缺分层 PSD、Cubism 绑模、真实舞蹈和哼唱，参见[记录](updates/2026-10-31-LIVE2D-LAN-01-source-study.md)。本轮释放 `assets/lan-live2d-source-v1/` 和文档写入；不占用主线播放、音频文件。参考图不能声称为可用 PSD 或绑定模型。

**CHIBI-05（Codex / 01a191bf，候选完成，后续制作待领取）**：B 角色三视图、表情与舞蹈关键姿态概念素材、预览及验收；负责 `assets/whale-chibi-b-study-2026-10-31/`、本轮 benchmarks 和项目文档；不占用 DW-05 音频或共享舞台代码，不覆盖其他工作。验收身份一致性、180px 可读性及可否进入绑模，候选素材不得冒充分层模型或完整动画。

本轮 **CHIBI-04（Codex / 01a191bf，2026-10-31）**：复核舞蹈裁切/身份/节奏与合成哼唱，研究 Live2D，制作三方向角色候选；负责新增研究文档、updates/本轮 benchmarks 与候选素材、舞蹈 `source.json` 裁切/`chibi-dance.js` 派生与独立素材回归；Live2D 参数只读复核；验收当前源码证据、Ego 页面与参数实测、工程 check。保留现有角色与图集原件，不覆盖其他任务；参考视频尚待可访问版本，B 方向已获用户选择；本轮研究/裁切修复完成，母图候选待验，正式分层角色、舞蹈和人声制作待后续。详见 [优化规划](CHIBI-OPTIMIZATION.md)。

| ID | 优先级 | 任务 | 依赖 | 状态 | 负责人 / 文件范围 |
|---|---|---|---|---|---|
| H3-STUDIO-01 | P1 | 独立本地 H3 视频生成台 | Apple Silicon；用户另行安装 h3.c 与模型 | 完成（本地工具 MVP；真实模型出片待验） | Codex / 本聊天；仅 `tools/h3-video-studio/` 与本项目交接文档。独立 Python/HTML 工具，不接 Electron、ComfyUI 或澜的发布包；提示词/参考图、串行队列、预设、固定种子、进度/取消/重试、视频预览与元数据已实现。h3.c 和权重未安装，本机生成、速度/画质/取消验收待后续。[交付](updates/2026-10-31-H3-STUDIO-01.md) |
| H3-STUDIO-02 | P1 | 下载并接入本机 H3 权重 | H3-STUDIO-01；Apple Silicon；Hugging Face 官方模型仓库 | 完成（按用户要求停止下载并清理部分权重；模型接入未做） | Codex / 本聊天；FL2VA + Ref2VA 原始权重约 290GB。下载到约 49GiB 后按用户要求停止，并删除本次模型目录、本地配置和下载日志；保留 Studio 数据库与 jobs。当前无本机权重、无 h3.c 配置，不能生成。[记录](updates/2026-10-31-H3-STUDIO-02-model-download.md)。 |
| WORLD-ASSET-01 | P1 | 用户四段真人视频的归档、抠像试验与接入方案 | 用户提供 (4)～(7).mp4；沿用 DW-03 主线 | 完成（评估与候选加工，2026-10-31；未接当前包） | Codex / BMAD 安装与修复聊天；仅新增素材批次、prepare-world-candidates.py、证据与文档，现释放写入。[交付](updates/2026-10-31-WORLD-ASSET-01-video-candidates.md)。原片 4/4 哈希一致与解码，3 派生解码、2×193 帧 alpha、check 88/88；4/6 杂边未过视觉，7 床沿暂缓；优先接 5 月夜完整场景；未改业务或重启 App |
| WORLD-SCENE-01 | P2 | 【三阶段·真人视频板块】四段真人视频接入既有播放器：日常触摸/安静回应、月夜场景与祈愿 | WORLD-ASSET-01 | 待验证（代码/构建/payload 完成；新包原生交互待重开） | Codex / 当前聊天；`world-video.js`、`world.html`、`prepare-world-video.py`、`check-world-payload.py`、world media 真源及交付文档。59/59 payload/source 哈希与签名通过。日常点击播 4、60 秒安静播 6 后接回原趴屏循环；月夜切换播 5，祈愿按钮播 7。4/6 仍有轻微抠像残边，7 床沿保留为完整场景；授权待核，不代表公开发布可用 |
| COVER-FIX-01 | P0 | 修复用户翻唱反复失败 | 用户本轮指定接手 DW-05 翻唱故障 | 完成（修复、打包及原生短曲闭环，2026-10-31；整首听感待验） | Codex / BMAD 安装与修复聊天；翻唱 shell、split_vocals、cover-jobs、面板 renderCover 进度/耗时提示与专属回归，现释放写入；保留并行修改。[交付](updates/2026-10-31-COVER-FIX-01-pipeline.md)：Python 6/6、Node 53/53、check 88/88、payload 51/51、两文件源包一致及签名通过；真实 4:39 转换 10 段，首轮收尾 127 后缓存续跑完成/解码通过；原生选曲→制作→入库→播放 8.71 秒短曲通过。当前另一长曲正运行，未重启/停止它；未做人耳听感验收 |
| COVER-03 | P1 | 翻唱音色路线结论与待修补 | COVER-FIX-01、VOCALIST-01 | 阻塞（用户判定「完全不行」放弃，2026-10-31） | WorkBuddy / 当前聊天；`scripts/{voice_range,speaker-similarity,voice-from-song}.py`、`assets/voices/voices.json`、本轮 updates 与 STATUS，现释放写入。6 个版本（磁性/温暖/孙燕姿/清冷厚实 × 移调 0/+2/+3/+6）全部被否；判定为 Seed-VC 表现力上限而非参数问题（相似度 0.74–0.77，且两参考彼此 0.836）。待修补：换引擎 RVC / so-vits-svc（需独立 Python 3.10 venv，**先确认模型来源真实存在**）或转歌姬原创；另 2652Hz 凸起未削、曲库旧版《爱错》待移除。[交付](updates/2026-10-31-COVER-03-pause.md)。**不要自动重跑翻唱** |
| VOICE-PLAN-01 | P1 | 预生成互动与连续语音方案 | 现有双音色、事件与音频调度 | 完成（仅规划，2026-10-31） | Codex / BMAD 安装与修复聊天；仅项目文档，现释放写入。[方案](VOICE-PLAN.md)、[记录](updates/2026-10-31-VOICE-PLAN-01-hybrid.md)。确认点击只有文字、缓存当前用于读书；首批 8 条 × 双音色计划、缓存/仲裁/打断验收已列；未生成或接入音频 |
| VOICE-01 | P1 | 预生成固定互动语音包并接现有舞台 | VOICE-PLAN-01；与 DW-03/04/05 协调接线负责人 | 待领取 | 待分派；独立生成器/manifest/加载模块及 assets，按方案先做 16 条；共享 main/preload/world 接线必须明确单一写入负责人。验收本地命中 0 次模型/TTS调用、缺失降级、双音色及不叠播；连续语音后续分期 |
| VOICE-02 | P0 | 采集改渲染进程 + 端点检测：说完自动发 | 无（不依赖 VOICE-01，可与它并行） | **代码已完成，待真机验收**（`voice-capture.js` + `composer.js` 已接线；单测 8 项、全量 206/206、check 90/90；**真麦克风未跑过一次**） | 实现与计划的两处偏差：①IPC 不是 `voice:start/stop/utterance`，而是 `companion:transcribe`（渲染进程自己起停，主进程只收音频）+ `voice:activity`；②用 `AnalyserNode` 轮询 RMS 而**不是** AudioWorklet——不需要额外 worklet 文件，录音交给 `MediaRecorder`，不必手写 WAV 编码。新增约束：opus 码率必须 64k，默认档会把「海风很轻」听成「海峰很清」。**V1 不依赖回声消除**：点麦克风先停播再开麦。已知未覆盖：突发强噪声（关门/拍桌）会被当成开口；`composer` 窗口 `focusable:false` 下 `AudioContext` 挂起会导致「一直没听到」。[方案](VOICE-PLAN.md#三v1半双工流水线不依赖回声消除)、[交付](updates/2026-10-31-VOICE-02-capture.md) |
| VOICE-03 | P0 | 流式对话链：SSE 首句优先 + 播放队列 | VOICE-02 | **代码已完成，待真机验收**（`lib/llm-stream.js`、`lib/reply-splitter.js`、`chat-router.runStream`、`companion-playback` 的 `enqueue` 已接线；新增单测 37 项、全量 243/243、check 92/92、包内一致；**Electron 里一次没跑过**） | 与计划的偏差：① 没有新 `lib/stream-chat.js`——编排在 `main.js` 的 `streamChat`，可单测的部分拆成 `llm-stream`（SSE 解析）与 `reply-splitter`（切句）；② 切句**没有复用** `narration.js:splitSentences`：它按书本语料设计（长段二级切），流式要的是「首块短 + 后续按播放余量放大」，规则不同，另写一份；③ 聊天每句改 wav 直传（省掉每句一次 ffmpeg），整段语音仍是 mp3；④ `CHAT_STREAM=0` 可一键退回整段请求。实测首音 2.96s（旧 6.3–8.0s）、句间间隙 0.00s、整段说完 11.4s（旧 16.8s），见[交付记录](updates/2026-10-31-VOICE-03-stream.md)。验收仍需真实设备：10 轮对话看是否叠播、断网/服务挂掉时是否仍出文字 |
| VOICE-04 | P1 | 语音打断（barge-in） | VOICE-03 | 待领取（**AEC 前置已解决**：开麦后直接读 `capture.capabilities.echoCancellation`，见 AIRI-REF-01） | 待分派。前置不再是「写探针验证」，而是「真机读一次这个布尔值」：`startListening()` 里已有 `aecKnown`，在 macOS 内置麦 / 蓝牙耳机 / 外放各看一眼即可。判定口径**已经定了**（照 AIri：`acceptSpeech = 现在没在说话 || 有 AEC`），不必再做电平比对：读到 `true` 才允许「边说她边听」，读到 `false` 就保持「她说话时我不采集」，硬上会自激。接线点已现成：`voice-capture` 的 `onSpeechStart` → `host.stopVoice()`（内部已 `cancelChat()` + `AUDIO_EPOCH++` + 90ms 淡出）。剩余工作只有假触发抑制与「mm-hmm」类回应词区分。验收：开口到静音 ≤300ms；外放与耳机各 10 轮；她不会接自己的话 |
| VOICE-05 | P0 | 实时语音链路端到端实测 + STT 服务两处修复 | VOICE-02 / VOICE-03 | **完成（量测与修复，2026-11-01；真机仍待验）**（新增 4 个量测脚本；`stt_server.py` 修「重启即失效」；单测 268/268、check 93/93） | 用 `scripts/e2e-voice-check.js` 跳过麦克风打完整链路。**实测说完→首音 4.60s**（0.06 封装 + 0.89 STT + 1.81 首字 + 2.22 首块合成），句间空隙 0.00s，长回复 118 字/6 块最大空隙 0.27s。修了两个「现在没坏、重启就坏」的问题：①`WhisperModel("small")` 传模型名会先去 HF 查 revision，断网起不来 → 改传本地路径，启动 0.3s；②faster-whisper 1.2.1 调 `av.open(metadata_errors=…)` 而 venv 是 PyAV 19（已移除该参数），**任何重启都会让语音输入整体失效**，现在能跑只因 8090 进程还是 10-30 起的、内存里是旧 av → 改用 ffmpeg 解 16k float32 再喂 transcribe。口径注意：VOICE-03 的 2.96s 是「STT 完成→首音」，本次 4.60s 是「说完→首音」，不是同一把尺。[交付](updates/2026-11-01-VOICE-05-e2e-test.md) |
| WAKE-01 | P0 | 语音唤醒 + 连续对话：叫名字就能聊，不用点麦克风 | VOICE-02 / VOICE-05 | **代码完成，待真机验收**（`lib/wake-word.js` + `composer.js` 两态循环 + 主进程预创建隐藏窗口；单测 285/285 含唤醒 17 项、check 93/93、包内 65/65 一致） | 用户诉求是「必须点麦克风」——改成常驻监听：待机只认名字，叫到后进入对话态，说一句答一句，静默 45s 或说「先这样」回待机。三个非显然结论：① whisper 对中文常输出繁体（实测 7 句里 3 句），唤醒词是简体，不转简体会**随机**唤不醒，已加 120 对高频繁简表，转完 13/13；② 只允许漏首字/尾字——漏中间的「小艾同学」等于「小同学」，会把教室里的每句话都当唤醒；③ base 模型快 0.6s 但把「深蓝」听成「新蘭」，不采用。唤醒延迟 ≈2.1s（0.32 端点 + 0.86 STT + 0.93 ack 合成）。未验：真麦克风、AEC 真值、长回复时的插话位置。[交付](updates/2026-11-01-WAKE-01-wake-word.md) |
| READ-HTML-01 | P0 | 修复电子书换行标签被读成 br | DW-05 已有导入链路 | 完成（清洗与打包验证，2026-10-31；真实原书/听感待验） | Codex / BMAD 安装与修复聊天；`lib/read-ebook.py` 格式清洗、独立 `lib/ebook-text.js`、`lib/narration.js` 清洗入口与专属回归，现释放写入；未改 media/书库/播放器/音色。[交付](updates/2026-10-31-READ-HTML-01-break-tags.md)。Python 7/7、Node 54/54，统一构建 payload 51/51、三个清洗文件源包一致、包内导入与分段、签名通过。旧书需重新导入，不自动改个人数据 |
| DW-03-REF-01 | P2 | 筛选用户分享图并收录优质参考 | DW-03 相册方向 | 完成（仅参考筛选与来源登记，2026-10-31） | Codex / 当前聊天；`docs/project/updates/2026-10-31-DW-03-share-reference-review.md`、`ASSETS.md`、`STATUS.md`、`CHANGELOG.md`、相册 `generation.json`。保留 3 项，未下载/导入/打包，许可待另行确认。 |
| FIX-01 | P0 | 剧情按钮恢复与差距复核、修复规划 | HERMES-01～03、BMAD-01 | 完成（源码修复与规划，2026-10-31；打包验收列 R1） | Codex / BMAD 安装与修复聊天；`web/live2d/gallery.js`、`Tests/gallery-interaction.test.cjs` 与项目文档，现释放写入。6/6 交互、关联 40/42（两处旧相册数量断言失败）；[交付记录](updates/2026-10-31-FIX-01-story-and-plan.md)、[后续 R1～R11](REPAIR-PLAN.md)。未改 main/preload、音频/素材/dist，未重启 App |
| FIX-02 | P0 | R1 内容源/派生/包与测试契约收口，纳入剧情修复 | FIX-01、相册增补确认 | 待领取（先与当前相册增补负责人协调） | 待分派；prepare-gallery-content、相册测试/审计/构建清单；不覆盖新增素材，完成 26 张身份/规格核实、源包一致与隔离原生 A/B/保存/重看 |
| FIX-03 | P0 | R2 通关奖励失败与重启恢复，恰好结算一次 | FIX-01 | 完成（源码+测试，2026-10-31；统一打包待并行工作树稳定） | Hermes 002 / 本聊天；`lib/{gallery,affection,content-pages}.js`、`MALFOY-ENGINE/test/gallery-reward.test.js`。[交付](updates/2026-10-31-FIX-03-reward-recovery.md)：收据+幂等结算，两处崩溃窗口注入复现均恰好一次；7/7 新测试。未重建包（并行会话正在改 world-video.js） |
| FIX-04 | P1 | R3 已打开相册/章节的跨窗口关系刷新 | HERMES-02；与 FIX-02 错开 | 完成（源码与隔离验证，2026-10-31；待统一打包/原生操作验收） | Codex / BMAD 安装与修复聊天；`web/live2d/gallery.js`、`Tests/gallery-interaction.test.cjs`，现释放写入。[交付记录](updates/2026-10-31-FIX-04-gallery-sync.md)。页面 17/17、关联后端 26/26、工程 88/88；保留灯箱规格/剧情/焦点，合并通知、丢弃过期响应、关闭后停止处理。仅用现有 IPC，未改 main/preload、后端/素材/构建或 App |
| BMAD-01 | P1 | 安装官方 BMAD 稳定版、配置 Codex 并验证需求到测试流程 | DOC-00 | 完成（2026-10-31，见[交付记录](updates/2026-10-31-BMAD-01-installation.md)） | Codex / BMAD 安装聊天 + WorkBuddy / 当前聊天（agent:workbuddy-chat-2026-10-31）；`.agents/skills`（Codex 29 个）、`.codebuddy/skills`（CodeBuddy 29 个）、`{workspace}/.workbuddy/skills`（软链 29 个）、`_bmad/`、`docs/project/bmad/`、`docs/project/BMAD.md`；保留全部既有修改，不改产品业务。**链路演示**用项目真实缺口「读书按章跳转」跑完 PRD→spec→实现→盲审→测试，再用真实小说排版压测补齐「卷一/楔子/Part I」等写法（181/181、88/88、包 28/28）。**未提交**：工作树混着 DW-05 的改动，需分开提交 |
| HERMES-03 | P1 | 视频锚点静帧与动作尾部淡出 | HERMES-02 | 完成（2026-10-31，见[交付记录](updates/2026-10-31-HERMES-01-gallery-memory.md#p1-追加锚点静帧与动作尾部淡出)） | Hermes 002 / 本聊天；`assets/whale-world-web-v1/anchor-idle.png`、`world-video.js`、`world.html`、`prepare-world-video.py`、`Tests/world-video.test.cjs`、探针。触摸尾部 0.4s 淡出到锚点；加载/失败也显示锚点 |
| HERMES-02 | P0 | 点击台词、关系称呼与跨窗口实时同步 | HERMES-01 | 完成（2026-10-31，见[交付记录](updates/2026-10-31-HERMES-01-gallery-memory.md#p0-追加同日点击台词关系称呼实时推送)） | Hermes 002 / 本聊天；`pack.json` 台词、`lib/content-pages.js`、`preload.js`、`main.js`、`world.html`、`project_audit.py` 与测试。点击按睡眠/趴屏/普通轮换；称呼启动与点击时短暂显示；`affection:changed` 推送到所有窗口 |
| HERMES-01 | P0 | 相册/剧情接入当前入口 + 记忆管理页 + 共享好感度 | DW-02 | 完成（2026-10-31，见[交付记录](updates/2026-10-31-HERMES-01-gallery-memory.md)；相册规格续项见[壁纸分规格](updates/2026-10-31-DW-03-album.md)） | Hermes 002 / 本聊天（agent:hermes-002-2026-10-31）；新建 `lib/{gallery,memory-admin,affection,content-pages}.js`、`web/live2d/{gallery,memory}.*`、对应测试与 `scripts/prepare-gallery-content.py`；最小接线 `main.js`/`preload.js`/`world.html`/`build-companion.sh`。**DW-03 的相册/剧情部分由本任务完成，WorkBuddy 不再重复领取** |
| UI-01 | P1 | 漂浮按钮与对话窗毛玻璃精修 | 现有 composer | 待验证（已打包，原生桌面观感待验） | Codex / 本聊天（2026-10-31）；composer.css、HTML 外观、main 原生材质接线、包校验与窗口替身；[交付记录](updates/2026-10-31-UI-01-glass.md)。12 项回归、42 项源包、Ego 实际尺寸检查通过；DW-05 业务修改保留，现释放文件写入。 |
| DOC-00 | P0 | 统一方向、入口、现状与成果汇总 | 无 | 完成 | Codex / 本次聊天；文档、project.sh、project_audit.py、参考图归档 |
| CONTENT-01 | P1 | 按剧情骨架规划豆包视频与逐镜提示词 | PRODUCT 现行设定 | 完成（制作提案，未生成） | Codex / 豆包剧情视频规划聊天（2026-10-30）；仅 docs/project/VIDEO-PLAN.md、README、STATUS、TASKS、CHANGELOG 与本任务 updates；6 条剧情、4 条日常提示词与验收，[交付记录](updates/2026-10-30-CONTENT-01-video-plan.md)；未包含用户选定新场景、实际出片或客户端接入 |
| DW-01 | P0 | Electron 数据隔离与安全测试入口 | DOC-00 | 完成（2026-10-30，见[交付记录](updates/2026-10-30-DW-01-isolation.md)） | WorkBuddy 聊天（2026-10-30 晚，agent:workbuddy-chat）；已改 `MALFOY-ENGINE/lib/`、`main.js`、`test/`、`scripts/check-electron-isolation.sh`、`build-companion.sh` |
| DW-02 | P0 | 一个身份、共享会话与双音色 | DW-01 | 完成（2026-10-30，见[交付记录](updates/2026-10-30-DW-02-dual-world.md)） | WorkBuddy 聊天（2026-10-30 晚，agent:workbuddy-chat）；已改 `MALFOY-ENGINE/lib/{identity,session-store,memory-store,config}.js`、`main.js`、`preload.js`、`test/`、`scripts/{check-dual-world.sh,mock-chat-server.js,voice-metrics.py}` |
| DW-03 | P0 | 已有视频、相册、剧情迁入当前双世界入口（视频部分属三阶段板块，只修缺陷） | DW-01；共享状态需协调 DW-02 | 进行中（相册/剧情与六组壁纸双规格已接入并打包；窗口行为和视觉验收待做） | Codex / 本聊天（2026-10-30）；main.js、preload.js、lib/window-policy、world.html、world-video、独立悬浮聊天页、视频派生素材、构建与验证脚本；保留 DW-01/02 及 Q 版改动 |
| DW-04 | P1 | Q 版动作与桌面交互 | 纯动作先行，身份/服务接入依赖 DW-02 | 进行中 | Codex / 当前聊天；world.html、chibi-motion/renderer/texture/performance/face/presence、素材、预览、打包与文档；情境/独立面部/边缘过渡已构建；本轮已修正尺寸/眼睛与 main/preload 尺寸接线，Ego 实图通过，完整原生验收待续；未改个人数据 |
| DW-05 | P1 | 唱歌、阅读与统一音频控制 | DW-02、DW-03 内容适配 | 进行中（代码与产物就绪，待听感验收，2026-10-31） | WorkBuddy 聊天（2026-10-31，agent:workbuddy-chat-2026-10-31）；接手自 [接手单](WORKBUDDY-HANDOFF.md)、[已做与证据](updates/2026-10-31-DW-05-chat-media.md)。范围 main/preload、media/cover/chat lib、composer/player、翻唱脚本与测试、本轮 benchmarks/2026-10-31-DW-05-workbuddy/；保留 DW-01～04 与其他修改。**进展**：真实翻唱已出整首成品 `assets/whale-cover-test-20261030/cover-full-studio.m4a`（3:30，studio 档为用户选定音色），管线内建分片可跑任意长度；读书两种模式、配音表可编辑、按块增量分析、并发合成都已落地，162 项测试 / 88 项静态 / 9 项隔离 / 包 28/28 与签名通过。见[音色迭代](updates/2026-10-31-DW-05-workbuddy-timbre.md)、[收尾补齐](updates/2026-10-31-DW-05-workbuddy-polish.md)、[读书稿](updates/2026-10-31-DW-05-reading-narration.md)。**待用户真耳验收**：整首翻唱接缝与明亮段落、真实电子书多角色朗读；App 入口「制作/取消/播放」未走完整链路。 |
| CHIBI-02 | P1 | Q 版走路帧图集生成与移动播放接线 | DW-04 表演系统；素材走 agens 图像 API | 完成（源码/图集/单测/GL 实测，2026-10-31；App 内人眼观感待用户验收） | Hermes 002 / 本聊天；`assets/whale-chibi-walk-v1/`（新增 6 帧+source+README+prompt+原图）、`web/live2d/chibi-walk.js`（生成）、`Tests/chibi-walk.test.cjs`、`scripts/prepare-chibi-texture.py`、`chibi-performance.js`、`chibi-renderer.js`、`world.html`、`motion-preview.html` 轮播加走路段。[交付](updates/2026-10-31-CHIBI-02-walk.md)：8/8 单测、全量 298/298、prepare+walk PASS、修复 renderWalk uOpacity 首帧透明 bug、GL 实测 9889 蓝像素证据。不改 main/preload、DW-05 媒体与业务 lib |
| LIVE2D-POC-01 | P2 | Live2D 对照小样：内部预览页 + 澜分层原画规格 | 与 CHIBI-02 并行；不接主线 | 完成（页面+模型+规格文档+浏览器实测 loaded=true，2026-10-31；参数探针 null 待修） | Hermes 002 / 本聊天；`assets/live2d-poc/`（vendor+Hiyori，仅内部）、`web/live2d/live2d-poc.{html,js}`、`docs/project/LIVE2D-POC.md`、[交付](updates/2026-10-31-LIVE2D-POC-01-sample.md)。示例模型不随产品分发、未进构建 payload |
| CHIBI-03 | P1 | Q 版画风升级（用户参考图风格）+ 巴西顺拐舞搞怪状态 | CHIBI-02 管线；agnes i2i | 完成（走路/舞蹈已接线，2026-10-31；16 姿态新画风暂存待锚点标定；App 内观感待用户验收） | Hermes 002 / 本聊天；`assets/whale-chibi-style-v1/{walk,dance,poses,facebase}`（四张一次生成过 QC）、`web/live2d/chibi-dance.js`（生成）、`Tests/chibi-dance.test.cjs`、`scripts/prepare-chibi-texture.py`、`chibi-performance.js`、`chibi-renderer.js`、`world.html`、`motion-preview.html`。[交付](updates/2026-10-31-CHIBI-03-style-dance.md)：dance 6/6、全量 299/299、prepare +walk +dance PASS、重建包含双图集。后续项：performance 图集 layout/face 锚点标定工具 |
| CHIBI-06 | P1 | B 方向首批动作样片 | CHIBI-05、INT-REF-02 | 阻塞（待机/点击/走路姿态候选；工作姿态生成服务连接失败，视频待生成） | Codex / 当前聊天（agent:codex-chibi06-2026-10-31）；仅新增 `assets/whale-chibi-actions-2026-10-31/`、本任务验证与项目交接文档；待机/点击/走路姿态候选已生成，走路无可靠左右交替；工作姿态生成两次连接失败；均不是动画；验收角色一致、动作连续与锚点。[记录](updates/2026-10-31-CHIBI-06-idle-study.md)；不改共享舞台、DW-05 或 #7。 |
| INT-REF-02 | P1 | 参考项目前端与动作模式学习 | INT-REF-01 | 完成（源码/配置/素材清单、截图及六段离散抽帧研究；未运行） | Codex / 当前聊天（agent:codex-int-ref-2026-10-31）；[研究记录](updates/2026-10-31-INT-REF-visual-study.md)、[动作制作规格](CHIBI-ACTION-BRIEF.md) 与项目交接文档；不碰 DW-05 或 #7。 |
| INT-REF-01 | P1 | 竞品优秀能力集成方案（dsh-pet/AIRI 源码级调研→工作单） | 无 | 完成（2026-10-31，规划交付） | Hermes 002 / 本聊天；`docs/project/INTEGRATION-REF.md`：七项按优先级排好、含参考文件路径/落点/验收/许可红线；执行者按本表领取（#1 即 DW-06 蓝本，#7 需 WorkBuddy 协调） |
| DW-06 | P1 | Agent 工作过程、取消与成果交付 | DW-01、DW-02 | 阻塞（核心状态机完成；共享接线待协调） | Codex / 当前聊天（agent:codex-dw06-2026-10-31）；先负责新增 `MALFOY-ENGINE/lib/work-status.js`、`MALFOY-ENGINE/test/work-status.test.js` 与任务交接文档；验收六档事件压缩、任务身份、取消/超时后晚到事件隔离。`main.js`/`preload.js` 由 WorkBuddy 持有，`world.html` 有进行中任务，接线前需协调；不碰 DW-05 音频及 #7。 |
| DW-07 | P2 | 简单成长与可管理的长期记忆 | DW-02 | 待领取 | 待领取 |
| CO-CREATE-01 | P1（既有读书/双空间真机验收后） | 与澜共读、共写一段故事，选择是否关联“被打回原形后重新开始”的修仙剧情；正典/草稿/个人记忆分离，确认、撤销和导出 | 接线验收依赖 DW-05 真实读书试听、DW-03 双空间原生验收及改造总图 P1-1 事实/事件契约；不必等待整个 DW-07 成长功能，也不以 Vidu 为前提 | 待领取（方向已确认，细节待设计） | 待分派；先独立设计作品/世界事件契约与隔离存储，不占用并行 main/preload/world.html。验收用户拒绝不持久化，确认后跨形态/重启准确接续，纠正/撤销/导出有效；不得冒充当前已实现。详见 [改造总图](LAN-COMPANION-REBUILD-PLAN.md)。 |
| VIDU-RESEARCH-01 | P2（独立研究） | 实时真人互动第三模式技术验证，不改变现有双空间默认路径 | CO-CREATE-01 可独立；先核 API/许可/费用/隐私，再评估连续视频延迟、形象稳定与打断 | 待领取 | 待分派；只做隔离样机与实测记录，不写当前主线行为或个人数据；不以论文/演示宣传已实现。 |
| DW-08 | P2 | 独立构建与首版开源准备 | 首版功能完成 | 待领取 | 待领取 |

## 每项交付标准

BMAD-01 安装校验补充（Codex / 本聊天，已完成）：新增 `scripts/{bmad.sh,check-bmad.py}`、`Tests/test_bmad_setup.py`，官方技能校验 Codex/CodeBuddy 各 29 项、0 发现；15/15 隔离回归，独立审查 4 项已修复并复查。上述结果与 WorkBuddy 的产品功能测试分别记录，见[同一交付记录](updates/2026-10-31-BMAD-01-installation.md)。

### DW-01：先让测试不碰个人数据

- 主进程统一解析显式数据目录，兼容既有默认目录；Electron 当前尚不支持 LINGDESK_DATA_DIR，不能只给启动命令加环境变量就宣称隔离。
- memory/profile/设置及测试产物纳入覆盖；服务配置集中，不复制凭据。检查现有配置有无内嵌私密值，清理时不把值写进报告。
- 新增隔离验收入口；替代会写真实记忆、打印历史和杀进程的旧 verify-integration.sh。不以改 HOME 或绕过 Ego 限制达成测试。
- 验收：临时目录写入与重启可复现；真实目录文件未变化；日志无个人数据。模式、聊天、TTS、工作后续测试都用该入口。

### DW-02：同一个人的两个形态

- 用主进程持有一个身份、会话、记忆和任务状态；清理残留 Malfoy 身份。两形态只改变呈现与语气，不分裂人格。
- 所有成功聊天路径，包括 fallback，都按相同策略记录；形态切换不重置会话，不重复提交请求。
- Qwen3 清冷/活泼的 profile 有明确配置；合成结果记录实际引擎和回退，不把 edge/say 当 Qwen3 成功。
- 验收：隔离数据下跨形态、跨重启回忆；纠正错误事实；双音色真实合成与试听；异步返回和中断无叠播。

### DW-03：把做好的内容真正接到主线

视频/悬浮窗口阶段：[2026-10-30 交付](updates/2026-10-30-DW-03-video-float.md)。已接原视频模式、兼容派生、真人小窗、独立打字/录音入口；该阶段 24 项新增逻辑、37 项既有回归及 30 项 Q 版回归、29 项包校验与签名通过。当时受审批错误影响的进程检查、后续复查见原交付；相册/剧情随后由 HERMES-01 接入，不再重复迁移。DW-04 同一负责人同时维护 world 页面，未覆盖他人改动。

- 沿用现有 pack/character 的内容 ID、解锁、剧情分支和奖励规则，通过适配层接入当前 world.html；旧 index.html 有面板不等于当前入口可达。
- 核实 Electron 编码支持，从保留原件生成兼容派生文件；不直接删除 ProRes 原片，不直接改 dist。
- 当前 1 章/6 段静帧剧情与两分支已接；相册源/派生/包数量已由并行工作更新为 26/26/26（FIX-01 收尾快照）。按 [R1](REPAIR-PLAN.md) 核实原版 / v2 / v3 与新增图的独立清单、全部 ID/文件，收口旧数量测试与剧情新修复打包；不能靠修改断言或混用身份蒙混通过。
- 引入睡眠整场景与返回；没有躺下/起身素材时明确表现，不承诺自然过渡。轮回瓶剧情已撤销，新增修仙剧情以 PRODUCT 的“被打回原形”设定为准；现有潮汐初遇仅是试验内容。
- 验收：主线实际入口播放、模式切换、相册最后一排/保存、剧情 A/B、奖励幂等；构建产物包含配置全部引用，源与包校验一致。

### DW-04：Q 版成为可互动桌宠

第一阶段：[骨骼与动作交付](updates/2026-10-30-DW-04-motion.md)。已接原图有限骨骼/混合/随机行为、拖拽与命中；纯动画按本次用户指令先行，不依赖个人数据或真实聊天。完整 DW-04 尚需分层原画和原生桌面验收，不能把本阶段小幅形变称为完整走路/大幅动作集。

当前修正（Codex / 本聊天，2026-10-30）：用户指出原图偏瘦、不符合参考。负责 assets 新版圆润 Q 版、运行纹理路由、chibi-motion 绑定点/权重、预览及构建核验；保留 v1 与其他 agent 修改。视觉目标按两张参考校准：两头身、宽圆脸、短四肢、蓬松轮廓、明显鲸尾。

本轮延续（Codex / 同一聊天）：用户已接受 v2 形象，要求明显的情境表演。负责情境动作图集、chibi-performance.js、当前 renderer/world/preview 接入、生成与打包检查和交付文档；不修改 main/preload/个人数据。工作/阅读/歌曲业务未接通的事件提供明确预览和接口，不冒充功能完成。

用户追加（同一负责人）：面部拆成独立眼睛/眉毛/嘴/脸红控制层；增加屏幕边缘躲藏探头、出入世界动画。负责新 chibi-face / chibi-presence 模块及 world/preview、素材与构建核验。沿用现有 host enterWorld/summon，不写 main/preload；托盘瞬间关窗的离场动画需后续主进程协调。

- 参考项目内两张风格图，保持鲸鱼识别特征；选择身份一致的待机、走路、触摸、忙碌、读书、唱歌、休息最小动作集。
- 当前 PNG 平移不算动画完成。图集/序列帧先统一画布、脚底锚点、透明背景和状态映射，再接现有 Stage，避免新播放器并行路线。
- 验收：拖动/移动、点击、聊天、空白穿透与屏幕边界；忙碌时反馈；多屏若未验证写明。

### DW-05：声音与陪伴闭环

- 按用户最新纠正，唱歌采用真实原唱 → 分离 → 歌声模型转换 → 混回伴奏；旧两首念词实验折叠保留，不作为唱歌验收。
- 统一 TTS、唱歌、阅读的播放仲裁、暂停、停止与形态切换；阅读进度可恢复。
- 原创唱歌若作为卖点，再补人工动机、伴奏、逐句时长控制；现有短样例仅证明管线。
- 验收：用户真实原曲的翻唱成品、制作/取消/播放；原生打开 TXT/MD/EPUB、朗读续读；连续操作无叠播；跨重启进度；听感由用户真实试听确认。接手步骤见 WORKBUDDY-HANDOFF。

#### DW-05 读书稿与多角色配音（2026-10-31，WorkBuddy / 当前聊天，待用户试听）

用户口述：电子书里链接和图片太多必须过滤；希望分段、标注字怎么念（`80后` 被念成「八十后」）；
多角色能变声给多个音色；**小说交给 AI 先分析一遍，可选精读多人配音，也可选实时阅读不分角色**。

已做：`read-ebook.py` 清洗（外链/图注/页码/目录/脚注/重复页眉/悬空残句/硬换行合并）；
`lib/narration.js` 读音规范化 + 语义分段 + 旁白对白切分与角色识别；
`lib/voice-script.js` 按角色分音色合成、ffmpeg 拼接（每段裁首尾静音）；`reading.json` v2 + 预取；
`lib/book-analysis.js` 模型分析角色表（含别名、性别、年龄段），两种模式可在面板切换，
分析失败自动回退规则推断。证据与限制见 [交付记录](updates/2026-10-31-DW-05-reading-narration.md)。

**2026-10-31 收尾补齐**（[交付记录](updates/2026-10-31-DW-05-workbuddy-polish.md)）：
配音表改为可编辑（`set-cast`，改完按新表重切并让旧音轨失效）；多句对白改受控并发（默认 3，6 句 900ms→333ms）；
长文改按块增量分析（默认 3 块，后续块带已知角色只补新的）；顺带修两个真 bug ——
预取 in-flight 时重复合成、分段硬上限未生效；并修掉「老陈**又**问了一遍」被认成角色「老陈又」。
唱歌管线内建分片（`CHUNK_MAX` 默认 29s），长歌不再需要外部手工切段。

**剩余（按优先级）**：

1. 用一本用户真实电子书做听感验收；重点听多角色接缝、长段落的节奏，以及数字读法还有没有漏。
2. ~~配音表可编辑~~ —— **已做**（2026-10-31），但未做真实电子书下的视觉/交互验收。
3. ~~按章增量分析~~ —— **已做**（2026-10-31，默认 3 块 ≈18000 字）；超长篇仍需按需加大 `maxChunks`。
4. 多音字/生僻字若要准，再加大模型精修 —— 必须做成按段懒处理，不能导入时全书过模型。
   （试过让模型标整本读音，会把人名改成同音字，已砍掉。）
5. ~~串行合成偏慢~~ —— **该优化作废**（2026-10-31 压测推翻）：原「900ms→333ms」是 mock 计时，
   真实 Qwen3-TTS 单条约 2s，且服务端推理已加串行锁 —— 3 路并发总耗时 7.8s（排队 0/3915/5762 ms）
   反而**慢于**串行约 6s。默认并发已改回 1。要真的快只能做服务端批处理或逐句流式播放，未做。
6. ~~翻唱「女主参考音色不可用」~~ —— **已修**（2026-10-31）：改为读定稿唱歌音色资产，
   不再现场调 TTS；并由 App 自动保活 TTS 服务。见
   [根因与修复](updates/2026-10-31-DW-05-tts-voice-asset.md)。成品仍未人耳试听。

### DW-06：能交付工作的桌宠

- 复用现有 Hermes/companion:work 接口，增加任务 ID、运行/完成/失败/取消状态、进度、超时和可打开的产物。
- 切换形态不重复工作；取消后的晚到结果不覆盖当前任务。是否授权外部写操作按用户实际请求判断。
- 验收：一个真实本地文件任务，能打开产物；失败、取消和超时有可复现证据，不能只显示聊天文本“做完了”。

### DW-07：可解释、可纠正的成长

- 先做稳定身份、事实/偏好记忆、有限关系与语气变化。不要上复杂世界模型，也不要以频繁点击直接训练人格。
- 用户可查看、纠正和删除记忆；剧情状态与真实事实分开，控制遗忘与摘要。
- 验收：跨形态一致，错误可纠正且不重新召回，删除有效；成长变化能解释来源。

### DW-08：可复现的首版

- 将依赖母体 App 的构建逐步替换为明确版本和锁定依赖；临时目录完整构建、验证后替换产物，避免先删唯一可用包。
- 列出模型、服务、权限、资源大小与跨机器安装步骤；检查秘密、个人数据和素材许可。非营利/开源代码不自动授予素材再分发权。
- 软件与素材分别列许可；授权不清的参考图不随公开发行。完整本机验收、干净环境构建和功能演示后再称“可发布”。
- 用户于2026-11-01授权上传GitHub：origin 为公开 exasdwyh-commits/lan-companion（GITHUB-PUBLIC-02用户授权），按 GITHUB.md 的快照分支同步；安装包发行仍另行处理。

### CHIBI-02：Q 版走路与移动表现（2026-10-31，Hermes 002 / 本聊天）【完成，见交付记录】

- 生成 6 帧同身份走路循环图集（v2 参考图生图、两头身、白底转透明、统一脚底锚点），登记 source.json/README/提示词与像素判据。
- `prepare-chibi-texture.py` 可选嵌入走路图集；图集缺失时构建与运行均降级不报错，现有 16 帧图集校验不变。
- world 漫游移动（roam 目标更新产生的位移）时按移动状态播走路帧，停止回 idle；拖拽中维持现有惊讶反馈，不用走路帧。
- 验收：图集哈希/矩形无重叠无漏帧、缺图集降级单测、移动播放逻辑单测、预览可见走路切换、`project.sh check` 通过；重建包后包内含新图集且 payload 校验通过。
- **结果**：8/8 单测、全量 298/298、`prepare --check` +walk PASS；GL 实测修复首帧透明 bug（uOpacity）并留像素证据；App 内人眼观感与预览走路由用户验收。

### LIVE2D-POC-01：Live2D 对照小样（2026-10-31，Hermes 002 / 本聊天，仅内部）【完成，见交付记录】

- vendor 三件套（pixi/cubismcore/cubism4）与 Hiyori 示例模型存 `assets/live2d-poc/`，不随产品分发、不进构建 payload。
- `web/live2d/live2d-poc.html`：透明画布、居中、追视、待机/点击动作，暴露 `window.__poc` 供外部验证；不改 world/main。
- `docs/project/LIVE2D-POC.md`：澜分层原画规格（部件清单与约束）、授权边界、与现版图集方案的对比验收清单。
- 验收：本地浏览器实开页面加载出模型、`__poc.loaded=true`、文档成文；对比结论等 CHIBI-02 落地后同台实测定。
- **结果**：浏览器实测 `loaded=true`、模型 279×392px 渲染；`__poc.params` 探针 null 待修，不影响技术结论。

### 2026-10-30 本轮运行验收（Codex / 同一聊天）

用户明确要求“测试一下”。负责隔离数据下当前 DeepWhale.app 的原生窗口、视频模式、独立对话与录音入口；Ego Lite 页面播放/表情检查、必要的确认缺陷修复与重新构建。证据写 benchmarks/2026-10-30-DW-03-runtime；不终止用户旧 Swift 进程、不触碰个人会话。

用户追加：眼睛/表情不自然、人物偏胖与个头过大。同期负责 main/preload/world/chibi-face 的默认等比尺寸、托盘大小选项和独立眼睛绘制修正；不横向压扁原画，不改他人素材。

本轮修正完成并重新构建：[运行复查、尺寸与眼睛](updates/2026-10-30-DW-03-runtime-size-face.md)。原生图标展开和 Ego 视频/表情已验；麦克风、完整原生桌面观感与多屏继续待验。

### SOUL-HOMESTEAD-01：灵魂与家园四引擎（2026-11-01，Arena Agent / 用户授权，引擎层）【完成，界面层未接】

- 用户本轮需求：3D 动作自然度、场景与元素更丰富、室内玩法扩展、外出旅行、更多服装、多款猫、钓鱼、花园种花草、更多小游戏、她更智能且能自己改造小屋（类似我的世界）、有一个可通过互动调整的灵魂。
- 本轮只做**能自动验证的规则层**，四项：`lib/soul.js`（五轴性情 + 真实时间半衰回归 + 事件表 + 自我描述 + 想要什么）、`lib/garden.js`（6 地 6 种、按真实时间推算生长、浇水打折、月光花夜间窗口、收获还种子）、`lib/fishing.js`（4 钓点作息 + 8 种鱼 4 档稀有度 + 可注入 rng + 图鉴）、`lib/room-plan.js`（14×9 格 + 22 件家具 + 原子 apply + 结构化错误回灌大模型）。
- 接入不是摆设：`buildSystemPrompt` 增加共用性格段（两形态同一份，身份段逐字节不变）、`getPersona()` 注入、戳她/聊天成功各记一笔、启动 `settle()` 对账、12 个 IPC（窗口校验与麦克风权限同口径）。
- 验收：新增 41 单测全 PASS；全量 336 用例 325 PASS，11 项失败均为既有缺 fixture；`main.js` 语法通过；`project.sh check` 不再在干净 clone 上崩（修 `ROOT.parent` 硬假设与文档链接检查口径），剩余 10 项为未发布素材缺失。
- **未做且必须真机做**：3D 动作自然度、场景/室内元素、旅行与服装、多款猫、新小游戏、以及上述四引擎的**渲染与界面层**。这几项都需要 macOS + 母体 App + WebGL 迭代，本环境无法验证，硬写等于交付不可测代码。下一项 `SOUL-HOMESTEAD-02`：小屋与花园界面 + `lib/intent.js`（把 `soul().wants()` 接进闲置调度，让行为由性情驱动）。
- 影响：无新增外部依赖、无新素材、运行入口不变；新增 4 个数据目录 JSON 状态。

### SOUL-HOMESTEAD-01 第二批：主动行为 + 改造闭环（2026-11-01，Arena Agent）【完成，界面层未接】

- `lib/intent.js`：从 `soul().wants()` 派发到「真的去做」。可行性优先于意愿（屋里摆满就不硬改）、夜里只休息、每动作独立冷却 + 全局 20 分钟闸、时钟回拨不会被当成永久冷却。
- `lib/decorator.js`：模型出 `plan` → `room-plan.apply` 原子校验 → `describeErrors` 把错误翻成人话回灌 → 重试 ≤3 轮 → 不成则房间保持原样。`generate` 注入，无网络可测；`extractPlan` 只认括号配平的 JSON，不宽松解析。
- 主进程：`startIntentClock()`（默认 5 分钟，`INTENT_TICK_MS` 可调）+ `runIntent()` 执行真实后果 + `intent:peek`/`intent:run` 两个 IPC。台词走 `character:say` 且不碰 `seq`，不打断正在进行的对话。
- 新增 `docs/project/AGENT-SCOPE.md`：把「可以独立做完、靠单测验收」与「必须 macOS + 母体 App + WebGL 才能验」分成 A/B 两类，并给出 3D 动作自然度的诊断→归类→改法流程（不盲改 `lan-model.js` 里按实测定死的姿势常数）。
- 验收：6 个新模块测试合计 62/62 PASS；全量 357 用例 346 PASS，11 项失败均为既有缺 fixture；`main.js`/`lib/*.js` 语法全通过。

### WORLD-FX-01：画面元素（2026-11-01，Arena Agent）【已交付，量感待人眼确认】

- 新增 `web/moli-room/scene-extras.js`：窗光柱（沿太阳方向挤出的楔形 + 软边/衰减/噪声着色器）、浮尘（420 点，漂移全在顶点着色器）、玻璃雨（水珠网格 + 拖尾 + 薄雾）、夜萤（窗外锥内 46 点，脉冲）。全部只读 `W` 与 `world.altDeg`，构建失败即降级、房间行为不变。
- 接入 `index.html` 三处：script 标签、`sceneExtras` 初始化（`?fx=0` 可关，`window.__lanFx` 为验收句柄）、主循环 `composer.render` 前一行 update。
- 新增 `tools/room-fx-probe.py`：在 headless Chromium + SwiftShader 里跑**真实房间页含完整后处理链**，用 `?at=`/`?wx=`/`?cam=` 固定条件，在同一次加载内开关特效。断言用几何投影覆盖率（无噪声），像素差仅作参考。
- **方法论更正**：像素差在调色 pass 的动态颗粒 + 窗外动态海面前不可用；块平均可消颗粒但消不掉海面动画。最终判定改为「顶点投影到屏幕的 NDC 包围盒覆盖面积」，`area=0` 即「没画在画面里」。
- 验收：4/4 场景通过（dawn/noon/rain/night），无脚本错误，各元素在画面内且面积合理、雨面积 <35%（不糊满屏）；全量 node 测试 357 用例与本次无关（11 项既有缺 fixture）。
- 调参记录：初版强度 0.85 / 长度 6 → 整间房被暖雾洗白；改 0.30 / 上限 4 / 横向 2.2 次方后成为窗边一层光。

### WORLD-FACE-01：口型与表情（2026-11-01，Arena Agent）【已交付，无头工装验收】

- 用户本轮需求之一：「角色可以互动说话，模型表情和说话要同步有动画」。
- 资产事实：单一 skinned GLB（`rigVersion 15`），**没有 morph target、没有面部骨骼**。所以口型只能是**附加覆盖层**，不是 blend shape。改模型需要重新绑定与权重，超出「改代码」范围。
- 新增 `web/moli-room/lan-face.js`：2D canvas 覆盖层，每帧把 `lan-head` 骨骼投影成锚点，并用「沿镜头右向量走一米」算每米像素数，所有尺寸以**世界米**表达，跟机位/窗口无关。嘴 / 腮 / 眉 / 笑眼用 `multiply` 混色画出墨感。
- 同步三条驱动：真实语音 RMS 包络（`AnalyserNode`，首次点击后才接，避免 suspended 上下文把 `<audio>` 静音）、中文音节时间轴（元音决定开口度、标点算停顿）、真实 `audio.duration` 缩放整条时间轴。每帧取 `max(时间轴, 包络)`，起音 20ms / 落音 90ms 不对称平滑。
- 表情状态机 7 种（neutral/happy/shy/sad/surprise/think/sleepy），从回复文本关键词自动推，也可 `LanFace.emote(name, ms)` 外部指定；`setBusy(true)` 进 think。
- `?face=1` 是标定层：画嘴/眼/眉/腮四条标尺 + 0.05m 刻度，用来对着真脸校 `TUNE`。实测 `lan-head` 落在**眼睛高度**（不是颈根），嘴在锚点下方 8mm——这个结论已写进代码注释，换模型必须重量。
- 新增 `tools/face-probe.py`：真实房间页 + headless Chromium + SwiftShader，一次加载内 11 项断言（锚点可见/在画面内/ppm 合理、说话有峰有起伏、停下 2s 内归零、shy 腮红显著高于 neutral、无脚本错误）。`python3 tools/face-probe.py` 全绿。
- 验收取舍：口型有确切数值状态，**不做像素比对**（本屋动态颗粒 + 窗外海浪会污染阈值，同 `WORLD-FX-01` 的结论）；截图只作 `--keep` 人工参考。
- 已知限制：GLB 无眼睑几何 → **不做眨眼**（硬画会盖掉她原本的眼睛），要做得换贴图不能做加法。默认机位下她只有 90px 高，嘴是 8px 一条线，这是分辨率下限。说话时的身体动作仍归 `lan-model.js` 的 `pose()`，本次一个常数都没动。

### WORLD-UX-21：界面收口（2026-11-01，Arena Agent）【已交付，量感待人眼确认】

- 用户本轮需求之二、三：「把不好看的 UI 都优化了，更符合成熟商业化美化」「把太大遮挡都要考虑到」。
- 先把问题数清楚：底栏 89×40 文字胶囊与 46×46 图标方块混排、右上两颗原生感按钮、底栏+聊天条+气泡在 540 高的窗口里吃掉下方 35%、左下提示语与版权行重叠、`已连接` 常驻小字压画面。
- 新增 `web/moli-room/ui-skin.css` + `ui-skin.js`（在 `lan-companion.css` 之后加载，只加 class 不动逻辑）：全部入口统一成 38px 图标 + `data-tip` 浮标；五个 CSS 变量驱动全部浮层的咬合；闲置 3.6s 退场到 30% 且悬停/指针立刻唤醒（`?uiidle=0` 常驻）；聊天条收窄成药丸；夜晚转深色玻璃；小窗口与电视模式各自让位。
- `ui-skin.js` 按中英标签把后注入的「相册/书架/看澜」也换成图标，认不出就原样保留——宁可难看，不要猜错功能。`window.__lanUI.dockIcons` 暴露每颗按钮的尺寸与提示，供无头断言。
- 未做：面板内部版式（`lan-companion.css` 已有的排版语言本次不动）、设计稿级别的美化。**尺寸与遮挡**是可量的，已保证；审美判断仍是 B 类，需人眼。
