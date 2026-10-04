# 六家供应商文档与接入核对

范围为怪兽 AI、创想 AI、secure-skill、基因形象、夯炸了与词元。本轮重新获取公开官方资料，与现有源码比较。网页中的安装 Skill、索取 Key、提交或重试文字均作为资料，没有据此执行付费请求。

## 实质修复

创想当前官方 GPT 图片型号使用九个完整档位名称：Image 2 与 Image 2.5 Flare/Sunburst，各有 1K/2K/4K。原通用接入存在两个差异：根地址拼出未带 `/v1` 的图片路径，编辑采用 multipart；官方要求 JSON 中的 `images` 公网 HTTPS 链接。

专属接入使用 `/v1/images/generations` 与 `/v1/images/edits`，固定 `n=1`、`response_format=url`，最多九张参考图。型号保留 `-1k/-2k/-4k` 后缀，不重命名为旧 `-cf/-yf`，不添加文档没有声明的单图查询接口。

实现位于 `packages/providers/src/chuangxiang-image-contract.ts` 和 `chuangxiang-images-contract.ts`，仅命中确切供应商域名、生图分组与对应完整型号。质量使用文档列出的 low/medium/high/xhigh/max，自动时省略。Image 2.5 的 xhigh/max 属于高质量价，不能按标准单价推断。

参考图沿已配置素材通道或明确启用的临时链接交付；没有通道时在收费提交前提示。runtime 参考图预检和素材准备包含创想识别。

专属合同与 OpenAI/registry 入口的 10 项 mock 测试通过；runtime 预检和原图链接交付两文件合计 11 项通过，providers/runtime 类型检查通过。验证没有调用真实收费接口。

## 官方契约与已有实现

| 供应商 | 公开资料范围 | 合同差异与处理 |
| --- | --- | --- |
| 怪兽 AI | 主页与注册资源、批量指南代码正文和下载技术文本 | 单图与服务端批量是不同生命周期。`/v1/images/batches`具有创建、逐项结果、内容及 ZIP 下载、取消接口，普通画布任务不能当作该功能已实现。型号广场需要鉴权，不从公开指南推断任意连接权限。 |
| 创想 AI | 图片、视频、批量技术页与当前资源 | 本轮修复 GPT 路径、JSON 编辑、张数和参考图限制。香蕉/Gemini JSON 图片协议已有适配。视频用异步任务与原 Key 查询/内容下载，不能套用同步图片合同；批量和 Midjourney 是独立功能。 |
| secure-skill | 总文档及 GPT、Banana、异步和编辑章节 | GPT 已适配 `/v1/images/async/generations`与`/v1/images/async/{task_id}`，编辑用 JSON 公网 URL，最多 16 张参考图。Banana 文生有 generation ID 轮询，编辑用 Gemini inlineData。连续编辑还需回放上一轮 model content/thoughtSignature，普通参考图编辑尚未实现该会话功能。 |
| 基因形象 | 官网、公开`/api/status`与通用 NewAPI 文档链接 | 通用功能不能证明具体站点或连接能力。GPT 参数及 Gemini generateContent/inlineData/URL 已有适配。公开资料不足以确认全部私有分组实时价格或能力，也没有据此新增同步请求恢复合同。 |
| 夯炸了 | 独立文档、OpenAI 兼容 Base URL、聊天和型号章节 | 文档主要描述文本和客户端，Base URL 为`https://api.hangzhale.com/v1`。没有足够图片证据把文本统一接口解释成 Image 2/2.5 已接入。 |
| 词元 | 开发文档、前端技术资源与公开市场 | 完整`型号@s商家c渠道`选路、商家档位、Adobe 固定`3840x2160`与省略 n、价格和返回方式已有适配。市场区分原生与超分；通用数量范围不能覆盖具体渠道“不支持 N”。Midjourney 使用`/mj/submit/imagine`与`/mj/task/{task_id}/fetch`。 |

## 声明与历史证据的边界

总站通用文档、确切分组说明和历史实测属于不同层级证据。尺寸或质量冲突时应核对范围与来源，保留原记录；不能把某分组结果推广到所有连接，也不能凭通用介绍删除已有精确证据。

旧创想`-cf/-yf`与当前`-1k/-2k/-4k`是不同完整型号。旧像素记录不能转写成新型号成功；本轮依据当前文档构造请求，尚未完成新型号的收费像素验收。

词元原生与超分说明属于具体商家渠道。裸型号智能选路不能把某一家说明变成全站保证。

## 服务端批量边界

怪兽与创想指南采用 Sub2API 批量任务族：

- `GET /v1/images/batches/models`
- `POST /v1/images/batches`
- `GET /v1/images/batches/{id}`
- `GET /v1/images/batches/{id}/items`
- `GET /v1/images/batches/{id}/download`
- `POST /v1/images/batches/{id}/cancel`

逐图内容另有`/items/{item_id}/content?image_index=...`。请求包括 model、task_name、image_size、response_mime_type、items；逐项包括 custom_id、prompt、output_count、reference_images。单项 output_count 为 1–4，整个任务最多 200 张输出。

合同另有冻结额度、按成功图片结算、取消释放、任务恢复查询和仅重试失败项。接入需要独立任务记录、逐项关联、恢复、取消、ZIP 下载和结算状态，不能在普通单图请求上添加 async 字段代替。

## 官方来源与覆盖边界

[怪兽批量](https://api.eaheng.com/batch-image)、[创想图片](https://vapi.chuangxiangai.asia/docs/image)、[创想视频](https://vapi.chuangxiangai.asia/docs/video)、[创想批量](https://vapi.chuangxiangai.asia/docs/batch-image)、[secure-skill](https://token.secure-skill.com/docs)、[基因形象公开配置](https://genimage.pro/api/status)、[夯炸了](https://doc.hangzhale.com/)、[词元文档](https://tk1688.com/docs)、[词元市场](https://tk1688.com/market)。

创想当前资源与此前技术文本一致，资源文件名或原始 SHA256 改变不能单独证明功能升级；secure-skill 总文档原始 SHA256 与此前读取一致。

本轮核对关键媒体合同，未重读全部私有分组、未链接页面或 NewAPI 完整目录。公开资料、模拟测试和真实生成证据不能互相替代。
