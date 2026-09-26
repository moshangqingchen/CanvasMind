# Secure Skill 参考图提交修复 · 2026-09-23

画布此前把 Secure Skill 的 GPT Image 2 / 2.5 参考图请求按通用 OpenAI 协议发送到 `/v1/images/edits`，正文是 multipart 文件。供应商当前文档明确要求 JSON `image` 数组中的公网图片链接。用户在 18:50 左右的三条请求约 0.8 秒内返回 `502 / upstream_error / Upstream request failed`，没有返回任务编号。

修复后仅对 `https://token.secure-skill.com` 的已知 GPT Image 2 / 2.5 型号采用文档中的异步协议：`POST /v1/images/async/generations`，保存 `data.task_id`，通过 `GET /v1/images/async/{taskId}` 查询。参考图片通过已有本机素材通道提供签名链接；未配置通道时在提交前明确提示，只有显式开启临时图床的连接才会使用该选项。其他供应商保留原来的调用协议。

已处理 `PENDING / RUNNING / SUCCESS / FAILED`、恢复后的任务查询和结果提取。缺失任务编号或提交阶段 502 仍保留不确定状态，不自动重发付费请求。供应商明确返回 `system under load / adobe throttled` 时显示“供应商模型当前繁忙，未能完成本次生成，请稍后重试”，技术详情保留原始错误。

## 真实验证

使用用户原提示词、同一张参考图及 `2992x2768 / max` 参数，每个型号各提交一次。Sunburst 在原画布源节点运行；Flare 在“改图修复验证 · Flare”画布运行，没有改变原节点的模型选择。

| 型号 | 供应商任务编号 | 结果 |
| --- | --- | --- |
| gpt-image-2.5-sunburst | img-2db1d95d-3ffe | 已接单，随后明确 FAILED：adobe throttled / status 408 / system under load |
| gpt-image-2.5-flare | img-29fe10b9-ec64 | 已接单，随后明确 FAILED：相同上游繁忙错误 |

这两次验证证明修正后的参考图链路可提交并获得原生任务编号、查询终态；本轮没有成功生成图片，不能宣称完整出图验收通过。没有自动重发。19:25（北京时间）查询供应商账单，余额为 9.118 CNY，记录仍为 9 条，本轮验证开始后没有新增费用记录。

## 本地验证与交付

- 供应商协议、原 OpenAI / REST 兼容性、文档接口、错误展示的定向测试通过。
- 运行服务、参考图通道及桌面提交前检查测试通过，包含本机签名链接进入实际运行请求的回归用例。
- TypeScript 检查和桌面生产构建通过；打包后的 23 项桌面冒烟检查通过。
- 修复已安装到现用 `apps/超级画布桌面版`，通过正常退出流程保存并重启；最终构建 ID 为 `vA4PMjPJhC4f7V8HDE4As`，安装的 11154 个文件逐一核对 SHA-256，安装过程未改变用户数据库。
- 对本轮创建的两条失败记录更新了繁忙提示，保留原始错误和任务编号。之前的三条未知记录没有伪改为已确认失败。

审计文件：`.codex-temp/secure-skill-edit-fix/`。原程序与完整资料备份：`backups/secure-skill-edit-20260923-191458/`；最终提示更新前的第二份备份：`backups/secure-skill-edit-20260923-192345/`。
