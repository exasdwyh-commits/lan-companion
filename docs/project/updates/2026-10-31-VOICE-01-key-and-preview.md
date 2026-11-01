# VOICE-01 · 翻唱升 K 与试听

日期：2026-10-31
状态：已完成，等用户试听确认

## 问题

用户反馈：「薛之谦的翻唱就很难听，可能要升 K 才行，所以还是要有试听，而且还要智能调整参数」。

之前管线里 `SHIFT` 硬编码为 `0`（`lib/cover-jobs.js`），也就是说**所有翻唱都按原调处理**。

## 根因（实测，不是猜）

Seed-VC 是 voice conversion，只换音色、不换音域。它把源人声的基频曲线原样搬过去，
所以男声原唱的音高会被完整保留到一个女声音色上。

《我好像在哪见过你》干声（`htdemucs` 分离后）实测：

| | p05 | p50 | p90 | p99 |
|---|---|---|---|---|
| 原唱（男高音） | 115 Hz | 232 Hz | 329 Hz | 423 Hz |
| 转换后（女声） | 105 Hz | 225 Hz | 310 Hz | 357 Hz |
| 参考音色 ref-sing-magnetic | 95 Hz | 163 Hz | 203 Hz | 280 Hz |

三件事同时成立，才导致「难听」：

1. **低音区下探到 115 Hz**，女声要唱实这个音是不可能的，只能挤成气声；
2. **中音区 232 Hz 上不去胸声厚度**，女声在这个位置没有力量；
3. **参考音色的音高不能当目标** —— ref-sing-magnetic 的 p50 只有 163 Hz，
   比原唱还低。参考只提供音色（speaker embedding），不提供音域。

顺带排掉一个误判：Seed-VC `inference.py` 里确实有 `auto_f0_adjust`，
但它做的是「把转换结果的音高整体对齐到源的中位数」，作用是**锁住源音高防漂移**，
不是适配女声音域。所以只开它没用，必须叠加 `semi_tone_shift`。

## 解法

### 1. 用低音区判调，不用中位数

`scripts/voice_range.py`：`pyworld.harvest` 提 f0，算分位数，按
**「把 p05 抬到女声实唱下界 165Hz」**给出半音数。

```
steps = round(12 * log2(165 / p05))     # 只在 p05 < 165 时计算
```

为什么不用中位数：薛之谦是男高音，p50=232 Hz 已经落在女声区间，
用它判会得出「不用升」。低音区才区分得开（男声 100~145，女声基本下不到 165 以下）。

**只升不降**：低音区已经在女声范围内就保持原调。每次升降都要让伴奏重新变调，
没必要的调整只会白牺牲伴奏音色；降调属于审美选择，留给用户手动。

实测推荐 **+6 半音**（`12*log2(165/115.2)=6.2`）。升完后 p50 落在 337 Hz（E4），
正是女声最舒服的位置。

### 2. 伴奏必须跟着一起变调

**这是之前管线里的一个真 bug**：`--semi-tone` 只作用于人声，
`no_vocals.wav` 原样混回去。一旦升 K，人声在 G 调、伴奏还在 C 调，直接跑调。

`scripts/sing_cover_file.sh` 新增 `shift_audio()`：

```
asetrate=44100*2^(n/12), atempo=2^(-n/12), aresample=44100
```

- ffmpeg 7.1 **没有编 rubberband**（`-filters` 里查不到），这是不引外部依赖的唯一选择
- 副作用是共振峰一起上移，升幅大时伴奏会变亮变薄
- 补偿：`highshelf -0.35dB/半音 @7k` + `lowshelf +0.3dB/半音 @120Hz`

实测升 6 半音后伴奏频谱重心 593.6 Hz → 678.1 Hz（+14%）。
纯变调理论值应是 +41%（839 Hz），补偿压掉了大部分「变刺」。
低频占比 47.5% → 37.8%，确实略薄，这是 `asetrate` 路线绕不开的物理事实。

> 踩坑：`aresample=resampler=soxr` 会抛
> `Requested resampling engine is unavailable`（这台 ffmpeg 没带 libsoxr），
> 整步失败。已改成内置 swr。

### 3. 试听

`PREVIEW_SEC=25` 时：

