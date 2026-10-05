import type { NormalizedRequest, ProviderConnectionResolver, ProviderTask, ValidationResult } from "./contracts.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig } from "./rest.js";

import { isChuangxiangImageConnection, CHUANGXIANG_IMAGE_QUALITIES as QUALITIES } from "./chuangxiang-image-contract.js";
export { isChuangxiangImageConnection, chuangxiangRequiresPublicAssets, applyChuangxiangCurrentImageCapabilities } from "./chuangxiang-image-contract.js";

const mapping = (key: string) => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true, omitValues: ["auto"] });
const submit: RestConnectorConfig["submit"] = {
  path: "/v1/images/generations", method: "POST", bodyMode: "json", idempotent: false,
  template: { n: 1, response_format: "url" }, mappings: [
    { target: "/model", source: { kind: "request", path: "$.model" } },
    { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    mapping("size"), mapping("quality"),
    { target: "/images", source: { kind: "assets", assetKind: "image", select: "all" }, omitIfEmpty: true },
  ], response: { errorPath: "$.error.message" },
};
const CONNECTOR: RestConnectorConfig = {
  auth: { type: "bearer" }, assetsRequirePublicUrls: true, allowedHosts: ["vapi.chuangxiangai.asia"], submit,
  operationOverrides: { "image.edit": { submit: { ...submit, path: "/v1/images/edits" } } },
  output: { path: "$.data", kind: "image", urlPath: "$.url", base64Path: "$.b64_json" },
};

export function isChuangxiangImageResult(result: unknown): boolean {
  return !!result && typeof result === "object" && "chuangxiangCurrentImages" in result && result.chuangxiangCurrentImages === true;
}

/** The public guide waits for HTTP 200; it does not declare single-image task polling. */
export class ChuangxiangImageAdapter extends GenericRestAdapter {
  constructor(private readonly resolver: ProviderConnectionResolver, options: GenericRestAdapterOptions = {}) {
    super(resolver, { ...options, config: CONNECTOR });
  }
  private normalized(request: NormalizedRequest): NormalizedRequest {
    const parameters = { ...request.parameters };
    if ((parameters.size === undefined || parameters.size === "auto") && typeof parameters.aspect_ratio === "string" && parameters.aspect_ratio !== "auto")
      parameters.size = parameters.aspect_ratio;
    return { ...request, parameters };
  }
  override async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const normalized = this.normalized(request);
    const result = await super.validate(normalized);
    const issues = [...result.issues];
    const connection = await this.resolver.resolve(request.connectionId);
    if (!isChuangxiangImageConnection({ ...connection.settings, baseUrl: connection.baseUrl }, request.model))
      issues.push({ path: "model", code: "unsupported_model", message: "此创想图片合同仅适用于生图分组当前带 1k/2k/4k 档位的 GPT 型号" });
    if (request.operation !== "image.generate" && request.operation !== "image.edit")
      issues.push({ path: "operation", code: "unsupported_operation", message: "此创想接口仅处理图片生成和编辑" });
    if (request.operation === "image.generate" && request.assets?.length)
      issues.push({ path: "assets", code: "reference_operation", message: "创想带参考图片的任务请使用图片编辑" });
    const images = (request.assets ?? []).filter(asset => asset.role !== "mask");
    if (request.operation === "image.edit" && !images.length)
      issues.push({ path: "assets", code: "reference_required", message: "创想图片编辑需要参考图" });
    if (images.length > 9)
      issues.push({ path: "assets", code: "too_many_images", message: "创想图片接口最多接受 9 张参考图" });
    if (images.some(asset => asset.kind !== "image"))
      issues.push({ path: "assets", code: "invalid_image", message: "创想图片接口仅接受参考图片" });
    if (normalized.parameters?.n !== undefined && normalized.parameters.n !== 1)
      issues.push({ path: "parameters.n", code: "invalid_count", message: "创想此图片接口每次仅生成一张" });
    const quality = normalized.parameters?.quality;
    if (quality !== undefined && quality !== "auto" && !QUALITIES.includes(String(quality)))
      issues.push({ path: "parameters.quality", code: "invalid_quality", message: "创想质量支持 low、medium、high、xhigh、max 或自动省略" });
    const size = normalized.parameters?.size;
    if (size !== undefined && size !== "auto" && (typeof size !== "string" || !/^[1-9]\d*(?:x|:)[1-9]\d*$/u.test(size)))
      issues.push({ path: "parameters.size", code: "invalid_image_size", message: "创想 size 使用宽高比或 WIDTHxHEIGHT；分辨率档位由完整型号选择" });
    return { valid: !issues.length, issues };
  }
  override async submit(request: NormalizedRequest): Promise<ProviderTask> {
    const task = await super.submit(this.normalized(request));
    return { ...task, result: { ...(task.result as Record<string, unknown>), chuangxiangCurrentImages: true } };
  }
}
