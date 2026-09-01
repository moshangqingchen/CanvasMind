# 自托管与运维

本文面向单机 Docker 自托管。应用提供一个可选的共享单账号登录，但没有多用户和租户隔离：未配置登录时只能放在可信本机，配置后也只适合个人自用，不是面向多人的生产模板。

## 服务与持久化边界

| 服务                     | 职责                                                    | 是否必须备份                  |
| ------------------------ | ------------------------------------------------------- | ----------------------------- |
| `web`                    | UI、HTTP API、SSE、上传签名                             | 否，可从镜像重建              |
| `worker`                 | DAG 执行、Provider 调用、轮询和输出归档                 | 否，可从镜像重建              |
| `postgres`               | 画布、revision、素材索引、连接密文、运行和 Webhook 事件 | 是                            |
| `redis`                  | BullMQ 调度                                             | 否，PostgreSQL 是运行状态真相 |
| `minio`                  | 原始素材和归档后的生成结果                              | 是                            |
| `.env` 中的 `MASTER_KEY` | 解密 Provider API Key                                   | 是，且应与数据备份分开保管    |

只恢复 PostgreSQL 而不恢复 MinIO，会得到指向缺失对象的素材记录；只恢复 MinIO 而不恢复 PostgreSQL，则对象无法从素材库访问。两者必须作为同一个备份集保存。

## 配置参考

应用读取以下环境变量：

| 变量                           | 默认行为                                        | 说明                                                                    |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`                 | Compose 必填；开发模式可留空                    | PostgreSQL 连接串；Compose 内使用 `postgres` 主机名                     |
| `USE_MEMORY_STORE`             | 默认使用持久化本地 JSON；`ephemeral` 才只存内存 | Compose/PostgreSQL 部署必须为 `false`                                   |
| `REDIS_URL`                    | Compose 必填；开发模式可留空                    | Redis 连接串，通常为 `redis://:密码@redis:6379`                         |
| `RUN_IN_PROCESS`               | 除非精确为 `false`，否则在 Web 进程执行         | 独立 Worker 模式必须为 `false`                                          |
| `WORKER_CONCURRENCY`           | `2`                                             | 单个 Worker 并发任务数                                                  |
| `S3_ENDPOINT`                  | 未设置时使用本地文件                            | Worker/Web 可访问的 S3 或 MinIO endpoint                                |
| `S3_PUBLIC_ENDPOINT`           | 与 `S3_ENDPOINT` 相同                           | 浏览器可访问的预签名上传 endpoint                                       |
| `S3_REGION`                    | `us-east-1`                                     | S3 region                                                               |
| `S3_ACCESS_KEY`                | 未设置时使用 SDK fallback（仅开发）             | S3 access key；Compose 使用 MinIO app user                              |
| `S3_SECRET_KEY`                | 未设置时使用 SDK fallback（仅开发）             | S3 secret key；Compose 使用 MinIO app password                          |
| `S3_BUCKET`                    | `supercanvas`                                   | 素材 bucket                                                             |
| `S3_FORCE_PATH_STYLE`          | 除非精确为 `false`，否则开启                    | MinIO 通常需要 `true`                                                   |
| `LOCAL_STORAGE_PATH`           | 当前进程目录下的 `storage`                      | 仅在未设置 `S3_ENDPOINT` 时使用                                         |
| `MASTER_KEY`                   | Compose 必填；开发模式可留空                    | 生产环境必填；Web 和 Worker 必须完全一致                                |
| `POSTGRES_PASSWORD`            | 无默认值，Compose 必填                          | PostgreSQL 密码                                                         |
| `REDIS_PASSWORD`               | 无默认值，Compose 必填                          | Redis AUTH 密码                                                         |
| `MINIO_ROOT_USER`              | 无默认值，Compose 仅供 MinIO/init 使用          | MinIO 管理员账号，不给 Web/Worker 使用                                  |
| `MINIO_ROOT_PASSWORD`          | 无默认值，Compose 仅供 MinIO/init 使用          | MinIO 管理员密码，不给 Web/Worker 使用                                  |
| `MINIO_APP_USER`               | 无默认值，Compose 必填                          | 受限 bucket 读写账号                                                    |
| `MINIO_APP_PASSWORD`           | 无默认值，Compose 必填                          | 受限 bucket 读写密码                                                    |
| `PUBLIC_BASE_URL`              | 空，公网素材/Webhook 入口关闭                   | 用于供应商参考素材公网 URL、Origin/CORS 校验；配置后才启用 Webhook 路由 |
| `NEXT_PUBLIC_APP_NAME`         | `超级画布`                                      | Docker 构建时写入前端的应用名称                                         |
| `NEXT_PUBLIC_DIRECTOR_ENABLED` | 启用；仅精确的 `false` 会关闭                   | 前端构建开关；变更后必须重新构建 Web                                    |
| `WEAI_DIRECT_LOCAL_ADDRESS`    | 空                                              | 可选的 We-AI 专用直连 IPv4；Compose 内须属于容器网卡                    |
| `WEAI_DIRECT_DNS_SERVERS`      | `223.5.5.5,119.29.29.29`                        | We-AI 专用直连解析器的 DNS 列表                                         |

