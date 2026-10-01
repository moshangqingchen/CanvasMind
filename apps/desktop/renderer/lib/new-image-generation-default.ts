import type { ModelDescriptor, ModelParameterDescriptor } from "@super-canvas/providers";
import { imageSizeOptions } from "@super-canvas/providers/image-size-presets";
import { getModelParameterDescriptor } from "@super-canvas/providers/cli-contracts";
import { modelSupportsNodeType } from "./graph-ui";
import { modelDescriptorForSavedSelection, parameterDescriptorsFor, parametersWithDefaults } from "./model-parameters";
import { providerConnectionSupplierKey, providerConnectionUsage } from "./provider-connection-options";
import type { ProviderConnectionView } from "./client-api";
import { matchesSupplierTemplate } from "./supplier-template-source";

const highestQuality = (value: unknown) => /^(?:max|maximum|highest)$/iu.test(String(value));
const fourK = (value: unknown) => String(value).trim().toUpperCase() === "4K";
const blockedCapability = (item: unknown) => {
  if (!item || typeof item !== "object") return false;
  const evidence = item as Record<string, unknown>;
  return (fourK(evidence.resolution) && ["unsupported", "conflict", "approximate"].includes(String(evidence.status))) ||
    (highestQuality(evidence.quality) && ["unsupported", "conflict"].includes(String(evidence.status)));
};
const weAiImage25Group = "生图-openai-adobe-image2.5专属";
const operations = ["image.generate", "image.edit"] as const;
const weAiImage25Parameters: readonly ModelParameterDescriptor[] = [
  { key: "size", label: "输出分辨率", control: "dimensions", valueType: "string", default: "auto",
    min: 16, max: 3840, step: 16, options: imageSizeOptions(["1K", "2K", "4K"], 3840), operations,
    description: "Image 2.5 请求尺寸预设，实际像素以供应商返回结果为准。" },
  { key: "quality", label: "质量", control: "select", valueType: "string", default: "high", operations,
    options: ["auto", "low", "medium", "high", "xhigh", "max"].map((value, index) => ({
      value, label: `${["自动", "低", "中", "高", "超高", "最高"][index]}（${value}）`,
    })) },
  { key: "n", label: "数量", control: "number", valueType: "integer", default: 1, min: 1, max: 1, step: 1, operations },
];

/** Supply this exact API's request controls when its inventory omits a schema.
 * The adapter contract is covered by providers/weai-timeout.test.ts; it is not
 * evidence that a live upstream image has returned the requested pixel size.
 * Existing schemas and negative capability or permission evidence take priority.
 */
export function withWeAiImage25RequestParameters(connection: ProviderConnectionView, models: readonly ModelDescriptor[]): ModelDescriptor[] {
  if (providerConnectionSupplierKey(connection) !== "weai" || connection.provider !== "openai" ||
      !matchesSupplierTemplate(connection) || connection.config.modelGroup !== weAiImage25Group ||
      (connection.config.accountKeyGroup && connection.config.accountKeyGroup !== weAiImage25Group) ||
      connection.config.supplierArchived === true || ["empty", "unauthorized"].includes(String(connection.config.modelScanStatus))) return [...models];
  return models.map(model => {
    const assumedSchema = model.metadata?.qualitySupport === "assumed";
    if (!/^gpt-image-2\.5-(?:flare|sunburst)$/u.test(model.id) || !model.operations.includes("image.generate") ||
        (model.parameters?.length && !assumedSchema) || model.metadata?.canvasRunnable === false ||
        model.metadata?.parameterControlsUnavailable === true || model.metadata?.imageResolutionMode === "provider-decided" ||
        ["provider-decided", "unsupported"].includes(String(model.metadata?.qualitySupport)) ||
        (model.metadata?.fixedQuality !== undefined && !highestQuality(model.metadata.fixedQuality))) return model;
    for (const key of ["imageUnsupportedResolutions", "imageApproximateResolutions"])
      if (Array.isArray(model.metadata?.[key]) && (model.metadata[key] as unknown[]).some(fourK)) return model;
    const evidence = model.metadata?.imageCapabilityEvidence;
    if (Array.isArray(evidence) && evidence.some(blockedCapability)) return model;
    return { ...model,
      parameters: [...weAiImage25Parameters, ...(model.parameters ?? []).filter(parameter => !["size", "quality", "n"].includes(parameter.key))],
      metadata: { ...model.metadata, imageParameterPresetSource: "weai-image25-request-profile" },
    };
  });
}

