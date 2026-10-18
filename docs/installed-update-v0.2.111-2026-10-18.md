# v0.2.111 本机覆盖安装记录

日期：2026-10-18。源码 HEAD：`adce42e527996603d8eb03be30dc7261844d0e97`，分支仍为 `release/v0.2.110`。本次未 commit、push、打 tag 或发布 GitHub Release，构建使用 `--publish never`，改动留待 Claude 审查后提交。

**结果：覆盖安装成功，首次启动后完整数据核对通过；安装版界面验收因检测到用户输入而中止，未完成结束前审计。** 不将部分验收写成全部通过。

## 本版内容与源码范围

根目录与 `apps/desktop/package.json` 均更新为 `0.2.111`，新增 [版本说明](releases/v0.2.111.md)。本版整理多档价格表、候选型号价格预览、目录统计、供应商/核验记录/个人 AI/创作助手的键值网格与标签，不改数据结构、不做数据迁移。`modelPickerPriceData` / `modelPickerPriceCompact` 的字符串输出保持原实现。

不包含供应商协议或价格调整，不发起收费生成。

验证过程中适配了 9 份旧布局 E2E 断言和 1 份外部打包冒烟 QA helper，保留身份、价格条件、保存、请求及溢出等原检查；未更改运行时产品源码、依赖或配置。首次验证的 1525 项输入中，除这 10 项 QA/test 文件外，其余 1515 项 SHA 一致。helper 不进入安装包，适配后未重打已经通过的包。原有 `CLAUDE.md` 删除及旧未跟踪文档保持起始状态，未恢复或清理。

## 步骤结果

| 步骤 | 结果 |
| --- | --- |
| 版本与中文说明 | 完成，保留要求的原句 |
| 全工作区单测、typecheck、lint、E2E、生产构建 | 已执行或按精确输入复用；具体计数和限制见下表 |
| 停机与 D 盘完整备份 | 按绝对安装路径检查，应用本来未运行；没有关闭或强杀用户应用，无需进入 2 分钟等待循环 |
| 备份逐文件 SHA 与基线 | 源复制前、目标副本、源复制后完全匹配；证据条数按当前配置计算 |
| `pnpm desktop:build` | exit 0，Next 实际内联版本 `0.2.111` |
| 打包 / 可见窗口冒烟 | 本次 29 / 4 项通过；独立临时资料，未使用正式资料 |
| 覆盖安装 | 唯一一次实际安装器执行 exit 0，没有自动启动或强制关闭应用 |
| 安装文件与首次启动前核对 | 两次完整载荷核对通过；安装后及首次启动前 profile 全部字节一致 |
| 首次启动后完整只读审计 | 通过，主库、业务数据、证据、计数和连接保护字段不变 |
| 安装版界面验收 | 仅深色首页有效截图完成；检测用户输入后立即停止 |
| 回首页与 `after-ui` 最终审计 | 未执行；用户输入停止规则优先，未再干预或读取应用现状 |
| 最终源码检查 | `git diff --check` exit 0；HEAD 未变。两份测试文件有 Git 的 CRLF→LF 提示，无空白错误 |

## 验证计数与失败证据

| 范围 | 结果 |
| --- | --- |
| 工作区单测 | 8780 通过、9 跳过、0 失败 |
| 额外 cloud / 根维护测试 | 24 / 12 通过 |
| 单测合计 | **8816 通过、9 跳过、0 失败**；本轮 4533，通过输入 SHA 复用 4283 |
| 完整 E2E | 发现 659 项；唯一执行 642 项，**639 通过、3 项原报告失败且因 6 GiB 内存门槛无效**；另 17 项原 P0 条件跳过 |
| 两套点名 UI readability 配置 | **107/107 通过**（app 96 + fixture 11） |
| 原 `canvas-performance` 6 项 | 全通过，18 个有效样本最低空闲 6817927168 字节，未改 6 GiB 门槛 |
| renderer typecheck / lint | 通过；测试适配后补过定向 lint 和完整 typecheck |
| Next 生产构建 | 通过；初次清理 map 的 EBUSY 失败保留，锁自然释放后只补失败构建 |
| 打包 / 可见窗口冒烟 | 29 / 4 通过，正常 GPU 窗口首次、重启、恢复均非空白 |

没有把 17 个跳过项或 3 个无效内存样本计为通过，严格全测试通过标志仍为 false。3 个内存无效项是供应商真实滚动 1366×768、120 混合节点、5000 型号菜单；未调阈值、缩次数或关闭用户程序释放内存。17 项按原注释、CI 和历史发布定义属于显式分离的手工 P0 专项，保留原 guard，不伪造父任务所有权或旧 BUILD_ID。

