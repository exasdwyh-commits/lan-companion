# WORLD-RIG-13 · 蒙皮真的能动了（three r128 材质 skinning 开关）

2026-11-01 · 负责 `moli-room/{lan-model.js,index.html}` + `benchmarks/2026-11-01-WORLD-RIG-13/`

## 用户看到的现象

「她不能走不能坐，不能睡觉啊，之前的动作都不能执行啊」

## 上一轮为什么"验收通过"却没生效

WORLD-RIG-12 的验收看的是**状态值**：`life.pk === 'sleep'`、`rig.rotation.x === -1.57`、
`life.at === 'lie'`，全部正确；`skeleton.boneMatrices` 也确实在逐帧变化
（实测躺下时 `boneMatrices[0..3]` 从 `[1,0,0,0]` 变成 `[0.835,0.55,0,0]`）。

但**画面里她一直是站立**。上一轮 `benchmarks/2026-11-01-WORLD-RIG-12/05-lie-sleep.jpg`
其实就是一张站姿照 —— 只是旁边配了 zzz 气泡。状态对 ≠ 画面对。

## 真正的根因

这个 three 构建（r128）把蒙皮编译决策放在**材质**上：

```js
skinning: material.skinning && bones > 0
```

`GLTFLoader` 给静态网格生成的 `MeshStandardMaterial` 里 `skinning` 是 `false`。
用它 new 一个 `SkinnedMesh`，顶点属性、骨骼、`boneMatrices` 全都正确，
**但着色器里根本没有蒙皮代码**，顶点永远停在绑定姿势。

代码：
```js
const mat = srcMesh.material.clone();   // 不改 loader 的材质
mat.skinning = true;
mat.needsUpdate = true;                 // 触发 program 重编译
skinnedMesh = new T.SkinnedMesh(geo, mat);
```

### 一个必须记住的坑：浏览器会把修复吞掉

第一次加上 `skinning = true` 后实测仍是 `false` —— 因为 `lan-model.js` 走了磁盘缓存。
`page.reload()` 不够，必须：

```js
await page.cdp("Network.setCacheDisabled", { cacheDisabled: true });
await page.goto(url + "?nocache=" + Date.now());
```

否则会误判"改了没用"，然后在无辜的代码上反复找 bug。同时 index.html 的
`lan-model.js?v=` 也要跟着 bump。

## 顺带修掉的四处

| 问题 | 现象 | 修法 |
|---|---|---|
| 分区用方框阈值 | 宽袖超出 `armOutX` 上限，落进 head 分支 → 抬手时袖子被撕成扇形、头转袖子跟着转 | 改成**判断顶点到肢体轴线段的距离**（肩-肘/肘-腕/髋-膝/膝-踝），方框只保留给颅顶和外扩裙摆 |
| IK 拉满 | Q 版大袖子被拉成两根直棍 | 手臂 IK 伸展上限收到 `0.9 × (l1+l2)`，留一点弯；腿不适用（会浮空） |
| 躺下转头 | head 骨枢轴在脖子，躺姿任何转头都把脖子拧成毛巾 | `lying` 时 `damp = 0`，头锁死在身体轴上 |
| 加载失败没兜底 | `rig.visible = false` 写在 `createLanModel` 顶部，GLB 失败 = 屋里没人 | 失败时 `rig.visible = true` 退回墨水体；`index.html` 对 `window.createLanModel` 缺失也留了 no-op 兜底 |

分区计数（17.4 万顶点）：hair 15985 / armL 14656 / armR 11585 / legL 41694 /
legR 40877 / skirt 23848 / torso 25633 / 非法顶点 0（上一版约 2000 个 1e30 量级垃圾点）。

## 验收方式（这次看画面）

用 `D.command(act)` + `D.update(1/60)` 循环快进虚拟时间（**不要**用 `?act=`，
那条路径走 `snapTo` 瞬间传送，会跳过走路和 settle，测出来的不是真实体验），
再 `D.lanModel.focus()` 把相机推近，`Page.captureScreenshot` 实拍：

- `01-game-sit-rug` 坐毯打游戏（持柄）
- `02-tv-sit` 坐毯看电视
- `03-read-desk` 走到书桌坐下读书（持平板）
- `04-sleep-lie` 走→跳上床→关灯→躺平（pitch −1.57）
- `05-exercise-stand` 站立运动
- `06-walk` 行走中（背对镜头，头发自然垂落）
- `07-sleep-closeup` 躺姿俯视特写：仰躺、闭眼、头发散在两侧、被子盖身

`bash scripts/project.sh check` → 93/93，错误 0。

## 仍然存在的边界

- **极端动作的布料**：开合跳双手举高时，大振袖会展开成翼状。这是 Q 版大袖 +
  虚拟骨的固有结果，要真正解决得在 Blender 里做平滑权重后重导出。
- **被子尺寸**：毯子是按原墨水体（0.78 细身）铺的，Q 版体型更宽，
  躺下盖不住头，看起来像"躺在被子上沿"。要改得动 `measureBlanket` 的命中体。
- **未接 Electron**：`dist/DeepWhale.app` 里 `app/web/moli-room/` 仍是
  2026-11-01 00:44 的旧资源（连 `lan-model.js` 都没有），用户只有跑源站才看得到本轮修复。
