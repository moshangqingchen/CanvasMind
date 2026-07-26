# 超级画布

超级画布是一个面向个人创作的生图/生视频工作流 Web 应用。它把素材、结构化 Prompt、图片生成、视频生成和结果预览组织在一张类型化 DAG 画布上，并通过统一 Provider Adapter 接入外部 API。

当前仓库包含可运行的单用户版本：开发环境可用内置 Fake Provider 快速体验；完整自托管模式使用 PostgreSQL 保存画布与运行快照、Redis/BullMQ 调度任务、MinIO 保存上传素材和生成结果。第三方结果会先归档到自己的对象存储，再释放下游节点。

## 已实现能力

- 五类节点：素材输入、Prompt、图片生成/编辑、视频生成、结果预览。
- 文本、图片、图片数组、视频、视频数组端口；连线时检查类型、数量和环路。
- Tiptap 结构化 `@素材`，保存不可变 `assetId` 和引用角色，不依赖素材 URL 或名称。
- 单节点运行、下游运行和整张画布运行。
- 自动保存、撤销/重做、项目 JSON 导入/导出、运行历史和结果版本保留。
- OpenAI 图片、Runway 视频、通用 REST 和 Fake Provider。
- PostgreSQL 运行快照、客户端幂等 ID、Worker 恢复、取消、轮询、SSE 状态和输出归档。
- API Key 仅在服务端解密使用，数据库保存 AES-256-GCM 密文，浏览器只看到掩码。

## 快速体验

需要 Node.js 24 和 pnpm 11。首次安装：

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install
pnpm dev
```

打开 <http://localhost:3210>。这个模式不要求 Docker：未设置环境变量时使用进程内数据库、本地文件存储、进程内执行器和 Fake Provider。

> 体验模式中的画布、素材索引、连接和运行历史会在 Web 进程重启后丢失，只适合开发和试用。要保留数据，请使用下面的完整自托管模式。

## Docker 自托管

需要 Docker Engine 或 Docker Desktop，且 Docker Compose v2 可用。

1. 创建部署环境文件并生成独立主密钥：

```powershell
Copy-Item .env.example .env
node -e "console.log('base64:' + require('node:crypto').randomBytes(32).toString('base64'))"
```

2. 把命令输出写入 `.env` 的 `MASTER_KEY`，并填写 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`MINIO_ROOT_USER`、`MINIO_ROOT_PASSWORD`、`MINIO_APP_USER`、`MINIO_APP_PASSWORD`、`DATABASE_URL` 和 `REDIS_URL`。Compose 不提供默认密码；连接串中的密码必须 URL 编码。MinIO root 凭据只用于初始化，Web/Worker 使用受限 app user。
3. 启动完整服务：

```powershell
docker compose up -d --build
docker compose ps
Invoke-RestMethod http://localhost:3000/api/health
```

打开 <http://localhost:3000>。一次性的 `migrate` 服务会先应用 Drizzle migrations，成功后 Web 和 Worker 才启动。查看日志：

```powershell
docker compose logs -f web worker
```

默认只将 Web、MinIO API 和 MinIO Console 绑定到 `127.0.0.1`；PostgreSQL 与 Redis 只在 Compose 内部网络可见，Redis 启用 AUTH。镜像使用固定版本 tag，Web/Worker 以非 root 用户运行。应用仍然没有登录，不能原样用于公网或不可信主机。密码修改、升级和备份步骤见 [自托管与运维](docs/self-hosting.md)。

## 基本工作流

1. 在左侧素材库上传图片或视频。使用 MinIO/S3 时，浏览器通过 10 分钟有效的预签名 URL 直传；预签名响应还带有绑定素材 ID、对象键、大小和 MIME 的短期 upload intent token，确认接口会再次校验对象头和文件魔数；本地存储时自动退回 Web 代理上传。
2. 添加“素材输入”节点并选定素材，或添加 Prompt 节点，在编辑器输入 `@` 选择素材。Mention 可标记为参考素材、首帧或尾帧。
3. 从输出端口拖到兼容输入端口。拖到画布空白处会出现兼容节点菜单；不兼容端口、重复单输入和环路会被拒绝。
4. 添加图片或视频生成节点，在右侧选择供应商、连接、模型，并填写参数 JSON。
5. 选择节点后运行当前节点或运行下游。范围外的上游会复用最近一次成功输出；没有可用输出时会在调用付费 API 前失败。
6. 也可在画布工具栏选择“运行全部”。生成结果自动进入素材库；历史记录中的任一输出可固定成不可变素材输入节点继续复用。

常用快捷键：

| 操作               | Windows / Linux            | macOS                    |
| ------------------ | -------------------------- | ------------------------ |
| 运行当前节点       | `Ctrl+Enter`               | `Cmd+Enter`              |
| 从当前节点运行下游 | `Ctrl+Shift+Enter`         | `Cmd+Shift+Enter`        |
| 撤销               | `Ctrl+Z`                   | `Cmd+Z`                  |
| 重做               | `Ctrl+Y` 或 `Ctrl+Shift+Z` | `Cmd+Y` 或 `Cmd+Shift+Z` |

“导出”只导出画布结构和参数，不包含素材文件、运行历史、供应商密钥或数据库 revision，因此不能替代系统备份。

## 供应商连接

在右上角“设置”中新建连接，保存后先执行“测试连接”，再在生成节点中选择该连接。API Key 不应写入画布参数、项目 JSON、浏览器代码或 Connector 模板。

### Fake

无需 API Key，图片模型使用 `fake-image-v1`，视频模型使用 `fake-video-v1`。适合验证连线、运行、归档和历史流程，不会调用外部服务。

### OpenAI 图片

- 供应商选择 `OpenAI 图片`，填入 API Key；默认 Base URL 为 `https://api.openai.com/v1`。
- 默认模型为 `gpt-image-2`，也可以在节点中填写其他可用模型 ID。
- 无参考图时调用图片生成；连入或 `@` 引用图片时自动切换为图片编辑，最多 16 张参考图。
- 参数 JSON 会转发 `background`、`moderation`、`n`、`output_compression`、`output_format`、`quality`、`size`、`user`。
- `gpt-image-2` 在提交前校验尺寸边长、16 像素倍数、像素总量和 3:1 比例；单张编辑输入不能超过 50 MB，且不接受透明背景。

