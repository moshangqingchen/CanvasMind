# 供应商授权异常复查与废弃分组清理（2026-10-10）

本次复查原有 23 条扫描状态为 unauthorized 的连接，覆盖 7 个供应商账号。通过免费模型目录及已认证账号的完整分组、Key 清单，确认 3 条 MikotoPro 连接的上游分组明确已删除，已清理其本地组及连接。其余 20 条属于停用、权限拒绝或无效 Key，保留原连接和资料，没有把 unauthorized 一律判成 Key 错误或把目录缺席当作删除。

本轮没有真实生成、收费视频验证、上游 Key 新增/删除、充值、桌面升级、提交或推送。安装程序仍为 **0.2.86 / BUILD_ID `Ckrib-_CpKBBPgjGCNoYl`**。工作区诊断代码已修复并通过检查，但尚未安装。随后发现的保存冲突已保全用户草稿并正常保存、刷新验收通过，具体过程与分组清理分开记录。

## 免费读取与身份核对

23 条连接共完成 **25 次模型目录 GET**：每条读取 `/v1/models`，喵呜两个失败连接还分别读取原生视频目录。回执采样时间为 2026-10-10 10:08:00–10:08:07 UTC，每条记录端点、时间、HTTP、机器码及正文 SHA-256。

7 个账号均已认证，账号可用分组和 Key 分页完整读取。“完整”指对应账号清单，不表示账号拥有所有全局组的调用权限。NewAPI 核对 `/api/user/self/groups`、`/api/token/?p=1&page_size=100` 和 `/api/pricing`；sub2api 核对 `/api/v1/groups/available`、`/api/v1/keys?page=1&page_size=100`。探测入口 404 后继续使用实际成功入口，没有当作无目录。必要登录及已有 Key 揭示使用站点原有 POST，只读取既有凭据进行本机匹配，没有创建或删除 Key。

|供应商|站点类型|账号可用组|Key 原始记录|解析可用 / 跳过|完整性|
|---|---|---:|---:|---:|---|
|沧元算力|newapi|14|10|10 / 0|已认证；组和 Key 分页完整|
|赛博阿飞 API|newapi|13|7|7 / 0|已认证；组和 Key 分页完整|
|MikotoPro|sub2api|7|9|7 / 2|已认证；组和 Key 分页完整|
|喵呜 API|newapi|1|1|1 / 0|已认证；组和 Key 分页完整|
|辰途 API|newapi|24|20|20 / 0|已认证；组和 Key 分页完整|
|secure-skill|sub2api|25|28|28 / 0|已认证；组和 Key 分页完整|
|FriModel|newapi|16|14|14 / 0|已认证；组和 Key 分页完整|

**18 条连接**精确匹配当前账号已有 Key，**0 个**同一稳定分组内可替换的其他有效 Key。此数按连接计：secure-skill 两条历史连接均匹配 Key 记录 2203，不能算成两个不同 Key。没有跨组借用凭据或删掉重建连接。Mikoto 的旧 Key 记录 2651、2652 仍有记录 ID，但缺少有效所属组，不能算作可用同组 Key。

## 23 条逐组结果

下表 Key 记录 ID 是上游账号列表的非凭据编号，不是 API Key 内容；精确匹配在本机完成。不提供独立官方编号的 NewAPI 组保留完整组名身份，不猜编号。

