---
title: '读书按章跳转'
type: 'feature'
created: '2026-10-31'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/docs/project/bmad/planning-artifacts/prds/prd-desktop-companion-2026-10-31/prd.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 一本十八九章的小说被切成几百个段落，读者想回到第三章只能连点几十次「下一段」。段落级导航对长篇没有意义。

**Approach:** 解析朗读稿时识别独占一行的章节标题，把每段归属到章；状态快照暴露章节列表与当前章号；`jump` 支持按章跳转；面板显示「第 N 章 / 共 M 章」并给出可点的章目录。识别不到章节的书完全不出现目录，行为与现在一致。

</frozen-after-approval>

## Implementation Notes

### Code Map

- `MALFOY-ENGINE/lib/narration.js` — `splitParagraphs()`（分段入口，章节标题在分段时天然独立成段）、`buildBook()`（组装 `{paragraphs, cast, mode}`）。新增章节识别挂在这里，不要动 `splitScript()` 的角色归属逻辑。
- `MALFOY-ENGINE/lib/companion-media.js` — `snapshot()` 暴露 `book.{index,total,text,cast,voices,mode,analysis}`；`command()` 的 `case 'jump'` 只接受 `{index}`；`save()`/`normalizeBook()` 负责 `reading.json` 读写与 v1→v2 升级。章节字段要在这里透出并做旧数据兼容。
- `MALFOY-ENGINE/web/live2d/companion-panel.js` — `render(p)` 里 `$('reader-progress')` 显示「第 N / M 段」；`renderCast()` 是最近加的同类 UI，可照它的写法。
- `MALFOY-ENGINE/web/live2d/composer.css` — `#reader-cast`/`.cast-row` 是现成的列表样式参照。

### 复用与约束

- **复用** `splitParagraphs` 的分段结果：章节标题本身就是一个独立段落，直接按段落文本判断，不要重写一套正文解析。
- **兼容旧数据**：`normalizeBook()` 收到的旧 `reading.json` 没有章节字段，读取时按 `paragraphs[i].text` 现算，不要求重新导入。
- **不要动**：`splitScript()` 的角色识别、`voice-script.js` 的合成、`reading.json` 的 `rev` 语义（`bumpRev()` 仍只管音轨失效）。
- 章节识别只认强模式：`第<数字或中文数字><章节卷回部篇>`（可后接标题文字）、`Chapter <n>`、`Prologue`/`Epilogue`；**纯数字行不算**，避免把正文误判成标题。
- 无章节时 `chapters` 必须是空数组，`jump` 按章跳要明确报错，不得静默返回。

### 验证

- `node --test Tests/*.test.cjs MALFOY-ENGINE/test/*.test.js` 全绿（现有 162 项不得回退）。
- 新增用例：多章文本能列出章节且首段索引正确；按章跳转落到章首段；无章节文本 `chapters` 为空且不报错；旧 `reading.json`（无章节字段）读回后能现算出章节。

## 实现记录

改动文件：`narration.js`（`isChapterTitle`/`markChapters`/`buildBook`/`applyCast`）、
`companion-media.js`（`normalizeBook`/`compact`/`snapshot`/`jump`/`import`/`set-mode`）、
`companion-panel.js`（`renderChapters` + 进度文案）、`composer.html`、`composer.css`、
`test/companion-media.test.js`。测试 162 → 174。

### 盲审后改掉的问题

1. **标题判定只有 `^` 锚会误判**：「第一章写得不好，我读不下去。」在段首会整段命中。
   改为「章号后必须是结束/空白/分隔符」，紧凑写法（「第一章潮汐」）另走一条更严的分支
   （剩余 ≤8 字且无标点）。
2. **目录标题会被读音规范化改写**：`toSpeech` 把「1984」念成「一九八四」、括号改成逗号，
   目录里就成了「第一章 一九八四年，上」。改为**在 `toSpeech` 之前**识别章节并保留原文标题，
   段落按索引对齐后套回章号。
3. **章号不落盘**：原先只有带对白的段落会存 `chapter`，纯旁白段落被压成 `{text}` 就丢了，
   形成半截数据。改为统一不存 —— 章号完全可由 `chapters` + `startParagraph` 重算。
4. **章节表可能被改乱**：`reading.json` 是用户可写文件，回填循环只往前走，
   遇到乱序条目会卡死。改为先按 `startParagraph` 排序去重，并加 500 条上限。
5. **面板下拉框被反复重建**：`render()` 由每次播放进度驱动（约 4 次/秒），
   整块重建会把用户正拉开的目录关掉。改为按章节表签名比对，只在变化时重建。
6. **章位置用序号而非标题**：「Chapter 12」「第X卷」会显示成「第 1 章」。改用标题。
7. `jump` 传 `chapter: -1`（客户端原样回传哨兵值）时给出「当前不在任何章节内」而不是「序号无效」。

### 判定为不修

- **卷/章压成一层**：PRD 的 Non-Goals 已明确不做嵌套树，属设计决策。
- **每次 emit 都带完整章节表**：章节数是几十量级，序列化开销可忽略；真正的分层优化
  要改 `emit` 语义，超出本 spec 范围，记录为已知限制。

### 真实排版压测后补的识别

构造数据全绿之后，用真实小说排版压了一遍，发现**最常用的几种写法全漏**：

| 写法 | 压测前 | 压测后 |
|---|---|---|
| `卷一　风起`（多卷本不带「第」） | ✗ | ✓ |
| `楔子` / `序章` / `尾声` / `终章` | ✗ | ✓ |
| `Part I` / `Interlude` | ✗ | ✓ |

`CHAPTER_RE` 补了 `[卷章][\s　]*[数字]` 与中文序章词表。同时确认没有扩大误判面：
「卷子发下来了」「序列号是三」「序」「章」单字都仍被拒绝（测试里固化为 15 项应识别 + 11 项应拒绝）。

全角空格（`　`）、段首缩进、楔子段归属 `-1` 也都验证过。

### 清洗链路验证

`read-ebook.py` 会剥目录行、页眉、页码，担心它把章节标题一起删掉。实测：
带 `第一章 归港 ........ 1` 的目录行**被正确删除**，正文里的 `第一章 归港` **完整保留**，
缩进被 trim —— 章节识别在清洗后的文本上照常工作。
已知残留：单页页码（单独一行 `15`）不会删，因为既有策略要求至少 2 行纯数字才判定为页码噪音，
这是为避免误删正文里的数字行，权衡后不动。
