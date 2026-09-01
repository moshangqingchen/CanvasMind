# 制作、故事板与视频生成

## 目录

- 制作媒介
- 图片参考
- 故事板
- 视频生成
- 动作与摄影机
- 文字层
- 返工

## 制作媒介

进入具体镜头前选择：

- 真人实拍：明确摄影机与镜头组、支撑方式、实景/搭景、美术材质、真实灯光、演员调度、服化道、现场特效/数字视效、同期声、剪辑和调色。
- 专业 3D：锁角色转面、比例、材质、毛发、骨骼和面部绑定，再按 Layout、Blocking、Spline/Polish、模拟、灯光、渲染和合成组织。
- 二维画师动画：锁角色设定、转面、表情、手型、线条、色彩脚本和背景透视，再按 Layout、原画、动作分解、中间画、清稿、上色、背景、特效作画和摄影合成组织。
- 混合制作：写清真人、3D、二维、合成和声音各层职责。

## 图片参考

逐张编号并记录：素材职责、画幅、风格、角色、表情/动作气质、色彩、材质、构图、文字区域、继承项和禁继承项。多参考冲突时使用：用户明确不可动项 > 主体身份 > 主场面任务 > 动作物理 > 光影连续 > 风格 > 装饰。

## 故事板

用户要求画故事板时，除非已说“直接生成、你来判断、不用选项”，先给：

1. 分层故事板图册（Recommended）：角色母版 + 关系空间板 + 每页 4-6 格。
2. 一页式完整故事板：适合 30 秒内 6-9 镜。
3. 动态预演型：适合打斗、追逐、复杂动作和多人对白。

选定后必须实际调用 image generation 工具。先锁角色定妆母版、人物关系、空间轴线和视觉圣经，再建立连续时间台账并分页生成。每格对应镜号和起止时间；精确镜号/时间码优先作为可编辑标注层，避免因生图文字错误重做正确画面。

画格与页面统一使用“已解析画幅”。未明确指定时画格为 16:9；只有明确竖屏意图时才为 9:16。平台名或“短视频”不得覆盖已解析画幅，竖屏发布版应从 16:9 母版派生并另列构图适配。

每页继承角色母版、相邻连续性帧、服装、道具、左右方向、光线和环境动态。局部失败只返工失败格或失败页。

## 视频生成

```text
prompt.delivery.default=direct-generation-finished-clip
prompt.out-of-model-deferral=forbidden
prompt.postproduction-handoff.requires-explicit-intent=required
```

### 视频参考代理前置门禁

存在参考视频、参考视频复刻、白模/灰模、深度视频、代理渲染或重渲染时，必须先完整读取 [video-reference-and-proxy-rerender.md](video-reference-and-proxy-rerender.md)，建立 `video_reference_proxy_plan` 并完成路线选择、通道拆分、逐参考职责和负向继承，再写代理或最终重渲染提示词。禁止把直接 R2V、深度代理、白模代理和混合代理当作固定递进步骤；按镜头控制目标自动选择最小充分路线。

代理视频是视频模型本次流程中的中间控制素材，不等于把成片职责延期给模型外后期。中间代理可以静音、无材质和无文字；最终重渲染仍受 `prompt.delivery.default=direct-generation-finished-clip` 约束，用户要求的声音、转场、特效和画内文字必须写入最终生成目标。

运行时 capability profile 还必须核验：视频参考数量、video-to-video、首帧、音频、深度/白模代理是否可作为视频参考，以及多参考能否显式分配职责。任何一项未核验都保留为 `runtime-check-required`，不得根据营销示例猜测。

用户只要求提示词、视频提示词或 Seedance 提示词时，交付物默认是可直接复制到视频模型并生成完整成片的直生提示词，而不是拍摄说明、导演阐述、分层制作单或后期交接单。

