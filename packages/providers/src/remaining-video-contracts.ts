import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ProviderAssetInput, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";

/** Exact supplier contracts re-read from public official documents on 2026-10-07. */
export type RemainingVideoSupplier = "chentu" | "frimodel" | "weai" | "secure" | "cyberafei";
export interface RemainingVideoContext {
  group?: string | undefined;
  groupDescription?: string | undefined;
  model?: ModelDescriptor | undefined;
}
interface VideoContract {
  durations?: readonly number[]; min?: number | undefined; max?: number | undefined;
  resolutions: readonly string[]; ratios: readonly string[];
  images?: number; videos?: number; audios?: number;
  imageField?: string | undefined; videoField?: string | undefined; audioField?: string | undefined;
  secondsField?: "duration" | "seconds"; ratioField?: "ratio" | "aspect_ratio";
  frames?: "array-pair" | "string-pair" | "ordered-images" | "native-pair" | "doubao-content" | "wan-first" | undefined;
  outputAudio?: "audio" | "generate_audio";
  requiresImage?: boolean; requiresVideo?: boolean;
  videoSeconds?: number; audioSeconds?: number;
  videoMinSeconds?: number; videoMaxSeconds?: number; audioMinSeconds?: number;
  defaultDuration?: number; defaultRatio?: string;
  defaultResolution?: string;
  freeRatio?: boolean;
  omitDuration?: boolean; omitResolution?: boolean; omitRatio?: boolean;
  allowFrameMediaMix?: boolean;
  maxAssets?: number;
  extraParameters?: readonly ModelParameterDescriptor[];
  extraWireFields?: readonly string[];
  submitPath?: string; pollPath?: string; contentPath?: string;
  outputPaths?: readonly string[];
  billingUnit?: "request" | "second";
  httpsOnly?: boolean;
  flow?: boolean;
  docs: string; note?: string;
}
const triple = ["16:9", "9:16", "1:1"] as const;
const portrait = ["16:9", "9:16"] as const;
const chentuDocs = "https://tu.988236.xyz/docs/";
const contracts: Record<RemainingVideoSupplier, Record<string, VideoContract>> = { chentu: {}, frimodel: {}, weai: {}, secure: {}, cyberafei: {} };
const put = (s: RemainingVideoSupplier, ids: readonly string[], c: VideoContract) => { for (const id of ids) contracts[s][id] = { ...c }; };
const chentuBase: VideoContract = { min: 4, max: 15, resolutions: ["720p"], ratios: triple, images: 9, videos: 3, audios: 3,
  imageField: "reference_images", videoField: "reference_videos", audioField: "reference_audios", secondsField: "duration", docs: chentuDocs };
for (const res of ["480p", "720p"]) {
  put("chentu", [`seedance-2.0-${res}`, `seedance-2.0-fast-${res}`], { ...chentuBase, resolutions: [res] });
  put("chentu", [`seedance-2.0-431-${res}`, `seedance-2.0-fast-431-${res}`], { ...chentuBase, resolutions: [res], images: 4, audios: 1,
    imageField: res === "480p" ? "image_urls" : "reference_images", videoField: res === "480p" ? "video_reference" : "video_references",
    audioField: "audio_reference", videoSeconds: 15, audioSeconds: 15, videoMinSeconds: 3, videoMaxSeconds: 10, audioMinSeconds: 2,
    note: "431 参考视频每段 3–10 秒，累计不超过 15 秒；参考音频 2–15 秒。" });
}
put("chentu", ["seedance-2.0-s"], { ...chentuBase, min: 10, audioField: "reference_audio_urls" });
put("chentu", ["seedance-2.0-v4"], { ...chentuBase, durations: [10], audioField: "reference_audio_urls" });
put("chentu", ["seedance2.0-mini"], { ...chentuBase, durations: [10], images: 4, audioField: "reference_audio_urls" });
put("chentu", ["PL-seedance-2.0-720p"], { ...chentuBase, durations: [15] });
put("chentu", ["seedance2.0 900"], { ...chentuBase, images: 9, videos: 0, audios: 0, imageField: "images", videoField: undefined, audioField: undefined });
for (const res of ["720p", "1080p"]) {
  put("chentu", [`kling-3.0-omni-${res}`], { ...chentuBase, resolutions: [res], images: 5, videos: 0, audios: 0, videoField: undefined, audioField: undefined });
  put("chentu", [`sp-kling-3.0-omni-${res}`], { ...chentuBase, durations: [5, 10, 15], resolutions: [res], ratios: portrait, images: 2, videos: 1, audios: 0,
    imageField: "image_urls", videoField: "reference_video", audioField: undefined, frames: "ordered-images", outputAudio: "generate_audio",
    note: "动作参考须一张角色图与一个视频；普通首尾帧模式和动作参考模式互斥。" });
  put("chentu", [`happyhorse-${res}`], { ...chentuBase, resolutions: [res], ratios: ["16:9", "4:3", "3:4", "1:1", "9:16"], images: 1, videos: 0, audios: 0,
    imageField: "input_reference", videoField: undefined, audioField: undefined, secondsField: "seconds" });
}
put("chentu", ["kling-o3"], { ...chentuBase, min: 3, resolutions: ["720p", "1080p", "2160p"], images: 7, videos: 1, audios: 0,
  videoField: "input_video", audioField: undefined, secondsField: "seconds", outputAudio: "audio", note: "视频参考模式省略时长，禁止 2160p 和首尾帧。" });
put("chentu", ["kling-v3"], { ...chentuBase, min: 3, resolutions: ["720p", "1080p", "2160p"], images: 0, videos: 0, audios: 0,
  imageField: undefined, videoField: undefined, audioField: undefined, secondsField: "seconds", outputAudio: "audio", frames: "array-pair" });
put("chentu", ["minimax-h3"], { ...chentuBase, min: 5, resolutions: ["1440p"], ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], images: 5, videos: 0,
  videoField: undefined, audioField: "audio_reference", secondsField: "seconds", outputAudio: "audio", frames: "string-pair", audioSeconds: 15,
  note: "普通参考图累计不超过 25 MiB；首尾帧与普通参考图互斥，参考音频累计不超过 15 秒。" });
put("chentu", ["Veo 3.1 Fast 1080p"], { ...chentuBase, durations: [8], resolutions: ["1080p"], ratios: portrait, images: 3, videos: 0, audios: 0,
  imageField: "images", videoField: undefined, audioField: undefined, secondsField: "seconds", outputAudio: "audio" });
put("chentu", ["veo-3.1"], { ...chentuBase, durations: [4, 6, 8], resolutions: ["720p", "1080p"], ratios: portrait, images: 3, videos: 0, audios: 0,
  imageField: "images", videoField: undefined, audioField: undefined, secondsField: "seconds", outputAudio: "audio", frames: "ordered-images" });
