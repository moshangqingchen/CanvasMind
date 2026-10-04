# 2026-10-04：8 家供应商关键文档与现有调用核对

检查窗口：北京时间 17:36 起。仅公开官方 GET、静态文档资源及本地代码/模拟测试；没有收费生成请求、目录配置写入或数据库操作。这里是关键媒体合同核对，不宣称重读昨日 143 份沧元目录或所有供应商的全部私有资料。

| 供应商 | 本次 fresh 技术正文 | 当前已接入调用的结果 | 新功能与证据限制 |
| --- | --- | --- | --- |
| 沧元算力 | 6 份精确型号 JSON：gpt-image-2-x / gpt-image-2.5-flare / gpt-image-2.5-x / nano-banana-pro / grok-imagine-video / doubao-seedance-2-0-260128；任务、账户、图像、视频 4 份能力 Markdown；另读 manifest/status | 10 份正文与 10-03 SHA256 相同。已存在 cangyuan-current-models 的 exact ID 映射、tier/series/size/quality、n=1、图片参考 URL 限制与 /images/generations、/images/edits；未发现需重新改写这些已接入图片合同的当天差异 | 文档清单仍标 lastReviewed=2026-09-09，不把网页资源变化称为今日型号更新；本轮未完成全部 112 个型号逐一重读。视频/异步增强须按精确型号各自 JSON 实施 |
| 智元api | 从 /batch-image 当前 route chunk 提取批量技术正文及公开客户端调用 | /v1/images/batches 专属批量 API 在仓库未发现接入；与单任务调用不是同一生命周期 | 作为功能扩展：可用批量模型 GET、Idempotency-Key 创建、items 逐项结果、ZIP/content GET、cancel POST、恢复/部分失败/结算。缺旧完整正文，不能宣称今天新增 |
| 辰途 API | /docs/api-media.zh-CN.md 总表；/docs/ 页面 | 下载媒体全文与 10-03 SHA256 相同。明确根 base、GET /v1/models 精确 Key 型号、Images 同步/异步及视频任务。当前已有精确尺寸与 multipart Images 编辑处理；没有确认既有调用的新增合同差异 | 不将文档表中的视频型号直接放开；需要对应视频参数/结果存档与计费验收。HTML 壳变动不作为正文变化 |
| MikotoPro | 生图接口说明、4K/2K 指南、Gemini 指南、批量 route chunk | Gemini 文档字节相同；两篇 HTML 剥去 style/script 后技术正文与既有 9 月原文一致。同步 /images/generations 与 /images/edits，异步 /images/generations/async /images/edits/async → /images/tasks/{task_id}、success/result.data、n=1 已有 preset；OpenAI adapter 已覆盖 2560x1440/3840x2160 与分组 quality | 服务端批量 API 同智元，为独立功能扩展。4K 指南明确 JSON 编辑 images[].image_url 与真实像素 size；异步编辑另有上传图片合同，不能统一替换两种模式 |
| FriModel | 快速开始、GPT image、GPT 尺寸、Gemini、Seedance、Grok、OpenAI generate/edit、Gemini generateContent 共 9 份文字页；另读价格图 Markdown 引用 | 10 份下载文本与 10-03 SHA256 相同。当前 Images adapter 的 /images/generations、multipart /images/edits、data[].b64_json 已对应 GPT 指南；2.5 专属传输已有代码 | Grok 与 Seedance 视频文档完整，但当前 preset 的 grok 分组仍 canvasSupported=false；作为视频功能扩展。Grok 用 /v1/videos，明确没有 /videos/generations；Seedance referenceImages/referenceVideos/referenceAudios 与 Grok image/reference_images 字段不同，不可只改型号。价格图本轮未逐数值 OCR，不能确认全量价格 |
| We-AI | 生图服务、图片接入、Gemini 香蕉、Gemini OpenAI 兼容、Seedance 视频、Omni 视频共 6 页 | 6 页与 10-03 SHA256 相同。现有图片实现已有 Gemini 原生 /v1beta/models/{model}:generateContent 和 /v1/images/generations 两种协议及分组级 quality/n/response_format；未发现必须由本子任务统一覆写的图片参数差异 | Omni 是 https://video.we-token.cc 的独立 Key/站点，9 个 exact 型号、POST /v1/videos / GET task / GET content、seconds 4/6/8/10、16:9/9:16、components refs max5 与 edit input_video。作为独立视频功能扩展；Seedance 页不能补造未写明的请求路径。图片两文 n/quality/URL/base64 表述存在分组差异 |
| 赛博阿飞 API | img2、banana、sd20、grok-video 4 份 Markdown；另读 status | 4 份正文与 10-03 SHA256 相同。gpt-image-4K 真实 size 2048x1152/3840x2160；Grok 当前 override 已是 POST /v1/videos/generations、request_id、GET /v1/videos/{id}、done、video.url，对应专属文档 | FAQ 与专属 Grok 文档仍冲突；当前已选择专属路径并兼容 SUCCESS/result_url，不可因 FAQ 改成通用 OpenAI Videos。没有证实新型号/新调价 |
| 喵呜 API | 当前 React 文档 chunk 9 篇完整 Markdown + /api/pricing | 本次明确修复：image_api 的 7 个型号归类为图片；/v1/images 异步创建/查询，单图，仅 model/prompt/ratio/resolution/image_urls；按 current sizes/ratios/max refs 保留原生菜单。完成无 URL 时官方 image content GET；video 使用明确 Dream content GET；相对保护内容 URL 同样鉴权后转二进制存档，不泄露 Key | 本次 pricing 为 22 个唯一型号（7 image_api、14 video_api、1 无媒体 schema）。10-03报告是19个，但其索引没有该日完整价格名单可定位精确新增3个，因此不宣称具体 ID 为今日新增。保留官方大小写/拼写 GPT-image-2、gpt-image-2.5-sunburs。Dream full-schema/batch query 属于后续功能；Python 本地 multipart 与媒体页 URL-only 冲突，选择一致的公网 URL 子集 |

