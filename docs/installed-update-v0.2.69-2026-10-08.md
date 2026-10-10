# 本机 0.2.67 → 0.2.69 安装阻塞修复

日期：2026-10-08（America/Los_Angeles）。本次是用户请求的本机安装故障修复，不属于供应商日检。

## 结论与状态

旧安装器反复提示“超级画布无法关闭”，但检查时正式应用和后端进程均已退出。将安装目录内一组可重建的 Next 页面响应缓存完整备份移出后，用户点击“重试”，确认安装继续；正式主程序随后变为 0.2.69。

现场干预与结果高度指向旧卸载器搬移超长路径缓存失败。未取得失败时的具体 Windows 文件操作错误码，因此不将推断写成已捕获的底层错误。

2026-10-08 14:24:37 UTC 的最终采样确认：安装器已退出，正式 `SuperCanvas.exe` 为 0.2.69，应用及其自己的后端 Node 均已启动。用户已确认“已经完成并正常打开”。安装后的新日志未检出本次筛查的启动超时、未捕获异常、崩溃恢复或无响应记录；这是短时启动核验，不是完整稳定性测试。

Windows 卸载登记仍显示 0.2.64，与实际程序文件版本不一致；本次未手工修改注册表。后续应检查安装器登记更新流程，不能用该旧登记否定已安装的真实版本。

## 排查证据

- 待安装包为 `SuperCanvas-Setup-0.2.69-x64.exe`，216,605,464 字节，SHA-256 为 `35B36B5CFE0008C324422D08AFA2EA722F1AB7AA520602A6C8CEBC99833D517D`，与已发布安装包一致。
- 采样时无正式安装目录下的应用或后端进程；Windows Restart Manager 对 19 个关键安装文件的只读检查未返回占用进程。这不等同于对全部文件的占用证明。
- 安装目录中存在 12 个运行时 `route-cache` 文件；最长文件路径为 265 个字符，搬移到旧卸载器的临时 `old-install` 目录后预计为 268 个字符。
- 排除这组缓存后，其余 11,645 个文件最长路径为 222 个字符，预计搬移后为 225 个字符。
- electron-builder 26.15.3 的旧卸载器通过逐文件 `Rename` 原子搬移旧程序，任一失败会恢复并退出。上层连续失败后显示通用的“无法关闭”提示，因此该提示并不只代表应用进程未退出。
- Next 16.3.8 的 `route-cache` 保存可重建的页面响应；编译路由位于独立的 `server/app`，本次未移动编译文件。

## 已执行的精确修复

于 2026-10-08 14:19:23 UTC，仅移动以下目录：

```text
%LOCALAPPDATA%\Programs\SuperCanvas\resources\runtime\server\apps\desktop\renderer\.next-desktop\server\route-cache
```

备份保留在工作区忽略目录：

```text
.codex-temp/installer-block-20261008/saved-route-cache-0.2.67
```

移动前核对源、目标的绝对边界，拒绝已存在的备份、目录链接和正式应用仍在运行的情况。移动后，12 个文件的相对路径、长度和 SHA-256 全部保持一致。正式画布数据库的操作前后 SHA-256 相同。没有删除缓存备份，没有写入正式资料，没有终止进程。

操作凭据与文件清单分别保存在 `.codex-temp/installer-block-20261008/cache-quarantine-receipt.json` 和 `route-cache-before.json`；这些文件不包含账号、Key 或数据库正文。

## 后续防复发与验收

后续源码修复已在 `apps/desktop/renderer/next.config.mjs` 设置 `experimental.isrFlushToDisk: false`，关闭 Next 运行时页面响应缓存的磁盘写入，保留默认 50 MiB 有界内存缓存和编译页面读取。已发布的 0.2.69 安装包不包含本次后续修复，本次未改版本、发布包或已安装程序。

`apps/desktop/tests/next-response-cache.test.mjs` 使用当前 Next 16.3.8 的真实 FileSystemCache，验证超过 259 字符的 HTML/RSC/segment 响应缓存只留在内存，且编译 seed 可读、原文件内容不变、不会提升复制到运行时缓存目录。两项针对性回归通过，无跳过。

验证结果：

- 桌面测试共 99 项：98 通过，0 失败，1 项因当前环境不能创建临时文件符号链接而跳过（日志链接边界用例，与本次缓存用例无关）。
- 生产 renderer 构建通过；生成的 `required-server-files.json` 与 standalone `server.js` 均保留 `isrFlushToDisk: false`，内存限制仍为 52,428,800 字节。
- 构建输出和 standalone 中均未生成 `server/route-cache`。
- `git diff --check` 通过。独立只读审查未发现阻塞问题。

0.2.69 启动后已再次创建 6 个缓存文件，当前最长路径为 249 个字符。已发布版本尚未包含关闭磁盘响应缓存的修复；本次成功移除的是旧安装阻塞，不能据此保证旧版本下次更新永不重现。下次打包与旧版升级验收需包含已有缓存的场景。

现场最终状态保存在 `.codex-temp/installer-block-20261008/installed-final-state.json`；源码构建验证保存在 `source-build-verification.json`，测试及构建日志也在同一忽略目录。
