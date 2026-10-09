import type { ModelDescriptor, NormalizedRequest, ProviderConnectionResolver, ProviderTask, ValidationResult } from "./contracts.js";
import { imageEditingConnection, imageReferenceAssets } from "./image-editing-capabilities.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig } from "./rest.js";
import { modelGenerationMediaKinds } from "./model-media.js";
import { applyChuangxiangMidjourneyCapabilities, chuangxiangMidjourneyInventoryIssue, isChuangxiangMidjourneyConnection,
  CHUANGXIANG_MIDJOURNEY_REFERENCES as REFERENCES, CHUANGXIANG_MIDJOURNEY_ADAPTER_REFERENCE_LIMIT as ADAPTER_REFERENCE_LIMIT } from "./chuangxiang-midjourney-contract.js";
export { applyChuangxiangMidjourneyCapabilities, chuangxiangMidjourneyRequiresPublicAssets, isChuangxiangMidjourneyConnection } from "./chuangxiang-midjourney-contract.js";

const parameter = (key: string) => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true, omitValues: ["auto"] });
const submit: RestConnectorConfig["submit"] = { path: "/v1/images/generations", method: "POST", bodyMode: "json", idempotent: false,
  template: { n: 1, response_format: "url" }, mappings: [
    { target: "/model", source: { kind: "request", path: "$.model" } },
    { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    parameter("size"), parameter("speed"), parameter("reference"),
    { target: "/images", source: { kind: "assets", assetKind: "image", select: "all" }, omitIfEmpty: true },
  ], response: { errorPath: "$.error.message" } };
const CONNECTOR: RestConnectorConfig = { auth: { type: "bearer" }, allowedHosts: ["vapi.chuangxiangai.asia"], assetsRequirePublicUrls: true,
  test: { path: "/v1/models", method: "GET", bodyMode: "none" }, submit,
  output: { path: "$.data", kind: "image", urlPath: "$.url", defaultMimeType: "image/png", requireOutput: true } };
const EDITOR_CONNECTOR: RestConnectorConfig = { ...CONNECTOR, submit: { ...submit, path: "/v1/images/edits" } };

export function isChuangxiangMidjourneyResult(result: unknown): boolean {
  return !!result && typeof result === "object" && "chuangxiangMidjourneyImages" in result && result.chuangxiangMidjourneyImages === true;
}

/** Synchronous Images transport, with the documented separate local-editor endpoint. */
export class ChuangxiangMidjourneyAdapter extends GenericRestAdapter {
  private readonly editor: GenericRestAdapter;
  constructor(private readonly resolver: ProviderConnectionResolver, options: GenericRestAdapterOptions = {}) {
    super(resolver, { ...options, config: CONNECTOR });
    this.editor = new GenericRestAdapter(resolver, { ...options, config: EDITOR_CONNECTOR });
  }
  private normalized(request: NormalizedRequest): NormalizedRequest {
    const input = request.parameters ?? {};
    const hasImages = imageReferenceAssets(request.assets).some(asset => asset.kind === "image");
    const reference = input.reference === undefined || input.reference === "auto" ? hasImages ? "image" : undefined : input.reference;
    const size = input.size === undefined || input.size === "auto" ? input.aspect_ratio : input.size;
    const speed = input.speed ?? (/(?:^|\s)--fast(?=\s|$)/iu.test(request.prompt) ? "fast" : "relax");
    // Generic image controls can remain in old nodes, but never enter this contract.
    return { ...request, parameters: { n: input.n ?? 1, speed,
      ...(reference === undefined ? {} : { reference }), ...(size === undefined || size === "auto" ? {} : { size }),
      ...(input.mask === undefined ? {} : { mask: input.mask }),
      ...(input.background === undefined ? {} : { background: input.background }) } };
  }
  override async listModels(connectionId: string): Promise<ModelDescriptor[]> {
    const connection = await this.resolver.resolve(connectionId);
    const source = imageEditingConnection(connection);
    const cached = source.config.modelCatalogModels;
    const models = Array.isArray(cached) ? cached as ModelDescriptor[] :
      Array.isArray(source.config.scannedModelIds) ? source.config.scannedModelIds.filter((id): id is string => typeof id === "string")
        .map(id => ({ id, name: id, operations: ["image.generate" as const] })) : [];
    return models.filter(model => isChuangxiangMidjourneyConnection(source.config, model.id))
      .map(model => applyChuangxiangMidjourneyCapabilities(source, model));
  }
  override async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const normalized = this.normalized(request);
    const editor = normalized.parameters?.reference === "editor";
    const result = editor ? await this.editor.validate(normalized) : await super.validate(normalized);
    const issues = [...result.issues];
    const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
    const connection = await this.resolver.resolve(request.connectionId);
    const source = imageEditingConnection(connection);
    if (!request.model || !["openai", "rest"].includes(connection.provider) || !isChuangxiangMidjourneyConnection(source.config, request.model))
      add("model", "unsupported_model", "此合同仅支持创想生图分组的 midjourney-1k / midjourney-2k。");
    if (request.model) {
      const inventoryIssue = chuangxiangMidjourneyInventoryIssue(source.config, request.model);
      if (inventoryIssue) add("model", "unavailable_model", inventoryIssue);
      const catalog = source.config.modelCatalogModels;
      const cached = Array.isArray(catalog) ? (catalog as ModelDescriptor[]).find(model => model?.id === request.model) : undefined;
      if (cached) {
        const current = applyChuangxiangMidjourneyCapabilities(source, cached);
        if (current.metadata?.canvasRunnable === false) add("model", "unavailable_model", String(current.metadata.canvasUnavailableReason ?? "当前型号不可运行。"));
        if (cached.outputKinds && cached.metadata?.outputKindsSource !== "inferred" && !modelGenerationMediaKinds(cached).includes("image"))
          add("model", "unsupported_output", "当前目录声明此型号不输出图片。");
      }
    }
    if (request.operation !== "image.generate" && request.operation !== "image.edit") add("operation", "unsupported_operation", "此接口仅处理图片生成和编辑。");
    if (normalized.parameters?.n !== 1) add("parameters.n", "invalid_count", "Midjourney 每次提交一个任务，固定返回四张图片。");
    const reference = normalized.parameters?.reference;
    if (reference !== undefined && !REFERENCES.includes(String(reference))) add("parameters.reference", "invalid_reference_mode", "请选择普通参考、风格、编辑、情绪板或局部编辑。");
    const images = imageReferenceAssets(request.assets);
    if ((reference !== undefined || request.operation === "image.edit") && !images.length) add("assets", "reference_required", "此参考或编辑模式需要原图。");
    if (images.some(asset => asset.kind !== "image")) add("assets", "invalid_image", "Midjourney 参考素材只能使用图片。");
    for (const image of images) if (image.url) {
      try { const url = new URL(image.url); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
      catch { add("assets", "invalid_reference_url", "参考图片需要可访问的 HTTPS 链接。"); }
    }
    const limit = editor ? 1 : reference === "edit" ? 4 : ADAPTER_REFERENCE_LIMIT;
    if (images.length > limit) add("assets", editor || reference === "edit" ? "too_many_images" : "adapter_reference_limit",
      editor ? "局部编辑仅接受一张原图。" : reference === "edit" ? "图片编辑模式最多接受四张参考图。" : `当前适配器最多传入 ${limit} 张参考图；官方未声明此模式的张数上限。`);
    if (editor && request.operation !== "image.edit") add("operation", "editor_requires_edit", "局部编辑请使用图片编辑操作。");
    const speed = normalized.parameters?.speed;
    if (speed !== "relax" && speed !== "fast") add("parameters.speed", "invalid_speed", "Midjourney 速度仅支持 relax 或 fast。");
    if (/(?:^|\s)--(?:turbo|hd)(?=\s|$)/iu.test(request.prompt)) add("prompt", "unsupported_speed_flag", "此合同不支持 --turbo 或 --hd。");
    for (const flag of ["fast", "relax"]) if (new RegExp(`(?:^|\\s)--${flag}(?=\\s|$)`, "iu").test(request.prompt) && speed !== flag)
      add("parameters.speed", "conflicting_speed", "speed 必须与提示词中的 --fast / --relax 一致。");
    const size = normalized.parameters?.size;
    if (size !== undefined && (typeof size !== "string" || !/^[1-9]\d*:[1-9]\d*$/u.test(size))) add("parameters.size", "invalid_image_size", "Midjourney size 使用宽高比，分辨率由完整型号选择。");
    return { valid: !issues.length, issues };
  }
  override async submit(request: NormalizedRequest): Promise<ProviderTask> {
    const normalized = this.normalized(request);
    const validation = await this.validate(normalized);
    if (!validation.valid) throw new Error(validation.issues.map(issue => issue.message).join("；"));
    const task = normalized.parameters?.reference === "editor" ? await this.editor.submit(normalized) : await super.submit(normalized);
    return { ...task, result: { ...(task.result as Record<string, unknown>), chuangxiangMidjourneyImages: true } };
  }
}
