# 其余13供应商媒体合同与价格核对（2026-10-07）

按洛杉矶日期记录，资料读取UTC时间 2026-10-08T02:37:15.146Z。本次精确合同共 102 个，合同数量不等于当前Key已开通数量；补齐只作用于当前Key实际返回的精确模型ID。

| 供应商 | 明确视频合同数 | 币种依据 | 结果和限制 |
| --- | ---: | --- | --- |
| 智元api | 待确认 | 当前目录注明币种 | 当前公开正文与目录未确认视频或音乐生成合同；展示目录已有价格，不能由多模态输入推定媒体输出。 |
| 辰途 API | 34 | CNY | 34 个精确视频 ID：33 个生产能力矩阵，加总文档的 Grok Fast。当前 Key 的能力接口返回404；Sora时长/比例枚举保持待确认。 |
| MikotoPro | 待确认 | 当前目录注明币种 | 视频相关猜测路径均返回 SPA 壳；实际资源目前仅找到图片指南，未编造视频端点或字段。价格仍由当前登录分组或目录读取。 |
| FriModel | 5 | 当前目录注明币种 | 5 个明确视频合同；Seedance referenceImages/referenceVideos/referenceAudios 与 Grok 模式单独映射。 |
| We-AI | 9 | 当前目录注明币种 | 9 个 Omni 视频合同在独立 video.we-token.cc；另5个SD2模型有标准化媒体参数，具体提交路径未公布，不套用Omni端点。当前9把已有Key跨视频站读取6个401、3个网络失败，不能宣称已开通。 |
| 赛博阿飞 API | 5 | USD | 当前文档明确的两个Grok1.5清晰度别名与3个SD2固定时长别名；保留既有已验证协议，不给编辑/续写增加未开放入口。SD2相对content结果使用原Key下载。 |
| 怪兽ai | 待确认 | 当前目录注明币种 | 本次公开资料未确认新的视频或音乐生成合同；图片/文本价格及模型范围沿用实时目录，不能推定视频参数。 |
| secure-skill | 49 | 当前目录注明币种 | 分别补齐SD2/SD2.5、Doubao、Wan3、MiniMax、Grok、Flow VEO/Omni合同。共享seedance ID必须有分组依据；Flow必须明确flow分组；未知分组不启用新route。 |
| 基因形象 | 待确认 | 当前目录注明币种 | 本次公开正文确认图片协议；未取得新的视频或音乐生成合同，保留其目录价格但不猜视频端点。 |
| 夯炸了 | 待确认 | CNY | 价格页有134个条目，token表单位是人民币/百万token；不能当作每张、每条视频价格。本次未确认视频/音乐生成合同。 |
| 词元 | 待确认 | 当前目录注明币种 | 目录商家价格按公开零售值显示，已有加价不再乘一次。输入/输出token、按次与媒体档位分别展示；本次未取得可新增的视频/音乐请求合同。 |
| Synora | 待确认 | 当前目录注明币种 | 读取实际DocsView正文；本次未找到可新增的视频/音乐生成合同。保留目录价格、权限和无法确认状态。 |
| pDog | 待确认 | 当前目录注明币种 | 香蕉组模型变化已记录；本次公开正文未确认视频或音乐生成合同，新型号不继承旧价格或字段。 |

## 接入与价格

辰途未收录的别名仅有openai-video标签时保持受限，不显示猜测的1–30秒或2K菜单。完整的精确手工合同和已确认接口schema保留原参数。

图片、视频、音乐按已确认输出分类；参考图片输入不证明图片输出，语音合成不作为音乐。未知音乐不能借图片route或兄弟模型route。We-AI SD2有参数示例但没有确定请求路径，不能套用Omni路径；具体已保存的手工合同仍可使用。

辰途官方状态为CUSTOM、￥、兑换率1，按CNY显示；赛博阿飞官方状态为USD。模型目录扫描后保留结构化价格，按秒/按次与分组倍率分开，名称只拼一次费用标签。Secure SD2按条，SD2.5按提交秒数；Grok声音条件使用供应商voice_id，不把本地音频URL当voice_id。参考视频档的token价格与普通档分开，不把token数字当每条报价。

使用供应商声明的POST路径、请求字段、任务ID、查询和下载路径。创建成功必须保存任务ID；查询、下载使用原Key，不能因为未就绪重复提交。Secure Flow、Wan3、Grok、SD、MiniMax返回信封分开处理；Afei SD2的相对content URL按原Key下载。

