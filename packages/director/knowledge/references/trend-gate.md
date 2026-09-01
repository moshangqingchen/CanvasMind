# 实时短视频趋势门禁

## 目录

- 适用范围
- 新鲜度
- 平台与证据等级
- 创作参考来源资格
- 研究流程
- 重要打斗双轨视觉研究
- 台词关键场次双源研究
- 创意转译
- 输出格式
- 受阻降级

## 适用范围

所有剧情创意、短片、短剧、广告、二创、台词、前三秒、标题封面、平台发布方案在定案前必须经过本门禁。纯执行型任务（例如用户已经锁定脚本，只要求修一个时间码）可以不重新研究，但不得声称使用了最新趋势。

## 新鲜度

- 用户明确说“最新、今天、最近、爆火、热榜”：热榜证据尽量在 6 小时内，最长不得超过 24 小时。
- 普通创意任务：至少核验当前日期的公开榜单或推荐入口；同一会话内可复用已核验结果。
- 仓库中的 `latest-platform-snapshot.md` 只是冷启动参考，并服从文件内分项 TTL：热榜 6 小时、挑战/短剧榜 24 小时、实际样本观察 72 小时。相应部分过期后只能作为历史灵感，不能当作当前热度证据。

## 平台与证据等级

平台池不是白名单。按题材、目标受众、地区、内容形态、传播目标和可取得的证据质量动态组成本轮样本池；抖音、快手、B站是常用入口，但不享有固定优先级，也不构成研究边界。可选平台包括但不限于小红书、视频号、TikTok、YouTube 与 YouTube Shorts、Instagram Reels，以及当时对该题材真正活跃的其他视频社区、创作者平台或公开榜单。

- 普通创意任务优先覆盖 3 个或以上彼此有区分度的平台生态；题材或地区高度垂直时，可减少数量，但要说明选择依据。
- 至少包含目标受众主要使用的平台；跨地区创意尽量同时观察中文与国际平台，长视频、横屏或深度叙事可直接采用 YouTube、B站等非纯短视频样本。
- 平台热度、样本相关性和 A/B 级证据质量高于机械凑齐固定平台。不得因为某平台未写在示例清单中而忽略高质量或高热度样本。
- 登录、验证码、风控或地区限制时正常降级，不绕过；受阻后可以切换到更相关且公开可核验的平台，而不是反复困在固定三平台。

## 创作参考来源资格

```text
reference.creative-source.origin-verified=required
reference.creative-source.ai-generated=forbidden
reference.generation-benchmark.separate=required
reference.search.task-conditioned=required
reference.search.user-specified-ip-keywords=required
reference.search.excellent-anime-pool=allowed
reference.search.named-ip.nonexclusive-default=required
reference.search.exclusive-scope.requires-explicit-intent=required
```

- 本门禁中的“短视频”只表示分发形态。用于学习剧情、结构、镜头、动作、表演、台词、声音或观众参与的创作参考，必须能追溯到电影、电视剧、正式动漫/剧本，或真人主导拍摄、表演、动作编排、绘制/动画与剪辑的短视频。
- 传统二维/三维动画、CGI 和数字视效不因使用计算机制作而自动归为生成式 AI。判断对象是本次 `observed_scope` 中要学习的具体表达是否主要由生成式模型产出。
- AI 生成、文生视频、生成式混合内容中无法隔离的生成片段，以及制作来源无法确认的样本，不得提供 `verified_mechanism`、不得设置 `eligible_for_finalization=true`，也不得进入 `referenceSet` / `fightReferenceSet`。实际观看只会提高证据等级，不会把不合格来源变成创作参考。
- 这些素材如确有工程价值，只能进入独立 `generationBenchmarkSet`，记录模型能力、物理/连续性故障、提示词响应与修复结果；禁止从中学习剧情、镜头、动作、表演、台词或声音创意。
- 每条样本记录 `observed_range_creation_mode=human-directed|ai-generated|origin-unverified` 与非空 `origin_evidence`。只有 `human-directed` 可参与创意定案；`ai-generated|origin-unverified` 必须保持不可定案，并说明来源核验结果。
- 创作参考检索必须随任务变化。未指定作品时，可以使用“高燃动漫打斗、动漫战斗作画、电影动作场面、真人动作/武术短片、剧情短片/短剧关键场次”等宽词，任何优秀动漫均可按镜头功能入池；指定作品/IP/角色/招式/战役时，保留用户给出的专名并组合“对手、具体战役、官方片段、作画、分镜、运镜、剧情场次”等词理解任务语境，同时允许跨作品寻找更强的镜头动作样本。只有用户明确要求只参考某作品时才排他收窄。不得把“AI 打斗、AI 动画、AI 生成动作、文生视频、模型名 + 高燃”作为创作参考查询。平台不支持排除词时，人工剔除 `AI生成|AIGC|文生视频|Seedance|Sora|Veo|Kling|Runway` 等生成展示，并继续核对原作、制作信息或创作者声明。

