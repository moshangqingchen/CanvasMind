# 超级画布

超级画布是一个面向个人创作的 Windows 桌面 App。它把素材、结构化 Prompt、图片生成、视频生成和结果预览组织在一张类型化 DAG 画布上，并通过统一 Provider Adapter 接入外部 API。

当前专注 Windows 10/11 x64 桌面版：安装包内置运行环境，提供独立窗口、托盘后台运行、旧资料迁移和应用内更新。画布、素材、连接与运行历史保存在本机；AI 生成通过已配置的供应商 API 联网执行，也可用内置 Fake Provider 验证流程。第三方结果先归档到本地，再释放下游节点。

安装、资料备份及更新说明见 [Windows 桌面 App](docs/windows-desktop.md)。项目仅保留桌面 App；画布界面和本地 API 位于 `apps/desktop/renderer`，由 Electron 启动，不提供独立网页服务。

## 已实现能力

- 五类节点：素材输入、Prompt、图片生成/编辑、视频生成、结果预览。
- 文本、图片、图片数组、视频、视频数组、音频、音频数组端口；连线时检查类型、数量和环路。
- Tiptap 结构化 `@素材`，保存不可变 `assetId` 和引用角色，不依赖素材 URL 或名称。
- 单节点运行、下游运行和整张画布运行；节点右键可直接运行、复制、原地复制和删除。
- 自动保存并在顶栏显示真实保存状态、撤销/重做、结构 JSON 与含素材完整项目包导入/导出、运行历史和结果版本保留。
- 平面设计工作台：制作海报、宣传图和活动物料，填写文案与品牌要求，添加 Logo/主体/风格参考，按模型支持的尺寸准备多个版式或直接生成，也可带入旧图改版。使用说明见 [平面设计](docs/graphic-design.md)。
- 图片设计评审：历史图片支持按名称、备注和状态筛选，2–4 图并排比稿、同步缩放查看，保存候选/定稿/淘汰及修改备注，并从选定版本创建新的图片编辑工作流。使用说明见 [图片比稿与定稿](docs/image-design.md)。
- 画布画笔图层：自由涂鸦、框选、拖动，并可把选中笔画合并成图片素材节点。
- 统一创作智能体：复用供应商分组中已保存的连接，选择对话模型进行文案、分镜和识图；媒体方案先放入画布，预检并确认后才生成。使用说明见 [通用创作智能体](docs/creative-agent.md)。
- 素材管理拖入桥接：从外部素材管理器拖动文件到画布即可登记为素材节点。
- OpenAI 图片、We-AI 图片、Runway 视频、喵呜视频、沧元算力图像、赛博阿飞、辰途、MikotoPro、FriModel、通用 REST 和 Fake Provider。
- 沧元、赛博阿飞、辰途、喵呜实时抓取模型广场目录与价格；五家国内网关另按当前 Key 实时扫描可调用模型，设置面板提供“刷新目录”按钮，已下架或无权限的模型在付费提交前拦截。
- 本地运行快照、客户端幂等 ID、任务恢复、取消、轮询、SSE 状态和输出归档。
- API Key 仅在本地后端解密使用，数据库保存 AES-256-GCM 密文；主密钥由 Windows DPAPI 保护，界面只显示掩码。

## 工作台与供应商管理

启动 App 进入工作台，可创建、搜索、排序、重命名和删除画布。编辑器采用深色点阵画布、悬浮创作工具栏与可收起的智能体面板，顶部显示实际保存状态。连线使用平滑曲线，只有点选节点或连线后，对应路径才显示柔和的连续渐变流光；点空白处取消。底部可切换连线、小地图、暂停动效并查看缩放比例。支持系统减少动态效果偏好。智能体面板的创作灵感按钮只填写可编辑草稿，不自动发送或生成。未完成保存的编辑会写入当前窗口的本地草稿，重新加载界面后尝试恢复；若资料已被其他窗口更新，则暂停自动保存并保留本地内容，可先导出当前副本，再选择放弃本地改动并载入已保存版本。

