import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterOption } from "@super-canvas/providers";

const resolutionKeys = new Set(["resolution", "image_size", "imageSize", "output_resolution", "tier"]);
const ratioKeys = new Set(["aspect_ratio", "aspectRatio", "ratio"]);

export function isImageRatioParameter(descriptor: ModelParameterDescriptor): boolean {
  if (ratioKeys.has(descriptor.key)) return true;
  if (descriptor.key !== "size" || descriptor.control !== "select") return false;
  const ratios = (descriptor.options ?? []).filter(option => String(option.value) !== "auto");
  return ratios.length > 0 && ratios.every(option => /^\d+:\d+$/u.test(String(option.value)) &&
    String(option.value).split(":").every(part => Number(part) > 0));
}

/** Image labels are independent of the supplier's request enum. */
export function imageResolutionOptionLabel(option: ModelParameterOption): string {
  const value = String(option.value).trim();
  if (/^auto$/iu.test(value)) return "自动";
  if (/^1080p$/iu.test(value)) return "标准";
  if (/^\d+p$/iu.test(value)) return `${value.slice(0, -1)} 像素档`;
  if (/^\d+k$/iu.test(value)) return value.toUpperCase();
  return option.label;
}

/** Native tiers and ratios remain separate parameters; pixels are display only. */
export function nativeImageResolutionControl(
  descriptors: readonly ModelParameterDescriptor[],
  model?: Pick<ModelDescriptor, "metadata"> | null,
): { resolution: ModelParameterDescriptor; ratio?: ModelParameterDescriptor } | undefined {
  const nativeKey = model?.metadata?.imageNativeResolutionParameter;
  const declaredResolution = descriptors.find(descriptor => descriptor.key === nativeKey && descriptor.control === "select" && descriptor.options?.length);
  const resolution = declaredResolution ?? descriptors.find(descriptor => {
    if (descriptor.control !== "select" || !descriptor.options?.length) return false;
    if (resolutionKeys.has(descriptor.key)) return true;
    const concrete = descriptor.options.filter(option => !/^auto$/iu.test(String(option.value)));
    if (descriptor.key === "size" && concrete.some(option => /^\d+x\d+$/iu.test(String(option.value)))) return false;
    if (/分辨率|清晰度/u.test(descriptor.label) && concrete.length > 0 &&
        concrete.every(option => /^\d+K(?:\s*[（(].*[）)])?$/iu.test(option.label))) return true;
    if (!["size", "quality"].includes(descriptor.key)) return false;
    return concrete.length > 0 && concrete.every(option => /^(?:\d+k|\d+p|512|web)$/iu.test(String(option.value)));
  });
  if (!resolution && model?.metadata?.imageNativeParameterContract === true && descriptors.some(isImageRatioParameter)) {
    const label = String(model.metadata.imageFixedResolution ?? "供应商原生");
    return { resolution: { key: "__fixed_resolution", label: "分辨率", control: "select", valueType: "string", default: label,
      options: [{ value: label, label }], description: model.metadata.imageFixedResolution ? "清晰度由完整型号决定；切换档位需要切换型号。供应商未公开逐比例像素表，以原图为准。" : "该完整型号没有可选 K 档；尺寸由供应商按画幅决定，以原图像素为准。" },
      ratio: descriptors.find(descriptor => isImageRatioParameter(descriptor) && descriptor.control === "select") };
  }
  if (!resolution) return undefined;
  return { resolution, ratio: descriptors.find(descriptor => isImageRatioParameter(descriptor) && descriptor.control === "select") };
}

/** Never infer image pixels from a tier name or a video resolution. */
export function declaredImageOutputDimensions(
  model: ModelDescriptor | null | undefined,
  resolution: unknown,
  ratio: unknown,
): { width: number; height: number } | undefined {
  return declaredDimensions(model?.metadata?.imageOutputDimensions, resolution, ratio);
}

/** Supplier reference pixels are separate from promised output dimensions. */
export function declaredImageReferenceDimensions(model: ModelDescriptor | null | undefined, resolution: unknown, ratio: unknown): { width: number; height: number } | undefined {
  return declaredDimensions(model?.metadata?.imageOutputReferenceDimensions, resolution, ratio);
}

function declaredDimensions(dimensions: unknown, resolution: unknown, ratio: unknown): { width: number; height: number } | undefined {
  if (!Array.isArray(dimensions)) return undefined;
  const matches = dimensions.filter(entry => entry && typeof entry === "object" &&
    entry.resolution === resolution && entry.aspectRatio === ratio &&
    Number.isSafeInteger(entry.width) && entry.width > 0 &&
    Number.isSafeInteger(entry.height) && entry.height > 0);
  const first = matches[0];
  if (!first || matches.some(entry => entry.width !== first.width || entry.height !== first.height)) return undefined;
  return { width: first.width as number, height: first.height as number };
}

/** A ratio option describes this selected native tier, without guessing pixels. */
export function nativeImageRatioOptionLabel(
  model: ModelDescriptor | null | undefined,
  resolution: ModelParameterDescriptor,
  value: unknown,
  ratio: ModelParameterOption,
): string {
  const tier = resolution.options?.find(option => String(option.value) === String(value)) ??
    { value: String(value ?? ""), label: String(value ?? "") };
  const label = imageResolutionOptionLabel(tier);
  const dimensions = declaredImageOutputDimensions(model, value, ratio.value);
  if (dimensions) return `${label} · ${String(ratio.value)} · ${dimensions.width} × ${dimensions.height}`;
  const reference = declaredImageReferenceDimensions(model, value, ratio.value);
  if (reference) return `${label} · ${String(ratio.value)} · ${reference.width} × ${reference.height}（参考）`;
  return `${label} · ${ratio.label}`;
}
