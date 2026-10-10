# 0.2.85 发布前源码清理（2026-10-09）

本轮按用户要求核查无用源码，范围是当前工作树的私有桌面界面、后端辅助模块与测试。先读取 renderer 的 Next.js 规则、已安装 Next.js 的入口约定、项目维护规则和两轮既有清理记录；没有按文件年龄或文本零引用直接删除文件。本记录只包含源码与清理依据，不包含账户资料、提示词或用户目录。

## 引用核查

TypeScript AST 扫描覆盖受 Git 跟踪及未跟踪、非忽略的 **923 个源码模块、2,681 条可解析 import/export/require/字面量动态 import 关系**。另检查私有 renderer lib 的 1,110 个导出声明；单个标识符出现仅作为复核线索。对实际删除项继续核对当前源码、测试、脚本、配置、文档与历史维护脚本，并确认 renderer 包声明为 `private`、没有将这些浏览器函数发布为包 exports。

## 已删除代码

| 文件或声明 | 删除依据与当前入口 |
|---|---|
| `apps/desktop/renderer/lib/director-client.ts` | 整个旧浏览器客户端只被自己的专属测试导入。原 `super-director-panel.tsx` 已在上一轮清理删除；当前 `creative-agent-panel.tsx` 使用 `agent-client.ts` 的 `agentRequest`、`streamAgentTurn`。历史源码快照中的旧客户端与旧面板仍自包含，不依赖当前文件。 |
| `apps/desktop/renderer/lib/director-client.test.ts` | 六项用例只测试上述无产品调用方的客户端，因此随对应实现一起移除。当前智能体事件流回归、导演后端与协议适配回归保留并执行，不用删除测试掩盖现用功能错误。 |
| `client-api.ts` 的 `sendAgentChat`、`AgentChatMessageView`、`AgentChatContentPartView`、`AgentChatResponseView` | 旧聊天包装函数及其专属类型没有当前调用方；当前界面通过 `agent-client.ts` 请求。`/api/agent/chat` 后端兼容路由保留。 |
| `client-api.ts` 的 `CangyuanAvailabilityView` | 无导入方的纯类型别名；当前可用性界面和测试直接使用 `cangyuan-availability-types.ts` 的 `CangyuanAvailabilityItem`，客户端仍保留实际使用的 Snapshot 类型与请求。 |
| `project-service.ts` 的 `canvasForProject` | 无调用方的单层包装；项目 API 直接使用 `repository.getCanvas`。不改仓储、画布读取或保存。 |
| `project-service.ts` 的 `archiveAssetForProject` | 无调用方的单素材包装；当前归档路由使用 `archiveExternalAssetsForProject`，生成结果使用 `archiveGeneratedAssetForFinished`。公共归档路径和共享 `archiveAsset` 实现保留。 |
| `director-adapters/shared.ts` 的 `strictDecision` | 四种协议适配器均使用 `strictDecisionFromCandidates` 处理供应商响应封装；旧单值包装无调用方。保留实际使用的 `parseDirectorDecision` 校验及全部协议适配路径。 |

合计删除 **2 个文件**，并在其余 3 个文件中删除 **4 个无调用函数、4 个孤立类型声明及随之无用的两个类型导入**。Git 差异为 455 行删除、1 行导入调整，净减 **454 行、14,993 字节**；不将源码减少量描述为已测得的界面性能收益。AST 逐项核对这 3 个保留文件中其余 **154 个顶层声明**，除上述类型导入移除外文本完全相同，没有改动现用逻辑。

## 明确保留

| 候选 | 保留依据 |
|---|---|
| `apps/cloud-generation/src/worker.ts` | `wrangler.jsonc` 指定的可选网关入口及 Workflow 类。 |
| `apps/desktop/renderer/e2e/global-setup.ts` | Playwright 配置的 `globalSetup`。 |
| `apps/desktop/src/preload.cjs` | 桌面构建复制，由 Electron 的 `webPreferences.preload` 装载。 |
| `apps/desktop/src/runtime-hook.cjs` | 桌面构建复制，后端进程通过 `--require` 装载。 |
| `docs/audits/2026-10-05/graph-benchmark.mjs` | 历史性能文档明确保留的复现入口。 |
| 内容相同的 core/director Vitest 配置 | 分别服务两个独立工作区包。 |
| Next.js 路由、布局、代理及其他约定入口 | 由框架发现，不依赖普通模块导入计数。 |
| 后端 `/api/director/**`、`/api/agent/chat`、供应商同步与兼容入口 | 本轮删除的是已经没有产品调用方的私有客户端；后端接口、协议、迁移与恢复语义保持，不能把历史兼容能力当作普通死代码。 |

现存供应商证据、fixture、维护复现脚本和历史源码快照不按单次引用计数删除。没有确认可安全移除的依赖，本轮不改任何依赖声明、锁文件或版本，也未改动并行进行的模型菜单与节点面板布局文件。用户资料、安装程序和可重建产物的整理不属于本段源码删除统计。

## 验证

- 客户端 API、当前智能体客户端、项目服务、导演协议适配器以及相关后端兼容路由定向回归：**19 文件 / 210 用例通过**，`maxWorkers=4`。
- 三个保留修改文件的 ESLint：通过。
- renderer TypeScript 类型检查：`tsc --noEmit --incremental false` 通过，未生成增量缓存。
- AST 保留声明一致性与 Git 空白差异检查：通过。

本轮没有生成新的产品行为测试，使用现有回归核对实际保留的调用路径；没有运行桌面构建、安装或操作用户应用。源码验收不替代随后新版本的构建与升级验收。供应商请求、真实生成及收费视频请求均为 **0**。原始安全扫描、源码差分校验和检查日志保存在本地 `.codex-temp/code-cleanup-source-20261009-final/`。

## 合并前统一检查

清理与同期面板变更合并到当前工作树后，完整 renderer 单测 **219 文件 / 2,584 用例通过**，全量 ESLint 通过，维护边界检查 **12/12 通过**。首轮单测曾有两项 Seedance 兜底断言失败：主工作树仍读取旧的 providers `dist`，缺少已提交的兜底实现；0.2.84 当时在独立干净工作树构建，不能代替当前工作树的共享产物。按现有依赖构建顺序重建 6 个共享包后，重新执行完整 renderer 单测即全部通过，没有修改断言或产品源码。首轮与最终日志分别保留在 `.codex-temp/cleanup-release85/`。

该统一结果对应新增供应商接入之前的检查时点。后续接入变更以及最终桌面构建、全项目类型检查、安装版和公开升级验收须另行核对，不能复用为未经检查的新源码的通过记录。