- `voice_range.py --pick-clip` 用 0.5s 窗 RMS + 片段长度平滑，找**整首最响的一段**
  （副歌）。试听挑主歌没有意义，音域窄、编曲薄，听不出问题。
- 从已分离的 stem 截 25 秒，产物和中间文件放进 `work/preview-<shift>/`，
  避免把整首的 `her.wav` 顶掉（同一首歌常常先试听再出整首）。
- demucs 产物共享，所以「换个参数再听一版」只需重跑转换那几步。

### 4. UI

娱乐页「让她学一首新歌」里新增：

- `音域 自动 · +6 半音` + 自动按钮，滑块停在推荐值上，备注给出推算依据
- 「试听 25 秒」/「再听一版」+「做整首」+「取消」
- 试听生成完**自动播放**（点这个按钮要的就是马上听一耳朵）
- 试听**不进曲库**：它是过程产物，可能被反复覆盖

## 改动文件

| 文件 | 改动 |
|---|---|
| `scripts/voice_range.py` | 新增。音域分析 + 升调推荐 + 试听片段定位 |
| `scripts/sing_cover_file.sh` | 自动定调、伴奏同步变调、`PREVIEW_SEC` 试听模式、幂等检查改 `-s` |
| `MALFOY-ENGINE/lib/cover-jobs.js` | `tune` 状态（自动/手动）、`runPreview()`、`previewAudio()`、解析 `[cover-shift]` |
| `MALFOY-ENGINE/main.js` | `preview` / `preview-play` / `tune` 三个 action |
| `MALFOY-ENGINE/web/live2d/composer.html` | 音域控件与三个按钮 |
| `MALFOY-ENGINE/web/live2d/composer.css` | 控件样式 |
| `MALFOY-ENGINE/web/live2d/companion-panel.js` | 推荐值渲染、滑块交互、`preview-done` 状态 |
| `scripts/render-panel-preview.js` | `PANEL_COVER=demo` 演示状态 + 滚动到控件 |
| `Tests/cover-jobs.test.cjs` | +7 项 |
| `Tests/cover-panel.test.cjs` | +3 项，桩补 `setAttribute` |
| `Tests/test_voice_range.py` | 新增 10 项 |

## 另一个真 bug

幂等检查原本用 `[[ -f ... ]]`。ffmpeg 失败时会留下 **0 字节**文件，
下一次重跑看到「文件存在」就跳过，然后混音阶段打不开输入，报一个和真实原因
完全无关的错误。全部改成 `-s`（存在且非空）。

## 验证

| 检查 | 结果 |
|---|---|
| `node --test Tests/*.test.cjs` | 93/93 PASS |
| 引擎 `node --test` | 149/149 PASS |
| `test_voice_range.py`（sing venv） | 10/10 PASS |
| 升调是否真的生效 | 源 p50=236.3 → 输出 337.8，比值 1.429 ≈ 2^(6/12)=1.414 |
| 伴奏频谱重心 | 593.6 → 678.1 Hz（补偿后，纯变调应为 839） |
| 片段位置一致性 | 两版都从 142.5s 起，可直接 A/B |
| 面板实拍 | `docs/integration-evidence/2026-10-31-voice-tuning.png` |
| `build-companion.sh` | payload 51/51 |

对比音频（同一段副歌，25 秒）：

- `docs/integration-evidence/2026-10-31-cover-shift0.m4a` —— 不升调（旧行为）
- `docs/integration-evidence/2026-10-31-cover-shift6.m4a` —— 升 6 半音（新推荐值）

## 没做 / 已知限制

- **伴奏变调的音质**：`asetrate` 会带走共振峰，升 6 半音时低频略薄。
  真要解决得上 rubberband（`--formant`），需要给 ffmpeg 加编译依赖。
  当前补偿 EQ 是折中。
- **没在真窗口点过**：离屏渲染只能证明静态版式，播放、拖动滑块、试听完成后自动播放
  都没在真实窗口里走一遍（这台机器锁屏）。
- **每首歌第一次仍要等 demucs 分离**（几分钟）。试听省掉的是转换那几十分钟，
  省不掉分离。后续可考虑「选完就后台预热分离」。
- 已入库的两首旧翻唱仍是 `shift=0` 的产物，需要重新生成才有音域修正。
