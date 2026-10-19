# v0.2.117 本机覆盖安装记录

**覆盖安装成功，启动后验收因检测到用户输入而停止。** 安装版 0.2.117.0；最后记录正式应用已启动，未关闭应用，停止后未再核对当前页面或运行状态。所有已完成、未完成及跳过项在下文分别记录。

源码 HEAD：`8601c96968507fe493773544cb7c5f692182d6a8`，分支 `release/v0.2.110`；全部变更未提交，待 Claude 审查。

## 开始前发现

- brief 与仓库相符：HEAD `8601c96968507fe493773544cb7c5f692182d6a8`，分支 `release/v0.2.110`，原安装版 `0.2.116.0`。EXE 时间 `2026-10-18T13:41:12Z` 对应本机 06:41，没有日期/时间冲突。
- 上轮容量中断的 E2E 不是完整结果。本次保留原 3 项失败和中断记录，按精确用例及覆盖源码复用已通过项，其余续跑并完成闭环。
- 未提供具体 `-o` 路径，最终报告采用本证据目录 `final-report.md`；要求的仓库安装记录为 `docs/installed-update-v0.2.117-2026-10-18.md`，已按真实安装与停止结果更新。
- 沿用 v0.2.111 教训：manifest 明确 UTF-8 读取；安装包装与 NSIS 显式传入 D 盘 TEMP/TMP，并已取得实际回执。环境无 `rg`，使用现有查询工具，没有额外安装工具。
- 正式画布的 draft/journal/参数初始化是否严格只读不能靠截图后再观察写入来证明；不能保证的面板验收项须跳过并说明，隔离 E2E 截图不能冒充安装版截图。[开始前核对](../.codex-logs/2026-10-18-release-v0.2.117/start-findings.md)

## 版本、产品小修与测试范围

根目录和 desktop 版本均为 `0.2.117`，中文发布说明覆盖两条扣费 P0 与参数面板改版，保留原句：“不包含供应商协议或价格调整，不发起收费生成。”本版没有数据迁移、供应商协议或价格变更。

额外三项产品小修全部留待 Claude 审查，未提交：

1. **参数来源**：精确透明依据存在时，仅过滤明确标为旧/历史的透明失败纯摘要片段，保留不冲突的尺寸、质量、来源及具体历史原图事实；无替代证据时保留全文。早先整段 `!transparencyNote` 修复过宽，误隐藏原正向来源，该失败原文保留，原正向与 5 个负向断言没有反改。最终范围采用保守片段匹配，不声称能推断任意自然语言冲突。
2. **内联提示词快捷键**：专用入口允许 Tiptap 已预留默认动作的 Ctrl/Cmd+Enter；参数卡及下拉子层仍尊重 `defaultPrevented` / `childOwnsKey`，IME、229、重复键、Alt 继续拒绝。未改扣费、保存、指纹或 revision 提交守卫。原失败没有生成 POST，也没有 422。
3. **自动比例文案**：有应用分辨率档位时恢复“自动 · 跟随提示词，其次参考图”并保留“保持该档位”；无档位时保留供应商原自动说明。只改 active-tier 展示分支，不改 `auto` 原值、参数、协议、价格或合法枚举。[最终小修复核](../.codex-logs/2026-10-18-release-v0.2.117/small-fixes-final-review.md)

测试适配主要为原 10 份域 SSR 测试及 23 份 E2E 的旧原生 select、按钮 span、折叠区、单项静态值和线路定位；保留完整型号、连接/分组身份、线值、价格、保存、无提交与原几何阈值。SSR Dropdown 替身只验证传入的完整域选项，不替代真实交互。另补快捷键与展示/来源回归；`canvas.spec.ts` 的 6 个声明展开为 7 例，其余 46 个声明正文不变。前态、UTC、SHA、diff 和逐例范围证明均保留。[联合复核](../.codex-logs/2026-10-18-release-v0.2.117/combined-release-review.md)、[测试适配](../.codex-logs/2026-10-18-release-v0.2.117/test-adaptation-review.md)

## 完整测试结论

