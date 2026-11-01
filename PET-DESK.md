> 历史/专题资料（2026-10-30 已统一）：当前方向、主线、状态与任务以 [统一项目中心](docs/project/README.md) 为准。下文保留原阶段记录，其中数量、运行入口和完成结论需按现状复核。

# 桌面宠物（PetDesk）

一个常驻桌面、能被点、会说话的桌宠。素材用 Malfoy 那套绿沙发场景，1080p 重压过，
六段加起来 16MB。

内容（台词、动作、章节、相册、解锁阈值）全在素材目录的 `pack.json` 里，
换角色只换素材和这份配置，不动代码。

```bash
./scripts/build-pet.sh          # 打包到 dist/PetDesk.app
open dist/PetDesk.app           # 双击也行
```

菜单栏有个 ✨ 图标可以把它找回来，右键桌宠本身有完整菜单。

## 能做什么

| 操作 | 反应 |
|---|---|
| 单击 | 播一段「被摸到」的动作，随口应一句（本地台词，不花钱），好感度 +1（45 秒冷却） |
| 双击 | 弹出输入条，回车把话发给模型，回复逐字冒出来 + 系统语音念 |
| 拖动 | 挪位置，松手记住，下次还在那儿 |
| 右键 | 说话 / 静音 / **相册** / **剧情** / 放大缩小 / 设置 / 忘掉对话 / 隐藏 |
| 菜单栏 ✨ | 显示隐藏 / 相册 / 剧情 / 设置 / 退出 |
| 搁着不管 | 每 14–26 秒随机播一个小动作；五分钟没人理就「睡着」——
睡姿播到第 5 秒就**定格**，不循环（循环的呼吸一眼就假） |
| 悬停 | 右上角出现静音和关闭 |

### 好感度怎么涨

| 途径 | 值 | 限制 |
|---|---|---|
| 摸她 | +1 | 45 秒冷却，连点十下也只算一次 |
| 聊天 | +1 | 20 秒冷却（这一条是故意的：不加冷却就能连发「嗯」刷满） |
| 每天第一次见面 | +3 | 一天只算一次 |
| 看完一章剧情 | +10 | 同一章只算一次 |

它驱动四件事：相册解锁、章节解锁、她对你的称呼（转校生 → 你 → 笨蛋）、
解锁时左下角状态条提示一次。

## 接模型

设置面板（右键 → 设置…）填三样：**服务地址**、**模型名**、**API Key**。

只要对方是 OpenAI 兼容的 `/chat/completions`，就能用：

| 想接的东西 | 服务地址 | 模型名 |
|---|---|---|
| **本机 Ollama（当前在用，零成本）** | `http://127.0.0.1:11434/v1` | `deepseek-r1:7b` |
| SenseNova（快，要余额） | `https://token.sensenova.cn/v1` | `sensenova-6.8-flash-lite` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenRouter 上的 Hermes | `https://openrouter.ai/api/v1` | 该模型页上的 id |
| 本机 vLLM 跑 Hermes | `http://127.0.0.1:8000/v1` | 启动 vLLM 时 `--model` 的名字 |

本机地址（`127.0.0.1` / `localhost`）会自动绕过系统代理——开着梯子时直接访问
本地端口会 502，这条在代码里判断了。DeepSeek / MiniMax 试过都因余额不足 402，
所以默认落在本地 Ollama 上：**一分钱不花，代价是首次回话要等模型热起来**。

点「测试连接」会真的去拉 `/models`，连不上会直接说原因。

密钥只写进 `~/Library/Application Support/LingDesk/settings.json`，权限 0600，
不写日志、不进对话记录。要换成 Keychain 是下一步的事。

### 推理型模型的坑（实测踩过）

`sensenova-6.8-flash-lite` 这类模型**先写思考、再写正文**，两者共用一个输出额度。
额度给小了会出现「响应 200 但 `content` 字段整段缺失」——看着像服务坏了，其实是
思考把预算吃光了。代码里已经能分辨：只拿到 `reasoning` 没有 `content` 时，
提示「思考把额度用完了」，而不是笼统地说「模型没回答」。

选型建议：**桌宠要的是快**。带思考的模型回一句要 4–5 秒，气泡空等很难看；
有非推理的 flash 档就优先用它。

## 语音

桌宠说话走 `scripts/pet_tts.py` 这个常驻 worker（Swift 起一个 Python 进程，
用 stdin/stdout 传 JSON，模型权重只在第一次用时加载，之后一直是热的）。
**引擎有三层，任何一层挂了都会往下掉**，所以不会出现「没声音」：

