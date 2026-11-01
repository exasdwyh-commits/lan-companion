# 2026-10-31 · HERMES-01 · 相册/剧情接入与记忆管理

负责人：Hermes 002 / 本聊天（agent:hermes-002-2026-10-31）。用户要求今晚修好，允许并行子 agent，前提是不破坏现有功能。

## 交付

| 能力 | 入口 | 实现 |
|---|---|---|
| 相册（20 张，按好感度解锁） | 世界顶栏「相册」、桌面态底栏「相册」、托盘「相册与剧情」 | `web/live2d/gallery.{html,css,js}` + `lib/gallery.js` |
| 剧情（潮汐初遇 1 章 / 6 段静帧 / A/B 分支 / +10 奖励幂等） | 同上，章节区 | `lib/gallery.js` + `lib/content-pages.js` |
| 保存照片到本地 | 灯箱「保存到…」 | 主进程 `dialog.showSaveDialog` + 目录边界校验 |
| 记忆管理（查看/搜索/纠正/删除/清空） | 世界顶栏「记忆」、桌面态底栏「记忆」、托盘「她记得的事」 | `web/live2d/memory.{html,css,js}` + `lib/memory-admin.js` |
| 共享好感度（相册解锁、每日到访、触摸、章节奖励） | 无独立界面，随使用增长 | `lib/affection.js` |

## 改动文件

新建：
- `MALFOY-ENGINE/lib/{gallery,memory-admin,affection,content-pages}.js`
- `MALFOY-ENGINE/web/live2d/{gallery,memory}.{html,css,js}`
- `MALFOY-ENGINE/test/{gallery,memory-admin,affection,content-pages}.test.js`
- `scripts/prepare-gallery-content.py`

接线（最小改动）：
- `MALFOY-ENGINE/main.js`：require 适配层；`whenReady` 内初始化并注册 IPC（失败只警告，不阻断主舞台）；托盘加两个入口；新增 `character:tap` 好感度钩子。
- `MALFOY-ENGINE/preload.js`：暴露 `gallery` / `memory` / `openContent` / `tap`。
- `MALFOY-ENGINE/web/live2d/world.html`：顶栏与桌面底栏各加「相册」「记忆」按钮。
- `scripts/build-companion.sh`：构建时把 pack 与相册图铺进 `companion-content`。

## 关键实现决定

- **独立窗口**，不塞进 340×440 悬浮聊天窗；也不复活旧 `index.html/app.js` 播放器。
- 页面只经 `preload` 白名单调用；图片 URL 由主进程生成 `file://`，页面不接受网络/data URL。
- 保存照片只允许复制内容包目录内的文件（`path.resolve` + `realpath` 双重边界校验）。
- 章节奖励只发一次：`gallery.json` 的 `rewarded` 列表持久化，重启后仍为 0。
- 好感度按 `pack.affection` 规则（每日到访、触摸冷却、章节奖励），状态损坏时备份后归零，不崩溃。
- 记忆管理只操作 `profile.md` 的结构化事实；`memory.jsonl` 不做逐条编辑，清空前两者都备份。

## 验证

| 命令 | 结果 | 说明 |
|---|---|---|
| `node --test MALFOY-ENGINE/test/gallery.test.js` | 10/10 | 解锁边界、第 20 张、A/B、奖励幂等、坏状态、路径穿越 |
| `node --test MALFOY-ENGINE/test/memory-admin.test.js` | 9/9 | 列表/纠正/删除/清空确认/坏行 |
| `node --test MALFOY-ENGINE/test/affection.test.js` | 10/10 | 冷却、每日、封顶、损坏恢复 |
| `node --test MALFOY-ENGINE/test/content-pages.test.js` | 5/5 | 视图、章节全流程、记忆 IPC、保存、错误返回 |
| 全量 `node --test Tests/*.test.cjs MALFOY-ENGINE/test/*.test.js` | **160/160 全绿** | WorkBuddy 凌晨修掉原 2 项 `narration.js` 红；本轮新增 34 项全过 |
| `bash scripts/project.sh check` | 88/88，错误 0；Electron 核心/包 28/28 | 8 项既有待办降为 7 项（相册/剧情待迁已消） |
| `bash scripts/check-electron-isolation.sh` | 9/9 | 真实 `~/.smartcompanion` 指纹未变 |
| `bash scripts/project.sh build` | 46/46 源包一致，签名通过 | 旧包备份在 `.build/app-backups/` |
| 隔离目录启动冒烟 | 进程存活，生成 `affection.json`（value=3），无 `[content]` 初始化错误 | 未做真实点击 |
| Electron 自身渲染截图（`LAN_CONTENT_PROBE=1`） | 4 张：相册、章节、记忆、640×360 窄窗 | 见下 |

