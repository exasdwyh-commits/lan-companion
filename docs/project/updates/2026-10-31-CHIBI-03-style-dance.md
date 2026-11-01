# CHIBI-03 · Q 版画风升级 + 巴西顺拐舞

- 日期：2026-10-31
- 负责人：Hermes 002 / 本聊天（agent:hermes-002-2026-10-31）
- 触发：用户提供卡通参考图，要求"升级到这个卡通级"并增加巴西顺拐舞搞怪状态。

## 交付内容

1. **画风升级（走路/舞蹈先行）**：用户参考图 + v2 身份立绘拼合为双参考，agnes i2i 生成新画风四张图集（`assets/whale-chibi-style-v1/`）：walk 6 帧、dance 8 帧、poses 16 姿态、facebase 无五官底。四张均一次生成通过结构 QC。
2. **巴西顺拐舞状态**：`chibi-performance.js` 新增 `dance` 场景与事件（优先级 35，7 秒，低于 surprise/任务反馈、高于普通触摸；业务活动不放舞）；`chibi-renderer.js` 新增 `loadDance/renderDance`（复用走路四边形通路，独立贴图与缓冲）；`world.html` 加载 `ChibiDance` 并传 `danceEnabled/danceFrames`；无舞蹈图集时事件降级为开心姿态。预览页新增「巴西顺拐舞」按钮与轮播段。
3. **走路换肤**：prepare 优先采用 style-v1 走路图集（CHIBI-02 的 whale-chibi-walk-v1 保留为回退真源）。
5. **顺拐舞哼唱**：本地合成 7.67s 嘉年华风「啦啦啦」哼唱循环（`assets/whale-chibi-style-v1/dance/hum.{wav,m4a}`，132BPM 切分、正弦+谐波+颤音音色、峰值 -2.7dB），prepare 内嵌进 `chibi-dance.js` 的 `audio` 字段；`chibi-hum.js` 纯逻辑控制器（入舞播放/出舞停止/说话让位恢复/无音频或减少动态不播），world 渲染层 Audio 循环播放。未动 main/preload；与主进程音频调度的统一仲裁留给 DW-05。
4. **poses/facebase 暂存**：16 姿态新画风已生成入库但**未接线**——performance 图集经 rig 网格映射需要每帧 layout+face 锚点标定，直接替换会姿态错位；标定列为后续项。

## 验证证据

| 项 | 结果 |
|---|---|
| 生成 QC | walk 6 格蓝 56-70% 行内对齐；dance 8 格蓝 53-61%、高度全 479；poses/facebase 16 格全有内容蓝 54-79% |
| `Tests/chibi-dance.test.cjs` | 8/8（含哼唱控制器）|（含降级、优先级、减少动态、到期回退）|
| 全量回归 | **299/299** |
| `prepare --check` | PASS + walk atlas + dance atlas |
| 构建 | 重建 DeepWhale.app，包内含 chibi-walk.js/chibi-dance.js 且与源一致 |

## 限制与待验

- **App 内观感未人眼验收**（当日视觉模型不可用，harness 浏览器对重型页面不稳）：请用户在预览页点「巴西顺拐舞」/看漫游走路，确认新画风满意度与顺拐舞喜感。
- 顺拐的"同侧手腿"由提示词约定（8 帧两两交替），具体是否顺拐成梗需人眼定夺，不成可只改提示词重生成（单张 1 次过的成本很低）。
- 走路/舞蹈期间独立面部层暂停（整帧美术）；16 姿态新画风切换待锚点标定（后续项）。
- 用户风格参考图的再分发许可未核实，公开发行前逐件确认。
