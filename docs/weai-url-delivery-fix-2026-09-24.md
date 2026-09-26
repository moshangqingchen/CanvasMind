# We-AI Image2.5 结果回传修复与真实验证

2026-09-24 13:26，北京时间。

## 确认的遗漏

用户连接 `1f2d1fd4-b264-43ca-9542-0c8e063fbbcf` 使用 `provider=openai`、We-AI 的 `生图-openai-adobe-image2.5专属` 分组。此前 URL 返回补丁只应用于 `profile=weai`；通用 OpenAI 分支既不读取该分组用于 URL 决策，其字段白名单也会过滤 `response_format`。因此不能把此前“已经固定发送 URL”的结论用于这个实际连接。

修复前新增断言，Flare/Sunburst × 生成/编辑四种情况均失败，实际发出的请求缺少 `response_format`。

## 修复

- 在真实 We-AI 域名和已知 Adobe URL 分组同时匹配时，于 OpenAI 参数过滤之后补入 `response_format=url`，覆盖 JSON 生成和 multipart 编辑，也覆盖通过云端转发的实际请求。
- 保留通用适配器原有的 `quality=max`、尺寸及参考图传输。
- URL 请求仍容纳供应商回退 Base64 的大响应，避免把成功大图限制在 8 MiB 而丢失；现有 8 MiB 图片 / 144 秒分块响应测试覆盖此情形。
- 旧云端任务只查询原编号，没有重新提交历史失败请求。

URL 支持依据：供应商[生图服务介绍](https://docs.we-ai.cc/guides/image-generation-service.html)的 Adobe 章节。URL 减少返回大体积 Base64 的传输步骤；这并不保证供应商今后绝不会超时。

## 真实验证

仅提交一次新的测试请求，使用原连接及 Key 998：`gpt-image-2.5-sunburst`、`2880x2880`、`quality=max`、`n=1`。测试提示词为白底蓝色陶瓷球，不重发用户旧提示词。

- 云端任务：`82c85ccf5d5ad0d48bb1c0eaa7ac015ae94b414789f5818055f4c287c26237f8`。
- 约 130.6 秒收到成功响应，137.0 秒完成本机取回。
- 返回形式确认为 URL，图片已复制到云端私有存储。
- 实际 PNG 解码尺寸为 **2880×2880**，文件 **7,350,011 字节**。
- 另一进程仅执行 GET，再次取回同一云端结果及图片，字节完全一致；未调用供应商生成。云端保留期限为保存完成后 24 小时。
- SHA-256：`e4c4a9faccac4707971b5389d2771818b12ff9438185510de6fe4bd59f8ed27f`。
- 本地验证记录：`.codex-temp/weai-url-verification/attempt.json`；测试图片：`.codex-temp/weai-url-verification/image-0.png`。

这证明修复后的同型号请求成功跨过两分钟并完整取回一次。历史任务 `15ce0c234e0a0794d3df1c1dc705847b8b8a344b1c71461ee01752039329d695` 保存的仍是 16 字节 `error code: 524`，无法据此还原之前生成的图片。

## 回归与安装

- Provider 402 项测试通过；Runtime 云端 8 项测试通过。
- Windows 桌面生产构建和 23 项打包冒烟检查通过。
- 已安装并重启实际目录 `apps/超级画布桌面版`，构建 `kOoOTMaBKMjzSqdpSNeP0`；301 个服务端代码块与新构建逐字节一致。
- 备份为 `apps/超级画布桌面版-backup-20260924-132404`。
- 数据库、存储、本地队列和云端连接健康。画布、素材、连接等内容校验一致；启动恢复查询仅刷新原 524 任务及其节点的 `updatedAt`，状态与其余内容一致。