put("chentu", ["veo-3.1-lite"], { ...chentuBase, durations: [4, 6, 8], resolutions: ["720p", "1080p"], ratios: portrait, images: 0, videos: 0, audios: 0,
  imageField: "images", videoField: undefined, audioField: undefined, secondsField: "seconds", outputAudio: "audio", frames: "ordered-images" });
put("chentu", ["gemini-omni"], { ...chentuBase, min: 3, max: 10, ratios: portrait, images: 5, videos: 0, audios: 0,
  videoField: undefined, audioField: undefined, secondsField: "seconds", outputAudio: "audio" });
put("chentu", ["gemini-omni-flash"], { ...chentuBase, min: 3, max: 10, ratios: portrait, images: 1, videos: 1, audios: 0,
  videoField: "input_video", audioField: undefined, secondsField: "seconds", outputAudio: "audio", note: "首帧 1、风格图 4、元素图 3；所有图片与源视频合计最多 4 项。" });
put("chentu", ["grok-imagine-video-1.5-preview"], { ...chentuBase, min: 1, resolutions: ["480p", "720p"], images: 7, videos: 0, audios: 0,
  videoField: undefined, audioField: undefined });
put("chentu", ["grok-imagine-video-1.5-fast"], { ...chentuBase, durations: [6, 10, 15], ratios: portrait, images: 7, videos: 0, audios: 0,
  imageField: "input_reference", videoField: undefined, audioField: undefined, requiresImage: true, docs: "https://tu.988236.xyz/docs/api-media.zh-CN.md" });
put("chentu", ["omni-fast", "omni-fast-no-water"], { ...chentuBase, durations: [10], ratios: portrait, images: 5, videos: 0, audios: 0,
  imageField: "images", videoField: undefined, audioField: undefined });
put("chentu", ["omni-fast-v2v", "omni-fast-v2v-no-water"], { ...chentuBase, durations: [10], ratios: portrait, images: 0, videos: 2, audios: 0,
  imageField: undefined, videoField: "videos", audioField: undefined, requiresVideo: true });
put("chentu", ["sora-v3-pro"], { ...chentuBase, min: 1, max: undefined, ratios: [], billingUnit: "second", note: "时长与比例以当前 Key 的 /v1/video/model-capabilities 为准；能力查询暂不可用时不推定枚举范围。故事板未开放。" });

const friSeedDocs = "https://ai-doc.apifox.cn/9155612m0.md";
const friGrokDocs = "https://ai-doc.apifox.cn/9208352m0.md";
const friBase: VideoContract = { min: 4, max: 15, resolutions: ["480p", "720p"], ratios: triple, images: 9, videos: 3, audios: 3,
  imageField: "referenceImages", videoField: "referenceVideos", audioField: "referenceAudios", ratioField: "ratio", secondsField: "duration", videoSeconds: 15, audioSeconds: 15, docs: friSeedDocs };
put("frimodel", ["videos-mini", "videos-fast"], friBase);
put("frimodel", ["videos-standard"], { ...friBase, resolutions: ["480p", "720p", "1080p", "4k"] });
const grokRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
put("frimodel", ["grok-imagine-video"], { ...friBase, min: 1, ratios: grokRatios, images: 7, videos: 0, audios: 0,
  imageField: "images", videoField: undefined, audioField: undefined, ratioField: "aspect_ratio", docs: friGrokDocs, note: "多参考图模式最多 7 张且不超过 10 秒；单图 image 是字符串。" });
put("frimodel", ["grok-imagine-video-1.5-preview"], { ...friBase, min: 1, resolutions: ["480p", "720p", "1080p"], ratios: grokRatios, images: 1, videos: 0, audios: 0,
  imageField: "image", videoField: undefined, audioField: undefined, ratioField: "aspect_ratio", requiresImage: true, docs: friGrokDocs });
const omniBase: VideoContract = { durations: [4, 6, 8, 10], resolutions: ["720p"], ratios: portrait, images: 0, videos: 0, audios: 0,
  secondsField: "seconds", docs: "https://docs.we-ai.cc/guides/omni-video-integration.html" };
for (const [suffix, res] of [["", "720p"], ["-1080p", "1080p"], ["-4k", "4K"]] as const) {
  put("weai", [`omni-flash${suffix}`], { ...omniBase, resolutions: [res] });
  put("weai", [`omni-flash-components${suffix}`], { ...omniBase, resolutions: [res], images: 5, imageField: "images", requiresImage: true });
  put("weai", [`omni-flash-edit${suffix}`], { ...omniBase, resolutions: [res], videos: 1, videoField: "input_video", requiresVideo: true });
}

const secureDocs = "https://token.secure-skill.com/docs";
const secureBase: VideoContract = { min: 1, resolutions: ["720p"], ratios: triple, secondsField: "duration", docs: secureDocs,
  imageField: "images", videoField: "videos", audioField: "audios", outputPaths: ["$.video_url", "$.url", "$.output[0].url", "$.data.video_url", "$.data.url"] };
put("secure", ["seedance2.0"], { ...secureBase, billingUnit: "request", note: "SD 2.0 按条计费；具体素材数量以当前分组说明为准。" });
put("secure", ["seedance-2.5"], { ...secureBase, min: 4, max: 30, secondsField: "seconds", images: 30, videos: 10, audios: 10, maxAssets: 50,
  resolutions: ["480p", "720p"], defaultRatio: "9:16", billingUnit: "second", note: "SD 2.5 按提交秒数计费；XS 分组默认 480p，NewToken 分组默认 720p。三类素材合计最多 50 项。" });
const toggle = (key: string, label: string): ModelParameterDescriptor => ({ key, label, control: "toggle", valueType: "boolean" });
const integer = (key: string, label: string): ModelParameterDescriptor => ({ key, label, control: "number", valueType: "integer", step: 1 });
const doubaoExtra: readonly ModelParameterDescriptor[] = [toggle("watermark", "添加水印"), integer("seed", "随机种子"), toggle("return_last_frame", "返回尾帧"),
  integer("priority", "优先级"), { ...integer("execution_expires_after", "任务超时（秒）"), min: 1 }, toggle("use_asset_library", "自动入库参考素材"),
  { key: "safety_identifier", label: "安全标识", control: "text", valueType: "string" }];
