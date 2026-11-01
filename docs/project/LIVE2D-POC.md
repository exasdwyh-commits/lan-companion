# Live2D 对照小样（仅内部验证）

本实验不接 `world.html`、`main.js`、`preload.js`，不修改图集+骨骼主线，也不打包到 `dist/`。Hiyori 用来验证 Cubism 4 在现有 Electron/Web 技术栈中的渲染路径；**它不是澜的美术成品**。页面的视觉与性能验收尚待实测。

## 技术栈与来源

| 组件 | 版本/来源 | 用途 |
|---|---|---|
| PixiJS | 7.4.2，`https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js` | WebGL/Canvas 舞台 |
| Live2D Cubism Core | Live2D 官方 Web CDN（该 URL 未固定版本，产品化时需锁版本/记录哈希），`https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js` | `.moc3` 运行时 |
| pixi-live2d-display Cubism 4 bundle | RaSan147 fork，`v0.5.0-ls-8`，`https://cdn.jsdelivr.net/gh/RaSan147/pixi-live2d-display@v0.5.0-ls-8/dist/cubism4.min.js` | Pixi-Cubism 桥接 |
| Hiyori | Live2D 官方 `https://github.com/Live2D/CubismWebSamples` 的 `Samples/Resources/Hiyori` | 内部测试模型 |

以上依赖与模型都在 `assets/live2d-poc/`，**不是** `MALFOY-ENGINE/web/` 下的构建素材。加载顺序固定为 Pixi → Core → cubism4 → 页面脚本。页面相对 `web/live2d/` 向上三级到项目根（`../../../assets/live2d-poc/`）。如将来调整目录，先重新验证 URL，不能把素材复制进产品 payload 来掩盖路径错误。

## 验证入口

在项目根运行：

```sh
python3 -m http.server 8915 --bind 127.0.0.1 --directory /Users/exasdwyh/Documents/VScode/vidu/desktop-companion
```

浏览器打开 `http://127.0.0.1:8915/MALFOY-ENGINE/web/live2d/live2d-poc.html`。预期模型在透明背景中央占视口约 95%，鼠标移动追视，点模型播放 `TapBody`，静置每 18 秒随机 `Idle`。开发者工具读 `window.__poc`：`loaded`、`modelWidth`、`modelHeight`、`params.angleX/angleY/mouthOpenY/eyeLOpen`；参数值随帧刷新。资源或模型失败时页面左上角应显示红字和 URL。不得以脚本语法检查代替浏览器视觉验证。

## 授权边界

- Cubism SDK：按现有技术参考口径，个人及年营业额低于 **1000 万日元**的主体可在相应许可下免费商用；具体发布资格与最新条款须在发布前向 Live2D 官方核对，Core 授权不等于模型授权。
- Hiyori 等官方示例模型仅供内部学习/测试，**不可随应用分发，也不可作为澜的商用角色素材**。
- pixi-live2d-display 源码为 MIT；若产品化，保留该库及依赖各自版权/许可声明，复核 fork 的版本与分发要求。澜的原画、Cubism 工程、导出模型必须另行确认权利。

## 澜的分层原画规格提案（26 层基础稿）

目标为现有圆润 Q 版：约两头身、宽圆脸、短手短腿、蓬松头发、蓝发/鳍耳/鲸尾、蓝白裙装。以下各层需**独立可动且被遮挡区域补画完整**，不能从一张扁平 PNG 自动切出真正可驱动的眼口。

| 区域 | 独立层与建议拆法 |
|---|---|
| 头部 11 | 后发、左侧发束、右侧发束、脸底、左眼白、右眼白、左瞳、右瞳、左眉、右眉、前发 |
| 五官 3 | 上唇/闭嘴线、张嘴内腔、下唇/牙齿（口型按编辑器变形，不靠整脸缩放） |
| 躯干/服装 4 | 脖颈、身体、上衣/领饰、裙摆 |
| 四肢 4 | 左臂、右臂、左腿、右腿 |
| 识别细节 4 | 左鲚耳（鳍耳）、右鲚耳、鲸尾（含尾鳍作为可弯曲网格）、胸前徽章/蝴蝶结 |

PSD 交付：透明、统一画布和坐标，逐层命名稳定，保持源尺寸足以缩到 180px 时眼睛和嘴仍清楚；闭合形状留形变边距与补绘，左右部件不能合并；关节旋转、眼球移动、眼皮开合、眉变形、嘴开合与尾鳍摆动分别绑定参数。上述 26 层是启动建议，美术/绑骨时可继续细分裙褶、手掌、眼睑和尾鳍；先做单张分层 PSD，再经 Cubism Editor 绑定与导出 `.model3.json`、`.moc3`、贴图和动作。

## 图集+骨骼 vs Live2D 对照验收

用同一角色造型、相同 **180 CSS px** 高度、同一窗口/机器/倍率测量；Hiyori 只能验技术链，不能作为澜造型的画质结论。记录 CPU（持续待机与拖动追视各一段，注明采样时长和机器）、帧率/卡顿、加载/恢复/多次切换稳定性、错误日志。

| 项目 | 现版图集+骨骼 | Live2D 待验收目标 |
|---|---|---|
| 追视 | 现有独立五官与骨骼追视 | 眼球与头部参数连续转动，不越界、不抖 |
| 眨眼 | 现有独立眼睛/情境帧 | 自然全闭全开，左右眼独立，过渡无裁切 |
| 口型 | 现版基于图集/面部层效果作基线 | 绑定 `ParamMouthOpenY`，真实音频驱动后验证开合与台词同步；POC 本身**未接 TTS** |
| 摸头 | 现版触摸反馈/姿态作基线 | 头部命中与 `TapBody` 分开规划，确认表情/姿态响应；POC 目前仅点击模型触发 `TapBody`，**不是摸头验收** |
| 180px 清晰度 | 同一原画身份和缩放参数截图 | 眼、嘴、发梢无明显糊边或渲染伪影 |
| CPU/稳定性 | 同设备记录空闲与交互采样 | 观察常驻 CPU、内存、掉帧、切换恢复及 WebGL 丢失处理 |

**决策门槛**：四项交互都用澜的真实分层模型复验，才比较开发成本与稳定性；若画质/CPU 不达标或 PSD 尚未授权，继续保留现有图集方案，不为 POC 引入主线依赖。
