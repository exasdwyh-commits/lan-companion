# GITHUB-PUBLIC-02 · 仓库改为公开

日期：2026-11-01；Codex / 01a191bf。用户明确要求“你改成公开就行”，授权将现有 GitHub 仓库公开。

## 改动

- 将 `exasdwyh-commits/lan-companion` 可见性从 private 改为 public；保留现有文件/提交历史和第三方署名、素材来源、各自许可说明。
- 同步仓库README、AGENTS和项目GitHub说明，移除当前状态仍为“私有”的过期文案；GITHUB-01交付记录保持当时的私有状态历史。
- 沿用原有快照排除规则，不上传个人设置/凭据/记忆/会话、原始大视频、模型权重、本机App与历史测试运行目录。没有修改业务代码/运行素材或重新打包App。
- 源码公开不等于独立安装包发行，不为所有第三方图/模型/声音附加统一许可证。

## 验证

证据目录：`benchmarks/2026-11-01-GITHUB-PUBLIC-02/`。

- `anonymous-access.json`：不带GitHub授权信息请求仓库元数据，HTTP 200，private=false、visibility=public。
- `remote-final.json`：GitHub分支提交/根树/完整blob路径及SHA与本地快照一致；远程仍为public。
- `project-check.log`：工程只读检查93/93通过，既有6项提示不变。
- 快照脚本逐文件核对内容、确认原HEAD和暂存区字节不变，普通快进推送，没有force。

仓库：https://github.com/exasdwyh-commits/lan-companion 。
