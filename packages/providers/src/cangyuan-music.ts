import type { ModelDescriptor, ModelParameterDescriptor, NormalizedRequest, ValidationIssue } from "./contracts.js";
import type { RestModelConnectorOverride } from "./rest.js";

const ids = new Set(["lyria-3-pro", "lyria-3.5"]);
const fields = ["title", "instrumental", "lyrics", "duration", "bpm", "seed", "n", "audio_format"] as const;
export const isCangyuanMusicModel = (id: string | undefined): boolean => ids.has(id ?? "");

export function isCangyuanMusicRequest(model: string | undefined, baseUrl?: string): boolean {
  if (!isCangyuanMusicModel(model)) return false;
  try { return /(^|\.)cangyuansuanli\.cn$/u.test(new URL(baseUrl ?? "").hostname); } catch { return false; }
}

/** Exact public music contracts freshly reviewed on 2026-10-07; prices remain supplier-owned. */
export function cangyuanMusicModel(model: ModelDescriptor): ModelDescriptor {
  if (!isCangyuanMusicModel(model.id)) return model;
  const operations = ["music.generate"] as const;
  const parameters: ModelParameterDescriptor[] = [
    { key: "title", label: "作品名", control: "text", valueType: "string", description: "最多160个字符；留空由平台命名。", operations },
    { key: "instrumental", label: "纯音乐", control: "toggle", valueType: "boolean", default: false, description: "打开后不使用歌词。", operations },
    { key: "lyrics", label: "歌词", control: "text", valueType: "string", visibleWhen: [{ parameter: "instrumental", values: [false] }], description: "最多20000个字符，可用 [Verse]、[Chorus] 分段。", operations },
    { key: "duration", label: "目标时长（秒）", control: "number", valueType: "integer", min: 5, max: 300, step: 1, description: model.id === "lyria-3-pro" ? "可留空。5–300秒只是提示，成品最长184秒，以实际音频为准。" : "可留空。5–300秒只是提示，成品大约数分钟，以实际音频为准。", operations },
    { key: "bpm", label: "节奏 BPM", control: "number", valueType: "integer", min: 30, max: 300, step: 1, description: "可留空；节奏是创作提示。", operations },
    { key: "seed", label: "随机种子", control: "number", valueType: "integer", min: 0, max: 2147483647, step: 1, description: "可留空；同一种子不保证音频完全相同。", operations },
    { key: "audio_format", label: "音频格式", control: "select", valueType: "string", default: "mp3", options: ["mp3", "wav", "m4a"].map(value => ({ label: value.toUpperCase(), value })), operations },
  ];
  const metadata = { ...model.metadata };
  const unavailableReason = String(metadata.canvasUnavailableReason ?? "");
  const explicitDenial = /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(unavailableReason);
  const repairableProtocol = metadata.autoInterfaceStatus === "incomplete" || /协议|接口|尚未内置|protocol|adapter/iu.test(unavailableReason);
  const runnable = !explicitDenial && (metadata.canvasRunnable !== false || repairableProtocol);
  if (runnable) delete metadata.canvasUnavailableReason;
  if (runnable) delete metadata.pendingLiveScan;
  if (runnable && metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus;
  return { ...model, operations, parameters, inputKinds: ["text"], outputKinds: ["audio"],
    limits: { maxPromptCharacters: 10000, maxInputImages: 0, maxInputVideos: 0, maxInputAudios: 0 },
    metadata: { ...metadata, canvasRunnable: runnable, protocol: "cangyuan-music", supportVerification: "official-native-contract-and-live-inventory", catalogCapability: "music", fixedOutputCount: 1,
      documentationUrl: `https://ai.cangyuansuanli.cn/docs-static/models/${model.id}.json` } };
}

export const cangyuanMusicMimeType = (format: unknown): string => format === "wav" ? "audio/wav" : format === "m4a" ? "audio/mp4" : "audio/mpeg";

export function cangyuanMusicTransport(format?: unknown): RestModelConnectorOverride {
  const response = { taskIdPath: "$.id", taskIdFallbackPaths: ["$.task_id"], statusPath: "$.status", errorPath: "$.error.message", errorFallbackPaths: ["$.error"], progressPath: "$.progress" };
  return {
    submit: { path: "/v1/music", method: "POST", bodyMode: "json", idempotent: true,
      mappings: [
        { target: "/model", source: { kind: "request", path: "$.model" } },
        { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
        ...fields.map(key => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true, omitIfEmpty: true })),
      ], response },
    poll: { path: "/v1/music/{taskId}", method: "GET", bodyMode: "none", response },
    pollIntervalMs: 5000,
    statusMap: { queued: "queued", pending: "queued", processing: "running", running: "running", completed: "succeeded", succeeded: "succeeded", failed: "failed", cancelled: "cancelled" },
    output: { path: "$.music_url", fallbackPaths: ["$.data.music_url", "$.result.music_url", "$.data", "$.result"], kind: "audio", urlPath: "music_url", urlFallbackPaths: ["url"], defaultMimeType: cangyuanMusicMimeType(format) },
  };
}

export function cangyuanMusicRequestIssues(request: NormalizedRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, code: "invalid_parameter", message });
  if (request.operation !== "music.generate") add("operation", "Lyria 仅支持音乐生成。");
  if (!request.prompt.trim() || request.prompt.length > 10000) add("prompt", "音乐描述需要1–10000个字符，不能全为空白。");
  if (request.assets?.length) add("assets", "这两款 Lyria 不接受参考图片、视频或音频。");
  if (request.idempotencyKey.length > 128) add("idempotencyKey", "音乐任务重试标识最多128个字符。");
  const p = request.parameters ?? {};
  for (const key of Object.keys(p)) if (!(fields as readonly string[]).includes(key)) add(`parameters.${key}`, `音乐接口未声明参数 ${key}。`);
  for (const [key, max] of [["title", 160], ["lyrics", 20000]] as const)
    if (p[key] !== undefined && (typeof p[key] !== "string" || p[key].length > max)) add(`parameters.${key}`, `${key === "title" ? "作品名" : "歌词"}最多${max}个字符。`);
  if (p.instrumental !== undefined && typeof p.instrumental !== "boolean") add("parameters.instrumental", "纯音乐开关必须为布尔值。");
  for (const [key, min, max] of [["duration", 5, 300], ["bpm", 30, 300], ["seed", 0, 2147483647]] as const)
    if (p[key] !== undefined && (typeof p[key] !== "number" || !Number.isInteger(p[key]) || p[key] < min || p[key] > max)) add(`parameters.${key}`, `${key}必须是${min}–${max}的整数。`);
  if (p.n !== undefined && p.n !== 1) add("parameters.n", "音乐接口每次请求只能 n=1。");
  if (p.audio_format !== undefined && !["mp3", "wav", "m4a"].includes(String(p.audio_format))) add("parameters.audio_format", "音频格式只能选择 MP3、WAV 或 M4A。");
  return issues;
}

export function withCangyuanMusicRequestParameters(request: NormalizedRequest): NormalizedRequest {
  const parameters = { instrumental: false, n: 1, audio_format: "mp3", ...request.parameters };
  if (parameters.instrumental) delete (parameters as Record<string, unknown>).lyrics;
  return { ...request, parameters };
}
