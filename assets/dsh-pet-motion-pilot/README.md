# dsh-pet 动作隔离样本（非商业内部试验）

本目录从本机 `/Users/exasdwyh/Documents/VScode/ref/dsh-pet/dsh-pet/assets/webm/` 复制 8 条透明 WebM，覆盖待机、移动、点击、拖拽、睡眠三段与工作思考。仅用于**动作/播放链路对照测试**；没有接入 `MALFOY-ENGINE`、构建脚本、`dist/` 或任何公开包。复制前后逐文件 SHA-256 相同，`ffmpeg` 全部解码通过；`ffprobe` 报 VP9、640×360、`ALPHA_MODE=1`，**不等于已经用 Electron 验过透明/循环/听感**。逐文件哈希见 [manifest.json](manifest.json)。

## 上游授权与署名

- 来源：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，作者 PC2005-cloud；[代码 LICENSE](https://github.com/PC2005-cloud/dsh-pet/blob/main/LICENSE) 为 MIT。
- [上游 README「许可」](https://github.com/PC2005-cloud/dsh-pet#许可)写明：动画/提示词/源视频“允许开源使用，禁止商用”；基于项目的公开二创/换皮须附原作者 GitHub 地址。
- 同页标注形象为社区二创 DeepSeek「大肥鱼」，原型由 B 站 @上善无形、DeepSeek 版由 B 站 @ZipZipPipe 设计；形象为 **CC BY-NC-SA 4.0**（署名、非商用、相同方式共享）。角色**不是澜的原创资产，也不是 DeepSeek 官方形象**。公开发布前进一步核实上游声明原文和素材具体权利/署名/相同方式共享范围；本目录不能自动当作公开发行许可证明。未来商业版必须换成独立授权的原创动作。

## 后续操作边界

1. 先在隔离预览中实测 8 条的透明、首尾、睡眠三段、角色观感；标清“上游角色测试素材”，不称作澜。
2. 若用户认可**非商业公开**采用该形象，再逐项核对 CC BY-NC-SA 条件、上游视频的权利链与 NOTICE 署名，然后在打包清单中明确包含或排除；未经这一步不进入产品包。
3. 需要保留澜的独立身份时，仅借动作设计、状态触发及过渡结构，基于澜获授权的原画/模型重做动画，不把参考角色涂蓝改名。
