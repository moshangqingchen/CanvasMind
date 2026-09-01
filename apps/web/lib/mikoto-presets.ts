import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
  RestConnectorConfig,
  RestModelConnectorOverride,
  RestRequestMapping,
} from "@super-canvas/providers";

export const MIKOTO_PRESET_ID = "mikoto-pro";
export const MIKOTO_SUPPLIER_KEY = "mikoto";
export const MIKOTO_BASE_URL = "https://api.mikoto.vip";
export const MIKOTO_MODEL_GROUP = "图片与视频";
export const MIKOTO_DEFAULT_MODEL = "gpt-image-2";

export const MIKOTO_IMAGE_GROUP = "OpenAI 图片";
export const MIKOTO_IMAGE_1K_GROUP = "生图（1k）";
// MikotoPro currently exposes this group with a missing closing bracket in
// the dashboard; keep the exact upstream id while rendering a readable label.
export const MIKOTO_IMAGE_4K_GROUP = "生图（原生4k";
export const MIKOTO_IMAGE_4K_GROUP_ALIAS = "生图（原生4k）";
export const MIKOTO_GROK_GROUP = "grok生图";
/** Canonical model id returned by MikotoPro's live /v1/models catalog. */
export const MIKOTO_GROK_MODEL = "grok-imagine-image-2.0";
export const MIKOTO_GEMINI_GROUP = "Gemini 原生图片";
export const MIKOTO_GEMINI_31_GROUP = "gemini-3.1-flash-image-preview";
export const MIKOTO_GEMINI_3_PRO_GROUP = "gemini-3-pro-image-preview";
// These are the exact group ids exposed by the MikotoPro API-key selector.
// Short names are accepted only as compatibility aliases for old imports.
export const MIKOTO_BANANA_2_GROUP = "香蕉2 1k2k";
export const MIKOTO_BANANA_PRO_GROUP = "香蕉pro 1k2k";
export const MIKOTO_BANANA_2_GROUP_ALIAS = "香蕉2";
export const MIKOTO_BANANA_PRO_GROUP_ALIAS = "香蕉pro";
export const MIKOTO_GEMINI_25_GROUP = "gemini-2.5-flash-image";
export const MIKOTO_BANANA_25_GROUP = "香蕉2.5flash无4k";
export const MIKOTO_SEEDANCE_GROUP = "Seedance 视频";
export const MIKOTO_KLING_GROUP = "Kling 视频";
export const MIKOTO_SORA_GROUP = "Sora 视频";

export const MIKOTO_GROUP_IDS = [
  MIKOTO_IMAGE_GROUP,
  MIKOTO_IMAGE_1K_GROUP,
  MIKOTO_IMAGE_4K_GROUP,
  MIKOTO_GROK_GROUP,
  MIKOTO_GEMINI_GROUP,
  MIKOTO_GEMINI_31_GROUP,
  MIKOTO_GEMINI_3_PRO_GROUP,
  MIKOTO_BANANA_2_GROUP,
  MIKOTO_BANANA_PRO_GROUP,
  MIKOTO_GEMINI_25_GROUP,
  MIKOTO_BANANA_25_GROUP,
  MIKOTO_SEEDANCE_GROUP,
  MIKOTO_KLING_GROUP,
  MIKOTO_SORA_GROUP,
] as const;

export type MikotoGroupId = (typeof MIKOTO_GROUP_IDS)[number];

export interface MikotoGroup {
  readonly id: MikotoGroupId;
  readonly label: string;
  readonly description: string;
  readonly defaultModel: string;
  readonly models: readonly ModelDescriptor[];
  readonly provider: "rest" | "weai";
  readonly protocol?: "gemini-generate-content";
}

export const MIKOTO_SEEDANCE_MODELS = [
  "seedance-2.0-1080p",
  "seedance-2.0-720p",
  "seedance-fast-480p",
  "seedance-fast-720p",
] as const;

export const MIKOTO_KLING_MODELS = ["kling-video", "kling-omni-video"] as const;

const IMAGE_OPERATIONS = ["image.generate", "image.edit"] as const;
const VIDEO_OPERATIONS = ["video.generate", "video.image-to-video"] as const;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const mikotoSnapshotPrice = (
  kind: "per-image" | "per-second" | "per-request",
  unitAmount: number,
  checkedAt = "2026-08-28T00:00:00.000Z",
) => ({
  kind,
  currency: "USD",
  unitAmount,
  sourceUrl: MIKOTO_BASE_URL,
  checkedAt,
  confidence: "snapshot" as const,
});

const IMAGE_SIZE_OPTIONS: readonly ModelParameterOption[] = [
  { label: "自动", value: "auto" },
  { label: "1K 方图 · 1024×1024", value: "1024x1024" },
  { label: "2K 方图 · 1440×1440", value: "1440x1440" },
  { label: "2K 横图 · 2560×1440", value: "2560x1440" },
  { label: "2K 竖图 · 1152×2048", value: "1152x2048" },
  { label: "2K 4:3 · 1920×1440", value: "1920x1440" },
  { label: "2K 3:4 · 1440×1920", value: "1440x1920" },
  { label: "2K 3:2 · 2160×1440", value: "2160x1440" },
  { label: "2K 2:3 · 1440×2160", value: "1440x2160" },
  { label: "2K 21:9 · 2560×1097", value: "2560x1097" },
  { label: "4K 方图 · 2160×2160", value: "2160x2160" },
  { label: "4K 横图 · 3840×2160", value: "3840x2160" },
  { label: "4K 竖图 · 2160×3840", value: "2160x3840" },
  { label: "4K 4:3 · 2880×2160", value: "2880x2160" },
  { label: "4K 3:4 · 2160×2880", value: "2160x2880" },
  { label: "4K 3:2 · 3240×2160", value: "3240x2160" },
  { label: "4K 2:3 · 2160×3240", value: "2160x3240" },
  { label: "4K 21:9 · 3840×1646", value: "3840x1646" },
];

