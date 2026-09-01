# 视频参考、白模/深度代理与重渲染

## 目录

- 定位与底层判断
- 强制契约
- 自动路由
- 通道与参考职责
- 白模代理
- 深度代理
- 最终重渲染
- 验收与返工
- 权利与研究证据

## 定位与底层判断

本能力用于把参考视频中的运镜、构图、动作、空间、遮挡和接触关系转移到新的角色、场景与视觉风格。它是模型中立的控制协议，不绑定某个平台或固定版本。

工程推断：直接引用原视频时，动作和摄影机信息常与人物身份、服装、场景、材质、灯光和风格纠缠。深度代理或中性白模代理先降低外观语义，再把结构控制权交给代理视频，把身份、场景和风格控制权交给目标图片与提示词。这是根据公开案例和官方多参考能力抽象出的工作方法，不代表任何模型未公开的网络、潜空间或训练架构。

“白膜”是用户常见误写，统一解释为“白模”；规范字段和正式交付始终使用“白模”。

## 强制契约

```text
video-reference.proxy-routing=required
video-reference.channel-decomposition=required
video-reference.depth-proxy.not-3d=required
video-reference.white-model.neutralization=required
video-reference.proxy.duration-and-timing-alignment=required
video-reference.proxy.playback-speed-preservation=required
video-reference.proxy.reference-roles=required
video-reference.proxy.negative-inheritance=required
video-reference.runtime-verification=required
video-reference.proxy.intermediate-silence-allowed=true
video-reference.final-delivery=direct-generation-finished-clip
```

存在参考视频时，先建立 `video_reference_proxy_plan`，再写代理生成或最终重渲染提示词：

```yaml
video_reference_proxy_plan:
  source_and_rights:
    source_id: source-video-01
    source_url: required
    authorization_status: R0-owned-or-licensed|R1-user-asserted|R2-unknown|R3-restricted
    reference_use_mode: internal-study|licensed-recreation|publishable-translation
    release_hold: true|false
    evidence_level: A|B|C|D|primary-official
    observed_scope: required
    visual_status: viewed|partially-viewed|not-viewed
    audio_status: verified|not-verified|not-present
    transcript_provenance: publisher-text|embedded-subtitles|reliable-transcript|none
  runtime_capabilities:
    status: verified|unverified
    model_name: runtime-check-required
    video_reference_count: runtime-check-required
    video_to_video: runtime-check-required
    first_frame: runtime-check-required
    audio: runtime-check-required
    multi_reference_role_binding: runtime-check-required
    accepts_depth_proxy: runtime-check-required
    accepts_white_model_proxy: runtime-check-required
  target_intent: required
  route: direct-r2v|depth-proxy|white-model-proxy|hybrid-proxy|keyframe-previs
  route_reason: required
  preserve_channels: []
  replace_channels: []
  negative_inheritance: []
  reference_roles:
    - asset_id: required
      media_type: video|image|audio
      role: motion|identity|scene|style|first-frame|audio
      positive_inheritance: []
      negative_inheritance: []
  proxy_contract:
    duration_and_timebase: required
    shot_boundaries: required
    structural_controls: []
    removed_semantics: []
  rerender_contract:
    final_identity_scene_style: required
    final_audio_and_text: required
    continuity_constraints: []
  qa_checkpoints: []
  failure_evidence: []
  fallback_route: required
```

内部台账维护完整字段；用户只要提示词或成片方案时，只外显当前执行所需的路线、参考职责和关键约束。

## 自动路由

按以下条件选择单一路线，不把五种路线机械地全部交付：

1. `direct-r2v`：原片人物、场景、光线或风格也应被继承，或原片外观与目标一致、控制污染很低。仍须写继承项与禁继承项。
2. `depth-proxy`：核心目标只有摄影机、人体/物体运动、轮廓、相对深度和遮挡，且没有精细接触、多层透明反射或复杂拓扑变化。
3. `white-model-proxy`：需要同时保留构图、空间调度、道具接触、场景几何、尺度、遮挡和动作因果，但必须更换人物身份、场景、材质、灯光或风格。
4. `hybrid-proxy`：单一代理已实测不能同时守住关节/接触与逐帧深度，且运行时确认支持多个视频参考和明确的参考职责隔离。没有失败证据时不得默认叠加，以免控制信号冲突。
5. `keyframe-previs`：账号能力不支持、参考权利受限、代理连续性失败，或镜头更适合用首尾帧、关键姿势、分段预演与原创动作重构。

