# 0.2.76 最终推送、发布与安装验收

任务日期：2026-10-08（America/Los_Angeles）；最终汇总：2026-10-09T05:25:10.949Z。

最终源码 `6b6d9a59c0266babcfb00c917ee0bd4e65c34ac7` 已推送。[主 CI](https://github.com/moshangqingchen/CanvasMind/actions/runs/37886612688) 和 [Windows 发布流程](https://github.com/moshangqingchen/CanvasMind/actions/runs/37886612960) 均为实际终态成功，[正式发布页](https://github.com/moshangqingchen/CanvasMind/releases/tag/v0.2.76) 的标签与说明准确对应该提交。

## 用户可见改动

- 智能体默认普通聊天；只有当前用户主动选择制作方案，才进入待确认的画布生产流程。模型建议、引用、历史和附件不能自动授予生成权限，费用预检与实际生成确认仍保留。
- 首页、智能体、画布工具栏及供应商设置统一层级、留白和控件，减少重复阴影和模糊；保留模型、参数、报价、错误提示和保存行为。
- 移除8个无调用的私有目录包装函数，整理旧智能体样式冲突，清理已核对的可重建或重复文件；独有验收资料、画布素材和恢复备份保留。
- 未取得单实例锁的重复进程立即退出，避免继续初始化或写入拥有者的浏览器加密状态；原密钥不会自动重置。

改动和清理证据见[本地聊天与界面验收](studio-refinement-chat-2026-10-08.md)、[清理审计](code-cleanup-audit-2026-10-08.md)和[重复启动保护记录](desktop-single-instance-2026-10-08.md)。

## 实际验收结果

| 检查 | 完整日志/收据结果 |
| --- | --- |
| 主 CI 单元 | 4194 planned，4193 通过，1 跳过，0 失败 |
| 主 CI 浏览器 | 345 项，首次通过 345，flaky 0，重试 0，跳过 0，最终失败 0 |
| 主 CI 维护 | 12 planned，12 通过，0 跳过，0 失败 |
| 云 Windows 桌面单元 | 106 planned，106 通过，0 跳过，0 失败 |
| 云 Windows 打包 / GPU窗口恢复 | 27 / 4 检查通过，渲染异常0 |
| 发布前置单元 | 4194 planned，4193 通过，1 跳过，0 失败 |
| 发布前置浏览器 | 345 项，首次通过 344，flaky 1，重试 1，跳过 0，最终失败 0 |
| 发布 producer 定向浏览器 | 36 项，首次通过 36，flaky 0，重试 0，跳过 0，最终失败 0 |
| 发布 producer 定向单元 | 199/199、63/63 |
| 发布 producer 桌面 / 打包 / GPU | 106 planned，106 通过，0 跳过，0 失败；27 / 4 检查，异常0 |
| 本地桌面单元 | 106 planned，105 通过，1 跳过，0 失败 |
| 本地确认烟测 / GPU窗口 | 27 / 4 检查通过，渲染异常0；27项来自保留首轮原生失败后的独立确认 |

planned、通过和跳过分开统计，不把环境跳过写成通过，也不把本地、主CI和发布流程的重叠子集累加为独立覆盖。浏览器重试/flaky按实际日志报告。

发布前置浏览器的快捷键弹窗用例首轮找不到弹窗关闭按钮，重试后通过；尚未执行Tab或Escape，因此不能由该日志认定焦点约束或关闭后返回入口存在产品故障。fixture仅等待加载期间也可见的菜单，而快捷键监听在初始化就绪后注册，存在可见的同步缺口；没有首败trace可确认唯一因果。主CI同用例首次通过不能抵消这次发布复验的真实重试。

## 保留的失败与修复边界

0.2.75 的 e350 发布 producer 在22项通过后，同隔离目录重启停留在资料密钥错误页。真实隔离对照证实了非拥有者退出引发加密状态写入的竞态；原远端失败未保存当时密钥状态，不能断言该竞态或DPAPI本身是那次失败的唯一原因。
76首个06d主CI的providers为1373通过、1项5秒超时。旧HTTP mock之前仍存在真实DNS等待边界；具体DNS占用的时间没有测得。后续仅补齐测试DNS/HTTP隔离，不改变产品、超时或跳过政策；旧发布流程在尚未发布时取消，原失败与取消证据保留。
本地首轮烟测驱动原生退出0xC0000409，未写出结果报告，原因未确证；只清理已证明自有的隔离测试进程，未停止正式应用。后续27项确认成功不能改写成首轮通过。

## 发布产物与本机安装

本地包 219,096,165 字节，SHA256 `a98baea717ad8e2290d5b906e05529d2371264beec8ebfa293607076183c39e6`，BUILD_ID `UN6GjmJJHV94WvVg75Dan`。19项冻结生产/发布元数据与最终提交绑定，这19项不是全仓库或全部烟测输入。
公开安装包 216,675,329 字节，官方摘要 `sha256:3bcb3a5013feb5fc5a166ab8173fc74f620dde4a05568dd067326abe2f4ccc35`。本地与云端摘要不同，分别保留实际值，不假定独立构建产物字节相同。
公开3个资产HEAD、完整latest.yml/blockmap校验及206的1024字节安装包Range样本通过。没有独立下载整包复算公开安装包哈希；producer整包校验单独记录。实际electron-updater比较结果见安全JSON，没有实例化更新器或追加安装。

公开检查有 2 次首轮连接错误后在有限重试中恢复：HEAD/asset-head ECONNRESET、GET/manifest ECONNRESET。最终校验通过不改写这些初始网络失败，不据此保证所有地区下载速度或网络稳定性。

本机 2026-10-09T05:14:16.6751049+00:00 完成76安装，退出码0，6个关键安装文件与已验本地产物匹配且allowLaunch通过。2026-10-09T05:15:52.4852183+00:00 普通启动检查确认窗口响应、拥有的后台及health/projects/suppliers三个GET均200；检查未读这些响应正文。界面截图来自隔离测试，不能冒充直接检查了全部正式UI。

资料保护于 2026-10-09T05:16:00.549Z 稳定采样；安装前后关闭状态及启动后13个受保护集合均为0差异。整体DB哈希未变化，信息性差异 0 项，按实际状态记录。安装前保存了5个原始资料/密文保护文件，未声称整个DB重新加密或恢复演练已执行。
GET检查器没有直接写正式资料；应用正常启动和GET处理仍可能执行迁移、状态恢复或目录刷新。保护结论只对应上述时间和受保护字段，不能保证后续用户编辑保持全库哈希不变。

## 安全收据

- ci：[安全证据](../.codex-temp/release-v0.2.76/github-readonly-final/evidence/6b6d9a59c0266babcfb00c917ee0bd4e65c34ac7/ci/run-37886612688/attempt-1/collection-2026-10-09T05-09-52.632Z-3cd7cd7b-6911-42dd-a5b2-4fa57c757585/workflow-counts-summary-2026-10-09T05-10-05.519Z-ab396dd7-e283-4bb2-8d9d-f29bd0db2627.json)，SHA256 `37d81581c7082c55db38d1a27a8f6b774bbd14fbd1e1533585a4a729bd732461`
- release：[安全证据](../.codex-temp/release-v0.2.76/github-readonly-final/evidence/6b6d9a59c0266babcfb00c917ee0bd4e65c34ac7/release/run-37886612960/attempt-1/collection-2026-10-09T05-20-34.629Z-2c435cd6-ed46-4743-a603-f1e473b7edc3/workflow-counts-summary-2026-10-09T05-21-19.899Z-2a8f30b2-45b9-42ca-b699-1dc17cace0cb.json)，SHA256 `7254fac1f7e8fa94de65243b8fc0e70e10bb85537f620cb84483cb97b002829f`
- public：[安全证据](../.codex-temp/release-v0.2.76-public-prepared/public-v0.2.76-verification-2026-10-09T05-22-47.677Z.json)，SHA256 `3c984ea11854dbad2ccb1a4fb14a9bb0b488590e2c28683b5496a547ec5cfaae`
- localBinding：[安全证据](../.codex-temp/release-v0.2.76/local-artifact-commit-binding-current-safe.json)，SHA256 `7b62d88b8d9e485ce7867857b245cc770dbfdf7b9b55cd84c3c7f26e6c0ecaef`
- localUnitLog：[安全证据](../.codex-temp/release-v0.2.76/desktop-unit.log)，SHA256 `220b8f5dbc902904efb984953a98143abed0b3abd3194b3032a957c17ccc6711`
- localSmoke：[安全证据](../.codex-temp/release-v0.2.76/packaged-smoke-confirm-report.json)，SHA256 `7ae8002342a5aff9268f8a623e75c91e1e175f0f5b26b89e00d60f1e349dfc4d`
- localWindowed：[安全证据](../.codex-temp/release-v0.2.76/windowed-smoke-report.json)，SHA256 `7dc6c6ffb1b3940c94d84e0ada46e976898dde7a0ae3cd771ca537a3c17051b5`
- install：[安全证据](../.codex-temp/release-v0.2.76/install-prepared/install76-20261009T051036789Z.json)，SHA256 `4bb7160bfbe0581f40d74d2f0b546d6b5da2d58ec83c933e776e451d386cf7e0`
- runtime：[安全证据](../.codex-temp/release-v0.2.76/install-prepared/normal-launch76-safe-20261009T051552490Z.json)，SHA256 `111917338317cc34ca11d082a63bd73702170fae1c64fbf49d35268f33aa3e4f`
- startupScope：[安全证据](../.codex-temp/release-v0.2.76/install-prepared/startup-free-scope-safe-2026-10-09T05-15-35-156Z.json)，SHA256 `e1a208b27bb985ca8d33ff5c006157edb9c54cf4a8a331d17f912b62df991877`
- closedProtection：[安全证据](../.codex-temp/release-v0.2.76/install-prepared/closed-protection-2026-10-09T05-14-16-664Z.json)，SHA256 `16064f61ae4b5168899d989887cff01c8a7e88b3bc3a785a1900f7d3954e768c`
- liveProtection：[安全证据](../.codex-temp/release-v0.2.76/install-prepared/live-protection-safe-2026-10-09T05-16-00-549Z.json)，SHA256 `6095b8b422f3b22dc503a6f4bc8bc4186e920cb78e8d0515f2c0068bbdc25911`
- backup：[安全证据](../.codex-temp/release-v0.2.76/install-prepared/protected-profile-backup-20261009T045227179Z/backup-receipt.json)，SHA256 `a0a63959b0bf25d061a07f300a017c405078404a2aeffc4e92f0f089e26c88db`
- old75ProducerLog：[安全证据](../.codex-temp/release-v0.2.75/github-readonly-final/evidence/e35082af5e108bfbb585a85b4744a48b30616392/release/run-37881639159/attempt-1/logs/job-113664613675.log)，SHA256 `50d6feb3d86728f0860168031d8708f646ebf5c9a23e4c66cd9cdf110dfd129e`
- old76Dns：[安全证据](../.codex-temp/release-v0.2.76/image-editing-fixture-isolation-20261009T0515Z/fixture-isolation-review-safe.json)，SHA256 `f4bde332ff4c33fa157362dbc3209aeddf78ecb1015c98317263ebe03aa124f2`
- old76Cancellation：[安全证据](../.codex-temp/release-v0.2.76/superseded-release-cancellation-2026-10-09T05-00-49-176Z-f6f9bb86-7ae1-4e18-8200-be181b76a7e6.json)，SHA256 `7afb38c2a45748e68219507eea654e98a09991e38a95763b7b40f67844f58fd4`
- old76Status：[安全证据](../.codex-temp/release-v0.2.76/github-readonly-prepared/status/status-2026-10-09T05-01-08.842Z-97ce8dbb-cc4e-4295-909f-f11f5959e1a4.json)，SHA256 `ff832bc07b52b3f00b1f64d43770f64f1f9ebba8fe41c88f969fa01365c339a0`
- localNativeFailure：[安全证据](../.codex-temp/release-v0.2.76/packaged-smoke-first-native-failure-safe.json)，SHA256 `ccc2ddf1f9bdd517b8f960244cf373119e4eab217271b2b5ceb0eb04f7a788a7`

仅使用隔离测试与模拟生成，没有借此报告声称真实付费生成、所有供应商能力或所有网络稳定性已验证。最终两份文档为发布后的本地验收资料，不追加提交或再次触发发布。
