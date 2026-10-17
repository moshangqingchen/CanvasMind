# 本地覆盖安装 v0.2.106（2026-10-16）：安装完成，正式窗口验收未完成

归档日期为 2026-10-16，以下证据时间使用 UTC。**已完成源码验证、完整备份、打包、隔离冒烟、本机覆盖安装及安装身份核对。正式资料窗口验收尚未完成，不能写为全面验收通过。** 用户已开始自行试用，正式应用后来在本自动化之外重启；当前实例仍运行在一张画布内，主题未知，未回首页。记录将安装前保护、旧验收实例、运行期写回和最新只读观察分别列明。

仓库 `D:\project development\超级画布`，分支 `release/v0.2.105`，本轮验证及打包基于 `e7eca048c3a54d52f8d764351f5935aa1bc90ae8`。功能提交 `9b2a26c`、`e7eca04` 为本轮开始前的既有提交。之后外部 Claude 于 **23:34:34Z** 提交了 `1ecc36a6d716e76425beeca475cfa5ae4b60ff23`（`chore(release): v0.2.106 local install record`），当前 HEAD 已推进到该提交；本自动化没有执行 git commit，不回退或改写外部提交，本次后续补记仅留在工作区。根目录、桌面包及实际安装版本为 **0.2.106**，Windows 产品版本 **0.2.106.0**，已核对安装 BUILD_ID 为 `wQ4ECUuNuy6dq6zmYKUuO`。

