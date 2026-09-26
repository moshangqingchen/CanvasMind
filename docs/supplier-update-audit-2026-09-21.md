# 供应商与文档更新核查 · 2026-09-21

本轮已完成现有权限可查范围：**11 家供应商、77 条已保存连接（含 5 条历史停用连接）**。模型目录请求 **65 条 HTTP 200、12 条 HTTP 403**；8 家已保存站点账号均登录成功，读取了 8 家完整登录目录和 2 家部分公开目录。智元完整目录需要站点登录。

核查窗口约为北京时间 2026-09-21 20:52–21:03。检查模型目录、分组、价格、能力参数、公告、供应商健康状态及能够访问的文档入口和关键接口文档。**没有发起收费生成，没有改写连接配置或替用户充值。** HTTP 200 只证明 Key 能读取模型目录，不证明所有模型均能成功生成。

机器可读证据：[完整 JSON](./supplier-update-audit-2026-09-21.json)。文末保留全部 77 条连接的检查结果。

## 最需要处理的发现

1. **沧元质量档位涨价，应用费用显示存在低估。** Flare/Sunburst 固定分辨率型号的 `xhigh/max` 现为普通价的两倍。当前已保存的 `gpt-image-2.5-flare-4k` 默认质量为 `max`，却仍标为“¥0.20/张”，结构化价格也以 `exact` 保存 0.20。按当前供应商规则，应估算 **¥0.40/张**。这是文档、定价接口与本地模型描述的交叉核对，没有通过实际扣费验证。本轮只报告问题，未修改适配代码。
2. **12 条连接不能读取目录，原因不同。** We-AI 7 条为余额不足；阿飞 1 条、喵呜 2 条、沧元 GLM 1 条为无分组权限；Mikoto Seedance 1 条为分组已停用。We-AI 的站点账号仍可登录，换密码不能解决当前余额问题。
3. **沧元已有目录收缩。** 全模型组不再返回 `sd10-seedance-2.0`、`sd10-seedance-2.0-fast`、`sd10-seedance-2.0-mini`；GPT-pro 不再返回 `gpt-6-astra`，GPT-plus 仍返回。上述异常已重复查询确认。
4. **两个沧元导演台连接的默认模型已失配。** GPT-plus 和 GPT-pro 均保存 `gpt-5.4`，当前各自目录都没有它。这是此前已有的问题，本轮再次确认；未擅自替换默认模型。
5. **FriModel 新增 OpenAI 外接分组；喵呜公开目录增加 Seedance 2.5 Pro。** 新分组没有现成 Key 可测，喵呜已有 vip Key 仍被拒绝，因此不能据此认定用户已获得调用权限。
6. **secure-skill 的 Banana Pro 价格字段与文案矛盾。** 统一价格组 1K/2K/4K 后台价格字段均由 0.07 降至 0.05，但说明还写“0.08元/张”。可确认元数据发生变化，不能把其中任一数字直接认定为最终人民币实扣价。

## 各供应商结果

“分组数”是本轮目录返回的数量；公开目录、账号可用分组及 Key 权限是不同层次。