公开价格页可匹配本矩阵9个模型；93个模型需要当前账户/分组报价。金额缺失明确标记，不按旧型号或未注明单位的数字猜价；这不等于运行时缺价93个。

## 明确模型合同

素材上限列按图片/视频/音频顺序；“按分组”表示供应商没有统一承诺数量或档位。本JSON保存参数、素材角色、字段白名单、分组依据、轮询及输出路径。

| 供应商 | 精确模型ID | 时长 | 清晰度 | 素材上限 | 创建路径 |
| --- | --- | --- | --- | --- | --- |
| 辰途 API | `seedance-2.0-480p` | 4–15 秒 | 480p | 9/3/3 | `/v1/videos` |
| 辰途 API | `seedance-2.0-fast-480p` | 4–15 秒 | 480p | 9/3/3 | `/v1/videos` |
| 辰途 API | `seedance-2.0-431-480p` | 4–15 秒 | 480p | 4/3/1 | `/v1/videos` |
| 辰途 API | `seedance-2.0-fast-431-480p` | 4–15 秒 | 480p | 4/3/1 | `/v1/videos` |
| 辰途 API | `seedance-2.0-720p` | 4–15 秒 | 720p | 9/3/3 | `/v1/videos` |
| 辰途 API | `seedance-2.0-fast-720p` | 4–15 秒 | 720p | 9/3/3 | `/v1/videos` |
| 辰途 API | `seedance-2.0-431-720p` | 4–15 秒 | 720p | 4/3/1 | `/v1/videos` |
| 辰途 API | `seedance-2.0-fast-431-720p` | 4–15 秒 | 720p | 4/3/1 | `/v1/videos` |
| 辰途 API | `seedance-2.0-s` | 10–15 秒 | 720p | 9/3/3 | `/v1/videos` |
| 辰途 API | `seedance-2.0-v4` | 10 秒 | 720p | 9/3/3 | `/v1/videos` |
| 辰途 API | `seedance2.0-mini` | 10 秒 | 720p | 4/3/3 | `/v1/videos` |
| 辰途 API | `PL-seedance-2.0-720p` | 15 秒 | 720p | 9/3/3 | `/v1/videos` |
| 辰途 API | `seedance2.0 900` | 4–15 秒 | 720p | 9/0/0 | `/v1/videos` |
| 辰途 API | `kling-3.0-omni-720p` | 4–15 秒 | 720p | 5/0/0 | `/v1/videos` |
| 辰途 API | `sp-kling-3.0-omni-720p` | 5/10/15 秒 | 720p | 2/1/0 | `/v1/videos` |
| 辰途 API | `happyhorse-720p` | 4–15 秒 | 720p | 1/0/0 | `/v1/videos` |
| 辰途 API | `kling-3.0-omni-1080p` | 4–15 秒 | 1080p | 5/0/0 | `/v1/videos` |
| 辰途 API | `sp-kling-3.0-omni-1080p` | 5/10/15 秒 | 1080p | 2/1/0 | `/v1/videos` |
| 辰途 API | `happyhorse-1080p` | 4–15 秒 | 1080p | 1/0/0 | `/v1/videos` |
| 辰途 API | `kling-o3` | 3–15 秒 | 720p/1080p/2160p | 7/1/0 | `/v1/videos` |
| 辰途 API | `kling-v3` | 3–15 秒 | 720p/1080p/2160p | 2/0/0 | `/v1/videos` |
| 辰途 API | `minimax-h3` | 5–15 秒 | 1440p | 5/0/3 | `/v1/videos` |
| 辰途 API | `Veo 3.1 Fast 1080p` | 8 秒 | 1080p | 3/0/0 | `/v1/videos` |
| 辰途 API | `veo-3.1` | 4/6/8 秒 | 720p/1080p | 3/0/0 | `/v1/videos` |
| 辰途 API | `veo-3.1-lite` | 4/6/8 秒 | 720p/1080p | 2/0/0 | `/v1/videos` |
| 辰途 API | `gemini-omni` | 3–10 秒 | 720p | 5/0/0 | `/v1/videos` |
| 辰途 API | `gemini-omni-flash` | 3–10 秒 | 720p | 1/1/0 | `/v1/videos` |
| 辰途 API | `grok-imagine-video-1.5-preview` | 1–15 秒 | 480p/720p | 7/0/0 | `/v1/videos` |
| 辰途 API | `grok-imagine-video-1.5-fast` | 6/10/15 秒 | 720p | 7/0/0 | `/v1/videos` |
| 辰途 API | `omni-fast` | 10 秒 | 720p | 5/0/0 | `/v1/videos` |
| 辰途 API | `omni-fast-no-water` | 10 秒 | 720p | 5/0/0 | `/v1/videos` |
| 辰途 API | `omni-fast-v2v` | 10 秒 | 720p | 0/2/0 | `/v1/videos` |
| 辰途 API | `omni-fast-v2v-no-water` | 10 秒 | 720p | 0/2/0 | `/v1/videos` |
| 辰途 API | `sora-v3-pro` | 1–待确认 秒 | 720p | 9/3/3 | `/v1/videos` |
| FriModel | `videos-mini` | 4–15 秒 | 480p/720p | 9/3/3 | `/v1/videos` |
| FriModel | `videos-fast` | 4–15 秒 | 480p/720p | 9/3/3 | `/v1/videos` |
| FriModel | `videos-standard` | 4–15 秒 | 480p/720p/1080p/4k | 9/3/3 | `/v1/videos` |
| FriModel | `grok-imagine-video` | 1–15 秒 | 480p/720p | 7/0/0 | `/v1/videos` |
| FriModel | `grok-imagine-video-1.5-preview` | 1–15 秒 | 480p/720p/1080p | 1/0/0 | `/v1/videos` |
| We-AI | `omni-flash` | 4/6/8/10 秒 | 720p | 0/0/0 | `/v1/videos` |
| We-AI | `omni-flash-components` | 4/6/8/10 秒 | 720p | 5/0/0 | `/v1/videos` |
| We-AI | `omni-flash-edit` | 4/6/8/10 秒 | 720p | 0/1/0 | `/v1/videos` |
| We-AI | `omni-flash-1080p` | 4/6/8/10 秒 | 1080p | 0/0/0 | `/v1/videos` |
| We-AI | `omni-flash-components-1080p` | 4/6/8/10 秒 | 1080p | 5/0/0 | `/v1/videos` |
| We-AI | `omni-flash-edit-1080p` | 4/6/8/10 秒 | 1080p | 0/1/0 | `/v1/videos` |
| We-AI | `omni-flash-4k` | 4/6/8/10 秒 | 4K | 0/0/0 | `/v1/videos` |
| We-AI | `omni-flash-components-4k` | 4/6/8/10 秒 | 4K | 5/0/0 | `/v1/videos` |
| We-AI | `omni-flash-edit-4k` | 4/6/8/10 秒 | 4K | 0/1/0 | `/v1/videos` |
| 赛博阿飞 API | `grok-imagine-video-1.5-720p` | 1–15 秒 | 720p | 1/0/0 | `/v1/videos/generations` |
| 赛博阿飞 API | `grok-imagine-video-1.5-1080p` | 1–15 秒 | 1080p | 1/0/0 | `/v1/videos/generations` |
| 赛博阿飞 API | `video-v1-5s` | 5 秒 | 由分组确定 | 按分组/0/0 | `/v1/video/generations` |
| 赛博阿飞 API | `video-v1-10s` | 10 秒 | 由分组确定 | 按分组/0/0 | `/v1/video/generations` |
| 赛博阿飞 API | `video-v1-15s` | 15 秒 | 由分组确定 | 按分组/0/0 | `/v1/video/generations` |
| secure-skill | `seedance2.0` | 1–待确认 秒 | 720p | 按分组/按分组/按分组 | `/v1/videos` |
| secure-skill | `seedance-2.5` | 4–30 秒 | 480p/720p | 30/10/10 | `/v1/videos` |
| secure-skill | `doubao-seedance-2-0-260128` | 4–15 秒 | 720p/1080p | 按分组/按分组/按分组 | `/v1/videos` |
| secure-skill | `doubao-seedance-2-0-fast-260128` | 4–15 秒 | 720p | 按分组/按分组/按分组 | `/v1/videos` |
| secure-skill | `doubao-seedance-2-5-260628` | 4–30 秒 | 720p/1080p | 按分组/按分组/按分组 | `/v1/videos` |
| secure-skill | `wan3.0-video` | 2–30 秒 | 480P/720P/1080P | 10/5/5 | `/v1/videos/generations` |
| secure-skill | `wan3.0-video-prime` | 2–30 秒 | 480P/720P/1080P | 10/5/5 | `/v1/videos/generations` |
| secure-skill | `minimax-h3` | 4–15 秒 | 由分组确定 | 按分组/3/3 | `/v1/videos` |
| secure-skill | `grok-imagine-video` | 1–15 秒 | 480p/720p | 7/0/0 | `/openai/v1/videos` |
| secure-skill | `grok-imagine-video-1.5` | 1–15 秒 | 480p/720p/1080p | 7/0/0 | `/openai/v1/videos` |
| secure-skill | `grok-imagine-video-1.5-preview` | 1–15 秒 | 480p/720p/1080p | 7/0/0 | `/openai/v1/videos` |
| secure-skill | `veo_fast` | 8 秒 | 720p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_lite` | 8 秒 | 720p | 1/0/0 | `/v1/jobs` |
| secure-skill | `veo_quan` | 8 秒 | 720p/1080p/4k | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo3.1` | 8 秒 | 720p/1080p/4k | 5/0/0 | `/v1/jobs` |
| secure-skill | `omni` | 4/6/8/10/20/30/40 秒 | 360p/720p/1080p | 5/1/0 | `/v1/jobs` |
| secure-skill | `omni_video_edit` | 4/6/8/10/20/30/40 秒 | 360p/720p/1080p | 5/1/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_fast` | 8 秒 | 720p | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_lite` | 8 秒 | 720p | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v` | 8 秒 | 720p | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_portrait` | 8 秒 | 720p | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_landscape` | 8 秒 | 720p | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_8s` | 8 秒 | 720p | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_1080p` | 8 秒 | 1080p | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_portrait_1080p` | 8 秒 | 1080p | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_landscape_1080p` | 8 秒 | 1080p | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_4k` | 8 秒 | 4k | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_portrait_4k` | 8 秒 | 4k | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_t2v_landscape_4k` | 8 秒 | 4k | 0/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v` | 8 秒 | 720p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_portrait` | 8 秒 | 720p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_landscape` | 8 秒 | 720p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_8s` | 8 秒 | 720p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_portrait_8s` | 8 秒 | 720p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_1080p` | 8 秒 | 1080p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_portrait_1080p` | 8 秒 | 1080p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_landscape_1080p` | 8 秒 | 1080p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_4k` | 8 秒 | 4k | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_portrait_4k` | 8 秒 | 4k | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_landscape_4k` | 8 秒 | 4k | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_fast` | 8 秒 | 720p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_fast_landscape` | 8 秒 | 720p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_r2v_fast_portrait` | 8 秒 | 720p | 5/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_i2v_s_fast_fl` | 8 秒 | 720p | 2/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_i2v_s_fast_portrait_fl` | 8 秒 | 720p | 2/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_i2v_s` | 8 秒 | 720p | 2/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_i2v_s_portrait` | 8 秒 | 720p | 2/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_i2v_lite_landscape` | 8 秒 | 720p | 1/0/0 | `/v1/jobs` |
| secure-skill | `veo_3_1_i2v_lite_portrait` | 8 秒 | 720p | 1/0/0 | `/v1/jobs` |

## 验证和限制

- 未执行任何付费生成；测试使用隔离模拟请求。
- 公开合同数量不是当前Key已开通模型数量；只丰富实时Key扫描返回的精确ID。
- 当前无法取得的能力或价格明确保留待确认，不用同名模型参数、旧价格或通用视频模板补猜。
- 其余13供应商未确认新的音乐生成合同。未知音乐仅展示，具体保存的手工音频合同及主供应商已确认合同可以绑定。
- providers类型检查通过；此前完整基线54文件1140测试通过，Doubao字段修正后的专有合同22测试通过。最终原生视频路由新增35项模拟集成回归，相关5文件274测试全部通过，覆盖无connector的openai/weai连接、原生字段与素材校验、原连接Key查询下载及任务恢复，没有真实生成请求。renderer类型检查通过，针对3文件63测试通过。最终build、全量和安装后的UI结果由总报告汇总。
- 原始公开证据、哈希与具体URL在JSON中；17把辰途Key的能力接口均404。We-AI独立视频站的已有Key6个401、3个网络失败；喵呜由主供应商报告记录403。