const IMAGE_1K_SIZE_OPTIONS: readonly ModelParameterOption[] = [
  { label: "1K 方图 · 1024×1024", value: "1024x1024" },
];

const IMAGE_4K_SIZE_OPTIONS: readonly ModelParameterOption[] = [
  { label: "4K 方图 · 2160×2160", value: "2160x2160" },
  { label: "4K 横图 · 3840×2160", value: "3840x2160" },
  { label: "4K 竖图 · 2160×3840", value: "2160x3840" },
  { label: "4K 4:3 · 2880×2160", value: "2880x2160" },
  { label: "4K 3:4 · 2160×2880", value: "2160x2880" },
  { label: "4K 3:2 · 3240×2160", value: "3240x2160" },
  { label: "4K 2:3 · 2160×3240", value: "2160x3240" },
  { label: "4K 21:9 · 3840×1646", value: "3840x1646" },
];

const IMAGE_GROK_SIZE_OPTIONS: readonly ModelParameterOption[] = [
  { label: "自动", value: "auto" },
  { label: "标准方图 · 1024×1024", value: "1024x1024" },
  { label: "2K 方图 · 1440×1440", value: "1440x1440" },
  { label: "2K 横图 · 2560×1440", value: "2560x1440" },
  { label: "2K 竖图 · 1152×2048", value: "1152x2048" },
  { label: "2K 4:3 · 1920×1440", value: "1920x1440" },
  { label: "2K 3:4 · 1440×1920", value: "1440x1920" },
  { label: "2K 3:2 · 2160×1440", value: "2160x1440" },
  { label: "2K 2:3 · 1440×2160", value: "1440x2160" },
  { label: "2K 21:9 · 2560×1097", value: "2560x1097" },
];

function imageParametersForSizes(
  options: readonly ModelParameterOption[],
  description: string,
): readonly ModelParameterDescriptor[] {
  return imageParameters.map((parameter) =>
    parameter.key === "size"
      ? {
          ...parameter,
          options,
          default: options[0]?.value ?? parameter.default,
          description,
        }
      : parameter,
  );
}

const VIDEO_RATIO_OPTIONS: readonly ModelParameterOption[] = [
  { label: "16:9 横屏", value: "16:9" },
  { label: "9:16 竖屏", value: "9:16" },
  { label: "1:1 方形", value: "1:1" },
  { label: "4:3 横屏", value: "4:3" },
  { label: "3:4 竖屏", value: "3:4" },
];

const KLING_RATIO_OPTIONS: readonly ModelParameterOption[] = [
  { label: "16:9 横屏", value: "16:9" },
  { label: "9:16 竖屏", value: "9:16" },
];

const imageParameters: readonly ModelParameterDescriptor[] = [
  {
    key: "size",
    label: "输出尺寸",
    control: "dimensions",
    valueType: "string",
    default: "auto",
    min: 256,
    max: 3840,
    step: 1,
    options: IMAGE_SIZE_OPTIONS,
    description:
      "按 MikotoPro 文档直接发送精确宽高；内置文档列出的 1K/2K/4K 常用尺寸。2026-08-13 实测 4K 3:2、2:3、21:9 会被上游分别对齐为 3232×2160、2160×3232、3840×1648，其他基础比例与请求像素一致。",
    operations: IMAGE_OPERATIONS,
  },
  {
    key: "quality",
    label: "画质",
    control: "select",
    valueType: "string",
    default: "high",
    options: [
      { label: "自动", value: "auto" },
      { label: "高", value: "high" },
    ],
    operations: IMAGE_OPERATIONS,
  },
];

const videoParameters: readonly ModelParameterDescriptor[] = [
  {
    key: "duration",
    label: "时长（秒）",
    control: "number",
    valueType: "integer",
    default: 4,
    min: 4,
    max: 15,
    step: 1,
    operations: VIDEO_OPERATIONS,
  },
  {
    key: "aspect_ratio",
    label: "画面比例",
    control: "select",
    valueType: "string",
    default: "16:9",
    options: VIDEO_RATIO_OPTIONS,
    operations: VIDEO_OPERATIONS,
  },
  {
    key: "generate_audio",
    label: "生成声音",
    control: "toggle",
    valueType: "boolean",
    default: true,
    operations: VIDEO_OPERATIONS,
  },
];

const klingParameters: readonly ModelParameterDescriptor[] = [
  {
    key: "duration",
    label: "时长（秒）",
    control: "select",
    valueType: "integer",
    default: 5,
    options: [5, 10, 15].map((value) => ({
      label: `${value} 秒`,
      value,
    })),
    operations: VIDEO_OPERATIONS,
  },
  {
    key: "aspect_ratio",
    label: "画面比例",
    control: "select",
    valueType: "string",
    default: "16:9",
    options: KLING_RATIO_OPTIONS,
    operations: VIDEO_OPERATIONS,
  },
  {
    key: "resolution",
    label: "清晰度",
    control: "select",
    valueType: "string",
    default: "720p",
    options: [
      { label: "720p", value: "720p" },
      { label: "1080p", value: "1080p" },
    ],
    operations: VIDEO_OPERATIONS,
  },
];

