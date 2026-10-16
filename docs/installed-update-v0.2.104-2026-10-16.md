# 本地覆盖安装 v0.2.104（2026-10-16）

归档日期：2026-10-16；实际证据为 2026-10-16 UTC（America/Los_Angeles 为 2026-10-15）。本次仅用户本机覆盖安装，没有推送 GitHub、创建公开 Release、commit、充值或收费生成。

最终 BUILD_ID：`4COLoavjnPh_6sGCUjsyi`。最终安装器 SHA-256：`f5db6dc47838bea761422208720e88f85a3cb04b12bad619a2d94e30208a00f9`，大小 **267,899,065 字节**。最终覆盖安装器于 2026-10-16T03:28:24.6200229Z 正常退出，退出码 **0**，实际版本 **0.2.104.0**，BUILD_ID 与最终包一致。原安装位置为 `%LOCALAPPDATA%/Programs/SuperCanvas/SuperCanvas.exe`。

首轮安装 BUILD_ID 为 `hQalDMUoCXXv_hFBSHU4k`。实际窗口验收发现 Synora 125 漏尺寸控件后，补齐精确数据合同、重跑增量验证、重新打包，并先做第二份独立完整备份，再覆盖同版本终版。首轮安装及其截图保留为过程证据，不能冒充终版新合同已经验收。

本轮包含内存泄漏修复、拖动／平移／缩放提速、浅色／深色主题、磨砂悬浮岛、灵动岛、一键整理与供应商变化接入。自动收费边界同步修复：启动、新 Key 与目录刷新不消费排队核验项发起收费生成；已有任务保留免费查询和归档，明确执行单项仍只提交所选任务一次。

## 源码与打包验证

共享包构建、全工作区类型检查、renderer lint、生产界面与 Windows 安装器构建均有通过证据。根目录和桌面包版本均为 0.2.104，更新说明随包。最终工作树及暂存区 `git diff --check` 均通过，退出码 0，见 `git-diff-check.json`；构建与差异静态检查分别留证。

| 验证范围 | 通过 | 跳过 | 采用的证据 |
| --- | ---: | ---: | --- |
| core | 30 | 0 | `core-tests.log` |
| db | 50 | 0 | `db-tests.log` |
| storage | 27 | 0 | `storage-tests.log` |
| providers（最终补丁后全套） | 3342 | 0 | `synora-fix-providers-tests.log` |
| runtime（最终共享包后全套） | 503 | 0 | `synora-fix-runtime-tests.log` |
| director | 24 | 0 | `director-tests.log` |
| renderer API／lib／proxy | 3528 | 7 | `renderer-tests.log` |
| cloud-generation | 24 | 0 | `cloud-tests-final.log` |
| Electron 桌面单元 | 116 | 1 | `desktop-tests-final.log` |
| 维护边界 | 12 | 0 | `maintenance-tests.log` |
| e2e 辅助程序 | 12 | 0 | `e2e-helper-tests.log` |

单元及辅助测试合计 **7,668 项通过、8 项跳过**。Synora 增量另跑 renderer 关联 30 项通过，这是原 renderer 集合的重复定向验证，不重复计入合计。providers／runtime 两包最终 typecheck 通过。未变化的长测试未再次重复跑。`validation-results.json` 保留首次桌面测试失败，最终桌面／云端结果以各自 final 日志为准，不把初次汇总写成全绿。

浏览器 e2e：**527 项通过、36 项条件跳过、6 项性能用例失败**。六项触发原有“至少 6 GiB 空闲内存”的环境前提，未改门槛、不写成全套通过。`e2e-summary.json` 与 `performance-invalid-memory/` 保留环境无效样本。用户给定日常空闲约 3 GB 的精简性能验收：拖动／平移／缩放 P95 约 17–33ms，磨砂未造成退步；该结果与环境无效的全量基准分别记录。此全套 e2e 在 Synora 最后小补丁前运行，之后采用精确回归、两包全套和实际安装版收尾，不冒充又跑了一遍全套。

最终包再次完成 **29 项打包冒烟＋4 项普通可见窗口冒烟**，见 `smoke-report-final.json`、`smoke-windowed-report-final.json`。包含无系统 PATH 的 Node／媒体工具、固定本地视频解码、Fake 任务、原文件下载与窗口恢复。全部使用独立临时 profile；这些隔离检查不代表正式安装版供应商或真实收费输出成功。

## 两轮备份与覆盖安装