| 层 | 引擎 | 条件 | 延迟 | 特点 |
|---|---|---|---|---|
| 1 | `qwen3` Qwen3-TTS CustomVoice | 本地 MLX 权重 | 首次 ~13s（含加载），之后 **0.7–2s** | **能演**：预设少女音色 + 情感指令（"撒娇地/委屈地"） |
| 2 | `edgetts` 微软神经语音 | 要联网，免费、不要 key | 1.5–3s | 中文自然；只有语速/音调/音量，**没有情感风格** |
| 3 | `kokoro` 本地 Kokoro-82M | 完全离线 | 0.2–1.5s | 8 个中文音色、**可以混音** |
| 4 | 系统 `AVSpeechSynthesizer` | 永远可用 | 即时 | 机械，兜底用 |

Qwen3 那 13 秒是 2.4 GB 权重的加载，一次性。app 启动 2 秒后会在后台预热，
所以正常聊天时感觉不到；只有冷启动后立刻说话才会撞上。

在 `character.json` 里配：

```json
"speechBackend": "auto",          // auto | qwen3 | edgetts | kokoro | system
"neuralVoice":   "Vivian",        // Qwen3 音色；换 zh-CN-* 就走 edgetts
"neuralInstruct":"温柔、自然，像十八岁的女孩，语速适中，带一点俏皮",
"neuralSpeed":   1.0,             // 0.6–1.6
"neuralPitch":   1.0              // 0.7–1.4，调高更年轻
```

`neuralInstruct` **只有 Qwen3 认**，写什么都行（"委屈地小声抱怨"、"开心、语速轻快"）。
这是目前唯一能改变"演法"的参数——edge-tts 和 Kokoro 都只能调快慢高低，改不了情绪。
换 edgetts 时这个字段会被忽略，不会报错。

`auto` 的完整链路是 **qwen3 → edgetts → kokoro → 系统语音**，任何一层失败自动往下掉。
**实际用的引擎可能和配的不一样**，自检里 `speech.engine` 报的是真实跑通的那个。

⚠️ 光看 `speech.engine == "none"` 分不清「没说话」和「还在加载权重」——
Qwen3 冷启动约 15 秒，早于此时刻的任何快照都会读成 `none`，看起来像坏了。
所以同时看 `speech.pending`：

| engine | pending | 含义 |
|---|---|---|
| `none` | `false` | 确实没触发说话 |
| `none` | `true` | **正在合成，不是失败** |
| `qwen3` | `false` | 已出声，引擎是 Qwen3 |

音色是白名单，不是随便传字符串。查全部：

```bash
python3 scripts/pet_tts.py --list-voices
```

- **qwen3**：`Vivian`（活泼少女，中文）、`Serena`（温柔安静，中文）、`Uncle_Fu` / `Dylan`（北京）
  / `Eric`（成都）（男声，中文），以及 Ryan / Aiden / Ono_Anna / Sohee（英日韩）。
- **edgetts**：`zh-CN-XiaoxiaoNeural`（温柔）、`zh-CN-XiaoyiNeural`（活泼，最像少女）、
  `zh-CN-YunxiNeural` / `YunyangNeural`（男声）等 10 个。
- **kokoro**：`zf_xiaoxiao` / `zf_xiaoni` / `zf_xiaobei` / `zf_xiaoyi`（女）、
  `zm_yunjian` / `zm_yunxi` / `zm_yunxia` / `zm_yunyang`（男）。
  写 `"zf_xiaoxiao,zf_xiaoni"` 就是**混音**（上游做等权平均），
  写 `"zf_xiaoxiao,zf_xiaoxiao,zf_xiaoni"` 近似 2:1 加权。

### 单独试语音

聊天要等模型回复才能听到声音，太慢。直接测：

```bash
./.build/debug/PetDesk --say "你回来啦" --assets assets/whale-video-test --data /tmp/petdata
# → {"backend": "auto", "voice": "Vivian", "engine": "qwen3"}
```

`engine` 字段是**真正出声**的那一层，不是配置里写的那个。想验证降级，把
`LINGDESK_TTS_PYTHON` 指到一个没装 `mlx_audio` 的解释器，`engine` 会变成
`"none"`（此时走系统语音，进程不崩）。

要连贯地验一遍（配置 + 权重 + 模块 + 真出声），跑：

```bash
bash scripts/check-whale-voice.sh     # 约 30 秒，FAIL 时退出码 1
```

这个脚本存在的理由：`auto` 链是 `qwen3 → edgetts → kokoro → 系统语音`，
前三层任何一层挂了都**静默降级**——声音还在，只是从 Vivian 变成微软播音腔。
客户不会看诊断字段，只会觉得「和样品不一样」。

