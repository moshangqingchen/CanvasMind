import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterValue,
  ProviderOperation,
} from "@super-canvas/providers";
import type { GenerationNodeType } from "./graph-ui";

const IMAGE_PARAMETERS: readonly ModelParameterDescriptor[] = [
  {
    key: "aspect_ratio",
    label: "画面比例",
    control: "select",
    valueType: "string",
    default: "auto",
    options: [
      { label: "自动（提示词优先，其次参考图）", value: "auto" },
      { label: "方形 1:1", value: "1:1" },
      { label: "横向 16:9", value: "16:9" },
      { label: "竖向 9:16", value: "9:16" },
      { label: "横向 4:3", value: "4:3" },
      { label: "竖向 3:4", value: "3:4" },
    ],
    description:
      "自动模式优先读取提示词中的比例；提示词没有明确比例时跟随第一张参考图",
  },
  {
    key: "size",
    label: "精确尺寸",
    control: "text",
    valueType: "string",
    placeholder: "例如 1024x1024（可选）",
    options: [
      { label: "方形 1024 x 1024", value: "1024x1024" },
      { label: "横向 1536 x 1024", value: "1536x1024" },
      { label: "竖向 1024 x 1536", value: "1024x1536" },
    ],
    description: "填写精确尺寸后，不再发送画面比例",
  },
  {
    key: "quality",
    label: "质量",
    control: "select",
    valueType: "string",
    default: "high",
    options: [
      { label: "自动", value: "auto" },
      { label: "低", value: "low" },
      { label: "中", value: "medium" },
      { label: "高", value: "high" },
    ],
  },
  {
    key: "n",
    label: "数量",
    control: "number",
    valueType: "integer",
    default: 1,
    min: 1,
    max: 10,
    step: 1,
  },
];

const VIDEO_PARAMETERS: readonly ModelParameterDescriptor[] = [
  {
    key: "duration",
    label: "时长（秒）",
    control: "number",
    valueType: "integer",
    default: 5,
    min: 2,
    max: 10,
    step: 1,
  },
  {
    key: "ratio",
    label: "画面比例",
    control: "text",
    valueType: "string",
    default: "1280:720",
    placeholder: "1280:720",
    options: [
      { label: "横屏 1280:720", value: "1280:720" },
      { label: "竖屏 720:1280", value: "720:1280" },
      { label: "方形 1024:1024", value: "1024:1024" },
    ],
  },
];

const REST_VIDEO_COUNT: ModelParameterDescriptor = {
  key: "n",
  label: "数量",
  control: "number",
  valueType: "integer",
  default: 1,
  min: 1,
  max: 10,
  step: 1,
};

const controls = new Set(["select", "number", "text", "toggle", "dimensions"]);

/** True when `size` represents an exact WIDTHxHEIGHT constraint, not a K tier. */
export function isExactSizeParameterDescriptor(
  descriptor: ModelParameterDescriptor,
): boolean {
  if (descriptor.key !== "size") return false;
  if (descriptor.control === "dimensions" || descriptor.control === "text")
    return true;
  const concreteOptions = (descriptor.options ?? []).filter(
    (option) => String(option.value).toLowerCase() !== "auto",
  );
  return (
    concreteOptions.length > 0 &&
    concreteOptions.every((option) =>
      /^\d+x\d+$/iu.test(String(option.value).trim()),
    )
  );
}

function isParameterDescriptor(
  value: unknown,
): value is ModelParameterDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = value as Record<string, unknown>;
  return (
    typeof descriptor.key === "string" &&
    descriptor.key.length > 0 &&
    descriptor.key.length <= 128 &&
    typeof descriptor.label === "string" &&
    descriptor.label.length > 0 &&
    controls.has(String(descriptor.control))
  );
}

function operationsForNodeType(
  nodeType: GenerationNodeType,
): readonly ProviderOperation[] {
  return nodeType === "image-generation"
    ? ["image.generate", "image.edit"]
    : ["video.generate", "video.image-to-video"];
}

