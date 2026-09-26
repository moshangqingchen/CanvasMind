# 已添加中转整体核查 · 2026-09-13

北京时间 19:49–19:55 核查。本机 8 家外部中转、1 个个人本地网关，共 40 条已保存连接（包含 5 条已禁用历史连接；按地址与分组去重为 35 组）。29 条连接成功返回模型目录，9 条返回 HTTP 403，2 条本地连接被拒绝。成功返回目录不等于付费生成实测成功。

本次只查询免费模型目录、公开价格、公告、文档和沧元健康状态，没有发起图片、视频或对话生成，没有改写连接、默认模型、Key 或数据库。逐连接脱敏证据见 [核查 JSON](relay-update-audit-2026-09-13.json)。

## 最值得先处理的变化

1. **当前导演大脑配置过期。** profile 绑定沧元 LLM-GPT-plus 的 gpt-5.4；当前 Plus、Pro 的 Key 目录均不包含它。两组当前都返回 gpt-5.3-codex-spark、gpt-5.5、gpt-5.6-sol、gpt-5.6-terra、gpt-6-astra。gpt-5.4 在保存的旧扫描里也已缺席，属于这次确认的已有配置问题，不能说是今天刚下架。需要同时核对导演 profile 与连接默认模型。
2. **辰途「低价Adobe生图」不再返回 gpt-image-2.5-sunburst。** 模型数 6→5，公共价格目录同样移除了它，两次 Key 查询一致。9 月 10 日的 Sunburst 4K 成功记录已经不足以代表当前可调用状态；Flare 仍在目录。
3. **Mikoto「生图（原生4k」目录明显偏离旧用途。** 2→24 个模型；gpt-image-2.5-flare 消失，gpt-image-2 保留，其余新出现的主要是 GPT 对话/音频型号。两次结果一致。只能确认该 Key 的可见目录变了，无法仅据此判断站方改组、Key 权限改变还是统一目录行为，也不能沿用旧 Flare 4K 能力结论。
4. **赛博阿飞「gpt5.6-破甲版」当前失去分组访问权限。** 原保存状态 live，现在两次查询均 403，明确提示无权访问该分组。图片综合组及 image-2 稳定生图组仍可正常读取目录。
5. **We-AI 五个连接均为余额不足。** 403 正文明确写 Insufficient account balance；这比应用笼统的 unauthorized 更具体，不应直接归因为 Key 无效。

## 各中转结果

| 中转 | 本次结果与变化 |
|---|---|
| 沧元算力 | 六个连接均能读取目录。IMAGE 27 个、全模型组 58 个，与今天较新的已保存扫描一致；备用组较 9/10 的 15 个增至 18 个，新增 doubao-seedream-5-0-pro、gemini-3-pro-image-preview、gemini-3.1-flash-image-preview。Plus 新见 Spark，Pro 新见 Astra；Claude kiro 4→8，新增 Fable 5.1、Haiku 4.5、Opus 4.6/4.7。 |
| 辰途 | Adobe 组移除 Sunburst 2.5；低价 Gemini 组 3→4，新增无 ad-/leo- 前缀的 gemini-3.1-flash-image-preview。稳定 Pro 对话组 4→5，新见 gpt-6-astra。官 Key 生图组仍为 403；稳定 Gemini、兜底原生、1K 组目录未变。 |
| MikotoPro | Seedance 从旧记录的鉴权失败恢复为 HTTP 200，返回 seedance-2.0-1080p、seedance-2.0-720p、seedance-fast-480p、seedance-fast-720p。原生 4K 组发生上述异常目录变化；1K、Gemini、Grok 组目录未变。 |
| 赛博阿飞 | 两个图片连接的模型 ID 与已保存记录一致；旧 GPT 破甲组现为 403。无后缀 GPT Image 2.5 的公共目录计费值下降。 |
| FriModel | 四组全部返回 200；Adobe 6 个、Gemini image 2 个、Gemini pro 2 个、Codex image 3 个，与 9/11 扫描一致。Adobe Flare/Sunburst 2.5 仍在该 Key 目录。公开价格入口需站点登录，本次未取得可比的实时价格。 |
| 智元 API | 8→9 个模型，新出现 gpt-image-2。该连接旧默认仍为 codex-auto-review；出现图像型号不代表整组都是图片模型，也未验证新增图片接口的真实调用能力。 |
| We-AI | 五个连接均 403，具体原因为账户余额不足，当前无法验证新库存。 |
| 喵呜 | 两条连接均 403，提示无权访问 vip 分组；公开模型广场可访问，但不能替代当前 Key 权限验证。 |
| 个人 GPT 本地网关 | localhost:18082 的对话、内置生图连接均 ECONNREFUSED。是本地端口未接受连接；并非外部中转公告或模型下架证据。 |

