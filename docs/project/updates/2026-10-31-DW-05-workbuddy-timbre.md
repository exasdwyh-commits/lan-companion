# DW-05 翻唱音色迭代与整首成品（WorkBuddy，2026-10-31 02:00）

负责人：WorkBuddy 聊天（agent:workbuddy-chat-2026-10-31）。
承接 [P0 交付](2026-10-31-DW-05-workbuddy-p0.md)：翻唱已跑通，用户试听后
反馈「基本可以，但不够磁性，音色太尖，没有女歌手的唱功感」。本轮解决该问题并产出整首。

证据目录：[`benchmarks/2026-10-31-DW-05-workbuddy/`](../../../benchmarks/2026-10-31-DW-05-workbuddy/)

## 1. 第一次尝试：改参考音色 —— 失败，但留下了关键诊断

原参考 `qwen-reference.mp3` 只有 **3.74 秒 / 24kHz / 单声道**，而
`third_party/seed-vc/inference.py:280` 会把它截断到 `sr * 25`（25 秒），
即**只用了 15% 的可用信息量**。

新增 `scripts/make_svc_reference.py`：Qwen3-TTS VoiceDesign 合成 5 段带气息与
情绪的句子 → 逐段裁静音 → 拼成 24~32 秒 → 重采样 44.1kHz。
三套 instruct 分别强调磁性气声 / 温暖圆润 / 清冷但更厚。

**实测推翻了假设**（频谱重心，Hz）：

| 文件 | 质心 |
|---|---|
| 源人声（李佳薇） | **3503** |
| 旧参考（萌娘 3.7s） | 2916 |
| 我生成的「磁性」参考 | **3246** ← 比萌娘还亮 11% |
| 三版输出 | 2864 ~ 3012 |

结论：

1. **Qwen3-TTS 的 VoiceDesign instruct 控不住音色明暗** —— 写了
   "dark and velvety low-mid range"，输出的质心反而更高。对「暗/厚/磁性」
   这类描述词不敏感，**别指望靠描述词调音色**。
2. **Seed-VC 的输出音色主要由源人声决定**，换参考只有 ±5% 的偏移。

## 2. 第二次尝试：后处理频谱整形 —— 有效，已定稿

新增 `scripts/shape_vocal.py`，三档：`warm` / `rich` / `studio`。
三刀对着三个听感问题下：

- **削 4~6kHz** → 去刺耳的「尖」（人耳齿音敏感区）
- **抬 180~300Hz** → 加厚度与胸腔感，磁性的主要来源
- **抬 10~13kHz** → 补空气感，避免削完高频后发闷
- **`acompressor`** → 气息与咬字力度更稳定，即「唱功感」

实测：

| 版本 | 质心 Hz | 滚降 Hz | >4kHz 占比 | 包络相关 |
|---|---|---|---|---|
| 源人声（参照） | 3503.1 | 7768.8 | 0.54% | 1.0000 |
| baseline（旧 3.7s 参考） | 2924.8 | 5910.3 | 1.05% | 0.8331 |
| magnetic（仅换参考） | 2904.8 | 6291.2 | 0.26% | 0.8256 |
| +warm | 2726.8 | 5986.6 | 0.17% | 0.8091 |
| +rich | 2353.6 | 4625.9 | 0.11% | 0.7895 |
| **+studio（用户选定）** | **2577.7** | 5403.1 | 0.16% | 0.8126 |

**用户已确认 studio 档为定稿音色。**

## 3. 一个会毁掉判断的坑：整形把响度一起削掉了

削齿音的同时把瞬态峰值也削了 —— RMS 掉约 7dB（peak 0.99 → 0.44）。
**不补回来的话，混音后人声偏小，听感上「显得柔和」，但那是变小声了，
不是变磁性了，会直接误判。**

所以 `shape_vocal.py` 默认开启响度补偿：先空跑一遍测出掉多少电平，
再补增益（实测 +2.60 ~ +6.10 dB），与输入同电平后才混音。
**以后做任何 EQ 类处理都要补这一刀。**

## 4. 整首跑通：绕开 MPS 显存不足