for (const [id, max, resolutions] of [["doubao-seedance-2-0-260128", 15, ["720p", "1080p"]], ["doubao-seedance-2-0-fast-260128", 15, ["720p"]], ["doubao-seedance-2-5-260628", 30, ["720p", "1080p"]]] as const) {
  put("secure", [id], { ...secureBase, min: 4, max, defaultDuration: 4, resolutions, ratios: ["16:9", "9:16", "1:1", "21:9", "4:3", "3:4"],
    frames: "doubao-content", allowFrameMediaMix: true, outputAudio: "generate_audio", extraParameters: doubaoExtra, extraWireFields: ["content", "tools"],
    note: "480p / 4K 仅对价格页明确开通的分组可用。首尾帧各 1 张，不能混用参考图或参考视频，可带参考音频。含参考视频会使用对应参考视频单价。" });
}
put("secure", ["wan3.0-video", "wan3.0-video-prime"], { ...secureBase, min: 2, max: 30, images: 10, videos: 5, audios: 5, resolutions: ["480P", "720P", "1080P"], defaultResolution: "720P",
  ratioField: "ratio", freeRatio: true, frames: "wan-first", imageField: "media", videoField: "media", audioField: "media", httpsOnly: true,
  submitPath: "/v1/videos/generations", pollPath: "/v1/videos/tasks/{taskId}", extraParameters: [toggle("prompt_extend", "扩展提示词")],
  outputPaths: ["$.video_url", "$.url", "$.output.video_url", "$.data.video_url", "$.result.video_url"],
  note: "标准协议支持首帧、普通参考图、视频和音频；只接受公网 HTTPS。标准协议不支持智能时长 -1 或 adaptive 比例。" });
put("secure", ["minimax-h3"], { ...secureBase, min: 4, max: 15, defaultDuration: 15, ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"], freeRatio: true,
  resolutions: [], ratioField: "ratio", frames: "native-pair", imageField: "image_urls", videoField: "video_urls", audioField: "audio_urls", videos: 3, audios: 3,
  httpsOnly: true, note: "图片数量、分辨率、参考视频和首尾帧权限按分组说明。首尾帧不能与参考图、视频或音频混用；2–3 段音频可能要求参考图。未确认的扩展字段不发送。" });
const secureGrok: VideoContract = { ...secureBase, min: 1, max: 15, defaultDuration: 4, defaultRatio: "9:16", ratios: grokRatios, images: 7, videos: 0, audios: 0,
  imageField: "reference_images", videoField: undefined, audioField: "reference_audios", secondsField: "seconds", resolutions: ["480p", "720p"],
  submitPath: "/openai/v1/videos", contentPath: "/openai/v1/videos/{taskId}/content", extraWireFields: ["image"],
  outputPaths: ["$.video.url", "$.video_url", "$.url"], note: "单图与 reference_images 互斥；多图最长 10 秒、最高 720p。查询、下载使用创建任务时同一把 Key。" };
put("secure", ["grok-imagine-video"], secureGrok);
put("secure", ["grok-imagine-video-1.5", "grok-imagine-video-1.5-preview"], { ...secureGrok, resolutions: ["480p", "720p", "1080p"], audios: 3,
  extraParameters: [{ key: "reference_voice_ids", label: "参考声音 ID", control: "text", valueType: "string", description: "最多 3 个供应商 voice_id，以英文逗号分隔；参考音频模式最高 720p。" }],
  note: `${secureGrok.note} 参考音频必须是 voice_id，不能直接发送本地音频或 URL。含音频最高 720p。` });
const flowBase: VideoContract = { durations: [8], defaultDuration: 8, resolutions: ["720p"], ratios: portrait, images: 5, videos: 0, audios: 0,
  docs: secureDocs, flow: true, frames: "ordered-images", omitDuration: true, submitPath: "/v1/jobs", pollPath: "/v1/jobs/{taskId}",
  outputPaths: ["$.url", "$.video_url", "$.data.url", "$.data.video_url", "$.data.source_url", "$.result.url"],
  extraWireFields: ["messages", "mode"], billingUnit: "request",
  extraParameters: [{ key: "mode", label: "视频模式", control: "select", valueType: "string", default: "auto", options: ["auto", "text", "image", "reference"].map(value => ({ label: { auto: "自动", text: "文生视频", image: "首尾帧", reference: "参考图片" }[value]!, value })) }],
  note: "Flow VEO 固定 8 秒，不发送 duration。Fast/Lite 文生仅 720p 横屏；图生仅 720p。质量档高分辨率须分组开通。" };
put("secure", ["veo_fast"], flowBase);
put("secure", ["veo_lite"], { ...flowBase, images: 1, frames: undefined });
put("secure", ["veo_quan"], { ...flowBase, resolutions: ["720p", "1080p", "4k"] });
put("secure", ["veo3.1"], { ...flowBase, resolutions: ["720p", "1080p", "4k"], extraParameters: [...flowBase.extraParameters!,
  { key: "quality", label: "视频质量", control: "select", valueType: "string", default: "fast", options: [{ label: "快速", value: "fast" }, { label: "轻量", value: "lite" }, { label: "高质量", value: "quality" }] }] });
put("secure", ["omni", "omni_video_edit"], { ...flowBase, durations: [4, 6, 8, 10, 20, 30, 40], omitDuration: false, videos: 1, imageField: "images", videoField: "video_url", resolutions: ["360p", "720p", "1080p"],
  frames: undefined, extraParameters: [], extraWireFields: ["messages", "video_url"], videoSeconds: 30,
  note: "Flow Omni 生成支持 4/6/8/10 秒；20/30/40 秒会自动续写。传源视频时输出时长跟随源视频，最长 30 秒，不发送 duration。" });
for (const id of ["veo_3_1_t2v_fast", "veo_3_1_t2v_lite"]) put("secure", [id], { ...flowBase, images: 0, frames: undefined, ratios: ["16:9"], extraParameters: [] });
for (const family of ["t2v", "r2v"]) for (const suffix of ["", "_portrait", "_landscape", "_8s", "_portrait_8s", "_1080p", "_portrait_1080p", "_landscape_1080p", "_4k", "_portrait_4k", "_landscape_4k"]) {
  if (family === "t2v" && suffix === "_portrait_8s") continue;
  put("secure", [`veo_3_1_${family}${suffix}`], { ...flowBase, images: family === "t2v" ? 0 : 5, frames: undefined, extraParameters: [],
    requiresImage: family === "r2v", ratios: [suffix.includes("portrait") ? "9:16" : "16:9"],
    resolutions: [suffix.endsWith("4k") ? "4k" : suffix.endsWith("1080p") ? "1080p" : "720p"] });
}
for (const suffix of ["", "_landscape", "_portrait"]) put("secure", [`veo_3_1_r2v_fast${suffix}`], { ...flowBase, frames: undefined, requiresImage: true, extraParameters: [], ratios: [suffix.includes("portrait") ? "9:16" : "16:9"] });
for (const id of ["veo_3_1_i2v_s_fast_fl", "veo_3_1_i2v_s_fast_portrait_fl", "veo_3_1_i2v_s", "veo_3_1_i2v_s_portrait", "veo_3_1_i2v_lite_landscape", "veo_3_1_i2v_lite_portrait"]) {
  put("secure", [id], { ...flowBase, images: id.includes("lite") ? 1 : 2, frames: id.includes("lite") ? undefined : "ordered-images", requiresImage: true, extraParameters: [],
    ratios: [id.includes("portrait") ? "9:16" : "16:9"] });
}

