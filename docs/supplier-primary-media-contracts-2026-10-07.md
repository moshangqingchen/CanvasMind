# 主三家供应商完整媒体合同核对 · 2026-10-07

本轮独立 fresh HTTPS GET 94 次，全部 200，0 次 429，窗口 2026-10-08T01:54:21.205Z–2026-10-08T01:55:16.364Z（PDT 18:54:21–18:55:16）。完整覆盖沧元 37 视频+2音乐、喵呜 **11视频**、创想34视频，加 Nano2.1 图片，共85个逐型号条目。另沧元全部72个已发布视频合同均已复读。没有收费生成、修改Key或写正式数据库。

喵呜原9型号探针清单漏了 seedance-2.0-deal 与 jimeng-seedance-2.5，本矩阵已完整计入。现有2Key对9型号的18个model_schema请求均403，不能把受限结果说成新参数为空。创想6个Key的fresh /v1/models均200但无视频分组型号，因此逐型号未公开的秒数上下限、比例枚举仍标为未知；保留正整数秒与可选比例控件，不从其他供应商借用型号合同。

沧元视频全部走 POST /v1/videos，异步 GET /v1/videos/{taskId}。已按每型号文档恢复 generate_audio、SD10 camera_movement、官转 face_mode、参考数组/首尾帧的数量及互斥；MM3参考视频对象由真实 durationSeconds 构造，缺真实时长先报错。SD12 base=18秒合计、fast=25秒合计、mini参考≤15秒分别处理，SD14输出+参考≤25秒；不把所有同族线路当同一合同。

创想固定成片下载为 GET /v1/videos/{taskId}/content，需创建任务的原Key；409继续查询原任务，下载鉴权不能转发到外域。公开正文未声明 generate_audio、seed 或 camera_movement，不添加这些收费请求字段。八个重新列出的旧ID已补支持，不称其为新发布。

价格按当前来源和分组倍率计算。沧元CNY、喵呜原quota×7再乘分组倍率、创想原CNY×模型effective_rate_multiplier（当前视频0.1），不重复乘分组。Lyria¥0.25/次；Grok视频按秒；其他每次模型不能再乘秒数。3个沧元官转按视频tokens和含/无参考视频条件计费，生成前实际tokens未知，已显示费率且阻止错误总额。

Nano2.1独立Images合同：generations/edits JSON，size只十比例、quality=1k/2k/4k，¥0.06/0.08/0.10每张，n只能1、14张HTTPS PNG/JPEG/WebP参考、单图≤35MB、无mask。额外两次dedicated文档GET均TLS ECONNRESET；引用本任务18:26:42 PDT成功读到的官方文档及18:54新pricing匹配合同，明确不声称失败请求为成功。

逐型号所有正式字段说明、实际控件与transport、媒体尺寸/格式/字节/时长限制、计费原始表达式、各组准确价格和证据hash在 companion JSON 中。以下仅为便于查看的合同与价格矩阵。

## cangyuan