首次 E2E 为 599 通过、36 跳过、24 失败：11 项隔离 fixture 的 Windows 路径准备错误、12 项旧 UI 断言、1 项真实 ambient 性能失败。仅对失败项和原 opt-in 项定向补验；ambient 原 zoom 增量 `2.400000000000091ms > 1ms`，空闲窗口单项补验为 `0ms`，原失败未改判。存在人工定向补验，不能称作一次性全绿。4283 项复用中 providers 3517 项依据原审计摘要与源 SHA，未找到其独立原 stdout，已明确披露。

首次打包冒烟要求旧的“名称·报价·余额”拼接 option，因本版改为概括字段而失败；仅适配外部 QA helper 后 29 项通过。首次安装包装在启动安装器前因 Windows PowerShell 缺省 ANSI 读取中文路径 manifest 而失败；只给三处 JSON 读取增加 UTF-8，确认没有 attempt/start/result 后才执行唯一真实安装。原 wrapper、diff 和错误均保留。

完整失败原文、非零命令 stdout/stderr、重试及样本见 [验证报告](../.codex-logs/2026-10-18-release-v0.2.111/validation-final-report.md) 和 [全部失败原文附件](../.codex-logs/2026-10-18-release-v0.2.111/validation-all-failures-verbatim.md)。附件 306305 字节，SHA-256 `0c2e8bb2168157f2a8680a33f99d4838ac4fd708e6dbf242da92c68b57ca3ef2`。编码错误的完整 stderr 含私有文件清单，只保留本地私有证据，不将清单拼入报告。

## 备份与数据核对

完整备份目录：`D:/project development/超级画布/backups/before-local-update-v0.2.111-20261018T062953865Z/`。

- `profile/`：2506 文件、1195 目录、4,035,878,594 字节；清单 SHA `7eb2395e526ca92454079ed8ef966b137d49bbb7840e0181ebb250b8dfb46769`。
- `program/`：11363 文件、1062 目录、1,019,228,813 字节；另备份 5 项控制文件。
- 当前实际 17 条完整核验证据，规范化汇总 SHA `55832afabaafd2ef76c7cf97b7e35df03ca0803491819fc34806b2b823414f4d`；19 个 sidecar、36 个证据存储文件，逐文件清单和完整内容哈希均保留。
- 主库 SHA `24dc995c58bc2f8cb0a97c0a674d11fd82040cf08569ab90fa3381f0707b3331`，安装前、安装后、首次启动后相同。

| 数据 | 备份 / 首次启动后 |
| --- | --- |
| assets / canvases / connections / suppliers | 583 / 4 / 180 / 21，均不变 |
| runs / nodeRuns / revisions | 551 / 551 / 24，均不变 |
| directorMessages / Sessions / Proposals / Profiles | 30 / 3 / 4 / 0，均不变 |
| supplierVerifications / webhookKeys | 17 / 0，均不变 |
| runs 和 nodeRuns 状态 | 328 succeeded、46 needs_attention、173 failed、4 cancelled，均不变；无 queued/running |

安装前、安装后及首次启动前的 `rawWholeProfileBytesUnchanged=true`。首次启动后该值为 false，仅 `reference-channel-status.json` 与 `reference-channel-status.json.tmp` 两个运行状态条目变化；状态含启动随机 instance、时间和临时发布过程，配置文件 `reference-channel.bin` 未变。没有受保护文件缺失、业务或目录文件改变，也没有新增 profile 文件；不能写成启动后整个 profile 字节完全相同。

首轮启动审计的 `passed`、`exactProtectionPassed`、`losslessPassed`、`measuredLedgerEvidenceUnchanged`、`allPriorProtectedFilesPreserved`、`controlsPassed` 均为 true。完整连接/供应商记录、Key 保护字段、用户参数、全部原素材、核验证据、sidecar 和 5 项控制文件保持不变；未解密 Key，无迁移或回滚触发条件。用户输入后的最终核对未执行，不能将先前结论外推到之后。

## 安装器与已安装载荷

安装器：[SuperCanvas-Setup-0.2.111-x64.exe](../apps/desktop/release/SuperCanvas-Setup-0.2.111-x64.exe)，268,861,162 字节。

- 安装器 SHA-256：`23e019ea0722ae9b788e58b578cecc3dcbf19a90f537d5370f3b576d9db5ebe3`。
- 实际安装路径：`C:/Users/Administrator/AppData/Local/Programs/SuperCanvas`。
- 实际 ProductVersion：`0.2.111.0`；BUILD_ID：`KAFmmDO4JJf3LETup4DER`。
- 安装器实际执行：2026-10-18 07:45:04.491–07:47:59.296 UTC，PID 109356，exit 0。
- 两次完整载荷比较：11364 个包文件全部匹配，1038 个 renderer 文件完整；仅额外允许 NSIS 生成的 `Uninstall SuperCanvas.exe`，missing / changed / unexpected 均为空。

