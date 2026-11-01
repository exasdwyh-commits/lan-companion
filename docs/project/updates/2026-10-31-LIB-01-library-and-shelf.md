# 2026-10-31 · LIB-01 · 曲库与书架

## 归属

- 负责人 / 聊天标识：WorkBuddy（DW-05 收尾后接续）
- 任务：娱乐系统的「曲库 + 书架」—— 用户明确要求「应该搞一个曲库和一个书架」。
- 开始时已有修改 / 其他负责人：`companion-media.js`、`narration.js`、`TASKS.md` 有并行会话改动，本次只做外科式编辑，不整体重写。
- 本次负责文件：
  - `MALFOY-ENGINE/web/live2d/composer.html`
  - `MALFOY-ENGINE/web/live2d/composer.css`
  - `MALFOY-ENGINE/web/live2d/companion-panel.js`
  - `MALFOY-ENGINE/lib/song-library.js`、`MALFOY-ENGINE/lib/read-ebook.py`
  - `scripts/prepare-companion-songs.py`、`scripts/check-world-payload.py`
  - `scripts/render-panel-preview.js`（新增）、`Tests/library-panel.test.cjs`（新增）

## 完成内容

### 曲库（娱乐页）

- 原来的歌曲列表是「标题 + 一行小字 + 一个播放按钮」的裸行，翻唱与原曲混在一起，看不出哪首在播。
- 现在按来源分组（「她自己的翻唱」在前、「随包原曲」在后），每行是：来源色块封面 + 标题 + `来源 · 时长` + 右侧播放态。播放中显示三根跳动的柱子，暂停时柱子停住但不换行。
- 播放态只翻 `aria-current` / `data-live` 属性，**不重建列表**：面板被播放进度驱动约 4 次/秒，重建会冲掉滚动位置和搜索焦点。
- 标题行右侧显示 `N 首 · 总时长`；没有歌时隐藏搜索框和播放控制，并把「让她学一首新歌」自动展开 —— 空曲库时那两个控件没有作用对象，只是噪音。
- 翻唱制作流程从主区域折进 `<details id="cover-studio">`：有歌时收起，制作中/做完自动展开（否则进度和完成提示藏在看不见的地方）。

### 书架（读书页）

- 原来只有 ≥2 本才显示一排胶囊，新用户根本不知道有书架；现在是常驻的卡片网格：书名、`段落数 · 章数 · 更新日期`，在读的那本高亮并挂「在读」角标，非在读的 hover 出「移出」（在读的由 `remove-book` 自己拦，避免连进度一起丢）。
- 一本都没有时给一句「怎么加第一本书」，而不是整块消失。
- 书架挪到当前书名之前：先看「我在哪个书架」，再看「这本是什么」。
- 书名去发布号：`read-ebook.py` 现在优先从正文 `书名：` 取书名（没有才退回文件名并剥掉 `-\d{6,}` 后缀），老数据在面板层剥。

### 顺带修掉的朗读质量问题

- 下载站 TXT 开头的 `书名／作者／分类／来源节选` 一整块元信息原来会被当成正文念出来（第一段就是「书名：爱如灰烬」）。现在只在最开头剥掉，遇到第一行正文就停 —— 正文里的「作者：」不动。

### 数据链路

- 时长不从运行时 `ffprobe` 拿：随包原曲的时长由 `prepare-companion-songs.py` 在构建时读 M4A 的 `mvhd`（纯标准库，无外部依赖）写进 `songs.json`；翻唱时长由制作/导入时测好存进 `covers/library.json`。曲库面板每次刷新只读索引。
- `check-world-payload.py` 的 `song-metadata` 比对忽略 `duration`：它是构建时量出来的，不是 `pack.json` 里手写的字段，不该算成「打包清单与规范曲包不一致」。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `node --test Tests/*.test.cjs` | PASS 82/82 | `Tests/library-panel.test.cjs` 等 | 覆盖新增的分组/播放态/空态/书架；用最小 DOM 桩，不能证明真实渲染 |
| `node --test`（MALFOY-ENGINE） | PASS 149/149 | `MALFOY-ENGINE/test/` | 含新增的曲库时长用例 |
| `python3 -m unittest test_read_ebook` | PASS 6/6 | `Tests/test_read_ebook.py` | 书名取自正文、前置元信息剥离、正文内「作者：」不动 |
| `bash scripts/build-companion.sh` | PASS 51/51 payload | 打包产物渲染见下行 | 证明改动确实进了 `dist/DeepWhale.app` |
| `node scripts/render-panel-preview.js`（{singing, reading} × {有数据, 空}） | 已目视确认 | `docs/integration-evidence/2026-10-31-library-singing.png`、`…-library-reading.png`、`…-library-empty.png`、`…-shelf-empty.png` | 真实 Chromium 渲染的静态帧；不能证明点击/滚动等交互 |

未执行：`scripts/verify-integration.sh`（会拉起第二个实例，本次只改 UI 层，留待下次整体验收）。

## 剩余工作与交接

- 当前限制：
  - 面板高度只有 440，曲库/书架内容多了要滚动；`#media-status` 常驻底部会压掉最后一行的一部分。
  - 已导入的两本书仍是旧数据（标题带发布号、正文含元信息段），重新导入才会走新的清洗逻辑。
  - 打包产物里只有 1 首能听的歌（翻唱），随包两首是历史念词实验，折在「历史实验样例」里。
- 下一项：
  - 阶段二：翻唱任务状态持久化 + 启动时对账（App 崩了以后 job 卡在 `converting`）。
  - 阶段四：拆 `companion-media.js`（25KB 上帝模块）。
- 是否更新 STATUS / TASKS / CHANGELOG：STATUS / TASKS 由并行会话维护，本次未改，避免冲突。
- 是否影响素材来源、外部依赖或运行入口：无新依赖；`prepare-companion-songs.py` 多了一步 M4A 头解析。
