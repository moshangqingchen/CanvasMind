import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterOption } from "./contracts.js";
import { parseSupplierGroupDetails } from "./supplier-group-details.js";
import { applyUserImageQualityPresets } from "./user-image-quality-presets.js";

export const IMAGE_SIZE_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
  "9:21",
] as const;
export type ImageSizeTier = "1K" | "2K" | "4K";

/** Pixel budgets for the verified 2.5 channels, with provider-required 16px alignment. */
export function imageSizeForTier(
  tier: ImageSizeTier,
  ratioText = "1:1",
  maxEdge = 3840,
): string {
  const [a, b] = ratioText.split(":").map(Number);
  const rawRatio = a && b ? a / b : 1;
  const ratio = Math.max(1 / 3, Math.min(3, rawRatio));
  const pixels = { "1K": 1024 ** 2, "2K": 2048 ** 2, "4K": 3840 * 2160 }[tier];
  const scale = Math.min(
    1,
    maxEdge / Math.sqrt(pixels * ratio),
    maxEdge / Math.sqrt(pixels / ratio),
  );
  let width = Math.max(
    16,
    Math.round((Math.sqrt(pixels * ratio) * scale) / 16) * 16,
  );
  let height = Math.max(
    16,
    Math.round((Math.sqrt(pixels / ratio) * scale) / 16) * 16,
  );
  while (width * height > pixels) {
    if (width >= height) width -= 16;
    else height -= 16;
  }
  return `${width}x${height}`;
}

export function imageSizeOptions(
  tiers: readonly ImageSizeTier[],
  maxEdge = 3840,
): ModelParameterOption[] {
  return [
    { label: "自动（提示词比例优先，其次参考图）", value: "auto" },
    ...tiers.flatMap((tier) =>
      IMAGE_SIZE_RATIOS.map((ratio) => {
        const value = imageSizeForTier(tier, ratio, maxEdge);
        return {
          label: `${tier} · ${ratio} · ${value.replace("x", " × ")}`,
          value,
        };
      }),
    ),
  ];
}

const USER_IMAGE_SIZE_PRESET_VERSION = "2026-10-11";
const USER_FOUR_K_SIZES: Readonly<Record<string, string>> = {
  "1:1": "2880x2880", "3:2": "3520x2336", "2:3": "2336x3520",
  "16:9": "3840x2160", "9:16": "2160x3840", "4:3": "3312x2480",
  "3:4": "2480x3312", "21:9": "3840x1648", "9:21": "1648x3840",
};

/** User-requested canvas shortcuts, not supplier declarations or measured output. */
export function userImageSizeOptions(tiers: readonly ImageSizeTier[] = ["1K", "2K", "4K"]): ModelParameterOption[] {
  return imageSizeOptions(tiers).map(option => {
    const ratio = /^4K · ([\d:]+) ·/u.exec(option.label)?.[1];
    const value = ratio ? USER_FOUR_K_SIZES[ratio] : undefined;
    return value ? { value, label: `4K · ${ratio} · ${value.replace("x", " × ")}` } : option;
  });
}

/** Langframe declares its own tier/ratio enums, including ratios absent from
 * the shared shortcuts. Pixels remain user presets, never supplier evidence. */
function langframePresetScope(model: ModelDescriptor): { tiers: Set<string>; ratios: string[] } | undefined {
  if (model.metadata?.langframeCatalog !== true) return;
  const raw = model.metadata.rawParams;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const source = raw as Record<string, unknown>;
  if (!Array.isArray(source.resolutions) || !source.resolutions.length || !Array.isArray(source.ratios) || !source.ratios.length) return;
  return { tiers: new Set(source.resolutions.filter((value): value is string => typeof value === "string")),
    ratios: [...new Set(source.ratios.filter((value): value is string => typeof value === "string" && /^[1-9]\d*:[1-9]\d*$/u.test(value)))] };
}

function userImageOptionsForModel(model: ModelDescriptor, tiers: readonly ImageSizeTier[]): ModelParameterOption[] {
  const options = userImageSizeOptions(tiers), scope = langframePresetScope(model);
  if (!scope) return options;
  const byTierRatio = new Map(options.flatMap(option => {
    const match = /^(1K|2K|4K) · ([\d:]+) ·/u.exec(option.label);
    return match ? [[`${match[1]}:${match[2]}`, option] as const] : [];
  }));
  return [options[0]!, ...tiers.filter(tier => scope.tiers.has(tier)).flatMap(tier => scope.ratios.map(ratio => {
    const existing = byTierRatio.get(`${tier}:${ratio}`);
    if (existing) return existing;
    const value = imageSizeForTier(tier, ratio);
    return { value, label: `${tier} · ${ratio} · ${value.replace("x", " × ")}` };
  }))];
}

