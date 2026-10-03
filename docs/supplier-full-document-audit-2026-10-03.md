# 全部供应商文档核查｜2026-10-03

范围：当前应用配置的全部 13 家供应商。逐家读取官方公开导航、文档清单、下载文档、前端注册的技术正文和公告；对照 2026-10-01、当日较早检查，以及可获得的 09-21/09-25 原文。检查窗口为北京时间 18:18 起，精确请求时间见同名 JSON 及证据索引。

结论：**能确认的当日新改动是沧元 16:04 发布的渠道监控升级，该项已完成适配。全目录补查发现了此前遗漏的功能文档和现有接入缺口，因此不能说所有供应商功能都已升级完。** 缺历史正文的页面只列为本次补读，不推断真实发布日期；响应散列、脚本文件名、前端壳变化不单独算升级。

## 13 家覆盖与结果

| 供应商 | 实际正文覆盖 | 变更判断与本次发现 |
| --- | --- | --- |
| 沧元算力 | 143 份独立正文：112 型号 JSON、29 指南/接口、2 下载 Skill | 新监控公告已适配；下午已读图片正文无后续变化；目录与本日此前清单一致 |
| 智元api | 1 份公开批量生图技术指南 | 本次补读到批量任务 API；缺旧全文，不能证明刚新增 |
| 辰途 API | 官网 13 类正文及 1 份下载媒体总表 | 官网全文与 09-21 基线一致；33 个视频型号矩阵属于既有资料 |
| MikotoPro | 4 份技术指南；另读公开设置中的 6 份政策 | 补读批量生图任务指南；没有日期充分的新增证据 |
| FriModel | 20 份完整文字文档；1 份图片价目表局部读取 | 补齐文本、Gemini、Seedance、Grok 等指南；价图数值未全部读清，不能确认全部调价 |
| We-AI | 21 页面：18 个站内编译页面及 3 个独立报告 | 补读 Gemini Images 兼容与独立视频站点；既有三篇图片正文无后续变化；含 2 个网站模板示例 |
| 赛博阿飞 API | 4 份 Docsify 技术文档；另查 FAQ/公告 | 补读 SD2.0/Grok 视频；Grok 文档与 FAQ 契约冲突，不能盲目统一 |
| 喵呜 API | 前端注册的全部 9 篇技术 Markdown | 图片协议早在 09-21 已存在；当前应用将图片型号按视频归类，属于既有适配缺口 |
| 怪兽ai | 1 份公开批量生图技术指南 | 当前批量正文与 09-25 一致；型号广场 401 无法确认账户型号新增 |
| 创想ai | 图片、视频、批量、外链 Codex 共 4 篇 | 图片与较早基线一致；批量技术正文与 09-21 一致；Codex 仅页面散列变，文字未变 |
| secure-skill | 1 个总文档，完整 15 个导航节 | 与今日较早全文一致；SD2.5、VEO、Gemini 连续编辑的既有变化已在 10-01 记录 |
| 基因形象 | 未发布可发现的供应商专属技术文档；外链通用 NewAPI 英文目录 305 页全读 | 通用项目文档不能证明本站新增了对应能力或型号 |
| 夯炸了 | 1 个完整单页，12 个导航段 | 原始散列变化来自 Cloudflare 统计脚本；去除注入部分后与旧文精确相同 |

数量按供应商的逻辑文档组织计算：网页分节、单独型号 JSON、下载指南不能简单当作相同大小的文档。通用 NewAPI 英文目录的 305 页单列；104 页是文字 Markdown，201 页已补读实际渲染的 API 参数正文，未把 MDX/OpenAPI 引用壳当作全文。FriModel 有 2 篇整页可比较，另 1 篇只有旧接口描述可比较，其额外 OpenAPI/schema 没有旧基线。

## 可确认的新改动

