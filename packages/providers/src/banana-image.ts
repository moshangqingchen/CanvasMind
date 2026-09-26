import type { ModelDescriptor, NormalizedRequest, ProviderConnectionResolver, ProviderTask, RemoteArtifact, ValidationResult } from "./contracts.js";
import { assetToBlob, providerFetch } from "./http.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig } from "./rest.js";

type Connection = { provider: string; config: Readonly<Record<string, unknown>> };
export type BananaRoute = { kind: "native" | "chuangxiang" | "secure-async"; auth: "bearer" | "google"; docs: string; maxInputs: number; model: string; sizes: string[]; ratios: string[]; asyncTextGeneration?: boolean; unavailableReason?: string; maxInputBytes?: number };
const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const EXTENDED_RATIOS = [...RATIOS, "1:8", "8:1", "1:4", "4:1"];
const imageModel = (id: string) => /^(?:gemini-[\w.-]*image[\w.-]*|(?:N )?nano-banana[\w.-]*)$/iu.test(id);

/** Supplier documentation is scoped by origin and model; GPT never enters this path. */
export function bananaImageRoute(connection: Connection, model: string): BananaRoute | undefined {
  if (connection.provider !== "openai" || !imageModel(model) || connection.config.usage === "agent" ||
      connection.config.usage === "disabled" || connection.config.supplierArchived === true) return;
  let url: URL;
  try { url = new URL(String(connection.config.baseUrl ?? "")); } catch { return; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      !/^\/(?:v1(?:beta)?\/?)?$/u.test(url.pathname)) return;
  const native = (docs: string, auth: BananaRoute["auth"] = "bearer", maxInputs = 14): BananaRoute => ({
    kind: "native", auth, docs, maxInputs, model,
    ratios: /^gemini-3\.1-flash-image/iu.test(model) ? EXTENDED_RATIOS : RATIOS,
    sizes: /^gemini-2\.5-flash-image/iu.test(model) ? ["1K"] : ["1K", "2K", "4K"],
  });
  if (url.hostname === "genimage.pro" && model.startsWith("gemini-"))
    return native("https://docs.newapi.ai/zh/docs/api/ai-model/images/gemini/geminirelayv1beta-383837589");
  if (url.hostname === "api.frimodel.com" && model.startsWith("gemini-"))
    return native("https://ai-doc.apifox.cn/9285585m0", "google");
  if (url.hostname === "token.secure-skill.com")
    return { ...native("https://token.secure-skill.com/docs", "google", 16), ratios: RATIOS,
      asyncTextGeneration: ["nano-banana-pro", "nano-banana-2", "nano-banana-2-lite", "gemini-3-pro-image-preview", "gemini-3.0-pro-image", "gemini-3.1-flash-image"].includes(model),
      sizes: /lite/iu.test(model) ? ["1K"] : ["1K", "2K", "4K"] };
  if ((url.hostname === "we-token.cc" || url.hostname.endsWith(".we-token.cc")) &&
      ["adobe香蕉", "gemini香蕉"].includes(String(connection.config.modelGroup)) && model.startsWith("gemini-"))
    return { ...native("https://docs.we-ai.cc/guides/gemini-banana-image.html"), model: model.replace(/-preview$/u, ""), sizes: ["512", "1K", "2K", "4K"], ratios: EXTENDED_RATIOS, maxInputBytes: 20 * 1024 * 1024,
      ...(!/^gemini-(?:3-pro|3\.1-flash)-image(?:-preview)?$/u.test(model)
        ? { unavailableReason: "此模型虽在分组列表中，但供应商香蕉接口仅声明支持 gemini-3-pro-image 和 gemini-3.1-flash-image；请选已支持的型号" } : {}) };
  if (url.hostname === "vapi.chuangxiangai.asia" && connection.config.modelGroup === "生图") {
    const fixed = /-(1k|2k|4k)$/iu.exec(model)?.[1]?.toUpperCase();
    return { kind: "chuangxiang", auth: "bearer", docs: "https://vapi.chuangxiangai.asia/docs/image", maxInputs: 9, model, sizes: fixed ? [fixed] : ["1K", "2K", "4K"], ratios: RATIOS };
  }
}

export function applyBananaImageCapabilities(connection: Connection, model: ModelDescriptor): ModelDescriptor {
  const route = bananaImageRoute(connection, model.id);
  if (!route || !model.operations.some(op => op.startsWith("image.")) || model.metadata?.canvasRunnable === false) return model;
  if (route.unavailableReason) return { ...model, operations: [], capabilities: [], metadata: { ...model.metadata,
    canvasRunnable: false, canvasUnavailableReason: route.unavailableReason, documentationUrl: route.docs } };
  return { ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"], inputKinds: ["text", "image", "image[]"], outputKinds: ["image"], parameters: [
    { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "auto", options: [
      { value: "auto", label: "自动（提示词优先，其次参考图）" }, ...route.ratios.map(value => ({ value, label: value })),
    ] },
    { key: "image_size", label: "分辨率", control: "select", valueType: "string", default: route.sizes.at(-1)!, options: route.sizes.map(value => ({ value, label: value })) },
    { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1 },
  ], limits: { ...model.limits, maxInputImages: route.maxInputs, maxOutputImages: 1, supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"] },
  metadata: { ...model.metadata, protocol: route.kind === "native" ? "gemini-generate-content" : "chuangxiang-banana-images",
    documentationUrl: route.docs, bananaProtocolVersion: 1, parameterControlsUnavailable: false }, };
}

