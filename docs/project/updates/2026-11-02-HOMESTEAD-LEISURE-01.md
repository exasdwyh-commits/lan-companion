# 2026-11-02 · HOMESTEAD-LEISURE-01 · 小屋休闲扩展（走光 / 家园 / 出门）

## 归属

- 负责人 / 聊天标识：Composer / 本聊天
- 任务：WORLD-MODESTY-20 → HOMESTEAD-UI-02 → WORLD-OUTDOOR-01（用户选定 C 分期 + 第三人称）
- 开始时已有修改 / 其他负责人：本地工作树已有大量未提交改动；本任务只扩家园相关文件，不覆盖未知无关 diff
- 本次负责文件：
  - `MALFOY-ENGINE/web/moli-room/lan-model.js`（去马赛克、布料内衬+短裤、躺姿加厚、被子加宽）
  - `MALFOY-ENGINE/web/moli-room/lan-companion.js`（「家园」页签）
  - `MALFOY-ENGINE/web/moli-room/room-furniture.js`（新建）
  - `MALFOY-ENGINE/web/moli-room/outdoor-world.js`（新建）
  - `MALFOY-ENGINE/web/moli-room/index.html`（接线、浴缸、出门渲染分叉）
  - `MALFOY-ENGINE/lib/aquarium.js`（新建）、`lib/fishing.js`（deposit）
  - `MALFOY-ENGINE/main.js` / `preload.js`（家园 IPC 暴露、浴缸、room:changed）
  - `MALFOY-ENGINE/test/aquarium.test.js`

## 完成内容

1. **WORLD-MODESTY-20**：删除马赛克贴图；裙内衬改为藏青 Standard 布料 + 低强度纯色 emissive；安全裤改为短筒圆柱布料短裤；躺姿略加厚短裤；`syncBlanketProxy` 髋宽 1.14→1.28。
2. **HOMESTEAD-UI-02**：面板新增「家园」——钓鱼图鉴、浴缸放入/取出、花园六格操作、14×9 编辑模式（幽灵格 + `room:apply`）、旅行手账状态条；固定浴缸 mesh + 鱼可视化；`lib/aquarium.js` 最多 6 条。
3. **WORLD-OUTDOOR-01**：`outdoor-world.js` 第三人称海岛（WASD / 点地走），码头/礁石钓鱼、六菜地种浇收；室内↔室外同一 renderer 分场景渲染；旅行仍走既有 `journey` 时间推进（不做旅途 3D 关卡）。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `node --test test/aquarium.test.js test/fishing.test.js` | PASS 15/15 | 本机终端 | 浴缸/背包进出与既有钓鱼规则 |
| `bash scripts/project.sh check` | 93/93 错误=0 | 本机终端 | 静态工程路由；不证明 WebGL 观感 |
| 真机躺姿裙口 / 出门走动 / 听感 | 未验证 | — | 需用户本机打开 App 人眼验收 |

## 续写（同夜 polish + 构建）

- 出门 HUD（Esc/H 回家、F 就近抛竿）、码头/礁石/湖心 userData 向上查找、水波动画、枯株可清。
- 底栏「家园」「出门」入口；浴缸鱼游动；编辑幽灵格越界标红 + 指针跟随预览。
- 已重建 `dist/DeepWhale.app`（414M，payload 75/75，核心 33/33）。

## 室外建模重做（对照 GitHub）

视觉基线改为 [img2threejs Tropical Island](https://img2threejs.io/#/demo/tropical-island)（源码 [img2threejs-showcase](https://github.com/img2threejs/img2threejs-showcase) `src/demos/tropical-island`）：

- 吸收：16 扇径向岸线、沙/草调色板、木屋·码头·船·棕榈·篝火·灯笼构图、沙滩路径 mask、浅滩水色
- **未引入**：measured surface 缓冲区、浅水 WASM/仿真、r169-only 着色器（项目仍是 Three r128）
- 落地：`outdoor-world.js` 用 r128 原语按该构图放大可走；钓鱼/菜地 IPC 未改

此前 Notbell / WaterThreeJS / lowpoly-island 仍作参考索引，不再作为室外主造型。