- 把成片需要的画面、动作、表演、声音、音乐、对白、转场、特效和用户要求的画内文字全部写成模型本次生成目标。
- 提示词内禁止写“后期添加、后期合成、剪辑时处理、字幕层另加、Logo 后放、配音时加入、生成后再调色”等模型外延期指令；不得用“建议后期”把困难变量移出本次生成。
- 只有用户明确要求后期方案、分层制作、剪辑交接、可编辑字幕或其他制作分工时，才输出这些内容。模型能力不明时仍写能力中性的直生提示词，不自动转成后期方案。
- 用户要求准确文字、品牌字或 Logo 直生时，在提示词内写明精确内容、位置、出现时间、清晰度与稳定性，并在生成后逐字检查。风险说明放在提示词之外，不能污染可直接复制的提示词，也不能把直生任务改成后期添加。

先核验当前账号/地区实际可用模型、时长、参考数量、音频、分辨率和局部编辑功能。把模型名称作为 capability profile，而不是创意结构。

无法进入账号界面或官方能力未确认时使用：

```yaml
capability_profile:
  status: unverified
  model_name: runtime-check-required
  prompt_mode: capability-neutral
  segment_plan: adaptive
  unverified_features: [duration, audio, video-reference-count, video-to-video, first-frame, multi-reference-role-binding, depth-proxy, white-model-proxy, local-edit, resolution]
```

此时仍可交付不依赖专有参数的高规格镜头设计，并给“当前界面支持连续时合并 / 不支持时按动作节点拆段”的自适应方案；不得把猜测写成已可用能力。

每条提示词至少包含：

```text
片段时长与画幅
制作媒介与全片风格锁定
人物/场景/道具连续性
本镜唯一主任务
空间站位与动作因果
摄影机起点、路线、速度曲线、视觉锚点、触发点、停稳落点
速度档案：主体动作、摄影机、播放倍率、特效/环境响应
真实光源、方向、衰减和环境反射
对白/声音/口型与声音桥
环境动态锚点及其来源、方向、强弱、起止
入点、出点和下一镜钩子
具体禁止项
```

其中“片段时长与画幅”必须引用已解析画幅，禁止由具体平台或旧模板二次推断。天气字段写明 `weather_motivation=user-request|reference-bound|story-causality`；未命中时不得自动补雨、雨声、湿地反光、霓虹雨夜或雨水材质。黑色电影、赛博朋克、汽车、悬疑和所谓“电影级”同样遵守此规则。

镜头含对白、旁白或人物确认时，内容先按 [dialogue-and-scene-writing.md](dialogue-and-scene-writing.md) 完成关键场次双源研究、人物知识边界和五项审计，形成 `approved_line` 后再做口型、配音和时长适配。执行层另记 `sync_line`、`protected_voice_tokens` 与改动理由；不得为了模型口型把不同角色压成同长度、同句法的万能短句，也不得用口型限制反向编写台词内容。

复杂动作、群像、口型、打斗和高密度特效按动作节点拆成短而有力的连续段。运行时允许的较长生成片段不等于单一镜头：完整打斗仍须先按 [action-and-fight-direction.md](action-and-fight-direction.md) 建立随总时长扩展的 `combatBeats` 与镜头职责，再编译成一条多镜头直生提示词或连续生成段。较长段只用于主任务清楚、空间关系已锁且动作路线有参考约束的场面。独立生成片段从本地 0 秒计时，完整成片另列累计时间。

15 秒、30 秒及更长的完整打斗提示词执行同一规则，不得把模型允许的时长直接等同于一个固定机位、一条持续对轰或一次无变化环绕。默认使用 `sequenceMode=multi-shot`；只有内部攻防与状态变化达到同等密度，且每次摄影机转位都由动作或信息触发时，才使用 `dynamic-long-take`。运行时支持一条 30 秒多镜头生成时，累计时间码、镜头切换、声音桥和全部成片要素直接写入同一条提示词；不支持时只在动作匹配点连续拆段，不削弱原有攻防、规模、力量和结果。

### 速度档案

只有速度会改变本镜结果时才展开，普通镜头保持真实自然速度。最终提示词不得用孤立的“快速、极速、缓慢、慢速”代替控制信息：

