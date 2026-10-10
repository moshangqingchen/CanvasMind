# 0.2.68 发布与下载状态验收（2026-10-08）

0.2.68 已推送到 main，并作为最新稳定版公开发布。冻结提交为 `66f370d2c5271bb4d1ef482578fc93a238440134`；本收据汇总完成于 2026-10-08T10:55:52.406Z，日期按 America/Los_Angeles。

[公开发布及安装包](https://github.com/moshangqingchen/CanvasMind/releases/tag/v0.2.68) · [主 CI](https://github.com/moshangqingchen/CanvasMind/actions/runs/37763424429) · [Windows 发布流程](https://github.com/moshangqingchen/CanvasMind/actions/runs/37763424721) · [版本说明](./releases/v0.2.68.md)

本版更新窗口显示下载速度与预计剩余时间，区分准备下载、差分、完整安装包和已校验缓存；传输停顿时清除过期估计，差分回退完整包时重置进度。传输达到 100% 后继续等待原有校验完成，再显示安装操作。关闭弹窗保留后台下载；窄窗口布局与失败重试界面经过回归。错误详情只显示阶段、分类、41 项批准错误码、HTTP 状态和可重试标记，独立 JSONL 日志只写结构白名单，最多保留两个 256 KiB 文件、128 条待写记录，不保留原始 URL、签名链接、Header、凭据、路径或堆栈。

| 验证 | 实际结果 |
| --- | --- |
| 主 CI | 6/6 作业成功；构建、类型检查、Lint 与生产依赖审计通过 |
| Linux 全项目单元与维护 | 3871/3871 单元测试，12/12 维护检查；其中 desktop 97/97，无跳过 |
| 主 CI 浏览器全量 | 325/325 首次通过；325 次实际执行、0 重试、0 flaky、0 跳过、0 最终失败；319 功能 + 6 性能用例、18 组性能测量 |
| Windows 发布前置 | 3871/3871 单元、12/12 维护；浏览器 325/325 首次通过、325 次执行、0 重试；重复覆盖不叠加计数 |
| Windows 桌面与安装包 | 主 CI、发布前置及正式 producer 均 desktop 97/97、0 跳过；每轮常规 smoke 27 项及 GPU 窗口/重启/崩溃恢复 4 项通过，rendererErrors 为 0 |
| 发布专项 | focused 浏览器 30/30 首次通过、30 次执行、0 重试；Vitest 189 + 62 项专项子集通过 |
| 本地桌面单元 | 97 项：96 通过、1 因 Windows 文件 symlink 创建权限跳过、0 失败；目录 junction 与 hardlink 安全检查通过；CI 同一文件 symlink 用例实际通过 |
| 本地更新 UI | Chrome 5/5 首次通过、5 次实际执行、0 重试/跳过/flaky；390×680 与 1440×1000 布局、速度/ETA、后台弹窗、full 回退、缓存与脱敏详情通过 |
| 打包 controller → IPC → UI | 7 项检查通过；真实 0.2.68 controller、NSIS 实例、preload/IPC、生产 UI 与诊断日志贯通，差分 2.5 MB/s / 12 秒、full 回退及 100% 等待完成状态一致 |
| 打包贯通安全边界 | 目标 0.2.69 为合成事件；主进程/后台外部网络尝试 0、生成提交 0、安装调用 0、渲染错误 0、正常退出后所属进程 0；原 0.2.68 exe/ASAR 保留 |
| 安装包完整校验 | CI producer 全量读取生成安装包并计算 SHA512，与 latest.yml 两个哈希字段及大小一致；版本、GitHub 更新配置、发布说明与 blockmap 校验通过 |
| 公开更新文件 | 三资源 HEAD 200；latest.yml 与 blockmap 全量 SHA256 匹配 GitHub digest；安装包精确 1,024 字节 Range 返回 206 |
| 真实更新比较器 | electron-updater 6.8.9：0.2.64～0.2.67 可更新到 0.2.68，0.2.68 和 0.2.69 不提示此更新 |

公开发布日期为 2026-10-08T10:43:30Z。安装包名为 `SuperCanvas-Setup-0.2.68-x64.exe`，大小 216577995 字节，GitHub 官方 SHA256 digest 为 `67a65b452b05e002002a8077aff6427b40c93ce3c0a32f9ae345bf78c386147f`。公开检查只读取 HEAD 与 1,024 字节范围，没有独立完整下载再算安装包哈希；完整安装包 SHA512 证据来自构建端。公开文件的全部 digest 与校验边界以 [安全 JSON 汇总](./release-v0.2.68-check-2026-10-08.json) 为准。

主 CI 与 Release 日志采集各在初轮匿名签名日志下载链路遇到一次 ECONNRESET，各有限重试一次后取得全部 14 份完整日志，原失败收据保留。公开安装包 HEAD 首次及 Range 前两次也遇到 ECONNRESET，有限重试后通过，三项失败留在公开验收 JSON。这些网络采集重试与测试执行分开记录；两工作流完整浏览器和正式 focused 均为零实际测试重试，不能据此说整个验收过程没有网络失败。

打包 IPC 验证使用隔离 0.2.68 副本，只有副本 ASAR 增加隔离/模拟前置代码与网络 guard，保留原 main 正文、package.json 和 262 个原归档文件。0.2.69 更新目标、传输进度及校验完成通知是合成事件，不是真实发布、下载、密码学验证或安装。首轮 controller/IPC/UI 断言通过，但差分原生截图捕获了旧的隐藏合成帧；仅修正忽略目录检查器的截图预热与等待绘制，独立最终副本与三张 final 截图经视检正确，首轮报告/图片及 [说明](../.codex-temp/update-download-status-20261008/packaged-telemetry-first-visual-review.json) 保留。最终 [精简回执](../.codex-temp/update-download-status-20261008/packaged-telemetry-final-validation.json) 与 [完整回执](../.codex-temp/update-download-status-20261008/packaged-telemetry-final-report.json) 可复核。

本版增加下载状态与诊断，保留原有下载源、差分策略、文件/签名校验与安装流程；状态显示本身不承诺增加网络带宽。发布验收时只读观察正式客户端当前为 0.2.67，本轮没有替用户安装正式 0.2.68；新版下载界面安装 0.2.68 后生效。真实 Key 没有进入本验收，未提交收费生成。视频分组创建和价格设置属于另一个授权任务，不混入本发布收据。短时回归和 smoke 不代表多小时稳定性保证。

截图：[差分速度与 ETA](../.codex-temp/update-download-status-20261008/packaged-telemetry-final-differential.png) · [完整包回退与安全详情](../.codex-temp/update-download-status-20261008/packaged-telemetry-final-fallback.png) · [完成后安装操作](../.codex-temp/update-download-status-20261008/packaged-telemetry-final-ready.png)。完整 CI 掩码日志及哈希位于 `.codex-temp/release-v0.2.68-ci-review/66f370d2/`，公开资源证据位于 `.codex-temp/release-v0.2.68/`。本报告是发布后的本地收据，保持未追踪，不再提交触发发布流程。
