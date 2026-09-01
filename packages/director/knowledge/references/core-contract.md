# 核心执行契约

## 目录

- 规则优先级
- 画幅与场景条件
- 创作参考来源资格
- 自然台词与场次依据
- 全有效时间轴
- 打斗序列与镜头活性
- 反应与停顿
- 速度与时间倍率
- 创意规格与可生成性
- 直生提示词交付
- 文字与二维码
- 真实性和连续性

## 规则优先级

```text
verified-rights-and-safety > current-user-intent > verified-product-delivery-facts > core-contract > capability-routing > task-reference > legacy-reference
```

旧能力卡没有隐式豁免权。发生冲突时保留旧卡的类型知识，删除其过时执行默认值。

## 画幅与场景条件

```text
aspect.default=16:9
aspect.vertical.requires-explicit-intent=required
weather.precipitation.requires-motivation=required
cinematic-look.does-not-imply-rain-neon-wet-ground=required
face-change.does-not-equal-rights-clearance=required
```

- 用户明确给出的画幅优先；未给画幅时，无论称为电影、电视剧、动漫、短片、短剧、广告、平台视频、热点二创或镜头复刻，都先建立 16:9 母版。
- 只有用户明确要求竖屏、9:16、竖屏短剧或移动端全屏版，才把当前交付解析为 9:16。平台名称、短视频标签或历史模板本身不构成竖屏意图。
- 平台确有竖屏交付要求且用户未要求放弃母版时，保留 16:9 母版并派生 9:16 适配版；不得静默覆盖母版。所有模板写“已解析画幅”，不重新猜比例。
- 雨、雪等降水，以及湿地反光、霓虹雨夜、雨声等连带视听元素，必须记录 `weather_motivation=user-request|reference-bound|story-causality`。没有其中至少一项时使用不带降水的中性场景条件。
- “电影级”“高级感”“黑色电影”“赛博朋克”“汽车广告”等词不自动等于雨夜、湿地或霓虹；类型卡中的雨景只能作为条件化选项。

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

- 创作参考必须来自可追溯的电影、电视剧、正式动漫/剧本，或真人主导拍摄、表演、动作编排、绘制/动画与剪辑的短视频。短视频只是发布渠道；播放量、A 级实看或“高燃”标签都不能替代制作来源核验。
- 所观察范围的主要剧情、画面、动作、表演、摄影机、剪辑或台词由生成式 AI 产出，或来源状态无法确认时，不得进入 `referenceSet`、`fightReferenceSet` 或支撑创意定稿。传统二维/三维动画、CGI 与数字视效不因使用计算机制作而自动归为生成式 AI；判断对象是生成式模型是否产出了本次要学习的具体表达。
- 每条结构化创作参考记录 `observedRangeCreationMode=human-directed|ai-generated|origin-unverified` 和非空 `originEvidence`。只有 `human-directed` 可计入创作参考轨；`ai-generated|origin-unverified` 必须移出创作参考，或使研究保持 `blocked-provisional`。
- AI 视频、AI 图片和试生成成片可进入独立 `generationBenchmarkSet`，只用于记录模型能力、连续性故障、物理错误和修复结果；不得从中提炼剧情、镜头、动作、表演、台词或声音创意机制。
- 未指定现有作品时，创作参考检索可以从“高燃动漫打斗、动漫战斗作画、电影动作场面、真人动作/武术短片、剧情关键场次”等宽入口开始，再按本轮需要的近身格斗、追逐、群战、兵器、能量对撞、关系冲突或揭示类型收窄。所有来源合格且镜头功能匹配的优秀动漫均可入池，不设固定作品白名单。
- 用户指定作品/IP、角色、招式、战役或名场面时，检索保留这些专名以理解角色、世界规则、招式和原作语法，同时仍可跨作品选择更适合具体镜头功能的优秀动漫样本。指定作品默认不是排他白名单；只有用户明确要求“只参考该作品、不要其他作品”时才收窄。参考忠实度由 `reference_use_mode` 决定：内部研究按用户要求高保真学习并保持发布锁，许可复刻服从许可，公开转译学习镜头/动作机制并重建可识别表达。
- 动作参考的首要拆解对象是空间调度、攻防因果、起势/轨迹/接触/受力结果、摄影机位置与运动、景别递进、动作触发切点和速度阶段，不以标题热度或特效亮度代替具体镜头学习。