证据等级：

- `A`：实际播放并观看视频，记录递增的具体观看范围以及画面/音频核验状态，且至少一项为 `yes` 或 `partial`；只可拆已观察范围内的画面、动作、运镜、转场、声音、表演与评论互动。要把口语、措辞、语气或对白节奏记为 `dialogue` 机制时，`audio` 必须为 `yes|partial`；纯画面观看不能声称核验了台词。
- `B`：取得可靠字幕、逐字稿或官方脚本；可拆文稿覆盖的结构和台词，不得把未观看的运镜、构图、表演、动作、声音或音乐写成已核验机制。
- `C`：只有标题、封面、榜单名次、简介或搜索摘要；只能判断题材与包装，必须标注“未核验”。
- `D`：二手转述且无法定位原始来源；不得作为创意定案依据。

## 结构化证据类型门禁

```text
verified_mechanism.entry={type,evidence_basis,description}
observed_signals.entry={type,evidence_basis,description}
evidence.description.authority=display-only
evidence.A.audio-claims.require=audio:yes|partial
evidence.A.dialogue-claims.require=audio:yes|partial
evidence.A.visual-claims.require=visual:yes|partial
evidence.B.mechanism-types=structure|dialogue
evidence.C.finalization=false
evidence.D.finalization=false
evidence.A.reuse-boundary=watched-scope-only
evidence.B.reuse-boundary=transcript-structure-dialogue-only
evidence.C.reuse-boundary=metadata-topic-packaging-only
evidence.D.reuse-boundary=secondary-report-not-for-finalization
evidence.creative-source.require=observed_range_creation_mode:human-directed
evidence.ai-generated.finalization=false
evidence.unknown-origin.finalization=false
```

- `verified_mechanism` 必须是对象数组；每项只能有非空字符串 `type`、`evidence_basis` 与 `description`，不接受字符串简写或附加放行字段。`type` 枚举为 `structure|dialogue|visual|action|camera|transition|performance|sound|music|audience-interaction`。
- `evidence_basis` 是机器执行的证据边界，不是自由文本。A 级视听项使用 `watched-visual|watched-audio|watched-visual-audio`，互动项还可使用 `watched-interaction`；B 级严格使用与类型对应的 `transcript-structure|transcript-dialogue`；C 级严格使用与类型对应的 `metadata-topic|metadata-packaging|metadata-rank|metadata-title|metadata-cover`；D 级只能使用 `secondary-report`。
- `description` 仅供人阅读，不产生超出 `type × evidence_basis × evidence_level` 的任何权限。校验器还会把描述中的跨模态或跨等级断言作为防御性错误拦截，但自由文本关键词不是主门禁。
- A 级至少包含一项 `verified_mechanism`，并且只能在实际观看范围和已核验模态内填写：`visual=no|unknown` 时禁止 `visual|action|camera|transition|performance`，`audio=no|unknown` 时禁止 `dialogue|sound|music`；A 级 `dialogue` 只能使用 `watched-audio|watched-visual-audio`，不能用 `watched-visual` 冒充；只有对应模态为 `yes|partial` 才放行，包括藏在描述里的断言。
- B 级的 `verified_mechanism` 与 `observed_signals` 都只允许 `structure|dialogue` 及其对应 transcript basis，不得用合法类型配合描述文本冒充已观看画面、动作、表演或声音。
- `observed_signals` 出现时同样必须是 `{type,evidence_basis,description}` 对象数组。C 级只允许 `topic|packaging|rank|title|cover` 及对应 metadata basis；D 级只允许 `secondary-claim + secondary-report`。C/D 的 `verified_mechanism` 必须为空数组，描述不得包装视听、表演、台词或叙事结论。
- 每条证据必须显式提供 JSON 布尔值 `eligible_for_finalization`。C/D 必须为 `false`；A/B 的 `true` 只表示可在该证据等级允许的范围内参与创意判断，不代表权利已经放行。
- `reuse_boundary` 是必填且按等级固定的精确枚举：A=`watched-scope-only`，B=`transcript-structure-dialogue-only`，C=`metadata-topic-packaging-only`，D=`secondary-report-not-for-finalization`；不得用自由文本反向宣称 C/D 可定案。
- 所有标量字段必须使用约定的 JSON 原生类型，枚举大小写必须完全一致。字符串按 NFKC 归一化并移除 Unicode `Cf/Cc` 格式与控制字符后仍须非空，禁止用零宽字符伪造有效值。

