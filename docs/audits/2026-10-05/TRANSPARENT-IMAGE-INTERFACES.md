# 透明背景图片接口核查 · 2026-10-05

范围：本机配置的全部 16 家有效供应商，不计 3 条已删除记录。核对当前公共官方文档、模型广场、已保存的分组声明，以及本地 v0.2.55 的参数菜单与请求代码。没有发起生图、编辑、扣费测试，也没有修改供应商设置或应用源码。

这里的“透明”指供应商返回的原图含实际透明像素。PNG 文件、白底图片、画出来的棋盘格、提示词中的“透明背景”，均不能单独证明透明输出。声明支持、客户端能发送参数、实际图片有透明像素，是三个不同的结论。

## 全部供应商结果

| 供应商 | 直接透明输出的证据与范围 | 本地 v0.2.55 情况 |
| --- | --- | --- |
| secure-skill | **当前官方文档明确支持 GPT Image 2**：`background=transparent`，返回 RGBA PNG。文档同时明确 **GPT Image 2.5 忽略该字段，不输出透明底**。 | Image 2 被通用 `unsupported_background` 校验拦截，尚不能正常从这条接入发送透明请求；2.5 即使发送字段，也不能据此当作透明可用。 |
| 辰途 API | **当前公开目录明确声明**：`image2.5全参` 分组支持透明；对应 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`。不推广到该站其他分组。 | 两个型号目前没有背景菜单；OpenAI 2.5 通路可传递该字段，但还没有形成可直接选择透明的完整操作流程。 |
| 怪兽 AI | **已保存的供应商声明**：`B4-GPT生图原生渠道V3（高质量）` 支持 `background=transparent/opaque`。保存扫描时间为 2026-10-04 16:48:47（北京时间）；今日匿名模型广场返回 401，未重新确认登录后的声明。 | B4 型号没有背景菜单。Image 2 还会遭通用透明校验拦截；2.5 不受该条校验限制。没有实测透明原图。 |
| 基因形象 | **历史声明，尚未实测**：`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` 支持透明；`gpt-image-2` 不支持。能力依据日期为 2026-09-22；今日匿名 pricing API 返回 401。 | `default`、`gptResponseBase64` 现存连接的两个 2.5 型号已有“透明（供应商声明）”选项及传参。尚不能写成真实 alpha 已验证。 |
| 沧元算力 | **公开资料冲突**：当前 pricing 对多个 GPT 2/2.5 型号提供透明选项，但本次读取的精确型号 JSON 没有列出 `background`，并要求不发送未列字段。总图像文档也要求按具体型号表判断。 | 部分旧型号有背景菜单，但本轮核对的旧内置请求映射及新 `-x` 专属合同均不发送该字段，不能把菜单选项当作透明输出已接入的证明。 |
| FriModel | 当前生成接口文档列出 `background` 背景模式，但本次读取的生成、编辑、GPT 指南和尺寸说明中没有找到足以确认透明枚举及具体型号的现行说明。 | 有透明菜单；Image 2 及其连字符后缀型号仍被通用校验拦截。2.5 可传参，但没有实际透明输出验证。 |
| 智元api | 当前公共批量生图指南和公开设置中未找到直接透明输出声明；不据此断言私有分组不支持。 | 当前模型目录没有背景选项。 |
| MikotoPro | 当前同步/异步生图、2K/4K 指南与公开设置未找到透明输出承诺。 | 当前模型目录没有背景选项。 |
| We-AI | 当前两份主要图片指南未声明透明输出；其中蒙版要求 alpha 是输入蒙版要求，不能视为输出支持。 | 当前 2.5 连接为 OpenAI 通路，可传递字段，但没有背景菜单和供应商透明承诺。旧 WeAI 通路另有分组白名单限制。 |
| 赛博阿飞 API | 当前图片指南和公共目录未找到透明输出声明。 | 当前模型目录没有背景选项。 |
| 喵呜 API | 当前原生图片文档列出 `model/prompt/ratio/resolution/image_urls`，没有透明字段；不能由该子集推断所有私有模型能力。 | `/v1/images` 专属请求不提供背景参数。 |
| 创想ai | 当前图片合同未声明 `background`、透明输出或 alpha。 | 专属 GPT 图片请求不发送背景参数。 |
| 夯炸了 | 当前公开文档主要说明聊天/文本接入，没有找到透明生图接口说明。 | 当前目录没有背景选项。 |
| 词元 | 当前公开开发文档与商品市场未找到可确认的透明输出声明。 | 当前目录字段白名单不包含 `background/output_format`，这些字段不会自动透传。 |
| Synora | 当前 Images 文档列出基本生成参数，没有透明输出说明；不能从“OpenAI 兼容”推断透明支持。 | 当前模型目录没有背景选项。 |
| pDog | 官方示例提示词出现透明背景，但参数表没有透明/alpha 输出保证；提示词示例不等于真实透明像素已验证。 | 专属图片请求没有背景输出参数。 |

“未找到声明”表示本次可访问证据不足，不表示已证实接口拒绝透明背景。

## 明确支持声明对应的调用入口

- secure-skill：`POST https://token.secure-skill.com/v1/images/generations`，或其异步 `POST /v1/images/async/generations`；精确型号 `gpt-image-2`、`background=transparent`。官方要求保留 PNG，不转 JPEG；URL/base64 是交付形式，不是透明保证。Image 2.5 不适用。
- 辰途：现有 Images 入口 `POST https://tu.988236.xyz/v1/images/generations`；必须使用 `image2.5全参` 分组和该组允许的完整 2.5 型号。当前公共分组声明未给出完整透明请求及 alpha 验收结果，不能把通用请求示例当作已验证结果。
- 怪兽：B4 分组明确给出 `background=transparent/opaque`；采用该连接已有 Images 接入。其声明范围和扫描日期见上表，未向其他组或所有型号推断。
- 基因形象：现有 Images 入口 `POST https://genimage.pro/v1/images/generations`，已保存的两个 2.5 型号可选择透明。属于历史供应商声明与客户端已接入，不是本轮实际出图验收。

