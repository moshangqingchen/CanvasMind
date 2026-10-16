# 本地覆盖安装 v0.2.105（2026-10-16）

归档日期为 2026-10-16；证据时间使用 UTC。**已完成验证、完整备份、打包、本机覆盖安装、API 读回与实际窗口验收，正式版保持运行。** 用户自行退出后才进行备份，未关闭或强制结束其使用中的应用。

根目录、桌面包与实际安装版本均为 **0.2.105**（Windows 产品版本 0.2.105.0）。BUILD_ID：`F2yuXYGBBs34l6Orz14LM`。安装器 `apps/desktop/release/SuperCanvas-Setup-0.2.105-x64.exe`，大小 **267,332,294 字节**，SHA-256：`e1eb193366c74c05faa48df43e3b7e804a12fea208e2022fd861e71dcfafea08`。安装位置为 `%LOCALAPPDATA%/Programs/SuperCanvas/`。

本次保留当前画布布局，恢复炭灰与淡紫配色、紫色选中、细线和点选流光；修复单行图片工具条、失败说明换行、端口标签遮挡及拉远时媒体显示；删除旧导演入口、接口、服务、知识库和同步脚本，保留共享层与历史数据。更新说明为 `docs/releases/v0.2.105.md`。不改供应商业务逻辑、不建 Key、不改连接、不充值；不 commit、不推送、不发布公开 Release。

## 源码与构建验证

已通过且源码未再变化的检查按 SHA 审计复用；没有重复运行长测试。共享包构建、全工作区 typecheck 和 renderer lint 的已有最终通过依据为 scratchpad 的 `remove-director2.log`。本轮测试文件修正后又通过 renderer typecheck、lint。0.2.105 重新完成 Next 生产构建，编译内联版本已核对为 0.2.105。

| 范围 | 通过 | 跳过 | 依据 |
| --- | ---: | ---: | --- |
| core | 30 | 0 | 0.2.104 通过日志与源码 SHA 一致，复用 |
| db | 51 | 0 | 本轮全套，含旧导演历史原文保留回归 |
| storage | 27 | 0 | 0.2.104 通过日志与源码 SHA 一致，复用 |
| providers | 3342 | 0 | 删除旧导演后全套通过，源码未再变化 |
| runtime | 503 | 0 | 删除旧导演后全套通过，源码未再变化 |
| director 共享层 | 17 | 0 | 删除旧导演后全套通过，源码未再变化 |
| renderer API/lib/proxy | 3555 | 7 | 删除旧导演后全套通过，源码未再变化 |
| cloud-generation | 24 | 0 | 0.2.104 通过日志与源码 SHA 一致，复用 |
| Electron 单元 | 116 | 1 | 本轮全套 |
| 维护边界 | 11 | 0 | 本轮全套，旧同步脚本及其测试已删除 |
| 原有 e2e helper 单元 | 12 | 0 | 对应测试与运行时依赖未变化，复用 |
| 新流光诊断 helper | 3 | 0 | 本轮，覆盖新 light/beam、旧 dash、legacy-only 对照策略 |

合计 **7,691 项通过、8 项跳过**。最终 `git diff --check` 与暂存区同项检查通过。新构建后生产输入未变化，仅更新测试断言与诊断工具；详见 `source-manifest-initial.json`、`source-manifest.json`、`validation-summary.json`。

全量 e2e 共 **570 项**，单 worker、独立临时 profile，首次为 525 通过、36 跳过、9 失败。三项旧断言经修正与定向补跑全部通过：错误类型从连续文案改为详情标签和值检查；焦点颜色按控件作用域读取；兼容端口使用恢复后的紫色激活色。没有为通过检查改动业务代码或 CSS。

按不同用例合并最终结果为 **528 通过、36 跳过、6 失败**。剩余六项为 `canvas-performance.spec.ts` 的 prompt/mixed × 50/200/500 场景，均未满足原有 **至少 6 GiB 空闲内存**条件；采样空闲内存为 **2,411,778,048–3,149,086,720 字节**。保留原门槛、原始帧时与环境记录，不能据此声称完整性能基准通过。全量记录与定向复跑分别留证，没有把定向复跑写成重新全套通过。

打包冒烟的旧 dash 断言已适配 light/beam、CSS motion path 与端点/羽化检查，保留连续六帧移动和静态主线不变的覆盖。性能诊断补齐新版动画采样，保留旧 SVG 对照范围；未运行额外的显式诊断 A/B，因此不宣称得到新的诊断性能结论。

## 退出等待、备份与安装

正式版最初由用户使用中，未关闭或强制结束它。首次检查 `2026-10-16T06:12:23.718Z`，此后约每两分钟检查，90 分钟截止原定为 `2026-10-16T07:42:23.718Z`。用户自行退出，于 **07:24:33.9999059Z** 确认安装目录下进程为 0，无未解析的同名候选；实际等待约 72 分钟。检查仅按绝对安装路径识别进程，不读取命令行凭据。随后确认保存的运行/节点运行和收费核验均无在跑任务。

完整备份：