在首页或编辑器的「API 设置」中添加供应商名称、站点地址和 API 地址后，可「保存并扫描」或「仅保存」。扫描先识别 NewAPI、Sub2API 或兼容站点的公开分组与模型，再用各分组已保存的独立 Key 读取实际可用模型；公开目录、Key 结果和手动配置分别展示。扫描失败保留已有配置与历史结果，目录不再返回的分组会标记为历史，未扫描到时仍可手动添加分组。后台登录支持账号密码或访问令牌，凭据加密保存在本机，仅用于对应站点的模型、分组、价格与账务读取；生成任务使用分组的独立 Key。

- 手动模型必须填写准确 ID，并匹配当前连接的能力与协议；手动添加标记为未验证，不代表 Key 已获得权限。普通图片可使用 OpenAI Images，对话可使用 Chat Completions 或 Responses；Gemini 遵循已有分组协议和模型限制，REST 图片/视频沿用对应连接已保存或自动识别的调用协议。
- 画布生成与智能体对话复用已保存的分组 Key，按模型能力选择调用协议。Key 扫描成功但结果为空时保持为空，不使用公开目录伪装成可调用模型。

## 安装与启动

普通使用请安装 `SuperCanvas-Setup-版本-x64.exe`，从桌面或开始菜单打开“超级画布”。无需安装 Node.js、pnpm 或 Docker；首次启动可创建空白资料库，也可迁移旧仓库或旧安装目录中的资料。具体步骤见 [Windows 桌面 App](docs/windows-desktop.md)。

