# 连接配置支持站点访问令牌

用户需求：在供应商的“连接配置”中，除账号密码外，增加使用后台访问令牌登录的方式。

## 使用方法

在“供应商与模型 → 连接配置”中，将“登录方式”切换为“访问令牌”，填写“站点访问令牌”。部分旧版 NewAPI / OneAPI 需要用户 ID，可填写后台账户资料中的数字 ID；其他站点可以留空。

“仅保存”保存认证配置，不发起目录读取或生成请求。“保存并扫描”沿用原有扫描和能力核验流程，可能提交生成请求，进度与暂停入口仍在“核验记录”。

保存后令牌输入框留空，并显示“已保存，留空保持原令牌”。后续可以直接保存其他配置，也可以单独修改或清除用户 ID。填写新令牌可替换旧令牌；点击“清除已保存登录”后保存，可移除认证信息。切换登录方式、修改连接地址或恢复历史配置时，会按照当前来源重新处理认证信息，避免将旧站点的凭据用于新站点。

站点访问令牌用于读取后台分组、已有 Key、模型价格、余额和消耗。生成请求继续使用对应分组的 API Key。

## 实现范围

- 保留账号密码方式，兼容没有 `authMode` 的旧密码记录，无需迁移已有数据。
- 增加访问令牌方式，通过站点的账号资料接口校验会话。NewAPI / OneAPI 使用 `/api/user/self`，Sub2API 使用 `/api/v1/user/profile`。
- 使用现有主密钥加密令牌，只向界面返回登录方式、是否配置和可选用户 ID；响应、历史配置和错误消息不返回令牌或密文。
- 目录扫描、账务读取、价格补充和核验扣费查询共用按站点绑定的后台会话。认证模式、令牌和用户 ID 变化会隔离价格缓存，旧请求的扫描和账务结果不能覆盖新配置。
- 根据令牌无效、权限不足、缺少用户 ID、限流或站点不可达显示可处理的提示。
- 补齐 NewAPI `/api/log/self/stat` 今日统计接口的会话认证，密码与令牌方式均适用。该接口的请求路径和参数受限，站点是否允许读取由其接口权限决定。

兼容依据：[NewAPI 当前认证说明](https://github.com/QuantumNous/new-api/blob/main/docs/authentication.md)、[旧版 NewAPI 认证实现](https://github.com/QuantumNous/new-api/blob/v0.10.3/middleware/auth.go)、[OneAPI 用户模型](https://github.com/songquanpeng/one-api/blob/main/model/user.go)、[Sub2API 认证中间件](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/server/middleware/jwt_auth.go)。

## 验证

使用模拟账号和令牌完成验证，不使用用户截图中的真实令牌，也不向真实供应商提交生成请求。

- Providers 全套单元测试：524 / 524，通过。其中站点登录测试 48 项，包含令牌与两种密码会话的真实今日账务 URL 读取，以及错误和跨站认证边界。
- Renderer 全套单元测试：1,539 / 1,539，通过。包含 API 响应隐藏秘密、旧密码兼容、令牌加密、两种方式切换、来源变化、过期扫描与账务结果丢弃、价格缓存隔离。
- 供应商界面回归：22 / 22，通过。其中新增 6 项访问令牌用例，覆盖保存扫描、留空保留、替换与清除、用户 ID 单独编辑、格式校验、弃改和更换来源。
- TypeScript、修改文件的 ESLint、差异检查，以及完整生产构建通过。

Windows 界面回归在独立端口和临时数据目录运行。生命周期预加载参数中的路径使用正斜杠，避免 `NODE_OPTIONS` 对反斜杠的转义影响：

```powershell
$env:PLAYWRIGHT_PORT = '3213'
$env:NODE_OPTIONS = '--require "D:/project development/超级画布/apps/desktop/src/runtime-hook.cjs"'
node node_modules/@playwright/test/cli.js test e2e/suppliers.spec.ts --max-failures=1
```

以上命令在 `apps/desktop/renderer` 中执行，运行前先完成生产构建。

桌面检查版已重新构建、打包并通过 `verify-release.mjs --unpacked`。打包版本冒烟检查 23 / 23 通过，包括正常退出保存画布、数据库落盘、后台退出和重新启动保留数据。检查版使用 `apps/desktop/release/win-unpacked/SuperCanvas.exe`，版本为当前项目的 0.2.44。已精确启动该检查版，并在实际程序的“沧元算力 → 连接配置”中确认新增“登录方式”字段；现有登录方式仍保留为账号密码，等待用户填写自己的访问令牌。