const geminiParameters: readonly ModelParameterDescriptor[] = [
  {
    key: "image_size",
    label: "输出分辨率",
    control: "select",
    valueType: "string",
    default: "4K",
    options: [
      { label: "1K", value: "1K" },
      { label: "2K", value: "2K" },
      { label: "4K", value: "4K" },
    ],
    operations: IMAGE_OPERATIONS,
  },
  {
    key: "aspect_ratio",
    label: "画面比例",
    control: "select",
    valueType: "string",
    default: "auto",
    options: [
      { label: "自动", value: "auto" },
      ...["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].map((value) => ({
        label: value,
        value,
      })),
    ],
    operations: IMAGE_OPERATIONS,
  },
  {
    key: "n",
    label: "生成张数",
    control: "number",
    valueType: "integer",
    default: 1,
    min: 1,
    max: 1,
    step: 1,
    operations: IMAGE_OPERATIONS,
  },
];

const soraParameters: readonly ModelParameterDescriptor[] = [
  {
    key: "duration",
    label: "时长（秒）",
    control: "number",
    valueType: "integer",
    default: 8,
    min: 4,
    max: 15,
    step: 1,
    operations: VIDEO_OPERATIONS,
  },
  {
    key: "aspect_ratio",
    label: "画面比例",
    control: "select",
    valueType: "string",
    default: "16:9",
    options: [
      { label: "16:9 横屏", value: "16:9" },
      { label: "9:16 竖屏", value: "9:16" },
      { label: "4:3 横屏", value: "4:3" },
      { label: "3:4 竖屏", value: "3:4" },
      { label: "1:1 方形", value: "1:1" },
      { label: "21:9 超宽", value: "21:9" },
    ],
    operations: VIDEO_OPERATIONS,
  },
  {
    key: "resolution",
    label: "清晰度",
    control: "select",
    valueType: "string",
    default: "720p",
    options: [{ label: "720p", value: "720p" }],
    operations: VIDEO_OPERATIONS,
  },
  {
    key: "reference_mode",
    label: "参考模式",
    control: "select",
    valueType: "string",
    default: "auto",
    options: [
      { label: "自动", value: "auto" },
      { label: "首帧", value: "start_frame" },
      { label: "首尾帧", value: "start_end" },
    ],
    operations: VIDEO_OPERATIONS,
  },
];

const MIKOTO_GEMINI_MODELS: readonly ModelDescriptor[] = [
  {
    id: "gemini-3.1-flash-image-preview",
    name: "Gemini 3.1 Flash Image Preview（$0.08/张）",
    description:
      "MikotoPro Gemini 原生生图模型；适合常规文生图，使用 generateContent 接口。",
    operations: IMAGE_OPERATIONS,
    inputKinds: ["text", "image", "image[]"],
    outputKinds: ["image"],
    isDefault: true,
    parameters: geminiParameters,
    pricing: mikotoSnapshotPrice("per-image", 0.08),
    metadata: { fixedOutputCount: 1, modality: "image" },
    limits: {
      supportedMimeTypes: IMAGE_MIME_TYPES,
    },
  },
  {
    id: "gemini-3-pro-image-preview",
    name: "Gemini 3 Pro Image Preview（$0.12/张）",
    description: "MikotoPro Gemini 原生复杂生图模型；适合图生图和多图融合。",
    operations: IMAGE_OPERATIONS,
    inputKinds: ["text", "image", "image[]"],
    outputKinds: ["image"],
    parameters: geminiParameters,
    pricing: mikotoSnapshotPrice("per-image", 0.12),
    metadata: { fixedOutputCount: 1, modality: "image" },
    limits: {
      supportedMimeTypes: IMAGE_MIME_TYPES,
    },
  },
];

const MIKOTO_GROK_MODELS: readonly ModelDescriptor[] = [
  {
    id: MIKOTO_GROK_MODEL,
    name: "Grok Imagine Image（$0.02/张）",
    description:
      "MikotoPro Grok Imagine 2.0 生图分组；使用 OpenAI Images 兼容异步接口，按当前 Key 分组计费。",
    operations: IMAGE_OPERATIONS,
    inputKinds: ["text", "image", "image[]"],
    outputKinds: ["image"],
    isDefault: true,
    parameters: imageParametersForSizes(
      IMAGE_GROK_SIZE_OPTIONS,
      "按 MikotoPro 文档发送真实宽高；Grok 上游可能将请求尺寸对齐为实际输出尺寸",
    ),
    pricing: mikotoSnapshotPrice("per-image", 0.02),
    metadata: { fixedOutputCount: 1, modality: "image" },
    limits: { maxInputImages: 9, supportedMimeTypes: IMAGE_MIME_TYPES },
  },
];

const MIKOTO_SORA_MODELS: readonly ModelDescriptor[] = [
  {
    id: "sora-v3-pro",
    name: "Sora V3 Pro（$0.35/秒）",
    description:
      "MikotoPro Sora 异步视频模型；支持 4–15 秒、720p、图片/视频/音频参考素材。",
    operations: VIDEO_OPERATIONS,
    inputKinds: [
      "text",
      "image",
      "image[]",
      "video",
      "video[]",
      "audio",
      "audio[]",
    ],
    outputKinds: ["video"],
    isDefault: true,
    parameters: soraParameters,
    pricing: mikotoSnapshotPrice("per-second", 0.35),
    metadata: {
      modality: "video",
      requiresImageWithAudio: true,
      pricingCapturedAt: "2026-08-28",
    },
    limits: {
      maxInputImages: 9,
      maxInputVideos: 3,
      maxInputAudios: 3,
      maxInputAssets: 12,
      supportedMimeTypes: [
        ...IMAGE_MIME_TYPES,
        "video/mp4",
        "video/quicktime",
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
      ],
    },
  },
];

