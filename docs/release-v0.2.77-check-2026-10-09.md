# v0.2.77 发布验收 — 2026-10-09

日期按 America/Los_Angeles。代码已推送 main，提交 `51fea72db1299ab3df18e1bbdf69873bc85ab1bf`。**GitHub CI 与 Windows 发布均已成功，v0.2.77 于 2026-10-09 00:39:56（America/Los_Angeles）公开发布。已匿名确认它是仓库当前最新正式版，三个更新资源可读取。**

## 本版变化

本版按本轮 16 个有效供应商、140 个连接的冻结官方采样补齐 Suno 音乐独立合同、We-AI Adobe 官方别名与 aistudio Nano Banana 2.1 合同、精确图片分组尺寸和质量限制，以及聊天、缓存、视频秒价与账户倍率解析。详见 [接入升级验收记录](supplier-integration-upgrade-v0.2.77-2026-10-09.md) 和 [更新说明](releases/v0.2.77.md)。

升级后应用会免费刷新匹配来源的已有活跃连接；未有对应 Key、官方未公开协议或明确权限拒绝的分组/型号保留实际限制。本次不创建 Key、不写正式画布或供应商配置，不向供应商提交收费生成。

## 本地最终验证

| 检查 | 实际结果 |
| --- | --- |
| 全量单元 | 4,247 项：4,246 通过，1 项既有 Windows 文件符号链接权限跳过，0 失败 |
| 类型与 Lint | 两项退出码均为 0 |
| 维护边界 | 12/12 通过 |
| 生产依赖审计 | 未发现已知漏洞 |
| 目标浏览器回归 | 最终 20/20 通过，0 重试；首轮 19/20 的媒体 token 摘要失败已修复，原日志保留 |
| 隔离打包运行 | 27/27 通过 |
| 正常 GPU 窗口、重启与崩溃恢复 | 4/4 通过，恢复后可见且有非空绘制，后端端口保持一致 |
| 安装包与更新元数据 | 版本、GitHub 更新配置、说明、SHA-512、文件大小、blockmap 校验通过 |

本地安装包 `SuperCanvas-Setup-0.2.77-x64.exe`：219,141,986 字节，SHA-256 `2c2c1815879784cd15f44819704a1d2d7c9349ab20c5b1a9380fb009859db1d1`。这是本地完整文件校验，不等同于 GitHub Windows 环境独立构建的文件哈希。

初次整套构建在 Node 官方校验清单下载时遭遇 TLS 连接重置；保留失败日志。随后仅在忽略目录中为官方 checksum 和 LICENSE 的两个 GET 使用现有网络读取实现，重新取得当前正文并通过校验，没有跳过校验或用缓存冒充成功。最终运行资源 staging、安装包构建、更新元数据验证和两种打包运行验收均成功。

## GitHub 与公开更新

| 项目 | 状态 |
| --- | --- |
| 主 CI | [37898449270](https://github.com/moshangqingchen/CanvasMind/actions/runs/37898449270)，精确提交 6/6 任务成功；完整日志已核对 |
| Windows 发布流程 | [37898449533](https://github.com/moshangqingchen/CanvasMind/actions/runs/37898449533)，精确提交 8/8 任务成功；首次 workflow attempt 完成，完整日志已核对 |
| v0.2.77 tag 与源码 SHA | tag 精确指向 `51fea72db1299ab3df18e1bbdf69873bc85ab1bf`，与已推送 main 一致 |
| 公开安装包、blockmap、latest.yml | 三个资源全部存在；匿名最新 release API 200、manifest GET 200、installer 与 blockmap Range GET 206；更新元数据和文件大小对应 |

主 CI 全量单元为 4,247 项（4,246 通过、1 项 Linux 平台的 Windows 短路径别名用例跳过），维护 12/12。独立 Windows 任务单元 106/106，打包烟测 27/27，正常窗口恢复 4/4，rendererErrors 为 0。本机单元跳过的是另一个 Windows 文件符号链接权限用例，不能把两种环境的跳过原因混写。

主 CI 浏览器实际计划 347 项，346 项首轮通过、1 项重试后通过；共 348 次 attempt，1 次 retry，最终失败与跳过均为 0。唯一重试为 `canvas-panel-after-supplier.spec.ts:344` 的 capture-lost-blur 中断后面板滚轮用例，首轮等待 `scrollTop > 0` 超时，第二次通过；没有 trace 证明唯一根因，不把它写成首轮全通过或供应商参数失败。完整日志与计数摘要已保留。

发布流程的独立前置浏览器检查为 functional-1 114/114、functional-2 114/114、functional-3 113/113、performance 6/6，共 347/347 首轮通过，0 重试、flaky、失败或跳过。主 CI 曾失败的滚轮用例在该独立运行中 3.4 秒首轮通过；这不抹去主 CI 的首次超时记录。

最终安装包生产任务在同一提交上额外完成目标单元两组 200/200、64/64，Windows 目标浏览器 38/38 首轮通过，桌面单元 106/106、打包运行 27/27、GPU 窗口与崩溃恢复 4/4；renderer 异常为 0。安装包完整 SHA-512 和 metadata 的生产端校验通过，上传并公开发布步骤成功；这些目标用例与全量检查有交集，不相加伪造总数。

公开发布地址：[超级画布 v0.2.77](https://github.com/moshangqingchen/CanvasMind/releases/tag/v0.2.77)。正式安装包为 216,720,801 字节（约 206.7 MiB），GitHub API 提供 SHA-256 `27a8c61cc6c24422895b1f794b532dd1d0c45d00da750b1af7b04a62517f591e`；blockmap 为 223,969 字节。

匿名下载验收完整读取 2,839 字节 `latest.yml`，SHA-256 与发布 API 的 `eea2cce48c6b5ac88a14a25dcd2fd73522c05039763ca870bb256c8d607968d8` 一致；版本、路径、release notes、SHA-512 字段及 installer 大小对应。对安装包与 blockmap 各执行 512 字节 Range GET，206 的 Content-Range 总大小与发布记录一致，安装包头为有效 PE 的 `MZ`。没有为了检查再次下载完整 206.7 MiB 公开安装包，远端完整文件哈希由 CI 生产端校验与 GitHub 提供的 digest 支撑，不能写成独立全量下载验证。

## 证据与实际安装边界

本地日志与脱敏证据保存在 `.codex-temp/release-v0.2.77/`；主 CI 与 Windows 发布完整日志已按 run、attempt 和精确提交保存到 `github-readonly/evidence/`。主 CI 6 日志、发布 8 日志均绑定完整 byte/hash/proof；发布复用此前已完整采集并核验的 7 个成功日志，额外采集最后一个生产任务。`published-assets-1791531674387.json` 与 `published-latest-confirmation-safe.json` 保存匿名公开资源验收。凭据只用于官方 GitHub API 的内存鉴权，不写明文、签名重定向 URL 或供应商 Key 到报告。

当前正式安装仍是 0.2.76，本轮没有关闭或覆盖用户正在运行的应用。正式安装、资料读回和升级后实际目录缓存结果不属于上述隔离测试结论；发布完成后可由应用内更新安装。
