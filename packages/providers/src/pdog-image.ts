import type { NormalizedRequest, ProviderConnectionResolver, ProviderTask, ValidationIssue, ValidationResult } from "./contracts.js";
import { ProviderHttpError, assetToBlob, providerFetch } from "./http.js";
import { imageEditingConnection, imageEditingRequestIssues, imageReferenceAssets } from "./image-editing-capabilities.js";
import { verifiedTransparentImageEvidence } from "./transparent-image-evidence.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig, type RestRequestMapping } from "./rest.js";
import type { ImageSizeTier } from "./image-size-presets.js";
import { isPdogImageConnection, pdogImageSizeForTier, pdogImageQualityOptions } from "./pdog-image-contract.js";
export * from "./pdog-image-contract.js";

type Mode = "async" | "sync";
function parameters(input: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const result: Record<string, unknown> = { n: input.n ?? 1 };
  for (const key of ["size", "quality", "response_format"] as const) {
    // The site declares these optional fields; automatic selection means omitting the field.
    if (input[key] !== undefined && input[key] !== "auto") result[key] = input[key];
  }
  if (input.background === "transparent") {
    result.background = "transparent";
    result.output_format = input.output_format ?? "png";
  }
  const tier = String(input.size_tier ?? input.resolution ?? "").toUpperCase();
  const ratio = typeof input.aspect_ratio === "string" && input.aspect_ratio !== "auto" ? input.aspect_ratio : undefined;
  if (result.size === undefined && (["1K", "2K", "4K"].includes(tier) || ratio)) {
    result.size = pdogImageSizeForTier((["1K", "2K", "4K"].includes(tier) ? tier : "1K") as ImageSizeTier, ratio ?? "1:1");
  }
  return result;
}

