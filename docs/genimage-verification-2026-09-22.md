# 基因形象参数与测试记录 · 2026-09-22

按此前约定：先读取模型广场、分组与已有实测；只补未知分辨率和最高质量，同组同型号不重复付费；最高档成功后开放其他质量请求预设，未逐档测试不伪造实测证据。结果不明暂停，视频不生成。

## 核对结果

站点 `https://genimage.pro`；图片接口 `/v1/images/generations`。模型广场的通用聊天示例与实际图像路由不一致，不能直接当成图像调用协议。

| 分组 | 当前 Key 图片型号 | GPT 图像标价 |
| --- | --- | --- |
| default | 3 个 GPT 图像型号、4 个 Gemini 型号 | $0.20 / 请求 |
| gptResponseBase64 | gpt-image-2、gpt-image-2.5-flare、gpt-image-2.5-sunburst | $0.20 / 请求 |
| geminiResponseUrl | 3 个 GPT 图像型号、3 个 Gemini 型号 | $0.08 / 请求 |
| image2.5_0.2分组 | 空列表 | 不冒用其他分组模型 |

GPT 基础价 $0.08；default 和 gptResponseBase64 倍率 2.5，geminiResponseUrl 倍率 1。原币和站内余额显示一致，不换算人民币。

三个 GPT 型号均被模型广场声明支持 1K、2K、4K；Image 2 明确不支持透明背景，两个 Image 2.5 型号声明支持。声明不等于本轮已验证实际像素。Gemini 未套用 GPT 参数；本轮未付费调用 Gemini。

## 已有记录与本次请求

- 既有 `default / gpt-image-2`：`high / 2720x1536 / n=1`，2026-09-22 12:40:34 提交，本地连接中断，官网后来扣 $0.20。上游请求 `202609220440336319737938268d9d6Eg1XJSq4`。没有原图，不能证明输出分辨率。
- 既有网站 QA：同组同型号 `1024x1024 / n=1 / b64_json`，未指定 quality，成功返回 1024×1024 PNG，扣 $0.20。原始记录位于 `.codex-temp/genimage-qa-20260922/`。不能用此样本证明 high 或 2K/4K。
- **本轮仅新增 1 次请求**：`gptResponseBase64 / gpt-image-2`，`high / 2720x1536 / n=1 / response_format=b64_json`。2026-09-22 13:48:53 提交，11.436 秒后 `fetch failed`，未收到 HTTP 状态、原图或任务编号。
- 本次本地请求 `3714a65f-fb50-4671-84df-7339376efb89`；14:20 的只读复查发现对应分组型号新增消耗 **$0.20**，上游请求 `202609220548519349479298268d9d6YGWQVxHg`。余额 $10.10 → $9.90，请求数 2 → 3。
- 后续 7 项最高质量补测未提交。没有重复请求、自动重试、充值、创建密钥或本地造图。原图未取回，2K/4K 实际输出与 Image 2.5 的 max 仍待实测。

API 请求 ID 与本地幂等 ID 不同。账单匹配来自这段时间内唯一的同分组型号新增记录和余额变化；程序自动按请求 ID/任务 ID 关联仍保留“未核对”，不虚报自动核对成功。

## 画布变更

- 精确限定 genimage.pro、三个有效 GPT 分组和三个精确型号；不影响其他供应商、未知分组、智能体或被拒绝的模型。
- 补齐自动尺寸与 1K/2K/4K，每档 11 种比例，显示请求像素。尺寸标为供应商声明，比例为预设。
- Image 2 默认 high；Image 2.5 默认最高档 max，并标记待核验。成功后由已有核验逻辑开放其余质量选项。
- 补齐背景、数量和返回方式；Image 2 不提供透明背景。多图数量、透明效果、URL 返回仍未实测。
- 保留已有操作与分组价格，不凭文生图记录新增编辑已验证状态。
- 修复账单读取未附带站点登录凭据，以及新旧 NewAPI 账单路径尾斜杠差异。认证只发送至明确的同站只读端点。

## 验证与部署

相关 providers 测试 71 项、renderer 测试 71 项通过；新增画布界面回归通过，覆盖 2K/4K 选择、保存、刷新恢复，生成提交次数为 0。TypeScript 与生产构建通过。正式打包版 22 项冒烟检查通过，包含持久化、退出、重启和资料恢复。

用户保存并从托盘正常退出后，已于 2026-09-22 14:28 将正式打包版安装至 `apps/超级画布桌面版/SuperCanvas.exe`，重新启动。Build ID：`spffz3AIAfVikq0tdipeg`；11,201 个程序文件逐一校验一致。

安装前完整备份并校验 780 个资料文件和旧程序：

