# 超级画布体检与改进方案（2026-09-30）

基于 v0.2.44（`aa62af0`）。本文只做诊断和方案，未改动任何代码。

## 一、结论速览

- **工程基线健康**：ESLint 0 报错，TypeScript 0 报错，单元测试 157 个文件、1466 个用例全部通过。Electron 安全配置（contextIsolation、sandbox、导航拦截、单实例锁、token/Host/Origin 三重校验）已核实没有问题。
- **真实 bug 共 30 条**：渲染层 15 条，主进程/本地 API/共享包 15 条。其中 6 条会影响付费提交或数据安全，建议最先修。
- **UI 的主要问题是“不统一”，不是“不好看”**：首页的紫色玻璃风格完成度很高，但画布编辑器和设置弹窗各自是另一套配色和组件，三套视觉语言并存；局部还有文字折行、面板遮挡、原生控件截断和字号过小的问题。
- **建议分 5 个阶段推进**：先修付费/数据相关 bug（阶段 1），再建设计令牌和基础组件（阶段 2），然后逐屏统一（阶段 3），最后做体验打磨和结构性重构（阶段 4–5）。

## 二、检查方法

| 项目 | 方法 | 结果 |
| --- | --- | --- |
| 静态检查 | `eslint .`、`tsc --noEmit`（renderer） | 全部通过 |
| 单元测试 | `vitest run app/api lib proxy.test.ts` | 1466/1466 通过 |
| 代码审查 | 逐文件阅读渲染层、主进程、API 路由、runtime/db/storage/providers | 发现 30 条问题，关键条目已人工复核 |
| 界面截图 | 隔离的临时资料库 + 无头 Chrome，1440×900 与 1280×720 两种窗口 | 截图见第四节描述 |
| 样式审计 | 统计 CSS 令牌、硬编码颜色、圆角、字号、`!important`、内联样式、弹窗/按钮实现 | 见第四节 |

## 三、Bug 修复清单

路径中 `renderer/` 指 `apps/desktop/renderer/`。“已复核”表示我亲自读代码确认过；“疑似”表示需要复现确认。

### P0：影响付费提交或数据安全（阶段 1 修完）

| # | 问题 | 位置 | 后果 | 修复要点 |
| --- | --- | --- | --- | --- |
| 1 | **在提示词里按 Ctrl+Enter 会先插入一个换行，再发起付费生成**（已复核） | `renderer/components/prompt-editor.tsx:189` | 提示词在光标处被断开，这个错误版本被提交并计费；多按几次提示词越来越乱 | 在 `EnterAsHardBreak` 里加 `"Mod-Enter": () => true` 和 `"Shift-Mod-Enter": () => true`，一行修复 |
| 2 | **打开再关闭设置弹窗，会拆掉运行中任务的 SSE 订阅和提交互斥锁** | `renderer/components/canvas-app.tsx:5647`、`:5063`、`:9953` | 状态栏误显示空闲；同一节点可能被重复提交，产生重复扣费 | 用 ref 保存 `connections` / `applyRunSnapshot`，让订阅 effect 依赖稳定；连接内容没变就不 `setConnections` |
| 3 | **播放视频时，Range 请求把整个文件读进内存，而且读操作互斥排队**（已复核） | `renderer/app/api/assets/media-utils.ts:411`、`packages/storage/src/index.ts:89/279` | 几个几百 MB 的视频就能让本地服务内存暴涨甚至崩溃；拖动进度条卡顿 | 单次 Range 上限 8 MB；非 Range 分支改用流式读取；读操作不加互斥锁 |
| 4 | **数据库写盘没有 fsync、没有 `.bak`，写失败后内存修改也不回滚** | `packages/db/src/file.ts:241`、`:162`、`:340` | 断电后数据库文件可能损坏，App 无法启动且无从回退；写失败的修改会在下次保存时“偷偷”落盘 | `fh.sync()` 后再 rename；rename 前轮转 `.bak`；读取失败时回退 `.bak` 并保留损坏文件；持久化失败回滚内存 |
| 5 | **“恢复任务”逐节点写库，中途出错留下半改状态** | `packages/runtime/src/service.ts:1433` | 节点卡在“运行中”，原错误信息丢失；CLI 账号可能被永久标记为占用 | 先整体校验、算出目标状态，全部通过后再批量写入 |
| 6 | **取消任务后立即退出，远端取消请求可能没发出，重启后也不会补发** | `packages/runtime/src/service.ts:1604`、`renderer/lib/server.ts:38`、`renderer/app/api/desktop/lifecycle/route.ts:9` | 供应商继续生成并扣费；节点永远显示“取消中” | 启动时扫描含 `cancel_requested` 节点的 run 并补做取消对账；lifecycle 把这类 run 计入 `activeRuns` |

