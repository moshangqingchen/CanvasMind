# 本机覆盖安装 v0.2.119（2026-10-19）

已构建并本机覆盖安装 **0.2.119.0**，BUILD_ID 为 `2-KE1rYWfoSFhp0zfM0uW`。安装器 exit 0，全载荷与核心文件 SHA、安装前后和首次启动前的资料字节核对均通过。正式应用已正常启动并保持运行。

**正式启动后验收未完成。** 应用于 `2026-10-19T11:01:22.5850215Z` 按正常方式启动，PID `183940`；输入监视器于 `11:01:23.6166397Z` 记录 `input-during-watcher-startup-gap`。按照“检测到用户输入立即停手”的要求，立即停止后续正式资料读回和界面操作，没有关闭应用。没有启动后只读核对、正式“换线路”弹层截图或首页截图；隔离冒烟不能替代这些验收。后续仅被动确认安装路径对应的 0.2.119 进程仍在运行。

本版调整“换线路”弹层的主次层级：强化供应商标题及线路数量，同账户余额集中显示，减少重复名称和普通行信息，突出当前线路并自动滚动至当前项。选择逻辑、价格、余额来源、Key 和连接未作产品改动。不包含供应商协议或价格调整，不发起收费生成。

| 步骤 | 结果 |
| --- | --- |
| 版本与发布说明 | 根目录及 desktop 为 0.2.119；新增 `docs/releases/v0.2.119.md` |
| 六库预编译、完整单测 | 通过；工作区 9346、cloud-generation 33、root maintenance 12，共 9391 通过、9 跳过、0 失败 |
| 递归 typecheck / renderer lint | 通过；lint 为 0 error，保留 2 个既有 unused warning |
| 完整 E2E | 19 配置、142 spec、709 个去重身份；683 通过、3 项 RAM 门槛失败、17 项原条件跳过、6 项性能预检不足未启动，不能表述为全绿；新增 hierarchy 9/9 通过 |
| Next / desktop:build | 通过，内联版本为 0.2.119；最终安装包 BUILD_ID 如上 |
| 隔离 packaged / 可见窗口冒烟 | 33 个唯一检查通过：原 packaged 20 项、定向补验 9 项、可见窗口 4 项；并非 packaged 一次全程通过 |
| 完整备份 | profile、安装程序、控制文件及 profile 外桌面状态已备份，逐文件 SHA 核对通过 |
| 覆盖安装与载荷核验 | exit 0；11366 个预期载荷文件 SHA 全匹配，核心文件、目录和 runtime 一致；额外文件仅安装器生成的卸载程序 |
| 安装前／安装后／首次启动前资料核对 | 三阶段核心资料与 profile 外桌面状态字节均与基线相同，无资料迁移或意外差异 |
| 正式启动后资料读回及 UI 验收 | 因检测到用户输入停止，未执行；无正式弹层或首页截图 |
| 应用状态 | 已正常启动，保持运行，未关闭或强制结束 |
| Git 发布、Worker、收费请求 | 未提交、未推送、未发布 GitHub Release、未部署 Worker、未发起收费生成 |

安装器：`apps/desktop/release/SuperCanvas-Setup-0.2.119-x64.exe`，268746813 字节，SHA-256 为 `46446604ad48c1954242ef15aeef8ba17ba6d72f75731ab8b0bd626058404ebd`。安装版 `SuperCanvas.exe` SHA-256 为 `3ab3738fc677bc27a7abd9df833efb3129669fb98590e3db711bf0d654e45c5e`。安装包装脚本、安装器进程的 TEMP/TMP 实际均为 `D:\project development\超级画布\.codex-temp\release-v0.2.119\installer`，包装进程 .NET TempPath 同一目录，未继承 C 盘 TEMP。

备份位于 `D:\project development\超级画布\backups\before-local-update-v0.2.119-20261019T104747298Z`。回滚安装器 0.2.118 已复制入备份，SHA-256 为 `e4aeb52f36648270732a8985f971902050f7ba0d581079f3c44f4b362d73d026`，未执行回滚。备份前的退出等待检查为 `10:46:30.5900163Z–10:46:31.0964853Z`，首次按绝对安装路径检查即确认未运行，共 1 次、约 0.506 秒；没有关闭或强制结束用户应用。

停机核对保留了 18 条核验证据完整读回及规范化哈希 `3b522ff4ee8e116fe6f96b5d63d962e298ff2b5e22cb0562ed394c9b60eda105`、各项计数、182 条连接保护字段、sidecar、证据文件和 5 个项目文件夹。三个阶段都与本版备份一致；这属于停机文件证据，不能写成正式启动后的安装版 API 或 UI 验收。启动后因输入监视命中而未继续读回，也没有据此宣称启动后的资料一致。

本轮保留了全部测试中间结果。E2E 的 3 项失败是与 0.2.118 相同身份的 6 GiB RAM 有效性门槛，6 项 `canvas-performance` 在 3.128 GiB 空闲内存预检下未启动，没有放宽阈值。首次 packaged 冒烟在旧 helper 仍期待每条线路重复余额时停止；仅更新未入包的 `apps/desktop/scripts/smoke-custom-suppliers.mjs` 余额断言，再补验失败项与尚未执行项，已通过的 20 项未重跑。定向续跑曾发生原因未知的原生退出，原始回执保留，未归咎 RAM；其部分 fixture 执行与后续成功检查分开记录。

该 helper 是本轮版本文件和文档之外唯一额外仓库改动，等待 Claude 审查。构建后绑定证明其余 1672 个源文件 SHA 不变，helper 未进入发布载荷，11366 个打包文件和安装器与改 helper 前逐字节相同。另有两项真实路径偏差已记录：首次单测的五个硬编码 fixture 目录，以及初次 Next 构建／E2E 沿用的 0.2.118 cache junction；结束后均保留原资料、逐文件 SHA 核对后迁入本版临时目录，不能写成全程路径严格符合。详见完整报告和相应证据。

源码 HEAD 保持 `1c2130cdd36efcf01937a51691f3d6272a087195`，分支 `release/v0.2.110`。需要 Claude 审查并提交的文件共 5 个：

- `package.json`
- `apps/desktop/package.json`
- `apps/desktop/scripts/smoke-custom-suppliers.mjs`
- `docs/releases/v0.2.119.md`
- `docs/installed-update-v0.2.119-2026-10-19.md`

完整中文报告（含原样失败、安装回执、备份核对和停止边界）：[final-report.md](../.codex-logs/2026-10-19-release-v0.2.119/final-report.md)。证据目录为 `.codex-logs/2026-10-19-release-v0.2.119/`。本记录没有补做任何应用操作、正式 profile 读取或 API 请求。
