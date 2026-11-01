# LIVE2D-POC-01 · Live2D 对照小样（内部）

- 日期：2026-10-31
- 负责人：Hermes 002 / 本聊天（子 agent 搭建 + 主聊天实测）
- 方案与规格：[LIVE2D-POC.md](../LIVE2D-POC.md)

## 交付内容

- `assets/live2d-poc/`：vendor 三件套（pixi 7.4.2 / cubismcore / RaSan147 cubism4 v0.5.0-ls-8）+ Hiyori 官方示例模型，**仅内部测试、不进构建 payload**。
- `MALFOY-ENGINE/web/live2d/live2d-poc.{html,js}`：透明画布、居中 95%、追视、点击 TapBody、18s 随机 Idle、`window.__poc` 状态探针、失败红字提示。
- `docs/project/LIVE2D-POC.md`：澜 26 层分层原画规格、授权边界、与现版图集方案的对照验收清单与决策门槛。

## 验证证据

- 文件：vendor 三件 456K/207K/155K（非 HTML 报错页）；Hiyori `.model3.json`/`.moc3`/motions 齐全；`node --check` 通过。
- **浏览器实测（本机 harness Chromium）**：页面加载 Hiyori 成功，`window.__poc.loaded === true`，模型 279.7×392.4 px 渲染，追视/动作代码路径在跑；截图留档 `benchmarks/2026-10-31-CHIBI-02/walk-render-fixed-canvas.png` 同批次。

## 限制与待验

- `__poc.params.*` 读值为 null：`core.getParameterIndex` 访问方式与该 Cubism Core 版本不匹配，参数探针待修（不影响加载/渲染结论）。
- 本 POC 未接 TTS 口型、未接摸头事件、未做 CPU/帧率采样；对照验收按 LIVE2D-POC.md 清单等澜的真实分层模型到位后再做。
- Cubism Core CDN URL 未锁版本；产品化前固定版本并记哈希。
