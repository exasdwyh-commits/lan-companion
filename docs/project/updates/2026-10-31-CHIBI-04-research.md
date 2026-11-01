# CHIBI-04 · B 方向与舞蹈/哼唱调优

- 日期：2026-10-31
- 负责人：Codex / 01a191bf-f15d-74a1-bfeb-f1c270e4555e
- 状态：研究、三方向候选与裁切修复完成；用户已选 B；正式新舞蹈/真实人声/Live2D 绑定待后续。

## 需求与结论

用户否定当前顺拐舞和 Q 版效果，要求研究 Live2D、学习哼唱/跳舞，追加两条抖音参考，并选择第二批候选的 B。推荐 B 的精致绘本质感，先统一母图/三视图、在 180px 验收，再制作短舞蹈/真实哼唱，最后完成分层绑模。成本/风险/验收详见 [唯一优化规划](../CHIBI-OPTIMIZATION.md)。

## 改动

- `assets/whale-chibi-style-v1/dance/source.json`：确认 PNG 实际 4×3、旧 4×2 跨排；只更新下两排 8 个完整双腿角色的取样坐标，排除鱼尾替腿第一排。原图字节不动，旧 metadata 存在本轮证据。
- `MALFOY-ENGINE/web/live2d/chibi-dance.js`：统一脚本重新派生；PNG/旧音频不变。
- `Tests/test_chibi_dance_asset.py`：真实 PNG alpha 连续行回归，旧 rect 可以检出双角色；当前 8 幅采样均单角色。
- `assets/whale-chibi-directions-2026-10-31/`：两批候选与用户 B 选择记录，新增 `B-master-v1.png` 透明母图候选，人工检查完整身体/双腿/尾巴；多尺寸与多动作一致性待验。均不进入构建。
- 更新项目 README、STATUS、TASKS、CHANGELOG、style-v1 历史 QC 更正；新增优化规划。
- Hiyori 参数探针当前可读，无需凭旧报告修改 `live2d-poc.js`。

## 当前验证

| 范围 | 当前证据 |
|---|---|
| 工程约定 | project.sh check 88/88，6 个既有待办，见本轮 project-check.log |
| 舞蹈状态 | 8/8；其中含派生一致性与音频让位纯逻辑 |
| 表演/脸/骨骼 | 8+11+11 = 30 项 |
| 真实图像裁切 | 2/2；当前单角色 + 旧串格可检出 |
| Ego 页面 | 两段抖音视频 readyState=4、约 15 秒；3 秒造型和 7/9/11/13 秒舞蹈截图已人工检查 |
| Ego Live2D | loaded=true，angleX/angleY/mouthOpenY/eyeLOpen 当前有数值且变化；不替代澜模型 |
| Ego 主线预览 | scene=dance，renderer=dance-atlas-webgl，error=null；截图完整单角色 |

证据：[benchmarks/2026-10-31-CHIBI-04](../../../benchmarks/2026-10-31-CHIBI-04/)。

## 明确边界

- 当前裁切只是止住串格；现有帧仍大量重复同侧姿态，不代表完成用户参考舞步。
- 未下载/分析参考音轨，无实测 BPM/旋律，未制作新哼唱。保留的合成音不能称为角色真实歌声；后续用真人/歌声干声加现有 Seed-VC，再以实际音频时钟同步动作。
- 本轮未重建/重启 App、未改个人数据或 DW-05 音频调度、未修改 Swift。
- 新图是视觉候选，未作为分层 PSD/.moc3 交付；角色、第三方参考与 SDK 的公开分发条件分别核对。