示例：

```json
{
  "size": "1536x1024",
  "quality": "high",
  "output_format": "png"
}
```

### 沧元算力图像 API

- 供应商选择 `沧元算力`，填写 API Key，再选择模型广场中的供应分组。
- `IMAGE` 与 `全模型-无claude/gpt` 当前各提供 9 个图片模型：`gpt-image-2`、GPT Image 2 固定 1K/2K、Nano Banana Pro 固定 1K/2K/4K、Nano Banana 2 固定 1K/2K/4K。
- `gpt-image-2` 为 ¥0.015/张并支持一次生成 1 至 10 张；固定档模型按模型广场标价且每次返回 1 张。当前模型广场未提供 `gpt-image-2-4k`，因此不接入该型号。
- `备用image线路` 提供 `codex-gpt-image-2-1k`（¥0.07/张）、`gemini-banana-2.0`（¥0.12/张）和 `gemini-banana-pro-4k`（¥0.18/张）。
- 连接只暴露当前分组中的模型；切换分组会同步更新默认模型与请求参数。
- 模型目录每 60 秒重新检查沧元主页、文档入口和模型广场；模型新增、移组、下架或改价会自动同步。上游暂时不可用时使用最近一次成功目录，首次检查失败时使用内置兜底目录。
- 运行前严格校验模型仍属于该连接的当前分组；已被移出或下架的旧节点会在请求发出前停止，避免错误扣费。
- 接入或更新模型前必须重新核对沧元算力主页、模型广场与对应单模型 API 文档；模型广场决定当前可用模型、价格和分组，单模型文档决定请求参数。

### Runway 视频

- 供应商选择 `Runway 视频`，填入 API Key；默认 Base URL 为 `https://api.dev.runwayml.com/v1`。
- 默认模型为 `gen4.5`，内置模型列表还包含 `gen4_turbo`。
- 没有图片输入时使用文生视频；有一张图片输入时使用图生视频。当前适配器最多接受一张首帧图片。
- 参数 JSON 支持 `ratio` 和 `duration`；`duration` 必须是 2 到 10 的整数秒。

示例：

```json
{
  "ratio": "1280:720",
  "duration": 5
}
```

### 通用 REST

通用 REST Connector 是声明式配置，不执行任意 JavaScript。它支持 JSON、multipart、同步响应、异步轮询和取消：

- `submit`、`poll`、`cancel`、`test` 描述路径、方法、请求体和响应字段。
- `mappings[].target` 使用 RFC 6901 JSON Pointer 写请求体。
- `source.path` 与响应提取使用受限 JSONPath，只支持属性、数组索引和通配符；不支持过滤器、脚本、切片、union 或递归下降。
- `output` 可从 URL 或 Base64 提取图片/视频。
- `allowedHosts` 应始终填写精确主机名；默认只允许 HTTPS。仅在可信的本地服务场景设置 `allowInsecureHttp: true`。
- 只有远端明确支持 `Idempotency-Key` 去重时，才可把请求定义标记为 `idempotent: true`。

