# 超级画布

超级画布是一个面向个人创作的生图/生视频工作流 Web 应用。它把素材、结构化 Prompt、图片生成、视频生成和结果预览组织在一张类型化 DAG 画布上，并通过统一 Provider Adapter 接入外部 API。

当前仓库包含可运行的单用户版本：开发环境可用内置 Fake Provider 快速体验；完整自托管模式使用 PostgreSQL 保存画布与运行快照、Redis/BullMQ 调度任务、MinIO 保存上传素材和生成结果。第三方结果会先归档到自己的对象存储，再释放下游节点。

## 已实现能力

- 五类节点：素材输入、Prompt、图片生成/编辑、视频生成、结果预览。
- 文本、图片、图片数组、视频、视频数组、音频、音频数组端口；连线时检查类型、数量和环路。
- Tiptap 结构化 `@素材`，保存不可变 `assetId` 和引用角色，不依赖素材 URL 或名称。
- 单节点运行、下游运行和整张画布运行；节点右键可直接运行、复制、原地复制和删除。
- 自动保存并在顶栏显示真实保存状态、撤销/重做、结构 JSON 与含素材完整项目包导入/导出、运行历史和结果版本保留。
- 画布画笔图层：自由涂鸦、框选、拖动，并可把选中笔画合并成图片素材节点。
- 右侧「超级导演」智能体：固定一个 GPT、Claude、Grok、Gemini 或 OpenAI-compatible 导演大脑，按需求研究、规划并比较图片/视频模型；所有媒体生成调用先给出方案和最高费用，确认后才写入并运行画布。
- 素材管理拖入桥接：从外部素材管理器拖动文件到画布即可登记为素材节点。
- OpenAI 图片、We-AI 图片、Runway 视频、喵呜视频、沧元算力图像、赛博阿飞、辰途、MikotoPro、FriModel、通用 REST 和 Fake Provider。
- 沧元、赛博阿飞、辰途、喵呜实时抓取模型广场目录与价格；五家国内网关另按当前 Key 实时扫描可调用模型，设置面板提供“刷新目录”按钮，已下架或无权限的模型在付费提交前拦截。
- PostgreSQL 运行快照、客户端幂等 ID、Worker 恢复、取消、轮询、SSE 状态和输出归档。
- API Key 仅在服务端解密使用，数据库保存 AES-256-GCM 密文，浏览器只看到掩码。
- 可选的单账号登录：配置后所有主机名都需要会话，登录接口有失败限流，写接口有跨站 Origin 校验。

## 快速体验

需要 Node.js 24 和 pnpm 11。首次安装：

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install
pnpm dev
```

打开 <http://localhost:3210>。这个模式不要求 Docker：未设置环境变量时使用本地 JSON 数据库、本地文件存储、进程内执行器和 Fake Provider。画布、素材索引、连接和运行历史默认保存在 `apps/web/data/super-canvas.json`，素材文件默认保存在 `apps/web/storage`，重启 Web 进程不会丢失。

> 本地模式适合单机使用和开发。正式公网部署、多人共享或需要独立数据库备份时，请使用下面的完整自托管模式。

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
```

打开 <http://localhost:3000>。一次性的 `migrate` 服务会先应用 Drizzle migrations，成功后 Web 和 Worker 才启动。查看日志：

```powershell
docker compose logs -f web worker
```

默认只将 Web、MinIO API 和 MinIO Console 绑定到 `127.0.0.1`；PostgreSQL 与 Redis 只在 Compose 内部网络可见，Redis 启用 AUTH。镜像使用固定版本 tag，Web/Worker 以非 root 用户运行。密码修改、升级和备份步骤见 [自托管与运维](docs/self-hosting.md)。

## 单账号登录

不配置时应用完全没有登录，适合只在本机使用。要在本机以外访问，请设置这三个变量：

```powershell
$env:SUPERCANVAS_PUBLIC_AUTH_USER = "你的用户名"
$env:SUPERCANVAS_PUBLIC_AUTH_PASSWORD = "一个足够长的密码"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
# 把输出写入 SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN
```

三者齐备后：

- **所有主机名都需要登录**，只有回环地址（`localhost`、`127.0.0.0/8`、`[::1]`）默认豁免。想让本机也要求登录，设置 `SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK=false`。
- 需要额外免登录的可信内网机器，用 `SUPERCANVAS_PUBLIC_AUTH_TRUSTED_HOSTS=studio.lan,192.168.1.20` 逐个列出。
- 登录失败按来源 IP 限流（15 分钟内 8 次），并有全局上限抵挡分布式撞库。
- 携带 `Origin` 的跨站写请求（`POST`/`PUT`/`DELETE`）会被拒绝；Provider Webhook 走自己的 HMAC 校验，不受影响。
- 会话 Cookie 为 `HttpOnly` + `SameSite=Lax`，生产模式下附带 `Secure`。

