# v0.2.109 本机覆盖安装记录（2026-10-17）

**已覆盖安装 0.2.109.0，启动后两次无损核对均通过，未触发回滚。** 首页与供应商来源诊断截图已完成，主题未改，应用已回到首页并保持运行。输入观察器已卸载，验收期间未检测到用户输入。

基于 `c395882abf3cf4c508f11beef0415fa0c799468f`，相对 0.2.108（`e197d13`）包含 `d96bec7` 的余额不足分类修复，以及 `c395882` 的 `/models` 返回网页时改试 `/v1/models` 修复。用户说明见 [v0.2.109.md](releases/v0.2.109.md)。本轮仅修改根目录和桌面 package 版本、新增发布说明与本记录，没有另改业务代码、测试、依赖或锁文件，没有 commit、推送或发布 GitHub Release。

全部时间为 UTC；证据位于 [本轮目录](../.codex-logs/2026-10-17-release-v0.2.109/)。缓存、临时资料和备份均在 D 盘项目内。未修改 Key 或连接字段，未充值、发送对话、发起收费生成或手动刷新供应商。

不包含供应商协议或价格调整，不发起收费生成。

## 1. 验证

单元测试唯一合计 **8643 通过、9 跳过、0 失败**：4166 项按源码、依赖和历史日志 SHA 复用，4477 项本轮执行。工作区包 8559 通过，额外工具 84 通过。受两项修复影响的 renderer 整套重跑，没有复用它的旧结果；重内存工作均串行执行。

| 范围 / 命令 | 结果 |
| --- | --- |
| renderer `pnpm test --maxWorkers=1 --fileParallelism=false` | **4291 通过、7 跳过**；365 文件，542.67 秒 |
| db / core / storage / providers / director / runtime `pnpm test` | 分别 **187 / 30 / 27 / 3376 / 19 / 503** 通过，逐输入 SHA 相同，复用 |
| desktop `pnpm test` | **126 通过、2 跳过**，本轮执行 |
| 根 `pnpm test:maintenance` | **11 通过**，本轮执行 |
| cloud-generation `pnpm test` | **24 通过**，逐 SHA 复用 |
| e2e helper / agent-eval 离线工具 | **15 / 34 通过**，本轮执行，无 live 调用 |
| renderer `pnpm typecheck` / `pnpm lint` | 均退出 0 |
| 相关 e2e | **107/107 通过**，0 跳过、0 失败、0 flaky；worker=1、retry=0，313.44 秒 |
| 根 `pnpm typecheck` | 退出 0 |
| renderer `pnpm build` | 退出 0，客户端实际内联 **0.2.109** |
| 根 `pnpm desktop:build` | 完整执行退出 0，12:49:21.291–12:51:50.277，外联拦截记录 0 |
| desktop `pnpm smoke --packaged` | **29 项通过**，12:52:38.611–12:53:03.599，独立 profile |
| desktop `pnpm smoke --packaged --windowed` | **4 项通过**，12:53:07.979–12:53:18.792，独立 profile；首绘、重启和崩溃恢复均有效 |
| `git diff --check` | 验证阶段通过，最终文档完成后再核，见收尾记录 |

相关 e2e 覆盖 `catalog-`、`supplier-`、`suppliers.spec.ts`、`assistant-cached-catalog.spec.ts` 和 `canvas-public-directory-diff.spec.ts`，包括调度、三种模式、历史价格、候选确认、凭据保护、参数保存、证据冷开和助手只读缓存。按本次要求没有重跑完整 e2e，不将相关用例冒充完整套件或性能基准。

e2e 自有回环服务器的非回环尝试、外部 HTTP creation 和全局错误均为 0；服务器及临时资料已清理。预构建 BUILD_ID 为 `fTdtjbMzyZlIUKsakqOY4`，最终包 BUILD_ID 另见下节。1530 项生产源码在 e2e 前后逐 SHA 相同。

逐命令参数、UTC 起止时间、退出码及日志见 [validation-results.jsonl](../.codex-logs/2026-10-17-release-v0.2.109/validation/validation-results.jsonl)；计数和复用依据见 [验证说明](../.codex-logs/2026-10-17-release-v0.2.109/validation/README.md)、`unit-summary.json`、`unit-reuse.json`。本轮产品测试、构建和冒烟均无失败，没有重跑已通过的长测试。

完整桌面构建复用已校验的 Node 24.15.0、Electron 44.4.1 和 NSIS/7zip 本地缓存；只在证据目录采用已有离线包装，不修改产品构建脚本。临时 pnpm shim 已在 finally 中恢复，前后 SHA 同为 `237ea78afff0411016889bccb65f59eca94cb35663aa5ea2b981812101d1c406`。

## 2. 等待退出、完整备份与基线

初次检查 **12:28:55.037**，正式应用及后端仍有 5 个进程。按绝对安装路径每 120 秒检查，原截止时间 **13:58:55.037** 未重置。**12:42:42.395** 确认无安装目录进程且无路径不可读的相关进程，等待约 **827 秒**；12:43:03.121 再独立复核。未关闭或强制结束用户应用。

