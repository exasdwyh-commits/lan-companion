# 2026-11-01 · WORLD-RIG-12 · 新模型运行时骨骼绑定（零件互不联动）

## 归属

- 负责人 / 聊天标识：Codex / 本聊天
- 任务：TASKS 中的 `WORLD-RIG-12`，承接 `WORLD-MODEL-11`（造型接入，当时无骨骼）与 `WORLD-MODEL-10`（混元多视图模型制作）。
- 开始时已有修改：`lan-model.js`（MODEL-11 写的静态加载版）、`index.html`（MODEL-11 的接入口与 idle 拦截）、`assets/lan-room/lan-v2-game.glb`（MODEL-10 制作）。
- 本次负责文件：
  - `MALFOY-ENGINE/web/moli-room/lan-model.js`（整体重写为运行时绑定）
  - `MALFOY-ENGINE/web/moli-room/index.html`（pose 接线一行；撤 idle 拦截；脚本版本戳）
  - `MALFOY-ENGINE/web/moli-room/LOCAL-CHANGES.md`
  - `docs/project/{TASKS.md,STATUS.md,CHANGELOG.md}`、本文件
  - `benchmarks/2026-11-01-WORLD-RIG-12/`（证据 7 张）

## 用户诉求与实现方式

用户原话：「重新优化了模型，你把骨骼接上，避免出现头发和四肢联动的问题，各个零件要独立」。

模型现状（实测）：`lan-v2-game.glb` 是**单网格、无骨骼、无拆件**——1 个 mesh、17.4 万有效顶点（另有约 2000 个坐标垃圾的顶点）、单材质、节点带 X+90° 旋转。所谓“头发和四肢联动”的风险在于：整张皮挂一个节点，任何动作整块走形。

### 实现的四步（全在 `lan-model.js`，约 300 行）

1. **烘焙旋转**：`gltf.scene.updateMatrixWorld(true)` 后 `geo.applyMatrix4(srcMesh.matrixWorld)`，把节点上的 X+90° 烘进顶点，之后所有骨骼数学都在“直立、脚底 y=0”坐标系里做。
   *坑：GLTFLoader 解析完 `matrixWorld` 是单位矩阵，不先 update 就烘不进去——第一版分区全落进腿就是这个问题。*
2. **建骨架**：12 根骨全部平铺挂在 root 骨下（root/spine/head/skirt + 臂 upper×2/lower×2 + 腿 upper×2/lower×2），关节位置按网格实测解剖位标定。
3. **分区蒙皮（核心）**：逐顶点按几何坐标判定归属，**硬归属**（每顶点 skinIndex 只写一根骨、权重 1）：
   - 头发（头顶 + 侧垂长发，含 z < -0.115G 的后发区）→ 只归头骨
   - 袖子/前臂（0.24G~0.545G 高度、|x| 0.085G~0.245G）→ 只归该侧臂骨（肘上下分 upper/lower）
   - 裙摆（y < 0.44G 且 |x| > 0.155G 的外扩区）→ 只归裙骨
   - 腿（y < 0.44G 内侧，膝上下分 upper/lower）→ 各归各腿
   - 其余 → spine；坐标垃圾顶点 → spine（`dead` 防护）
   因为任何顶点都**绝不同时挂两根骨**，头发和四肢在物理上不可能互相牵引——这是“零件独立”的保证。
4. **姿态回放**：每帧把上游姿态记录 `C`（hl/hr 手目标、fl/fr 脚目标、ahl/ahr/lhl/lhr 肘膝朝向、y/pitch/roll 根运动）乘 `kGeom`（= 1.106/0.78，rig 空间 → 几何空间）后，用**与上游 `Limb.prototype.update` 相同公式的两段 IK** 解出肘/膝，直接摆放骨骼位置与朝向；头骨按 look 目标做限幅转头；裙骨独立呼吸摆动。

### 顺带修复

- **撤掉 `desiredAct()` 里的 `if (lanModel) return 'idle'`**——那是 MODEL-11 无骨骼时的临时补丁，绑骨后她的自主日程（吃饭/游戏/读书/睡觉的时间表）重新生效。
- 脚本版本戳 `?v=20261101-12`（浏览器缓存会把旧 shader/旧脚本钉住）。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明 |
|---|---|---|---|
| `?act=tv/read_desk/exercise/sleep/game` + Ego CDP 抓帧 | PASS 7 姿态 | `benchmarks/2026-11-01-WORLD-RIG-12/*.jpg` | 浏览器真实渲染的动作正确性、头发/裙摆独立性；不能证明 Electron 内一致 |
| 分区统计（`lanModel.info.partition`） | hair 21517 / arm0 29893 / arm1 18415 / leg0 38688 / leg1 37384 / skirt 9250 / torso 19131 / dead 0 | 控制台输出 | 每顶点归属唯一 |
| 挥手联动测试（`life.waveT=3` 触发） | PASS：右臂举挥、发裙零位移 | `02-wave-arm-independence.jpg` | 独立性的直接视觉证明 |
| `bash scripts/project.sh check` | PASS 93/93 | 命令输出 | 静态一致性 |
| `node --check lan-model.js` | PASS | — | 语法 |

姿态证据：01-stand / 02-wave-arm-independence（联动测试）/ 03-exercise（双臂上举，视觉干净）/ 04-sit-tv（坐毯）/ 05-lie-sleep（躺，发在枕上不陷地）/ 06-game-hold-pad（坐毯持柄）/ 07-read-desk（书桌读书）。

## 剩余工作与交接

- **未接 Electron/打包**（主线 `main.js`/`preload.js`/`dist` 一行未动， WORLD-LAN-07 待领取）。
- 极端姿势（深蹲、双臂后摆、大幅转体）下裙-腿交界可能出现接缝——分区蒙皮的固有边界；如需消除要在 Blender 里做平滑权重或等上游出带骨版本。
- 头骨只有限幅转头，没有表情/眨眼（模型本身无 morph target）。
- 约 2000 个垃圾顶点已被安全兜底（归 spine 不渲染异常），但建议上游重新导出时清理。
- `lan-model-check.html`（MODEL-11 的独立检查页）未更新到绑定版，仍显示静态网格。

## 是否影响素材来源 / 外部依赖 / 运行入口

- 素材来源：无新增外部素材；GLB 是 MODEL-10 已落盘的 `lan-v2-game.glb`（许可状态 `internal_preview_only`，见 `lan-model.source.json`）。
- 外部依赖：无新增（three r128 自带 SkinnedMesh/Skeleton，无需 DRACO）。
- 运行入口：不变——本地静态服务器打开 `index.html`；`?act=<name>` 可指定动作复现。