const afeiDocs = "https://api.3365api.cn/docs/grok-video.md";
for (const resolution of ["720p", "1080p"]) put("cyberafei", [`grok-imagine-video-1.5-${resolution}`], { min: 1, max: 15, defaultDuration: 6,
  resolutions: [resolution], ratios: grokRatios, images: 1, videos: 0, audios: 0, imageField: "image", requiresImage: true, docs: afeiDocs, omitResolution: true,
  submitPath: "/v1/videos/generations", extraWireFields: ["image"], outputPaths: ["$.video.url", "$.result_url", "$.data.result_url"] });
for (const duration of [5, 10, 15]) put("cyberafei", [`video-v1-${duration}s`], { durations: [duration], resolutions: [], ratios: triple, imageField: "images", videos: 0, audios: 0,
  ratioField: "ratio", omitDuration: true, omitResolution: true, docs: "https://api.3365api.cn/docs/sd20.md", submitPath: "/v1/video/generations",
  pollPath: "/v1/video/generations/{taskId}", outputPaths: ["$.result_url", "$.data.result_url", "$.video.url"], billingUnit: "request", note: "时长由完整模型名固定；不会发送额外 duration 或 resolution。" });

function contractFor(supplier: RemainingVideoSupplier, id: string, context: RemainingVideoContext = {}): VideoContract | undefined {
  const c = contracts[supplier][id]; if (!c) return undefined;
  const group = context.group ?? String(context.model?.metadata?.modelGroup ?? "");
  if (supplier !== "secure") return c;
  const description = context.groupDescription ?? String(context.model?.metadata?.groupDescription ?? context.model?.metadata?.supplierGroupDescription ?? "");
  if (c.flow && !/flow/iu.test(`${group} ${description}`)) return undefined;
  if (id === "omni_video_edit") return { ...c, requiresVideo: true };
  if ((id === "seedance-2.5" || id === "seedance2.0") && /vivid/iu.test(`${group} ${description}`)) return { ...c,
    durations: [15], min: undefined, max: undefined, omitRatio: true, images: 9, videos: 3, audios: 3, secondsField: "duration",
    imageField: "image_urls", videoField: "video_urls", audioField: "audio_urls", resolutions: id === "seedance2.0" ? ["720p"] : ["480p", "720p", "1080p", "4K"],
    note: "VividAI Seedance 固定 15 秒，忽略画幅；参考图 9、视频 3、音频 3。清晰度权限及价格以当前分组为准。" };
  if (id === "seedance-2.5" || id === "seedance2.0") {
    if (!/(?:seedance|sd|xs|newtoken)/iu.test(`${group} ${description}`)) return undefined;
    if (id === "seedance-2.5" && group === "sd-2.5-条") return { ...c, billingUnit: "request", resolutions: ["720p"], defaultResolution: "720p",
      note: "当前分组按条计费，支持 4–30 秒、720p；参考图 30、视频 10、音频 10，合计最多 50 项。价格取当前分组报价，不随请求秒数相乘。" };
    return { ...c, defaultResolution: /(?:^|[\s_-])xs(?:$|[\s_-])/iu.test(group) ? "480p" : "720p" };
  }
  if (id.startsWith("doubao-seedance-") && !id.includes("fast")) {
    const confirmed = context.model?.metadata?.videoSupportedResolutions;
    return { ...c, resolutions: Array.isArray(confirmed) ? c.resolutions.concat(confirmed.filter((r): r is string => typeof r === "string" && ["480p", "4K"].includes(r))) : c.resolutions };
  }
  if (id.startsWith("grok-") && /grok2api/iu.test(`${group} ${description}`)) return { ...c, audios: 0 };
  if (id === "minimax-h3") {
    const resolutions = context.model?.metadata?.videoSupportedResolutions;
    return { ...c, resolutions: Array.isArray(resolutions) ? resolutions.filter((r): r is string => typeof r === "string") : [],
      ...(context.model?.limits?.maxInputImages === undefined ? {} : { images: context.model.limits.maxInputImages }) };
  }
  return c;
}

