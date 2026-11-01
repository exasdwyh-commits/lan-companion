# 2026-10-30 · DW-01 · Electron 数据隔离与安全测试入口

## 归属

- 负责人 / 聊天标识：WorkBuddy 聊天（2026-10-30 晚，agent:workbuddy-chat）
- 任务：[TASKS.md · DW-01](../TASKS.md)（P0，「Electron 数据隔离与安全测试入口」）
- 开始时已有修改 / 其他负责人：工作树干净（HEAD `a7d844f`）。执行中观察到
  `MALFOY-ENGINE/web/live2d/world.html` 在 20:10 被他人改动（新增 `rigDebug` 相关行），
  未回退、未覆盖，只按原样重新打包。
- 本次负责文件：`MALFOY-ENGINE/lib/*`（新增）、`MALFOY-ENGINE/main.js`、
  `MALFOY-ENGINE/test/*`（新增）、`scripts/check-electron-isolation.sh`（新增）、
  `scripts/build-companion.sh`、`scripts/project_audit.py`、本文档与 STATUS/TASKS/CHANGELOG。

## 完成内容

### 问题（改之前是真的会写真实数据）

`main.js` 里 `MEM_DIR = path.join(process.env.HOME, ".smartcompanion")` 写死。任何自检、
任何一次聊天都会往真实记忆 `memory.jsonl` / `profile.md` 里追加；Electron 自己的
`userData`（localStorage / IndexedDB / 缓存）也固定落在
`~/Library/Application Support`。也就是说：「跑一次验收」= 往用户真实画像里写测试对话。

顺带发现另一个更该修的问题：源码里**写死过一个本地 llama-server 的 key**，
仓库一公开就是泄露。

### 改动

1. **新增 `MALFOY-ENGINE/lib/data-dir.js`**：数据目录解析，优先级
   `--data-dir` / `--data` 参数 → `LAN_DATA_DIR`（兼容 `LINGDESK_DATA_DIR`、`PET_DATA_DIR`）
   → 旧默认 `~/.smartcompanion`。纯函数，不依赖 Electron，可直接用 `node --test` 断言。
   显式传的目录如果**正好等于旧默认目录**，返回 `warning: 隔离无效`——这是最容易假绿的坑。
2. **新增 `MALFOY-ENGINE/lib/memory-store.js`**：把 `remember/recall/readProfile/
   mergeProfile/clear` 从 `main.js` 抽出来，目录由调用方给。落盘格式与迁移前逐字节兼容
   （`memory.jsonl` 一行一条 `{t,u,a}`，`profile.md` 一行一条 `- 事实`，上限 200 / 40）。
3. **新增 `MALFOY-ENGINE/lib/config.js`**：服务端点与本机路径集中；密钥改为
   「环境变量 → `~/.hermes/.env` → 空串」，删掉源码里的 `LOCAL_LLM_KEY` 明文。
4. **`main.js` 接线**：`DATA = resolveDataDir(...)`，`STORE = createStore(DATA.dir)`；
   显式目录时 `app.setPath("userData", <dir>/electron)`，把 Chromium 状态也搬走；
   `hermes` 子进程继承 `LAN_DATA_DIR`。原有函数名（`remember`/`recall`/`readProfile`）保留，
   调用点零改动。
5. **两种探针**（供验收，不影响正常运行）：`LAN_PRINT_DATA_DIR=1` 打印目录解析结果即退出；
   `LAN_PROBE=write|read` 真写一条/读回一条再退出。都用环境变量触发——
   Chromium 的开关解析会把不认识的 `--data-dir` 直接判 `bad option` 拒掉（实测）。
6. **新增 `scripts/check-electron-isolation.sh`**：9 项断言，带看门狗
   （旧构建不认探针时会一直开窗口，没超时脚本会永久卡住）。自动清掉本机注入的
   `ELECTRON_RUN_AS_NODE=1` 与 `NODE_OPTIONS` shim，否则 app 会变成 node REPL。
7. **`build-companion.sh` 补 `lib/` 拷贝**：漏了它的表现是启动即崩、屏幕无反应，
   探针表现为「超时无输出」，很难看出是少拷一个目录。
8. `project_audit.py`：那条「尚未提供可靠测试隔离」的静态提示改为指向新脚本，
   不再暗示能力缺失。

## 验证证据

| 命令或实际操作 | 结果 | 证据路径 | 能证明与不能证明的范围 |
|---|---|---|---|
| `node --test MALFOY-ENGINE/test/*.test.js` | PASS 16/16 | `benchmarks/2026-10-30-DW-01/isolation.json` | 证明：参数/环境/默认三级优先级、相对路径、默认目录警告、写入落在指定目录、超限裁剪、坏行不崩、画像去重。不证明：真实窗口行为 |
| `bash scripts/check-electron-isolation.sh` | PASS 9/9 | 同上 | 证明：干净构建的 `dist/DeepWhale.app` 在 `LAN_DATA_DIR=/tmp/...` 下自报该目录、写一条后**另起进程**读回同一条、真实 `memory.jsonl` 指纹全程未变。不证明：聊天/模型链路 |
| 负向验证：对旧构建执行同一脚本（`PROBE_LIMIT=8`） | 预期 4 项 FAIL | 本次会话输出 | 证明检查会红、且不会卡死；旧包确实没有隔离能力 |
| `bash scripts/project.sh check` | 63/63，错误 0 | 终端输出 | 包/源 4/4 一致、素材 29/29；静态检查，不验证窗口与听感 |
| 主线产物探针（干净环境） | `{"dataDir":"/tmp/probe-final","source":"env","explicit":true}` | 终端输出 | `dist/DeepWhale.app` 已换成带隔离的构建；`codesign -v` 通过 |

真实目录指纹：`3820:1793351859`（size:mtime），验收前后一致。

## 剩余工作与交接

- 当前限制：
  - 只有「记忆/画像/Chromium userData」纳入隔离；`~/Library/Caches`、日志、系统 Keychain 未处理。
  - 旧 `verify-integration.sh` 仍然存在且会写真实数据，**不要当默认测试跑**；退役属 DW-08/DW-02 范围。
  - 配置里仍有本机绝对路径（`edge-tts`、`hermes`、ffmpeg 候选），已提为可覆盖常量，未做跨机器迁移。
  - `LAN_PROBE` 是写给验收用的后门，生产启动不会触发；如后续担心滥用，可在打包时剔除。
- 下一项建议：**DW-02**（一个身份、共享会话与双音色）现在可以安全地跑了 ——
  用 `LAN_DATA_DIR=$(mktemp -d)` 起 app，聊天只写临时目录；DW-03 的内容接回同样受益。
- 是否更新 STATUS / TASKS / CHANGELOG：是，均已更新。
- 是否影响素材来源、外部依赖或运行入口：不影响素材；新增一个环境变量族
  （`LAN_DATA_DIR` / `LINGDESK_DATA_DIR` / `PET_DATA_DIR`）与两个探针开关；
  正常运行入口（`dist/DeepWhale.app`）行为不变，未指定变量时仍用旧目录。