### 文本预处理

worker 出声前会清一遍文本：去 Markdown 符号、**小整数转中文**（"等了3个小时" →
"等了三个小时"）、折叠连续标点。数字只转 0–9999 的整数，百分比/时间/长编号保留
数字——猜错比念得不顺更糟。

### 运行时在项目里（`.runtime/`）

Python 环境和语音权重都不在项目外面，也不依赖隔壁 LiveTalking：

```
.runtime/
  venv-tts/                       Python 3.12 + mlx-audio 0.6.2（1.6 GB）
  models/qwen3-tts/               8bit MLX 权重 2.4 GB —— 对话语音用它
  models/qwen3-tts-fp16-source/   转 8bit 用的原始 bf16 4.2 GB（可删）
```

这些都在 `.gitignore` 里：能重建的东西不进版本库。新机器一条命令复原：

```bash
bash scripts/setup-runtime.sh          # 缺什么补什么，幂等
bash scripts/setup-runtime.sh --check  # 只报告缺什么，不动手
```

查找顺序（都保留旧路径作回退，因为把项目挪到没收口的机器上时，能出声比报错强）：

| 找什么 | 顺序 |
|---|---|
| 权重 | `PET_TTS_MODEL` → `.runtime/models/qwen3-tts` → 旧 `~/.cache/pet-tts/...` |
| 解释器 | `LINGDESK_TTS_PYTHON` → `.runtime/venv-tts` → 隔壁 `LiveTalking/.venv` |

`bash scripts/check-whale-voice.sh` 会把 app 实际用的解释器和权重的绝对路径打出来，
并断言它们都在 `.runtime/` 里——只看 `engine=qwen3` 是不够的，隔壁那套环境同样能出
qwen3，而那正是「换台机器就散架」的原因。

### 权重怎么来的（本机 HuggingFace 不通）

这台机器访问 HuggingFace 全线失败：直连 SSL 报错、代理返回 000、`hf-mirror.com`
也不通。但 **ModelScope 是通的**，同一份权重。所以流程是「ModelScope 下 → 转 MLX」：

```bash
python3 scripts/fetch_qwen_tts.py --out .runtime/models/qwen3-tts-fp16-source
.runtime/venv-tts/bin/python -m mlx_audio.convert \
  --hf-path .runtime/models/qwen3-tts-fp16-source \
  --mlx-path .runtime/models/qwen3-tts \
  -q --q-bits 8 --model-domain tts
```

原始 4.52 GB（bf16），转出来 2.39 GB（8bit）。`scripts/setup-runtime.sh` 就是把这两步
包起来跑，不用手敲。

**权重目录不存在时 worker 会自动降级到 edgetts，不会报错**——声音还在，只是音色变了。
这就是为什么需要 `check-whale-voice.sh` 而不是靠耳朵。

### 音量

桌宠一整天贴在耳朵边说话，按广播响度（-16 LUFS）做太吵了。默认改成：

- 响度目标 **-20 LUFS**（比广播低 4 dB），峰值归一化到 -6 dBFS
- `character.json` 里 `neuralGain` 再叠一层 dB 微调，范围 -30…+12

```json
"neuralGain": -4        // 再轻 4 dB；你嫌吵就往 -8 调
```

## 唱歌（翻唱）

她能唱。点右键 →「唱一首」，或者直接跟她说「唱首歌 / 给我唱一首」。
唱歌时底部会滚动显示歌词，点她一下停。

### 一个人能唱成什么样，先说清楚

**不是「孙燕姿翻唱」那种录音室质感。** 实际听感是「一个少女在哼一首很简单的调子」。
客观指标全过（浊音 70%、跨度 11.5 半音、帧间抖动 0.11 半音、音色相似度 0.883），
但离「以假乱真」还有距离。要当卖点得先自己听一遍，别照宣传词写。

### 为什么不做真·AI 翻唱

拿真人歌手的模型翻唱，同时踩三条权利：**声音权益**（民法典 1023 条）、
**录音制作者权**（原版伴奏）、**词曲著作权**。三条里任意一条没拿到都不能对外交付。
做的是给学生/情侣的定制模板，一定会被复制传播，风险不可控。

所以这条链路两端都由自己产：

```
自己写的词 → TTS（她自己的声音）→ WORLD 换基频（旋律由程序写）→ Seed-VC 换音色
```

Seed-VC 的「源」是我们自己合成的清唱，不是任何人的录音。
**整条链路可以举证来源。**

### 生成一首歌

