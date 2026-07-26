import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
  RestConnectorConfig,
} from "@super-canvas/providers";

export const CANGYUAN_IMAGE_PRESET_ID = "cangyuan-gpt-image-2";
export const CANGYUAN_IMAGE_LEGACY_4K_PRESET_ID = "cangyuan-gpt-image-2-4k";
export const CANGYUAN_IMAGE_BASE_URL = "https://ai.cangyuansuanli.cn";

export const CANGYUAN_IMAGE_GROUP = "IMAGE";
export const CANGYUAN_VIDEO_GROUP = "VIDEO";
export const CANGYUAN_ALL_MODELS_GROUP = "全模型-无claude/gpt";
export const CANGYUAN_BACKUP_IMAGE_GROUP = "备用image线路";

export const CANGYUAN_IMAGE_MODEL = "gpt-image-2";
export const CANGYUAN_CODEX_IMAGE_MODEL = "codex-gpt-image-2-1k";
export const CANGYUAN_BANANA_2_MODEL = "gemini-banana-2.0";
export const CANGYUAN_BANANA_PRO_4K_MODEL = "gemini-banana-pro-4k";
export const CANGYUAN_IMAGE_DEFAULT_MODEL = CANGYUAN_IMAGE_MODEL;

export const CANGYUAN_IMAGE_1K_MODEL = "gpt-image-2-1k";
export const CANGYUAN_IMAGE_2K_MODEL = "gpt-image-2-2k";
// Retained for saved projects; this SKU is not in the current marketplace.
export const CANGYUAN_IMAGE_4K_MODEL = "gpt-image-2-4k";
export const CANGYUAN_NANO_BANANA_PRO_1K_MODEL = "nano-banana-pro-1k";
export const CANGYUAN_NANO_BANANA_PRO_2K_MODEL = "nano-banana-pro-2k";
export const CANGYUAN_NANO_BANANA_PRO_4K_MODEL = "nano-banana-pro-4k";
export const CANGYUAN_NANO_BANANA_2_1K_MODEL = "nano-banana2-1k";
export const CANGYUAN_NANO_BANANA_2_2K_MODEL = "nano-banana2-2k";
export const CANGYUAN_NANO_BANANA_2_4K_MODEL = "nano-banana2-4k";

export type CangyuanImageGroup =
  | typeof CANGYUAN_IMAGE_GROUP
  | typeof CANGYUAN_VIDEO_GROUP
  | typeof CANGYUAN_ALL_MODELS_GROUP
  | typeof CANGYUAN_BACKUP_IMAGE_GROUP;

export const CANGYUAN_IMAGE_GROUP_OPTIONS: readonly {
  value: CangyuanImageGroup;
  label: string;
}[] = [
  { value: CANGYUAN_IMAGE_GROUP, label: "IMAGE" },
  { value: CANGYUAN_VIDEO_GROUP, label: "VIDEO" },
  {
    value: CANGYUAN_ALL_MODELS_GROUP,
    label: "全模型-无claude/gpt",
  },
  { value: CANGYUAN_BACKUP_IMAGE_GROUP, label: "备用image线路" },
];

const IMAGE_OPERATIONS = ["image.generate", "image.edit"] as const;
const GENERATE_ONLY = ["image.generate"] as const;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const BASIC_SIZE_OPTIONS: readonly ModelParameterOption[] = [
  { label: "1:1", value: "1:1" },
  { label: "3:2", value: "3:2" },
  { label: "2:3", value: "2:3" },
  { label: "自动", value: "auto" },
];

const BANANA_RATIO_OPTIONS: readonly ModelParameterOption[] = [
  { label: "1:1", value: "1:1" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" },
  { label: "自动", value: "auto" },
];

const GPT_FIXED_RATIO_OPTIONS: readonly ModelParameterOption[] = [
  { label: "自动（跟随参考图）", value: "auto" },
  { label: "1:1", value: "1:1" },
  { label: "5:4", value: "5:4" },
  { label: "7:6", value: "7:6" },
  { label: "9:16", value: "9:16" },
  { label: "21:9", value: "21:9" },
  { label: "16:9", value: "16:9" },
  { label: "3:2", value: "3:2" },
  { label: "4:3", value: "4:3" },
  { label: "4:5", value: "4:5" },
  { label: "3:4", value: "3:4" },
  { label: "2:3", value: "2:3" },
];

const NANO_PRO_RATIO_OPTIONS: readonly ModelParameterOption[] = [
  { label: "自动（跟随参考图）", value: "auto" },
  { label: "1:1", value: "1:1" },
  { label: "5:4", value: "5:4" },
  { label: "9:16", value: "9:16" },
  { label: "21:9", value: "21:9" },
  { label: "16:9", value: "16:9" },
  { label: "3:2", value: "3:2" },
  { label: "4:3", value: "4:3" },
  { label: "4:5", value: "4:5" },
  { label: "3:4", value: "3:4" },
  { label: "2:3", value: "2:3" },
];

const NANO_2_RATIO_OPTIONS: readonly ModelParameterOption[] = [
  { label: "自动（跟随参考图）", value: "auto" },
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "1:8", value: "1:8" },
  { label: "1:4", value: "1:4" },
  { label: "4:1", value: "4:1" },
  { label: "8:1", value: "8:1" },
];

