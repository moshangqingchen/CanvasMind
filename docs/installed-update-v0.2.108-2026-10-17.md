# v0.2.108 本机覆盖安装记录（2026-10-17）

已从 `f0b0cc6a3c84bef407ad5ef1d8e0bb14a27900bf` 构建并覆盖安装 **0.2.108.0**。首次迁移的 **17 条完整核验证据哈希全部一致**，图数据、计数和连接保护字段通过，未触发回滚。界面验收期间检测到用户物理鼠标输入，已停止界面操作；应用保持运行，剩余截图未继续补拍。

全部时间为 UTC。证据位于 [本轮目录](../.codex-logs/2026-10-17-release-v0.2.108/)。本轮不 commit、不推送、不发布 GitHub Release；未发送对话、收费生成或供应商手动刷新。

## 1. 版本与变更范围

根目录和 `apps/desktop/package.json` 改为 `0.2.108`；新增 [用户发布说明](releases/v0.2.108.md) 和本记录。内容覆盖目录分层读取、条件报价、诊断与骤降确认、补查队列、状态与证据外置、流式写盘及按需加载。发布说明中的性能数字明确限定为本机真实数据隔离副本测量。

**本次发布没有修改业务代码、测试源码、依赖或锁文件。** 验证与观测工具的修正仅在忽略的证据目录中。工作区原有 `CLAUDE.md` 删除及其他未跟踪资料保持原样。

不包含供应商协议或价格调整，不发起收费生成。

## 2. 测试、构建与失败处理

单元测试唯一计数为 **8640 通过、9 跳过、0 未解决失败**。工作区包 8556 通过，额外工具 84 通过。每条原始命令、参数、时间、退出码与日志 SHA 见 [验证说明](../.codex-logs/2026-10-17-release-v0.2.108/validation/README.md) 和 [命令账本](../.codex-logs/2026-10-17-release-v0.2.108/validation/validation-results.jsonl)。

| 范围 / 命令 | 结果 |
| --- | --- |
| renderer `pnpm test` | 4288 通过、7 跳过；1453 个输入文件及依赖逐文件 SHA 相同，按授权复用前轮成功记录 |
| db `pnpm test` | 187 通过；47 个输入文件及 core/配置 SHA 相同，复用成功记录 |
| core / storage / director `pnpm test` | 分别 30 / 27 / 19 通过 |
| providers `pnpm test` | 唯一计数 3376 通过；首轮 6 项工具误拦，定向复测通过 |
| runtime `pnpm test` | 唯一计数 503 通过；首轮 4 项同类误拦，原失败文件 62 项复测通过，不重复计数 |
| desktop `pnpm test` | 126 通过、2 跳过 |
| 根 `pnpm test:maintenance` / cloud-generation `pnpm test` | 11 / 24 通过 |
| e2e helper / agent-eval 离线测试 | 15 / 34 通过；没有 live 评测 |
| renderer `pnpm typecheck` / `pnpm lint` | 均退出 0 |
| 根 `pnpm typecheck` | 退出 0 |
| renderer `pnpm build` | 退出 0；完整 e2e 使用预构建 BUILD_ID `Kb4fSty1Sa4HsNS7NAyo8` |
| 完整 e2e，641 项 / 131 文件 | **599 通过、36 原有条件跳过、6 失败**；worker=1、retry=0，flaky 0、全局错误 0，29.8 分钟 |
| 根 `pnpm desktop:build` | 最终完整执行退出 0，11:20:01.179–11:21:41.128；实际外联 0 |
| desktop `pnpm smoke --packaged` | 独立 profile，29 项通过，退出 0 |
| desktop `pnpm smoke --packaged --windowed` | 独立 profile，4 项通过，退出 0；首绘、重启及崩溃恢复有效 |
| `git diff --check` | 通过；最终文档完成后另存收尾检查记录 |

复用依据见 [unit-reuse.json](../.codex-logs/2026-10-17-release-v0.2.108/validation/unit-reuse.json)。完整 e2e 后，1530 项生产源码 SHA 再核一致；本轮没有业务缺陷修复。

失败原文与处理：