单账号登录相关变量（三者必须同时非空才会启用）：

| 变量                                     | 默认行为       | 说明                                           |
| ---------------------------------------- | -------------- | ---------------------------------------------- |
| `SUPERCANVAS_PUBLIC_AUTH_USER`           | 空，登录关闭   | 登录用户名                                     |
| `SUPERCANVAS_PUBLIC_AUTH_PASSWORD`       | 空，登录关闭   | 登录密码                                       |
| `SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN`  | 空，登录关闭   | 会话 Cookie 的值；改动即让所有已登录设备失效   |
| `SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK` | 回环地址免登录 | 设为 `false` 时本机访问也要求登录              |
| `SUPERCANVAS_PUBLIC_AUTH_TRUSTED_HOSTS`  | 空             | 逗号分隔的额外免登录主机名，仅用于可信内网机器 |

启用后，**除回环和上述可信主机外的所有主机名**都需要有效会话。`/api/public-auth/*`（登录本身）、`/api/webhooks/*`（Provider 回调，自带 HMAC 校验）、`/api/provider-assets/*`（带时效 token 的供应商参考素材）和 `/_next/*` 静态资源保持公开。登录失败按来源 IP 限流（15 分钟 8 次），另有全局阈值抵挡分布式撞库；限流状态保存在 Web 进程内存中，因此只对单个 Web 容器有效。

> 反向代理若把 `Host` 改写成 `localhost`，回环豁免会绕过整个登录。这类部署必须设置 `SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK=false`，或配置代理透传原始 `Host`。

`.env.example` 供本机配置参考。复制后必须填写 Compose 所需的非空密码和连接串；Compose 不再提供任何默认密码。`DATABASE_URL`、`REDIS_URL` 可按部署网络自定义，URL 中的特殊字符必须进行 URL 编码。MinIO root 凭据只用于 `minio-init` 创建 bucket、CORS 和受限 app policy；该 policy 仅允许目标 bucket 的列举、读、写和删除对象，Web/Worker 只使用 `MINIO_APP_USER` / `MINIO_APP_PASSWORD`。真实 Provider 密钥必须通过 UI 的“设置”加密保存，不能放进普通环境变量或 Connector JSON。

`USE_MEMORY_STORE` 是保留至今的兼容变量名：留空或设为 `true` 都会使用 `LOCAL_DATABASE_PATH` 指向的本地 JSON 文件，并非易失内存；只有测试隔离场景应使用 `ephemeral`。当它为 `false` 且提供 `DATABASE_URL` 时才使用 PostgreSQL。

`WEAI_DIRECT_LOCAL_ADDRESS` 会被同时传给 Web 和 Worker。原生 Windows 运行时可填写物理网卡地址；Docker 容器不能绑定宿主机专属地址，因此 Compose 部署通常应留空，除非填入的地址确实分配在容器网络接口上。

## 超级导演配置与审批边界

超级导演默认启用。`NEXT_PUBLIC_DIRECTOR_ENABLED` 会被 Next.js 写入浏览器 bundle；变量缺省或为任何非 `false` 值时都启用，只有在 Web **构建阶段**精确设置为 `false` 才关闭。仅修改已经构建好的容器运行时环境不会改变前端开关；变更后应重新构建镜像。仓库提供的默认镜像构建启用超级导演。

部署完成后，在 UI 中分两步配置：

