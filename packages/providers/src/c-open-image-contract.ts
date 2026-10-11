import type { ModelDescriptor, ProviderOperation, ValidationIssue } from "./contracts.js";
import { genimageImageRatioIssues } from "./genimage-image-capabilities.js";
import { verifiedTransparentImageEvidence } from "./transparent-image-evidence.js";

type Connection = { provider: string; config: Readonly<Record<string, unknown>> };
export type COpenImageRoute = { supplier: "zhiyuan" | "synora" | "hang" | "monster"; group: string; tiers: string[]; quality?: "medium" | "high" | "max"; docs: string };
const GPT_IDS = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const COMPATIBLE_EXTRA_FIELDS = ["output_format", "output_compression", "background", "moderation", "user"];
function measuredExtraFields(config: Readonly<Record<string, unknown>>, model: string, parameters: Readonly<Record<string, unknown>>, operation: ProviderOperation) {
  const route = cOpenImageRoute(config, model);
  if (route?.supplier !== "hang" || (config.accountKeyGroupId !== undefined
    ? String(config.accountKeyGroupId) !== "75" : String(config.accountKeyGroup ?? config.modelGroup) !== "Image - 1k")) return;
  const evidence = operation === "image.generate" ? verifiedTransparentImageEvidence({ provider: "openai", config }, model, parameters) : undefined;
  return evidence?.transport.kind === "openai-images" && evidence.request.background === "transparent" && evidence.request.output_format === "png" ? evidence : undefined;
}

/** These exact groups publish Images fields, but no per-ratio pixel matrix. */
export function cOpenImageRoute(config: Readonly<Record<string, unknown>>, model: string): COpenImageRoute | undefined {
  if (["agent", "disabled"].includes(String(config.usage)) || config.supplierArchived === true || config.manualProtocol === true) return;
  let origin: string;
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    if (url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return;
    origin = url.origin;
  } catch { return; }
  const group = String(config.accountKeyGroup ?? config.modelGroup ?? "");
  const stable = config.accountKeyGroupId != null ? String(config.accountKeyGroupId) : undefined;
  if (origin === "https://api.eaheng.com") {
    const groups: Record<string, string> = { "6": "A2-GPT-Pro正价-0.28倍率", "24": "GPT生图原生渠道V5", "18": "B4-GPT生图原生渠道V3（高质量）" };
    const stableMatches = (id: string) => stable ? stable === id : group === groups[id];
    if ((stableMatches("6") || stableMatches("24")) && [...GPT_IDS, "gpt-image-2.5"].includes(model))
      return { supplier: "monster", group, tiers: [], docs: "https://api.eaheng.com/docs" };
    const fixed = /^gpt-image-2\.5-(?:flare|sunburst)-(high|max)$/u.exec(model)?.[1] as "high" | "max" | undefined;
    if (stableMatches("18") && fixed) return { supplier: "monster", group, tiers: [], quality: fixed, docs: "https://api.eaheng.com/docs" };
  }
  if (origin === "https://pool.chaozhiyuanai.com" && GPT_IDS.includes(model) &&
      ["gpt  pro 0.12", "GPT pro", "GPT pro 企业级稳定"].includes(group) && (stable === undefined || stable === group))
    return { supplier: "zhiyuan", group, tiers: [], docs: "https://pool.chaozhiyuanai.com/docs" };
  if (origin === "https://synoralink.com" && GPT_IDS.includes(model)) {
    if ((stable ? stable === "99" : group === "adobe中质量生图") && model === "gpt-image-2")
      return { supplier: "synora", group, tiers: ["4K"], quality: "medium", docs: "https://synoralink.com/docs" };
    if (stable ? ["115", "119"].includes(stable) : ["全参生图专线", "OAI官Key生图"].includes(group))
      return { supplier: "synora", group, tiers: (stable ? stable === "115" : group === "全参生图专线") ? ["4K"] : [], docs: "https://synoralink.com/docs" };
  }
  if (origin === "https://api.hangzhale.com") {
    if ((stable ? stable === "21" : group === "Image2生图专用分组") && model === "gpt-image-2")
      return { supplier: "hang", group, tiers: ["4K"], docs: "https://api.hangzhale.com/docs" };
    if ((stable ? stable === "75" : group === "Image - 1k") && [...GPT_IDS, "gpt-image-2.5"].includes(model))
      return { supplier: "hang", group, tiers: ["1K"], docs: "https://api.hangzhale.com/docs" };
  }
}

