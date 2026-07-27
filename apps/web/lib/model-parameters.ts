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
    default: "auto",
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

const REST_IMAGE_COUNT: ModelParameterDescriptor = {
  key: "n",
  label: "生成张数",
  control: "number",
  valueType: "integer",
  default: 1,
  min: 1,
  max: 10,
  step: 1,
};

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

const controls = new Set([
  "select",
  "number",
  "text",
  "toggle",
  "dimensions",
]);

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
    if (
      nodeType === "image-generation" &&
      provider === "rest" &&
      fixedOutputCount !== 1 &&
      !declared.some((descriptor) => descriptor.key === "n")
    ) {
      return [...declared, REST_IMAGE_COUNT];
    }
    return declared;
  }
  if (nodeType === "image-generation") return [...IMAGE_PARAMETERS];
  return provider === "rest"
    ? [...VIDEO_PARAMETERS, REST_VIDEO_COUNT]
    : [...VIDEO_PARAMETERS];
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

export function parametersWithDefaults(
  descriptors: readonly ModelParameterDescriptor[],
  current: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    descriptors.flatMap((descriptor) => {
      const value = current[descriptor.key] ?? descriptor.default;
      return value === undefined ? [] : [[descriptor.key, value]];
    }),
  );
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