## 自然台词与场次依据

```text
dialogue.critical-scene.dual-source-reference=required
dialogue.critical-scene.classification-derived=required
dialogue.new-writing.relevant-ab-reference=required
dialogue.every-line.has-scene-function=required
dialogue.character-knowledge-action-grounding=required
dialogue.speaker-swap-test=required
dialogue.shared-knowledge-exposition=forbidden
dialogue.generic-ai-cliche=forbidden
dialogue.content-before-lip-sync-compression=required
dialogue.output.reference-note=short-after-dialogue
```

- 先建立场次因果，再写台词。每个说话者必须有外在目标、关系位置、知识边界、语域、现场动作与防御方式；每句话至少推进动作、信息、关系、选择、情绪或证据中的一项。
- 新写的普通台词场次至少取得一条相关 A/B 级长篇或当前短视频依据。关键性同时由 `criticalSceneReasons`、独立 `sceneFunctionTypes` 与场次目标/关系/信息文本派生，不得用一个自报布尔值跳过双源。开场交锋、关系转向、信息揭示/反转、情绪破裂/和解、高潮决断、广告人物确认和传播记忆句属于关键场次，定稿前必须同时取得一条相关动漫/电影/电视剧/正式剧本的 A/B 级长篇参考和一条当前相关优质或高热度短视频的 A/B 级参考。
- A 级只使用实际观看并核验的范围，B 级只使用可靠剧本、字幕或逐字稿。C/D 级不得支撑具体台词、语域、表演或潜台词判断。任一参考轨受阻时只能交付 `blocked-provisional` 暂定稿并同时设 `finalizationHold=true`、`releaseHold=true`，不得冒充双源定稿或可发布稿。
- 禁止共同已知信息的讲解式对白、可任意互换说话人的通用台词、类型标签直出金句和没有场景因果的励志/哲理套话。内容通过朗读、说话人互换、场景依赖、共同知识和权利边界审计后，才进入口型压缩。
- 默认先交付剧情与台词，末尾只附 2-4 行参考短注。详细字段和执行方法以 [dialogue-and-scene-writing.md](dialogue-and-scene-writing.md) 为准。

## 全有效时间轴

```text
timeline.every-interval.has-story-function=required
reaction.standalone-filler=forbidden
reaction.default-gap.maximum=0.5s
duration.padding=forbidden
segment.timeline.local-zero=required
```

每个时间段至少推进一项：对白、动作、信息、关系、情绪、空间、证据、声音转折或剪辑衔接。删掉后没有损失的段落直接删除或并入相邻动作。

不要机械套用固定四段时间轴。先根据场次任务和动作密度分配节拍。片段内容不足时缩短，不用慢动作、空镜、重复反应、静态凝视、环境微动或无动机推拉填满 15/30 秒。

## 打斗序列与镜头活性

```text
fight.reference.dual-visual-track=required
fight.effective-beat-density=5s
fight.single-shot-static-clash=forbidden
fight.multi-shot.default=required
fight.dynamic-long-take.requires-internal-beats=required
power-clash.must-evolve=required
```

