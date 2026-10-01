# 辰途 Sunburst HTTP 502 检测记录

检测时间：2026-10-01 08:10—08:16（北京时间）。

## 结论

这次画布请求收到辰途远端 Nginx 返回的 HTTP 502。当前保存的 API Key 能正常读取模型，Sunburst 仍在该 Key 的可用列表内；图片能力接口和模型状态页则返回 502。证据指向辰途图片服务的网关或后端线路异常。具体后端故障需要辰途服务端日志确认。

## 对应失败任务

- 工作流任务：`匿名示例-工作流-001`（公开文档已替换本机任务编号）。
- 节点任务：`匿名示例-节点-001`（对应上述工作流，公开文档已替换本机节点编号）。
- 开始时间：2026-10-01 08:09:48；失败状态写入时间：08:09:51。
- 连接：辰途 API · image2.5全参 · 画布。
- 模型：`gpt-image-2.5-sunburst`。
- 操作：`image.edit`，一张参考图。
- 参数：`size=3840x2160`，`quality=max`。
- 保存的地址：`https://tu.988236.xyz/v1`；该编辑操作使用 multipart `POST /v1/images/edits`。
- 请求耗时：2,129 毫秒；网络路径：`physical-direct`。
- 响应：HTTP 502，166 字节 HTML，正文含 `502 Bad Gateway` 和 `nginx/1.18.0 (Ubuntu)`。
- 无供应商任务 ID，运行状态为 `needs_attention`。

同日 07:17，同一连接及相同模型、尺寸、质量也返回相同 Nginx 502。07:19 辰途“低价Adobe生图”的 `gpt-image-2-4k` 编辑请求两次返回相同 502，耗时约 1.6—2.5 秒。因此，这组证据不支持“生成等太久导致本地超时”的解释，也未出现参数或内容被拒绝的响应。

前一天 2026-09-30 10:50，同一 image2.5全参连接的 Sunburst、`quality=max`、`size=2496x3312` 编辑成功。该历史成功不能保证今天服务可用，也不代表本次横图组合已经重新实测。

## 现场只读接口检测

| 接口 | 鉴权 | 结果 |
| --- | --- | --- |
| `GET /v1/models` | 当前 image2.5全参连接的已保存 Key | 200，约 560 毫秒，返回 `gpt-image-2.5-flare` 与 `gpt-image-2.5-sunburst` |
| `GET /v1/image/model-capabilities` | 同一 Key | 502，约 3,609 毫秒，Nginx HTML 错误页 |
| `GET /api/pricing` | 公开接口 | 200，模型广场仍列出 image2.5全参分组下的 Sunburst |
| `GET /docs/api-media.zh-CN.md` | 公开接口 | 200，当前文档仍说明同步图生图使用 `/v1/images/edits` |
| `GET /model-status/` | 公开页面 | 502，Nginx HTML 错误页 |

页面和鉴权接口可用，而部分图片相关接口异常；不能据此断言整个辰途网站宕机。未重新提交生成请求，未测试本次图生图是否已经恢复，也未核实这次失败的结算情况。

## 本地代码核对

- `packages/providers/src/http.ts` 保留远端 HTTP 状态及响应正文。
- `packages/providers/src/error-presentation.ts` 将 502 翻译为截图中的上游服务错误提示。
- `packages/providers/src/openai.ts` 对辰途保留模型 ID，参考图编辑使用 multipart；画布内部 `size_tier` 不作为图片 API 参数发送。
- `packages/runtime/src/service.ts` 对可能已受理的提交进入 `needs_attention`，避免自动重复提交。

本轮没有修改程序、连接配置或画布，也没有发起收费生成。

## 后续处理

先核对辰途任务与扣费记录，再在服务恢复后手动重试。若需要立即完成，可参考已有运行记录：2026-10-01 07:34，同一画布节点通过“MikotoPro · 生图（2k4k 高质量） · 画布”的 Sunburst 成功，参数为 `size=3360x2464`、`quality=max`。这是一条历史成功记录，尚未验证该渠道当前状态；本轮未自动切换供应商或重新运行节点。

原始运行证据来自本机桌面版数据文件，仅摘录诊断必要字段，未写入凭据。