| 核心文件 | SHA-256 |
| --- | --- |
| `SuperCanvas.exe` | `b95e827a8dfdcf1d141c0de1c32de20cba003f960dc09f9fe0e5f1dd0cd663f6` |
| `resources/app.asar` | `8185a2d756524fe07ad73489f02ba63d72ff37cb95deeb8c47e25d1aa8f0582d` |
| `resources/runtime/node.exe` | `3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5` |
| `resources/runtime/runtime-hook.cjs` | `d03b8f3a1b54947d4e383781d845947fe8cc68de86bdeb38dd7fea1bbcb16121` |
| renderer `BUILD_ID` 文件 | `b39c0e7a29fa0c6d75691c5689dac123a3f70d196d851d6a966652dceaec0a21` |

旧 0.2.110 安装器保留在本轮证据 `rollback/`，SHA `154c58a8201c8431564f8472ad9e28597be98d5f1558bf112a2d21deaa6da824`；本轮没有执行回滚。

**路径偏差：**备份、构建和测试缓存均在 D 盘，但实际安装包装及其调用 shell 未显式覆盖 TEMP/TMP，安装器继承系统 `C:/Users/ADMINI~1/AppData/Local/Temp`。因此不能确认全部安装临时文件位于 `.codex-temp`；这不符合用户要求的缓存路径约束。本轮保留实际执行脚本和偏差回执，没有改写记录掩盖、重复安装或删除系统临时文件。

## 安装版界面验收与中止

正式应用于 07:51:44.106 UTC 启动，PID 160528、创建时间 07:51:44.2111508 UTC，版本和 BUILD_ID 匹配；未启用测试 profile、CDP/debugger 或内存存储。07:53:03.478 UTC 首轮审计通过，当时没有用户输入。

| 项目 | 实际结果 |
| --- | --- |
| 深色首页工作台 | [原始截图](../.codex-logs/2026-10-18-release-v0.2.111/screenshots/installed-home-dark.jpg)，1426×953，07:54:13.046 UTC；已逐张自看，标题、导航、统计卡和搜索框未见截断、重叠、溢出或对不齐 |
| 供应商型号行、价格明细与“查看依据” | 未完成；一次只读导航点击后，下一次操作前守卫检测输入，未再读取其打开结果 |
| 供应商设置诊断区 | 因输入中止未完成 |
| 画布模型菜单、底部候选价格预览、参数命中高亮、目录对照统计块 | 跳过：打开真实画布可能协调 IndexedDB/localStorage journal、旧参数并自动保存，无法保证只读；未为截图改型号、参数或画布 |
| 浅色主题 | 跳过：切换主题会写 localStorage 和 `appearance.json`，保留用户原深色主题；隔离 E2E 双主题证据不冒充正式安装版截图 |

首次未置前的原生截图实际捕获遮挡的 Edge，已标为 `screenshots/invalid-before-activation.jpg`，不计安装版验收；未向 Edge 发送输入。置前后重新截图才作为上表有效首页图。

**07:54:16.5030683 UTC，监测到 pointer 用户输入，守卫要求立即停止；07:54:16.5358972 UTC 观察器结束。** 后续一次操作前检查被拒绝，未再调用截图、点击、正式数据审计、回首页、进程探测、关闭或恢复。`after-ui` 未执行，不能记作通过。没有手动刷新供应商、改 Key/连接、充值、收费生成、选择其他型号、改参数、发对话或改画布内容。

应用未被本流程关闭，中止时保留运行；最后已确认的正式 PID 为 160528，最后观测界面为工作台。用户输入后没有再探测，不能声称此刻界面仍是首页或进程状态仍未变化。

## 证据

统一目录：`.codex-logs/2026-10-18-release-v0.2.111/`。

- [完整报告（含失败原文）](../.codex-logs/2026-10-18-release-v0.2.111/final-report.md)。
- [验证报告](../.codex-logs/2026-10-18-release-v0.2.111/validation-final-report.md)、[打包独立复核](../.codex-logs/2026-10-18-release-v0.2.111/package-final-review.md)、[资料保护独立复核](../.codex-logs/2026-10-18-release-v0.2.111/data-final-review.md)。
- `backup-summary.json`、`compare-before-install.private.json`、`compare-after-install.private.json`、`compare-before-first-start.private.json`、`compare-first-start.private.json`、`installed-payload.json`、`before-first-launch-payload-identity.json`。
- `installer-result.json`、`installed-launch.json`、`audit-first-start-identity-guard.json`、`user-input-observed.json`、`input-watch-ended.json`、`ui-acceptance-events.jsonl`。
