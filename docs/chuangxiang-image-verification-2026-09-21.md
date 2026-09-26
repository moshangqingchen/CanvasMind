# 创想 AI 图片能力付费实测 · 2026-09-21

> 0.2.29 更新：本文保留当次请求及实际像素证据。某次未达到 4K 或出现服务错误不再限制后续请求；界面已开放自动、1K/2K/4K 与每档 11 个比例。可请求档位与实测通过档位分别记录，详情见 `panel-reference-fixes-2026-09-21.md`。

8 个 GPT 图像型号；质量仅 high / xhigh / max；11 种比例统一用 high；2K 方图及 4K 横图抽测；不包含 Grok、编辑与图生图。

共计划 120 项，已提交 120 项，其中 98 项成功出图，保存 99 张可解码原图，22 项服务错误，0 项未提交。每项最多请求一次，没有自动重试、充值或新建密钥。

## 费用

后台 98 条账单合计 **60 站内额度**，按站点标价约 **人民币 6 元**。余额 100 → 40，减少 60 额度。按站点公开模型标价：cf 每张 0.04 元对应 0.4 额度，yf 每张 0.08 元对应 0.8 额度；不是外币汇率。

计费异常：所有请求都明确发送 `n: 1`，但 2 条账单记录的图片数不是 1：gpt-image-2.5-flare-yf，输入 832x1248，记 2 张、1.6 额度；gpt-image-2.5-flare-yf，输入 1184x880，记 2 张、1.6 额度。首次发现后暂停对账，随后单请求预留双倍费用并降为 2 路并发，总预算不变。早期响应未记录完整 data 数量，不能确定异常发生在返回数量还是计费环节。

后续响应已确认：gpt-image-2.5-flare-yf 请求 832x1248 时发送 n=1，却返回 2 张，已解码保存 2 张。这些请求的多张计费与返回数量一致，问题是上游没有遵守请求数量；早期未记录完整返回数组的那笔仍单独保留不确定性。

## 型号结果

| 型号 | 请求 / 出图 | 成功提交的质量参数 | 实际接近的 K 档位 | 费用（额度） |
| --- | --- | --- | --- | --- |
| gpt-image-2-cf | 15 / 12 | high | 1K | 4.8 |
| gpt-image-2-yf | 15 / 12 | high | 1K | 9.6 |
| gpt-image-2.5-cf | 15 / 10 | high | 1K | 4 |
| gpt-image-2.5-yf | 15 / 11 | high | 1K | 8.8 |
| gpt-image-2.5-flare-cf | 15 / 15 | high、xhigh、max | 1K、2K、4K | 6 |
| gpt-image-2.5-flare-yf | 15 / 15 | high、xhigh、max | 1K、2K、4K | 13.6 |
| gpt-image-2.5-sunburst-cf | 15 / 13 | high、xhigh、max | 1K、2K | 5.2 |
| gpt-image-2.5-sunburst-yf | 15 / 10 | high、xhigh、max | 1K | 8 |

## 需要留意的结果

- 实测达到 4K 档位的型号：gpt-image-2.5-flare-cf、gpt-image-2.5-flare-yf。这里只确认返回像素，不验证上游是否采用超分。
- 4K 请求缩水：gpt-image-2-cf → 1672×941；gpt-image-2-yf → 1672×941；gpt-image-2.5-cf → 1672×941；gpt-image-2.5-yf → 1672×941；gpt-image-2.5-sunburst-cf → 1672×941；gpt-image-2.5-sunburst-yf → 1672×940。
- 比例偏差：gpt-image-2-cf，4:5 请求 912x1136 → 1191×1321；gpt-image-2.5-flare-cf，9:16 请求 768x1360 → 1088×1445；gpt-image-2.5-flare-yf，9:16 请求 768x1360 → 1088×1445。
- 未列出的质量或 K 档位表示本轮没有充分的成功证据。服务错误与尺寸缩水分别记录，不能用暂时性 502 / 503 推断永久不支持。

## 具体尺寸与比例

