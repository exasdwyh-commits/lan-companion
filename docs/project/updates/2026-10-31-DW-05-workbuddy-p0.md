# 2026-10-31 · DW-05 · WorkBuddy 续跑：真实翻唱通了

## 归属

- WorkBuddy 聊天（2026-10-31，agent:workbuddy-chat-2026-10-31）；任务 [DW-05](../TASKS.md)。
- 接手自 [接手单](../WORKBUDDY-HANDOFF.md)、[Codex 上一轮记录](2026-10-31-DW-05-chat-media.md)。
- 沿用 Electron 主线、同一舞台与播放器；保留 DW-01～04 全部改动。
- 负责文件：`scripts/sing_seedvc.py`、`Tests/companion-windows.test.cjs`、
  本轮 `benchmarks/2026-10-31-DW-05-workbuddy/`、本文档及 STATUS/TASKS/CHANGELOG 对应条目。

## 完成内容

### 1. 定位并修掉真正卡点：Seed-VC 在 MPS 上的 float64 崩溃

翻唱一直「停在人声分离之后」，交接单判断为「进程存活未知、可能卡住」。
实查是 **Python 抛异常退出**：

```
File "third_party/seed-vc/inference.py", line 329, in main
    F0_ori = torch.from_numpy(F0_ori).to(device)[None]
TypeError: Cannot convert a MPS Tensor to float64 dtype as the MPS
           framework doesn't support float64.
```

RMVPE 输出的 F0 是 float64，MPS 不支持该 dtype。上游 `app_svc.py:298`、
`seed_vc_wrapper.py:386` 同样位置都写了 `.float()`，只有 `inference.py` 漏了。

修复：在 `scripts/sing_seedvc.py` 新增 `patch_mps_float64()`，把「目标是 MPS
且当前为 float64」的张量先转 float32 再搬运。**不改第三方源码**（避免升级丢失），
沿用该文件已有的运行期补丁风格。精度足够，**不改变默认音高**。

### 2. 避免重复大任务：复用已跑完的分离结果

实查 `short-work/demucs/htdemucs/in/{vocals,no_vocals}.wav` 均完整
（24.00s / 44.1kHz 立体声）。上轮第二轮是重复跑分离时被中断。
本轮直接接第 3 步，未重跑 Demucs。

### 3. P0-3 服务排查结论

本机 ollama 之前**未启动**（launchd 服务，被 `ollama list` 唤起后即在线）。
网关 magpie 现在也正常。实测：ollama 兼容端点 2.14s、原生端点 3.80s、
Qwen3-TTS 1.06s，均真实返回。local27b（18434）返回 502，不可用。

### 4. 修掉 6 项测试回归

`Tests/companion-windows.test.cjs` 的 vm 沙箱缺少 `synthesizeScript` 替身
（main.js 定义在第 478 行，落在切片之外，而 633 行会引用）。
按该文件既有模式补注入，**只改测试，不动产品代码**。回归 97/105 → 103/105。

## 可试听 / 可查看产物

| 类型 | 路径 |
|---|---|
| 翻唱成品（24 秒） | `assets/whale-cover-test-20261030/cover-24s-svc.m4a` |
| 转换后人声（中间产物） | `assets/whale-cover-test-20261030/work-retry-01/her.wav` |
| 证据目录 | `benchmarks/2026-10-31-DW-05-workbuddy/` |
| 当前 App | `dist/DeepWhale.app` |

## 验证证据

| 命令或实际操作 | 结果 | 证据 | 范围 |
|---|---|---|---|
| `python scripts/sing_seedvc.py --singing ... --steps 30` | PASS，30/30 步 / 23s / RTF 1.66 | `benchmarks/.../README.md` | 真实模型 + 用户真实原曲 |
| ffmpeg 混回伴奏 → m4a | PASS，24.009s / AAC / 193kbps | 同上 | 真实解码 |
| `verify-cover.py`（响度/包络/音色） | PASS | `cover-metrics.json` | 客观指标，非听感 |
| `verify-pitch.py`（RMVPE F0） | PASS，相关 0.9966 / 移调 0.001 半音 | `pitch-metrics.json` | 客观指标 |
| ollama /v1/chat/completions | PASS，2.14s | 会话输出 | 真实服务 |
| Qwen3-TTS /tts | PASS，1.06s | 会话输出 | 真实服务 |
| `node --test Tests/*.test.cjs MALFOY-ENGINE/test/*.test.js` | 103/105 | 会话输出 | fixture + 逻辑 |
| `bash scripts/project.sh check` | 88/88，错误 0，待办 8 | 会话输出 | 静态检查 |

未执行：电子书原生文件对话框操作、App 入口制作/取消/播放、整首翻唱、人耳试听。

## 剩余工作与交接

1. **等用户试听** 24 秒成品（交接单验收顺序的明确关卡）。
   试听通过后：
   - 跑整首原曲；
   - 通过 App 入口走一遍「打开原曲 → 制作 → 阶段反馈 → 取消 → 成品播放」。
2. **P0-2 电子书原生打开**未验，需原生文件对话框操作；
   若窗口遮挡，先查 `dialog.showOpenDialog` 的父窗口/焦点接线，不要另加 Web 选择路线。
3. **2 项阅读测试仍红**，属 `lib/narration.js` 在飞的改动（分段上限 120 → 200）。
   需负责人裁定是改断言还是改分段；我没有动 `narration.js`。
4. **并发写入待确认**：00:21～00:27 有本会话以外的写入者改了
   `MALFOY-ENGINE/lib/{narration,voice-script,companion-media}.js`、
   `test/{voice-script,companion-media}.test.js`、`lib/read-ebook.py`。
   按 AGENTS.md 单写入负责人规则，这些文件我未触碰。
5. 已更新 STATUS / TASKS / CHANGELOG。本轮未提交、未推送、未重建 .app。