1. providers/runtime 的隔离 guard 在 Undici 8 自定义 lookup 前误拦虚构 Host `cdn.provider.example`，原文 `Offline slice-2 build forbids external connections`。目标是本地假代理，未外联。只修证据目录 guard，强制 lookup 结果为回环地址；原失败日志、定向成功日志和计数保留在验证说明中，业务断言不变。
2. e2e 六项均失败于 `canvas-performance` 原 **6 GiB 空闲内存门槛**：18 组手势实际空闲 **288.66–879.86 MiB**，18 条 RAM 断言失败；采样数不足和 P95 的额外失败均为 0。未放宽或重跑掩盖。prompt/500 批量拖动 P95 83.3ms、mixed/500 61.1ms，**只是低内存诊断，不是正式性能通过**。全文见 [console.log](../.codex-logs/2026-10-17-release-v0.2.108/validation/e2e-full/console.log)，数据见 [performance-summary.json](../.codex-logs/2026-10-17-release-v0.2.108/validation/performance-summary.json)。其他功能无未解决失败。
3. 前两次打包遗漏既有离线环境：第一次 Node checksum 获取被 guard 拦截，第二次 Electron 下载被拦截，分别 1 / 2 次连接前拦截，未实际联网。补回已有官方 Node 缓存和本地 `electronDist` 后，第三次完整构建通过；临时 pnpm shim 的 finally 恢复前后 SHA 一致。没有修改产品构建脚本。
4. 额外程序备份首轮因预建目标目录报 `ERR_FS_CP_EEXIST`；虚构 fixture 复现后改用全新目标、不预建根目录，排他复制成功，原失败记录保留。
5. 冒烟后身份汇总工具报 `Smoke command identity mismatch.`；只补充实际 `pnpm smoke` 的精确 cwd/script 身份匹配，没有重跑或修改冒烟断言。
6. 正式 HTTP 工具首轮因 Node inspector 非标准 display URL 报 `ERR_INVALID_URL`，未注入观测。随后绑定同一自有 PID、创建时间、父链、可执行文件及固定 Runtime 布尔恢复自己的 inspector，未重启应用。原失败与观察缺口保留。

## 3. 完整备份与基线

备份前及源复核后，按绝对安装路径检查正式进程均为 0；没有关闭用户应用，也无需等待循环。

- 备份：[before-local-update-v0.2.108-20261017T105040Z/profile](../backups/before-local-update-v0.2.108-20261017T105040Z/profile)。**2460 文件、1191 目录、3,976,705,596 字节**，源前/备份/源后逐文件长度及 SHA 完全相同。
- 主库 SHA：`350331c52c0b3b1231ee9a32ab8c3a8ee40f152b5dd9263c400eefe84fca4435`。
- 从备份计算 17 条核验规范化哈希；活动核验任务 0。547 条运行及 547 条节点运行均为终态，包括 43 条 `needs_attention`，没有待自动执行的生成任务。
- 基线：画布 **4**、版本 **37**、素材 **582**、连接 **180**、运行 **547**、节点运行 **547**；另保存连接 ID、Key 密文/归属等保护字段、图和完整画布记录、实扣证据哈希，没有输出正文或 Key。
- 老模式默认每天一次；正式旧库内联新流水线 namespace 为 0、外置证据为 0。不能将规模 fixture 的内联状态体积当成正式库已有内容。

额外完整程序副本 `installed-program-20261017T105259Z` 为 11336 文件、1,015,061,680 字节，逐文件 SHA 一致，不替代回滚安装器。

精确旧安装器从独立更新器缓存只读找回，排他复制到证据目录 `rollback/SuperCanvas-Setup-0.2.107-x64.exe`：**267,923,876 字节**，SHA **`58635cc6fe3d92b7133f6590d391ff39b9d9484171a85a0de8d9a797a49387b0`**。源前/副本/源后相同，未改写缓存，`rollback-ready.json` 为 true。早期找包问题已解决，无需用户再提供路径。

## 4. 包身份、覆盖与首次启动前复核

| 身份 | 结果 |
| --- | --- |
| 安装器 | `apps/desktop/release/SuperCanvas-Setup-0.2.108-x64.exe` |
| 字节数 | **268,469,079** |
| 安装器 SHA-256 | **`a6bf0d46d1caca6f759ad829434fa41b6a0608fda19190c05f2ba155c71838ad`** |
| 原位置覆盖 | `C:/Users/Administrator/AppData/Local/Programs/SuperCanvas`；缓存、备份与证据均在 D 盘 |
| 产品版本 | **0.2.108.0** |
| 最终 BUILD_ID | **`J1uDcMflWZtq_WnetpQNW`** |
| 已安装 exe SHA | `2f6195de55f4179ea89b46aa8b6a29ac5cd0a485ad3c2af90ef4e85721f26e44` |
| 完整 renderer | **1035 文件、46,056,807 字节**；清单 SHA `6b4d410bbc4798805ac26794fd0ddbe0ca958ac12accdb6c9c1a78283ce7f1af` |