1. 在“设置 → 导演大脑”直接新建独立导演连接并加密保存 Key，也可选择已有的 `usage: agent` 连接。导演大脑支持 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages / Claude、xAI Responses / Grok、Google Gemini `generateContent` 和通用 OpenAI-compatible 协议。不要复用用途为画布生成的连接冒充导演连接。
2. 在“设置 → 导演大脑”固定连接、模型 ID、协议和实际能力。可选的 Tavily 研究连接同样从已加密保存的连接中选择；其名称或供应商标识需要包含 `Tavily` 才会出现在选择框中。模型支持原生搜索时优先使用原生搜索，否则使用 Tavily 降级。

`director_profile` 只保存上述连接 ID、模型和导演能力配置；API Key 仍只存在于供应商连接密文中，浏览器不会收到明文。Web 与 Worker 必须继续使用相同的 `MASTER_KEY`。导演会话、消息、版本化方案、报价、审批状态和关联 run 存在本地 JSON 或 PostgreSQL 中，因此数据库备份也包含导演历史；外部研究来源仅保存 URL、抓取时间、证据等级和有限摘录。

导演的连接访问遵守以下边界：

- 保存导演配置不会改写供应商连接的 Key、Base URL、默认模型、Connector 或模型目录。
- 为比价进行的能力/目录探测是只读的；需要扫描供应商时使用非持久化模式，不会把扫描结果写回连接。只有用户在“供应商与密钥”中执行编辑、测试或刷新目录时，才允许更新供应商连接。
- 导演配置和比价不会调用图片或视频生成端点。发送自然语言请求会调用固定导演大脑，并可能调用原生搜索或 Tavily，因此可能产生文本 token/搜索费用；它不构成媒体生成授权。

所有图片、视频等媒体生成调用必须经过方案确认。`POST /api/director/turn` 只生成理解、研究、规划和报价事件；待确认节点只在浏览器中以幽灵状态预览。确认卡会列出每次调用的供应商、连接、模型、参数、数量、输入输出、原币价格、人民币估算、价格来源时间、最高总费用和候选排除原因。只有带正确 proposal 版本和预期 canvas revision 的审批请求通过服务端复核后，才会一次保存画布并创建 `selection` run。

方案默认 15 分钟过期。供应商、模型、参数、数量、价格或画布 revision 变化都会使旧确认失效；价格上涨时服务端生成新版报价，必须再次确认。系统不得自动付费重试或切换付费备用模型；远端是否已收到请求无法确定时沿用 `needs_attention`，管理员应先去供应商控制台核对，不能直接重提。取消待确认方案不会写画布或发起媒体生成调用。

### 导演知识快照

运行时读取镜像/仓库内的 `packages/director/knowledge`，不会访问维护者机器上的外部“超级导演”工作目录。应在构建和发布镜像前完成知识同步并把快照纳入代码审核：

```powershell
pnpm director:sync -- --source "D:\path\to\超级导演"
```

同步默认拒绝 dirty 源，包括首次导入。只有维护者已经审核并明确接受未提交内容时，才可覆盖：

```powershell
pnpm director:sync -- --source "D:\path\to\超级导演" --allow-dirty
```

`packages/director/knowledge/manifest.json` 会记录源路径、源 commit、`dirty`、同步时间、整体 `contentHash`，以及 Skill、路由表和参考资料的逐文件 SHA-256。使用 `--allow-dirty` 不会掩盖状态，清单仍明确记录 `dirty: true`。发布检查应确认源 commit、dirty 标记、内容哈希和知识 diff 都符合预期；后续同步仍默认拒绝 dirty 源。不要在运行中的容器里临时挂载外部知识目录替换快照，否则版本化 proposal 的 `knowledgeVersion` 将失去可追溯性。

## 首次部署

复制 `.env.example` 后，先为 PostgreSQL、Redis、MinIO root/app 和应用主密钥生成不同的随机值。MinIO root/app 用户必须不同，两个 MinIO 密码至少 8 个字符。密码不要使用示例值；URL 中的密码部分要进行 URL 编码：

```powershell
Copy-Item .env.example .env
node -e "console.log('base64:' + require('node:crypto').randomBytes(32).toString('base64'))"
```

把命令输出写入 `.env` 的 `MASTER_KEY`，并至少填写以下变量：

```dotenv
MASTER_KEY=base64:这里是命令输出的Base64内容
POSTGRES_PASSWORD=替换为随机密码
REDIS_PASSWORD=替换为随机密码
MINIO_ROOT_USER=替换为管理员用户名
MINIO_ROOT_PASSWORD=替换为随机管理员密码
MINIO_APP_USER=替换为应用用户名
MINIO_APP_PASSWORD=替换为随机应用密码
DATABASE_URL=postgres://supercanvas:替换为URL编码后的密码@postgres:5432/supercanvas
REDIS_URL=redis://:替换为URL编码后的密码@redis:6379
```