> 反向代理若把 `Host` 改写成 `localhost`，回环豁免会让登录形同虚设。这种部署必须设置 `SUPERCANVAS_PUBLIC_AUTH_ALLOW_LOOPBACK=false`，或让代理透传原始 `Host`。
>
> 会话令牌是一个静态共享密钥：修改 `SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN` 会立即让所有已登录会话失效，这也是唯一的“强制登出所有设备”手段。

## 基本工作流

1. 在左侧素材库上传图片、视频或音频。使用 MinIO/S3 时，浏览器通过 10 分钟有效的预签名 URL 直传；预签名响应还带有绑定素材 ID、对象键、大小和 MIME 的短期 upload intent token，确认接口会再次校验对象头和文件魔数；本地存储时自动退回 Web 代理上传。
2. 添加“素材输入”节点并选定素材，或添加 Prompt 节点，在编辑器输入 `@` 选择素材。Mention 可标记为参考素材、首帧或尾帧。
3. 从输出端口拖到兼容输入端口。拖到画布空白处会出现兼容节点菜单；不兼容端口、重复单输入和环路会被拒绝。
4. 添加图片或视频生成节点，在右侧“节点参数”中选择供应商、连接、模型与参数；也可以切换到“超级导演”，直接用自然语言让导演研究、规划和报价。
5. 选择节点后运行当前节点或运行下游。范围外的上游会复用最近一次成功输出；没有可用输出时会在调用付费 API 前失败。
6. 也可在画布工具栏选择“运行全部”。生成结果自动进入素材库；历史记录中的任一输出可固定成不可变素材输入节点继续复用。

## 超级导演

`NEXT_PUBLIC_DIRECTOR_ENABLED` 是前端构建开关，默认启用：变量未设置或不是精确的 `false` 时都会显示超级导演。只有确实需要回退旧导演台时，才在执行 `pnpm dev` 或 `pnpm build` 的环境中设置 `NEXT_PUBLIC_DIRECTOR_ENABLED=false`，然后重启开发服务或重新构建前端。

首次使用按以下顺序配置：

1. 在“设置 → 导演大脑”中直接新建一个独立导演连接并保存 API Key，也可选择之前已经创建的 `usage: agent` 连接。它与画布生成连接分开，可使用 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages / Claude、xAI Responses / Grok、Google Gemini `generateContent` 或通用 OpenAI-compatible 协议。
2. 打开“设置 → 导演大脑”，选择固定的导演连接、模型 ID、接口协议和模型实际支持的能力。这里保存的只是导演 profile 对连接的引用，不会改写该连接的密钥、Base URL、模型目录或默认生成参数。
3. 需要实时研究时，可另外创建并选择 Tavily 研究连接。导演模型声明支持原生搜索时优先使用原生搜索；否则才使用 Tavily。研究结果会保留来源 URL、抓取时间和证据等级。

发送消息只授权导演大脑进行本轮文本推理和有限研究；这一步可能产生导演模型或搜索服务自身的 token/搜索费用，但**不授权任何图片或视频生成**。需求明确后，系统会展示工作流变化、逐次媒体调用、供应商、连接、模型、参数、数量、原币价格、人民币估算、价格时间和排除原因。只有点击“确认并生成”后，幽灵节点才会持久化到画布并执行整批媒体调用。

- 方案默认 15 分钟过期。模型、参数、数量、价格或画布 revision 变化时必须重新报价并再次确认。
- 未知、过期或无法换算的价格不参与“自动最便宜”排序；没有可比较候选时必须手动选择。
- 系统不会自动进行付费重试或切换到付费备用模型。提交结果不确定时进入 `needs_attention`，再次提交前必须重新确认。
- 取消待确认方案不会写入画布，也不会发起媒体生成调用。
- 导演读取画布供应商连接和模型目录进行比价时使用只读探测；这些扫描不会持久化回供应商连接。连接的编辑、测试和目录刷新仍只由“供应商与密钥”界面显式执行。

导演规则运行时只读取仓库内的 `packages/director/knowledge` 快照，不依赖外部“超级导演”目录。维护者可显式同步新的规则源：