/** Translate old canvas controls before the generic GPT sizing path can discard the tier. */
export function normalizeBananaParameters(route: BananaRoute, input: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const dimensions = typeof input.size === "string" ? /^(\d+)x(\d+)$/iu.exec(input.size) : null;
  const pixels = dimensions ? Number(dimensions[1]) * Number(dimensions[2]) : 0;
  const legacyTier = dimensions ? (pixels > 6_400_000 ? "4K" : pixels > 1_600_000 ? "2K" : "1K") : undefined;
  const tier = input.image_size ?? input.imageSize ?? input.size_tier ?? (/^(?:512|[124]k)$/iu.test(String(input.size)) ? input.size : undefined) ??
    (route.kind === "chuangxiang" && /^[124]k$/iu.test(String(input.quality)) ? input.quality : undefined) ?? legacyTier ?? route.sizes.at(-1);
  let ratio = input.aspect_ratio ?? input.aspectRatio ?? (typeof input.size === "string" && /^\d+:\d+$/u.test(input.size) ? input.size : undefined);
  if (!ratio && dimensions) {
    const value = Number(dimensions[1]) / Number(dimensions[2]);
    ratio = route.ratios.reduce((best, candidate) => {
      const distance = (r: string) => Math.abs(Math.log(value / (Number(r.split(":")[0]) / Number(r.split(":")[1]))));
      return distance(candidate) < distance(best) ? candidate : best;
    });
  }
  if (typeof ratio === "string" && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/u.test(ratio)) {
    const value = Number(ratio.split(":")[0]) / Number(ratio.split(":")[1]);
    if (Number.isFinite(value) && value > 0) ratio = route.ratios.reduce((best, candidate) => {
      const distance = (r: string) => Math.abs(Math.log(value / (Number(r.split(":")[0]) / Number(r.split(":")[1]))));
      return distance(candidate) < distance(best) ? candidate : best;
    });
  }
  return { aspect_ratio: ratio ?? "auto", image_size: typeof tier === "string" ? tier.toUpperCase() : tier, n: input.n ?? 1 };
}

export function bananaRequiresPublicAssets(provider: string, config: Readonly<Record<string, unknown>> | undefined, model?: string): boolean {
  return !!model && !!config && bananaImageRoute({ provider, config }, model)?.kind === "chuangxiang";
}

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
      ], response: { errorPath: "$.error.message" } },
    output: { path: "$.candidates[*].content.parts[*]", kind: "image", base64Path: "$.inlineData.data", base64FallbackPaths: ["$.inline_data.data"], mimeTypePath: "$.inlineData.mimeType" },
  };
}

export class BananaImageAdapter extends GenericRestAdapter {
  constructor(connections: ProviderConnectionResolver, private readonly route: BananaRoute, descriptor: ModelDescriptor, private readonly options: GenericRestAdapterOptions = {}) {
    super(connections, { ...options, config: connector(route, descriptor) });
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
    if (this.route.unavailableReason) issues.push({ path: "model", code: "unsupported_model", message: this.route.unavailableReason });
    if (!this.route.sizes.includes(String(normalized.parameters?.image_size))) issues.push({ path: "parameters.image_size", code: "invalid_image_size", message: `此香蕉模型支持的分辨率为 ${this.route.sizes.join("、")}` });
    const ratio = normalized.parameters?.aspect_ratio;
    if (ratio !== "auto" && !this.route.ratios.includes(String(ratio))) issues.push({ path: "parameters.aspect_ratio", code: "invalid_aspect_ratio", message: "请选择此香蕉模型提供的画面比例" });
    if (normalized.parameters?.n !== 1) issues.push({ path: "parameters.n", code: "invalid_count", message: "此香蕉接口每次生成一张图片" });
    if (request.operation === "image.edit" && !request.assets?.length) issues.push({ path: "assets", code: "reference_required", message: "改图需要连接或添加参考图片" });
    if (request.operation === "image.generate" && request.assets?.length) issues.push({ path: "assets", code: "reference_operation", message: "带参考图片的任务应使用图片编辑操作" });
    if (request.assets?.some(asset => asset.kind !== "image" || !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType))) issues.push({ path: "assets", code: "invalid_image", message: "参考图仅支持 PNG、JPEG 或 WebP" });
    if (this.route.maxInputBytes && request.assets?.some(asset => asset.data && asset.data.byteLength > this.route.maxInputBytes!)) issues.push({ path: "assets", code: "image_too_large", message: "此供应商要求每张参考图不超过 20 MB" });
    return { valid: !issues.length, issues };
  }
  override async submit(request: NormalizedRequest): Promise<ProviderTask> {
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
    return { ...task, result: { ...(task.result as Record<string, unknown>), bananaImage: true } };
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