```bash
# 歌词一行一句，空行会当换气
printf '海面把月亮揉碎\n我把它捧在手心\n' > lyrics.txt

# 完整链路（约一分钟）：TTS → WORLD → Seed-VC
TIMBRE=1 bash scripts/sing_from_lyrics.sh lyrics.txt out.m4a out.json

# 只要 WORLD（快，但音色是声码器味）
bash scripts/sing_from_lyrics.sh lyrics.txt out.m4a out.json
```

权重一次性准备（约 1.9 GB，走 ModelScope 镜像；本机 HF 不通）：

```bash
python3 scripts/fetch_sing_models.py
```

只加载不下载：加 `--check`。

### 翻唱现成歌曲

给她一首现成的歌（本地 mp3 或 B 站/YouTube 链接），四步管线自动走完：
Demucs 分离人声/伴奏 → Seed-VC 把人声换成她的音色 → 混回伴奏 → AAC。

```bash
# 本地文件
bash scripts/sing_cover_file.sh 原唱.mp3 cover.m4a

# 链接（走 yt-dlp）
bash scripts/sing_cover_file.sh "https://www.bilibili.com/video/BVxx" cover.m4a

# 常用调节
SHIFT=12   bash scripts/sing_cover_file.sh 男声原唱.mp3 out.m4a   # 男声先升八度再换
VOCAL_GAIN=0.8 bash scripts/sing_cover_file.sh in.mp3 out.m4a    # 人声嫌大
KEEP_WORK=1 WORK=/tmp/c bash scripts/sing_cover_file.sh in.mp3 out.m4a  # 留中间产物
```

参考音色固定用 `assets/whale-video-test/voice/ref-vivian.wav`（Qwen3 合成的
3.5 秒说话样本，`scripts/sing_from_lyrics.sh` 与翻唱共用同一份，换音色才一致）。

耗时参考（M 系列 CPU）：分离约 0.6× 歌曲时长，Seed-VC 约 1.6× 歌曲时长。
一首四分钟的歌全程约 10 分钟。

客观验收（2026-10-30，源为演示曲）：浊音 73%、跨度 12.1 半音、帧间抖动 0.14、
**音色相似度 0.935**（输入原唱位是 0.908）——旋律节奏原样保留，音色贴上她的。

登记进内容包让她真的会唱：

```bash
python3 scripts/add_song_to_pack.py cover.m4a --title 潮汐 --unlock 20
# 翻唱没有逐句时间轴，不传 --lyrics：唱时不显示逐句歌词，只出声
```

**版权边界**：自用/试听没问题；放进要卖的模板 = 词曲著作权 + 原录音制作者权
两条都要拿到授权，本管线不解决授权问题。

### 客观体检

没有听觉反馈的时候，只能把「听着不对」翻译成数字：

```bash
../.venvs/sing/bin/python scripts/sing_report.py out.m4a out.json 她的说话样本.wav
```

| 指标 | 达标线 | 防的是什么 |
|---|---|---|
| 浊音占比 | ≥50% | 周期性被毁 → 听着是气声噪音 |
| f0 跨度（10~90 分位） | 2~18 半音 | 没起伏像念经 / 起伏太大像尖叫 |
| 帧间抖动（相邻 5ms 中位） | ≤0.25 半音 | 每帧音高乱跳 |
| 音色相似度（MFCC 余弦） | ≥0.85 | 换音色那步没起作用 |

参考值：WORLD 直出 0.723，过了 Seed-VC 是 0.883。

### 写进内容包

```json
"songs": [{
  "id": "tide", "title": "岸边的潮", "file": "songs/tide.m4a",
  "credit": "原创旋律 · 澜演唱（非真人翻唱）",
  "unlockAt": 0, "gain": 1.0,
  "lyrics": [{ "at": 0.0, "zh": "海面把月亮揉碎" }, { "at": 2.23, "zh": "我把它捧在手心" }]
}],
"affection": { "song": 2 }      // 听完一首加多少好感，不写默认 2
```

- `file` 支持音频也支持视频（视频只取音轨）。
- **`credit` 不要删**。翻唱 / 改编作品必须标明来源，这是能不能对外交付的硬要求。
- `unlockAt` 是好感门槛，不写就一开始能点。
- 歌词时间码直接用 `sing_cover.py --json` 写出来的那份，别手抄。

### 台面上能看到什么

| 行为 | 结果 |
|---|---|
| 右键「唱一首」 | 挑一首没听过的开始唱，底部出歌词 |
| 说「唱首歌」 | 同上；说「别唱了」停 |
| 点她一下 | 停歌，不算听完 |
| 听完整首 | 好感 +2，记入「听过」，下次优先挑没听过的 |
| 说完一句话 | 唱歌让位给语音，不会两个声音叠在一起 |

