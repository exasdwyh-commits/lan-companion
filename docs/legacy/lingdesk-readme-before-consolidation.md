# LingDesk 桌宠

macOS 原生桌宠客户端：本地 LLM 生成回复，LiveTalking 生成带语音的口型视频，再播放。
新设置默认 `saytts + Tingting`（macOS 系统语音）；手动选择的 `edgetts` 需要联网。
模型与素材准备完成后，系统语音模式可在本机运行。

## 启动

```bash
open dist/LingDesk.app
```

口型引擎不在运行时，桥会自动启动。关闭桌宠会停止由它启动的引擎；手动启动的引擎保留。
本地聊天服务需要先运行，默认地址 `http://127.0.0.1:11434/v1`，模型名在设置中选择。
可先运行 `python3 scripts/doctor.py` 检查本机环境。

`LingDesk.app` 依赖这个工作区里的 `LiveTalking/.venv`、模型和桥脚本，当前不是独立分发包。
保持在 `dist/` 中运行；移动后需在设置中填写 Python 和桥脚本路径。

## 素材与角色绑定

在桌宠菜单中导入文件夹，至少包含 `character-master.png` 或 `idle-01.mp4`。
只有静态头像的素材包也能播放生成的回复视频。

| 文件 | 用途 |
|---|---|
| `character-master.png` | 主形象与兜底静图 |
| `idle-01.mp4` | 待机循环，可选 |
| `character.json` | 绑定同一个 LiveTalking 说话形象 |

`character.json` 示例（对应资产需已存在于 `LiveTalking/data/avatars/`）：

```json
{"schema_version": 1, "engine_avatar": "desk_muse_1"}
```

导入时会同步角色标识。没有绑定的素材包采用系统朗读，避免沿用上个角色的口型视频。
该绑定验证标识，不识别人脸；请确保素材和引擎资产确实是同一个形象。

生成一套待机素材并创建对应 MuseTalk 形象：

```bash
python3 scripts/make_starter_pack.py --muse-avatar desk_muse_1 --install
# 换自己的照片
python3 scripts/make_starter_pack.py --image ~/Pictures/me.png --muse-avatar my_face --install
```

个人照片原图不会被去水印滤镜修改。上游 demo 素材仅用于本地技术测试，商用前需核实授权。

## 音色与引擎

设置中更换音色会重建会话；复用引擎进程时也会按会话传入角色、TTS 和音色。
旧设置显式选择的联网音色会保留；缺少 TTS 字段的旧设置使用系统语音。

- `saytts`：`Tingting`、`Meijia`，取决于本机已安装的系统语音。
- `edgetts`：`zh-CN-XiaoxiaoNeural` 等，需要联网；网络预检失败会提示改用系统语音。
- 网页原型/CLI 还可显式配置 `kokorotts`，需要相应依赖和权重。

手动启动默认也使用系统语音：

```bash
./scripts/start_engine.sh
TTS=edgetts VOICE=zh-CN-XiaoxiaoNeural ./scripts/start_engine.sh
AVATAR_ID=my_face ./scripts/start_engine.sh
```

同一端口不能混用 MuseTalk 与 wav2lip 模型。桥会验证正在运行的引擎模型，配置不符会报告错误。

## 编译与检查

```bash
bash scripts/build.sh
bash scripts/check_core.sh
../LiveTalking/.venv/bin/python -m unittest discover -s Tests -v
```

构建脚本包含 `--disable-sandbox` 和本地临时签名。当前 Command Line Tools 环境没有 XCTest；
`check_core.sh` 直接编译并执行 Swift 检查，覆盖真实桥进程重连、故障恢复和退出竞态。
Python 检查包含本地 HTTP 测试，需要允许本机监听端口。

可选真实验收（会运行已安装的 LLM/口型模型，不下载、不调用云 API；临时聊天数据库）：

```bash
../LiveTalking/.venv/bin/python scripts/verify_live.py
```

2026-10-29 本机验收与已知边界见 [修复记录](benchmarks/fixes-2026-10-29/REPORT.md)。
短句两音色各约 8.7 秒出片，取消约 0.1 秒，这是特定模型与本机单次测量，不是延迟保证。

## 实现与数据

桌宠和 `LiveTalking/make_clip.py`、网页服务共用 `scripts/engine_bridge.py`：
同一条语音驱动口型并随视频录制，不再二次配音。取消会中断任务、收尾录制并丢弃晚到结果。
缓存键包含文本、模型、音色、TTS、角色和角色资产版本；旧无角色缓存不会复用。
`LiveTalking/_mac_port/` 为移植说明和历史快照，不作为当前出片入口。

个人设置和聊天在 `~/Library/Application Support/LingDesk/`，可用 `LINGDESK_DATA_DIR` 覆盖。
设置权限为 0600；素材导入不会覆盖已有素材包。

尚未接入：语音输入、表情控制、桌宠直播推流。嘴部自然度与商用视觉效果仍需单独验收。
