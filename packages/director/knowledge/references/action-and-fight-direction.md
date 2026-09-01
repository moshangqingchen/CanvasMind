# 动作与打斗序列导演

## 目录

- 目的与适用范围
- 定稿前双轨视觉研究
- 有效节拍与时长
- 多镜头默认与动态长镜例外
- 对轰必须演化
- 结构化时间轴接口
- 完成前审片

## 目的

打斗不是“一镜对轰直到时长结束”，也不是靠无目的绕圈、爆光和运动模糊制造热闹。本流程先锁空间、双方目标、压力方向与动作因果，再用持续改变战局的有效节拍和有职责的摄影机，把 15 秒、30 秒及更长打斗组织成可读、精彩且可生成的完整序列。

```text
fight.reference.origin-verified-human-directed=required
fight.reference.ai-generated=forbidden
reference.search.task-conditioned=required
reference.search.user-specified-ip-keywords=required
reference.search.excellent-anime-pool=allowed
reference.search.named-ip.nonexclusive-default=required
reference.search.exclusive-scope.requires-explicit-intent=required
fight.reference.dual-visual-track=required
fight.effective-beat-density=5s
fight.single-shot-static-clash=forbidden
fight.multi-shot.default=required
fight.dynamic-long-take.requires-internal-beats=required
power-clash.must-evolve=required
```

## 什么时候必须进入本流程

用户提出打斗、战斗、决斗、动作戏、追逐交锋、招式、技能、必杀技、能量对撞/对轰，或要求把相关镜头变精彩、变活、看清动作时，必须读取本 reference。剧情中完整发生一轮攻防并交付分镜、故事板、视频提示词、时间轴或审片意见时，使用 `fightScope=complete-sequence` 并执行全部规则。

用户明确只要一个短促命中、单次招式特写、结果插镜或已锁定长序列中的一个执行镜时，可使用 `fightScope=isolated-beat`；它仍须有起势/触发、接触和结果，但不强制完整序列的镜头数与双轨研究。不得把实际包含多轮攻防、主导权转移或完整胜负的场面标成 `isolated-beat` 绕过校验。对白镜头、非战斗动作和仅提到“战斗”的说明文本不自动成为打斗序列。

旧能力卡中的“4-15 秒单镜”“一镜只留一个主任务”只适用于单个独立生成片段的控制预算，不代表完整打斗只能有一个镜头或一个动作。完整打斗先按本页建立整段累计时间轴，再按动作匹配点拆成可生成片段；拆分不能删除战斗节拍、规模、速度、力量或结果。

## 定稿前双轨视觉研究

每个 `complete-sequence` 默认都视为重要打斗，在定稿前建立 `fightReferenceSet`，至少包含两条职责不同的 A 级视觉证据；只有本页定义的 `isolated-beat` 不进入完整序列研究门禁：

1. `lane=current-short-form`：一条当前相关、优质或高热度短视频，用于学习进入速度、当前观看节奏、视觉信息密度和评论可复述机制。
2. `lane=long-form-visual`：一段相关动漫或电影动作片段，用于学习空间建立、攻防递进、主导权转移、景别组织、摄影机职责和剪辑因果。

`current-short-form` 中的“短视频”是发布渠道，不是制作来源。合格样本只能是：可追溯到动漫/电影原作的片段，或真人主导拍摄、表演、动作设计、传统/手工动画与剪辑的原创动作/剧情短视频。`long-form-visual` 只能是可追溯的正式动漫或电影片段。传统二维/三维动画、CGI 和数字视效不自动等于生成式 AI；判断的是本次要学习的具体剧情、画面、动作、表演、摄影机或剪辑是否主要由生成式模型产出。