安装器：`apps/desktop/release/SuperCanvas-Setup-0.2.106-x64.exe`；大小 **267,425,898 字节**；SHA-256：`0669141a3071de3c36adf670e3fefe703e35bce2b1e43bdd4bd1b5ebde0ca4bb`。安装位置保持 `%LOCALAPPDATA%\Programs\SuperCanvas\`，正式资料保持 `%LOCALAPPDATA%\SuperCanvasDesktop\profile`，未迁移。

更新说明见 [v0.2.106](releases/v0.2.106.md)：神经网络工作台、本地检索和详情面板、统一创作设置、创作助手消息/历史/模型浮层与流式回复、网格整理、批量素材避让、多选批量连线和简洁型号报价。本轮没有修改供应商协议或价格源码，但**启动后旧自动目录升级及运行期读写实际改变了保存的型号、参数与价格缓存**，详见下文，不能据更新说明声称正式连接和价格数据完全未变。

本轮代理及子代理未 commit、未 push、未发布 GitHub Release；外部 Claude 已作上述本地提交，不能再将全局状态写为“所有改动尚未提交”。本自动化未直接编辑正式 profile、回滚用户数据、创建或更换 Key、充值、主动发送智能体对话或发起收费生成。用户自行试用期间出现了实际 `/api/agent/turn`，因此不能将整个会话写成“0 次真实对话”。创作助手的受控真实回答评测仍未完成，隔离环境无法解开 Key，评测调用 0 次，不能宣称回答质量已实测提升。

## 源码与构建验证

全工作区单元及相关 helper 合计 **7,871 通过、8 跳过、0 失败**；其中按 SHA 审计复用 **4,119 通过、1 跳过**，本轮实跑 **3,752 通过、7 跳过**。

| 范围 | 通过 | 跳过 | 依据 |
| --- | ---: | ---: | --- |
| core | 30 | 0 | SHA 复用 |
| db | 51 | 0 | SHA 复用 |
| storage | 27 | 0 | SHA 复用 |
| providers | 3342 | 0 | v0.2.104 最终同输入原日志，SHA 复用 |
| runtime | 503 | 0 | v0.2.104 最终同输入原日志，SHA 复用 |
| cloud-generation | 24 | 0 | SHA 复用 |
| Electron 单元 | 116 | 1 | SHA 复用 |
| 维护边界 | 11 | 0 | SHA 复用 |
| e2e memory helper | 12 | 0 | SHA 复用 |
| e2e edge helper | 3 | 0 | SHA 复用 |
| renderer API/lib/proxy | 3703 | 7 | 本轮单 worker |
| 创作助手评测离线设施 | 32 | 0 | 本轮单 worker，仅合成 fixture |
| director 共享层 | 17 | 0 | 本轮单 worker |

十个复用范围核对 **406 条源码文件、5 条共享配置**，Git blob 身份一致，各旧日志 SHA-256 匹配原 artifact-index，原字节复制到本轮 D 盘。常规基线为 `912ddb4`；providers/runtime 采用 `aea977e` 对应最终日志，核对其后输入未变。v0.2.105 引用的 `remove-director2.log` 原文件已缺失，本轮未假称复核该原日志；director 共享层重新运行。

首次两个 pnpm 单元入口在用例执行前因依赖预检退出，原文为 `[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY`。未允许自动清除/重装依赖，改用 Node 运行现有 Vitest 入口后通过；原始混合编码日志与可读派生文本分别保留，不把前置错误计为测试用例失败。评测离线设施用临时 paths alias 将合成报告引向本轮证据目录，测试配置随后原字节恢复，SHA-256 为 `c88e9bcdee16ad87a174173ca949d6a15830170604fbab2599738a22fa0c66bc`，未运行 live 配置。

renderer typecheck、lint 均通过；最后的 acceptance 检查分别于 **23:12:45.223Z**、**23:13:27.005Z** 完成，退出 0。`pnpm desktop:build` 于 **22:43:19.319–22:45:32.715Z** 完整完成，退出 0，包含共享包、最终 Next 生产构建、桌面壳、staging、NSIS 和 verify-release。内联版本为 0.2.106；renderer、stage、win-unpacked 的 BUILD_ID 一致；发布说明源文件与打包副本原字节相同，官方 Node 校验与捆绑媒体工具检查保留。**23:14:21.829Z** 的工作区 `git diff --check` 和暂存区同项检查均退出 0。

独立源码审查确认：本轮没有产品业务代码/CSS 修改，没有降低性能门槛、增加 skip 或删除覆盖；8 份 e2e 与 4 份 smoke 的改动仅为证据路径和陈旧 UI 断言适配，不要求重复生产构建。

### 完整 e2e 与失败处置

完整默认套件仅运行 **一次，611 项、单 worker、重试 0**，从 **22:43:54.014Z** 至 **23:12:47.825Z**，退出 1：**567 通过、36 跳过、8 个用例失败**，另有 **1 个独立全局 teardown 错误**。

两项旧设置动效断言原文为：

```text
Error: expect(locator).toHaveCSS(expected) failed
Locator: getByRole('dialog', { name: '供应商与模型设置', exact: true })
Expected: "none"
Received: "neural-settings-fade"
Timeout: 10000ms
```

`e7eca04` 的 `settings-neural.css:156–158` 已明确规定减少动态效果使用单次 150ms、仅 opacity 的 fade，第 16 行已有静态 `blur(9px) saturate(85%)`。仅修正测试，精确检查动画名、时长 ≤150ms、次数 ≤1、当前与关键帧均无 transform，以及静态玻璃背景；保留拖动阴影降级/恢复、交互清理、网格同步和零提交覆盖。使用另一独立 profile 于 **23:13:03.657–23:13:09.836Z** 定向复跑，**2 项通过、0 失败**、守卫阻断 0。

按相同用例 ID 合并，最终为 **569 通过、36 跳过、6 失败、0 flaky**；这不是重新整套通过，也不抹去初次全量的全局 teardown 错误。36 项为默认未启用的视觉/诊断/内存专项，逐项标题与原因保留。

六项剩余失败为 prompt/mixed × 50/200/500。每场景 drag、zoom、multiselect-drag 三种手势均实际采样，合计 **18 组原始数据**。原错误样例：

```text
Error: prompt/50/drag: available RAM must be >= 6 GiB
Expected: true
Received: false
```

实际可用内存为 **787,795,968–1,373,839,360 字节**，原要求为 **6,442,450,944 字节（6 GiB）**；全部样本无效，保留失败，没有改门槛或转为跳过。六份 `performance.json`、console-events、附件和截图保留在 `e2e-full/results/canvas-performance-*/`，summary 列出全部路径和 18 组数据。没有其他帧时/样本数断言失败，但不能据此声称有效完整性能基准通过。

独立 teardown 错误原文：

```text
Error: 1897 forbidden server external requests were blocked
at helpers/neural-global-setup.ts:176:13
```

全量沿用原神经/助手专用回环守卫；部分既有参数 fixture 创建假 REST 连接，却未完整模拟本机 models API。只读源码链为：画布 `fetchModels`/`refreshModels` → 本机 `/api/providers/:id/models` → 型号 inventory 的默认价格补全 → `discoverSupplierCatalog`/`providerFetch` 的免费目录 GET → 非回环 socket 在 connect 前被阻断。`SUPPLIER_AUTO_VERIFY=off` 不会禁止所有目录补全；共享临时仓库中的旧假连接和后台重读可能延续触发。

首条阻断 **22:46:23.840Z**、末条 **23:12:38.300Z**；1,897 个时间戳均且仅重合一个活动用例区间，涉及 **9 个 spec、24 个用例**，这些用例自身通过。**原守卫日志没有 host、API、请求 ID 或 stack；时间重合不等于逐条因果追踪，阻断数不能写成 HTTP 请求数、收费次数或生成提交数。** 实际外连成功数 0，保留原守卫及附加错误，未去掉保护或重跑整套抹去记录。这项夹具/范围兼容问题未在本轮修复。

全量/定向 profile 分别为 D 盘临时目录 `supercanvas-e2e-Vy1J8k`、`supercanvas-e2e-PYu3WF`，未复制正式 profile、Key 或用户项目。测试服务和临时数据已清理。运行期间后补的 image-design/suppliers 路径修正未作用于已缓存转换：5 张 PNG＋1 份 JSON 首次仍落在旧 D 盘 `.codex-temp/` 和 `apps/desktop/renderer/test-results-suppliers/`。六文件均未删除，已无重编码地归档到 `e2e-full/legacy-output-archive/`，原路径、时间、长度和 SHA-256 对应留证。最终纯路径修改经静态检查与独立审查，没有重复三个已通过行为用例；不能声称首次就全部直接输出到指定证据根。

### 源码清单证据限制

原 `source-manifest.json` 采样于 **22:43:57.504Z**，1,358 项；独立审查在 **22:53:21.729Z** 读取原清单，确认 1,353 项相同、5 项纯测试变化、无新增源码。主任务于 **23:14:22.472Z** 重新采样时覆盖了同名文件，**没有保存原完整清单副本**。原 SHA-256 `1dcfdca79be832f7dd63f10a75f981b9661b959f0eee37eb599ff8440b977f12`、原采样时间、比较计数及 5 项前后 SHA 保留在独立审计摘要中，但原完整清单已不能独立重放。

最终快照另存 `source-manifest-final.json`，SHA-256 `0de2336251585347cfaec2a27f68ce48af33f08811b7b14bdcc3d82c5a4fecd3`，1,358 项与当前文件相同。独立 `unit-input-manifest.json` 仍保留 1,147 项输入 SHA。生产输入未因测试适配变化的结论来自覆写前已完成的审计及现存身份记录，不能把两个现存 manifest 当作原/最终两份完整清单。

## 完整备份、打包冒烟与覆盖安装

备份前正式安装目录下进程为 **0**，仅按绝对安装路径识别，未关闭或强制结束用户应用。完整备份为：

`D:\project development\超级画布\backups\before-local-update-v0.2.106-20261016T224229Z\profile`

于 **22:42:48.495Z** 完成，**2,460 文件、1,191 目录、3,970,633,033 字节**；逐文件长度和 SHA-256 相同，源目录在复制及核对期间稳定。数据库 SHA-256 为 `f7059428df473689b97b27713c227c72088dd86f1cacccdf6e2c258c86ab5544`。C 盘旧备份未动；新备份、证据与 TEMP/TMP、npm/Electron/electron-builder 等缓存均按要求放在项目 D 盘。

最终 **29 项打包冒烟＋4 项普通可见窗口冒烟**通过，全部使用 D 盘独立临时 profile，覆盖隔离 Fake/离线 CLI、媒体归档播放、原文件及多格式下载、单实例、六帧流光、持久化、重启，以及正常 GPU 可见窗口和 renderer 崩溃恢复。新首页按项目 ID/标题核对 API 与画布模块 DOM，然后回 hub 捕获 Electron 绘制；这不冒充正式 profile 的鼠标界面验收。

首次冒烟仅完成前 3 条后因 `AssertionError [ERR_ASSERTION]: homepage eyebrow text must stay on one line` 退出 1。测试把非数值 computed line-height 用于高度比较，已改为 DOM Range 实际文本行框，保留单行要求；原失败日志、报告和 PNG 独立保留。修正后全套于 **22:46:19.395–22:46:40.059Z** 退出 0，29 条、无 error；可见窗口于 **22:46:45.254–22:46:54.417Z** 退出 0，4 条、rendererErrors 0。profile 为 `supercanvas-desktop-smoke-sZi0h7` 和 `supercanvas-desktop-smoke-windowed-XN8UDx`，均位于 `.codex-temp/release-v0.2.106/`。

安装前 **23:14:28.152Z** 再次 verify：正式进程 0，完整目录及所有文件字节与 D 盘备份一致。安装器于 **23:14:28.256Z** 启动、**23:17:23.058Z** 正常退出，退出码 **0**。**23:17:44.010Z** 首次启动前 compare 再次确认正式进程 0、全部资料字节与备份一致。安装本身未造成资料字节变化。

**23:17:45.039Z** 实际安装身份核对为产品 **0.2.106.0**、BUILD_ID `wQ4ECUuNuy6dq6zmYKUuO`；下列文件长度与 SHA-256 均与 win-unpacked 一致：

| 文件 | SHA-256 |
| --- | --- |
| `SuperCanvas.exe` | `8bca280f4ca8fe3774a61807c0a647cf740ca075bd227dcbea8f6f79a9a0be27` |
| `resources/app.asar` | `089785bfd90d5beda72eb8054e4b29ecc649d234a1dd5f5aa3ca0a4ac1dd637b` |
| `resources/runtime/node.exe` | `3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5` |
| renderer `BUILD_ID` 文件 | `0a0da2836528dc3e944eebaa2a17b7a579ba93e729fe744bae58e5882d7675aa` |

首次正式启动记录于 **23:18:19.565Z**，验收实例 PID **407860**，使用既有正式 `profile` 及配套 `browser`，smoke=false。该实例在 **23:32:29Z 之前** 已于本自动化之外退出，9226 调试端点拒绝连接；不是本自动化关闭或强制结束。后续按绝对安装路径识别到新的主进程 PID **408240**，**23:33:13.496Z** 的产品版本读回仍为 **0.2.106.0**。旧实例的 API、生命周期和数据采样不能冒充新实例复验。

## 安装版 API、数据差异与验收偏差

旧验收实例首次 **23:18:23.550Z** 与 **23:24:23.296Z** 读回：健康、生命周期、项目、连接、素材、智能体型号六接口均 **HTTP 200**。项目 **4**，连接 **180**，素材列表 **289**，智能体型号 **1,796**、其中 available **1,679**。该阶段完整数据库素材为 **582**，列表条数不冒充资产总数，目录可读不当作型号收费调用成功。这些数据均在外部重启前取得，尚未对新实例重复 API 验收。

旧实例 **23:24:23Z** 的 rendererExceptions 为 **0**，activeRuns/resumableCloudRuns/activeVerifications 均 **0**，但 **activeWrites=1**。随后旧实例独立只读采样 **23:28:10.955Z** 确认四项均 **0**，原始 JSON 单独保留；不能用该时点为 0 抹去先前仍有写入的阶段。这也不代表外部重启后的新实例生命周期/异常已复验，不证明其余窗口验收完成。

### 启动旧逻辑自动目录写回

观察到 **23:18:23.551Z** 旧 `DesktopBridge` 启动逻辑自动 POST `/api/suppliers/catalog-upgrade`。15 条超过 24 小时的连接被既有逻辑重试；后台结果 phase=complete，但 **refreshed 0、unavailable 5、failed 10**。完成状态不是成功刷新。代理没有手动点击扫描/刷新或直接编辑 profile；该旧逻辑仍实际写回目录、参数、价格和供应商状态，偏离本次“正式资料只看不改”的验收要求，不能归咎于供应商或隐去。

中间 **23:18:51Z** 审计记录 4 条连接、3 家供应商变化，画布未变；**23:23:11.383Z** 冻结数据库之后独立详细审计记录 **43 条连接、10 家供应商、1 张画布**变化。该中间原文件为 98,492,002 字节，SHA-256 `a7a2db9deef1ec29ff758c4402fba66b1edb9ae9b08f9cda05661e0d3eda62c3`。最终 **23:28:27Z** 另存 `profile-database-final-readback.private.json`，SHA-256 为 **`596f97bf0d30d09007f4ca2a3cb396495accf79704b9f865dd70d6cdb7f0dcec`**；`data-audit-detailed-final.json` 与该冻结身份一致，最终为 **120 条连接、10 家供应商、1 张画布**变化。三个阶段 **4→43→120** 分别保留，不能把早期少量差异当作最终状态。

最终 `formal-profile-change-review-final.json` 核对全部 **180 个连接 ID、Key 密文、provider/name、baseUrl、defaultModel、modelGroup、usage、供应商归属/source、账户与分组 Key ID 等保护字段均保持原值**，没有新增/删除连接；21 家供应商的身份、名称、API/site URL 等也保持。与此同时，最终 120 条连接完整行摘要并不相同；原始逐字段摘要完整保留，但本轮没有逐个解释全部 120 条缓存变化，不将其写成全部参数/价格/模板未变。

旧普通缓存目录分支也会离线重绑定参数/协议投影，内容不同即 `saveConnection`。用户 turn/方案读取可经 `loadAgentCatalog` / `director-catalog` 逐连接调用同一 cached inventory，再经 `bindScannedModelProtocols` 写回，因此变化能扩展到启动升级的 15 条之外。该链与旧版本相同。**不能把最终 120 条全部归因最初一次启动 POST，也不能仅按时间为每个字段编造唯一来源。** 用户同时试用使它不再是静止资料的受控安装实验。

23:23 的中间快照具体查到：7 条连接的 30 个目录型号参数描述变化、7 条连接的 140 个模板型号重绑定；connector 顶层协议相同，辰途模板 3 个 Gemini modelOverrides 的 auth/output 有补入或变化。以下价格样例也只对应这个中间冻结，不冒充最终 120 条逐项结论。

**价格变化不止时间戳或元数据。** 23:23 冻结时，沧元算力图像 API 的 `midjourney-v7` 原 ¥0.19/请求变为缺价，`sd7-seedance-2.0-1080p` 的 ¥6.9/请求、`sd7-seedance-2.0-720p` 的 ¥4.9/请求变为缺价，`suno` ¥0.18/请求→¥0.35/请求；沧元生图和视频的 `gpt-image-2` 从缺价→¥0.017/张。这里描述的是前后保存缓存，**未经完整官方资料复查，不能写成供应商官方改价或已验证新价格**。智元 gpt pro 的 10 个型号 priceStatus 从 unauthorized→partial，仍无价格；Synora 的中间参数删除在后续既有运行逻辑中恢复，23:23 冻结时其连接参数/价格金额与备份相同，不是代理进行了回滚。供应商目录还存在分组/型号顺序、条目和状态差异，逐字段安全摘要保留在审计中。

本轮代理没有为此修改供应商源码，也未直接修改连接、缓存或业务库、覆盖回备份；后续修复旧自动写回行为需单独处理，当前不能声称连接/价格完全未变。

### 用户同时试用的业务变化

窗口工具返回 **user input detected** 后，代理重新观察到用户自行进入设置，可能有尚未保存草稿；两次自动化输入/激活尝试均在执行前被 guard 拒绝，成功输入为 0，此后不再尝试。约 **23:19Z** 已询问何时可继续，尚未收到回复，未抢占界面、切换主题、确认方案、执行连线/整理或覆盖用户改动。

观察器记录用户试用期间有画布 PUT、5 个账务 POST、方案 DELETE/PATCH，并在 **23:20:58.828Z** 有实际 POST `/api/agent/turn`。这些不是代理发送，不能将全部观测写请求归为代理，也不能把整个会话写成 0 次对话或对用户调用费用作无证据结论。代理自身及受控测试没有发送真实智能体对话或收费生成；用户实际试用不纳入“受控回答质量评测已完成”的证据。

旧实例最后的 **23:28:27Z** 冻结仍为 **4 张画布、35 条版本、582 项素材、180 条连接、547 条运行、547 条节点运行**；素材、运行、节点运行和 17 条供应商核验逐行摘要未变，新增运行 **0**。但不能据数量相同声称所有历史行不变：一张用户正在编辑的画布 revision **10755→10786**，节点/边数量仍 **24/21**，布局、边、视口等改变；该画布保留上限 20 份的版本历史发生 **20 旧 ID 移出＋20 新 ID 进入**，其他三张画布的 **15 份原版本均保留**，全库总数仍为 35。该滚动保留上限是旧 db 代码既有行为，与 `912ddb4` 相同。此冻结发生在外部重启前，不代替新实例的数据复验。

原 **24 条 directorMessages 按 ID 与规范 SHA 全部保留，新增 3 条 user/system/assistant 消息，合计 27**；一条 session 的任务记忆等改变。原 **3 个 proposal ID 全部保留**，其中一条从 awaiting_execution→cancelled，另于 **23:24:54Z** 新增一条 awaiting_approval，最终 proposal 总数 **4**。它们发生在用户同时操作期间，不是受控的迁移实验，不能笼统归因安装；未恢复或覆盖这些用户试用变更。启动前字节核对通过与启动后的实际差异是两个独立事实。

## 正式窗口截图与当前运行状态

目前仅保存 **1 张正式安装程序、正式 profile 的窗口截图**：

| 截图 | 内容与身份 |
| --- | --- |
| `screenshots/01-home-dark.jpg` | 新首页深色工作台，保存时间 23:18:56.958Z；原始 JPEG 659,233 字节，SHA-256 `eee51d3fae944ed017ad8958a0b9f7a7009639c5615548955d7e89048047c174` |

截图原始编码/字节保留，窗口身份与 `savedAtUtc` 在 `screenshots/index.json`；精确原生 capture UTC 未独立记录，不能把保存时间冒充捕获时刻。其余要求的浅色首页、画布模块/详情、供应商模块/详情、个人账号、创作设置供应商页、原有画布、创作助手/模型浮层、网格整理按钮/排序菜单均**尚未完成正式截图验收**，不能以 e2e 或隔离 smoke 截图代替。

旧实例 **23:24:23Z** 被动读回 URL 为 `/`、主题为原 **dark**；当时曾被动观察到用户自行返回深色首页 hub，但窗口被其他窗口遮挡，未将遮挡画面保存为正式证据。该历史状态不是代理完成了恢复主题/回首页，也不是外部重启后的当前状态。旧观察器已正常断开，没有关闭应用。

**最新状态为 23:34:47.185Z 的新实例只读 native accessibility 观察**：窗口 **1509064**、标题“超级画布”，当前位于 `/canvas/2e08d8b0-c437-4cf1-bd48-5fd1a4312cc9`，**不在首页，外部重启后主题未知**。可访问性树观察到画布工作台、“返回主界面”、“一键整理”和“排列顺序”按钮；未激活、未点击、未打开菜单、未截新图，因此不把这些可访问性条目算作要求的窗口截图或功能执行通过。正式应用主 PID **408240** 仍在运行。

当前恢复原主题、回到首页、其余截图及新实例 API/生命周期/数据复验均未完成。由于持续用户活动和输入保护，未抢占用户界面，未为完成验收强制导航或覆盖用户试用状态；仍待可继续窗口验收的时间。

## 本轮文件改动

版本文件：`package.json`、`apps/desktop/package.json`。文档：`docs/releases/v0.2.106.md`、本安装记录。

8 份 e2e 修改为 `assistant-workspace.spec.ts`、`canvas-batch-connections.spec.ts`、`canvas-import-grid.spec.ts`、`canvas-model-bar.spec.ts`、`canvas-motion-lifecycle.spec.ts`、`canvas-tidy-grid.spec.ts`、`image-design.spec.ts`、`suppliers.spec.ts`，均位于 `apps/desktop/renderer/e2e/`。除 motion 的陈旧断言外，其余只修改证据输出路径。

4 份冒烟测试为 `apps/desktop/scripts/smoke-custom-suppliers.mjs`、`smoke-rendering.mjs`、`smoke-windowed.mjs`、`smoke.mjs`，适配新首页与指定证据目录，保持原 29＋4 覆盖。为修复产品缺陷而做的业务代码/CSS 改动：**无**。

用户既有 `apps/desktop/renderer/CLAUDE.md` 删除和无关 `docs/`、`output/` 未跟踪文件保持原样，不属于本轮变更。本自动化未 commit、push 或发布公开 Release；外部 Claude 已提交 `1ecc36a`，本次之后的状态补记仅留工作区，不改写该提交。

## 未完成项

- 正式窗口验收仅完成深色首页 1 张，其余截图仍待用户允许继续操作的时间；未把用户自行试用写成代理完成验收。
- 外部重启后的新实例当前在画布内，主题未知，恢复原主题和回首页尚未完成；旧实例的 API 200、23:28:10 生命周期全 0 和数据冻结不代表新实例复验。
- 启动旧自动目录升级与运行期写回造成参数、目录和实际价格缓存差异，已留证但未修复，不能通过“只读全部通过”验收。
- 用户同时试用已改变画布、滚动版本和对话/方案状态；后续最终快照须继续与这些时点区分，不恢复或覆盖用户数据。
- 六项大场景性能样本缺少原要求 6 GiB 空闲内存，保留失败；完整 e2e 另有 1 项独立网络守卫 teardown 错误，未宣称整套全通过。
- 原完整源码冻结清单被最终快照覆盖，覆写前独立摘要与原 SHA 保留，但原完整清单无法独立重放。
- 创作助手受控真实回答评测未完成，评测调用 0；不能据离线测试或用户自行试用宣称回答质量评测提升。

## 证据索引

证据根目录：`D:\project development\超级画布\.codex-logs\2026-10-16-release-v0.2.106\`。

- `unit-validation-summary.json`、`reused-checks-audit.md`、`reused-unit-sha-audit.json`、`reused-unit-evidence/`：单元计数与 SHA 复用原证据；`renderer-unit.log`、`director-unit.log`、`agent-eval-offline-unit.log` 为实跑。
- `validation-results.json`、`renderer-typecheck-acceptance.log`、`renderer-lint-acceptance.log`、`desktop-build.log`、`compiled-version.json`、`package-summary.json`：静态检查、完整构建、内联版本与安装器。
- `e2e-validation-summary.json`、`e2e-failure-analysis.md`、`e2e-full/`、`e2e-motion-rerun/`：一次全量、两项补跑与原始性能数据；`network-guard-source-review.md/.json` 和运行守卫原字节副本解释附加全局错误及证据限制。
- `e2e-full/legacy-output-archive/` 两份 manifest：六个旧 D 盘落点的原时间、长度和原字节归档 SHA。
- `final-source-review.json/.md`、`source-manifest-final.json`、`unit-input-manifest.json`、`git-check-before-install.json`：覆写前独立审计摘要、最终输入、单元身份与 diff 检查；原完整冻结 manifest 未保留。
- `backup-summary.json`、`profile-backup-manifest.private.json`、`verify-summary.json`、`compare-summary.json`：D 盘完整备份、安装前及首次启动前字节核对。
- `smoke-verification.json`、`smoke-report.json`、`smoke-windowed-report.json`、`packaged-smoke.log`、`smoke-report-attempt1.json`、`smoke-failure-attempt1.png`：29＋4 与首次陈旧断言失败原文/原图。
- `installer-start.json`、`installer-result.json`、`installed-identity.json`、`installed-launch.json`：实际覆盖安装、核心文件哈希、正式启动身份。
- `installed-api-readback.json`、`installed-final-state.json`、`installed-background-state.json`、`installed-background-state-20261016T232810955Z.json`：API、观察到的写请求、先 activeWrites=1 后归零的独立时点。
- `installed-current-process.json`、`installed-last-view.json`：外部重启后按绝对安装路径确认的新进程、旧实例/调试端点退出，以及最新只读可访问性画布状态；未用旧 API 结果冒充新实例复验。
- `data-audit-detailed-post-start.json`、`data-audit-detailed-after-catalog.json`、`data-audit-detailed-final.json`：4→43→120 条连接变化的三个时点原始字段摘要。
- `formal-profile-change-review.json`、`formal-profile-change-review-final.json`、`formal-profile-change-review.md`：中间参数/价格样例与最终保护字段、版本、消息/方案审计及归因限制。
- `profile-database-after-catalog.private.json`、`profile-database-final-readback.private.json` 及两份 identity：两个冻结原数据库；敏感正文不复制到本记录。
- `screenshots/index.json`、`screenshots/01-home-dark.jpg`：目前唯一正式窗口原始截图，其余待完成。