const videoModel = (
  id: (typeof MIKOTO_SEEDANCE_MODELS)[number],
  resolution: string,
  price: number,
): ModelDescriptor => ({
  id,
  name: `${id}（$${price.toFixed(2)}/秒）`,
  description: `${resolution} Seedance 视频模型；支持 4–15 秒、参考图片、视频和音频。`,
  operations: VIDEO_OPERATIONS,
  inputKinds: [
    "text",
    "image",
    "image[]",
    "video",
    "video[]",
    "audio",
    "audio[]",
  ],
  outputKinds: ["video"],
  parameters: videoParameters,
  pricing: mikotoSnapshotPrice("per-second", price, "2026-08-13T00:00:00.000Z"),
  metadata: {
    modality: "video",
    supportsFirstLastFrames: true,
    allowFrameMediaMix: true,
    pricingCapturedAt: "2026-08-13",
  },
  limits: {
    maxInputImages: 9,
    maxInputVideos: 3,
    maxInputAudios: 3,
  },
});

const klingVideoModel = (
  id: (typeof MIKOTO_KLING_MODELS)[number],
  price: number,
  maxInputImages: number,
): ModelDescriptor => ({
  id,
  name: `${id}（$${price.toFixed(2)}/次）`,
  description:
    id === "kling-video"
      ? "Kling 文生视频、首帧或首尾帧生成；支持 5/10/15 秒和 720p/1080p。"
      : "Kling Omni 多主体、多元素参考生成；最多支持 3 张参考图。",
  operations: VIDEO_OPERATIONS,
  inputKinds: ["text", "image", "image[]"],
  outputKinds: ["video"],
  parameters: klingParameters,
  pricing: mikotoSnapshotPrice(
    "per-request",
    price,
    "2026-08-13T00:00:00.000Z",
  ),
  metadata: {
    modality: "video",
    supportsFirstLastFrames: id === "kling-video",
    pricingCapturedAt: "2026-08-13",
  },
  limits: { maxInputImages, maxInputVideos: 0, maxInputAudios: 0 },
});

export const MIKOTO_MODELS: readonly ModelDescriptor[] = [
  {
    id: MIKOTO_DEFAULT_MODEL,
    name: "GPT Image 2（原生4K组 $0.08/张）",
    description:
      "MikotoPro OpenAI Images 兼容模型；当前原生4K密钥分组全部尺寸 $0.08/张，1K 专用分组为 $0.02/张；支持文生图、图片编辑和精确 2K/4K 尺寸。",
    operations: IMAGE_OPERATIONS,
    inputKinds: ["text", "image", "image[]"],
    outputKinds: ["image"],
    isDefault: true,
    metadata: {
      fixedOutputCount: 1,
      modality: "image",
      pricingCapturedAt: "2026-08-13",
      tested4KHighAt: "2026-08-13",
    },
    pricing: mikotoSnapshotPrice("per-image", 0.08, "2026-08-13T00:00:00.000Z"),
    parameters: imageParameters,
    limits: {
      supportedMimeTypes: IMAGE_MIME_TYPES,
    },
  },
  videoModel("seedance-2.0-1080p", "1080p", 0.35),
  videoModel("seedance-2.0-720p", "720p", 0.25),
  videoModel("seedance-fast-480p", "480p", 0.15),
  videoModel("seedance-fast-720p", "720p", 0.2),
  klingVideoModel("kling-video", 0.7, 2),
  klingVideoModel("kling-omni-video", 1, 3),
  ...MIKOTO_GROK_MODELS,
  ...MIKOTO_SORA_MODELS,
];

const MIKOTO_GEMINI_1K_2K_SIZES: readonly ModelParameterOption[] = [
  { label: "1K", value: "1K" },
  { label: "2K", value: "2K" },
];

const MIKOTO_GEMINI_1K_2K_PARAMETERS: readonly ModelParameterDescriptor[] =
  geminiParameters.map((parameter) =>
    parameter.key === "image_size"
      ? {
          ...parameter,
          options: MIKOTO_GEMINI_1K_2K_SIZES,
          default: "2K",
        }
      : parameter,
  );

function mikotoGeminiModels(
  modelIds: readonly string[],
  sizes: readonly ModelParameterOption[] = [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" },
  ],
): readonly ModelDescriptor[] {
  return modelIds.flatMap((id) => {
    const model = MIKOTO_GEMINI_MODELS.find((candidate) => candidate.id === id);
    if (!model) return [];
    return [
      {
        ...model,
        parameters: model.parameters?.map((parameter) =>
          parameter.key === "image_size"
            ? {
                ...parameter,
                options: sizes,
                default: sizes.at(-1)?.value ?? parameter.default,
              }
            : parameter,
        ),
      },
    ];
  });
}

function mikotoImageModel(
  options: readonly ModelParameterOption[],
  name: string,
  description: string,
  price: number,
): ModelDescriptor {
  const base = MIKOTO_MODELS.find(
    (model) => model.id === MIKOTO_DEFAULT_MODEL,
  )!;
  return {
    ...base,
    name,
    description,
    pricing: mikotoSnapshotPrice(
      "per-image",
      price,
      "2026-08-13T00:00:00.000Z",
    ),
    parameters: imageParametersForSizes(options, description),
  };
}

