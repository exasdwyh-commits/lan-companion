# 澜 · 鲸鱼娘桌面伙伴

**这里是最终统一开发位置：`/Users/exasdwyh/Documents/VScode/vidu/desktop-companion`。**
当前产品是 `PetDesk` 原生 AppKit 桌宠，运行入口为 `WhaleVideoCompanion.app`。

## 启动与构建

```bash
cd /Users/exasdwyh/Documents/VScode/vidu/desktop-companion
open dist/WhaleVideoCompanion.app
# 源码、character.json、pack.json 或素材修改后：
bash scripts/build-whale-video.sh
```

重新构建后退出旧进程，再打开上述应用，才能加载新包。`dist/` 是构建副本，源码和素材从本目录修改。

## 当前已接入

- 文字聊天、聊天面板、可配置模型连接。
- 背景与透明人物分层，背景替换、人物拖动缩放。
- 点击撒娇视频与待机锚点衔接、好感度、来访记录。
- 约 60 秒无操作切到趴屏陪伴，约 300 秒切到床上睡眠；计时检查存在间隔。
- 右键“趴着陪我”“让她休息”，点击睡眠场景或打开聊天唤醒；隐藏暂停播放。
- 当前角色语音为开源 Kokoro MLX，`zf_xiaoni`；失败时回退系统语音。
- 26 张「澜 · 二十六景」收藏壁纸：日常、四季、幻想与换装主题；4 张初始开放，其余随好感度解锁，相册支持滚动、大图和保存壁纸。

## 其他 agent 从这里接手

| 文档 | 内容 |
|---|---|
| [开发交接](docs/DEVELOPMENT.md) | 文件职责、依赖、检查命令、数据路径、验证边界和后续优先级 |
| [素材索引](docs/ASSETS.md) | 当前生效素材、原片、生成参考图、重建脚本 |
| [工作区约定](../AGENTS.md) | 唯一主线和多人开发规则 |
| [素材包说明](assets/whale-video-test/README.md) | 配置与运行素材入口 |

## 当前限制

睡眠使用完整场景视频，尚无躺下/起身过渡；趴屏人物仍有发丝绿边。语音不会驱动嘴型，麦克风输入、视觉感知未接入；剧情内容仍为空。相册新增内容为静态壁纸，舞蹈、亲亲等主题尚无对应动态视频。应用仍依赖本工作区的 Python 环境与本机模型缓存，尚非独立分发版本。

`dist/LingDesk.app` 为另一套口型客户端，`dist/PetDesk.app` 为马尔福测试入口，`dist/DeepseaCompanion.app` 为早期静态形象样板，均不是当前默认入口。旧说明见 `docs/legacy/`。
