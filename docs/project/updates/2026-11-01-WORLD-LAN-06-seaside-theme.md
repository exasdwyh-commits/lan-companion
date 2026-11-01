# 2026-11-01 · WORLD-LAN-06 · 茉莉小屋海边主题化与澜的三维鲸鱼娘

## 归属

- 负责人 / 聊天标识：Codex / 本聊天
- 任务：TASKS 中的 `WORLD-LAN-06`。
- 开始时已有修改 / 其他负责人：
  - `lan-room.js`（上一轮：3 张项目自有相册照片 + 放大对话框）
  - `index.html` 的标题与署名（`WORLD-MOLI-05` 复用时改的）
  - `Sources/`、`Tests/`、`Package.swift`、`dist/WhaleVideoCompanion.app` 为已废弃的 Swift 侧，**本轮未动**
- 本次负责文件：
  - `MALFOY-ENGINE/web/moli-room/lan-theme.js`（**新增**，本轮主体）
  - `MALFOY-ENGINE/web/moli-room/lan-character.js`（角色第二轮修形）
  - `MALFOY-ENGINE/web/moli-room/index.html`（接线 + 树位/花草散布/脚本版本戳）
  - `MALFOY-ENGINE/web/moli-room/LOCAL-CHANGES.md`（登记）
  - `docs/project/{TASKS.md,STATUS.md,CHANGELOG.md}`、本文件
  - `benchmarks/2026-11-01-WORLD-LAN-06/`（证据截图）

## 完成内容

### 1. 房间主题化（`lan-theme.js` 新增）

沿用上游 `WORLD-SCENE-PLAN.md` 定的美术方向：奶油白墙、浅木家具、雾蓝软装，海面远景低对比、慢运动，不抢角色注意力。

- **配色重着色**：`retint('wall'|'wainscot'|'cap'|'stone'|'stoneD'|'wood'|'woodD'|'woodL')`，原色先备份进 `before`，`restore()` 可还原。
- **草地 → 沙岛 + 海**：上游 `ground` 是半径 40 的圆盘，会吞掉任何水面。改成半径 7.4 的沙岛圆盘（复用原材质位但**另建材质**，见下），上游大圆盘 `visible=false` 保留，天气/昼夜染色仍走原路径。
- **海面**：半径 46 的 **环形**（`RingGeometry`，不是圆盘）。这是本轮最关键的一个修法。
- **波纹**：两组正弦叠加的 `ShaderMaterial`，加色混合；只在开阔水面出现，向地平线淡出。
- **远景山丘**：上游 22 个 `ConeGeometry` 环形山丘立在草地上；草地没了之后它们会变成一圈挡视野的绿色尖刺。**直接隐藏**，改为自建 9 座低矮海岛（岩色 + 灰绿顶盖，半径 26~42）。
- **木栈桥**：从后墙窗口方向伸向海面，带栏杆、桩柱和一条系着的小船。
- **海滩道具**：浮木 3 段、遮阳伞 1 把（唯一的饱和色）、贝壳、玻璃浮球。
- **鲸鱼物件**：窗台小鲸、床上鲸形抱枕、鲸尾墙钩。
- **雾的适配**：上游雾的起点按"房子 + 草地"调过；放到海面上会把整片海染成白纸。主题在 `update()` 里把 `fog.near/far` 推到 24/62，只让远地平线化开。

### 2. 角色第二轮修形（`lan-character.js`）

第一轮已解决"鲸尾悬空成双翼"和"鳍耳造型不对"。本轮针对实拍暴露的三个问题：

| 问题 | 修法 |
|---|---|
| 头顶珠链像串珠项链 | 11 颗 → 13 颗，半径 `.014` → `.0092`，贴合发际线 |
| 呆毛卷像天线 | `tube` 半径 `.0105` → `.0062`，曲线收短并前弯 |
| **鳍耳完全看不见** | 根因：鳍耳原点在 `x=±.152`，而帽子球半径 `.19`——它整个被包在头发球里。改为长在**头顶偏后**（`x=±.104, y=.108, z=-.028`）并后仰 `rotation.y/z = ±.62`，现在四分之三视角清晰可见 |
| 背面头发像头盔 | 后发球 `.193/.19/.143` → `.186/.183/.128` |

### 3. 场景耦合点（`index.html`）