如果使用非默认数据库用户名/名称，必须同步修改 `DATABASE_URL`；如果使用不同 Redis 主机或 TLS，也直接覆盖 `REDIS_URL`。`POSTGRES_PASSWORD` 和 `REDIS_PASSWORD` 仍用于启动相应服务。

然后启动：

```powershell
docker compose up -d --build
docker compose ps
```

第一次打开设置页前，确认 Web 和 Worker 都收到了同一个主密钥：

```powershell
docker compose config
docker compose logs --tail 100 web worker
```

不要把 `docker compose config` 输出粘贴到工单或聊天中，它可能包含凭据。

Compose 顶层项目名固定为 `supercanvas`，避免从中文目录名推导出不一致的容器和卷前缀。已有部署若曾使用其他项目名，应在首次升级前通过 `COMPOSE_PROJECT_NAME=旧项目名` 或 `docker compose -p 旧项目名` 继续引用原卷，确认数据迁移后再切换；命令行 `-p` 的优先级高于文件中的默认名。

## 本地持久化开发

## Windows 独立部署与 GitHub Release 更新

Windows 本地发布模式使用独立版本目录，避免更新覆盖开发仓库和本地业务数据。完成依赖安装后，
在开发仓库中运行：

```powershell
pnpm public:install
pnpm public:start:installed
```

`public:install` 从 `SUPERCANVAS_UPDATE_REPOSITORY` 的 GitHub Releases 中选择最新的稳定
`vX.Y.Z`，校验 Release 压缩包和 SHA-256 清单后安装到
`%LOCALAPPDATA%\SuperCanvas\releases`。画布 JSON、素材、密钥和环境文件保存在该目录之外。

发布前必须同步根目录 `package.json` 的 `version` 与 Release 标签，例如 `0.2.0` 对应 `v0.2.0`。
`.github/workflows/release.yml` 会在 Windows runner 上构建并上传运行包；普通分支 push 不会触发
本地升级。

运行中的画布会在启动时和默认每 10 分钟检查一次更新。项目菜单中的“应用更新”显示 GitHub
Release 正文，下载可以后台进行；应用阶段会等待生成任务排空，候选版本健康检查失败则自动恢复
旧版本。检查、下载和切换过程记录在 `%LOCALAPPDATA%\SuperCanvas\logs`，不会记录 GitHub Token。

公开仓库无需 Token；如使用私有仓库，可在本地环境文件中设置
`SUPERCANVAS_GITHUB_TOKEN`，不要把它提交到 Git。

