# 澜 · 鲸鱼娘桌面伙伴工作区

**唯一主开发目录：`/Users/exasdwyh/Documents/VScode/vidu/desktop-companion`。**
当前主线是 Swift / AppKit 的鲸鱼娘桌宠 `PetDesk`，打包名 `WhaleVideoCompanion.app`。

## 从这里开始

1. 进入 `desktop-companion/`，阅读 [项目入口](desktop-companion/README.md)。
2. 开发前读 [agent 约定](AGENTS.md) 和 [开发交接](desktop-companion/docs/DEVELOPMENT.md)。
3. 当前素材见 [素材索引](desktop-companion/docs/ASSETS.md)。

```bash
cd /Users/exasdwyh/Documents/VScode/vidu/desktop-companion
open dist/WhaleVideoCompanion.app
# 修改代码或素材后重新打包
bash scripts/build-whale-video.sh
```

## 工作区各部分

| 位置 | 定位 |
|---|---|
| `desktop-companion/` | 当前唯一桌宠开发主线，源码、素材、脚本、检查结果、应用输出都在这里 |
| `LiveTalking/` | 上游本地口型工程及 Python 环境；鲸鱼娘 Kokoro TTS 仍使用其 `.venv`，保留原位置 |
| `ai-live-avatar/` | 独立 Vidu 云端直播原型，非当前桌宠入口 |
| `research/`、`deliverables/`、`DESIGN.md` | 早期研究和方案，历史参考，不代表当前实现 |

截至 2026-10-29，此工作区和桌宠目录均未初始化 Git。当前 `.app` 是本机测试产物，不是独立安装包。
旧版入口说明保存在 `desktop-companion/docs/legacy/`。
