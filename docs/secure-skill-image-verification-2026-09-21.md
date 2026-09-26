# secure-skill 图片能力核验 · 2026-09-21

已提交 8 次，成功保存 3 张新原图，本次失败 4 项，尚未提交 20 项。视频生成提交为 0。每个用例最多提交一次，保留请求编号；失败不自动重发。

当前停止原因：banana-全系列 / nano-banana-pro 提交超时，未取得远端任务编号。已核对异步任务、同步记录与账单，暂未出现对应记录；停止后续付费请求，原请求编号 0f44697f-d72e-4874-982e-3c9d4b25a07a，不自动重发。

## 结果

| 分组 | 型号 | 请求档位 / 质量 | 实际像素 | 结果 |
| --- | --- | --- | --- | --- |
| adobe-image2-mid | gpt-image-2 | 4K / 由分组/模型决定 | 3840×2160 | 出图成功，尺寸达标 |
| seedream-5.0-pro图片模型 | seedream-5.0-pro | 2K / 由分组/模型决定 | 2048×2048 | 出图成功，尺寸达标 |
| image-2-1k | gpt-image-2.5-flare | 1K / max | — | 本次失败：{"code":"no_image_output","message":"upstream did not return image output","type":"upstream_error"} |
| image-2-1k | gpt-image-2.5-sunburst | 1K / max | — | 本次失败：{"code":"no_image_output","message":"upstream did not return image output","type":"upstream_error"} |
| flow | gemini-3.0-pro-image | 4K / 由分组/模型决定 | — | 本次失败：{"code":403,"message":"Image generation is not enabled for this group","status":"PERMISSION_DENIED"} |
| flow | nano-banana-2 | 4K / 由分组/模型决定 | — | 本次失败：{"message":"Image generation is not enabled for this group","type":"permission_error"} |
| flow | gemini-3.1-flash-image | 4K / 由分组/模型决定 | — | 跳过：同一分组的 Google 原生与原生图片接口均明确返回 403 未开通图片生成，停止该分组后续提交 |
| flow | gemini-3.1-flash-lite-image | 1K / 由分组/模型决定 | — | 跳过：同一分组的 Google 原生与原生图片接口均明确返回 403 未开通图片生成，停止该分组后续提交 |
| flow | nano-banana-pro | 4K / 由分组/模型决定 | — | 跳过：同一分组的 Google 原生与原生图片接口均明确返回 403 未开通图片生成，停止该分组后续提交 |
| banana-全系列 | nano-banana-2 | 4K / 由分组/模型决定 | 4096×4096 | 出图成功，尺寸达标 |
| banana-全系列 | nano-banana-pro | 4K / 由分组/模型决定 | — | 结果待核对：The operation was aborted due to timeout |
| banana-全系列 | N nano-banana-pro | 4K / 由分组/模型决定 | — | 未提交 |
| banana-全系列 | gemini-3-pro-image-as | 4K / 由分组/模型决定 | — | 未提交 |
| banana-全系列 | gemini-3.0-pro-image | 4K / 由分组/模型决定 | — | 未提交 |
| banana-全系列 | gemini-3.0-pro-image-preview | 4K / 由分组/模型决定 | — | 未提交 |
| banana-全系列 | gemini-3.1-flash-image | 4K / 由分组/模型决定 | — | 未提交 |
| banana-全系列 | gemini-3.1-flash-image-preview | 4K / 由分组/模型决定 | — | 未提交 |
| banana-pro统一价格 | nano-banana-2 | 4K / 由分组/模型决定 | — | 未提交 |
| banana-pro统一价格 | nano-banana-pro | 4K / 由分组/模型决定 | — | 未提交 |
| banana-pro统一价格 | N nano-banana-pro | 4K / 由分组/模型决定 | — | 未提交 |
| banana-pro统一价格 | gemini-3-pro-image-as | 4K / 由分组/模型决定 | — | 未提交 |
| banana-pro统一价格 | gemini-3.0-pro-image | 4K / 由分组/模型决定 | — | 未提交 |
| banana-pro统一价格 | gemini-3.0-pro-image-preview | 4K / 由分组/模型决定 | — | 未提交 |
| banana-pro统一价格 | gemini-3.1-flash-image | 4K / 由分组/模型决定 | — | 未提交 |
| banana-pro统一价格 | gemini-3.1-flash-image-preview | 4K / 由分组/模型决定 | — | 未提交 |
| gpt | gpt-image-2 | 4K / 由分组/模型决定 | — | 未提交 |
| image2-官key | gpt-image-2 | 4K / 由分组/模型决定 | — | 未提交 |
| flow-大户 | gemini-2.5-flash-image | 2K / 由分组/模型决定 | — | 未提交 |
| flow-大户 | gemini-2.5-flash-image | 4K / 由分组/模型决定 | — | 未提交 |
| flow-大户 | gemini-3.1-flash-image | 2K / 由分组/模型决定 | — | 未提交 |
| flow-大户 | gemini-3.1-flash-image | 4K / 由分组/模型决定 | — | 未提交 |

## 费用与证据边界

{
  "newPostedChargesCNY": 0.25,
  "previousPostedChargesCNY": 0.152,
  "totalPostedChargesCNY": 0.402,
  "balanceDisplayedCNY": 9.6,
  "source": "https://token.secure-skill.com/usage",
  "checkedAt": "2026-09-21T12:46:47.481Z",
  "newRows": [
    {
      "group": "adobe-image2-mid",
      "model": "gpt-image-2",
      "amount": 0.05,
      "time": "2026-09-21 20:30:01"
    },
    {
      "group": "seedream-5.0-pro图片模型",
      "model": "seedream-5.0-pro",
      "amount": 0.15,
      "time": "2026-09-21 20:33:50"
    },
    {
      "group": "banana-全系列",
      "model": "nano-banana-2",
      "amount": 0.05,
      "time": "2026-09-21 20:37:10"
    }
  ],
  "notes": "费用按后台明细新增行汇总；失败请求和超时请求暂未出现新增账单。不能把未出现账单作为未受理的证明。"
}

账单页面未展示可直接匹配的请求编号；按分组、型号、完成时间核对的费用属于旁证，未伪标为请求编号级对账通过。质量参数被接受不代表已证明不同质量档的视觉差异。像素达标不证明上游未使用放大处理。

## 取回已有结果

原请求 5e71c4b7-c8ba-4c3f-92b8-63357abe6a12：recovered，1536×1024。新增生成提交 0 次。

## 文档规则

- GPT Image 2：公开接口质量由 Key 分组决定；本轮未发送虚构的质量参数。
- GPT Image 2.5：仅测试文档允许的 1K（1536×1024），质量 max；未测试明确不支持的 2K/4K。
- Seedream 5.0 Pro：文档只支持 1K/2K；本轮测试 2048×2048。
- Banana：按文档的原生异步或 Google 原生协议请求；未把 HTTP 接受当作生成成功。
- 视频和对话分组不提交生成。目录与分组冲突、缺少公开协议的型号不付费猜测。

[供应商文档](https://token.secure-skill.com/docs) · [价格页](https://token.secure-skill.com/pricing) · [完整结果](./secure-skill-verification-2026-09-21/results.json)
