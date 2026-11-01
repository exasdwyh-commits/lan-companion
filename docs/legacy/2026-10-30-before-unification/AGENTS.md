# 项目开发约定

## 唯一主线

- 工作区：`/Users/exasdwyh/Documents/VScode/vidu`。
- 当前开发目录：`desktop-companion/`，Swift target 为 `PetDesk`。
- 当前构建：`bash scripts/build-whale-video.sh`；产物：`dist/WhaleVideoCompanion.app`。
- 先读 `desktop-companion/README.md`、`docs/DEVELOPMENT.md`、`docs/ASSETS.md`。
- `Sources/LingDesk`、其他 `.app`、马尔福工程和云端直播工程都是并行/历史路线。修改前确认任务确实涉及它们。

## 实施

- 优先稳定、简单、可维护。沿用 PetController / StageView，不另建一套桌宠播放器或复制一份工程。
- 素材单一真源为 `assets/`；运行包只从 `assets/whale-video-test` 构建。不要直接修改 `dist/*.app/Contents/Resources`。
- 保留原视频；新处理结果使用新文件名。导入素材时复制到项目，不能只引用 Downloads 或系统临时目录。
- 保留 LiveTalking 相对位置：TTS 当前使用 `../LiveTalking/.venv/bin/python`。跨机器依赖尚未打包。
- 用 `LINGDESK_DATA_DIR` 隔离测试数据；不要打印、复制或提交个人 `settings.json`、密钥、聊天历史。
- 此目录目前没有 Git，不要声称已提交或已同步远程。
- 多个 agent 共用工作区时先明确文件归属，保留他人修改，不覆盖未知改动。

## 视觉与验证

- 形象为同一个年轻成年、真人写实鲸鱼娘：蓝长发、鲸鳍耳饰、蓝白银服装，不改成二次元。
- 待机动作以自然呼吸、眨眼、理发、安静休息为主，避免重复晃肩。
- 睡眠视频是整幅场景；当前没有躺下/起身过渡。循环处理或检查通过不等于观感无瑕疵。
- 修改播放器/状态机时运行 `bash scripts/check-whale-modes.sh`；其他变更按影响范围选择检查，见开发交接。
- 向用户说明真实改动、已验证内容和剩余限制；不要把 fixture 通过说成真实模型验收。