| 型号 | 请求质量 | 请求档位 / 比例 | 请求像素 | 实际像素 | 结果 |
| --- | --- | --- | --- | --- | --- |
| gpt-image-2-cf | high | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2-cf | xhigh | 1K / 1:1 | 1024x1024 | — | 服务错误 502 |
| gpt-image-2-cf | max | 1K / 1:1 | 1024x1024 | — | 服务错误 503 |
| gpt-image-2-cf | high | 2K / 1:1 | 2048x2048 | — | 服务错误 503 |
| gpt-image-2-cf | high | 4K / 16:9 | 3840x2160 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2-cf | high | 1K / 16:9 | 1360x768 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2-cf | high | 1K / 9:16 | 768x1360 | 943×1668 | 比例匹配；就近 1K |
| gpt-image-2-cf | high | 1K / 4:3 | 1184x880 | 1454×1082 | 比例匹配；就近 1K |
| gpt-image-2-cf | high | 1K / 3:4 | 880x1184 | 1080×1456 | 比例匹配；就近 1K |
| gpt-image-2-cf | high | 1K / 3:2 | 1248x832 | 1536×1024 | 比例匹配；就近 1K |
| gpt-image-2-cf | high | 1K / 2:3 | 832x1248 | 1024×1536 | 比例匹配；就近 1K |
| gpt-image-2-cf | high | 1K / 5:4 | 1136x912 | 1402×1122 | 比例匹配；就近 1K |
| gpt-image-2-cf | high | 1K / 4:5 | 912x1136 | 1191×1321 | 比例偏差；就近 1K |
| gpt-image-2-cf | high | 1K / 21:9 | 1552x672 | 1906×825 | 比例匹配；就近 1K |
| gpt-image-2-cf | high | 1K / 9:21 | 672x1552 | 825×1906 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2-yf | xhigh | 1K / 1:1 | 1024x1024 | — | 服务错误 502 |
| gpt-image-2-yf | max | 1K / 1:1 | 1024x1024 | — | 服务错误 503 |
| gpt-image-2-yf | high | 2K / 1:1 | 2048x2048 | — | 服务错误 503 |
| gpt-image-2-yf | high | 4K / 16:9 | 3840x2160 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 16:9 | 1360x768 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 9:16 | 768x1360 | 943×1667 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 4:3 | 1184x880 | 1454×1082 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 3:4 | 880x1184 | 1080×1456 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 3:2 | 1248x832 | 1536×1024 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 2:3 | 832x1248 | 1024×1536 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 5:4 | 1136x912 | 1402×1122 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 4:5 | 912x1136 | 1123×1401 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 21:9 | 1552x672 | 1903×826 | 比例匹配；就近 1K |
| gpt-image-2-yf | high | 1K / 9:21 | 672x1552 | 826×1905 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 1:1 | 1024x1024 | — | 服务错误 502 |
| gpt-image-2.5-cf | xhigh | 1K / 1:1 | 1024x1024 | — | 服务错误 502 |
| gpt-image-2.5-cf | max | 1K / 1:1 | 1024x1024 | — | 服务错误 503 |
| gpt-image-2.5-cf | high | 2K / 1:1 | 2048x2048 | — | 服务错误 503 |
| gpt-image-2.5-cf | high | 4K / 16:9 | 3840x2160 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 16:9 | 1360x768 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 9:16 | 768x1360 | — | 服务错误 502 |
| gpt-image-2.5-cf | high | 1K / 4:3 | 1184x880 | 1454×1082 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 3:4 | 880x1184 | 1080×1456 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 3:2 | 1248x832 | 1536×1024 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 2:3 | 832x1248 | 1024×1536 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 5:4 | 1136x912 | 1399×1124 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 4:5 | 912x1136 | 1124×1399 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 21:9 | 1552x672 | 1905×825 | 比例匹配；就近 1K |
| gpt-image-2.5-cf | high | 1K / 9:21 | 672x1552 | 826×1905 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | xhigh | 1K / 1:1 | 1024x1024 | — | 服务错误 502 |
| gpt-image-2.5-yf | max | 1K / 1:1 | 1024x1024 | — | 服务错误 503 |
| gpt-image-2.5-yf | high | 2K / 1:1 | 2048x2048 | — | 服务错误 503 |
| gpt-image-2.5-yf | high | 4K / 16:9 | 3840x2160 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 16:9 | 1360x768 | — | 服务错误 502 |
| gpt-image-2.5-yf | high | 1K / 9:16 | 768x1360 | 943×1667 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 4:3 | 1184x880 | 1454×1082 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 3:4 | 880x1184 | 1082×1454 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 3:2 | 1248x832 | 1536×1024 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 2:3 | 832x1248 | 1024×1536 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 5:4 | 1136x912 | 1398×1125 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 4:5 | 912x1136 | 1125×1398 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 21:9 | 1552x672 | 1905×825 | 比例匹配；就近 1K |
| gpt-image-2.5-yf | high | 1K / 9:21 | 672x1552 | 825×1905 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | xhigh | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | max | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 2K / 1:1 | 2048x2048 | 2048×2048 | 比例匹配；就近 2K |
| gpt-image-2.5-flare-cf | high | 4K / 16:9 | 3840x2160 | 3840×2160 | 比例匹配；就近 4K |
| gpt-image-2.5-flare-cf | high | 1K / 16:9 | 1360x768 | 1670×942 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 9:16 | 768x1360 | 1088×1445 | 比例偏差；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 4:3 | 1184x880 | 1454×1082 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 3:4 | 880x1184 | 1081×1455 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 3:2 | 1248x832 | 1536×1024 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 2:3 | 832x1248 | 1024×1536 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 5:4 | 1136x912 | 1398×1125 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 4:5 | 912x1136 | 1124×1399 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 21:9 | 1552x672 | 1905×825 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-cf | high | 1K / 9:21 | 672x1552 | 825×1906 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | xhigh | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | max | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 2K / 1:1 | 2048x2048 | 2048×2048 | 比例匹配；就近 2K |
| gpt-image-2.5-flare-yf | high | 4K / 16:9 | 3840x2160 | 3840×2160 | 比例匹配；就近 4K |
| gpt-image-2.5-flare-yf | high | 1K / 16:9 | 1360x768 | 1668×943 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 9:16 | 768x1360 | 1088×1445 | 比例偏差；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 4:3 | 1184x880 | 1454×1082 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 3:4 | 880x1184 | 1081×1455 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 3:2 | 1248x832 | 1536×1024 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 2:3 | 832x1248 | 1024×1536 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 5:4 | 1136x912 | 1399×1124 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 4:5 | 912x1136 | 1124×1399 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 21:9 | 1552x672 | 1905×825 | 比例匹配；就近 1K |
| gpt-image-2.5-flare-yf | high | 1K / 9:21 | 672x1552 | 826×1905 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | xhigh | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | max | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 2K / 1:1 | 2048x2048 | 2048×2048 | 比例匹配；就近 2K |
| gpt-image-2.5-sunburst-cf | high | 4K / 16:9 | 3840x2160 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 16:9 | 1360x768 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 9:16 | 768x1360 | 943×1668 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 4:3 | 1184x880 | 1454×1082 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 3:4 | 880x1184 | 1081×1455 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 3:2 | 1248x832 | 1536×1024 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 2:3 | 832x1248 | 1024×1536 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 5:4 | 1136x912 | 1401×1123 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 4:5 | 912x1136 | 1124×1399 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-cf | high | 1K / 21:9 | 1552x672 | — | 服务错误 502 |
| gpt-image-2.5-sunburst-cf | high | 1K / 9:21 | 672x1552 | — | 服务错误 502 |
| gpt-image-2.5-sunburst-yf | high | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | xhigh | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | max | 1K / 1:1 | 1024x1024 | 1254×1254 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | high | 2K / 1:1 | 2048x2048 | — | 服务错误 502 |
| gpt-image-2.5-sunburst-yf | high | 4K / 16:9 | 3840x2160 | 1672×940 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | high | 1K / 16:9 | 1360x768 | 1672×941 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | high | 1K / 9:16 | 768x1360 | 943×1668 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | high | 1K / 4:3 | 1184x880 | 1454×1082 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | high | 1K / 3:4 | 880x1184 | 1081×1455 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | high | 1K / 3:2 | 1248x832 | 1536×1024 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | high | 1K / 2:3 | 832x1248 | 1024×1536 | 比例匹配；就近 1K |
| gpt-image-2.5-sunburst-yf | high | 1K / 5:4 | 1136x912 | — | 服务错误 502 |
| gpt-image-2.5-sunburst-yf | high | 1K / 4:5 | 912x1136 | — | 服务错误 503 |
| gpt-image-2.5-sunburst-yf | high | 1K / 21:9 | 1552x672 | — | 服务错误 503 |
| gpt-image-2.5-sunburst-yf | high | 1K / 9:21 | 672x1552 | — | 服务错误 502 |

