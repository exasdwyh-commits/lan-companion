# 圆润鲸鱼 · 首批情境表演图集

2026-10-30，DW-04；在用户接受圆润 v2 形象后补充。内置 image_gen 参考 v2 原画生成一张透明图集，再调整布局；未改动生成 PNG 的像素。当前 atlas.png 为 1254×1254 RGBA，16 幅姿态。运行导演与接口见 [CHIBI-MOTION](../../docs/project/CHIBI-MOTION.md)。

| 帧号（从 0 开始） | 内容 |
|---|---|
| 0–3 | 平静、捧脸开心、抱臂害羞、托腮思考 |
| 4–5 | 坐姿电脑眼镜，睁眼/眨眼工作 |
| 6–7 | 坐姿持书，阅读/举起书页 |
| 8–9 | 麦克风音符，睁眼/闭眼伸手唱歌 |
| 10–11 | 抱鲸鱼枕，半睁眼困倦/闭眼睡眠 |
| 12–15 | 惊讶、含泪委屈、举手星星庆祝、招手 |

- [atlas.png](atlas.png)：当前真源；source.json 记录哈希、尺寸、每帧 UV 采样矩形、透明区域分析与脚底布局。
- [prompt.txt](prompt.txt)：首轮生成原提示词；[layout-prompt.txt](layout-prompt.txt)：二次布局编辑原提示词；atlas-layout-draft.png 保留首轮输出，不进入运行包。
- [atlas-face-base.png](atlas-face-base.png)：以原图集为编辑目标，只清理五官形成动态面部底图；[face-base-prompt.txt](face-base-prompt.txt) 保留内置 image_gen 编辑提示词，source.json 的 faceBase 记录来源哈希。独立五官由运行代码绘制，不将无五官底图单独呈现为成品。逐帧 face 标注眼部中心、头部角度、瞳距与遮挡。
- 输入身份参考：[v2 原图](../whale-chibi-rig-v2/texture.png)；其最初参考为用户两张表情图，已归档于 whale-chibi-reference-2026-10-30。
- 第二次输出仍不满足严格等分留白，因此不按 4×4 固定切片，使用 source.json 里的取样区域；局部 alpha >96 分析得到 alphaBounds，按同一像素缩放与各帧脚底布局，不拉伸坐姿。
- 生成图可见细小透明边缘色点，当前尺寸下已在实际舞台检查主要轮廓；不能将此图集当作高分辨率分层原画。当前主要为两帧短循环，完整步态、音素口型和任意道具组合未完成。
- `python3 scripts/prepare-chibi-texture.py` 从此目录生成 chibi-atlas.js；构建也执行同脚本。不要直接改 dist。
- 用户参考的公开再分发许可尚未核实；本记录不构成素材授权。软件与图像的发行许可分别处理。
