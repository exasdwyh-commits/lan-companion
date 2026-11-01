# Q 版情境表演与骨骼系统

更新：2026-10-30，DW-04 情境表演。用户已接受圆润 v2 的形象，要求根据情况改变表情、姿势与道具。后续开发以本页接口为准，成果进入同一个 [交付索引](CHANGELOG.md)。

## 当前方案

沿用当前 `world.html` 舞台，在同一个 WebGL renderer 中加入 **16 幅身体姿态 + 独立五官 + 语义情境导演 + 边缘/世界过渡**。电脑、书、麦克风、抱枕和表情属于同一套角色图集；坐姿直接使用坐姿原画，不把立姿膝盖硬折成坐姿。原有 16 骨骼和受约束蒙皮保留作降级与调试。

当前有工作、阅读、唱歌的成对短循环，睡眠由半睁眼进入闭眼；不是 16 套完整逐帧动画，也不是实时生成任意动作。走动仍主要依靠位置移动，完整步态、独立口型和自由拿放道具尚未完成。说话的嘴部开合跟随真实 Audio Analyser 音量，暂不做音素口型同步；无音频的唱歌预览使用明确的视觉节奏。

## 情境与反馈

| 情境 | 表情、姿势、道具 | 已接入来源 |
|---|---|---|
| 空闲 | 平静；间歇开心、害羞、招手、托腮；久闲抱枕休息 | 当前舞台本地行为，忙碌/悬停时不抢占 |
| 摸头 / 连续触摸 | 开心捧脸；5 秒内第 3 次起害羞抱臂 | 当前角色真实 pointer 点击 |
| 碰尾巴 / 拖起 / 下落 | 睁大眼、张嘴、惊讶，拖起轻晃 | 当前 pointer 拖动与移动状态；尾部使用右下区域近似 |
| 聊天等待 | 歪头托腮、问号 | 当前聊天发送与等待 |
| 回复情绪 / 聊天失败 | 本地情绪白名单；断线委屈 | 当前聊天回调，浏览器用 fixture 核对，未验真实模型 |
| 工作 | 坐姿、眼镜、电脑；睁眼/眨眼短循环 | `setActivity("working")`；业务接线由 DW-06 完成 |
| 阅读 | 坐姿、打开书；读页/举起书页短循环 | `setActivity("reading")`；阅读器由 DW-05 完成 |
| 唱歌 | 麦克风、音符；睁眼/闭眼伸手、轻摆 | `setActivity("singing")`；真实播放器由 DW-05 完成 |
| 休息 | 坐着抱鲸鱼枕，逐渐闭眼 | `setActivity("sleeping")` 或空闲行为；不是系统睡眠探测 |
| 完成 / 失败 | 举手庆祝星星 / 含泪失落 | 明确事件 API；尚未订阅真实 agent 结果 |

工作、阅读、唱歌的预览只演示表演，不能当成业务成功。取消/停止恢复 idle，不能一律发“完成庆祝”。表演层不推断任务是否成功，不读文件或记忆，不调用模型。

## 代码与素材单一真源

| 位置 | 责任 |
|---|---|
| `assets/whale-chibi-performance-v1/` | 当前情境 PNG、生成提示词、来源哈希、16 帧采样区域及脚底锚点 |
| `assets/whale-chibi-rig-v2/` | 用户接受的圆润基础立绘，降级/骨骼调试仍使用；v1 为历史 |
| `chibi-performance.js` | 白名单、事件优先级/持续时间、成对姿态节奏、空闲选择；纯逻辑 |
| `chibi-face.js` | 独立眼睛、眉毛、嘴、脸红、眼泪与追视；不改变身体/道具 |
| `chibi-presence.js` | 屏幕边缘躲藏/探头、世界离开/到达时序；不调用 IPC |
| `chibi-motion.js` | 原有 16 骨骼、约束、固定步与动作混合；1421 点 / 2688 三角形 |
| `chibi-renderer.js` | 同一 WebGL 管线：绘制图集或骨骼；反求当前 UV 做透明命中 |
| `world.html` | 现有位移/拖动/聊天/音频生命周期与语义状态对接 |
| `chibi-texture.js` / `chibi-atlas.js` | 由 `prepare-chibi-texture.py` 生成；原 PNG 字节内嵌，file:// 加载不绕过安全设置 |
| `motion-preview.html` | iframe 直接引用生产 world；轮播与手动预览，不维护另一个播放器 |

图集不假定四等分：生成画面留白不完全均匀，`source.json` 逐帧记录采样矩形。保留生成 PNG 原字节，只调整 UV 与布局。独立面部使用额外生成的 atlas-face-base.png（保留原 atlas.png）与逐帧脸部锚点，运行时画参数化五官并叠入同一 WebGL 画布。各姿态保持相同像素缩放、真实宽高比和脚底位置；不将坐姿拉高到立姿。轮廓差异大，不交叉叠加两张全身图，避免双脸/多手重影。

加载图集失败 → 原图骨骼；WebGL 不可用/上下文丢失 → 原 PNG。减少动态保留情境表情和道具，停成对循环、轻摆与随机表演。显卡句柄失效后不继续画，重载恢复。

## 业务接入接口