## 研究流程

1. 先核对所观察范围的制作来源，记录 `observed_range_creation_mode`、`origin_evidence`、`captured_at`、平台、榜单/搜索入口和 URL；来源不合格时从创作参考池移出。
2. 先读平台级信号：高频题材、第一帧、叙事机制、声音玩法、评论参与方式和同质化程度。
3. 每个平台尽量选 1-3 个与用户题材相关的具体样本；A 级只拆已观看范围的视听执行，B 级只拆可靠文稿覆盖的结构与台词。
   - 创意定案前尽量取得至少 1 条题材或品类相邻的 A/B 级样本。
   - 若只能取得跨品类 A/B 样本，或相关样本仅为 C 级，明确标注“只使用平台级机制，不代表该品类趋势”，并降低结论置信度。
4. 对每个样本提取：
   - 人物处境与人性观察
   - 前三秒问题或反常结果
   - 信息债与揭示顺序
   - 视觉/动作/声音机制
   - 观众参与和评论接话口
   - 已饱和元素及避开方法
5. 从跨平台交集判断“当前观众正在响应什么”，再从平台差异寻找陌生化机会。
6. 先确定 `reference_use_mode`：`publishable-translation` 才执行原创转译；`internal-study` 与 `licensed-recreation` 按其忠实度推进，不得被趋势门禁偷偷原创化。

## 重要打斗双轨视觉研究

```text
fight.reference.dual-visual-track=required
```

完整打斗场面在镜头与视频提示词定稿前，必须组成两条彼此独立且实际观看的视觉参考轨：

- `current-short-form`：一条与题材、受众或动作机制相邻，且已核验为真人主导原创或可追溯至动漫/电影原作的当前优质/高热度短视频，用于学习进入速度、动作密度、观看距离、切点和当下观众参与方式。
- `long-form-visual`：一段相关动漫或电影动作片段，用于学习空间建立、攻防推进、景别/视点递进、摄影机与主体关系、冲击结果和长线战术变化。

两轨都只能使用 `observedRangeCreationMode=human-directed`、非空 `originEvidence`、`evidenceLevel=A`、`visual=yes|partial` 且 `observedScope` 明确覆盖实际观看范围的视觉证据；AI 生成/来源不明片段，以及 B 级字幕、脚本或逐字稿，均不能支持动作、构图、运镜、剪辑或表演判断。若要学习打击音、音乐或声音桥，所用轨还必须记录 `audio=yes|partial`。

`fightReferenceSet` 的每条记录至少保留 `sourceId`、`lane`、`medium`、`sourceLocator`、`observedRangeCreationMode`、`originEvidence`、`evidenceLevel`、`visual`、`observedScope`、空间/攻防/景别/摄影机/剪辑机制、`doNotCopy[]`、`referenceUseMode`、`authorizationStatus` 与 `reuseBoundary`。当前短视频另记 `publishedAt`、`capturedAt`、`selectionBasis=viral|quality`、`currentRelevanceEvidence`，并按选择依据填写 `rankOrHeat` 或 `qualityRationale`。两轨不得使用同一规范化来源冒充不同证据。

参考只提供可迁移机制，不提供默认复制许可：`publishable-translation` 必须重建独特镜头排列、标志性招式、角色、声音和可识别表达；`internal-study` 保持 `release_hold=true`；`licensed-recreation` 只在 R0 覆盖范围内高还原。缺少任一轨时只能交付 `researchStatus=blocked-provisional`，并同时设置 `finalizationHold=true`、`releaseHold=true`，明确缺失轨与阻挡证据。

## 台词关键场次双源研究

自然台词不能只从热榜标题推断，也不能只模仿一部熟悉作品。开场交锋、关系转向、揭示/反转、情绪破裂/和解、高潮决断、广告人物确认与传播记忆句，在定稿前必须组成两条独立参考轨：

- `long-form`：相关动漫、电影、电视剧、正式剧本或可靠字幕的 A/B 级来源，负责人物长线声音、关系压力、信息释放与潜台词；
- `short-video`：当前相关优质或高热度短视频的 A/B 级来源，负责当下口语密度、进入速度、停留点与评论接话方式。

短视频台词/剧情参考同样必须是可追溯至动漫、电影、电视剧或真人主导创作的场次；AI 生成短剧、AI 对白展示和来源不明片段不计入任一参考轨。A/B 只描述观看或文稿证据质量，不绕过来源资格。

两条轨都必须与本场的题材、关系、压力或受众至少一项高度相关，并分别记录 `learned_mechanisms` 与 `do_not_copy`。长篇来源不靠“经典”标签放行，短视频来源不靠平台名或播放量截图放行；具体台词机制都需要 A/B 级文本依据。