透明/反射主体、精细手指、强自遮挡、多人交叉、精确刚体接触、大视角变化、面部表演和口型不能默认只走深度代理。优先换成白模、混合代理或关键帧预演，不先削弱人数、速度、力量与场面规模。

## 通道与参考职责

`preserve_channels` 从以下集合按任务选择：时长、帧节奏、镜头边界、摄影机路径、焦段/透视变化、构图、人物数量与站位、动作时序、关键姿势、道具轨迹、接触点、相对深度、遮挡次序、特效触发点，以及用户明确要求继承的声音。

`replace_channels` 默认包括：人物身份、脸发、服装细节、场景设计、纹理材质、灯光色彩、视觉风格、Logo、文字，以及用户未明确要求继承的原片音频。

每个输入只分配一个主职责：

- `motion`：摄影机、动作、构图、空间、遮挡与接触；深度或白模代理归入此职责。
- `identity`：角色脸、发型、体型、服装与稳定识别特征。
- `scene`：空间类型、几何、布景和环境物件。
- `style`：材质语言、色彩、笔触、渲染或摄影风格。
- `first-frame`：成片初始构图、姿势和连续性状态。
- `audio`：对白、声线、音乐、音效或节奏，仅在权利与运行时能力允许时使用。

每个参考同时写 `negative_inheritance`。发生冲突时按用户硬约束与已确认权利优先，再按 `motion > identity > scene > style` 处理结构性镜头；首帧只锁入点，不得无意覆盖整段运动。若一个素材承担多个目的，先确定唯一主职责，其余信息显式列入禁止或次级继承，不能让模型自行猜权重。

## 白模代理

白模阶段的生成目标是中性结构预演，而不是风格化成片：

- 逐段对齐源片时长、时间基准、镜头边界、摄影机起停、构图、人物数量/站位、关键姿势、动作节奏、道具轨迹、接触结果、遮挡和空间尺度。
- 人物使用中性哑光白/浅灰材质，保留三维体积、肢体比例、服装外轮廓与清楚手型；不保留脸、发色、衣服纹样和身份特征。
- 保留承担接触、受力或战术因果的道具，并改成无纹理代理体；删除纯装饰物、Logo、字幕和界面。
- 使用中性代理地面与必要的粗几何块表达台阶、墙面、门洞、掩体和前后景深度；禁止继承源片灯光风格、反射、材质、配色、天气和装饰性背景。
- 不添加扫描线、HUD、点云、深度伪彩或“技术演示”视觉包装。中间代理可静音，但不得改变原片的动作节拍或播放倍率。

白模检查至少覆盖：主体数量、四肢完整、道具不融合、接触点成立、脚底不滑、空间轴线稳定、摄影机落点一致、全段无源片风格泄漏。

## 深度代理

深度代理是按时间对齐的逐帧 2.5D 距离/轮廓控制序列，不是带材质、骨骼和自由视角能力的三维模型。

- 生成前明确近/远极性；无法从工具确认时，以前景人物、地面和背景的可辨深度关系做小段测试，不凭颜色名称猜极性。
- 对齐源片时长、帧节奏、镜头切点、主体轮廓、相对深度、遮挡进入/退出和摄影机变化。
- 检查边缘闪烁、深度呼吸、轮廓断裂、人物消失、前后景翻转、多人粘连和遮挡穿帮。
- 最终重渲染明确禁止从深度视频继承脸、发型、服装外观、材质、灯光、文字和声音；目标角色图负责身份与服装。
- 深度无法表达的精细接触、内部旋转、反射/透明关系或被完全遮挡的关节，不得靠更强提示词假装已经解决。

## 最终重渲染

最终生成以代理视频为 `motion`，目标角色图为 `identity`，场景图为 `scene`，风格图为 `style`；没有对应输入时才由文字补足。提示词必须写清：

- 成片身份、场景、材质、灯光、色彩和风格全部服从目标参考，不服从代理源。
- 初始人物数量、站位、姿势、摄影机和关键道具状态与代理入点一致；动作全过程保留准备、轨迹、接触和受力结果。
- 全程保持人物轮廓与关节稳定，禁止跳帧式位移、肢体融合、人物消失、凭空新增对象、道具穿模和空间拓扑突变。
- `playback_speed` 默认保持源片实时倍率；只有用户明确要求或叙事因果成立时才改变，并记录进入点、持续时间、退出点和功能。
- 中间代理允许没有声音，最终成片仍须把用户要求的对白、音效、音乐、环境声、字幕和画内文字写成本次模型生成目标；不得默认推迟给后期。

