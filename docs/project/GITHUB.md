# GitHub 公开源码快照

目标仓库：[exasdwyh-commits/lan-companion](https://github.com/exasdwyh-commits/lan-companion)。用户于2026-11-01明确授权改为公开；当前为公开源码快照，没有安装包 Release。

## 上传范围

- 当前 Electron 主线、完整小屋源码与运行素材（包括当前GLB/蒙皮数据、游戏、相框图）、桌面播放器及24段dsh-pet动作。
- Swift迁移参考、测试、脚本、项目文档、已选桌面动作真源与素材来源元数据。
- 排除原始大视频/建模工程、模型权重、依赖安装、本机App、个人设置/密钥/记忆/会话、基准测试运行目录及历史证据截图。
- 不上传旧Git历史，避免把历史大文件或未经审核的旧内容带入远程；本地原HEAD、暂存区及未提交工作保留。

这是开发源码快照，不是完整本机备份，也不是可独立安装的App发行包。部分文档引用的本地原始素材/历史截图未上传。构建当前仍依赖本机 `SmartCompanion.app` 和本地媒体/模型服务；干净机器的一键构建尚未实现。

## 查看小屋

```bash
git clone https://github.com/exasdwyh-commits/lan-companion.git
cd lan-companion
python3 -m http.server 8947 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8947/MALFOY-ENGINE/web/moli-room/?lang=zh`。这个浏览器入口可看场景和原有小游戏；聊天、个人相册与书库、召回桌面需要Electron宿主及相应服务，不能以网页预览代替原生验收。

## 继续同步

在原开发仓库执行：

```bash
python3 scripts/github-snapshot.py             # 生成清单，扫描候选文件
python3 scripts/github-snapshot.py --commit    # 独立临时索引，更新本地 github/main
# 确认目标为自己的目标仓库后推送；不需要force
# git remote -v
# git push origin github/main:main
```

脚本只准备提交、不联网、不替换当前HEAD和暂存区；快照分支后续沿自己的提交历史追加。清单/排除原因/源码哈希与提交证据在 `.build/github-snapshot/`（不入库）；潜在凭据命中时停止，日志仅给路径/行号/规则，不打印内容。不要把本地原主分支直接推送到这个快照远程。

## 许可与发行边界

- 没有为整个混合项目擅自附加统一开源许可证。
- 小屋按上游 [LICENSE](../../MALFOY-ENGINE/web/moli-room/LICENSE) 保留CC BY-NC 4.0及署名；代码/音乐/美术依各自原说明。
- dsh-pet动作按 [NOTICE](../../assets/dsh-pet-desktop-v1/NOTICE.md) 保留原作者和CC BY-NC-SA 4.0非商业说明；不能声称为澜原创。
- 其他第三方代码和运行组件保留原有许可。用户图、生成角色、参考图与音色不因为源码上传而获得公开再分发许可。
- 仓库公开不改变各素材的原始许可；不能因源码可见就将第三方图、模型、音色或动画用于商业再分发。安装包发行另行处理。
