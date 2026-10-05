# 蒙版局部重绘核查 · 2026-10-05

用户需求：上传原图，用画笔涂抹需要修改的区域，只修改该区域，其他部分保持不变。

结论：供应商端存在原图加蒙版的编辑接口；本地 v0.2.55 尚没有完整的涂抹式局部重绘流程。目前只有沧元的一个精确型号接入了蒙版 URL 参数。没有发现区域外像素不变的保证机制。

## 本地功能现状

| 环节 | 当前实现 |
| --- | --- |
| 上传、拖放原图 | 已有图片素材及导入入口。 |
| 参考图编辑、继续修改 | 已有；原图接入 references，runtime 选择 image.edit。 |
| 画笔涂抹原图生成 mask | 没有专用蒙版编辑器。已有画笔是自由涂鸦；合并后按笔迹边界导出普通 PNG 参考图，未与原图像素坐标绑定。 |
| 蒙版上传与连接 | 没有专用 mask 资产角色和节点输入。把蒙版作为第二张图片上传，仍然是参考图，不会自动成为 mask。 |
| 已接入的 mask 参数 | 仅沧元 gpt-image-2-x 的 1k/2k/4k 编辑请求，参数为公网 HTTPS 蒙版地址；web 档不接受。 |
| 通用 OpenAI 图片编辑 | 白名单和 multipart 构造均没有独立 mask 字段；FriModel、辰途、Synora 等走该通路时不会自动传递 mask。 |
| 其余供应商专属接入 | 当前审查的 Mikoto、阿飞、喵呜、创想、secure-skill、pDog 等标准请求映射没有独立 mask；词元目录过滤同样没有此字段。不能由客户端缺失反推供应商不支持。 |
| 未涂抹区域保持不变 | 目前只靠提示词要求保留；结果直接保存上游返回图片，没有按蒙版检测或保护区域外像素的流程。 |

## 已核对的上游接口证据

- **沧元 gpt-image-2-x**：当前精确文档明确只有 1k/2k/4k 编辑可以传一个 mask HTTPS URL，web 不接受。使用 POST /v1/images/edits，同时提交 images 与 mask。[型号文档](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-x.json)
- **沧元部分其他完整型号**：gpt-image-2-4k、gpt-image-2.5-flare 的当前独立型号文档也列出可选 mask；但 gpt-image-2.5-x 文档没有该参数。不能按系列名字统一推断；当前项目未为前两者完成 mask 映射。[Image 2 4K](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-4k.json)、[Image 2.5 Flare](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare.json)、[2.5-x](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-x.json)
- **FriModel**：本轮相邻的公开资料读取中，GPT 指南明确说明局部重绘可上传 mask，并要求原图与 mask 尺寸匹配、mask 为带透明通道 PNG。本地通用 adapter 尚未传该文件字段。[GPT 指南](https://ai-doc.apifox.cn/9077234m0.md)
- **创想**：当前图片文档说明 GPT 编辑可增加 mask 图片链接；Midjourney 的局部编辑为 /v1/images/edits、reference=editor、单张参考图和可选 mask。本地相应请求映射仍未接入 mask。[图片文档](https://vapi.chuangxiangai.asia/docs/image)
- **词元**：当前开发文档有 multipart 局部重绘示例，将 image 文件与 mask 文件发送到 /v1/images/edits；示例型号是 gpt-image-1，不能据此宣称当前 Image 2/2.5 或所有商家渠道支持。[开发文档](https://tk1688.com/docs)
- **secure-skill**：当前文档将 mask 列入提交上游前拒绝的参数。其透明背景输出能力不能推导为支持蒙版局部编辑。[官方文档](https://token.secure-skill.com/docs)
- **We-AI**：图片指南提到局部编辑，并列出蒙版缺 alpha 的错误说明，但本次未取得足够完整的分组级 mask 提交合同，不据此认定所有组已支持。[图片指南](https://docs.we-ai.cc/guides/image-generation.html)
- **OpenAI 官方语义**：Images 编辑支持输入图和 mask，多图时 mask 对第一张图生效；原图与蒙版需匹配格式与尺寸，蒙版需含 alpha。官方同时明确蒙版属于模型引导，可能不精确遵守形状。因此“有 mask 参数”不能等同于“未涂抹区域逐像素不变”。这是官方模型能力说明，不是对第三方所有分组的支持承诺。[官方图像编辑说明](https://developers.openai.com/api/docs/guides/image-generation#edit-an-image-using-a-mask)

## 可定位的代码

- apps/desktop/renderer/components/canvas-app.tsx：3881 附近为画布涂鸦；8354 附近说明合并涂鸦后接普通参考图；9344 附近为上传入口。
- apps/desktop/renderer/lib/drawing.ts：233 附近为按笔迹边界导出图片。
- packages/providers/src/cangyuan-current-models.ts：41 为蒙版 URL 文本参数；75–79 为原图及 mask 请求映射；107–108 为型号、档位和 HTTPS 限制。当前未校验蒙版实际尺寸与 alpha。
- packages/providers/src/openai.ts：1567 附近为通用参数白名单；3793 附近为只构造 image/image[] 的编辑 multipart。
- packages/providers/src/contracts.ts：122 附近为素材角色，没有 mask。
- packages/runtime/src/service.ts：724 附近按图片输入选择 image.edit；3603 附近直接归档供应商输出。

本轮只读核查，未生成或修改图片、未调用收费接口、未修改应用源码或配置。公开资料保存在本机发布排除目录 .release-stage/inpainting-audit-20261005/，部分与上一轮相邻读取的公开资料共用 .release-stage/transparent-audit-20261005/。
