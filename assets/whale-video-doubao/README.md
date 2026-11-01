# 豆包绿幕素材 · 水印区域覆盖版

源文件：`/Users/exasdwyh/Downloads/绿幕视频制作（桌面宠物素材）.mp4`，未修改。

输出：`doubao-greenscreen-covered.mp4`，1280×720、24 fps、8.064 秒，保留原音轨。仍为绿幕视频，尚未抠绿。

水印在右下角与左上角之间切换。用绿色 `#24993E` 固定覆盖两处矩形，坐标以视频左上角为原点：

- 左上：x=0, y=0, width=260, height=100。
- 右下：x=1000, y=620, width=280, height=100。

抽查每秒画面，覆盖区未碰到人物。矩形与原绿幕存在色差，供后续抠绿合成使用。AI 生成属性保留在视频 comment 元数据中。

复现滤镜：

```text
drawbox=x=0:y=0:w=260:h=100:color=0x24993e:t=fill,drawbox=x=1000:y=620:w=280:h=100:color=0x24993e:t=fill
```