export function cOpenImageParameterIssues(config: Readonly<Record<string, unknown>>, model: string,
  parameters: Readonly<Record<string, unknown>> = {}, operation: ProviderOperation = "image.generate"): ValidationIssue[] {
  const route = cOpenImageRoute(config, model);
  if (!route) return [];
  const issues = genimageImageRatioIssues(parameters).map(issue => ({ ...issue,
    message: issue.message.replaceAll("基因形象", "当前供应商型号") }));
  const tier = parameters.size_tier ?? parameters.resolution;
  if (tier !== undefined && tier !== "auto" && !(typeof parameters.size === "string" && /^[1-9]\d*x[1-9]\d*$/u.test(parameters.size)))
    issues.push({ path: "parameters.size", code: "resolution_requires_explicit_size", message: "已保存的档位偏好保留；此完整型号没有逐比例像素映射，请输入明确 W/H，size 将按原值发送。" });
  if (route.quality && parameters.quality !== undefined && parameters.quality !== "auto" && parameters.quality !== route.quality)
    issues.push({ path: "parameters.quality", code: "invalid_quality", message: `当前官方分组/完整型号固定质量 ${route.quality}；原值保留，请修改质量后提交。` });
  if (!["synora", "monster"].includes(route.supplier)) for (const key of COMPATIBLE_EXTRA_FIELDS) {
    const measured = measuredExtraFields(config, model, parameters, operation);
    if (["background", "output_format"].includes(key) && measured?.request[key] === parameters[key]) continue;
    if (parameters[key] !== undefined && parameters[key] !== null && parameters[key] !== "auto" && parameters[key] !== "")
      issues.push({ path: `parameters.${key}`, code: "missing_exact_field_contract", message: `当前供应商完整型号没有该 ${key} 字段的适用资料；原值保留，请移除该显式值或提供对应字段合同。` });
  }
  return issues;
}

export function cOpenImageParameters(config: Readonly<Record<string, unknown>>, model: string,
  parameters: Readonly<Record<string, unknown>> = {}, operation: ProviderOperation = "image.generate"): Record<string, unknown> {
  const route = cOpenImageRoute(config, model);
  const measured = measuredExtraFields(config, model, parameters, operation);
  const fields = ["size", "quality", "n", "response_format", ...(route && ["synora", "monster"].includes(route.supplier) ? COMPATIBLE_EXTRA_FIELDS :
    ["background", "output_format"].filter(key => measured?.request[key] === parameters[key]))];
  const result = Object.fromEntries(fields.flatMap(key => parameters[key] === undefined ||
    ["size", "quality", "response_format"].includes(key) && parameters[key] === "auto" ? [] : [[key, parameters[key]]]));
  if (route?.quality) result.quality = route.quality;
  return result;
}

