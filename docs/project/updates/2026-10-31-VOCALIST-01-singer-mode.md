# VOCALIST-01 · 歌姬模式（MiniMax 作曲 + 她的声音）

日期：2026-10-31
状态：已实现并通过单元测试；**真实出歌环节等 API Key**（见文末「没验证到的部分」）

## 这一版解决什么

之前「娱乐」里只有一条路：**她学一首已有的歌**（翻唱，seed-vc 换音色）。
用户提出另一个方向：**让她自己写、自己唱一首本来不存在的歌**。

两者不是同一个功能，所以不是加一个按钮，而是分成两条链路：

| | 输入 | 干的事 | 产物 |
|---|---|---|---|
| 翻唱 `covers` | 一首已经存在的歌 | 分离人声 → 换音色 → 重新混音 | `covers/<id>/cover.m4a` |
| 歌姬 `vocalist` | 一个主题 / 一段歌词 | 写词 → 作曲 →（可选）换她的声音 | `originals/<id>/song.m4a` + `her.m4a` |

## 设计：三段可以各自失败

写词、作曲、换成她的声音，依赖的东西完全不同：

1. **写词** → 本机模型池（`llmRaw`）。失败可以自己写。
2. **作曲** → 云端音乐模型。**不依赖本机歌声模型**，没装 seed-vc 也能出歌。
3. **换成她的声音** → 本机 `scripts/sing_cover_file.sh` + 音色参考音频。缺了只是少一个版本。

所以面板上三件事各有各的可用状态，任何一段失败都不会把前面已经做出来的东西弄丢：

- 写词失败 → 台词是「她这会儿想不出词（模型暂时不可用）。自己写几句也行」。
- 作曲失败 → 草稿和歌词都还在，改一下能重试。
- 换声失败 → 明确告诉用户「原来的版本还能听」。

## 接口契约（实测确认的部分）

```
POST https://api.minimaxi.com/v1/music_generation
Authorization: Bearer <key>
{
  "model": "music-3.0",          // 回退 music-2.6
  "prompt": "风格描述",           // 0–2000 字
  "lyrics": "[Verse]\n…",        // 1–3500 字，支持 [Verse]/[Chorus]/…
  "stream": false,
  "output_format": "url",        // 也可以是 hex
  "audio_setting": { "sample_rate": 44100, "bitrate": 256000, "format": "mp3" }
}
```

响应：`base_resp.status_code === 0` 才算成功；`data.audio` 是 URL 或 hex；
`extra_info.music_duration` 是**毫秒**（转秒存进索引）。

三个刻意的决定：

1. **只要一次计费。** 先要 `url`（响应小），万一服务端只给 hex 就当场解码，
   绝不为了「拿不到 url」再请求一遍 —— 那是一次新的扣费。
2. **账号级错误不换模型重试。** `1004`（key 无效）/`1008`（余额不足）/
   `1026`/`1027`（内容审核）换个模型也是同样的错。只有 `1013` 这类服务端临时故障
   才回退到 `music-2.6`。测试里两条路径都钉了（`鉴权失败不换模型重试` / `服务端临时故障才回退`）。
3. **模型名与端点都可用环境变量改。** `MINIMAX_MUSIC_MODEL` / `MINIMAX_MUSIC_URL`。
   官方控制台给不同账号开放的模型名一直在变，写死等于把功能绑死在一个名字上。

## 歌词清洗：模型一定会加戏

实测（写词 prompt 已明确禁止）模型仍会输出：代码围栏、`标题：《…》`、
开头的「好的，我为你写了这首：」、结尾的「希望你喜欢！」。

`parseLyrics()` 做四件事：

1. 摘出 `标题：` / `歌名：` / `title:` 那一行做歌名，**书名号去掉**；
2. 剥掉代码围栏与「好的/当然/没问题」这类开场；
3. 结构标签归一：`[主歌]`/`[副歌]`/`[pre-chorus]`/`[hook]` → 官方写法；
   **认不出的标签整行丢掉**（它是噪音，留在歌词里会被当成歌词唱出来）；
4. 结尾客套话只在**它是整个末行**且命中开头词时才删。

第 4 条有个取舍：只删一行，宁可偶尔漏一句也不吃歌。直接砍最后一行太危险 ——
那可能就是最后一句副歌。

