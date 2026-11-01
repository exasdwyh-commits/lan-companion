# WORLD-RIG-19 裙内改打码：马赛克贴图 + 不受光的打码团块

- 日期：2026-11-01
- 负责人：WorkBuddy（本聊天）
- 用户原话：「你改成模糊马赛克就行」
- 前情：[WORLD-RIG-18](2026-11-01-WORLD-RIG-18-skirt-exposure.md) 已用"裙内衬 + 安全裤"堵住走光，
  但那是**几何遮挡**，看起来只是一层深色布料。
- 结论：内衬与安全裤**保留**（遮挡逻辑不变），外观换成**马赛克打码**。
  站姿外形零变化，裙口内是灰蓝方格块。真机已重启为新构建（pid 3717）。

---

## 一、改了什么

只动 `MALFOY-ENGINE/web/moli-room/lan-model.js`，**几何一个顶点都没动**。

### 1. `skirtMosaicTexture()`（新，约 20 行）

128×128 的 `CanvasTexture`，画 8×8 个 16px 方块，颜色在后墙深蓝灰里随机取
（`#2b323d` … `#8e9ab0`）。

- `magFilter = NearestFilter` —— 近看是硬边方块，不是渐变。
- 尺寸取 2 的幂，`repeat + mipmap` 在 WebGL1 下合法；远处自然糊成一片，
  正好是"模糊马赛克"。
- `encoding = sRGBEncoding` 与场景输出对齐。

**为什么块数是 8**：内衬 UV 实测铺满 `0.0004–0.9996`（见 `measure-uv.mjs`），
裙口宽约 0.52 m，8 块即每块约 6 cm —— 屏幕上明显是方块而不是噪点。

### 2. 裙内衬（`lan-skirt-lining`）

材质换成 `map + emissiveMap` 同一张马赛克贴图：

```js
map: mosaic, roughness: .95, metalness: 0, skinning: true, side: T.BackSide,
emissiveMap: mosaic, emissive: 0x4a5468, emissiveIntensity: .5
```

`emissiveMap` 是必需的：**裙内朝向床面，收不到任何主光**，纯 `map` 会被压成一片全黑。

### 3. 打码团块（`lan-bloomers`）

安全裤从球体换成**低多边形球 + 正交投影 UV + 不受光材质**：

```js
const blobGeo = new T.SphereGeometry(1, 12, 9);
// 把球面 UV 重投影成 (x,y) 平面 UV，否则格子会沿极点拉成条纹
new T.MeshBasicMaterial({ map: mosaic, fog: true })
```

`MeshBasicMaterial` 是刻意的：打码块**本来就不该被灯照**，
它的职责就是一块读不出内容的平面色块；不受光才能在阴影里依然可见。
尺寸/挂点/父子关系与 RIG-18 完全一致（半径远小于该高度裙片半径），
所以**物理上仍然戳不出裙外**。

---

## 二、踩的坑（都是实拍才发现）

### 1. 受光材质在裙内一定变黑

先按常规用 `MeshStandardMaterial + map`，出来的是一整块漆黑，格子的影都没有。
换成 `emissiveMap` 提亮后又遇到第二个坑。

### 2. `emissive` 会把逐面明暗压平

为了让团块有"块感"，试过低多边形 + `flatShading` + 逐面顶点色。
但 `emissive` 是**均匀加项**：它把面与面之间的明暗差一起抬起来，最后几何棱角全部消失，
看上去就是一个光滑的深色球。**块感只能来自"各面自身颜色/照度差"，不能靠加自发光去提亮。**

### 3. 球面 UV 会把格子拉成条纹

`SphereGeometry` 的 UV 绕极点收束，贴方格贴图后沿纬线变成条带。
解法是把 UV 重投影成 `x/y` 平面投影：

```js
buv[i * 2] = bp.getX(i) * 0.5 + 0.5;
buv[i * 2 + 1] = bp.getY(i) * 0.5 + 0.5;
```

这样正对裙口的视线看到的是规整方格。

### 4. "整件衣服和身体是同一个网格"

想用"把身体染成纯色"判断裙内那块粉色是不是皮肤时发现：`lan-smooth-skin` 这一个
SkinnedMesh 同时包含**身体和裙子**（靠 UV 区域区分），所以整体染色会让裙子也变色，
这个测试**无法区分**皮肤与布料。仍然只能靠**按主导骨分组染色**（RIG-18 的方法）。

---

## 三、验证

### 机位（`benchmarks/2026-11-01-WORLD-RIG-19/`，`verify.mjs`）

| 图 | 机位 | 结果 |
|---|---|---|
| `01-lie-foot.png` | 躺姿、床尾平视 | 侧卧，无暴露 |
| `02-lie-3q.png` | 躺姿 3/4 | 无暴露 |
| `03-sit-low.png` | `read_bed` 低机位正视 | 裙口内是**灰蓝方格**，无皮肤 |
| `04-stand-outside.png` | 站姿正面 | 裙外侧**没有任何补丁/花纹**，外形零变化 |

### 决定性断言（`assert-legs.mjs`）

把**腿**主导的顶点染成纯红、其余压成近黑，`read_bed` 三个机位各拍一张，
统计"红色像素占比"：

| 图 | 红色像素占比 | 红色出现在哪 |
|---|---|---|
| `40-legs-red-close.png` | 0.02 % | 裙外膝盖边缘 |
| `41-legs-red-mid.png` | 0.08 % | 裙外膝盖/小腿正面 |
| `42-legs-red-high.png` | 0.08 % | 同上 |

**两腿之间、裙摆下方是零红色** —— 打码块完整盖住了需要盖的区域；
红色只出现在短裙本来就露着的膝盖上，属于正常着装。

### 门禁

- `node --test test/*.test.js` → **295 / 295**
- `bash scripts/project.sh check` → **93 / 93**，错误 0，待办提示 6
- `bash scripts/project.sh build` → `pass: true`，**66 / 66** 文件一致
- `.app` 内 `lan-model.js` 与源码 **sha256 一致**，`index.html` 引用 `?v=20261101-46`

---

## 四、已知边界

- 真机画面仍抓不到（本机屏幕会话锁屏），以上判定全部来自 ego-browser 离屏渲染。
- 打码团块是**刚体挂在裙骨**上，腿大幅弯曲时位置会偏一点；它只负责挡视线，不需要跟腿。
- 上床/起身过渡帧的穿模这次没动（用户此前明示接受）。
- 内衬多 36k 面，多走一次蒙皮 pass；未做逐帧耗时对比。
