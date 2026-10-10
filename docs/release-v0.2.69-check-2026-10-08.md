# 0.2.69 发布、视频合同与价格验收（2026-10-08）

0.2.69 已作为最新稳定版公开发布，最终提交为 `c21b76619b15d440fb2a5edc192feb3e83dbb49b`。本收据完成于 2026-10-08T13:22:17.251Z，日期按 America/Los_Angeles。

[公开发布与安装包](https://github.com/moshangqingchen/CanvasMind/releases/tag/v0.2.69) · [主 CI](https://github.com/moshangqingchen/CanvasMind/actions/runs/37780506775) · [Windows 发布流程](https://github.com/moshangqingchen/CanvasMind/actions/runs/37780507180) · [版本说明](./releases/v0.2.69.md)

本版按完整视频型号选择对应可用分组，避免借用同名图片或相似型号报价；导入明确的按秒价格、原币种与计费单位，分组倍率只计算一次。secure-skill 的账户分组按数字 ID 精确对应，token 价格按人民币/百万 token 显示，保留分辨率和参考视频条件；token 用量未知时不猜总价。沧元三个 Seedance 官转与创想 34 个精确型号复用各自合同的参数、提交、查询和结果读取。喵呜默认分组五个只有免费 Key 目录证据的型号保持待协议确认，旧缓存的自动聊天接口也在提交前拒绝；手动配置、自定义端点、已确认合同和 Key 权限边界保留。

| 验证 | 实际结果 |
| --- | --- |
| 最终主 CI | 6/6 作业成功；3971/3971 全项目单元、12/12 维护通过 |
| 主 CI 浏览器 | 325/326 首次通过；实际 327 次执行、1 次重试、1 flaky、0 跳过、0 最终失败；320 功能 + 6 性能、18 组性能测量 |
| Windows 发布流程 | 总体 8/8 作业成功；7/7 前置成功；3971/3971 单元、12/12 维护；浏览器 326/326 首次通过；实际 326 次执行、0 次重试、0 flaky、0 跳过、0 最终失败 |
| 主 CI Windows 桌面 | 97 项：97 通过、0 跳过；smoke 27 + GPU 4，rendererErrors 0 |
| 发布前置 Windows 桌面 | 97 项：97 通过、0 跳过；smoke 27 + GPU 4，rendererErrors 0 |
| 正式安装包 producer | 97 项：97 通过、0 跳过；smoke 27 + GPU 4，rendererErrors 0；完整安装包 SHA512、版本、发布说明、更新配置与 blockmap 验证通过 |
| 发布专项 | focused 浏览器 30/30 首次通过；实际 30 次执行、0 次重试、0 flaky、0 跳过、0 最终失败；Vitest 两个专项子集 192 + 62 项通过，不叠加成独立覆盖 |
| 本地最终功能 UI | Chrome 5/5 首次通过、5 次执行、0 重试/flaky/跳过/付费提交/pageerror；完整型号分组、条件 token 价格与遮挡恢复通过 |
| 主 CI 快捷键首次失败复核 | 同一弹窗 case 初次 11.5 秒失败、retry#1 1.6 秒通过；发布前置首次 1.2 秒通过。同生产用例有界重复 5 次均首次通过（900/892/797/827/770 ms），无源改动 |
| 本地完整单元 | 3971 项：3970 通过、1 Windows 文件 symlink 权限跳过；发生于最后测试隔离提交前，生产源码相同；最后 providers 1251/1251 再通过 |
| 本地生产打包与 smoke | 最终功能源码生产构建/unpacked 0.2.69 成功；27 检查、无 renderer 异常、重启页面非空 |
| 公开更新资源 | 三文件 HEAD；latest.yml 与 blockmap 全量 SHA256 匹配 GitHub digest；安装包 1024 字节 Range 206 |
| 实际升级比较器 | electron-updater 6.8.9：0.2.64～0.2.68 可更新至 0.2.69；0.2.69、0.2.70 不提示此更新 |

公开发布日期为 2026-10-08T13:11:50Z。安装包 `SuperCanvas-Setup-0.2.69-x64.exe`，216605464 字节，GitHub 官方 SHA256 为 `35b36b5cfe0008c324422d08afa2ea722f1ab7aa520602a6c8cebc99833d517d`。公开检查只读取 HEAD 与 1024 字节范围；完整安装包哈希证据来自最终 CI producer，未独立下载公开完整包。全部 digest、时间、请求状态和边界见 [JSON 收据](./release-v0.2.69-check-2026-10-08.json)。

本地第一轮全量有一个 5 秒超时：登录测试未把内部默认 HTTP transport 隔离，通用示例域名仍触发 DNS。仅修正测试 fixture，保留真实登录校验、原超时与失败报告；目标 46 项及敏感 5×2 项再验证通过。随后 7ffc67a5 的发布前置出现 supplier-login 的 HTTP 200 permission_denied 用例 5 秒超时，其 HTTP 已是 mock，但端点检查仍等待公网 DNS。仅隔离这个测试文件的 DNS/HTTP，保留准确官方域名的鉴权边界，49 项、敏感 5×5 项及 providers 全 1251 项通过。最终提交相对 7ffc67a5 只有这个测试文件变化，生产源码一致。此前 22d48a4 与 7ffc67a5 发布准备均由 root 取消，失败与取消证据保留；上述旧工作流不作为最终发布成功证据。

最终主 CI 的快捷键弹窗首次失败发生于等待关闭按钮焦点，关闭按钮当时未找到；真实一次重试通过，发布前置同一用例及同生产独立 5 次复验均通过。只读代码存在初始化 ready 后才注册快捷键监听的门槛，而测试仅等待项目菜单可见，这只是可能因素，未确认唯一原因或产品缺陷。官方 artifact 名单只查一次，没有该成功 flaky 作业的诊断包（工作流仅 failure() 上传），没有首轮 trace/截图可用于进一步确认；不把未复现说成已修复，也不改记为零 flaky。

22d48a4 历史主 CI 日志初两次匿名重定向下载出现 ECONNRESET，失败收据保留，改用已有 providerFetch/configured proxy 后取得完整日志。最终 c21 主 CI 日志第一轮 API 连接 UND_ERR_SOCKET，有限再采取得完整日志。公开验收的前两轮分别遇到 release-metadata API ECONNRESET、blockmap HTTP200 后正文超时，原报告保留。日志采集和公开资源的网络重试与测试重试分开记录；最终两流程的真实首次失败/重试次数以完整日志 JSON 为准，不能把整个准备过程描述成零失败。

本版保留 0.2.68 的速度/ETA、preparing/differential/full/cached 状态、差分回退与有界脱敏诊断；状态显示不承诺增加网络带宽。本轮只读发布验收未执行正式安装、收费生成或修改正式资料库。本轮供应商视频分组与 Key 接入已完成，见 [分组接入记录](./supplier-video-group-provision-2026-10-08.md)。UI 与 smoke 是短时回归；真实收费生成、长时运行不在本次验证证据内。

沧元三个当前官方技术 JSON 已成功重读；创想当前公开目录与价格已重读，但当前技术 chunk 正文的有限网络读取失败，复用已有精确合同，不能称全部当前技术正文都已读取或无变化。

可复核 [最终 UI 收据](../.codex-temp/release-v0.2.69/renderer-e2e-miaowu-final-validation.json)、[喵呜旧缓存离线复验](../.codex-temp/release-v0.2.69/miaowu-boundary-fixed-final-report.json)、[本地测试隔离诊断](../.codex-temp/release-v0.2.69/models-isolation-diagnosis-safe.json)、[发布前置 DNS 诊断](../.codex-temp/release-v0.2.69/supplier-login-dns-diagnosis-safe.json)、[主 CI 计数](../.codex-temp/release-v0.2.69-ci-review/c21b7661/ci/workflow-counts-summary.json)、[Release 计数](../.codex-temp/release-v0.2.69-ci-review/c21b7661/release/workflow-counts-summary.json) 和 [公开资源验收](../.codex-temp/release-v0.2.69/public-v0.2.69-verification-2026-10-08T13-20-37.533Z.json)。完整掩码日志与哈希保存在 `.codex-temp/release-v0.2.69-ci-review/c21b7661/`。本地收据保持未追踪，不提交触发新发布。
