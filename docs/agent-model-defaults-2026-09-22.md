# 智能体视觉与质量档位规则 · 2026-09-22

最新完整规范见 [供应商模型验证完整规则：生图与智能体](supplier-testing-workflow.md)，其中第 12 节明确：缺少渠道思考档位时，先查清渠道别名对应的官方型号，再按该官方型号补齐；不能只因名称不标准就停止查证或一直显示“待识别”。本文后续型号表与交付信息为当时的核验记录，不能替代最新官方资料。

此变更按用户追加要求调整“信息不足”的默认行为，沿用已接入 Key，不创建或合并密钥。

- 供应商文档与模型广场明确说明图片、视频、音频能力及上传数量时优先使用；精确 Key 的实际拒绝会覆盖默认假设。
- 未声明视觉的聊天大语言模型默认开放图片理解，显示“默认支持”，不是实测标签。音频/视频仍需明确声明与适配器支持。
- 思考强度优先渠道声明；缺失时使用准确型号的官网档位。官网档位与渠道实测分开标记，不把别的供应商成功记录套给当前 Key。
- 供应商的上传数量与应用每轮 16 个附件、单个 16 MB、总计 24 MB 的内存限制分别展示。新附件超限会阻止提交；历史超限只省略旧附件并保存提示，不静默丢失本轮附件。
- 原连接 ID、供应商/分组隔离、鉴权、历史任务、失败恢复、画布执行继续保留。

## 官网依据

核验日期：2026-09-22。以下为官方声明，未标为转售渠道实测：

| 精确型号 | 官网思考档位 | 来源 |
| --- | --- | --- |
| GPT-6 Astra | low / medium / high / xhigh / max | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-astra) |
| GPT-5.6 Sol（含 gpt-5.6 别名） | none / low / medium / high / xhigh / max | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| GPT-5.6 Terra | none / low / medium / high / xhigh / max | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| GPT-5.5 | none / low / medium / high / xhigh | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.5) |
| GPT-5.4 | none / low / medium / high / xhigh | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.4) |
| GPT-5.2、GPT-5.4 Mini | none / low / medium / high / xhigh | [GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2)、[GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |
| GPT-5.2 Pro | medium / high / xhigh | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.2-pro) |
| GPT-5.3 Codex | low / medium / high / xhigh | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.3-codex) |
| GPT-5.6 Luna | none / low / medium / high / xhigh / max | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| Claude Opus 4.5 | low / medium / high | [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort) |
| Claude Opus 4.6、Sonnet 4.6 | low / medium / high / max | [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort) |
| Claude Opus 4.7 / 4.8 / 5、Sonnet 5、Fable 5 / 5.1 | low / medium / high / xhigh / max | [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort) |
| Gemini 3 Pro Preview | low / high | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking) |
| Gemini 3.1 Pro Preview | low / medium / high | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking) |
| Gemini 3 Flash Preview、3.5 Flash | minimal / low / medium / high | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking) |

GPT-6 Astra 的 API 官方档位没有 Ultra，因此不会照抄 Codex 界面中的 Ultra 标签作为 API 参数。

原生 Claude 请求使用 `output_config.effort`；支持 adaptive 的型号使用对应思考模式，避免强制工具选择与 adaptive 冲突。原生 Gemini 3 使用 `generationConfig.thinkingConfig.thinkingLevel`。Gemini 2.5 的此协议使用预算，保留自动，不把低中高编造成预算值。参见 [Claude 模式限制](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting) 与 [Gemini generateContent](https://ai.google.dev/gemini-api/docs/generate-content/thinking)。

只对官网明确列出的日期快照映射原型号；未查到的转售别名不通过截字符串猜型号。GPT-4o Audio 对话模型按官方声明支持音频，明确不支持图片/视频，不能被“默认视觉”覆盖。

## 验证与安装状态

补充自动测试覆盖文档/广场字段存取、未知视觉默认、明确否定、各类附件数量、历史附件选择、思考来源、某档位被拒绝、MP3 与 Gemini 多模态请求字节。界面/API 1,255 项单测、供应商 332 项测试、类型检查及修改文件 ESLint 通过。最终构建的 11 项智能体浏览器回归、22 项打包冒烟通过。初次浏览器回归发现测试选择器匹配多个提示框、上传 mock 误匹配预览 GET；已修正测试定位与拦截路径后复跑全部通过，不涉及程序修改。

读取当前真实连接配置（不调用付费接口）确认 `secure-skill / gpt / gpt-6-astra` 使用 Responses，视觉为默认支持，思考选项为自动、低、中、高、超高、极限，来源为官网。此检查不等于 secure-skill 渠道实测；本轮没有新增付费模型调用。

2026-09-23 15:32（北京时间）已安装并重新启动，构建标识 `jItqYMJxRf7KpHu18Cu1x`。安装前确认程序正常退出，备份并校验 877 个资料文件；11,229 个程序文件与新包一致。启动前资料完整不变，启动后保留 82 条连接、1 个画布、107 个素材、98 条运行记录，密钥容器与备份一致。新进程正常启动，内置健康检查通过后写入端口文件，服务与访问鉴权正常。

- 资料备份：`C:\Users\Administrator\AppData\Local\SuperCanvasDesktopBackups\before-agent-model-defaults-20260923-153141\profile`。
- 旧程序备份：`backups/agent-model-defaults-program-20260923-153141`。
- 安装记录：`.codex-temp/agent-model-defaults-20260922/install-report.json`。
