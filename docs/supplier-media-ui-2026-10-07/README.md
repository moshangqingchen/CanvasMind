# 媒体模型、参数与价格 UI 验收

验收日期：2026-10-07（America/Los_Angeles）。最新 renderer 构建在隔离 Playwright 环境中通过 **6 / 6** 用例，耗时 12.8 秒。

执行命令：`pnpm exec playwright test e2e/media-contract-ui.spec.ts`，工作目录为 `apps/desktop/renderer`。未设置 `PLAYWRIGHT_BASE_URL`，使用仓库 globalSetup 创建的隔离数据目录。供应商与模型均为 UI fixture，未保存真实 Key，生成请求 `POST /api/runs` 为 0，外部供应商 fixture 请求为 0，无浏览器 `pageerror`。

| 检查项 | 结果与证据 |
| --- | --- |
| 同连接包含图片、视频、音乐、图片理解、语音合成模型 | 图片节点仅出现图片输出型号；视频节点仅出现视频输出型号；音乐节点仅出现音乐生成型号。图片理解和 TTS 未混入三个生成菜单。 |
| 图片按张计费 | fixture 单价 0.08 CNY / 张，数量 3 时显示预计费用 0.24 CNY。刷新保留数量与费用。 |
| 视频条件参数与按秒计费 | 720p 支持 5 / 10 / 15 秒；切 1080p 后仅支持 5 / 10 秒，原 15 秒恢复为合法默认 5 秒。1080p、10 秒、数量 2 显示 0.4 CNY / 秒，预计费用 8 CNY。声音开关、参数、型号均保存并在刷新后恢复。 |
| 视频独立型号与币种 | 切换 fixture 4K 型号后，仅显示其 4 / 8 秒选项，数量参数消失；按次单价和预计费用显示 2 USD（参考），刷新保留新型号与参数。 |
| 音乐参数与歌词草稿 | 歌词输入占完整网格行；作品名、时长、音频格式与歌词刷新恢复。纯音乐状态隐藏歌词，保留草稿，切回后恢复原歌词；隐藏草稿不产生参数错误，按次预计费用正常显示。真正提交时省略歌词由运行参数规范化与音乐 adapter 单元测试覆盖。 |
| 窄窗口与长型号 | 720px 窗口关闭智能体侧栏后，长名称、长 ID、菜单、参数网格、歌词和价格说明没有横向溢出。模型名称及 ID 使用省略显示，完整内容可通过控件标题查看。 |

截图为浏览器实际 UI 截图，其中价格均来自验收 fixture，用于验证交互与展示计算。真实供应商的价格依据和模型参数应查阅本次供应商审计矩阵。

## 截图

- [图片数量与价格恢复](image-count-price-restored.png)
- [图片模型筛选](image-typed-model-menu.png)
- [视频参数与费用联动](video-dynamic-parameters-price.png)
- [视频独立型号保存恢复](video-fixed-request-model-restored.png)
- [视频模型筛选](video-typed-model-menu.png)
- [720px 视频长型号菜单](video-narrow-window-model-menu.png)
- [720px 视频参数与价格](video-narrow-window-parameters-price.png)
- [音乐歌词宽行](music-lyrics-parameters.png)
- [音乐纯音乐模式保存恢复](music-instrumental-restored.png)
- [音乐模型筛选](music-typed-model-menu.png)
- [720px 音乐歌词宽行](music-narrow-window-lyrics.png)

已目视检查图片费用、视频动态参数、音乐歌词、窄窗口长菜单及窄窗口歌词截图：控件和费用分区整齐，字体与间距一致，未发现重叠或横向溢出。参数面板内部纵向滚动属于正常行为。

## 0.2.64 打包版验收

包含原生视频路由与签名素材链接修复的最终交付构建，`apps/desktop/release/win-unpacked/SuperCanvas.exe` 文件版本为 **0.2.64.0**。最终构建完成后重新执行 `node apps/desktop/scripts/smoke.mjs --packaged` 成功退出（exit 0），**27 项检查全部通过**。以下报告和截图均已更新为这次最终构建的结果。

- 使用 `--smoke-test` 创建独立临时 profile：`C:\Users\ADMINI~1\AppData\Local\Temp\supercanvas-desktop-smoke-EDAakj`；未访问或写入正式 profile。
- Fake 图片生成、归档、下载及幂等重试通过。Fake 音乐在 Chromium 中播放正常，时长 1 秒；Electron WAV 下载状态为 `completed`，收到 8044 字节，RIFF/WAVE 文件头与归档大小正确。
- 1280×800 与 1920×1080 首页样式、文字与布局检查通过，横向溢出为 0。
- 中文路径、原生图片处理、项目导入导出、供应商名称与型号选择、退出保存及重启恢复通过。
- 首次启动和重启均无 renderer 异常。重启 Electron 合成器捕获为非空画面，项目 API 与实际显示的 4 个画布一致。
- `SuperCanvas.exe` SHA-256：`9CC87199E78B61125BC9CAEB99F8622506FB6D294A2248AEAF49C3B44AEB8344`。
- `resources/app.asar` SHA-256：`DC267DE3F91B42307E8FD4CBDA752B61CFBDB8E82BFEE4C6B06EB047B563B3E1`。

已目视检查打包版首页、画布及重启画面：文字清晰、控件整齐、配色一致，无明显重叠或异常黑屏。

- [完整打包版 smoke 报告](packaged-smoke-report.json)
- [打包版 1280px 首页](packaged-smoke-home-1280.png)
- [打包版画布](packaged-smoke-canvas.png)
- [打包版重启原生合成器画面](packaged-smoke-home-restart-capture.png)
