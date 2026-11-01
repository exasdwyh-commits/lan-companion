# 桌面扩展序列帧 · DESKTOP-MOTION-21

形象依据当前 dsh-pet 待机第1秒（reference-idle.png），上游、作者及非商业/相同方式共享声明见 ../NOTICE.md。
使用内置 imagegen 工具（未使用 CLI/API fallback），透明背景，各动作单独生成。原始 PNG 保留，不做换脸或重绘裁剪；准备脚本仅切格、统一透明画布与 VP9 编码。

## 提示词

共同约束：exact reference character identity and illustration style; blue-haired two-head-tall whale maid, fin ears, lace headband, navy dress, whale apron, same face/body scale; true transparent alpha; 4 columns × 2 rows; eight equal square cells; no labels, grid, background, shadow or cropped body; whole character centered in each cell.

- reading-sheet-v1.png：standing holding open cream book with both hands, eyes follow page, blink, slight head tilt, right hand lifts page, page turns, settles, returns. No pen/writing.
- sit-sheet-v1.png：sitting on invisible horizontal window ledge, upright torso, thighs supported, knees bent, lower legs dangling forward, hands beside hips; blink, slight leg swings/head tilt. No rendered chair/window; not squatting.
- shunguai-sheet-v1.png：neutral → left arm + left leg forward → accent → neutral → right arm + right leg forward → accent → neutral → anticipation. Result failed direction check (all kicks left); NOT USED.
- shunguai-sheet-v2.png：edit v1; top row neutral/leftward kick/high leftward kick/neutral; bottom row MUST mirror the silhouette for rightward kick/high rightward kick/neutral/next anticipation. Both arm and leg of same side point forward. Keep identity/costume, transparent 4×2 layout. Runtime order in generated.json excludes redundant anticipation and repeats intermediate poses to return to neutral.

## 派生与验收

运行 `python3 scripts/prepare-dsh-generated.py`，再运行 `python3 scripts/prepare-dsh-desktop.py`。640×360 alpha VP9，统一脚底330，坐姿臀部270；PNG→裁格→284px→透明补画布不生成中间姿态。

这是低帧率序列动画：读书/坐姿3fps，舞蹈8.8fps（左右节拍约132BPM）。v2已检查左右同侧踢腿；未证明复刻抖音原视频的完整舞步、连续顺滑动作或人声同步。细部与原版视频可能有轻微造型差异。图集第2排少量裙边/尾部贴近格界，下一批优先增加安全边距与过渡帧。

## DESKTOP-MOTION-22 · 16组补充图集

继续使用同一 `reference-idle.png`，每组独立调用内置 imagegen，真透明4列×2行，共8幅顺序姿态；2:1横向原图1774×887。要求同脸、蓝长发/鳍耳、深蓝女仆裙、白头饰、鲸鱼围裙、约二头身；站姿脚底约格高88%，四边留安全距离；第一/末帧回到相似中性姿态。原 PNG 保留。

| key / 原图前缀 | 动作要求 |
|---|---|
| sad | 委屈：眉头抬起、垂眼、轻轻吸鼻，不夸张大哭 |
| cry | 擦眼泪：眼泪积起滑落、衣袖擦脸、呼吸平复 |
| smug | 小得意：叉腰、抬下巴、挑眉、满意点头 |
| confused | 歪头疑惑：不对称眉、左右观察、歪头与眨眼 |
| heart | 比心：双手胸前组成心、脸红微笑、放下 |
| hug | 求抱抱：向观看者展开双臂、张开掌心、期待前倾再回位 |
| kiss | 飞吻：手移嘴边、送出一颗蓝色小心心、回位 |
| nod | 点头：下巴明确下点/抬起，身体固定 |
| shake-head | 摇头：脸朝左/右/正中，身体固定 |
| tea | 喝茶：白色蓝鲸杯、举杯小口喝、满足、放低 |
| phone | 看手机：左手蓝手机、右手划屏、视线与眨眼 |
| draw | 画画：速写本与铅笔、手腕画鲸鱼、看看作品、微笑 |
| cheer | 给你加油：小拳头贴脸旁交替举起、点头，不加啦啦球 |
| apology | 鞠躬：双手放围裙前、上身约20度行礼、起身 |
| sneeze | 打喷嚏：手帕遮鼻、一次低头喷嚏、羞涩眨眼 |
| umbrella | 撑伞：整把深蓝伞留在格内、轻移/眨眼，不画雨或背景 |

各原图为 `<key>-sheet-v1.png`。机器可读的动作提示摘要/帧序/fps/分类见 `spec.json`，输出与来源哈希见 `../generated.json`。新16组采用4fps、8帧×3次，约6秒；切格不创造补间帧。观察结果：脸/服装/配色一致，动作可区分；少量线条、头部比例与原视频仍有差异，低帧率带序列感。不要称作16条高帧率连续视频。完整8格检查联系图在本任务 benchmarks 的 generated-a/b.jpg。

## 顺拐舞原哼唱

用户2026-11-01明确选择抖音参考视频原哼唱。原视频为香菜鱼丸子《鲸鱼娘和gpt的日常》：https://www.douyin.com/video/7695469152915747574 （原短链 n25o_yaC3DY）。通过Ego Lite打开公开页面并提取可播放媒体地址，保存 `shunguai-reference-7695469152915747574.mp4`；不是重合成或克隆声音。

完整原音抽取到 `../shunguai-hum.m4a`，AAC128k，约15.07秒，仅加短淡入/淡出。旧合成音保留为可追溯备份，默认使用 reference。源视频和两音轨哈希/时长/制作记录见 `../special-idle.json`。音频的再分发授权未核实，不属于角色美术的CC许可；本批只集成本机版本，未推送公共仓库。
