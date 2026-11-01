# 2026-10-30 · DW-04 情境表演、独立面部与出入世界

## 用户要求与归属

用户已接受圆润 v2 外观，要求按情况改变表情、姿态与道具，随后追加独立自由面部、边框后躲藏/探头及出入自己世界的动画。

负责人：Codex / 当前 Q 版动作聊天。新增 performance/face/presence，扩展现有 renderer/world/preview、素材、生成/打包/静态核验与统一文档。保留 WorkBuddy DW-01/02 的 main/preload/lib 与未知修改，不直接改 dist 资源。

## 实现

- 内置 image_gen 参考已接受的 v2，生成 16 姿态图集，再生成独立五官用的无五官底图。真源、哈希、提示词与逐帧脸/脚底锚点在 [素材目录](../../../assets/whale-chibi-performance-v1/README.md)。原 PNG 与首轮图集保留，未在 Python 中改图。
- 坐姿电脑/眼镜、持书/翻页、麦克风/伸手、抱枕困倦/闭眼，以及捧脸、抱臂、托腮、惊讶、含泪、举手庆祝、招手。工作/读书/唱歌为成对短循环；不是 16 套完整动画。使用当前 renderer 的同一 WebGL 管线。
- 独立眼睛/眉毛/嘴/脸红/眼泪：10 个面部预设、参数组合、短眨眼、鼠标追视。持书或电脑姿态可更换面部；睡姿尊重枕头遮嘴。真实语音使用现有 Audio Analyser 音量开合嘴，未做音素口型。
- 触摸开心、连摸害羞、碰尾/拖起惊讶、聊天等待托腮/失败委屈接当前回调。工作/读书/唱歌、完成/失败 API 提供给 DW-05/06；没有假造业务成功。
- 屏幕左/右/底边：靠近→藏起→等待→探头→再藏→出来。开启漫游后只在空闲冷却触发，忙碌时不藏。目前是屏幕/iframe 边缘裁剪，不是其他 App 的真实层级遮挡。
- 世界过渡：光环、收拢离场/现身；舞台按钮与 ESC 等离场后调用既有 host，新窗口加载播放现身。请求去重、失败恢复；减少动态保留短淡入淡出，停缩放/旋转。
- 保留骨骼调试与 PNG 降级。图集内嵌支持包内 file://，不关闭 webSecurity；图集失败仍用原立绘骨骼。

## 验证与证据

- [情境核心 8 项](../../../benchmarks/2026-10-30-DW-04-performance/core-checks.txt)、[骨骼回归 11 项](../../../benchmarks/2026-10-30-DW-04-performance/motion-regression.txt)、[独立面部/边缘/过渡 11 项](../../../benchmarks/2026-10-30-DW-04-performance/face-presence-checks.txt)：合计 30 项通过。
- [Ego 姿态检查 15 项](../../../benchmarks/2026-10-30-DW-04-performance/browser-checks-authored-poses.json)：完成于独立面部追加之前，覆盖成对姿态实际推进、alpha 命中、真实 pointer 连摸/拖起/落地、减少动态，以及 fixture 聊天等待/情绪/失败。不证明新面部、世界过渡或真实模型。
- [阅读](../../../benchmarks/2026-10-30-DW-04-performance/reading.png)、[唱歌](../../../benchmarks/2026-10-30-DW-04-performance/singing.png)、[睡眠](../../../benchmarks/2026-10-30-DW-04-performance/sleeping.png) 同属上述旧姿态快照。检查时去掉整图交叉淡化造成的双脸重影。
- 最新面部/边缘/世界过渡的浏览器检查待续：本轮 Ego space 8 已不存在，按 ego-browser 技能询问后，**用户明确选择“先完成代码，稍后再看”**。因此未另开空间或绕过到其他浏览器，保留画面验收。不能沿用上一版截图证明新版画面完成。
- [构建记录](../../../benchmarks/2026-10-30-DW-04-performance/build-transaction.json)：临时包构建，18 项源包核对与签名后替换 canonical App，保留前包；显式临时数据目录早退探针通过，没有启动窗口/模型。
- [静态审计](../../../benchmarks/2026-10-30-DW-04-performance/static-checks.txt)：以当前报告为准；不替代视觉/听感或真实服务验收。

## 入口与剩余边界

预览：`http://127.0.0.1:8914/live2d/motion-preview.html?revision=face-presence-v1`；App 为 `dist/DeepWhale.app`。预览直接加载生产 world.html，滚动侧栏选择身体、独立面部、滑杆、探头和世界切换。

接口与后续规则集中在 [CHIBI-MOTION](../CHIBI-MOTION.md)。工作/阅读/唱歌实际业务由 DW-05/06 接线。面部选择不重置身体/道具；静态预览同页切换 world/desktop，原生宿主调用既有 host。

main 的托盘/快捷键仍直接关旧窗口：新窗口会现身，旧窗口离场握手需与主进程负责人协调。原生穿透、多屏、长时能耗、真实业务流程、真人世界过渡观感与独立五官配准仍需验收。DW-04 保持进行中。
