# 本机覆盖安装 v0.2.118（2026-10-19）

已构建并本机覆盖安装 **0.2.118.0**。全载荷与核心 SHA、安装后及首次启动前的正式资料字节核对均通过。**停在首次正式启动前**：正常启动会访问 GitHub 检查更新，本轮禁止其他外网且没有现成安全关闭入口；因此没有启动后验收、正式首页截图，正式应用当前未运行。没有把隔离冒烟当成正式资料验收。

安装器 268,745,744 字节；SHA-256 `e4aeb52f36648270732a8985f971902050f7ba0d581079f3c44f4b362d73d026`。正式安装版本 0.2.118.0，BUILD_ID `sWYPX6XvnosGxySShuM6d`。

| 步骤 | 结果 |
| --- | --- |
| 根与 desktop 版本、发布说明 | 完成，0.2.118；docs/releases/v0.2.118.md |
| workspace 库预编译、单测 | 完成；9385 通过、9 跳过，2 个旧 fixture 失败已最小适配并复验 |
| typecheck / renderer lint | 通过；保留原 2 个 unused warning，最终 36 个修改 fixture lint 为 0 warning |
| 全量 E2E | 700 唯一用例：677 通过、6 RAM 环境失败、17 原条件跳过 |
| Next 与 desktop:build | 通过；内联版本 0.2.118，最终 BUILD_ID sWYPX6XvnosGxySShuM6d |
| 隔离 packaged / 可见窗口冒烟 | 29/29 与 4/4；使用打包载荷，未使用正式 profile |
| 完整备份与回滚安装器 | 已逐文件 SHA 核对 |
| 覆盖安装 | 完成，exit 0；显式 D 盘 TEMP/TMP |
| 全载荷、安装后与首次启动前字节核对 | 全部通过，无意外资料差异 |
| 正式启动后只读读回、首页截图、保持运行 | 未执行：本轮外网限制与既有自动更新检查冲突 |
| Cloudflare Worker / 收费生成 / Git 发布 | 均未执行 |

三个停机核对阶段（before-install、after-install、before-first-start）全部通过：完整 profile 字节、主库、全部连接／供应商保护字段、各项计数、18 条核验证据完整读回及规范化哈希、19 份 sidecar、19 份证据文件和 5 个项目文件夹完全一致。profile 外完整桌面状态逐文件 SHA 也不变；本次未新增 .supercanvas-meta/。安装后 11366 个预期载荷文件全 SHA 匹配，目录一致、runtime 完全相同；仅允许安装器生成 Uninstall SuperCanvas.exe（实际 11367 个文件）。没有资料迁移、异常差异、回滚或旧安装器执行。这里是停机文件读回，不能写成安装版 API 或正式 UI 验收。

安装包装进程和安装器的 TEMP、TMP 实际均为 `D:\project development\超级画布\.codex-temp\release-v0.2.118\installer`；包装进程 .NET TempPath 同一目录。回执：installer-launcher-environment.json、installer-wrapper-environment.json、installer-start.json、installer-result.json。

备份：`D:\project development\超级画布\backups\before-local-update-v0.2.118-20261019T063745489Z`；回滚安装器 0.2.117 SHA-256 `532f89521d1a834861c8a0b5b7e0522ff62fe3124b29458c6effe9474d88a651`。

正式首页截图：无。隔离冒烟截图及诊断见本轮 smoke/；它们只证明新包在隔离资料下的行为。用户自行退出后未关闭／强杀其应用；正式首次启动和输入监视未开始。

源码保持 HEAD `eb7d4586de9667910a3c3f657dbeb52d7c37377d`、分支 release/v0.2.110；本轮未提交、推送、打 tag 或发布 GitHub Release。新增内容为两个版本号、发布说明、本记录及测试 fixture 适配；未增加产品逻辑修复。两份 providers 测试与 36 份 E2E fixture 的精确改动等 Claude 审查。

完整中文报告（含原样失败）：[final-report.md](../.codex-logs/2026-10-19-release-v0.2.118/final-report.md)；[正式启动边界复核](../.codex-logs/2026-10-19-release-v0.2.118/startup-readonly-reassessment.md)。证据目录：`.codex-logs/2026-10-19-release-v0.2.118/`。不包含供应商协议或价格调整，不发起收费生成。云端超时保留任务编号的改动仍须另外部署云端服务，本次未部署。