| 验证范围 | 实际结果 |
| --- | --- |
| 全工作区及额外单测 | **9166 通过、9 跳过、0 未解决失败**；工作区 9130、cloud 24、维护 12。原唯一 9152 + 快捷键新增 10 + 显示/来源新增 4；27 项快捷键定向内含旧 17，最终来源消费者 15 文件/134 项内含旧 130，复跑不累计为唯一数。 |
| 完整 E2E | **137 spec、687 唯一身份：670 通过、17 原诊断开关跳过、0 未解决/缺失/意外**。793 条实际完成记录 = 中断前可证明 84 + 本轮 709；初 81 个成功中 10 个因覆盖源码变化重验，最终直接复用 71 个。 |
| 性能 | `canvas-performance` 6 项通过；18 个有效样本最低空闲 9,252,724,736 字节（8.62 GiB），未改 6 GiB 门槛或性能阈值。17 个 E2E 跳过来自原 P0 内存/retention 显式开关，并非这 6 项内存不足。 |
| 静态与生产构建 | 全工作区 typecheck、renderer lint、最终小修及相关测试 lint、最终完整 TypeScript、Next 生产构建均通过，内联版本 `0.2.117`；原有两个 unused-vars 警告保留。最终源码 E2E 构建 `jEz6ixyx2OXddC2t8vhPM`，安装包由同一冻结源另构建，BUILD_ID 见下文。 |
| 打包/可见窗口冒烟 | 新隔离 profile **29/29 + 4/4 全部通过**，没有复用原失败前的 20 项成功；网络尝试/阻断 0，正式 profile 写入 0、收费请求 0。可见窗口验证包含正常 GPU、重启及强制 renderer 崩溃后恢复，均针对隔离测试实例。 |

不是首次全绿：最初 3 项 assistant E2E 失败为新版比例/质量/单选静态控件对应的旧断言；主 602 项旧 bundle 为 517 通过/68 失败/17 跳过，其中 5 项是真实内联快捷键回归，其余 63 项是旧控件/线路/折叠定位。首次最终 77 项为 69 通过/8 失败（7 项适配遗漏、1 项 active-tier 自动文案回归），后续精确补验全部闭环。早先来源宽 guard 漏回验原已通过的 17 项消费者，后由 `auto-ratio-unit` 的 42 过/1 败暴露，最终保留原断言并补足全部直接消费者。

环境与执行问题也保留：root script 内嵌 pnpm 的 PATH 失败发生在用例执行前；providers 本机 multipart 测试继承代理得到 502，仅在验证子进程清空代理后原用例通过；含空格 E2E 配置路径曾被拆开；新增 SSR helper 曾缺 select 事件泛型导致 TS2339，修后完整 typecheck/build 通过。均未修改真实系统网络或供应商配置。

原 **11 个非零验证命令**的全文、栈、Received HTML 和归因见 [失败原文](../.codex-logs/2026-10-18-release-v0.2.117/failures-verbatim.md) 与 [索引](../.codex-logs/2026-10-18-release-v0.2.117/validation/failures-index.json)。desktop 首次下载失败和首次 packaged smoke 失败另见下节；后继通过不覆盖原日志。主执行者合并最终报告时可把失败原文作为附录原样带入，不应仅写“首次通过”。[验证报告](../.codex-logs/2026-10-18-release-v0.2.117/validation-report.md)、[最终闭环](../.codex-logs/2026-10-18-release-v0.2.117/validation/validation-closeout.json)、[唯一用例汇总](../.codex-logs/2026-10-18-release-v0.2.117/validation/e2e-resume-summary.json)

## desktop 构建、官方缓存与构建后 driver 差异

首次 `corepack pnpm desktop:build` 在 `2026-10-19T03:48:54.197Z` 退出 1；依赖、Next/TypeScript、壳和 runtime npm ci 已完成，stage 官方 fetch 报：

```text
TypeError: fetch failed
cause: ECONNRESET, syscall: read
```

