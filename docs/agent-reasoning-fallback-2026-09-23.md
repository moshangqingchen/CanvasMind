# 思考档位的供应商优先与官方回退

2026-09-23 核对“夯炸了”的 `gpt-pro-[稳定优先]` 分组。该名称是分组名，不能当成模型 ID。当前 Key 已保存的型号为 `gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-6-astra`、`gpt-6-sol`。

按用户要求先核对供应商资料：

- [供应商文档](https://doc.hangzhale.com/) 说明调用方式和按 Key 权限选择模型，没有声明思考档位。
- 主站内置模型广场接口返回未启用，但公开设置链接到了独立[模型广场](https://price.hangzhale.com/)。其 `/api/provider/pricing` 列出该分组的 `gpt-6-sol` 等模型和价格，没有声明思考档位。
- [GPT-6 Sol 官方页面](https://developers.openai.com/api/docs/models/gpt-6-sol) 明确支持 `none / low / medium / high / xhigh / max`，项目内置表漏掉此型号，导致回退失败。本次补齐，并同步补齐已核对的 [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) 相同档位。

供应商声明继续优先，当前连接明确拒绝的参数继续排除。官方回退显示“官网默认档位，当前渠道未实测”，核验日期为 2026-09-23；没有新增付费模型请求或伪造渠道实测。

同时修正已保存模型描述的解析：旧逻辑遇到 `operations` 数组就只解析 ID，遗漏同一记录中的文档和枚举。现在保留这些声明，同时不把旧扫描器的 `[text]` 占位误判为明确不支持视觉。

回归覆盖该分组五个型号的官方回退、最高档位传递、供应商声明优先、旧描述解析、渠道拒绝和旧视觉占位兼容。

验证结果：101 项相关单元测试、界面/API 类型检查、修改文件 ESLint 和完整桌面构建通过。对新包内的本地 API 使用当前分组的五个已保存型号及虚拟 Key，在隔离资料库中读取 `/api/agent/models`，全部返回官方档位；`gpt-6-sol` 返回自动及六个明确档位。没有修改用户资料库或调用模型生成接口。

更新包为 `apps/desktop/release/SuperCanvas-Setup-0.2.33-x64.exe`。随后合并接口路径修复，最终构建标识为 `Ashwj-BG5nQu9h8a6PnWc`；核验报告为 `.codex-temp/agent-reasoning-20260923/package-check.json`。2026-09-23 20:42 已覆盖安装并重启，详情见 [接口路径修复与安装记录](agent-api-path-fix-2026-09-23.md)。
