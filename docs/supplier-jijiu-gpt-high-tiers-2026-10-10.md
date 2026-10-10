# 极九 GPT 高档图片参数补齐

2026-10-10，用户明确要求将供应商已标注的 2K、4K 与最高质量直接列入可选参数，不再因缺少逐比例像素 schema 而隐藏。此次只修改 `https://newapi.jijiucanvas.com` 的完整型号 `gpt-image-2-2K/4K`；可用分组仍为 `default`、`图片-GPT-image-2-2K/4K`，不扩大低档 GPT、Gemini 或其他供应商能力。

## 官方资料与请求

本次免费读取的[官方 API 文档](https://newapi.jijiucanvas.com/docs/api-docs.md)和[模型价格目录](https://newapi.jijiucanvas.com/api/pricing)均声明该完整型号支持 1K / 2K / 4K 和参考图。文档列出图片字段 `size`、生成端点 `/v1/images/generations` 与 JSON 编辑端点 `/v1/images/edits`；尚未提供该型号逐比例像素表、自定义宽高规则。

控件使用 `size: auto / 1K / 2K / 4K` 和独立 `quality: auto / high`。“最高”实际发送 `high`；这是 [GPT Image 2 的原始质量枚举](https://developers.openai.com/api/reference/resources/images/methods/generate)，不会将中文标签或 `max` 发送给接口。`auto` 省略对应字段，保留供应商默认。最高质量可与档位独立选择。

供应商明确声明档位；用户要求启用这些档位；单次真实请求结果分别记录，三者不混为全部组合已实测。合法已保存的 4K/high 在目录刷新和参数解析后保留，别名统一映射到 `size`；冲突字段、未知 max、自定义像素和错误分组在请求前阻断，不静默降档。

## 单次原图证据

主任务于 `2026-10-10T08:19:14.811Z` 完成一次该高档分组的图片请求：`size: "4K"`、`quality: "high"`、`n: 1`，HTTP 200，返回原始 PNG **2880 × 2880**、**3,734,557 字节**，未转码。原文件 SHA256：`0a72660f53bc5cef0885f42885a8c9204f56fb82045ef8b4a48cd0cf6bb713a5`。

此证据只证明该次生成参数被接受且获得上述原图，不将 2880 × 2880 固定为所有 4K 比例，不宣称 1K、2K、编辑或所有比例已完成真实生成。目录当前计费表达式为 `tier("base", fixed(0.1))`，以 CNY 每次并应用实际分组倍率一次；本次账户请求数增加 1、额度减少 50,000，按站点 500,000 额度单位 / CNY 对应 0.1 CNY。

随后免费读取 `/api/log/self`，请求期间仅一条消费记录，完整型号、分组、时间和 50,000 额度均相符；但账单请求编号与响应头编号不一致，因此按时间窗口及账户差额关联，不宣称请求编号精确匹配。带尾斜杠的日志地址触发重定向，改用站点原生无尾斜杠地址后正常返回。

本次供应商资料读取为免费 GET；provider 开发与回归使用模拟 HTTP，无额外图片生成、上传和任何视频收费请求。

## 资料哈希与源码回归

| 官方资料 | HTTP | SHA256 |
| --- | --- | --- |
| `/docs/api-docs.md` | 200 | `632144eb2dbdae3f612f8ac29618c44071cdc835a6ac3407dc469e61d81aeb94` |
| `/api/pricing` | 200 | `d80add1e490eeee82be3cfe6fccad15ad2e87d1980bd418545900f742d690f09` |
| 官网首页 | 200 | `9b813c765240ab4463f748d634971c20bb26ab63e47b6eff6bafe6bd9e0c3111` |
| 官网引用前端 `index.e2408c4861.js` | 200 | `7272b0312cf00f527ce5f5dc65ecf5e4f693990b9874ebe0ebbeab3b6c223d35` |

provider 回归覆盖生成与 JSON 编辑字段、供应商默认省略、保存值/别名、旧目录刷新、错误来源/分组、低档隔离及非法参数零 HTTP。新增自动路由回归同时检查 openai/rest 的旧 auto-only schema、漏字段模板、显式手工合同保留，以及原 PNG / URL 的结果提取和无网恢复。精确合同、路由及通用文档 75 项通过，类型检查通过。

providers 全量 85 文件 / 2064 项中，2063 项直接通过；构建并行时一项既有 CLI 测试达到 5 秒超时，随后整个 CLI 文件 26 项单独复验全部通过，未修改超时或代码。运行时新增 32 项完整请求与归档回归通过。安装版 API、安装版界面和发布验收另行记录。