export function applyCOpenImageCapabilities(connection: Connection, model: ModelDescriptor): ModelDescriptor {
  if (connection.provider !== "openai" || model.metadata?.canvasRunnable === false || model.metadata?.source === "manual" || model.metadata?.source === "paid-test" ||
      model.metadata?.protocolEvidence === "paid-test" || !model.operations.some(operation => operation.startsWith("image."))) return model;
  const route = cOpenImageRoute(connection.config, model.id);
  if (!route) return model;
  const measured = measuredExtraFields(connection.config, model.id, {}, "image.generate");
  const metadata = { ...model.metadata };
  for (const key of ["imageOutputDimensions", "imageOutputReferenceDimensions", "imageResolutionProfiles", "imageCustomDimensionRules", "imageFixedResolution", "imageSupportedSizes"])
    delete metadata[key];
  const quality = route.quality ?? (model.id.includes("2.5") ? "max" : "high");
  const parameters: NonNullable<ModelDescriptor["parameters"]> = [
    ...(route.tiers.length ? [{ key: "size_tier", label: "分辨率档位偏好", control: "select" as const, valueType: "string" as const,
      default: route.tiers.at(-1)!, options: [{ value: "auto", label: "自动" }, ...route.tiers.map(value => ({ value, label: value }))],
      description: "来源为当前官方分组说明；档位不是固定像素。请填写 W/H 以 size 表达，不向 Images 接口补造 resolution 字段。" }] : []),
    { key: "size", label: "输出尺寸", control: "dimensions", valueType: "string", default: "auto", allowCustomValue: true,
      options: [{ value: "auto", label: "自动（省略 size）" }], description: "本完整型号没有逐比例像素表、自定义范围或步长。明确 W/H 按 size 原值发送；旧选择保留，不猜档位像素。" },
    { key: "aspect_ratio", label: "画面比例偏好", control: "select", valueType: "string", default: "auto", allowCustomValue: true,
      options: [{ value: "auto", label: "自动" }], description: "通过明确 W/H 的 size 表达；比例和档位偏好保留，缺少像素映射时提交前提示输入 W/H。" },
    { key: "quality", label: "请求质量", control: route.quality ? "select" : "text", valueType: "string", default: quality,
      allowCustomValue: !route.quality, options: (route.quality ? [quality] : ["auto", quality]).map(value => ({ value, label: value })),
      description: route.quality ? `当前官方分组/完整型号固定 ${quality} 质量。` : "high / max 是应用最高质量偏好；当前完整型号未列精确质量枚举或默认，按开放字符串原值发送。" },
    ...(measured && !["synora", "monster"].includes(route.supplier) ? [
      { key: "background", label: "背景", control: "select" as const, valueType: "string" as const, default: "auto", operations: ["image.generate" as const],
        options: [{ value: "auto", label: "自动" }, { value: "transparent", label: "透明（历史原PNG实测）" }], description: `同来源、官方组、完整型号的历史请求字段，${measured.checkedAt}；编辑操作独立核对。` },
      { key: "output_format", label: "输出格式", control: "select" as const, valueType: "string" as const, default: "auto", operations: ["image.generate" as const],
        options: [{ value: "auto", label: "自动" }, { value: "png", label: "PNG（历史原文件实测）" }], description: `历史请求原字段，${measured.checkedAt}；编码与返回方式分开。` },
    ] : []),
  ];
  return { ...model, parameters: [...parameters, ...(model.parameters ?? []).filter(parameter =>
    !["size", "size_tier", "resolution", "aspect_ratio", "aspectRatio", "ratio", "quality", ...(["synora", "monster"].includes(route.supplier) ? [] : COMPATIBLE_EXTRA_FIELDS)].includes(parameter.key))],
    metadata: { ...metadata, imageNativeParameterContract: true, imageNativeResolutionOptions: true,
      imageNativeResolutionParameter: route.tiers.length ? "size_tier" : "size", imageResolutionTierParameter: "size_tier",
      cOpenImageContract: 1, imageOpenSizePreferences: true, imageNativeQualityOptions: true, imageSupportedResolutions: route.tiers,
      imageRequestResolutions: route.tiers, imageResolutionMode: "open-size-and-independent-preferences", imagePixelBudgetPublished: false,
      imageTierSource: "official-group-description", imageSizeFieldContract: "supplier-open-string",
      imageApplicationQualityDefault: quality, imageSupplierQualityDefault: null,
      imageAdditionalFieldContract: ["synora", "monster"].includes(route.supplier) ? "official-openai-compatible-images-contract" : "not-declared-in-exact-supplier-material",
      ...(measured ? { imageMeasuredAdditionalFields: { origin: "https://api.hangzhale.com", officialGroupId: "75", fullModelId: model.id,
        checkedAt: measured.checkedAt, operation: "image.generate", background: measured.request.background, output_format: measured.request.output_format,
        source: "same-exact-identity-original-transparent-png-evidence" } } : {}),
      documentationUrl: route.docs, contractCheckedAt: "2026-10-10" } };
}