AI 生成打斗、文生视频动作样本、以模型名为卖点的生成展示、来源不明混剪，以及无法确认所观察范围制作来源的片段，一律不能计入任一视觉轨。即使已经实际播放观看，也不得因 `evidenceLevel=A` 获得创作参考资格。它们只能放入独立 `generationBenchmarkSet`，用于记录生成模型的连续性、物理、动作可读性和故障修复，不得提炼为剧情、镜头、动作或表演范本。

未指定作品/IP 时，允许并推荐用“高燃动漫打斗、动漫战斗作画、电影高燃动作场面、真人动作短片、武术短片、动作短剧高燃片段”等宽词建立候选池，再按近身格斗、追逐、群战、兵器、能量对撞或所需摄影机机制收窄。所有来源合格、实际观看且镜头功能匹配的优秀动漫都可进入参考池，不设作品白名单。

当任务出现作品/IP、角色、招式、战役或名场面专名时，安排语境查询保留这些专名，并组合“对手、具体战役、战斗片段、官方片段、作画、分镜、运镜、剪辑”等词来理解任务语境；例如《火影忍者》任务可以检索“火影忍者 高燃打斗”或“角色名 + 对手/招式/战役 + 战斗片段/分镜/运镜”。与此同时，仍可按具体镜头职责跨作品检索任何优秀动漫：近身攻防可借一个样本，追逐换位可借另一个，群战空间、兵器接触、能量对撞、冲击承受和剪辑节奏也可分别选择最强样本。具体 IP 默认不是排他白名单；只有用户明确说“只参考这部、不要其他作品”时，才把 `referenceSearchPlan.exclusiveScope=true` 并收窄候选池。

创作参考检索不得以“AI 打斗 / AI 动画 / AI 生成动作 / 文生视频打斗 / 模型名 + 高燃动作”为正向查询，并在平台不支持排除词时人工剔除 `AI生成|AIGC|文生视频|Seedance|Sora|Veo|Kling|Runway` 等生成展示结果。注意：“高燃动漫打斗”与“AI 动画打斗”不是同一类查询，前者合法且推荐，后者属于生成样本检索。标题未标 AI 也不等于通过，仍须查看原作、账号说明、片尾/制作信息或创作者声明。

实际观看后优先拆镜头与动作：空间和轴线如何建立，进攻怎样逼出应对，起势—轨迹—接触—受力结果如何读清，摄影机何时追、躲、抢位、承受或停稳，景别如何递进，切点如何由动作/视线/声音/结果触发，主体动作、摄影机和播放倍率如何分工。`internal-study` 可按用户要求高保真学习具体镜头动作并保持 `releaseHold=true`；`licensed-recreation` 按许可；`publishable-translation` 可模仿这些机制，但必须重建标志性招式、独特镜头排列和角色识别。

检索前建立轻量 `referenceSearchPlan`，不要求向用户展示，但必须实际影响查询：

```yaml
referenceSearchPlan:
  userSpecifiedAnchors: [用户原话中的作品/IP、角色、对手、招式、战役或名场面；未指定时为空]
  exclusiveScope: false  # 只有用户明确要求只参考指定作品时才设 true
  positiveQueries:
    - 未指定示例: 高燃动漫打斗 分镜 运镜 战斗作画
    - 语境查询示例: 火影忍者 + 用户指定角色/对手/招式/战役 + 战斗片段 分镜 运镜 作画
    - 功能补充示例: 优秀动漫 + 近身格斗/追逐/群战/兵器/能量对撞 + 分镜 运镜 作画
  negativeFilters: [AI生成, AIGC, 文生视频, Seedance, Sora, Veo, Kling, Runway]
  learningTargets: [空间调度, 攻防因果, 动作阶段, 摄影机位置与运动, 景别递进, 动作触发切点, 速度阶段]
```

`userSpecifiedAnchors` 非空时，至少安排一组语境查询保留作品/IP 专名和本轮相关的角色、招式或战役锚点；其余查询可按镜头功能跨作品寻找更优样本。具体 IP 不强制占据打斗双轨中的某一条，也不阻止别的优秀动漫成为主要镜头动作参考；只有 `exclusiveScope=true` 才限制作品范围。搜索结果若只是盘点、解说或混剪，继续定位其原作片段；只有实际观看的原作/官方片段范围才能支撑具体镜头动作判断。