| 型号 | 媒体 | 标量控件/范围 | 参考图/视频/音频 | 当前价格 |
| --- | --- | --- | --- | --- |
| sd11-seedance-2.0-fast | video | duration: 4–15; aspect_ratio: 16:9/4:3/1:1/3:4/9:16/21:9/adaptive; resolution: 480p/720p; generate_audio: boolean; seed: 0 | 9/3/3 | VIDEO: 720p ¥7.4/请求 · 480p ¥3.5/请求 ; 全模型-无claude/gpt: 720p ¥7.4/请求 · 480p ¥3.5/请求  |
| sd11-seedance-2.0-mini | video | duration: 4–15; aspect_ratio: 16:9/4:3/1:1/3:4/9:16/21:9/adaptive; resolution: 480p/720p; generate_audio: boolean; seed: 0 | 9/3/3 | VIDEO: 720p ¥4.7/请求 · 480p ¥2.2/请求 ; 全模型-无claude/gpt: 720p ¥4.7/请求 · 480p ¥2.2/请求  |
| grok-imagine-video | video | duration: 1–15; aspect_ratio: 16:9/9:16/1:1; resolution: 480p/720p | 1/0/0 | VIDEO: 720p ¥0.11/秒 · 480p ¥0.08/秒 ; 全模型-无claude/gpt: 720p ¥0.11/秒 · 480p ¥0.08/秒  |
| doubao-seedance-2-5-260628 | video | duration: 4–30; aspect_ratio: 16:9/9:16/1:1/21:9/4:3/3:4; resolution: 720p; generate_audio: boolean; seed: integer; face_mode: boolean | 9/3/3 | VIDEO-Seedance官转: 含参考视频 ¥28.56/1M 视频 tokens · 无参考视频 ¥47.6/1M 视频 tokens  |
| mm2-minimax-h3 | video | duration: 4–15; aspect_ratio: 16:9/4:3/1:1/3:4/9:16/21:9/adaptive; resolution: 768P/2K; seed: 0 | 9/3/3 | 全模型-无claude/gpt: 2k ¥14/请求 · 768p ¥9.9/请求 ; VIDEO: 2k ¥14/请求 · 768p ¥9.9/请求  |
| kl1-kling-3.0 | video | duration: 3–15; aspect_ratio: 16:9/9:16/1:1; resolution: 720p/1080p; generate_audio: boolean; seed: 0 | 0/0/0 | VIDEO: 1080p ¥6.1/请求 · 720p ¥4.6/请求 ; 全模型-无claude/gpt: 1080p ¥6.1/请求 · 720p ¥4.6/请求  |
| sd13-seedance-2.5 | video | duration: 4–30; aspect_ratio: auto/21:9/16:9/4:3/1:1/3:4/9:16; resolution: 480p/720p; generate_audio: boolean | 30/10/0 | VIDEO: 720p ¥22.14/请求 · 480p ¥10.32/请求 ; 全模型-无claude/gpt: 720p ¥22.14/请求 · 480p ¥10.32/请求  |
| omni-v2v | video | aspect_ratio: 16:9/9:16 | 5/2/0 | VIDEO: ¥0.88/次 request; 全模型-无claude/gpt: ¥0.88/次 request |
| sd11-seedance-2.5 | video | duration: 4–30; aspect_ratio: 16:9/4:3/1:1/3:4/9:16/21:9/adaptive; resolution: 480p/720p/1080p; generate_audio: boolean; seed: 0 | 30/10/10 | VIDEO: 1080p ¥29/请求 · 720p ¥19/请求 · 480p ¥12.8/请求 ; 全模型-无claude/gpt: 1080p ¥29/请求 · 720p ¥19/请求 · 480p ¥12.8/请求  |
| mm2-minimax-h3-max | video | duration: 5–15; aspect_ratio: 16:9/4:3/1:1/3:4/9:16/21:9/adaptive; resolution: 480P/768P; seed: 0 | 9/3/3 | VIDEO: 768p ¥8.9/请求 · 480p ¥5.8/请求 ; 全模型-无claude/gpt: 768p ¥8.9/请求 · 480p ¥5.8/请求  |
| wan4-wan3.0 | video | duration: 2–30; aspect_ratio: adaptive/16:9/9:16/1:1/4:3/3:4; resolution: 480P/720P/1080P; generate_audio: boolean; seed: 0 | 10/5/5 | VIDEO: 1080p ¥20.7/请求 · 720p ¥10.3/请求 · 480p ¥5.2/请求 ; 全模型-无claude/gpt: 1080p ¥20.7/请求 · 720p ¥10.3/请求 · 480p ¥5.2/请求  |
| kling-3.0 | video | duration: 3–15; aspect_ratio: 16:9/1:1/9:16; generate_audio: boolean | 1/0/0 | VIDEO: ¥2.5/次 request; 全模型-无claude/gpt: ¥2.5/次 request |
| sd13-seedance-2.0 | video | duration: 4–15; aspect_ratio: auto/21:9/16:9/4:3/1:1/3:4/9:16; resolution: 480p/720p/1080p/4k; generate_audio: boolean | 9/3/0 | VIDEO: 1080p / 4k ¥15.96/请求 · 480p / 720p ¥7.11/请求 ; 全模型-无claude/gpt: 1080p / 4k ¥15.96/请求 · 480p / 720p ¥7.11/请求  |
| omni-fast | video | aspect_ratio: 16:9/9:16 | 5/0/0 | VIDEO: ¥0.66/次 request; 全模型-无claude/gpt: ¥0.66/次 request |
| niulai-pro | video | duration: 4–15; aspect_ratio: 16:9/9:16/1:1/4:3/3:4/21:9/adaptive; resolution: 768p/2k | 9/3/3 | 全模型-无claude/gpt: 2k ¥3.9/请求 · 768p ¥2.9/请求 ; VIDEO: 2k ¥3.9/请求 · 768p ¥2.9/请求  |
| omni-v2v-no-water | video | aspect_ratio: 16:9/9:16 | 5/2/0 | VIDEO: ¥1/次 request; 全模型-无claude/gpt: ¥1/次 request |
| grok-imagine-video-1.5 | video | duration: 1–15; aspect_ratio: 16:9/9:16/1:1; resolution: 480p/720p/1080p | 7/0/0 | VIDEO: 1080p ¥0.32/秒 · 720p ¥0.168/秒 · 480p ¥0.116/秒 ; 全模型-无claude/gpt: 1080p ¥0.32/秒 · 720p ¥0.168/秒 · 480p ¥0.116/秒  |
| doubao-seedance-2-0-260128 | video | duration: 4–15; aspect_ratio: 16:9/9:16/1:1/21:9/4:3/3:4; resolution: 720p; generate_audio: boolean; seed: integer; face_mode: boolean | 9/3/3 | VIDEO-Seedance官转: 含参考视频 ¥19.04/1M 视频 tokens · 无参考视频 ¥31.28/1M 视频 tokens  |
| sd10-seedance-2.5 | video | duration: 30; aspect_ratio: 16:9/9:16/1:1/4:3/3:4/21:9; resolution: 720p; camera_movement: auto/fixed | 30/0/0 | VIDEO: ¥4.9/次 request; 全模型-无claude/gpt: ¥4.9/次 request |
| sd15-seedance-2.5 | video | duration: 4–30; aspect_ratio: 16:9/9:16/1:1; resolution: 480p/720p | 30/0/10 | VIDEO: ¥3.9/次 request; 全模型-无claude/gpt: ¥3.9/次 request |
| sd11-seedance-2.0 | video | duration: 4–15; aspect_ratio: 16:9/4:3/1:1/3:4/9:16/21:9/adaptive; resolution: 480p/720p/1080p; generate_audio: boolean; seed: 0 | 9/3/3 | VIDEO: 1080p ¥18.9/请求 · 720p ¥9.6/请求 · 480p ¥4.5/请求 ; 全模型-无claude/gpt: 1080p ¥18.9/请求 · 720p ¥9.6/请求 · 480p ¥4.5/请求  |
| sd8-seedance-2.5 | video | duration: 30; aspect_ratio: 21:9/16:9/4:3/1:1/3:4/9:16 | 9/0/0 | VIDEO: ¥3.9/次 request; 全模型-无claude/gpt: ¥3.9/次 request |
| kling-3.0-pro | video | duration: 3–15; aspect_ratio: 16:9/1:1/9:16; generate_audio: boolean | 4/0/0 | VIDEO: ¥2.9/次 request; 全模型-无claude/gpt: ¥2.9/次 request |
| sd10-seedance-2.0 | video | duration: 5/10/15; aspect_ratio: 16:9/9:16/1:1/4:3/3:4/21:9; resolution: 720p; camera_movement: auto/fixed | 9/0/0 | VIDEO: ¥3.9/次 request; 全模型-无claude/gpt: ¥3.9/次 request |
| sd10-seedance-2.0-fast | video | duration: 5/10/15; aspect_ratio: 16:9/9:16/1:1/4:3/3:4/21:9; resolution: 720p; camera_movement: auto/fixed | 9/0/0 | VIDEO: ¥3.5/次 request; 全模型-无claude/gpt: ¥3.5/次 request |
| sd14-seedance-2.0 | video | duration: 4–15; aspect_ratio: 1:1/16:9/9:16; resolution: 720p | 9/3/3 | VIDEO: ¥3.9/次 request; 全模型-无claude/gpt: ¥3.9/次 request |
| sd10-seedance-2.0-mini | video | duration: 5/10; aspect_ratio: 16:9/9:16/1:1/4:3/3:4/21:9; resolution: 720p; camera_movement: auto/fixed | 9/0/0 | VIDEO: ¥2.9/次 request; 全模型-无claude/gpt: ¥2.9/次 request |
| doubao-seedance-2-0-fast-260128 | video | duration: 4–15; aspect_ratio: 16:9/9:16/1:1/21:9/4:3/3:4; resolution: 720p; generate_audio: boolean; seed: integer; face_mode: boolean | 9/3/3 | VIDEO-Seedance官转: 含参考视频 ¥14.96/1M 视频 tokens · 无参考视频 ¥25.16/1M 视频 tokens  |
| sd13-seedance-2.0-mini | video | duration: 4–15; aspect_ratio: auto/21:9/16:9/4:3/1:1/3:4/9:16; resolution: 480p/720p; generate_audio: boolean | 9/3/0 | VIDEO: 720p ¥3.63/请求 · 480p ¥1.7/请求 ; 全模型-无claude/gpt: 720p ¥3.63/请求 · 480p ¥1.7/请求  |
| sd13-seedance-2.0-fast | video | duration: 4–15; aspect_ratio: auto/21:9/16:9/4:3/1:1/3:4/9:16; resolution: 480p/720p; generate_audio: boolean | 9/3/0 | VIDEO: 480p / 720p ¥5.67/请求 ; 全模型-无claude/gpt: 480p / 720p ¥5.67/请求  |
| sd7-seedance-2.0-1080p | video | duration: 4/5/6/7/8/9/10/11/12/13/14/15; aspect_ratio: 16:9/9:16/1:1/4:3/3:4/21:9; resolution: 1080p; generate_audio: boolean | 5/3/3 | VIDEO: ¥6.9/次 request; 全模型-无claude/gpt: ¥6.9/次 request |
| sd7-seedance-2.0-720p | video | duration: 4/5/6/7/8/9/10/11/12/13/14/15; aspect_ratio: 16:9/9:16/1:1/4:3/3:4/21:9; resolution: 720p; generate_audio: boolean | 5/3/3 | VIDEO: ¥4.9/次 request; 全模型-无claude/gpt: ¥4.9/次 request |
| mm3-minimax-h3-2k | video | duration: 15; aspect_ratio: 16:9/9:16/1:1; resolution: 2k | 9/3/3 | 全模型-无claude/gpt: ¥2.9/次 request; VIDEO: ¥2.9/次 request |
| gv3-grok-video-1.5 | video | duration: 3–15; aspect_ratio: 16:9/9:16/1:1; resolution: 720p | 7/0/0 | VIDEO: ¥1.9/次 request; 全模型-无claude/gpt: ¥1.9/次 request |
| happyhorse-1.1 | video | duration: 3–15; aspect_ratio: 16:9/9:16/1:1/4:3/3:4/21:9/9:21/5:4/4:5; resolution: 720p/1080p | 9/0/0 | VIDEO: 720p ¥2.8/请求 · 1080p ¥3.8/请求 ; 全模型-无claude/gpt: 720p ¥2.8/请求 · 1080p ¥3.8/请求  |
| lyria-3.5 | music | title: string; instrumental: boolean; lyrics: string; duration: 5–300; bpm: 30–300; seed: 0–2147483647; audio_format: mp3/wav/m4a; n: 1 | 0/0/0 | MUSIC: ¥0.25/次 request; 全模型-无claude/gpt: ¥0.25/次 request |
| lyria-3-pro | music | title: string; instrumental: boolean; lyrics: string; duration: 5–300; bpm: 30–300; seed: 0–2147483647; audio_format: mp3/wav/m4a; n: 1 | 0/0/0 | MUSIC: ¥0.25/次 request; 全模型-无claude/gpt: ¥0.25/次 request |
| omni-fast-no-water | video | aspect_ratio: 16:9/9:16 | 5/0/0 | VIDEO: ¥0.81/次 request; 全模型-无claude/gpt: ¥0.81/次 request |
| sd15-seedance-2.0 | video | duration: 4–15; aspect_ratio: 16:9/9:16/1:1; resolution: 480p/720p | 9/3/3 | VIDEO: ¥2.9/次 request; 全模型-无claude/gpt: ¥2.9/次 request |
| gemini-nano-banana-2.1 | image | aspect_ratio: 1:1/16:9/9:16/3:2/2:3/4:3/3:4/5:4/4:5/21:9; quality: 1k/2k/4k; n: 1 | 14/0/0 | IMAGE: 4k ¥0.1/张 · 2k ¥0.08/张 · 1k ¥0.06/张 ; 全模型-无claude/gpt: 4k ¥0.1/张 · 2k ¥0.08/张 · 1k ¥0.06/张  |

