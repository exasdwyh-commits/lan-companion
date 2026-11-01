# LIVE2D-LAN-01：澜的 Live2D 原画准备

## 已做

- 以用户选择的 B 母图为参考生成面部底色、后发遮挡及手臂展开研究图，归档在 `assets/lan-live2d-source-v1/`，附尺寸、用途、局限和拆件制作顺序。
- 视觉检查：面部图去掉五官，保留发型和服装；三联图中间减少后发遮挡，两侧手臂姿势不同。均为生成的平面图，未验证与 B 母图的像素对齐，不能直接当作层。
- 检索项目内 PSD、CMO3、MOC3、ORA：只发现 Hiyori 的 MOC3 副本，没有澜的 PSD、Cubism 工程或模型。应用目录检查与 Spotlight 检索未发现 Cubism Editor。
- Live2D 官方说明支持 PSD 导入：<https://docs.live2d.com/en/cubism-editor-manual/precautions-for-psd-data/>；编辑器下载及系统要求见 <https://www.live2d.com/en/cubism/download/editor/>。是否符合许可与当前版本以官方条款为准。
- `bash scripts/project.sh check`：90/90，错误 0，6 条既有待办；静态检查不代表视觉或模型验收。

## 未完成与下一步

本轮没有生成分层 PSD，也没有导入 Cubism、绑模、制作舞蹈或哼唱，更没有接入或重建应用。下一步需要能编辑/绘制分层 PSD 的工具与人工或可控绘制工作：按同画布拆件、补全遮挡并复合检查，再安装 Cubism Editor 导入、绑参并导出真实模型。图像生成参考不能代替该步骤。

参考文件 SHA-256：

- `face-underpaint-reference.png`: `d0f2e2626c04ba47a9655b88a0b14fb4f6edace075cd4297d481f17f5cf6b008`
- `hair-arm-study-reference.png`: `0e8b206680a26fcb2df66117484b6017ad5c6fcab5eb4da99d05ffec535220d8`