完整备份为 [before-local-update-v0.2.109-20261017T124333Z/profile](../backups/before-local-update-v0.2.109-20261017T124333Z/profile)，**2496 文件、1193 目录、3,978,864,227 字节**。工具自身再次确认停机，源前、备份、源后逐文件长度和 SHA-256 全部一致，12:44:09.998 完成。正式源写入为 0。

- 主库 **52,421,396 字节**，SHA-256 `ff8f9d99c440d3e1d59a6993e5d43830591e543e9490a51eb25d50153ed3c607`。
- 仅从备份读回 **17 条完整外置核验证据**，逐条校验规范化哈希；物理证据 **17 文件、52,059,200 字节**，包括全部原始证据文件的长度与 SHA。
- 已有 **19 个 sidecar、2,019,461 字节**，0 个 inline namespace；本版 **没有新数据迁移**。
- 基线：画布 **4**、节点 **37**、连线 **25**、版本 **37**、素材 **582**、连接 **180**、供应商 **21**、运行 **547**、节点运行 **547**、核验 **17**、对话消息 **27**、会话 **2**、方案 **4**。
- 180 个连接 ID、Key 密文/归属等保护字段、21 个供应商保护字段、2 份实测 ledger、全部图及不可变集合仅保存保护哈希，没有输出 Key、密文或正文。
- 活动核验任务为 0；运行及节点运行分别均为 327 succeeded、43 needs_attention、173 failed、4 cancelled，非终态为 0。没有恢复或提交任务。

清单与摘要见 `profile-backup-manifest.private.json`、`protected-data-baseline.private.json`、[data-protection-summary.json](../.codex-logs/2026-10-17-release-v0.2.109/data-protection-summary.json)。

## 3. 安装器身份与覆盖结果

| 项目 | 身份 |
| --- | --- |
| 安装器 | `apps/desktop/release/SuperCanvas-Setup-0.2.109-x64.exe` |
| 长度 | **268,468,401 字节** |
| 安装器 SHA-256 | **`26dd7a06a5b5ef12767d517a466e4feebdcee4fc2212244016a10538554ce12f`** |
| 产品版本 | **0.2.109.0** |
| 最终 BUILD_ID | **`a16RkaOPDGx7UUgx0oNWU`** |
| 已安装 SuperCanvas.exe SHA | `6c446d1b113397d213ee56ea38b65182cb01d4e66e74f8d7ef48d79d251f3cf0` |
| 完整 renderer | **1035 文件、46,057,403 字节**，逐文件长度/SHA 清单完整 |
| renderer 清单 SHA | `d6957d8b0350851e09833b06ff0eeb466aaee88e879dba4867250b1728396be8` |

原安装位置 `C:/Users/Administrator/AppData/Local/Programs/SuperCanvas`，所有备份、缓存和证据仍在 D 盘项目。安装前 **12:54:25.125** 全部 profile 字节与备份一致，正式进程为 0。

安装器 **12:54:26.350–12:56:42.926** 执行，退出 **0**。安装后 **12:56:45.518** 核对版本、BUILD_ID、5 个核心文件及完整 renderer SHA 均通过；**12:57:02.712** 核对全部 profile 字节仍一致。

首次启动前，再次核对完整安装载荷，**12:57:34.067** 再核 2496 个 profile 文件与备份逐字节一致。最终客户端内联版本见 `validation/inline-version-final.json`，并非仅以 package 版本推断。

包摘要和完整清单见 [package-summary.json](../.codex-logs/2026-10-17-release-v0.2.109/package-summary.json)、`renderer-payload.json`。摘要中的 installerExecuted=false 是打包阶段历史状态；实际安装以 `installer-result.json` 为准。

## 4. 启动后无损核对

**12:57:35.262** 正常启动本轮自有正式实例，main PID **587288**、创建时间 **12:57:35.3296438**，使用原正式 profile 和 origin `http://127.0.0.1:55086`。未打开 CDP 或后端 inspector。输入观察器只记录是否发生输入及类型，不记录按键内容或位置；12:57:36.583 就绪，并以启动前 tick 与 hook 安装后的二次检查覆盖启用间隙。

先于 UI 操作完成 first-start 审计；返回首页后，又完成 after-ui 最终只读审计，覆盖期间应用自身后台自动检查的合法目录更新。两次均以 PID、绝对 exe 和创建时间绑定本轮实例，前、中、后没有用户输入标记。

