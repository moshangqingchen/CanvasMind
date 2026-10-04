import {
  imageSizeForTier,
  type ImageSizeTier,
} from "@super-canvas/providers/image-size-presets";
import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
} from "@super-canvas/providers";

const tiers: readonly ImageSizeTier[] = ["1K", "2K", "4K"];
const stationSizes: Readonly<Record<string, string>> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

interface Tk1688ResolutionPreset {
  value: string;
  ratio: string;
  tier?: ImageSizeTier;
}

/** Presentation only: the model's real parameter descriptors stay unchanged. */
export interface Tk1688ResolutionControl {
  descriptor: ModelParameterDescriptor;
  value: string;
  savedTier?: ImageSizeTier;
  readOnlyDimensions: true;
  readonly presets: readonly Tk1688ResolutionPreset[];
  readonly supportedTiers: readonly ImageSizeTier[];
  readonly automaticResolution: boolean;
  readonly automaticRatio: boolean;
  readonly automaticOptions: readonly ModelParameterOption[];
  readonly fixedSize?: string;
}

function validTier(value: unknown): ImageSizeTier | undefined {
  return tiers.find(tier => tier === value);
}

function sizeForTier(tier: ImageSizeTier, ratio: string): string {
  // The 1K station presets differ from the generic pixel-budget calculation.
  return tier === "1K" && stationSizes[ratio]
    ? stationSizes[ratio]!
    : imageSizeForTier(tier, ratio);
}

function declaredTiers(model: ModelDescriptor): ImageSizeTier[] {
  const declared = model.metadata?.tk1688SupportedResolutions;
  return Array.isArray(declared) ? tiers.filter(tier => declared.includes(tier)) : [];
}

