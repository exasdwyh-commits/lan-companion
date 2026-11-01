# 混元角色制作批次

已通过混元 3.1 单图生成并下载真实人物模型，消耗 1 积分、余额 19。**下载完成；角色背面修形及动画验收未完成。**

## 已落盘

- `lan-b-hunyuan-original.glb`：56,549,976 字节，498,662 三角面，325,376 顶点，3 张内嵌 4096 贴图；无外部文件依赖、无骨骼、无动作和表情形变。
- `review-v1/model-review.blend`：实际导入原始 GLB，打包贴图和 B 母图的检查工程。
- `review-v1/{front,right,back,three-quarter}.png`：实际 Blender 四视角渲染。正面保留 B 版脸、蓝发、鳍耳、鲸尾和围裙；背部误生成鼓起的鲸背/白色区域。
- `refined-v4/lan-b-room-static.glb`：9,405,948 字节、99,999 三角面、2K 贴图的静态修形候选；`refined-v4/lan-b-refined.blend` 保留高密度可编辑副本，`refined-v4/review/` 为重新导入 GLB 后的渲染。

## 视觉结论

`refined-v1` 至 `refined-v4` 尝试收薄背部、补发束、降低反光及轻量化；它们仍有背发接缝、材质分界和下缘轮廓问题，**未通过正式角色视觉验收，不进入房间或发行包**。下一步应使用独立且一致的侧/背图重新约束生成，再做手工拓扑与骨骼；现有多视图拼图只是概念参考，不能当作已完成的多视图模型。

`preparation/reference-only.blend` 已通过 Blender 5.2.1 LTS 实际保存，内嵌已选 B 母图、灯光与检查相机。它没有人物网格，不能作为角色模型交付；实际报告见 `preparation/inspection.json`。

真实模型下载后，在项目根运行：

```sh
blender --background --python scripts/review-lan-model.py -- \
  --reference assets/whale-chibi-directions-2026-10-31/B-master-v1.png \
  --model assets/lan-3d-hunyuan-v1/lan-b-hunyuan-original.glb \
  --output assets/lan-3d-hunyuan-v1/review-v1 --render
```

脚本导入 GLB/glTF/FBX、保留源文件、保存检查副本、打包贴图，输出正侧背和四分之三预览及网格/骨架/动作清单。已在 Blender 5.2.1 LTS 执行原始模型与四版候选的真实导入/渲染；相机方向已人工看图核实。

该脚本不代替修形、拓扑、权重修整或视觉验收。B 母图来源为 `../whale-chibi-directions-2026-10-31/B-master-v1.png`，参考素材再分发权仍待核实。
