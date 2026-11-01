# 2026-11-01 · WORLD-MODEL-11 · 新版真实模型换入小屋

## 归属

Codex / 本聊天。负责小屋 `index.html`、新增 `lan-model.js`、`assets/lan-room/lan-v2-game.glb` 与来源文件、`LOCAL-CHANGES.md`、本任务证据/文档。保留已有其他修改，未动 main/preload/dist、个人数据、原始模型、游戏代码或程序造型实验。

## 完成

- 按用户“替换，我看看效果”接入 WORLD-MODEL-10 的实际混元多视图 GLB。运行副本 9,213,768 bytes，199,999 三角面，两张内嵌 2K 图，SHA256 与素材真源一致。
- 按真实模型包围盒统一为本地高 0.78；继承角色组 1.6 比例，世界高 1.248。脚底最低 Y=0.012，恰与角色站立地面一致，朝 +Z。
- 隐藏旧角色整套 rig；GLB 挂在角色组下并独立于隐藏的 IK 倾斜/软体形变，没有黑色身体/手脚重叠。
- 默认地毯站立展示，新加“看澜”按钮近看，“复位视角”返回全屋；加载/错误提示与造型预览状态可见。
- 默认不再按时间自动调用坐卧日程；上游活动指令、电视和四款游戏仍在，但静态模型不具备 IK、持物、挥手、坐卧或真实步态，不能按原角色动作宣称验收。
- 保留现有海边房间、照片和主题。未接 Electron 世界窗口或重新打包。

## 实测

| 操作 | 结果 | 证据 |
|---|---|---|
| `node --check .../lan-model.js` | PASS | 新增适配器语法 |
| `bash scripts/project.sh check` | 93/93，6 个现有提示 | `benchmarks/2026-11-01-WORLD-MODEL-11/project-check.log` |
| 运行模型/真源字节比较 | 一致 | `asset-check.json`、`assets/lan-room/lan-model.source.json` |
| Ego Lite 加载新版入口 | ready / 199,999 三角面 | 实际 Three.js GLB，非贴图替身 |
| 全屋与“看澜”近景 | 已实看 | `room-overview.png`、`lan-closeup.png` |
| 旧 rig 与脚底 | rig.visible=false；最低 Y=0.012 | `asset-check.json` |
| 电视入口、Enter、Esc | 点击电视成功；进入 moli intro，返回小屋成功 | `game-smoke.png`；未重测四游戏完整通关/玩法 |

首次打开未带新版本参数的旧 URL，浏览器复用了旧页面；实际 no-store 读取已是新源码，增加 `v=20261101-11` 后正确加载，不清除个人浏览器数据。首次复位镜头后立即点电视在镜头阻尼尚未稳定时未进入，镜头稳定后实际点击进入；未据此篡改游戏或命中逻辑。

## 查看与后续

打开 `http://127.0.0.1:8947/MALFOY-ENGINE/web/moli-room/?lang=zh&v=20261101-11`，底部“看澜”近看，空白拖动旋转、滚轮缩放，“复位视角”回全屋。本轮用于截图的固定天气/时间参数只是预览，不代表实时天气验证。

尚缺关节/口眼拓扑、骨骼权重、动作，以及 Electron 集成；当前仅造型场景展示。用户外观验收待反馈，模型的手指/发丝/裙边噪点仍保留。公开素材权利边界不变。STATUS/TASKS/CHANGELOG 与 README 入口已同步。