安装器 **11:25:29.347–11:27:27.859** 执行，退出 0。安装后及首次启动前均核对 5 个核心文件和全部 renderer SHA，版本和 BUILD_ID 一致。最终客户端内联 `0.2.108` 见 `validation/inline-version-final.json`。

安装后 **11:27:53.692**、首次启动前 **11:28:57.642**，profile 全部 2460 文件与备份字节一致。`package-summary.json` 中 installerExecuted=false 是打包时历史快照；实际覆盖结果以 `installer-result.json` 为准。

## 5. 首次迁移无损校验、耗时与内存

**11:28:59.142** 启动本轮自有正式实例，main **636660**、后端 **621776**，原正式 profile、原 origin `http://127.0.0.1:55086`，非冒烟模式。没有发送恢复任务、聊天或生成。

**11:29:06.179** 看到原子替换后的主文件缩小及证据文件：启动至可见发布上界 **7,037ms**，包含 Electron/Node/Next 启动、调度和 150ms 轮询，**不是纯迁移 CPU 时间**。完整读回审计采样 **11:31:56.933**，审计后 **11:32:24.709** 再核无用户输入标记。

| 检查 | 结果 |
| --- | --- |
| 完整核验证据 | **17/17** 从外置文件完整读回并校验，规范化哈希逐条与基线完全一致 |
| 外置证据 | **17 文件、52,059,200 字节**，原请求/任务/实扣证据完整保留 |
| 目录状态文件 | **19 个 sidecar**，主库内联新 namespace 为 0 |
| 主文件 | **104,341,566 → 52,411,851 字节**，减少约 **49.8%** |
| 画布 / 版本 / 素材 / 连接 / 运行 / 节点运行 | **4 / 37 / 582 / 180 / 547 / 547**，与基线一致 |
| 原连接 ID、Key 密文、归属等保护配置 | 全部保持 |
| 图数据及完整画布记录 | 全部保持 |
| 不可变集合、供应商身份字段、实扣证据 | 全部保持，异常集合 0 |
| 迁移 / 回滚 | `migrationCompleted=true`、`losslessPassed=true`，**未触发回滚** |

逐条证据见 [migration-audit-first-start.json](../.codex-logs/2026-10-17-release-v0.2.108/migration-audit-first-start.json)。审计工具零解密、零网络、零源写入；应用既有每日检查的合法目录发布另列下节。

采样器仅按 PID/创建时间/父链读取进程内存，没有 heapdump：

- 启动至元数据就绪阶段仅 **3 个样本**：树 WorkingSet 峰 **1507.27 MiB**、Private 峰 **1471.87 MiB**；后端 lifetime PeakWorkingSet **1224.23 MiB**。稀疏采样可能漏掉瞬时峰，不能声称精确迁移峰值。
- 用户输入前保守完整样本 **178 个**，后端 lifetime PeakWorkingSet **1283.11 MiB**；全窗口树 WorkingSet/Private 峰仍为上述数值。进程树 WorkingSet 求和可能重复计算共享页，不是 JS heap。
- 总 **314 样本**；实际间隔 P50 **1393ms**、P95 **1843ms**、max **2680ms**，不是请求配置的稳定 500ms。初始阶段 P50/P95 为 **1933/2237ms**。系统最小空闲 **6.242 MiB**，照实记录，不能当成空闲环境性能基准。
- 用户输入后的 135 个样本和 1 个边界样本不作迁移归因。整个后续自动检查窗口的峰值不等于纯迁移峰值。

详细原始时间与限定见 `installed-memory-final-analysis.json`、`installed-memory-summary.json`。renderer 全窗口 heap 另有被动读数，因包含用户输入后的操作，不当作迁移或只读验收 heap 峰值。

## 6. 自动检查：结果、实际请求与覆盖缺口

没有手动刷新，旧模式为 **每天一次（默认）**。用户输入前 **11:32:49.851** 的只读快照及其本地分析见 `startup-catalog-state-initial.json`、`startup-catalog-initial-analysis.json`。