const MIKOTO_IMAGE_1K_MODELS: readonly ModelDescriptor[] = [
  mikotoImageModel(
    IMAGE_1K_SIZE_OPTIONS,
    "GPT Image 2（1K · $0.02/张）",
    "MikotoPro 生图（1k）分组；仅开放 1K 方图，避免误选 2K/4K 尺寸。",
    0.02,
  ),
];

const MIKOTO_IMAGE_4K_MODELS: readonly ModelDescriptor[] = [
  mikotoImageModel(
    IMAGE_4K_SIZE_OPTIONS,
    "GPT Image 2（原生4K · $0.08/张）",
    "MikotoPro 生图（原生4k）分组；按文档仅展示原生 4K 尺寸并默认高画质。",
    0.08,
  ),
];

const imageMappings: readonly RestRequestMapping[] = [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  {
    target: "/size",
    source: { kind: "request", path: "$.parameters.size" },
    omitIfUndefined: true,
  },
  {
    target: "/quality",
    source: { kind: "request", path: "$.parameters.quality" },
    omitIfUndefined: true,
  },
  {
    target: "/aspect_ratio",
    source: { kind: "request", path: "$.parameters.aspect_ratio" },
    omitIfUndefined: true,
  },
];

const seedanceVideoMappings: readonly RestRequestMapping[] = [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  {
    target: "/duration",
    source: { kind: "request", path: "$.parameters.duration" },
    omitIfUndefined: true,
  },
  {
    target: "/aspect_ratio",
    source: { kind: "request", path: "$.parameters.aspect_ratio" },
    omitIfUndefined: true,
  },
  {
    target: "/generate_audio",
    source: { kind: "request", path: "$.parameters.generate_audio" },
    omitIfUndefined: true,
  },
  {
    target: "/reference_mode",
    source: {
      kind: "assetMode",
      frameValue: "frame",
      referenceValue: "media",
      referenceThreshold: 3,
    },
  },
  {
    target: "/images",
    source: { kind: "assets", assetKind: "image" },
    omitIfEmpty: true,
  },
  {
    target: "/referenceVideos",
    source: { kind: "assets", assetKind: "video" },
    omitIfEmpty: true,
  },
  {
    target: "/referenceAudios",
    source: { kind: "assets", assetKind: "audio" },
    omitIfEmpty: true,
  },
];

const videoOutput = {
  path: "$.content_url",
  fallbackPaths: [
    "$.url",
    "$.result_url",
    "$.video_url",
    "$.media_url",
    "$.data.content_url",
    "$.data.url",
    "$.data.result_url",
    "$.data.video_url",
    "$.data.media_url",
  ],
  kind: "video" as const,
  defaultMimeType: "video/mp4",
};

const seedanceVideoTransport: RestModelConnectorOverride = {
  pollIntervalMs: 4_000,
  submit: {
    path: "/v1/videos",
    method: "POST",
    bodyMode: "json",
    mappings: seedanceVideoMappings,
    response: {
      taskIdPath: "$.id",
      statusPath: "$.status",
      errorPath: "$.error.message",
    },
  },
  poll: {
    path: "/v1/videos/{taskId}",
    method: "GET",
    bodyMode: "none",
    response: {
      statusPath: "$.status",
      errorPath: "$.fail_reason",
      errorFallbackPaths: ["$.error.message", "$.data.fail_reason"],
    },
  },
  output: videoOutput,
};

const klingVideoMappings = (
  referenceMode: "frame" | "element",
): readonly RestRequestMapping[] => [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  { target: "/messages", source: { kind: "openaiMessages", detail: "high" } },
  {
    target: "/duration",
    source: { kind: "request", path: "$.parameters.duration" },
  },
  {
    target: "/seconds",
    source: { kind: "request", path: "$.parameters.duration" },
    coerce: "string",
    omitIfUndefined: true,
  },
  {
    target: "/aspect_ratio",
    source: { kind: "request", path: "$.parameters.aspect_ratio" },
    omitIfUndefined: true,
  },
  {
    target: "/aspectRatio",
    source: { kind: "request", path: "$.parameters.aspect_ratio" },
    omitIfUndefined: true,
  },
  {
    target: "/resolution",
    source: { kind: "request", path: "$.parameters.resolution" },
    omitIfUndefined: true,
  },
  {
    target: "/size",
    source: {
      kind: "videoDimensions",
      resolutionPath: "$.parameters.resolution",
      aspectRatioPath: "$.parameters.aspect_ratio",
    },
  },
  {
    target: "/reference_mode",
    source: { kind: "literal", value: referenceMode },
  },
  {
    target: "/extra_body/duration",
    source: { kind: "request", path: "$.parameters.duration" },
    omitIfUndefined: true,
  },
  {
    target: "/extra_body/seconds",
    source: { kind: "request", path: "$.parameters.duration" },
    omitIfUndefined: true,
  },
  {
    target: "/extra_body/aspect_ratio",
    source: { kind: "request", path: "$.parameters.aspect_ratio" },
    omitIfUndefined: true,
  },
  {
    target: "/extra_body/aspectRatio",
    source: { kind: "request", path: "$.parameters.aspect_ratio" },
    omitIfUndefined: true,
  },
  {
    target: "/extra_body/resolution",
    source: { kind: "request", path: "$.parameters.resolution" },
    omitIfUndefined: true,
  },
  {
    target: "/extra_body/size",
    source: {
      kind: "videoDimensions",
      resolutionPath: "$.parameters.resolution",
      aspectRatioPath: "$.parameters.aspect_ratio",
    },
  },
  {
    target: "/extra_body/reference_mode",
    source: { kind: "literal", value: referenceMode },
  },
];