两轨都必须实际观看，`evidenceLevel=A` 且 `visual=yes|partial`。`partial` 只允许拆 `observedScope` 明确覆盖的范围；只读字幕、剧情梗概、分镜转述或搜索摘要均不能推断具体动作、运镜、景别、剪辑或表演，B/C/D 级不得替代视觉轨。遇到登录、地区、验证码或访问限制时不绕过、不虚构，改找合法可访问的官方片段或同功能替代样本。

每条参考使用以下 canonical 字段：

```yaml
sourceId: 稳定来源标识
lane: current-short-form|long-form-visual
medium: short-video|anime|film
title: 来源标题或可核对片段名
platform: 发布平台、片源平台或本地素材库
sourceLocator: 可追溯 URL 或本地来源位置
evidenceLevel: A
visual: yes|partial
observedScope: 实际观看的递增时间范围
observedRangeCreationMode: human-directed
originEvidence: 原作/官方片段、制作信息、创作者声明或可核对来源链；不得只写“看起来不像 AI”
publishedAt: 当前短视频必填的带时区发布时间
capturedAt: 当前短视频必填的带时区采集时间；长篇轨可选
selectionBasis: 当前短视频使用 viral|quality
currentRelevanceEvidence: 当前热度、活跃讨论或当下工艺相关性的证据
rankOrHeat: viral 样本必填的排名或热度证据
qualityRationale: quality 样本必填的动作与视听完成度理由
spatialMechanism: 如何建立距离、轴线、危险方向和出入口
attackDefenseMechanism: 进攻如何迫使应对，应对如何改变下一步
shotScaleMechanism: 景别如何服务信息与受力可读性
cameraMechanism: 摄影机为何追、躲、抢位、承受或停稳
editingMechanism: 剪辑点如何由动作、视线、声音或结果触发
doNotCopy: [不复制的独特镜头排列、招式、构图、声音或角色识别]
referenceUseMode: internal-study|licensed-recreation|publishable-translation
authorizationStatus: R0-owned-or-licensed|R1-user-asserted|R2-unknown|R3-restricted
reuseBoundary: internal-study-high-fidelity-release-held|licensed-recreation-within-permission-scope|publishable-mechanism-only-expression-rebuilt
```

`observedRangeCreationMode` 的 canonical 枚举为 `human-directed|ai-generated|origin-unverified`，但只有 `human-directed` 能进入 `fightReferenceSet` 并计入双轨。`ai-generated|origin-unverified` 必须移出创作参考；若因此缺轨，按下方受阻规则处理。当前短视频必须用可核验的当前相关性，而不是把今天重新打开旧链接当成热点；`selectionBasis=viral` 时填写 `rankOrHeat`，`selectionBasis=quality` 时填写 `qualityRationale`。参考只转译空间、动作因果、镜头职责、节奏和声音机制。`publishable-translation` 必须重建标志性招式、独特镜头排列、声音和角色识别；`internal-study` 保持 `releaseHold=true`；`licensed-recreation` 仅限 `authorizationStatus=R0-owned-or-licensed` 且服从已核验许可范围。`reuseBoundary` 必须与 `referenceUseMode` 对应，R1 只能内部推进并等待证明，R3 停止使用。视觉研究不等于发布授权。

任一视觉轨缺失或字段不足时：

```yaml
researchStatus: blocked-provisional
finalizationHold: true
releaseHold: true
researchBlocker: 缺失的轨道与原因
blockerEvidence: 已尝试访问、替代检索或限制证据
```

此时只交付暂定结构，不得称为双轨学习定稿、趋势定稿或可发布稿。两轨完整时使用 `researchStatus=complete`；权利未清场仍须独立保持 `releaseHold=true`。