| 供应商 | 连接数 | 目录成功 / 拒绝 | 当前目录分组 | 结果与变化 |
|---|---:|---:|---:|---|
| 沧元算力 | 8 | 7 / 1 | 17 | 相对保存记录减少 GLM；全模型组 63→60；GPT-pro 5→4；固定分辨率 GPT Image 2.5 计费调整，详见下表 |
| 智元api | 1 | 1 / 0 | 未取得完整目录 | 现有 Key 返回 9 个模型，与保存记录一致；完整分组/价格需站点账号 |
| 辰途 API | 16 | 16 / 0 | 29 | 无敌稳定Pro 相对保存目录增加/重新出现 `gpt-6-astra`，4→5；其余 Key 目录一致；与 9 月 13 日相比部分倍率、价格有变化 |
| MikotoPro | 9 | 8 / 1 | 11 | Seedance 视频分组消失且 Key 明确提示停用；原生4k旧连接返回 24 个模型，需注意这并非 24 个生图模型 |
| FriModel | 4 | 4 / 0 | 15 | 新增 `openai_official_外接`（展示名：openai_official 外接渠道）；已有四组 Key 目录一致 |
| We-AI | 7 | 0 / 7 | 11 | 七条 Key 均为 `Insufficient account balance`；站点登录、分组目录可读 |
| 赛博阿飞 API | 3 | 2 / 1 | 17，公开部分 | 两条图片连接目录一致；gpt5.6-破甲版无权限；部分组倍率较 9 月 13 日提高 |
| 喵呜 API | 2 | 0 / 2 | 7，公开部分 | 两条 vip Key 均无权限；公开目录六组新增 `seedance-2.5-pro` |
| 怪兽ai | 4 | 4 / 0 | 10 | 四条 Key、分组说明和价格与保存记录一致；目录含 C2-Gemini，但账号返回的可用组只有 9 个，不能视为十组全部获权 |
| 创想ai | 1 | 1 / 0 | 17 | 生图 Key 10 个模型、分组和价格与保存记录一致；网站有 9 月 18 日版 Codex 接入教程 |
| secure-skill | 22 | 22 / 0 | 22 | 22 条 Key 模型目录一致；Banana Pro 统一价格组结构化价格下降，文案未同步 |

辰途的 Astra 在 9 月 13 日记录中已出现，不能称为刚发布的新模型。Mikoto 原生4k旧连接增加的 23 项主要是对话/音频型号，9 月 13 日该 Key 也已返回过 24 项；这是相对本机当前缓存的差异，不是今天新上架了 23 个图片模型。该旧分组此前即标为缺失，本次没有据此猜测其后台迁移原因。

## 价格、模型与能力变化

### 沧元：相对 2026-09-13 的价格

以下为当前定价接口与文档的对应价格。固定图片型号按张，Midjourney 按请求。全模型组、IMAGE 的相关倍率为 1；其他分组应另核对倍率。

| 型号或系列 | 旧价格 | 当前普通质量价格 | 当前 xhigh / max |
|---|---|---|---|
| Flare 1K / 2K / 4K | ¥0.055 / 0.075 / 0.095 每张 | **¥0.16 / 0.18 / 0.20 每张** | **¥0.32 / 0.36 / 0.40 每张** |
| Sunburst 1K / 2K / 4K | ¥0.075 / 0.095 / 0.125 每张 | **¥0.18 / 0.20 / 0.22 每张** | **¥0.36 / 0.40 / 0.44 每张** |
| Banana 2，1K / 2K / 4K | ¥0.075 / 0.11 / 0.145 每张 | ¥0.06 / 0.08 / 0.10 每张 | 不套用上述翻倍规则 |
| Banana Pro，1K / 2K / 4K | ¥0.09 / 0.13 / 0.19 每张 | ¥0.06 / 0.08 / 0.10 每张 | 不套用上述翻倍规则 |
| Gemini Flash / Pro Image | ¥0.13 / 0.15 每张 | ¥0.08 / 0.08 每张 | — |
| Grok Image / Image 2.0 | ¥0.11 / 0.13 每张 | ¥0.07 / 0.09 每张 | — |
| Midjourney 1K，Relax / Fast | ¥0.19 / 0.25 每请求 | ¥0.29 / 0.39 每请求 | 每请求 4 张，不能当每张价 |
| Midjourney 2K，Relax / Fast | ¥0.29 / 0.35 每请求 | ¥0.39 / 0.49 每请求 | 每请求 4 张，不能当每张价 |

