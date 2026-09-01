# 深度能力地图

仅在任务需要更深细节时读取对应旧卡；一次优先加载不超过 3 张。所有旧卡均受 `core-contract.md` 覆盖。

## 主入口

- 动态创意：`docs/superpowers/specs/2026-08-02-ai-super-director-dynamic-creative-divergence-fun-meme-engine.md`
- 平台趋势：`docs/superpowers/specs/2026-06-07-ai-super-director-ai-trend-radar.md`
- 短剧：`docs/superpowers/specs/2026-06-07-ai-super-director-short-drama-conflict-reversal-hook-engine.md`
- 广告证明：`docs/superpowers/specs/2026-06-07-ai-super-director-creative-ad-product-proof-conversion-engine.md`
- 高概念：`docs/superpowers/specs/2026-06-07-ai-super-director-high-concept-short-film-rule-engine.md`
- 完整打斗、决斗、招式、必杀技与能量对撞：先执行本 Skill 的 `references/action-and-fight-direction.md`；旧 `docs/superpowers/specs/2026-06-07-ai-super-director-action-fight-vfx-choreography-engine.md` 只补充类型词表与受力知识
- 一般动作、追逐与特效：`docs/superpowers/specs/2026-06-07-ai-super-director-action-fight-vfx-choreography-engine.md`
- 速度关键动作、追逐、招式、产品机制与强运镜：先执行 `core-contract.md` 的速度契约与 `references/production-and-generation.md` 的 `speed_profile`，再按需读取动作特效、运镜或视频基线卡
- 视觉二创/镜头复刻：`docs/superpowers/specs/2026-07-03-ai-super-director-fanwork-style-anchor-library.md`、`docs/superpowers/specs/2026-06-07-ai-super-director-cinema-tokusatsu-shortfilm-essence-translation-library.md`
- 声音二创/原声与声线延续：`docs/superpowers/specs/2026-07-03-ai-super-director-fanwork-style-voice-continuation-engine.md`、`docs/superpowers/specs/2026-06-07-ai-super-director-sound-first-auditory-directing-engine.md`
- 台词与场次写作：先读本 Skill 的 `references/dialogue-and-scene-writing.md`；只有需要二创人物声音或口型执行细节时，再加载 `docs/superpowers/specs/2026-08-02-ai-super-director-viral-fanwork-ip-emotional-dialogue-editor.md`、`docs/superpowers/specs/2026-06-07-ai-super-director-dialogue-lip-sync-performance-library.md`
- 表演：`docs/superpowers/specs/2026-06-07-ai-super-director-live-performance-emotion-action-directing-library.md`
- 运镜：`docs/superpowers/specs/2026-06-07-ai-super-director-camera-language-dictionary.md`
- 声音：`docs/superpowers/specs/2026-06-07-ai-super-director-sound-first-auditory-directing-engine.md`
- 连续性：`docs/superpowers/specs/2026-06-07-ai-super-director-continuity-script-supervisor-prop-character-engine.md`
- 故事板：`docs/superpowers/specs/2026-07-12-ai-super-director-complete-visual-storyboard-generation-system.md`
- 制作媒介：`docs/superpowers/specs/2026-07-12-ai-super-director-production-authenticity-live-action-animation-pipeline-baseline.md`
- 视频参考、参考视频复刻、白模/灰模/深度代理与重渲染：先执行本 Skill 的 `references/video-reference-and-proxy-rerender.md`，再执行 `references/production-and-generation.md`；外部来源或公开发布同时执行 `references/rights-and-provenance.md`，仅在需要历史类型知识时再加载旧卡
- 视频基线：`docs/superpowers/specs/2026-07-12-ai-super-director-seedance-latest-natural-realism-baseline.md`
- 审片：`docs/superpowers/specs/2026-06-07-ai-super-director-output-audit-scorecard.md`

## 已废止的旧默认值

读取旧卡时忽略并不得输出：

- 因评级 C/D 或“高风险”而自动预先降难。
- 将大特效默认改成小征兆、群像默认改成少数人、复杂动作默认改成轻微动作。
- 固定所有视频为 4-6 秒或固定四段式时间轴。
- 台词后默认保留半秒、动作后默认保留 1 秒环境声、2-4 秒桥镜或集体沉默。
- 使用慢推、空镜、凝视、呼吸和环境微动填满模型时长。
- 未核验就宣称平台样本“爆火”或拆解其运镜、声音和表演。
- 由“短视频”、平台名称、电影级或影视类型自动切成 9:16；未明确画幅时统一使用 16:9 母版。
- 把电影感、汽车、黑色电影或赛博朋克自动写成雨夜、湿地反光、霓虹雨景或雨声。
- 仅因用户提出高还原或换脸，就把现有 IP、镜头、台词、原声、招式、技能或名场面视为已清权。
- 由“认真、嘴硬、温柔、反派、热血”等类型标签直接生成固定金句，或给每个角色机械添加口头禅。
- 先按口型字数把所有人物压成同一种 3-8 字短句，再倒推人物声音和场次逻辑；内容审计必须先于口型压缩。
- 用 C/D 级标题、封面、榜单元数据或模型记忆冒充动漫/影视/短视频台词学习；关键场次必须完成长篇与短视频两条 A/B 级参考轨。
- 把“快速、极速、缓慢、慢速”作为孤立快慢词，单独当作动作或运镜控制，或让主体速度自动改变整段播放倍率。
- 因动作很快自动快放、因情绪很慢自动慢动作，或用慢动作、抽帧、静止帧填满模型时长；播放倍率默认实时，变化必须写进入点、持续时间、退出点和叙事功能。
- 把 15 秒、30 秒或更长的完整打斗生成单元默认写成一个镜头，或用固定机位、持续对轰、重复爆光和无状态变化的环绕占满时长。
- 把单纯换角度、粒子亮度、慢动作或重复同一招计作新的战斗节拍；有效拍必须改变攻防、空间、主导权、目标、伤势、资源或能力规则。

## 当前总纲的唯一来源

- 优先级、停顿、规格、文字和连续性：本 Skill 的 `references/core-contract.md`。
- 实时平台证据：本 Skill 的 `references/trend-gate.md`。
- 权利和素材来源：本 Skill 的 `references/rights-and-provenance.md`。
- 自然台词、关键场次双源研究和去 AI 味审计：本 Skill 的 `references/dialogue-and-scene-writing.md`。
- 速度目标、局部阶段、播放倍率、相对运镜与环境响应：本 Skill 的 `references/production-and-generation.md`。
- 完整打斗的双轨视觉研究、有效拍密度、多镜头默认、动态长镜例外与对轰演化：本 Skill 的 `references/action-and-fight-direction.md`。
- 视频参考的通道拆分、代理路由、参考职责、重渲染与结构验收：本 Skill 的 `references/video-reference-and-proxy-rerender.md`。
- 具体模型能力：当前账号界面和带日期的官方来源；旧卡中的版本号只作历史记录。