export function remainingVideoSupplier(baseUrl: unknown): RemainingVideoSupplier | undefined {
  try { const host = new URL(String(baseUrl)).hostname.toLowerCase();
    return host === "tu.988236.xyz" ? "chentu" : ["api.frimodel.com", "platform.frimodel.com"].includes(host) ? "frimodel" : host === "video.we-token.cc" ? "weai" : host === "token.secure-skill.com" ? "secure" : host === "api.3365api.cn" ? "cyberafei" : undefined;
  } catch { return undefined; }
}
export const remainingVideoModelIds = (supplier: RemainingVideoSupplier): string[] => Object.keys(contracts[supplier]);
export const isRemainingVideoModel = (supplier: RemainingVideoSupplier | undefined, id: string | undefined, context?: RemainingVideoContext): boolean => Boolean(supplier && id && contractFor(supplier, id, context));
export function remainingVideoModel(supplier: RemainingVideoSupplier, id: string, current?: ModelDescriptor, context?: RemainingVideoContext): ModelDescriptor | undefined {
  const c = contractFor(supplier, id, { model: current, ...context }); if (!c) return undefined;
  const parameters: ModelParameterDescriptor[] = [{ key: "duration", label: "视频时长", control: c.durations ? "select" : "number", valueType: "integer", required: true,
    default: c.defaultDuration ?? c.durations?.[0] ?? Math.max(c.min ?? 1, 5), ...(c.durations ? { options: c.durations.map(value => ({ label: `${value} 秒`, value })) } : { min: c.min ?? 1, ...(c.max ? { max: c.max } : {}), step: 1 }),
    ...(c.note ? { description: c.note } : {}) },
    ...(!c.omitRatio ? [{ key: "aspect_ratio", label: "画面比例", control: c.freeRatio || !c.ratios.length ? "text" as const : "select" as const, valueType: "string" as const,
      ...(c.ratios.length ? { default: c.defaultRatio ?? c.ratios[0]!, options: c.ratios.map(value => ({ label: value, value })) } : { description: "比例以当前 Key 能力接口为准；留空使用供应商默认值。" }) }] : []),
    ...(c.resolutions.length ? [{ key: "resolution", label: "输出分辨率", control: "select" as const, valueType: "string" as const, default: c.defaultResolution ?? (c.resolutions.includes("720p") ? "720p" : c.resolutions[0]!), required: supplier !== "weai", options: c.resolutions.map(value => ({ label: value, value })),
      ...(supplier === "weai" || c.omitResolution ? { description: "输出档位由完整模型名固定；不会额外发送 resolution。" } : {}) }] : []),
    ...(c.outputAudio ? [{ key: "generate_audio", label: "生成声音", control: "toggle" as const, valueType: "boolean" as const, default: true }] : []), ...(c.extraParameters ?? [])];
  return { ...current, id, name: current?.name ?? id, operations: c.requiresImage ? ["video.image-to-video"] : c.requiresVideo ? ["video.generate"] : ["video.generate", "video.image-to-video"],
    inputKinds: ["text", ...(c.images || c.imageField || c.frames ? ["image" as const, "image[]" as const] : []), ...(c.videoField && c.videos !== 0 ? ["video" as const, "video[]" as const] : []), ...(c.audioField && c.audios !== 0 && !(supplier === "secure" && id.startsWith("grok-")) ? ["audio" as const, "audio[]" as const] : [])], outputKinds: ["video"], parameters,
    limits: { ...current?.limits, ...(c.images === undefined ? {} : { maxInputImages: Math.max(c.images, c.frames ? 2 : 0) }), ...(c.videos === undefined ? {} : { maxInputVideos: c.videos }),
      ...(c.audios === undefined ? {} : { maxInputAudios: supplier === "secure" && id.startsWith("grok-") ? 0 : c.audios }), ...(c.maxAssets ? { maxInputAssets: c.maxAssets } : {}), ...(c.requiresImage ? { requiresInputImage: true } : {}), ...(c.requiresVideo ? { requiresInputVideo: true } : {}),
      ...(c.videoSeconds ? { maxTotalInputVideoDurationSeconds: c.videoSeconds } : {}), ...(c.audioSeconds ? { maxInputAudioDurationSeconds: c.audioSeconds } : {}) },
    metadata: { ...current?.metadata, supplier, modality: "video", catalogCapability: "video", operationsSource: "declared", outputKindsSource: "declared", protocol: "openai-videos", documentationUrl: c.docs, videoContractCheckedAt: "2026-10-07", remoteMediaUrlsOnly: true,
      videoReferenceImageLimit: c.images, videoReferenceVideoLimit: c.videos, videoReferenceAudioLimit: c.audios,
      supportsFirstLastFrames: Boolean(c.frames), videoSupportsFirstLastFrames: Boolean(c.frames), allowFrameMediaMix: Boolean(c.allowFrameMediaMix), videoSupportedResolutions: [...c.resolutions],
      ...(c.billingUnit ? { billingUnit: c.billingUnit, billingLabel: c.billingUnit === "second" ? "按秒计费" : "按次计费" } : {}),
      videoDurationValues: c.durations ? [...c.durations] : undefined, videoMinDuration: c.min, videoMaxDuration: c.max, videoContractNote: c.note } };
}