export function parameterDescriptorsFor(
  nodeType: GenerationNodeType,
  provider: string,
  model?: Pick<ModelDescriptor, "parameters" | "metadata"> | null,
): ModelParameterDescriptor[] {
  if (model?.metadata?.parameterControlsUnavailable === true) return [];
  const operations = operationsForNodeType(nodeType);
  const declared = (model?.parameters ?? [])
    .filter(isParameterDescriptor)
    .filter(
      (descriptor) =>
        !descriptor.operations?.length ||
        descriptor.operations.some((operation) =>
          operations.includes(operation),
        ),
    );
  if (declared.length > 0) {
    const fixedOutputCount = model?.metadata?.fixedOutputCount;
    return nodeType === "image-generation"
      ? declared.filter(
          (descriptor) =>
            descriptor.key !== "n" ||
            (fixedOutputCount !== 1 &&
              typeof descriptor.max === "number" &&
              descriptor.max > 1),
        )
      : declared;
  }
  if (nodeType === "image-generation") {
    const fallback = [...IMAGE_PARAMETERS];
    return model?.metadata?.fixedOutputCount === 1
      ? fallback.filter((descriptor) => descriptor.key !== "n")
      : provider === "openai" || provider === "fake"
        ? fallback
        : fallback.filter((descriptor) => descriptor.key !== "n");
  }
  return provider === "rest"
    ? [...VIDEO_PARAMETERS, REST_VIDEO_COUNT]
    : [...VIDEO_PARAMETERS];
}

/** Applies model-declared cross-field bounds without changing other models. */
export function parameterDescriptorsForValues(
  nodeType: GenerationNodeType,
  provider: string,
  model: Pick<ModelDescriptor, "parameters" | "metadata"> | null | undefined,
  parameters: Readonly<Record<string, unknown>>,
): ModelParameterDescriptor[] {
  const descriptors = parameterDescriptorsFor(nodeType, provider, model);
  const conditional = model?.metadata?.durationMaxByResolution;
  const resolution = parameters.resolution;
  if (
    !conditional ||
    typeof conditional !== "object" ||
    Array.isArray(conditional) ||
    typeof resolution !== "string"
  )
    return descriptors;
  const maximum = Number(
    (conditional as Readonly<Record<string, unknown>>)[resolution],
  );
  if (!Number.isFinite(maximum)) return descriptors;
  return descriptors.map((descriptor) =>
    descriptor.key === "duration"
      ? {
          ...descriptor,
          max: Math.min(descriptor.max ?? maximum, maximum),
        }
      : descriptor,
  );
}

export function modelDescriptorFromConnectionConfig(
  config: Readonly<Record<string, unknown>>,
  modelId?: string,
): ModelDescriptor | null {
  const candidates = modelDescriptorsFromConnectionConfig(config);
  return (
    candidates.find((model) => model.id === modelId) ??
    candidates.find((model) => model.isDefault === true) ??
    candidates[0] ??
    null
  );
}

export function modelDescriptorsFromConnectionConfig(
  config: Readonly<Record<string, unknown>>,
): ModelDescriptor[] {
  const savedCatalog = config.modelCatalogModels;
  if (Array.isArray(savedCatalog)) {
    const savedModels = savedCatalog.filter((model): model is ModelDescriptor =>
      Boolean(
        model &&
        typeof model === "object" &&
        !Array.isArray(model) &&
        typeof (model as Record<string, unknown>).id === "string" &&
        typeof (model as Record<string, unknown>).name === "string" &&
        Array.isArray((model as Record<string, unknown>).operations),
      ),
    );
    if (savedModels.length > 0) return savedModels;
  }
  const connector = config.connector;
  if (!connector || typeof connector !== "object" || Array.isArray(connector))
    return [];
  const models = (connector as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];
  return models.filter((model): model is ModelDescriptor =>
    Boolean(
      model &&
      typeof model === "object" &&
      !Array.isArray(model) &&
      typeof (model as Record<string, unknown>).id === "string" &&
      typeof (model as Record<string, unknown>).name === "string" &&
      Array.isArray((model as Record<string, unknown>).operations),
    ),
  );
}

