# Secure Skill GPT Image 2.5 分组重测 · 2026-09-23

后续规则更新：用户要求 4K 成功即开放 2K。画布现由 Sunburst 已保存的 4K 成功证据推断开放 2K，未新增生成，繁忙的 2K 记录仍保留。未来保存新分组 Key 会自动接入核验，详见 [供应商自动核验](supplier-auto-verification-2026-09-23.md)。下文保留此次真实重测时的结果与费用。

截图中的 `secure-skill / gpt-image-2.5 / gpt-image-2.5-flare` 实际支持 2K 和 4K。此前界面的 1K 是缺少该连接实测证据时生成的“默认假设”，不是已验证的上限。本次使用截图所选分组原有 Key，共提交四个不同测试项，每项一次，成功取得三张原图；已将结果和参数回填至正在运行的桌面版。

## 接入依据与原因

- 站点：`https://token.secure-skill.com`；连接 ID：`a2dee814-a7da-49a2-a191-124c13482b04`；分组 ID 44，名称 `gpt-image-2.5`。
- 当前 Key 的 `/v1/models` 返回 `gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`。
- 2026-09-23 读取的公开文档依然写“GPT Image 2.5 仅 1K，1:1 / 3:2 / 2:3”，已与该分组真实返回结果冲突。不能继续用这段旧说明证明当前分组不支持 2K/4K。
- 该分组之前的 Flare、Sunburst 2K/4K 用例仍为 queued。整个供应商的自动核验因另一个 Banana 请求结果不明而暂停，因此没有形成可用于参数面板的成功证据。
- `/api/v1/pricing/channels` 当前列出该组质量 `low / medium / high / xhigh / max`，两个型号均 0.16/次，站点使用 CNY 展示。其他特价组的价格和权限不套用到该 Key。

## 真实测试结果

| 型号 | 请求档位 | 质量 | 请求像素 | 实际原图 | 结果 |
| --- | --- | --- | --- | --- | --- |
| gpt-image-2.5-flare | 2K | max | 2720×1536 | 2720×1536 | 成功，精确匹配 |
| gpt-image-2.5-flare | 4K | max | 3840×2160 | 3840×2160 | 成功，精确匹配 |
| gpt-image-2.5-sunburst | 2K | max | 2720×1536 | 无 | HTTP 408 / rate_limit_error，Model is overloaded, please retry later |
| gpt-image-2.5-sunburst | 4K | max | 3840×2160 | 3840×2160 | 成功，精确匹配 |

三个成功用例使用公开的异步接口 `POST /v1/images/async/generations`，保留任务编号后用 `GET /v1/images/async/{task_id}` 查询并下载原图。对应任务分别为 `img-5048c453-4753`、`img-697e2b9e-0362`、`img-14d3a0c5-ac57`。

Sunburst 2K 使用桌面版实际画布运行接口和现有 OpenAI 同步适配器，运行 ID `8c2a91a7-b420-442c-9e64-49c32be2f7a0`。上游约 2.6 秒返回模型繁忙，未取得图片；此项记录为 inconclusive，未误判尺寸不支持、未重发。成功的异步用例原图通过现有核验归档服务写入素材库并放入核验画布，不把这一步描述为同步生成链路已全部实测通过。

## 画布回填与校验

- Flare 现有 1K、2K、4K 选项；2K/4K 是当前 Key 实测，1K 保留为既有默认假设。
- Sunburst 现有 1K、4K 选项；2K 本次繁忙，仍未标为已通过。
- 两个型号的 max 成功后开放 `auto / low / medium / high / xhigh / max` 请求预设，默认 max。其他质量和其他比例没有逐项付费实测。
- 已通过的档位开放原有比例预设，只有本轮请求的横图像素有实测证明；不宣称所有比例都已验证。
- 当前连接的 `requestTimeoutMs` 设为 600000；这是客户端配置，不能保证上游网关一定等待同样时长。
- 本次四条结果进入供应商核验记录，同型号同档位原有 queued 项标为 superseded，避免以后恢复队列时重复提交。Banana 的旧问题及全供应商暂停状态保留。
- 三张原图进入素材库，并保存至新建的“Secure Skill 实测 · 2026-09-23”画布，ID `903899e4-e775-40c0-8f36-144738183b7a`。原工作画布未由本任务改写。
- 实时刷新目录后再次读取缓存，两个型号的档位和质量结果一致。刷新未增加生成次数；Flare 4K/max 的现有适配器参数校验通过。三张素材库原图 SHA-256 与下载原图逐一一致，核验画布保存后回读包含三张图片节点。
- 本轮为真实接口重测和配置/证据回填，没有改动应用源代码、重新打包或替换程序。

## 费用与证据

余额从 9.598 降至 9.118 CNY，新增三条 0.16 CNY 明细，合计 **0.48 CNY**。截至 2026-09-23 16:14:35（中国标准时间），Sunburst 2K 繁忙请求没有新增账单。Flare 2K 请求在供应商账单中标作 4K，本报告档位沿用画布预设，并以真实像素 2720×1536 为准。

账单的 `media:…` 请求编号与本地幂等编号及异步任务编号不同；按分组、型号、时间范围、新增记录和余额变化核对，保留为费用旁证，不伪标自动请求编号匹配成功。

原图 SHA-256：

- Flare 2K：`b5e842b7a980c41395218341999c37cf752d935aa617a19d098892b90c5ab1bb`
- Flare 4K：`fb9b0845decb64b3f3d5ea3600ac1b0eaa6a3d4febcbba5885a431df7ad39d45`
- Sunburst 4K：`adab7648cc8c88673a9b2c6c579751da414f37232789e1c5944c5afadebdbaf0`

本地审计目录：`.codex-temp/secure-skill-20260923/`，包括脱敏目录与分组资料、文档片段、`results.json`、账单前后快照、`verification-before-import.json`、`import-report.json`、`final-check.json` 及原图。没有本地生成、放大、合成或重排图片。