- 脚本引用加版本戳 `?v=20261101`（浏览器缓存会把旧 shader 钉住，本轮因此排查过一轮误判）。
- 主题调用插在 `W`（天气对象）定义之后，避开 TDZ。
- 逐帧接 `lanTheme.update(t, n, W.rain, W.cover)`；上游每帧重置 `ground.material.color`，主题改为驱动自己的 `groundMesh`。
- 树位调整 3 棵（原位置会落到海里或挡住窗户），花草散布半径收敛（花 `×5` → `×3.6`，草 `×5.2` → `×3.7`）。

### 4. 本轮踩到的三个真 bug（都靠实拍发现，静态读代码看不出来）

1. **海面圆盘与沙岛 z-fighting**。海原本是半径 46 的**圆盘**，沙岛半径 7.4，两者同心、只差 0.05 高度。大平面深度精度不够，海面从沙地里透出来 → 满屏等距白条。修法：海改成 `RingGeometry`（内径 7.0），从几何上消除重叠。
2. **模板字符串写成了 `$(` 而不是 `${`**。波纹 shader 的 `smoothstep` 参数原样进了 GLSL，编译失败但页面不报错，只是波纹不生效。**教训：GLSL 里的插值必须确认真的插进去了。**
3. **`page.screenshot()` 返回 76 字节空图**，必须走 CDP `Page.captureScreenshot`。另外 `?cam=` URL 参数会被 `OrbitControls` 的方位角限制夹住，取远景要同时放开 `min/maxAzimuthAngle` 和 `min/maxDistance`。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `ego-browser nodejs` + CDP 抓帧，`?cam=` / `?at=` 定取景 | PASS | `benchmarks/2026-11-01-WORLD-LAN-06/01-outside-wide.jpg` 等 6 张 | 证明浏览器里真实渲染的室外/室内/夜景/角色特写；**不能**证明 Electron 里一致 |
| `bash scripts/project.sh check` | PASS 93/93 | 命令输出 | 静态检查通过；不含窗口行为与视觉听感 |
| `node --check lan-theme.js lan-character.js` | PASS | — | 语法正确 |
| 浏览器内 `page.evaluate` 捕获 `start()` 同步异常 | PASS | 修完返回 `{ok:true, dbg:true}` | 证明主题初始化无 TDZ / ReferenceError |
| 逐个隐藏大平面 + 射线检测定位条纹 | PASS | 排查过程记录在本文"真 bug"段 | 证明 z-fighting 根因定位正确 |

证据截图清单：

| 文件 | 内容 |
|---|---|
| `01-outside-wide.jpg` | 室外全景：沙岛、木栈桥、海岛、房子 |
| `02-outside-sea.jpg` | 从窗内朝海：蓝色海面与地平线 |
| `03-room-front.jpg` | 室内正面：奶油白/浅木/雾蓝，窗外是海 |
| `04-room-night.jpg` | 夜景：暖灯 + 深蓝海面 |
| `05-char-quarter.jpg` | 角色四分之三：鳍耳可见 |
| `06-char-face.jpg` | 角色面部特写 |
| `07-diorama-cutaway.jpg` | 剖面全景 + 电视游戏（方块）正常启动 |

## 剩余工作与交接

- 当前限制 / 未验证：
  - **Electron 真机未跑过**。全部证据来自浏览器（three.js r128 同一份 `vendor/three.min.js`，但渲染宿主不同）。
  - 远景海岛、栈桥小船、遮阳伞都只做了静态几何，**没有交互**（点它们不会有反应）。
  - 上游 `hillMats` 的山丘是被**隐藏**而非删除，若日后有人改 `lan-theme.js` 的隐藏逻辑，山丘会突然回来。
  - 沙岛材质是主题**另建**的（不复用上游 `ground.material`），因为上游那份带雪覆盖 shader，在这个太阳下会烧成白色。所以 `ground.material.color` 的逐帧重置对沙岛不再生效——改沙色要改 `lan-theme.js` 的 `groundBase`。
- 下一项建议：把 `moli-room` 接进 Electron 入口（本轮及上轮都未碰 `main.js`/`preload.js`/`dist`），以及给栈桥/小船加点击交互。
- 是否更新 STATUS / TASKS / CHANGELOG：是，三份都已更新。
- 是否影响素材来源 / 外部依赖 / 运行入口：
  - **素材来源**：无新增外部素材。`assets/lan-room/` 的 3 张照片是上一轮的项目自有照片，本轮未动。
  - **外部依赖**：无新增。仍是 three.js r128 本地 vendor，无构建步骤。
  - **运行入口**：无变化，浏览器直接打开 `index.html`（本地起静态服务器）即可。
  - **许可**：上游 `norsizu/moli-room` 仍是 CC BY-NC 4.0，本轮改动同样继承该许可；已在 `LOCAL-CHANGES.md` 登记。