const klingVideoTransport = (
  referenceMode: "frame" | "element",
): RestModelConnectorOverride => ({
  pollIntervalMs: 4_000,
  submit: {
    path: "/v1/videos",
    method: "POST",
    bodyMode: "json",
    template: {
      duration: 5,
      seconds: "5",
      aspect_ratio: "16:9",
      aspectRatio: "16:9",
      resolution: "720p",
      size: "1280x720",
      reference_mode: referenceMode,
      extra_body: {
        duration: 5,
        seconds: 5,
        aspect_ratio: "16:9",
        aspectRatio: "16:9",
        resolution: "720p",
        size: "1280x720",
        reference_mode: referenceMode,
      },
    },
    mappings: klingVideoMappings(referenceMode),
    response: {
      taskIdPath: "$.id",
      taskIdFallbackPaths: ["$.task_id"],
      statusPath: "$.status",
      errorPath: "$.error.message",
    },
  },
  poll: {
    path: "/v1/videos/{taskId}",
    method: "GET",
    bodyMode: "none",
    response: {
      statusPath: "$.status",
      statusFallbackPaths: ["$.data.status"],
      errorPath: "$.fail_reason",
      errorFallbackPaths: [
        "$.error.message",
        "$.data.fail_reason",
        "$.data.error.message",
      ],
    },
  },
  output: videoOutput,
});

const soraVideoMappings: readonly RestRequestMapping[] = [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  {
    target: "/seconds",
    source: { kind: "request", path: "$.parameters.duration" },
    coerce: "string",
  },
  {
    target: "/aspect_ratio",
    source: { kind: "request", path: "$.parameters.aspect_ratio" },
  },
  {
    target: "/resolution",
    source: { kind: "request", path: "$.parameters.resolution" },
  },
  {
    target: "/image_url",
    source: { kind: "assets", assetKind: "image", select: "first" },
    omitIfUndefined: true,
  },
  {
    target: "/reference_image_urls",
    source: { kind: "assets", assetKind: "image", offset: 1 },
    omitIfEmpty: true,
  },
  {
    target: "/reference_video",
    source: { kind: "assets", assetKind: "video", select: "firstIfOnly" },
    omitIfUndefined: true,
  },
  {
    target: "/reference_videos",
    source: { kind: "assets", assetKind: "video", select: "allIfMultiple" },
    omitIfUndefined: true,
  },
  {
    target: "/audio_url",
    source: { kind: "assets", assetKind: "audio", select: "firstOrAll" },
    omitIfUndefined: true,
  },
  {
    target: "/video_config/reference_mode",
    source: { kind: "request", path: "$.parameters.reference_mode" },
    omitIfUndefined: true,
  },
];

const soraVideoTransport: RestModelConnectorOverride = {
  pollIntervalMs: 3_000,
  submit: {
    path: "/v1/videos",
    method: "POST",
    bodyMode: "json",
    template: { video_config: { reference_mode: "auto" } },
    mappings: soraVideoMappings,
    response: {
      taskIdPath: "$.id",
      taskIdFallbackPaths: ["$.task_id"],
      statusPath: "$.status",
      errorPath: "$.error.message",
    },
  },
  poll: {
    path: "/v1/videos/{taskId}",
    method: "GET",
    bodyMode: "none",
    response: {
      statusPath: "$.status",
      statusFallbackPaths: ["$.data.status"],
      errorPath: "$.error.message",
      errorFallbackPaths: ["$.fail_reason", "$.data.error.message"],
      progressPath: "$.progress",
    },
  },
  output: {
    path: "$.video_url",
    fallbackPaths: [
      "$.content_url",
      "$.url",
      "$.result_url",
      "$.data.video_url",
      "$.data.content_url",
    ],
    kind: "video",
    defaultMimeType: "video/mp4",
  },
  statusMap: {
    queued: "queued",
    pending: "queued",
    processing: "running",
    running: "running",
    in_progress: "running",
    completed: "succeeded",
    succeeded: "succeeded",
    failed: "failed",
    failure: "failed",
    cancelled: "cancelled",
    canceled: "cancelled",
    expired: "failed",
  },
};

export const MIKOTO_CONNECTOR: RestConnectorConfig = {
  auth: { type: "bearer" },
  allowedHosts: ["api.mikoto.vip"],
  assetsRequirePublicUrls: true,
  restrictModels: true,
  models: MIKOTO_MODELS,
  pollIntervalMs: 4_000,
  submit: {
    path: "/v1/images/generations/async",
    method: "POST",
    bodyMode: "json",
    template: { n: 1, response_format: "url" },
    mappings: imageMappings,
    response: {
      taskIdPath: "$.task_id",
      statusPath: "$.status",
      errorPath: "$.error.message",
    },
  },
  poll: {
    path: "/v1/images/tasks/{taskId}",
    method: "GET",
    bodyMode: "none",
    response: {
      statusPath: "$.status",
      errorPath: "$.error.message",
      progressPath: "$.progress",
    },
  },
  output: {
    path: "$.result.data",
    kind: "image",
    urlPath: "url",
    base64Path: "b64_json",
    defaultMimeType: "image/png",
  },
  statusMap: {
    queued: "queued",
    pending: "queued",
    running: "running",
    processing: "running",
    success: "succeeded",
    completed: "succeeded",
    failed: "failed",
    error: "failed",
    cancelled: "cancelled",
    canceled: "cancelled",
    expired: "failed",
  },
  operationOverrides: {
    "image.edit": {
      submit: {
        path: "/v1/images/edits/async",
        method: "POST",
        bodyMode: "multipart",
        template: { n: 1, response_format: "url" },
        mappings: [
          ...imageMappings,
          {
            target: "/image",
            source: { kind: "assets", assetKind: "image" },
            omitIfEmpty: true,
          },
        ],
        response: {
          taskIdPath: "$.task_id",
          statusPath: "$.status",
          errorPath: "$.error.message",
        },
      },
    },
  },
  modelOverrides: Object.fromEntries([
    ...MIKOTO_SEEDANCE_MODELS.map((model) => [model, seedanceVideoTransport]),
    ["kling-video", klingVideoTransport("frame")],
    ["kling-omni-video", klingVideoTransport("element")],
    ["sora-v3-pro", soraVideoTransport],
  ]),
};