function presetTier(value: unknown): ImageSizeTier | undefined {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return ["1K", "2K", "4K"].includes(normalized) ? normalized as ImageSizeTier : undefined;
}

function userPresetTiers(model: ModelDescriptor): ImageSizeTier[] {
  const metadata = model.metadata ?? {};
  const details = parseSupplierGroupDetails({
    name: String(metadata.modelGroup ?? ""),
    description: String(metadata.supplierGroupDescription ?? ""),
  }, "key-groups");
  const denied = new Set([
    ...(Array.isArray(metadata.imageUnsupportedResolutions) ? metadata.imageUnsupportedResolutions : []),
    ...(Array.isArray(metadata.unsupportedResolutions) ? metadata.unsupportedResolutions : []),
    ...(details?.unsupportedResolutions ?? []),
  ].map(presetTier).filter(Boolean));
  const fixed = presetTier(metadata.imageFixedResolution);
  const explicitTiers = metadata.imageResolutionTierSource === "official-key-group" && Array.isArray(metadata.imageResolutionTiers)
    ? metadata.imageResolutionTiers.map(presetTier).filter(Boolean)
    : metadata.exclusiveResolutions === true && Array.isArray(metadata.imageSupportedResolutions)
      ? metadata.imageSupportedResolutions.map(presetTier).filter(Boolean)
      : details?.exclusiveResolutions ? details.supportedResolutions?.map(presetTier).filter(Boolean) : undefined;
  return (["1K", "2K", "4K"] as const).filter(tier => !denied.has(tier) && (!fixed || tier === fixed) &&
    (!explicitTiers?.length || explicitTiers.includes(tier)) && (metadata.imageSizeContract !== "group-1k-only" || tier === "1K"));
}

function sizeFitsParameter(value: string, parameter: ModelParameterDescriptor, model: ModelDescriptor): boolean {
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (!match) return value === "auto";
  const [width, height] = [Number(match[1]), Number(match[2])];
  if ([width, height].some(edge => parameter.min !== undefined && edge < parameter.min || parameter.max !== undefined && edge > parameter.max ||
      parameter.step !== undefined && parameter.step > 1 && edge % parameter.step !== 0)) return false;
  const rules = model.metadata?.imageCustomDimensionRules;
  if (rules && typeof rules === "object") {
    const constraint = rules as Record<string, unknown>;
    const min = Number(constraint.minimumEdge), max = Number(constraint.maximumEdge), alignment = Number(constraint.alignment);
    const minPixels = Number(constraint.minimumPixels), maxPixels = Number(constraint.maximumPixels);
    const minLongestEdge = Number(constraint.minimumLongestEdge), maxAspectRatio = Number(constraint.maximumAspectRatio);
    if (Number.isFinite(min) && Math.min(width, height) < min || Number.isFinite(max) && Math.max(width, height) > max ||
        Number.isFinite(alignment) && alignment > 1 && (width % alignment !== 0 || height % alignment !== 0) ||
        Number.isFinite(minPixels) && width * height < minPixels || Number.isFinite(maxPixels) && width * height > maxPixels ||
        Number.isFinite(minLongestEdge) && minLongestEdge > 0 && Math.max(width, height) < minLongestEdge ||
        Number.isFinite(maxAspectRatio) && maxAspectRatio > 0 && Math.max(width / height, height / width) > maxAspectRatio) return false;
  }
  return true;
}