const mappings: readonly RestRequestMapping[] = [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  ...["size", "quality", "n", "response_format"].map(key => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true })),
  ...["background", "output_format"].map(key => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` },
    omitIfUndefined: true, when: [{ path: "$.parameters.background", values: ["transparent"] }] })),
];

function connector(mode: Mode): RestConnectorConfig {
  const suffix = mode === "async" ? "/async" : "";
  const response = mode === "async" ? { taskIdPath: "$.task_id", taskIdFallbackPaths: ["$.id"], statusPath: "$.status", errorPath: "$.error.message", errorFallbackPaths: ["$.error"] } : { errorPath: "$.error.message" };
  const submit = { path: `/v1/images/generations${suffix}`, method: "POST" as const, bodyMode: "json" as const, idempotent: false, mappings, response };
  return { auth: { type: "bearer" }, allowedHosts: ["ai.whyshy.cn"], submit,
    operationOverrides: { "image.edit": { submit: { ...submit, path: `/v1/images/edits${suffix}`, bodyMode: "multipart", mappings: [
      ...mappings, { target: "/image", source: { kind: "assets", assetKind: "image", select: "all" }, omitIfEmpty: true },
    ] } } },
    ...(mode === "async" ? { poll: { path: "/v1/images/tasks/{taskId}", method: "GET" as const, bodyMode: "none" as const, idempotent: true, response },
      statusMap: { processing: "running" as const, completed: "succeeded" as const, failed: "failed" as const }, pollIntervalMs: 5000 } : {}),
    output: { path: "$.image_url", fallbackPaths: ["$.result.data", "$.data"], kind: "image", urlPath: "$.url", base64Path: "$.b64_json", mimeTypePath: "$.mime_type" },
  };
}

export function isPdogImageResult(result: unknown): boolean {
  return !!result && typeof result === "object" && "pdogImage" in result && result.pdogImage === true;
}

/** Freeze the documented task contract in each result so a restart polls the original task. */
export class PdogImageAdapter extends GenericRestAdapter {
  constructor(private readonly pdogConnections: ProviderConnectionResolver, private readonly pdogOptions: GenericRestAdapterOptions = {}, private readonly mode: Mode = "async") {
    super(pdogConnections, { ...pdogOptions, config: connector(mode) });
  }

  override async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const normalized = { ...request, parameters: parameters(request.parameters) };
    const base = await super.validate(normalized);
    const issues: ValidationIssue[] = [...base.issues];
    const connection = await this.pdogConnections.resolve(request.connectionId).catch(() => undefined);
    if (connection) issues.push(...imageEditingRequestIssues(imageEditingConnection(connection), request));
    const transparent = connection && request.parameters?.background === "transparent"
      ? verifiedTransparentImageEvidence(imageEditingConnection(connection), request.model ?? "", request.parameters) : undefined;
    if (transparent && transparent.transport.kind !== `pdog-${this.mode}`)
      issues.push({ path: "parameters.background", code: "unverified_transparent_route", message: "此型号透明背景仅验证异步图片接口，请使用已验证的异步线路" });
    if (!connection || connection.provider !== "openai" || !isPdogImageConnection({ ...connection.settings, baseUrl: connection.baseUrl }, request.model))
      issues.push({ path: "model", code: "unsupported_model", message: "此 PDog 接口仅适用于当前站点已配置的 GPT 图片模型" });
    if (request.operation !== "image.generate" && request.operation !== "image.edit") issues.push({ path: "operation", code: "unsupported_operation", message: "PDog GPT 接口只支持生成或编辑图片" });
    const selected = normalized.parameters;
    const qualities = pdogImageQualityOptions(request.model);
    if (selected.n !== 1) issues.push({ path: "parameters.n", code: "invalid_count", message: "PDog 每个请求只能生成一张图片（n=1）" });
    if (selected.quality !== undefined && (typeof selected.quality !== "string" || !qualities.includes(selected.quality))) issues.push({ path: "parameters.quality", code: "invalid_quality", message: `此 PDog 型号提供的质量选项为 ${qualities.join("、")}` });
    if (selected.size !== undefined) {
      const match = typeof selected.size === "string" ? /^(\d+)x(\d+)$/u.exec(selected.size) : null;
      const width = Number(match?.[1]);
      const height = Number(match?.[2]);
      if (!match || width % 16 || height % 16 || Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3 ||
          width * height < 655360 || width * height > 8294400)
        issues.push({ path: "parameters.size", code: "invalid_size", message: "输出尺寸需符合已有 GPT 图片适配的像素及对齐限制；优先选择 PDog 文档尺寸" });
    }
    if (selected.response_format !== undefined && selected.response_format !== "url" && selected.response_format !== "b64_json") issues.push({ path: "parameters.response_format", code: "invalid_response_format", message: "PDog 返回格式必须为 url 或 b64_json" });
    const images = imageReferenceAssets(request.assets).filter(asset => asset.kind === "image");
    if (request.assets?.some(asset => asset.kind !== "image")) issues.push({ path: "assets", code: "invalid_image", message: "PDog 图片编辑仅接受图片参考素材" });
    if (request.operation === "image.edit" && !images.length) issues.push({ path: "assets", code: "missing_image", message: "PDog 图片编辑需要参考图片" });
    if (request.operation === "image.generate" && images.length) issues.push({ path: "assets", code: "reference_operation", message: "有参考图时请使用图片编辑接口" });
    return { valid: !issues.length, issues };
  }

  override async submit(request: NormalizedRequest): Promise<ProviderTask> {
    // Download URL-only references before multipart construction; local byte inputs remain local.
    const normalized = { ...request, parameters: parameters(request.parameters) };
    const checked = await this.validate(request);
    if (!checked.valid) throw new Error(checked.issues.map(issue => issue.message).join("；"));
    const outbound = normalized.assets?.length ? { ...normalized, assets: await Promise.all(normalized.assets.map(async asset => {
      if (asset.data) return asset;
      const blob = await assetToBlob(asset, this.pdogOptions.fetch ?? providerFetch);
      return { ...asset, data: new Uint8Array(await blob.arrayBuffer()) };
    })) } : normalized;
    let task: ProviderTask;
    try {
      task = await super.submit(outbound);
    } catch (error) {
      if (this.mode === "async" && error instanceof ProviderHttpError && error.details.status === 404 && error.details.phase === "submit")
        throw new ProviderHttpError("PDog 异步生图接口返回 HTTP 404；文档说明未开启对象存储或存储凭证不完整时不会创建任务。请核对供应商异步服务配置；系统未自动改用同步或重复提交", { ...error.details, retryable: false });
      throw error;
    }
    if (this.mode === "async" && (task.providerTaskId.startsWith("rest:sync:") || !task.providerTaskId.trim()))
      throw new ProviderHttpError("PDog 响应缺少图片任务编号；请核对原请求，避免重复提交", {
        kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true,
      });
    return { ...task, ...(this.mode === "async" && task.status === "running" ? { pollAfterMs: 3000 } : {}),
      result: { ...(task.result as Record<string, unknown>), pdogImage: true } };
  }
}