```yaml
speed_profile:
  action_speed:
    target: character-or-object
    local_range_or_trigger: 0.0-1.8s-or-event
    phase_curve: start -> accelerate -> peak -> decelerate -> settle
    path_or_relation: spatial-path-or-contact-relation
    readability_anchor: visible-path-contact-or-pose
    result_anchor: changed-position-force-or-state
  camera_speed:
    target: camera
    local_range_or_trigger: subject-action-or-information-change
    phase_curve: start -> follow -> correct -> decelerate -> settle
    path_or_relation: route-and-relative-speed-to-subject
    readability_anchor: subject-prop-or-spatial-axis
    result_anchor: final-composition
  playback_speed:
    mode: real-time
    motivation: none
    enter_at: none
    duration: none
    exit_at: none
    story_function: none
  effect_response_speed:
    target: effect-or-environment-carrier
    local_range_or_trigger: after-contact-or-activation
    phase_curve: immediate-response -> delayed-aftershock -> settle
    path_or_relation: force-direction-and-propagation-relation
    readability_anchor: force-direction-and-contact
    result_anchor: inherited-next-shot-state
```

- 只填写当前镜头实际需要的分支，但 `playback_speed.mode` 必须明确；未指定倍率变化时固定为 `real-time`。
- 快动作优先写局部时间、步数、距离、触地或接触事件，不滥用无法核验的时速。极速场面必须能读到加速路径、命中点和结果，运动模糊只服务速度感，不能遮住主体。
- 慢动作、快放或速度渐变必须把 `motivation` 写为 `user-request|reference-bound|story-causality` 之一，并写 `enter_at`、`duration`、`exit_at` 和 `story_function`；只写“电影级慢动作”或把主体的慢动作误写成播放慢动作，均视为失败。
- 慢速表演或极慢运镜仍要在镜内改变动作、信息、关系、证据、空间或声音状态；删除后无损的慢段直接删除。

可执行示例：

```text
全程实时播放。角色在 0.4 秒内由静止爆发，沿画面左向右完成三步加速，第三步触地达到峰值；摄影机晚 0.1 秒启动，以略低于角色的速度横向追随，在接触前追平并减速停稳。衣摆和尘土在触地后延迟响应，保留清楚的轨迹、接触和受力结果；禁止慢动作、抽帧、瞬移和无动机速度拉伸。
```

## 动作与摄影机

强运镜写清摄影机为何在躲避、追赶、抢位、承受冲击或跟随视线。每镜至少清楚呈现起势、接触、结果之一；用方向、视线、兵器轨迹、环境反馈或声音桥维持空间连续。

完整打斗的摄影机按序列分工，而不是全程使用同一种“炫技运镜”。镜头职责可承担空间建立、追随压力、与主体闪避、接触澄清、承受冲击、揭示反转或重标定结果；只换景别、角度、粒子亮度或环绕方向而没有新增战术信息，不构成新的镜头任务。固定机位只可作为短暂空间基准或有明确画内调度的反差，不能被动记录整段战斗。

能量对撞、对波或光束对轰只能是战斗中的一个发展阶段。该阶段写清初始平衡、至少两次可见压力转移、战术介入或能力变招、破局条件、环境受力与最终结果；能量线长期停在原位、只增亮光效或以爆炸遮住结果均视为失败。

摄影机像有重量的真人设备：有起步、跟随、修正和停稳，不无故漂移、绕圈或推拉。运镜删掉后若不改变信息、关系、空间或观众参与方式，就删除。

速度关键镜头中，摄影机速度必须相对主体速度书写：领先、同速、落后、追平或脱离，并标明由哪个动作/信息触发改变。主体、摄影机和环境不得被“快速”一词绑成全画面同速运动；播放倍率也不得随动作形容词自动改变。

每个镜头至少有一个符合物理条件的环境动态锚点，但环境动态是主戏底噪，不得遮挡口型和关键动作，也不得用来填时长。

## 文字层