const mikotoGroupDefinitions: readonly MikotoGroup[] = [
  {
    id: MIKOTO_IMAGE_GROUP,
    label: "OpenAI 图片",
    description:
      "MikotoPro OpenAI Images 兼容接口；gpt-image-2 支持文生图、图片编辑和真实尺寸 2K/4K。",
    defaultModel: MIKOTO_DEFAULT_MODEL,
    models: MIKOTO_MODELS.filter((model) => model.id === MIKOTO_DEFAULT_MODEL),
    provider: "rest",
  },
  {
    id: MIKOTO_IMAGE_1K_GROUP,
    label: "生图（1k）",
    description:
      "MikotoPro OpenAI Images 1K 专用分组；每张 $0.02，仅提供 1024×1024。",
    defaultModel: MIKOTO_DEFAULT_MODEL,
    models: MIKOTO_IMAGE_1K_MODELS,
    provider: "rest",
  },
  {
    id: MIKOTO_IMAGE_4K_GROUP,
    label: MIKOTO_IMAGE_4K_GROUP_ALIAS,
    description:
      "MikotoPro OpenAI Images 原生 4K 高质量分组；每张 $0.08，尺寸按文档精确传递。",
    defaultModel: MIKOTO_DEFAULT_MODEL,
    models: MIKOTO_IMAGE_4K_MODELS,
    provider: "rest",
  },
  {
    id: MIKOTO_GROK_GROUP,
    label: "grok生图",
    description:
      "MikotoPro Grok Imagine 图片分组；独立 Key、独立计费和模型路由。",
    defaultModel: MIKOTO_GROK_MODEL,
    models: MIKOTO_GROK_MODELS,
    provider: "rest",
  },
  {
    id: MIKOTO_GEMINI_GROUP,
    label: "Gemini 原生图片",
    description:
      "MikotoPro Gemini 原生 generateContent 接口；使用 x-goog-api-key 和 imageConfig。",
    defaultModel: "gemini-3.1-flash-image-preview",
    models: MIKOTO_GEMINI_MODELS,
    provider: "weai",
    protocol: "gemini-generate-content",
  },
  {
    id: MIKOTO_GEMINI_31_GROUP,
    label: "gemini-3.1-flash-image-preview",
    description:
      "MikotoPro Gemini 3.1 Flash 独立 Key 分组；支持 1K、2K、4K 和 7 种文档比例。",
    defaultModel: "gemini-3.1-flash-image-preview",
    models: mikotoGeminiModels(["gemini-3.1-flash-image-preview"]),
    provider: "weai",
    protocol: "gemini-generate-content",
  },
  {
    id: MIKOTO_GEMINI_3_PRO_GROUP,
    label: "gemini-3-pro-image-preview",
    description:
      "MikotoPro Gemini 3 Pro 独立 Key 分组；支持 1K、2K、4K 和多图融合。",
    defaultModel: "gemini-3-pro-image-preview",
    models: mikotoGeminiModels(["gemini-3-pro-image-preview"]),
    provider: "weai",
    protocol: "gemini-generate-content",
  },
  {
    id: MIKOTO_BANANA_2_GROUP,
    label: "香蕉2 1k2k",
    description:
      "MikotoPro 香蕉 2 分组；当前 Key 仅开放 1K/2K，避免发送不支持的 4K 档位。",
    defaultModel: "gemini-3.1-flash-image-preview",
    models: mikotoGeminiModels(
      ["gemini-3.1-flash-image-preview"],
      MIKOTO_GEMINI_1K_2K_SIZES,
    ),
    provider: "weai",
    protocol: "gemini-generate-content",
  },
  {
    id: MIKOTO_BANANA_PRO_GROUP,
    label: "香蕉pro 1k2k",
    description:
      "MikotoPro 香蕉 Pro 分组；当前 Key 仅开放 1K/2K，独立于 4K 香蕉 Pro Key。",
    defaultModel: "gemini-3-pro-image-preview",
    models: mikotoGeminiModels(
      ["gemini-3-pro-image-preview"],
      MIKOTO_GEMINI_1K_2K_SIZES,
    ),
    provider: "weai",
    protocol: "gemini-generate-content",
  },
  {
    id: MIKOTO_GEMINI_25_GROUP,
    label: "gemini-2.5-flash-image",
    description:
      "MikotoPro Gemini 2.5 Flash Image 独立 Key 分组；使用原生 generateContent。",
    defaultModel: "gemini-2.5-flash-image",
    models: [
      {
        id: "gemini-2.5-flash-image",
        name: "Gemini 2.5 Flash Image（$0.035/张）",
        description: "MikotoPro Gemini 2.5 Flash Image 图片模型。",
        operations: IMAGE_OPERATIONS,
        inputKinds: ["text", "image", "image[]"],
        outputKinds: ["image"],
        isDefault: true,
        parameters: geminiParameters,
        pricing: mikotoSnapshotPrice("per-image", 0.035),
        metadata: { fixedOutputCount: 1, modality: "image" },
        limits: { supportedMimeTypes: IMAGE_MIME_TYPES },
      },
    ],
    provider: "weai",
    protocol: "gemini-generate-content",
  },
  {
    id: MIKOTO_BANANA_25_GROUP,
    label: "香蕉2.5flash无4k",
    description:
      "MikotoPro 香蕉 2.5 Flash 分组；当前 Key 仅开放 1K/2K，不显示 4K。",
    defaultModel: "gemini-2.5-flash-image",
    models: [
      {
        id: "gemini-2.5-flash-image",
        name: "Gemini 2.5 Flash Image（1K/2K · $0.035/张）",
        description: "MikotoPro 香蕉 2.5 Flash 无 4K 分组。",
        operations: IMAGE_OPERATIONS,
        inputKinds: ["text", "image", "image[]"],
        outputKinds: ["image"],
        isDefault: true,
        parameters: MIKOTO_GEMINI_1K_2K_PARAMETERS,
        pricing: mikotoSnapshotPrice("per-image", 0.035),
        metadata: { fixedOutputCount: 1, modality: "image" },
        limits: { supportedMimeTypes: IMAGE_MIME_TYPES },
      },
    ],
    provider: "weai",
    protocol: "gemini-generate-content",
  },
  {
    id: MIKOTO_SEEDANCE_GROUP,
    label: "Seedance 视频",
    description:
      "MikotoPro Seedance 视频接口；包含文档列出的四个模型、4–15 秒和参考媒体参数。",
    defaultModel: "seedance-fast-720p",
    models: MIKOTO_MODELS.filter((model) => model.id.startsWith("seedance-")),
    provider: "rest",
  },
  {
    id: MIKOTO_KLING_GROUP,
    label: "Kling 视频",
    description:
      "MikotoPro Kling 独立密钥分组；包含 kling-video 与 kling-omni-video，自动匹配 frame/element 参数。",
    defaultModel: "kling-video",
    models: MIKOTO_MODELS.filter((model) => model.id.startsWith("kling-")),
    provider: "rest",
  },
  {
    id: MIKOTO_SORA_GROUP,
    label: "Sora 视频",
    description:
      "MikotoPro Sora V3 Pro 异步视频分组；4–15 秒、720p，按秒计费。",
    defaultModel: "sora-v3-pro",
    models: MIKOTO_SORA_MODELS,
    provider: "rest",
  },
];

