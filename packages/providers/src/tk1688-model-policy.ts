import type { ModelDescriptor, ResolvedProviderConnection, ValidationIssue } from "./contracts.js";
import { userImageQualityValues } from "./user-image-quality-presets.js";
import { applyUserImageSizePresets } from "./image-size-presets.js";
import { normalizeTk1688ImageSizeContract } from "./tk1688-image-size-contract.js";

const currentImageModel = (model: ModelDescriptor): ModelDescriptor => applyUserImageSizePresets(normalizeTk1688ImageSizeContract(model));

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
const chosen = (parameters: Readonly<Record<string, unknown>>, keys: readonly string[]) => keys.map(key => parameters[key]).filter(value => value !== undefined && value !== "auto" && value !== "");
/** The official studio publishes default pixels, without tying them to merchant tiers. */
export function tk1688DocumentedSize(resolution: unknown, ratio: unknown): string | undefined {
  return [undefined, "auto"].includes(resolution as string | undefined) && typeof ratio === "string" ? stationSizes[ratio] : undefined;
}

/** Current connection inventory is the permission boundary; another SKU's
 * published description cannot change this exact model's request policy.
 */
export function configuredTk1688ImageModel(connection: ResolvedProviderConnection, modelId: string): ModelDescriptor | undefined {
  if (!isTk1688ApiUrl(connection.baseUrl)) return undefined;
  const nested = record(connection.settings?.config);
  const models = connection.settings?.modelCatalogModels ?? nested?.modelCatalogModels;
  if (!Array.isArray(models)) return undefined;
  const model = models.find((value): value is ModelDescriptor => {
    const model = record(value);
    return model?.id === modelId && record(model.metadata)?.tk1688Catalog === true &&
      Array.isArray(model.operations) && model.operations.some(operation => operation === "image.generate" || operation === "image.edit");
  });
  return model ? currentImageModel(model) : undefined;
}

export function tk1688ImageParameters(
  source: Readonly<Record<string, unknown>>,
  selected: Record<string, unknown>,
  model: ModelDescriptor | undefined,
): Record<string, unknown> {
  if (model) model = currentImageModel(model);
  const declared = model?.parameters ? new Set(model.parameters.map(parameter => parameter.key)) : undefined;
  const result = Object.fromEntries(Object.entries(selected).filter(([key]) => !declared || declared.has(key)));
  // Discard only the generic adapter's derived pixels. Explicit user size is restored below.
  delete result.size;
  delete result.resolution;
  delete result.aspect_ratio;
  const fixedSize = model?.metadata?.tk1688FixedSize;
  const resolution = chosen(source, ["resolution", "image_size", "imageSize", "size_tier"])[0] ?? source.resolution;
  if (typeof source.size === "string" && /^\d+x\d+$/u.test(source.size)) result.size = source.size;
  else if (typeof fixedSize === "string" && /^\d+x\d+$/u.test(fixedSize)) result.size = fixedSize;
  else if (source.size === undefined || source.size === "auto") {
    const ratio = chosen(source, ["aspect_ratio", "aspectRatio", "ratio"])[0];
    const size = tk1688DocumentedSize(resolution, ratio);
    if (size) result.size = size;
  }
  if (model?.metadata?.tk1688OmitN === true) delete result.n;
  // The official studio omits quality when the user chooses automatic quality.
  if (result.quality === "auto") delete result.quality;
  return result;
}

