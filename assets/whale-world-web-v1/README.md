# 真人世界浏览器视频派生 v1

真源为 `../whale-video-test/character.json` / `pack.json` 及其引用的原片，全部保留。生成：在 desktop-companion 执行 `python3 scripts/prepare-world-video.py`；同时刷新 `MALFOY-ENGINE/web/live2d/world-media/` 开发副本。不要编辑生成副本或 dist 资源。

| 输出 | 引用来源 | 用途 |
|---|---|---|
| idle.webm | character.character | 880×660 透明待机 |
| touch.webm | pack.scene.touch | 880×660 原触摸反应（保留作基线） |
| quiet.webm | character.quietCharacter | 960×540 透明趴屏循环，6 号一次性近景后播放 |
| sleep.webm | character.sleepScene | 960×540 床上整场景 |
| palm-magic.webm | 用户 4 号 | 日常点击动作，透明 VP9，一次播放后回 idle |
| moon-room.mp4 | 用户 5 号 | 月夜整场景循环；双 video 在边界交叉衔接 |
| gentle-smile.webm | 用户 6 号 | 60 秒闲置时的一次性近景，随后进入 quiet.webm |
| prayer-scene.mp4 | 用户 7 号 | 月夜“祈愿”按钮触发的一次性完整镜头，结束后回到月夜 |
| anchor-idle.png / anchor-moon.png | 对应 idle / moon-room | 场景切换、解码期间静帧 |
| background.png | character.background | 原背景复制 |

均为 VP9，不依赖 Electron 的专有 H264 解码；三个透明片用 libvpx-vp9 解码才能在 ffmpeg 验证 alpha。manifest.json 保存文件和原件哈希，config.js 是 file:// 可加载的同份公开配置。构建从此目录复制，不以开发副本为真源。

派生及 scene 配置由 `python3 scripts/prepare-world-video.py` 一并生成；构建的 payload 守卫核对原片/派生/应用包 SHA256。验证与视觉限制见[四段接入交付](../../docs/project/updates/2026-10-31-WORLD-ASSET-01-video-candidates.md)。新增派生沿用原素材许可边界，不代表获得新的再分发授权。
