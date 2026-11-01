# 撒娇比心动作素材

原文件保留：`/Users/exasdwyh/Downloads/绿幕视频制作（桌面宠物素材） (1).mp4`。

- `cute-greenscreen-covered.mp4`：豆包水印两处盖绿，1280×720、24 fps、约 8 秒，保留原音轨。
- `cute.mov`：透明 ProRes 4444，去除原音轨，供桌宠合成；未替换当前待机视频；其中心裁切版本 `../whale-video-test/touch-cute.mov` 已配置为点击反应。
- `clip.json`：动作与处理参数。

动作：歪头、闭眼笑、双手比心、回到正面。建议作为点击或夸奖后的一次性反馈。素材首尾看起来接近，但尚未验证无缝循环。

水印遮罩整段生效：左上 (0,0,260,100)，右下 (1000,620,280,100)，颜色 #24993e。每 0.5 秒抽帧检查，未见残留水印或遮罩覆盖人物。透明版本已用深灰背景抽帧检查，发丝仍有少量绿边，需要最终场景下调色。

绿幕滤镜：
`drawbox=x=0:y=0:w=260:h=100:color=0x24993e:t=fill,drawbox=x=1000:y=620:w=280:h=100:color=0x24993e:t=fill`

透明滤镜：`chromakey=0x24993e:0.10:0.03,format=yuva444p10le`，编码 `prores_ks -profile:v 4 -alpha_bits 16`。
AI 生成属性保留于绿幕 MP4 comment 元数据。