首轮：备份 `C:\Users\Administrator\AppData\Local\SuperCanvasDesktop\backups\before-local-update-v0.2.104-20261016T025331Z\profile`，**2,360 文件／1,167 目录／3,782,631,110 字节**，逐 SHA-256 核对，正式进程为 0。首轮安装退出码 0，首次启动前完整目录和字节一致；另保留 490 字节的加密 Chromium Local State 伴随备份。

终版第二轮：已包含新建的 7 个 Key 对应的加密连接资料、目录同步和验收设置。独立完整备份为：

`C:\Users\Administrator\AppData\Local\SuperCanvasDesktop\backups\before-local-update-v0.2.104-20261016T032552Z\profile`

**2,360 文件／1,195 目录／3,785,282,534 字节**；备份完成 `2026-10-16T03:26:09.430Z`，安装前复核 `2026-10-16T03:26:50.034Z`，终版覆盖后首次启动前复核 `2026-10-16T03:28:40.040Z`。三次均 verified=true、正式进程为 0。数据库 SHA-256：`f792169acb04e2ed73f7d9b66c8a659ab5c91d74d6d813fcf11af718c75f905f`。完整 profile 的目录清单、文件长度、SHA-256 与该轮备份一致，保护新接入的 7 组资料。

第二轮最初一次备份保护脚本因残留“来源必须 0.2.103”的断言而中止；修正为实际来源 0.2.104 后才建立上述成功备份。失败回执保留 `final-install/backup-failure.json`；不能将失败尝试当成备份成功。

“逐字节相同”只适用于每次首次启动前。启动后已授权目录同步、新连接及正常保存会改变数据库，改按身份、密文、画布参数、素材与历史记录逐项核对，不能宣称最终数据库与最初备份完全不变。

## 新建 Key 与连接

已逐组检查同组现有 Key／连接后，**新建并绑定 7 个 Key、7 个连接**；旧连接 ID 和原 Key 归属保留。以下仅列名称、分组与当前读取结果，不含凭据明文。

| 站点 | 官方分组 | Key 名称 | 连接名称 | 免费目录结果 |
| --- | --- | --- | --- | --- |
| https://synoralink.com | 125 · adobe全参生图 | `SuperCanvas-adobe全参生图-20261016` | Synora · adobe全参生图 · 画布 | 终版 API 三型号均有 size／aspect_ratio／quality／n；截图 14／15 已确认档位、比例、W/H、max 与菜单 |
| https://tu.988236.xyz | 字符串分组 · ad高质量image2 | `SuperCanvas-ad高质量image2-20261016` | 辰途 API · ad高质量image2 · 画布 | Key 目录 HTTP 200：4 个图片型号；已截图菜单、尺寸、质量与报价 |
| https://api.hangzhale.com | 104 · Gemini-Ultra-美国大豆包 | `SuperCanvas-Gemini-Ultra-美国大豆包-20261016` | 夯炸了 · Gemini-Ultra-美国大豆包 · 智能体 | 免费 /models 余额拒绝；智能体仅保留 5 个 source=catalog、available=false 条目，不是当前 Key 成功；未充值 |
| https://vapi.chuangxiangai.asia | 56 · claude【kiro power】 0.2x | `SuperCanvas-claude【kiro power】 0.2x-20261016` | 创想ai · claude【kiro power】 0.2x · 智能体 | Key 目录 HTTP 200 返回 7 个 Claude；程序已移除 Claude／Anthropic 支持，全部过滤，当前智能体不可选 |
| https://vapi.chuangxiangai.asia | 57 · deepseek高缓 0.15x | `SuperCanvas-deepseek高缓 0.15x-20261016` | 创想ai · deepseek高缓 0.15x · 智能体 | 最终智能体有 5 个 DeepSeek，source=key、available=true |
| https://vapi.chuangxiangai.asia | 58 · gpt不降智福利-astra不降 0.12x | `SuperCanvas-gpt不降智福利-astra不降 0.12x-20261016` | 创想ai · gpt不降智福利-astra不降 0.12x · 智能体 | 本地身份竞态 409 补读恢复；最终智能体 6 个 GPT，source=key、available=true；价格仍失败 |
| https://vapi.chuangxiangai.asia | 59 · Gemini-ultra 0.25x | `SuperCanvas-Gemini-ultra 0.25x-20261016` | 创想ai · Gemini-ultra 0.25x · 智能体 | 最终智能体有 16 个 Gemini，source=key、available=true |