/** Final presentation/request projection. Supplier evidence and its enums remain intact. */
export function applyUserImageSizePresets(model: ModelDescriptor): ModelDescriptor {
  if (!model.operations?.some(operation => operation.startsWith("image.")) ||
      model.metadata?.source === "manual" || model.metadata?.protocolEvidence === "paid-test" || model.metadata?.source === "paid-test") return model;
  model = applyUserImageQualityPresets(model);
  const size = model.parameters?.find(parameter => parameter.key === "size");
  if (!size || model.metadata?.imageSizeOptionsCompleteEnum === true ||
      size.options?.some(option => /^\d+:\d+$/u.test(String(option.value))) && (size.control !== "dimensions" || size.allowCustomValue !== true) ||
      size.options?.some(option => presetTier(option.value)) && size.control !== "dimensions" && size.allowCustomValue !== true) return model;
  if (!["dimensions", "text", "select"].includes(size.control)) return model;
  const tiers = userPresetTiers(model);
  const explanation = "按用户要求补齐分辨率与比例尺寸预设；请求按所选宽高发送，实际输出以原图为准。";
  const sourceOptions = model.metadata?.imageUserSizePresets && Array.isArray(model.metadata?.imageUserSizeSourceOptions)
    ? model.metadata.imageUserSizeSourceOptions as ModelParameterOption[] : size.options ?? [];
  const sourceDescription = model.metadata?.imageUserSizePresets ? model.metadata?.imageUserSizeSourceDescription : size.description;
  const sourceByTierRatio = new Map(sourceOptions.flatMap(option => {
    const match = /^(1K|2K|4K) · ([\d:]+) ·/u.exec(option.label);
    return match ? [[`${match[1]}:${match[2]}`, option] as const] : [];
  }));
  const presets = userImageOptionsForModel(model, tiers).map(option => {
    if (option.value === "auto") return sourceOptions.find(source => source.value === "auto") ?? option;
    const match = /^(1K|2K|4K) · ([\d:]+) ·/u.exec(option.label);
    return match ? sourceByTierRatio.get(`${match[1]}:${match[2]}`) ?? option : option;
  }).filter(option => sizeFitsParameter(String(option.value), size, model));
  const values = new Set(presets.map(option => option.value));
  const scope = langframePresetScope(model);
  const options = [...presets, ...sourceOptions.filter(option => !values.has(option.value))].filter(option => {
    if (!scope) return true;
    const match = /^(1K|2K|4K) · ([\d:]+) ·/u.exec(option.label);
    // Keep arbitrary user W/H shortcuts; only labelled tier/ratio presets are
    // bounded by the supplier's explicit enums and retained tier prohibitions.
    return !match || tiers.includes(match[1] as ImageSizeTier) && scope.tiers.has(match[1]!) && scope.ratios.includes(match[2]!);
  });
  const parameters = model.parameters!.map(parameter => parameter === size ? {
    ...parameter, control: "dimensions" as const, allowCustomValue: true, options,
    description: explanation,
  } : parameter);
  return { ...model, parameters, metadata: { ...model.metadata,
    imageUserSizePresets: USER_IMAGE_SIZE_PRESET_VERSION,
    imageUserSizePresetSource: "user-request",
    imageUserSizePresetTiers: tiers,
    imageUserSizePresetParameter: "size",
    imageUserSizeSourceOptions: sourceOptions,
    ...(sourceDescription ? { imageUserSizeSourceDescription: sourceDescription } : {}),
  } };
}

/** Accept the nominal ratio attached to a rounded canvas preset. */
export function imageSizePresetMatchesRatio(size: unknown, ratio: unknown): boolean {
  if (typeof size !== "string" || typeof ratio !== "string") return false;
  return userImageSizeOptions().some(option => option.value === size && option.label.split(" · ")[1] === ratio);
}

/** Resolve auto + chosen tier/ratio before exact adapter validation; never replace explicit W/H. */
export function resolveUserImageSizeParameters(
  model: ModelDescriptor | undefined,
  parameters: Readonly<Record<string, unknown>> = {},
  inferredRatio?: string,
): Record<string, unknown> {
  if (!model) return { ...parameters };
  const projected = applyUserImageSizePresets(model);
  if (projected.metadata?.imageUserSizePresets !== USER_IMAGE_SIZE_PRESET_VERSION ||
      parameters.size !== undefined && parameters.size !== "" && parameters.size !== "auto" ||
      parameters.width !== undefined || parameters.height !== undefined) return { ...parameters };
  const tierKey = projected.metadata.imageResolutionTierParameter ?? projected.metadata.imageNativeResolutionParameter;
  const tier = presetTier(parameters.size_tier) ?? (typeof tierKey === "string" && tierKey !== "size" ? presetTier(parameters[tierKey]) : undefined);
  // Omitted size belongs to native ratio transports; only an explicit automatic
  // size or canvas tier asks this projection to derive pixels.
  if (parameters.size === undefined && !presetTier(parameters.size_tier)) return { ...parameters };
  const ratio = [parameters.aspect_ratio, parameters.aspectRatio, parameters.ratio]
    .find(value => typeof value === "string" && value !== "auto" && value !== "");
  if (!tier) return { ...parameters };
  const selectedTier = tier;
  const selectedRatio = typeof ratio === "string" ? ratio : inferredRatio ?? "1:1";
  const option = projected.parameters?.find(parameter => parameter.key === "size")?.options?.find(candidate =>
    candidate.label.startsWith(`${selectedTier} · ${selectedRatio} ·`));
  return option ? { ...parameters, size: option.value } : { ...parameters };
}
