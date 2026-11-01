# 角色规格 01：深海·深seek鲸鱼娘（GPT 三视图定稿 + 小云雀视频 + 抠像）

> 2026-10-29 老板拍板：GPT 管颜值（出图定稿），小云雀管视频（ego 登录，每日积分），
> 绿幕角色图 → 生成视频 → 抠像 → 桌面融合。

## 角色设计（定稿前可改，改完锁版本）

- 风格：3D 渲染萌系，5.5 头身（桌宠小尺寸下辨识度最高）
- 造型：
  - 背部小鲸背，大尾鳍像长马尾一样垂在身后（动态灵魂，视频主要动它）
  - 小鳍翼手臂（不放大到夸张，保留手形方便指/点头动作）
  - 深蓝 body（DeepSeek 蓝 #1E4FA3 系）+ 白肚皮 + 银色 tech 线条点缀
- 表情基调：眼睛大、柔和，微垂眼（安静陪伴感，不做亢奋脸）
- 红线：
  - 服装禁用绿色（#00FF00 绿幕会吃掉衣服色）
  - 禁用大面积纯黄/纯白闪光元素（抠像边缘风险）
  - 尾巴/发丝边缘不要太碎（碎 = 抠像绿边）

## GPT 提示词（直接复制）

### P1 三视图定稿（白底设计稿）
```
3D rendered cute chibi-style girl character "Deepsea", DeepSeek-blue whale themed:
small hump on the back, large tail fin flowing behind like a long ponytail,
small fin wings on the arms, white belly, silver tech-line accents,
big soft gentle eyes, 5.5 head-tall, full body character sheet
with three views (front / side / back) plus one face close-up,
clean white background, design sheet layout, no text, no watermark
```

### P2 绿幕定稿版（三视图选中角度后出）
```
same character as the approved design [贴定稿图], standing front pose,
full body, solid pure green chroma key background (#00FF00),
no shadows, no ground, clean silhouettes, 3D render, high quality,
9:16 aspect ratio
```
（9:16 优先，小云雀若不支持就退回 1:1，别改提示词其他部分）

## 小云雀视频（每日 1 条，做 idle loop 优先）

- 时长 5–10s，镜头锁死，绿幕背景不变
- 动作词（按优先级出）：
  1. "tail fin sways slowly, gentle blink, subtle breathing, camera locked, green screen background stays unchanged"
  2. "waving with fin hand, tail fin sways, camera locked, green screen unchanged"
  3. "nodding slightly, tail fin settles down, sleepy eyes, camera locked"
- 每条出片先验：绿幕是否纯净（无渐变/反光）→ 不纯就重生成，不进入抠像

## 抠像 → 素材包（我这边接）

- 静态：ffmpeg colorkey 抠绿 → 透明 PNG → character.json `green_screen_png`
- 动态：ffmpeg 逐帧 colorkey → WebM(VP9+alpha) → `chroma_video`
- 验收：贴深/浅桌面背景无绿边；alpha 视频播放边缘不抖不泛绿

## 备选：古装少女

要换方向时同规格出：宋制褙子 + 高马尾，配色走黛青/月白（避开绿），
动态元素换成发带 + 衣袂。提示词我来出。

## 小云雀 idle loop 视频：锚点图约束（抄 Malfoy 工程，2026-10-29 加）

小云雀出片时：
1. 参考图用绿幕定稿正面单体（deepsea-greenscreen-front-v2.png 的抠像结果或白底定稿图，看小云雀入口）
2. 提示词必须含："start from this exact pose, end in the exact same pose"（首尾帧=锚点，片段才能无缝衔接）
3. 动作幅度越小越好（尾鳍摆+眨眼+呼吸），5s，镜头锁死
4. 出片后本地验：首帧 vs 尾帧像素差应 <0.5（灰度 0-255 均值），超了就重生成
5. 播放端（LingDesk）：尾帧不播到最后，duration-0.45s 起 0.45s 淡出

## 验收数据参考（Malfoy 实测）
- 锚点帧差 0.30-0.32（灰度 0-255）
- 尾帧清晰度崩：blurdetect 首帧 696KB → 末帧 101KB
- 响度：素材 -19 LUFS / 成片 -15 LUFS
