# 自然台词与场次写作

## 目的

台词不是独立金句生成。先让人物在具体关系、信息差和现场动作里非说不可，再决定他说什么、故意不说什么。参考动漫、电影、电视剧和优质短视频时，学习的是人物博弈、语域、节奏与潜台词机制，不把来源中的标志性台词直接拼进公开作品。AI 生成短剧、AI 对白展示和来源不明片段不是台词/剧情参考；它们只能作为独立生成故障样本。

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

## 什么时候必须进入本流程

剧情、剧本、场次、对白、旁白、台词润色、人物小传、广告人物确认、二创角色声音和“去 AI 味”任务都进入本流程。只改已经锁定台词的时间码、字幕格式或口型参数属于纯执行任务，可以不重新研究，但不得声称台词经过当前样本学习。

下列任一情况视为 `criticalScene=true`：

- 开场冲突、前三秒钩子或第一次人物交锋；
- 关系转向、秘密揭示、误会解除、背叛或反转；
- 情绪破裂、和解、告别、表白、审判或关键选择；
- 高潮前决断、战斗前交涉、招式释放前后的任务台词；
- 广告中承担人物信任、产品体验确认或品牌记忆的关键一句；
- 明确希望成为记忆点、评论接话口、传播句或角色代表句的台词。

关键场次不能先编一句“像金句的话”再倒填剧情。新写的普通场次虽不要求双轨，但定稿前仍至少取得一条与人物关系、题材或语域相关的 A/B 级长篇或当前短视频依据；只有锁定稿的纯执行任务可以使用空 `referenceSet`。

结构化场次用 `criticalSceneReasons` 记录原因，取值限于：`opening-conflict|opening-hook|confrontation|relationship-turn|information-reveal|reversal|emotional-rupture|reconciliation|climax|decision|ad-confirmation|brand-human-confirmation|memory-line`。另用独立 `sceneFunctionTypes` 声明同一组结构角色；普通场次只能为 `[ordinary-continuation]`，关键场次必须与 `criticalSceneReasons` 精确一致。关系与信息还须分别记录 `relationshipStateBefore`、`relationshipStateAfter` 和 `newlyRevealedFacts[]`：前后状态不同会自动派生 `relationship-turn`，新事实数组非空会自动派生 `information-reveal`，并强制进入关键场次双源；不能同时清空分类数组或换一套措辞来手填 `criticalScene=false`。

## 关键场次双源研究

每个关键场次在定稿前建立 `dialogue_reference_set`（结构化 JSON 字段为 `referenceSet`），至少包含两条彼此职责不同的 A/B 级证据：

1. `long-form`：一条与题材、人物关系、压力等级和语域相邻的动漫、电影、电视剧、正式剧本或可靠字幕来源。用于学习长线人物声音、信息控制、潜台词和关系推进。
2. `short-video`：一条与当下受众、平台、内容形态和场次功能相邻的优质或高热度短视频来源。用于学习当前口语密度、进入速度、停留点和评论接话机制。

`short-video` 是发布渠道，不是来源资格。合格短视频须能追溯至动漫、电影、电视剧，或真人主导拍摄、表演、编剧、传统/手工动画与剪辑的剧情短片/短剧。生成式 AI 产出的剧情、画面、表演、声音或对白，以及无法核验所观察范围制作来源的片段，均不得进入 `referenceSet`；即使已实看或取得字幕，也不能提升为合格参考。传统二维/三维动画、CGI 与数字视效不因使用计算机制作而自动归为生成式 AI。

“爆款”必须有当前可核验热度依据；“优质”可以由表演、写作、完成度和题材相关性选择，但要说明判断依据。长篇来源不要求是热点，要求工艺与人物关系高度相关。平台名不是证据，搜索摘要也不是台词样本。

只有下列证据能支持台词机制：

- A 级：实际观看，且台词相关范围的音频或可靠字幕已核验；
- B 级：官方剧本、正式字幕、可靠逐字稿或用户提供并确认的文本；
- C 级：只能说明题材、标题和包装，不能据此推断台词、表演或潜台词；
- D 级：不得参与定稿。

双源均须记录：`sourceId`、`lane=long-form|current-short-form`、`medium`、`title`、`platform`、`sourceLocator`、`observedRangeCreationMode=human-directed`、`originEvidence`、`evidenceLevel`、`transcriptProvenance`、`observedScope`、`mechanismEvidenceBasis`、`learnedMechanisms`、`doNotCopy`、`referenceUseMode`、`authorizationStatus` 与 `reuseBoundary`。`observedRangeCreationMode` 的完整枚举为 `human-directed|ai-generated|origin-unverified`，但后两者不能计入创作参考。当前短视频另记 `publishedAt`、`capturedAt`、`selectionBasis=viral|quality` 和 `currentRelevanceEvidence`；爆款样本补 `rankOrHeat`，优质样本补 `qualityRationale`，不能把今天重新打开一个旧链接等同于当前相关。A 级台词依据只允许 `mechanismEvidenceBasis=watched-audio|watched-visual-audio`，且 `observedScope` 必须是递增时间范围并含 `audio=yes|partial`；B 级只允许 `transcript-dialogue|script-dialogue`。`reuseBoundary` 必须与使用模式精确对应：`internal-study-high-fidelity-release-held|licensed-recreation-within-permission-scope|publishable-mechanism-only-expression-rebuilt`。不得把模型记忆中的某部作品当成已核验来源，也不得用同一规范化内容 URL/文件位置、`share_id`/`share_item_id` 等分享参数来冒充两条来源。

