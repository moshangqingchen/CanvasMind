# 项目检查与优化记录 · 2026-10-05

基线提交：`a32dffc873556dd2649699324e52a2e5d320cbc0`。检查环境为 Windows x64、Node.js 24.15.0，使用仓库现有依赖。检查覆盖桌面生命周期、画布图算法、客户端请求与缓存、供应商传输、结果下载、素材接口、项目存储、首页及编辑器关键交互。

后续复查与新增修复见 [第二轮复查记录](ROUND-2.md)。以下保留第一轮结果。

后续新增的失败原因、扣费状态与金额展示见 [生图失败诊断说明](../../generation-failure-diagnostics.md)。

该功能再次检修的修复与验证结果见 [失败与扣费复检](FAILURE-RECHECK.md)。

提交、失败、扣费、取消与恢复的固定范围复核见 [本轮验收记录](FINAL-ACCEPTANCE.md)，包含问题来源区分与本轮实际验证范围。

## 已修复的问题

| 范围 | 原有问题 | 修改后的行为 |
| --- | --- | --- |
| 网络请求 | DNS 安全检查在计时器之前执行，慢 DNS 不受请求超时或取消约束 | DNS、发送前进度记录、响应头、读取正文使用同一总时间预算；取消后不再继续提交 |
| 请求资源 | 自定义传输或响应流不响应取消，迟到响应和进度回调失败可能留下正文流 | 主动回收响应和 reader；清理操作本身不会无限阻塞调用方 |
| 参考图下载 | 下载未继承所在生成任务的取消信号 | 任务取消立即终止参考图等待 |
| Fake-IP/TUN | 第一个不通的 IP 占满直连尝试预算，后续可用地址没有机会 | 最多 4 个 TLS 候选并行建立连接，交给 HTTP 层的只有一个成功连接；其他 socket 释放 |
| 远程下载 | 将部分保留 `/24` 网段错误扩大为 `/16`，误拒公网 CDN；部分 IPv6 写法绕过地址判断 | 精确限制保留网段，补齐 IPv6 补零、大写及嵌入 IPv4 的边界处理 |
| 客户端连接 | 多个组件同时请求相同供应商列表；保存/删除后旧请求可能覆盖新状态 | 合并进行中的读取；变更失效后旧读取转接到新数据；下一次主动刷新仍访问服务器 |
| 模型状态 | 删除连接不清模型缓存，旧凭据的迟到可用性响应仍可能被使用 | 删除后清理模型和渠道状态，拒绝失效凭据发起的旧响应 |
| 流式对话 | CRLF 被分在两次网络读取时解析失败；未收到结束事件也被视为成功 | 完整缓冲区处理换行，异常断流显示错误，完成、取消和解析失败均释放 reader |
| 媒体访问 | 网关将 HEAD 转成 GET，Next 默认 HEAD 又执行完整素材读取；后缀范围和 416 头丢失 | 显式 HEAD 只查元数据，支持 suffix Range，正确透传范围错误信息 |
| 桌面退出 | HTTP 响应已结束，但处理函数仍在异步保存时被误判为空闲 | 等待可观察处理函数的 Promise 完成，退出与更新不会提前跳过该写入 |
| 画布校验 | 长链 DFS 递归栈溢出；每个输入端口重复扫描全图连线 | 显式 DFS 栈支持 12,000 节点长链；按目标节点预先组织入边 |
| 项目目录 | 同一项目并发打开/归档时重复初始化整套目录 | 合并同项目正在进行的初始化，完成后不永久缓存文件系统状态 |
| 首页状态 | 重命名或删除完成后，旧的焦点刷新请求可能恢复过时内容 | 成功变更使旧读取失效 |

网络优化没有新增自动重发付费生成的逻辑；候选 TLS 竞争发生在 HTTP 请求发送之前。

## 界面与使用流程