## 判断边界

- 出图成功只确认请求参数可提交，不证明 high / xhigh / max 有三种独立画质，也不认证上游模型身份。
- 502 / 503 / 连接超时记录为服务错误；没有可用兼容账号不等于该质量或比例不支持。未自动重试已提交的测试项。
- 实际尺寸按解码后的原图记录，未做本地放大、裁剪或重新编码。K 档位按与 App 同比例预设的像素距离就近归类，不宣称原生分辨率。
- 比例通过阈值为相对误差 2.5%，允许像素取整；大图比例与多档质量的所有组合没有穷举。

[逐请求参数、像素与扣费记录](chuangxiang-image-verification-2026-09-21.json)。不包含账号、密码、密钥或登录令牌。原始样张与可筛选预览位于项目的 `.codex-temp/chuangxiang-20260921/`。

## 画布接入与交付验证

能力仅应用于 `https://vapi.chuangxiangai.asia` 的“生图”分组和本轮 8 个 GPT 型号，不影响 Grok、其他供应商或智能体连接。保留模型原有操作和价格信息，不因文生图成功额外声明图像编辑已验证。

画布提供有实际尺寸证据的 K 档位、成功提交的高档质量参数。比例选项分别标注“实测比例有偏差”“本轮服务错误”“比例预设”，不把失败或未测组合当成通过。对已知缩水的 4K 以及超出验证范围的参数，在提交前本地拦截；原有节点的已保存参数不会被静默重写。

最终 54 项供应商相关测试、45 项参数及扫描逻辑测试、生产构建、21 项打包桌面检查通过。离线校验确认 120 项请求无重复提交，99 张保存原图的 SHA-256 和解码像素均与记录一致；98 条账单与余额减少完全对上。

用户从系统托盘退出后，已覆盖 `apps/超级画布桌面版` 并重新打开。核对 11,109 个安装文件与打包产物一致；覆盖期间 219 个用户数据文件保持不变，保留 46 个连接、1 个画布、22 个素材、26 条生成记录。配置与程序均先完成了备份。
