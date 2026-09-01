# 权利、来源与发布清场

## 目录

- 原则
- 授权状态
- 参考使用模式
- 素材台账
- 创意与发布分层
- 高风险类别

## 原则

```text
rights.clearance=required
face-change.does-not-equal-rights-clearance=required
```

创意忠实度和发布权利是两条并行轨道。不要因为需要核验权利就偷偷改掉用户指定的角色、Logo或声音；也不要因为用户要求保留就声称商业发布一定安全。

本检查不是法律意见。商业发布、真人身份、医疗金融、儿童、真实灾难或争议项目需要客户法务、平台规则或权利人确认。

## 授权状态

- `R0-owned-or-licensed`：用户/客户自有，或已有明确许可、公共领域/适用开放许可。记录证据和使用范围。
- `R1-user-asserted`：用户明确表示有权使用，但项目中没有证据。只允许内部继续推进，`release_hold=true`，等待授权证明归档；不得直接进入公网或商业发布。
- `R2-unknown`：权利不明。可做内部探索或原创转译；商业发布前必须确认或替换。
- `R3-restricted`：涉及冒用身份、无授权声音克隆、私密素材、误导性真实事件或明显禁止用途。停止该实现，提供不改变核心观众承诺的安全重构。

## 参考使用模式

涉及现有动漫、电影、电视剧、游戏、热点短视频、名场面、镜头、招式、技能、音乐或声音时，必须先选择且只选择一种：

- `internal-study`：用户要求高还原且没有声明公开用途，或授权状态为 R1/R2。允许内部研究镜头排列、角色动作、招式/技能因果、声音设计与表演语法；不得偷偷原创化。固定 `release_hold=true`，产物不得直接发布。
- `licensed-recreation`：仅在 `authorization_status=R0-owned-or-licensed`，且证据明确覆盖所用元素、用途、地区和期限时使用。只在许可范围内公开高还原；超出范围的元素另行取得许可或转入 `publishable-translation`。
- `publishable-translation`：已声明公网/商业发布但关键参考缺少 R0 时使用。可以保留人性观察、类型机制、观众承诺和动作因果，但必须重建角色整体识别、镜头排列、台词、技能表现、音乐、原声与独特音效，不得只换人物的脸。

换脸、改名、换服装或换场景都不自动清除作品、表演、声音、肖像、商标或其他权利。原录音与仍能识别特定自然人的声线/声纹必须单独记录来源、许可和身份同意；不能以“脸不一样”放行声音或整体可识别表达。

## 素材台账

对真实人物、品牌、现有 IP、音乐、视频、图片、声音和台词记录：

```yaml
asset_id:
element_type: character-design|real-person-identity|dialogue-story|shot-sequence|choreography-skill|music-composition|sound-recording-sfx|voice|brand-logo|other
source_url:
owner_or_rightsholder:
authorization_status: R0-owned-or-licensed|R1-user-asserted|R2-unknown|R3-restricted
reference_use_mode: internal-study|licensed-recreation|publishable-translation
release_hold: true|false
identity_detectable: true|false|unknown
ai_disclosure_status: not-applicable|planned|embedded-and-visible|verified|unknown
permitted_use: internal|organic|paid-media|commercial|unknown
territory:
term:
evidence_location:
captured_at:
notes:
```

平台热榜、搜索结果和公开可观看不等于可自由商用。

动漫、电影、电视剧、正式剧本和短视频作为台词学习来源时，同样进入素材台账。`learned_mechanisms` 只记录关系博弈、信息释放、语域、节奏和口语密度等方法；`do_not_copy` 明列标志性台词、独特对白排列、角色专属称呼与声音表达。研究证据达到 A/B 级只说明判断有依据，不等于来源表达已获发布许可。

`release_hold=false` 不能由用户一句“可以发”自动得出：`licensed-recreation` 需有覆盖本元素的 R0 证据，`publishable-translation` 需完成逐项重建与独立权利清场。R1 一律保持发布锁定。

## 创意与发布分层

- 内部提案：允许保留用户指定参考，但清楚标记来源和待确认项。
- 原创转译版：保留人性、机制、类型骨架和观众承诺，重写独特角色、台词、音乐、Logo、镜头排列和名场面表达。
- 授权二创版：按许可范围保留 IP 元素，并维护角色、声音和世界连续性。
- 商业发布版：所有关键素材必须达到 R0，或取得法务/权利人明确放行。
- 公网发布的 AI 生成合成内容：按当前适用规则和平台能力规划显式/隐式标识，记录 `ai_disclosure_status` 并在交付前验证；不得用“内部提案”标签绕过实际公开发布的标识要求。

核验入口（执行时检查现行版本）：[《中华人民共和国著作权法》](https://www.npc.gov.cn/c2/c30834/202011/t20201119_308796.html)、[最高人民法院关于声音权益的典型案例及民法典条文指引](https://www.court.gov.cn/zixun/xiangqing/466131.html)、[《人工智能生成合成内容标识办法》](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)。

## 高风险类别

- 真人脸、姓名、声音、经历或可识别身份。
- 未确认授权的角色、台词、Logo、歌曲、歌词、旋律、MV、原声和独特音效。
- 把真实品牌放进负面剧情、竞品比较或未经证明的功效宣称。
- 儿童、患者、受害者、灾难、公益募捐、医疗效果、金融收益和伪新闻。
- 隐藏 AI 生成事实以冒充真实采访、真实证明或权威背书。

遇到上述内容时，先确认创作目的、发布范围和授权状态；不能确认时给出原创转译或虚构替代，不虚构已有授权。