缺少任一轨时可以写受阻暂定稿，但必须标记 `researchStatus=blocked-provisional`、`finalizationHold=true`、`releaseHold=true` 和缺失原因；不得称为定稿、爆款写法、双源学习结果或可发布稿。锁定台词后的纯口型、字幕格式、时间码执行可标 `not-required-execution-only`，不重新研究也不虚构研究。

## 创意转译

趋势只提供刺激，不成为未授权公开复制模板。公开用途缺少 R0 时使用 `publishable-translation`，不得只换人物、道具、场景或脸来复刻热门视频。

`publishable-translation` 每个方案至少改变以下三项中的两项；该最低改动量不约束 `internal-study` 和许可范围内的 `licensed-recreation`：

- 人物关系或外在任务
- 叙事机制或揭示顺序
- 视觉语法、空间机关、声音落点或观众参与方式

`publishable-translation` 保留的是“为什么观众会停下和接话”，不是原视频的独特表达、台词、角色、音乐、Logo或镜头排列。内部高保真研究仍须保留 `release_hold=true`，授权复刻仍须服从许可范围。

## 输出格式

一般创意先给一个不超过 8 行的趋势简报。剧情/台词交付例外：先给剧情与台词，末尾只附 2-4 行参考短注，说明长篇源学到的机制、短视频源学到的机制、没有照搬的表达和必要发布限制；只有用户要求研究报告时才展开完整趋势简报与证据卡。

```text
趋势核验：YYYY-MM-DD HH:mm +08:00
trend_basis：current-turn / snapshot-not-watched-this-turn / metadata-only
平台：本轮动态样本池（列出实际核验的平台与选择依据）
已观看：A 级 N 条；文稿：B 级 N 条；仅元数据：C 级 N 条
当前有效刺激：...
已饱和、避免照搬：...
本次原创转译：...
```

需要保存结构化证据时使用：

```json
{
  "platform": "douyin",
  "source_url": "https://...",
  "captured_at": "2026-08-07T12:00:00+08:00",
  "published_at": "unknown-or-ISO-8601",
  "rank_or_heat": "visible-value-and-metric-scope|unknown|not-visible",
  "evidence_level": "A",
  "observation_context": "current-turn|project-snapshot|user-provided",
  "replayed_current_turn": true,
  "eligible_for_finalization": true,
  "observed_range_creation_mode": "human-directed",
  "origin_evidence": "可核对的原作、官方片段、制作信息或创作者声明",
  "transcript_provenance": "watched|official-transcript|reliable-transcript|metadata-only|secondary-report|unlocated-secondary-report",
  "observed_scope": "00:00-00:20; visual=yes; audio=no",
  "observed_signals": [
    { "type": "visual", "evidence_basis": "watched-visual", "description": "画面内倒计时进入人物任务" }
  ],
  "verified_mechanism": [
    { "type": "action", "evidence_basis": "watched-visual", "description": "量化任务在首个动作中建立" }
  ],
  "saturation_risk": "low|medium|high",
  "freshness_risk": "...",
  "rights_risk": "...",
  "reuse_boundary": "watched-scope-only"
}
```

`platform`、`source_url`、`captured_at`、`rank_or_heat`、`published_at`、等级、上下文、来源、`observed_range_creation_mode`、`origin_evidence` 和风险字段必须是语义非空的 JSON 字符串。`current-turn` 必须与布尔值 `replayed_current_turn=true` 同时出现；其他上下文不得冒充本轮回放。A/B 级若要参与创意定案，必须使用 `observed_range_creation_mode=human-directed`；`ai-generated|origin-unverified` 必须设置 `eligible_for_finalization=false` 且 `verified_mechanism=[]`。A 级 `observed_scope` 必须写递增时间范围、`visual` 与 `audio` 状态且至少一项为 `yes|partial`；B 级不得写 `visual=` 或 `audio=`。

可运行 `.agents/skills/ai-super-director/scripts/validate-trend-evidence.ps1` 验证字段、证据等级语义和新鲜度。

## 受阻降级

平台无法访问时：

1. 记录阻挡类型和时间。
2. 尝试平台官方榜单、公开搜索页或可信的原始链接，不绕过登录和风控。
3. 只有标题/元数据时降为 C 级，不拆运镜、声音和表演。
4. 本轮所选平台池都无法取得 A/B 级样本时，明确写“实时样本未核验”，用其他相关平台的公开元数据做低置信度刺激，并避免声称某机制正在爆火。
5. 项目快照里的历史 A/B 级证据可以在 TTL 内复用，但必须标为 `project-snapshot`；没有本轮重新播放就不得写“本轮已观看”。动态榜单页面只有外壳且没有内容时，不计作 C 级具体样本。