```powershell
pnpm director:sync -- --source "D:\path\to\超级导演"
```

同步默认拒绝含未提交改动的源工作树。首次导入也不例外；只有明确接受 dirty 快照时才使用 `--allow-dirty`：

```powershell
pnpm director:sync -- --source "D:\path\to\超级导演" --allow-dirty
```

每次同步都会更新 `packages/director/knowledge/manifest.json`，记录源 commit、dirty 状态、同步时间、整体内容哈希和逐文件 SHA-256。提交快照前应审核该清单和知识文件 diff；后续同步继续默认拒绝 dirty 源。

常用快捷键（应用内按 `?` 或 `Ctrl+/` 可随时打开这张表）：

| 操作               | Windows / Linux            | macOS                    |
| ------------------ | -------------------------- | ------------------------ |
| 运行当前节点       | `Ctrl+Enter`               | `Cmd+Enter`              |
| 从当前节点运行下游 | `Ctrl+Shift+Enter`         | `Cmd+Shift+Enter`        |
| 撤销               | `Ctrl+Z`                   | `Cmd+Z`                  |
| 重做               | `Ctrl+Y` 或 `Ctrl+Shift+Z` | `Cmd+Y` 或 `Cmd+Shift+Z` |
| 复制 / 粘贴节点    | `Ctrl+C` / `Ctrl+V`        | `Cmd+C` / `Cmd+V`        |
| 原地复制选中节点   | `Ctrl+D`                   | `Cmd+D`                  |
| 选中全部节点       | `Ctrl+A`                   | `Cmd+A`                  |
| 立即保存画布       | `Ctrl+S`                   | `Cmd+S`                  |
| 删除选中对象       | `Delete`                   | `Delete`                 |
| 抓手 / 画笔 / 选择 | `1` / `2` / `3`            | `1` / `2` / `3`          |
| 缩放到适合全部节点 | `F`                        | `F`                      |
| 快捷键帮助         | `?` 或 `Ctrl+/`            | `?` 或 `Cmd+/`           |

输入框和 Prompt 编辑器内不会触发画布快捷键。

### 项目迁移与备份

右上角项目菜单提供两种格式：

- “导出项目”生成轻量 `.canvas.json`，只保存经过限额校验的节点、连线、视图和涂鸦。素材仍按当前实例的 `assetId` 引用，适合在同一素材库中制作模板。
- “导出完整项目包”生成 `.supercanvas`，会打包画布实际引用的图片、视频和音频，并在导入时上传为新素材、自动改写引用，适合跨实例迁移。压缩包及解压后内容上限均为 512 MB。

导入会先显示节点、连线、涂鸦、素材缺失等预检结果，不会直接覆盖当前画布；默认会先下载当前画布的 JSON 备份。只有素材齐全的完整项目包才允许继续，且新画布成功保存前不会替换界面；中途上传的素材会尽量自动回滚。

两种格式都不包含运行历史、供应商密钥、数据库 revision 或未被画布引用的素材，因此不能替代系统级备份。完整备份与恢复请参阅 `docs/self-hosting.md`。

## 供应商连接

在右上角“设置”中新建连接，保存后先执行“测试连接”，再在生成节点中选择该连接。API Key 不应写入画布参数、项目 JSON、浏览器代码或 Connector 模板。

所有内置供应商共用一套实时目录机制：

- 沧元、赛博阿飞、辰途、喵呜有机器可读的模型广场，模型、分组和价格实时抓取（60 秒缓存，失败时退回最近成功目录或内置兜底）。
- 赛博阿飞、辰途、喵呜、MikotoPro、FriModel 另外用当前 Key 调用免费的 `/v1/models` 实时扫描；哪个模型能用以扫描结果为准，被移出分组、分组停用或下架的模型会标记为不可用，并在付费提交前被拦截。
- MikotoPro 与 FriModel 的官网价格不可机器读取，价格采用内置快照并标注“快照”；Key 可见但快照未收录的模型显示“价格以平台为准”。
- 设置面板每个分组提供“刷新目录”按钮，随时强制重新拉取模型广场与 Key 扫描结果；“测试连接”同样只调用免费端点，不发起付费生成请求。
- 通用 OpenAI 兼容/REST 连接也会按当前连接的 `/models` 或 `/v1/models` 响应扫描模型、文档分组和价格字段；扫描结果、默认模型和最近检查时间只写入该连接，并在设置页显示实时模型、价格与分组摘要。
- 每条连接都有稳定的供应商命名空间。已有连接不能改绑到其他供应商；切换供应商必须新建连接，避免沿用旧的加密密钥、模型目录或扫描状态。

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

