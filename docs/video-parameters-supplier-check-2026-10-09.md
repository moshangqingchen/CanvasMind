# 佳速视频参数免费复查（2026-10-09）

复查时间：2026-10-09 美西时间（2026-10-10 UTC）。范围为 `https://ai.jiasuapi.com` 的 `vip` 分组全部 26 个公开视频完整型号，重点为 `seedance2.5-全参真人`。本次只读官网、公开目录、文档、schema 与前端资源，离线运行回归；**0 次生成请求、0 次付费视频验证、0 次素材上传**。未操作用户画布或修改已有参数。

## 精确型号与界面问题

`seedance2.5-全参真人` 的公开记录只有 `supported_endpoint_types=[openai-video]`、`enable_groups=[vip]`、`quota_type=1`、`model_price=1.1`，没有 `description` 或 `api_parameters`。[公开价格接口](https://ai.jiasuapi.com/api/pricing?surface=video)与 [status](https://ai.jiasuapi.com/api/status)确认 `vip` 倍率为 1、货币符号为 `¥`、换算率为 1，因此可显示 **¥1.1/次**。这是该分组和型号的公布请求价，不证明任意时长、分辨率均可生成。

浏览器实际打开[模型广场](https://ai.jiasuapi.com/pricing)，搜索完整 ID 显示“没有匹配的模型”；按官网实际详情路由打开[该完整型号](https://ai.jiasuapi.com/pricing/seedance2.5-%E5%85%A8%E5%8F%82%E7%9C%9F%E4%BA%BA)，显示“模型未找到”。查明原因是广场实际调用 `surface=plaza`，只有 17 个型号、其中 8 个视频，不含目标型号；`surface=pricing/playground/image/video` 则均返回 35 个型号、其中 26 个视频。因此不能把“广场未展示”误记为 API 不可用，也不能声称实际看到了目标型号的参数详情。

[视频工作台](https://ai.jiasuapi.com/video-workbench)在本次浏览器会话要求登录；没有在浏览器填写凭据或生成。随后使用项目为此精确站点保存的访问令牌完成工具内存中的身份验证，再仅执行允许列表内的 GET：认证后的 pricing/video/playground 仍为 35 个型号，目标仍无参数；plaza 仍为 17 个型号且不含目标；`/api/user/models` 返回 34 个型号并包含该完整 ID，但没有 schema。官网前端实际使用的管理配置接口 `/api/models/?p=0&page_size=100`、`/api/video-pricing/catalog`、`/api/video-pricing/models` 均返回 403。本次认证没有 POST，凭据不写文件或输出；仅保存去除账户字段后的查证摘要。不能把缺少管理权限说成型号不可用。

读取当前前端代码确认：工作台时长约束来自选中记录的 `api_parameters`；缺失时，页面存在通用整数检查（1–3600），详情组件另有通用视频表（1–60）。站内视频示例又写 `2.0-*` 为 4–15、`2.5-*` 为 4–30。[Apifox 视频接口](https://aijiasu.apifox.cn/api-510583244)正文要求缺失时使用型号默认时长，内嵌 schema 说明写默认 5，独立 [VideoCreateRequest schema](https://aijiasu.apifox.cn/schema-310790781)仅声明 integer，无上下限。[文档目录](https://aijiasu.apifox.cn/llms.txt)的独立视频特例是 MiniMax H3，没有全参真人独立文档。以上入口相互不一致，且没有把这些范围明确绑定到该完整 ID 的实际详情证据；不据此认定 35、38 或其他任意秒数合法，也不借用 `sd-2.5-J2` 的 5–30 秒。没有声称完成已登录工作台中该型号的控件验收。

原程序把未公布的时长生成为 `min=1`、无 `max` 的数字参数，把未公布的分辨率生成为自由文本，验证也允许任意正整数和字符串；旧值因而显示为普通 spinner 或文本框。这是程序合同与验证缺陷。

本次修复：未知时长不再虚构上下限/default，未知分辨率使用空选项的 select，分别标明 `durationRangeUnverified`、`resolutionRangeUnverified`。旧值继续保留；界面由对应修复提供明确恢复“供应商默认”的入口，用户主动恢复后才省略字段。Provider 在出站前拒绝未确认的自定义值；精确型号 `api_parameters` 发布的合法默认单独记录为 `videoParameterConfirmedDefaults`，未知完整范围时也只开放这个已确认默认（分辨率提供对应单个选项），不从通用示例或旧缓存推断。取得新范围或枚举后重建合同并清除旧未知标记，非法默认不注入请求。已存在的型号/分组实际响应限制继续保留。

## 全部 26 个完整型号覆盖

来源 **P** 为当前 `surface=video` 的逐型号 `api_parameters`、描述、价格；**G** 为 `surface=plaza` 实际广场可见记录。26 个型号的参数声明与项目保存的公开快照逐一比对，内容无变化。8 个型号有独立声明，18 个没有独立时长/分辨率声明；不能把另一个型号或计费 schema 的档位当成生成档位。

下表的 **R3** 为 16:9 / 9:16 / 1:1；**R5** 为 9:16 / 1:1 / 3:4 / 4:3 / 16:9。素材上限按图/视频/音频排列。`未公布` 表示该完整型号的独立声明缺项；通用接口存在字段不等于无限支持。金额均为当前 `vip` 公布价，币种 CNY。

| 完整型号 | 时长（秒） | 生成分辨率 / 比例 | 素材上限 | 价格与条件 | 证据状态 |
|---|---|---|---|---|---|
| `sd-2.0-933-720-fast-原生真人` | 4–15，默认 5 | 720p / R3 | 9/3/3 | 2.6/次 | P+G 明确 |
| `sd-2.0-fast-803-J3` | 未公布 | 未公布 | 未公布 | 0.8/次 | P 缺参数，G 不展示 |
| `sd-2.0-mini-J1` | 480p 4–15；720p 4–12 | 480p、720p / R3 | 9/0/3 | 两档均 1/条，`per_item` | P+G；schema 默认 15 与 720p 描述上限 12 冲突，程序保留已修复的合法 12 |
| `AIGV-WAN3-1080P` | 未公布 | 未公布 | 未公布 | 缺完整报价条件 | P 缺参数；不按名称猜 1080p |
| `sd-2.0-J1` | 4–15，默认 15 | 720p / R3 | 9/0/3 | 4/次；空 per-request override 回退自身 model_price | P+G 明确 |
| `ov-seedance-2.5-720p-nv` | 未公布 | 未公布 | 未公布 | 缺完整报价条件 | P 缺参数；不按名称猜 720p |
| `wan3` | 15–30，默认 30 | 720p、1080p / R3 | 10/5/5 | 720p 0.16/秒；1080p 0.3/秒，`per_second` | P+G；不误取同记录的 per-item 字段 |
| `doubao-seedance-2-0-mini-260615` | 未公布 | 未公布 | 未公布 | Token/分辨率/是否视频输入条件已声明，费率矩阵缺失 | P 的计费档位不是生成档位 |
| `seedance2.5-全参真人` | 未公布 | 未公布 | 未公布 | 1.1/次 | P 有价格，无参数；G 不展示 |
| `doubao-seedance-2-0-fast-260128` | 未公布 | 未公布 | 未公布 | Token 条件已声明，费率矩阵缺失 | P 的计费档位不是生成档位 |
| `ov-seedance-2.5-480p-nv` | 未公布 | 未公布 | 未公布 | 缺完整报价条件 | P 缺参数；不按名称猜 480p |
| `MiniMax-H3-jx` | 未公布 | 未公布 | 未公布 | 缺完整报价条件 | 不借用其他 MiniMax 完整型号 |
| `sd-2.0-mini-503-J3` | 未公布 | 未公布 | 未公布 | 0.6/次 | P 缺参数，G 不展示 |
| `sd-2.0-J2` | 5–15，默认 5 | 720p / R3 | 9/3/3 | 0.3/秒，`video_pricing.final_price` | P+G；优先于旧 model_price 0.25 |
| `grok-1.5` | 3–15，默认 5 | 720p / R3 | 7/未公布/未公布 | 1/次 | P+G 明确 |
| `minimax-h3` | 4–15，默认 15 | 2k / R5 | 9/3/3，合计 10 | 2k 1/次，final_price | P+G；参考视频合计≤15 秒，duration_seconds 规则明确 |
| `AIGV-WAN3-720P` | 未公布 | 未公布 | 未公布 | 缺完整报价条件 | P 缺参数；不按名称猜 720p |
| `seedance2.0-mini-A` | 未公布 | 未公布 | 未公布 | 1/次 | P 缺参数，G 不展示 |
| `doubao-seedance-2-5-260628` | 未公布 | 未公布 | 未公布 | Token 条件已声明，费率矩阵缺失 | P 缺生成范围；已有 vip 响应约束保留 |
| `sd-2.0-fast-J4` | 未公布 | 未公布 | 未公布 | 缺完整报价条件 | P 缺参数，G 不展示 |
| `sd-2.5-J2` | 5–30，默认 30 | P 声明 480p、720p、1080p / R3 | 30/10/10 | 480p 0.4/秒、720p 0.65/秒、1080p 1.1/秒，final_price | P+G；描述只写 720p，schema 更完整；已有 vip 480p 禁用证据保留 |
| `seedance2.0-720-满血真人` | 未公布 | 未公布 | 未公布 | 5.5/次 | P 缺参数；不按名称猜范围 |
| `sd-2.0-J4` | 未公布 | 未公布 | 未公布 | 缺完整报价条件 | P 缺参数，G 不展示 |
| `sd-2.0-fast-813-J3` | 未公布 | 未公布 | 未公布 | 1/次 | P 缺参数，G 不展示 |
| `seedance2.0-满血` | 未公布 | 未公布 | 未公布 | 缺完整报价条件 | P 缺参数，G 不展示 |
| `doubao-seedance-2-0-260128` | 未公布 | 未公布 | 未公布 | Token 条件已声明，费率矩阵缺失 | P 缺生成范围；已有 vip 响应约束保留 |

通用视频合同声明文生、参考素材、首尾帧（`images[].type=first_frame/end_frame`），但未给上述缺项型号独立的编辑/续写能力、素材数、帧率或声音枚举；不添加推测选项。首尾帧与参考音频不能混用。素材使用公网 URL 或对应对象，`materials` 与各素材数组统一计数。通用 `ratio` 三枚举可用；通用 `resolution` 文档写 480p/720p/1080p、默认 720p，仅记录为通用文档，不能证明缺项型号的自选档位。准确像素、原视频音轨及生成成功不由这次只读查证证明。

26 个型号公开端点类型均为 `openai-video`，目录映射到 `/v1/video/generations`；本次仅读取映射，未调用提交端点。结果获取依据[官方查询文档](https://aijiasu.apifox.cn/api-511071739)：`GET /v1/videos/tasks/{task_id}`，状态 queued / in_progress / completed / failed / unknown，完成后读取 `result_urls` 原文件。没有重发任何已有任务。

## 证据与验收

原始公开响应仅保存在本地 `.codex-temp/jiasu-video-parameter-review-20261010/`，不随发布打包。认证响应仅在内存中计算哈希，文件只保存允许的参数/价格字段与状态摘要。下列 SHA-256 是本次响应的哈希；本报告和摘要不包含凭据、账户 ID、余额或私有任务记录。

| 官方来源 | SHA-256 |
|---|---|
| [pricing：surface=video](https://ai.jiasuapi.com/api/pricing?surface=video)，本次 pricing/playground/image 响应内容相同 | `7651488362ef1c86e7f2ef76890a704e068ccb8050377b8583210db0bcffefd5` |
| [pricing：surface=plaza](https://ai.jiasuapi.com/api/pricing?surface=plaza) | `56ebd2f15145801da29d1ce47331e35c843b03373bfaec1dd4bdf6af31a21177` |
| [status](https://ai.jiasuapi.com/api/status) | `ea73972614fef866914f6a8646769584c76359dbaff3efb549015e08aa5cf484` |
| [视频接口 Markdown](https://aijiasu.apifox.cn/api-510583244.md) | `85546aec80ebfaebeba6086bbe860deb21fd1a2166bad205d1cabd6ad2282a64` |
| [视频请求 schema Markdown](https://aijiasu.apifox.cn/schema-310790781.md) | `49913d3c5e07e070a6262f6dceeefaa68e572aaed2458c86aeee0757caf901e8` |
| [官网当前前端资源](https://ai.jiasuapi.com/static/js/index.db56a06799.js) | `79c6508e196825d5b5cc101f4df8b5709b64dd29eb93a75247f2cd01ba7c216f` |
| 认证后的 [pricing](https://ai.jiasuapi.com/api/pricing)，video/playground 内容相同 | `2bdbd0a69ab85c60819b8a1e515bd9c4e269e0ea7287452a0ab4d34fb9832021` |
| 认证后的 [plaza](https://ai.jiasuapi.com/api/pricing?surface=plaza) | `014dcca08f5df9160a7b5c7d8145464d0736a52fd000df58a2445a6e35e636e5` |
| 认证后的 [当前账户型号目录](https://ai.jiasuapi.com/api/user/models) | `053edb504dd7b3ce6a6bca83351e4c02a73571981bcd2a8a418c49b369254ea8` |
| [模型配置](https://ai.jiasuapi.com/api/models/?p=0&page_size=100)、[视频价格目录](https://ai.jiasuapi.com/api/video-pricing/catalog)、[视频价格配置](https://ai.jiasuapi.com/api/video-pricing/models)的 403 响应 | `9b394b2a42d2ae48b7db441750c8d3620cd077c75d498ab3417074b701803650` |

Provider 回归：`jiasu-video-contract.test.ts` 与 `jiasu-catalog-pricing.test.ts` **39/39 通过**；provider 类型检查通过。新增用例覆盖旧 35/38 秒与未确认分辨率在 Auto/REST 两条路径中本地拒绝、零网络调用、请求值不被改写、显式默认省略、合法精确 default、离散秒数枚举及刷新清除旧未知标志。Auto 与 GenericRestAdapter 的离线模拟提交另验证已公布默认和省略字段均合法，未公布自定义值在 HTTP 前阻断，目录删除默认后不会继续保留旧确认标记。这是源码验证；安装版 API 读回、安装版界面验收和真实收费生成属于独立证据，不由这些单测替代。

## 跨供应商运行时与旧缓存补查

本节依据本地现有精确合同、目录处理和接口映射进行离线审查，不代表对下列供应商重新发起官网认证或收费生成。没有使用生产 Key、修改用户资料或提交任何视频任务。

修复了三个可复现缺陷：

- `remaining-video-contracts.ts` 重建有证据的时长枚举或完整上下限后，旧目录的 `durationRangeUnverified=true` 仍被复制，导致已确认范围继续显示未确认控件。现在仅在当前精确合同确有完整范围时清除；真正未知范围主动标记未确认。回归覆盖 Chentu 连续范围、固定枚举以及 Secure 从 SD 未知范围切换到 VividAI 固定 15 秒。
- `rest.ts` 之前只对原生视频路由执行声明参数校验；手动接口和已保存 `paid-test` 接口使用固定 transport 后会漏过其自身 `min/max/step/options/required` 及条件约束。现在所有视频均校验当前接口自身的声明；不会借用另一个渠道的原生限制。三条离线路径的 21 项非法值原来均返回 `valid:true`，现在验证和提交预检均拒绝且 HTTP 调用数为零。模拟手工合同中合法的 38 秒、1440p 保留原自定义路由和原值，这只是测试合同，不宣称实际供应商支持这些参数。
- `auto-interface-adapter.ts` 在视频当前目录缺少参数或刷新为 `parameters:[]` 时，会丢弃已保存接口的参数 schema。现在仅在稀疏目录情况下回退保存接口 schema；当前明确声明仍优先，目录权限状态继续独立检查。

现有静态合同中以下 17 个完整型号只有共享 `min=1`，无时长上限、枚举或 `defaultDuration`。此前可传入任意正整数，离线验证 `duration=1000000` 均未产生时长错误；其中两项还被通用逻辑自动填成 5 秒。不能把这个最小值或一次示例当作供应商已确认范围。

| 供应商 / 合同作用域 | 完整型号 | 修复后的未知时长行为 |
|---|---|---|
| Chentu | `sora-v3-pro` | 时长必需但无已证据默认；本地阻断并说明缺合同，不再强填 5 秒 |
| Chentu 当前目录 | `grok-imagine-video-1.5（按次）`、`grok-video1.5-fast`、`grok--video1.0`、`minimax-h3 768p` | 可省略时长使用上游默认；旧自定义时长本地拒绝 |
| Secure 的 SD 类分组（回归使用 `sd特价分组1`） | `seedance2.0` | 时长必需但无已证据默认；本地阻断；VividAI 分组已确认固定 15 秒的独立合同仍可用 |
| Cyber Afei OpenAI Video | `minimax-h3`、`seedance2.0`、`seedance2.5`、`veo3.1`、`veo3.1-fast`、`veo3.1-lite`、`omni-flash`（生成模式） | 可省略时长；自定义时长本地拒绝；Omni 源视频编辑仍使用其独立 Chat 合同 |
| Mikoto | `grok-imagine-video`、`grok-imagine-video-1.5` | 可省略时长；自定义时长本地拒绝，素材 multipart 上传与原任务恢复规则保留 |
| Hang | `grok-imagine-video`、`grok-imagine-video-1.5` | 可省略时长；自定义时长本地拒绝，异步查询与原视频获取映射保留 |

`duration` 和 `seconds` 两个入口统一检查；不会把旧 38 秒静默裁剪成另一个收费请求。`defaultDuration` 只使用合同显式值，或在已有完整合法范围内保留 UI 初始选择；未知范围不再通过 `Math.max(min, 5)` 制造默认。未来当前合同增加合法范围/枚举即可恢复控件；Miaowu 的 `pricing.video_api` / `dream.video_schema`、佳速独立原生合同及手工显式合同继续走各自证据链，不被这张静态表覆盖。

新增 `unknown-video-duration.test.ts` 逐一覆盖上述 17 个型号的 38 秒、百万秒及 `seconds` 别名：验证与提交均在 HTTP 前拒绝；15 项可选时长省略合法，2 项必需但未知的时长省略仍明确失败。既有传输回归改为在未知时长时省略该字段，并断言 JSON / multipart 不含虚构秒数，继续验证上传、提交映射和原任务查询。

本阶段本地 provider 全量回归 **78 文件 / 1887 用例通过**，provider TypeScript 检查通过，`git diff --check` 通过。以上只证明源码与离线模拟；安装版读回、安装版 UI 和真实收费生成仍需分别记录。本次真实视频生成次数为 **0**。

### 未确认分辨率与正式像素尺寸字段

对全部 `openResolution` 配置补查后发现，接口接受名为 `resolution` 的字段，不代表其完整型号已经公布合法值列表。不能据此让旧画布的 `720p`、`4K` 或任意字符串直接提交。

| 合同来源 | 可核实事实 | 本轮处理 |
|---|---|---|
| [Chentu 媒体文档](https://tu.988236.xyz/docs/api-media.zh-CN.md)，复用项目已存原文 | 通用 Creator 提供档位，但文档要求实际范围跟随型号能力；这些目录别名未有独立合法分辨率列表 | 15 个目录合同标记未确认，保留默认省略 |
| [Cyber Afei 目录](https://api.3365api.cn/api/pricing) 与现有 OpenAI Video multipart 合同 | 七款型号有报价条件和 `size` 像素字段；报价条件不能证明自由 `resolution` 请求值全部有效 | 七款保留独立 `size`，未确认 `resolution` 只允许省略 |
| [Mikoto 官方部署](https://image.mikoto.vip/)，复用已存前端视频插件模板 | 模板明确独立传递 `params.size → FormData.size` 和 `resolution → resolution_name`；通用默认不构成两个 Grok 完整型号的档位枚举 | 两款未确认 `resolution` 只允许省略；补通正式独立 `size` 字段及 multipart 映射，防止禁用未知档位时连像素字段一起丢失 |
| [Hang 所采用的 Grok 服务端源码](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/service/grok_media.go)，本轮免费只读核对 | 读取 `resolution` 并处理视频计费信息，未证明任意档位都合法 | 两款标记未确认；旧显式值在本地阻止，默认省略继续可用 |
| [Miaowu OpenAI 视频文档](https://api.miaowuai.store/docs/openai-videos)，复用已存原文 | 声明 `resolution`，未给所有未来目录别名的枚举；文档明确拒绝 `size` | 未来目录合同同样标记未知；不向 Miaowu 添加其他渠道的 `size` 字段，已认证 Dream schema 保留原独立逻辑 |

26 个现有完整型号是：Chentu 的 `grok-imagine-video-1.5（按次）`、`grok-video1.5-fast`、`grok--video1.0`、`minimax-h3 768p`、`MiniMaxH3`、`MiniMaxH3-720p`、`MiniMaxH3-2k`、`MiniMaxH3-2k-pro`、`H3量化版`、`minimax_h3-768p-933`、`a-2.0-720p-v1`、`a-2.0-720p-v4`、`sd-2.5-M-720p`、`xinghe-2.0s`、`sd-2.0-720p-TJ`；Cyber Afei 的 `minimax-h3`、`seedance2.0`、`seedance2.5`、`veo3.1`、`veo3.1-fast`、`veo3.1-lite`、`omni-flash`；Mikoto 和 Hang 各自的 `grok-imagine-video`、`grok-imagine-video-1.5`。

这些合同现在设置 `resolutionRangeUnverified=true`，界面使用已有的全视频“供应商默认”下拉；已保存值仍展示但标记未确认，不自动改写。运行时在 HTTP 前拒绝显式未确认档位；省略字段不发送虚构默认。有明确枚举的当前合同会清除旧未知标记。Mikoto 与 Cyber 的正式 `size` 继续接受独立宽×高原字段，仅校验正整数 `宽x高` 格式，不编造最大尺寸或已生成成功结论；Miaowu 不增加 `size`。

新增 `unknown-video-resolution.test.ts` 覆盖 26 个完整型号、Cyber/Miaowu 未来目录合同、缓存标记更新及两个正式 `size` 路由；非法分辨率验证和提交预检的真实 HTTP 调用数均为零。原上传和查询回归使用省略分辨率或正式 `size` 字段，仍核对实际 JSON / multipart 内容。最新 provider 全量回归 **79 文件 / 1919 用例通过**，provider TypeScript 检查与变更空白检查通过；新增收费视频请求仍为 **0**。

## 0.2.83 源码与安装包验收

最终 renderer 全量回归 **219 文件 / 2576 用例通过**，runtime **27 文件 / 436 用例通过**；全项目类型检查、ESLint、维护脚本 12 项检查和生产桌面构建通过。报价回归另外确认 `seconds=5` 的每秒计价为 `3.25 CNY`、冲突别名拒绝报价、手工接口合法自由参数保留、供应商明确公布的默认值仍可使用。

最终生产构建离线浏览器验收 **11/11 通过**：包括完整型号 `seedance2.5-全参真人` 的旧 `38` 秒 / `720p` 不被改写、未知值下拉提示、显式选默认后清除别名、已确认范围滑块、固定档位下拉、分辨率和素材变化后的约束联动、报价、保存和刷新恢复。测试供应商和提交请求均为本地模拟；没有向真实供应商发送请求。

本地 0.2.83 Windows 安装包构建 `Vbycd7On0gHWynYvOgC1C`：packaged smoke **28/28**、普通窗口 smoke **4/4** 通过；独立临时资料下验证原视频归档解码、空系统 PATH 的随包媒体工具、窗口重启及渲染器崩溃恢复。安装包大小 `267291763` 字节，SHA-256 `33e3d5c300820e275b56e971c8f189a740063bc257c7c2b4aa1dd862e22ac0cb`。

以上为源码和独立安装包证据。实际用户安装版 API、实际用户安装版界面、公开发布和升级渠道须另行记录，不能由上述结果代替。真实收费视频生成验证次数为 **0**。
