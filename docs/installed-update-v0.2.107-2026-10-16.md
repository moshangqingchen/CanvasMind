# 本地覆盖安装 v0.2.107（2026-10-16）：修复包已安装，应用保持运行

> **修复后的0.2.107已完成第二次覆盖安装，产品版本0.2.107.0，BUILD_ID `lcgBqOEnOB5_k_HBtO7XS`。** 安装前与首次启动前全部资料长度/SHA一致；928项渲染载荷匹配，修复包启动后规范化数据库与第二备份完全一致。最后读回为深色首页，生命周期与renderer异常全0，应用保持运行。正式grid/trail截图及修复包原生离页复验未完成，下面区分已有证据与验收限制。

记录日期按本地2026-10-16归档，证据时间均为UTC。仓库 `D:\project development\超级画布`，分支 `release/v0.2.105`，基线HEAD `12bc439028b2a2d32aad6e70049462c08fcd6ef4`。本自动化没有commit、push或发布GitHub Release。用户明确授权本机安装；没有充值、真实智能体对话或收费生成。所有备份、证据和缓存均在D盘项目内，正式数据目录没有迁移。

详细报告和原始日志在 [.codex-logs发布目录](../.codex-logs/2026-10-16-release-v0.2.107/report.md)，更新说明见 [v0.2.107](releases/v0.2.107.md)。

## 助手只读目录及版本

根目录和桌面package版本均为0.2.107。助手/方案固定走 `cached=1&readonly=1`，只读取已保存目录和价格；原生组及协议重绑定仅在克隆内投影，不保存、不扫描。缺缓存显示“未读取目录 · 请先在设置中刷新”，模型浮层改为“重新读取缓存”，可定位对应供应商设置。普通画布菜单读取不在本轮改造范围，原行为保留。

来源、目录、价格、参数和授权不变量均保留；真实对话完成后的兼容证据保存属于原有显式请求结果，不误删。独立源码检查与8项真实MemoryRepository集成、2项模拟e2e互证目录零上游、零保存。受控真实对话评测仍只有此前14次文字请求、5道题，本轮未新增；不宣称回答质量全面实测提升。不包含供应商协议或价格调整，不发起收费生成。

## 初次源码与完整回归

初次全工作区单元及helper **7,997通过、9跳过、0失败**：3,399按输入与原日志SHA复用，其余本轮运行；renderer3822通过、7跳过。renderer typecheck、lint、根typecheck均退出0。Electron首轮115通过/1跳过/1失败；Windows PowerShell编码破坏中文测试路径，最终仅修测试UTF-8，定向6通过/1环境跳过，合并为115通过/2跳过。失败和未解决的中间native假设日志全部保留，未改产品scope保护。

完整默认e2e仅一次，631项/125文件，worker1/retry0，02:43:11.125Z开始，约35.4分钟：**581通过、36跳过、14失败**。8个失败是旧目录状态mock/可见性前置条件：旧响应 `{"phase":"complete","updatedConnectionIds":[]}` 缺connections/history导致设置渲染报 `Cannot read properties of undefined (reading 'filter')`，不是主题或Esc业务保护失效。补类型化完整fixture后fresh8题先7过/1失败；长列表在测试自己折叠后fill隐藏输入，补普通展开与可见/保留草稿断言，单题通过。合并为 **589通过、36跳过、6失败**，不是整套绿色重跑。

剩余6题为prompt/mixed×50/200/500性能门槛；18组手势全部低于原6GiB可用内存要求，实际71.91–1032.43MiB。原文18条RAM失败，samples/P95无额外失败；不降低门槛，不把低内存数据当正式基准通过。200节点动效ABBA的drag/zoom平均P95开关均约5.7ms，增量约0；20次往返GC后堆+1,990,820字节、尾六不单调、WebGL1、卸载ambient2d0。它们是隔离fixture数据，不替代正式性能门槛或长期内存保证。

完整和两次夹具定向运行的服务端非回环尝试0、实际外连0；临时服务和资料清理。原错误、完整report、trace、精确数值与命令账本见证据目录。原始版本35→37缺陷修复后的测试另列下节，不拿初次源码验证冒充修复包验证。

## 正式备份与第一次覆盖安装

02:30:20.667Z按绝对安装路径检查，正式进程0。没有关闭或强制结束用户应用。完整备份：

`D:\project development\超级画布\backups\before-local-update-v0.2.107-20261017T023403Z\profile`

02:34:21.398Z核对通过：**2,460文件、1,191目录、3,976,696,895字节**，逐文件长度和SHA-256一致；数据库SHA `53470457fb009b9eb6b43922de2f0205a00ede4eb98c36b81215bba152fb7c4c`。03:26:12.642Z安装前复核一致；03:29:24.369Z第一次正式启动前再次逐文件核对一致，安装本身未改资料字节。Private manifest只保留在项目，正文不复制Key或密文。