/** Validate exact declared controls before submitting a billable request. */
export function tk1688ImageParameterIssues(model: ModelDescriptor | undefined, parameters: Readonly<Record<string, unknown>>, modelId = ""): ValidationIssue[] {
  if (model) model = currentImageModel(model);
  const issues: ValidationIssue[] = [];
  const ratios = chosen(parameters, ["aspect_ratio", "aspectRatio", "ratio"]);
  const resolutions = chosen(parameters, ["resolution", "image_size", "imageSize", "size_tier"]);
  if (new Set(ratios.map(String)).size > 1) issues.push({ path: "parameters.aspect_ratio", code: "conflicting_aspect_ratio", message: "词元已保存的比例字段不同，请明确选择；不自动改比例" });
  if (new Set(resolutions.map(String)).size > 1) issues.push({ path: "parameters.resolution", code: "conflicting_resolution", message: "词元已保存的档位字段不同，请明确选择；不自动改档位" });
  for (const ratio of ratios) if (typeof ratio !== "string" || !/^\d+:\d+$/u.test(ratio) || ratio.split(":").some(part => !Number.isSafeInteger(Number(part)) || Number(part) <= 0))
    issues.push({ path: "parameters.aspect_ratio", code: "invalid_aspect_ratio", message: "词元比例需为正整数 WIDTH:HEIGHT" });
  const requestedQualities = userImageQualityValues(modelId);
  const fallbackQualities = requestedQualities.length ? requestedQualities : ["auto", "low", "medium", "high"];
  if (!model && parameters.quality !== undefined && !fallbackQualities.includes(String(parameters.quality)))
    issues.push({ path: "parameters.quality", code: "invalid_quality", message: `当前型号质量可选 ${fallbackQualities.join("、")}` });
  for (const key of ["size", "resolution", "aspect_ratio", "quality"] as const) {
    const value = parameters[key];
    const parameter = model?.parameters?.find(parameter => parameter.key === key);
    if (value === undefined || !parameter?.options?.length) continue;
    if (key === "size" && parameter.control !== "select") continue;
    if (key === "resolution" && model?.metadata?.imageUserSizePresets) continue;
    if (key === "aspect_ratio" && parameter.allowCustomValue && typeof value === "string" && /^\d+:\d+$/u.test(value) && value.split(":").every(part => Number(part) > 0)) continue;
    // A fixed merchant size also resolves old automatic-size snapshots.
    if (key === "size" && value === "auto" && typeof model?.metadata?.tk1688FixedSize === "string") continue;
    if (!parameter.options.some(option => option.value === value))
      issues.push({ path: `parameters.${key}`, code: key === "quality" ? "invalid_quality" : "invalid_image_size",
        message: `词元当前型号 ${key} 仅支持 ${parameter.options.map(option => option.value).join("、")}` });
  }
  const resolution = resolutions[0] ?? parameters.resolution;
  const supported = model?.metadata?.imageUserSizePresetTiers ?? model?.metadata?.tk1688SupportedResolutions;
  if (resolution !== undefined && resolution !== "auto" &&
    (!Array.isArray(supported) || !supported.includes(resolution)) && !issues.some(issue => issue.path === "parameters.resolution"))
    issues.push({ path: "parameters.resolution", code: "invalid_image_size", message: "当前型号的可选分辨率不包含此档位" });
  const rawSize = parameters.size;
  if (rawSize !== undefined && rawSize !== "auto") {
    const match = typeof rawSize === "string" ? /^(\d+)x(\d+)$/u.exec(rawSize) : null;
    if (!match || ![match[1], match[2]].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0))
      issues.push({ path: "parameters.size", code: "invalid_image_size", message: "词元 size 必须为正整数 WIDTHxHEIGHT；文档没有公布自定义像素范围或步长" });
    const ratioValue = ratios[0];
    const ratio = typeof ratioValue === "string" ? /^(\d+):(\d+)$/u.exec(ratioValue) : null;
    if (match && ratio && Math.abs(Math.log((Number(match[1]) / Number(match[2])) / (Number(ratio[1]) / Number(ratio[2])))) > 0.012)
      issues.push({ path: "parameters.aspect_ratio", code: "size_ratio_mismatch", message: "词元 W/H 与已保存的比例不同，请明确调整；不自动换尺寸" });
  } else if (model?.metadata?.tk1688FixedSize === undefined && typeof resolution === "string" && ["1K", "2K", "4K"].includes(resolution)) {
    issues.push({ path: "parameters.size", code: "missing_documented_size", message: "此词元商家只声明了分辨率档位，没有逐比例像素表；请填写独立 W/H，按 size 原值发送" });
  } else if (ratios.length && !tk1688DocumentedSize(resolution, ratios[0])) {
    issues.push({ path: "parameters.size", code: "missing_documented_size", message: "词元工作台没有此比例的像素映射，请填写独立 W/H" });
  }
  return issues;
}