### P1：影响稳定性或会丢数据（阶段 1 后半段）

| # | 问题 | 位置 | 修复要点 |
| --- | --- | --- | --- |
| 7 | 退出流程先设 `quitting = true`，清理步骤抛错后托盘“退出”失灵，App 卡在关不掉的状态 | `apps/desktop/src/main.mjs:208/226`、`reference-channel.mjs:84` | 清理步骤改为尽力而为（`.catch(log)`）；catch 中复位标志；`publish` 的 rename 复用 DB 的 EPERM/EBUSY 重试 |
| 8 | 主进程没有任何崩溃处理，渲染进程崩溃后一直白屏 | `apps/desktop/src/main.mjs` | 监听 `render-process-gone`（自动 reload 或显示错误页）、`child-process-gone`、`unhandledRejection`；所有 `void promise` 补 `.catch` |
| 9 | 启动恢复用 `Promise.all`，一个 run 异常就跳过全部云端任务恢复 | `renderer/lib/server.ts:38` | 改 `Promise.allSettled`，逐个记录失败的 runId；云端恢复独立执行 |
| 10 | 视频/音频轮询固定 240 次（约 6 分钟）就判超时，且不可中止 | `packages/runtime/src/service.ts:3241` | 按操作类型设时间上限（视频 30–60 分钟）+ 指数退避；`delay` / `pollWithRetry` 传入 `signal` |
| 11 | 导入远程素材可被 DNS 重绑定绕过内网限制，且允许 HTTPS 被重定向到 HTTP | `renderer/app/api/assets/import-source/route.ts:124/209` | 复用已固定 IP 的 `consumeRemoteArtifact`（`packages/runtime/src/remote-download.ts`）；禁止协议降级 |
| 12 | 删除项目只检查 `queued/running`，漏掉 `needs_attention` 和节点级进行中状态，且检查与删除之间有竞态 | `renderer/app/api/projects/[id]/route.ts:15/124` | 扩大检查范围，`needs_attention` 至少二次确认；检查与删除放进仓储层原子操作 |
| 13 | 任何一次撤销/重做都会删掉“正在导入”的占位节点，上传完成后素材静默丢失，却计为成功 | `renderer/components/canvas-app.tsx:2036/3619/8442` | `restoreSnapshot` 合并回当前的 `pendingImport` / `directorDraft` 节点；`onCanvasDrop` 使用返回值并提示用户 |
| 14 | 素材桥接拖入超过 15 秒后，占位节点永久卡在“正在改用浏览器上传…”，或出现重复素材（部分疑似） | `renderer/components/canvas-app.tsx:8420/8045` | 超时分支调用 `failPendingAssetImport` 和 `unregisterPendingNativeDrop`；由共享状态决定谁负责回退 |
| 15 | 智能体改动已应用成功，但草稿确认失败会被报成“操作失败”，用户重试就会执行两次（疑似） | `renderer/components/canvas-app.tsx:6853` | `acknowledgeCanvasDraft` 单独 try/catch，失败只标记草稿存储错误 |
| 16 | 智能体修改画布期间，Delete / Ctrl+Enter / Ctrl+Z 等全局快捷键仍然生效 | `renderer/components/canvas-app.tsx:6233` | keydown 处理器开头判断 `agentMutationRef.current` |
| 17 | `runNode` 先校验媒体，后刷新编辑器里未提交的修改，刚输入的 `@素材` 没经过前端校验（疑似） | `renderer/components/canvas-app.tsx:5890` | `flushPendingEditorEdits()` 移到 `runNode` 最开头 |

### P2：体验、性能与健壮性（穿插在阶段 3–5 修复）