/** Require declared Image 2.5 max-quality and 4K controls, never generic fallbacks. */
export function image25Highest4KParameters(provider: string, model: ModelDescriptor): Record<string, unknown> | undefined {
  const requestPreset = model.metadata?.imageParameterPresetSource === "weai-image25-request-profile";
  if (provider === "fake" || !/^(?:az-)?(?:gpt[-_]?)?image[-_]?2\.5(?:$|[-_:])/iu.test(model.id.trim()) ||
      !modelSupportsNodeType(model, "image-generation") || !model.operations.includes("image.generate") ||
      model.metadata?.canvasRunnable === false || !model.parameters?.length ||
      model.metadata?.parameterControlsUnavailable === true ||
      model.metadata?.imageResolutionMode === "provider-decided" ||
      (["provider-decided", "unsupported"].includes(String(model.metadata?.qualitySupport)) || (model.metadata?.qualitySupport === "assumed" && !requestPreset))) return undefined;
  for (const key of ["imageUnsupportedResolutions", "imageApproximateResolutions"])
    if (Array.isArray(model.metadata?.[key]) && (model.metadata[key] as unknown[]).some(fourK)) return undefined;
  const evidence = model.metadata?.imageCapabilityEvidence;
  if (Array.isArray(evidence) && (evidence.some(blockedCapability) || evidence.some(item => item && typeof item === "object" &&
      fourK(item.resolution) && item.status === "assumed" && !requestPreset))) return undefined;
  if (Array.isArray(model.metadata?.imageRequestResolutions) && model.metadata.imageRequestResolutions.some(fourK) &&
      !(Array.isArray(model.metadata.imageSupportedResolutions) && model.metadata.imageSupportedResolutions.some(fourK)) &&
      !(Array.isArray(evidence) && evidence.some(item => item && typeof item === "object" &&
        fourK(item.resolution) && ["declared", "verified"].includes(String(item.status)))) && !requestPreset) return undefined;
  const descriptors = parameterDescriptorsFor("image-generation", provider, model)
    .filter(parameter => !parameter.operations?.length || parameter.operations.includes("image.generate"));
  const nativeSizeKey = model.metadata?.imageNativeResolutionParameter;
  const sizeDescriptors = descriptors.filter(parameter => parameter.key === nativeSizeKey ||
    ["size", "resolution", "image_size", "imageSize", "tier"].includes(parameter.key) ||
    (parameter.key === "quality" && parameter.options?.every(option => /^[124]k$/iu.test(String(option.value)))));
  const sized = sizeDescriptors.flatMap(descriptor => (descriptor.options ?? []).flatMap(option => {
    if (fourK(option.value)) return [{ descriptor, option }];
    const pixels = /^(\d+)x(\d+)$/iu.exec(String(option.value));
    return pixels && Number(pixels[1]) * Number(pixels[2]) > 5_000_000 &&
      /(?:^|[^a-z0-9])4k(?:[^a-z0-9]|$)/iu.test(option.label) &&
      !/非\s*4k|近似|上采样|upscal/iu.test(option.label) ? [{ descriptor, option }] : [];
  }));
  const selectedSize = sized.find(({ descriptor, option }) => descriptor.key === nativeSizeKey && option.value === descriptor.default) ??
    sized.find(({ descriptor }) => descriptor.key === nativeSizeKey) ??
    sized.find(({ descriptor, option }) => option.value === descriptor.default) ??
    sized.find(({ option }) => /1\s*:\s*1/u.test(option.label)) ?? sized[0];
  if (!selectedSize) return undefined;
  const quality = descriptors.find(parameter => /^(?:quality|image_quality|output_quality)$/iu.test(parameter.key) &&
    parameter.key !== selectedSize.descriptor.key && parameter.options?.some(option => highestQuality(option.value)));
  const maxOption = quality?.options?.find(option => highestQuality(option.value));
  if (!maxOption && !highestQuality(model.metadata?.fixedQuality)) return undefined;
  if (model.metadata?.fixedQuality !== undefined && !highestQuality(model.metadata.fixedQuality)) return undefined;
  const parameters = parametersWithDefaults(descriptors, {}, provider === "cli");
  parameters[selectedSize.descriptor.key] = selectedSize.option.value;
  if (quality && maxOption) parameters[quality.key] = maxOption.value;
  const countDescriptor = descriptors.find(parameter => parameter.key === "n");
  if (countDescriptor && (countDescriptor.min ?? 1) <= 1 && (countDescriptor.max ?? 1) >= 1 &&
      (!countDescriptor.options?.length || countDescriptor.options.some(option => Number(option.value) === 1))) parameters.n = 1;
  if (selectedSize.descriptor.key === "size" && /^\d+x\d+$/iu.test(String(selectedSize.option.value))) {
    if (provider !== "cli" || descriptors.some(parameter => parameter.key === "size_tier")) parameters.size_tier = "4K";
    for (const key of ["aspect_ratio", "aspectRatio", "ratio"]) delete parameters[key];
  }
  // Conditional controls must remain legal in the selected 4K request.
  if ([selectedSize.descriptor, quality].some(descriptor => descriptor?.visibleWhen?.some(condition =>
      !condition.values.includes(parameters[condition.parameter] as string | number | boolean)))) return undefined;
  for (const descriptor of [selectedSize.descriptor, quality]) {
    if (!descriptor) continue;
    const resolved = getModelParameterDescriptor(model, descriptor.key, parameters, "image.generate");
    if (!resolved || (resolved.options?.length && !resolved.options.some(option =>
        String(option.value) === String(parameters[descriptor.key])))) return undefined;
  }
  return parameters;
}

/** New-node preference only; supplier identity is independent of its API adapter. */
export function weAiImageGenerationDefault(connection: ProviderConnectionView, models: readonly ModelDescriptor[]) {
  if (providerConnectionSupplierKey(connection) !== "weai" || providerConnectionUsage(connection) !== "canvas") return undefined;
  const available = withWeAiImage25RequestParameters(connection, models);
  const preferred = modelDescriptorForSavedSelection(available, connection.config.defaultModel);
  const ordered = [preferred, ...available.filter(model => model.isDefault), ...available];
  for (const model of ordered) {
    if (!model) continue;
    const parameters = image25Highest4KParameters(connection.provider, model);
    if (parameters) return { model, parameters };
  }
  return undefined;
}