/** Resolves obsolete saved model aliases to the documented API model IDs. */
export function modelDescriptorForSavedSelection(
  models: readonly ModelDescriptor[],
  savedModel: unknown,
  savedParameters?: Readonly<Record<string, unknown>>,
): ModelDescriptor | undefined {
  if (typeof savedModel !== "string" || !savedModel.trim()) return undefined;
  const normalizedModel = savedModel.trim();
  const exact = models.find((model) => model.id === normalizedModel);
  if (exact) return exact;

  // Older canvas builds exposed resolution as a fake Adobe model suffix
  // (`gpt-image-2::2k`). We-AI only accepts the real quality-specific model
  // IDs; resolution remains an independent `size` request parameter.
  const legacyAdobeVariant =
    /^gpt-image-2(?:-(low|medium|high))?::(1k|2k|4k)$/iu.exec(normalizedModel);
  const hasRealAdobeModels = models.some((model) =>
    /^gpt-image-2-(?:low|medium|high)$/u.test(model.id),
  );
  if (
    hasRealAdobeModels &&
    (legacyAdobeVariant || normalizedModel === "gpt-image-2")
  ) {
    const savedQuality = savedParameters?.quality;
    const quality =
      legacyAdobeVariant?.[1]?.toLowerCase() ??
      (typeof savedQuality === "string" &&
      ["low", "medium", "high"].includes(savedQuality.toLowerCase())
        ? savedQuality.toLowerCase()
        : "low");
    return (
      models.find((model) => model.id === `gpt-image-2-${quality}`) ??
      models.find((model) => model.isDefault) ??
      models.find((model) => model.id === "gpt-image-2-low")
    );
  }

  const canonicalGeminiModel = normalizedModel.replace(/-preview$/u, "");
  return canonicalGeminiModel !== normalizedModel
    ? models.find((model) => model.id === canonicalGeminiModel)
    : undefined;
}

/**
 * Resolves the saved model without replacing an explicit selection when a
 * transient catalog snapshot does not contain it. Catalogs can be refreshed
 * in multiple stages (saved snapshot first, live response second), so falling
 * back in that situation makes the model selector jump unexpectedly.
 */
export function modelDescriptorForSavedSelectionOrDefault(
  models: readonly ModelDescriptor[],
  savedModel: unknown,
  savedParameters?: Readonly<Record<string, unknown>>,
): ModelDescriptor | undefined {
  const saved = modelDescriptorForSavedSelection(
    models,
    savedModel,
    savedParameters,
  );
  if (saved) return saved;
  if (typeof savedModel === "string" && savedModel.trim()) return undefined;
  return models.find((model) => model.isDefault) ?? models[0];
}

export function modelDescriptorListsEqual(
  left: readonly ModelDescriptor[],
  right: readonly ModelDescriptor[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (model, index) => JSON.stringify(model) === JSON.stringify(right[index]),
    )
  );
}

export function parametersWithDefaults(
  descriptors: readonly ModelParameterDescriptor[],
  current: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const parameters = Object.fromEntries(
    descriptors.flatMap((descriptor) => {
      const currentValue = current[descriptor.key];
      const acceptsCurrentValue =
        currentValue === undefined ||
        descriptor.control !== "select" ||
        !descriptor.options?.length ||
        descriptor.options.some(
          (option) => String(option.value) === String(currentValue),
        );
      const value = acceptsCurrentValue
        ? (currentValue ?? descriptor.default)
        : descriptor.default;
      return value === undefined ? [] : [[descriptor.key, value]];
    }),
  );

  const savedResolutionTier =
    typeof current.size_tier === "string"
      ? current.size_tier.trim().toUpperCase()
      : "";
  const hasTieredDimensionControl = descriptors.some(
    (descriptor) =>
      descriptor.key === "size" &&
      descriptor.control === "dimensions" &&
      ["1K", "2K", "4K"].every((tier) =>
        descriptor.options?.some((option) =>
          option.label.toUpperCase().startsWith(tier),
        ),
      ),
  );
  if (hasTieredDimensionControl) {
    if (["1K", "2K", "4K"].includes(savedResolutionTier)) {
      parameters.size_tier = savedResolutionTier;
    } else {
      const sizeDescriptor = descriptors.find(
        (descriptor) =>
          descriptor.key === "size" && descriptor.control === "dimensions",
      );
      const hasAutomaticSize = sizeDescriptor?.options?.some(
        (option) => String(option.value).trim().toLowerCase() === "auto",
      );
      // Tiered exact-size models can still choose their aspect ratio from the
      // prompt/reference image. Keep the size value automatic while selecting
      // the highest documented tier as the default output resolution.
      if (
        hasAutomaticSize &&
        (current.size === undefined ||
          (typeof current.size === "string" &&
            current.size.trim().toLowerCase() === "auto")) &&
        current.size_tier === undefined
      ) {
        parameters.size = "auto";
        parameters.size_tier = "4K";
      }
    }
  }

  // Exact dimensions and an aspect ratio describe the same output constraint.
  // Resolution tiers such as 1K/2K/4K remain independent from aspect ratio.
  // Preserve whichever value was explicitly saved instead of reintroducing the
  // other field's descriptor default during model discovery or page reload.
  const hasSize = descriptors.some(isExactSizeParameterDescriptor);
  const hasAspectRatio = descriptors.some(
    (descriptor) => descriptor.key === "aspect_ratio",
  );
  if (hasSize && hasAspectRatio) {
    if (current.size !== undefined) delete parameters.aspect_ratio;
    else if (current.aspect_ratio !== undefined) delete parameters.size;
    else if (parameters.size !== undefined) delete parameters.aspect_ratio;
  }

  return parameters;
}