| # | 问题 | 位置 | 修复要点 |
| --- | --- | --- | --- |
| 18 | 撤销历史被空操作污染、重做栈被清空：画了过小的图形、取消绘制、程序化补丁，以及没配置供应商时点“新建图片节点”（已复核）都会压入空记录 | `renderer/components/canvas-app.tsx:3600/3773/4275/4840` | 确认画布真的变化后再入栈；`insertNodeAt` 把 `checkpoint` 挪到节点创建成功之后；`updateNodeData` 增加 `recordHistory` 选项 |
| 19 | 绘制模式下滚轮缩放，每个 wheel 事件都深拷贝全图并写一次 IndexedDB；`preventDefault` 在 passive 监听里无效 | `renderer/components/canvas-app.tsx:3727/3431` | 原生 `addEventListener("wheel", …, { passive: false })`；缩放结束后再保存；草稿写入移进防抖 |
| 20 | SSE 被服务端拒绝后，已关闭的连接一直残留，状态栏“运行中”常亮（疑似） | `renderer/components/canvas-app.tsx:5405` | `onerror` 检查 `readyState === CLOSED` 后移除并交给对账重订阅；404 时停止订阅 |
| 21 | 焦点停在按钮上时，Ctrl+Z / Ctrl+Y 静默失效 | `renderer/lib/graph-ui.ts:981` | 历史快捷键只排除 `editing` / `modalOpen` |
| 22 | 全局 Escape 在输入法组合、弹窗内也会关闭所有菜单并退出绘制模式；与节点面板的 Escape 顺序不稳定 | `renderer/components/canvas-app.tsx:6236` | `isComposing` 检查移到最前；弹窗/输入框内的 Escape 只做局部处理 |
| 23 | 提示词编辑器有焦点时忽略外部更新，失焦后不补同步，可能覆盖外部修改（疑似） | `renderer/components/prompt-editor.tsx:306` | 监听 `blur`，与最新 parts 比较后 `setContent(…, { emitUpdate: false })` |
| 24 | 保存面板宽度的 `localStorage.setItem` 没有 try/catch | `renderer/components/canvas-app.tsx:2827` | 包一层 try/catch，与 `canvas-motion.tsx:42` 保持一致 |
| 25 | `CanvasShell` 不带 selector 订阅整个 store，全局 keydown 监听随每次节点变化重新注册 | `renderer/components/canvas-app.tsx:2437/6461` | 按字段 selector + `useShallow`；处理器内用 `getState()` 读取 nodes |
| 26 | 迁移前的旧进程检测在中文路径下可能失效，且 `JSON.parse` 无防护（疑似） | `apps/desktop/src/data.mjs:72` | 命令前设置 `[Console]::OutputEncoding=UTF8`；解析失败时拒绝迁移 |
| 27 | `runtime-port.json` 写入不是原子的；端口预留存在竞态 | `apps/desktop/src/main.mjs:88/171` | 临时文件 + rename；后端监听失败时换端口重试一次 |
| 28 | 素材通道隧道子进程崩溃后，3210 网关仍在监听且不会重连 | `apps/desktop/src/reference-channel.mjs:117` | `failed()` 中关闭 gateway，加有限次数的退避重启 |
| 29 | 上传和远程导入会把大文件整体缓冲进内存 | `renderer/app/api/assets/upload/route.ts:172`、`import-source/route.ts:134` | 改为流式写入 `storage.putStream`，边读边检测文件头 |
| 30 | `storage-gc --apply` 不检查 App 是否在运行，可能删掉刚上传的文件 | `scripts/storage-gc.mjs:76` | 执行前检查运行端口或进程锁，发现在运行就拒绝 |

另有一处小问题：`packages/runtime/src/cloud-generation.ts:52` 的 `response.json()` 没有防护，服务端返回非 JSON 时用户会看到 “Unexpected token <”。

## 四、UI 问题诊断

### 4.1 截图观察（1440×900 与 1280×720，无供应商的全新资料库）

