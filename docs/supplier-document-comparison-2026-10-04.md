# 2026-10-04 供应商文档对照与接入修复

本轮核对供应商关键官方公开媒体文档与现有调用代码，修复图片接口、参数、目录失败分类及缓存恢复中的明确差异。公开目录、当前 Key 权限、文档声明、模拟测试和真实生成证据分别处理；发布验证采用模拟接口和隔离资料库。

## Synora 与 pDog

| 项目 | Synora | pDog |
| --- | --- | --- |
| 图片协议 | 保留现有 OpenAI Images 同步接入；公开文档不足以确认新的单图异步合同 | 专属 `/v1/images/generations/async` 与 `/v1/images/edits/async`，保留 task_id，原连接 GET `/v1/images/tasks/{task_id}`；同步模式可明确配置 |
| 质量 | 普通 Image 2 默认 high，Image 2.5 默认 max 候选；按具体渠道证据限制 | Image 2 按通用示例 low/medium/high，默认 high；Image 2.5 保留 auto/low/medium/high/xhigh/max、默认 max，供应商上游支持情况待核验 |
| 分辨率 | 分组声明与原图像素证据分别保留 | 优先采用官方 2K/4K 像素表，补齐 11 比例与 auto；文档表没有声明排他枚举 |
| 原生与超分 | 能力只属于对应分组及完整型号 | 按分组说明分别显示原生与超分；输出像素达到 4K 不自动证明原生 |
| Gemini 香蕉 | 只按当前型号与协议证据接入 | generateContent、x-goog-api-key、inlineData；保留请求型号，不把响应 modelVersion 当请求别名 |
| 目录失败 | INSUFFICIENT_BALANCE 独立于鉴权失败，保留既有目录 | 同样按确切返回代码区分余额、权限及网络问题 |

pDog 图片文档示例使用 gpt-image-2，并写明质量能力由上游模型决定；不能将该例的 high 上限推广为所有 Image 2.5 的上限。2.5 的 max 是按应用规则保留的最高候选，未伪标为该供应商已实测支持。

依据：[pDog GPT 图片文档](https://ai.whyshy.cn/docs/async-image-api.html)、[pDog Gemini 文档](https://ai.whyshy.cn/docs/gemini-image-api.html)、[Synora 文档](https://synoralink.com/docs)。

## 已修复的接入

- pDog：精确站点与安全 API 根路径使用专属 GPT/Gemini 协议，自定义路径保持原配置。异步只提交一次，恢复只查询原任务；提交 404 保留原 HTTP 证据并解释对象存储配置，不能自动再提交同步请求。
- 创想：生图分组的完整 GPT `-1k/-2k/-4k` 型号使用 `/v1/images/generations` 和 `/v1/images/edits`。编辑发送 JSON 公网 images 链接，最多九张参考图，n=1、response_format=url。无素材通道时在提交前提示。
- 创想质量例外：官方在 `gpt-image-2-1k/-2k/-4k` 行专门列出 low/medium/high/xhigh/max；应用使用最高已声明值 max。Image 2.5 的 xhigh/max 另按高质量价处理，不能套标准单价。
- 喵呜：image_api 的七个型号使用原生 `/v1/images` 创建/查询，发送 model/prompt/ratio/resolution/image_urls；保留各型号原生分辨率和比例。成功任务的保护内容只按原任务同源官方接口鉴权 GET，禁止重定向。
- 价格：将“价格后紧跟 ID”的说明逐型号绑定，香蕉报价不串型号；分别保留原生与超分说明。缺少确切型号时提示“当前分组无此型号”，型号存在但没有报价时提示“同型号未报价”。
- 缓存：客户端缓存、显示、刷新、节点创建和运行归一化采用同一纯参数合同；手选质量及尺寸、档位、分组与型号保存后保持。
- 余额：识别 INSUFFICIENT_BALANCE，保留已有配置；真实鉴权失败仍按原流程处理。

## 其他供应商与未实现的独立功能

| 供应商 | 关键结论 |
| --- | --- |
| 沧元 | 本轮六个型号及四篇能力正文与先前资料一致，现有精确图片合同已对应；未宣称重读全部型号 |
| 智元 | 服务端 batches 有独立创建、逐项结果、取消、ZIP 和结算生命周期，尚未实现 |
| 辰途 | 当前媒体总表一致，现有图片尺寸与编辑合同未发现新差异 |
| Mikoto | 图片技术正文一致，已有同步和异步 preset；服务端 batch 尚未实现 |
| FriModel | 关键文本一致，原生 Grok/Seedance 视频是独立功能，不能只替换 Images 型号 |
| We-AI | Gemini 图片已有两种协议；Omni 独立站点、Key 与视频任务尚未接入 |
| 阿飞 | 保留专属 Grok 文档协议，FAQ 的冲突表述不覆盖它 |
| 怪兽 | 图片能力按精确分组证据保留；服务端 batch 尚未接入 |
| secure-skill | 已有专属 GPT 异步及 Gemini；总文档与历史分组能力冲突时保留来源；thoughtSignature 多轮连续编辑尚未实现 |
| 基因形象 | 公开通用 NewAPI 文档不能证明本站 Key 支持全部能力；价格及任务恢复须有本站合同 |
| 夯炸了 | 公开文档主要为文本，没有图片新增证据 |
| 词元 | 精确商家完整型号、原生/超分、Adobe 固定尺寸和省略 n 已适配；参数界面保留商家能力 |

详细来源与覆盖见[八家对照](supplier-document-comparison-eight-2026-10-04.md)和[六家对照](supplier-document-comparison-other-2026-10-04.md)。本轮重点是关键媒体合同，不声称覆盖全部私有文档或全部 NewAPI 通用页面。

## 验证

- providers 全套 41 文件、670 项通过。
- renderer 相关七文件、238 项通过；客户端合同和 We-AI 默认规则两文件、37 项通过。
- runtime 三文件、15 项通过。
- 隔离 Playwright 4/4 通过：2.0 high、2.5 max 候选、11 比例与 auto、手选质量/档位及分组/型号保存重载、逐型号报价。
- 每个隔离界面用例确认生成 POST 与 pDog 上游访问次数为零。
- 打包程序 23 项桌面验收、类型检查、相关 ESLint 和 diff check 通过。

模拟合同和界面回归不代表供应商已通过真实收费生成。pDog 异步对象存储及其 Image 2.5 max 上游能力仍须按确切分组核验。真实账户、账单、请求编号和本机安装备份证据保留在本机私有记录，不进入源码发布包。
