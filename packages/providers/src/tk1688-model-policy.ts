import type { ModelDescriptor, ResolvedProviderConnection, ValidationIssue } from "./contracts.js";
import { imageSizeForTier, type ImageSizeTier } from "./image-size-presets.js";

const TK1688_API_HOSTS = new Set([
  "tk1688.com",
  "api.tk1688.com",
  "ai.tk1688.com",
]);

export function isTk1688ApiUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && !url.username && !url.password &&
      TK1688_API_HOSTS.has(url.host);
  } catch {
    return false;
  }
}

/** https://tk1688.com/docs: @s{merchant}c{channel} pins a merchant.
 * Resolve only existing Image 2 parameter policy; never rewrite request IDs
 * or infer another merchant's Image 2.5 quality/resolution capabilities.
 */
export function tk1688ImagePolicyModelId(model: string, baseUrl: string | undefined): string {
  if (!isTk1688ApiUrl(baseUrl) || !/@s\d+c\d+$/u.test(model)) return model;
  const family = model.replace(/@s\d+c\d+$/u, "");
  return /^gpt-image-2(?:-|$)/u.test(family) ? family : model;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const stationSizes: Readonly<Record<string, string>> = { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024" };
function tk1688SizeForTier(tier: ImageSizeTier, ratio: string): string {
  return tier === "1K" && stationSizes[ratio] ? stationSizes[ratio]! : imageSizeForTier(tier, ratio);
}

/** Current connection inventory is the permission boundary; another SKU's
 * published description cannot change this exact model's request policy.
 */
export function configuredTk1688ImageModel(connection: ResolvedProviderConnection, modelId: string): ModelDescriptor | undefined {
  if (!isTk1688ApiUrl(connection.baseUrl)) return undefined;
  const nested = record(connection.settings?.config);
  const models = connection.settings?.modelCatalogModels ?? nested?.modelCatalogModels;
  if (!Array.isArray(models)) return undefined;
  return models.find((value): value is ModelDescriptor => {
    const model = record(value);
    return model?.id === modelId && record(model.metadata)?.tk1688Catalog === true &&
      Array.isArray(model.operations) && model.operations.some(operation => operation === "image.generate" || operation === "image.edit");
  });
}

export function tk1688ImageParameters(
  source: Readonly<Record<string, unknown>>,
  selected: Record<string, unknown>,
  model: ModelDescriptor | undefined,
): Record<string, unknown> {
  const declared = model?.parameters ? new Set(model.parameters.map(parameter => parameter.key)) : undefined;
  const result = Object.fromEntries(Object.entries(selected).filter(([key]) => !declared || declared.has(key)));
  const fixedSize = model?.metadata?.tk1688FixedSize;
  const resolution = source.resolution;
  if (typeof fixedSize === "string" && /^\d+x\d+$/u.test(fixedSize)) result.size = fixedSize;
  else if (typeof source.size === "string" && /^\d+x\d+$/u.test(source.size)) result.size = source.size;
  else if (typeof resolution === "string" && ["1K", "2K", "4K"].includes(resolution)) {
    const ratio = typeof source.aspect_ratio === "string" && source.aspect_ratio !== "auto" ? source.aspect_ratio : "1:1";
    // 1K dimensions follow the official image-station controls. Higher named
    // tiers use the existing pixel conversion; this is not output verification.
    result.size = tk1688SizeForTier(resolution as ImageSizeTier, ratio);
  } else if (source.size === undefined && typeof source.aspect_ratio === "string") {
    const size = stationSizes[source.aspect_ratio];
    if (size) result.size = size;
  }
  if (model?.metadata?.tk1688OmitN === true) delete result.n;
  // The official studio omits quality when the user chooses automatic quality.
  if (result.quality === "auto") delete result.quality;
  return result;
}

/** Validate exact declared controls before submitting a billable request. */
export function tk1688ImageParameterIssues(model: ModelDescriptor | undefined, parameters: Readonly<Record<string, unknown>>): ValidationIssue[] {
  if (!model) return [];
  const issues: ValidationIssue[] = [];
  for (const key of ["size", "resolution", "aspect_ratio", "quality"] as const) {
    const value = parameters[key];
    const parameter = model.parameters?.find(parameter => parameter.key === key);
    if (value === undefined || !parameter?.options?.length) continue;
    // A fixed merchant size also resolves old automatic-size snapshots.
    if (key === "size" && value === "auto" && typeof model.metadata?.tk1688FixedSize === "string") continue;
    if (!parameter.options.some(option => option.value === value))
      issues.push({ path: `parameters.${key}`, code: key === "quality" ? "invalid_quality" : "invalid_image_size",
        message: `词元当前型号 ${key} 仅支持 ${parameter.options.map(option => option.value).join("、")}` });
  }
  const resolution = parameters.resolution;
  const supported = model.metadata?.tk1688SupportedResolutions;
  if (resolution !== undefined && resolution !== "auto" &&
    (!Array.isArray(supported) || !supported.includes(resolution)) && !issues.some(issue => issue.path === "parameters.resolution"))
    issues.push({ path: "parameters.resolution", code: "invalid_image_size", message: "词元当前商家未声明此分辨率档位" });
  const rawSize = parameters.size;
  if (rawSize !== undefined && rawSize !== "auto" && !model.parameters?.some(parameter => parameter.key === "size")) {
    const tiers = Array.isArray(supported) ? supported.filter((tier): tier is ImageSizeTier => ["1K", "2K", "4K"].includes(String(tier))) : [];
    const ratios = model.parameters?.find(parameter => parameter.key === "aspect_ratio")?.options
      ?.flatMap(option => typeof option.value === "string" && /^\d+:\d+$/u.test(option.value) ? [option.value] : []) ?? Object.keys(stationSizes);
    const allowedSizes = new Set(tiers.length ? tiers.flatMap(tier => ratios.map(ratio => tk1688SizeForTier(tier, ratio))) : Object.values(stationSizes));
    if (typeof rawSize !== "string" || !allowedSizes.has(rawSize))
      issues.push({ path: "parameters.size", code: "invalid_image_size", message: "词元当前商家未公开支持此精确尺寸，请使用该型号的分辨率和比例选项" });
    else if (typeof resolution === "string" && ["1K", "2K", "4K"].includes(resolution)) {
      const tierSizes = new Set(ratios.map(ratio => tk1688SizeForTier(resolution as ImageSizeTier, ratio)));
      if (!tierSizes.has(rawSize)) issues.push({ path: "parameters.size", code: "invalid_image_size", message: "精确尺寸与词元当前选择的分辨率档位冲突" });
    }
  }
  return issues;
}