| 界面 | 现状 | 问题 |
| --- | --- | --- |
| 首页 / 项目列表 | 紫色玻璃风格，完成度最高 | 项目卡片的“…”菜单太窄：“导出结构 JSON”“导出完整项目包（含素材）”折成两行；各菜单项字号不一致 |
| 画布编辑器 | 石墨灰加淡紫，与首页不是一套色 | 运行按钮是浅紫底深色字，其他页面的主按钮是深紫底白字；节点端口标签“提示词”约 8px，几乎看不清；新建节点落在随机位置（`addNewNode` 用 `360 + Math.random() * 260`），画布越用越乱 |
| 创作设置弹窗 | 中性灰，又是第三套配色 | “添加供应商”是靛蓝色，另有蓝色链接式按钮；复选框和下拉框都是没加样式的原生控件；眉题写着英文“YOUR CONNECTIONS”，而界面其他地方全是中文 |
| 节点库面板 | — | 没有标题栏，顶部只有一片空白和一个关闭 X；面板打开后压住了底部工具栏 |
| 智能体面板 | — | 4 个原生下拉框，选项文字被截断；右侧有一条突兀的紫色拖拽柄 |
| 开发模式 | — | Next 的开发指示器“N”压住了缩放控件（只影响开发，可在 `next.config` 里用 `devIndicators` 调整位置或关闭） |

### 4.2 样式代码量化审计

| 指标 | 现状 | 目标 |
| --- | --- | --- |
| 全局样式 | `globals.css` 共 8233 行，至少 7 层“补丁”叠加（`Interface polish`、`visual system`、`Final UI pass`……），后面的层覆盖前面的层 | 按模块拆分，全局只保留基础样式 |
| CSS 变量 | 33 个。核心变量被重复定义 5–7 次，每次的值都不同：`--bg` 有 7 个值，`--accent` 有 5 个值（`#9b8cff` / `#8584ed` / `#b5a6ff` / `#6256d9` / `#b9a7ff`） | 每个令牌只定义一次 |
| 颜色字面量 | 1954 处，1511 种不同写法；仅深色面板底色就有 183 种 | 约 30 个语义令牌 |
| 圆角 | 36 种 | 5 档 |
| 字号 | 33 种；其中 9px 42 处、8px 4 处 | 7 档，最小 11px |
| 间距 | 60 种；7px 出现 123 次、9px 出现 118 次（不在任何网格上） | 以 4px 为基准，8 档 |
| 层级 z-index | 29 种，另有内联的 10000 / 10001 | 6 层 |
| 阴影 | 153 种 | 4 档 |
| `!important` | 84 处 | 个位数 |
| 字重 | 15 种 | 4 档（400 / 500 / 600 / 700） |
| 按钮 | 73 个按钮类名，9 种主按钮样式；`node-run-button` 本身就有 3 种颜色；84 个 `<button>` 没写 `type` | 一个 Button 组件：4 个变体 × 3 个尺寸 |
| 弹窗 | 8 种各自实现，z-index 分别是 80 / 120 / 1000 / 1500；快捷键弹窗和保存冲突弹窗没有接入 `useDialogFocus` | 一个 Modal 组件 |
| 图标 | 23 种尺寸，仅关闭 X 就有 10 种 | 3 档（14 / 16 / 20） |
| 焦点环 | 6 种写法 | 1 种 |
| 提示 | 只有 1 种自定义 Tooltip，另有 148 处原生 `title=` | Tooltip 组件 |
| 加载动画 | 11 份重复的 spin keyframes | 1 份 |
| 字体 | 5 套以上字体栈；首选的 Inter 并没有打包（既没有 `next/font` 也没有 `@font-face`），没装 Inter 的 Windows 机器会回退到 Segoe UI，不同机器看到的界面不一样 | 1 套字体栈 |

### 4.3 可以直接修的具体缺陷

