# 源码清理与整理（2026-10-08）

本轮按用户要求清理多余文件与代码，整理重复实现并修复确认的可靠性问题。基线为已发布的 0.2.66，提交 `864b5f8a266a07d7a5bf5d3ef81d59704540c72d`。本报告记录升级发布前的源码整理与本地验证，当时正式发布版本为 0.2.66；后续升级内容见 [v0.2.67 发布说明](./releases/v0.2.67.md)，发布是否成功以对应工作流及公开发布验收为准。

## 已完成的整理

| 范围 | 修改与依据 |
| --- | --- |
| 旧界面文件 | 删除 `components/agent-panel.tsx` 和 `components/super-director-panel.tsx`，共 3,012 行。初轮 TypeScript AST 扫描全仓 808 个源码模块的 import/export/require/dynamic import，确认这两个组件无引用；当前入口实际使用 `creative-agent-panel.tsx` |
| 文件下载与导出 | 项目 JSON/完整项目包、定稿交付、设计方案包和任务诊断四处调用统一的 `lib/blob-download.ts`。保持各调用方原始 Blob、MIME、文件名和 1 秒 URL 回收时序，失败继续向原调用方抛出，并清理临时链接 |
| 长工作流预检 | `desktop-preflight.ts` 对入边建立一次索引，以显式栈代替递归与重复扫描全体边。基线 12,000 节点合成链会抛 `Maximum call stack size exceeded`，整理后得到正确业务错误或正常放行纯文本链 |
| 无效配置 | 去掉无读取引用的 `NEXT_PUBLIC_DIRECTOR_ENABLED`、两条被通用规则覆盖的 test-results 忽略项，以及只匹配旧 Next 16.3.3 的两条 override |
| 锁文件 | 只同步删除上述两条 override，依赖解析图保持原样。`importers/packages/snapshots` 前后 SHA256 相同：`ea543f6a04b83a26b18f3985ecf3be6c7c41c8daeb406e8907232dba0ae665c0`，离线 frozen-lockfile 检查通过 |
| 参数与文本格式 | 两个未使用参数改为下划线名称，位置与类型不变；所修改画布文件按既有 `.gitattributes` 保持 LF |
| 维护目录说明 | 补充当前可选 `apps/cloud-generation` 网关用途，区分它与已移除的旧独立网页版 Worker；它仍被桌面设置及运行时提交/恢复调用 |

供应商、完整型号、费用、公开参考图限制、云端生图放行、素材通道、错误 code 和公开 API 保持原有合同。共用 CSS、旧聊天历史迁移、兼容客户端和 API 仍有用途，继续保留。

预检改动另经独立差分复核：4,000 个随机合成小图、49,425 个起点，包含循环、缺失节点、重复边和嵌套素材引用，11,506 次 true、37,919 次 false 均与旧实现一致。本次改为迭代的是图的祖先遍历，不宣称任意深度嵌套对象解析也已消除递归。

## 测试隔离修复

首轮全量测试出现一项既有手动模型用例 5,000ms 超时。该测试只替换了模型列表的 `fetchProviderJson`，成功扫描后的价格、接口文档与能力补充仍会走独立外网读取。

本轮仅在 `models-manual.test.ts` 为这三项附加读取补齐测试替身；保留真实 manual 合并、协议绑定和鉴权路径，设置意外请求哨兵，并加强 200/live、准确 ID、协议、GET 地址和合成鉴权断言。401 拒绝与 404 保留独立手动记录的原有用例保留。没有改产品文档读取逻辑、放宽超时、跳过或启用重试。

45 项相关回归通过；随后 5 个独立 Vitest 进程运行原 3 项用例，15/15 通过。原超时用例耗时 7.51–7.92ms，每轮额外请求哨兵调用为 0。初轮失败日志保留在 `full-unit-tests.log`，最终全量成功日志另存。

## 可重建产物清理

逐项验证绝对路径在当前工作区内、不含目录链接且没有受 Git 跟踪的源码后，复用已有安全清理器删除三项：

- `apps/desktop/renderer/playwright-report`
- `apps/desktop/renderer/test-results`
- `apps/desktop/renderer/tsconfig.tsbuildinfo`

本次清理操作删除 969,142 字节、3 个文件，约 0.92 MiB。后续验证会重新生成必要缓存，因此该数值是删除操作量，不是最终磁盘净节省量。三张没有确认重复副本的历史供应商截图保留；不整体清理 `.codex-temp`、`.release-stage` 或备份。

正式安装、正式资料库、画布、素材、连接和 Key 不在本轮清理范围内。依赖目录、历史证据、当前安装包与更新文件保留。验证过程中正常重建本地 `.next-desktop`、共享包 dist、stage 和 win-unpacked；没有执行素材 GC。

## 最终验证

| 验证 | 结果 |
| --- | --- |
| 全项目类型检查、Lint | 通过；renderer 严格未使用声明检查及所改测试文件 Lint 也通过 |
| 全量单元测试 | **3,850/3,850**：core 30、db 50、storage 27、providers 1,187、director 24、desktop 76、runtime 366、renderer 2,090 |
| 维护检查 | **12/12** 通过 |
| 长图回归 | 新增三项，覆盖 12,000 节点媒体链拒绝、文本链放行、上游循环终止及循环内媒体识别，均通过；包括在上述 runtime 366 中，不重复累计 |
| 桌面生产构建 | `node scripts/build-desktop.mjs --unpacked` 通过，生成可运行的本地打包程序；BUILD_ID 为 `u_4tOmlhNVgOpiXxGF69V`。使用 `--publish never`，没有生成或发布新版本安装包 |
| 浏览器功能 | 已安装 Chrome 上 **7/7** 通过，18.6 秒，显式 `--retries=0`。验证四种导出、当前智能体入口及两项保存冲突保护；交付包包含原始图片字节、实际尺寸及评审，任务诊断没有提示词 |
| 打包常规 smoke | **27 项通过**，包含启动、鉴权、Fake 生成、音乐播放/下载、素材、项目导入导出、布局、退出保存及重启恢复 |
| 普通 GPU 窗口 smoke | **4 项通过**，正常绘制、重启、实际渲染崩溃后新 PID 恢复，后台 PID/端口/资料库一致，rendererErrors 为空 |
| 工作区差异与进程 | `git diff --check` 通过；验收服务已退出，未发现本轮工作区的 Node/Electron/桌面程序残留 |

浏览器首轮指定缓存 Chromium 时全部在启动阶段失败，错误为 `browserType.launch: spawn UNKNOWN`，没有进入功能断言。使用项目默认的已安装 Chrome 后七项全部通过；首轮日志与 trace 另存，未覆盖或作为产品测试通过结果。构建中的 author/packageManager 元数据提示与 Node DEP0190 警告保留，没有当作运行时错误，也没有修改安全策略绕过测试。

本轮仅使用隔离资料库、Fake Provider 和合成测试数据，没有读取正式 Key、提交收费生成或变更正式应用数据库。长图测试证明该预检边界修复，短时桌面 smoke 不等同于多小时稳定性或内存泄漏证明。

原始日志与新截图保存在 `.codex-temp/source-cleanup-20261008/`；配置清理证据位于 `.codex-temp/maintenance-cleanup-20261008/`，模型测试隔离证据位于 `.codex-temp/renderer-manual-contract-recheck-20261008/`。本轮安全汇总见 [code-cleanup-2026-10-08.json](./code-cleanup-2026-10-08.json)。
