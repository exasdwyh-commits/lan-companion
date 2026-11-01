# 鲸鱼娘视频测试包

`source.mp4` 是用户提供的 6.08 秒、1112×834 绿幕视频的原样副本。原下载文件未修改。

`source-covered.mp4` 是当前盖绿水印版；覆盖左上固定标识、左侧与右侧切换的平台水印。右侧遮罩紧贴衣袖轮廓，局部边缘可能略有裁切。`source.mp4` 仍保留原样。

`character.mov` 是从盖绿版生成的测试用 ProRes 4444 透明视频，去掉原音轨；播放器静音循环。运行时与 `background.png` 独立合成，支持原有换背景、人物移动缩放、文字聊天与系统语音。

重建透明视频：

```sh
ffmpeg -i source-covered.mp4 -an -vf 'chromakey=0x14953c:0.10:0.03,format=yuva444p10le' -c:v prores_ks -profile:v 4 -alpha_bits 16 character.mov -y
```

在 desktop-companion 下执行 `bash scripts/build-whale-video.sh`，入口为 `dist/WhaleVideoCompanion.app`。

当前视频用于循环待机；点击和聊天不会驱动对应肢体动作或口型。原素材首尾未必一致，可能有循环跳变；发丝边缘仍有绿色残留，属于测试版。

水印覆盖滤镜（左上为坐标原点）：

```text
drawbox=x=18:y=18:w=105:h=52:color=0x14953c:t=fill,drawbox=x=18:y=195:w=150:h=55:color=0x14953c:t=fill,drawbox=x=914:y=676:w=135:h=42:color=0x14953c:t=fill
```

## 当前衔接测试版

角色配置已改为 `idle-matched.mov`，点击动作使用 `touch-matched.mov`，同源锚点衔接。旧 `character.mov` 和 `touch-cute.mov` 保留。时码、复现方法及限制见 `../../benchmarks/whale-transition-2026-10-29/README.md`。