- 完整打斗序列的 `requiredBeats=max(3, ceil(totalDuration / 5s))`，不以 15 秒为上限：15 秒至少 3 拍，30 秒至少 6 拍，更长片段继续按公式增长。每拍必须改变攻防、空间、主导权、目标、伤势、资源或能力规则中的至少一项；单纯换角度、增亮粒子、慢动作、重复同一招或继续对轰不计数。
- 真实状态变化记在每个 `combatBeat.end`。首个变化距序列 0 秒、相邻变化之间、最后变化距 `totalDuration` 均不得超过 6 秒。全序列同时包含 `attack`、`response`、`result`，主导权变化数不少于 `max(1, floor(requiredBeats / 3))`，且相邻节拍的主导权前后状态保持连续。
- 默认 `sequenceMode=multi-shot`，最少镜头数为 `max(2, ceil(requiredBeats / 2))`。每镜声明不同任务所需的 `fightShotRole`；重复角色或重复角度不能冒充节拍或镜头活性。合格职责包括空间建立、追随/闪避、接触澄清、冲击承受、反转揭示和结果重标定。
- `sequenceMode=dynamic-long-take` 是例外，不降低任何节拍、攻防、主导权或结果要求。每拍都必须具备由动作或信息触发的摄影机转位、视觉锚点和停稳落点；固定机位观察、持续环绕、无目的漂移和装饰性推拉均不合格。
- 能量或兵器对轰只能作为局部发展阶段。它必须记录初始平衡、至少两次原因和结果均不同的压力转移、战术介入或能力变化、破局条件、环境受力传播与最终结果，并至少保留一个对轰阶段之外的有效节拍；固定对峙到时长结束失败。
- 重要完整打斗定稿前建立两条 A 级视觉轨：一条当前相关的真人主导优质/高热度动作短视频，或可追溯至动漫/电影原作的当前高燃短视频片段；以及一段相关动漫或电影动作片段。两轨均须实际观看并标记 `visual=yes|partial`、`observedRangeCreationMode=human-directed`，记录来源核验、当前相关性、权利状态、`referenceUseMode`、复用边界与 `doNotCopy`，只能在 `observedScope` 内拆空间、攻防、景别、摄影机和剪辑机制；AI 生成打斗、来源不明片段和 B 级字幕/文稿不得支持具体动作、运镜或表演推断。任一轨缺失时只能 `researchStatus=blocked-provisional`，同时 `finalizationHold=true`、`releaseHold=true` 并记录阻塞证据。
- 结构化打斗根对象使用 `sequenceType=fight`、`fightScope=complete-sequence|isolated-beat`、`sequenceMode=multi-shot|dynamic-long-take`、`fightReferenceSet[]`、`combatBeats[]` 与现有 `shots[]`。完整字段、单节拍例外、对轰对象与权利边界以 [action-and-fight-direction.md](action-and-fight-direction.md) 为准；仓库交付必须通过 `scripts/validate-storyboard-timeline.ps1`。

## 反应与停顿

- 普通即时反应：0-0.5 秒，与触发尾音或下一动作重叠。
- 喜剧：停顿必须改变认知或制造错误胜利；若只是“等观众笑”，删除。
- 悬疑：停顿期间必须有证据进入、声音变化、危险逼近或选择成本上升。
- 情感：余味必须由物件、动作、呼吸变化、声音回声或关系状态变化承载，不拍纯凝视。
- 动作：用受力结果、环境延迟反馈和战术转移收尾，不用摆姿势或慢镜强行升华。

“慢半拍”可以是角色特征或声画关系，但不能自动换算成 1 秒以上的空段。

## 速度与时间倍率

```text
motion.speed-profile.when-story-critical=required
motion.speed.target-and-phase=required
playback.speed.default=real-time
playback.speed-change.requires-explicit-intent=required
speed.adjective-alone=insufficient
```

