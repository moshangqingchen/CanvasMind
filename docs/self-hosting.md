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

| 变量                   | 默认行为                                | 说明                                                |
| ---------------------- | --------------------------------------- | --------------------------------------------------- |
| `DATABASE_URL`         | Compose 必填；开发模式可留空            | PostgreSQL 连接串；Compose 内使用 `postgres` 主机名 |
| `USE_MEMORY_STORE`     | 除非精确为 `false`，否则使用内存        | 持久化部署必须为 `false`                            |
| `REDIS_URL`            | Compose 必填；开发模式可留空            | Redis 连接串，通常为 `redis://:密码@redis:6379`     |
| `RUN_IN_PROCESS`       | 除非精确为 `false`，否则在 Web 进程执行 | 独立 Worker 模式必须为 `false`                      |
| `WORKER_CONCURRENCY`   | `2`                                     | 单个 Worker 并发任务数                              |
| `S3_ENDPOINT`          | 未设置时使用本地文件                    | Worker/Web 可访问的 S3 或 MinIO endpoint            |
| `S3_PUBLIC_ENDPOINT`   | 与 `S3_ENDPOINT` 相同                   | 浏览器可访问的预签名上传 endpoint                   |
| `S3_REGION`            | `us-east-1`                             | S3 region                                           |
| `S3_ACCESS_KEY`        | 未设置时使用 SDK fallback（仅开发）     | S3 access key；Compose 使用 MinIO app user          |
| `S3_SECRET_KEY`        | 未设置时使用 SDK fallback（仅开发）     | S3 secret key；Compose 使用 MinIO app password      |
| `S3_BUCKET`            | `supercanvas`                           | 素材 bucket                                         |
| `S3_FORCE_PATH_STYLE`  | 除非精确为 `false`，否则开启            | MinIO 通常需要 `true`                               |
| `LOCAL_STORAGE_PATH`   | 当前进程目录下的 `storage`              | 仅在未设置 `S3_ENDPOINT` 时使用                     |
| `MASTER_KEY`           | Compose 必填；开发模式可留空            | 生产环境必填；Web 和 Worker 必须完全一致            |
| `POSTGRES_PASSWORD`    | 无默认值，Compose 必填                  | PostgreSQL 密码                                     |
| `REDIS_PASSWORD`       | 无默认值，Compose 必填                  | Redis AUTH 密码                                     |
| `MINIO_ROOT_USER`      | 无默认值，Compose 仅供 MinIO/init 使用  | MinIO 管理员账号，不给 Web/Worker 使用              |
| `MINIO_ROOT_PASSWORD`  | 无默认值，Compose 仅供 MinIO/init 使用  | MinIO 管理员密码，不给 Web/Worker 使用              |
| `MINIO_APP_USER`       | 无默认值，Compose 必填                  | 受限 bucket 读写账号                                |
| `MINIO_APP_PASSWORD`   | 无默认值，Compose 必填                  | 受限 bucket 读写密码                                |
| `PUBLIC_BASE_URL`      | 空，Webhook 入口关闭                    | 配置公网基址后才启用 Webhook 路由                   |
| `NEXT_PUBLIC_APP_NAME` | `超级画布`                              | Docker 构建时写入前端的应用名称                     |

单账号登录相关变量（三者必须同时非空才会启用）：

| 变量                                     | 默认行为       | 说明                                           |
| ---------------------------------------- | -------------- | ---------------------------------------------- |
| `SUPERCANVAS_PUBLIC_AUTH_USER`           | 空，登录关闭   | 登录用户名                                     |
| `SUPERCANVAS_PUBLIC_AUTH_PASSWORD`       | 空，登录关闭   | 登录密码                                       |
| `SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN`  | 空，登录关闭   | 会话 Cookie 的值；改动即让所有已登录设备失效   |
| `SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK` | 回环地址免登录 | 设为 `false` 时本机访问也要求登录              |
| `SUPERCANVAS_PUBLIC_AUTH_TRUSTED_HOSTS`  | 空             | 逗号分隔的额外免登录主机名，仅用于可信内网机器 |