如果需要热更新，同时使用 Docker 中的 PostgreSQL、Redis 和 MinIO，请显式加载只绑定回环地址的开发 override：

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis minio minio-init
```

在第一个 PowerShell 中运行 Web：

```powershell
$env:DATABASE_URL='postgres://supercanvas:替换为URL编码后的密码@localhost:5432/supercanvas'
$env:USE_MEMORY_STORE='false'
$env:REDIS_URL='redis://:替换为URL编码后的Redis密码@localhost:6379'
$env:RUN_IN_PROCESS='false'
$env:S3_ENDPOINT='http://localhost:9000'
$env:S3_PUBLIC_ENDPOINT='http://localhost:9000'
$env:S3_ACCESS_KEY='替换为MINIO_APP_USER'
$env:S3_SECRET_KEY='替换为MINIO_APP_PASSWORD'
$env:S3_BUCKET='supercanvas'
$env:MASTER_KEY='base64:替换为同一主密钥'
pnpm db:migrate
pnpm dev
```

在第二个 PowerShell 中为 Worker 设置相同的 `DATABASE_URL`、`USE_MEMORY_STORE`、`REDIS_URL`、`RUN_IN_PROCESS`、S3 变量和 `MASTER_KEY`，然后运行：

```powershell
pnpm dev:worker
```

根目录 `.env` 不会自动注入 `pnpm dev:worker`；必须由 shell、进程管理器或秘密管理服务显式注入。

## 网络与安全

### 当前必须遵守的边界

- 默认只将 `3000`、`9000`、`9001` 发布到 `127.0.0.1`；PostgreSQL 和 Redis 不发布宿主端口。`docker-compose.dev.yml` 也只把开发端口绑定到回环地址。
- Compose 不包含默认 PostgreSQL、Redis 或 MinIO 密码。`minio` 仅持有 root 凭据，`minio-init` 使用 root 创建 bucket/CORS/受限 policy；`web` 和 `worker` 只持有 app user 凭据。更换任一凭据时要同步更新 `.env`，并按轮换流程更新 MinIO app user。
- Redis 启用 AUTH；`REDIS_URL` 必须包含密码（或由外部受控 URL 提供认证），健康检查也使用认证连接。
- Compose 镜像使用固定版本 tag；升级前应显式审核 tag、运行测试并完成 PostgreSQL/MinIO 备份。
- 不配置 `SUPERCANVAS_PUBLIC_AUTH_*` 时应用没有任何身份验证。要在本机以外访问，必须先按上文启用单账号登录；它会保护页面、全部 `/api/*` 和 SSE 路由，只放行登录接口、带时效 token 的 `/api/provider-assets/*` 和自带验签的 Webhook。
- 登录只有一个共享账号，没有多用户隔离和审计。即使外层已有 HTTPS，也不要在多人或不可信网络开放。
- 反向代理必须透传原始 `Host`；若代理把 `Host` 改写为 `localhost`，请同时设置 `SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK=false`，否则回环豁免会绕过登录。
- MinIO Console (`9001`)、S3 API (`9000`)、PostgreSQL (`5432`) 和 Redis (`6379`) 不应经过公网反向代理。

轮换 MinIO app 密码时，先停止 `web`/`worker`。下面的临时容器会从 Compose 已解析的 `.env` 取得旧 root/app 凭据，不依赖 PowerShell 的 `$env:*`（Compose 读取 `.env` 并不会把变量导入当前 shell）：

```powershell
docker compose stop web worker
docker compose run --rm --entrypoint sh minio-init -lc 'mc alias set minio-admin http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc admin user remove minio-admin "$MINIO_APP_USER"'
# 此时更新 .env 中的 MINIO_APP_USER/MINIO_APP_PASSWORD，再继续
docker compose run --rm minio-init
docker compose up -d web worker
```

### 主密钥与 Provider Key

- 首次保存 Provider 连接前生成随机 `MASTER_KEY`，让 Web 和 Worker 使用同一个值。
- 更换或丢失 `MASTER_KEY` 会导致数据库中的现有 API Key 无法解密。轮换流程应先通过 UI 覆盖所有连接密钥，再淘汰旧密钥。
- `.env`、备份、`docker compose config` 输出和进程环境都应按密钥材料保护。
- UI 返回的密钥只是掩码；画布、普通数据库字段和 BullMQ payload 不应包含明文 Key。

### 素材与上传

- 预签名直传上限为 2 GB，有效期 10 分钟；预签名响应中的 upload intent token 绑定素材 ID、对象键、声明大小和规范化 MIME，确认接口会验证 token、对象 HEAD 元数据及文件头；代理上传上限为 500 MB。允许的媒体类型为图片 PNG/JPEG/WebP/GIF、视频 MP4/MOV/WebM，以及音频 MP3/WAV/M4A，并会校验文件头；不接受 SVG 或允许清单之外的任意媒体 MIME。
- 当前没有病毒扫描。不能把上传接口开放给不可信用户。
- `S3_PUBLIC_ENDPOINT` 必须能从浏览器访问；`S3_ENDPOINT` 必须能从 Web/Worker 访问。二者可以不同。
- `infra/minio/cors.xml` 只允许 `http://localhost:3000` 和 `http://localhost:3210`。使用其他可信 origin 时要更新 CORS；不要配置通配符 origin。

### Webhook

`POST /api/webhooks/:provider/:connectionId` 仅在配置 `PUBLIC_BASE_URL` 后启用，并且会先调用 Adapter 验签、再登记去重事件。当前内置 OpenAI、We-AI、Runway 和 Fake Adapter 未实现 `verifyWebhook`，因此仍依赖轮询；只有通用 REST Connector 支持声明式 HMAC-SHA256 验签，密钥使用连接的加密 `apiKey`，不会写入 Connector JSON。示例配置：

```json
{
  "webhook": {
    "signatureHeader": "x-signature",
    "signaturePrefix": "sha256=",
    "taskIdPath": "$.id",
    "statusPath": "$.status",
    "errorPath": "$.error",
    "progressPath": "$.progress"
  }
}
```

供应商应对原始请求体计算 HMAC-SHA256，并把十六进制或 Base64 摘要放在配置的请求头中。事件按 `provider + connectionId + externalId` 去重；未配置 `PUBLIC_BASE_URL` 返回 `404`，Adapter 不支持验签返回 `501`，验签或载荷处理失败返回 `401`，当前任务完成通知依赖轮询。

公网部署至少还需要：单用户认证、HTTPS、CSRF/Origin 策略、请求速率限制、Webhook 原始 body 验签、审计日志和秘密管理。完成这些工作之前，反向代理不应提供公网访问。

## 通用 REST Connector

以下是设置面板默认配置的精简版本：

```json
{
  "auth": { "type": "bearer" },
  "allowedHosts": ["api.example.com"],
  "submit": {
    "path": "/generate",
    "method": "POST",
    "bodyMode": "json",
    "template": {},
    "mappings": [
      {
        "source": { "kind": "request", "path": "$.prompt" },
        "target": "/prompt"
      }
    ],
    "response": {
      "taskIdPath": "$.id",
      "statusPath": "$.status"
    }
  },
  "poll": {
    "path": "/tasks/{taskId}",
    "method": "GET",
    "bodyMode": "none",
    "response": { "statusPath": "$.status" }
  },
  "statusMap": {
    "queued": "queued",
    "running": "running",
    "completed": "succeeded",
    "failed": "failed",
    "cancelled": "cancelled"
  },
  "output": {
    "path": "$.output",
    "kind": "image",
    "defaultMimeType": "image/png"
  }
}
```

配置要点：

- Base URL 在设置页单独填写，例如 `https://api.example.com`。
- `auth.type` 可为 `none`、`bearer` 或 `header`；`header` 可配 `headerName` 和 `prefix`。
- `bodyMode` 可为 `none`、`json`、`multipart`。multipart 映射到素材对象时会上传二进制，有 URL 时则传 URL 字符串。
- `source.kind` 可为 `request`、`task` 或 `literal`；`target` 必须是 JSON Pointer。
- `submit.response` 可提取 `taskIdPath`、`statusPath`、`errorPath`、`progressPath`。没有任务 ID 时按同步成功处理。
- `output.path` 可指向一个值或数组；对象输出可继续配置 `urlPath`、`base64Path`、`mimeTypePath`、`filenamePath`。
- JSONPath 仅支持 `$.field`、`$['field']`、`$[0]` 和 `*`。过滤器、脚本、切片、union 和递归下降均被拒绝。

安全要求：

- `allowedHosts` 使用精确 hostname，不要把用户输入插入路径或 host。
- 默认只允许 HTTPS；除本机受控服务外不要开启 `allowInsecureHttp`。
- Connector 会拒绝 URL 内嵌凭据和跨 origin 重定向，但它不是完整的公网 SSRF 防护。公网场景仍需阻断环回、链路本地、内网和云元数据地址，并处理 DNS rebinding。
- 只有远端文档明确承诺按 `Idempotency-Key` 去重时才设置 `submit.idempotent: true`。错误配置可能导致重复扣费。

## 健康检查与故障定位

基础状态：

```powershell
docker compose ps
docker compose exec web node -e "const t=process.env.SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN||'';fetch('http://127.0.0.1:3000/api/health',{headers:t?{cookie:'super_canvas_session='+t}:{}}).then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})"
docker compose exec postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose exec redis sh -lc 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" ping'
Invoke-WebRequest http://localhost:9000/minio/health/live -UseBasicParsing
```

`/api/health` 会访问 PostgreSQL 和对象存储并返回默认画布 ID，同时附带按供应商聚合的模型扫描状态和最近检查时间（不包含密钥）。Web 的 Compose 探针与上面的容器内命令会在配置登录时携带会话 Cookie，因此 `SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK=false` 不会让容器误报 401；探针没有额外的免鉴权入口。宿主机直接请求该 URL 时仍应按正常登录策略返回 401。Compose 另有 PostgreSQL、Redis、MinIO 健康检查；Worker 进程退出由 `restart: unless-stopped` 处理。外部 Provider 仍应单独监控。

日志：

```powershell
docker compose logs --tail 200 web
docker compose logs --tail 200 worker
docker compose logs --tail 100 postgres redis minio
```

常见问题：

| 现象                       | 检查项                                                          |
| -------------------------- | --------------------------------------------------------------- |
| 上传 URL 无法访问          | `S3_PUBLIC_ENDPOINT`、MinIO CORS、浏览器是否能访问 9000         |
| 任务一直 queued            | Worker 是否启动、Redis 是否 `PONG`、Web/Worker 的数据库是否相同 |
| Provider Key 无法解密      | Web/Worker 的 `MASTER_KEY` 是否与保存连接时一致                 |
| Runway 图生视频预检失败    | 图片是否可从对象存储读取、格式/大小是否符合供应商限制           |
| 运行进入 `needs_attention` | 提交响应可能丢失；先去供应商控制台核对任务，禁止直接重复提交    |
| 结果生成但节点未成功       | 查看 `archiving` 错误，并检查 MinIO 容量、凭据和网络            |

## 备份

推荐在没有新任务提交的维护窗口执行一致性备份。以下命令复用 Compose 的 `minio-init` 镜像，不要求主机另装 MinIO Client，也不会假设 `.env` 已加载到 PowerShell：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path (Get-Location) "backups\$stamp"
New-Item -ItemType Directory -Force $backupDir | Out-Null

docker compose stop web worker
docker compose exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/supercanvas.dump'
docker compose cp postgres:/tmp/supercanvas.dump "$backupDir\postgres.dump"

docker compose run --rm --entrypoint sh --volume "${backupDir}:/backup" minio-init -lc 'mc alias set supercanvas http://minio:9000 "$MINIO_APP_USER" "$MINIO_APP_PASSWORD" && mc mirror --overwrite "supercanvas/$MINIO_BUCKET" /backup/minio-bucket'

Copy-Item .env "$backupDir\deployment.env"
docker compose start web worker
```

把 `deployment.env` 移到与数据库/对象备份分离的加密秘密存储中；它包含解密 Provider Key 所需的主密钥。若修改了 Compose 中的数据库或 MinIO 凭据，也要安全保存对应部署配置。

至少定期验证：

- `postgres.dump` 能被 `pg_restore --list` 读取。
- `minio-bucket` 的对象数量和容量与源 bucket 大致一致。
- 在隔离环境完成一次完整恢复，并能打开旧画布、读取旧素材和解密一次测试连接。

## 恢复

先恢复正确的 `.env` / `MASTER_KEY`，再启动基础服务。恢复会覆盖目标数据库和 bucket 中同名内容，应在隔离环境先演练。

```powershell
$restoreDir = (Resolve-Path "backups\目标备份").Path
Copy-Item "$restoreDir\deployment.env" .env
docker compose up -d postgres redis minio minio-init
docker compose stop web worker

docker compose cp "$restoreDir\postgres.dump" postgres:/tmp/supercanvas.dump
docker compose exec -T postgres sh -lc 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/supercanvas.dump'

docker compose run --rm --entrypoint sh --volume "${restoreDir}:/backup:ro" minio-init -lc 'mc alias set supercanvas http://minio:9000 "$MINIO_APP_USER" "$MINIO_APP_PASSWORD" && mc mirror --overwrite --remove /backup/minio-bucket "supercanvas/$MINIO_BUCKET"'

docker compose run --rm migrate
docker compose up -d web worker
docker compose ps
```

恢复后检查旧素材内容、供应商连接掩码和最近运行历史。Redis 不需要恢复；Worker 会扫描 PostgreSQL 中可恢复的运行并继续执行。对于状态为 `needs_attention` 的任务，应先在供应商控制台人工核对，不要通过恢复过程重新提交。

## 升级与回滚

升级前先完成一组 PostgreSQL、MinIO 和 `MASTER_KEY` 备份，然后：

```powershell
docker compose build --pull web worker
docker compose up -d web worker
docker compose logs --tail 100 web worker
```

数据库结构由 `packages/db/drizzle` 中的顺序迁移管理。当前最新迁移 `0007_numerous_venus.sql` 新增导演 profile、会话、消息和版本化方案表；`0006_fuzzy_nemesis.sql` 把 `audio` 加入素材类型约束；`0005_strong_stellaris.sql` 为 `node_run.provider_task_id` 增加索引，`0003_loud_giant_man.sql` 已把 `asset.size` 迁移为 bigint 以覆盖 2 GB 直传上限。迁移仍可能包含不可逆变更，升级前必须阅读版本说明并先在备份副本上演练；代码回滚不能替代数据库和对象存储恢复。