/**
 * Groups that have a documented, canvas-callable model. OpenAI/Gemini
 * aggregate groups remain in the internal definitions for old connections,
 * but are intentionally not shown as new Key groups in the settings UI.
 */
export const MIKOTO_GROUPS = mikotoGroupDefinitions.filter(
  (group) =>
    group.id !== MIKOTO_IMAGE_GROUP && group.id !== MIKOTO_GEMINI_GROUP,
);

export function isMikotoGroupId(value: unknown): value is MikotoGroupId {
  return (
    typeof value === "string" &&
    MIKOTO_GROUP_IDS.includes(value as MikotoGroupId)
  );
}

/** Normalize the historical readable alias to MikotoPro's exact group id. */
export function normalizeMikotoGroupId(
  value: unknown,
): MikotoGroupId | undefined {
  if (value === MIKOTO_MODEL_GROUP) return MIKOTO_IMAGE_GROUP;
  if (value === MIKOTO_IMAGE_4K_GROUP_ALIAS) return MIKOTO_IMAGE_4K_GROUP;
  if (value === MIKOTO_BANANA_2_GROUP_ALIAS) return MIKOTO_BANANA_2_GROUP;
  if (value === MIKOTO_BANANA_PRO_GROUP_ALIAS) return MIKOTO_BANANA_PRO_GROUP;
  return isMikotoGroupId(value) ? value : undefined;
}

export function mikotoGroup(value: unknown): MikotoGroup | undefined {
  const normalized = normalizeMikotoGroupId(value);
  return normalized
    ? mikotoGroupDefinitions.find((group) => group.id === normalized)
    : undefined;
}

export function mikotoConnectorForGroup(
  groupId: MikotoGroupId,
): RestConnectorConfig {
  const group = mikotoGroup(groupId) ?? mikotoGroupDefinitions[0]!;
  const connector = structuredClone(MIKOTO_CONNECTOR);
  connector.models = structuredClone(group.models);
  if (connector.modelOverrides) {
    const allowedModels = new Set(group.models.map((model) => model.id));
    connector.modelOverrides = Object.fromEntries(
      Object.entries(connector.modelOverrides).filter(([model]) =>
        allowedModels.has(model),
      ),
    );
  }
  return connector;
}

export function mikotoConnectionConfig(
  groupId: MikotoGroupId = MIKOTO_IMAGE_1K_GROUP,
) {
  const group = mikotoGroup(groupId) ?? mikotoGroupDefinitions[0]!;
  return {
    preset: MIKOTO_PRESET_ID,
    supplierKey: MIKOTO_SUPPLIER_KEY,
    usage: "canvas",
    modelGroup: group.id,
    baseUrl: MIKOTO_BASE_URL,
    defaultModel: group.defaultModel,
    ...(group.provider === "rest"
      ? { connector: mikotoConnectorForGroup(group.id) }
      : { protocol: group.protocol }),
    catalogCapturedAt: "2026-08-28",
  };
}

export function isMikotoPreset(value: unknown): boolean {
  return value === MIKOTO_PRESET_ID;
}