/**
 * Normalize persisted generation parameters against the selected model.
 * Older canvas snapshots may retain `n` after switching to a fixed-output
 * model, so an absent multi-output descriptor must remove it entirely.
 */
export function normalizedParametersForModel(
  nodeType: GenerationNodeType,
  provider: string,
  model: Pick<ModelDescriptor, "parameters" | "metadata"> | null | undefined,
  current: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const descriptors = parameterDescriptorsForValues(
    nodeType,
    provider,
    model,
    current,
  );
  const parameters = parametersWithDefaults(descriptors, current);
  if (model?.metadata?.clampNumericParameters === true) {
    for (const descriptor of descriptors) {
      const value = parameters[descriptor.key];
      const numeric =
        typeof value === "number"
          ? value
          : typeof value === "string" && value.trim()
            ? Number(value)
            : Number.NaN;
      if (!Number.isFinite(numeric)) continue;
      const integer =
        descriptor.valueType === "integer" ? Math.trunc(numeric) : numeric;
      parameters[descriptor.key] = Math.min(
        descriptor.max ?? Number.POSITIVE_INFINITY,
        Math.max(descriptor.min ?? Number.NEGATIVE_INFINITY, integer),
      );
    }
  }
  const countDescriptor = descriptors.find(
    (descriptor) => descriptor.key === "n",
  );
  if (!countDescriptor) {
    delete parameters.n;
    return parameters;
  }

  const minimum = Number.isFinite(countDescriptor.min)
    ? Math.ceil(countDescriptor.min!)
    : 1;
  const maximum = Number.isFinite(countDescriptor.max)
    ? Math.floor(countDescriptor.max!)
    : 10;
  const requested = Number(parameters.n);
  const fallback = Number(countDescriptor.default ?? minimum);
  const count = Number.isFinite(requested) ? Math.trunc(requested) : fallback;
  parameters.n = Math.min(maximum, Math.max(minimum, count));
  return parameters;
}

export function coerceParameterInput(
  descriptor: ModelParameterDescriptor,
  raw: string | boolean,
): ModelParameterValue | undefined {
  if (descriptor.control === "toggle") return Boolean(raw);
  if (typeof raw !== "string" || raw === "") return undefined;
  const option = descriptor.options?.find(
    (candidate) => String(candidate.value) === raw,
  );
  if (option) return option.value;
  if (
    descriptor.valueType === "number" ||
    descriptor.valueType === "integer" ||
    descriptor.control === "number"
  ) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return undefined;
    return descriptor.valueType === "integer" ? Math.trunc(value) : value;
  }
  if (descriptor.valueType === "boolean") return raw === "true";
  return raw;
}

export function setParameterValue(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
  value: ModelParameterValue | undefined,
): Record<string, unknown> {
  const next = { ...parameters };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}
