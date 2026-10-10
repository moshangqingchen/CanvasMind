import type { FetchImplementation, NormalizedRequest, ProviderConnectionResolver, ProviderTask, ValidationResult } from "./contracts.js";
import { assertValidResult } from "./contracts.js";
import { ProviderHttpError, providerFetch } from "./http.js";
import { referenceImageHostingEnabled, uploadTemporaryReferenceImages } from "./reference-image-hosting.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig } from "./rest.js";

// Current supplier docs: /docs#seedream-5-image. This is a separate protocol
// from GPT Images: top-level id, native 202, lowercase status, data[].url.
const nativeParameterKeys = ["size", "width", "height", "aspect_ratio", "n", "quantity", "strength", "image_url", "image_urls", "image_guidance"];
const knownParameterKeys = new Set([...nativeParameterKeys, "quality", "output_format", "output_compression", "stream", "size_tier", "background", "response_format"]);
const CONNECTOR: RestConnectorConfig = {
  auth: { type: "bearer" }, assetsRequirePublicUrls: true,
  submit: { path: "/v1/images/generations", method: "POST", bodyMode: "json", idempotent: false,
    mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ...nativeParameterKeys.map(key => ({
        target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true, omitIfEmpty: true,
      })),
    ], response: { taskIdPath: "$.id", statusPath: "$.status", errorPath: "$.error.message", errorFallbackPaths: ["$.error.code"] } },
  poll: { path: "/v1/images/generations/{taskId}", method: "GET", bodyMode: "none",
    response: { statusPath: "$.status", errorPath: "$.error.message", errorFallbackPaths: ["$.error.code"] } },
  statusMap: { in_progress: "running", succeeded: "succeeded", failed: "failed" }, pollIntervalMs: 4000,
  output: { path: "$.data", kind: "image", urlPath: "$.url" },
};
const strengths = new Set(["LOW", "MID", "HIGH"]);
const ratios = new Set(["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "21:9"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function publicUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/\.+$/u, "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      hostname.includes(".") && !hostname.endsWith(".local") && !hostname.endsWith(".localhost") &&
      !/^(?:localhost$|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|(?:22[4-9]|2[3-5]\d)\.|\[)/u.test(hostname);
  } catch { return false; }
}
export function isSecureSkillSeedreamResult(result: unknown): boolean {
  return record(result) && result.secureSkillSeedream === true;
}

export class SecureSkillSeedreamAdapter extends GenericRestAdapter {
  private readonly seedreamFetch: FetchImplementation;
  constructor(private readonly seedreamConnections: ProviderConnectionResolver, options: GenericRestAdapterOptions = {}) {
    super(seedreamConnections, { ...options, config: CONNECTOR });
    this.seedreamFetch = options.fetch ?? providerFetch;
  }
  override async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const result = await super.validate(request);
    const issues = [...result.issues];
    const add = (path: string, message: string) => issues.push({ path, code: "invalid_seedream_parameter", message });
    const p = request.parameters ?? {};
    for (const [key, value] of Object.entries(p)) if (value !== undefined && !knownParameterKeys.has(key))
      add(`parameters.${key}`, `当前 Seedream 接口未声明 ${key}，请清除旧型号的此项设置；当前生成尚未提交。`);
    if (!["image.generate", "image.edit"].includes(request.operation)) add("operation", "Seedream 只支持图片生成与参考图编辑。");
    if (request.model !== "seedream-5.0-pro") add("model", "当前 Seedream 接口只接受 seedream-5.0-pro。");
    if ([...request.prompt.trim()].length < 3) add("prompt", "Seedream 提示词至少需要 3 个字符。");
    const dimension = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 768 && value <= 2048;
    if (p.size !== undefined) {
      const match = typeof p.size === "string" && /^(\d+)x(\d+)$/u.exec(p.size);
      if (!match || !dimension(Number(match[1])) || !dimension(Number(match[2]))) add("parameters.size", "Seedream 宽高必须为 768–2048 的整像素，不支持 4K 或自动尺寸。");
    }
    if ((p.width !== undefined || p.height !== undefined) && (!dimension(p.width) || !dimension(p.height)))
      add("parameters.width", "Seedream W/H 必须成对提供，范围为 768–2048 整像素。");
    if (p.aspect_ratio !== undefined && !ratios.has(String(p.aspect_ratio))) add("parameters.aspect_ratio", "此比例没有 Seedream 快捷值，请使用对应的 size 像素尺寸。");
    for (const key of ["n", "quantity"]) if (p[key] !== undefined && (typeof p[key] !== "number" || !Number.isInteger(p[key]) || Number(p[key]) < 1 || Number(p[key]) > 6))
      add(`parameters.${key}`, "Seedream 每次生成 1–6 张图片。");
    if (p.n !== undefined && p.quantity !== undefined && p.n !== p.quantity) add("parameters.quantity", "n 与 quantity 必须一致。");
    if (p.strength !== undefined && !strengths.has(String(p.strength))) add("parameters.strength", "参考强度必须为 LOW、MID 或 HIGH。");
    if (p.stream !== undefined) add("parameters.stream", "Seedream 不支持 stream。");
    for (const key of ["quality", "output_format", "output_compression"]) if (p[key] !== undefined && p[key] !== "auto")
      add(`parameters.${key}`, `当前 Seedream 接口未提供 ${key}，请清除旧型号的此项设置。`);
    if (p.background !== undefined && !["auto", "opaque"].includes(String(p.background)))
      add("parameters.background", "当前 Seedream 接口未提供此背景选项，请使用普通模式。");
    if (p.response_format !== undefined && p.response_format !== "url")
      add("parameters.response_format", "当前 Seedream 接口仅返回图片 URL，不能请求其他返回方式。");
    const urls: unknown[] = [];
    if (p.image_url !== undefined) urls.push(p.image_url);
    if (p.image_urls !== undefined) {
      if (!Array.isArray(p.image_urls)) add("parameters.image_urls", "image_urls 必须为公网 URL 数组。");
      else urls.push(...p.image_urls);
    }
    if (p.image_guidance !== undefined) {
      if (!Array.isArray(p.image_guidance)) add("parameters.image_guidance", "image_guidance 必须为参考图对象数组。");
      else for (const item of p.image_guidance) {
        if (!record(item) || item.strength !== undefined && !strengths.has(String(item.strength))) add("parameters.image_guidance", "参考图需要 url，可选强度为 LOW、MID 或 HIGH。");
        if (record(item) && Object.keys(item).some(key => !["url", "strength"].includes(key)))
          add("parameters.image_guidance", "Seedream 参考图对象只支持 url 与 strength，不能提交未声明字段。");
        urls.push(record(item) ? item.url : undefined);
      }
    }
    if (urls.some(url => !publicUrl(url))) add("parameters.image_urls", "Seedream 参考图必须是公网 HTTP(S) URL，不支持内网、base64 或本地路径。");
    let hosting = false;
    try {
      const connection = await this.seedreamConnections.resolve(request.connectionId);
      hosting = referenceImageHostingEnabled(connection.settings);
      const settings = connection.settings;
      const model = Array.isArray(settings?.modelCatalogModels) ? settings.modelCatalogModels.find(item => record(item) && item.id === request.model) : undefined;
      const metadata = record(model) && record(model.metadata) ? model.metadata : {};
      const unavailableReason = String(metadata.canvasUnavailableReason ?? metadata.unavailableReason ?? "");
      if (!connection.apiKey) add("connection.apiKey", "当前连接没有 API Key。");
      if (settings?.supplierArchived === true || ["disabled", "agent"].includes(String(settings?.usage)) ||
          ["empty", "unauthorized"].includes(String(settings?.modelScanStatus)) ||
          Array.isArray(settings?.scannedModelIds) && !settings.scannedModelIds.includes(request.model) ||
          metadata.publicCatalogOnly === true || record(model) && model.available === false ||
          /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(unavailableReason))
        add("connection", "当前 Key 或分组没有 Seedream 的可用权限。");
    } catch { /* Generic validation already records an unavailable connection. */ }
    for (const asset of request.assets ?? []) {
      if (asset.kind !== "image" || asset.role === "mask") add("assets", "Seedream 仅支持参考图片，不支持蒙版、音频或视频。");
      else if (!publicUrl(asset.url) && !(hosting && !asset.url && asset.data?.byteLength))
        add("assets", "Seedream 需要参考图公网链接；可在分组中启用参考图临时链接，当前生成尚未提交。");
    }
    const count = urls.length + (request.assets?.length ?? 0);
    if (count > 10) add("assets", "Seedream 各参考图字段合计最多 10 张。");
    if (request.operation === "image.edit" && !count) add("assets", "Seedream 参考图编辑需要至少一张图片。");
    return { valid: issues.length === 0, issues };
  }
  override async submit(request: NormalizedRequest): Promise<ProviderTask> {
    assertValidResult(await this.validate(request));
    const assets = [];
    for (const asset of request.assets ?? []) assets.push(publicUrl(asset.url) ? asset : (await uploadTemporaryReferenceImages([asset], this.seedreamFetch))[0]!);
    const parameters = { ...request.parameters };
    if (assets.length) parameters.image_urls = [...(Array.isArray(parameters.image_urls) ? parameters.image_urls : []), ...assets.map(asset => asset.url)];
    // Merge public assets into the documented JSON field. Keep HTTP URLs intact;
    // the generic hosting path accepts HTTPS only and must not re-upload them.
    const task = await super.submit({ ...request, parameters, assets: [] });
    if (!task.providerTaskId.trim() || task.providerTaskId.startsWith("rest:sync:"))
      throw new ProviderHttpError("Secure Seedream did not return a generation id", {
        kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true,
      });
    return { ...task, result: { ...(task.result as Record<string, unknown>), secureSkillSeedream: true } };
  }
  override async poll(task: ProviderTask): Promise<ProviderTask> {
    const state = await super.poll(task);
    if (state.status === "succeeded" && !(await super.extractOutputs(state.result)).length)
      return { ...state, status: "failed", error: "Seedream 返回成功状态但没有图片 URL，请保留原任务编号查询，不要自动重发。" };
    return state;
  }
}