从源码启动需要 Windows x64、Node.js 24 和 pnpm 11。在仓库根目录执行：

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install
pnpm dev
```

`pnpm dev` 构建共享包和 Electron 主进程后启动带鉴权的 Next 开发服务，界面与本地 API 支持热更新，共享包自动监听编译；修改 Electron 外壳后重新运行。开发资料独立保存在 `%LOCALAPPDATA%\SuperCanvasDesktopDevelopment\profile`，首次自动创建空白库，关闭开发窗口会安全退出并停止服务与编译监听器。

需要检查生产构建时运行 `pnpm desktop:dev:production`。生产桌面 App 使用 `%LOCALAPPDATA%\SuperCanvasDesktop\profile` 保存资料，完整的历史资料可通过首次启动迁移导入。本次清理的旧网页资料保存在 `backups/legacy-web-profile-20260921`；已从历史归档找回 22 份素材，仍有 173 条缺少原文件的记录，需补齐后才能通过完整迁移校验。详见[桌面工程整理记录](docs/desktop-only-cleanup-2026-09-21.md)。

运行资源已经准备好且源码未变化时，可用 `pnpm start` 或 `pnpm desktop:start` 直接启动。开发桌面壳不安装在线更新；安装版通过 App 内的更新器升级。

## 基本工作流

1. 在左侧素材库添加图片、视频或音频，素材会归档到当前桌面资料库；也可从外部素材管理器拖动文件到画布。
2. 添加“素材输入”节点并选定素材，或添加 Prompt 节点，在编辑器输入 `@` 选择素材。Mention 可标记为参考素材、首帧或尾帧。
3. 从输出端口拖到兼容输入端口。拖到画布空白处会出现兼容节点菜单；不兼容端口、重复单输入和环路会被拒绝。
4. 添加图片或视频生成节点，在右侧“节点参数”中选择供应商、连接、模型与参数；“智能体”支持直接对话、分析素材和准备画布方案，媒体执行需要预检与确认。
5. 选择节点后运行当前节点或运行下游。范围外的上游会复用最近一次成功输出；没有可用输出时会在调用付费 API 前失败。
6. 也可在画布工具栏选择“运行全部”。生成结果自动进入素材库；历史记录中的任一输出可固定成不可变素材输入节点继续复用。

## 创作与交付

首页可直接进入活动海报、客户原图修改或多尺寸物料工作台。创作设置只保留统一供应商与模型管理、个人 AI 网站、素材通道和云端生图；旧版连接配置入口已移除，已有连接及加密密钥继续保留。

历史生成默认展示当前项目成果，可切换全部项目。在作品详情查看同一生成节点与明确改图关系中的版本、生成要求和客户原文；从某版继续修改会带入已保存的评审意见，不自动生成。

运行历史打开任务中心，查看进行中、需要处理和已完成任务、最近更新及新任务的提交阶段时间线。取回结果和恢复任务沿用原有恢复机制；诊断导出只包含任务状态、模型、阶段和错误代码，不包含提示词、素材内容或密钥。

平面设计支持保存常用方案，导出含参考素材的 `.supercanvas` 方案包，并按实际创建的图片节点展示批量价格估算。未知费用单列，不把账号累计消耗当成本次扣费。

定稿图片可在作品详情完成交付核对，导出原始图片及 `delivery.json`。检查由用户逐项确认，导出不重绘图片。完整项目包 v2 携带所引用图片的评审状态和备注，导入时建立新的评审版本，继续兼容 v1 项目包。使用说明见 [平面设计](docs/graphic-design.md)、[图片比稿与定稿](docs/image-design.md)。

智能体配置与使用请参阅 [通用创作智能体](docs/creative-agent.md)。旧导演会话以只读历史保留，知识快照维护仍可运行 `pnpm director:sync -- --source "D:\path\to\超级导演"`。

常用快捷键（应用内按 `?` 或 `Ctrl+/` 可随时打开这张表）：

| 操作               | Windows                    |
| ------------------ | -------------------------- |
| 运行当前节点       | `Ctrl+Enter`               |
| 从当前节点运行下游 | `Ctrl+Shift+Enter`         |
| 撤销               | `Ctrl+Z`                   |
| 重做               | `Ctrl+Y` 或 `Ctrl+Shift+Z` |
| 复制 / 粘贴节点    | `Ctrl+C` / `Ctrl+V`        |
| 原地复制选中节点   | `Ctrl+D`                   |
| 选中全部节点       | `Ctrl+A`                   |
| 立即保存画布       | `Ctrl+S`                   |
| 删除选中对象       | `Delete`                   |
| 抓手 / 画笔 / 选择 | `1` / `2` / `3`            |
| 缩放到适合全部节点 | `F`                        |
| 快捷键帮助         | `?` 或 `Ctrl+/`            |

输入框和 Prompt 编辑器内不会触发画布快捷键。

### 项目迁移与备份

右上角项目菜单提供两种格式：

- “导出项目”生成轻量 `.canvas.json`，只保存经过限额校验的节点、连线、视图和涂鸦。素材仍按当前实例的 `assetId` 引用，适合在同一素材库中制作模板。
- “导出完整项目包”生成 `.supercanvas`，会打包画布实际引用的图片、视频和音频，并在导入时上传为新素材、自动改写引用，适合跨实例迁移。压缩包及解压后内容上限均为 512 MB。

导入会先显示节点、连线、涂鸦、素材缺失等预检结果，不会直接覆盖当前画布；默认会先下载当前画布的 JSON 备份。只有素材齐全的完整项目包才允许继续，且新画布成功保存前不会替换界面；中途上传的素材会尽量自动回滚。

两种格式都不包含运行历史、供应商密钥、数据库 revision 或未被画布引用的素材，因此不能替代完整资料备份。备份桌面资料库及跨电脑迁移的注意事项见 [Windows 桌面 App](docs/windows-desktop.md#资料备份)。

## 供应商连接

个人网站还可通过「设置 → 个人 AI 网站」添加本地 CLI 连接，沿用 CLI 登录状态，并同步模型、分辨率和时长等参数。即梦提供待接入模板；模拟连接用于验证完整流程。接入协议和使用说明见 [个人 AI 网站 CLI](docs/personal-ai-cli.md)。

在右上角“设置”中新建连接，保存后先执行“测试连接”，再在生成节点中选择该连接。API Key 不应写入画布参数、项目 JSON、界面代码或 Connector 模板。

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
- 喵呜不接受文件字段或 `data:` URL，参考图片、视频或音频必须使用供应商可访问的公网素材地址。可在桌面创作设置的「素材通道」连接自有域名与现有 Cloudflare 隧道，由本机提供 1 小时有效的签名素材链接；未连接时会在付费提交前提示。纯文生视频不依赖该通道。
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

设置面板会提供一份可编辑的起始配置。Connector 的字段定义见 `packages/providers/src/rest.ts`；请求由 App 本地运行服务执行。

## 运行可靠性

- 每次运行冻结当前画布图，并使用 `canvasId + clientRequestId` 去重创建请求。
- 运行记录、任务快照和归档素材保存在本地资料库。重启 App 后根据已有远端任务 ID 和快照恢复轮询或归档。
- 远端是否已收到请求无法确定时，节点进入 `needs_attention`，系统不会盲目重提付费任务。
- 输出 URL 或 Base64 会先复制到本地存储；归档成功后节点才变为 `succeeded`。供应商已完成但解析或归档失败时保留任务快照并进入 `needs_attention`。
- 运行创建时会把自动选择的模型解析并写入冻结 revision；之后修改连接默认模型不会改变该运行。
- 局部运行从保存的成功节点记录查找最近输出，不依赖编辑稿中的临时 URL 或缓存字段。
- 关闭窗口后生成继续在托盘运行；从托盘退出时先保存画布，未完成任务需等待完成或返回 App。

## 内部 HTTP API

以下接口由 App 内置本地后端提供，供内嵌界面使用。后端仅监听回环地址，桌面主进程为请求附加本次启动的访问令牌；这些接口不是对外部署或远程访问入口。

| 方法            | 路径                        | 用途                       |
| --------------- | --------------------------- | -------------------------- |
| `GET`           | `/api/health`               | 本地服务、数据库与存储探针 |
| `GET`, `POST`   | `/api/canvas`               | 读取默认画布、创建画布     |
| `GET`, `PUT`    | `/api/canvas/:id`           | 读取或保存画布             |
| `GET`           | `/api/assets`               | 素材列表                   |
| `POST`          | `/api/assets/upload`        | 上传素材到本地资料库       |
| `GET`           | `/api/assets/:id/content`   | 读取归档素材内容           |
| `GET`, `POST`   | `/api/providers`            | 列出或保存供应商连接       |
| `DELETE`        | `/api/providers/:id`        | 删除供应商连接             |
| `POST`          | `/api/providers/:id/test`   | 测试连接                   |
| `GET`           | `/api/providers/:id/models` | 查询模型列表               |
| `GET`, `POST`   | `/api/runs`                 | 查询历史或创建运行         |
| `GET`, `DELETE` | `/api/runs/:id`             | 查询或取消运行             |
| `GET`           | `/api/runs/:id/events`      | SSE 运行状态               |

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

常用命令均在仓库根目录执行：

| 命令                                         | 用途                                          |
| -------------------------------------------- | --------------------------------------------- |
| `pnpm dev`                                   | 启动独立开发资料库、界面热更新和共享包监听 |
| `pnpm desktop:dev:production`                | 构建生产运行资源并启动 Electron |
| `pnpm desktop:lock`                           | 显式更新桌面运行依赖锁文件，需先构建界面 |
| `pnpm benchmark:repository`                  | 用隔离合成资料测试历史查询与全量保存 |
| `pnpm start` / `pnpm desktop:start`          | 启动已准备好的桌面运行资源                    |
| `pnpm build` / `pnpm desktop:build`          | 构建 Windows x64 安装包                       |
| `pnpm desktop:build --unpacked`              | 构建未安装版                                  |
| `pnpm desktop:test`                          | 运行桌面测试                                  |
| `pnpm build:runtime`                         | 仅构建内嵌 UI、API 与共享包，供跨平台质量校验 |
| `pnpm typecheck` / `pnpm test` / `pnpm lint` | 类型检查、单元测试、代码检查                  |

安装包输出到 `apps/desktop/release`。桌面运行与打包需要 Windows；`build:runtime` 用于共享代码和内嵌界面的构建验证，不产出安装包。

需要验证画布交互时，先执行 `pnpm build:runtime`，再执行 `pnpm --filter @super-canvas/desktop-ui e2e`。Playwright 会在独立的 `http://localhost:3211` 启停测试服务；它是内嵌界面的测试工具，不是用户启动入口。桌面发布验收项目见 [Windows 桌面 App](docs/windows-desktop.md#开发与验证)。