- 当快慢直接影响动作成败、力量、空间距离、招式可读性、喜剧或悬念击点、产品证明、转场和记忆帧时，建立 `speed_profile`。速度不影响本镜结果时保持自然物理速度，不为“电影感”机械添加快慢词。
- `speed_profile` 分开记录 `action_speed`、`camera_speed`、`playback_speed` 与 `effect_response_speed`；适用项必须写作用对象、局部时间段或事件触发点、实际阶段、可读锚点和结果锚点。阶段从 `start|accelerate|peak|decelerate|settle` 中按本镜选择，不要求每镜机械走满五段。
- 单独的“快速、极速、高速、缓慢、慢速、极慢”不构成可执行约束。优先使用“0.4 秒内由静止爆发”“两步内加速，第三步触地达到峰值”“门内声音出现时减速并收手”等局部时间或物理事件描述。
- 默认 `playback_speed=real-time`。动作速度、摄影机速度和播放倍率彼此独立：主体极速不自动快放，主体缓慢不自动慢动作。慢动作、快放、速度渐变、抽帧、保持帧或延时摄影必须来自用户明确意图或已锁定叙事节点，并写进入点、持续时间、退出点和叙事功能。
- 极速动作仍要保留预备、轨迹、接触、受力与环境结果；禁止瞬移、无因加速、无惯性急停和用全屏运动模糊遮住动作。慢速动作和极慢运镜仍须持续推进状态，不能替代有效剧情或填满时长。

## 创意规格与可生成性

第一版先守住观众承诺、场面规模、核心动作、特效峰值和记忆帧。可生成性检查用于工程实现，不是创意刹车。

优先使用：动作预演、R2V、绿幕/白模参考、关键帧、首尾帧、时间段绑定、分层特效、短段连续生成、动作匹配剪辑、声音桥和区域编辑。拆镜只拆彼此冲突的控制任务，不拆掉速度、力量、人数、尺度或想象力。

只有当前账号能力不支持、存在硬时长/素材限制，或同一核心变量经试生成确认失败，才局部降级；同时提供一个保留同等观众承诺的创意重构版。

## 直生提示词交付

```text
prompt.delivery.default=direct-generation-finished-clip
prompt.out-of-model-deferral=forbidden
prompt.postproduction-handoff.requires-explicit-intent=required
```

- 用户只要求提示词、视频提示词或 Seedance 提示词时，默认交付可直接提交给视频模型生成完整成片的提示词；画面、动作、声音、转场和用户要求的画内文字必须写成模型在本次生成中完成的目标。
- 直生提示词不得出现“后期添加、后期合成、剪辑时处理、字幕层另加、Logo 后放、配音时加入”等把必需成片要素推迟到模型之外的制作指令，也不得在提示词结尾附带默认后期方案。
- 只有用户明确要求后期方案、分层制作、剪辑交接、可编辑字幕或其他制作分工时，才切换为相应交付；不得根据精确文字、Logo、音频或模型不确定性自行推断用户需要后期。
- 直生所需文字或 Logo 必须写清内容、位置、出现时间和稳定性要求，并在生成后逐字检查。无法保证准确时可在提示词外标注风险，但不得把任务偷偷改成后期添加。

## 文字与二维码

按可验证性分层：

- 氛围性、不可读的场景纹理：可由生成模型完成。
- 故事板镜号、技术时间码等制作标注：放在可编辑且可校验的文字层。
- 直生视频中用户要求的字幕、产品参数、品牌字与 Logo：作为画内生成目标写入提示词并逐字检查，不得自动转为后期任务。
- 二维码：必须由可验证工具生成并实际扫码测试；图片模型不得承担最终生产二维码。
- 用户明确要求文字直接生在画内：可以生成，但逐字检查；错误时只返工文字区域，不能声称未校验内容准确。

## 真实性和连续性

先锁制作媒介。真人实拍写清真实光源、演员任务、摄影机身体、服化道、现场特效/数字视效和同期声；3D 写清模型、绑定、动画、模拟、灯光与合成；二维写清设定、Layout、原画、清稿、上色和摄影合成。

多镜头维护角色身份、服装、伤势、关键道具、空间轴线、动作方向、光线时段、声音母题、已知信息和关系状态台账。相邻镜必须至少有一个动作、视线、声音、道具或空间钩子。
