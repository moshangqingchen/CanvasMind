# We-AI 长请求中断修复

2026-09-24。

后续本机故障与验证范围更正见 [本机图片生成连接与等待修复](local-image-connection-fix-2026-09-24.md)。本记录仅描述云端路径；一次成功不能证明所有供应商或本机连接不会中断。

## 根因

We-AI 的 Adobe Image2.5 同步接口可能需要两分钟以上才返回。此前云端工作流虽然设置了 30 分钟的 fetch 和 Workflow 等待时间，但 Worker 的普通 `fetch()` 仍会经过 Cloudflare HTTP 回源代理。该代理默认约 125 秒没有收到上游响应就返回 HTTP 524，应用只能收到 16 字节的 `error code: 524`。本机直连也会在长响应时出现 `UND_ERR_SOCKET`，因此只延长 Node 等待时间不能解决问题。

## 修复

- 为三个官方等价 We-AI 域名在 Cloudflare Workflow 中增加直接 TLS socket HTTP/1.1 传输：`asian-acc.we-token.cc`、`us-la.we-token.cc`、`sub2api.we-token.cc`。
- 只对精确匹配的 We-AI 主机启用该通道；其他供应商继续使用普通 fetch。
- 请求只写入一次，先保存云端任务标记；连接中断、响应截断、超大响应或非法 HTTP 分帧都直接进入不确定状态，不自动重新扣费。
- 传输实现支持分块响应、`Content-Length`、关闭分隔响应、gzip/deflate、信息响应、取消和 AbortSignal；响应下载与供应商图片归档仍走云端存储流程。
- 状态接口保存安全的传输类型和上游请求 ID，绝不保存供应商密钥或 Cookie。

## 实际验证

使用用户连接 Key 998、`gpt-image-2.5-sunburst`、`2880x2880`、`quality=max`、`n=1`，只提交一次：

- 云端任务：`fc147f9ff750d3d5ed12d57a4b57a66133a80dcb2dfd7fcc38a6de03f2b295b1`
- 收到供应商响应头约 121 秒，HTTP 200；云端响应读取/保存阶段约 129 秒，整个流程约 133 秒完成。不能据此声称验证了三分钟无响应。
- 返回 PNG 为 2880×2880、7,363,419 字节，已保存到私有 R2，并在新进程只执行 GET 后再次取回，字节一致。
- 云端状态记录 `transport.kind=direct-tls`，上游返回 `Via: 1.1 Caddy`，未出现 Cloudflare 524。

测试覆盖：直接 TLS 传输 8 项、云端工作流 15 项、Provider 402 项、Runtime 云端 8 项、桌面打包冒烟 23 项均通过。生产 Worker 已部署，桌面生产构建 ID 为 `ZKkxvw9bWUE7kaqX0rhAe`，已覆盖安装到 `apps/超级画布桌面版`；旧目录备份为 `apps/超级画布桌面版-backup-20260924-141800`。
