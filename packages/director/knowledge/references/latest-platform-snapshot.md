# 最新平台观察快照

> 本快照只用于冷启动。热榜超过 6 小时、挑战/短剧榜超过 24 小时、样本观察超过 72 小时后必须重新浏览；过期数据只能作为历史灵感，不能声称“当前最火”。

```yaml
captured_at: "2026-08-07T08:29:46+08:00"
timezone: "Asia/Shanghai"
freshness:
  hot_rank_ttl: "6h"
  challenge_and_drama_ttl: "24h"
  sample_observation_ttl: "72h"
official_entries:
  douyin_hot: "https://www.douyin.com/hot"
  kuaishou_index: "https://index.e.kuaishou.com/rank"
  kuaishou_brilliant: "https://www2.kuaishou.com/brilliant"
  bilibili_popular: "https://www.bilibili.com/v/popular/all/"
  bilibili_rank: "https://www.bilibili.com/v/popular/rank/all"
```

## 已核验样本

### 抖音：挑战100小时举办一场婚礼

```yaml
platform: douyin
source_url: "https://www.douyin.com/hot/2599352/挑战100个小时举办一场婚礼"
captured_at: "2026-08-07T08:29:46+08:00"
published_at: "2026-08-05T21:07:00+08:00"
duration: "39:27"
rank_or_heat: "942.8万热度（抓取时点可见口径）"
evidence_level: A
observation_context: project-snapshot
replayed_current_turn: false
observed_scope: ["00:00-00:26", "约01:02", "约11:32", "约31:29"]
transcript_provenance: watched-partial-visual
audio_verified: false
verified_mechanism:
  - "评论区真实问题迅速转成可量化限时任务"
  - "时间压力、人物关系和连续障碍推进同一目标"
  - "长内容用任务里程碑而非空停顿维持兑现"
reuse_boundary: "只转译限时任务、共同完成任务的关系证明和里程碑结构；不复刻真实情侣、婚礼流程或未核验音乐"
freshness_risk: "样本观察72小时后只能作为历史灵感；热度6小时后不再视为当前值"
rights_risk: "公开可播放不等于可转载或可商用；关系、婚礼流程与音乐均不直接复制"
```

### B站：特效小哥大战网吧女王

```yaml
platform: bilibili
source_url: "https://www.bilibili.com/video/BV1xvuc66EU5"
captured_at: "2026-08-07T08:29:46+08:00"
published_at: "2026-08-05T12:00:00+08:00"
duration: "03:17"
rank_or_heat: "149.7万播放（抓取时点可见口径）"
evidence_level: A
observation_context: project-snapshot
replayed_current_turn: false
observed_scope: "00:00-约00:21"
transcript_provenance: watched-partial-visual
audio_verified: false
verified_mechanism:
  - "普通网吧第一帧出现发光异常物"
  - "约9秒进入强特效冲突，约21秒升级为第一人称攻防"
  - "弹幕与站队投票把观看变成参与"
reuse_boundary: "只转译日常空间异化、即时规则冲突、视角升级与站队机制；不复刻角色、武器、特效造型、音乐和动作编排"
freshness_risk: "样本观察72小时后只能作为历史灵感；排名/播放量需重新核验"
rights_risk: "页面标注未经授权禁止转载"
```

### 快手：辅导作业 emo 了

```yaml
platform: kuaishou
source_url: "https://www.kuaishou.com/short-video/3xj9dymhsibpq96"
captured_at: "2026-08-07T08:29:46+08:00"
published_at: "not-visible"
rank_or_heat: "not-visible"
evidence_level: C
observation_context: project-snapshot
replayed_current_turn: false
observed_scope: null
transcript_provenance: metadata-only
access_result: "详情页提示浏览器版本过低，未能播放"
metadata_hypothesis: "家庭任务与职业技能错位"
verified_mechanism: []
reuse_boundary: "只进入创意野生期；禁止据此拆镜头、台词、声音或表演"
freshness_risk: "标题级线索24小时后重新核验"
rights_risk: "未播放、未确认内容与授权；不可复刻"
```

## 当前跨平台刺激

仅作为本次抓取时点的工作假设：

- 可量化任务和时间压力，比背景解释更快形成信息债。
- 日常空间中的异常规则、隐藏入口、身份/技能反杀与经营任务仍有较强标题吸引力。
- 关系内容通过共同做事、失败补救和选择成本表达，不依赖独立凝视。
- 第一帧异常物、快速进入冲突、视角升级和评论站队可形成参与链。
- 年代错置、空间入口、无限规则、AI/末世和“普通身份+离谱技能”已经出现同质化风险，需要更换人物处境、因果、空间机关和结尾，不只换皮。

## 使用限制

- 本快照未记录 `observed_range_creation_mode` 与 `origin_evidence`，因此在补做来源核验前，任何条目都不能直接进入 `referenceSet` 或 `fightReferenceSet`；尤其不得把 AI 生成/来源不明内容当作剧情、镜头、动作或表演参考。
- 抖音与快手总榜新闻占比高，不能直接当剧情榜；剧情任务同步检查快手挑战/短剧榜和 B站综合热门。
- A 级也只能拆已观看范围；本快照没有可靠 B 级完整字幕，音频均未核验。
- C 级标题只用于发散，不作为运镜、声音、表演或完整结构证据。
- 热榜、公开可播放和高播放量不等于可转载或可商用。
