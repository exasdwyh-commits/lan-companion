# WORLD-RIG-13 睡姿/被子/鞋子/穿模修复

- 日期：2026-11-01
- 负责人：Hermes 002 / 本聊天（WORLD-RIG-12 交付后释放写入权，本任务接手）
- 范围：`scripts/prepare-lan-skin.py`、`MALFOY-ENGINE/web/moli-room/{lan-model.js,index.html,assets/lan-room/lan-v2-skin.bin,lan-v2-contact-cuts.bin,lan-v2-skin.json}`、`benchmarks/2026-11-01-WORLD-RIG-13/`、本文档与 TASKS/CHANGELOG。未改 GLB 原始模型、main/preload、dist。

## 用户报告的四项缺陷与根因

1. **睡觉人物太高、人没在被子里** → 根因有两个：
   - `measureBlanket()` 射线测量对象是隐藏的旧 ink 身体（`hits=[body]`），澜躺的位置/轮廓与之不同，被子照着旧身体盖；
   - 测量闸门在 boot 后 ~9 秒触发，而澜的 GLB 要 2-5 秒后才 rigged，**测量永远跑在她加载之前**，且 `sag>0.22` 的重测闸在躺定后再也不可满足。
2. **躺姿裙底不美观** → LIE 姿态上游脚目标把脚踝摊到 ±0.7（劈叉躺），裙摆骨架无躺姿处理，裙筒开口朝脚暴露裙底。
3. **鞋子变形** → 权重生成脚本的腿 carve 窗口 `z<.12` 没罩住伸得更前的鞋尖，鞋尖落进"围裙区"跟裙骨走，裙骨一转鞋就拧。
4. **穿模** → 主要是裙底/裙-腿交界随腿独立运动错切（跨左右腿混合的裙摆片）。

## 修复内容

| 修复 | 实现 | 验证 |
|---|---|---|
| 鞋权重 | `prepare-lan-skin.py` 增加鞋区 carve（`y<.095, |x|<.118, -.02<z<.185` 按左右脚入腿区）；重新生成 `lan-v2-skin.bin`/`contact-cuts.bin`（skinSha256 `9edc9d10…`） | 鞋区 7580 顶点：裙骨残留 mean 0.0029 / max 0.031，单腿纯度 100% |
| 被子测量源 | `lan-model.js` 新增 `syncBlanketProxy(mesh)`：测量时从根骨/头骨世界坐标现算躺姿包围盒（世界系，尺寸 0.40×(骨距+0.42)×0.30）；`index.html` `measureBlanketInner` 把该盒加入射线命中集 | 手动射线在躯干柱命中代理 y=0.978；重测后被子顶 1.093 ≈ 身体顶 1.036+余量，186 列被子被顶起 |
| 测量时机 | 躺定 + rigged 后允许重测一次（`blanketLan` 标记；重测路径不再要求 `sag>0.22` 尖峰） | 后台标签页手动泵帧 30 帧即触发：`ready=true, lan=true, k→1` |
| 睡姿高度 | `rootYm` 躺姿项 0.14 → 0.105（贴床垫） | dbg.rootYm 躺定 0.06-0.105 |
| 并腿 | 躺姿脚踝 x 目标乘 `1-0.72*lying` | 脚目标从 ±0.7 收到中线 |
| 裙摆收拢 | 裙骨躺姿绕 X +1.26 rad，把裙摆压向腿面/床垫 | 几何验证裙筒闭合方向；视觉待用户确认 |

## 诊断过程中的两个弯路（记录以免重蹈）

- **初始"裙摆跨腿混合 4078 顶点"是误报**：旧分析用错了坐标系（未做脚本里的 xzy 换轴），且把同一条腿的 legUp+legLo 混合计成"跨腿"。真实跨左右腿顶点仅 41 个（会阴中线），可忽略。基于错误分析加的裙摆抑制已撤销，只保留鞋 carve。
- **"update 循环冻死在 pkT=9"是测试假象**：无头驱动的浏览器标签页在后台时 rAF 被节流到 0，页面自身动画暂停但 eval 仍可用；`Page.bringToFront` + 手动泵帧后一切正常。不是代码 bug。

## 保留的诊断设施

- `measureBlanket` 包 try/catch（失败写 `window.__blanketErr`，不再炸掉整个 update 循环）。
- 渲染循环包 try/catch（单帧异常不再永久冻住房间；console.error 每次记录）。
- `MOLI_DEBUG.blanketDiag()` 返回 `{k, ready, lan, err}`。

## 证据

- `benchmarks/2026-11-01-WORLD-RIG-13/rig13-day-shoes.png`（白天坐姿鞋部）
- 夜间 `?at=02:00&lamp` 被子几何数据：blanketMaxY 1.093 / proxyTop 1.036 / 186 列抬升 / k=1
- 权重统计：鞋区裙残留 mean 0.0029 max 0.031；`lan-v2-skin.json` 更新（vertices 174278, cuts 2070）

## 未完成/待验

- **用户视觉验收**：被子盖人、裙摆收拢、鞋子不拧、穿模缓解——截图已备，待用户浏览器实看（真实浏览器 rAF 正常，无泵帧问题）。
- 极端姿势（深蹲、双臂后摆）裙-腿接缝为 RIG-12 已知限制，未在本轮处理。
- 3D 模型仍未接 Electron（WORLD-LAN-07 待领取）。