const sizeParameter = (defaultValue = "1:1"): ModelParameterDescriptor => ({
  key: "size",
  label: "画面比例",
  control: "select",
  valueType: "string",
  default: defaultValue,
  options: BASIC_SIZE_OPTIONS,
  operations: IMAGE_OPERATIONS,
});

const aspectRatioParameter = (
  options: readonly ModelParameterOption[],
  defaultValue = "16:9",
): ModelParameterDescriptor => ({
  key: "aspect_ratio",
  label: "画面比例",
  control: "select",
  valueType: "string",
  default: defaultValue,
  options,
  operations: IMAGE_OPERATIONS,
});

const dimensionsParameter = (): ModelParameterDescriptor => ({
  key: "size",
  label: "精确尺寸",
  control: "dimensions",
  valueType: "string",
  min: 16,
  max: 3840,
  step: 16,
  placeholder: "宽 x 高",
  description: "宽高须为 16 的倍数；设置后不再发送画面比例",
  operations: IMAGE_OPERATIONS,
});

const countParameter = (max: number): ModelParameterDescriptor => ({
  key: "n",
  label: "生成张数",
  control: "number",
  valueType: "integer",
  default: 1,
  min: 1,
  max,
  step: 1,
  operations: IMAGE_OPERATIONS,
});

const IMAGE_GROUP_MODELS: readonly ModelDescriptor[] = [
  {
    id: CANGYUAN_IMAGE_MODEL,
    name: "GPT Image 2（¥0.015/张）",
    description: "IMAGE 分组网页生图线路；稳定画幅为 1:1、3:2、2:3、auto",
    operations: GENERATE_ONLY,
    isDefault: true,
    parameters: [sizeParameter(), countParameter(10)],
    limits: { supportedMimeTypes: IMAGE_MIME_TYPES },
  },
  {
    id: CANGYUAN_IMAGE_1K_MODEL,
    name: "GPT Image 2 1K（¥0.025/张）",
    description: "固定 1K 计费档位；quality 不改变档位或价格",
    operations: IMAGE_OPERATIONS,
    metadata: { fixedOutputCount: 1 },
    parameters: [
      aspectRatioParameter(GPT_FIXED_RATIO_OPTIONS, "1:1"),
      dimensionsParameter(),
      {
        key: "quality",
        label: "质量",
        control: "select",
        valueType: "string",
        default: "medium",
        options: [
          { label: "低", value: "low" },
          { label: "中", value: "medium" },
          { label: "高", value: "high" },
        ],
        operations: IMAGE_OPERATIONS,
      },
    ],
    limits: { maxInputImages: 9, supportedMimeTypes: IMAGE_MIME_TYPES },
  },
  {
    id: CANGYUAN_IMAGE_2K_MODEL,
    name: "GPT Image 2 2K（¥0.05/张）",
    description: "固定 2K 计费档位；quality 不改变档位或价格",
    operations: IMAGE_OPERATIONS,
    metadata: { fixedOutputCount: 1 },
    parameters: [
      aspectRatioParameter(GPT_FIXED_RATIO_OPTIONS, "1:1"),
      dimensionsParameter(),
      {
        key: "quality",
        label: "质量",
        control: "select",
        valueType: "string",
        default: "medium",
        options: [
          { label: "低", value: "low" },
          { label: "中", value: "medium" },
          { label: "高", value: "high" },
        ],
        operations: IMAGE_OPERATIONS,
      },
    ],
    limits: { maxInputImages: 9, supportedMimeTypes: IMAGE_MIME_TYPES },
  },
  ...[
    [CANGYUAN_NANO_BANANA_PRO_1K_MODEL, "Nano Banana Pro 1K（¥0.08/张）"],
    [CANGYUAN_NANO_BANANA_PRO_2K_MODEL, "Nano Banana Pro 2K（¥0.10/张）"],
    [CANGYUAN_NANO_BANANA_PRO_4K_MODEL, "Nano Banana Pro 4K（¥0.149/张）"],
  ].map(([id, name], index): ModelDescriptor => ({
    id: id!,
    name: name!,
    description: `Nano Banana Pro 固定 ${["1K", "2K", "4K"][index]} 档位`,
    operations: IMAGE_OPERATIONS,
    metadata: { fixedOutputCount: 1 },
    parameters: [aspectRatioParameter(NANO_PRO_RATIO_OPTIONS)],
    limits: { maxInputImages: 9, supportedMimeTypes: IMAGE_MIME_TYPES },
  })),
  ...[
    [CANGYUAN_NANO_BANANA_2_1K_MODEL, "Nano Banana 2 1K（¥0.059/张）"],
    [CANGYUAN_NANO_BANANA_2_2K_MODEL, "Nano Banana 2 2K（¥0.08/张）"],
    [CANGYUAN_NANO_BANANA_2_4K_MODEL, "Nano Banana 2 4K（¥0.12/张）"],
  ].map(([id, name], index): ModelDescriptor => ({
    id: id!,
    name: name!,
    description: `Nano Banana 2 固定 ${["1K", "2K", "4K"][index]} 档位`,
    operations: IMAGE_OPERATIONS,
    metadata: { fixedOutputCount: 1 },
    parameters: [aspectRatioParameter(NANO_2_RATIO_OPTIONS)],
    limits: { maxInputImages: 9, supportedMimeTypes: IMAGE_MIME_TYPES },
  })),
];