### We-AI 图片

- 供应商选择 `We-AI（图片生成 / 图片编辑）`，填入 We-AI API Key；默认使用亚太入口 `https://asian-acc.we-token.cc/v1`。
- 设置页展示当前模型广场的 6 个图片分组、倍率和价格；模型广场负责“目录与计价”，专属路由文档负责“是否可调用”。只在广场出现、但未被当前分组路由承诺的模型会标为只读，不能设为画布默认。
- CODEX、Adobe Token、Azure 与 Adobe 按次使用 OpenAI Images 端点：文生图为 `/v1/images/generations` JSON，改图为 `/v1/images/edits` multipart；参考图最多 16 张。CODEX 固定 `gpt-image-2` 与 `n=1`，Adobe Token/Azure 最多 10 张。
- `生图-openai-adobe-按次` 在画布中只展示 `GPT Image 2 1K/2K/4K` 三个分辨率模型，LOW、MEDIUM、HIGH 画质与 `$0.03/$0.07/$0.10 每次`价格单独选择；适配器据此调用对应的 `gpt-image-2-low/medium/high` 后缀模型。该兼容通道只发送文档建议的 `model/prompt/size/n`，不会附带 `quality`、`output_format` 或 `output_compression`。
- `生图-openai-adobe-按次-返回url` 是独立分组，使用普通 `gpt-image-2`，通过 `quality` 选择 LOW/MEDIUM/HIGH，并强制请求 URL 响应；不能与前一分组的后缀模型规则混用。
- Gemini 香蕉新连接默认使用 OpenAI 兼容 `/v1/images/generations`、`/v1/images/edits`，也可切换到 Google 原生 `/v1beta/models/{model}:generateContent`。兼容协议使用 `size=1K/2K/4K` 与 `aspectRatio`；原生协议使用 `generationConfig.imageConfig.imageSize=512/1K/2K/4K` 与 `aspectRatio`，两套参数不会混用。Gemini 固定 `n=1`，最多 14 张参考图、单张不超过 20 MB。
- GPT Image 2 的 `size` 始终作为独立请求参数发送。Adobe 按次线路按所选 K 档提交精确尺寸；4K 提供 1:1、16:9、9:16、4:3、3:4、3:2、2:3、21:9 八种预设。为满足 We-AI 宽高都必须是 16 像素倍数的约束，3:2 / 2:3 使用 `3264x2176` / `2176x3264`，21:9 使用 `3840x1648`。其他可自定义尺寸的线路同样强制宽高按 16 像素对齐。
- 输出解析同时兼容 `b64_json`、带 `data:image/...;base64,` 前缀的数据、URL，以及 Gemini 原生 `inlineData`；同步请求超时按 We-AI 建议设置为 30 分钟。

推荐从以下参数开始：

```json
{
  "size": "2048x1152",
  "n": 1
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

### MikotoPro 图片与视频 API

- 供应商选择 `MikotoPro`，单独填写 MikotoPro API Key；默认 Base URL 为 `https://api.mikoto.vip`。
- MikotoPro 按官方接入文档分成 `OpenAI 图片`、`Gemini 原生图片`、`Seedance 视频`、`Kling 视频` 四个独立连接分组；每个分组单独保存连接、API Key、默认模型和参数协议。2K/4K 是图片尺寸参数，不是单独供应商组。
- 图片模型 `gpt-image-2` 使用 MikotoPro 异步 Images API，支持文生图、图片编辑、URL/base64 输出和常用 1K/2K/4K 尺寸。
- Seedance 视频模型使用 `/v1/videos` 创建任务并轮询 `/v1/videos/{id}`；当前内置 `seedance-2.0-1080p`、`seedance-2.0-720p`、`seedance-fast-480p`、`seedance-fast-720p`，时长范围为 4–15 秒。
- Kling 视频同样使用异步 `/v1/videos`，但作为独立密钥分组接入；内置 `kling-video` 和 `kling-omni-video`，画布会自动生成文档要求的 `messages`、`seconds`、`extra_body` 与 `frame`/`element` 参数，只需选择 5/10/15 秒、16:9/9:16 和 720p/1080p。
- Gemini 原生图片使用 `/v1beta/models/{MODEL}:generateContent`，模型为 `gemini-3.1-flash-image-preview` 和 `gemini-3-pro-image-preview`，鉴权按文档使用 `x-goog-api-key`。
- MikotoPro 连接在界面上独立归类，不与 OpenAI、通用 REST、沧元或其他供应商共用连接配置；模型和 Key 只保存在 MikotoPro 连接中。
- MikotoPro 文档未提供公开价格目录，价格采用内置快照；模型可用性通过当前分组 Key 的免费 `/v1/models` 端点实时扫描，“测试连接”和“刷新目录”都会执行该扫描并在分组停用（403）时明确报错，不会发起可能扣费的生成请求。快照中 Key 扫描不到的模型会标记“暂不可调用”，付费提交前也会被拦截。