原异常没有 URL，不能断言当时必定是 LICENSE。随后每个官方 URL 仅做一次标准 TLS 只读诊断：本轮完整 SHASUMS HTTP 200、2967 字节，SHA-256 `1e812945dee26c3e4ca41a8c0b582668ff2401ba0ae727a122300c0e8514edb0`；LICENSE 15 秒超时。第二轮 stage 窄域 hook 只服务两个固定 Node 官方 URL，使用本轮完整 SHASUMS 和**此前已官方核验并保留来源链的 LICENSE**（SHA-256 `4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18`），不伪称本轮在线 LICENSE 成功。当前、有效备份及 staged Node SHA 全同，stage 原 checksum 比对继续执行；没有关闭 TLS、改系统网络，hook 本身无下载。第二轮完整构建在 `03:54:34.783Z` 退出 0，含 NSIS 与 verify-release，`publish never`。[失败及缓存来源](../.codex-logs/2026-10-18-release-v0.2.117/packaging-failure-addendum.md)、[缓存绑定自校验](../.codex-logs/2026-10-18-release-v0.2.117/validation/node-cache-resume-2-self-validation.json)

构建前后严格核对的 1634 个源文件原本全同。首次 packaged smoke 完成 20 项后等待已删除的 native 供应商 option 超时 30 秒；不是 422，也不是付费提交失败。获授权仅改 `apps/desktop/scripts/smoke-custom-suppliers.mjs` 测试驱动，转真实线路/单价/余额明细，保留 29 个检查名、业务断言与 1px 阈值；原失败报告/截图不覆盖，随后完整重跑 29+4。

**当前 1634 输入并非全部相同**：这个不入包 driver 从 `817bf5a4d22e10043f3693ede36e4fdd514464a49a5dfd1e48bbc841ee182e52` 变为 `902bead37f23342835a67eb0c825e5343310c39e70ba1d159ab52ef72257b803`，其余 1633 逐 SHA 相同。源图与实际 stage 11290 文件、runtime 11291 文件、asar 312 条目、70 份 Next trace 都没有它。已有独立 review 和后继 package binding。

必须披露限制：**driver 编辑前没有完整 installer/program 字节清单**。首次全载荷字节基线在编辑之后；安装器与编辑前构建生成的 `latest.yml` SHA-512 相符，不能写成编辑前后完整载荷已逐字比较。本次依据是未变的其他源、明确构建图/不入包证明、既有 builder 元数据和后继全载荷绑定。[独立复核](../.codex-logs/2026-10-18-release-v0.2.117/postbuild-smoke-adaptation/independent-review.md)、[实际绑定及限制](../.codex-logs/2026-10-18-release-v0.2.117/package-source-binding.json)、[29+4 回执](../.codex-logs/2026-10-18-release-v0.2.117/smoke-summary-postbuild.json)

## 三次备份与历史 cancel 守卫

1. 第一次被 `app-running-or-unreadable` 拦截，没有有效备份。原回执未保留精确 PID，不能追溯写成已证实误报；后续只补诊断，不放松真实占用/不可读进程拒绝条件。
2. 第二次 `before-local-update-v0.2.117-20261019T021608552Z` 源/副本字节一致，但被 `active-generation-or-verification` 拦截且没有有效 manifest，不能用于安装放行。
3. 有效第三次为 `D:/project development/超级画布/backups/before-local-update-v0.2.117-20261019T023031939Z`。确认停机后，源前/副本/源后三向逐文件 SHA 相同；profile 2701 文件/4,436,696,420 字节，原程序 11367 文件/1,018,451,808 字节，控制文件 5/740 字节；profile 外完整桌面状态另备份 7409 文件/9,461,296,056 字节，包含 browser 草稿、journal、会话、IndexedDB 和空目录。[核心回执](../.codex-logs/2026-10-18-release-v0.2.117/backup-summary.json)、[额外状态回执](../.codex-logs/2026-10-18-release-v0.2.117/desktop-extra-backup-summary.json)

历史孤立节点仍是 `cancel_requested`（非终态计 1），父 run 已 `cancelled`，没有 providerTaskId。例外只绑定该节点/父行精确身份与全文 SHA；源码和隔离副本证明不被启动恢复调度。未改原状态、清理资料或调用会写入的 reconcile。最初主库摘要与 hydrate 完整证据误比的诊断失败保留，v2 全证据比较及隔离免费 verification kick 通过，全副本树无变化、无 mutation/远端请求。[资料保护复核](../.codex-logs/2026-10-18-release-v0.2.117/data-safety-resume-review.md)

