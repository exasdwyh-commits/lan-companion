# 操作逻辑（Operation Logic）

## 三态

```
        ┌──────────── 启动 ────────────┐
        ▼                              │
   ┌─────────┐   ⌥⌘1 / 托盘          ┌─┴──────────────┐
   │ dormant │ ──────────────────────▶│ world          │
   │ 休眠    │                        │ 她的世界        │
   │ 只有壁纸 │◀──────────────────────│ 全屏 + 聊天     │
   └─────────┘      Esc / 托盘        └────────────────┘
        │ ▲                                   │
        │ │ Esc / 托盘                         │ ⌥⌘2
        │ └──────────────────┐               ▼
        │              ┌─────┴──────────┐
        └──────────────│ desktop        │
          Esc / 托盘    │ 你的世界        │
                       │ 透明 + Q版漫游  │
                       └────────────────┘
```

| 状态 | 窗口 | 音色 | 鼠标 |
|---|---|---|---|
| `dormant` | 壁纸窗（`type:"desktop"`，压在图标下，不可交互） | — | 穿透 |
| `world` | 全屏不透明窗 + 聊天框 | `voiceProfiles.world`（清冷优雅） | 正常 |
| `desktop` | 全屏透明置顶窗 + 聊天框 | `voiceProfiles.desktop`（萌娘活泼） | **命中区才接收** |

## 进入 / 退出

| 操作 | 结果 |
|---|---|
| 启动 app | `dormant`（只有壁纸，不打扰） |
| 托盘「进入她的世界 ⌥⌘1」 | `world` |
| 托盘「召唤她到桌面 ⌥⌘2」 | `desktop` |
| 托盘「让她回去休息 Esc」 | `dormant` |
| 窗口内按 **Esc** | `dormant` |
| ⌥⌘K（全局） | 有窗 → `dormant`；无窗 → `desktop` |
| 托盘「退出」 | 退出 app |

规则：**任何时刻最多一个交互窗**。开新窗前先 `closeStage()`，并让壁纸窗沉睡（否则会同时出现两个她）。

## 鼠标穿透（desktop 模式的关键）

透明全屏窗如果直接 `setIgnoreMouseEvents(true)`，聊天框也点不到；如果设 `false`，整个桌面被挡住。

解决：**渲染层命中测试 + 主进程动态切换**。

```
world.html  mousemove
   ├─ 在角色矩形内（padding 28px）→ stageHit(true)
   ├─ 在聊天框矩形内（padding 20px）→ stageHit(true)
   └─ 其他 → stageHit(false)
                    │
main.js  ipcMain.on("stage:hit")
   └─ stage.setIgnoreMouseEvents(!interactive, { forward: true })
```

`forward: true` 保证穿透时 mousemove 仍能到达渲染层，否则一旦穿透就再也收不到事件、无法解除。

实测：角色中心 `true` / 空白 `false` / 输入框 `true`。

## 聊天

- 输入框在 `world` 和 `desktop` 两态都有（`world.html?chat=1`）
- `dormant` 壁纸态没有输入框（`chat=0`），不抢焦点
- 发送 → `malfoyHost.chat(text, history)` → 主进程走模型池 → 返回 `{text, voice, emo, mode, voiceProfile}`
- 回复同时：气泡显示 + 情绪切换 + TTS 播放
- 历史保留最近 12 条

## 窗口边缘互动（爬窗）

`desktop` 模式下她会爬上其他 app 的窗口边缘走。

### 怎么拿到窗口坐标

`CGWindowListCopyWindowInfo`，通过 **JXA（osascript -l JavaScript）** 调用：

```js
ObjC.import("CoreGraphics");
var l = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID);
var a = ObjC.deepUnwrap(ObjC.castRefToObject(l));   // ← 必须 castRefToObject 再 deepUnwrap
```

- **不需要录屏权限**（只要 bounds，不要窗口标题）
- **不需要辅助功能权限**（`System Events` 那条路反而拿不到窗口，全返回 0）
- 主进程每 2.5s 刷新一次，缓存在 `winCache`，渲染层通过 `companion:windows` 取

过滤规则：`layer === 0`、`w >= 420 && h >= 260`、排除自己 + 系统进程（`universalAccessAuthWarn`、`Window Server`、`Dock`、`Control Center`…）。

### 站哪条边

窗口顶边常常贴着屏幕顶部（y=33~91），而 Q 版有 373px 高——站顶边头会被切掉。

```
perchLine(w):
  顶边 y >= 角色高 + 8  →  站顶边 (w.y)
  否则                  →  站底边 (w.y + w.h)
```

### 状态机

```
idle ──(idle 计时结束)──▶ walk
walk ──(走到边沿, 45% 概率)──▶ jump ──(落地)──▶ idle
walk ──(走 6~12s)──▶ idle
perch 消失 / 没窗口 ──▶ fall ──▶ idle(屏幕底)
```

- 走路速度 62 px/s，活动范围 `[w.x+34, w.x+w.w-34]`
- 跳跃：抛物线，`sin(πk) * 90px` 抬升，0.75s
- 下落：520 px/s² 到屏幕底

### 坑

**窗口列表每轮重建对象**，`wins.includes(perch)` 永远 false → 她会一直掉下去。
必须按 `app + 坐标近似` 把 `perch` 刷新到新对象：

```js
const still = wins.find(w => w.app === perch.app &&
  Math.abs(w.x - perch.x) < 60 && Math.abs(w.y - perch.y) < 60);
if (still) perch = still; else { perch = null; pet.state = "fall"; }
```

**时间单位**：`lastWinPoll` 用 ms 比较（`now - lastWinPoll > 2500`），别传秒。

## 文件对应

| 文件 | 作用 |
|---|---|
| `main.js` `openStage(mode)` | 唯一的开窗入口（world / desktop 共用） |
| `main.js` `goDormant()` | 关交互窗，重建壁纸 |
| `main.js` `buildMenu()` | 托盘菜单（状态用 ● 标记） |
| `world.html` | 两态共用页面：`?mode=world\|desktop&chat=0\|1` |
| `preload.js` | `enterWorld / summon / dormant / stageHit / chat` |

## 已验证（2026-10-30）

| 步骤 | 结果 |
|---|---|
| ① 启动 | 1 页，`world.html?mode=world`（无 chat）✅ |
| ② 进入她的世界 | 1 页，`?mode=world&chat=1` ✅ |
| ③ 召唤到桌面 | 1 页，`?mode=desktop&chat=1`，`roaming:true` ✅ |
| ④ Esc | 回到 `?mode=world`（无 chat）✅ |
| 命中测试 | 角色 `true` / 空白 `false` / 输入框 `true` ✅ |

## 还没做

- [ ] 托盘图标现在是文字 `🐋`（macOS 27 未签名 app 的 `NSStatusItem` 有渲染问题，先用 `setTitle`）
- [ ] 首次启动的引导（现在直接进壁纸，用户可能不知道托盘在哪）
- [ ] `world` 态窗口没有 alwaysOnTop，切到别的 app 会被盖住——是否要置顶待定
- [ ] 多显示器：目前只取主屏 `screen.getPrimaryDisplay()`