export function tk1688ResolutionControl(
  model: ModelDescriptor | null | undefined,
  descriptors: readonly ModelParameterDescriptor[],
  parameters: Readonly<Record<string, unknown>>,
): Tk1688ResolutionControl | undefined {
  if (model?.metadata?.tk1688Catalog !== true ||
      !model.operations.some(operation => operation === "image.generate" || operation === "image.edit"))
    return undefined;

  const sizeDescriptor = descriptors.find(descriptor => descriptor.key === "size");
  const fixedSize = model.metadata.tk1688FixedSize;
  if (typeof fixedSize === "string" && /^\d+x\d+$/u.test(fixedSize) &&
      sizeDescriptor?.options?.some(option => option.value === fixedSize)) {
    const supportedTiers = declaredTiers(model);
    // A single declared tier names these fixed pixels; their dimensions alone
    // do not grant additional resolutions or proportions.
    const savedTier = supportedTiers.length === 1 ? supportedTiers[0] : undefined;
    return {
      descriptor: {
        ...sizeDescriptor,
        label: "分辨率",
        control: "dimensions",
        default: fixedSize,
        options: [{
          label: `${savedTier ? `${savedTier} · ` : ""}固定 · ${fixedSize.replace("x", " × ")}`,
          value: fixedSize,
        }],
      },
      value: fixedSize,
      savedTier,
      readOnlyDimensions: true,
      fixedSize,
      presets: [],
      supportedTiers: savedTier ? [savedTier] : [],
      automaticResolution: false,
      automaticRatio: false,
      automaticOptions: [],
    };
  }

  const resolutionDescriptor = descriptors.find(descriptor => descriptor.key === "resolution");
  const ratioDescriptor = descriptors.find(descriptor => descriptor.key === "aspect_ratio");
  if (!resolutionDescriptor || !ratioDescriptor) return undefined;

  const supportedTiers = declaredTiers(model).filter(tier =>
    resolutionDescriptor.options?.some(option => option.value === tier));
  const automaticResolution = resolutionDescriptor.options?.some(option => option.value === "auto") === true;
  const automaticRatio = ratioDescriptor.options?.some(option => option.value === "auto") === true;
  const ratios = (ratioDescriptor.options ?? []).flatMap(option =>
    typeof option.value === "string" && /^\d+:\d+$/u.test(option.value) &&
    option.value.split(":").every(part => Number(part) > 0)
      ? [{ value: option.value, label: option.label }]
      : []);
  const presets: Tk1688ResolutionPreset[] = [
    ...supportedTiers.flatMap(tier => ratios.map(ratio => ({
      value: sizeForTier(tier, ratio.value), ratio: ratio.value, tier,
    }))),
    // These are the official studio's default ratio presets, without claiming
    // a named 1K tier for a merchant that did not declare it.
    ...(automaticResolution ? ratios.flatMap(ratio => stationSizes[ratio.value]
      ? [{ value: stationSizes[ratio.value]!, ratio: ratio.value }]
      : []) : []),
  ];
  const automaticOptions: ModelParameterOption[] = [
    ...(automaticResolution && automaticRatio
      ? [{ label: "自动（提示词优先，其次参考图）", value: "auto" }]
      : []),
    ...(automaticResolution ? ratios.flatMap(ratio => stationSizes[ratio.value]
      ? [{ label: `${ratio.label} · ${stationSizes[ratio.value]!.replace("x", " × ")}`, value: stationSizes[ratio.value]! }]
      : []) : []),
  ];
  const seenValues = new Set<string>();
  const options = [
    ...(automaticResolution && automaticRatio
      ? [{ label: "自动（提示词优先，其次参考图）", value: "auto" }]
      : []),
    ...presets.flatMap(preset => {
      if (seenValues.has(preset.value)) return [];
      seenValues.add(preset.value);
      const ratio = ratios.find(ratio => ratio.value === preset.ratio)!;
      return [{
        label: `${preset.tier ? `${preset.tier} · ` : ""}${ratio.label} · ${preset.value.replace("x", " × ")}`,
        value: preset.value,
      }];
    }),
  ];
  const resolution = parameters.resolution ?? resolutionDescriptor.default;
  const ratio = parameters.aspect_ratio ?? ratioDescriptor.default;
  const savedTier = validTier(resolution);
  const activeTier = savedTier && supportedTiers.includes(savedTier) ? savedTier : undefined;
  const matching = presets.find(preset => preset.tier === activeTier && preset.ratio === ratio);
  const rawSize = parameters.size;
  const value = typeof rawSize === "string" && /^\d+x\d+$/u.test(rawSize)
    ? rawSize
    : matching?.value ?? "auto";

  return {
    descriptor: {
      key: "size", label: "分辨率", control: "dimensions", valueType: "string",
      default: "auto", options,
      description: "使用当前词元型号已声明的分辨率与比例；像素尺寸仅展示，不能输入商家未声明的尺寸。",
    },
    value,
    savedTier: activeTier,
    readOnlyDimensions: true,
    presets,
    supportedTiers,
    automaticResolution,
    automaticRatio,
    automaticOptions,
  };
}

/** Map the shared dimensions UI back to the actual Tk1688 request fields. */
export function tk1688ParametersForResolutionChange(
  control: Tk1688ResolutionControl,
  parameters: Readonly<Record<string, unknown>>,
  raw: string,
  tier?: ImageSizeTier | null,
): Record<string, unknown> {
  const next = { ...parameters };
  if (control.fixedSize) {
    next.size = control.fixedSize;
    delete next.resolution;
    delete next.aspect_ratio;
    delete next.size_tier;
    return next;
  }

  const currentTier = validTier(parameters.resolution);
  const selectedTier = tier === undefined ? currentTier : tier ?? undefined;
  if (selectedTier && !control.supportedTiers.includes(selectedTier)) return next;
  if (!selectedTier && !control.automaticResolution) return next;

  let ratio: string;
  if (raw === "auto") {
    if (!control.automaticRatio) return next;
    ratio = "auto";
  } else {
    const preset = control.presets.find(preset =>
      preset.value === raw && preset.tier === selectedTier);
    if (!preset) return next;
    ratio = preset.ratio;
  }
  next.resolution = selectedTier ?? "auto";
  next.aspect_ratio = ratio;
  delete next.size;
  delete next.size_tier;
  return next;
}
