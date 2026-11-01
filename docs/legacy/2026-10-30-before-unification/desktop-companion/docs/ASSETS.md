# 素材索引（2026-10-29）

## 唯一运行素材包

`assets/whale-video-test/` 是 `build-whale-video.sh` 复制到应用的素材真源。

| 文件 | 当前职责 |
|---|---|
| `character.json` | 人物、背景、Kokoro 音色、循环切点开关、闲置阈值 |
| `pack.json` | 台词、好感、点击动作、相册与剧情配置 |
| `background.png` | 默认日间房间背景，与透明人物独立 |
| `idle-matched-clean.mov` | 默认互动待机，约 1.92 秒；往返短循环，已做透明区颜色外扩去绿边 |
| `touch-matched-clean.mov` | 点击撒娇，约 7.96 秒，与默认待机使用共同锚点；已做去绿边 |
| `quiet-idle-loop.mov` | 趴屏陪伴，约 7.54 秒，ProRes 4444 alpha |
| `bed-sleep-loop.mp4` | 完整月夜床上睡眠场景，约 9.54 秒，覆盖原背景 |
| `album-*.jpg` | 26 张横屏收藏壁纸，由 pack.json 的 album 引用；前 4 张初始开放 |

以上人物/场景运行视频均为静音；聊天语音独立播放。不能用绿幕版替换透明 MOV 却不改渲染方式。

`idle-matched.mov` / `touch-matched.mov` 是无后缀的原片，保留备查；运行包用 `-clean` 版。
两者差别只有透明区颜色（原片 alpha=0 处保留绿幕 RGB，缩放时会渗进发丝）。

## 原片与生成过程

| 目录 | 定位 |
|---|---|
| `assets/whale-video-test/source.mp4` | 最初近景原片；同目录的 character.mov / source-covered.mp4 等为旧加工版本，非当前默认待机 |
| `assets/whale-video-doubao/` | 豆包前一版绿幕源与加工记录 |
| `assets/whale-video-cute/` | 撒娇原片与加工；运行包 touch-cute.mov 是当前锚点重建的上游输入 |
| `assets/whale-sleepy-video/` | 用户 (2).mp4 趴屏素材及局部同源帧修补；当前重建输入 sleepy-temporal-repair-v1.mp4 |
| `assets/whale-bed-sleep/source.mp4` | 用户 (3).mp4 新睡眠原片，未改动 |
| `assets/whale-bed-sleep/sleep-repaired.mp4` | 新睡眠水印修补中间成品 |
| `assets/whale-girl/three-view-greenscreen.png` | 角色设计真源：蓝发、鳍耳、蓝白银服装 |
| `assets/whale-girl/sleepy-idle/` | 趴屏姿势图、图片/视频提示词 |
| `assets/whale-girl/action-references/` | 理发、托腮、躺下准备、睡醒四格参考图及 video-prompts.md |
| `assets/whale-album-2026-10-29/` | 2026-10-30 内置 image_gen 生成的 26 张原始 PNG、逐张提示词、解锁阈值与来源记录；包含街拍、泳装、黑丝、白丝舞蹈、瑜伽、亲亲、浴袍和温泉等静态主题 |
| `assets/deepsea-sample/`、`characters/`、`starter-pack/`、`malfoy-pack/` | 旧样板 / 测试 / 参考，非当前鲸鱼运行包 |

## 重建

```bash
# 从当前撒娇透明源提取默认待机与动作共同锚点
bash scripts/prepare-whale-transitions.sh
# 重建趴屏透明层、睡眠局部修补及两个循环版；会覆盖这些派生文件，不改原片
../LiveTalking/.venv/bin/python scripts/prepare-whale-rest.py
# 透明素材去绿边（绿幕 RGB 渗进发丝）；输出新文件名，不覆盖原片
../LiveTalking/.venv/bin/python scripts/fix-alpha-bleed.py \
  assets/whale-video-test/idle-matched.mov \
  assets/whale-video-test/idle-matched-clean.mov --unmix --despill
# 重新复制素材到应用
bash scripts/build-whale-video.sh
```

水印修补与灰绿背景抠像方案是当前素材的专用参数，换视频必须重校时码、区域、分辨率与色彩阈值。
详细记录：`assets/whale-sleepy-video/README.md`、`assets/whale-bed-sleep/README.md`、`benchmarks/whale-transition-2026-10-29/README.md`。

## 新素材接入约定

1. 复制原片进 `assets/` 的专属目录，保留原名/来源说明，不依赖 Downloads 或 `/tmp`。
2. 每个动作独立加工与命名，原片不覆盖；透明人物和完整背景场景分清。
3. 当前运行版本放 `assets/whale-video-test/`，改 character.json 或 pack.json 指向新文件，再构建。
4. 循环待机要求首尾姿态一致；躺下/醒来属于单向过渡，应与已有睡眠帧对齐，不要求自身首尾相同。
5. 新图继续保持同一个成年写实鲸鱼娘身份。四格动作板用于选姿势，每次视频只用一格并搭配角色设定参考。

本次整理保留所有旧素材，没有批量删除。当前 App 按 character.json / pack.json 引用白名单打包；相册只打包运行 JPEG，原始 PNG 和提示词留在素材源目录。