创建确认见 `key-creation-followup.json`，连接确认见 `new-connections-final.json`；创想四组稳定身份读回见 `new-connection-binding-readback.json`。未设置额度、未充值、未删除或重绑旧 Key。HTTP 200 返回条目不自动等于上游本次实时读取成功，最终状态必须结合连接 `modelScanStatus / modelScanAttemptStatus / UpstreamErrorCode` 读回；已按 `connection-states-final.json` 区分保存状态，不能将其一概当本轮实时成功。

### 智能体入口的实际读回与程序限制

最终 `GET /api/agent/models` 为 HTTP 200，`new-agent-models-final.json` 中 32 个新组相关条目：创想 57／58／59 合计 **27 个 source=key、available=true**；夯炸了 104 另外 **5 个 source=catalog、available=false**，原因“此模型尚未由当前 Key 返回，请刷新供应商模型”。这五个保留项不能作为当前 Key 实时成功或智能体可选能力。

创想 56 的 Key 与连接已正确绑定，免费 Key 目录确实返回 `claude-opus-4-6`、`claude-opus-4-7`、`claude-opus-4-8`、`claude-opus-5`、`claude-opus-5-5`、`claude-sonnet-4-6`、`claude-sonnet-5`。七个完整 ID 全部被现有 `agent-model-support.ts:8–12` 过滤，原因“Claude / Anthropic 支持已移除，请重新选择受支持的模型和连接”。**这是程序现有产品范围限制，不是账号、Key 或供应商故障，不能写成已经在智能体可选。** 本轮按“纯文本型号只在智能体用到时接”的范围，没有恢复已移除的 Claude／Anthropic 功能，列为当前限制／未完成项。

## 正式目录同步与安装版 API

终版安装后又正常重启一次；`installed-final-acceptance.json` 于 2026-10-16T03:39:54.198Z 确认版本 0.2.104、原 4 张画布／31 个节点、180 条连接，以及 7 个新连接均保留对应 Key 身份。`package-identity-final.json` 核对正式安装文件与最终包一致，BUILD_ID 为 `4COLoavjnPh_6sGCUjsyi`。健康接口 HTTP 200，活动生成、收费核验、云恢复、写入均为 0；浏览器错误及拦截到的生成提交均为 0。该重启沿用正式 profile，保留用户原来的“跟随系统”设置。

最终保存的 180 条连接状态为 **live 139、unauthorized 30、failed 7、empty 4**，见 `connection-states-final.json`。这是当前保存状态全体，包含未在本轮刷新而保留的旧记录，不能全部算作本轮实时成功。failed 七条中六条为夯炸了余额拒绝（含 104 和五个旧组），另一条为 secure-skill 的 cc-max 智能体目录网络失败；应用即便 HTTP 200 返回历史型号，也保留失败事实。

受影响官网目录扫描 13 家；创想首轮因登录未完成而失败，随后在终版免费重读恢复 live／局部（保存 46 个分组条目，含旧快照），总共 14 次扫描处理均返回本地 HTTP 200。以下按最终保存状态列出。HTTP 200 仅说明应用完成扫描处理，不代表该站所有官方资料或所有 Key 可用。

| 供应商 | 本地扫描 HTTP | 实际 scanStatus | scanComplete | 保存分组数 |
| --- | ---: | --- | --- | ---: |
| Synora | 200 | live | false | 22 |
| 辰途 API | 200 | live | true | 48 |
| 夯炸了 | 200 | live | true | 17 |
| 创想ai | 200 | live | false | 46 |
| 喵呜 API | 200 | live | true | 8 |
| secure-skill | 200 | live | true | 37 |
| 佳速api | 200 | live | true | 1 |
| 极九api | 200 | live | true | 14 |
| 沧元算力 | 200 | live | true | 24 |
| FriModel | 200 | live | true | 29 |
| We-AI | 200 | live | true | 12 |
| 赛博阿飞 API | 200 | live | true | 17 |
| 词元 | 200 | live | true | 3 |

Synora 官网为局部资料，当前 Key 125 已独立返回实际 3 个图片型号；创想首轮失败保留旧有效目录，终版重读已恢复分组读取但广场仍不完整，58／59 的官网型号仍为 0，与同组 Key 的 6／16 型号独立记录。智元账号登录失效未绕过，现有官方快照状态 unauthorized；MikotoPro 的既有官网目录仍为局部。其余未受影响站点保留既有资料，未把 13 家改写为全部配置站点都完成新扫描。

