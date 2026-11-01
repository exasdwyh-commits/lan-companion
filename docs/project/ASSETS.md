# 素材与音色真源

更新：2026-10-30。素材留原目录，不移动大文件；集中登记引用、加工关系与发布范围。

## 2026-11-01 小屋与桌面动作（WORLD-UX-20）

- `assets/dsh-pet-desktop-v1/`：24段原始透明VP9动作，约11 MiB；`manifest.json`记原文件名/来源rev/哈希，`NOTICE.md`记署名。用`scripts/prepare-dsh-desktop.py`复制到运行镜像`MALFOY-ENGINE/web/live2d/dsh-motion/`。来源PC2005-cloud/dsh-pet：代码MIT；上游角色/动画标注CC BY-NC-SA 4.0、上善无形/ZipZipPipe署名及非商业使用；当前内部复用不等于原创澜角色或可商业发布。
- `moli-room/assets/lan-room/journey-{0,1,2,3}.jpg`：复用已在项目的四张海边/图书馆/森林/城市相册图，供旅途手账缺图时展示；`journey-sources.json`记来源与哈希，界面标注馆藏配图。既有许可边界继续生效。
- [本次交付与验证](updates/2026-11-01-WORLD-UX-20-room-desktop.md)。

## 真人内容

### 2026-10-31 用户四段新视频候选

真源：[whale-world-candidates-2026-10-31](../../assets/whale-world-candidates-2026-10-31/README.md)。4/5/6/7 已接入真人世界：日常点击播 4，闲置 60 秒播 6 后接回现有趴屏循环；切换“月夜房间”播放 5，月夜专属“祈愿”按钮播放 7。原片保留；4/6 用透明 VP9 派生，但发丝/衣服边缘仍有轻微抠像残留，5/7 完整场景静音播放。用户来源的豆包视频，再分发许可未核实，不代表可公开发布。详见[交付与验证](updates/2026-10-31-WORLD-ASSET-01-video-candidates.md)。

| 路径 | 当前内容与用途 |
|---|---|
| assets/whale-video-test/character.json | 默认背景、人物、趴屏/睡眠、阈值与 Swift 语音配置 |
| assets/whale-video-test/pack.json | 台词、好感、album/clips/chapters/songs；现有鲸鱼内容真源 |
| background.png | 独立日间房间背景 |
| idle-matched-clean.mov | 当前默认待机，约 1.92 秒，透明区去绿边版本 |
| touch-matched-clean.mov | 点击撒娇，约 7.96 秒，使用共同锚点 |
| quiet-idle-loop.mov | 趴屏陪伴，约 7.54 秒，ProRes 4444 alpha |
| bed-sleep-loop.mp4 | 床上完整睡眠场景，约 9.54 秒；无躺下/起身过渡 |
| album-*.jpg | 20 张旧竖版 + 6 组情绪相册；新组各有手机竖版与 `-desktop` 电脑横版 |
| songs/tide.m4a | 约 8.7 秒原创演示歌曲，pack 内有歌词时间轴 |
| songs/d9205056.m4a | 第二首已登记转换演示曲，来源说明见 pack 与 cover 基准报告 |

表中未带目录的文件均在 assets/whale-video-test。时长是既有加工记录，不是本次新做视频视觉验收。HERMES-01 已把鲸鱼相册/剧情接入 Electron；Electron 桌面壁纸规格适配详见本轮相册更新。

### 原片与加工

- assets/whale-girl/three-view-greenscreen.png：真人身份参考。
- assets/whale-video-cute/：撒娇上游素材；prepare-whale-transitions.sh 生成锚点链。
- assets/whale-sleepy-video/、assets/whale-bed-sleep/：趴屏/床上原片与修补结果；prepare-whale-rest.py 重建。
- fix-alpha-bleed.py：透明视频边缘颜色外扩与去溢色；新文件名，不覆盖原片。
- assets/whale-girl/action-references/：动作参考板与单镜头提示词；不能直接把整板当视频参考。