## miaowu

| 型号 | 媒体 | 标量控件/范围 | 参考图/视频/音频 | 当前价格 |
| --- | --- | --- | --- | --- |
| minimax-h3-max | video | seconds 5–15; resolution 720p/480p; ratio 1:1/16:9/9:16/4:3/3:4/21:9 | 9/0/3 | default:  ¥2 per_call; vip:  ¥2 per_call; 内部:  ¥2 per_call; 特价分组:  ¥2 per_call |
| dola-seedance-2.0-fast | video | seconds 4–15; resolution 720p; ratio 1:1/16:9/9:16/4:3/3:4/21:9 | 9/0/3 | default: 720p ¥0.55 per_call; vip: 720p ¥0.55 per_call; 内部: 720p ¥0.55 per_call; 特价分组: 720p ¥0.55 per_call |
| sora-2 | video | seconds 8; resolution 720p; ratio 16:9/9:16 | 1/0/0 | default:  ¥1 per_call; vip:  ¥1 per_call; 内部:  ¥1 per_call; 特价分组:  ¥1 per_call |
| wan3.0-video | video | seconds 5–30; resolution 480p/720p/1080p; ratio 16:9/9:16/1:1 | 10/5/5 | default: 720p ¥0.39,1080p ¥0.65,480p ¥0.195 per_second |
| wan3.0-vedio-deal | video | seconds 5–20; resolution 480p/720p; ratio 16:9/9:16/4:3/3:4/1:1 | 10/0/5 | default: 720p ¥0.5(≤10s),480p ¥0.5(≤20s) per_call; vip: 720p ¥0.5(≤10s),480p ¥0.5(≤20s) per_call; 内部: 720p ¥0.5(≤10s),480p ¥0.5(≤20s) per_call; 特价分组: 720p ¥0.5(≤10s),480p ¥0.5(≤20s) per_call; deal: 720p ¥0.5(≤10s),480p ¥0.5(≤20s) per_call |
| seedance-2.0-deal | video | seconds 4–15; resolution 720p; ratio 16:9/9:16/4:3/3:4/21:9/1:1 | 9/0/3 | vip: 720p ¥3.125 per_call; 内部: 720p ¥3.125 per_call; 特价分组: 720p ¥3.125 per_call; deal: 720p ¥3.125 per_call; default: 720p ¥3.125 per_call; dreamina: 720p ¥3.125 per_call |
| jimeng-seedance-2.5 | video | seconds 4–30; resolution 720p/480p; ratio 16:9/9:16/4:3/3:4/21:9/1:1 | 30/0/10 | default: 720p ¥0.75(≤30s),480p ¥0.625(≤30s) per_second; dreamina: 720p ¥0.75(≤30s),480p ¥0.625(≤30s) per_second; vip: 720p ¥0.75(≤30s),480p ¥0.625(≤30s) per_second; 内部: 720p ¥0.75(≤30s),480p ¥0.625(≤30s) per_second; 特价分组: 720p ¥0.75(≤30s),480p ¥0.625(≤30s) per_second |
| doubao-seedance-2.5 | video | seconds 5–30; resolution 720p; ratio 16:9/9:16 | 9/0/0 | default: 720p ¥6.25(≤30s) per_call; vip: 720p ¥6.25(≤30s) per_call; 内部: 720p ¥6.25(≤30s) per_call; 特价分组: 720p ¥6.25(≤30s) per_call |
| seedance-2.0-mini-deal | video | seconds 5–15; resolution 480p/720p; ratio 16:9/9:16/4:3/3:4/1:1 | 9/0/3 | deal: 480p ¥0.4(≤15s),720p ¥0.4(≤12s) per_call; default: 480p ¥0.4(≤15s),720p ¥0.4(≤12s) per_call; dreamina: 480p ¥0.4(≤15s),720p ¥0.4(≤12s) per_call; vip: 480p ¥0.4(≤15s),720p ¥0.4(≤12s) per_call; 内部: 480p ¥0.4(≤15s),720p ¥0.4(≤12s) per_call; 特价分组: 480p ¥0.4(≤15s),720p ¥0.4(≤12s) per_call |
| dola-seedance-2.5 | video | seconds 4–30; resolution 720p; ratio 1:1/16:9/9:16/4:3/3:4/21:9 | 30/0/10 | 特价分组: 720p ¥0.875 per_call; default: 720p ¥0.875 per_call; vip: 720p ¥0.875 per_call; 内部: 720p ¥0.875 per_call |
| minimax-h3 | video | seconds 5–15; resolution 720p; ratio 9:16/16:9/4:3/3:4/1:1 | 5/0/3 | default: 720p ¥0.0625 per_second; vip: 720p ¥0.0625 per_second; 内部: 720p ¥0.0625 per_second; 特价分组: 720p ¥0.0625 per_second |