如果长篇源或短视频源受登录、地区、字幕或访问限制：

- 不绕过限制，不虚构观看；
- 尝试合法可访问的正式剧本、官方片段、可靠字幕或同功能替代样本；
- 仍缺一轨时可交付 `researchStatus=blocked-provisional` 的暂定稿，但必须 `finalizationHold=true`、`releaseHold=true`，并记录非空 `researchBlocker` 与 `blockerEvidence`，明确哪一轨未核验，不得称为趋势定稿、双源学习结果或可发布稿。

## 先建场次，再写台词

为每个场次建立 `dialogue_scene_contract`；结构化 JSON 将下列字段放在场次根对象：

```yaml
sceneObjective: 这场戏结束前谁必须得到、阻止或确认什么
relationshipTurn: 开场与结尾的权力、亲疏、信任或债务变化
relationshipStateBefore: 开场时可核对的关系状态
relationshipStateAfter: 结尾时可核对的关系状态；与 before 不同即派生关系转向
informationState: 每个人已知、误信、隐瞒、试探和本场新得知什么
newlyRevealedFacts: 本场新揭示的具体事实数组；非空即派生信息揭示
physicalContext: 人物此刻正在做什么，空间/道具/时间压力如何打断语言
stakes: 说错、沉默或被识破的即时后果
criticalScene: true|false
criticalSceneReasons: 关键场次原因数组
sceneFunctionTypes: 独立结构角色数组
researchStatus: complete|blocked-provisional|not-required-execution-only
finalizationHold: true|false
releaseHold: true|false
referenceUseMode: internal-study|licensed-recreation|publishable-translation
```

结构化场次中的 `finalizationHold` 表示研究证据尚不足、不能称为定稿；`releaseHold` 表示权利尚未清场、不能发布。两者不能互相替代。写入项目素材台账时，`releaseHold` 映射为既有字段 `release_hold`。`blocked-provisional` 必须 `finalizationHold=true`；`internal-study` 与 R1 必须同时 `releaseHold=true`（即台账 `release_hold=true`）。

`not-required-execution-only` 只允许已经锁定台词后的 `executionKind=timing|subtitle-format|lip-sync`，并同时写 `lockedDialogue=true` 与 `newDialogueWritten=false`。另须提供现存本地批准稿 `lockedDialogueSource` 及匹配的 `lockedDialogueSha256`；当前 `lines` 的 id、说话人、听者、正文、语言行为、场次功能、现场任务、潜台词、知识依据、动作、场景锚点和后果必须与批准稿完全一致。只要新增、改写或润色台词，就不能伪装成纯执行任务；关键场次的纯口型/时间码执行也可使用本状态，因为它不改变内容。

再为每个说话者建立声音指纹：

```yaml
id: 稳定人物标识
name: 人物名
lifeStage: 年龄阶段与生活经验
socialRole: 职业、教育、阶层或群体位置
relationshipPosition: 他在当前关系里想占据的位置
knowledgeBoundary: 他能知道、不能知道、误以为什么
register: 地区、时代、正式度、行话与礼貌等级
sentenceShape: 长短句、停改口、反问、省略和语速倾向
addressSystem: 对不同对象的称呼变化
actionVerbs: 此人常用来施压、回避或照顾关系的语言动作
defenseStrategy: 玩笑、反问、挑错、转移、沉默、过度解释等防御方式
pressureMutation: 压力上升时声音如何变形，而不是只变大声
neverSays: 此人不会使用的词、价值判断和通用金句
echoBudget: 口头习惯何时可复现；禁止每句重复
```

人物声音来自经历、关系和当下任务，不是“认真角色说哲理、嘴硬角色说反话、反派说规则与代价”这种标签到套话的映射。口头禅是稀缺回声，不是自动贴纸。

## 每句台词的落地字段

每句可交付台词至少能回答：

```yaml
speaker: 谁说
listener: 真正说给谁听
text: 台词正文
speechAct: 威胁、试探、遮掩、请求、交换、纠正、安抚、拒绝等
sceneFunction: 推进动作、信息、关系、选择、情绪或证据中的哪一项
visibleTask: 说话时手上正在完成什么任务
subtext: 他真正想让对方做、相信或停止什么
knowledgeBasis: 这句话基于他已知的哪件事；不得越过信息边界
physicalAction: 哪个动作、道具或环境事件承接或打断这句话
sceneSpecificAnchor: 只有这场戏、这段关系才说得出的具体词或事实
lineConsequence: 这句话让下一步发生了什么变化
```

