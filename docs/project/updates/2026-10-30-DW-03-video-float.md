# DW-03 视频模式恢复与独立悬浮对话

负责人：Codex / Q 版动作同一聊天。日期：2026-10-30。范围为 DW-03 的视频与窗口阶段；相册、剧情仍待迁移。

## 用户决定与根因

用户反馈当前像全屏，要求恢复昨天的视频模式，把打字/说话放进独立小悬浮入口。确认 `openStage` 的 world 与 desktop 原来都用整屏 bounds，启动还默认创建壁纸；原 PetDesk 的完整待机/趴屏/睡眠链和素材存在，当前 world 页面却只播放旧 idle-smile。

## 本次实现

- 主线仍为 `MALFOY-ENGINE → dist/DeepWhale.app`，没有另建播放器工程或退回 Swift 产品。
- 真人 world 默认 **640×360**，可拖动顶栏、保持 16:9 缩放；禁止最大化和原生全屏，打开时用 `showInactive`。屏幕工作区较小时收敛到可见范围。Q 版保留整屏透明绘制面，角色和控制命中才取消空白穿透。
- 壁纸改为托盘的显式选项；只作背景并忽略鼠标。收起角色会隐藏/暂停场景，保留独立聊天图标；同一形态再次打开恢复窗口和播放位置。跨形态重建场景会重置该视频状态；位置调整目前仅当前场景会话保留，不承诺跨重启保存。
- 恢复 **正常待机 → 点击完整触摸 → 待机**，**60 秒趴屏 → 300 秒整场景床上睡眠**，点击唤醒；顶栏和托盘可主动选平常/趴屏/睡眠，顶栏另有暂停/继续和人物左右/大小调整。隐藏、暂停、聊天/录音不计入闲置时间。
- `world-video.js` 在原 `world.html` 内管理双视频槽：新片有可解码帧才替换，触摸在短待机循环边界切入、播完返回；异步旧加载不能盖掉新状态，坏片保留旧画面并显示错误。静态人物降级保留。
- 独立 `composer.html/js`：64px 窗口中显示 50px 圆按钮；拖外圈移动，点击展开 340×440 对话框，拖顶栏移动，收起保持草稿和未完成回复。`⌥⌘J` 开关对话。Enter 发送，Shift+Enter 换行，中文输入法确认不误发。
- 复用主进程聊天、SESSION 和 Qwen3 双音色，不传 renderer 的旧历史覆盖共享会话；启动消费 `character:session`。麦克风按钮显式录音 4 秒，STT 结果进草稿，确认发送；录音单飞，错误会显示，未自动录音或看屏幕。调用现有 `findFfmpeg()`，补主包麦克风用途说明。
- 主进程原来推送 `audio`，world 读取 `voice`，现统一推送 `voice`。**角色舞台是聊天唯一播音者**，聊天窗只渲染 IPC 返回文本；兼容嵌入输入的返回值带 `deliveredToStage` 避免重复播放。合成期间换形态或隐藏，旧形态音频被抑制；晚到旧回答继续遵循 DW-02 序号仲裁；超时请求在模型或合成完成后不再补播（底层 HTTP 请求仍可能继续到自身超时）。此处不等于 DW-05 歌曲/阅读音频仲裁完成。

## 素材与构建

- 保留 `assets/whale-video-test` 原片。从 character.json / pack.scene.touch 读取映射，派生到 `assets/whale-world-web-v1`；manifest 登记原件和派生 SHA256。source world-media 是生成副本，已忽略入库。
- 待机/触摸为 880×660 VP9 alpha，趴屏为 960×540 VP9 alpha，床上睡眠为 960×540 VP9 整场景；连同原背景及配置约 14.4MB。ffmpeg 完整解码 4/4，三个透明片 alpha 抽样均有 0–255 值；检查了原片与派生合成抽帧。
- 构建改为 dist 临时包 → 签名严格验证 → 29 项字节与素材来源校验 → 备份旧包 → 替换唯一主包。失败不先删唯一产物；替换失败尝试回滚。仍依赖 SmartCompanion.app 母体，不代表独立分发完成。
- 产物固定：[DeepWhale.app](../../../dist/DeepWhale.app)。未终止或重启用户当前进程，运行中的旧窗口不会自动更新。

## 验证及证据

工作目录 `/Users/exasdwyh/Documents/VScode/vidu/desktop-companion`：

```bash
node --test Tests/world-video.test.cjs Tests/companion-windows.test.cjs Tests/composer.test.cjs Tests/reply-delivery.test.cjs MALFOY-ENGINE/test/*.test.js
node Tests/chibi-motion.test.cjs
node Tests/chibi-performance.test.cjs
node Tests/chibi-face-presence.test.cjs
bash scripts/project.sh check
bash scripts/build-companion.sh
python3 scripts/check-world-payload.py dist/DeepWhale.app
codesign --verify --deep --strict dist/DeepWhale.app
```

- 新增 24 项行为检查 + 原 37 项存储/身份检查，通过；Q 版 30 项动作/面部/出入逻辑回归，通过。
- 模拟 Electron 检查实际 main 窗口/IPC 编排：启动尺寸、不强制聚焦、独立图标、切形态保留聊天、命中发送者限制、隐藏恢复、录音单飞、视频命令等待窗口加载。模拟视频检查解码就绪、循环切入、完整动作、过期加载、失败保留、暂停/可见性；模拟 DOM 检查草稿、IME、会话及无重复播音。这些都没有打开真实浏览器或原生窗口。
- 工程静态检查 83/83；包内 29/29 字节匹配、原素材来源匹配、签名有效。
- 证据统一在 [本轮目录](../../../benchmarks/2026-10-30-DW-03-video-float/)：`regression.tap`、`logic-tests.tap`、`chibi-*.log`、`media.json`、`payload.json`、`build.log`、`build-transaction.json`、`inventory.json`。

## 未验证与限制

读取当前原生进程的提升权限请求被自动审批额度错误拦住：**“usage limit … automatic approval review could not be completed”**，动作未执行。未通过其他路径绕过；用户要求继续完成代码。故未确定当前屏幕运行的是哪个旧进程，也未自动退出/重开当前应用；原生小窗焦点、拖动、透明点击、Electron 实际解码、播放音量、真实麦克风授权/STT、多屏仍需本机实测。没有新 Ego 截图，不沿用旧截图当本轮验收。

睡眠素材没有躺下/起身动作，切换使用短淡化；完整解码与抽帧不能证明循环和接缝观感无瑕疵。相册、剧情、读书、歌曲入口及 agent 任务进度未在本轮迁移。
