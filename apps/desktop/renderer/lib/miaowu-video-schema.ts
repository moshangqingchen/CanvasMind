import type { ModelDescriptor, ModelParameterDescriptor } from "@super-canvas/providers";

export interface MiaowuVideoSchemaContract {
  durations?: number[];
  minSeconds?: number;
  maxSeconds?: number;
  durationByResolution?: Record<string, { min?: number; max?: number }>;
  resolutions: string[];
  ratios: string[];
  maxInputImages: number;
  maxInputVideos: number;
  maxInputAudios: number;
  maxPromptCharacters?: number;
}
export interface MiaowuVideoSchemaReceipt {
  id: string;
  sourceUrl: string;
  checkedAt: string;
  status: "live" | "unsupported" | "unauthorized" | "failed";
  httpStatus?: number;
  error?: string;
  normalizedSchemaSha256?: string;
  contract?: MiaowuVideoSchemaContract;
  stale?: boolean;
  lastSuccessfulCheckedAt?: string;
}
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const positive = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
const maximum = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const enumStrings = (value: unknown): string[] | undefined => Array.isArray(value) && value.length && value.every(item => typeof item === "string" && item.trim()) ? [...new Set(value)] as string[] : undefined;

/** The authenticated exact-model schema is data; never execute its content. */
export function parseMiaowuVideoSchema(id: string, payload: unknown): MiaowuVideoSchemaContract {
  const response = object(payload), root = object(response?.request_schema), fields = object(object(object(root?.properties)?.params)?.properties);
  if (response?.id !== id || response.type !== "video" || !fields) throw new Error("免费 schema 未返回同一完整视频型号的参数合同");
  const known = ["prompt", "seconds", "size", "ratio", "image_urls", "video_urls", "audio_urls"];
  const unsupported = Object.keys(fields).filter(key => !known.includes(key));
  if (unsupported.length) throw new Error(`免费 schema 含尚未接入的参数：${unsupported.join("、")}`);
  const prompt = object(fields.prompt), seconds = object(fields.seconds), size = object(fields.size), ratio = object(fields.ratio);
  const resolutions = enumStrings(size?.enum), ratios = enumStrings(ratio?.enum);
  if (prompt?.type !== "string" || seconds?.type !== "string" || size?.type !== "string" || ratio?.type !== "string" || !resolutions || !ratios)
    throw new Error("免费 schema 缺少明确的视频时长、分辨率或比例定义");
  let durations: number[] | undefined;
  if (seconds.enum !== undefined) {
    const values = enumStrings(seconds.enum);
    if (!values || values.some(value => !/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error("免费 schema 视频时长枚举无效");
    durations = values.map(Number);
  }
  const minSeconds = positive(seconds["x-dream-integer-string-min"]), maxSeconds = positive(seconds["x-dream-integer-string-max"]);
  if (!durations && (!minSeconds || !maxSeconds || minSeconds > maxSeconds)) throw new Error("免费 schema 未明确视频时长范围");
  const counts = ["image_urls", "video_urls", "audio_urls"].map(field => {
    const schema = object(fields[field]), items = object(schema?.items), count = maximum(schema?.maxItems);
    if (schema?.type !== "array" || items?.type !== "string" || count === undefined || schema.minItems !== 0) throw new Error(`免费 schema 的 ${field} 素材范围暂无法完整接入`);
    return count;
  });
  const durationByResolution: Record<string, { min?: number; max?: number }> = Object.create(null);
  for (const [resolution, value] of Object.entries(object(seconds["x-dream-seconds-by-size"]) ?? {})) {
    const rule = object(value), min = positive(rule?.min), max = positive(rule?.max);
    if (!resolutions.includes(resolution) || !rule || min === undefined && max === undefined || min !== undefined && max !== undefined && min > max)
      throw new Error("免费 schema 的分辨率与时长联合约束无效");
    durationByResolution[resolution] = { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
  }
  const maxPromptCharacters = prompt.maxLength === undefined ? undefined : positive(prompt.maxLength);
  if (prompt.maxLength !== undefined && maxPromptCharacters === undefined) throw new Error("免费 schema 提示词长度上限无效");
  return { ...(durations ? { durations } : { minSeconds, maxSeconds }), resolutions, ratios,
    ...(Object.keys(durationByResolution).length ? { durationByResolution } : {}),
    maxInputImages: counts[0]!, maxInputVideos: counts[1]!, maxInputAudios: counts[2]!,
    ...(maxPromptCharacters === undefined ? {} : { maxPromptCharacters }) };
}

/** Caller supplies only same-Key, same-source, same-group receipts for visible IDs. */
export function applyMiaowuVideoSchema(model: ModelDescriptor, receipt: MiaowuVideoSchemaReceipt | undefined): ModelDescriptor {
  if (!receipt || receipt.id !== model.id || !model.outputKinds?.includes("video")) return model;
  if (model.metadata?.source === "manual" || model.metadata?.protocolEvidence === "paid-test" ||
      /401|403|权限|未开通|拒绝|下架|停用|unauthorized|forbidden/iu.test(String(model.metadata?.canvasUnavailableReason ?? ""))) return model;
  const evidence = { videoSchemaStatus: receipt.status, videoSchemaCheckedAt: receipt.checkedAt, videoSchemaSourceUrl: receipt.sourceUrl,
    videoSchemaError: receipt.error ?? null, videoSchemaStale: receipt.stale === true,
    ...(receipt.lastSuccessfulCheckedAt ? { videoSchemaLastSuccessfulCheckedAt: receipt.lastSuccessfulCheckedAt } : {}),
    ...(receipt.normalizedSchemaSha256 ? { videoSchemaNormalizedSha256: receipt.normalizedSchemaSha256 } : {}) };
  if (!receipt.contract || receipt.status !== "live" && !receipt.stale) return { ...model, metadata: { ...model.metadata, ...evidence } };
  const c = receipt.contract;
  const existing = (key: string) => model.parameters?.find(row => row.key === key);
  const select = (key: string, label: string, values: string[]): ModelParameterDescriptor => ({ key, label, control: "select", valueType: "string", required: true,
    default: values.includes(String(existing(key)?.default)) ? existing(key)!.default : values[0]!, options: values.map(value => ({ label: value, value })) });
  const oldDefault = existing("duration")?.default;
  const defaultDuration = typeof oldDefault === "number" && (c.durations ? c.durations.includes(oldDefault) : oldDefault >= c.minSeconds! && oldDefault <= c.maxSeconds!) ? oldDefault : c.durations?.[0] ?? c.minSeconds!;
  const duration: ModelParameterDescriptor = { key: "duration", label: "视频时长", control: c.durations ? "select" : "number", valueType: "integer", required: true, default: defaultDuration,
    ...(c.durations ? { options: c.durations.map(value => ({ label: `${value} 秒`, value })) } : { min: c.minSeconds!, max: c.maxSeconds!, step: 1 }),
    ...(c.durationByResolution ? { constraints: Object.entries(c.durationByResolution).map(([value, rule]) => ({ when: [{ parameter: "resolution", values: [value] }], ...rule })) } : {}) };
  const metadata: Record<string, unknown> = { ...model.metadata, ...evidence, parameterSource: "dream.video_schema", remoteMediaUrlsOnly: true,
    canvasRunnable: true, parameterControlsUnavailable: false, clampNumericParameters: false,
    operationsSource: "declared", outputKindsSource: "declared", catalogCapability: "video", supportsFirstLastFrames: false,
    videoContractCheckedAt: receipt.lastSuccessfulCheckedAt ?? receipt.checkedAt };
  delete metadata.canvasUnavailableReason;
  const limits = { ...model.limits, maxInputImages: c.maxInputImages, maxInputVideos: c.maxInputVideos, maxInputAudios: c.maxInputAudios };
  delete limits.maxPromptCharacters;
  if (c.maxPromptCharacters !== undefined) limits.maxPromptCharacters = c.maxPromptCharacters;
  return { ...model, operations: c.maxInputImages ? ["video.generate", "video.image-to-video"] : ["video.generate"], outputKinds: ["video"],
    inputKinds: ["text", ...(c.maxInputImages ? ["image" as const, "image[]" as const] : []), ...(c.maxInputVideos ? ["video" as const, "video[]" as const] : []), ...(c.maxInputAudios ? ["audio" as const, "audio[]" as const] : [])],
    parameters: [duration, select("resolution", "输出分辨率", c.resolutions), select("aspect_ratio", "画面比例", c.ratios)], limits, metadata };
}