## 用嘴说话（音箱式交互）

三件事凑出「音箱感」，少一件就退回成一个输入框：

| 能力 | 怎么做 | 怎么用 |
|---|---|---|
| **点一下说，说完自动停** | 静音 1.5 秒自动结束，不用按停止；最长 30 秒兜底 | 输入条 🎤 按钮 / 状态栏「用嘴说…」/ 右键菜单 |
| **你一开口她就闭嘴** | 麦克风电平超过阈值立刻停掉正在播放的语音 | 自动，无需操作 |
| **说完不用再点** | 她说完后 12 秒内麦克风半开着，直接接话 | 自动；`continuousSeconds` 可调，0 关闭 |

识别用系统 `SFSpeechRecognizer` + `zh-CN`，**开 `requiresOnDeviceRecognition`**，
音频默认不出本机、离线也能用。

### 唤醒词（默认关）

右键 → 「一直听着（耗电）…」打开后，喊她名字就能开始对话：

```json
"wakeWords": ["澜", "小澜", "蓝"],
"continuousSeconds": 12
```

**默认关**是有原因的：麦克风一直开着、一直在做识别，费电也费 CPU。
开着的时候状态栏会显示「一直听着」。

### 为什么第一次必须手动授权

macOS 的 TCC（隐私控制）只在**双击 / LaunchServices 启动**的 app 里弹授权框。
从终端直接跑二进制去申请麦克风，TCC 会**直接把进程 abort 掉**，崩溃栈长这样：

```
__TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION__
```

这不是代码 bug，拦也拦不住。所以正确的第一次是：**双击 app → 点状态栏
「用嘴说…」→ 弹框点「好」**。授权会持久化，之后就能用命令行测了：

```bash
./dist/WhaleVideoCompanion.app/Contents/MacOS/PetDesk \
  --listen 8 --assets assets/whale-video-test --data /tmp/petdata --out /tmp/listen.json
```

⚠️ 授权前跑上面这条会 SIGABRT（退出码 134），属预期。

## 自动验证

屏幕截图要走系统录屏权限，很多机器上直接不可用。桌宠的关键状态都在内存里，
直接 dump 比截图准：

```bash
open -n dist/PetDesk.app --args --data /tmp/pet-data --selftest --out /tmp/pet.json
```

它会走一遍 启动 → 点击 → 输入 → 回复 → 待机交接 → 开关面板，把每一步的窗口
可见性、图层透明度、播放速率、好感度、气泡文字写进 JSON。加 `--story` 还会
真的播一章剧情。实测结果（全新数据目录，好感度从 0 开始）：

```
boot           t= 0.0s taps=0 aff=0 swaps=0 cover=1.00  bubble='书还没翻完。'
afterTap       t= 1.5s taps=1 aff=1 swaps=0 cover=1.00  bubble='再摸就收费了。'
composerOpen   t= 2.4s taps=1 aff=1 swaps=0 cover=1.00  key=True  ← 面板能成为 key 窗口
afterReply     t=10.4s taps=1 aff=2 swaps=1 cover=1.00
　　　　　　　 bubble='我在看一本关于魔法的书，它让我重新思考了魔法的本质。'
idleSwap       t=18.0s swaps=1 cover=1.00   ← 13.4 秒处完成了一次待机交接
panels         t=19.0s windows=['桌面伙伴','相册 · 1 / 1','剧情']
story          t=24.3s swaps=2 cover=1.00
```

带剧情的另一轮（`--story` + 5 秒测试包）：

```
panels  playing=True  choice=False cap='第一句台词。'   ← 字幕按时间码出来了
story   playing=True  choice=True  cap=''              ← 分支选择框弹出
```

三个关键数：

- **`swaps`** 大于 0 证明交叉淡化真的跑过（不是靠肉眼判断“看起来不卡”）。
- **`cover`** 是淡化期间两层里较高的那个透明度的最小值。等于 1.00 说明**中间从没黑过**；
  掉到 0.3 就是肉眼那一下闪。
- **`key`** 为 True 说明输入框能拿到键盘焦点。

还有一条 `windows.all`，列出**全部**窗口并标 `on/off`。只看可见窗口会掩盖
「窗口被 orderOut 掉了」和「窗口压根没建」的区别——排查面板问题全靠它。

```bash
# 带剧情的一轮（用一个只有 5 秒、带字幕的测试包）
./dist/PetDesk.app/Contents/MacOS/PetDesk \
  --data /tmp/pet-story --assets /tmp/story-pack --selftest --story --out /tmp/r.json
```