初次 `pnpm desktop:build` 03:22:50.927–03:24:32.081Z退出0，包含Next、壳、stage、NSIS和verify；29项隔离打包冒烟及4项正常GPU可见窗口冒烟均通过。使用项目独立profile，Fake/离线CLI不冒充真实供应商调用。复用现有Electron44.4.1和此前官方验证的Node24.15.0缓存，当前binary重新哈希，原stage/lock/verify未绕过；未新增依赖或改锁文件。

初次安装器03:26:12.752Z启动、03:28:03.328Z退出0。安装位置仍为 `%LOCALAPPDATA%\Programs\SuperCanvas`。03:28:56.127Z核对产品版本 **0.2.107.0**、BUILD_ID **`53HHMWBnvYqAoRA4QbVGL`**；核心exe/app.asar/Node/BUILD_ID长度和SHA与win-unpacked均一致。

| 首次安装器 | 身份 |
| --- | --- |
| 长度 | 267,923,453字节 |
| SHA-256 | `c39228841426caf0e2129b536df5064a4e59df2c9266cfcb8627696c6af1484b` |
| 原文件归档 | `.codex-logs/2026-10-16-release-v0.2.107/round1-package/SuperCanvas-Setup-0.2.107-x64.exe` |

03:29:29.555Z首次正式启动PID518164，formalProfile=true、smoke=false。该身份只代表第一份包；不是第二份修复包的安装记录。

## 安装版只读验收、实际变化与启动检查

首次安装包的正式窗口已保存13张原JPEG：深浅工作台、画布模块/详情、供应商模块/详情、账号模块、供应商设置/待处理/变更历史、助手面板/型号浮层、一键整理及排序菜单。索引位于 `screenshots/index.json`，含安装路径、windowId、保存UTC、长度和SHA。角色近景 `avatar-closeup-from-installed.png` 是精确裁剪派生，来源记录单列，不冒充另一张原始窗口截图。这些只证明第一份 `53HH...` 包的窗口，不能挪作修复包截图。只打开菜单，没有确认方案、发消息、运行、整理或批量连接。

正式grid/trail截图仍缺：原画布首次进入为低LOD，效果按设计关闭；没有为补图更改缩放或图数据。模拟e2e画面不替代该正式验收。原主题dark已恢复并回首页。03:49Z读回pathname `/`、theme/preference=dark/dark，API失败0、生命周期各项全0、renderer异常和console error0；出现用户活动迹象后停止界面操作，不抢输入，保持运行。

安全审计显示画布4、素材582、连接180、运行547、节点运行547，图节点37/连线25保持；所有原连接ID和Key等保护字段保留。**版本总数35→37，发生两次同图autosave**，对应canvas只有revision/updatedAt变更，graph/title完全相同。没有删除、覆盖或回滚这些版本，不能写“所有数据均与备份完全相同”。

启动自动目录检查采用旧资料默认daily，累计唯一连接尝试131、成功17、失败114、发布17、暂停0、进行中0。失败分类为网络9、鉴权9、余额1、上游1、不完整93、冲突1。历史10条、69个变化项：价格37、新增型号1、下架17、型号规格9、分组变更5。最后局部API显示total4/failed4，不代表整次只查4个；131是连接数，不是HTTP次数。

失败连接只记尝试revision/time/result/分类/streak/manualRequired/paused等元数据，原有效价格与目录均保留，unexpected字段计数0。完整成功发布会更新保存的catalog/型号、connector/协议模板、扫描事实及history；这些真实变更不能写成价格全部未变。路径计数807/509等是叶字段变化次数而非连接数。依据 `startup-catalog-brief.json` 和已有安全审计摘要，编写本记录未重读正式资料。

## no-op autosave修复与第二份同版本包

上述同图写版本是产品缺陷：离页saveNow为持久性发autosave，DB原先即使内容相同也增revision和版本。修复仅对reason=autosave且title/graph深等价返回原记录；expectedRevision仍先校验，真实编辑/manual版本仍保存。FileRepository不对干净no-op写盘，但已有在途/失败持久化仍等待或重试；不能用早返回吞磁盘错误。另修助手默认旧扫描说明的“实时返回”来源文案，仅内存呈现为已保存目录，不改保存记录或普通画布文案。

修复后DB62项通过（新增5）；renderer保存与来源26项通过（新增来源1）；runtime503/director17复测通过；renderer/root types和lint退出0；隔离e2e-noop-repair10项通过、非回环尝试0。最终按唯一用例合并为 **8,003通过、9跳过、0失败**；这10项e2e含1个新增用例，其余重跑不重复累计。保留原保存PUT、CAS/冲突/失败保护，新增只读离开后完整canvas、revision、updatedAt不变断言。只复测受影响范围，没有重跑已经通过的长完整suite；原完整e2e的6项低内存门槛失败仍保留。

第二次完整构建03:46:40.876–03:49:46.341Z退出0，独立29+4smoke退出0：

| 当前已安装修复包 | 身份 |
| --- | --- |
| BUILD_ID | `lcgBqOEnOB5_k_HBtO7XS` |
| 安装器长度 | 267,923,876字节 |
| 安装器SHA-256 | `58635cc6fe3d92b7133f6590d391ff39b9d9484171a85a0de8d9a797a49387b0` |
| 文件 | `apps/desktop/release/SuperCanvas-Setup-0.2.107-x64.exe` |