1. **遮罩和提示几乎看不清**（已复核）。`renderer/components/canvas-app.tsx:8766` 的“正在保存并核对画布…”遮罩用的是 `#ffffffaa` 白色半透明底，文字却继承深色主题的浅色字，对比度约 1.05:1。`renderer/components/desktop-bridge.tsx:49-50` 的错误提示是纯白底，退出遮罩是 `#f6f6f4ed` 浅米色底，在深色界面里像是闪了一下白屏。
2. **键盘焦点环看不见**（已复核）。`renderer/app/studio-theme.css:7-8` 写的是 `outline: 3px solid rgb(98 86 217 / 28%)`，在深色底上对比度约 1.31:1，用键盘操作的用户找不到焦点在哪。
3. **悬停没有反馈**。`studio-theme.css` 是从浅色主题机械转换过来的，14 个 hover 状态里有 12 个和常态完全一样，分隔线在深色底上也看不见。`:138`、`:158`、`:173`、`:201` 还残留着浅色主题的值；`:79-167` 整段又被 `canvas-studio.css` 覆盖掉了。
4. **文字对比度不达标**：`globals.css` 里用在深色底上的 94 种文字颜色中，有 13 种低于 WCAG AA 要求的 4.5:1；`canvas-studio.css` 的 37 种中有 5 种低于 4.5:1。
5. **用 aria-label 当 CSS 选择器**：`canvas-studio.css:114`、`:217-219`、`:235`、`:403` 和 `studio-theme.css:260`。改一下按钮文案样式就丢了，以后也没法做多语言。
6. **断点写了也用不上，真正要适配的宽度却没管**。窗口最小是 980×680（`apps/desktop/src/main.mjs:286`），但样式里有约 31 个小于 980px 的 `max-width` 断点永远不会触发。反倒是 1280 宽度下，`image-design-compare.module.css:138` 的四图对比会溢出。
7. **死代码超过 1000 行**：
   - `globals.css` 的 455 个类里有 118 个没被引用，`studio-theme.css` 的 246 个类里有 44 个没被引用。
   - 整段登录页样式（约 `globals.css:4410–5004`）和旧的设置/cangyuan 样式（约 `:2370–2950`）都已经没有引用。
   - `app/light-theme.css`（299 行）和 `components/image-design-history.module.css`（77 行）没有被任何文件导入（已复核）。
8. **同一个选择器多处定义**：`.topbar` 分散在 13 个规则块里，`.button` 有 5 处。改一处经常被后面的规则覆盖，这也是补丁层越叠越多的根本原因。

## 五、UI 优化方案

### 5.1 视觉方向：统一到首页的紫色玻璃风格

首页是目前完成度最高、也最有辨识度的界面，建议以它为基准，把画布和设置收敛过去：

- **三层深色表面**：背景、面板、浮层，都带一点紫调，不再用纯灰。
- **强调色**：只保留一个紫色。浅紫用于文字、图标和描边；深紫用于按钮底色，配白字。青色只表示“运行中/信息”，不再用作装饰。
- **主按钮只有一种**：深紫底白字，和首页一致。画布上的运行按钮也改成这一种。
- **玻璃效果只用在浮层**（弹窗、菜单、浮动工具栏）。面板用实色，避免画布上大面积 `backdrop-filter` 拖慢拖拽和缩放，这和最近几次性能提交的方向一致。

如果你更喜欢画布现在的石墨灰，也可以反过来，把首页收敛到石墨灰。只要令牌建好，切换方向基本只需要改 `tokens.css` 里的数值。

### 5.2 设计令牌：新建 `renderer/app/tokens.css` 作为唯一来源

下面是建议的初始值。对比度已按 WCAG 公式估算：`--color-text-muted` 在面板底上约 5.4:1，白字在 `--color-accent-solid` 上约 4.8:1，焦点环约 6.7:1。落地时以实际截图微调。