|供应商|完整本地分组|完整连接 ID|官方组编号/身份|Key 记录身份|实际免费 GET 与结果|原因|本次动作|
|---|---|---|---|---|---|---|---|
|沧元算力|IMAGE-备用分组|`829c6998-bfc8-4957-9c53-00b91619650f`|无独立编号；以完整组名识别|3656（当前精确匹配）|GET `https://ai.cangyuansuanli.cn/v1/models` → 403 / 无机器码|账号权限拒绝；现有 Key 仍绑定旧组|保留原连接、凭据、组和历史|
|赛博阿飞 API|gpt5.6-破甲版|`b02685af-ee50-49c9-b43c-4172b0391a1c`|无独立编号；以完整组名识别|1753（当前精确匹配）|GET `https://api.3365api.cn/v1/models` → 403 / 无机器码|账号权限拒绝；公共价格组及现有 Key 仍在|保留原连接、凭据、组和历史|
|MikotoPro|Seedance 视频|`0e25fcc9-481e-49a6-8932-7d57c5236293`|34|2646（当前精确匹配）|GET `https://api.mikoto.vip/v1/models` → 403 / GROUP_DISABLED|上游明确停用；当前 Key 仍绑定该组|保留原连接、凭据、组和历史|
|MikotoPro|Gemini 原生图片|`687622e2-7454-4b25-acae-0d8712fd3eb3`|无独立编号；以完整组名识别|未确认|GET `https://api.mikoto.vip/v1/models` → 403 / GROUP_DELETED|上游明确所属组已删除；本地无业务引用|已删本地组及连接；不删上游 Key|
|喵呜 API|OpenAI Videos|`62103fb3-1370-4deb-a0b2-7f4bdab3895e`|无独立编号；以完整组名识别|未确认|GET `https://api.miaowuai.store/v1/models` → 401 / 无机器码<br>GET `https://api.miaowuai.store/v1/dream/model_list?type=video` → 401 / 无机器码|Key 无效；三目录不见，但无明确删除回执|保留原连接、凭据、组和历史|
|MikotoPro|grok生图|`938173d4-9017-43df-a434-f96d897be1fe`|37|4066（当前精确匹配）|GET `https://api.mikoto.vip/v1/models` → 403 / GROUP_DISABLED|上游明确停用；当前 Key 仍绑定该组|保留原连接、凭据、组和历史|
|喵呜 API|vip|`1cdbc5f4-eabb-4c23-ab6d-de5aa550f53e`|无独立编号；以完整组名识别|未确认|GET `https://api.miaowuai.store/v1/models` → 401 / 无机器码<br>GET `https://api.miaowuai.store/v1/dream/model_list?type=video` → 401 / 无机器码|Key 无效；vip 仍全局可见|保留原连接、凭据、组和历史|
|辰途 API|无敌稳定Pro|`5437e229-a274-4c2c-8c9b-5e458336522c`|无独立编号；以完整组名识别|587（当前精确匹配）|GET `https://tu.988236.xyz/v1/models` → 403 / 无机器码|账号权限拒绝；现有 Key 仍绑定旧组|保留原连接、凭据、组和历史|
|辰途 API|az兜底渠道1k生图|`dfa05bdc-cd12-4fa9-88e1-2a7543b27699`|无独立编号；以完整组名识别|820（当前精确匹配）|GET `https://tu.988236.xyz/v1/models` → 403 / 无机器码|账号权限拒绝；现有 Key 仍绑定旧组|保留原连接、凭据、组和历史|
|沧元算力|GLM|`a9b123f3-a69d-4dd5-8e46-bf1a5a9f3de7`|无独立编号；以完整组名识别|1499（当前精确匹配）|GET `https://ai.cangyuansuanli.cn/v1/models` → 403 / 无机器码|账号权限拒绝；现有 Key 仍绑定旧组|保留原连接、凭据、组和历史|
|辰途 API|纯血ccmax|`13c46a9e-21e0-4cdf-aba0-8ce6fe7d86cc`|无独立编号；以完整组名识别|586（当前精确匹配）|GET `https://tu.988236.xyz/v1/models` → 403 / 无机器码|账号权限拒绝；公共价格组及现有 Key 仍在|保留原连接、凭据、组和历史|
|辰途 API|CC-MAX-企业版-CC Test满分|`8d328ac4-6c7b-480c-b142-0e0a6cdb9654`|无独立编号；以完整组名识别|585（当前精确匹配）|GET `https://tu.988236.xyz/v1/models` → 403 / 无机器码|账号权限拒绝；公共价格组及现有 Key 仍在|保留原连接、凭据、组和历史|
|辰途 API|0.13特惠Pro号池|`2ad02041-d655-4e79-a240-f75ea8996650`|无独立编号；以完整组名识别|578（当前精确匹配）|GET `https://tu.988236.xyz/v1/models` → 403 / 无机器码|账号权限拒绝；现有 Key 仍绑定旧组|保留原连接、凭据、组和历史|
|MikotoPro|gemini-3.1-flash-image-preview|`699e615a-234c-4494-809b-24bd3b8b0142`|无独立编号；以完整组名识别|2652（旧保存 ID；当前未匹配有效组）|GET `https://api.mikoto.vip/v1/models` → 403 / GROUP_DELETED|上游明确所属组已删除；本地无业务引用|已删本地组及连接；不删上游 Key|
|MikotoPro|gemini-3-pro-image-preview|`6b5a9d11-26fd-4169-bd46-c436022d3c75`|无独立编号；以完整组名识别|2651（旧保存 ID；当前未匹配有效组）|GET `https://api.mikoto.vip/v1/models` → 403 / GROUP_DELETED|上游明确所属组已删除；本地无业务引用|已删本地组及连接；不删上游 Key|
|secure-skill|video-企业版|`0f0dc6b8-5d52-460c-8f81-934f850fed92`|16|2203（当前精确匹配）|GET `https://token.secure-skill.com/v1/models` → 403 / GROUP_NOT_ALLOWED|当前账号不允许此组；现有 Key 绑定可核对|保留原连接、凭据、组和历史|
|secure-skill|seedream-5.0-pro图片模型|`ce3be462-25e6-4c33-9584-a07f145d1828`|35|2211（当前精确匹配）|GET `https://token.secure-skill.com/v1/models` → 403 / GROUP_NOT_ALLOWED|当前账号不允许此组；现有 Key 绑定可核对|保留原连接、凭据、组和历史|
|secure-skill|sd-2.5-特价|`50b8e6ec-cf6d-4fee-b7ab-8fc4f8095f38`|42|2216（当前精确匹配）|GET `https://token.secure-skill.com/v1/models` → 403 / GROUP_NOT_ALLOWED|当前账号不允许此组；现有 Key 绑定可核对|保留原连接、凭据、组和历史|
|secure-skill|flow-大户|`f5806c70-2248-4ed7-92d5-6fba1c0fba43`|47|2219（当前精确匹配）|GET `https://token.secure-skill.com/v1/models` → 403 / GROUP_NOT_ALLOWED|当前账号不允许此组；现有 Key 绑定可核对|保留原连接、凭据、组和历史|
|FriModel|gpt_image_adobe_外接|`72c5d66d-485f-4e6e-91f1-dc597c363112`|无独立编号；以完整组名识别|3839（当前精确匹配）|GET `https://api.frimodel.com/v1/models` → 403 / 无机器码|账号权限拒绝；现有 Key 仍绑定旧组|保留原连接、凭据、组和历史|
|辰途 API|klingsd视频|`a9e0f338-d166-4f46-80cd-f7a331b13a99`|无独立编号；以完整组名识别|1100（当前精确匹配）|GET `https://tu.988236.xyz/v1/models` → 403 / 无机器码|账号权限拒绝；现有 Key 仍绑定旧组|保留原连接、凭据、组和历史|
|MikotoPro|grok heavy|`ed67229e-23a4-4fcd-b2b3-f3372895c2f0`|40|5342（当前精确匹配）|GET `https://api.mikoto.vip/v1/models` → 403 / GROUP_DISABLED|上游明确停用；当前 Key 仍绑定该组|保留原连接、凭据、组和历史|
|secure-skill|video-企业版 [分组ID 16]|`f06dc582-c95b-414b-95b9-6194b4c562ac`|16|2203（当前精确匹配）|GET `https://token.secure-skill.com/v1/models` → 403 / GROUP_NOT_ALLOWED|当前账号不允许此组；现有 Key 绑定可核对|保留原连接、凭据、组和历史|