| 校验 | first-start / after-ui |
| --- | --- |
| 采样时间 | **12:59:01.605 / 13:03:13.517** |
| 完整核验证据规范化哈希 | **17/17 一致 / 17/17 一致** |
| 全部既有证据文件原始长度与 SHA | **17/17 一致 / 17/17 一致** |
| 原连接 ID、Key 密文、归属和用户保护配置 | 全部不变 / 全部不变 |
| 图数据、完整画布、版本、素材、运行、对话等计数与不可变集合 | 全部不变 / 全部不变 |
| 供应商保护字段、实测账单证据 | 全部不变 / 全部不变 |
| sidecar / 原命名空间 | **19 个齐全且有效 / 19 个齐全且有效** |
| sidecar 字节变化 | **0 / 4 个合法后台自动状态变化** |
| 主文件大小 | **52,421,396 / 52,438,057 字节**；最终增加 16,661 字节是自动目录状态/业务缓存更新，不是新迁移 |
| 严格判定 | 两次 `losslessPassed=true`、`storageComplete=true` |

见 [data-audit-first-start.json](../.codex-logs/2026-10-17-release-v0.2.109/data-audit-first-start.json)、[data-audit-after-ui.json](../.codex-logs/2026-10-17-release-v0.2.109/data-audit-after-ui.json)。审计工具没有发业务 API、解密或写正式资料。未发现意外资料差异，**没有执行回滚**。

## 5. 只读窗口验收与当前状态

沿用 Computer Use 操作本轮自有窗口。供应商设置等待列表与详情实际加载后才保存；只查看已有刷新详情、展开目录记录并滚动到“来源读取诊断”，没有点击刷新、余额、保存、候选确认或来源外链。

- [首页](../.codex-logs/2026-10-17-release-v0.2.109/screenshots/installed-home.jpg)
- [供应商设置已加载](../.codex-logs/2026-10-17-release-v0.2.109/screenshots/installed-supplier-settings.jpg)
- [既有供应商刷新详情](../.codex-logs/2026-10-17-release-v0.2.109/screenshots/installed-supplier-saved-diagnostic.jpg)
- [新流水线来源读取诊断](../.codex-logs/2026-10-17-release-v0.2.109/screenshots/installed-supplier-diagnostics.jpg)
- [验收后回到首页](../.codex-logs/2026-10-17-release-v0.2.109/screenshots/installed-home-final.jpg)

均保留原生 JPEG 字节，未转码或合成。两项修复通过虚构上游 fixture 与相关回归验证；正式界面展示保存的历史诊断，没有手动刷新作真实供应商实测。

原保存模式“每天一次”保持。观察到应用自身后台检查提示更新，最终画面为“135 个连接需要手动刷新 · 部分型号沿用上次价格（5 个）”；这是保存状态的只读界面观察，未计作实发 HTTP 数或完整周期统计。上述合法后台变化已由最终数据审计区分，没有改用户保护数据。

**13:04:11.911** 输入观察器已卸载；**13:04:12.060** 再核同 PID/创建时间/绝对路径仍为 0.2.109.0 并运行。验收期间没有用户输入、没有改主题，已回首页；未关闭或重启应用。当前状态证据为 `ui-acceptance.json`、`acceptance-cleanup.json`。

## 6. 辅助工具诊断与回滚预案

产品验证、安装及无损校验均通过。辅助脚本的准备或记录问题保留在证据目录，未改产品断言：

1. 等待脚本遇到 `Relevant process identity unreadable; do not proceed.` 后停止，未进入资料读取。保留原脚本/错误日志，改为“记录不可读进程并继续等待，仍禁止备份”，沿用原 90 分钟截止。最后确认所有相关身份均可读、正式进程为 0 后才备份。见 `waiting-first-failure.json`、`waiting.stderr.log` 和 `waiting-resumed-helper.json`。
2. 资料工具首次内联生成命令报 `SyntaxError: Invalid or unexpected token`，未执行资料操作；改用独立准备脚本后，**10 项项目内虚构 fixture 全通过**。摘要的图计数字段曾取错，已仅从备份基线纠正为节点 37、连线 25，没有改原资料或基线。详见 `data-safety-operations.md`。
3. 启动身份额外守卫最初因 PowerShell 日期解析产生时区差，正式 DB 读取前即停止。改用 `DateTimeOffset` 的 UTC 比较，保留 1ms 精度限制后通过。first-start 子进程退出码 getter 返回 null，如实记为未捕获，未伪报 0；其完整严格审计布尔和哈希结果已独立核实。after-ui 提前保留 Process handle，实际退出码 **0**，没有为退出码问题重跑 first-start。

0.2.108 精确回滚包已在新证据目录 `rollback/SuperCanvas-Setup-0.2.108-x64.exe` 保护：**268,469,079 字节**，SHA **`a6bf0d46d1caca6f759ad829434fa41b6a0608fda19190c05f2ba155c71838ad`**。源前/副本/源后一致，安装前后独立 re-hash 通过。

预案为：若确认意外资料差异，停止验收，只关闭本轮自启实例，恢复整个 profile 备份，用该匹配的 0.2.108 安装器恢复，再逐文件 SHA 核对。本次无损检查全部通过，**没有触发预案**，完整备份和回滚包保留。工作区原有 `CLAUDE.md` 删除及其他无关未跟踪文件保持原样。