## chuangxiang

| 型号 | 媒体 | 标量控件/范围 | 参考图/视频/音频 | 当前价格 |
| --- | --- | --- | --- | --- |
| grok-imagine-video | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 480p/720p; n: 1–1 | 1/0/0 | 480p ¥0.11/秒 · 720p ¥0.15/秒 |
| grok-imagine-video-1.5 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 1080p/480p/720p; n: 1–1 | 7/0/0 | 1080p ¥0.43/秒 · 480p ¥0.15/秒 · 720p ¥0.22/秒 |
| gv3-grok-video-1.5 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 720p; n: 1–1 | 7/0/0 | 720p ¥2.54/次 |
| happyhorse-1.1 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 1080p/720p; n: 1–1 | 9/0/0 | 1080p ¥5.07/次 · 720p ¥3.73/次 |
| kl1-kling-3.0 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 1080p/720p; n: 1–1 | 0/0/0 | 1080p ¥8.13/次 · 720p ¥6.13/次 |
| kling-3.0 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 720p; n: 1–1 | 1/0/0 | 720p ¥3.33/次 |
| kling-3.0-pro | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 720p; n: 1–1 | 4/0/0 | 720p ¥3.87/次 |
| mm2-minimax-h3 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 2k/768p; n: 1–1 | 9/3/3 | 2k ¥18.67/次 · 768p ¥13.2/次 |
| mm2-minimax-h3-max | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 480p/768p; n: 1–1 | 9/3/3 | 480p ¥7.73/次 · 768p ¥11.87/次 |
| mm3-minimax-h3-2k | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 2k; n: 1–1 | 9/3/3 | 2k ¥3.87/次 |
| niulai-pro | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 2k/768p; n: 1–1 | 9/3/3 | 2k ¥5.2/次 · 768p ¥3.87/次 |
| omni-fast | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 720p; n: 1–1 | 5/0/0 | 720p ¥0.88/次 |
| omni-fast-no-water | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 720p; n: 1–1 | 5/0/0 | 720p ¥1.08/次 |
| omni-v2v | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 720p; n: 1–1 | 5/2/0 | 720p ¥1.17/次 |
| omni-v2v-no-water | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 720p; n: 1–1 | 5/2/0 | 720p ¥1.33/次 |
| sd10-seedance-2.0 | video | duration: 5/10/15; aspect_ratio: string; resolution: 720p; n: 1–1 | 9/0/0 | 720p ¥5.2/次 |
| sd10-seedance-2.0-fast | video | duration: 5/10/15; aspect_ratio: string; resolution: 720p; n: 1–1 | 9/0/0 | 720p ¥4.67/次 |
| sd10-seedance-2.0-mini | video | duration: 5/10; aspect_ratio: string; resolution: 720p; n: 1–1 | 9/0/0 | 720p ¥3.87/次 |
| sd10-seedance-2.5 | video | duration: 30; aspect_ratio: string; resolution: 720p; n: 1–1 | 30/0/0 | 720p ¥6.53/次 |
| sd11-seedance-2.0 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 1080p/480p/720p; n: 1–1 | 9/3/3 | 1080p ¥25.2/次 · 480p ¥6/次 · 720p ¥12.8/次 |
| sd11-seedance-2.0-fast | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 480p/720p; n: 1–1 | 9/3/3 | 480p ¥4.67/次 · 720p ¥9.87/次 |
| sd11-seedance-2.0-mini | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 480p/720p; n: 1–1 | 9/3/3 | 480p ¥2.93/次 · 720p ¥6.27/次 |
| sd11-seedance-2.5 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 1080p/480p/720p; n: 1–1 | 30/10/10 | 1080p ¥38.67/次 · 480p ¥17.07/次 · 720p ¥25.33/次 |
| sd13-seedance-2.0 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 1080p/480p/4k/720p; n: 1–1 | 9/3/0 | 1080p ¥21.28/次 · 480p ¥9.48/次 · 4k ¥21.28/次 · 720p ¥9.48/次 |
| sd13-seedance-2.0-fast | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 480p/720p; n: 1–1 | 9/3/0 | 480p ¥7.56/次 · 720p ¥7.56/次 |
| sd13-seedance-2.0-mini | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 480p/720p; n: 1–1 | 9/3/0 | 480p ¥2.27/次 · 720p ¥4.84/次 |
| sd13-seedance-2.5 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 480p/720p; n: 1–1 | 30/10/0 | 480p ¥13.76/次 · 720p ¥29.52/次 |
| sd14-seedance-2.0 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 720p; n: 1–1 | 9/3/3 | 720p ¥5.2/次 |
| sd15-seedance-2.0 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 480p/720p; n: 1–1 | 9/3/3 | 480p ¥3.87/次 · 720p ¥3.87/次 |
| sd15-seedance-2.5 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 480p/720p; n: 1–1 | 30/0/10 | 480p ¥5.2/次 · 720p ¥5.2/次 |
| sd7-seedance-2.0-1080p | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 1080p; n: 1–1 | 5/3/3 | 1080p ¥9.2/次 |
| sd7-seedance-2.0-720p | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 720p; n: 1–1 | 5/3/3 | 720p ¥6.54/次 |
| sd8-seedance-2.5 | video | duration: 30; aspect_ratio: string; n: 1–1 | 9/0/0 | ¥5.2/次 |
| wan4-wan3.0 | video | duration: 正整数（范围未公开）; aspect_ratio: string; resolution: 1080p/480p/720p; n: 1–1 | 10/5/5 | 1080p ¥27.6/次 · 480p ¥6.93/次 · 720p ¥13.73/次 |

