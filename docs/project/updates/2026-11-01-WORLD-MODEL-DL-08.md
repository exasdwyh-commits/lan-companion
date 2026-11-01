# WORLD-MODEL-DL-08：现有鲸鱼娘模型下载复核

本聊天仅负责下载、认证恢复和本记录，不改房间、应用或模型。

- 已通过官方 Hyper3D CLI 0.3.0 实际调用 MCP；初次返回 Authentication expired。通过 Ego 浏览器、官方 device flow 恢复 CLI 登录，终端确认 Authenticated successfully。没有复制 Codex 认证、密钥或其他个人数据。
- 同一 generation_id `bd1560d2-6368-42e3-b2b2-12611f5d3525`：status 返回 completed / rigging 5 of 5；result 返回 INVALID_REQUEST。不再把缺少当前聊天工具当作无法调用 MCP 的理由；CLI 能调用，具体结果接口拒绝原因未由服务端解释。
- 已实点模型页面 GLB 与下载按钮，弹出订阅窗口，显示 Gen-2.5 Medium 需订阅，Low / Extreme-Low 可免费下载。未订阅、未付款、未重新生成、未花积分。网页提示与接口错误分开记录，不能断言 MCP INVALID_REQUEST 就是订阅导致。
- 当前没有任何模型文件落盘。网页预览不是可导出模型交付；文件获得后才可核对 GLB、贴图、骨架、动画和角色身份。

后续：用户处理平台订阅后，继续网页导出及 MCP result 验证；不承诺订阅一定修复 MCP 接口错误。