按连接分类：3 条 `GROUP_DELETED` 已本地删除；保留 **3 条 `GROUP_DISABLED`、5 条 `GROUP_NOT_ALLOWED`、10 条无专用机器码的权限 HTTP 403、2 条无效 Key HTTP 401**。保留 20 条的真实上游结果为 **18 条 HTTP 403 + 2 条 HTTP 401**。

沧元 2 条、辰途 6 条、FriModel 1 条的现有 Key 仍绑定旧组，账号可用清单缺席不足以证明删除。辰途“纯血ccmax”“CC-MAX-企业版-CC Test满分”仍在公共价格目录；赛博“gpt5.6-破甲版”和喵呜“vip”也仍全局可见。喵呜“OpenAI Videos”虽在当前账号组、公共价格组、Key 清单均不见，仍因没有明确删除回执而保留。权限恢复或有效同组 Key 是这些连接继续使用的外部条件，本次没有放开调用开关隐藏阻碍。

## 3 个本地废弃分组的实际删除

正常 catalogOnly 扫描会把具有本地凭据、但新目录未返回的旧组补回 stale key-groups，不能可靠标为 missing。因此没有伪造 manual/missing 状态，也没有使用缺少分组事务保护的裸 provider DELETE。

安装程序和后端正常退出、完整备份完成后，维护脚本经默认 dry-run、独立只读复审、真实备份复制数据库演练，再显式 apply。它仅针对上述 3 个固定组/连接，核对最新 DB SHA、供应商和来源、连接/config 哈希、完整组成员、直接 GROUP_DELETED 回执和业务引用；通过现有 `FileRepository.commitSupplier` 一次提交，保留仓库的并发、未完成运行、历史凭据和 director 处理逻辑。

