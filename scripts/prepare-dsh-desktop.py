#!/usr/bin/env python3
"""Copy the user-requested non-commercial dsh-pet pack, preserving source hashes."""
import hashlib,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent.parent/'ref/dsh-pet/dsh-pet/assets/webm'
ASSETS=ROOT/'assets/dsh-pet-desktop-v1'
WEB=ROOT/'MALFOY-ENGINE/web/live2d/dsh-motion'
ACTIONS={
'idle':('待机呼吸休闲','发呆'), 'walk':('螃蟹走路','散步'), 'wave':('点击回应-元气挥手','挥手'), 'drag':('被鼠标拖拽悬空反馈','拎起来'),
'sleep-in':('睡觉-开始','准备睡觉'), 'sleep':('睡觉-循环','睡觉'), 'wake':('睡觉-起来','起床'), 'thinking':('工作状态-思考冒泡','想事情'),
'working':('写代码','写代码'), 'success':('工作状态-雀跃庆祝','庆祝'), 'dance':('可爱宅舞','跳舞'), 'sway':('轻快摇摆舞','摇摆舞'),
'stretch':('超大伸懒腰','伸懒腰'), 'snack':('大口吃零食','吃零食'), 'cat':('撸猫','撸猫'), 'magic':('凭空生花','变朵花'),
'bubbles':('鲸鱼吐泡泡特效','吐泡泡'), 'shy':('点击回应-害羞惊讶','害羞'), 'happy':('点击回应-开心跃动','开心'), 'game':('原地专心玩魔方','玩魔方'),
'flute':('吹笛子','吹笛子'), 'reading':('轻快记录','做笔记'), 'look':('东张西望','张望'), 'whale':('蓝鲸现世','小鲸鱼')}
notice='''# dsh-pet 桌面动作包

按用户 2026-11-01 授权，复用 PC2005-cloud/dsh-pet 的透明动画用于本地非商业伙伴。
上游：https://github.com/PC2005-cloud/dsh-pet
代码 MIT；动画/提示词/源视频允许开源使用，禁止商用，公开二创须附原作者 GitHub 地址。
形象为社区二创 DeepSeek「大肥鱼」，非 DeepSeek 官方，非澜原创资产。
原型「溟月」：B站 @上善无形 https://space.bilibili.com/4456176
DeepSeek 版设计：B站 @ZipZipPipe https://space.bilibili.com/4168597
形象：CC BY-NC-SA 4.0 https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans
上游声明：https://www.bilibili.com/opus/1247156596114456581
本包仅接入本机非商业版本；公开发布仍需项目整体素材审计，并保留署名与相同方式共享条件。
源文件不修改；静音播放，动作不是澜的原创原画。manifest 记录原路径及 SHA256。
'''
for d in [ASSETS,WEB]: d.mkdir(parents=True,exist_ok=True)
rows={}
for key,(name,label) in ACTIONS.items():
 src=SOURCE/(name+'.webm'); dest=ASSETS/(key+'.webm');shutil.copy2(src,dest);shutil.copy2(dest,WEB/dest.name)
 rows[key]={'file':dest.name,'label':label,'sourceFile':src.name,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size}
data={'source':'https://github.com/PC2005-cloud/dsh-pet','revision':'8ad3d957f83052d332f0d0f09e90993e9756d2ec','license':'Animations non-commercial; character CC BY-NC-SA 4.0','actions':rows}
for d in [ASSETS,WEB]:
 (d/'manifest.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');(d/'NOTICE.md').write_text(notice)
print(f'{len(rows)} actions; {sum(r["bytes"] for r in rows.values())/1024/1024:.1f} MiB; copies match source')