## 播放层怎么做的

不是「切视频」，也不是单个播放器循环，是**两层待机 + 一层动作**：

- **待机**：两个 `AVPlayer` 轮流当前台。一段播到 `duration - 0.6` 秒，就在另一层上
  起下一段，`CABasicAnimation` 把两层 opacity 换过来。
- **动作**：第三个 player 叠在上面，淡入，播到 `duration - 0.45` 秒时淡出。

为什么不用 `AVPlayerLooper`：单元素循环在素材首尾帧不完全一致时，会在循环点
露一次跳帧。**交叉淡化不管素材接不接得上都能糊过去**，而且多段待机可以轮换——
同一段连播更容易看出循环点。

为什么动作是 0.45：等 `DidPlayToEndTime` 通知已经太晚，那时画面停在末帧，
姿势多半没回到锚点，肉眼能看见「顿一下才消失」。

透明度动画必须加在 `AVPlayerLayer` 的 `CABasicAnimation` 上。用 SwiftUI/NSView 的
隐式动画会跟着刷新节奏走，慢帧时会闪。

## 内容包（pack.json）

角色的全部内容——说什么话、播哪几段、解锁阈值——都在素材目录的 `pack.json` 里。
**换一套角色 = 换一个素材目录，不用改代码、不用重新编译。**

```
{
  "name": "Miss Malfoy",
  "persona": "语气、句子长短、什么话题会让她动摇……",
  "greeting": ["一天里第一次见面说的话"],
  "touches": ["被点一下时的反应，写 3–6 条"],
  "idles": ["长时间没人理时偶尔冒一句"],
  "addresses": [{ "affinity": 0, "call": "转校生" }, { "affinity": 20, "call": "你" }],
  "scene": {
    "still": "anchor.jpg",                        // 垫在所有视频下的静帧
    "ambient": ["a.mp4", "a.mp4", "b.mp4"],       // 重复写就是提高权重（2/3）
    "actions": ["idle-a.mp4", "idle-b.mp4"],
    "touch": "touch.mp4",
    "sleep": "sleep.mp4", "sleepStill": "sleep.jpg", "sleepEndAt": 5.0
  },
  "clips": [{
    "id": "1-1", "file": "story-1-1.mp4",
    "caps": [{ "from": 8.2, "to": 11.95, "zh": "台词", "en": "optional" }]
  }, {
    // 没有剧情视频也能演：静帧 + 一句话 + 停留秒数
    "id": "s1", "image": "album-01.jpg", "duration": 4.5, "text": "一句台词。"
  }],
  "chapters": [{
    "id": "ch1", "title": "第一章", "unlockAt": 0, "reward": 10,
    "flow": [{ "clip": "1-1" }, { "clip": "1-2", "then": "choice" },
             { "branch": { "A": "1-2A", "B": "1-2B" } }],
    "choices": { "prompt": "她在等你的回答", "a": "…", "b": "…" }
  }],
  "album": [{ "id": "p1", "file": "p1.jpg", "unlockAt": 10, "zh": "…", "where": "禁书区" }],
  "songs": [{
    "id": "tide", "title": "岸边的潮", "file": "songs/tide.m4a",
    "credit": "原创旋律 · 澜演唱（非真人翻唱）", "unlockAt": 0, "gain": 1.0,
    "lyrics": [{ "at": 0.0, "zh": "…" }, { "at": 2.23, "zh": "…" }]
  }],
  "affection": { "max": 100, "touch": 1, "touchCooldown": 45, "dailyVisit": 3,
                 "chat": 1, "chatCooldown": 20, "chapterReward": 10, "song": 2 }
}
```

几条约定：

- **所有字段可选**。少写一项就走默认值，不会因为缺字段黑屏。
- **字幕挂在视频秒数上**，不用 TTS 合成。什么时候开口、停多久都由分镜决定，
  这是「演出」能不能做准的关键。
- **镜头可以是视频，也可以只是一张静帧。** 写了 `image` 就按图文剧演：
  显示这张图、打出台词、停 `duration` 秒（不写默认 4.5，兜底范围 0.5–30）再往下走。
  静帧只有一句话（`text`），要多句卡点仍须用视频 + `caps`。
  这条是给「有图但没剧情视频」的素材包留的路——相册那 26 张图配上台词就能演一章。
- `flow` 里 `then: "choice"` 会弹出选项框，**12 秒不选就算 A**（沉默也是一种回答）。
- 缺素材不会卡死：缺哪个片段就跳过哪段，并在播放器底部写一行提示。