固定分辨率 Flare/Sunburst 的 `low/medium/high`、省略或 `auto` 走普通档，`xhigh/max` 走两倍档。**不带分辨率后缀**的 `gpt-image-2.5`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` 当前仍是 ¥0.025/张，不能把固定分辨率规则混套过去。

证据：[实时定价接口](https://ai.cangyuansuanli.cn/api/pricing)、[Flare 4K 结构化文档](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-4k.json)、[Sunburst 4K 结构化文档](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-4k.json)。两份文档的审核日期为 2026-09-17，包含质量分档；定价接口也返回 `billing_mode: tiered_expr` 和相应表达式。

应用当前将固定价格直接保存为精确单价，没有将这些表达式转成质量分档；模型质量又默认取 `max`，因此显示价与默认参数组合不一致。后续应同时适配质量/分辨率分档与费用估算，避免只更新名称中的单价。

相对 9 月 13 日，沧元公开价格目录由 74 项变为 80 项（增加 19、移除 13，详见 JSON）。新增/替换包括 sd12、sd13、sd14 Seedance 渠道，以及 kl1/kl2、ve1、wan4/wan5 等视频渠道；新增 `grok-imagine-image-sale` 为 ¥0.019/张、仅 1024×1024。目录变化是两个时间点的差异，不代表所有型号都在今天上线。

当前视频参数中特别需要保留这些区别：

- `sd13-seedance-2.0`：4–15 秒；480p/720p ¥7.11 每任务，1080p/4K ¥15.96 每任务。9 月 20 日公告提及原生 4K。
- `sd13-seedance-2.5`：4–30 秒；480p ¥10.32、720p ¥22.14 每任务；没有 1080p/4K，不应套用同系列 2.0 的上限。
- `sd14-seedance-2.0`：720p、4–15 秒、¥3.90 每任务；支持最多 9 图/3 视频/3 音频或首尾帧组合，输出与参考视频总时长上限 25 秒，具体组合约束以接口能力为准。

以上新渠道能在现有全模型 Key 目录看到，未发起生成任务确认成功率。视频价格为每任务，不是每秒。

### 其他供应商

| 供应商 | 对比基线 | 确认变化 | 解释 |
|---|---|---|---|
| 辰途 | 9 月 13 日 | 低价Adobe倍率 1→1.25；GPT Image 2 基础价 0.04 对应有效数值 0.04→0.05，Flare 0.06→0.075 | 平台计价单位，不能未经汇率/充值规则确认就写为人民币实扣 |
| 辰途 | 9 月 13 日 | 企业级Pro倍率 0.25→0.20；无敌稳定Pro 0.17→0.15 | 分组倍率下降 |
| 辰途 | 9 月 13 日 | `grok-video1.5-fast` 基础价 0.48→0.59；`grok--video1.0` 0.38→0.49 | 保留供应商原始型号拼写，仍须结合所属分组 |
| 阿飞 | 9 月 13 日 | gpt-plus-0.1：0.5→0.55；gpt-pro-0.15：0.75→1；超级福利gpt：0.3→0.5；特价claude-高缓：0.825→0.865 | 属于组倍率，不等同于基础单价或人民币充值折扣 |
| secure-skill | 本轮开始时保存记录 | Banana Pro 统一价格组 1K/2K/4K 的 `imagePrices` 0.07→0.05，降约 28.6% | 文案仍写 0.08 元/张，来源冲突已记录，实际扣费未测 |

来源：[辰途价格接口](https://tu.988236.xyz/api/pricing)、[阿飞价格接口](https://api.3365api.cn/api/pricing)、[secure-skill 模型定价](https://token.secure-skill.com/pricing)。secure-skill 的结构化分组信息通过已保存站点账号读取。

## 文档核查

只有存在可比旧正文的文档，才判定“更新”或“未变”。前端页面壳、HTML/Markdown 返回格式差异、无旧快照的文档，均不能据此断言接口发生变化。

| 供应商 / 文档 | 本轮结果 |
|---|---|
| [沧元图片能力](https://ai.cangyuansuanli.cn/docs-static/capabilities/image.md)、[Image 2 4K](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-4k.json) | 与旧文档相比，尺寸说明更明确：固定尺寸需要传精确 WxH。 |
| 沧元 Flare / Sunburst 4K | **确认更新**：增加质量分档价格，`xhigh/max` 翻倍；上述价格适配问题需处理。`/docs/api` 页面壳本身变化不单独算接口变更。 |
| [Mikoto 图片指南](https://api.mikoto.vip/image-api-guide.html)、[2K/4K 指南](https://api.mikoto.vip/openai-image-4k-2k-guide.html) | 分别与 9 月 13 日、9 月 15 日保存正文完全一致。Seedance 停用来自当前目录/Key 返回，不是图片指南修改。 |
| [辰途媒体 API](https://tu.988236.xyz/docs/api-media.zh-CN.md)、[文档入口](https://tu.988236.xyz/docs/) | 与旧快照正文完全一致。本轮另外读取了 7 个画布分组的能力元数据。 |
| [阿飞 Image 2 文档](https://api.3365api.cn/docs/img2.md)、侧栏索引 | 与旧快照完全一致。公开文档不能说明账号分组权限。 |
| [FriModel 生图指南](https://ai-doc.apifox.cn/9077234m0)、[生成](https://ai-doc.apifox.cn/473749171e0)、[编辑](https://ai-doc.apifox.cn/473749172e0) | 返回格式由旧 HTML 变为 Markdown/OpenAPI；提取旧 HTML 内嵌正文后，指南正文一致，生成/编辑描述也一致，**没有确认接口规则变化**。价格页为图片，本轮以登录后的结构化目录核对价格。 |
| [secure-skill 文档](https://token.secure-skill.com/docs) | 已读取动态渲染正文与各模型章节；没有可比旧文档全文，因此只确认当前规范，不能把页面“新增”字样当作本轮刚更新的证据。 |
| [喵呜媒体接口](https://api.miaowuai.store/docs/openai-videos) | 已读取动态正文；无旧正文可比。当前严格限制视频、图片接口字段，见下文。 |
| [We-AI 生图文档](https://docs.we-ai.cc/guides/image-generation.html) | 可正常读取全文；无旧全文可比。余额不足阻止的是 Key 目录访问。 |
| [创想 2026-09-18 接入教程](https://chuangxiangai.asia/docs/codex-guide-m2-20260918.html) | 首页链接指向此版本，内容主要为 Codex/聊天接入，提及 v1.1.1 辅助安装器；未发现独立的新生图接口指南。本轮未安装工具或更改 Codex 配置。 |
| 怪兽ai、智元api | 公开首页未发现独立 API 文档入口；怪兽通过登录读取了分组说明，智元完整目录仍需登录。不能以未找到入口断言供应商没有文档或没有更新。 |

当前规范中需要继续遵守的要点（**不等同于确认本次新变化**）：

- **secure-skill GPT Image**：JSON `image` 最多 16 个公开 HTTP(S) 参考图链接，不接收本地文件 multipart 或 data URL；GPT Image 2 支持受限自定义 WxH，最大边 3840、16 的倍数。GPT Image 2.5 只列出 1024×1024、1536×1024、1024×1536，没有 2K/4K。异步生图为 `/v1/images/async/generations` 和 `/v1/images/async/{task_id}`，成功状态 `SUCCESS`。
- **secure-skill Seedream**：通过 `/v1/images/generations` 创建并返回 202，按任务 ID 查询，成功状态 `succeeded`；支持 1K/2K，不支持 4K。视频各组也存在不同任务协议，不能用一个公共轮询路径覆盖所有分组。
- **喵呜视频**：`POST /v1/videos` 使用 `seconds/ratio/resolution/image_urls/video_urls/audio_urls`；`size/input_reference` 等未知字段会被拒绝。素材为远程 URL，multipart 可以传文本字段但不接收文件。
- **喵呜图片**：当前文档入口为 `/v1/images` 和 `/v1/images/{id}`，不是通用 `/v1/images/generations`；没有 `n/size`，一次一张。Dream 另有 `/v1/dream/generate`、模型目录/结构查询协议。
- **FriModel 编辑**：仍描述 multipart 文件参数 `image`；请求的尺寸为目标，不保证最终像素完全一致。

## 健康状态与待补权限

沧元 `/v1/availability` 使用已保存 Key 后可以读取，共 71 项：48 项 operational、6 项 degraded、3 项 unavailable、14 项 unknown。不可用项为 `sd10-seedance-2.5`、`sd11-seedance-2.5`、`sd7-seedance-2.0-1080p`；降级项包括 GPT-pro、Grok 视频、sd13 Seedance 2.5、sd7 720p、ve1、wan4。此处是供应商自己的监控结果，不是本轮实际生成测试的成功率，也不等同于当前 Key 的完整可用型号集合。

受登录限制未完成的部分为：智元完整分组与价格目录，阿飞账号分组说明/权限，喵呜账号分组说明/vip 权限。用户已选择“先完成现有权限能查到的部分”，本轮按此范围完成。其余 8 家已保存账号均有效，无需重新提供密码。

## 比较口径与后续处理优先级

- 主要基线为本轮开始时抓取的桌面保存记录；价格另与 9 月 13 日原始接口、文档与已有 9 月 13/15 日快照比较。仅重排模型顺序、原来已标为缺失的分组，不算新增变化。
- 首轮核查期间，正在运行的应用刷新了部分保存记录，因此实时数据库文件哈希出现变化。本轮脚本只写审计文件，没有重写实时数据库；比较使用固定的开始快照，避免混用刷新前后数据。
- 优先修正沧元质量分档费用显示，然后处理失配默认模型、停用/无权限分组；We-AI 若要恢复调用需要处理余额。新分组和新模型应先确认权限与协议，再决定是否接入。
- 本轮交付是核查报告及价格文档注记。应用代码修复、配置替换、充值、新建 Key 和收费生成验证均未执行。

## 全部连接检查表

模型数为当前 Key 返回的目录，不代表付费生成已验证。disabled 为已有停用连接，本次仅查询。

| 供应商 / 连接 | 分组 | 用途 | HTTP | 模型数 | 相对核查开始时保存记录 |
|---|---|---|---:|---:|---|
| We-AI 图片 | 生图-openai-codex-token计费 | canvas | 403 | — | Insufficient account balance |
| 赛博阿飞 API · gpt5.6-破甲版 | gpt5.6-破甲版 | agent | 403 | — | 无权访问 gpt5.6-破甲版 分组 |
| 赛博阿飞 API · 图片视频模型综合分组 | 图片视频模型综合分组 | canvas | 200 | 22 | 目录一致 |
| 沧元生图和视频 | IMAGE | canvas | 200 | 28 | 目录一致 |
| We-AI · 生图-openai-adobe-token计费 | 生图-openai-adobe-token计费 | canvas | 403 | — | Insufficient account balance |
| 赛博阿飞 API · image-2稳定生图 | image-2稳定生图 | canvas | 200 | 5 | 目录一致 |
| We-AI · gemini香蕉 | gemini香蕉 | canvas | 403 | — | Insufficient account balance |
| 沧元算力图像 API | 全模型-无claude/gpt | canvas | 200 | 60 | 新增 0，未返回 3 |
| We-AI Â· AZURE-openai | AZURE-openai | canvas | 403 | — | Insufficient account balance |
| We-AI · claude-code-MAX满血 · 画布 | claude-code-MAX满血 | canvas | 403 | — | Insufficient account balance |
| 沧元算力图像 API | IMAGE-备用分组 | canvas | 200 | 18 | 目录一致 |
| We-AI · adobe香蕉 · 画布 | adobe香蕉 | canvas | 403 | — | Insufficient account balance |
| 沧元算力 · LLM-GPT-plus · 导演台 | LLM-GPT-plus | agent | 200 | 4 | 目录一致 |
| We-AI · 生图-openai-adobe-按次 · 画布 | 生图-openai-adobe-按次 | canvas | 403 | — | Insufficient account balance |
| 沧元算力 · LLM-GPT-pro · 导演台 | LLM-GPT-pro | agent | 200 | 4 | 新增 0，未返回 1 |
| 沧元算力 · LLM-Claude-kiro · 导演台 | LLM-Claude-kiro | agent | 200 | 8 | 目录一致 |
| 沧元算力 · LLM-Claude-MAX · 智能体 | LLM-Claude-MAX | agent | 200 | 9 | 目录一致 |
| 沧元算力 · GLM · 画布 | GLM | canvas | 403 | — | 无权访问 GLM 分组 |
| MikotoPro · Seedance 视频 | Seedance 视频 | canvas | 403 | — | API Key 所属分组已停用 |
| vip视频 | OpenAI Videos | canvas | 403 | — | 无权访问 vip 分组 |
| 辰途 API · 低价Adobe生图 | 低价Adobe生图 | canvas | 200 | 6 | 目录一致 |
| FriModel · gpt_image_adobe | gpt_image_adobe | canvas | 200 | 6 | 目录一致 |
| 喵呜 API · vip | vip | canvas | 403 | — | 无权访问 vip 分组 |
| 辰途 API · 兜底原生生图 | 兜底原生生图 | canvas | 200 | 4 | 目录一致 |
| MikotoPro · Gemini 原生图片 | Gemini 原生图片 | canvas | 200 | 1 | 目录一致 |
| FriModel · gemini_image | gemini_image | canvas | 200 | 2 | 目录一致 |
| 辰途 API · 无敌稳定Pro · 导演台 | 无敌稳定Pro | agent | 200 | 5 | 新增 1，未返回 0 |
| MikotoPro · grok生图 | grok生图 | canvas | 200 | 1 | 目录一致 |
| 辰途 API · 低价gemni生图 | 低价gemni生图 | disabled | 200 | 4 | 目录一致 |
| FriModel · gemini_pro | gemini_pro | canvas | 200 | 2 | 目录一致 |
| MikotoPro · 生图（1k） · 画布 | 生图（1k） | canvas | 200 | 3 | 目录一致 |
| 辰途 API · 稳定gemini生图 | 稳定gemini生图 | disabled | 200 | 2 | 目录一致 |
| FriModel · codex_image · 画布 | codex_image | canvas | 200 | 2 | 目录一致 |
| MikotoPro · 生图（原生4k · 画布 | 生图（原生4k | canvas | 200 | 24 | 新增 23，未返回 0 |
| 辰途 API · image2官key生图 | image2官key生图 | canvas | 200 | 5 | 目录一致 |
| MikotoPro · 生图（2k4k 高质量） · 画布 | 生图（2k4k 高质量） | canvas | 200 | 1 | 目录一致 |
| 辰途 API · 1k低价生图 · 画布 | 1k低价生图 | canvas | 200 | 4 | 目录一致 |
| MikotoPro · 生图（2k4k 中质量） · 画布 | 生图（2k4k 中质量） | canvas | 200 | 24 | 目录一致 |
| 辰途 API · 低价gemni生图 · 画布 | 低价gemni生图 | disabled | 200 | 4 | 目录一致 |
| MikotoPro · gemini-3.1-flash-image-preview · 画布 | gemini-3.1-flash-image-preview | canvas | 200 | 1 | 目录一致 |
| 辰途 API · 稳定gemini生图 · 画布 | 稳定gemini生图 | canvas | 200 | 2 | 目录一致 |
| MikotoPro · gemini-3-pro-image-preview · 画布 | gemini-3-pro-image-preview | canvas | 200 | 1 | 目录一致 |
| 辰途 API · 低价gemni生图 · 画布 | 低价gemni生图 | disabled | 200 | 4 | 目录一致 |
| 辰途 API · 低价gemni生图 · 画布 | 低价gemni生图 | disabled | 200 | 4 | 目录一致 |
| 辰途 API · 低价gemni生图 · 画布 | 低价gemni生图 | canvas | 200 | 4 | 目录一致 |
| 辰途 API · az兜底渠道1k生图 · 画布 | az兜底渠道1k生图 | canvas | 200 | 1 | 目录一致 |
| 辰途 API · 纯血ccmax · 智能体 | 纯血ccmax | agent | 200 | 6 | 目录一致 |
| 辰途 API · CC-MAX-企业版-CC Test满分 · 智能体 | CC-MAX-企业版-CC Test满分 | agent | 200 | 5 | 目录一致 |
| 辰途 API · 0.13特惠Pro号池 · 智能体 | 0.13特惠Pro号池 | agent | 200 | 5 | 目录一致 |
| secure-skill · image-2-1k · 画布 | image-2-1k | canvas | 200 | 3 | 目录一致 |
| 智元api · gpt  pro 0.12 · 画布 | gpt  pro 0.12 | canvas | 200 | 9 | 目录一致 |
| 创想ai · 生图 · 画布 | 生图 | canvas | 200 | 10 | 目录一致 |
| secure-skill · adobe-image2-mid · 画布 | adobe-image2-mid | canvas | 200 | 2 | 目录一致 |
| secure-skill · gpt · 画布 | gpt | canvas | 200 | 6 | 目录一致 |
| secure-skill · grok · 智能体 | grok | agent | 200 | 13 | 目录一致 |
| secure-skill · flow · 画布 | flow | canvas | 200 | 14 | 目录一致 |
| 怪兽ai · B3-GPT生图-特惠渠道 · 画布 | B3-GPT生图-特惠渠道 | canvas | 200 | 4 | 目录一致 |
| secure-skill · video-企业版 · 画布 | video-企业版 | canvas | 200 | 3 | 目录一致 |
| secure-skill · cc-max · 智能体 | cc-max | agent | 200 | 8 | 目录一致 |
| secure-skill · grok-企业 · 智能体 | grok-企业 | agent | 200 | 3 | 目录一致 |
| secure-skill · gemini · 智能体 | gemini | agent | 200 | 4 | 目录一致 |
| secure-skill · seedance-2.5 · 画布 | seedance-2.5 | canvas | 200 | 9 | 目录一致 |
| 怪兽ai · B2-GPT生图原生渠道V2（推荐） · 画布 | B2-GPT生图原生渠道V2（推荐） | canvas | 200 | 4 | 目录一致 |
| secure-skill · grok视频特价 · 画布 | grok视频特价 | canvas | 200 | 2 | 目录一致 |
| secure-skill · banana-全系列 · 画布 | banana-全系列 | canvas | 200 | 8 | 目录一致 |
| secure-skill · grok视频-备用 · 画布 | grok视频-备用 | canvas | 200 | 3 | 目录一致 |
| secure-skill · seedream-5.0-pro图片模型 · 画布 | seedream-5.0-pro图片模型 | canvas | 200 | 1 | 目录一致 |
| secure-skill · minimax-h3-优化版 · 画布 | minimax-h3-优化版 | canvas | 200 | 1 | 目录一致 |
| 怪兽ai · B1-GPT生图原生渠道V1 · 画布 | B1-GPT生图原生渠道V1 | canvas | 200 | 4 | 目录一致 |
| secure-skill · seedance-官方token版 · 画布 | seedance-官方token版 | canvas | 200 | 3 | 目录一致 |
| secure-skill · wan3视频 · 画布 | wan3视频 | canvas | 200 | 3 | 目录一致 |
| secure-skill · image2-官key · 画布 | image2-官key | canvas | 200 | 13 | 目录一致 |
| secure-skill · sd-2.5-特价 · 画布 | sd-2.5-特价 | canvas | 200 | 1 | 目录一致 |
| secure-skill · banana-pro统一价格 · 画布 | banana-pro统一价格 | canvas | 200 | 8 | 目录一致 |
| 怪兽ai · B4-GPT生图原生渠道V3（高质量） · 画布 | B4-GPT生图原生渠道V3（高质量） | canvas | 200 | 4 | 目录一致 |
| secure-skill · gpt-image-2.5 · 画布 | gpt-image-2.5 | canvas | 200 | 13 | 目录一致 |
| secure-skill · flow-大户 · 画布 | flow-大户 | canvas | 200 | 9 | 目录一致 |
