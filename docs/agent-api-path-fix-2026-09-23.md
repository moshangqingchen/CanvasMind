# 智能体接口返回网页的修复

用户会话中两次 GPT-6 Sol 请求均记录为 `invalid_response`，提示“导演模型返回了无法解析的数据”。连接保存的 Base URL 是供应商站点根地址 `https://api.hangzhale.com`。旧版缺少 GPT-6 Sol 档位资料时默认 Chat Completions；适配器直接拼接 `/chat/completions`，遗漏供应商文档要求的 `/v1`。

2026-09-23 使用无凭据、空请求体复现：`POST /chat/completions` 返回 HTTP 200、`text/html` 和网站首页；`POST /v1/chat/completions` 返回 HTTP 401、JSON 的 `API_KEY_REQUIRED`。这说明旧地址打到了网页入口。没有提交带 Key 的模型生成请求。

修复内容：

- 供应商地址只有域名时，OpenAI 兼容及 Anthropic 协议使用 `/v1`，Gemini 原生协议使用 `/v1beta`。
- 已明确配置的版本路径或自定义网关前缀保持原路径，不重复添加 `/v1`。
- HTTP 成功但内容为网页时，提示“供应商返回了网页内容，请核对供应商文档中的 API 地址和接口路径”，不再把页面正文当模型答案或显示笼统的导演解析错误。
- 合并此前 GPT-6 Sol/Luna 官方思考档位及供应商声明解析修复。

211 项相关测试、类型检查、修改文件 ESLint 通过；覆盖各协议根地址、显式网关前缀、网页响应、SSE、结构化结果、连接隔离和思考档位。

供应商依据：[接入文档](https://doc.hangzhale.com/)。安装与备份记录保存在 `.codex-temp/agent-endpoint-20260923/install-report.json`。

2026-09-23 20:42 已覆盖安装并重启现有 `apps/超级画布桌面版`，构建标识 `Ashwj-BG5nQu9h8a6PnWc`。安装校验 11,233 个程序文件与新包一致、926 个资料文件在安装期间完全不变；保留 86 条连接、3 个画布、115 个素材、111 条运行记录。程序与资料分别备份到 `backups/agent-endpoint-program-20260923-204119` 和 `%LOCALAPPDATA%/SuperCanvasDesktopBackups/before-agent-endpoint-20260923-204119/profile`。

重启后已通过 Windows 界面打开原画布与原会话，确认 GPT-6 Sol 的思考强度显示“自动、无、低、中、高、超高、极限”以及官网默认来源。旧错误作为历史记录保留，没有自动重发旧任务。