- 资料：`C:/Users/Administrator/AppData/Local/SuperCanvasDesktopBackups/before-genimage-20260922-142748/profile`
- 程序：`backups/genimage-program-20260922-142748/`

已将本轮断线请求登记为 `needs_attention`，核验队列维持暂停，used 从 1 增至 2，limit 仍为 18。收费记录附上游请求 ID，自动账单关联状态仍为 unknown。已扣费但缺失原图的请求不会自动重发。

更新后逐项比较资料库，除基因形象的该条核验记录外，所有资料区段及其他供应商核验记录保持一致：81 个连接、1 个画布、99 个素材、83 条运行记录。

详细脱敏审计、计划、单次提交记录和余额复查位于 `.codex-temp/genimage-20260922/`。

## 后续使用反馈：120 秒超时修复

用户截图对应后续自行提交的 `geminiResponseUrl / gpt-image-2.5-sunburst` 文生图请求，本地运行 `4c5a3647-447f-4009-9687-6650c96792a0`：2026-09-22 14:38:15.600 至 14:40:16.010，耗时 120.410 秒，`max / 2496x3312 / n=1 / b64_json`，错误 `request_timeout`，没有任务编号或输出素材。官网截图显示 2 分 1 秒、扣费 $0.08；扣费本身不能证明图片已生成成功。

此请求命中 OpenAI 适配器的默认 120 秒等待上限。修复将精确匹配基因形象的三个 GPT 型号、三个有效分组的文生图及图生图提交默认等待延长为 600 秒，并同步设置直连与代理的底层 HTTP 响应头/响应体等待预算，避免 Undici 默认 300 秒再次提前断开。显式连接超时配置仍优先；其他供应商默认值保持原状。

不重新提交这条已扣费请求，不改变超时后 `needs_attention` 与禁止自动重试的逻辑。此修复只防止本地过早放弃等待，不保证上游一定成功或可恢复旧响应。

验证：112 项 providers 相关测试及 1 项运行时不确定提交安全测试通过。离线虚拟时钟覆盖 121 秒响应仍收图、600 秒截止、文生图/图生图、实际 max 参数、默认传输路径、直连/代理预算、供应商隔离及单次付费 POST 语义；修复验证没有调用真实付费接口。

TypeScript 与桌面生产构建通过，正式打包版 22 项冒烟检查通过。用户正常退出后，已于 2026-09-22 15:01 安装并重新打开桌面版，后台启动就绪。Build ID：`BXROCA0_gj3XFMQWu6ccG`。11,201 个程序文件校验一致，800 个资料文件保持原样；重启后资料库 SHA-256 与安装前备份完全一致，保留 81 个连接、1 个画布、101 个素材和 86 条运行记录。核验队列仍暂停，没有重新提交旧请求。

资料备份：`C:/Users/Administrator/AppData/Local/SuperCanvasDesktopBackups/before-genimage-timeout-20260922-150032/profile`；程序备份：`backups/genimage-timeout-program-20260922-150032/`。安装记录：`.codex-temp/genimage-timeout-20260922/install-report.json`。

## 后续反馈：供应商 Cloudflare 524 与取消后的迟到结果

不能将前述本地超时修复视为完整解决。更新后 `geminiResponseUrl / gpt-image-2.5-sunburst / max / 2496x3312` 的两次请求均收到供应商发回的 HTTP 524 HTML 错误页：

| 本地运行 | 提交时间 | 失败时间 | 本地耗时 | 收到内容 |
| --- | --- | --- | --- | --- |
| `b47e3124-c7da-4489-87aa-c17214079918` | 15:03:01.163 | 15:05:06.954 | 125.791 秒 | `genimage.pro \| 524: A timeout occurred` |
| `be9c79fe-df54-482a-82f8-d72cd809087d` | 15:05:52.251 | 15:07:58.008 | 125.757 秒 | `genimage.pro \| 524: A timeout occurred` |

对应用户截图账单 15:05:19、15:07:58 各 $0.08。这里没有原图响应或可查询任务 ID；不能伪造恢复或重新提交。Cloudflare 当前官方说明：源站未在默认 125 秒内返回响应会产生 524，长请求需要供应商提供状态轮询/异步处理、未被代理的正式 API 子域，或调整其代理等待上限。继续延长客户端超时无法消除已经返回的 HTTP 524。

官方依据：[Cloudflare Error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)。当前官网控制台的 API 信息显示“未配置 API 路由”；sunburst 模型详情只有通用同步调用示例，未找到其官方异步/备用入口。任务日志为 0 条，绘图日志页返回 500。不能据此猜测一个新入口并把用户密钥发送过去。

