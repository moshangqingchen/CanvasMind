import type { ImageSizeTier } from "@super-canvas/providers/image-size-presets";
import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
} from "@super-canvas/providers";

const tiers: readonly ImageSizeTier[] = ["1K", "2K", "4K"];
/** Presentation only: the model's real parameter descriptors stay unchanged. */
export interface Tk1688ResolutionControl {
  descriptor: ModelParameterDescriptor;
  value: string;
  savedTier?: ImageSizeTier;
  readOnlyDimensions: true;
  readonly automaticOptions: readonly ModelParameterOption[];
  readonly fixedSize: string;
}

function declaredTiers(model: ModelDescriptor): ImageSizeTier[] {
  const declared = model.metadata?.tk1688SupportedResolutions;
  return Array.isArray(declared) ? tiers.filter(tier => declared.includes(tier)) : [];
}

export function tk1688ResolutionControl(
  model: ModelDescriptor | null | undefined,
  descriptors: readonly ModelParameterDescriptor[],
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
      automaticOptions: [],
    };
  }

  // Open dimensions use the shared tier and size controls directly.
  return undefined;
}

/** Map the shared dimensions UI back to the actual Tk1688 request fields. */
export function tk1688ParametersForResolutionChange(
  control: Tk1688ResolutionControl,
  parameters: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const next = { ...parameters };
  next.size = control.fixedSize;
  delete next.resolution;
  delete next.aspect_ratio;
  delete next.size_tier;
  return next;
}
