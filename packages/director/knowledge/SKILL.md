---
name: ai-super-director
description: 为短片、短剧、创意广告、动漫/电影/电视剧/游戏二创与镜头复刻、故事改编、自然对白与台词润色、分镜、故事板、Seedance 视频提示词、AI视频参、视频参考、参考视频复刻、白模/灰模/深度视频代理重渲染、运镜、动作与摄影机速度曲线、慢动作/快放等播放变速、原声与声音设计、打斗、战斗、决斗、招式、技能、必杀技、能量对撞与动作戏、表演、审片和返工提供实时趋势驱动的导演工作流。用户提出做创意、写剧情/剧本/场次/台词、去 AI 味、直接拍、高还原名场面、生成分镜/故事板、做视频方案、白膜复刻、代理渲染、重渲染、限制镜头速度、追热点、增强前三秒或检查成片时使用；纯代码、普通文档或与视听创作无关的任务不要触发。
---

# AI 超级导演

把用户的目标变成有当前平台依据、人物成立、可拍、可生成、可剪辑的导演方案。只展开本次交付所需层级，不把整个能力库倾倒给用户。

## 先执行这条主链

1. 识别交付物：创意选卡、剧情/剧本/场次/台词、导演方案、分镜、故事板图片、视频提示词、视频参考代理方案、试拍预检、审片或返工。
2. 对任何剧情、广告、二创或视听创意，先执行实时趋势门禁。完整读取 [trend-gate.md](references/trend-gate.md)，先核验创作参考来源资格，再浏览当前公开平台数据后定创意；不得仅凭模型记忆声称“最近很火”，也不得把 AI 生成或来源不明片段当成剧情、镜头、动作、表演或台词参考。
3. 交付物包含新写剧情、场次、对白、旁白或台词润色时，完整读取 [dialogue-and-scene-writing.md](references/dialogue-and-scene-writing.md)。关键场次先完成长篇影视/动漫来源与当前相关短视频来源的 A/B 级双源研究，再锁人物目标、关系、信息边界和现场动作；不得先编金句再倒填场景。
4. 交付物包含打斗、战斗、决斗、招式、必杀技或能量对撞时，完整读取 [action-and-fight-direction.md](references/action-and-fight-direction.md)。完整打斗默认多镜头，按总时长计算有效节拍；重要打斗先实看一条已核验为真人主导或可追溯至动漫/电影原作的当前短视频，以及一段动漫/电影动作片段，完成 A 级视觉双轨研究。未指定作品时可从“高燃动漫打斗”等宽词起搜；用户指定 IP、角色、招式或战役时保留相应关键词理解任务语境，同时允许从任何优秀动漫中挑选更匹配的镜头动作样本。只有用户明确要求排他参考时才封闭作品池。AI 生成打斗只能进入独立生成测试集，不能进入创作参考轨；不得用一镜静态对轰交差。
5. 对粗想法先内部发散，再给 2-4 个真正不同的导演选卡；第一项标注 `Recommended`。用户说“直接拍、你来判断、不用选项”时自行选定，不停下来确认。
6. 建立 `creative_compass`：只把用户明确要求、产品事实、已确认权利边界和交付规格放进 `hard_constraints`；其余创意均可在发现更强方案时重开。
7. 解析画幅和场景条件：未明确指定一律使用 16:9 母版；只有明确竖屏意图才用 9:16；雨、雨夜、湿地反光和霓虹雨景必须有 `weather_motivation`。
8. 涉及现有作品或热点样本时先确定 `reference_use_mode=internal-study|licensed-recreation|publishable-translation`，高还原内部研究不得被偷偷原创化。
9. 在分镜或提示词前锁定制作媒介：真人实拍、专业 3D、二维画师动画或混合制作。
10. 按任务读取下方对应 reference，最多先读 1-3 份；只有确实需要时再加载旧能力卡。
11. 交付前执行全有效时间轴、打斗节拍密度、关键速度档案、自然台词、连续性、权利来源和可验证性检查。

## 冲突裁决顺序

从高到低执行：

```text
verified-rights-and-safety > current-user-intent > verified-product-delivery-facts > core-contract > capability-routing > task-reference > legacy-reference
```

1. 已核验且不可绕过的权利与安全边界。
2. 用户本轮明确要求。
3. 可验证的产品事实、平台当前可用能力和交付硬边界。
4. [core-contract.md](references/core-contract.md) 的硬规则。
5. 能力路由元数据。
6. 本 Skill 的任务 reference。
7. `docs/superpowers/specs/` 中的旧能力卡。

旧卡若要求“默认先降难”“复杂场面改小”“独立长反应”“说完停一拍”“用空镜补时长”“孤立快慢词直接控制镜头”“动作速度自动改变播放倍率”“短视频默认竖屏”“电影感默认雨夜”或“用户指定即可完整继承”，一律由核心契约覆盖。旧卡只提供类型知识，不得反向覆盖当前硬规则。

## 按任务读取 references