来源：各条连接已配置地址的 /v1/models，结果及基线保存在核查 JSON；[沧元模型广场](https://ai.cangyuansuanli.cn/api/pricing)、[辰途模型广场](https://tu.988236.xyz/api/pricing)、[阿飞模型广场](https://api.3365api.cn/api/pricing)、[喵呜模型广场](https://api.miaowuai.store/api/pricing)。

## 价格与新型号

以下旧价以 9 月 10 日 12:36 留存的原始 pricing 为基线，计入明确存在的分组倍率。数值是对应平台的目录计费值，不能直接当作跨平台充值后人民币成本。

| 平台 / 分组 / 模型 | 原目录有效值 | 当前目录有效值 | 变化 |
|---|---:|---:|---|
| 辰途 / 低价Adobe / GPT Image 2 的 1K、2K、4K、自由传参 | 0.04×1.25 = 0.05/次 | 0.04×1 = 0.04/次 | 降 20% |
| 辰途 / 低价Adobe / GPT Image 2.5 Flare | 0.044×1.25 = 0.055/次 | 0.06×1 = 0.06/次 | 涨约 9.1% |
| 赛博阿飞 / image-2稳定生图 / GPT Image 2.5 无后缀 | 0.20/次 | 0.15/次 | 降 25%；站点美元目录，未折算充值成本 |
| 辰途 / grok纯享视频 / grok-video1.5-fast | 0.45/次 | 0.48/次 | 涨约 6.7% |
| 辰途 / grok纯享视频 / grok--video1.0 | 0.35/次 | 0.38/次 | 涨约 8.6% |

价格来源为以上平台当前 /api/pricing，与本地 9/10 原始响应逐字段对照；不是根据旧公告推算。沧元相同模型的基础价和已有分组倍率未发现变化；GPT Image 2.5 无后缀/Flare/Sunburst 仍为 0.025/张，Flare 1K/2K/4K 为 0.055/0.075/0.095，Sunburst 1K/2K/4K 为 0.075/0.095/0.125。Sunburst 分辨率 SKU 已出现在 9/10 较晚保存的目录中，不算本轮最新 Key 扫描新增。

沧元相对 9/10 已保存供应商目录，新见 Seedream 5.0 Pro（0.099/张）、Gemini Flash image（0.13/张）、Gemini Pro image（0.15/张），以及 sd4-seedance-2.5-480p / 720p（0.49 / 0.59 **每秒**）。Seedance 此处 billing_mode 明确为 per_second，不得误报为整条视频价格；720p 无参考视频最长 29 秒、带参考视频最长 18 秒。480p 的文字描述写最长 30 秒，但 duration.max 仍为 29，存在元数据不一致，未据此修改参数。当前全模型 Key 可见两个 Seedance SKU；wan3.0-video 已不在当前分组目录。[沧元实时目录](https://ai.cangyuansuanli.cn/api/pricing)

辰途公开目录还新增「grok生图」「image超分」分组。未为这两个新组配置并核验独立 Key，不能视作已添加连接自动获得权限。「image超分」标签写可 4K，不等于原生 4K；本次未做生成验证。[辰途实时目录](https://tu.988236.xyz/api/pricing)

喵呜公共目录 14→16 个：移出 seedance-2.0-deal，新见 seedance-2.0-fast-noface、wan3.0-vedio-deal、wan3.0-video-prime-deal。其若干型号的顶层 model_price 与 video_api.pricing.rules 不同，并混合按次/按秒；本次仅记录字段变动，不把顶层值变化直接宣称为最终涨价。目前 Key 权限亦无法通过。[喵呜实时目录](https://api.miaowuai.store/api/pricing)

## 实时状态与文档

沧元 /v1/availability?window_days=7 返回 67 项站方监测状态：46 operational、14 degraded、2 unavailable、5 unknown。其中 Flare 2.5 的 2K/4K、Sunburst 2.5 的 4K、LLM-GPT-plus/pro 均为 degraded；happyhorse-1.1 与 sd7-seedance-2.0-720p 为 unavailable。这是供应商监控的状态快照，不是本次付费生成测得的成功率，不能由其 availability 数字直接推算你的任务成功概率。

Mikoto 的图片/异步说明和 2K/4K 指南、辰途文本版媒体文档、阿飞 img2.md、FriModel 接口指南，与 9/10 留存正文一致。沧元 /docs/api 返回的只是前端入口 HTML，其字节变化不足以证明接口文档内容更新。FriModel 定价文档入口能够读取，但缺少可比较的历史正文，且账户定价目录仍需登录。

本次可读取的沧元、辰途、阿飞公开公告，最新标注日期分别仍为 8/28、8/13、8/15，未见日期晚于 9/10 的公告；这不排除群公告或登录后通知。实际模型目录已有更新，因此公告日期不能作为“没有变化”的依据。来源：[沧元状态公告](https://ai.cangyuansuanli.cn/api/status)、[辰途状态公告](https://tu.988236.xyz/api/status)、[阿飞状态公告](https://api.3365api.cn/api/status)。

文档核对：[Mikoto 图片说明](https://api.mikoto.vip/image-api-guide.html)、[Mikoto 2K/4K](https://api.mikoto.vip/openai-image-4k-2k-guide.html)、[辰途媒体文档](https://tu.988236.xyz/docs/api-media.zh-CN.md)、[阿飞图片文档](https://api.3365api.cn/docs/img2.md)、[FriModel 指南](https://ai-doc.apifox.cn/9077234m0)。

## 全部连接检查表

同名历史连接保留独立行；disabled 连接只读取，不启用。模型数为此次 Key 接口返回的全部型号，可能含对话型号。

| 连接 | 分组 | 用途 | 结果 | 模型数 | 相对该连接保存扫描的变化 |
|---|---|---|---|---:|---|
| 个人Gpt · 导演台对话 | 导演台对话 | agent | ECONNREFUSED | — | ECONNREFUSED |
| 个人Gpt · Codex 内置生图 | 内置生图 | canvas | ECONNREFUSED | — | ECONNREFUSED |
| We-AI 图片 | 生图-openai-codex-token计费 | canvas | 403 | — | Insufficient account balance |
| We-AI · 生图-openai-adobe-按次 | 生图-openai-adobe-按次 | canvas | 403 | — | Insufficient account balance |
| 沧元生图和视频 | IMAGE | canvas | 200 | 27 | 新增 0，减少 0 |
| We-AI · 生图-openai-adobe-token计费 | 生图-openai-adobe-token计费 | canvas | 403 | — | Insufficient account balance |
| We-AI · gemini香蕉 | gemini香蕉 | canvas | 403 | — | Insufficient account balance |
| 沧元算力图像 API | 全模型-无claude/gpt | canvas | 200 | 58 | 新增 0，减少 0 |
| We-AI Â· AZURE-openai | AZURE-openai | canvas | 403 | — | Insufficient account balance |
| 沧元算力图像 API | IMAGE-备用分组 | canvas | 200 | 18 | 新增 3，减少 0 |
| 沧元算力 · LLM-GPT-plus · 导演台 | LLM-GPT-plus | agent | 200 | 5 | 新增 1，减少 0 |
| 沧元算力 · LLM-GPT-pro · 导演台 | LLM-GPT-pro | agent | 200 | 5 | 新增 1，减少 0 |
| 沧元算力 · LLM-Claude-kiro · 导演台 | LLM-Claude-kiro | agent | 200 | 8 | 新增 4，减少 0 |
| 辰途 API · 低价Adobe生图 | 低价Adobe生图 | canvas | 200 | 5 | 新增 0，减少 1 |
| MikotoPro · Seedance 视频 | Seedance 视频 | canvas | 200 | 4 | 无成功旧目录可比较 |
| 赛博阿飞 API · 图片视频模型综合分组 | 图片视频模型综合分组 | canvas | 200 | 22 | 新增 0，减少 0 |
| vip视频 | OpenAI Videos | canvas | 403 | — | 无权访问 vip 分组 |
| MikotoPro · Gemini 原生图片 | Gemini 原生图片 | canvas | 200 | 1 | 新增 0，减少 0 |
| 赛博阿飞 API · gpt5.6-破甲版 | gpt5.6-破甲版 | agent | 403 | — | 无权访问 gpt5.6-破甲版 分组 |
| 喵呜 API · vip | vip | canvas | 403 | — | 无权访问 vip 分组 |
| 赛博阿飞 API · image-2稳定生图 | image-2稳定生图 | canvas | 200 | 5 | 新增 0，减少 0 |
| MikotoPro · grok生图 | grok生图 | canvas | 200 | 1 | 新增 0，减少 0 |
| 辰途 API · 兜底原生生图 | 兜底原生生图 | canvas | 200 | 4 | 新增 0，减少 0 |
| MikotoPro · 生图（1k） · 画布 | 生图（1k） | canvas | 200 | 3 | 新增 0，减少 0 |
| 辰途 API · 无敌稳定Pro · 导演台 | 无敌稳定Pro | agent | 200 | 5 | 新增 1，减少 0 |
| MikotoPro · 生图（原生4k · 画布 | 生图（原生4k | canvas | 200 | 24 | 新增 23，减少 1 |
| 辰途 API · 低价gemni生图 | 低价gemni生图 | disabled | 200 | 4 | 新增 1，减少 0 |
| 辰途 API · 稳定gemini生图 | 稳定gemini生图 | disabled | 200 | 2 | 新增 0，减少 0 |
| 辰途 API · image2官key生图 | image2官key生图 | canvas | 403 | — | 无权访问 image2官key生图 分组 |
| 辰途 API · 1k低价生图 · 画布 | 1k低价生图 | canvas | 200 | 4 | 新增 0，减少 0 |
| 辰途 API · 低价gemni生图 · 画布 | 低价gemni生图 | disabled | 200 | 4 | 新增 1，减少 0 |
| 辰途 API · 稳定gemini生图 · 画布 | 稳定gemini生图 | canvas | 200 | 2 | 新增 0，减少 0 |
| 辰途 API · 低价gemni生图 · 画布 | 低价gemni生图 | disabled | 200 | 4 | 新增 1，减少 0 |
| 辰途 API · 低价gemni生图 · 画布 | 低价gemni生图 | disabled | 200 | 4 | 新增 1，减少 0 |
| 辰途 API · 低价gemni生图 · 画布 | 低价gemni生图 | canvas | 200 | 4 | 新增 1，减少 0 |
| 智元api · gpt  pro 0.12 · 画布 | gpt  pro 0.12 | canvas | 200 | 9 | 新增 1，减少 0 |
| FriModel · gpt_image_adobe | gpt_image_adobe | canvas | 200 | 6 | 新增 0，减少 0 |
| FriModel · gemini_image | gemini_image | canvas | 200 | 2 | 新增 0，减少 0 |
| FriModel · gemini_pro | gemini_pro | canvas | 200 | 2 | 新增 0，减少 0 |
| FriModel · codex_image · 画布 | codex_image | canvas | 200 | 3 | 新增 0，减少 0 |