2026-10-10 10:18:30 UTC 正式回执确认：总连接 **164 → 161**，Mikoto 目录组 **19 → 16**，该供应商 revision **173 → 174**，旧 scanId 失效。3 个候选没有当前画布、历史版本、生成运行、nodeRun、素材或 director 业务引用。历史验证账本仍有 **12 处连接引用：9 处 evidence、3 处 skipped**，全部原样保留，不能声称所有历史引用均为零。

维护脚本 **19 项**正/负检查通过，复制数据库提交后其余 **13 个集合**严格相等。正式操作仅提交本地数据库一次，不联系上游，不删上游 Key，不创建生成验证任务。独立回滚 DB 副本和完整 profile 备份均保留在本机忽略目录。

## 安装版读回与工作区修复

原安装版重启后读取全部 **161 条**连接的 cached-only 模型接口，结果为 **141 条 HTTP 200 + 20 条旧扫描器 HTTP 401**，合计 **3140 个模型引用**，未刷新上游或生成。3 个删除连接读回均为 404；真正的 `GET /api/suppliers` 另行确认 Mikoto 目录 16 组、三个旧组已消失、当前“gemini生图”仍在。供应商影响分析接口不是目录响应，未把它的空结果当作删除证据。

这里的 HTTP 200 是缓存目录成功读回，失败扫描保留的已有目录也可能返回 200；不代表其中每个型号均已通过真实生成、接口或完整报价验证。3140 是模型引用数，不能当作3140个独立型号的收费成功记录。

旧安装版将多种上游拒绝统一存为 unauthorized 并回 401；**20 个本地 HTTP 401 不代表 20 个真实无效 Key**。直接免费回执已证明其中 18 个是上游 403、2 个是上游 401。

工作区已修正扫描器和普通/刷新/cached-only 读取的诊断传递：保留真实 401/403，仅保存已核实的 GROUP_DELETED、GROUP_DISABLED、GROUP_NOT_ALLOWED 机器码，并用固定中文原因展示。未知正文、请求 ID 或凭据不保存、不回显，成功完整扫描后清除旧拒绝原因。拒绝目录仍不可调用，不借历史或手工缓存授予权限；界面同步区分权限拒绝与 Key 鉴权失败。**该修复尚未安装**，不能当作安装版已展示新诊断。

|验证层次|本次证据与结论|
|---|---|
|源码回归|renderer 全量 225 个测试文件、2682 项全部通过；workspace typecheck、lint、production build 均 exit 0。Vitest JSON 的 suite 数含嵌套 suite，不当作文件数。|
|离线删除安全性|维护脚本 19 项通过，真实备份复制 DB 和正式事务均核对范围与资料保留。|
|安装版 API|161 条 cached-only 读回、三个连接 404、真实供应商目录 16 组，均有独立回执。|
|安装版界面|原版本重启后返回原路由；保存冲突保全处理后正常刷新，显示已保存、无冲突、9 个节点、生命周期计数全 0。未安装的诊断修复不冒充已在界面生效。|
|真实收费生成|本轮 0 次，不用免费目录或模拟测试冒充。|

## 资料保护与变化边界

操作前正常保存退出并逐文件校验完整私下备份 **3262 个文件**。独立受保护文件清单前后完全一致：**1582 个文件、1,901,031,371 字节**，精确组成是 storage 1552 个文件、projects 28 个文件及 `secrets.bin`、`initialized.json` 两个文件；两份非素材文件不误算为生成素材。全部文件内容哈希相同。

正式事务及早期重启对比确认，**161 条保留连接逐条相同**；画布 4、历史版本 35、素材记录 429、运行 344、nodeRun 344、验证账本 17、director 会话 2、消息 24、提案 3 均保持内容与数量。21 家供应商保留，仅 Mikoto 这 3 个目录组被移除。

随后两家供应商账单刷新带来的差异仅为 `billing.checkedAt`、`billing.lastSuccessAt` 及相应记录 revision/updatedAt，未改变报价、余额或金额。因此不声称“其他供应商最终全记录逐字节相同”。以上画布内容不变的保护结论对应分组删除事务及早期重启采样时点；后续为保全用户新设置执行了一次正常草稿保存，不能扩展为“整个任务最终所有画布业务均未变化”。

