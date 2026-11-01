> 历史/专题资料（2026-10-30 已统一）：当前方向、主线、状态与任务以 [统一项目中心](docs/project/README.md) 为准。下文保留原阶段记录，其中数量、运行入口和完成结论需按现状复核。

# 桌宠架构路线（2D骨骼 → 世界模型）

> 2026-10-30 定稿。近端 2D 骨骼自由，远端接世界模型。

## 一、当前已跑通（基线）

| 模块 | 实现 | 状态 |
|---|---|---|
| 场景/素材 | malfoy 408MB 全套（场景/剧情/相册/BGM） | ✅ |
| 壳 | Electron（复用 malfoy 运行时） | ✅ |
| 大脑 | DeepSeek v4.1 池（magpie :3425，6 源自动切换） | ✅ 2.4s |
| 干活 | Hermes CLI（spawn，真执行） | ✅ 10-28s |
| 长期记忆 | ~/.smartcompanion/memory.jsonl | ✅ 验证通过 |
| 主动开口 | 空闲 8 分钟触发 | ✅ 验证通过 |
| 语音合成 | edge-tts + say 兜底（熔断） | ✅ |
| 语音识别 | faster-whisper :8090（常驻） | ✅ 0.7s/句 |
| 麦克风录音 | ffmpeg avfoundation | ⚠️ 缺 TCC 授权 |

## 二、阶段一：2D 骨骼自由（近期）

### 选型

| 方案 | 优势 | 劣势 | 结论 |
|---|---|---|---|
| **Live2D Cubism** | 生态最全；PSD 分层→网格变形；JS 运行时成熟；表情/口型/眨眼/视线有标准参数；Open-LLM-VTuber / AIRI 均验证 | 商用需授权（小规模免费） | **首选** |
| Spine 2D | 骨骼动画强，游戏向 | 表情/口型参数体系弱 | 备选 |
| 纯 Canvas 变形 | 零依赖 | 表现力差 | 不选 |

### 「骨骼自由」落地四步

1. **分层立绘**：PSD 拆 头发/前发/后发/眼白/瞳/眉/嘴/脸/身体/衣服/饰品（约 20-30 层）
2. **绑骨**：Cubism 里建变形器（Deformer）链 + 旋转器，形成"骨骼"
3. **参数化**：
   - `ParamAngleX/Y/Z` ← 鼠标位置 / 情绪
   - `ParamMouthOpenY` ← TTS 音频振幅（实时口型）
   - `ParamEyeLOpen/ParamEyeROpen` ← 眨眼定时器（3-6s 随机）
   - `ParamBodyAngleX` ← 呼吸正弦波
   - `ParamBrowLY/RY` ← 情绪
4. **情绪标签协议**：LLM 输出 `[emotion:happy]` / `[action:wave]`，渲染层解析后驱动参数或播放 Motion

### 与现有素材的关系

- **保留** malfoy 视频场景作为「环境层」（背景/氛围）
- **替换** 角色为 Live2D 骨骼角色（叠加在场景上）
- 好处：角色可做任意表情/动作，不再受预渲染视频限制

### 运行时
- `pixi-live2d-display`（Web/Electron 通用）
- 渲染层拿到：`setEmotion(name)` / `setMouthOpen(v)` / `lookAt(x,y)` / `playMotion(name)`

## 三、阶段二：世界模型（远期）

### HY-WorldPlay（HY-World 1.5）现实评估

**它是什么**：流式视频扩散世界模型，480P 图生视频，实时交互 + 长期几何一致性。5B（WAN 基座）/ 8B（HY Video 基座）。

**依赖**：Qwen2.5-VL-7B 文本编码器 + ByT5 + Glyph-SDXL-v2

**关键判断**：
- ❌ **本地 64GB Mac 跑不了实时**（需大显存 GPU，视频扩散模型）
- ✅ 三条可行路径：
  1. **云端 API**：腾讯混元 3d.hunyuan.tencent.com
  2. **租 GPU** 跑蒸馏版（4 步推理）
  3. **HY-World 2.0** 做**离线静态 3D 场景**生成（非实时）

### 定位建议（重要）

**世界模型负责「世界」，不负责「角色」。**

```
世界层（世界模型/视频）  ← 场景、天气、时间、环境变化
        ↑ 背景
角色层（2D 骨骼）        ← 永远可控、低延迟、便宜
```

理由：
- 世界模型出帧慢（即使蒸馏版），角色不能跟着卡
- 角色是情感载体，必须 100% 可控（表情/口型/动作）
- 分层后，世界模型可以异步生成/切换，不影响角色流畅度

## 四、目标架构

```
[语音输入]  whisper :8090  ─┐
[文字输入]  聊天条          ─┤
                            ↓
                    [大脑层]
              ┌─────────────┴─────────────┐
        闲聊（快）                    干活（真执行）
    DeepSeek v4.1 池              Hermes CLI（工具）
              └─────────────┬─────────────┘
                            ↓
              [情绪/动作标签解析]
                            ↓
                    [表现层]
              ┌─────────────┴─────────────┐
        角色层                        世界层
   Live2D 2D 骨骼                 视频场景 / 世界模型
   表情·口型·视线·动作            场景切换·氛围
              └─────────────┬─────────────┘
                            ↓
                   [TTS] edge-tts / say
```

## 五、下一步优先级

1. **麦克风授权**（你点一次系统弹窗）→ 语音输入闭环
2. **Live2D 角色层**（需要一张分层 PSD 立绘）
3. 情绪标签协议（LLM 输出 → 渲染层）
4. 屏幕视觉（她能看你屏幕）
5. 世界模型接入（云端 API 先行）

## 六、参考项目

| 项目 | 可抄的点 |
|---|---|
| [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | Live2D 参数驱动、语音打断、看屏幕、主动说话 |
| [AIRI](https://github.com/moeru-ai/airi) | 角色卡、长期记忆、MCP 工具、游戏智能体 |
| [HY-WorldPlay](https://github.com/Tencent-Hunyuan/HY-WorldPlay) | 世界模型（远期环境层） |
| xiaoya_girlfriend | HF 实时语音管线、工具链、Qdrant 记忆 |
| Firefly-Companion | 关系状态、权限受控工具 |
