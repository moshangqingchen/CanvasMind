import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ValidationIssue } from "./contracts.js";
import { CANGYUAN_CURRENT_VIDEO_CONTRACTS } from "./cangyuan-video-contract-data.js";
import type { RestModelConnectorOverride, RestRequestMapping } from "./rest.js";

export const isCangyuanVideoModel = (id: string | undefined): boolean => !!CANGYUAN_CURRENT_VIDEO_CONTRACTS[id ?? ""];
export function isCangyuanVideoRequest(model: string | undefined, baseUrl?: string): boolean {
  if (!isCangyuanVideoModel(model)) return false;
  try { return new URL(baseUrl ?? "").origin === "https://ai.cangyuansuanli.cn"; } catch { return false; }
}

/** Exact native catalog IDs whose current official contracts were rechecked. */
export function isCangyuanNativeSeedanceRequest(model: string | undefined, baseUrl?: string): boolean {
  return ["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-5-260628"].includes(model ?? "") &&
    isCangyuanVideoRequest(model, baseUrl);
}

const labels: Record<string, string> = { duration: "视频时长", aspect_ratio: "画面比例", resolution: "输出分辨率", generate_audio: "生成声音", seed: "随机种子", face_mode: "人脸代审核", camera_movement: "镜头运动" };
/** Per-model field contracts supplement a live inventory; they never add model IDs or grant access. */
export function cangyuanVideoModel(model: ModelDescriptor): ModelDescriptor {
  const c = CANGYUAN_CURRENT_VIDEO_CONTRACTS[model.id];
  if (!c) return model;
  const parameters: ModelParameterDescriptor[] = c.parameters.flatMap(p => {
    if (p.key === "duration" && c.approximateDurationSeconds) return [];
    const toggle = p.key === "generate_audio" || p.key === "face_mode", numeric = p.key === "duration" || p.key === "seed";
    return [{ key: p.key, label: labels[p.key] ?? p.key, control: toggle ? "toggle" : p.values?.length ? "select" : numeric ? "number" : "text",
      valueType: toggle ? "boolean" : numeric ? "integer" : "string", description: p.description,
      ...(p.default !== undefined ? { default: p.default } : p.values?.length ? { default: p.values[0]! } : p.min !== undefined ? { default: p.min } : {}),
      ...(p.values?.length ? { options: p.values.map(value => ({ label: p.key === "duration" ? `${value} 秒` : value === "fixed" ? "固定镜头" : value === "auto" && p.key === "camera_movement" ? "自动运镜" : String(value), value })) } : {}),
      ...(numeric ? { step: 1, ...(p.min === undefined ? p.key === "seed" ? /非负/u.test(p.description) ? { min: 0 } : {} : { min: 1 } : { min: p.min }), ...(p.max === undefined ? {} : { max: p.max }) } : {}),
    }];
  });
  const images = c.references.images ?? model.limits?.maxInputImages, videos = c.references.videos ?? model.limits?.maxInputVideos, audios = c.references.audios ?? model.limits?.maxInputAudios;
  const imageInput = images === undefined ? c.fields.includes("reference_image_urls") || c.frames : images > 0 || c.frames;
  return { ...model, parameters, operations: imageInput ? ["video.generate", "video.image-to-video"] : ["video.generate"], outputKinds: ["video"],
    inputKinds: ["text", ...(imageInput ? ["image" as const, "image[]" as const] : []), ...((videos === undefined ? c.fields.includes("reference_videos") : videos > 0) ? ["video" as const, "video[]" as const] : []), ...((audios === undefined ? c.fields.includes("reference_audios") : audios > 0) ? ["audio" as const, "audio[]" as const] : [])],
    limits: { ...model.limits, ...(images === undefined ? {} : { maxInputImages: images + (c.frames ? 2 : 0) }), ...(videos === undefined ? {} : { maxInputVideos: videos }), ...(audios === undefined ? {} : { maxInputAudios: audios }),
      ...(c.maxInputAssets ? { maxInputAssets: c.maxInputAssets } : {}), ...(c.maxPromptCharacters ? { maxPromptCharacters: c.maxPromptCharacters } : {}),
      ...(c.maxTotalInputVideoDurationSeconds ? { maxTotalInputVideoDurationSeconds: c.maxTotalInputVideoDurationSeconds } : {}),
      ...(c.maxInputVideoDurationSeconds ? { maxInputVideoDurationSeconds: c.maxInputVideoDurationSeconds } : {}),
      ...(c.maxInputAudioDurationSeconds ? { maxInputAudioDurationSeconds: c.maxInputAudioDurationSeconds } : {}),
      ...(model.id.startsWith("omni-v2v") ? { requiresInputVideo: true } : {}) },
    metadata: { ...model.metadata, modality: "video", operationsSource: "declared", outputKindsSource: "declared", catalogCapability: "video", documentationUrl: `https://ai.cangyuansuanli.cn/docs-static/models/${model.id}.json`,
      cangyuanVideoContractCheckedAt: c.checkedAt ?? "2026-10-07", videoContractFields: [...c.fields], payloadBuilder: "seedance-flat", remoteMediaUrlsOnly: true,
      ...(c.facePolicy ? { facePolicy: c.facePolicy } : {}), ...(c.fixedResolution ? { videoFixedResolution: c.fixedResolution } : {}),
      supportsFirstLastFrames: c.frames, videoSupportsFirstLastFrames: c.frames, framePairRequired: c.framePairRequired, allowFrameMediaMix: c.allowFrameMediaMix,
      videoReferenceImageLimit: images, videoReferenceVideoLimit: videos, videoReferenceAudioLimit: audios,
      requiresImageWithAudio: c.requiresImageWithAudio ?? false, referenceVideoObjects: c.videoObjects ?? false,
      referenceMimeTypes: c.inputMimeTypes, maxInputBytes: c.maxInputBytes,
      referenceNeedsDuration: !!(c.videoObjects || c.maxTotalInputVideoDurationSeconds || c.maxOutputAndInputVideoDurationSeconds || c.maxTotalInputAudioDurationSeconds || c.maxInputVideoDurationSeconds || c.maxInputAudioDurationSeconds),
      minInputVideoDurationSeconds: c.minInputVideoDurationSeconds, minTotalInputVideoDurationSeconds: c.minTotalInputVideoDurationSeconds,
      maxOutputAndInputVideoDurationSeconds: c.maxOutputAndInputVideoDurationSeconds,
      durationMaxWithReferenceVideo: c.durationMaxWithReferenceVideo,
      maxTotalInputAudioDurationSeconds: c.maxTotalInputAudioDurationSeconds,
      ...(model.id.startsWith("doubao-seedance-") ? { billingIncludesInputDuration: true, priceContractWarning: "按视频 token 用量计费，有参考视频与无参考视频费率不同；实际 token 未返回前无法按所选秒数推算总额。" } : {}),
      ...(c.approximateDurationSeconds ? { approximateVideoDurationSeconds: c.approximateDurationSeconds } : {}), videoPollingTimeoutMs: 1_800_000 },
  };
}

