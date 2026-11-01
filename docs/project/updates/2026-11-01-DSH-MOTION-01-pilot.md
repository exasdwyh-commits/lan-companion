# 2026-11-01 · DSH-MOTION-01 · dsh-pet 动作隔离样本

## 归属
- 负责人：Hermes 002 / 本聊天。用户建议桌面互动人物动作可从 dsh-pet 提取。
- 本轮只负责 `assets/dsh-pet-motion-pilot/`、`docs/project/{INTEGRATION-REF,LAN-COMPANION-REBUILD-PLAN,TASKS,STATUS,CHANGELOG}.md` 和本记录。未动 `main.js/preload.js/world.html/build-companion.sh/dist/`，未抢占 DW-04 写入权。

## 实际做了什么
- 从本机 `ref/dsh-pet` 的 commit `8ad3d957f83052d332f0d0f09e90993e9756d2ec` 提取 8 条 VP9 WebM：待机、螃蟹走路、挥手、拖拽、睡眠开始/循环/起来、工作思考。动作独立存放，并写 `manifest.json`（每条 SHA-256）与 `README.md`（上游署名和许可）。
- 校正此前 `INTEGRATION-REF.md` 的“动画一律不可搬”过严口径。上游 [README 许可段](https://github.com/PC2005-cloud/dsh-pet#许可)明确代码 MIT、动画/提示词/源视频允许开源使用但禁止商用、公开二创需署名；所用形象另标 CC BY-NC-SA 4.0，原型/二创设计者另有署名。非商业内部提取可行，不自动证明发布权利链全部清楚。
- **用户设定“澜即小肥鱼”并不自动等于上游“大肥鱼”形象可直接作为澜的原创正式资产**。如未来非商业试玩要用这套角色，先核视频来源、形象协议的适用范围、署名与相同方式共享、发行包整体许可证；将来商用必须替换为原创/另获授权的动作。

## 验证
- 本机 8 条逐文件复制前后 SHA-256 一致；全部 `ffmpeg -v error -i <file> -f null -` 解码退出 0。`ffprobe` 逐文件读取 VP9/640×360/`ALPHA_MODE=1`；这不是 Chromium 实际透明播放、角色观感、睡眠接缝验证。
- `manifest.json`：8 条哈希与文件 8/8 匹配，合计 3,281,816 字节，来源 revision `8ad3d957f83052d332f0d0f09e90993e9756d2ec`；`bash scripts/project.sh check`：93/93、错误 0、待办提示 6；`git diff --check` 退出码 0。
- 文件仅在资产隔离目录；未进现行构建清单、未运行 App、未公开发布，也未完成对角色接受度的视觉验证。

## 后续交接
- DW-04/素材负责人先在隔离预览用 Ego Lite 核透明、循环/睡眠三段和 180px 观感，再决定是否在**非商业测试版**接入；接线前明确主舞台文件写入权。若要保持澜的独立原创形象，只参考动作时序和触发逻辑，不给上游画面换名冒充澜。
- 公开包构建审计要显式排除本样本，除非授权、署名和分发决策逐项签字确认；不应将隔离研究目录随 `git add .` 一起公开。