## 验收与返工

使用时间对齐的结构检查，不要求与源片像素相似：

1. 在起始帧、关键姿势、接触/遮挡点、镜头转折和结束帧设置 `qa_checkpoints`。
2. 每个检查点比较摄影机位置与方向、构图、主体数量/位置、姿势、道具关系、相对深度、遮挡和动作相位。
3. 拒收运镜漂移、动作错拍、接触缺失、肢体/道具融合、人物丢失、空间拓扑突变、源片身份/服装/场景/风格泄漏，以及目标身份失真。
4. 第一次返工只修错误的通道所有权或路线；第二次修代理时间/结构对齐；第三次排查多参考职责冲突；仍失败才局部补关键帧或按动作节点拆段。
5. 每次记录 `failure_evidence` 和修改变量，锁住已正确部分；不得用缩小场面或长停顿掩盖代理失败。

最低验收场景包括：外观一致的直接 R2V、单人运镜动作的深度代理、带道具接触的白模代理、多人遮挡的混合/关键帧降级、参考职责冲突、运行时不支持，以及公开发布权利不足时的原创转译。

## 权利与研究证据

参考视频进入流程时遵守 [rights-and-provenance.md](rights-and-provenance.md)。R1/R2 的高还原工作固定为 `internal-study` 且 `release_hold=true`；公开发布缺少覆盖具体镜头、动作、人物、声音和用途的 R0 证据时，使用 `publishable-translation`，只保留机制与动作因果并重建独特表达。

以下记录用于形成方法，不作为当前账号能力或发布授权证明：

```yaml
- source_id: x-pixverse-white-model-demo
  source_url: https://x.com/PixVerse_/status/2086368766561227124/video/1
  captured_at: 2026-08-09T16:30:00+08:00
  platform: X
  evidence_level: A
  observed_scope: 实际观看约 9.6 秒画面，成片动作镜头与中性白模代理交替展示
  visual_status: viewed
  audio_status: not-verified
  transcript_provenance: publisher-text
  learned_mechanisms: [白模去外观语义, 运镜动作与最终风格分离, 结构代理后重渲染]
  do_not_copy: [示例人物, 独特镜头成片, 发布文案, 品牌和原音]
  authorization_status: R2-unknown
  reference_use_mode: internal-study
  release_hold: true

- source_id: x-tanlu-depth-white-model-tutorial
  source_url: https://x.com/TanLuAI/status/2086023224744382860/video/1
  captured_at: 2026-08-09T16:30:00+08:00
  platform: X
  evidence_level: A
  observed_scope: 实际观看约 100 秒教学画面，覆盖源视频转白模、白模加角色图重渲染、深度视频生成及深度加角色图复刻
  visual_status: viewed
  audio_status: not-verified
  transcript_provenance: publisher-text-and-visible-ui
  learned_mechanisms: [白模保留调度和几何, 深度保留轮廓和相对距离, 目标图片接管身份与场景, 两类代理按镜头条件分流]
  do_not_copy: [示例素材, 独特提示词排列, 平台界面, 人物和原音]
  authorization_status: R2-unknown
  reference_use_mode: internal-study
  release_hold: true

- source_id: bytedance-official-multireference-capability
  source_url: https://seed.bytedance.com/en/blog/seedance-2-0-official-launch
  captured_at: 2026-08-09T16:30:00+08:00
  platform: ByteDance Seed
  evidence_level: primary-official
  observed_scope: 官方说明图像、视频和音频多参考可控制主体、动作、风格、场景与运镜
  transcript_provenance: official-page
  runtime_proof: false

- source_id: bytedance-official-technical-report
  source_url: https://arxiv.org/pdf/2604.14148
  captured_at: 2026-08-09T16:30:00+08:00
  platform: arXiv
  evidence_level: primary-official
  observed_scope: 官方技术报告把主体、动作、风格和编辑拆成独立评测维度，并展示视频动作参考与图像身份参考的组合任务
  transcript_provenance: official-paper
  runtime_proof: false
```

官方页面和报告只能证明公开描述的能力范围，不能替代当前账号对参考数量、时长、音频、首帧、代理接受方式和多参考角色隔离的运行时核验。