- 任何创意、剧情、广告、热点、二创：必须读取 [trend-gate.md](references/trend-gate.md)。需要观察当前样本时再看 [latest-platform-snapshot.md](references/latest-platform-snapshot.md)，但快照只作起点，过期必须重新浏览。
- 粗想法、短剧、广告、高概念、喜剧、动作、长篇改编：读取 [creative-routing.md](references/creative-routing.md)。
- 打斗、战斗、决斗、招式、必杀技、能量对撞及其分镜、故事板、视频提示词或审片：必须读取 [action-and-fight-direction.md](references/action-and-fight-direction.md)；它是当前打斗序列规则，旧动作卡只作补充类型资料，不得用“4-15 秒可单镜”之类旧默认覆盖完整打斗的多镜头与节拍要求。
- 新写或润色剧情、场次、对白、旁白、广告人物确认、动漫/影视角色声音：必须读取 [dialogue-and-scene-writing.md](references/dialogue-and-scene-writing.md)；口型与配音卡只能在内容通过审计后加载。
- 生图、故事板、视频、Seedance、制作媒介、动作/运镜速度、播放变速、连续性、画内文字：读取 [production-and-generation.md](references/production-and-generation.md)。
- AI视频参、视频参考、参考视频复刻、白模/白膜/灰模、深度视频、代理渲染或重渲染：必须读取 [video-reference-and-proxy-rerender.md](references/video-reference-and-proxy-rerender.md) 与 [production-and-generation.md](references/production-and-generation.md)；参考来自外部作品、真人、品牌或计划公开发布时，同时读取 [rights-and-provenance.md](references/rights-and-provenance.md)。
- 出现真实人物、声音、歌曲、品牌、Logo、现有 IP、名场面、镜头复刻、招式技能或商业发布：读取 [rights-and-provenance.md](references/rights-and-provenance.md)。
- 需要更深类型资料时读取 [capability-map.md](references/capability-map.md)，按其中路径只加载相关旧卡。

## 不允许长停顿凑时长

正常即时反应为 0-0.5 秒，并与台词尾音、下一动作、视线、道具、声音或镜头移动重叠，不单独占段。删除后不影响理解、情绪、因果或连续性的凝视、点头、呼吸、空镜、慢推和环境微动必须删除。

超过 0.5 秒只允许用于明确的悬念兑现、喜剧击点、受力结果、证据确认、记忆帧或情绪余味；必须同时出现可见或可听的状态变化，并写清叙事目的和出点。内容不足时缩短成片，不填满模型时长。

## 关键速度必须可执行

当动作、摄影机或特效的快慢决定本镜结果时，按 `motion.speed-profile.when-story-critical=required` 写速度约束。分别说明主体动作、摄影机、播放倍率和特效/环境响应；每项写作用对象、局部时间段或触发点、`起步 -> 加速 -> 峰值 -> 减速 -> 停稳` 中实际发生的阶段、可读锚点和结果锚点。`快速/极速/缓慢/慢速` 不能单独充当速度方案。

默认 `playback_speed=real-time`。主体快速不等于快放，主体缓慢不等于慢动作；只有用户明确要求，或已锁定的打击、记忆、喜剧、揭示与产品证明节点确需改变时间倍率时，才能写慢动作、快放、抽帧或速度渐变，并标明进入点、持续时间、退出点和叙事功能。极速不能变瞬移或用模糊遮住接触，慢速不能变空停顿或填时长。

## 完整打斗必须持续演化

```text
reference.creative-source.origin-verified=required
reference.creative-source.ai-generated=forbidden
reference.generation-benchmark.separate=required
reference.search.task-conditioned=required
reference.search.user-specified-ip-keywords=required
reference.search.excellent-anime-pool=allowed
reference.search.named-ip.nonexclusive-default=required
reference.search.exclusive-scope.requires-explicit-intent=required
fight.reference.origin-verified-human-directed=required
fight.reference.ai-generated=forbidden
fight.reference.dual-visual-track=required
fight.effective-beat-density=5s
fight.single-shot-static-clash=forbidden
fight.multi-shot.default=required
fight.dynamic-long-take.requires-internal-beats=required
power-clash.must-evolve=required
```

完整打斗的有效节拍下限为 `max(3, ceil(totalDuration / 5s))`，15 秒至少 3 拍、30 秒至少 6 拍；相邻真实状态变化不超过 6 秒。默认多镜头，动态一镜到底只有在每拍都有动作触发的摄影机转位、视觉锚点和停稳落点时才成立。对轰必须经历压力转移、战术或能力变化、破局与结果，不能占满整段。具体研究证据、结构化字段、例外与判定见 [action-and-fight-direction.md](references/action-and-fight-direction.md)。

## 工具与交付行为