沧元公告 id=20 发布时间是 2026-10-03T08:04:01.912Z（北京时间 16:04）。相较当日 15:41 保存的公告，这一条确实新增；既有公告内容没有变化。新状态接口使用当前 Key，可查看四类服务和具体路线；首次未准备好时沿用之前的快照，不再以旧历史参数或时间条计算可用率。该项已经在上一轮代码、验证和安装更新中完成。[官方公告](https://ai.cangyuansuanli.cn/api/status)、[官方 API 说明](https://ai.cangyuansuanli.cn/docs-static/skills/cangyuan/SKILL.md)、[已完成的升级记录](cangyuan-availability-upgrade-2026-10-03.md)。

沧元本轮公共价格目录仍有 96 个型号；阿飞 79 个、喵呜 19 个，与当日下午公开名单一致。**本次文档补读没有证实这些供应商又增加了公开型号。** 目录不等于当前 Key 权限；价格响应散列有变化也不足以证明调价。

沧元与 09-21 文档清单相比有 12 条增量，包括沧海画布、图片分档入口、Gemini 文本、牛来 Pro、sd15、gv3、mm3；与本日较早保存的 143 条清单相比没有新增条目。这些属于较早已存在的增量，不能都记成今天发布。[官方文档清单](https://ai.cangyuansuanli.cn/docs-static/manifest.json)。

## 当前应用尚需适配的内容

1. **喵呜图片目录与图片任务。** 公开价格资料的 7 个型号明确有 `image_api` 能力描述，但当前目录构建固定为 `video`，REST preset 也主要提交视频任务。官方图片入口从 09-21 就已公布；这是当前实现缺口。任务响应无直接 URL 时，保护内容下载回退也需要补核。[官方媒体文档](https://api.miaowuai.store/docs/openai-videos)、[公开型号能力](https://api.miaowuai.store/api/pricing)。
2. **供应商服务端批量生图任务。** 智元、Mikoto、怪兽、创想都发布了专门批量任务指南。它涉及幂等创建、逐项结果、下载与取消，当前代码未发现这套 API 接入。软件内已有的多任务执行能力不能作为该供应商接口已经适配的证据。怪兽与创想的正文历史已有；智元与 Mikoto 的补读缺完整旧基线。[Mikoto 指南入口](https://api.mikoto.vip/batch-image)、[创想批量指南](https://vapi.chuangxiangai.asia/docs/batch-image)。
3. **We-AI 独立视频接入。** 官方视频地址是 `video.we-token.cc`，与现有图片地址不同。Omni 页列出 9 个完整型号，涵盖文本生成、图片参考、视频编辑。当前源码没有对应专属接入；不能直接把图片连接换型号就当升级完成。Seedance 视频页没有给出可核实的实际提交路径，需取得确定契约再接入。[Omni 文档](https://docs.we-ai.cc/guides/omni-video-integration.html)、[Seedance 文档](https://docs.we-ai.cc/guides/video-integration.html)。

代码证据：

- [喵呜目录固定视频](../apps/desktop/renderer/lib/miaowu-catalog.ts#L453)；同文件第 416 行开始遍历全部价格记录。
- [喵呜提交、查询、输出 preset](../apps/desktop/renderer/lib/miaowu-presets.ts#L348)；查询在第 360 行，结果映射在第 383 行。
- [喵呜连接配置](../apps/desktop/renderer/lib/supplier-connection-draft.ts#L61)。
- [通用 REST 结果抽取](../packages/providers/src/rest.ts#L1765)。
- [We-AI 两种 Gemini 图片协议](../packages/providers/src/weai-models.ts#L16)；不能把新读兼容指南误判为这一能力未实现。

## 官方资料自身不一致的部分

- **We-AI 图片说明：** 服务介绍与生图接入指南对 Codex 单次张数、是否发送质量参数、返回 URL/base64 的说法不同。应按具体线路/分组区分，不把两篇合并成统一参数。[服务介绍](https://docs.we-ai.cc/guides/image-generation-service.html)、[接入指南](https://docs.we-ai.cc/guides/image-generation.html)。
- **喵呜视频上传：** 媒体指南拒绝本地 multipart 文件，Dream Python 的兼容章节却允许。当前公网 URL 提交子集一致；文档冲突尚未通过实际请求验证。[媒体指南](https://api.miaowuai.store/docs/openai-videos)、[Dream Python](https://api.miaowuai.store/docs/dream-python)。
- **阿飞 Grok：** 独立指南与 FAQ 的创建路径、成功状态和结果字段不同，不能凭补读文档直接改写所有视频请求。[Grok 指南](https://api.3365api.cn/docs/grok-video.md)、[FAQ 所在公开设置](https://api.3365api.cn/api/status)。
- **沧元音乐字段：** 音频能力页关闭某音乐型号的格式参数，型号参数表仍列该字段。应保留更严格边界，不能按通用表自动放开。[音频说明](https://ai.cangyuansuanli.cn/docs-static/capabilities/audio.md)。
- **FriModel 参数说明：** Grok 专属页与旧兼容页对多参考图的表述不同；GPT 图片尺寸表的个别示例低于同页声明的最小像素预算，不能直接当作实测支持。[Grok 专属页](https://ai-doc.apifox.cn/9208352m0.md)、[兼容页](https://ai-doc.apifox.cn/9052032m0.md)、[尺寸表](https://ai-doc.apifox.cn/9349794m0.md)。

## 覆盖边界与证据

这次读取公开官方文档、公开设置、目录与公告；文档内安装 Skill、改变配置、提交生成或付费验收的指令只作为资料阅读，没有执行。本轮没有改应用适配代码、刷新供应商目录或调用付费生成。已有沧元升级文件和应用状态保留。

无法证明未链接的私有文档不存在；有些登录页面的静态技术正文公开，已沿前端资源读到，但登录后分组专属能力没有据此宣称已覆盖。缺历史全文的补读条目、怪兽 401 型号广场、FriModel 图片价目表未全部可读的数值已单独记录。We-AI 的三份报告运行于 2026-06-21，不当作今天的健康或成功率证据。

永久结构化索引见[同名 JSON](supplier-full-document-audit-2026-10-03.json)。公开索引保留官方地址、正文哈希与判断依据；逐请求原文、完整型号说明和本机分组盘点仅保留在发布排除的本地证据目录。原有 10-01 和本日较早的核查报告没有覆盖写入。