- 故事板镜号、技术时间码等制作标注：使用可编辑、可校验的文字层。
- 直生视频中用户要求的字幕、产品参数、品牌字与 Logo：直接写入提示词作为画内生成目标，写清内容、位置和出现时间并逐字检查；不得擅自改成后期文字层。
- 画面中的招牌或界面若必须参与剧情：写清准确内容、位置、出现时间，同时准备干净替换区。
- 二维码：确定目标 URL 后使用可靠二维码工具生成，实际扫码验证，再进入最终版；不得使用生图模型的伪二维码。

## 返工

第一轮只改一个已确认失败变量并锁住其他正确部分；第二轮可拆镜或换机位；第三轮重做首帧、关键帧、参考职责或创意关系。区域错误优先区域编辑，叙事逻辑、人物动线或镜头结构错误才重做整段。

高风险镜头同时保留：

- 高规格忠实执行版：预演、参考绑定、分层和连续拆镜保住原规格。
- 同等震撼创意重构版：改变动作关系、空间机关、揭示方式或声音落点，实现同一观众承诺。

## 时间轴机器检查

有起止时间码的分镜或故事板应同时维护 JSON 台账。根必须是对象，`shots` 必须始终是数组；每镜至少包含原生 JSON 字符串 `id`、`kind`、`storyFunctionType`、`storyFunction`，以及原生数字或时间码字符串 `start`、`end`。即使只有一个镜头也不得把 `shots` 写成对象。`keyframes` 出现时必须是对象数组，每项使用字符串 `id` 和数字或时间码字符串 `at`。

完整打斗台账另在根声明 `sequenceType=fight`、`fightScope=complete-sequence|isolated-beat`、`sequenceMode=multi-shot|dynamic-long-take`、`fightReferenceSet[]` 与 `combatBeats[]`。有效战斗拍下限为 `max(3, ceil(totalDuration / 5s))`，相邻有效状态变化不得间隔超过 6 秒；多镜头模式的镜头下限为 `max(2, ceil(requiredBeats / 2))`。每拍记录时间范围、阶段、目的、对手应对、摄影机计划/目的、阶段结果、主导权前后状态和真实状态变化；动态长镜另记 `cameraTransition`、`trigger`、`visualAnchor` 与 `settlePoint`。

```text
timeline.shots.type=array
timeline.kind.required=true
timeline.scalar-types.strict=true
timeline.padding.scan=all-string-leaves
timeline.reaction-aliases=canonicalized
```

`kind` 必须精确取 `action|dialogue|reaction|transition|establishing|insert|montage` 之一；`storyFunctionType` 必须精确取 `dialogue|action|information|relationship|emotion|space|evidence|sound|continuity` 之一，枚举大小写不自动纠正。所有必填字符串在 NFKC 归一化并移除 Unicode `Cf/Cc` 字符后仍须非空，禁止用单元素数组、布尔、数字或零宽字符冒充字符串。

校验器递归扫描每个镜头的全部字符串叶节点；`filler`、`fillers`、`padding`、`padded`、独立纯反应及对应中文表达无论藏在 `storyFunction`、`description`、提示词、备注或关键帧内都必须失败。反应识别统一覆盖 `kind`、`shotType`、`beatType`、`storyFunction`、`description` 等语义字段中的 `reaction`、`reaction-beat`、`reaction-shot` 和中文别名；超过 0.5 秒时，`stateChange` 与 `exitPoint` 必须是语义非空的原生 JSON 字符串。禁止 `standaloneReaction: true`。

动作、摄影机、特效或环境等运动字段出现强速度词时，镜头 JSON 同时携带本页定义的四轨 `speed_profile`。`playback_speed` 始终必填；动作、摄影机、特效/环境分支按实际命中填写，并统一使用 `target`、`local_range_or_trigger`、`phase_curve`、`path_or_relation`、`readability_anchor`、`result_anchor`。慢动作/快放另需非空 `motivation`、`enter_at`、`duration`、`exit_at` 与 `story_function`；明确瞬移则使用 `movement_mode=teleportation` 并记录动机、触发与到达状态。

在仓库内交付此类台账时运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-storyboard-timeline.ps1 -InputPath <timeline.json>
```