启用后，**除回环和上述可信主机外的所有主机名**都需要有效会话。`/api/public-auth/*`（登录本身）、`/api/webhooks/*`（Provider 回调，自带 HMAC 校验）和 `/_next/*` 静态资源保持公开。登录失败按来源 IP 限流（15 分钟 8 次），另有全局阈值抵挡分布式撞库；限流状态保存在 Web 进程内存中，因此只对单个 Web 容器有效。

> 反向代理若把 `Host` 改写成 `localhost`，回环豁免会绕过整个登录。这类部署必须设置 `SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK=false`，或配置代理透传原始 `Host`。

`.env.example` 供本机配置参考。复制后必须填写 Compose 所需的非空密码和连接串；Compose 不再提供任何默认密码。`DATABASE_URL`、`REDIS_URL` 可按部署网络自定义，URL 中的特殊字符必须进行 URL 编码。MinIO root 凭据只用于 `minio-init` 创建 bucket、CORS 和受限 app policy；该 policy 仅允许目标 bucket 的列举、读、写和删除对象，Web/Worker 只使用 `MINIO_APP_USER` / `MINIO_APP_PASSWORD`。真实 Provider 密钥必须通过 UI 的“设置”加密保存，不能放进普通环境变量或 Connector JSON。

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
Invoke-RestMethod http://localhost:3000/api/health
```

第一次打开设置页前，确认 Web 和 Worker 都收到了同一个主密钥：

```powershell
docker compose config
docker compose logs --tail 100 web worker
```

不要把 `docker compose config` 输出粘贴到工单或聊天中，它可能包含凭据。

## 本地持久化开发

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
- 不配置 `SUPERCANVAS_PUBLIC_AUTH_*` 时应用没有任何身份验证。要在本机以外访问，必须先按上文启用单账号登录；它会保护页面、全部 `/api/*` 和 SSE 路由，只放行登录接口和自带验签的 Webhook。
- 登录只有一个共享账号，没有多用户隔离和审计。即使外层已有 HTTPS，也不要在多人或不可信网络开放。
- 反向代理必须透传原始 `Host`；若代理把 `Host` 改写为 `localhost`，请同时设置 `SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK=false`，否则回环豁免会绕过登录。
- MinIO Console (`9001`)、S3 API (`9000`)、PostgreSQL (`5432`) 和 Redis (`6379`) 不应经过公网反向代理。

轮换 MinIO app 密码时，先停止 `web`/`worker`，用 root 凭据删除旧 app user，再更新 `.env` 并重新运行一次性初始化服务：

```powershell
docker compose stop web worker
mc alias set minio-admin http://localhost:9000 $env:MINIO_ROOT_USER $env:MINIO_ROOT_PASSWORD
mc admin user remove minio-admin $env:MINIO_APP_USER
docker compose run --rm minio-init
docker compose up -d web worker
```

### 主密钥与 Provider Key

- 首次保存 Provider 连接前生成随机 `MASTER_KEY`，让 Web 和 Worker 使用同一个值。
- 更换或丢失 `MASTER_KEY` 会导致数据库中的现有 API Key 无法解密。轮换流程应先通过 UI 覆盖所有连接密钥，再淘汰旧密钥。
- `.env`、备份、`docker compose config` 输出和进程环境都应按密钥材料保护。
- UI 返回的密钥只是掩码；画布、普通数据库字段和 BullMQ payload 不应包含明文 Key。

### 素材与上传

- 预签名直传上限为 2 GB，有效期 10 分钟；预签名响应中的 upload intent token 绑定素材 ID、对象键、声明大小和规范化 MIME，确认接口会验证 token、对象 HEAD 元数据及文件头；代理上传上限为 500 MB。允许的媒体类型为 PNG/JPEG/WebP/GIF 和 MP4/MOV/WebM，并会校验文件头；不接受 SVG 或任意 `image/*`/`video/*` MIME。
- 当前没有病毒扫描。不能把上传接口开放给不可信用户。
- `S3_PUBLIC_ENDPOINT` 必须能从浏览器访问；`S3_ENDPOINT` 必须能从 Web/Worker 访问。二者可以不同。
- `infra/minio/cors.xml` 只允许 `http://localhost:3000` 和 `http://localhost:3210`。使用其他可信 origin 时要更新 CORS；不要配置通配符 origin。

### Webhook

`POST /api/webhooks/:provider/:connectionId` 仅在配置 `PUBLIC_BASE_URL` 后启用，并且会先调用 Adapter 验签、再登记去重事件。OpenAI、Runway 和 Fake Adapter 未实现 `verifyWebhook`，因此仍依赖轮询；通用 REST Connector 支持声明式 HMAC-SHA256 验签，密钥使用连接的加密 `apiKey`，不会写入 Connector JSON。示例配置：

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

供应商应对原始请求体计算 HMAC-SHA256，并把十六进制或 Base64 摘要放在配置的请求头中。事件按 `provider + connectionId + externalId` 去重；没有可验证签名的 Connector 会返回 `501`，当前任务完成通知依赖轮询。

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
Invoke-RestMethod http://localhost:3000/api/health
docker compose exec postgres pg_isready -U supercanvas -d supercanvas
docker compose exec redis sh -lc 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" ping'
Invoke-WebRequest http://localhost:9000/minio/health/live -UseBasicParsing
```

`/api/health` 会访问 PostgreSQL 和对象存储并返回默认画布 ID。Compose 另有 PostgreSQL、Redis、MinIO 与 Web 健康检查；Worker 进程退出由 `restart: unless-stopped` 处理。外部 Provider 仍应单独监控。

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

推荐在没有新任务提交的维护窗口执行一致性备份。以下命令需要主机已安装 MinIO Client `mc`。

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path (Get-Location) "backups\$stamp"
New-Item -ItemType Directory -Force $backupDir | Out-Null

docker compose stop web worker
docker compose exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/supercanvas.dump'
docker compose cp postgres:/tmp/supercanvas.dump "$backupDir\postgres.dump"

mc alias set supercanvas http://localhost:9000 $env:MINIO_APP_USER $env:MINIO_APP_PASSWORD
mc mirror --overwrite "supercanvas/$env:S3_BUCKET" "$backupDir\minio-bucket"

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
Copy-Item "backups\目标备份\deployment.env" .env
docker compose up -d postgres redis minio minio-init
docker compose stop web worker

docker compose cp "backups\目标备份\postgres.dump" postgres:/tmp/supercanvas.dump
docker compose exec -T postgres pg_restore --clean --if-exists --no-owner -U "$env:POSTGRES_USER" -d "$env:POSTGRES_DB" /tmp/supercanvas.dump

mc alias set supercanvas http://localhost:9000 $env:MINIO_APP_USER $env:MINIO_APP_PASSWORD
mc mirror --overwrite --remove "backups\目标备份\minio-bucket" "supercanvas/$env:S3_BUCKET"

docker compose run --rm migrate
docker compose up -d web worker
Invoke-RestMethod http://localhost:3000/api/health
```

恢复后检查旧素材内容、供应商连接掩码和最近运行历史。Redis 不需要恢复；Worker 会扫描 PostgreSQL 中可恢复的运行并继续执行。对于状态为 `needs_attention` 的任务，应先在供应商控制台人工核对，不要通过恢复过程重新提交。

## 升级与回滚

升级前先完成一组 PostgreSQL、MinIO 和 `MASTER_KEY` 备份，然后：

```powershell
docker compose build --pull web worker
docker compose up -d web worker
docker compose logs --tail 100 web worker
```

数据库结构由 `packages/db/drizzle` 中的顺序迁移管理。当前迁移 `0005_strong_stellaris.sql` 为 `node_run.provider_task_id` 增加索引，便于 Worker 恢复和 Webhook 查找；`asset.size` 已迁移为 bigint 以覆盖 2 GB 直传上限。迁移仍可能包含不可逆变更，升级前必须阅读版本说明并先在备份副本上演练；代码回滚不能替代数据库和对象存储恢复。