`C:\Users\Administrator\AppData\Local\SuperCanvasDesktop\backups\before-local-update-v0.2.105-20261016T072455Z\profile`

共 **2,384 文件、1,169 目录、3,817,014,346 字节**。备份完成并核对于 **07:25:12.785Z**；源目录稳定、备份逐文件长度与 SHA-256 相同。备份完成后才启动桌面打包。安装前复核 **07:32:05.699Z**，安装后首次启动前复核 **07:33:54.053Z**，均 verified=true，正式进程为 0，完整目录及所有文件字节与备份一致。数据库 SHA-256：`9cec4fd355a7a03fb346bb738453fb7a0d52c4ecf36e3b5c34a24b5fb0fc02fe`。

桌面壳、staging、NSIS 安装器与 `verify-release.mjs` 均通过。首次 staging 下载 Node 官方校验清单遇到 TLS 连接重置，改用系统 curl 从同一官方 URL 下载清单与许可证作为本次进程的本地输入，**保留原 staging 对 Node.exe 的官方 SHA-256 断言**。打包器首次因缺少 pnpm 入口无法解析依赖树；通过证据目录的 corepack shim 临时补充子进程 PATH 后通过。未改系统代理或 PATH；初次失败日志保留，没有重复已通过的 Next 构建或长测试。

最终 **29 项打包冒烟、4 项普通可见窗口冒烟**通过，均使用独立临时 profile，覆盖原文件下载、媒体工具、Fake/离线 CLI、流光六帧、重启和崩溃恢复。这些属于打包验证，不冒充正式资料的安装版界面或真实收费输出。

安装器于 **07:33:38.1974251Z** 正常退出，退出码 **0**；实际产品版本 0.2.105.0、BUILD_ID 与包一致。安装后的 SuperCanvas.exe、app.asar、Node.exe 与 BUILD_ID 文件逐项 SHA-256 对应验证包。首次正式启动使用既有 `%LOCALAPPDATA%/SuperCanvasDesktop/profile`；Chromium 正常使用其配套 `%LOCALAPPDATA%/SuperCanvasDesktop/browser`，未切换为 smoke profile。

启动后核对：**4 张画布、35 条版本、570 项素材、180 条连接、537 条运行与 537 条节点运行**，数量均与本次备份相同；上一轮原 180 个连接 ID 全部仍在，Key 密文、归属、默认型号和用途一致。素材、历史任务与旧历史记录逐项摘要一致；旧导演四表的 JSON 值文本 SHA-256 全部不变。新增运行数、收费核验提交数均为 0。

首次完整画布摘要检查因正常保存发生差异而非零退出，逐字段核清只有本次查看的原画布：选择/视口/保存版本变化，以及三张历史图片加载后正常记录的 `mediaAspectRatio` **1.792717086834734 → 1.797752808988764**、显示高度 **178.5 → 178**、测量高度 **179 → 178**。对应源码为 `workflow-node.tsx` 图片 onLoad 与 `canvas-app.tsx` 的 updateMediaAspectRatio；没有直接编辑 profile 或发送画布修改 API。补查 100% 缩放并返回首页后的最终复核于 **07:53:42.506Z** 通过，三张图片的上述预览数值已恢复为备份值，最终仅有选择/视口/保存版本变化。初次观察来自本会话工具输出；复核覆盖了同名 JSON，未单独保留首轮 JSON 快照，这一证据限制在 `data-audit-history.md` 明示。生成参数、提示词、型号、连接引用、素材引用、节点位置及边均无变化；`protected-data-disposition.json` 确认无未解释差异。启动后的数据库因正常应用保存及后台缓存读写而变化，不能再声称与启动前数据库逐字节相同。

旧历史保护边界：未改变的四张 director 表保留原 JSON 值文本；当前智能体确实修改同一表时正常序列化，旧记录语义保留。旧导演数据保留，旧导演 UI/API 入口移除，普通本地及项目聊天继续保留。

## 安装版 API 与界面验收

实际安装程序版本读回为 0.2.105；健康、生命周期、项目、连接、素材列表、智能体型号接口均 HTTP 200。`/api/providers` 返回 180 条；`/api/agent/models` 返回 1,796 项，其中 1,679 项当前标为 available。此处仅验证既有目录可读，不据此声称型号收费调用已成功。素材 API 当前列表返回 277 条，完整数据库 570 项逐项保留；列表结果不当作完整资产总数。

旧 `/api/director/sessions`、`/api/agent/legacy` 均为 **404**；首页和画布原旧导演入口已消失，智能体面板正常打开，原有对话气泡和待确认方案正常显示，型号列表可打开且未改变选择。没有确认既有方案、发送聊天或发起收费生成。最终生命周期 activeRuns / resumableCloudRuns / activeVerifications / activeWrites 均 **0**，renderer 异常 **0**，观测到的生成/智能体提交 **0**。