## 有效节拍与时长

完整打斗的有效节拍下限统一按总时长计算：

```text
requiredBeats = max(3, ceil(totalDuration / 5s))
maximumStateChangeGap = 6s
requiredDominanceChanges = max(1, floor(requiredBeats / 3))
minimumMultiShotCount = max(2, ceil(requiredBeats / 2))
```

- 15 秒至少 3 个有效节拍，30 秒至少 6 个；更长时长继续按公式增加，不能把 30 秒写成拉长版 15 秒。
- 每个节拍必须真实改变 `offense|defense|space|dominance|objective|injury|resource|ability-rule` 中至少一项。换景别、换角度、提高粒子亮度、慢动作、重复同一招、继续奔跑或继续对轰本身都不是状态变化。
- 全序列必须同时包含 `phase=attack|response|result`。应对不是空反应，而是格挡、闪避、借力、抢位、诱导、牺牲资源或改变规则，并直接迫使下一步变化；结果必须留下位置、伤势、资源、目标或战术后果。
- 节拍的真实状态变化发生在 `combatBeat.end`。按结束时间排序后，首个 `end` 距 0 秒、相邻 `end` 之差、以及最后一个 `end` 距 `totalDuration` 均不得超过 6 秒。
- `dominanceBefore != dominanceAfter` 且 `stateChanges` 包含 `dominance` 才算一次主导权变化；数量至少为上述公式。相邻节拍的 `dominanceBefore` 必须接续前一拍的 `dominanceAfter`，禁止无因跳转。

先锁空间基准、双方外在目标、可用资源、压力方向、失败代价和初始主导权，再排节拍。每拍至少回答：谁想完成什么，对方如何迫使他改招，摄影机为何在这里，状态具体变成什么。

## 多镜头默认与动态长镜例外

`sequenceMode=multi-shot` 是完整打斗默认。镜头数不得低于 `minimumMultiShotCount`，每镜用 `fightShotRole` 声明主要职责：

```text
space-establish
pursuit-evasion
contact-clarity
impact-reception
reversal-reveal
result-reframe
```

多镜头至少使用两种不同职责。每镜以 `combatBeatIds[]` 关联实际节拍，并写动作、视线、声音、道具或空间衔接；同一职责可以在更长战斗中再次使用，但重复镜头不增加有效节拍，也不能用连续同角度攻击补足镜头数。摄影机必须由空间危险、主体动作、受力、信息揭示或视线触发，有起步、修正和停稳。

`sequenceMode=dynamic-long-take` 只允许在长镜内部仍满足相同节拍、攻防、主导权和结果要求时使用。每个 `combatBeat` 额外必填：

```yaml
trigger: 哪个动作、危险或信息变化触发摄影机移动
cameraTransition: 摄影机如何改变位置、朝向、高度或与主体的速度关系
visualAnchor: 转位期间观众靠什么读清主体、轴线和接触
settlePoint: 本拍结果在哪个构图与动作状态上停稳
```

持续环绕、无目的漂移、固定机位观察、全程同速跟随或装饰性推拉不构成长镜资格。长镜不是减少变化，而是把剪辑职责转为镜内转位、遮挡揭示、主体换位和声音接力。

## 对轰必须演化

能量束、火力、兵器或力量对撞只能是战斗中的一个阶段，不能覆盖全部 `combatBeats`。出现对轰语义时建立 `powerClash`：

```yaml
powerClash:
  clashBeatIds: [只属于对轰阶段的节拍 id；不得覆盖全部 combatBeats]
  initialBalance: 双方力量、位置与初始压力线
  pressureShifts:
    - at: 转移发生时间
      advantagedSide: 此刻取得优势的一方
      cause: 战术、资源、位置或能力规则原因
      visibleResult: 压力线、身体、环境或构图发生的可见变化
  tacticalInterventionOrAbilityChange: 战术介入或能力变招
  breakCondition: 什么具体条件打破对峙
  environmentalForceResponse: 力量如何传入地面、空气、建筑、道具或群体
  finalOutcome: 对人物任务、位置、伤势、资源或下一动作的结果
```