另一个独立情况是 `793adae3-ce7d-4022-8b2c-3b1dfa53c38d`：15:02:53.551 提交后约 2 秒运行被取消，15:04:58.867 收到成功响应；程序保留了 `inputJson.providerTask.result` 中的图片 URL，但取消状态阻止归档。已从保存的 URL 单次 GET 取回原图，没有重新生成、没有修改运行/数据库：

- 文件：`.codex-temp/genimage-recovery-20260922/a387d80f-9fd8-4802-993d-52d631e1498e.png`
- PNG，2496 × 3312，8,889,132 字节
- SHA-256：`05aabb3fcbe4cb87273a2e1d6088866faaeb369e02d3ebf3b39815de67acaf8b`
- 恢复记录：`.codex-temp/genimage-recovery-20260922/recovery-report.json`

源码已修正 HTTP 524 的错误分类及提示：明确供应商网关超时，提交阶段提醒核对已扣费请求、不要重复提交；保留禁止自动重提逻辑，查询阶段不误报扣费。该提示变更尚未安装到正在运行的桌面版；不将其描述为供应商长请求通道已修好。

## 15:24 目录复查及已有结果恢复

最新四组只读 `/v1/models` 与 `/api/pricing` 复查证实：`geminiResponseUrl` 已移除全部三个 GPT image 模型，只保留三个 Gemini 模型。GPT image 目前仅列在 `default` 与 `gptResponseBase64`，倍率仍为 2.5（$0.20 / 请求）。这是供应商目录变化；不能继续使用前文早些时候的 $0.08 GPT 分组目录，也不应静默切换至更贵分组。

`/api/status` 未公布服务版本、备用 API 地址或异步插件；个人任务列表为空。对既有本账户日志 ID 的只读 `GET /v1/tasks/{id}` 返回 `404 Invalid URL`，并非一个有效任务查询路由。通用 New API 插件文档不能证明该站启用了相关插件；目前没有可直接接入且能恢复两条 524 请求的异步入口。

新增独立 `recoverRunOutputs` 和运行历史“取回已有图片”：仅从保存的成功响应提取、下载并归档原图，不调用生成、轮询或执行下游，保留原取消/失败状态和诊断。压缩后的工作流快照也可使用；重复点击和并发恢复复用确定的素材 ID。没有成功响应的 524 请求明确拒绝恢复。

离线导入演练使用真实记录的副本与已下载原图，校验 SHA-256 后成功恢复至原画布，运行仍为 `cancelled`；重复执行不修改数据库。原有素材、其余运行、连接、画布节点和连线逐项比对未变。本次没有新增付费请求。

脱敏证据与演练：`.codex-temp/genimage-recovery-20260922/protocol-audit.json`、`protocol-findings.md`、`import-dry-run-report.json`。

## 15:39 恢复版本已安装

确认程序已退出后，完整备份资料和旧程序，安装 Build ID `ViR7VtsOTP0txDnSVJcWE` 并重新启动。11,208 个打包文件哈希校验一致；安装程序时 802 个原资料文件保持不变，之后通过独立恢复接口导入原图，再精准刷新四个基因形象连接的模型目录。

原图已恢复至原画布和素材库（素材 `e48fd532fcfade1b3a01f0075fdf807ad1706aaacf7785efa1d03a7a8ca5d936`）。最终 81 个连接、1 个画布、102 个素材、89 条运行，画布 4 个节点。原有节点、连线、视角、素材和历史均保留；只新增恢复素材节点及对应输出 ID，更新这四个连接的模型目录，不改密钥、分组或其他模型参数，不切换更贵分组。原取消状态和原始响应保留。

界面同时修复已归档图片被“已取消/失败”占位遮挡的问题。下架型号及未选型号会在运行前被拦截；修复了带 `schemaVersion/viewport` 的画布文档导致提交前校验被跳过的问题。HTTP 524 分类提示现已随此版本安装。两条没有成功响应/任务 ID 的 524 记录仍不可恢复，供应商通道限制未宣称解决。

验证：providers 100 项、runtime 122 项、renderer 定向 40 项通过；目录改动另有 65 项定向回归通过。生产构建通过；“取回已有图片→固定输出→保存→刷新显示”浏览器回归通过，确认无生成提交；打包版 22 项冒烟检查通过。正式导入后再次逐项比对资料和原图 SHA-256，全部通过。本次新增付费请求为 0。

- 资料备份：`C:/Users/Administrator/AppData/Local/SuperCanvasDesktopBackups/before-genimage-recovery-20260922-153821/profile`
- 程序备份：`backups/genimage-recovery-program-20260922-153821/`
- 部署、恢复及核对记录：`.codex-temp/genimage-recovery-20260922/install-report.json`、`import-report.json`、`post-install-data-check.json`
