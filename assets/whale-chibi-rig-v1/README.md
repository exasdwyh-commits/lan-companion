# Q 版单图骨骼 v1

**历史保留：用户指出此图偏瘦、不符合参考，当前运行与打包已改用 [圆润 v2](../whale-chibi-rig-v2/README.md)。以下记录首次接入时的形态，不是当前真源。**

texture.png 是项目原有 MALFOY-ENGINE/web/live2d/whale-chibi.png 的无修改副本；[来源记录](source.json) 保存哈希。本次没有重新画图或自动拆出被遮挡的部位。原图的公开再分发许可仍需核实。

当前原图真源放本目录，开发运行副本保留在 engine 原路径；构建从本目录覆盖包内纹理，project.sh check 核对二者哈希。更新纹理时同时更新开发副本与 source.json，不直接改 dist。

更新后运行 `python3 scripts/prepare-chibi-texture.py`，从原图生成运行模块 chibi-texture.js；构建也执行同一脚本。内嵌数据保留 PNG 原字节，解决 file:// 页面的 WebGL/alpha 遮罩跨域限制，不修改画面。

骨骼、绑定点、权重和角度限制是 [动作模块](../../MALFOY-ENGINE/web/live2d/chibi-motion.js) 中的代码参数。完整契约与下一轮分层素材规范见 [Q 版动作系统](../../docs/project/CHIBI-MOTION.md)。

当前模型为同一张透明原画的连续网格，15 骨骼、1421 顶点、2688 三角形。它能做轻微头/身体/手脚动作；没有眼皮、嘴型、背面或被头发遮住的完整手臂，不能宣称支持大幅挥手、转身、独立表情或任意姿势。