基线计数：assets 601、canvases 4、connections 182、suppliers 22、runs/nodeRuns 各 593、revisions 24、directorMessages 30、sessions 3、proposals 4、profiles 0、verifications 18、webhookKeys 0；sidecar 19、证据文件 19。593 个父 run 均终态，nodeRuns 为 592 终态加上述历史 1 条。主库 SHA-256 `9171a12b26f1f17b791148989e91dd7f8f871f15425f802cc82f121bc7556b64`；18 条完整核验证据规范化哈希 `3b522ff4ee8e116fe6f96b5d63d962e298ff2b5e22cb0562ed394c9b60eda105`。API 公共投影另有 18 条独立基线，不与内部完整证据混比。

回滚安装器已复制入有效备份：0.2.116，268,652,779 字节，SHA-256 `4d089433109ca90044da4a9c9d62f2601715d5cd668a7751e7c66d7a967f2ec3`，本静态记录未声称执行回滚。异常受保护数据差异仍必须停止并按既定恢复流程处理。

## 安装器身份、实际 TEMP 与已完成安装

- 安装器：`apps/desktop/release/SuperCanvas-Setup-0.2.117-x64.exe`，268,685,550 字节，SHA-256 `532f89521d1a834861c8a0b5b7e0522ff62fe3124b29458c6effe9474d88a651`。
- 目标：`C:/Users/Administrator/AppData/Local/Programs/SuperCanvas`；ProductVersion `0.2.117.0`，安装载荷 BUILD_ID **`S0lprhNfIkNQK8Z-DMHkE`**，Next 内联 `0.2.117`。
- 安装前绝对路径首检 `04:05:12Z` 即未运行，等待 0.555 秒；没有结束任何用户进程。120 秒检查/90 分钟上限守卫保留。安装前 core 与 extra 严格字节核对均已通过。
- 包装 PID 157568；安装器 PID 218216，`04:07:53.590Z` 启动，`04:10:00.106Z` exit **0**；`forcedClose=false`、`autoLaunchRequested=false`。
- 包装、子包装、安装器显式环境块实际记录的 TEMP/TMP 均为 `D:\project development\超级画布\.codex-temp\release-v0.2.117\installer`；.NET TempPath 同目录。未继承 C 盘 TEMP。[环境](../.codex-logs/2026-10-18-release-v0.2.117/installer-wrapper-environment.json)、[启动](../.codex-logs/2026-10-18-release-v0.2.117/installer-start.json)、[结果](../.codex-logs/2026-10-18-release-v0.2.117/installer-result.json)
- `04:10:24.099Z` 已安装载荷核对通过：预期 **11366 文件全部一致**，目录与 runtime 完全匹配，实际 11367 文件额外仅 NSIS 的 `Uninstall SuperCanvas.exe`，没有 missing/changed/unexpected。[完整载荷回执](../.codex-logs/2026-10-18-release-v0.2.117/installed-payload.json)

| 核心文件（相对安装根） | 字节 | SHA-256 |
| --- | ---: | --- |
| SuperCanvas.exe | 246398464 | `a1bace3ddad8c84a1c6c2c5db5a330a1615c6264681147c6b771ae9a52dbe623` |
| resources/app.asar | 2372690 | `04fa9cb175da7441e41446284b6909ae5e1c49e341654778506dbe7385202520` |
| resources/runtime/node.exe | 91694408 | `3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5` |
| resources/runtime/runtime-hook.cjs | 5246 | `d03b8f3a1b54947d4e383781d845947fe8cc68de86bdeb38dd7fea1bbcb16121` |
| resources/runtime/server/apps/desktop/renderer/.next-desktop/BUILD_ID | 21 | `3e70b88eb9e4432454d39c3c53307aa8388acdb8509b8143d4f07f0a34ef1a61` |

没有 commit/push/tag/GitHub Release，没有修改真实 Key/连接、充值、收费生成、对话或手动刷新供应商。冒烟的 fixture 配置和 Fake 请求仅在临时隔离 profile，不是正式账号操作。

## 首次启动、用户输入停止与未完成项

覆盖安装完成；**安装版启动后验收未完成**。安装后与首次启动前的完整 core / desktop-extra 字节复核都通过，完整证据、原文件、计数、连接保护字段、控制文件与浏览器状态仍与备份相同。首次启动前还再次核对安装版全载荷，11366 个预期文件一致，额外仅 NSIS 卸载器。详见 `compare-after-install.private.json`、`desktop-extra-compare-after-install.private.json`、`compare-before-first-start.private.json`、`desktop-extra-compare-before-first-start.private.json` 及 `before-first-launch-payload-identity.json`。