`pnpm clean:check` 预览可清理的路径、文件数和空间；`pnpm clean` 清理旧构建、测试输出、开发日志及旧测试部署的重复依赖，保留当前 `.next-desktop`、桌面 stage 和编译输出，清理后仍可 `pnpm start`。`pnpm clean:deep` 额外删除开发依赖和桌面打包中间产物，之后需要 `pnpm install` 和 `pnpm dev`。执行前先停止源码开发服务和测试；独立安装的 App 不受影响。

清理脚本不会删除画布、素材、密钥、备份、历史测试中的数据与原图、已安装 App 或安装包，也不会沿目录链接删除其他位置。完整资料备份使用 [桌面资料备份流程](docs/windows-desktop.md#资料备份)；历史存储清理脚本默认指向旧仓库数据目录，不用于日常桌面资料清理。目录用途与维护约定见 [项目维护](docs/project-maintenance.md)。

日常使用请通过安装器生成的快捷方式打开正式安装版，不要从项目中的旧程序副本启动。Dock 的目标也应保持与桌面快捷方式一致。2026-09-29 的旧程序、历史安装包与调试产物清理范围见[工作区整理记录](docs/workspace-cleanup-2026-09-29.md)。

仓库结构：

```text
apps/desktop       Electron 主进程、托盘、资料迁移、更新与打包
apps/desktop/renderer           桌面内嵌 Next.js 画布界面与本地 HTTP API（仍是 App 必需源码）
packages/core      图、端口、Prompt、状态机与重试规则
packages/db        本地 JSON Repository 与内存测试存储
packages/director  超级导演规划与内置知识库
packages/providers Provider Adapter 与密钥加密
packages/runtime   DAG 运行、恢复、归档与事件
packages/storage   本地素材与项目存储
infra/minio        历史对象存储配置，桌面运行不依赖
```

独立网站的登录、部署、网页更新、Docker、Worker、PostgreSQL 和 S3 实现已移除。内部界面沿用 React / Next.js，但仅供桌面 App 使用；所有请求均需 Electron 本次启动的会话令牌。

## 当前边界

- 当前支持 Windows 10/11 x64、单用户手动运行；没有多用户协作、计费、循环或条件分支、时间线剪辑。
- 通过供应商 API 联网生成，不附带本地 AI 模型。需要公网参考素材链接时，可使用「素材通道」接入自己的域名与 Cloudflare 隧道；无需 R2，原素材保存在本机。详见 [桌面使用说明](docs/windows-desktop.md)。
- 本地后端只监听回环地址，并使用每次启动生成的访问令牌；桌面资料库不提供远程共享入口。
- 电脑睡眠、关机或断网期间无法保证供应商任务完成；重启后按已保存记录恢复，提交结果不确定时需人工处理。
- 归档下载器自动兼容 Clash/Mihomo 的 HTTPS Fake-IP DNS，并逐跳校验海外 CDN 跳转；IP 直连、HTTP Fake-IP、HTTPS 降级和真实私网地址仍会被拒绝。
- `/api/health` 检查本地数据库与存储，不探测外部 Provider。
