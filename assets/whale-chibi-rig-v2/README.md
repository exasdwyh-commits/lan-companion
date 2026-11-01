# 圆润鲸鱼 Q 版 v2

依据 2026-10-30 用户纠正：旧形象偏瘦、不够可爱。内置 image_gen 以两张用户参考为输入生成，保留原输出 RGBA 字节，没有拉宽/压扁旧图。图为 1254×1254，透明背景。目标为约两头身、圆脸、短手短腿、宽蓬松裙摆、蓝长发与明显鲸尾；用户随后已接受形象；新增情境图集见 [whale-chibi-performance-v1](../whale-chibi-performance-v1/README.md)。

- 当前纹理真源：[texture.png](texture.png)；生成记录与哈希：[source.json](source.json)；完整提示词：[prompt.txt](prompt.txt)。
- 参考：assets/whale-chibi-reference-2026-10-30 的 crossed-arms / rice；旧原图在 whale-chibi-rig-v1 保留。
- 同图副本进入 MALFOY-ENGINE/web/live2d/whale-chibi.png，供降级使用。运行 `python3 scripts/prepare-chibi-texture.py` 生成内嵌纹理数据；构建执行同脚本，禁止直接改 dist。
- 当前是 16 骨骼单图蒙皮，校准头/臂/短腿绑定和尾部权重；尾巴小幅摆动不等于已拥有独立图层或背面。
- 大幅动作、闭眼/嘴型仍需分层与补画，规范见 [CHIBI-MOTION](../../docs/project/CHIBI-MOTION.md)。
- 用户参考的再分发许可仍未核实，生成记录不能代替公开发行审查。
