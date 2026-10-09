import type { ModelDescriptor, NormalizedRequest, ProviderConnectionResolver, ProviderTask, RemoteArtifact, ValidationResult } from "./contracts.js";
import { assetToBlob, providerFetch, ProviderHttpError } from "./http.js";
import { assertValidResult } from "./contracts.js";
import { imageEditingConnection, imageEditingRequestIssues, imageReferenceAssets } from "./image-editing-capabilities.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig } from "./rest.js";
import { GEMINI_NANO_BANANA_21_MODEL, normalizeBananaParameters, weAiBananaModelUnavailable, type BananaRoute } from "./banana-image-contract.js";
export * from "./banana-image-contract.js";
function connector(route: BananaRoute, descriptor: ModelDescriptor): RestConnectorConfig {
  const parameter = (target: string, key: string) => ({ target, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true, omitValues: ["auto"] });
  if (route.kind === "secure-async") {
    const response = { taskIdPath: "$.id", statusPath: "$.status", errorPath: "$.error.message", errorFallbackPaths: ["$.error"] };
    return { auth: { type: "bearer" }, models: [descriptor], restrictModels: true, pollIntervalMs: 3000,
      submit: { path: "/v1/images/generations", method: "POST", bodyMode: "json", idempotent: false,
        template: { model: route.model, n: 1 }, mappings: [
          { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
          parameter("/size", "image_size"), parameter("/aspect_ratio", "aspect_ratio"),
        ], response },
      poll: { path: "/v1/images/generations/{taskId}", method: "GET", bodyMode: "none", idempotent: true, response },
      output: { path: "$.data", kind: "image", urlPath: "$.url", base64Path: "$.b64_json" },
    };
  }
  if (route.kind === "chuangxiang") {
    const submit = { path: "/v1/images/generations", method: "POST" as const, bodyMode: "json" as const, idempotent: false,
      template: { model: route.model, response_format: "url", n: 1 }, mappings: [
        { target: "/prompt", source: { kind: "request" as const, path: "$.prompt" } }, parameter("/size", "aspect_ratio"),
        ...(route.model.startsWith("gemini-") ? [parameter("/quality", "quality")] : []),
        { target: "/images", source: { kind: "assets" as const, assetKind: "image" as const, select: "all" as const }, omitIfEmpty: true },
      ], response: { errorPath: "$.error.message" } };
    return { auth: { type: "bearer" }, models: [descriptor], restrictModels: true, assetsRequirePublicUrls: true, submit,
      operationOverrides: { "image.edit": { submit: { ...submit, path: "/v1/images/edits" } } },
      output: { path: "$.data", kind: "image", urlPath: "$.url", base64Path: "$.b64_json" } };
  }
  return { auth: route.auth === "google" ? { type: "header", headerName: "x-goog-api-key" } : { type: "bearer" }, models: [descriptor], restrictModels: true,
    submit: { path: `/v1beta/models/${encodeURIComponent(route.model)}:generateContent`, method: "POST", bodyMode: "json", idempotent: false,
      template: { contents: [{ role: "user", parts: [{ text: "" }] }], generationConfig: { responseModalities: ["IMAGE"] } },
      mappings: [
        { target: "/contents/0/parts/0/text", source: { kind: "request", path: "$.prompt" } },
        ...Array.from({ length: route.maxInputs }, (_, offset) => ({ target: `/contents/0/parts/${offset + 1}`, source: {
          kind: "assets" as const, assetKind: "image" as const, select: "first" as const, offset, encoding: "gemini-inline-part" as const,
        }, omitIfUndefined: true })),
        parameter("/generationConfig/imageConfig/aspectRatio", "aspect_ratio"),
        ...(/^gemini-2\.5-flash-image/iu.test(route.model) ? [] : [parameter("/generationConfig/imageConfig/imageSize", "image_size")]),
        ...(route.thinking ? [parameter("/generationConfig/thinkingConfig/thinkingLevel", "thinking_level")] : []),
      ], response: { errorPath: "$.error.message" } },
    output: { path: "$.candidates[*].content.parts[*]", kind: "image", base64Path: "$.inlineData.data", base64FallbackPaths: ["$.inline_data.data"], mimeTypePath: "$.inlineData.mimeType" },
  };
}

export class BananaImageAdapter extends GenericRestAdapter {
  constructor(private readonly bananaConnections: ProviderConnectionResolver, private readonly route: BananaRoute, descriptor: ModelDescriptor, private readonly options: GenericRestAdapterOptions = {}) {
    super(bananaConnections, { ...options, config: connector(route, descriptor) });
  }
  private normalized(request: NormalizedRequest): NormalizedRequest {
    const parameters = normalizeBananaParameters(this.route, request.parameters);
    if (this.route.kind === "chuangxiang" && this.route.model.startsWith("gemini-")) parameters.quality = String(parameters.image_size).toLowerCase();
    return { ...request, parameters };
  }
  override async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const normalized = this.normalized(request);
    const result = await super.validate(normalized);
    const issues = [...result.issues];
    if (this.route.thinking && request.parameters &&
      (Object.hasOwn(request.parameters, "thinking_level") || Object.hasOwn(request.parameters, "thinkingLevel"))) {
      const selected = request.parameters.thinking_level ?? request.parameters.thinkingLevel;
      if (typeof selected !== "string" || !this.route.thinking.values.includes(selected.toLowerCase()))
        issues.push({ path: "parameters.thinking_level", code: "invalid_thinking_level", message: `此香蕉模型支持的思考档位为 ${this.route.thinking.values.join("、")}` });
    }
    const connection = await this.bananaConnections.resolve(request.connectionId);
    if (weAiBananaModelUnavailable(imageEditingConnection(connection), request.model ?? this.route.model))
      issues.push({ path: "model", code: "model_unavailable", message: "当前 We-AI 分组已记录此型号不可用，请重新核对 Key 权限" });
    issues.push(...imageEditingRequestIssues(imageEditingConnection(connection), request));
    if (this.route.unavailableReason) issues.push({ path: "model", code: "unsupported_model", message: this.route.unavailableReason });
    if (!this.route.sizes.includes(String(normalized.parameters?.image_size))) issues.push({ path: "parameters.image_size", code: "invalid_image_size", message: `此香蕉模型支持的分辨率为 ${this.route.sizes.join("、")}` });
    const ratio = normalized.parameters?.aspect_ratio;
    if (ratio !== "auto" && !this.route.ratios.includes(String(ratio))) issues.push({ path: "parameters.aspect_ratio", code: "invalid_aspect_ratio", message: "请选择此香蕉模型提供的画面比例" });
    if (normalized.parameters?.n !== 1) issues.push({ path: "parameters.n", code: "invalid_count", message: "此香蕉接口每次生成一张图片" });
    if (request.operation === "image.edit" && !request.assets?.length) issues.push({ path: "assets", code: "reference_required", message: "改图需要连接或添加参考图片" });
    if (request.operation === "image.generate" && request.assets?.length) issues.push({ path: "assets", code: "reference_operation", message: "带参考图片的任务应使用图片编辑操作" });
    if (this.route.inputLimitSource === "adapter" && imageReferenceAssets(request.assets).length > this.route.maxInputs) issues.push({ path: "assets", code: "adapter_reference_limit", message: `当前香蕉适配器最多传入 ${this.route.maxInputs} 张参考图；供应商文档未声明数量上限` });
    if (request.assets?.some(asset => asset.kind !== "image" || !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType))) issues.push({ path: "assets", code: "invalid_image", message: "参考图仅支持 PNG、JPEG 或 WebP" });
    if (this.route.maxInputBytes && request.assets?.some(asset => asset.data && asset.data.byteLength > this.route.maxInputBytes!)) issues.push({ path: "assets", code: "image_too_large", message: "此供应商要求每张参考图不超过 20 MB" });
    return { valid: !issues.length, issues };
  }
  override async submit(request: NormalizedRequest): Promise<ProviderTask> {
    assertValidResult(await this.validate(request));
    let normalized = this.normalized(request);
    // Arbitrary public URLs are not Google Files URIs. Download them locally and send actual image bytes.
    if (this.route.kind === "native" && normalized.assets?.length) {
      normalized = { ...normalized, assets: await Promise.all(normalized.assets.map(async asset => {
        if (asset.data) return asset;
        const blob = await assetToBlob(asset, this.options.fetch ?? providerFetch);
        return { ...asset, data: new Uint8Array(await blob.arrayBuffer()) };
      })) };
    }
    const task = await super.submit(normalized);
    if (this.route.kind === "secure-async" && task.status !== "succeeded" && task.status !== "failed" && task.providerTaskId?.startsWith("rest:sync:"))
      throw new Error("供应商已响应，但未返回香蕉任务编号；不能查询结果，请核对供应商记录，避免重复提交");
    const result: Record<string, unknown> = { ...(task.result as Record<string, unknown>), bananaImage: true };
    if ((this.route.pdog || this.route.chentu || this.route.model === GEMINI_NANO_BANANA_21_MODEL) && task.status === "succeeded" && !bananaNativeOutputs(result)?.length)
      throw new ProviderHttpError("Gemini 已返回响应但没有图片；请核对供应商记录及响应中的安全限制，避免重复提交。", {
        kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true, responseBody: result.remote,
      });
    return { ...task, result };
  }
}