| 保存状态 | 观察值 |
| --- | ---: |
| 新持久化 HTTP 派发预约 | **101**，派发前预约，**不等于实发 HTTP** |
| 本轮有结果的连接 | **21** |
| 最新完整 / 部分 / 失败诊断 | **4 / 1 / 16** |
| 延后连接 / 暂停来源 | **0 / 0**；暂停来源不是连接计数 |
| 有发布变化的连接 / 变更记录 | **11 / 12** |
| 价格 / 新型号 / 下架 / 规格 / 分组事件累计 | **115 / 33 / 19 / 232 / 2**，不是唯一型号数 |
| 原有且仍可见有效报价 | 检查 **3014** 个型号，价格或来源 metadata 变化 8 个 |
| 异常清空报价候选 | **0** |

分层读取允许失败项和其他可发布部分并存，“失败连接”与“有发布连接”可重叠。3014 项没有异常清空候选，实扣证据无损；但此检测不能代替每个失败响应与每个条件 tariff 的因果核对，**没有把全周期“读取失败覆盖价格为零”冒充已逐响应证明**。

后端 native-undici 被动窗口 **11:32:21.461–11:34:21.648**，实际观察 **HTTP 0 / CONNECT 0 / 429 0**。启动至附加有 **202.319 秒缺口**。不能把预约当实发，也不能把窗口零扩大为全周期零。窗口无可评估请求，因此 **全局2 / 主机1 / 2秒±0.5秒 / 真实 Retry-After 本次无样本，正式运行验收未完成**；本地虚构 fixture 不冒充供应商实测。

HTTP raw 尾部实际延续至用户输入后，没有伪造提前截止。停止后 5 订阅、临时 global、WS 和自有后端 inspector 9229 全部清理，同 main/backend 仍运行。详见 [HTTP 观察说明](../.codex-logs/2026-10-17-release-v0.2.108/http-observation-installed-window-notes.md)，没有为补数触发刷新或重启。

renderer 被动 CDP：按物理输入 **11:33:20.8071685** 截止，**47 个本地 API：38 GET、5 POST、4 PATCH**，9 个非 GET 全为 catalog-check 分类；HTTP≥400 和 renderer exception 均为 **0**，4 个网络 loadingFailed 全为 canceled=true，不能称 4 个 API 失败。源码包含自动 POST 调度和通知游标 PATCH，但匿名日志没有 body/initiator，不能唯一归因每条调用，也不能写“API 全部为零”。截止后另 6 GET 排除验收。工具没有发送业务 API、智能体消息或收费请求。分段证据见 `renderer-observation-boundary.json/md`。

## 7. 用户输入后的停止、截图与当前状态

只激活自有窗口并观察深色首页，未点击主题、供应商、画布、助手、整理或刷新控件。最初未激活时的遮挡画面未保存；激活后的正确首页缓存图为 [installed-home-dark.jpg](../.codex-logs/2026-10-17-release-v0.2.108/screenshots/installed-home-dark.jpg)。截图在输入前取得，停止后仅写出已有缓存，保留原始 JPEG 字节，没有继续抓屏、转码或操作。

**11:33:20.807** 物理鼠标输入触发停止标记，监听器随即卸载。之后不再 UI 操作，不重新读正式库判损坏，不强制回首页或抢焦点。主题没有被本轮改变，无需恢复。**应用保持运行**，用户输入后的当前页面不作保证。

未完成正式截图：供应商诊断与变更、公布/上次/实测价、画布、创作助手等。输入中止前也未完成独立正式生命周期响应的完整读回，不宣称生命周期所有计数为 0。没有用独立 profile 冒烟截图冒充正式验收；HTTP 全周期与限流实测保留上述缺口。后台只读观察工具随后均已停止，不关闭应用。

## 8. 回滚预案与保留资料

若证据缺失、哈希不一致、计数/保护字段/图损坏，应停止验收，仅关闭本轮自启实例，以本次完整备份恢复整个 profile，再用匹配 SHA 的 0.2.107 安装器恢复并逐文件核对。本次全部强制无损校验通过，**未执行回滚，未关闭应用**。

完整资料备份和精确旧安装器保留在 D 盘。新格式不能直接交给旧软件写入；回退须恢复整份旧 profile，不能仅换主 JSON。安装、迁移、失败和清理证据全部保留供审查。
