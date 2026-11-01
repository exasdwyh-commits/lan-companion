# vidu 工作区

当前可运行主线是 **LingDesk 本地桌宠 + LiveTalking 口型引擎**。
另有独立的 Vidu 云端直播控制原型。

| 目录 | 职责 | 当前边界 |
|---|---|---|
| `desktop-companion/` | macOS 桌宠、聊天、素材导入、口型视频播放 | 依赖工作区运行，尚非独立安装包 |
| `LiveTalking/` | 本地 MuseTalk / wav2lip 推理与网页原型 | 需要已准备的权重与角色资产 |
| `ai-live-avatar/` | 云端直播控制、调度、工作台与空跑 | 本次未验收真实 Vidu 生成和直播 |

## 本地桌宠

```bash
cd desktop-companion
open dist/LingDesk.app
```

口型桥会自动拉起缺失的引擎。本地 LLM 服务需先启动，模型名在桌宠设置中对齐实际模型。
`python3 scripts/doctor.py` 可检查环境；`bash scripts/build.sh` 可重新构建应用。

默认使用 macOS 系统语音 `saytts + Tingting`。显式选择 `edgetts` 会使用联网语音服务；
首次模型准备和下载也需要网络。不能把所有 TTS 模式统称为“全程不出网”。

素材可以只含一张正面人像。通过 `character.json` 绑定同一个说话形象，避免导入后串角色。
完整说明见 [桌宠 README](desktop-companion/README.md)。

## 当前验证（2026-10-29）

已验证本机两音色真实口型生成、生成中取消、Swift 桥重连/故障恢复和 Python HTTP 回归。
实测短句两次各约 8.7 秒出片，生成中取消约 0.1 秒。测量条件与后续聊天验收记录见
[修复记录](desktop-companion/benchmarks/fixes-2026-10-29/REPORT.md)。

桌宠与网页原型现在共用 `desktop-companion/scripts/engine_bridge.py` 出片，
`LiveTalking/make_clip.py` 是调用入口，`_mac_port/` 下同名文件是历史快照。

尚待产品接入：语音输入、表情控制、桌宠直播推流。现有视频文件可播放不等于视觉自然度或商用验收。
上游 demo 形象仅作本地技术测试，实际发布前应准备有授权的素材。

## 云端工作台

```bash
cd ai-live-avatar
.venv/bin/python server.py
```

入口为 `http://127.0.0.1:28900/workbench`。2026-10-29 检查中 39 项测试通过，
验证范围是本地测试与空跑；本次未调用收费生成接口。
实际价格、平台直播规则、素材和声音授权需在上线前按当前官方信息核实。