### 喵呜 OpenAI Videos API

- 供应商选择 `喵呜 API（视频）`，填写喵呜 API Key；默认 Base URL 为 `https://api.miaowuai.store`。
- 按 OpenAI Videos 文档使用 `POST /v1/videos` 创建任务，并轮询 `GET /v1/videos/{id}`；请求只发送 `model`、`prompt`、`seconds`、`ratio`、`resolution`、`image_urls`、`video_urls` 和 `audio_urls`。
- 模型列表与价格实时抓取喵呜模型广场（`/api/pricing`，60 秒缓存），并与当前 Key 的 `/v1/models` 实时扫描合并：广场有价但 Key 无权限的模型会被移出可调用列表，Key 可见但广场未标价的（如 vip 专属线路）保留调用并显示“价格以平台为准”。人民币价格按平台 ¥7/$1 折算。上游不可用时退回 2026-08-17 内置快照。
- 喵呜不接受文件字段或 `data:` URL。使用参考图片、视频或音频时，画布会生成带 24 小时时效签名的只读公网素材地址；因此必须配置同一服务可被公网访问的 `PUBLIC_BASE_URL` 和稳定的 `MASTER_KEY`。纯文生视频不依赖该素材出口。
- 文档没有提供无扣费鉴权端点，“测试连接”只验证连接配置与密钥可正常解密，不会发起付费生成请求。

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

主要接口如下。未配置单账号登录时它们没有任何鉴权，只能在可信本机使用；配置后除 `/api/public-auth/*` 和 `/api/webhooks/*` 外都需要会话 Cookie。

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

维护命令：

```powershell
pnpm clean                 # 清理可重新生成的构建与测试缓存
pnpm clean:deep            # 额外清理依赖目录，之后需要重新 pnpm install
pnpm gc:storage            # 只读检查孤儿素材，不会删除文件
pnpm gc:storage:apply      # 实际删除；必须先停服务并备份 data/storage
```

`gc:storage:apply` 不属于日常清理命令。确认 dry-run 清单无误并完成备份前，不要执行。

仓库结构：

```text
apps/web          Next.js 画布和 HTTP API
apps/worker       BullMQ Worker
packages/core     图、端口、Prompt、状态机与重试规则
packages/db       Drizzle schema、本地 JSON/PostgreSQL Repository
packages/providers Provider Adapter 与密钥加密
packages/runtime  DAG 运行、恢复、归档与事件
packages/storage  本地文件和 S3/MinIO 存储
infra/minio       本地直传 CORS 配置
```

## Windows 本地常驻与自动更新

完成上面的 `pnpm install` 后，运行以下命令会在 3210 端口启动带进程守护的本地服务：

```powershell
pnpm public:watch
```

### GitHub Release 更新

如果要把本地运行目录与开发仓库分开，先在开发仓库发布一个与根目录
`package.json` 一致的 GitHub Release，例如 `package.json` 为 `0.2.0` 时创建
`v0.2.0`：

```powershell
pnpm public:install
```

该命令会从公开仓库 `moshangqingchen/CanvasMind` 下载并校验 Windows x64
运行包，安装到 `%LOCALAPPDATA%\SuperCanvas`，并生成独立的数据、素材和环境配置目录。
之后用安装目录中的 `start-local-public.ps1` 启动，或在仓库中运行：

```powershell
pnpm public:start:installed
```

画布启动时和配置的检查间隔会检查更新。源码目录运行时会通过 `git ls-remote` 读取配置分支的
最新提交；没有配置 Token 时完全不调用 GitHub Releases REST API，因此不会消耗匿名 API 配额。
本地分支匹配、工作区干净且远程提交可以快进时，管理器会自动执行 `git pull --ff-only`，然后
重建并切换 Web 服务。检测到未提交改动、分支不匹配或无法安全快进时只报告状态，不会覆盖本地文件。
项目菜单中的“检查更新”会显示远程分支和提交标识。正式 Release 仍会显示版本号、发布时间、
提交标识和 Release 正文；确认下载后，更新包会在后台校验，有生成任务时会等任务结束再切换。
失败时保留旧版本并恢复服务。应用更新不会覆盖画布 JSON、素材、密钥或 `.local-public.env`。

