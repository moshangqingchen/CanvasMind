# 第二轮源码与工作区清理核对（2026-10-08）

本轮按用户要求清理无用文件和代码，以 `8a9e74bf2f258884f85f52e1facc5002e80a487f` 的 0.2.74 源码与验收产物为保护基线。此次清理删除 8 个已无调用的私有客户端包装函数，减少 **206 行、6,120 字节**；删除 **884,786 字节、4 个可重建或已确认重复的临时文件**，约 0.84 MiB。没有将源代码减少量描述为已测得的界面性能收益。

## 源码清理依据

初轮 TypeScript AST 审计覆盖 838 个受 Git 跟踪的源码模块，识别 2,324 条 import、export、require 和字面量动态 import 关系。另审查 renderer lib 的 1,083 个导出声明；单次标识符出现只是待复核候选，不直接作为删除依据。

从 `apps/desktop/renderer/lib/client-api.ts` 精确删除沧元、喵呜、赛博阿飞、辰途各自的 `fetch*Catalog` 和 `fetch*Marketplace` 两个函数，共 8 个。当前源码、测试和文档没有这些函数的调用；当前供应商管理与画布通过 `client-suppliers.ts` 及连接模型读取路径加载数据。临时维护脚本也没有运行时调用：匹配到的旧 UI 位于两套自包含的历史源码快照；三份 2026-09-21 维护脚本仅生成上传测试或修改源码文本。

该 renderer 包明确为私有桌面界面及本地 API 工程，没有将这些浏览器包装函数作为包的公共 exports。历史快照中的旧函数与旧调用方完整保留。后端目录路由、目录发现与鉴权逻辑保持保留。

删除工具按 AST 声明范围处理，并逐条比较删除前后其余 **93 个顶层声明**，文本完全相同。保留实际仍使用的 marketplace view 类型、沧元渠道可用性缓存与查询、模型缓存、连接、画布、智能体请求及其授权接口。没有整文件格式化或删除后端接口。

模块级无静态入边的五个候选继续保留，原因分别是：

| 候选 | 实际用途与证据 |
| --- | --- |
| `apps/cloud-generation/src/worker.ts` | `wrangler.jsonc` 指定的可选网关入口和 Workflow 类 |
| `apps/desktop/renderer/e2e/global-setup.ts` | Playwright 配置的 `globalSetup` |
| `apps/desktop/src/preload.cjs` | 桌面构建复制，并由 Electron `webPreferences.preload` 加载 |
| `apps/desktop/src/runtime-hook.cjs` | 桌面构建复制，程序启动时装载 |
| `docs/audits/2026-10-05/graph-benchmark.mjs` | 历史性能核对文档明确保留的复现入口 |

两个内容相同的 Vitest 配置分别服务独立包。手动 dev smoke、桌面截图与自定义供应商 smoke、仓储基准、维护诊断和仍使用的兼容入口继续保留，没有为了减少文件数量改造它们。

## 实际文件清理

| 路径 | 文件数 | 删除字节数 | 依据 |
| --- | ---: | ---: | --- |
| `apps/desktop/renderer/playwright-report` | 1 | 528,222 | 可重建的浏览器报告 |
| `apps/desktop/renderer/test-results` | 2 | 45,123 | 测试状态文件及已确认重复的截图 |
| `apps/desktop/renderer/tsconfig.tsbuildinfo` | 1 | 311,441 | TypeScript 增量编译缓存 |

临时喵呜升级截图与保留的 e1a 历史验收截图均为 45,078 字节，SHA256 同为 `CCC865A369EE42673038DF45141D856042D1CD314F4AC0323DB7811DDEDC5874`。只删除临时副本，归档副本不变。`test-results-suppliers` 的三张截图没有证明存在相同副本，全部保留，共 335,900 字节。

删除使用 PowerShell `Remove-Item -LiteralPath`，在同一 shell 内先验证绝对路径处于工作区、所有祖先和目标内部没有重解析链接、没有受 Git 跟踪的文件、没有潜在 Playwright／TypeScript／smoke 写入进程；删除前再次核对目标文件长度和 SHA256。

14 个保护文件在清理前后完整 SHA256 相同，包括 0.2.74 三处 BUILD_ID、桌面入口、安装包、blockmap、latest.yml、本地与远端验收收据、三张独有截图和保留的重复截图主副本。保留当前 renderer 构建、stage、dist、win-unpacked、开发依赖、全部历史验收与回滚资料、未跟踪用户报告。没有读取或修改正式资料库、画布、素材、连接、Key 或安装目录。

## 验证与交付状态

| 验证 | 本轮实际结果 |
| --- | --- |
| 现有清理保护回归 | 5/5 首次通过，0 失败／跳过；覆盖工作区越界、目录链接及资料保护 |
| 客户端 API 回归 | 12 个文件，63/63 首次通过；连接、模型缓存、可用性、上传、画布保存、恢复和超时行为保持通过 |
| 修改文件 Lint | 通过，0 输出 |
| 定向严格类型检查 | 通过；禁用 incremental，没有重新生成已删除缓存 |
| Git 差异检查 | 通过；客户端 API 差异仅 206 行删除 |

本报告只记录此次清理子任务，不将同期其他协作者的界面或智能体实现算入该清理差异，也不将 0.2.74 的旧构建验收写成新版本验收。本轮未构建、安装、提交、推送或发布新版本。删除量是此次操作量，后续开发和测试可重新生成缓存。

安全逐文件清单、哈希、引用审计和原始测试日志位于 `.codex-temp/code-cleanup-second-20261008/`；结构化汇总见 [code-cleanup-audit-2026-10-08.json](code-cleanup-audit-2026-10-08.json)。