2026-10-10 10:35:20 UTC 最终收尾复核：**158 条保留连接完整记录相同**，另外 3 条仅有安装版正常目录重建带来的诊断/时间字段变化：低价Adobe生图、喵呜 default 的已有接口缓存标记变为 stale，辰途“新渠道image2.5全参”更新检查时间；喵呜缺报价说明只更新其中时间，缺价结论不变。逐个差异路径核对确认 **161 条的凭据、分组身份、型号、接口、参数及实际报价内容均未改变**，20 条拒绝连接完整记录仍相同，没有回写旧诊断伪装成功。

同次收尾确认 1582 个受保护文件哈希仍完全相同，3 张其他画布记录完全相同，当前画布业务内容与保全草稿完全一致，9 个节点、5 条连线；429 条素材记录、344 条运行、344 条 nodeRun、17 条验证账本和 director 资料完整记录相同。正常自动保存新增 4 个画布版本，原有保留规则淘汰 4 个旧版本，版本总数仍为 35；操作前的全部版本另保留于已核验的完整备份，不能声称最终版本集合逐字节未变。

## 保存冲突已保全处理

2026-10-10 10:26:28 UTC 只读检查发现原画布有本地草稿：draft base revision **6874**，server revision **6875**。两份均为 9 个节点、标题一致，但完整图和业务图不相同。差异包含一个图片节点的新连接/型号 `gpt-image-2.5-sunburst`、`quality=max`、`size_tier=4K` 和参数记忆，不能说成仅有几何测量变化。其余 8 个节点业务相同，原 9 个节点、连线、绘画和标题没有删除。

在保护两份内容后，通过现有保存接口执行 **一次**严格版本比较的正常 PUT：expected revision **6875 → saved revision 6876**，HTTP 200；随后 GET 完整 graph 与要保全的草稿精确相同。没有手删 local draft/journal，也没有点击“放弃本地更改”。这次保存用于保全用户的新选择，是本轮分组清理之外单独记录的业务写入，没有放宽冲突保护或加入自动合并规则。

2026-10-10 10:32:16 UTC，安装版正常刷新后显示 **已保存、conflict=false、9 个节点、无应用错误，activeRuns/resumableCloudRuns/activeVerifications/activeWrites 均为 0**。刷新后的正常几何存档使 server revision 到 **6878**，完整业务 graph 与保全草稿哈希一致（`0bc0a3a2a504cdbbd524673840272eb2b80d8acebdd59dba8fd7bb1d6ee235b7`）。原路由恢复，未丢弃本地编辑，未生成、升级或推送。

根因尚未确诊：版本反馈/确认失步是可行路径，不能认定用户在另一窗口编辑，也不能把首次差异解释为仅测量变化。当前这次冲突已经无损处理，未以推测替代根因证据。

## 证据与隐私范围

以下为本机 `.codex-temp/auth-recheck-20261010/` 下的忽略目录证据，不作为公开附件：

- 免费实际回执：`root/free-auth-recheck.json`；7 账号完整性及精确匹配：`root/free-accounts-recheck.json`。
- 候选复审：`cleanup/candidate-review.json`；复制 DB 回归：`cleanup/maintenance-helper-test-2026-10-10T10-15-40-217Z.json`；正式提交：`cleanup/apply-2026-10-10T10-18-27-006Z.json`。
- 正常退出和备份：`root/catalog-drain-quit-report.json`、`root/profile-before.json`；资料保护：`root/post-restart-preservation.json`、`cleanup/protection-baseline.json`、`root/final-protection-inventory.json`、`root/final-protection-summary.json`。
- 安装版读回：`root/installed-postcheck.json`、`root/installed-postcheck-summary.json`、`root/installed-catalog-read.json`；冲突只读记录、正常保存及最终界面验收：`root/save-conflict-readonly.json`、`root/canvas-conflict-save-receipt.json`、`root/canvas-conflict-resolved.json`。
- 最终资料、目录差异与画布状态复核：`root/final-closure-checks.json`，严格逐路径检查目录重建差异，并再次核对素材哈希、凭据、实际报价、业务图和当前“已保存/无冲突”状态。
- 源码诊断和回归：`source/diagnostic-fix-summary.json`、`recovery/ui-status-unit.json`、`root/renderer-full-tests.json`、`root/validation.json`、`root/validation-checks.json` 及对应日志。

本文仅记录供应商/组、非凭据记录 ID、连接 ID、端点与结论。不写明文 Key、token、Cookie、账号口令、用户提示词、签名素材 URL、真实画布 ID 或本地用户 profile 路径；原始 profile、复制 DB 和恢复备份只留本机私有忽略目录。
