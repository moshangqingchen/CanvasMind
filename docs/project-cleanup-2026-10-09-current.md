# 项目清理复查（2026-10-09）

本次完成源码引用核查和可重建产物清理。日期按 `America/Los_Angeles` 记录。删除可重建报告、测试运行状态和 TypeScript 增量缓存 **849,533 字节（约 0.81 MiB）、3 个文件**；另将 **5 张独有验收截图、744,958 字节** 归档保存，不能将这部分计入空间节省。新增审计文件的占用未从删除量中扣除，后续构建和测试可能重新生成产物，因此不把删除操作量描述为最终磁盘净节省。

## 实际清理项

| 原位置 | 原文件数 | 原字节数 | 处理 |
| --- | ---: | ---: | --- |
| `apps/desktop/renderer/playwright-report` | 1 | 532,950 | 删除可重建 HTML 报告 |
| `apps/desktop/renderer/test-results` | 3 | 409,103 | 删除 45 字节测试运行状态；佳速图片、视频参数截图共 409,058 字节归档 |
| `apps/desktop/renderer/test-results-suppliers` | 3 | 335,900 | 桌面、移动端和手动供应商流程截图全部归档，没有丢弃证据 |
| `apps/desktop/renderer/tsconfig.tsbuildinfo` | 1 | 316,538 | 删除可重建增量编译缓存 |

截图归档目录为 `.codex-temp/project-cleanup-20261009-current/preserved-e2e/`，下方保持原目录层级。每张图片在删除原位置之前和之后均核对长度与 SHA256 一致；原路径、归档路径和校验值见该审计目录的 `result-safe.json`。此前 `test-results-suppliers` 的截图与 `.codex-temp/redesign-review` 同名图片内容不同，本次保留了各自内容。

删除复用 `scripts/clean.mjs` 的计划、路径验证和执行接口，并将本轮范围固定为上述四项。执行前核对没有 Playwright、Next、桌面构建或 TypeScript 编译写入进程；逐层验证绝对路径位于本工作区、拒绝目录链接，并确认目标下没有受 Git 跟踪的源码。删除前再次逐文件核对 SHA256，防止初次扫描后的变化。归档时使用排他写入，不覆盖既有证据。

清理完成瞬间再次运行普通清理计划，结果为空。`apps/desktop/dist/main.cjs` 与 `apps/desktop/release/latest.yml` 的 SHA256 在清理前后相同。正式安装程序仍在运行，未停止或改写正式安装与用户资料。

## 源码与死文件核查

TypeScript AST 扫描包括受 Git 跟踪与未跟踪、非忽略的当前源码，共 **892 个模块、2,575 条可解析静态 import/export/require/字面量动态 import 关系**。不是仅依据文件名、文件年龄或单次文本出现决定删除。五个无静态入边候选都有实际入口，全部保留：

| 候选 | 保留依据 |
| --- | --- |
| `apps/cloud-generation/src/worker.ts` | `wrangler.jsonc` 的 `main` 和可选图像网关 Workflow 入口 |
| `apps/desktop/renderer/e2e/global-setup.ts` | Playwright 配置的 `globalSetup` |
| `apps/desktop/src/preload.cjs` | 桌面构建复制，Electron `webPreferences.preload` 装载 |
| `apps/desktop/src/runtime-hook.cjs` | 桌面构建复制，后端进程启动时通过 `--require` 装载 |
| `docs/audits/2026-10-05/graph-benchmark.mjs` | 性能审计文档明确保留的复现入口 |

两个内容相同的 Vitest 配置分别服务 `core` 与 `director` 独立包，保留。另筛查 renderer lib 的 **1,096 个导出声明**，42 项只有单个标识符出现的候选记录在 `export-audit-safe.json`；其中包含协议类型、诊断/兼容入口和正在复查的供应商实现，不能仅凭这一指标删除。本清理子任务未删除应用源码或修改 UI/供应商实现；并行 UI 修复和供应商接入由对应变更及验证记录负责。

当前工作树原有源码修改、未跟踪测试/模型 fixture、历史报告与供应商证据、原始图片和视频、备份、项目、密钥、资料库、依赖、现有构建与打包输出全部保留。未执行 `clean:deep` 或素材 GC，也未将 `.codex-temp` 整体视为垃圾。

## 验证

- `node --test scripts/clean.test.mjs`：**5/5 通过**，0 失败/跳过；覆盖工作区越界、非产物拒绝、目录链接和用户资料保护。
- 5 张归档截图：清理前后长度和 SHA256 均一致。
- 两个现有桌面启动/发布文件：清理前后 SHA256 一致。
- 修改文档 `git diff --check`：通过。

未重复执行全仓类型检查、Lint、单元测试或构建，统一验证由本次主任务执行。本记录只证明清理及其保护边界，不作为安装版 API 读回、安装版界面验收或真实收费生成的证据。维护说明已补充 E2E/清理前保存独有证据的步骤。

本机审计文件位于 `.codex-temp/project-cleanup-20261009-current/`：`plan-safe.json`、`result-safe.json`、`source-audit-safe.json`、`export-audit-safe.json` 及本轮执行脚本。未读取正式数据库或凭据，未发起网络/供应商请求。

## 本轮构建期间的大文件复核

2026-10-10 01:33 UTC 追加只读扫描，限定 `.release-stage`、`apps/desktop/release` 与三个本轮审计目录，不跟随目录链接，也不触及外部 profile/backups。结果见 `.codex-temp/project-review-20261009/build-duplicates-readonly-safe.json`。

- `.release-stage`：254文件、31,942,959字节，均非本轮新写文件，保留。
- `apps/desktop/release`：共4,363,122,031字节，本轮新写980,511,852字节，主要为0.2.82安装包及`win-unpacked`运行依赖；仍在用于构建与安装验收，保留。
- 本轮`project-review`目录：244,409,184字节。主要是逐次目录状态、冻结输入与独立E2E trace；两份大trace的SHA不同，前后快照的状态/时间也不同，不能按文件大小或相似名称当作重复垃圾。
- 同日其他供应商审计目录中的正式资料基线、当前官方业务页面原文、价格快照和原图证据继续保留。

本次追加复核没有确认可安全删除的新增无用重复输出，实际删除0。没有扩大此前0.81 MiB清理操作量，也没有删除仍在使用的构建文件、旧安装包或回滚副本。