```javascript
// activity 只表示正在做什么，不负责启动业务。
Character.setActivity("working");
try {
  const result = await existingAgentTask();
  // 此处必须由真实结果判断成功；取消单独处理。
  Character.react("task-complete"); // working 自动恢复 idle，再庆祝
} catch (error) {
  Character.react("task-failed");   // working 自动恢复 idle，再失落
}

Character.setActivity("reading");
Character.setActivity("singing");
Character.setActivity("sleeping");
Character.setActivity("idle"); // 停止/取消活动
Character.react("pet");
Character.react("greet");
Character.setEmotion("happy");
Character.performance; // scene / frame / expression / prop / activity / event / atlasReady / error
Character.motion;      // 实际 renderer、活动、减少动态、错误
Character.setRigDebug(true); // 显示原有骨骼；关闭返回情境表演
```

活动白名单：idle / thinking / working / reading / singing / speaking / sleeping。
事件白名单：pet / shy / greet / surprise / task-complete / task-failed / chat-failed / good-night。

优先关系：拖起/跳落 > 明确完成或失败等高优先事件 > 当前业务活动 > 普通触摸/回复情绪 > 空闲表演。事件超时恢复原活动，低优先事件不盖住失败。空闲表演每 9–17 秒才再选，避免连续同一项；不会随机掏出电脑、书或麦克风。长时间后台最多补 .25 秒，避免一下跳过整个反馈。

`Character.emote(scene)` 是手动预览的强制 4 秒表演；`clearReaction()`、`setPresentationScale()` 供预览使用，业务通常使用 setActivity/react/setEmotion。保留的 `action` 接口会映射到语义姿态，骨骼调试可查原动作；不能把“开心图”称为完整点头动画。

## 独立面部与边缘/世界动作

```javascript
// 不改变正在阅读/工作/唱歌的身体与道具；预设默认 6 秒，可设 .1–30 秒。
Character.setExpression("playful", {duration: 10}); // 左眼 wink
Character.setExpression("pout");
Character.setFace({eyes: .6, mouth: "open", mouthOpen: .5, blush: .8, brow: -.2});
Character.blink();
Character.clearFace(); // 恢复情境默认；自定义参数最长保留 15 秒
Character.face;       // 独立参数、眼神、开口、ready

Character.setActivity("idle");
Character.peek("right"); // left / right / bottom；有业务活动时拒绝
await Character.travel("world");
await Character.travel("desktop");
Character.presence; // phase / progress / active / target
```

面部预设：calm / happy / shy / focused / sad / surprised / sleepy / sleeping / playful / pout。自定义 eyes 为 0–1.2，mouthOpen/blush 为 0–1，brow 为 -1–1；口型 smile/small/open/round/sad/pout，wink 布尔。输入原子验证，非法字段或数值不覆盖现状。情绪事件、独立面部覆盖、自然眨眼和鼠标追视分别处理。睡姿抱枕遮住嘴部时不把嘴画到枕头上。

边缘动作分为靠近、藏起、停顿、探头、再藏、出来。用舞台/屏幕真实裁剪边界遮挡，不画一根假遮挡条；目前只支持屏幕边缘，**未实现其他 App 窗口的真实前后遮挡**。开启漫游时只在空闲、无悬停/交互/活动且经过冷却后偶尔触发；不会随机把业务中的角色藏起来。减少动态保留边缘静态可点姿态，不滑出屏幕。

`travel` 是现有舞台按钮和 ESC 的交互入口：挥手/光环收拢 → 离场完成 → 调用已有 enterWorld/summon/dormant；新舞台加载时播放现身。重复请求复用同一 Promise，不重复调用业务。普通静态预览没有 host 时，在同页切换真实 world/desktop 视图，不启动原生服务。失败会恢复现身并显示提示。减少动态仅短淡入淡出，不旋转、缩小或显示光环。

当前没有修改 main/preload。托盘、快捷键直接调用主进程 openStage 时仍立即关闭旧窗口，**只有新窗口现身，旧窗口离场未接握手**；后续由主进程负责人与本任务协调。原生窗口流畅度与前后穿透需本机验收，不能用静态页替代。

## 补充动作的规则

1. 先定义触发条件、结束/取消条件和道具；避免单纯随机换装或情绪乱跳。
2. 保持两头身、宽圆脸、短四肢、蓝长发、鳍耳与鲸尾，不再回到瘦长 v1。
3. 新动作入 assets，保留生成/可编辑源、提示词、透明背景、哈希和锚点。多个姿态需要补画，不能靠无限角度硬拉单图。
4. 当前 16 图是首批情境；下一步补走路/转身/拿放物品、每组 4–8 帧，或分层头脸/手臂/腿/尾巴与遮挡区，再沿用当前导演接入。不要新建第三套播放器。
5. 增加动作映射时同步预览、状态表、回归与来源记录；真实阅读/音乐/任务组件负责发开始、停止、失败、完成事件。

## 开发与验证

```bash
node Tests/chibi-performance.test.cjs
node Tests/chibi-face-presence.test.cjs
node Tests/chibi-motion.test.cjs
python3 scripts/prepare-chibi-texture.py --check
bash scripts/project.sh check
python3 -m http.server 8914 --bind 127.0.0.1 --directory MALFOY-ENGINE/web
```

入口：`http://127.0.0.1:8914/live2d/motion-preview.html?revision=performance-v1`，默认轮播，选择活动会暂停；摸头、拖动直接在舞台操作。预览中的比例放大只便于检查，正式舞台仍保持默认尺寸。

本轮验证与限制见 [情境表演交付](updates/2026-10-30-DW-04-performance.md)。历史骨骼与外观证据保留，不当成当前表演验收。原生穿透、多屏、长时能耗、真实模型/歌曲/阅读/任务流程另验。