const BACKUP_GROUP_MODELS: readonly ModelDescriptor[] = [
  {
    id: CANGYUAN_CODEX_IMAGE_MODEL,
    name: "Codex GPT Image 2 1K/2K（¥0.07/张）",
    description: "备用image线路同步模型；quality low=1K、medium=2K",
    operations: GENERATE_ONLY,
    isDefault: true,
    parameters: [
      sizeParameter(),
      {
        key: "quality",
        label: "分辨率",
        control: "select",
        valueType: "string",
        default: "low",
        options: [
          { label: "1K", value: "low" },
          { label: "2K", value: "medium" },
        ],
        operations: GENERATE_ONLY,
      },
      countParameter(4),
    ],
    limits: { supportedMimeTypes: IMAGE_MIME_TYPES },
  },
  {
    id: CANGYUAN_BANANA_2_MODEL,
    name: "Gemini Banana 2.0（¥0.12/张）",
    description: "备用image线路模型；模型广场当前未提供单模型参数文档",
    operations: GENERATE_ONLY,
    parameters: [aspectRatioParameter(BANANA_RATIO_OPTIONS), countParameter(1)],
    limits: { supportedMimeTypes: IMAGE_MIME_TYPES },
  },
  {
    id: CANGYUAN_BANANA_PRO_4K_MODEL,
    name: "Gemini Banana Pro 4K（¥0.18/张）",
    description: "备用image线路同步模型，支持最高 4K 与 JSON 参考图",
    operations: IMAGE_OPERATIONS,
    metadata: { fixedOutputCount: 1 },
    parameters: [
      aspectRatioParameter(BANANA_RATIO_OPTIONS),
      {
        key: "quality",
        label: "分辨率",
        control: "select",
        valueType: "string",
        default: "high",
        options: [
          { label: "自动", value: "auto" },
          { label: "1K", value: "low" },
          { label: "2K", value: "medium" },
          { label: "4K", value: "high" },
        ],
        operations: IMAGE_OPERATIONS,
      },
    ],
    limits: {
      maxInputImages: 9,
      supportedMimeTypes: IMAGE_MIME_TYPES,
    },
  },
];

const BASE_CONNECTOR = {
  auth: { type: "bearer" as const },
  restrictModels: true,
  allowedHosts: [
    "ai.cangyuansuanli.cn",
    "vip-api.cangyuansuanli.cn",
    "direct-api.cangyuansuanli.cn",
  ],
  test: {
    path: "/v1/models",
    method: "GET" as const,
    bodyMode: "none" as const,
  },
  statusMap: {
    queued: "queued" as const,
    pending: "queued" as const,
    in_progress: "running" as const,
    running: "running" as const,
    processing: "running" as const,
    completed: "succeeded" as const,
    succeeded: "succeeded" as const,
    failed: "failed" as const,
    error: "failed" as const,
    cancelled: "cancelled" as const,
    canceled: "cancelled" as const,
  },
};