- 保留深色创作空间，调整背景层次、标题和控件对比度，以浅紫、暖橙、薄荷绿区分三个设计入口。
- 已有项目时直接展示作品，不再用重复的大型新建卡片占据第一格；顶部创建入口及空库引导继续可用。
- 记住网格/列表视图和排序偏好，搜索显示匹配数量，素材缩略图异步解码。
- 新增路由加载界面，并在第一次读取项目时复用，减轻页面跳转的空白和视觉断层。
- 放大编辑器保存状态与主要操作文字，保留窄窗口的自适应收缩规则。
- 窄窗口隐藏纯装饰的首页动效区域，让项目列表更早出现；保留系统减少动态效果和手动暂停设置。

## 性能测量

使用同一份合法合成图（2,500 节点、2,499 连线），旧/新实现交替执行，预热 3 轮、测量 10 轮：

| 图校验 | 中位数 |
| --- | ---: |
| 修改前 | 43.39 ms |
| 修改后 | 2.65 ms |

这是本机图校验测量，不代表整体界面帧率、带宽或外部供应商生成速度。原始结果见 [graph-benchmark.json](graph-benchmark.json)。从仓库根目录运行 `node docs/audits/2026-10-05/graph-benchmark.mjs` 可与固定基线提交重新对比；该命令会更新 JSON，机器负载会影响数值。

## 验证记录

工作区单元与集成测试、类型检查、ESLint、共享包构建、Next 生产构建、Electron 外壳构建和维护脚本检查均通过。最后一轮网络边界修复后，重新运行 Providers 全包和 Runtime 全包，重新构建共享包与 Next，并重新运行相关浏览器场景。

| 验证范围 | 结果 |
| --- | ---: |
| Core | 30 项通过 |
| DB | 47 项通过 |
| Storage | 18 项通过 |
| Providers | 688 项通过 |
| Director | 24 项通过 |
| Runtime | 247 项通过 |
| Renderer | 1,841 项通过 |
| Electron 桌面 | 40 项通过 |
| 工作区测试合计 | **2,935 项通过** |
| 维护脚本 | 12 项通过 |
| 浏览器回归第一批 | 110 项通过 |
| 浏览器回归最终批 | 79 项通过（其中 12 个首页场景与第一批重复） |
| 浏览器不同场景合计 | **177 项通过** |

浏览器测试使用隔离资料库与 Fake/模拟接口，不读取实际项目或调用付费生成。覆盖自动保存、草稿恢复、保存冲突、离页与跨画布切换、撤销重做、节点连接与参数、任务恢复、图片预览、Fake 图片到视频工作流、导入导出、设计工作台、评审、供应商扫描与配置、智能体、弹窗焦点及 390–2539 像素宽度的相关布局。

主要验证命令（在仓库根目录运行；浏览器命令在 `apps/desktop/renderer` 运行）：

```powershell
pnpm typecheck
pnpm test
pnpm test:maintenance
pnpm lint
pnpm --filter @super-canvas/runtime... --filter @super-canvas/director... build
pnpm --filter @super-canvas/desktop-ui build
pnpm --filter @super-canvas/desktop build
```

```powershell
pnpm exec playwright test workspace-home.spec.ts canvas-layout-regression.spec.ts canvas-polish.spec.ts canvas-menu-keyboard.spec.ts canvas.spec.ts canvas-checkpoints.spec.ts canvas-run-reconciliation.spec.ts dialog-interactions.spec.ts project-dialog.spec.ts image-preview.spec.ts canvas-studio.spec.ts
pnpm exec playwright test workspace-home.spec.ts graphic-design.spec.ts image-design.spec.ts agent.spec.ts suppliers.spec.ts supplier-lifecycle.spec.ts supplier-settings-usability.spec.ts reference-channel.spec.ts
```

通过截图检查了 [桌面首页](workspace-home.png) 与 [窄窗口首页](workspace-narrow.png)。截图使用测试项目及占位封面。

## 检查边界

此次为源码检查、离线回归与本机浏览器验证，不等同于所有真实供应商端点的实网压测。没有使用真实 API Key 进行付费生成，没有生成、发布或安装新的安装包。开发版重新启动后使用新代码；已安装版本需后续打包升级。

代码规模较大的画布与样式文件仍有后续拆分空间。本次只修改有证据的问题和可验证的体验，未进行大范围迁移，以避免影响已有项目格式、供应商协议及保存语义。
