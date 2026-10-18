# C 盘历史备份清理记录（2026-10-11）

用户在本会话授权“按照你的删除不相关的吧”。本次只清理以下两个历史备份根中的旧副本，没有修改项目源码、安装程序或正式运行中的 profile/browser 数据。

- `C:\Users\Administrator\AppData\Local\SuperCanvasDesktop\backups`
- `C:\Users\Administrator\AppData\Local\SuperCanvasDesktopBackups`

## 结果

按 1 GiB = 1,073,741,824 字节统计（Windows 磁盘界面通常显示为 GB）：

| 项目 | 结果 |
| --- | ---: |
| 原备份文件总量 | 80.35 GiB |
| 已删除文件 | 64,404 个，共 69.86 GiB |
| 保留内容及新增精简说明 | 10.49 GiB |
| 结束时 C 盘可用空间 | 186.23 GiB |

删除文件共 75,012,051,757 字节。执行阶段磁盘可用空间增加约 68.95 GiB；磁盘统计受同时发生的其他写入及文件系统实际分配影响，不将文件逻辑大小冒充精确的磁盘净增量。

## 保留范围

两处各保留一份最新完整备份，共 17,904 个文件、约 5.01 GiB：

1. `SuperCanvasDesktop\backups\before-image-presets-v0.2.95-2026-10-11T16-20-03-685Z-cbda7e3e-2f48-4f2f-8986-0f0282374fac`
2. `SuperCanvasDesktopBackups\before-jiasu-recharged-20261009T234429Z`

旧快照中原路径保留数据库、密钥、配置、迁移留档、manifest、修复证据等 23,290 个文件，约 4.22 GiB。保留规则覆盖旧布局的根级 data、根级数据库与配置、profile/data、profile/backups、profile 根文件、JPEG 修复 archive-before 与修复原图。

另保留 152 个没有相同保留副本的历史媒体文件，约 1.27 GiB。其余被删除媒体均先核对 SHA-256 和文件长度，并在清单中记录实际保留副本路径；保留副本不会被本次清理删除。旧 browser 副本清理时保留 Local State、Preferences、Secure Preferences、Bookmarks 和清单/报告类文件。

## 验证及边界

- 共盘点 58 份快照、105,750 个文件。删除仅使用 PowerShell `Remove-Item -LiteralPath` 对清单中的单个文件执行，限定于两个明确备份根的直接快照子目录。
- 执行前校验规范绝对路径、目录边界、重解析点、文件大小与修改时间，并锁定清单 SHA-256。
- 删除前后均验证全部 41,346 个保留文件的 SHA-256 一致，包含两份完整备份、历史证据与独有媒体；逐条确认待删除文件已不存在。
- 当前源码与常规测试没有读取指定旧快照的依赖。旧诊断使用的数据库及密钥原路径保留。正式应用进程在清理后仍在运行，正式数据库与密钥文件存在；没有进行界面、收费生成或供应商能力验收。
- 被精简的旧目录已增加 `CLEANUP-NOT-A-FULL-BACKUP.txt`。它们不再是完整回滚点；原 manifest 的 verified 仅代表创建时状态。遍历原清单检查整份旧备份的历史脚本不能直接通过，不能将保留诊断基线等同于保留完整旧备份。
- 保留快照目录原修改时间，避免精简说明使旧快照被排序成最新。

## 本地明细

详细清单含本地路径，保存在已被 Git 忽略的 `.codex-temp/backup-cleanup-20261011/`：

- `plan.csv`：全部文件的保留/删除分类、哈希与媒体保留位置。
- `plan-summary.json`：执行前统计。
- `deletion-journal.jsonl`：每个实际删除文件及其保留副本映射。
- `result.json`：完成统计及校验结果。
- `prepare-cleanup.ps1`、`apply-cleanup.ps1`：本次使用的检查和受限清理脚本。

清单 SHA-256：`FDEDF2E8BBF0B2BB1ADC121396E5535C930318C64D07B9A5A0C13E05D528A95C`。

完成时间：2026-10-11 17:32（America/Los_Angeles），对应 `2026-10-12T00:32:10Z`。
