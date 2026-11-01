> 历史/专题资料（2026-10-30 已统一）：当前方向、主线、状态与任务以 [统一项目中心](docs/project/README.md) 为准。下文保留原阶段记录，其中数量、运行入口和完成结论需按现状复核。

# Malfoy Desktop 借鉴笔记（op7418/malfoy-desktop，2026-10-29 已 clone 到 ~/Documents/VScode/ref/malfoy-desktop）

> 本篇只讲**素材/视频生成**。**程序架构**（播放合成器、窗口交互、状态机、好感度、打包、测试）见 [MALFOY-APP-LESSONS.md](MALFOY-APP-LESSONS.md)。

> 同物种完整成品：即梦/Seedance 出视频 → 桌面融合 → Electron 壳。技术文档 503 行，全标实测值。
> 许可红线：代码 PolyForm 非商业；素材（视频/图/音乐）禁止再分发/再剪辑/商用。
> → 只学方法，素材必须自产（GPT 绿幕线），不得进商用产品。

## 直接可用的 4 条方法论（写入鲸鱼娘管线）

### 1. 锚点图原则（idle loop 视频生成的核心约束）
桌面动作片段（他叫 D 系列）**首帧 = 尾帧 = 同一张锚点图**，实测平均像素差 0.30–0.32（灰度 0–255）。
→ 小云雀提示词必须写死："start from this exact anchor pose, end in the same pose"，并附锚点图作参考。
→ 我们的小云雀 idle loop 动作词模板要加这一条，不然片段之间会跳。

### 2. 尾帧不播到最后一帧
即梦/Seedance 尾帧画质崩（blurdetect：首帧 696KB → 末帧 101KB 清晰度）。
→ 播放引擎：每段在 duration − 0.45s 起 0.45s 淡出到静止循环；淡出前切到对应场景循环。
→ LingDesk engine 要加这个逻辑（现在没有）。

### 3. 静止循环（idle 背景）做法
- 环境动态段（"她在动但环境也在动"）首尾 0.6s 交叉淡化做无缝循环（make-loop.sh）
- 局部动态（壁炉火光）：运动热图（逐像素时间标准差）找出除人物外唯一在动的区域 → 羽化遮罩叠加（make-ambient.sh，σ=60）
- 循环时长 4–5s；遮罩不能碰到人物，否则羽化边缘带出动作
- 场景列表可加权（沙发 [D8,D8,D9]：偶动 2/3 + 完全不动 1/3，更有生活感）

### 4. 响度规范
- 生成素材统一 −19 LUFS（loudnorm=I=-19:TP=-2:LRA=11 单遍，视频流 copy）
- 成片两遍 linear loudnorm → −15 LUFS / −1 dBTP / AAC 320k
- 即梦原声只有 −24 ~ −30 LUFS，直接叠 BGM 会全闷

### 其他值得抄的
- 语音识别词级时间戳：faster-whisper small.en int8 CPU；音乐下用 medium.en 且关 VAD
- whisper 在纯静音段会幻觉出 "Thanks for watching" → 静音检测过滤
- 特效贴图必须截自调色后的画面（HyperFrames snapshot --at 转场点−1帧），否则转场首帧跳色
- macOS 壁纸层：type:"desktop" 窗口点击被 Finder 接走 → 播放窗口和互动窗口分离（壁纸只播不交互，Esc/菜单切互动）
- Wallpaper Engine 无 H.264/AAC → 视频转 WebM(VP9 CRF30)+Ogg Opus，包体积 409→87MB
- 相册用 GPT-Image 出的"CCD 直闪照片"（4:3 白边相纸+自带日期戳），好感度解锁
- 好感度数字：日首次 +3 / 点她 +1（冷却45s）/ 首章 +10 / 解锁阈值 20/40/60

## 素材规格（2026-10-29 已从 v0.1.0 DMG 实测，不是推测）

解包路径：`Miss Malfoy.app/Contents/Resources/app/web/media/`（`asar: false`，素材直接躺在磁盘上）。
全部 **3840×2160 / h264 / yuv420p / 24fps**，9 条待机+动作合计 231MB，全量素材 408MB。

| 文件 | 时长 | 码率 | 用途 |
|---|---|---|---|
| ambient-sofa-a/b | 14.00s | 25.0 / 24.9 Mbps | 静止循环（D8/D9 处理后的成品） |
| ambient-sleep | 5.00s | 13.2 Mbps | 睡眠循环（静帧 + 火光遮罩） |
| ambient-armchair | — | 3.5MB | 扶手椅循环 |
| D1 | 8.10s | 39.3 Mbps | 入场 |
| D2 / D4 / D7 | 5.10s | 27.5 / 23.5 / 28.1 Mbps | 待机动作 |
| D3 / D5 | 6.10s | 27.7 / 41.3 Mbps | 伸懒腰 / 睡眠 |
| 1-1 ~ 1-4 | 1080P | — | 剧情正片 |

**1080p 重压实测**：`ambient-sofa-a` 4K 43MB → 1080p crf20 **3.9MB（1/11）**，肉眼无损。
桌宠小窗根本不需要 4K，这一条直接决定 dmg 大小。

## 实测推翻/修正的两条（2026-10-29，用 scripts/check_clip.py 量的）

1. **"锚点帧差 0.30–0.32" 复现不出来，实际约 3.5。** 原因查到了：锚点图是 **jpg（full range）**，
   视频帧是 **yuv420p（limited range 16–235）**，同一画面在两种色彩空间里亮度差约 **4.3/255**
   （anchor luma 53.47 vs D2 首帧 49.18，逐通道偏移 +1.7 ~ +5.5）。
   减去整体偏移后 MAE 从 3.46 掉到 1.91 —— 说明**姿势是对的，差的是色域**。
   → **对合成器是硬约束**：静帧层和视频层叠在一起做淡入淡出，会有 4/255 的亮度跳变，
   在暗部画面（这套素材 luma 只有 50）肉眼可见。静帧必须走同一色彩管线
   （转成 1 帧 mp4 交给 AVPlayer，或对 PNG 做亮度补偿），别直接把 jpg 塞进 CALayer。
2. **"尾帧画质崩" 在本套素材上不成立。** 拉普拉斯方差首帧/末帧几乎持平；
   文档里 696KB → 101KB 的差别是 **I 帧 vs P 帧的码率**，不是清晰度。
   但"不播到最后一帧"这条**依然要留**：理由不是防糊，是防**末帧姿势没回到锚点**
   （实测 D2 首尾差 2.23、D5 睡着首尾差 24.19 —— D5 本来就该停在睡姿，
   所以它用 `sleepEndAt: 5.0` 提前结束）。

## 待办
- [x] DMG 下载完 → 解包看素材实际规格（见上表）
- [ ] 把"锚点图+尾帧淡出"写进小云雀 idle loop 动作词模板（CHARACTER-SPEC-01）
- [ ] 锚点色域对齐进 `SceneController`（静帧层不能直接用 jpg）
- [ ] LingDesk engine 加尾帧 0.45s 淡出逻辑（开 Codex 任务）
