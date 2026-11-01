# 2026-11-01 · PLAN-LAN-01 · 自主共创伙伴改造交接

## 归属与范围
- 负责人：Hermes 002 / 本聊天。
- 负责文件：新增 [整体改造方案](../LAN-COMPANION-REBUILD-PLAN.md)，更新 `docs/project/{README,TASKS,STATUS,CHANGELOG}.md`。本轮还曾修改项目父目录的 `AGENTS.md` 中旧轮回瓶/隔离口径；后续补充该文件的审批未获回应，已停止再写。
- 未修改 Electron 运行代码、内容包、角色资产或 `dist/`；未接管 WorkBuddy 或其他 agent 的共享文件写入权。

## 文档完成内容
- 将用户已批准的澜=小肥鱼、被打回原形、异界结契伙伴、开放苦修/躺平、非商业首版与双空间保留，整理成明确的现行/提案/历史边界。
- 给出 P0 基线验收和事实风险、P1 自主角色/事件/共创/小屋痕迹、P2 许可与第三模式研究的依赖图、文件归属、测试门槛和失败回退。
- 指出 `lib/journey.js` 会补造关机期间旅行；`web/moli-room/` 当前原版茉莉是临时占位，用户已否定程序拼接鲸鱼娘；旧 `VIDEO-PLAN.md` 只供追溯。`TASKS.md` 中仍可执行的“关联轮回瓶剧情”已纠正。

## 验证
- `bash scripts/project.sh check`：93/93、错误 0、待办提示 6；`git diff --check`：退出码 0。
- 文件/入口核验：`doc_files=6/6`、`entry_link=True`、`task_link=True`、`handoff_link=True`。陌生 agent 只读试读找到的执行冲突已修正于 README/TASKS/STATUS 和总方案；历史交付行仍保留原始记录。
- 此次只做文档，不以静态检查冒充真实书籍朗读、双空间、剧情或小屋验收。

## 接手顺序
1. 新 agent 先读 `../AGENTS.md`、[README](../README.md)、[PRODUCT](../PRODUCT.md)、[STATUS](../STATUS.md)、[TASKS](../TASKS.md)、[改造总图](../LAN-COMPANION-REBUILD-PLAN.md)。
2. 在 TASKS 领取一个纵向切片，确认 `main.js/preload.js/world.html` 的单一写入负责人；个人数据仅用显式隔离目录。
3. 每片保留源/包/入口/服务/视觉或听感的证据层级；提交交付记录并更新 STATUS 与 CHANGELOG。