整首 210.46 秒直接跑 Seed-VC 会崩：

```
Insufficient Memory (00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory)
device = Apple M5 Pro
```

原因：Seed-VC 自带的分片只覆盖语义特征，而 `inference.py:312` 的
`mel = mel_fn(source_audio...)` 是**整条**算的，长音频照样爆。

对策：在外层先切段，每段 ≤29 秒（正好落在它「不分片」的简单路径上）。
新增 `benchmarks/2026-10-31-DW-05-workbuddy/split-vocals.py`：
用短时能量在句间停顿处选切点，避免硬切产生咔哒声。

实测 8 段全部转换成功，拼接后 **210.43s（源 210.46s）**；
接缝处窗口跳变 0.00004 ~ 0.00026，远低于非接缝处的 95 分位 0.0708 —— **拼接基本无缝**。

### 顺带的提速发现

Demucs 分离在 **MPS 上只用 7 秒**（RTF 0.033），CPU 上要几十分钟。
已把 `DEVICE` 环境变量接进 `scripts/sing_cover_file.sh`（默认 cpu，整首跑传 `DEVICE=mps`）。

## 5. 管线改造

`scripts/sing_cover_file.sh` 现在是五步：

1. 取源
2. 分离（可 `DEVICE=mps`）
3. Seed-VC 换音色
4. **3.5 整形**（`SHAPE=studio|warm|rich|none`，默认 studio）
5. 混回伴奏

且**每一步都先检查产物是否存在**，存在就跳过 —— 整首要好几十分钟，
中途被打断时重跑同一条命令可以直接续上，不用从分离重新开始。

### 音色资产约定

- 说话：`assets/whale-video-test/voice/ref-vivian.wav`（清冷优雅，跟世界走）
- 唱歌：`assets/whale-video-test/voice/ref-sing-magnetic.wav`（磁性女声，32s）

**说话和唱歌刻意用不同音色**：说话是清冷的她，唱歌是更有磁性的一面。

## 6. 验证边界

已验证：

- 整首 8 段分片转换全部成功，拼接时长守恒（210.43 vs 210.46）
- 接缝跳变 <0.0003（低于非接缝 95 分位 0.0708）
- 整首人声质心 2720.9Hz，源 3631.8Hz（降 25%）
- 整首人声 vs 源人声包络相关 **0.8836**（节奏/时长未跑）
- 成品电平 mean -15.6 dB / max 0.0 dB（原曲 mean -13.5 / max 0.0，量级一致）
- 此前已验证：F0 相关 0.9936、等效移调 0.007 半音（整形未动音高）

**不能证明 / 未做**：

- **整首成品未做人耳试听** —— 客观指标不能替代耳朵，需用户确认
- 未走 App 入口的「制作 / 取消 / 播放」全流程
- 未重建 `dist/DeepWhale.app`
- P0-2 电子书原生文件对话框仍未验（需原生 GUI 操作）
- Node 回归仍有 2 项红，属他人 `narration.js` WIP，未改动

## 7. 产物清单

| 文件 | 说明 |
|---|---|
| `assets/whale-cover-test-20261030/cover-full-studio.m4a` | **整首成品**（3:30.46 / AAC 194kbps / 5.1MB） |
| `assets/whale-cover-test-20261030/cover-24s-studio.m4a` | 24 秒试听（用户已确认的音色） |
| `assets/whale-cover-test-20261030/full-work/` | 整首中间产物（in.wav / demucs / chunks / chunk-plan.json） |
| `scripts/make_svc_reference.py` | 长参考音色生成（多段拼接 + 裁静音 + 重采样） |
| `scripts/shape_vocal.py` | 人声频谱整形（三档预设 + 自动响度补偿） |
| `benchmarks/2026-10-31-DW-05-workbuddy/split-vocals.py` | 长音频静音点切分 |
| `benchmarks/2026-10-31-DW-05-workbuddy/compare-timbre.py` | 音色指标对比 |

原曲为**用户提供的本地文件**，未核实再分发许可（`source.json` 标注
`doNotPublish: true`），**不进任何公开发布包**。