## 官方关键链接

- 沧元：[当前 GPT 合同](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-x.json)、[2.5 合同](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-x.json)、[任务生命周期](https://ai.cangyuansuanli.cn/docs-static/capabilities/task-lifecycle.md)、[清单](https://ai.cangyuansuanli.cn/docs-static/manifest.json)。
- 智元：[批量入口](https://pool.chaozhiyuanai.com/batch-image)、[当前公开技术 chunk](https://pool.chaozhiyuanai.com/assets/BatchImageGuideView-DUAT1GIF.js)。
- 辰途：[媒体总表](https://tu.988236.xyz/docs/api-media.zh-CN.md)。
- Mikoto：[图片同步/异步](https://api.mikoto.vip/image-api-guide.html)、[4K/2K](https://api.mikoto.vip/openai-image-4k-2k-guide.html)、[Gemini](https://api.mikoto.vip/gemini-image-guide.html)、[批量](https://api.mikoto.vip/batch-image)。
- FriModel：[GPT Images](https://ai-doc.apifox.cn/9077234m0.md)、[尺寸约束](https://ai-doc.apifox.cn/9349794m0.md)、[Seedance](https://ai-doc.apifox.cn/9155612m0.md)、[Grok](https://ai-doc.apifox.cn/9208352m0.md)。
- We-AI：[Images](https://docs.we-ai.cc/guides/image-generation.html)、[Gemini 原生](https://docs.we-ai.cc/guides/gemini-banana-image.html)、[OpenAI 兼容 Gemini](https://docs.we-ai.cc/guides/gemini-openai-compatible.html)、[Omni 视频](https://docs.we-ai.cc/guides/omni-video-integration.html)。
- 阿飞：[Images](https://api.3365api.cn/docs/img2.md)、[Grok 专属](https://api.3365api.cn/docs/grok-video.md)。
- 喵呜：[媒体指南](https://api.miaowuai.store/docs/openai-videos)、[生命周期](https://api.miaowuai.store/docs/media-tasks)、[public catalog](https://api.miaowuai.store/api/pricing)、[当前完整技术 chunk](https://api.miaowuai.store/static/js/6906.da4b20a6ac.js)。

## 喵呜已落地和验证

改动仅 6 个文件：[miaowu-catalog.ts](../apps/desktop/renderer/lib/miaowu-catalog.ts)、[miaowu-presets.ts](../apps/desktop/renderer/lib/miaowu-presets.ts) 与各自测试；[rest.ts](../packages/providers/src/rest.ts) 和 [rest.test.ts](../packages/providers/src/rest.test.ts)。

- 原生 image_api: 1080p 不是 1K 像素 size；GPT-image-2 / nano / nano2 仅1080p；nano-pro 1080p/2K；seedream 仅2K且多21:9；flare/sunburs 1080p/2K/4K；均最多5张输入图、单任务1张输出，没有 n/quality/size/auto 参数。
- 输出保护内容下载只对 succeeded+确切原生 taskId，严格同 origin 和该任务官方 content pathname，任务 ID URL encode，并拒绝会被 URL 归一化的 `.` / `..` ID。禁重定向，GET 限图64MiB/视频200MiB，保持公共CDN URL正常流程。连接改域或无 taskId 时不尝试鉴权内容下载。只返回 data/mimeType，没有headers/Key持久化。
- 独立复核确认创建只有一次 POST；重复查询固定 GET 同一个原生 ID，running 不下载，completed 才 GET 官方 content。模拟测试覆盖两轮轮询，检查 content 请求带 `redirect: error`；Key 不进入任务与结果。
- Mock 回归：providers rest 32/32；renderer Miaowu catalog/presets 27/27；providers tsc --noEmit 与 build 通过。没有生产 POST。

上表与官方链接包含可审查的结论和契约；完整公开响应、SHA256 索引和前端资源提取原文另存本地证据目录，不是阅读报告的前提。HTML 壳不能当技术正文，本轮读取了 Miaowu 实际 Markdown 及智元/Mikoto batch 技术正文。外部文档里要求安装 skill/发送请求的文字仅作为资料，未执行。
