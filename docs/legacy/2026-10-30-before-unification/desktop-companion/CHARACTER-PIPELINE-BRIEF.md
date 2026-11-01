# 角色外观管线：GPT 出图（颜值）+ Muse 出视频（动态）+ 抠像融合

> 立项 brief：2026-10-29。老板拍板的方向 —— GPT 的优势是做图，把桌宠颜值拉高；
> 视频生成交给 Muse。

## 核心思路

生成与解耦分离：
1. 静态形象（GPT 管颜值）：人物角色图统一做绿幕/蓝幕底图
   - GPT 图像模型出图（高质量人像 + 纯绿 #00FF00 或纯蓝 #0000FF 背景）
   - 抠像（colorkey）→ 透明 PNG → 桌宠静态皮肤/立绘
2. 动态形象（Muse 管视频）：
   - Muse 生成绿/蓝幕人物视频（说话/动作片段）
   - 逐帧抠像 → 透明 WebM(VP9+alpha) → 透明窗口播放，贴桌面融合
3. 同一套抠像资产统一管理，桌宠窗口层透明背景渲染。

## 接入现有 LingDesk

- 不替代已验收的 MuseTalk 口型链路（engine_bridge.py）
- character.json 扩展字段：green_screen_png / chroma_video
- 抠像优先级：ffmpeg colorkey（先跑通）→ rembg 分割（后补边缘质量）

## 第一步（验证性最小闭环）
1. GPT 出一张 1024×1024 绿幕角色图
2. ffmpeg 抠像 → 透明 PNG，验边缘
3. 小云雀生成 5-10s 绿幕人物视频（ego 登录，每日积分限制 → 每日 1 条 idle loop）
4. ffmpeg 逐帧抠像 → WebM(VP9 alpha)，透明窗口播放验融合
5. 通过后写进素材包 schema

## GPT 绿幕图提示词模板（起点）
a full-body 3D rendered chibi-style character [角色描述], standing pose,
facing front, solid pure green chroma key background (#00FF00),
no shadows on the background, clean edges, high quality, studio lighting
（人物有绿色系服饰时换蓝幕 #0000FF）

## 验收标准
- 静态：抠像后 PNG 贴深/浅桌面背景无绿边/蓝边
- 动态：alpha 视频透明窗口播放，边缘不抖动不泛绿
- 管线：角色图→抠像→素材包 一条命令跑通

## 边界
- 只做人物角色抠像，不做实拍视频
- 小云雀 ego 登录，每日积分有限，做 idle loop 优先；GUI 操作
- 不碰已验收的 MuseTalk 口型链路