`pressureShifts` 至少两次，且优势方、原因或可见结果必须实际变化；只把同一次爆光写成“更亮、再亮、最亮”失败。至少一个有效节拍位于 `clashBeatIds` 之外。固定机位两边持续输出、装饰性环绕、反复切脸、粒子加码后爆炸收尾，均不能通过。

## 结构化时间轴接口

打斗根对象在现有 `totalDuration` 与 `shots[]` 之外使用：

```yaml
sequenceType: fight
fightScope: complete-sequence|isolated-beat
sequenceMode: multi-shot|dynamic-long-take
researchStatus: complete|blocked-provisional
finalizationHold: true|false
releaseHold: true|false
fightReferenceSet: []
combatBeats:
  - id: beat-01
    start: 0
    end: 4.5
    phase: attack|response|result
    objective: 本拍当前目的
    opponentResponse: 对手采取的具体应对
    cameraPlan: 摄影机起点、路线、速度关系与落点
    cameraPurpose: 该摄影机选择让观众读到什么
    phaseResult: 本拍结束时可核对的结果
    dominanceBefore: 本拍开始的主导方或平衡状态
    dominanceAfter: 本拍结束的主导方或平衡状态
    stateChanges: [offense|defense|space|dominance|objective|injury|resource|ability-rule]
    trigger: dynamic-long-take 时必填
    cameraTransition: dynamic-long-take 时必填
    visualAnchor: dynamic-long-take 时必填
    settlePoint: dynamic-long-take 时必填
shots:
  - id: shot-01
    start: 0
    end: 4.5
    kind: action
    storyFunctionType: action
    storyFunction: 本镜如何推进战局
    fightShotRole: contact-clarity
    combatBeatIds: [beat-01]
```

所有时间使用现有时间轴的原生数字或时间码规则。`combatBeats` 按时间递增、落在 `0..totalDuration` 内，`stateChanges` 至少一项且与 `phaseResult` 一致。30 秒直生提示词可以作为一条完整提示词交付，但其内部仍须写累计时间码、多镜头和多节拍；若当前模型需要拆段，每个生成片段从本地 0 秒开始，累计时间另列，并只在动作、视线、声音、道具或空间匹配点拆分。

明显包含完整打斗语义的时间轴不得省略 `sequenceType=fight`。交付仓库内 JSON 台账时运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-storyboard-timeline.ps1 -InputPath <timeline.json>
```

校验失败不得声称完成、定稿或可发布。机器通过只证明字段与基础节拍约束自洽，不证明来源观看真实、动作最终精彩、许可有效或成片物理可信；仍须导演逐拍审读、预演/试生成、实际观看复核和权利清场。

## 完成前审片

- 最强点是否来自战术、空间、人物选择或动作结果，而非只靠特效亮度；
- 最弱的一拍删除后是否无损，若无损就删除或重编；
- 每次进攻是否迫使具体应对，应对是否改变下一步，结果是否继承到相邻镜；
- 观众是否能读到预备、轨迹、接触、受力和战术后果，极速是否仍非瞬移；
- 摄影机是否在追、躲、抢位、承受或揭示，而不是呆站、漂移或环绕；
- 对轰是否只是演化中的一段，并具有两次压力转移、破局和最终后果；
- 15 秒、30 秒及更长时长是否都按公式达到有效变化，不靠停顿、慢动作、重复攻击或爆光凑时长；
- 双轨视觉参考是否均为 `observedRangeCreationMode=human-directed` 且有可核对 `originEvidence`，没有混入 AI 生成/来源不明片段；使用模式、`doNotCopy`、定稿锁和发布锁是否与实际证据一致。