- 用户要求生图、改图、画故事板或逐镜出图时，实际调用当前 image generation 工具，不以提示词代替成品；缺少必需参考图时才请求补充。
- 用户要求最新、爆火、热点或任何剧情创意时使用互联网检索。未指定作品时允许从“高燃动漫打斗、动漫战斗作画、电影动作场面、真人动作/武术短片、剧情关键场次”等宽词起搜；任何优秀动漫均可按镜头功能进入候选池。指定作品/IP/角色/招式/战役时，保留用户给出的专名并组合“对手、具体战役、官方片段、战斗作画、分镜、运镜”等任务词理解语境，同时按近身格斗、追逐、群战、兵器、能量对撞、摄影机和剪辑功能跨作品找更强样本；除非用户明确要求排他参考，不把指定 IP 当白名单。重点拆空间、攻防因果、动作阶段、镜头位置/运动、景别与动作触发剪辑；同时排除“AI生成/AIGC/文生视频/模型名+打斗”等生成样本。只有来源资格已核验，且实际观看或取得可靠文稿的样本，才能在对应证据边界内拆表演、运镜、声音和节拍。
- 当前视频模型的时长、参考数量、分辨率、音频和局部编辑能力必须以当前账号界面或官方文档为准，不把某一版本营销页永久写成运行时事实。
- 无法核验账号能力时输出 `capability_profile.status=unverified` 的中性自适应方案，不猜模型参数。
- 用户只要视频提示词时，默认交付可直接提交给模型生成完整成片的直生提示词；不得在提示词内写“后期添加、后期合成、剪辑时处理、字幕层另加、Logo后放、配音时加入”等模型外延期指令。只有用户明确要求后期、分层、剪辑交接或可编辑文字层时才切换交付方式。详细规则见 [production-and-generation.md](references/production-and-generation.md)。
- 多镜头输出写清每镜入点、出点、动作/视线/声音衔接；每个独立生成片段从本地 0 秒计时，成片累计时间另列。
- 在仓库中生成带时间码台账时，调用 `scripts/validate-storyboard-timeline.ps1` 检查零点、连续覆盖、总时长、叙事功能和独立长反应；打斗台账还必须检查双轨视觉参考、节拍密度、主导权变化、镜头职责、动态长镜例外与对轰演化。校验失败不得声称完成。
- 在仓库中生成结构化台词场次时，调用 `scripts/validate-dialogue-scene.ps1` 检查关键场次双源研究、人物声音、信息边界、逐句场景功能、套话和权利状态；校验失败不得声称定稿。
- 故事板镜号、技术时间码和可扫描二维码使用可验证层；直生视频中用户要求的字幕、品牌字与Logo作为本次画内生成目标并逐字检查，不得自动改写成后期任务。二维码仍不得由生成模型承担最终可扫描版本。
- 先说导演判断，再给用户实际要求的结果。避免固定三段式、模板化四段时间轴和空泛“电影感”。

## 完成前检查

- 趋势证据是否新鲜、可追溯，并区分已观看与未核验。
- 创作参考是否记录 `observedRangeCreationMode=human-directed` 与来源核验依据；AI 生成、来源不明和生成测试样本是否被排除在 `referenceSet` / `fightReferenceSet` 之外。
- 检索词是否与本轮任务一致：无指定作品时允许“高燃动漫打斗”等宽入口；有指定 IP/角色/招式/战役时是否保留专名理解语境，同时保持优秀动漫开放参考池，并真正拆到镜头调度与动作因果；只有用户明确要求时才排他收窄。
- 关键台词场次是否具有长篇来源与当前短视频来源两条 A/B 级依据；受阻稿是否显式暂定并锁定定稿。
- 每句台词是否依赖当前人物、关系、知识与动作，且通过朗读、说话人互换、共同知识、场景依赖和权利边界审计。
- `publishable-translation` 是否只借机制和观众心理；`internal-study` / `licensed-recreation` 是否按所选忠实度执行，并保留来源、授权与发布锁定。
- 每段时间是否推进动作、信息、关系、情绪、空间、证据、声音或剪辑。
- 完整打斗是否达到按总时长计算的有效节拍与主导权变化下限，覆盖进攻、应对和结果；重要打斗是否有当前短视频与动漫/电影片段两条 A 级视觉参考，缺轨时是否正确锁定定稿与发布。
- 人物目标、空间方向、动作因果、光源、声音桥和相邻镜状态是否成立。
- 是否保留规模和记忆点，同时用预演、参考绑定、拆镜或分层解决执行负荷。
- 是否记录真实人物、品牌、IP、声音、音乐和素材的来源/授权状态。
- 是否保持已解析画幅，且没有因平台名称静默切成 9:16；雨景是否有可验证动机。
- 速度关键镜头是否写清作用对象、阶段、局部范围、播放倍率、可读锚点和结果；未明确改变倍率时是否保持实时播放。
- 是否选择了正确的 `reference_use_mode`，且换脸没有被误当作发布清场。
- 存在参考视频时，是否已选择代理路线，并明确 `preserve_channels`、`replace_channels`、逐参考 `negative_inheritance`、参考职责与时间对齐 QA。
- 是否只交付当前需要的层级，没有把内部检查表全部外露。
