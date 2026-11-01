# GITHUB-01 · 私有源码上传

日期：2026-11-01；Codex / 01a191bf。用户明确授权“你可以上传到github”。

## 结果

仓库：https://github.com/exasdwyh-commits/lan-companion ，私有，远程分支 `main`；本地 `origin` 指向该仓库。本地 `github/main` 为专用上传快照分支，不切换/重置现有工作分支，不修改原暂存区，不推送旧Git历史。

已上传当前Electron/小屋/桌面源码、运行GLB/蒙皮/游戏/相框和dsh-pet动画，以及参考源码/测试/脚本/项目文档与选定素材真源。初次快照906文件、约112 MiB，后续追加交付文档；最终文件数/提交/完整文件树以证据 `remote-final.json` 为准。

未上传本机App、原始大视频/建模工程、模型权重、依赖安装、个人配置/密钥/记忆/会话、基准测试运行数据、历史证据截图和未使用的Live2D示例模型。没有把私有备份称为公开开源或完整可安装发行；混合素材不额外附加统一开源许可证，保持各自署名/许可。

## 实施

- `scripts/github-snapshot.py`：显式范围、45 MiB单文件上限、候选文件SHA-256、潜在凭据扫描；命中时只输出路径/行号/规则。三条URL测试中的固定localhost伪凭据按精确文件/值豁免，未读取任何个人设置或真实数据。
- 使用临时 `GIT_INDEX_FILE` 生成快照，逐文件核对提交blob与清单；断言原HEAD和index字节保持不变。首次快照为新根，后续沿 `github/main` 追加，避免把旧历史大文件或未审查内容推入远程。
- 通过已登录的 `exasdwyh-commits` GitHub CLI创建私有仓库；只在push命令使用gh凭据助手，不复制/持久化令牌，不改全局Git认证设置；普通快进push，无force。
- 新仓库保留 `AGENTS.md` 与项目入口，补充 [GitHub查看/同步/许可说明](../GITHUB.md) 和README，说明网页与原生功能边界、缺少的本机依赖。

## 验证

证据：`benchmarks/2026-11-01-GITHUB-01/`（仅留本地，不进入源码快照）。

- `remote-initial.json`：GitHub实际私有性、main提交、根树与完整递归树检查全部通过，906个blob。
- `remote-final.json`：末轮交付文档同步后的同等验证；另外逐项核对远程blob路径/SHA与本地快照树完全一致，防止只检查到仓库存在。
- 本地候选/排除理由/内容哈希和提交记录：`.build/github-snapshot/{manifest,commit}.json`；凭据模式扫描无命中，单文件最大约8.8 MiB。
- `project-check.log`：只读工程检查93/93通过，6项既有待办。没有运行写个人数据的验证，没有更改运行中的App。

## 后续

同步继续使用 `python3 scripts/github-snapshot.py --commit` 与 `git push origin github/main:main`，先看 `docs/project/GITHUB.md`。不要直接将本地旧主分支推到远程main。干净机器独立构建、完整素材许可审查和公开发行仍是后续任务。