const array = (value: unknown): unknown[] => Array.isArray(value) ? value : value === undefined ? [] : [value];
const imageRoles = (assets: readonly ProviderAssetInput[], role: "firstFrame" | "lastFrame") => assets.filter(a => a.kind === "image" && a.role === role).map(a => a.url);
/** Produces only documented wire fields and keeps the user's asset order. */
export function normalizeRemainingVideoParameters(supplier: RemainingVideoSupplier, request: NormalizedRequest, context?: RemainingVideoContext): Record<string, unknown> {
  const c = contractFor(supplier, request.model ?? "", context); if (!c) return { ...request.parameters };
  const original = request.parameters ?? {}, assets = request.assets ?? [], p: Record<string, unknown> = {};
  if (!c.omitDuration) p[c.secondsField ?? "duration"] = original.duration ?? original.seconds ?? c.defaultDuration ?? c.durations?.[0] ?? Math.max(c.min ?? 1, 5);
  if (!c.omitRatio) p[c.ratioField ?? "aspect_ratio"] = original.aspect_ratio ?? original.ratio ?? c.defaultRatio ?? c.ratios[0];
  if (supplier !== "weai" && !c.omitResolution && c.resolutions.length) p.resolution = original.resolution ?? c.defaultResolution ?? (c.resolutions.includes("720p") ? "720p" : c.resolutions[0]);
  const byKind = (kind: "image" | "video" | "audio") => assets.filter(a => a.kind === kind && (!a.role || a.role === "reference")).map(a => a.url);
  for (const [kind, field] of [["image", c.imageField], ["video", c.videoField], ["audio", c.audioField]] as const) {
    if (!field || supplier === "secure" && (request.model?.startsWith("wan3.") || request.model?.startsWith("grok-") && kind === "audio")) continue;
    const values = [...array(original[field]), ...byKind(kind)];
    if (!values.length) continue;
    if (supplier === "chentu" && field === "input_reference" && request.model !== "grok-imagine-video-1.5-fast") p[field] = original[field] ?? { image_url: values[0] };
    else if (field === "video_reference") p[field] = values.map(value => typeof value === "string" ? { url: value } : value);
    else if (supplier === "cyberafei" && field === "image") p[field] = typeof values[0] === "string" ? { url: values[0] } : values[0];
    else if (["input_video", "reference_video", "image"].includes(field) || field === "audio_reference" && c.audios === 1) p[field] = values[0];
    else p[field] = values;
  }
  const first = original.start_frame ?? original.first_frame ?? imageRoles(assets, "firstFrame")[0], last = original.end_frame ?? original.last_frame ?? imageRoles(assets, "lastFrame")[0];
  if (c.frames === "array-pair") { if (first !== undefined) p.start_frame = array(first); if (last !== undefined) p.end_frame = array(last); }
  if (c.frames === "string-pair") { if (first !== undefined) p.start_frame = first; if (last !== undefined) p.end_frame = last; }
  if (c.frames === "ordered-images" && !c.flow && (first !== undefined || last !== undefined)) p[c.imageField!] = [first, last].filter(x => x !== undefined);
  if (c.frames === "native-pair") { if (first !== undefined || original.first_frame !== undefined) p.first_frame = original.first_frame ?? first; if (last !== undefined || original.last_frame !== undefined) p.last_frame = original.last_frame ?? last; }
  if (c.frames === "doubao-content" && (first !== undefined || last !== undefined || original.content !== undefined)) {
    p.content = original.content ?? [{ type: "text", text: request.prompt },
      ...(first === undefined ? [] : [{ type: "image_url", image_url: { url: first }, role: "first_frame" }]),
      ...(last === undefined ? [] : [{ type: "image_url", image_url: { url: last }, role: "last_frame" }]),
      ...(["image", "video", "audio"] as const).flatMap(kind => array(p[`${kind}s`]).map(url => ({ type: `${kind}_url`, [`${kind}_url`]: { url }, role: `reference_${kind}` })))];
    delete p.images; delete p.videos; delete p.audios;
  }
  if (supplier === "secure" && request.model?.startsWith("wan3.")) p.media = [...array(original.media), ...assets.map(asset => ({
    type: asset.kind === "image" ? asset.role === "firstFrame" ? "first_frame" : "reference_image" : asset.kind === "audio" ? "audio" : "reference_video", url: asset.url,
  }))];
  if (c.outputAudio && (original.generate_audio !== undefined || original.audio !== undefined)) p[c.outputAudio] = original.generate_audio ?? original.audio;
  if (supplier === "chentu" && request.model === "kling-o3" && p.input_video) { delete p.seconds; }
  if (supplier === "chentu" && request.model?.startsWith("sp-kling-") && p.reference_video) { p.image_url = original.image_url ?? array(p.image_urls)[0]; delete p.image_urls; }
  if (supplier === "chentu" && request.model === "gemini-omni-flash") for (const field of ["style_references", "element_references"] as const) if (original[field] !== undefined) p[field] = original[field];
  if (supplier === "frimodel" && request.model?.startsWith("grok-")) {
    const images = array(p.images ?? p.image); delete p.images; delete p.image;
    if (images.length === 1) { p.image = images[0]; p.mode = "image-to-video"; }
    else if (images.length > 1) { p.images = images; p.mode = "reference-to-video"; }
    else p.mode = "text-to-video";
  }
  if (supplier === "weai" && request.model?.startsWith("omni-flash-components") && original.image !== undefined) p.image = original.image;
  if (supplier === "secure" && request.model?.startsWith("grok-")) {
    const refs = array(p.reference_images);
    if (original.image !== undefined || original.input_reference !== undefined) p.image = original.image ?? original.input_reference;
    else if (refs.length === 1) { p.image = typeof refs[0] === "string" ? { url: refs[0] } : refs[0]; delete p.reference_images; }
    else if (refs.length > 1) p.reference_images = refs.map(value => typeof value === "string" ? { url: value } : value);
    if (original.reference_audios !== undefined) p.reference_audios = original.reference_audios;
    if (typeof original.reference_voice_ids === "string" && original.reference_voice_ids.trim()) p.reference_audios = original.reference_voice_ids.split(",").map(voice_id => ({ voice_id: voice_id.trim() })).filter(item => item.voice_id);
  }
  for (const field of [...(c.extraParameters ?? []).map(parameter => parameter.key), ...(c.extraWireFields ?? [])]) if (original[field] !== undefined && p[field] === undefined) p[field] = original[field];
  delete p.reference_voice_ids;
  if (c.flow) {
    const images = assets.filter(asset => asset.kind === "image").map(asset => ({ type: "image_url", image_url: { url: asset.url } }));
    p.messages = [{ role: "user", content: images.length ? [{ type: "text", text: request.prompt }, ...images] : request.prompt }];
    if (first !== undefined || last !== undefined) p.mode = "image";
    if (p.mode === "auto") delete p.mode;
    delete p.images;
    if (request.model === "omni" || request.model === "omni_video_edit") {
      if (p.video_url) delete p.duration;
    }
  }
  return p;
}
export function remainingVideoTransport(supplier: RemainingVideoSupplier, id: string, context?: RemainingVideoContext): RestModelConnectorOverride | undefined {
  const c = contractFor(supplier, id, context); if (!c) return undefined;
  const fields = [...new Set([...(c.omitDuration ? [] : [c.secondsField ?? "duration"]), ...(c.omitRatio ? [] : [c.ratioField ?? "aspect_ratio"]), ...(supplier === "weai" || c.omitResolution ? [] : ["resolution"]), ...(c.flow ? [] : [c.imageField]), c.videoField, c.audioField,
    ...(c.frames === "native-pair" ? ["first_frame", "last_frame"] : c.frames === "doubao-content" ? ["content"] : c.frames === "wan-first" ? ["media"] : c.frames ? ["start_frame", "end_frame"] : []), ...(c.outputAudio ? [c.outputAudio] : []), ...(supplier === "frimodel" && id.startsWith("grok-") ? ["image", "images", "mode"] : []),
    ...(supplier === "weai" && id.startsWith("omni-flash-components") ? ["image"] : []), ...(c.extraParameters ?? []).map(parameter => parameter.key).filter(key => key !== "reference_voice_ids"), ...(c.extraWireFields ?? []),
    ...(id.startsWith("sp-kling-") ? ["image_url"] : []), ...(id === "gemini-omni-flash" ? ["style_references", "element_references"] : [])].filter((s): s is string => Boolean(s)))];
  const response = { taskIdPath: "$.task_id", taskIdFallbackPaths: ["$.id", "$.request_id", "$.data.task_id", "$.data.id"], statusPath: "$.status", statusFallbackPaths: ["$.data.status"], errorPath: "$.error.message", progressPath: "$.progress" };
  const paths = c.outputPaths ?? (supplier === "chentu" ? ["$.download_url", "$.data.download_url", "$.metadata.url"] : ["$.video_url", "$.url", "$.metadata.url", "$.data.video_url"]);
  return { submit: { path: c.submitPath ?? "/v1/videos", method: "POST", bodyMode: "json", idempotent: false,
    mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, ...(c.flow ? [] : [{ target: "/prompt", source: { kind: "request" as const, path: "$.prompt" } }]),
      ...fields.map(field => ({ target: `/${field}`, source: { kind: "request" as const, path: `$.parameters.${field}` }, omitIfUndefined: true, omitIfEmpty: true }))], response },
    poll: { path: c.pollPath ?? "/v1/videos/{taskId}", method: "GET", bodyMode: "none", response }, pollIntervalMs: c.pollPath === "/v1/video/generations/{taskId}" ? 15_000 : supplier === "frimodel" ? 5_000 : 4_000,
    statusMap: { queued: "queued", pending: "queued", in_progress: "running", processing: "running", running: "running", unknown: "running", completed: "succeeded", succeeded: "succeeded", done: "succeeded", success: "succeeded", error: "failed", failed: "failed", cancelled: "cancelled", canceled: "cancelled", expired: "failed", timeout: "failed", IN_PROGRESS: "running", SUCCESS: "succeeded", FAILURE: "failed" },
    output: { path: paths[0]!, fallbackPaths: [...paths.slice(1)], kind: "video", defaultMimeType: "video/mp4",
      ...(c.flow || c.pollPath === "/v1/videos/tasks/{taskId}" ? {} : { contentFallback: { path: c.contentPath ?? "/v1/videos/{taskId}/content" } }) } };
}
export function remainingVideoRequestIssues(supplier: RemainingVideoSupplier, request: NormalizedRequest, context?: RemainingVideoContext): ValidationIssue[] {
  const c = contractFor(supplier, request.model ?? "", context); if (!c) return [];
  const p = normalizeRemainingVideoParameters(supplier, request, context), issues: ValidationIssue[] = [], add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  const seconds = c.omitDuration ? request.parameters?.duration ?? c.durations?.[0] : p[c.secondsField ?? "duration"];
  if (seconds !== undefined && (typeof seconds !== "number" || !Number.isInteger(seconds) || c.durations && !c.durations.includes(seconds) || c.min !== undefined && seconds < c.min || c.max !== undefined && seconds > c.max)) add("parameters.duration", c.durations ? `此型号只支持 ${c.durations.join(" / ")} 秒。` : `时长必须为 ${c.min ?? 1}${c.max ? `–${c.max}` : " 以上"} 的整数秒。`);
  const ratio = p[c.ratioField ?? "aspect_ratio"];
  if (!c.omitRatio && !c.freeRatio && c.ratios.length && !c.ratios.includes(String(ratio))) add("parameters.aspect_ratio", `此型号比例仅支持 ${c.ratios.join(" / ")}。`);
  if (c.freeRatio && !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/u.test(String(ratio))) add("parameters.aspect_ratio", "画面比例必须为正数宽高比，例如 16:9。");
  const resolution = request.parameters?.resolution ?? p.resolution;
  if (resolution !== undefined && c.resolutions.length && !c.resolutions.includes(String(resolution))) add("parameters.resolution", `此型号分辨率仅支持 ${c.resolutions.join(" / ")}。`);
  if (request.parameters?.duration !== undefined && request.parameters.seconds !== undefined && request.parameters.duration !== request.parameters.seconds) add("parameters.duration", "duration 与 seconds 不能冲突。");
  const assets = request.assets ?? [], counts = { image: 0, video: 0, audio: 0 };
  const content = array(request.parameters?.content).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  for (const [kind, limit, field] of [["image", c.images, c.imageField], ["video", c.videos, c.videoField], ["audio", c.audios, c.audioField]] as const) {
    const native = field ? array(request.parameters?.[field]) : [], list = assets.filter(a => a.kind === kind && (!a.role || a.role === "reference")); counts[kind] = native.length + list.length;
    // Grok's single image string is a separate accepted input field.
    if (supplier === "frimodel" && kind === "image" && request.model === "grok-imagine-video") counts.image += array(request.parameters?.image).length;
    if (supplier === "secure" && request.model?.startsWith("wan3.")) counts[kind] = native.filter(item => item && typeof item === "object" && (item as { type?: unknown }).type === (kind === "audio" ? "audio" : `reference_${kind}`)).length + list.length;
    if (supplier === "secure" && request.model?.startsWith("grok-") && kind === "image") counts.image += array(request.parameters?.image ?? request.parameters?.input_reference).length;
    if (supplier === "weai" && kind === "image") counts.image += array(request.parameters?.image).length;
    if (supplier === "chentu" && kind === "image" && request.model?.startsWith("sp-kling-")) counts.image += array(request.parameters?.image_url).length;
    if (c.frames === "doubao-content") counts[kind] += content.filter(item => item.type === `${kind}_url` && !["first_frame", "last_frame"].includes(String(item.role))).length;
    if (limit !== undefined && counts[kind] > limit) add("assets", limit ? `此型号最多接受 ${limit} 个${kind === "image" ? "参考图" : kind === "video" ? "参考视频" : "参考音频"}。` : `此型号不支持${kind === "image" ? "普通参考图" : kind === "video" ? "参考视频" : "参考音频"}。`);
  }
  if (c.requiresImage && !counts.image && !(c.flow && assets.some(asset => asset.kind === "image"))) add("assets", "此型号必须提供参考图片。");
  if (c.requiresVideo && !counts.video) add("assets", "此型号必须提供源视频。");
  const first = imageRoles(assets, "firstFrame"), last = imageRoles(assets, "lastFrame"),
    firstCount = first.length + array(request.parameters?.start_frame ?? request.parameters?.first_frame).length + content.filter(item => item.role === "first_frame").length,
    lastCount = last.length + array(request.parameters?.end_frame ?? request.parameters?.last_frame).length + content.filter(item => item.role === "last_frame").length,
    hasFirst = firstCount > 0, hasLast = lastCount > 0;
  if (firstCount > 1 || lastCount > 1) add("assets", "首帧和尾帧分别最多一张。");
  if ((hasFirst || hasLast) && !c.frames) add("assets", "此型号没有已确认的首尾帧合同，请使用普通参考图。");
  if (hasLast && !hasFirst && c.frames !== "doubao-content") add("assets", "尾帧必须与首帧一起提供。");
  if ((hasFirst || hasLast) && counts.image) add("assets", "首尾帧与普通参考图不能混用。");
  if (c.frames === "wan-first" && hasLast) add("assets", "Wan3 标准协议不支持尾帧；请使用首帧或普通参考素材。");
  if (c.frames === "wan-first") {
    const media = array(request.parameters?.media);
    if (media.some(item => !item || typeof item !== "object" || !["first_frame", "reference_image", "reference_video", "audio"].includes(String((item as { type?: unknown }).type)))) add("parameters.media", "Wan3 标准协议素材类型只能为 first_frame/reference_image/reference_video/audio。");
    const nativeFirst = media.filter(item => item && typeof item === "object" && (item as { type?: unknown }).type === "first_frame").length;
    if (nativeFirst + firstCount > 1) add("assets", "Wan3 首帧最多一张。");
    if ((nativeFirst || hasFirst) && counts.image + counts.video + counts.audio) add("assets", "Wan3 首帧不能与其他参考素材混用。");
  }
  if (supplier === "secure" && c.frames === "native-pair" && (hasFirst || hasLast) && (counts.video || counts.audio)) add("assets", "MiniMax 首尾帧不能与参考视频或参考音频混用。");
  if (c.frames === "doubao-content" && (hasFirst || hasLast) && counts.video) add("assets", "Doubao 首尾帧不能与参考视频混用。");
  if (c.frames === "doubao-content" && request.parameters?.content !== undefined) {
    const texts = content.filter(item => item.type === "text");
    if (texts.length !== 1 || typeof texts[0]?.text !== "string" || texts[0].text !== request.prompt) add("parameters.content", "原生 content 必须包含一条与提示词一致的非空 text。");
    if (assets.length || request.parameters?.images || request.parameters?.videos || request.parameters?.audios) add("parameters.content", "原生 content 不能与画布素材或扁平素材字段混用。");
  }
  if (c.maxAssets && counts.image + counts.video + counts.audio + firstCount + lastCount > c.maxAssets) add("assets", `所有参考素材合计最多 ${c.maxAssets} 项。`);
  if (supplier === "secure" && request.model?.startsWith("grok-")) {
    const voices = array(p.reference_audios);
    if (assets.some(asset => asset.kind === "audio")) add("assets", "Grok 参考声音只接受供应商 voice_id，不接受音频素材 URL。");
    if (voices.length > (c.audios ?? 0)) add("parameters.reference_voice_ids", `此分组最多接受 ${c.audios ?? 0} 个 voice_id。`);
    if (voices.some(voice => !voice || typeof voice !== "object" || typeof (voice as { voice_id?: unknown }).voice_id !== "string" || !(voice as { voice_id: string }).voice_id.trim())) add("parameters.reference_audios", "参考声音必须使用非空 voice_id 对象。");
    const referenceMode = counts.image > 1 || voices.length > 0;
    if (referenceMode && resolution === "1080p") add("parameters.resolution", "Grok 多参考图或参考声音模式最高 720p。");
    if (counts.image > 1 && typeof seconds === "number" && seconds > 10) add("parameters.duration", "Grok 多参考图模式最长 10 秒。");
    if ((request.parameters?.image !== undefined || request.parameters?.input_reference !== undefined) && (array(request.parameters?.reference_images).length || assets.some(asset => asset.kind === "image"))) add("assets", "Grok 单图 image/input_reference 不能与参考图片混用。");
  }
  if (c.flow) {
    const imageCount = assets.filter(asset => asset.kind === "image").length;
    if (c.images !== undefined && imageCount > c.images) add("assets", `此 Flow 型号最多接受 ${c.images} 张图片。`);
    if (c.requiresImage && !imageCount) add("assets", "此 Flow 型号必须提供图片。");
    const quality = request.model === "veo_lite" ? "lite" : request.model === "veo_quan" ? "quality" : request.parameters?.quality ?? "fast";
    const mode = p.mode ?? (imageCount === 0 ? "text" : imageCount === 1 || hasFirst || hasLast ? "image" : "reference");
    if (["veo_fast", "veo_lite", "veo_quan", "veo3.1"].includes(request.model ?? "")) {
      if (mode === "text" && imageCount || mode === "image" && !imageCount || mode === "reference" && !imageCount) add("parameters.mode", "视频模式与所提供的图片数量不一致。");
      if ((request.model === "veo_fast" || request.model === "veo_lite" || request.model === "veo3.1" && quality !== "quality") && mode === "text" && ratio !== "16:9") add("parameters.aspect_ratio", "Flow Fast/Lite 文生视频只支持 16:9。");
      if (quality === "lite" && (imageCount > 1 || mode === "reference")) add("assets", "Flow Lite 不支持多参考或首尾帧。");
      if (resolution !== "720p" && (quality !== "quality" || mode === "image")) add("parameters.resolution", "高分辨率仅用于 Flow 质量档的文生或多参考模式。");
    }
  }
  const totalVideoSeconds = assets.filter(asset => asset.kind === "video").reduce((sum, asset) => sum + (asset.durationSeconds ?? 0), 0);
  if (c.videoSeconds && totalVideoSeconds > c.videoSeconds) add("assets", `参考视频实际累计时长最多 ${c.videoSeconds} 秒。`);
  const totalAudioSeconds = assets.filter(asset => asset.kind === "audio").reduce((sum, asset) => sum + (asset.durationSeconds ?? 0), 0);
  if (c.audioSeconds && totalAudioSeconds > c.audioSeconds) add("assets", `参考音频实际累计时长最多 ${c.audioSeconds} 秒。`);
  if (c.httpsOnly) {
    const urls = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(urls) : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => ["url", "image_url", "video_url", "audio_url"].includes(key) ? urls(child) : []) : [];
    const nativeUrls = [...new Set([c.imageField, c.videoField, c.audioField, "start_frame", "end_frame", "first_frame", "last_frame"].filter((key): key is string => Boolean(key)))].flatMap(field => urls(request.parameters?.[field]));
    if ([...nativeUrls, ...assets.flatMap(asset => asset.url ? [asset.url] : [])].some(url => !/^https:\/\//iu.test(url))) add("assets", "此型号的参考素材必须使用公网 HTTPS 地址。");
  }
  if (supplier === "chentu" && request.model === "kling-o3" && counts.video && resolution === "2160p") add("parameters.resolution", "Kling O3 视频参考模式只能选择 720p 或 1080p。");
  if (supplier === "chentu" && request.model?.startsWith("sp-kling-") && counts.video && (counts.image !== 1 || hasFirst || hasLast)) add("assets", "SP Kling 动作参考须一张角色图与一个视频，不能混用首尾帧。");
  if (supplier === "chentu" && request.model === "gemini-omni-flash" && counts.image + counts.video + array(request.parameters?.style_references).length + array(request.parameters?.element_references).length > 4) add("assets", "Gemini Omni Flash 的图片与源视频合计最多 4 项。");
  if (supplier === "chentu" && request.model === "gemini-omni-flash" && array(request.parameters?.style_references).length > 4) add("parameters.style_references", "风格参考图最多 4 张。");
  if (supplier === "chentu" && request.model === "gemini-omni-flash" && array(request.parameters?.element_references).length > 3) add("parameters.element_references", "元素参考图最多 3 张。");
  for (const asset of assets) {
    if (asset.kind === "video" && asset.durationSeconds !== undefined && (c.videoMinSeconds !== undefined && asset.durationSeconds < c.videoMinSeconds || c.videoMaxSeconds !== undefined && asset.durationSeconds > c.videoMaxSeconds)) add("assets", `每段参考视频必须为 ${c.videoMinSeconds ?? 0}–${c.videoMaxSeconds ?? c.videoSeconds} 秒。`);
    if (asset.kind === "audio" && asset.durationSeconds !== undefined && c.audioMinSeconds !== undefined && asset.durationSeconds < c.audioMinSeconds) add("assets", `每段参考音频至少 ${c.audioMinSeconds} 秒。`);
  }
  if (supplier === "frimodel" && request.model === "grok-imagine-video" && counts.image > 1 && typeof seconds === "number" && seconds > 10) add("parameters.duration", "FriModel Grok 多参考图模式最长 10 秒。");
  if (request.operation === "video.image-to-video" && !counts.image && !hasFirst) add("assets", "图生视频需要提供参考图或首帧。");
  return issues;
}
