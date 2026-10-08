# 供应商与官方文档日检 · 2026-10-07

用户时区为 **America/Los_Angeles**。本轮公开资料采样为 2026-10-07 **18:25–18:30 PDT**，Key 目录初读为 **18:27:29–18:28:03**，差异及临时失败另作定向复读。UTC 原始时间、基线和安全元数据见同名 JSON。

已创建当前聊天的每日自动检查任务：**每天 20:00，洛杉矶时区**。检查官方公告、目录、分组、报价、技术文档与现有 Key 的免费模型目录；无重要变化时保持安静，有确认变化、检查失败或待处理问题时通知，已有问题没有变化时不重复通知。

本轮检查 **16 家有效供应商、126 条在用连接**，排除已删除供应商及停用历史连接。最终 **104 条返回模型、17 条鉴权或权限未通过、5 条返回空目录**。FriModel 的 3 次临时网络失败均经复读恢复。本轮不包含收费生成，不能用目录和文档结果代替真实出图、性能或扣费验证。

## 确认的变化

| 供应商 | 本轮新见事实 | 对项目的影响与证据范围 |
| --- | --- | --- |
| 沧元算力 | `IMAGE` 和 `全模型-无claude/gpt` 两条 Key 均新增 `gemini-nano-banana-2.1`，目录分别 30→31、67→68；公开目录 91→92。`LLM-Claude-MAX` 再次返回 `claude-haiku-4-5-20251001`，9→10。 | 两次 Key 查询确认。Nano 2.1 有沧元专属 Images 合同，不能套用其他供应商同名型号的原生 Gemini 字段。新增出现不等于已完成生成验证或确切上线时间。 |
| 辰途 API | `兜底原生生图` 本轮不再返回 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`，6→4；`grok生图` 不再返回 `grok-imagine-image-quality`，3→2。公开目录 63→62，缺席后者。 | 两次 Key 读取确认，仅适用于这两个分组；不解释为所有分组或全站永久下架。已有节点采用这些分组时需核对型号。 |
| MikotoPro | `生图（2k4k 高质量）` 新返回 `gpt-image-2`，22→23。 | 两次 Key 查询确认；其他组不借用该组权限或报价。三篇图片指南和批量合同没有新的语义变化。 |
| 创想ai | Claude-反重力公开组标签 0.11x→0.13x，原始倍率 1.1→1.3；视频组重新列出 8 个旧 ID，26→34。当前视频正文推荐带原 Key 下载本站 content 路径。 | 同一公开组两次读取确认；倍率是文字组计价信息，不是新增生图分组。视频下载返回相对路径时必须按本站地址和鉴权合同处理。当前 Key 型号没有增删。 |
| 喵呜 API | 公开目录 21→18，不再列出 `minimax-h3-plus`、`doubao-seedance-2.0-fast`、`seedance-2.5-pro`。 | 两次公开读取确认；两条现有 Key 仍为 403，不能确认账户内对应权限，也不将旧 Seedance 2.5 报价当作当前有效报价。 |
| 词元 | 两条 Key 的裸型号均 74→75，新增 `minimax-m2.7`。公开新增 4 条公告，商家商品在两次采样间继续变化。 | 裸型号变化两次确认。商家 alias、在线状态、零售价格和账户可见商品分开判断，未读取认证账户 alias 清单。 |
| pDog | 香蕉稳定渠道由列出 `gemini-2.1-flash-image` 改为列出 `gemini-3.6-flash-image`，总数仍为 3。 | 两次 Key 查询确认，仅是目录 ID 变化；旧指南未写新 ID，不能推断底层型号、全部参数或价格。 |

其他 9 家（智元api、FriModel、We-AI、赛博阿飞、怪兽ai、secure-skill、基因形象、夯炸了、Synora）的当前 Key 型号相对本轮启动前应用库存没有确认增删。

来源：[沧元目录](https://ai.cangyuansuanli.cn/api/pricing)、[Nano 2.1 专属合同](https://ai.cangyuansuanli.cn/docs-static/models/gemini-nano-banana-2.1.json)、[辰途目录](https://tu.988236.xyz/api/pricing)、[创想广场](https://vapi.chuangxiangai.asia/api/v1/model-plaza)、[创想视频文档](https://vapi.chuangxiangai.asia/docs/video)、[喵呜目录](https://api.miaowuai.store/api/pricing)、[词元公告](https://tk1688.com/api/status)、[词元市场](https://tk1688.com/market)，以及本轮各官方 API 域名的现有 Key 免费模型查询。

## 需要保留的技术与计价条件

沧元 Nano 2.1 的 `IMAGE`、`全模型-无claude/gpt` 倍率均为 1，公开参考价为 **1K ¥0.06/张、2K ¥0.08/张、4K ¥0.10/张**。文生图使用 `/v1/images/generations`，编辑使用 `/v1/images/edits`；`quality=1k/2k/4k` 决定清晰度，`size` 为比例，`n=1`。文档仅列 10 种比例，不支持任意像素宽高或 secure-skill 的四种扩展长宽比。参考图为 `images` HTTPS URL 数组，最多 14 张、每张 35 MB，无蒙版。这是文档声明，未做收费实测。[官方合同](https://ai.cangyuansuanli.cn/docs-static/models/gemini-nano-banana-2.1.json)

创想视频创建、状态查询仍使用 `/v1/videos/generations` 家族；下载推荐 **GET `/v1/videos/{TASK_ID}/content` 并使用创建任务的原 Key**。状态返回 `/v1/...` 相对路径时需补本站前缀并保留鉴权；409 时继续查询原任务。不能将 HTTP `X-Request-Id` 当视频任务 ID。重新列出的 8 个视频 ID 属于此前目录中出现过的旧型号，不称为 8 款新发布。[官方视频文档](https://vapi.chuangxiangai.asia/docs/video)

词元公开商品初读 **748 / 75 个底层市场标签 / 46 个按次图片商品**，复读为 **747 / 75 / 45**，两次均返回完整 `total=returned`。复读时 742 个商品在线、44 个图片商品在线；期间 `gpt-image-2@s1c34` 从商品列表消失，`gpt-image-2@s1c77` 转为离线，共同商品报价字段未变。上述是具体商家线路状态，不等于裸型号或当前 Key 下架。4 条新公告为定价准确性修复、功能更新、服务中断致歉、访问提速。供应商声明已恢复服务；公告内中断发生时间没有明确时区，未猜测发生时间，也没有实测性能。零售价格字段已包含平台加价，不再次乘 markup。[官方公告](https://tk1688.com/api/status)、[公开商品接口](https://tk1688.com/api/marketplace/listings)

## 文档覆盖与访问限制

- FriModel 的官方 Apifox 现有 21 页、We-AI 现有 21 页正文与 10-03 原文一致；FriModel 包含 1 页价格图片的文本包装，实际价格 PNG 两次超时，未确认像素或完整价格数值。Fri canonical 文档域名连接失败，官方配置所指 Apifox 别名可读。
- Mikoto 两篇指南仅 BOM 差异，另外一篇及批量真实 JS 原始字节一致。智元批量 JS 排除资源引用后 1,392 个正文字符串一致；怪兽批量正文及主资源原始字节一致。
- secure-skill 当前文档与已保存的 Nano 2.1 原文一致，四种扩展比例和 16 张参考图属于此前已完成更新；基因形象的香蕉 2.1 公告也已在此前报告记录，不重复报为新增。
- 夯炸了技术 HTML 与旧原文一致；公开价目 134 条，导出声明为 CNY/百万 Token，不能将图片行数字直接写成每张价格。Synora 的关键单图、Gemini 和 batches 合同符合旧记录，缺全文历史基线，未声称逐字节无变化。pDog 两篇指南去旧文件末尾 CRLF 后全文一致。
- 沧元读取 manifest 和重点型号合同，未重扫全部历史文档。部分公开公告、价格或广场需要登录；匿名 401、关闭广场的 404 及网络失败只记录访问边界。本轮没有读取认证账户分组或商家 alias，不能声称覆盖所有登录内公告、分组和报价。

## 在用连接状态

| 供应商 | 在用连接 | 返回模型 | 鉴权/权限未过 | 空目录 |
| --- | ---: | ---: | ---: | ---: |
| 沧元算力 | 8 | 6 | 2 | 0 |
| 智元api | 6 | 6 | 0 | 0 |
| 辰途 API | 17 | 12 | 5 | 0 |
| MikotoPro | 10 | 6 | 4 | 0 |
| FriModel | 12 | 9 | 0 | 3 |
| We-AI | 9 | 9 | 0 | 0 |
| 赛博阿飞 API | 6 | 5 | 1 | 0 |
| 喵呜 API | 2 | 0 | 2 | 0 |
| 怪兽ai | 7 | 7 | 0 | 0 |
| 创想ai | 6 | 6 | 0 | 0 |
| secure-skill | 23 | 19 | 3 | 1 |
| 基因形象 | 5 | 4 | 0 | 1 |
| 夯炸了 | 6 | 6 | 0 | 0 |
| 词元 | 2 | 2 | 0 | 0 |
| Synora | 3 | 3 | 0 | 0 |
| pDog | 4 | 4 | 0 | 0 |
| 合计 | 126 | 104 | 17 | 5 |

空目录仍为 FriModel 的 `gpt_image_adobe_外接`、`gpt_image_leo`、`gpt_image_web_4`，secure-skill 的 `grok视频-备用`，基因形象的 `image2.5_0.2分组`。17 条未通过读取的连接均返回 403，不据此判断分组或型号永久下架。详情见同名安全 JSON。

## 数据保留与后续日检

本轮只有官方资料和免费模型目录读取，收费生成、Key 创建/删除和正式数据库写入均为 0；正式数据库读取前后 SHA256 一致。报告不包含 Key、用户名、私有连接 ID 或逐 Key 完整型号库存。We-AI 图片组使用现有应用适配器比较，Claude 文字组按完整文字 ID 比较；词元只比较裸型号，排除应用中混合存储的商家 alias。

后续日检以最近一次成功的同连接读取为基线。初轮请求前冻结基线，定向复读使用同一基线，避免应用尚未导入旧变化时把历史差异重复报为今天新增。失败读取保留最近成功库存。脚本独立于应用服务，网络守卫只允许同供应商模型目录 GET，不启动应用刷新或付费核验。

本机检查器：[key-directory.cjs](../.codex-temp/supplier-daily-20261007/key-directory.cjs)。初轮完成后，对新增/缺席或网络失败执行 `--confirm`，再由 [merge-key-results.cjs](../.codex-temp/supplier-daily-20261007/merge-key-results.cjs) 合并；初轮与确认不能并行。每次启动使用独立 Electron 资料目录，凭据仅在内存中使用，保持系统密钥保护上下文。

详细公开证据：[重点五家](../.codex-temp/supplier-daily-20261007/primary-public.md)、[另外五家](../.codex-temp/supplier-daily-20261007/other-public.md)、[余下六家](../.codex-temp/supplier-daily-20261007/remaining-public.md)。这些本机原文与比较基线位于 Git 忽略目录；共享时以本文及同名脱敏 JSON 为准。

本地定时任务需要执行时电脑开机且 Codex 保持运行。[OpenAI 官方定时任务说明](https://learn.chatgpt.com/docs/automations)
