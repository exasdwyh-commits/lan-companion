# 壳的决策：只留一套（Electron），另一套标 deprecated

> 2026-10-30 · 整合时定案

## 结论

| | 用哪套 | 状态 |
|---|---|---|
| **桌宠主体** | `MALFOY-ENGINE/`（Electron）+ `dist/DeepWhale.app` | **唯一主线** |
| Swift / PetDesk | `Package.swift`、`Sources/`、`dist/WhaleVideoCompanion.app`、`scripts/build-whale-*.sh` | **deprecated，不删、不再改** |
| 旧 `SmartCompanion.app` | 同一套 Electron 引擎的旧壳（bundle id 还是 `demo.missmalfoy.desktop`） | **保留为母体/回滚点** |

## 为什么选 Electron 这套

智能层全在这边，而且已经实测跑通：三态窗口、Qwen3-TTS 双音色、DeepSeek 6 源池、
长期记忆 + 用户画像、情绪标签、Hermes 干活模式、CGWindowList 爬窗。

Swift 那套是 `PetDesk`——视频播放器 + 状态机，**没有智能层**：没有对话、没有记忆、
没有 TTS。要用它就得把上面整套重新实现一遍，纯亏。

## deprecated 怎么标

- 不删任何文件（用户硬约束：只增不删）。
- 新增本文件作为唯一说明；`Sources/`、`Package.swift`、`README.md`、`AGENTS.md`
  保持原样不动 —— 这几个文件在这台机器上有 open() 永久挂起的已知问题，
  连读都不该读，更不该改。
- `AGENTS.md` 里「唯一主线 = build-whale-video.sh / dist/WhaleVideoCompanion.app」
  这段描述从今天起作废，以本文件为准。

## 新主线怎么跑

```bash
bash scripts/build-companion.sh          # → dist/DeepWhale.app（bundle id com.koudouma.deepwhale）
open dist/DeepWhale.app
```

引擎源码改在 `MALFOY-ENGINE/`，改完重跑上面那条命令即可；不要再手改
`*.app/Contents/Resources`。详见过渡说明见 `INTEGRATION-REPORT.md`。
