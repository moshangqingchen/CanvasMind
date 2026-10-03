# 项目维护

当前交付目标是 Windows 桌面 App。`apps/desktop` 是桌面外壳，`apps/desktop/renderer` 是 App 内嵌界面和本地 API，都属于桌面 App，不存在独立网站工程。

## 目录用途

| 目录                                                   | 用途与保留规则                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `apps/desktop/src`、`apps/desktop/renderer`、`packages`             | 当前功能源码与测试                                                       |
| `apps/desktop/stage`、`apps/desktop/dist`              | 已准备的桌面运行资源；普通清理保留                                       |
| `apps/desktop/renderer/.next-desktop`                               | 最近的桌面界面构建；普通清理保留                                         |
| `apps/desktop/release`                                 | 当前版本安装包、更新文件与打包验证产物；旧包核对版本后单独清理             |
| `%LOCALAPPDATA%/Programs/SuperCanvas`                  | 本机正式安装目录；日常使用与 Dock 指向这里，不在仓库中维护安装副本        |
| `.codex-temp`                                          | 历史诊断、测试和素材验证；只自动清理已知测试部署中的构建、日志和重复依赖 |
| `backups`、`项目`、`apps/desktop/renderer/data`、`apps/desktop/renderer/storage` | 历史数据与恢复资料；不列入构建清理                                       |
| `%LOCALAPPDATA%/SuperCanvasDesktop/profile`            | 当前 App 的画布、素材、连接和历史；不在仓库清理范围内                    |

## 日常清理

先结束源码开发服务和测试，再执行：

```powershell
pnpm clean:check  # 只预览清单和可回收空间
pnpm clean        # 执行普通清理，保留当前桌面启动资源
pnpm start        # 继续启动已经构建好的桌面版
```

要从依赖开始重建，才使用：

```powershell
pnpm clean:deep -- --dry-run
pnpm clean:deep
pnpm install --frozen-lockfile
pnpm dev
```

清理仅操作工作区内的可重建路径。它逐层检查路径边界，拒绝穿过符号链接或 Windows junction，删除构建目录时也不跟随内部链接。`pnpm test:maintenance` 验证素材、备份、安装副本和目录链接的保护边界，CI 同样运行这些测试。

普通清理也包含 `.ui-*-results` 形式的历史界面测试输出；只识别这个明确的产物命名，不处理其他 `.ui-*` 隐藏目录。

## 质量检查与测试隔离

`pnpm typecheck` 会先构建运行服务与导演引擎的共享依赖，支持干净检出。`pnpm test` 只收集各包源码中的单元测试，不扫描 `dist` 或 Next.js standalone 产物。`pnpm test:maintenance` 同时运行清理边界、素材 GC、供应商目录检查器和导演知识同步脚本的回归测试。

构建后运行 `pnpm --filter @super-canvas/desktop-ui e2e`。自动启动的测试服务使用每次独立的系统临时目录，隔离数据库、素材、项目归档、恢复文件和素材通道配置；结束时先停止服务，再清理该临时目录。显式设置 `PLAYWRIGHT_BASE_URL` 则使用调用方指定的服务，由调用方负责其数据隔离。不要指向正在使用的个人资料库。

画布性能数据和 CPU profile 写入 Playwright 的当前测试输出目录。历史遗留的 `apps/desktop/renderer/项目` 已加入 Git 与打包忽略规则，保留现有文件以供核对，不作为源码或安装包内容。

旧版本安装副本和历史安装包不做自动按时间删除。先确认桌面快捷方式、卸载注册和运行进程都指向当前版本，且旧目录没有用户资料，再单独删除明确的旧副本。

2026-09-29 已按上述核对流程整理本地工作区，删除不再使用的旧程序副本和历史安装包，保留当前 0.2.43 安装包、更新文件和开发启动资源。以后不要再向 `apps/超级画布桌面版*` 复制日常使用的程序，避免启动旧版本和重复占用空间。历史诊断目录可能同时含程序副本、数据库快照和原始生成素材，不能直接删除整个 `.codex-temp` 或 `backups`；程序副本与资料必须分别检查。具体清单及保留范围见[本地工作区整理记录](workspace-cleanup-2026-09-29.md)。

独立网页版及 Docker、Worker、PostgreSQL、S3、网页更新与守护脚本已移除。旧资料仅作为迁移备份保存，不参与构建；导入时选择包含 data、storage 和原加密配置的目录。

不把 `gc:storage:apply` 用于日常整理，它处理实际素材，需要独立检查引用和备份。图片修复、供应商协议和历史运行记录属于功能与数据，不按“文件较旧”删除。
