import type { ModelDescriptor, ModelParameterDescriptor, ProviderOperation } from "./contracts.js";
import { getModelParameterDescriptor } from "./cli-contracts.js";
import { resolveUserImageSizeParameters } from "./image-size-presets.js";

type ParameterModel = Pick<ModelDescriptor, "parameters" | "metadata">;
type ParameterValues = Readonly<Record<string, unknown>>;
type ParameterAliases = ReadonlyArray<readonly [string, readonly string[]]>;

/** Aliases belong to the exact supplier contract, never just a model family. */
export function imageParameterAliases(model?: ParameterModel | null): ParameterAliases {
  if (model?.metadata?.genimageNativeSizeOpen === true ||
      model?.metadata?.mikotoImageContract === true && model.metadata.imageResolutionTierParameter === "size_tier")
    return [["aspect_ratio", ["aspectRatio", "ratio"]]];
  if (model?.metadata?.pdogImageProtocol === 1 && model.metadata.imageResolutionTierParameter === "size_tier")
    return [["aspect_ratio", ["aspectRatio", "ratio"]], ["size_tier", ["resolution"]]];
  if (model?.metadata?.tk1688ImageSizeContract === 2)
    return [["aspect_ratio", ["aspectRatio", "ratio"]], ["resolution", ["image_size", "imageSize", "size_tier"]]];
  if (model?.metadata?.jijiuImageContract === true && model.metadata.imageParameterPresetSource === "jijiu-high-tier-user-request")
    return [["size", ["resolution", "image_size", "imageSize", "size_tier"]]];
  if (model?.metadata?.jiasuImageProtocol === 1)
    return [["ratio", ["aspect_ratio", "aspectRatio"]], ["resolution", ["image_size", "size_tier"]]];
  return [];
}

/** Resolve conditional controls without cleaning, clamping or saving user values. */
export function imageParameterControls(
  model: ParameterModel,
  parameters: ParameterValues = {},
  operation?: ProviderOperation,
): ModelParameterDescriptor[] {
  const defaults = Object.fromEntries((model.parameters ?? []).filter(field => field.default !== undefined)
    .map(field => [field.key, field.default]));
  const effective = { ...defaults, ...parameters };
  return (model.parameters ?? []).flatMap(original => {
    const field = getModelParameterDescriptor(model, original.key, effective, operation);
    if (!field) return [];
    if (field.default !== undefined && !field.allowCustomValue && field.options?.length &&
        !field.options.some(option => option.value === field.default)) field.default = field.options[0]!.value;
    return [field];
  });
}

export interface ImageParameterEvaluation {
  model: ModelDescriptor;
  controls: ModelParameterDescriptor[];
  /** Application parameters for the existing supplier serializer, not a wire body. */
  requestParameters: Record<string, unknown>;
  /** Billing aliases are local facts only and must never be copied to a request. */
  pricingParameters: Record<string, unknown>;
  resolutionTier?: string;
}

/**
 * Evaluate one already-resolved supplier/group/model contract. No global model-ID
 * cache, network calls, inferred prices, or changes to saved values. Final wire
 * fields and validation remain owned by that supplier's existing adapter.
 */
export function evaluateImageParameters(
  model: ModelDescriptor,
  parameters: ParameterValues = {},
  context: { operation?: ProviderOperation; inferredRatio?: string } = {},
): ImageParameterEvaluation {
  const requestParameters = resolveUserImageSizeParameters(model, parameters, context.inferredRatio);
  const defaults = Object.fromEntries((model.parameters ?? []).filter(field => field.default !== undefined)
    .map(field => [field.key, field.default]));
  const pricingParameters = { ...defaults, ...requestParameters };
  for (const [canonical, aliases] of imageParameterAliases(model)) {
    const alias = aliases.find(key => requestParameters[key] !== undefined);
    if (requestParameters[canonical] === undefined && alias) pricingParameters[canonical] = requestParameters[alias];
  }
  // Reuse the current contract's labelled sizes; do not classify arbitrary pixels
  // using another supplier's tier thresholds or turn examples into fixed enums.
  const selectedResolution = requestParameters.size_tier ?? requestParameters.resolution ?? requestParameters.image_size;
  const resolutionTier = String(selectedResolution ?? "").toUpperCase()
    || model.parameters?.find(field => field.key === "size")?.options
      ?.find(option => option.value === requestParameters.size)?.label.match(/\b[124]K\b/iu)?.[0]?.toUpperCase();
  const defaultResolution = pricingParameters.size_tier ?? pricingParameters.resolution ?? pricingParameters.image_size;
  // Native values may participate in case-sensitive supplier price conditions.
  // Uppercase display labels must not replace an explicit "auto" or open value.
  const resolution = requestParameters.resolution ?? selectedResolution ?? (resolutionTier || defaultResolution);
  if (resolution !== undefined) pricingParameters.resolution = resolution;
  return {
    model,
    controls: imageParameterControls(model, parameters, context.operation),
    requestParameters,
    pricingParameters,
    ...(resolutionTier ? { resolutionTier } : {}),
  };
}
