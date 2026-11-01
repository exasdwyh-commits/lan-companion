# READ-HTML-01：修复电子书换行标签被读成 br

日期：2026-10-31。负责人：Codex / BMAD 安装与修复聊天。

## 根因与处理

用户判断成立：TXT/Markdown 导入没有处理 HTML 换行标签；粘贴文本也没有经过文件解析器。后续 `narration.toSpeech()` 把 `<`、`>` 当符号删掉，留下 `br` 或 `br /`。EPUB 原有解析器能处理真实标签，但转义的 `&lt;br&gt;` 仍可能残留。这是标签清洗顺序的问题，不是真正的换行字符变成了英文字母。

- `lib/read-ebook.py`：在原有行过滤前，有限次解码实体，再用现有 HTMLParser 提取文字，将换行/段落标签转换为换行。覆盖 TXT、MD 和 EPUB 转义标签。
- 新增 `lib/ebook-text.js`：粘贴文本先解码、完整移除标签与非正文容器，保留段落边界；这里只提取纯文本，不渲染 HTML，也不是安全消毒器。
- `lib/narration.js`：在 `buildBook()` 分段前和 `toSpeech()` 符号清理前接入。两种阅读模式都走这条路径。
- 不全局删除普通词中的 `br`，保留正文的 `br`、`bravo`、`BRCA1`；未修改媒体状态机、书库、音色或播放器。

合成复现：`第一章 海边<br />她来了。<br>风停了。` 修复前产生 `第一章 海边 br / 她来了。 br 风停了。`；修复后分为章节标题、`她来了。`、`风停了。` 三段。

## 验证与打包

证据：[本任务目录](../../../benchmarks/2026-10-31-READ-HTML-01/)。全部使用合成文本或临时目录，未读取/修改个人书库、记忆或音轨。

- `python3 -m unittest discover -s Tests -p 'test_*ebook*.py'`：7/7；包括共享 14 组标签/转义/正文保留案例，以及真实生成的 TXT、MD、EPUB 文件导入。
- `node --test Tests/ebook-markup.test.cjs MALFOY-ENGINE/test/narration.test.js MALFOY-ENGINE/test/voice-script.test.js MALFOY-ENGINE/test/companion-media.test.js Tests/companion-media.test.cjs`：54/54。
- 修复前后的失败/通过日志、示例输出分别保存在 `python-before.txt`、`node-before.tap`、`python-after.txt`、`node-after.tap`、`reproduction-{before,after}.json`。
- `bash scripts/project.sh build` 成功，构建自身 payload 51/51；统一生成 `dist/DeepWhale.app`，没有手改包内容。
- `packaged-verification.json`：包内三个清洗相关文件与源码逐字节一致；直接调用包内 Node 分段模块及 `/usr/bin/python3` 文件导入器得到正确段落；`codesign --verify --deep --strict` 通过。
- `bash scripts/project.sh check`：88/88，错误 0；`git diff --check` 通过。结果见 `project-check.txt`，静态检查的 6 项既有待办仍保留。

## 用户操作与边界

**退出并重新打开新包，再重新导入原书。** 已经保存成朗读稿的裸 `br` 无法安全区分于正文英文，旧稿与旧音轨不自动修改；重新导入获得新书 ID，使用新的朗读稿及独立音轨缓存。原有阅读进度未自动迁移。

本次没有检查用户实际原书，没有启动客户端或做真实语音试听；验证的是清洗、分段、相关媒体回归以及构建包内容。HTML 提取不承诺任意畸形 HTML 的浏览器级解析一致性。并行 agent 的其余改动保留，未提交 Git。