## 官方来源

- secure-skill：[图片指南](https://token.secure-skill.com/docs#image-generation)，本次读取实际文档资源 `https://token.secure-skill.com/assets/DocsView-BmEBwyRT.js`。
- 辰途：[实时公开目录](https://tu.988236.xyz/api/pricing)、[媒体 API 总表](https://tu.988236.xyz/docs/api-media.zh-CN.md)。
- 怪兽：[模型广场入口](https://api.eaheng.com/model-plaza)、[批量指南](https://api.eaheng.com/batch-image)；透明声明依据本机昨日保存目录，本次公共模型广场 API 401。
- 基因形象：[模型广场](https://genimage.pro/pricing)；能力历史见项目 `docs/genimage-verification-2026-09-22.md`，本次公共 pricing API 401。
- 沧元：[当前 pricing](https://ai.cangyuansuanli.cn/api/pricing)、[总图像合同](https://ai.cangyuansuanli.cn/docs-static/capabilities/image.md)、[Image 2](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.json)、[Image 2.5 Flare](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare.json)、[Image 2.5 Sunburst](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst.json)、[2-x](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-x.json)、[2.5-x](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-x.json)。
- FriModel：[生成接口](https://ai-doc.apifox.cn/473749171e0.md)、[编辑接口](https://ai-doc.apifox.cn/473749172e0.md)、[GPT 指南](https://ai-doc.apifox.cn/9077234m0.md)、[尺寸说明](https://ai-doc.apifox.cn/9349794m0.md)。
- 智元：[批量指南](https://pool.chaozhiyuanai.com/batch-image)，本次读取当前技术资源 `BatchImageGuideView-CpGHznj6.js`。
- Mikoto：[图片指南](https://api.mikoto.vip/image-api-guide.html)、[2K/4K 指南](https://api.mikoto.vip/openai-image-4k-2k-guide.html)。
- We-AI：[图片接入](https://docs.we-ai.cc/guides/image-generation.html)、[服务说明](https://docs.we-ai.cc/guides/image-generation-service.html)。
- 阿飞：[图片指南](https://api.3365api.cn/docs/img2.md)、[公开目录](https://api.3365api.cn/api/pricing)。
- 喵呜：[媒体指南](https://api.miaowuai.store/docs/openai-videos)，本次实际正文来自 `https://api.miaowuai.store/static/js/async/6906.da4b20a6ac.js`。
- 创想：[图片指南](https://vapi.chuangxiangai.asia/docs/image)。
- 夯炸了：[官方文档](https://doc.hangzhale.com/)。
- 词元：[开发文档](https://tk1688.com/docs)、[市场](https://tk1688.com/market)。
- Synora：[官方文档](https://synoralink.com/docs)。
- pDog：[GPT 图片指南](https://ai.whyshy.cn/docs/async-image-api.html)、[Gemini 图片指南](https://ai.whyshy.cn/docs/gemini-image-api.html)。

## 客户端代码证据与验证边界

- `packages/providers/src/openai.ts`：Image 2 通用校验拒绝 `background=transparent`；它不能正确表达 secure-skill 当前声明的专属支持。
- `packages/providers/src/secure-skill-image.ts`：专属映射含 `background`，但常规提交会先经过上述校验。
- `packages/providers/src/genimage-image-capabilities.ts`：2.5 的透明菜单及 `declared-transparent`，Image 2 的 `opaque-only`，明确记录声明日期和未实测边界。
- `apps/desktop/renderer/lib/model-parameters.ts`：模型未声明的背景参数不会自动成为界面控件。
- 辰途和怪兽的现存模型描述没有 `background`；仅服务端通路允许该字段，不等于用户已有可用按钮。
- 内存校验复现了 secure-skill/FriModel/怪兽 Image 2 的 `unsupported_background`，请求函数调用数为 0；2.5 不命中这条 Image 2 限制。此项只验证客户端行为，不能证明供应商出图能力。

公共响应及哈希存于本机发布排除目录 `.release-stage/transparent-audit-20261005/`。本报告不含账户凭据、账单或用户提示词。未进行真实透明像素验收，因此不把任何渠道标为“本轮实际生成验证通过”。
