# 2026-10-31 · DW-05 · 收尾补齐：两个真 bug、管线分片、配音表可编辑、增量分析

## 归属

- 负责人 / 聊天标识：WorkBuddy / 当前聊天（agent:workbuddy-chat-2026-10-31）
- 任务：[TASKS.md](../TASKS.md) DW-05「唱歌、阅读与统一音频控制」
- 开始时已有修改 / 其他负责人：另一位负责人（01:05–01:34 最后活动）已改过
  `lib/{narration,companion-media,voice-script}.js`、`test/{companion-media,book-analysis}.test.js`。
  本次接手前确认**已无并发进程**（无 codex/claude 进程，文件 55 分钟无变动）。
- 本次负责文件：`MALFOY-ENGINE/lib/{companion-media,narration,voice-script,book-analysis}.js`、
  `MALFOY-ENGINE/web/live2d/{companion-panel.js,composer.css}`、
  `MALFOY-ENGINE/test/{companion-media,book-analysis}.test.js`、
  `scripts/{sing_cover_file.sh,split_vocals.py}`

## 完成内容

### 1. 修两个真 bug（原先表现为 2 项红测试）

**a. 预取还在飞时重复合成**（`companion-media.js`）

上一段播完会触发预取下一段，紧接着 `ended` 事件让 `index++` 后调 `read()`。
预取的 Promise 还没落地时 `prefetch` 仍是 `null`，缓存查不到 → **对同一段再发一次合成请求**。
短段落、快速切段时必然触发，后果是重复调用 TTS（白等一遍）且存在叠播风险。

修法：除了「已完成的 prefetch」，再记一个 in-flight Promise（`inflight`）；
`read()` 命中同 key 时直接 await 那一个，而不是重新发起。

**b. 分段的「硬上限」根本没生效**（`narration.js`）

`splitParagraphs` 在**追加之后**才检查 `buf.length >= PARA_HARD(160)`，
而 `splitSentences` 已按 `LIMIT=100` 切好，累积到 200 才超阈值 → 实际段长 200，
是声明上限的 1.25 倍。改为**追加前**判断「加上下一句会不会超」，超了先把攒的吐出去。
601 字无标点文本从 `200,200,200,1` 变成 `100,100,100,100,100,101`。

### 2. 唱歌管线内建分片（`sing_cover_file.sh` + `scripts/split_vocals.py`）

上一轮整首 3:30 是我在外部手工切 8 段跑通的，**管线本身对长音频仍会 OOM**：
Seed-VC 自带分片只切语义特征，`mel = mel_fn(source_audio...)` 仍是整条算的。
现在管线自动判时长，超过 `CHUNK_MAX`（默认 29s）就按静音点切段、逐段转换、再拼接，
每段都幂等（已有 `her-XX.wav` 就跳过），中断可续跑。切点严格不超硬上限。

`split_vocals.py` 从一次性脚本提升为正式工具（参数化，不再硬编码路径）。

### 3. 配音表可编辑（DW-05 剩余清单第 2 项）

原先音色写死在 `narration.js` 的 `VOICE_POOL` 里，面板只能看不能改，认错角色只能改代码。

- 后端新增 `set-cast` 操作：改单个角色音色 → 按新表重切朗读稿 → `rev+1` 让旧音轨失效；
  正在播放时先停（旧音色继续放没意义）。负向拦截：角色不存在、音色不存在、实时阅读模式下改。
- `snapshot().book` 增加 `voices`（音色池）和 cast 条目的 `voice` id，面板才能渲染下拉框。
- 面板把只读文字换成每个角色一个下拉框。

### 4. 多句对白并发合成（DW-05 剩余清单第 5 项）

`voice-script.js` 原先逐句 `await`。改为受控并发（默认 3，`options.concurrency` 可调）——
不用 `Promise.all` 全丢，本地 TTS 并发一高会顶到显存。结果顺序保持不变。

### 5. 角色名误提取（顺带发现）

「你真的想好了？」老陈**又**问了一遍 → 配音表里凭空多出「老陈又」这个角色。
根因：`SAY_AFTER_RE` 的名字捕获组是 1~4 个任意汉字，非贪婪匹配为满足后面的动词会一路回溯，
把副词吞进名字。修法：把「又/也/便/却/就/才/还/都/只/再/随即/于是…」移出捕获组，
放到中间的可选修饰组里。

### 6. 长文按块增量分析（DW-05 剩余清单第 3 项）

原先只送开头 6000 字，第三章才登场的角色永远认不出。现在按 6000 字切块依次送模型
（默认最多 3 块），切点优先落在章节标题前、其次段落换行；**后续块带上已认出的名字**，
让模型只补新的。合并时跨块补齐别名、`unknown` 不覆盖已知性别。
面板显示「读了前 N 段」。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `node --test Tests/*.test.cjs MALFOY-ENGINE/test/*.test.js` | PASS 162/162 | 本记录 | 逻辑层；含新增 5 项（预取不重复、段落上限、改音色、副词不入名、增量分析×2）。不证明听感 |
| `bash scripts/project.sh check` | PASS 88/88，错误 0 | 本记录 | 静态一致性；不验证窗口行为与听感 |
| `bash scripts/check-electron-isolation.sh` | PASS 9/9 | `benchmarks/2026-10-30-DW-01/isolation.json` | app 能启动并自报数据目录、115 项单测、真实记忆指纹未变（3820:1793351859） |
| `bash scripts/build-companion.sh` | PASS | 备份 `.build/app-backups/DW-03-video-float-20261031-102952-61958` | payload 46/46、签名有效、Electron 核心/包 28/28 |
| `split_vocals.py` 实跑 210.46s 人声 | PASS 8 段，每段 ≤28.56s | 本记录 | 分片工具本身；不证明整首听感 |
| 并发合成实测（6 句 × 150ms） | 900ms → 333ms，顺序保持 | 本记录 | fixture 计时；真实 TTS 的并发上限未压测 |
| `codesign --verify --deep --strict` | PASS | 本记录 | 签名有效性 |

**不能证明**：整首翻唱成品与读书的**听感**（未人耳试听）；窗口内视觉（未做 Ego 回归）；
真实电子书导入；多音字/生僻字准确度。

## 剩余工作与交接

- 当前限制：
  - 听感验收仍缺（整首翻唱 + 多角色朗读），必须用户真耳确认。
  - 电子书原生文件对话框（P0-2）需真实 GUI 操作，未验。
  - App 入口「制作/取消/播放」未走完整链路。
  - 多音字/生僻字仍靠规则，未接模型精修（此前试过整本标注会改掉人名，已砍）。
  - 增量分析只覆盖前 3 块（约 18000 字），超长篇仍需按需加大 `maxChunks`。
- 下一项建议：先做用户真实电子书听感验收，再决定是否需要音色池扩充。
- 是否更新 STATUS / TASKS / CHANGELOG：是，均已更新。
- 是否影响素材来源、外部依赖或运行入口：否。新增 `scripts/split_vocals.py` 为纯本地工具。