## 证据与验证

[沧元官方目录](https://ai.cangyuansuanli.cn/api/pricing)、[完整文档manifest](https://ai.cangyuansuanli.cn/docs-static/manifest.json)、[沧元视频入口](https://ai.cangyuansuanli.cn/docs-static/capabilities/video.md)、[沧元音乐入口](https://ai.cangyuansuanli.cn/docs-static/capabilities/music.md)、[Nano2.1独立合同](https://ai.cangyuansuanli.cn/docs-static/models/gemini-nano-banana-2.1.json)。

[喵呜当前目录](https://api.miaowuai.store/api/pricing)、[视频文档](https://api.miaowuai.store/docs/openai-videos)、[fresh页面引用的实际媒体正文](https://api.miaowuai.store/static/js/async/6906.da4b20a6ac.js)。

[创想当前模型广场](https://vapi.chuangxiangai.asia/api/v1/model-plaza)、[视频文档](https://vapi.chuangxiangai.asia/docs/video)、[fresh页面引用的实际视频正文](https://vapi.chuangxiangai.asia/ui-price-20260922/assets/VideoApiDocsView-C5dD5mJg.js)。

验证为离线请求模拟，不创建付费任务。provider typecheck 已通过；provider合同/REST/价格六文件70 tests、renderer两catalog文件62 tests全部通过。共85项价格均有当前公开值：82项可结构化展示，另3项官转条件tokens费率可准确展示标签，实际用量未知不估总额；没有发布价缺失。创想SD8固定任务准确¥5.2/次，per_request保留key不再误当分辨率。

[JSON完整矩阵](primary-contract-audit.json)包含85条，不把文档出现等同可生成成功或Key权限。