逐 Key 模型刷新首轮共 **156 次**：HTTP 200 128 次、HTTP 401 1 次、HTTP 403 25 次、HTTP 409 1 次、HTTP 502 1 次。其中 **28 次非 2xx**；创想 58 的 409 为本地连接身份并发变化，旧响应被丢弃，补读已 HTTP 200 返回六个 GPT 型号。剩余 **27 次首轮非 2xx**为认证／权限／组删除／余额问题。`model-sync.json` 的 phase=complete 只表 HTTP 200；某些 200 返回的是保留目录，尤其夯炸了旧组仍有 failed／余额错误，实时与保留状态按最终连接状态表逐项判定，绝不写成 128 个目录全部实时成功。

### 逐 Key 首轮非 2xx 清单

| 连接／分组 | HTTP | 原因／当前处理 |
| --- | ---: | --- |
| 沧元算力图像 API | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 赛博阿飞 API · gpt5.6-破甲版 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 辰途 API · 兜底原生生图 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 喵呜 API · vip | 401 | 当前 Key 鉴权失败，请更新 Key 后重新刷新；原有配置已保留 |
| 辰途 API · 无敌稳定Pro · 导演台 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 辰途 API · az兜底渠道1k生图 · 画布 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 沧元算力 · GLM · 画布 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 辰途 API · 纯血ccmax · 智能体 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 辰途 API · CC-MAX-企业版-CC Test满分 · 智能体 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 辰途 API · 0.13特惠Pro号池 · 智能体 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| secure-skill · video-企业版 · 画布 | 403 | 当前账号不允许使用此 API Key 所属分组，请检查分组权限；原有配置已保留 |
| secure-skill · seedream-5.0-pro图片模型 · 画布（稳定组 35） | 403 | 当前账号不允许使用此 API Key 所属分组，请检查分组权限；原有配置已保留 |
| secure-skill · wan3视频 · 画布（稳定组 40） | 403 | 此 API Key 所属分组已删除，请选择当前可用分组；原有配置已保留 |
| secure-skill · image2-官key · 画布（稳定组 41） | 403 | 当前账号不允许使用此 API Key 所属分组，请检查分组权限；原有配置已保留 |
| secure-skill · sd-2.5-特价 · 画布（稳定组 42） | 403 | 当前账号不允许使用此 API Key 所属分组，请检查分组权限；原有配置已保留 |
| secure-skill · flow-大户 · 画布（稳定组 47） | 403 | 当前账号不允许使用此 API Key 所属分组，请检查分组权限；原有配置已保留 |
| secure-skill · image2.5特价 · 画布（稳定组 49） | 403 | 此 API Key 所属分组已删除，请选择当前可用分组；原有配置已保留 |
| 夯炸了 · Claude-Max 特价 · 画布（稳定组 22） | 403 | 当前账号不允许使用此 API Key 所属分组，请检查分组权限；原有配置已保留 |
| FriModel · gpt_image_leo · 画布 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| FriModel · gpt_image_adobe_外接 · 画布 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| Synora · OAI官Key生图 · 画布（稳定组 119） | 403 | 此 API Key 所属分组已删除，请选择当前可用分组；原有配置已保留 |
| 沧元算力 · VIDEO-Seedance官转 · 画布 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 辰途 API · sora，veo，omni视频 · 画布 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| 辰途 API · klingsd视频 · 画布 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| FriModel · Seedance2.0 · 画布 | 403 | 当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留 |
| secure-skill · video-企业版 [分组ID 16] · 画布（稳定组 16） | 403 | 当前账号不允许使用此 API Key 所属分组，请检查分组权限；原有配置已保留 |
| 夯炸了 · Gemini-Ultra-美国大豆包 · 智能体（稳定组 104） | 502 | 供应商账户余额不足，暂时无法读取模型目录，请补充余额后重新刷新；原有配置已保留 |
| 创想ai · gpt不降智福利-astra不降 0.12x · 智能体（稳定组 58） | 409 | 接口识别期间连接已改变，旧结果已丢弃；已补读 HTTP 200，6 型号，价格仍失败 |

### HTTP 200 返回空目录

以下仅记录本次返回 0 项，不判为删除，不清除历史引用：

- secure-skill · grok视频-备用 · 画布（稳定组 34）
- FriModel · gpt_image_web_4 · 画布
- 辰途 API · vip · 画布
- 基因形象 · image2.5_0.2分组 · 画布

### Synora 125 的实际接入漏项及修复