若一句台词删除后不影响动作、信息、关系、选择、情绪或证据，就删除。若把人物名互换后仍同样成立，说明人物声音或关系压力不够具体，必须重写。

## 写作顺序

1. 用无对白动作写清场次因果：谁先做什么，谁拦住，什么证据进入，关系在哪里转向。
2. 标出必须通过语言完成的行为；能让动作、道具、眼神或现场声完成的信息，不再让人物解释一遍。
3. 写第一轮“功能台词”，确保每轮交锋改变权力、信息、动作或选择。
4. 根据人物声音指纹改写词汇、称呼、句形、回避方式和压力变形。
5. 把长篇源学到的潜台词/关系机制与短视频源学到的进入速度/口语密度分开使用，禁止把两条来源的表面句式拼接。
6. 朗读并表演一遍：检查呼吸、抢话、改口、打断和动作是否自然；不要为了“像真人”机械加入嗯、啊、那个或省略号。
7. 执行五项审计：`speakerSwapPassed`、`sharedKnowledgeExpositionPassed`、`sceneDependencyPassed`、`readAloudPassed`、`rightsBoundaryPassed`。每条审计说明至少引用一个实际台词 `line id`，说话人互换说明还要指出具体人物；“已检查、没有问题”不能充当证据。任何一项失败都不得定稿。
8. 删掉全场最像 AI 写的那一句，再看场次是否更准确；如果更准确，就不要补回另一句金句。

## 明确禁止

- 两个都知道同一事实的人互相完整讲解，只为给观众补设定；
- 没有现场因果的“这不可能”“你终于来了”“一切都结束了”“我不会放过你”“我们一定能做到”；
- 与人物身份、地区、时代、职业和关系无关的整齐书面腔；
- 每个人都说同样长度、同样节奏、同样正确的总结句；
- 用抽象名词替代冲突，如无具体依据地反复谈“命运、规则、代价、选择、守护、相信”；
- 情绪发生时让人物准确解释自己的全部心理；
- 为了可传播先写金句，再让人物和剧情为金句服务；
- 仅凭 C/D 级元数据、搜索摘要或记忆声称“参考了某作品的台词风格”。

上述短语不是靠填一个非空锚点就能豁免的孤立禁词。结构化交付一旦命中库存句或其轻微变体，必须把具体事实、关系动作或即时后果真正写进台词正文后再校验；不存在“这句其实很合场景”的布尔白名单。校验器只负责拦明显套话，最终自然度仍须靠场次审读与朗读测试判断。

## 二创、学习与权利边界

- `internal-study`：可高保真研究已有角色的措辞、节奏、关系博弈和名场面功能，结构化场次必须 `releaseHold=true`，写入素材台账时为 `release_hold=true`；研究稿不因换脸或改名而变成可发布稿。
- `licensed-recreation`：仅 R0 且 `permissionScope` 明确提供 `coveredElements`（必须含 `dialogue-story`）、`permittedUses`、`territories`、`validFrom`、`validUntil`、现存本地 `evidenceLocation`、匹配文件的 `evidenceSha256`、`evidenceVerifiedBy`、`evidenceVerifiedAt`、`evidenceDocumentType`、`evidenceAuthorizationId`、`evidenceIssuer` 与 `evidenceGrantee` 时，才可在许可范围高还原。证据文件限结构化授权 JSON、PDF、EML 或 MSG；结构化 JSON 的主体、被许可方、授权编号和许可数组须与 `permissionScope` 一致。用户一句“有授权”、不存在的路径或任意项目文件不构成 R0；即使机器校验通过，签发主体与真实性仍须人工/法务确认。
- `publishable-translation`：学习关系机制、信息释放、语域和节奏，重建具体台词、人物整体识别和场次表达；标志性台词、独特对白排列、可识别真人声纹与原录音另行清权。

引用短片或长篇来源是为了做出更准确的写作判断，不等于可以复制来源表达。完整权利路由服从 [rights-and-provenance.md](rights-and-provenance.md)。

## 输出与口型交接

默认输出顺序：

1. 先给一句导演判断；
2. 直接给剧情/场次动作与台词；
3. 末尾只附 2-4 行“参考短注”，说明长篇源学了什么、短视频源学了什么、没有照搬什么，以及必要的发布限制。

只有用户要求研究报告或审计记录时，才展开完整证据卡。不要让参考说明淹没剧情。

台词内容通过五项审计后，才交给口型、时长和声音执行层。口型压缩优先删重复信息、把可见信息还给动作、调整切分和抢话，不得把不同人物都压成同一种 3-8 字短句，也不得牺牲信息边界、人物语域或关系动作。保留原稿 `approved_line`，执行稿另记 `sync_line` 与改动理由。

仓库内结构化场次可运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-dialogue-scene.ps1 -InputPath <scene.json> -Format Text
```

校验通过只表示研究、人物、因果、权利和反套话字段自洽，不证明调用方诚实观看、授权文件真实或作品最终自然；仍须导演朗读、演员试演、来源复核与人工/法务审稿。
