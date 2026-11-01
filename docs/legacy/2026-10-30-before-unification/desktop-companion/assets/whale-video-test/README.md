# 当前鲸鱼娘运行包

这里是 `WhaleVideoCompanion.app` 的唯一素材真源；主开发入口在 `../../README.md`。

- `character.json`：默认待机 idle-matched.mov、趴屏 quiet-idle-loop.mov、完整睡眠场景 bed-sleep-loop.mp4、Kokoro zf_xiaoni、60/300 秒闲置阈值。
- `pack.json`：点击 touch-matched.mov、台词与好感配置；album 接入 26 张收藏壁纸，chapters 当前为空。
- `album-*.jpg`：26 张横屏运行壁纸；原始 PNG 和提示词见 `../whale-album-2026-10-29/`。
- `background.png`：独立日间背景。

完整素材索引与重建入口见 `../../docs/ASSETS.md`。
构建：在 desktop-companion 运行 `bash scripts/build-whale-video.sh`。
不要直接改 dist 应用里的副本。

此目录还保留 source.mp4、source-covered.mp4、character.mov、touch-cute.mov、quiet-idle.mov 等原始/旧版/重建输入；不是全部都在当前配置中播放。旧说明原文在 `../../docs/legacy/whale-video-readme-before-consolidation.md`。
