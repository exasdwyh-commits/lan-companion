# 澜 · 双世界桌面伙伴

**统一项目中心：[docs/project/README.md](docs/project/README.md)。所有 agent 的方案、任务和改动汇总到这里。**

方向：真人女主世界 + Q 版桌面神识，Qwen3-TTS 清冷/活泼双音色，共享记忆、陪伴、读书、唱歌与 agent 工作。首版免费、非营利、拟开源。

## GitHub 源码快照

当前公开仓库：[exasdwyh-commits/lan-companion](https://github.com/exasdwyh-commits/lan-companion)。包含源码、小屋与桌面运行素材；不含本机App、权重、个人数据和大原片。当前仍依赖本机运行环境，**不代表已完成独立构建或安装包发行**。查看、同步和许可边界见 [GitHub说明](docs/project/GITHUB.md)。

## 开始开发

1. 读 [工作区约定](AGENTS.md) 与 [产品定义](docs/project/PRODUCT.md)。
2. 查 [现状](docs/project/STATUS.md)，在 [任务表](docs/project/TASKS.md) 领取任务。
3. 按 [开发与验收](docs/project/DEVELOPMENT.md) 工作，结果登记 [交付记录](docs/project/CHANGELOG.md)。

```bash
cd /Users/exasdwyh/Documents/VScode/vidu/desktop-companion
bash scripts/project.sh status   # 只读盘点
bash scripts/project.sh check    # 文档、入口、配置与 JS 语法
bash scripts/project.sh build    # 本机 Electron 构建，依赖 SmartCompanion.app 母体
bash scripts/project.sh run      # 打开现有 DeepWhale.app，不自动启动模型
```

| 工程 | 当前职责 |
|---|---|
| MALFOY-ENGINE/ → dist/DeepWhale.app | 后续唯一双世界集成主线，已有三态窗口、聊天、双音色配置与记忆/工作接口 |
| Sources/PetDesk/、CompanionCore/ → dist/WhaleVideoCompanion.app | 已有视频状态机、20 张已接相册、1 章/6 镜头图文剧、2 首登记歌曲等迁移成果和回归基线 |
| Sources/LingDesk/、其他 App | 旧路线或实验 |

计数为 2026-10-30 快照；动态现状用 status 核对。**Swift 包内存在不等于 Electron 当前入口已可用。**

Swift 基线构建：`bash scripts/project.sh reference-build`。

原资料保留原路径并加历史标记；整理前文档见 [备份](docs/legacy/2026-10-30-before-unification/INDEX.md)。查找旧成果见 [资料索引](docs/project/ARCHIVE.md)。
