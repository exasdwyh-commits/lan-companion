# H3 Video Studio

一个独立的本地视频生成小工具：网页端管理提示词、参考图、生成队列和成片，使用 Apple Silicon 原生 `h3.c` CLI 推理。它不依赖 ComfyUI，也不接入澜的 Electron 主程序。

## 当前功能

- 文生视频、首帧/首尾帧、多参考图三种模式。
- 平衡、质量、草稿三个预设；自定义画幅、2–15 秒时长、固定随机种子。
- M5 `int8-row-fc2` 开关；只有引擎构建支持时才启用。
- 单任务队列、状态刷新、取消、失败重试。
- 成片预览；每个任务保留本地输入、提示词、参数、运行日志和 JSON 元数据。
- 仅绑定 loopback 地址，不开放局域网或公网访问。

## 启动

需要 Apple Silicon、Python 3.9+、FFmpeg/FFprobe，以及按 [h3.c 上游说明](https://github.com/antirez/h3.c) 单独构建的 `h3` 和 MiniMax-H3 权重。模型权重和生成视频不会随代码分发。

```sh
cd tools/h3-video-studio
cp config.example.json config.local.json
```

在 `config.local.json` 设置：

```json
{
  "h3_bin": "/absolute/path/to/h3",
  "model_dir": "/absolute/path/to/MiniMax-H3",
  "data_dir": "data",
  "host": "127.0.0.1",
  "port": 8190
}
```

也可用 `H3_BIN`、`H3_MODEL_DIR`、`H3_STUDIO_CONFIG` 环境变量配置。启动：

```sh
python3 studio.py
```

打开 `http://127.0.0.1:8190`。生成数据在 `data/`，本地配置文件不会进入 Git。

## 限制

- 当前只上传图像参考；视频和音频参考、拖拽排序、命名提示词、收藏、批量分镜尚未实现。
- 队列在应用重启后会继续排队任务；中断中的生成会回到队列头从头重跑，不支持扩散过程续算。
- 暂无本机 `h3.c` 和模型权重时，界面仍能启动，但生成任务会说明需要配置引擎。
- 尚未在目标机器运行真实 H3 生成；画质、耗时、内存和取消响应都待本机验证。
- 当前是本地个人工具，未加入账号、上传鉴权或远程访问。