设置面板会提供一份可编辑的起始配置。Connector 的完整字段、SSRF 边界和部署建议见 [自托管与运维](docs/self-hosting.md#通用-rest-connector)。

## 运行可靠性

- 每次运行冻结当前画布图，并使用 `canvasId + clientRequestId` 去重创建请求。
- 队列任务只携带不透明的 `node_run_id`；Provider 密钥、任务响应和素材不会进入 Redis Job payload。
- PostgreSQL 是运行状态的唯一真相。Worker 启动时会恢复 `queued` / `running` 运行，已有远端任务 ID 和持久化任务快照时只恢复轮询或归档，不重新提交。
- 远端是否已收到请求无法确定时，节点进入 `needs_attention`，系统不会盲目重提付费任务。
- 输出 URL 或 Base64 会先复制到 MinIO/S3/本地存储；归档成功后节点才变为 `succeeded`。供应商已完成但解析/归档失败会保留任务快照并进入 `needs_attention`。
- 取消请求在 Worker 停机期间会保留为 `cancel_requested`，下次 Worker 启动时继续向供应商发送取消。
- 运行创建时会把自动选择的模型解析并写入冻结 revision；之后修改连接默认模型不会改变该运行。
- Redis 无需备份。丢失 Redis 队列后，Worker 可根据 PostgreSQL 中的运行记录恢复。
- 局部运行从 PostgreSQL 的成功 `node_run` 查找最近输出，不依赖编辑稿中的临时 URL 或缓存字段。

## HTTP API

主要接口如下。当前没有登录鉴权，只能在可信本机使用。

| 方法            | 路径                                    | 用途                                                                   |
| --------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `GET`           | `/api/health`                           | Web、数据库与对象存储探针                                              |
| `GET`, `POST`   | `/api/canvas`                           | 读取默认画布、创建画布                                                 |
| `GET`, `PUT`    | `/api/canvas/:id`                       | 读取或保存画布                                                         |
| `GET`           | `/api/assets`                           | 素材列表                                                               |
| `POST`          | `/api/assets/presign`                   | 获取预签名上传指令                                                     |
| `POST`          | `/api/assets/complete`                  | 确认直传并登记素材                                                     |
| `POST`          | `/api/assets/upload`                    | Web 代理上传                                                           |
| `GET`           | `/api/assets/:id/content`               | 读取归档素材内容                                                       |
| `GET`, `POST`   | `/api/providers`                        | 列出或保存供应商连接                                                   |
| `DELETE`        | `/api/providers/:id`                    | 删除供应商连接                                                         |
| `POST`          | `/api/providers/:id/test`               | 测试连接                                                               |
| `GET`           | `/api/providers/:id/models`             | 查询模型列表                                                           |
| `GET`, `POST`   | `/api/runs`                             | 查询历史或创建运行                                                     |
| `GET`, `DELETE` | `/api/runs/:id`                         | 查询或取消运行                                                         |
| `GET`           | `/api/runs/:id/events`                  | SSE 运行状态                                                           |
| `POST`          | `/api/webhooks/:provider/:connectionId` | Provider Webhook 入口（需配置 `PUBLIC_BASE_URL`；REST 可用 HMAC 验签） |

创建运行必须传入客户端生成且重试时保持不变的 `clientRequestId`：

```json
{
  "canvasId": "canvas-id",
  "clientRequestId": "0190...",
  "scope": "node",
  "nodeId": "node-id"
}
```

`scope` 可取 `node`、`downstream` 或 `all`；`all` 不需要 `nodeId`。

## 开发与验证

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @super-canvas/web e2e
```

Playwright 默认在独立的 <http://localhost:3211> 启停生产测试服务，执行 E2E 前需要先完成生产构建；也可用 `PLAYWRIGHT_BASE_URL` 指向外部服务。Docker 镜像分别提供 `web`、`worker` 和迁移所用的 `base` target。

仓库结构：

```text
apps/web          Next.js 画布和 HTTP API
apps/worker       BullMQ Worker
packages/core     图、端口、Prompt、状态机与重试规则
packages/db       Drizzle schema、内存/PostgreSQL Repository
packages/providers Provider Adapter 与密钥加密
packages/runtime  DAG 运行、恢复、归档与事件
packages/storage  本地文件和 S3/MinIO 存储
infra/minio       本地直传 CORS 配置
```

## 当前边界

- 单用户、手动运行；没有登录、权限、协作、计费、循环/条件分支或时间线剪辑。
- `PUBLIC_BASE_URL` 未配置时 Webhook 路由返回 404；OpenAI、Runway 和 Fake 默认依赖轮询，通用 REST 可按 Connector 配置使用 HMAC-SHA256 Webhook。公网部署仍需先增加登录、HTTPS、CSRF/Origin 策略、限流和域名白名单。
- 归档下载器自动兼容 Clash/Mihomo 的 HTTPS Fake-IP DNS，并逐跳校验海外 CDN 跳转；IP 直连、HTTP Fake-IP、HTTPS 降级和真实私网地址仍会被拒绝。
- `/api/health` 检查数据库与对象存储；Redis 由 Compose 自身健康检查覆盖，仍不探测外部 Provider。
- 单个 Docker Worker 是默认部署边界。跨多个 Worker 实例的严格分布式执行租约尚未实现，因此不要水平扩容 Worker。
- CORS 默认只允许 `localhost:3000` 和 `localhost:3210`；修改 Web 端口时要同步更新 MinIO CORS。

这些限制及上线前检查清单详见 [自托管与运维](docs/self-hosting.md)。