用户提供的 [ChatGPT 人物图分享](https://chatgpt.com/share/6ae56d54-b944-83e9-bc80-542a92c74a28) 已筛选并登记为视觉参考：[筛选记录](updates/2026-10-31-DW-03-share-reference-review.md)。保留一张有明显侧角度的竖版近景，以及两张场景差异清晰的横版日常图；相似近景淘汰。这里只记录来源和选择，不代表图片已导入或获准再分发。

### 相册版本缺口

| 目录/配置 | 现状 |
|---|---|
| assets/whale-album-2026-10-29/originals/ | 26 张初版 PNG 全部存在 |
| model-v2/ | 14 张，未齐 |
| final-v3/ | 6 张，未齐 |
| generation.json | 26 条，当前指 model-v2；有 12 个原图引用缺失 |
| generation-v3.json | 26 条，指未齐的 final-v3 |
| 当前 pack / Swift App | pack 现有 26 个相册条目；Electron 页面支持新组双规格。Swift UI 横版切换未做，需另行构建和验收 |

import-whale-album.py 会在导入前检查 generation.json 的全部原图；因此现在直接运行会失败，不应靠删校验解决。DW-03 应记录选定版本，补齐或明确使用完整初版，再导入、解码、检查与打包。不把不同版本悄悄混在一起称“最终版”。

## Q 版

用户本次选定风格已复制至 [参考目录](../../assets/whale-chibi-reference-2026-10-30/README.md)，不再依赖系统临时附件。

- 识别点：蓝发、鳍耳、鲸尾、蓝白女仆裙、圆润比例、清晰表情。
- 默认放松待机，抱胸/干饭作为互动状态；补左右走、坐下、睡眠、聊天、思考、完成反馈。
- 统一脸型、画幅、脚底锚点、透明背景与角色实际像素高度；动作切换避免跳大小。
- 静态表情图、连续动作帧、可绑定分层图是三类不同素材；图多不等于已有动画。
- 当前 PNG 为按用户参考生成的 [圆润 v2](../../assets/whale-chibi-rig-v2/README.md)，原输出 1254×1254 RGBA；头大身短、圆脸、短腿、鲸尾。16 骨骼已按新比例重绑，尾部和腿部分开赋权；它不是独立分层动作集。v1 原图保留作历史。接口、限制和下一轮原画规范见 [动作系统](CHIBI-MOTION.md)。

- 当前情境表演真源为 [whale-chibi-performance-v1](../../assets/whale-chibi-performance-v1/README.md)：16 幅身体/道具姿态与单独的无五官底图，眼睛/眉毛/嘴/脸红由代码参数独立控制；工作、阅读、唱歌成对短循环。生成 chibi-atlas.js 供同一 renderer 使用，原图与 v2 骨骼降级仍保留。
- 走路循环：[whale-chibi-walk-v1](../../assets/whale-chibi-walk-v1/README.md)（CHIBI-02，2026-10-31）：agnes i2i 参考 v2 生成的 6 帧正面走路，白底转透明、每行脚线对齐、结构校验数字见其 README；运行副本 `web/live2d/chibi-walk.js` 由 prepare-chibi-texture.py 生成。参考素材再分发许可未核实，公开发行前逐件确认。
- Live2D 内部小样：[live2d-poc](../../assets/live2d-poc/)（LIVE2D-POC-01，2026-10-31）：vendor 三件套与 Hiyori 官方示例模型，仅内部测试不随产品分发、不进构建 payload；规格与授权见 [LIVE2D-POC.md](LIVE2D-POC.md)。
- 新画风图集组：[whale-chibi-style-v1](../../assets/whale-chibi-style-v1/README.md)（CHIBI-03，2026-10-31）：用户卡通参考图+v2 身份双参考生成；walk/dance 已接线（prepare 优先、dance 专用通路+合成哼唱 hum.m4a 内嵌），poses/facebase 暂存待锚点标定；用户参考图仅作风格输入，再分发许可未核实。

## Electron 现有视频

assets/whale-greenscreen-keyed/source/ 保留源片，encoded/ 存派生 WebM，manifest.json 记录过程。当前运行副本在 MALFOY-ENGINE/web/live2d/keyed/。

world.html 的 idle/closeup/heart/sleep 表登记四条资源；sleep 尚无调用。DW-04 后桌面不再自动切 closeup 或真人比心，Q 版保持自己的动作；world 保留真人 idle，点击反馈仍为原有爱心。后续要统一资产适配/打包，避免运行副本与 assets 真源漂移。旧 WORKBUDDY-FIXES 的缩放绿边、清晰度与画幅问题仍需视觉复核。

## 双音色与模型

| 路线 | 配置 | 接口与边界 |
|---|---|---|
| Electron 主线 | web/data.js persona.voiceProfiles.world/desktop | Qwen3 VoiceDesign HTTP :8091/tts，清冷/活泼描述；回退 edge/say，实际 engine 必须另验 |
| Swift 基线 | character.json，PetNeuralSpeech.swift | 优先 .runtime/venv-tts 与项目模型；兼容 LiveTalking 旧路径；不是同一个 HTTP 服务 |
| 歌曲制作 | sing_from_lyrics.sh / sing_cover_file.sh / sing_seedvc.py | 歌曲生成、分离/转换/混回；独立于对话 TTS 播放 |

.runtime、.models 与机器缓存不能当成已随 App 分发。移机、模型下载与服务启动由配置/发布任务收口。

## 来源与发布

素材站：[蓝色大肥鱼](https://xn--pssy23gqgbz2d718b.com/)，[来源与授权](https://xn--pssy23gqgbz2d718b.com/about.html#license)，[公开元数据](https://xn--pssy23gqgbz2d718b.com/open-api/v1/works.json)。本聊天已核对站点与两张作品详情，具体许可仍逐件核实。

每份新素材至少记录：本地路径、原始 URL/文件、作者、许可声明及链接、用途（参考/本机测试/允许发布）、派生文件与加工命令。免费开源不自动取得图片、模型或音频的再分发权；代码许可与素材许可分开。

参考图和来源未明素材不得因进入 assets 就默认加入公开包。旧 Malfoy、Cubism 示例和各模型也分别核实，发布任务统一处理。

## 真人世界视频兼容派生（DW-03）

`assets/whale-world-web-v1` 是真人世界视频唯一派生真源，保留原有 idle/touch/quiet/sleep，并通过 `prepare-world-video.py` 加入候选场景和动作。构建从 assets 真源复制到包；`check-world-payload.py` 对照源素材、派生哈希与打包文件。见[素材说明](../../assets/whale-world-web-v1/README.md)与[四段接入交付](updates/2026-10-31-WORLD-ASSET-01-video-candidates.md)。