下列 **14 张均为实际安装程序、正式 profile 的原始窗口截图**，JPEG 原始编码保留，未重编码，时间/哈希/窗口身份见 `screenshots/index.json`。01/06/12/14 补充首页证据；05 是缩放后的首帧，最终 51% 标签与媒体显示另由 11 明确留证。02 的深色正常缩放与 13 的浅色 100% 均另采六帧，位移六值各异且主线路径不变；07/11 的 51% 精简显示按设计暂停动画，只作为拉远显示证据，不算动态通过。不需要运行任务来构造动画。动作仅为正常查看、选中、定位、缩放、切换主题和展开已有面板。验收后恢复用户原有 **dark** 主题，关闭面板并返回首页，应用保持运行。

| 截图 | 内容 |
| --- | --- |
| `01-home-dark.jpg` | 原4张画布的深色首页 |
| `02-canvas-dark-selected-glow.jpg` | 深色画布、紫色选中、细线和点选流光 |
| `03-failure-card-dark.jpg` | 历史失败卡、人话原因、换行、展开详情入口；未重试 |
| `04-image-toolbar-dark.jpg` | 历史图片的单行工具条与紫色选中 |
| `05-zoomed-out-images-dark.jpg` | 拉远后图片继续显示 |
| `06-home-light.jpg` | 浅色首页 |
| `07-canvas-light-selected-glow.jpg` | 浅色51%拉远图片；精简显示按设计暂停流光 |
| `08-agent-chat-light.jpg` | 智能体面板、旧方案、聊天输入区 |
| `09-agent-model-list-light.jpg` | 既有智能体型号列表，未改选择 |
| `10-agent-history-light.jpg` | 既有对话气泡与聊天界面，未发送 |
| `11-final-dark-zoom51.jpg` | 深色51%拉远图片；精简显示按设计暂停流光 |
| `12-final-home-dark.jpg` | 首轮验收结束，原4张画布与原深色主题 |
| `13-canvas-light-active-glow-100.jpg` | 浅色100%点选流光；另有六帧动态与静态主线对照 |
| `14-final-home-dark-restored.jpg` | 补查后恢复原深色首页，原4张画布保留 |

## 未完成项

- 发布和安装验收没有未完成步骤；不需要用户再退出或处理安装事项。源码尚未提交，由 Claude 负责本地 commit；未推送。
- 六项大场景性能检查缺少至少 6 GiB 空闲内存，未取得有效全量性能基准。
- 沿用上一轮已明确不阻塞发布的遗留项：参数卡首次冷打开约 0.46–0.54 秒，未达 0.2 秒目标；本轮未重新测量，不将其写为已解决。
- 上次记录中的供应商账号/余额/权限事项未在本次刷新或处理；本次不涉及供应商逻辑或正式连接调整。

本轮真实收费图片、视频生成/编辑/续写：**0 次**。

## 证据索引

证据根目录：

`C:\Users\Administrator\AppData\Local\Temp\claude\D--project-development-----\bb3d85ed-297b-4492-96b8-bd4bfa879d47\scratchpad\release-v0.2.105-2026-10-16\`

- `validation-results.json`、`validation-summary.json`：本轮检查时间、退出码、最终计数；保留首次失败与后续修正记录。
- `reused-checks-audit.md`：复用范围、日志与逐文件 SHA 依据；长单元检查另参考 `../remove-director2.log`。
- `db-tests.log`、`desktop-tests.log`、`maintenance-tests.log`、`edge-diagnostics-tests.log`：本轮单元回归。
- `renderer-typecheck-final.log`、`renderer-lint-final.log`、`next-build.log`：最终静态检查与生产构建。
- `renderer-e2e.log`、`renderer-e2e-corrected-assertions.log`、`renderer-e2e-scoped-focus.log`：首次全套及定向复跑。
- `performance-invalid-memory/`：六项原始性能与内存样本。
- `source-manifest*.json`：源码冻结与构建身份。
- `process-watch.json`：每两分钟的正式进程检查及用户自行退出确认。
- `backup-summary.json`、`verify-summary.json`、`compare-summary.json`、`profile-backup-manifest.private.json`：完整备份、安装前复核、首次启动前字节核对。
- `package-summary.json`、`desktop-stage-final.log`、`desktop-dist.log`、`verify-release.log`、`official-node-downloads.json`：安装器身份、构建和官方运行时校验；初次网络/PATH 失败另有保留日志。
- `smoke-report.json`、`smoke-windowed-report.json`：29+4 项隔离打包检查。
- `installer-start.json`、`installer-result.json`、`installed-identity.json`：实际安装与版本身份。
- `installed-api-readback.json`、`installed-final-state.json`、`installed-motion-dark.json`、`installed-motion-light.json`：正式安装版 API、六帧流光、状态及零提交。
- `installed-motion-light-compact-paused.json`：51%精简显示下暂停的单独样本，不计为动态通过。
- `ui-targets.private.json`、`protected-data-after.json`、`canvas-save-differences.json`、`protected-data-disposition.json`：原180连接、数据保留、逐字段正常保存差异及解释。
- `data-audit-history.md`：早期预览元数据变化、最终恢复与首轮快照未单独归档的证据限制。
- `screenshots/index.json`：14 张正式安装窗口截图的索引与 SHA-256。
- `final-acceptance.json`、`artifact-index.json`：最终检查、安装器与截图哈希复核、证据文件索引。
