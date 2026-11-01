# 待修三条（外部 review，带实测数据）

> 来源：独立验收 `dist/DeepWhale.app`（pid 43653，CDP :9223）
> 已确认没问题的部分见文末，不用重做。

---

## ① 绿偏没消干净：不要用「平均色」填透明区

**实测**（把 `idle-smile.webm` 缩到 300×400 画到 canvas，逐像素统计）：

```
透明角像素 alpha        = 0        ✅ 真透明
绿偏像素占比            = 0.82%    ⚠️
最大绿偏 (G - max(R,B)) = 14/255   ⚠️ 约 5.5%
平均绿偏                = 3/255
```

**根因**：把全透明像素的 RGB 统一填成「角色平均色」。

角色是蓝发 + 白裙，平均色是一坨灰蓝。白裙边缘在缩放插值时被拉向灰蓝 → 灰边；蓝发边缘被拉向灰蓝 → 偏色。平均色只是近似，不是解。

**正确做法：edge extend（最近不透明像素色）**

```python
import numpy as np
from scipy.ndimage import distance_transform_edt

opaque = rgba[:, :, 3] > 8
idx = distance_transform_edt(~opaque, return_distances=False, return_indices=True)
rgba[:, :, :3] = rgba[idx[0], idx[1], :3]   # 每个透明像素取最近的不透明像素颜色
```

没有 scipy 就用 `cv2.distanceTransform(..., DIST_L2, 5)` + 最近邻查表，效果等价。

`scripts/fix-alpha-bleed.py` 讲的就是这个思路，直接复用，别另写一套近似。

**验收方式**：不要只在源图上量「0% 绿」。必须**缩放到实际显示尺寸后再量**——alpha bleed 只在缩放插值时暴露。

---

## ② 分辨率掉太多：360×360 撑不住 72vh

```
idle-smile.webm     360×360
action-heart.webm   370×360
closeup-idle.webm   478×480
sleep.webm          626×359
```

源素材是 `1280×720` 和 `1112×834`。

| 场景 | 显示尺寸 | 缩放比 |
|---|---|---|
| world 模式 `72vh` | 707px | **1.96× 放大**（糊） |
| desktop 模式 `40vh` | 393px | 1.09×（可接受） |

对比：原来的静态图 `whale.png` 是 400×1024，在 707px 下是 **0.69× 缩小**（清晰）。

**结论**：world 模式的「活立绘」比静态图更糊，等于负优化。

**改法**：抠像裁剪时保持源高度 ≥720，不要统一缩到 360。桌面模式可以另出一份小的（可选），world 模式必须用高分辨率那份。

---

## ③ 四条素材画幅不一致，切换会「跳大小」

`360×360 / 478×480 / 626×359 / 370×360` —— 四种画幅，靠 CSS `height: 40vh` 统一高度。

但每条的**角色在画面里的占比不同**：切到 `closeup-idle` 时她会突然变大变近（这是设计意图），可 `idle` → `heart` 也会跳，因为 370×360 和 360×360 的角色尺寸没归一。

**改法**：按**角色实际像素高度**归一化，不是按画幅高度。抠像时记录角色的 bbox 高度，输出时缩放到统一目标高度（比如 720px），画幅宽度按 bbox 比例给。

---

## 已独立验证通过，不用重做

| 项 | 证据 |
|---|---|
| `dist/DeepWhale.app` 存在 | bundle id `com.koudouma.deepwhale`，CFBundleName `DeepWhale` 1.0.0 |
| keyed 素材打进包 | 4 个 webm 都在 `Contents/Resources/app/web/live2d/keyed/` |
| VP9 alpha 真透明 | Chromium 里角像素 alpha = 0 |
| 视频在播 | `idle-smile.webm`，videoWidth 360，currentTime 2.93s，paused=false |
| app 在跑 | pid 43653，`--remote-debugging-port=9223` |
| TTS 1.7B 就绪 | `:8091/health` → `Qwen3-TTS-1.7B-VD`，mode `voice_design` |
| 三态逻辑保留 | `openStage` / `goDormant` / `stageHit` 未被重写，只做了增量 |
| 爬窗保留 | 按 pid 过滤修掉了「爬自己窗口」的回归 |

---

## 附带提醒

现在有三套 app 并存，最后要清一套：

```
SmartCompanion.app             旧 Electron 包（bundle id 仍是 demo.missmalfoy.desktop）
dist/DeepWhale.app             ← 最终版
dist/WhaleVideoCompanion.app   原 PetDesk（Swift，无智能层）
```