更新检查可通过以下环境变量调整：

```text
SUPERCANVAS_UPDATE_ENABLED=true
SUPERCANVAS_UPDATE_REPOSITORY=moshangqingchen/CanvasMind
SUPERCANVAS_UPDATE_BRANCH=main
SUPERCANVAS_AUTO_SYNC_SOURCE=true
SUPERCANVAS_UPDATE_INTERVAL_SECONDS=60
SUPERCANVAS_GITHUB_TOKEN=
```

源码部署跟踪普通分支 push，不要求创建 Release；默认每 60 秒读取一次远程提交。Token 只在需要
查询正式 GitHub Release 和下载 Windows 更新包时使用。若要让独立安装包获得新版本，仍需发布
带 `v` 前缀且与 `package.json` 对齐的 Release。开发源码热更新仍使用 `pnpm public:watch`。

首次运行会先构建密钥迁移工具、生成 `.local-public.env` 和本地 JSON 数据库；已有配置项会原样保留，只补齐缺失的本地默认项和空的 `MASTER_KEY`。脚本不再写入固定公网域名；如需反向代理，请自行设置 `PUBLIC_BASE_URL` 和登录变量。只有确实迁移旧开发主密钥加密的连接时才会在 `backups` 中留下备份。

管理器会监听 Web 运行代码、共享 packages 源码、项目依赖配置和 `.local-public.env`。文件停止变化 2 秒后，它会在备用 `.next-live-*` 目录完成生产构建；只有构建成功且源码在构建期间未再次变化时，才会停止旧进程并使用新进程接管 3210 端口。构建失败时保留当前可用服务，修改源码后自动重试。`apps/web/data`、`apps/web/storage`、测试文件和构建产物不参与监听，因此画布自动保存和素材写入不会触发服务重启。

本地 JSON 持久化会合并并发快照写入，避免自动保存排队持有多份完整数据库。每个画布保留最近 20 条失败或待处理运行的完整恢复快照；更早的运行记录、状态、错误和输出仍保留，但不再允许从旧快照恢复。管理器默认给 Web 进程设置 2048 MB 堆上限，必要时可通过 `SUPERCANVAS_NODE_MAX_OLD_SPACE_MB` 调整；进程异常退出后会自动重启。

该常驻管理器依赖 Windows PowerShell、`Get-NetTCPConnection`、CIM 和 Windows 命名互斥体，只支持 Windows。macOS/Linux 请使用 `pnpm dev` 或 Docker Compose。Windows 当前用户的登录自启动项可调用同一个 `scripts/start-local-public-managed.ps1`；重复启动的实例会作为热备等待，主管理器退出后自动接管。

`apps/web/proxy.ts` 是 Next.js 的请求前置层，负责登录门禁、跨站写请求拦截和安全响应头；对应的用例在 `apps/web/proxy.test.ts`。

## 当前边界

- 单用户、手动运行；只有一个共享账号，没有多用户、权限、协作、计费、循环/条件分支或时间线剪辑。
- 登录限流是单进程内存实现，只覆盖默认的单容器部署；多副本部署需要换成共享存储的限流器。
- `PUBLIC_BASE_URL` 未配置时 Webhook 路由返回 404；OpenAI、Runway 和 Fake 默认依赖轮询，通用 REST 可按 Connector 配置使用 HMAC-SHA256 Webhook。公网部署仍需自行提供 HTTPS 和域名白名单。
- 归档下载器自动兼容 Clash/Mihomo 的 HTTPS Fake-IP DNS，并逐跳校验海外 CDN 跳转；IP 直连、HTTP Fake-IP、HTTPS 降级和真实私网地址仍会被拒绝。
- `/api/health` 检查数据库与对象存储；Redis 由 Compose 自身健康检查覆盖，仍不探测外部 Provider。
- 单个 Docker Worker 是默认部署边界。跨多个 Worker 实例的严格分布式执行租约尚未实现，因此不要水平扩容 Worker。
- CORS 默认只允许 `localhost:3000` 和 `localhost:3210`；修改 Web 端口时要同步更新 MinIO CORS。

这些限制及上线前检查清单详见 [自托管与运维](docs/self-hosting.md)。
