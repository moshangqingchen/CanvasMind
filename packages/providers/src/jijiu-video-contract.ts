import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ProviderAssetInput, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";

export const JIJIU_VIDEO_DOCS = "https://newapi.jijiucanvas.com/docs/api-docs.md";
interface Contract {
  group: string; min: number; max: number; resolutions?: readonly string[]; durations?: readonly number[];
  images?: number; videos?: number; audios?: number; inputDurationBilling?: boolean;
  wan?: boolean; wanJson?: boolean; minimax?: boolean; openDuration?: boolean; note?: string;
  referenceOnly?: boolean; httpsOnly?: boolean; ratios?: readonly string[]; mediaMinSeconds?: number; mediaTotalSeconds?: number; totalAssets?: number;
  fields?: readonly [string, string | undefined, string | undefined];
}
/** Exact IDs from the current pricing directory; bounds from the same site's guide §4.5. */
const contracts: Readonly<Record<string, Contract>> = {
  MinimaxH3: { group: "视频-MnimaxH3", min: 4, max: 15, openDuration: true, resolutions: ["480p", "768p", "1080p", "2k-upscale", "4k-upscale"], images: 9, videos: 3, audios: 3, minimax: true, fields: ["reference_images", "reference_videos", "reference_audios"] },
  "Minimax漫剧优化版": { group: "视频-MnimaxH3", min: 4, max: 15, openDuration: true, resolutions: ["480p", "768p", "2k-upscale", "4k-upscale"], images: 9, videos: 3, audios: 3, minimax: true,
    note: "1080p 未开放；官网说明该输入会按 768p 出片并计费，当前不提供伪 1080p 选项。" },
  "MinimaxH3特价版": { group: "视频-MnimaxH3", min: 4, max: 15, fields: ["reference_images", "reference_videos", "reference_audios"], note: "固定 2K 出片；resolution 使用供应商声明的字符串字段，未公布此线路完整输入枚举。" },
  "SD2.0满血稳定933-线路一": { group: "视频SD2.0", min: 4, max: 15, resolutions: ["720p"], images: 9, videos: 3, audios: 3, fields: ["images", "videos", "audios"] },
  "SD2.0满血稳定933-线路二": { group: "视频SD2.0", min: 5, max: 15, resolutions: ["720p"], images: 9, videos: 3, audios: 3, fields: ["images", "videos", "audios"] },
  "SD2.0满血稳定933-线路三": { group: "视频SD2.0", min: 5, max: 15, resolutions: ["720p"], images: 9, videos: 3, audios: 3, httpsOnly: true, fields: ["images", "video_refs", "audio_refs"] },
  "SD2.0满血稳定933-线路四": { group: "视频SD2.0", min: 4, max: 15, resolutions: ["720p"], images: 9, videos: 3, audios: 3, httpsOnly: true, fields: ["imageUrls", "videoUrls", "audioUrls"], note: "供应商说明此线路带数字水印，按次计费。" },
  "SD2.0fast稳定903A": { group: "视频SD2.0", min: 4, max: 15, resolutions: ["720p"], images: 9, videos: 0, audios: 3 },
  "SD2.0fast稳定900D": { group: "视频SD2.0", min: 5, max: 15, durations: [5, 10, 15], ratios: ["9:16"], resolutions: ["720p"], images: 9, videos: 0, audios: 0, fields: ["reference_images", undefined, undefined] },
  "SD2.0mini稳定900B": { group: "视频SD2.0", min: 5, max: 15, resolutions: ["720p"], images: 9, videos: 0, audios: 0, fields: ["image_urls", undefined, undefined] },
  "SD2.0mini稳定903C": { group: "视频SD2.0", min: 5, max: 10, resolutions: ["480p"], images: 9, videos: 0, audios: 3, fields: ["image_urls", undefined, "audio_urls"] },
  "SD2.5特价30-10-10-线路一": { group: "视频SD2.5", min: 5, max: 30, resolutions: ["720p"], images: 30, videos: 10, audios: 10, fields: ["images", "videos", "audios"] },
  "SD2.5特价30-10-10-线路二": { group: "视频SD2.5", min: 4, max: 30, resolutions: ["720p"], images: 30, videos: 10, audios: 10, httpsOnly: true, fields: ["image_urls", "video_urls", "audio_urls"] },
  "SD2.5特价30-10-10-线路三": { group: "视频SD2.5", min: 4, max: 30, resolutions: ["720p"], images: 30, videos: 10, audios: 10, fields: ["images", "video_refs", "audio_refs"] },
  "SD2.5特价30-10线路一": { group: "视频SD2.5", min: 4, max: 30, resolutions: ["720p"], images: 30, videos: 0, audios: 10, fields: ["image_urls", undefined, "audio_urls"], note: "专属文档固定 720p；价格 schema 同时列出 480p/720p。报价保留原始档位，生成按专属文档使用 720p；480p 生成能力未实测。" },
  "SD2.5特价30-10线路二": { group: "视频SD2.5", min: 5, max: 30, resolutions: ["720p"], images: 30, videos: 10, audios: 10, fields: ["images", "videos", "audios"] },
  "SD2.5特价900线路一": { group: "视频SD2.5", min: 5, max: 30, resolutions: ["720p"], images: 9, videos: 0, audios: 0, fields: ["images", undefined, "audios"] },
  "满血seedance-2.5全参A": { group: "稳定满血视频模型", min: 4, max: 30, resolutions: ["480p", "720p", "1080p"], images: 30, videos: 0, audios: 10, fields: ["imageUrls", undefined, "audioUrls"], note: "供应商说明此线路带数字水印，按次计费。" },
  "满血seedance-2.5全参B": { group: "稳定满血视频模型", min: 4, max: 30, resolutions: ["480p", "720p"], images: 30, videos: 0, audios: 10, fields: ["imageUrls", undefined, "audioUrls"] },
  "满血seedance-2.5全参C": { group: "稳定满血视频模型", min: 4, max: 30, resolutions: ["720p"], images: 30, videos: 10, audios: 10, fields: ["images", "video_refs", "audio_refs"],
    referenceOnly: true, httpsOnly: true, ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], mediaMinSeconds: 2, mediaTotalSeconds: 30, totalAssets: 50,
    note: "仅支持文生视频与参考生成；参考素材 HTTPS 链接，合计最多 50 个；视频与音频每段至少 2 秒，各类型总时长最多 30 秒。" },
  "稳定seedance-2.5全参D": { group: "稳定满血视频模型", min: 5, max: 30, resolutions: ["720p"], images: 30, videos: 10, audios: 10, fields: ["images", "videos", "audios"] },
  "稳定seedance-2.5全参E": { group: "稳定满血视频模型", min: 4, max: 30, resolutions: ["480p", "720p"], images: 30, videos: 0, audios: 10, fields: ["image_refs", undefined, "audio_refs"],
    note: "2026-10-14 官网专属指南 §5.4 明确不支持参考视频；支持 30 图 / 10 音频，480p / 720p，按输出秒数计费。" },
  "稳定seedance-2.5参图参音F": { group: "稳定满血视频模型", min: 4, max: 29, resolutions: ["720p"], images: 30, videos: 0, audios: 10, fields: ["images", undefined, "audios"] },
  "wan3.0-video": { group: "视频WAN3", min: 2, max: 30, resolutions: ["480p", "720p", "1080p"], images: 10, videos: 5, audios: 5, wan: true },
  "wan3.0-video-prime": { group: "视频WAN3", min: 2, max: 30, resolutions: ["480p", "720p", "1080p"], images: 10, videos: 5, audios: 5, wan: true },
  // Guide §5.2 gives these exact URL fields. §5.3's multipart and input-duration
  // restrictions explicitly cover only the two non-S IDs above.
  "wan3.0-video-S": { group: "视频WAN3", min: 2, max: 30, resolutions: ["480p", "720p", "1080p"], images: 10, videos: 5, audios: 5, wanJson: true, referenceOnly: true, httpsOnly: true, fields: ["reference_images", "videos", "audios"] },
  "wan3.0-video-prime-S": { group: "视频WAN3", min: 2, max: 30, resolutions: ["480p", "720p", "1080p"], images: 10, videos: 5, audios: 5, wanJson: true, referenceOnly: true, httpsOnly: true, fields: ["reference_images", "videos", "audios"] },
};
export function isJijiuApiUrl(value: unknown): boolean {
  try { const u = new URL(String(value)); return u.origin === "https://newapi.jijiucanvas.com" && !u.username && !u.password && !u.search && !u.hash && /^(?:\/v1)?\/?$/u.test(u.pathname); }
  catch { return false; }
}
function contract(id: string, current?: ModelDescriptor): Contract | undefined {
  if (["manual", "paid-test"].includes(String(current?.metadata?.source)) || current?.metadata?.protocolEvidence === "paid-test") return undefined;
  return Object.hasOwn(contracts, id) ? contracts[id] : undefined;
}
export const jijiuVideoModelIds = (): string[] => Object.keys(contracts);
export const isJijiuVideoModel = (id: string, current?: ModelDescriptor): boolean => Boolean(contract(id, current));
export const isJijiuWanVideoModel = (id: string | undefined): boolean => Boolean(id && contracts[id]?.wan);
export const jijiuVideoGroupMismatch = (settings: Readonly<Record<string, unknown>> | undefined): boolean => settings?.accountKeyGroup !== undefined && settings.modelGroup !== undefined && settings.accountKeyGroup !== settings.modelGroup;
function groupAllowed(id: string, c: Contract, group: string | undefined): boolean {
  return !group || group === c.group || c.group === "视频SD2.5" && group === "视频SD.2.5" || group === "auto" || id === "SD2.0fast稳定903A" && group === "vip";
}
export function jijiuVideoModel(id: string, current?: ModelDescriptor, group?: string): ModelDescriptor | undefined {
  const c = contract(id, current); if (!c) return undefined;
  const min = c.min, max = c.max;
  const metadata = { ...current?.metadata };
  for (const key of ["durationRangeUnverified", "durationRangeSource", "durationRangeFallbackFamily", "userFallbackDurationRange", "resolutionRangeUnverified", "videoParameterConfirmedDefaults", "videoResolutionAllowsCustom", "videoDurationValues", "videoSupportsAutomaticDuration"]) delete metadata[key];
  // Retire only this exact line's former input-duration contract. Saved inputs
  // remain on the request and are rejected below, rather than silently changed.
  if (id === "稳定seedance-2.5全参E") {
    delete metadata.billingIncludesInputDuration;
    delete metadata.priceContractWarning;
  }
  if (metadata.jijiuGroupUnavailable === true && groupAllowed(id, c, group)) { delete metadata.canvasUnavailableReason; delete metadata.canvasRunnable; }
  const parameters: ModelParameterDescriptor[] = [
    { key: "duration", label: "视频时长", control: c.wan || c.durations || min === max ? "select" : "number", valueType: "integer", step: 1,
      ...(c.wan || c.durations ? { min, max, options: (c.durations ?? Array.from({ length: max - min + 1 }, (_, i) => min + i)).map(value => ({ label: `${value} 秒`, value })) }
        : c.openDuration ? { min: 1, allowCustomValue: true } : { ...(min === max ? { default: min, options: [{ label: `${min} 秒`, value: min }] } : {}), min, max }),
      description: c.openDuration ? "官网画布提供 4–15 秒选择，API真实上下限未确认；按用户填写的正整数发送，保留旧值。" : c.wan ? "供应商当前仅接受 2–30 秒正整数，不接受 -1 自动时长；旧值保留，请改选。按实际输入与输出时长结算。" : "留空采用供应商线路默认时长；超范围或旧值请改选，不静默裁剪。" },
    { key: "resolution", label: "输出分辨率", control: c.resolutions?.length ? "select" : "text", valueType: "string",
      ...(c.resolutions?.length ? { options: c.resolutions.map(value => ({ label: value, value })) }
        : { allowCustomValue: true, placeholder: "供应商默认（留空）", description: c.note ?? "供应商声明 resolution 字符串字段；按填写值发送，由当前分组与型号校验。留空不发送。" }) },
    { key: "size", label: "输出像素尺寸", control: "text", valueType: "string", allowCustomValue: true, placeholder: "如 1280x720",
      description: "供应商声明的 WIDTHxHEIGHT 字段，服务端换算到对应分辨率档；留空不发送，输入范围由当前分组与型号处理。" },
    { key: "aspect_ratio", label: "画面比例", control: c.ratios ? "select" : "text", valueType: "string", placeholder: "供应商默认（留空）",
      ...(c.ratios ? { options: c.ratios.map(value => ({ label: value, value })) } : {}),
      description: c.ratios ? "供应商声明的比例；留空不发送，按画面自适应。" : "快捷比例来自供应商官方示例，也可填写自定义正数宽高比；留空不发送比例，由供应商决定，官方未公布具体默认比例。" },
    { key: "seed", label: "随机种子", control: "number", valueType: "integer" },
    ...(c.inputDurationBilling ? [{ key: "reference_video_seconds", label: "参考视频总时长", control: "number" as const, valueType: "number" as const, min: 0, description: "带参考视频时必填真实总秒数，参与上游计费；不按素材条数估算。" }] : []),
    ...(!c.wan && !c.wanJson ? [{ key: "negative_prompt", label: "负面提示词", control: "text" as const, valueType: "string" as const }] : []),
    ...(c.minimax ? [
      { key: "watermark", label: "平台水印", control: "toggle" as const, valueType: "boolean" as const },
      { key: "prompt_optimizer", label: "提示词优化", control: "toggle" as const, valueType: "boolean" as const },
      { key: "callback_url", label: "完成回调地址", control: "text" as const, valueType: "string" as const, placeholder: "公网 HTTP(S) URL", description: "官网仅为 MinimaxH3 标准/漫剧线路声明此字段；留空不发送。" },
    ] : []),
  ];
  return { ...current, id, name: current?.name ?? id, operations: ["video.generate", "video.image-to-video"], inputKinds: ["text", "image", "image[]", ...(c.videos !== 0 ? ["video" as const, "video[]" as const] : []), ...(c.audios !== 0 ? ["audio" as const, "audio[]" as const] : [])], outputKinds: ["video"], parameters,
    limits: { ...(c.images === undefined ? {} : { maxInputImages: c.images }), ...(c.videos === undefined ? {} : { maxInputVideos: c.videos }), ...(c.audios === undefined ? {} : { maxInputAudios: c.audios }), ...(c.wan ? { maxInputVideoDurationSeconds: 15 } : {}) },
    metadata: { ...metadata, supplier: "jijiu", modality: "video", catalogCapability: "video", operationsSource: "declared", outputKindsSource: "declared", protocol: "openai-videos", documentationUrl: JIJIU_VIDEO_DOCS,
      endpointPath: "/v1/videos", endpointMethod: "POST", parameterSource: "supplier-documented-contract", protocolEvidence: "supplier-documentation", generationVerified: false, videoContractCheckedAt: "2026-10-14",
      videoMinDuration: c.openDuration ? undefined : min, videoMaxDuration: c.openDuration ? undefined : max, ...(c.durations ? { videoDurationValues: [...c.durations] } : min === max ? { videoDurationValues: [min], videoParameterConfirmedDefaults: { duration: min } } : {}), videoSupportedResolutions: [...(c.resolutions ?? [])],
      videoParameterAliases: { duration: ["seconds", "duration_seconds"], aspect_ratio: ["ratio"] },
      ...(!c.resolutions?.length ? { resolutionRangeUnverified: true, videoResolutionAllowsCustom: true } : {}),
      videoAspectRatioPresets: c.ratios ? c.ratios.map(value => ({ label: value, value })) : [{ label: "16:9（横屏）", value: "16:9" }, { label: "9:16（竖屏）", value: "9:16" }, { label: "1:1（方形）", value: "1:1" }],
      remoteMediaUrlsOnly: !c.wan, supportsFirstLastFrames: !c.wan && !c.referenceOnly, videoSupportsFirstLastFrames: !c.wan && !c.referenceOnly, allowFrameMediaMix: !c.wan && !c.referenceOnly, videoReferenceImageLimit: c.images, videoReferenceVideoLimit: c.videos, videoReferenceAudioLimit: c.audios,
      ...(c.wan ? { videoDurationValues: Array.from({ length: max - min + 1 }, (_, i) => min + i), videoMediaTransport: "multipart-files", videoReferenceAudioRequiresVisual: true, videoSupportsAutomaticDuration: false } : {}),
      ...(c.wanJson ? { videoMediaTransport: "json-urls", videoSupportsAutomaticDuration: false } : {}),
      parameterControlsUnavailable: false, jijiuVideoContract: true, ...(group ? { jijiuContractGroup: group } : {}), ...(c.note ? { videoContractNote: c.note } : {}), ...(c.wan ? { videoContractNote: "参考视频总时长最多 15 秒；参考视频与输出合计最多 30 秒，输入与输出秒数分别向上取整后合计计费。" } : {}),
      ...(c.minimax ? { durationRangeUnverified: true, videoDocumentedCanvasDurationRange: { min: 4, max: 15 }, videoApiDurationRangeUnverified: true, videoResolutionOutputUnverified: true, videoContractNote: "当前官方文档画布选择为 4–15 秒；API真实上下限未确认，正整数按填写值发送。顶层分辨率/放大字段尚未完成上游传递，选择档位不代表实际输出已核验。" } : {}),
      ...(c.wan || c.inputDurationBilling ? { billingIncludesInputDuration: true, priceContractWarning: "按参考视频总时长加输出时长计费；未计入输入视频时长时不显示输出秒数推算的总价。" } : {}),
      jijiuGroupUnavailable: !groupAllowed(id, c, group), ...(!groupAllowed(id, c, group) ? { canvasRunnable: false, canvasUnavailableReason: "当前极九分组未上架此完整型号。" } : {}) } };
}
const list = (v: unknown): unknown[] => v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v];
const aliases = { image: ["images", "imageUrls", "image_refs", "input_reference", "reference_images", "reference_image_urls", "image_urls", "image_url", "image"], video: ["reference_videos", "videoUrls", "video_refs", "videos", "video_urls", "video_url"], audio: ["reference_audios", "audioUrls", "audio_refs", "audios", "audio_urls", "audio_url"] } as const;
function materialFields(c?: Contract): readonly [string, string | undefined, string | undefined] {
  return c?.fields ?? (c?.wan ? ["images", "videos", "audios"] : ["images", "reference_videos", "reference_audios"]);
}
function references(request: NormalizedRequest, kind: keyof typeof aliases): unknown[] {
  const wan = isJijiuWanVideoModel(request.model);
  return [...aliases[kind].flatMap(key => list(request.parameters?.[key])), ...(request.assets ?? []).filter(a => a.kind === kind && (!a.role || a.role === "reference")).map(a => wan ? a : a.url)];
}
const frameAssets = (request: NormalizedRequest, role: ProviderAssetInput["role"]) => (request.assets ?? []).filter(a => a.kind === "image" && a.role === role);
export function normalizeJijiuVideoParameters(request: NormalizedRequest): Record<string, unknown> {
  const s = request.parameters ?? {}, p: Record<string, unknown> = {};
  const fixed = contracts[request.model ?? ""];
  // The guide only promises duration_seconds on some upstream lines. Preserve
  // its value through the seconds field explicitly supported by every line.
  const seconds = s.duration ?? s.seconds ?? s.duration_seconds ?? (fixed?.min !== undefined && fixed.min === fixed.max ? fixed.min : undefined), ratio = s.aspect_ratio ?? s.ratio;
  if (seconds !== undefined && seconds !== "") p.seconds = seconds;
  if (ratio !== undefined && ratio !== "") p.aspect_ratio = ratio;
  for (const key of ["resolution", "size", "seed", "negative_prompt", "watermark", "prompt_optimizer", "callback_url", "metadata", "reference_video_seconds"])
    if (s[key] !== undefined && s[key] !== "" && !(request.model === "稳定seedance-2.5全参E" && key === "reference_video_seconds")) p[key] = s[key];
  const fields = materialFields(fixed);
  for (const [kind, field] of [["image", fields[0]], ["video", fields[1]], ["audio", fields[2]]] as const) {
    if (!field) continue;
    const values = references(request, kind);
    if (values.length) p[field] = fixed?.wan ? values.map((value, i) => typeof value === "string"
      ? { id: `jijiu-${kind}-${i}`, kind, mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg", url: value } : value) : values;
  }
  for (const [role, field] of [["firstFrame", "first_frame_image"], ["lastFrame", "last_frame_image"]] as const) {
    const value = s[field] ?? frameAssets(request, role)[0]?.url; if (value !== undefined) p[field] = value;
  }
  return p;
}
function publicUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !/^(?:localhost$|127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[(?:::1\]|f[cd][\da-f]*:|fe80:))/iu.test(u.hostname) && !/\.(?:local|localhost)$/iu.test(u.hostname); }
  catch { return false; }
}
export function jijiuVideoRequestIssues(request: NormalizedRequest, current?: ModelDescriptor, group?: string): ValidationIssue[] {
  const c = contract(request.model ?? "", current); if (!c) return [];
  const descriptor = jijiuVideoModel(request.model!, current)!, p = normalizeJijiuVideoParameters(request), source = request.parameters ?? {};
  const issues: ValidationIssue[] = [], add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  if (request.model === "稳定seedance-2.5全参E" && source.reference_video_seconds !== undefined && source.reference_video_seconds !== "")
    add("parameters.reference_video_seconds", "此线路已取消参考视频，按输出秒数计费；已保存的参考视频时长保留，请移除后提交。");
  if (!groupAllowed(request.model!, c, group)) add("model", "当前极九分组未上架此完整型号。");
  if (p.seconds !== undefined && (typeof p.seconds !== "number" || !Number.isSafeInteger(p.seconds) || (c.openDuration ? p.seconds <= 0 : p.seconds < c.min || p.seconds > c.max || c.durations && !c.durations.includes(p.seconds)))) add("parameters.duration", c.openDuration ? "视频时长必须为正整数秒；API真实范围由此分组上游校验，保留用户原值。" : c.durations ? `此型号时长仅支持 ${c.durations.join(" / ")} 秒；保留原值，请改选。` : `此型号时长必须为 ${c.min}–${c.max} 的整数秒${c.wan ? "，当前不接受 -1 自动时长" : ""}；保留原值，请改选。`);
  const durationAliases = ["duration", "seconds", "duration_seconds"].filter(key => source[key] !== undefined).map(key => source[key]);
  if (new Set(durationAliases).size > 1) add("parameters.duration", "duration、seconds 与 duration_seconds 不能冲突。");
  if (source.aspect_ratio !== undefined && source.ratio !== undefined && source.aspect_ratio !== source.ratio) add("parameters.aspect_ratio", "aspect_ratio 与 ratio 不能冲突。");
  if (p.resolution !== undefined && (typeof p.resolution !== "string" || c.resolutions?.length && !c.resolutions.includes(p.resolution)))
    add("parameters.resolution", c.resolutions?.length ? `此型号分辨率仅支持 ${c.resolutions.join(" / ")}。` : "resolution 必须为字符串。");
  if (p.aspect_ratio !== undefined && (typeof p.aspect_ratio !== "string" || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/u.test(p.aspect_ratio) || !p.aspect_ratio.split(":").every(v => Number(v) > 0))) add("parameters.aspect_ratio", "画面比例必须为正数宽高比。");
  if (c.ratios && p.aspect_ratio !== undefined && !c.ratios.includes(String(p.aspect_ratio))) add("parameters.aspect_ratio", `此型号画面比例仅支持 ${c.ratios.join(" / ")}。`);
  if (p.size !== undefined && (typeof p.size !== "string" || !/^\d+x\d+$/u.test(p.size) || !p.size.split("x").every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0)))
    add("parameters.size", "输出像素尺寸必须为正整数 WIDTHxHEIGHT，例如 1280x720。");
  if (p.seed !== undefined && (typeof p.seed !== "number" || !Number.isSafeInteger(p.seed))) add("parameters.seed", "随机种子必须为安全整数。");
  for (const field of ["watermark", "prompt_optimizer"]) if (p[field] !== undefined && (!c.minimax || typeof p[field] !== "boolean")) add(`parameters.${field}`, "此参数只支持 MiniMax H3 标准/漫剧线路，且必须为布尔值。");
  if (p.callback_url !== undefined && (!c.minimax || !publicUrl(p.callback_url))) add("parameters.callback_url", "此线路未支持该回调地址。");
  if (p.metadata !== undefined && (!c.minimax || !p.metadata || typeof p.metadata !== "object" || Array.isArray(p.metadata))) add("parameters.metadata", "透传 metadata 只支持 MiniMax H3 标准/漫剧线路的对象。");
  if (p.reference_video_seconds !== undefined && (!c.inputDurationBilling || typeof p.reference_video_seconds !== "number" || !Number.isFinite(p.reference_video_seconds) || p.reference_video_seconds <= 0)) add("parameters.reference_video_seconds", "该字段仅用于此线路带参考视频的真实总时长，必须为正数。");
  if (c.inputDurationBilling && references(request, "video").length && p.reference_video_seconds === undefined) add("parameters.reference_video_seconds", "此线路带参考视频时须填写 reference_video_seconds 真实总秒数，不能按素材数量估算计费。");
  for (const [kind, limit] of [["image", c.images], ["video", c.videos], ["audio", c.audios]] as const) {
    const values = references(request, kind);
    if (kind === "image") for (const field of ["first_frame_image", "last_frame_image"]) values.push(...list(p[field]));
    if (limit !== undefined && values.length > limit) add("assets", `此型号最多支持 ${limit} 个${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}素材（含首尾帧）。`);
    if (c.wan ? values.some(v => !wanReferenceAsset(v, kind)) : values.some(v => !publicUrl(v) || c.httpsOnly && !String(v).startsWith("https://"))) add("assets", c.wan
      ? "WAN 参考素材须提供文件字节或可下载的公网 HTTP(S) 地址；素材会作为 multipart 文件上传。" : `极九参考素材只接受公网 ${c.httpsOnly ? "HTTPS" : "HTTP(S)"} URL，不接受文件、对象或本地地址。`);
  }
  for (const [role, field] of [["firstFrame", "first_frame_image"], ["lastFrame", "last_frame_image"]] as const)
    if (frameAssets(request, role).length + list(source[field]).length > 1) add("assets", "首帧和尾帧分别最多一张。");
  for (const asset of request.assets ?? []) if (asset.role === "mask" || asset.kind !== "image" && asset.role && asset.role !== "reference") add("assets", "极九视频只支持参考素材与图片首尾帧角色。");
  if (c.wan) {
    for (const field of ["negative_prompt", "mode", "quality", "fps", "n", "output_format"])
      if (source[field] !== undefined && source[field] !== "") add(`parameters.${field}`, "WAN 此线路不接受该字段。");
    if (["first_frame_image", "last_frame_image"].some(field => source[field] !== undefined && source[field] !== "") || request.assets?.some(asset => asset.role === "firstFrame" || asset.role === "lastFrame")) add("assets", "WAN 此线路不支持首帧或尾帧角色，请使用参考图片。");
    if (references(request, "audio").length && !references(request, "image").length && !references(request, "video").length) add("assets", "WAN 参考音频须同时连接参考图片或参考视频。");
  }
  if (c.wanJson) for (const field of ["negative_prompt", "mode", "quality", "fps", "n", "output_format", "file_id"])
    if (source[field] !== undefined && source[field] !== "") add(`parameters.${field}`, "当前 WAN -S 专属合同未声明该字段，原值已保留。");
  if (c.referenceOnly && (["first_frame_image", "last_frame_image"].some(field => source[field] !== undefined && source[field] !== "") || request.assets?.some(asset => asset.role === "firstFrame" || asset.role === "lastFrame"))) add("assets", "此完整型号仅支持参考生成，不支持首帧或尾帧。");
  if (c.totalAssets && ["image", "video", "audio"].reduce((sum, kind) => sum + references(request, kind as keyof typeof aliases).length, 0) > c.totalAssets) add("assets", `此型号参考素材合计最多 ${c.totalAssets} 个。`);
  if (c.mediaTotalSeconds) for (const kind of ["video", "audio"] as const) {
    const refs = references(request, kind);
    const measured = refs.map(url => (request.assets ?? []).find(asset => asset.kind === kind && asset.url === url)?.durationSeconds);
    if (measured.some(seconds => typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < c.mediaMinSeconds!)) add("assets", `此型号参考${kind === "video" ? "视频" : "音频"}须有实际测量时长，每段至少 ${c.mediaMinSeconds} 秒。`);
    if (measured.reduce<number>((sum, seconds) => sum + (seconds ?? 0), 0) > c.mediaTotalSeconds) add("assets", `此型号参考${kind === "video" ? "视频" : "音频"}总时长最多 ${c.mediaTotalSeconds} 秒。`);
  }
  if (c.wan && references(request, "video").length) {
    const videos = references(request, "video").flatMap(value => typeof value === "object" && value !== null ? [value as ProviderAssetInput] : (request.assets ?? []).filter(a => a.kind === "video" && a.url === value));
    const refs = references(request, "video");
    if (videos.length !== refs.length || videos.some(a => typeof a.durationSeconds !== "number" || !Number.isFinite(a.durationSeconds) || a.durationSeconds <= 0)) add("assets", "WAN 参考视频必须具备已测量的实际时长，才能校验合计上限及报价。");
    if (videos.reduce((sum, asset) => sum + (asset.durationSeconds ?? 0), 0) > 15) add("assets", "WAN 参考视频总时长最多 15 秒。");
    if (p.seconds === undefined) add("parameters.duration", "WAN 带参考视频时请选择输出时长，以核对合计 30 秒上限。");
    else if (videos.reduce((sum, asset) => sum + (asset.durationSeconds ?? 0), 0) + Number(p.seconds) > 30) add("parameters.duration", "WAN 参考视频总时长与输出时长合计最多 30 秒。");
  }
  return issues;
}
function wanReferenceAsset(value: unknown, kind: keyof typeof aliases): boolean {
  if (typeof value === "string") return publicUrl(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const asset = value as ProviderAssetInput;
  return asset.kind === kind && typeof asset.id === "string" && typeof asset.mimeType === "string" &&
    (asset.data instanceof Uint8Array && asset.data.byteLength > 0 || publicUrl(asset.url));
}
export function jijiuVideoTransport(id?: string, request?: NormalizedRequest): RestModelConnectorOverride {
  const wan = isJijiuWanVideoModel(id);
  const wanJson = Boolean(id && contracts[id]?.wanJson);
  const fields = materialFields(id ? contracts[id] : undefined).filter((field): field is string => Boolean(field));
  const multipart = wan && Boolean(request && ["images", "videos", "audios"].some(field => list(request.parameters?.[field]).length));
  const response = { taskIdPath: "$.id", statusPath: "$.status", progressPath: "$.progress", errorPath: "$.error.message" };
  return { auth: { type: "bearer" }, submit: { path: "/v1/videos", method: "POST", bodyMode: multipart ? "multipart" : "json", idempotent: false,
    mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ...["seconds", "resolution", "size", "aspect_ratio", ...fields, ...(wan || wanJson ? [] : ["first_frame_image", "last_frame_image", "negative_prompt", "watermark", "prompt_optimizer", "callback_url", "metadata", "reference_video_seconds"]), "seed"].map(field => ({ target: `/${field}`, source: { kind: "request" as const, path: `$.parameters.${field}` }, omitIfUndefined: true, omitIfEmpty: true }))], response },
    poll: { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none", response }, pollIntervalMs: 5000,
    statusMap: { queued: "queued", in_progress: "running", unknown: "running", completed: "succeeded", failed: "failed" },
    output: { path: "$.content_url", fallbackPaths: ["$.video_url", "$.download_url", "$.result_url", "$.url", "$.video.url"], kind: "video", defaultMimeType: "video/mp4",
      contentFallback: { path: "/v1/videos/{taskId}/content", alternatePaths: ["/v1/tasks/{taskId}/artifacts/video/content"] } } };
}
