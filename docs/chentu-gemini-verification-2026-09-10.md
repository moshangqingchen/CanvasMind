# 辰途低价 Gemini 分组协议核验

2026-09-10，北京时间 21:52 起，使用「低价gemni生图」已保存的 Key 查询当前能力与模型广场，再测试文生图和参考图编辑。

截图中的“尚无已验证的画布生成协议”来自画布适配缺失，不代表 Key 未保存或供应商没有生图能力。以下三个精确模型 ID 均已验证 Gemini 原生接口成功：

| 模型 | 文生图真实尺寸 | 编辑真实尺寸 | 广场价格 |
| --- | --- | --- | --- |
| ad-gemini-3-pro-image-preview | 1024×1024 | 1024×1024 | ¥0.065 / 请求 |
| ad-gemini-3.1-flash-image-preview | 1024×1024 | 1024×1024 | ¥0.05 / 请求 |
| leo-gemini-3.1-flash-image-preview | 1024×1024 | 1024×1024 | ¥0.055 / 请求 |

三个型号各调用一次 `/v1/images/generations`，均返回 HTTP 500 `convert_request_failed`，提示该转换路径只接受 Imagen。随后各调用一次 `/v1beta/models/{完整模型ID}:generateContent` 文生图与编辑，六次均返回 HTTP 200。鉴权为 `x-goog-api-key`，模型的 `ad-` / `leo-` 前缀必须保留。

测试要求生成红杯与左侧蓝球，再只将杯子改绿；抽查 Pro 与 Leo 编辑结果，绿杯和蓝球均正确。请求使用 `responseModalities: ["TEXT", "IMAGE"]`、`imageSize: "1K"`、`aspectRatio: "1:1"`，参考图以内联 Base64 传入。输出按 `candidates[].content.parts[].inlineData` 解码并读取真实像素。

实现增加精确型号的 Gemini 原生 REST connector：保持供应商、Key 和用途，扫描后切换相应提交协议；逐个保留模型 ID，支持文生图和多张参考图，按 MIME 类型提取图片并忽略附带文字。首次接入仅开放 1K，随后按用户反馈补测并恢复 2K/4K，见下表；比例依据 Gemini 原生协议文档提供，不声称额外质量档位或所有比例均已实测。

来源：[辰途媒体文档](https://tu.988236.xyz/docs/api-media.zh-CN.md)、[模型广场](https://tu.988236.xyz/api/pricing)、当前 Key 的 `/v1/image/model-capabilities`。公共文档声明 Gemini 双协议，但上述型号的实际 OpenAI Images 请求失败，因此以原生接口的实测结果接入。

脱敏逐次记录和样图保存在 `.codex-temp/probe/chentu-gemini/`；未保存明文 Key。相关 35 项测试与 web TypeScript 检查通过，本地服务自动构建后刷新该连接，三个型号均返回 `canvasRunnable: true` 和 `gemini-generate-content`。

最后使用实际持久化 connector 和画布共用的 `GenericRestAdapter` 再调用一次 Adobe Flash 编辑，任务状态 `succeeded`，成功解码 PNG 1024×1024；验证了参考图编码、原生请求与图片解析的完整适配路径。总计 10 次上游请求，3 次错误协议对照失败，7 次原生生成/编辑成功。

## 22:17–22:20 分辨率补测

供应商能力接口只列了 1K 附近的像素尺寸，不能据此推断原生 Gemini 接口不支持更高档位。使用相同已保存 Key 和精确型号分别传 `imageSize: "2K"` / `"4K"`、`aspectRatio: "1:1"`，六次全部 HTTP 200，并解码输出检查真实尺寸：

| 模型 | 2K 实际尺寸 | 4K 实际尺寸 |
| --- | --- | --- |
| ad-gemini-3-pro-image-preview | 2048×2048 | 4096×4096 |
| ad-gemini-3.1-flash-image-preview | 2048×2048 | 4096×4096 |
| leo-gemini-3.1-flash-image-preview | 2048×2048 | 4096×4096 |

三个型号均恢复 1K、2K、4K 下拉选项，选择值通过 connector 原样传入 `generationConfig.imageConfig.imageSize`。文生图与图片编辑共用此参数映射；回归测试覆盖三种档位、三个精确型号和两类操作。此次 2K/4K 实际上游补测为文生图，编辑实际验证仍为前面的 1K。

分辨率原始脱敏记录：`.codex-temp/probe/chentu-gemini/size-results.jsonl`。六次耗时约 28–86 秒，没有通过本地放大替代模型输出。累计 16 次上游请求，13 次原生生成/编辑成功，3 次错误协议对照失败。
