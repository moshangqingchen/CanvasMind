# 图片尺寸与分辨率全渠道检查（2026-09-15）

## 范围与结果

检查本机 8 家供应商、29 条外部画布连接：沧元 3、辰途 7、Mikoto 5、赛博阿飞 2、FriModel 4、We-AI 5、喵呜 2、智元 1。包含部分视频连接，用于确认扫描中是否新增了图片型号。逐条读取应用实际返回的型号、尺寸、比例、质量及可用状态；辰途另外查询每个图片分组 Key 的实时尺寸能力。

| 渠道 | 本次处理 |
| --- | --- |
| 辰途 Adobe Sunburst | 补齐 2K 请求预设及 11 种比例，明确标注可能近似。历史请求 2048×2048 返回 1920×1920；本次返回 503 无可用渠道，不能算作 2K 精确输出验证。 |
| 辰途普通 GPT Image 2.5 | 修复只提供文本输入框的问题，按当前 Key 能力显示 11 种原始尺寸；保留 Adobe、AZ、原生 Gemini 的独立协议。 |
| 辰途其他图片分组 | 固定 GPT 档位使用实时尺寸；AZ 保留已实测的 9 种 1K 尺寸及 low；原生 Gemini 提供 1K/2K/4K 与比例。未明确协议的型号保持不可运行。 |
| Mikoto 1K | GPT Image 2 和 Sunburst 从单一方图补为自动及 11 种比例请求预设；Flare 的 11 种比例已有历史实测。新补的其他型号预设不冒充逐项实测。 |
| Mikoto 原生 4K | 补回同一个 GPT Image 2 型号在官方文档中已有的 1K、2K 请求尺寸；修复保存连接沿用“仅 4K”旧表的问题。其他 Gemini/Grok 连接保留独立参数。 |
| 赛博阿飞 | 两个灵活 4K 型号补回 2K 列表。运行时“2K＋自动比例”按选择的 2K 尺寸表解析，避免仍生成 4K 请求。固定 Gemini 型号通过同系列型号快捷切换档位。 |
| 沧元 | 固定型号提供同系列档位与价格快捷切换；Seedream 补齐 1K/2K 自定义尺寸请求预设。GPT 公共别名、Banana 2 的模型文档只列比例，移除与文档冲突的空白精确尺寸输入，保留完整比例列表；Banana 2 标明固定 K 档。 |
| FriModel | 本次部分目录超时或返回缓存；现有 GPT 图片型号已有多档尺寸。不能将此次缓存读取声称为最新上游能力验证。 |
| We-AI / 喵呜 | 当前连接返回 403 / 401，无法重新验证实际权限与最新尺寸。保留已有配置，不将认证失败当作型号下架。 |
| 智元 | 扫描可见 GPT Image 2，但没有明确画布调用协议，不补造尺寸与质量能力。 |

## 独立型号快捷切换

用户确认允许按分辨率切换独立计费型号。画布节点设置和右侧检查器增加“分辨率与价格”：

- 只使用当前连接内同系列 `-1k/-2k/-4k` 型号，不跨渠道、Key 或分组。
- 展示各型号的已有价格与币种，未知价格显示“价格以渠道为准”；没有对应型号的档位禁用。
- 点击档位同时切换型号与参数；按新型号提供的合法尺寸保留最接近的比例，自动模式继续自动。
- 质量按新型号的最高可用档位初始化。刷新后保留所选型号与比例。

## 实测与费用

本次只发出一次真实生图请求：辰途 `低价Adobe生图` / `gpt-image-2.5-sunburst` / `2048x2048` / `quality=max`，北京时间 17:55:13，返回 503 `No available channel`，未得到图片，随即停止重试。

随后读取该 Key 的 `/api/log/token/`，654 条记录中没有本次时间窗口的 Sunburst 结算记录，匹配扣费为 0；本次未发现新增扣费。此前任务已记录实测费用累计 ￥0.657476。其余工作为目录读取、软件测试及模拟接口浏览器测试。

## 验证

- 全量单元测试 1,210 项通过，类型检查和生产构建通过，Lint 无错误。
- 浏览器端到端测试验证 1K→4K→刷新→2K，型号、对应价格和竖图尺寸均正确。
- 运行时回归覆盖阿飞自动比例的 2K、4K 与显式 A4 尺寸优先级。
- 原始目录与本地扫描证据存放于被 Git 忽略的 `.codex-temp/all-sizes-20260915/`，不包含在发行包中。

## 依据

- [辰途媒体接口](https://tu.988236.xyz/docs/api-media.zh-CN.md)及各 Key 的 `/v1/image/model-capabilities`。
- [Mikoto 2K/4K 尺寸与比例](https://api.mikoto.vip/openai-image-4k-2k-guide.html)。
- [阿飞 Image-2](https://api.3365api.cn/docs/img2.md)。
- [沧元统一图片接口](https://ai.cangyuansuanli.cn/docs-static/capabilities/image.md)、[GPT 公共名](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.json)、[Banana 2](https://ai.cangyuansuanli.cn/docs-static/models/nano-banana2-4k.json)、[Seedream](https://ai.cangyuansuanli.cn/docs-static/models/doubao-seedream-5-0-pro.json)与实时价格目录。