首轮真实参数卡只有质量，没有档位／比例／W/H，属于程序漏接，截图 04 保留失败证据。原因是站点精确 Images 路由只覆盖 99／115／119，漏了 125，用户预设投影因无 size 参数而直接返回。

终版为 stable 125 的 `gpt-image-2`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` 单独匹配本站通用 Images 的已有 size 字段；不借 99 的 medium 或 115 的固定档位。1K／2K／4K、11 比例和 W/H 为用户指定应用预设，质量最高分别 high／max；未补造供应商逐档像素声明。

官方 DocsView 免费读回 HTTP 200，SHA-256 `7b7f1bd22df5a7d896d9385d0b5416a3b0f2531072b47c085c2925f8e740fb9f`，与 10-14 一致；文档更新时间 2026-07-12，与采样时间分开。Images 章节给出生成、编辑路径与 size 示例；示例 1024x1024 未当完整枚举。精确新增回归 4 项，三型号共 9 次 mock 请求；最终 providers 全套 3342、runtime 503、关联 renderer 30 均通过。终版 `synora125-models-final.json` 已读回：三个完整型号均有 `size / aspect_ratio / quality / n`，1K／2K／4K 每档各 11 个比例尺寸选项；gpt-image-2 质量默认 high，两个 2.5 型号默认 max，预设来源为 user-request。真实安装窗口截图 14／15 已确认档位、11 比例、W/H、max 与型号菜单恢复；这三类证据均不称收费生成成功。

## 原资料保护与唯一授权停用差异

`protected-data-after.json` 于 2026-10-16T03:39:17.744Z 最终核对：原 173 条连接的 Key 密文和归属、默认型号一致；原 4 张画布内容及参数、35 条版本、569 项素材、533 条运行／533 条节点运行、智能体历史完整保留。仅新增 7 条连接使总数 173→180；新增实际运行为 0，新增核验提交为空。

两个本次创建的独立验收画布已按精确 ID／名称通过应用 API 删除，未对原画布执行删除；临时版本和目录一并清理。最终画布数恢复 4、版本数恢复 35；`qa-canvas-cleanup.json` 和重启后的首页截图 19 留证。严格守护仍列下述授权用途变化，`protected-data-disposition.json` 确认没有其它未解释差异。

明确登记唯一守护差异：连接 `ee78c538-4f53-40fd-ba7e-4331791fb7d7`，赛博阿飞 `gpt-pro-0.15`，usage 从 `canvas` 改为 `disabled`。当前 Key 仅有 13 个文本型号、没有媒体输出协议，因此按本轮已授权目录停用画布选项；连接 ID、Key 密文、历史任务、原默认型号保留。**不是零差异，也没有替换 Key 或重建旧连接。**

## 实际安装版截图索引

共 19 张原始安装窗口截图。01–13 为首轮同版本初始 BUILD_ID；14–19 为最终 BUILD_ID。04 是实际发现漏项的失败证据，14／17 是修复后的通过证据。其余主题及辰途／极九组件代码在最后数据层补丁后没有改变。截图原始编码为 JPEG，未重编码；文件后缀已按真实编码登记为 .jpg，SHA-256、窗口及采样时间见 `screenshots/index.json`。

| 文件 | 范围 |
| --- | --- |
| `screenshots/01-home-light.jpg` | 浅色首页 |
| `screenshots/02-home-dark.jpg` | 深色首页 |
| `screenshots/03-canvas-dark-island.jpg` | 深色画布及收起的灵动岛 |
| `screenshots/04-synora125-parameters-initial-gap.jpg` | Synora 125 首轮尺寸漏项，保留失败证据 |
| `screenshots/05-synora125-model-menu.jpg` | Synora 125 首轮三个完整型号 |
| `screenshots/06-chentu-ad-4k-price.jpg` | 辰途 ad 4K 型号、档位与报价 |
| `screenshots/07-chentu-ad-4k-size.jpg` | 辰途 4K 比例尺寸与独立 W/H |
| `screenshots/08-chentu-ad-full-image-controls.jpg` | 辰途 high、PNG、生成模式和对应报价 |
| `screenshots/09-chentu-ad-model-menu.jpg` | 辰途 ad 四个完整型号与价格 |
| `screenshots/10-jijiu-image-4k-high-price.jpg` | 极九 4K／high 与报价 |
| `screenshots/11-jijiu-model-menu.jpg` | 极九完整型号及分组 |
| `screenshots/12-canvas-light-island.jpg` | 浅色画布与悬浮岛 |
| `screenshots/13-island-light-expanded.jpg` | 浅色灵动岛展开 |
| `screenshots/14-final-synora125-full-size-quality.jpg` | 终版修复：档位、比例、W/H、max |
| `screenshots/15-final-synora125-model-menu.jpg` | 终版 Synora 125 完整型号菜单 |
| `screenshots/16-final-canvas-dark.jpg` | 终版深色画布 |
| `screenshots/17-final-synora125-dark-controls.jpg` | 终版深色 Synora 125 完整尺寸／质量控件 |
| `screenshots/18-final-island-dark-expanded.jpg` | 终版深色灵动岛展开 |
| `screenshots/19-final-home-original-projects.jpg` | 终版正常重启、跟随系统、清理后原 4 张画布 |

## 未完成项与用户账号条件

- 参数卡首次冷打开约 **0.46–0.54 秒**，未达 **0.2 秒**；用户明确不阻塞发布，继续列为未完成项。
- 六项全量性能用例未满足 6 GiB 空闲内存前提；不称完整性能基准通过。
- 夯炸了 104 新 Key 目录曾 HTTP 502，最终持久状态 failed／403／余额拒绝；未充值。智能体保留五个 available=false 的 catalog 条目。五个旧夯炸了组也是 failed／余额错误，HTTP 200 保留历史目录不能当成功。
- 创想 58 补读恢复 6 型号，但对应价格查询失败，缺价格留空／保留事实，不补造数字。
- 创想 56 的七个 Claude 型号在 Key 目录返回，但程序已移除 Claude／Anthropic 支持而全部过滤，当前智能体不可选。该项是程序范围限制／未完成项，本轮不恢复已移除功能，不归因账号或供应商。
- 喵呜 vip HTTP 401；沧元、辰途、FriModel、赛博阿飞等 HTTP 403 的精确组见上表，需要账号／Key 分组权限恢复。
- secure-skill 和 Synora 的已删除组保留旧连接与历史，不跨组重绑；智元登录失效需用户恢复对应账号。
- 创想终版免费扫描首次发现稳定组 60「gpt不降智-fast/ultrafast专线 0.3x」，当前官网模型 0。本次首次发现，无法确认何时新增；不在 10-14 交接的建 Key 清单内，本轮未为该组查重、建 Key 或扩接。该组完整型号及精确协议／计价条件留待后续检测。
- Synora 125 当前分组说明价格保留供应商原文及“分组说明参考”，未标币种和各质量／尺寸附加条件时不补造总价；透明／编码等缺少该精确组独立证据的能力未写成实测成功。

真实收费图片／视频生成、编辑、续写：**0 次**。`protected-data-after.json` 的新增运行数 0、新增核验提交为空与建 Key 操作回执分别留证；Fake／固定 CLI 冒烟不算真实收费输出。

## 证据索引

证据根目录：`C:\Users\ADMINI~1\AppData\Local\Temp\claude\D--project-development-----\bb3d85ed-297b-4492-96b8-bd4bfa879d47\scratchpad\release-v0.2.104-2026-10-16`。

- 最终源码增量：`synora-fix-validation-summary.json`、`synora-fix-*.log`；未变长测试采用原各包最终日志。
- 最终打包：`desktop-build-final.log`、`package-summary-final.json`、`package-identity-final.json`、`smoke-report-final.json`、`smoke-windowed-report-final.json`。
- 首轮保护：`backup-summary.json`、`verify-summary.json`、`compare-summary.json`。
- 终版保护与覆盖：`final-install/backup-summary.json`、`final-install/verify-summary.json`、`final-install/installer-result.json`、`final-install/compare-summary.json`。
- 接入：`new-connections-final.json`、`new-connection-binding-readback.json`、`key-creation-followup.json`、`key-preparation-index.md`。
- 同步：`sync-progress.json`、`catalog-sync-final.json`、`model-sync.json`、`chuangxiang58-models-final.json`、`synora125-models-final.json`、`connection-states-final.json`、`new-agent-models-final.json`、`protected-data-after.json`、`protected-data-disposition.json`、`qa-canvas-cleanup.json`、`installed-final-acceptance.json`、`final-build-model-readback.json`。
- 官方合同：`synora125-official-docs.js`、`synora125-official-docs-receipt.json`；截图：`screenshots/index.json`。

四类证据分别成立：源码验证见测试日志；安装版 API 读回见最终目录／连接／重启记录；安装版界面验收见 19 张真实截图；真实收费生成本次为 0。源码、API 或界面证据均不冒充收费成功。