const COMMON_SUBMIT_MAPPINGS = [
  { source: { kind: "request" as const, path: "$.model" }, target: "/model" },
  {
    source: { kind: "request" as const, path: "$.prompt" },
    target: "/prompt",
  },
  {
    source: { kind: "request" as const, path: "$.parameters.size" },
    target: "/size",
    omitIfUndefined: true,
  },
  {
    source: { kind: "request" as const, path: "$.parameters.quality" },
    target: "/quality",
    omitIfUndefined: true,
  },
  {
    source: {
      kind: "request" as const,
      path: "$.parameters.aspect_ratio",
    },
    target: "/aspect_ratio",
    omitIfUndefined: true,
  },
  {
    source: { kind: "request" as const, path: "$.parameters.n" },
    target: "/n",
    omitIfUndefined: true,
  },
] as const;

export const CANGYUAN_IMAGE_CONNECTOR: RestConnectorConfig = {
  ...BASE_CONNECTOR,
  models: IMAGE_GROUP_MODELS,
  pollIntervalMs: 5_000,
  submit: {
    path: "/v1/images/generations",
    method: "POST",
    bodyMode: "json",
    headers: { Connection: "close" },
    template: { async: true, n: 1 },
    mappings: [
      ...COMMON_SUBMIT_MAPPINGS,
      {
        source: { kind: "assets", assetKind: "image" },
        target: "/images",
        omitIfEmpty: true,
      },
    ],
    response: {
      taskIdPath: "$.id",
      statusPath: "$.status",
      errorPath: "$.error.message",
      progressPath: "$.progress",
    },
  },
  poll: {
    path: "/v1/images/generations/{taskId}",
    method: "GET",
    bodyMode: "none",
    headers: { Connection: "close" },
    response: {
      taskIdPath: "$.id",
      statusPath: "$.status",
      errorPath: "$.error.message",
      progressPath: "$.progress",
    },
  },
  output: {
    path: "$.data",
    kind: "image",
    urlPath: "url",
    base64Path: "b64_json",
    defaultMimeType: "image/png",
  },
};

export const CANGYUAN_BACKUP_IMAGE_CONNECTOR: RestConnectorConfig = {
  ...BASE_CONNECTOR,
  models: BACKUP_GROUP_MODELS,
  submit: {
    path: "/v1/images/generations",
    method: "POST",
    bodyMode: "json",
    headers: { Connection: "close" },
    template: { n: 1 },
    mappings: [
      ...COMMON_SUBMIT_MAPPINGS,
      {
        source: { kind: "assets", assetKind: "image" },
        target: "/images",
        omitIfEmpty: true,
      },
    ],
  },
  output: {
    path: "$.data",
    kind: "image",
    urlPath: "url",
    base64Path: "b64_json",
    defaultMimeType: "image/png",
  },
};

export function isCangyuanImagePreset(value: unknown): boolean {
  return (
    value === CANGYUAN_IMAGE_PRESET_ID ||
    value === CANGYUAN_IMAGE_LEGACY_4K_PRESET_ID
  );
}

export function isCangyuanImageGroup(
  value: unknown,
): value is CangyuanImageGroup {
  return CANGYUAN_IMAGE_GROUP_OPTIONS.some((option) => option.value === value);
}

export function cangyuanImageConnectorForGroup(
  group: CangyuanImageGroup,
): RestConnectorConfig {
  return structuredClone(
    group === CANGYUAN_BACKUP_IMAGE_GROUP
      ? CANGYUAN_BACKUP_IMAGE_CONNECTOR
      : CANGYUAN_IMAGE_CONNECTOR,
  );
}

export function cangyuanDefaultModelForGroup(
  group: CangyuanImageGroup,
): string {
  if (group === CANGYUAN_VIDEO_GROUP) return "sd5-seedance-2.0";
  return group === CANGYUAN_BACKUP_IMAGE_GROUP
    ? CANGYUAN_CODEX_IMAGE_MODEL
    : CANGYUAN_IMAGE_MODEL;
}

export function cangyuanImageConnectionConfig(
  modelGroup: CangyuanImageGroup = CANGYUAN_IMAGE_GROUP,
) {
  return {
    preset: CANGYUAN_IMAGE_PRESET_ID,
    modelGroup,
    baseUrl: CANGYUAN_IMAGE_BASE_URL,
    defaultModel: cangyuanDefaultModelForGroup(modelGroup),
    connector: cangyuanImageConnectorForGroup(modelGroup),
  };
}

// Retain the old exports for saved integrations and downstream imports.
export const CANGYUAN_IMAGE_4K_PRESET_ID = CANGYUAN_IMAGE_LEGACY_4K_PRESET_ID;
export const CANGYUAN_IMAGE_4K_BASE_URL = CANGYUAN_IMAGE_BASE_URL;
export const CANGYUAN_IMAGE_4K_CONNECTOR = CANGYUAN_IMAGE_CONNECTOR;
export function cangyuanImage4kConnectionConfig() {
  return cangyuanImageConnectionConfig();
}