/** URL-returning groups can put the image into a text or file part instead of inlineData. */
export function bananaNativeOutputs(result: unknown): RemoteArtifact[] | undefined {
  if (!result || typeof result !== "object" || !("bananaImage" in result) || !result.bananaImage || !("remote" in result)) return;
  const remote = result.remote as { candidates?: { content?: { parts?: Record<string, unknown>[] } }[] };
  if (!Array.isArray(remote?.candidates)) return;
  const outputs: RemoteArtifact[] = [];
  const urls = new Set<string>();
  for (const candidate of remote.candidates) for (const part of candidate.content?.parts ?? []) {
    const inline = (part.inlineData ?? part.inline_data) as { data?: string; mimeType?: string; mime_type?: string } | undefined;
    if (typeof inline?.data === "string" && !/^https?:/iu.test(inline.data)) {
      const dataUri = /^data:(image\/[\w.+-]+);base64,(.+)$/su.exec(inline.data);
      const mimeType = inline.mimeType ?? inline.mime_type ?? dataUri?.[1];
      const encoded = dataUri?.[2] ?? inline.data;
      if (mimeType?.startsWith("image/") && /^[A-Za-z0-9+/\s]+={0,2}$/u.test(encoded)) outputs.push({ kind: "image", data: new Uint8Array(Buffer.from(encoded, "base64")), mimeType });
      continue;
    }
    const file = (part.fileData ?? part.file_data) as { fileUri?: string; file_uri?: string } | undefined;
    const possible = [file?.fileUri, file?.file_uri, inline?.data];
    if (typeof part.text === "string") {
      possible.push(...[...part.text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/giu)].map(m => m[1]));
      if (/^https?:\/\/\S+$/iu.test(part.text.trim())) possible.push(part.text.trim());
    }
    for (const url of possible) if (url && /^https?:\/\//iu.test(url) && !urls.has(url)) { urls.add(url); outputs.push({ kind: "image", url }); }
  }
  return outputs;
}
