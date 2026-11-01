# 澜 · B 方向立体造型重设 v2

任务 WORLD-MODEL-10，2026-11-01。按用户新视频研究体积，保持已选的短圆 Q 版身份。

## 制作顺序

1. 看参考视频的多个时间点：圆头后脑、面颊、前胸与背发有厚度，短手脚从躯干明确分开，细尾独立于裙装。
2. 保持约两头身、蓝发、鳍耳、蓝白围裙及鲸尾；不通过拉长腿解决旧模型局促。
3. 先出造型与三视图，检查尾巴左右一致性，再出独立正、侧、背图。
4. 混元 3.1 多图生成真实网格，下载后用 Blender 四视角查验；合格后才进入拓扑、绑骨与动作。

## 文件

- `volume-look-study-v1.png`：立体效果概念，仅作观感参考。
- `turnaround-study-v1.png`：废弃的第一版三视图，背面尾巴左右不一致。
- `turnaround-study-v2.png`：已修正尾巴方向的三视图。
- `modeling-front-v1.png` / `modeling-side-v1.png` / `modeling-back-v1.png`：本轮混元实际输入。背视尾巴在画面左，正视在画面右；侧视面朝画面左。
- `prompt-*.txt` / `prompt-single-views.json`：完整生成提示词。
- `manifest.json`：来源、尺寸、哈希与任务状态。
- `model-trial-v1/lan-b-multiview-original.glb`：混元实际下载原件，56,946,276 bytes，497,910 三角面，327,237 顶点，3 张内嵌 4K 贴图。
- `model-trial-v1/review/`：原始模型实际四视角及可编辑 Blender 检查工程。
- `model-trial-v1/lan-b-multiview-game-preview.glb`：独立柔和材质副本，9,213,768 bytes，199,999 三角面，两张内嵌 2K 贴图；roughness=0.55 / metallic=0。
- `model-trial-v1/game-review/`：最终轻量副本重新导入后的四视角与 Blender 工程。
- `model-trial-v1/prepare-game-copy.py`：副本加工脚本，不覆盖原始模型。
- `model-trial-v1/*inspection.json` / `game-copy-report.json`：文件和 Blender 结构证据。

## 边界

独立视图是 AI 生成参考，部分细节与相机有误差，并非精确投影图。第三方视频只用于形体研究，未作为项目运行内容。生成图与关联 B 母图仅供内部制作与审核，公开发布素材权利尚未核实。未覆盖旧模型，未替换房间，未制作骨骼/动画。

## 造型评审

原始模型正、侧、背、三分之四均实看：短圆比例与身份保留，后脑深度和背发分层清晰，旧版白色背部鼓包已消失，正背尾方向相符。手指、发丝及裙边仍有生成网格噪点，尾部是简化的鲸尾造型；没有把候选写成用户已确认。

原始 PBR 反光偏强，副本改成统一柔和材质并降面/降贴图；减面不是动画拓扑。两份 GLB 均无外部依赖、骨骼、动画和表情 shape keys，后续需拓扑与绑定才能制作真实动作。