### 视觉验收（真实 Electron 渲染 + 真实 preload/IPC，非 CDP）

命令：

```bash
LAN_DATA_DIR=$(mktemp -d) LAN_CONTENT_PROBE=1 LAN_CONTENT_PROBE_NARROW=1 \
  LAN_CONTENT_PROBE_OUT=/tmp/probe ./dist/DeepWhale.app/Contents/MacOS/DeepWhale
```

结果：
- 相册：好感度 28 时显示 9/20 已解锁，前 9 张图片正常加载，锁定卡显示门槛；无横向溢出。
- 章节：`?tab=chapters` 会滚到「02 / STORIES · 剧情章节」，显示「潮汐初遇 / 已解锁 / 开始」。
- 记忆：修复后按「属性：值」显示（如 `喜欢：雨天`），不再是只有值。
- 640×360：单行 4 列，无横向溢出、无裁切。
- 未覆盖：保存对话框是系统模态框，探针无法点击；灯箱/分支按钮的真实点击仍由用户验收。

### P0 追加（同日）：点击台词、关系称呼、实时推送

- `pack.json` 新增 `wakeLines` / `quietLines`；点击按「睡眠唤醒 / 趴屏 / 普通触摸」轮换台词，仍走 `touches` 作为普通触摸。
- 舞台左上角新增轻量关系称呼（“她叫你：渐渐熟悉”），启动和每次点击短暂出现 6 秒；不做常驻数值条。
- 主进程新增 `companion:affection` / `companion:touch-line`，并在关系变化时向所有窗口推送 `affection:changed`；已打开的内容页也能收到。
- 修掉 `project_audit.py` 里“相册/剧情仍待迁入”的陈旧警告。
- 视觉复核：`LAN_CONTENT_PROBE_WORLD=1` 截世界窗，确认称呼样式与位置正常（不挡人物、不挡顶栏）。

### P1 追加：锚点静帧与动作尾部淡出

- 从 `idle-matched-clean.mov` 首帧生成 `assets/whale-world-web-v1/anchor-idle.png`（880×660 RGBA，透明区 58%），不重新生成角色视频。
- `config.js` 增加 `fadeOutSeconds: 0.4` 与 `anchor` 字段；`prepare-world-video.py` 负责再生。
- `world-video.js`：触摸片段剩余 ≤0.4 秒时提前淡出，露出锚点静帧；加载中、淡出中、解码失败时显示锚点，正常播放时隐藏，避免与视频重影。
- 验收：新增 2 项单测（淡出判据、淡出时锚点接管）；世界窗实拍「中段 / 淡出瞬间 / 结束」三张，淡出瞬间人物完整、无空白黑屏。
- 限制：锚点是静态首帧，睡眠/唤醒仍没有拍摄好的过渡素材，只做短淡化。

## 未验证 / 限制

- **保存对话框与真实点击未验收**：页面渲染已用 Electron 自身截图验过；系统保存框、灯箱左右键、分支按钮需要用户实际点一遍。
- 好感度来源：每日到访、摸头、真实聊天成功（20 秒冷却）、章节奖励；聊天失败/超时不计。
- 相册 26 张中 v2/v3 未齐，本轮按既有 20 张接入；不修改断言冒充全量。
- 记忆列表无真实时间戳（`profile.md` 本身不存时间），按文件行序倒序。
- 多进程同时写 `profile.md` 仍有竞争窗口（`memory-store.js` 不加锁，本轮未改它）。
- `LAN_CONTENT_PROBE` 是验收专用开关，正常启动不触发；不要把它当产品功能。
