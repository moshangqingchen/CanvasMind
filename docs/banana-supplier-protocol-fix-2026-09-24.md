# 香蕉供应商协议修复

用户截图中的基因形象 `geminiResponseUrl / gemini-3-pro-image-preview` 被发送到 OpenAI Images 接口，返回 `convert_request_failed / only imagen models are supported`。本次按供应商和模型分开路由，GPT 图片接口、请求参数和已存配置保持原样；没有改动 Corel 或供应商自动核验调度。

## 供应商处理

| 供应商 | 香蕉调用方式 | 文档依据 |
| --- | --- | --- |
| 基因形象 Genimage | `/v1beta/models/{model}:generateContent`，Bearer；读取所有图片 parts，支持 inlineData、fileData 和返回图片链接的文本 | 供应商 `/api/status` 指向的 [New API 原生 Gemini 文档](https://docs.newapi.ai/zh/docs/api/ai-model/images/gemini/geminirelayv1beta-383837589) |
| FriModel | 同一原生端点完成文生图和改图；`x-goog-api-key`，参考图使用 `inlineData` | [Gemini 图片生成指南](https://ai-doc.apifox.cn/9285585m0) |
| We-AI adobe香蕉 | 原生 Gemini 端点，Bearer；保留文档中的比例、512/1K/2K/4K 和 preview 别名规则 | [香蕉接入指南](https://docs.we-ai.cc/guides/gemini-banana-image.html) |
| Secure Skill | 文档明确的型号在无参考图时使用 `/v1/images/generations` 原生异步接口，保存 id，每 3 秒 GET 同一路径加 id；参考图通过原生 Gemini 内联字节提交。其余分组映射别名使用文档允许的原生 Gemini 路径 | [Banana 图片接入](https://token.secure-skill.com/docs) |
| 创想 AI | 保留其文档指定的 Images 路径，香蕉使用比例 size；Gemini 的 quality 传 1k/2k/4k，固定档 nano-banana 不传 quality；编辑以 JSON images 传公开 HTTPS 链接，最多 9 张 | [图片 API](https://vapi.chuangxiangai.asia/docs/image) |

辰途、赛博阿飞、Mikoto 的已有原生 Gemini 接法保留；沧元保留其供应商模型目录明确声明的 Images 接法及模型专用参数和异步查询。没有把所有香蕉供应商强行统一成一种协议。

2026-09-24 使用现有 Key 只读查询了 Genimage、FriModel、We-AI 的 `/v1beta/models`。前两者均返回截图型号；We-AI 原生列表没有旧通用目录里的 `gemini-3.0-pro-image`，因此禁止该未受支持的型号误发请求，并提示选择已支持型号，不偷偷换模。

## 参数、参考图和返回值

- 香蕉专用参数是画面比例和分辨率，旧画布的 `size_tier`、像素尺寸与大小写档位会迁移；明确保存的 2K 不会因新默认值改成 4K。
- 修复 FriModel 等分组被标记为仅文生图的问题，参考图字节随编辑指令进入 `contents[].parts[]`。原生路径遇到 URL 参考图时先在本机读取字节，不能把任意网址假装成 Google Files URI。
- 支持 camelCase/snake_case 图片 parts、base64、data URI、fileData 和 Markdown 图片 URL。异步接口完成但尚无图片时继续查询同一个任务编号。
- 保留无限本机图片提交等待和既有断线诊断；有任务编号的查询可以恢复。非幂等生成只提交一次，不盲目重发未知状态的收费请求。供应商同步接口若在返回前断开且没有任务编号，客户端不能凭空恢复结果。
- 创想 AI 的公开参考图需求在付费提交前检查；沿用用户已经配置的本机素材通道或明确开启的临时链接选项。

## 验证

- Providers：34 文件、474 测试通过。
- Runtime：14 文件、202 测试通过，包含原始画布参数、连接参考图、原生请求和结果归档。
- 画布与供应商目录：11 文件、166 测试通过；最后补充的界面迁移回归共 4 文件、67 测试通过。
- TypeScript 和桌面生产构建通过；打包桌面冒烟 23 项通过。
- 使用已安装桌面的认证 API 实际提交 **一次** `Genimage / geminiResponseUrl / gemini-3-pro-image-preview`，原始参数为 `{size:"auto",size_tier:"4K",quality:"max"}`。实际请求为原生 Gemini 的 4K、1:1，网络记录仅一条收费 POST，经 physical-direct。
- 运行 `e8c66aba-fb71-465f-b6ae-4c52dd080a44` 在约 **61 秒** 后成功。返回资产 `b0f1c7c28eac623a110f8050c02fec75e705aba44df09c6b55192ba9b2499d5b` 为 **4096×4096 JPEG、9,279,383 字节**，完整解码 50,331,648 字节像素，并目视核对。桌面素材预览接口也成功显示了该图片。
- 其他供应商本轮进行了文档、模型列表及协议回归验证，没有全部逐个付费生成，不能将上述单次成功描述为所有供应商已实测永不中断。

测试画布：`e2715b06-6ed5-4847-a6bf-831a2fb5237c`（香蕉接口修复验证 2026-09-24）。协议证据、安装记录和实测记录位于 `.codex-temp/gemini-routing-20260924/`。第一次安装构建 `OI1wsN8zeTY8cyGvLnKmj` 的 11257 个文件逐一比对哈希一致，安装期间数据库未变化，91 个连接中的 GPT 模型配置、默认型号和密钥未变。最终界面补丁的安装核对记录见同目录最终安装文件。

最终构建 **`QoOzDhCtuX9sf2Vfhp81y`** 已覆盖安装到 `apps/超级画布桌面版` 并重启，再次逐一核对 11257 个文件，安装期间数据库未变。实际选择测试香蕉节点后，旧 `quality:max` 已迁移移除，4K 档位保留，图片素材预览在安装后的桌面成功解码显示。两次安装备份分别位于 `apps/超级画布桌面版-backup-20260924-banana` 和 `apps/超级画布桌面版-backup-20260924-banana-final`。最终界面补丁后没有再付费生成；其供应商与运行层代码和前述真实成功验证相同。