## 存储与曲库合并

```
<data>/originals/
  index.json          [{id,title,createdAt,duration,model,style,theme,lyrics,her}]
  draft.json          未完成的草稿（主题/曲风/歌词），重启后还在
  <uuid>/song.mp3     接口原始产物（保留）
  <uuid>/song.m4a     转码，供播放器
  <uuid>/her.m4a      （可选）换成她的声音
```

`originals/` 与 `covers/` 分开：`covers/library.json` 只认 `cover.m4a`，
混在一起会让「她自己写的」冒出翻唱条目。曲库里由 `song-library.js` 合成一个列表，
顺序是 **原创 → 翻唱 → 随包原曲**，用暖金「创」/ 蓝「翻」/ 灰「原」三种色块分开。

一首原创歌在曲库里**只算一首**，哪怕有两个版本：

- `url` → 有 `her.m4a` 就播她唱版（用户点播放要听的是她）
- `altUrl` → 生成版，留给面板做对照

这条也有测试钉住（`有她唱版时优先播她唱版，原版留在 altUrl 里`）。

## 文件改动

| 文件 | 改动 |
|---|---|
| `MALFOY-ENGINE/lib/vocalist-jobs.js` | 新增：写词/作曲/换声三段编排、歌词清洗、错误映射、草稿持久化 |
| `MALFOY-ENGINE/lib/song-library.js` | 新增 `originalSongs()`，原创排最前，her 版优先 |
| `MALFOY-ENGINE/main.js` | `vocalists()` 控制器 + `companion:vocalist` IPC（draft/write/generate/dress/cancel/play） |
| `MALFOY-ENGINE/preload.js` | `vocalist()` / `onVocalistState()` |
| `MALFOY-ENGINE/web/live2d/composer.html` | 「让她写一首新歌」折叠区 |
| `MALFOY-ENGINE/web/live2d/composer.css` | 竖排字段、结果卡、暖金原创色块 |
| `MALFOY-ENGINE/web/live2d/companion-panel.js` | `renderVocalist()`、分组加「她自己写的」、曲库提示文案 |
| `scripts/render-panel-preview.js` | `PANEL_VOCALIST=demo` 演示状态 |
| `MALFOY-ENGINE/test/vocalist-jobs.test.js` | 新增 19 项 |
| `MALFOY-ENGINE/test/song-library.test.js` | +4 项 |
| `Tests/vocalist-panel.test.cjs` | 新增 9 项 |

## 验证

| 检查 | 结果 |
|---|---|
| 引擎 `node --test` | 181/181 PASS（原 158 + 19 + 4） |
| 桌面 `node --test Tests/*.test.cjs` | 116/116 PASS（原 107 + 9） |
| 面板离屏渲染 | `docs/integration-evidence/2026-10-31-vocalist-panel.png`、`…-vocalist-library.png` |

面板截图这一轮的坑：这台机器上裸 Electron 二进制里 `require('electron')` 拿不到模块
（`MODULE_NOT_FOUND`），所以改用 Playwright 缓存里的 `chrome-headless-shell` 直接开
一份注入 mock 的 `composer.html` 副本。**注意 `--window-size` 在 `--headless=new`
（完整 Chrome）下不生效，视口会变成 500 宽**，会把右侧裁掉并让人误判成布局溢出；
`chrome-headless-shell` 则正常按 340 出图。

## 没验证到的部分

**真实出歌一次都没跑过** —— 本机没有任何 MiniMax 凭证
（`~/.hermes/.env` 里只有 `AGENS_API_KEY` / `OPENROUTER_API_KEY` 等，
`~/.hermes/auth.json` 的 `credential_pool` 里也没有 minimax）。

另外一条必须提前说清的风险：官方文档写明
**2026-08-20 起付费音乐 API（Music Generation / Lyrics Generation）不再向新用户开放**，
免费额度（`music-3.0-free` / `music-2.6-free` / `music-cover-free`）**已停止服务**。
已有付费权限的账号可以继续用。所以真正能不能出歌，取决于这个账号是否已开通。

一旦有 key（`MINIMAX_API_KEY`），把 `~/.hermes/.env` 补上就能跑通，
代码不需要再改。第一次真实生成后要回填的数字：实际耗时、单曲时长、
`music-3.0` 与 `music-2.6` 谁的产出更稳。