正式应用于 **2026-10-19T04:13:09.0956022Z** 启动，记录 PID **36312**、版本 **0.2.117.0**、BUILD_ID **S0lprhNfIkNQK8Z-DMHkE**，使用正式 profile，没有调试或测试覆盖环境。守卫就绪后于 **2026-10-19T04:13:10.5667890Z** 观察到 **pointer（物理指针输入）**，立即要求停止；守卫于 2026-10-19T04:13:10.6482081Z 自行结束，不记录按键、坐标或输入内容。

随后的 `audit-own-installed.ps1 -Label after-start` 在入口的 Assert-AcceptanceInputClear 即拒绝执行，未创建只读审计 helper。拒绝原文为：

```text
User input observed; acceptance must stop immediately.
At D:\project development\超级画布\.codex-logs\2026-10-18-release-v0.2.117\acceptance-common.ps1:22 char:86
+ ... d.json')) { throw 'User input observed; acceptance must stop immediat ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : OperationStopped: (User input obse...op immediately.:String) [], RuntimeException
    + FullyQualifiedErrorId : User input observed; acceptance must stop immediately.
```

没有继续读正式资料、请求正式 API、查看或操作窗口、补截图、返回首页或检查进程。没有关闭/强杀应用。**最后可证明状态是上述正式进程已启动；停止后当前页面和持续运行状态未重新核对。** 没有启动后资料差异的实际审计结果，不能声称数据最终不变，也没有发现差异便执行回滚。回滚备份与 0.2.116 安装器保留，未执行。

| 安装版验收项目 | 实际结果 |
| --- | --- |
| 安装后、首次启动前完整字节核对 | core / extra 均通过；18 条完整证据哈希不变，19 sidecar 和 19 证据文件均在，业务计数及完整连接保护记录不变 |
| 启动后完整核验证据、计数、连接、sidecar、证据文件与 extra | **未执行**：用户输入守卫在首项审计入口停止；不以启动前结果代替 |
| 18 条已认证 HTTP API 公共投影 | **未执行**：守卫停止；另无受支持的已认证窗口 JS GET 能力，不抽取会话 token、不改认证或开启调试。内部文件全证据与公共投影分项记录 |
| 图片节点“模型与参数”截图 | **无截图**：无法证明进入现有画布的 draft/journal 恢复及参数标准化完全只读，原计划按 brief 跳过；随后守卫停止 |
| 视频节点“模型与参数”截图 | **无截图**：同上；不是缺少视频节点，也不声称任何画布必定写入 |
| 比例下拉展开后 Esc | **无截图**：下拉自身开关只改 UI state，但不能保证安全到达面板；随后守卫停止 |
| “换线路”弹层展开后 Esc | **无截图**：开关自身只改 UI state，但上述前置条件未满足；没有选择任何线路 |
| 底栏“本次预计” | **无截图**：未安全到达面板；没有点击运行 |
| 当前主题首页工作台 | **无截图、未视觉检查**：用户输入先发生，不再捕获或操作窗口；没有切换主题 |
| 返回首页并保持运行 | 没有执行导航或关闭动作；停止后的当前页/运行状态未知，不能写成已回到首页 |

本轮没有正式安装版截图可列，不声称这些界面无截断、重叠、溢出或对齐问题。隔离 fixture 图片此前逐张检查的结果只属于测试证据，不能替代真实安装版验收。只读可行性源码依据见 [安装版只读复核](../.codex-logs/2026-10-18-release-v0.2.117/installed-readonly-api-ui-extra-review.md)。本轮使用 [computer-use 技能](C:/Users/Administrator/.codex/plugins/cache/openai-bundled/computer-use/26.1013.40934/skills/computer-use/SKILL.md)准备只读截图工具；停止前没有调用正式窗口截图或输入。

停止后的工作仅为 D 盘证据、仓库文档和构建产物身份整理，没有重跑长测试或触碰正式应用。未提交、推送、发布 GitHub Release。按用户“中途检测到用户输入就立即停手”的边界，启动后验收保持未完成。