```css
:root {
  /* 表面 */
  --color-bg: #0f0f14;
  --color-surface-1: #17171f;          /* 面板 */
  --color-surface-2: #1f1f29;          /* 卡片、输入框 */
  --color-surface-3: #2a2a36;          /* 悬停 */
  --color-overlay: rgb(10 10 16 / 72%);
  --color-border: #2e2e3a;
  --color-border-strong: #45455a;

  /* 文字 */
  --color-text: #eeeef5;
  --color-text-secondary: #b4b4c6;
  --color-text-muted: #8c8ca3;         /* 最低档，仍 ≥ 4.5:1 */

  /* 强调 */
  --color-accent: #9d90ff;             /* 文字、图标、描边、焦点环 */
  --color-accent-solid: #6d5ce8;       /* 按钮底色，配白字 */
  --color-accent-solid-hover: #7a6af0;
  --color-accent-solid-active: #6252d6;
  --color-accent-soft: rgb(157 144 255 / 14%);
  --color-on-accent: #ffffff;

  /* 状态 */
  --color-success: #5fd4a0;
  --color-warning: #f2c26b;
  --color-danger: #f08a9a;
  --color-info: #80ccd6;

  /* 字号：7 档，最小 11px */
  --font-size-xs: 11px;  --font-size-sm: 12px;  --font-size-md: 13px;
  --font-size-base: 14px; --font-size-lg: 16px; --font-size-xl: 20px; --font-size-2xl: 28px;

  /* 间距：4px 网格 */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;

  /* 圆角 */
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px; --radius-full: 999px;

  /* 阴影 */
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 30%);
  --shadow-md: 0 4px 16px rgb(0 0 0 / 35%);
  --shadow-lg: 0 16px 48px rgb(0 0 0 / 45%);
  --shadow-focus: 0 0 0 2px var(--color-accent);

  /* 层级：6 层 */
  --z-canvas-ui: 10; --z-panel: 20; --z-dropdown: 40;
  --z-modal: 100; --z-toast: 200; --z-blocking: 300;

  /* 动效 */
  --duration-fast: 120ms; --duration-base: 200ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

使用规则：

- 除 `tokens.css` 以外不允许写颜色字面量和 `!important`。可以引入 stylelint 来强制（`color-no-hex` 排除 tokens.css；`declaration-no-important`）。
- 内联 `style={{…}}` 只允许用来设置动态的尺寸和位置，颜色一律走类名和令牌。

### 5.3 基础组件：新建 `renderer/components/ui/`

| 组件 | 取代什么 | 规格 |
| --- | --- | --- |
| `Button` | 73 个按钮类名、9 种主按钮样式 | 变体：primary / secondary / ghost / danger；尺寸：sm 28px / md 32px / lg 40px；默认 `type="button"`；内置 loading 状态 |
| `IconButton` | 各处图标按钮、10 种关闭按钮 | 必须传 `label`，同时用作 `aria-label` 和 Tooltip 文案；按钮 24 / 28 / 32，对应图标 14 / 16 / 20 |
| `Modal` | 8 种弹窗实现 | 统一遮罩、`--z-modal`、`useDialogFocus`、Esc 关闭、关闭后焦点回到触发元素；结构固定为“标题栏 + 可滚动内容 + 底部操作栏” |
| `Menu` | 项目“…”菜单、画布右键菜单等 | 最小宽度 220px、不折行；图标、文字、快捷键三列对齐；危险项放最后并用分隔线隔开 |
| `Select` | 设置弹窗和智能体面板里的原生下拉框 | 自定义弹层，选项完整显示，支持键盘；过渡期可以先给原生 select 加样式 |
| `Switch` / `Checkbox` | 未加样式的原生复选框 | 布尔型设置统一用 Switch |
| `Tooltip` | 148 处原生 `title=` | 延迟 400ms 出现，可以显示快捷键 |
| `Panel` | 节点库、智能体、属性面板 | 统一标题栏（标题 + 操作 + 关闭），内容区独立滚动 |
| `Spinner` / `EmptyState` / `Toast` | 11 份 spin 动画、各处写法不同的空状态 | — |

### 5.4 逐屏改造要点

**首页 / 项目列表**

- 项目“…”菜单改用 `Menu`，文字不再折行，字号统一 13px，“删除项目”用危险色并放在最后。
- 其余保持不变，作为全局基准。

**画布编辑器**

- 底色、面板、工具栏全部换成令牌；运行按钮改为 primary（深紫底白字）。
- 字号：端口标签 ≥ 11px，节点标题 13px / 600，节点正文 12px。
- 新建节点改为放在视口中心，并避开已有节点；如果当前选中了节点，就放在它右侧 40px。取代现在的随机落点。
- 左侧工具栏（editor-rail）：图标统一 16px，按钮 32px，分组之间加分隔线；Tooltip 显示“名称 + 快捷键”。
- 缩放控件、小地图、底部工具栏、节点库面板统一避让规则，不再互相遮挡。

**创作设置弹窗**

- 用 `Modal` 重做，配色切换到统一令牌，去掉靛蓝色和蓝色链接式按钮。
- “YOUR CONNECTIONS”改为中文“我的连接”；眉题统一 11px / 600 / 次要文字色。
- “添加供应商”用 primary，其他操作用 secondary 或 ghost；复选框改 `Switch`，下拉框改 `Select`。
- 供应商以卡片网格展示：图标、名称、状态徽标（已连接 / 未验证 / 失败）、操作，四项对齐。
- 没有配置供应商时，现在点“新建图片节点”会直接弹出设置。建议改成在节点上显示空状态，并提供“去添加供应商”按钮，同时修掉 bug #18 的空撤销记录。

**节点库面板**

- 加标题栏：“节点库” + 搜索框 + 关闭按钮。
- 面板底部留出工具栏的高度（或打开面板时工具栏上移），不再压住工具栏。
- 节点条目显示“图标 + 名称 + 一行说明”；分组标题 11px / 600。

**智能体面板**

- 4 个原生下拉框改为 `Select`，或者收进“模型设置”弹层，面板上只留最常用的一个。
- 被截断的文字加 Tooltip。
- 拖拽柄改成 4px 宽的透明热区，悬停时才显示一条 1px 的强调色线。

**全局遮罩与提示**

- “正在保存并核对画布…”、“正在准备退出”、桌面桥错误提示统一改为深色半透明遮罩 + 浅色字 + Spinner，去掉内联 style，层级改用 `--z-blocking`。

### 5.5 排版与字体

- 只用一套字体栈：`"Inter", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif`。
- 要用 Inter，就用 `next/font/local` 或 `@font-face` 把字体文件打包进应用（桌面应用需要离线可用）；不打算打包的话就从字体栈里去掉 Inter，保证每台机器显示一致。
- 中文正文不小于 12px；11px 只用于标签和徽标。
- 尺寸、时长、积分等数字使用 `font-variant-numeric: tabular-nums`，让列表里的数字对齐。

### 5.6 无障碍

- 只保留一种焦点环：`:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }`。
- 正文对比度 ≥ 4.5:1；大字和图标 ≥ 3:1。
- 所有弹窗都走 `Modal`，获得焦点陷阱、Esc 关闭和焦点归还。
- 图标按钮必须有可读名称。样式不再依赖 aria-label 选择器，改用类名或 `data-*` 属性。
- 动效接入现有的 `MotionPreferenceBridge`，开启“减少动态效果”时统一关闭过渡动画。

### 5.7 窗口尺寸适配

- 窗口最小尺寸 980×680 是下限。断点只保留 980 / 1280 / 1600 三档，删掉小于 980 的 31 个断点。
- 1280 宽：四图对比改为 2×2 网格；侧面板可以折叠。
- 680 高：弹窗内容区可滚动，底部操作栏固定不动。

### 5.8 样式架构

- 加载顺序：`tokens.css` → `base.css`（reset、排版、焦点环）→ 组件级 CSS Modules → 页面样式。
- `globals.css` 按区域拆分（home / canvas / settings / agent / image-design），逐步迁到 CSS Modules，补丁层随迁移一起删除。
- 删除 `light-theme.css`；`studio-theme.css` 的有效部分并入令牌后删除。

## 六、分阶段实施路线

时间按一人全职估算，每个阶段结束发一个小版本。

### 阶段 1：紧急修复（约 1–1.5 周，发 v0.2.45）

- 修复 P0 #1–6、P1 #7–17。每条都配回归测试：共享包写 vitest，界面交互写 Playwright。
- 不依赖令牌的快速 UI 修复：
  - 遮罩和提示的对比度（`canvas-app.tsx:8766`、`desktop-bridge.tsx:49-50`）
  - 焦点环（`studio-theme.css:7-8`）
  - 项目菜单折行
  - 端口标签字号
  - “YOUR CONNECTIONS”改中文
  - 84 个按钮补上 `type="button"`
  - 节点库面板遮挡工具栏
- 风险：
  - #4（DB 写盘）要做“写盘中途强杀进程”的恢复测试。
  - #2 改了订阅依赖，需要回归所有 SSE 相关的 e2e。

### 阶段 2：设计令牌与清理（约 1 周）

- 新建 `tokens.css`，把 33 个变量的多份重复定义合并成一份。
- 删除死代码（1000+ 行）和 2 个孤儿文件，合并 11 份 spin 动画。
- 目标是**视觉几乎零变化**，用截图对比确认。
- 风险：动态拼接的类名（`toast-*`、`is-*`、`sm-refresh-*`）可能被误判为死代码。删除前对照这份白名单，并逐个全文搜索。

### 阶段 3：基础组件与逐屏统一（约 2–3 周）

- 先写组件：Button、IconButton、Modal、Menu、Select、Switch、Tooltip、Panel。
- 再按顺序逐屏改造：设置弹窗 → 首页与项目菜单 → 画布工具栏与节点 → 节点库 → 智能体面板 → 平面设计。
- 每屏一个 PR，附改造前后的截图。
- 顺带修 P2 #18–25，以及新建节点落点。

### 阶段 4：打磨（约 1 周）

- 字体打包、字号档位、数字对齐。
- 对比度全面达标，清理断点，适配 1280 宽度。
- 统一动效。
- 修 P2 #26–30 和 `cloud-generation.ts:52`。

### 阶段 5：结构性重构（持续进行，约 2–4 周）

- 拆分 `canvas-app.tsx`（10,206 行）：
  - 按职责抽出 hooks：`useRunSubscriptions`、`useCanvasHistory`、`useCanvasShortcuts`、`useAssetImport`、`useAgentMutation`。
  - 按区域抽出子组件：`EditorRail`、`CanvasToolbar`、`SettingsModal`、`AgentPanel` 等。
  - P0 #2 和 P1 #13–17 都集中在这个文件里，拆开后同类问题更容易被发现和测试。
- 把 `globals.css` 完全迁出，最后只保留基础样式；加上 stylelint 规则，防止回退。
- 风险：大文件拆分只做搬移、不改逻辑，小步提交，每一步都跑完整 e2e。

### 风险与应对

| 风险 | 应对 |
| --- | --- |
| 改 DB 写盘和任务恢复，可能引入新的数据问题 | 先写测试（断电模拟、半写入回滚），改前备份用户数据目录 |
| 统一视觉会改变用户熟悉的画布配色 | 阶段 2 先做零变化的令牌化，阶段 3 再按屏切换，每屏都可以单独回滚 |
| 删除 CSS 时误删动态类名 | 白名单 + 全文搜索 + 截图对比三重确认 |
| 拆分 `canvas-app.tsx` 引入回归 | 只搬移不改逻辑，每步跑 35 个 e2e spec |

## 七、验证方式

**每个阶段都跑**（在 `apps/desktop/renderer` 下直接调用 `node_modules/.bin`，因为本机 PATH 里没有 pnpm）：

- `eslint .`
- `tsc --noEmit`
- `vitest run app/api lib proxy.test.ts`
- 各共享包自己的 vitest
- Playwright e2e：35 个 spec，使用隔离的临时资料库，端口 3211

**截图回归**：在 1280×720 和 1440×900 两种窗口下，对以下画面做改造前后对比：

- 首页
- 空画布
- 有节点的画布
- 设置弹窗
- 项目菜单
- 节点库
- 智能体面板

**专项验证**：

| 条目 | 验证方法 |
| --- | --- |
| #1 Ctrl+Enter | e2e：输入提示词后按 Ctrl+Enter，提交的内容与输入完全一致 |
| #2 设置弹窗 | e2e：运行中打开再关闭设置，状态栏仍然显示运行中，且不会重复提交 |
| #3 视频 Range | 用 500 MB 视频反复拖动进度条，观察本地服务内存保持平稳 |
| #4 DB 写盘 | 写盘过程中强杀进程，重启后能从 `.bak` 恢复 |
| #6 取消后退出 | 用 mock 供应商：取消后立刻退出，重启后能补发远端取消 |
| 对比度 / 无障碍 | 在 e2e 中接入 axe 检查，或手动跑 Lighthouse 无障碍评分 |

**打包冒烟**：每个版本都在真实 Windows 安装包上走一遍“安装 → 启动 → 生成 → 取消 → 退出”。

## 八、建议的起步动作

1. 先做 3 处低风险修复来跑通流程：#1 Ctrl+Enter（一行）、两处遮罩对比度、焦点环。
2. 确认视觉方向：统一到首页紫色玻璃（推荐），还是统一到画布石墨灰。
3. 从 `main` 开分支，按阶段 1 的清单逐条修；每条单独提交，附测试。
