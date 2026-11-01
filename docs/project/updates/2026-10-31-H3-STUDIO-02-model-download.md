# 2026-10-31 · H3-STUDIO-02 · H3 模型下载

## 目标

为独立 H3 Video Studio 准备本机 `h3.c` 所需权重；文件放在 Git 忽略目录，不进入代码提交或应用发布包。

## 处理结果

- 下载源：Hugging Face `MiniMaxAI/MiniMax-H3`，经可达的 `hf-mirror.com` 端点下载。
- 下载范围：官方原始 `model_index.json`、`FL2VA/*`、`Ref2VA/*`，跳过其他 Diffusers 格式副本。
- 两个自包含 checkpoint 合计约 290GB；目标目录原为 `tools/h3-video-studio/data/models/MiniMax-H3/`。
- 下载到约 49GiB 后用户要求停止。已删除上述模型目录、仅为本次操作创建的 `tools/h3-video-studio/config.local.json` 与 `tools/h3-video-studio/data/h3-download.log`。
- 清理后 `tools/h3-video-studio/data/` 仅保留 Studio 数据库、jobs 与空目录；等待 5 秒确认模型目录没有重新生成。当前无模型权重，不能生成。

## 状态与限制

- 约 290GB 的体积来自官方仓库两个 BF16 模型目录的 dry-run 文件清单，不包含生成视频空间。
- 这套原始 BF16 权重遵循 [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3)。
- 当前仅验证镜像元数据、部分文件曾落盘及清理后目录状态；未校验完整快照、未构建 h3.c、未生成视频。
