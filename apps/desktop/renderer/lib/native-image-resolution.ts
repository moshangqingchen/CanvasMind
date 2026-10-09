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
  if (!resolution) return undefined;
  return { resolution, ratio: descriptors.find(descriptor => isImageRatioParameter(descriptor) && descriptor.control === "select") };
}

/** Never infer image pixels from a tier name or a video resolution. */
export function declaredImageOutputDimensions(
  model: ModelDescriptor | null | undefined,
  resolution: unknown,
  ratio: unknown,
): { width: number; height: number } | undefined {
  const dimensions = model?.metadata?.imageOutputDimensions;
  if (!Array.isArray(dimensions)) return undefined;
  const matches = dimensions.filter(entry => entry && typeof entry === "object" &&
    entry.resolution === resolution && entry.aspectRatio === ratio &&
    Number.isSafeInteger(entry.width) && entry.width > 0 &&
    Number.isSafeInteger(entry.height) && entry.height > 0);
  const first = matches[0];
  if (!first || matches.some(entry => entry.width !== first.width || entry.height !== first.height)) return undefined;
  return { width: first.width as number, height: first.height as number };
}