包身份及两轮原证据在 `package-summary.json` 和 `package-summary-repair.json`。修复包预构建与打包后的生产源码SHA完全相同，04:16:06Z再次检查1,447项源码身份无变化，HEAD仍为12bc439。第二次安装的结果如下。

## 第二次备份、覆盖安装与最后只读复核

03:51:24.939Z开始由 `wait-installed-repair.ps1` 每120秒按绝对安装路径检查，最多90分钟。04:07:35.959Z用户应用在自动化之外自行退出，实际等待16分11.020秒，相关进程0、不可读进程0，`closedByAutomation=false`；没有关闭或强制结束用户应用。

第二份完整备份位于：

`D:\project development\超级画布\backups\before-local-update-v0.2.107-20261017T040823Z\profile`

04:08:48.323Z验证通过：**2,460文件、1,191目录、3,976,705,596字节**，数据库SHA-256 `350331c52c0b3b1231ee9a32ab8c3a8ee40f152b5dd9263c400eefe84fca4435`。备份保留37份版本和等待期间的当前资料，没有覆盖回首次备份。安装前及04:14:11.444Z首次启动前全部文件长度/SHA再次一致。

修复安装器 **04:09:19.610Z启动、04:12:34.511Z退出0**。04:12:56.962Z核对版本 **0.2.107.0**、BUILD_ID **`lcgBqOEnOB5_k_HBtO7XS`**，4个核心文件长度/SHA全部匹配；04:12:57.443Z进一步核对928项渲染运行时载荷，**928匹配、0差异**，清单40,391,049字节。exe/app.asar/Node与首次包相同不能单独证明渲染及DB修复，故另存完整载荷清单。证据为 `installed-identity-repair.json`、`installed-repair-payload.json`、`repair-renderer-payload.json`、`repair-source-comparison.json` 和 `final-source-comparison.json`。

04:14:19.806Z从绝对安装路径启动正式修复包，主PID **465840**，formalProfile=true、smoke=false。04:15:05.349Z安全审计 `exactCanonicalUnchanged=true`：全部集合计数和规范化内容与第二备份一致，画布/供应商/连接变更均0，原连接ID和保护字段全部保留。计数为画布4、版本37、素材582、连接180、运行547、节点运行547、供应商记录21、核验17、消息27、方案4、会话2，图节点37/连线25。该结论以第二份备份为基准；首次35→37两条同图版本仍保留，没有回滚。

修复包本次启动新增目录尝试、成功、失败、发布、暂停均 **0**，daily模式不变，接口idle/total0，历史仍10条。与首次累计131尝试、17成功、114失败、17发布、0暂停分开记录。观察器在renderer就绪后附加，不能假定捕获了更早全部网络事件；数据库持久化尝试字段同样未变，支持本窗口没有新尝试或发布的结论。

04:15:14.579Z最后只读采样：4个文档化本地GET均HTTP200、失败0，pathname `/`、theme/preference=dark/dark；生命周期全部0、renderer异常0、console error0，`observedWrites=[]`、`providerCatalogRequests=[]`。未发送导航、输入或写请求。依据 `data-audit-repair-after-start.json` 与 `installed-observer-repair-acceptance.json`；编写本记录仅使用这些已脱敏证据，没有重读正式profile。

修复包原生窗口仅执行列表和状态读取，没有激活或输入。可访问性状态识别深色首页、4画布、37节点、18个界面可见供应商、2,634个可用型号；界面18供应商与数据库21条记录口径不同。前台为其他窗口，截图与目标UIA状态不符，为避免抢操作停止UI操作；仅观察到这些活动迹象，没有捕获实际键鼠输入事件。不保存无关截图、不披露前台内容。新包正式grid/trail截图和原生离页复验未做，隔离10项e2e不能冒充这两项正式验收；第一份13张截图也不挪作新包证据。详见 `native-repair-acceptance-handoff.json`。

04:16:08Z最终记录确认正式修复包保持运行，共5个安装目录进程，主PID465840，最后API状态为深色首页。应用没有被关闭，后续未再操作正式窗口。

## 改动、证据与已知限制

完整源码/测试/文档清单见 [changed-files.md](../.codex-logs/2026-10-16-release-v0.2.107/changed-files.md)和带SHA的JSON，排除用户原CLAUDE.md删除、旧docs/output。助手只读主链、未读提示、新模拟e2e、版本说明、旧目录mock契约和UTF-8测试工具为最初范围；DB no-op autosave是真实验收发现后的追加业务修复，单独列明。无依赖和锁文件修改，没有回滚用户资料。

原始日志、失败全文、定向修正和性能限制见 [详细报告](../.codex-logs/2026-10-16-release-v0.2.107/report.md)。本次已完成修复包覆盖安装、载荷身份、资料与API复核；仍保留6项低内存性能门槛失败，以及正式grid/trail截图和修复包原生离页复验的窗口限制。没有宣称完整e2e全绿、全部正式截图完成，或把第一次安装后产生的两条空版本写成资料完全未变。
