# WORLD-SCENE-01：四段用户视频接入现有真人世界

日期：2026-10-31。负责人：Codex / 当前聊天。

## 用户能看到的触发方式

- **日常房间**默认进入原待机。点击真人角色，播放 4 号掌心动作一次，然后回到待机。
- 日常房间累计闲置 **60 秒**，播放 6 号低头抬眼近景一次，然后进入原有趴屏循环。任何互动会重置闲置计时。
- 鼠标移到窗口顶部显示控制条，点击**月夜房间**，播放 5 号完整场景循环；点击**返回日常**回到原日常待机。
- 月夜场景中才显示**祈愿**按钮。点击后播放 7 号完整镜头一次，结束回到月夜循环。
- 月夜场景没有单独的触摸/睡眠素材；点击角色不跳到日常镜头。原有暂停、收起和角色布局保留。

## 实现

复用 `MALFOY-ENGINE/web/live2d/world-video.js` 原双 video 播放器、解码就绪切换和 generation token；没有加第二套播放器。

- Player 增加 `scenes`、场景级 clip/layout、场景切换和一次性 cue；切场景时取消迟到加载，锚点跟场景切换。
- `world.html` 顶部工具条增加“月夜房间/返回日常”和条件显示的“祈愿”。角色点击仍从原 poke 流程进入 Player。
- 4/6 通过本批次专用绿色键控输出 VP9 alpha，原文件和声轨都留在 `originals/`。角色边缘仍有轻微杂边，当前按真人完整近景用法接入，不宣称无瑕抠像。
- 5 保留视频编码，仅去掉音轨；7 以完整场景播放，保留画面中的床沿。视频元素静音，避免与 TTS/聊天声音重叠。
- `prepare-world-video.py` 从 assets 真源生成所有旧/新媒体、两套锚点、`config.js`、`manifest.json` 及开发副本。构建仍只复制 `assets/whale-world-web-v1`。
- `check-world-payload.py` 增加四段候选原片→派生→app 包 SHA256、清单哈希、场景引用与两个锚点检查。

## 素材来源与范围

用户提供的 (4)～(7) 视频副本位于 `assets/whale-world-candidates-2026-10-31/originals/`；下载原件未修改。派生在同目录 `derived/`，播放器媒体在 `assets/whale-world-web-v1/`。复现命令：

```bash
python3 scripts/prepare-world-candidates.py
python3 scripts/prepare-world-video.py
```

这批素材标有豆包生成信息，实际账号与对外再分发授权未核实；已保留原片，不据此宣称可以公开发行。

## 验证状态

| 层级 | 结果 |
|---|---|
| 原片与派生 | 四条源/派生均完整解码；生成的 alpha 视频可解码；检查图见 `assets/whale-world-candidates-2026-10-31/previews/encoded-review.jpg` |
| 播放接线 | 静态源码可见上述按钮/触发映射与现有生命周期复用 |
| 构建 / payload / 签名 | `bash scripts/project.sh build` 完成；候选视频、场景锚点及运行时代码 payload 59/59 一致，素材来源哈希通过，ad-hoc 代码签名有效；固定产物 `dist/DeepWhale.app` |
| 原生窗口实际切换、点击、闲置触发 | 未对新构建的 world 页面做原生点击验收：构建前已有旧版本进程运行，当前只显示对话窗。没有为验证而强制重启；用户重新打开新包后可按上表触发 |
| 视觉限制 | 4/6 绿幕边缘可见少量残留；5/7 是完整画面素材，7 保留床沿 |

## 文件范围

- `MALFOY-ENGINE/web/live2d/world-video.js`
- `MALFOY-ENGINE/web/live2d/world.html`
- `scripts/prepare-world-candidates.py`、`scripts/prepare-world-video.py`、`scripts/check-world-payload.py`
- `assets/whale-world-candidates-2026-10-31/`、`assets/whale-world-web-v1/`
- `docs/project/TASKS.md`、`STATUS.md`、`ASSETS.md`、`CHANGELOG.md`
