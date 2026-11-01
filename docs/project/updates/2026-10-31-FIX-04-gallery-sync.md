# 2026-10-31 · FIX-04 · 相册与剧情页关系实时刷新

## 归属与范围

- Codex / BMAD 安装与修复聊天；用户要求选择能与其他 agent 并行的优化。
- 开始前核对任务表：DW-03 素材/窗口、DW-04 Q 版、DW-05 读书/唱歌仍在推进；FIX-04 尚未领取。先登记页面与测试归属，再实施。
- 负责 `MALFOY-ENGINE/web/live2d/gallery.js`、`Tests/gallery-interaction.test.cjs`；项目文档只更新本任务条目与交付索引。保留他人修改。
- 消费已有 `onAffection` 和 `gallery.state`，不修改 main/preload、素材、结算后端、构建脚本或 dist；本聊天未构建、重启 App。

## 改动

1. 打开相册后订阅已有关系通知，重新获取主进程权威视图；别处加好感后，不用关窗重开就能更新解锁卡片及可访问的章节。
2. 通知只触发读取，不执行剧情动作、不加好感。连续通知合并为一个进行中的请求和一次后续补读；启动加载期间收到通知也不会丢失。
3. 剧情/保存请求进行中延后后台刷新。用状态版本丢弃早于剧情操作或新通知的响应，防止旧视图覆盖刚完成的动作。
4. 保留当前剧情幕次、A/B 选项焦点与错误提示；保留灯箱照片 ID、手机/电脑规格、保存反馈与焦点。列表更新后重新绑定关闭灯箱时的返回焦点。
5. 如果降低好感导致正在查看的照片重新锁定，关闭灯箱并把焦点交回可访问卡片。
6. 后台刷新失败保留可见内容、提示错误，下次通知重试；成功只清理对应的后台错误。页面关闭后忽略未完成响应与后续通知；宿主若提供解绑函数则调用。

## 验证

| 操作 | 结果 | 证据与边界 |
|---|---|---|
| 原有页面交互回归 | 6/6 | [baseline.tap](../../../benchmarks/2026-10-31-FIX-04/baseline.tap) |
| 加同步用例后、修复前 | 首批 15 项中 7 通过、8 失败，复现缺少订阅/刷新 | [before.tap](../../../benchmarks/2026-10-31-FIX-04/before.tap)；其后另补初始化通知与重新锁定两项边界 |
| `node --test Tests/gallery-interaction.test.cjs` | **17/17**，含原有 6 项与新增 11 项 | [after.tap](../../../benchmarks/2026-10-31-FIX-04/after.tap)；真实页面脚本 + 真实内容适配/关系/剧情状态机，DOM/通知通道为替身，数据仅在临时目录 |
| `node --test MALFOY-ENGINE/test/gallery.test.js MALFOY-ENGINE/test/content-pages.test.js MALFOY-ENGINE/test/affection.test.js` | **26/26** | [backend-regression.tap](../../../benchmarks/2026-10-31-FIX-04/backend-regression.tap)；本轮读取到其他 agent 已收口的数量测试，前次 FIX-01 的两处旧断言失败不再出现；本聊天未改这些后端测试 |
| `bash scripts/project.sh check` | **88/88，0 错误** | [project-check.txt](../../../benchmarks/2026-10-31-FIX-04/project-check.txt)；只读静态检查 |

## 边界与交接

- **源码与隔离逻辑验证完成，尚未由本聊天打包和验收原生窗口。** 下次统一构建应包含本轮 gallery.js；随后用临时数据实际操作“一个窗口增加好感 → 已打开的相册更新”，并验灯箱、剧情 A/B/重看与系统保存框。
- 当前 preload 的 `onAffection` 没有返回显式解绑函数。本轮不占用 DW-05 的 preload 文件，采用页面关闭后禁用处理，并兼容将来返回的解绑函数；没有宣称已经补完 preload 级的主动解绑。
- R2 奖励故障恢复仍是独立待办；本轮未改奖励与数据格式。其他 agent 可继续处理后端、音频、Q 版、素材及发布。
- 文件写入在本任务收尾后释放；STATUS、TASKS、CHANGELOG 与修复规划同步本轮结果。