完整 schema 看 `assets/malfoy-pack/pack.sample.json`。现在这份 `pack.json` 里
`chapters` 和 `clips` 是空的，所以剧情面板会显示空态——素材里没有剧情片段，
不是功能坏了。

## 换素材

放进 `assets/malfoy-pack/`（或任意目录，用 `--assets` 指过去）再重新打包：

```
idle-01.mp4   待机循环（首尾帧最好能接上；接不上也有 0.6 秒交叉淡化兜底）
idle-02.mp4   小动作 A
idle-03.mp4   小动作 B
touch-01.mp4  被点到时的反应
sleep-01.mp4  久无人理时的睡姿
character-master.png  静帧兜底 / 相册图
pack.json     内容配置
```

全部 1920×1080 / H.264 / 无音轨。窗口是 16:9，`resizeAspectFill` 铺满。

## 素材坏了会怎样

换素材最容易翻车的不是观感，是**文件对不上**：名字写错、拷了一半、换台机器丢了、
编码不认。这一层现在不会静默黑屏，也不会把交互卡死：

| 情况 | 现在的行为 |
|---|---|
| 声明的待机素材不存在 | 跳过它继续播其余的；启动时用气泡点名缺哪个，问候语让位 |
| 待机素材一个都不在 | 气泡列出全部缺失文件名（不再是含糊的「没找到素材」） |
| 文件在、但解不出来 | 前台那层失败时自动退回上一段能播的，画面不中断 |
| 动作素材缺失 | 不把动作层提起来（否则空层压住待机画面），只报一句 |
| 动作迟迟起不来 | 4 秒看门狗收回待机；等循环锚点的场景按待机时长放宽 |
| 睡姿 / 安静形象加载失败 | 原来什么都不说，现在会说是哪个文件 |

自检里对应三个字段：

```bash
./dist/WhaleVideoCompanion.app/Contents/MacOS/PetDesk --check-assets --data /tmp/probe
# {"idle.health":"ok","idle.error":"","idle.recoveries":0,...}
```

- `idle.health`：`ok` / `degraded` / `empty`。`degraded` 就是「有东西没播成」。
- `idle.error`：最近一次的原因，具体到文件名和解码错误。
- `idle.recoveries`：解码失败后退回上一段的次数，用来确认恢复路径真的走过。

注意鲸鱼主线走的是 `character.json` + `StageView`，`PetStage` 那套只在
「没有 character.json 的内容包」和「睡眠兜底」里生效，所以鲸鱼包上
`idle.status` 一直是 `none`、`idle.swaps` 一直是 0 —— 这是路径没被用到，不是故障。

## 一键生成内容包

手写 `pack.json` 最常错的地方不是语法，是**文件名和字段对不上**——写错一个字母，
开机就是空场景，还不报错。所以有个扫描脚本按命名规则直接生成：

```bash
python3 scripts/make_pack.py --src ~/Pictures/newgirl          # 写进素材目录
python3 scripts/make_pack.py --src assets/malfoy-pack --dry-run # 只看会生成什么
python3 scripts/make_pack.py --src ~/Pictures/newgirl --name "苏晚" --force
```

它按前缀认文件（`idle-*` 待机、`touch-*` 反应、`sleep-*` 睡姿、`clip-*` / `story-*`
剧情、其余图片进相册），用 `ffprobe` 读片长并打印每段剧情可用的时间范围，
空场景会直接警告，认不出的文件列出来交给你判断，**不猜**。

素材目录里放一份 `lines.json`（只写想覆盖的字段，如 `persona` / `greeting` /
`touches` / `chapters`）就会盖掉脚本的默认台词——策划改文案不用碰代码。

实测：把 malfoy 那套素材换个目录、加一张相册图、加一段 `clip-01.mp4`，
`make_pack.py` 生成 `pack.json` 后**不改一行代码重新启动**，自检直接读到
`name=苏晚 ambient=3 actions=2 clips=1 album=1 scene=True`，相册和剧情面板都正常打开。
这就是「卖模板 = 换素材目录」这句话的验证方式。

交付给客人时换个名字和图标打包，产物是独立的 app，跟开发这版互不影响：

```bash
PET_ASSETS=~/Pictures/newgirl PET_APP_NAME=SuWan PET_DISPLAY_NAME="苏晚" \
PET_BUNDLE_ID=com.yourname.suwan ./scripts/build-pet.sh
```

## 已知限制

1. **主程序 LingDesk 在这台机器上编不了。** 只装了 CommandLineTools，缺
   `libSwiftUIMacros.dylib`，凡是 `@State` / `@StateObject` / `@FocusState` 的文件
   都过不了编译。桌宠因此做成独立的纯 AppKit 程序，避开整个问题。主程序源码
   保持原样，装完整 Xcode 后可继续。
