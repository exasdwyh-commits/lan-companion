# 鲸鱼内容包与 Swift 回归基线

更新：2026-10-30。这里是现有鲸鱼内容真源；[统一素材文档](../../docs/project/ASSETS.md) 登记与 Electron 的迁移关系。

- character.json：默认 idle-matched-clean.mov，趴屏 quiet-idle-loop.mov，完整睡眠场景 bed-sleep-loop.mp4；闲置阈值 60/300 秒。TTS worker 支持 auto/Qwen3 及回退，不再按旧文档只称 Kokoro。
- pack.json：touch-matched-clean.mov、台词、好感、26 张相册、1 章/6 静帧剧情及两分支、2 首歌曲；动态数量以配置与 project.sh status 为准。
- album-*.jpg：原有 20 张纵版，加 6 组情绪相册的手机/电脑双规格，共 32 个运行图片文件；相册来源与筛选见 [相册说明](../whale-album-2026-10-29/README.md)。
- background.png：独立日间背景；songs/：原创演示及转换演示音频。

Swift 构建：在 desktop-companion 执行 `bash scripts/project.sh reference-build`。Electron 相册读取 `desktopFile` 横版字段，并随内容准备脚本复制；Swift UI 尚未增加规格切换。

不要直接改 dist 的副本。source.mp4、source-covered.mp4、character.mov、touch-cute.mov 等是保留原片/旧版/重建输入，不是全部用于当前播放。原文见 [整理前快照](../../docs/legacy/2026-10-30-before-unification/desktop-companion/assets/whale-video-test/README.md)。
