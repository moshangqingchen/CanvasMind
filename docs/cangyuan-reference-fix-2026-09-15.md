# 沧元参考图未生效：原因、修复与费用

## 已确认原因

沧元 GPT Image 的旧适配将图生图请求作为 JSON 提交到 `/v1/images/generations`，虽然携带 `images` 数组，但本次对照中该入口没有遵循参考图。当前官方文档要求参考图编辑使用 **JSON `POST /v1/images/edits`**，以 HTTPS URL 数组传 `images`，并使用 `GET /v1/images/edits/{task_id}` 轮询。

旧代码曾因 multipart 编辑请求失败而改走 generations；multipart 失败不足以证明 JSON edits 不可用。此前只确认图片下载、输入记录和字段映射正常，没有验证实际编辑入口，因此未找到这个错误。

## 两次真实对照

2026-09-15 北京时间 15:42—15:46，使用用户已保存的沧元 IMAGE 连接、`gpt-image-2.5-sunburst-4k`，参考同一张“蝶”身份卡。两次请求的提示词、参考图、`size=3840x2160`、`quality=medium`、`n=1`、`response_format=url`、`async=true` 完全相同，仅改变提交和轮询入口。

提示词要求保留参考图片的主体、人物、文字、颜色、材质和构图，只将外侧背景改为纯白，没有描述身份卡的内容。

| 调用 | 返回情况 | 目视检查 |
| --- | --- | --- |
| `/v1/images/generations` | 任务 completed | 返回与身份卡无关的人物照片，未遵循参考 |
| `/v1/images/edits` | 任务 completed | 保留透明身份卡、Q 版人物、头盔、文字、绿色装饰，外侧背景变白 |

本次证明当前 Sunburst 4K 的 JSON 编辑入口能够读取这张参考图，并复现了旧入口未遵循参考的问题。其他 GPT Image SKU 按相同的已公布契约修正，没有重新付费遍历所有 SKU；多图数量与顺序已用请求回归检查覆盖。本次未重新生成用户完整的五图场景，不能保证生成模型对所有复杂场景都完全保持人物细节。

原始图片与任务记录保存在 `.codex-temp/cangyuan-reference-ab/`。没有改写用户原参考图、提示词或画布成图，也没有自动重跑历史任务。

## 修复

- 沧元 GPT Image 2、Flare、Sunburst 的参考图操作改为 JSON `/v1/images/edits`。
- 对应异步任务改为 `/v1/images/edits/{taskId}` 轮询。
- 包含这些型号的连接要求可下载的公网参考图 URL，保留输入图片顺序。
- 文生图继续使用 `/v1/images/generations`；不套用到其他独立型号协议。
- 通过应用 API 刷新 IMAGE、全模型-无claude/gpt、IMAGE-备用分组三条保存连接。

## 实际消费

**本次两次对照合计 ￥0.25。**

| 任务 | actual_quota | 实际金额 |
| --- | ---: | ---: |
| 文生图入口对照 `task_NYwz8TDDOTmNcVMqOqhOUVAlegILefrc` | 62500 | ￥0.125 |
| JSON 编辑入口 `task_XIxOHeuPvYHkk6JT5T3JeDblfowhcLyn` | 62500 | ￥0.125 |
| 合计 | 125000 | ￥0.25 |

依据是 `/api/log/token/` 中按 task_id 精确匹配的两条成功结算记录。平台 `quota_per_unit=500000`、`quota_display_type=CNY`，因此 `125000/500000=0.25`。该 Key 为 unlimited_quota，usage/token 的额度值未随请求变化，不能用它推断免费。

先前口头估算误用了 Flare 的 ￥0.095 单价；本次使用的是 Sunburst 4K，实际账单 `model_price=0.125`。本次之后没有继续提交付费请求。连同此前辰途测试 ￥0.407476，本任务所有已记录付费测试累计为 **￥0.657476**。

## 验证

沧元目录与请求测试 27 项通过，扫描协议 17 项及连接隔离 18 项通过，Web 类型检查和生产构建通过。新增用例覆盖 GPT Image 2 及三个系列各 1K/2K/4K，在三个分组内使用多参考 URL 提交、保持图片顺序和轮询 edits 入口。

## 官方依据

- [统一图像接口](https://ai.cangyuansuanli.cn/docs-static/capabilities/image.md)
- [GPT Image 2 4K](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2-4k.json)
- [Sunburst 4K](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-sunburst-4k.json)
- [Flare 4K](https://ai.cangyuansuanli.cn/docs-static/models/gpt-image-2.5-flare-4k.json)