2. **键盘焦点依赖 app 被激活。** 这是系统规则：键盘事件只送给「前台且 key」的窗口，
   绕不过去。自检里 `composerOpen` 那步已经拿到 `key=True`（面板成为 key 窗口），
   说明 `makeKeyAndOrderFront` + `NSRunningApplication.activate` 这条回退是有效的。
   剩下唯一没验的是「键盘事件真的落到输入框」——需要你双击试一次。
3. **素材是 Malfoy 的，只能个人测试。** 原仓库许可不允许再分发或商用。
   对外卖之前必须换成自己生成的素材。
4. **对话没有长期记忆。** 只带最近 24 条上下文，存在 `history-pet.json`。
   好感度和「看过哪些章节」是另一份 `pet-state.json`，删掉它等于重新认识她，
   但聊天记录不受影响。
5. **剧情还是空壳，相册已有 20 张。** 引擎跑通了（时间码字幕、分支选择、解锁、大图都能用），
   但 `assets/whale-video-test/` 的 `chapters` 为空，所以剧情面板打开是空态；
   相册是 `album-01..20`，其中 4 张初始开放、16 张按好感度解锁。
   这不是功能缺失——把素材补齐、往 `pack.json` 里写 `clips` / `chapters` / `album`
   就会出现。<br>补齐一套的最小量：**6 段剧情 + 6 张相框 + 2 条分支**，
   第一章总时长只要 65 秒就够撑起完整体验。
6. **待机交接每 13–14 秒换一次解码器。** 两个 player 轮换意味着每轮都要重新载入
   同一段视频。实测 `cover=1.00` 没有可见中断，但比单播放器循环多吃一点 GPU。
   素材如果很短（<3 秒），交接会变得频繁，建议待机循环不要短于 8 秒。
7. **语音识别必须先在真实 app 里授权一次。** macOS 的 TCC 只在双击启动时弹框；
   终端直跑二进制申请麦克风会被 `SIGABRT`（退出码 134，栈里是
   `__TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION__`）。这不是 bug，是系统隐私机制。
   详见「用嘴说话」一节。
8. **唤醒词常驻是耗电的，默认关。** 开着时麦克风一直采集、持续做设备端识别。
   它换来的是「不用动手」，代价写在右键菜单标题里，不是藏起来的。
9. **少女音色靠 `instruct` 描述，不是真克隆。** 实测基频 253 Hz（原配置）→
   298 Hz（现配置），成年女性典型 165–255 Hz、少女 250–300 Hz。再往上（304 Hz）
   会开始发腻。**没有做真人音色克隆**——要对外卖模板，克隆影视/配音演员的声音
   有声音权风险（民法典 1023 条把声音参照肖像权保护）。
10. **素材降级路径里还有两条没实测。** 动作看门狗只验证了「正常动作不会误超时」
    和「动作会自然收回」；「解码真卡住、一直不 ready」需要专门的坏素材
    （比如纯音频 .mov）才能构造，目前没有夹具。睡眠场景（`StageView.enterSleepScene`）
    的失败分支也只做了代码补齐，没拿坏素材跑过。
11. **唱歌是「像她的音色在唱简单的调」，不是录音室翻唱。** 音色相似度 0.883
    （她自己说话算 1.000），旋律由程序按五声音阶随机游走生成，没有作曲意图，
    也没有正经伴奏。想卖得更好听，旋律得人工写。详见
    `benchmarks/sing-2026-10-30/README.md`。
12. **`songs[].file` 可以带子目录，但打包时必须保留相对路径。**
    `scripts/build-pet.sh` 的选择性打包曾经把所有素材拍平到 `PetAssets/` 根目录，
    导致 `songs/tide.m4a` 找不到；更麻烦的是 `nextSong()` 会**静默过滤**掉文件
    不存在的歌，表现为「歌单有 1 首、点唱没反应、也不报错」。已修，回归方式：
    `./dist/WhaleVideoCompanion.app/Contents/MacOS/PetDesk --check-song`。
13. **翻唱权重的路径不能直接用 third_party 里的。** `seed-vc` 的配置引用
    `facebook/wav2vec2-xls-r-300m` 这类 HF 仓库名，本机连不上 HF，
    所有 `load_custom_model_from_hf` 调用都会被 `scripts/sing_seedvc.py`
    拦成读 `.models/seedvc` 下的本地文件。装到新机器记得先
    `python3 scripts/fetch_sing_models.py`。