/** Current contracts also repair stale saved transports during submission. */
export function cangyuanVideoTransport(id: string): RestModelConnectorOverride | undefined {
  const c = CANGYUAN_CURRENT_VIDEO_CONTRACTS[id]; if (!c) return undefined;
  const mappings: RestRequestMapping[] = [
    { target: "/model", source: { kind: "request", path: "$.model" } },
    { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    ...c.fields.map(field => ({ target: `/${field}`, source: { kind: "request" as const, path: `$.parameters.${field}` }, omitIfUndefined: true, omitIfEmpty: true })),
  ];
  return { pollIntervalMs: 5_000,
    submit: { path: "/v1/videos", method: "POST", bodyMode: "json", headers: { Connection: "close" }, mappings,
      response: { taskIdPath: "$.id", taskIdFallbackPaths: ["$.task_id", "$.request_id"], statusPath: "$.status", errorPath: "$.error.message", progressPath: "$.progress" } },
    poll: { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none", headers: { Connection: "close" }, response: { statusPath: "$.status", errorPath: "$.error.message", progressPath: "$.progress" } },
    output: { path: "$.video_url", fallbackPaths: ["$.data[*]", "$.metadata.video_url", "$.metadata.url", "$.url"], kind: "video", urlPath: "url", urlFallbackPaths: ["video_url"], defaultMimeType: "video/mp4" },
  };
}

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
/** Also repairs the formerly saved audio alias without emitting undocumented fields. */
export function normalizeCangyuanVideoParameters(request: NormalizedRequest): Record<string, unknown> {
  const c = CANGYUAN_CURRENT_VIDEO_CONTRACTS[request.model ?? ""], p = { ...request.parameters };
  if (!c) return p;
  if (p.duration === undefined && p.seconds !== undefined) p.duration = p.seconds;
  delete p.seconds;
  if (c.fields.includes("generate_audio") && p.generate_audio === undefined && p.audio !== undefined) p.generate_audio = p.audio;
  delete p.audio;
  for (const [kind, field] of [["image", "reference_image_urls"], ["video", "reference_videos"], ["audio", "reference_audios"]] as const) {
    const explicit = list(p[field]);
    const supplied = new Set(explicit.map(value => typeof value === "object" && value !== null ? (value as Record<string, unknown>).url : value));
    const values = [...explicit, ...(request.assets ?? []).filter(a => a.kind === kind && (!a.role || a.role === "reference") && !supplied.has(a.url)).map(a => kind === "video" && c.videoObjects ? { url: a.url, duration: a.durationSeconds } : a.url)];
    if (values.length) p[field] = [...new Set(values)];
  }
  for (const [role, field] of [["firstFrame", "first_image_url"], ["lastFrame", "last_image_url"]] as const) {
    const asset = request.assets?.find(a => a.role === role); if (asset && p[field] === undefined) p[field] = asset.url;
  }
  delete p.n;
  return p;
}

export function validateCangyuanVideoRequest(request: NormalizedRequest): ValidationIssue[] {
  const c = CANGYUAN_CURRENT_VIDEO_CONTRACTS[request.model ?? ""];
  if (!c) return [];
  const p = normalizeCangyuanVideoParameters(request), issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  if (!request.operation.startsWith("video.")) add("operation", "此沧元型号只支持视频生成。");
  if (request.parameters?.n !== undefined && request.parameters.n !== 1) add("parameters.n", "沧元视频每次只能创建一个任务。");
  for (const key of Object.keys(p)) if (!c.fields.includes(key)) add(`parameters.${key}`, `该型号官方合同未声明参数 ${key}。`);
  for (const d of c.parameters) {
    const value = p[d.key]; if (value === undefined) continue;
    if (d.values?.length && !d.values.includes(value as string | number)) add(`parameters.${d.key}`, `请选择该型号支持的 ${d.values.join(" / ")}。`);
    if (["duration", "seed"].includes(d.key) && (typeof value !== "number" || !Number.isInteger(value) || (d.min !== undefined && value < d.min) || (d.key === "duration" && value < 1) || (d.key === "seed" && /非负/u.test(d.description) && value < 0) || (d.max !== undefined && value > d.max))) add(`parameters.${d.key}`, "请输入该型号合法范围内的整数。");
    if (["generate_audio", "face_mode"].includes(d.key) && typeof value !== "boolean") add(`parameters.${d.key}`, "此开关必须为布尔值。");
  }
  if (c.durationMaxWithReferenceVideo !== undefined && list(p.reference_videos).length && typeof p.duration === "number" && p.duration > c.durationMaxWithReferenceVideo)
    add("parameters.duration", `此型号带参考视频时，出片时长最多 ${c.durationMaxWithReferenceVideo} 秒。`);
  if (request.model === "niulai-pro" && p.duration === undefined) add("parameters.duration", "牛来 Pro 必须填写 4–15 秒的时长。");
  const assetUrl = (value: unknown) => {
    if (typeof value !== "string") return false;
    if (request.model?.startsWith("doubao-seedance-") && /^asset:\/\/[^\s/?#]+$/u.test(value)) return p.face_mode !== true;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !/^(?:localhost$|127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[(?:::1\]|f[cd][\da-f]*:|fe80:))/iu.test(url.hostname) && !url.hostname.endsWith(".local") && !/^\/v1\/files(?:\/|$)/u.test(url.pathname); } catch { return false; }
  };
  let count = 0;
  for (const [field, limit] of [["reference_image_urls", c.references.images], ["reference_videos", c.references.videos], ["reference_audios", c.references.audios]] as const) {
    const values = list(p[field]); count += values.length;
    if (p[field] !== undefined && !Array.isArray(p[field])) add(`parameters.${field}`, "参考素材必须为数组。");
    if (limit !== null && values.length > limit) add(`parameters.${field}`, `该型号此类参考素材上限为 ${limit}。`);
    for (const value of values) {
      if (field === "reference_videos" && c.videoObjects) {
        const v = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
        if (!assetUrl(v.url) || typeof v.duration !== "number" || !Number.isFinite(v.duration) || v.duration <= 0) add(`parameters.${field}`, "MM3 每段参考视频须提供 {url, duration}，时长须为实际正数秒。");
      } else if (!assetUrl(value)) add(`parameters.${field}`, "参考素材需要公网 HTTPS URL；仅官转型号可按文档使用 asset://。");
    }
  }
  if (c.maxInputAssets && count > c.maxInputAssets) add("assets", `此型号参考素材合计最多 ${c.maxInputAssets} 个。`);
  for (const [kind, field, minimum, maximum, totalMinimum, totalMaximum] of [
    ["video", "reference_videos", c.minInputVideoDurationSeconds, c.maxInputVideoDurationSeconds, c.minTotalInputVideoDurationSeconds, c.maxTotalInputVideoDurationSeconds],
    ["audio", "reference_audios", c.minInputAudioDurationSeconds, c.maxInputAudioDurationSeconds, undefined, c.maxTotalInputAudioDurationSeconds],
  ] as const) {
    const values = list(p[field]);
    if (!values.length || !(minimum || maximum || totalMinimum || totalMaximum || kind === "video" && (c.videoObjects || c.maxOutputAndInputVideoDurationSeconds))) continue;
    let total = 0, complete = true;
    for (const value of values) {
      const object = typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
      const url = object?.url ?? value, asset = request.assets?.find(a => a.kind === kind && a.url === url);
      const seconds = asset?.durationSeconds ?? (kind === "video" && c.videoObjects ? object?.duration : undefined);
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) { complete = false; add(`parameters.${field}`, "此型号需核对参考素材真实时长；请提供可识别时长的素材，不能估算。"); continue; }
      if (object?.duration !== undefined && typeof object.duration === "number" && Math.abs(object.duration - seconds) > 0.05) add(`parameters.${field}`, "参考视频声明的 duration 与实际素材时长不一致。");
      total += seconds;
      if (minimum !== undefined && seconds < minimum || maximum !== undefined && seconds > maximum) add(`parameters.${field}`, `此型号单条${kind === "video" ? "视频" : "音频"}时长须在${minimum ?? 0}–${maximum ?? "不限"}秒内。`);
    }
    if (!complete) continue;
    // Summing measured decimal seconds can exceed the same decimal limit by rounding alone.
    const roundingAllowance = Number.EPSILON * Math.max(1, total, totalMaximum ?? 0) * values.length;
    if (totalMinimum !== undefined && total < totalMinimum || totalMaximum !== undefined && total - totalMaximum > roundingAllowance) add(`parameters.${field}`, `此型号参考${kind === "video" ? "视频" : "音频"}合计时长须在${totalMinimum ?? 0}–${totalMaximum ?? "不限"}秒内。`);
    if (kind === "video" && c.maxOutputAndInputVideoDurationSeconds) {
      const output = p.duration ?? c.parameters.find(d => d.key === "duration")?.default;
      if (typeof output !== "number" || !Number.isFinite(output)) add("parameters.duration", "此型号需将出片与参考视频合计时长核对，请填写出片时长。");
      else if (total + output > c.maxOutputAndInputVideoDurationSeconds) add(`parameters.${field}`, `出片与参考视频合计不得超过 ${c.maxOutputAndInputVideoDurationSeconds} 秒。`);
    }
  }
  const first = p.first_image_url !== undefined, last = p.last_image_url !== undefined;
  if (!c.frames && (first || last)) add("assets", "此型号不支持首尾帧。");
  if ((last && !first) || c.framePairRequired && first !== last) add("assets", c.framePairRequired ? "该型号首尾帧必须成对提供。" : "尾帧必须搭配首帧。");
  if ((first || last) && count && !c.allowFrameMediaMix) add("assets", "此型号首尾帧与参考素材互斥。");
  for (const field of ["first_image_url", "last_image_url"] as const) if (p[field] !== undefined && !assetUrl(p[field])) add(`parameters.${field}`, "首尾帧必须使用该型号接受的公网素材链接。");
  if (c.requiresImageWithAudio && list(p.reference_audios).length && !list(p.reference_image_urls).length) add("assets", "牛来 Pro 参考音频必须搭配至少一张参考图。");
  if (request.model?.startsWith("omni-v2v") && !list(p.reference_videos).length) add("assets", "Omni v2v 必须提供参考视频。");
  if (request.model?.startsWith("sd12-") && list(p.reference_audios).length && (!(list(p.reference_image_urls).length || list(p.reference_videos).length) || first)) add("assets", "SD12 音频须搭配参考图或视频，且不能与首帧混用。");
  if (request.model?.startsWith("minimax-h3-") && list(p.reference_audios).length && !list(p.reference_videos).length) add("assets", "该 MiniMax 型号参考音频必须搭配参考视频。");
  if (c.maxPromptCharacters && request.prompt.length > c.maxPromptCharacters) add("prompt", `该型号提示词最多 ${c.maxPromptCharacters} 个字符。`);
  for (const asset of request.assets ?? []) {
    const accepted = c.inputMimeTypes?.[asset.kind], bytes = c.maxInputBytes?.[asset.kind];
    if (accepted?.length && !accepted.includes(asset.mimeType)) add("assets", `该型号${asset.kind}参考素材仅接受 ${accepted.join(" / ")} 格式。`);
    if (bytes && asset.data && asset.data.byteLength > bytes) add("assets", `该型号单个${asset.kind}参考素材不得超过 ${bytes / 1024 / 1024}MB。`);
    if (asset.role === "mask" || asset.role && asset.role !== "reference" && asset.kind !== "image") add("assets", "视频参考素材需要该型号支持的素材角色；首尾帧必须为图片，蒙版不可用。");
  }
  for (const role of ["firstFrame", "lastFrame"] as const) if ((request.assets ?? []).filter(a => a.role === role).length > 1) add("assets", "首帧和尾帧分别只能提供一张图片。");
  return issues;
}
