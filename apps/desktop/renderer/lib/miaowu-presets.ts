import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
  RestConnectorConfig,
  RestModelConnectorOverride,
  RestRequestMapping,
} from "@super-canvas/providers";

export const MIAOWU_PRESET_ID = "miaowu-openai-videos";
export const MIAOWU_SUPPLIER_KEY = "miaowu";
export const MIAOWU_BASE_URL = "https://api.miaowuai.store";
export const MIAOWU_MODEL_GROUP = "OpenAI Videos";
export const MIAOWU_DEFAULT_MODEL = "seedance-2.0-mini";
export const MIAOWU_CATALOG_CAPTURED_AT = "2026-08-30";

const VIDEO_OPERATIONS = ["video.generate", "video.image-to-video"] as const;
const RATIO_OPTIONS: readonly ModelParameterOption[] = [
  { label: "16:9 横屏", value: "16:9" },
  { label: "9:16 竖屏", value: "9:16" },
  { label: "1:1 方形", value: "1:1" },
  { label: "4:3 横屏", value: "4:3" },
  { label: "3:4 竖屏", value: "3:4" },
  { label: "21:9 超宽屏", value: "21:9" },
];

function parameters(
  input: {
    minSeconds?: number;
    maxSeconds?: number;
    defaultSeconds?: number;
    resolutions?: readonly string[];
    defaultResolution?: string;
    ratios?: readonly string[];
  } = {},
): readonly ModelParameterDescriptor[] {
  const resolutions = input.resolutions ?? ["720p"];
  const ratios =
    input.ratios ?? RATIO_OPTIONS.map((option) => String(option.value));
  return [
    {
      key: "duration",
      label: "时长（秒）",
      control: "number",
      valueType: "integer",
      default: input.defaultSeconds ?? 5,
      min: input.minSeconds ?? 1,
      max: input.maxSeconds ?? 30,
      step: 1,
      description:
        input.maxSeconds === undefined
          ? "喵呜文档仅规定 seconds 为正整数，未公开该模型上限；画布为防误输入暂限制 30 秒。"
          : "喵呜 OpenAI Videos API 的 seconds 字段；范围按模型广场已知限制设置。",
      operations: VIDEO_OPERATIONS,
    },
    {
      key: "aspect_ratio",
      label: "画面比例",
      control: "select",
      valueType: "string",
      default: ratios.includes("16:9") ? "16:9" : ratios[0],
      options: ratios.map(
        (value) =>
          RATIO_OPTIONS.find((option) => option.value === value) ?? {
            label: value,
            value,
          },
      ),
      description: "按 API 的 ratio 字段发送。",
      operations: VIDEO_OPERATIONS,
    },
    {
      key: "resolution",
      label: "输出分辨率",
      control: "select",
      valueType: "string",
      default: input.defaultResolution ?? "720p",
      options: resolutions.map((value) => ({ label: value, value })),
      description:
        input.resolutions === undefined
          ? "平台未公开该模型的分辨率档位；画布仅保留文档示例 720p，避免发送未经确认的 2k。"
          : "按 API 的 resolution 字段发送；档位来自模型广场已知说明。",
      operations: VIDEO_OPERATIONS,
    },
  ];
}

interface MarketplaceModel {
  id: string;
  price: string;
  description: string;
  group?: "default" | "vip";
  parameterControls?: boolean;
  parameterOverrides?: Parameters<typeof parameters>[0];
  limits: {
    maxInputImages: number;
    maxInputVideos: number;
    maxInputAudios: number;
  };
}

const MARKETPLACE_MODELS: readonly MarketplaceModel[] = [
  {
    id: "hailuo-3",
    price: "¥2.5/次",
    description: "喵呜视频模型；模型广场暂未公开专用视频参数。",
    parameterControls: false,
    limits: { maxInputImages: 0, maxInputVideos: 0, maxInputAudios: 0 },
  },
  {
    id: "happyhorse:r2v-1.5-deal",
    price: "¥0.9/次",
    description: "暂时正在维护。",
    parameterOverrides: {
      minSeconds: 4,
      maxSeconds: 9,
      defaultSeconds: 4,
      resolutions: ["720p"],
      ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    },
    limits: { maxInputImages: 9, maxInputVideos: 0, maxInputAudios: 0 },
  },
  {
    id: "minimax-h3",
    price: "¥0.12/秒",
    description: "官方 720p；使用垫视频时选择 720p，最高 13 秒。",
    parameterOverrides: {
      minSeconds: 4,
      maxSeconds: 15,
      defaultSeconds: 4,
      resolutions: ["720p"],
      ratios: ["9:16", "16:9", "4:3", "3:4", "1:1"],
    },
    limits: { maxInputImages: 9, maxInputVideos: 0, maxInputAudios: 3 },
  },
  {
    id: "seedance-2.0-deal",
    price: "¥5/次",
    description: "喵呜视频模型；模型广场暂未公开专用视频参数。",
    parameterControls: false,
    limits: { maxInputImages: 0, maxInputVideos: 0, maxInputAudios: 0 },
  },
  {
    id: "seedance-2.0-min",
    price: "¥1.2/次",
    description: "喵呜视频模型；模型广场暂未公开专用视频参数。",
    parameterControls: false,
    limits: { maxInputImages: 0, maxInputVideos: 0, maxInputAudios: 0 },
  },
  {
    id: "seedance-2.0-mini",
    price: "¥0.8/次",
    description: "933 不卡人脸；480p，可出 720p，但 720p 最高 12 秒。",
    parameterOverrides: {
      minSeconds: 5,
      maxSeconds: 15,
      defaultSeconds: 5,
      defaultResolution: "480p",
      resolutions: ["480p", "720p"],
      ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    },
    limits: { maxInputImages: 9, maxInputVideos: 3, maxInputAudios: 3 },
  },
  {
    id: "seedance-2.0-特惠",
    price: "¥0.17/次",
    description: "喵呜视频模型；模型广场暂未公开专用视频参数。",
    parameterControls: false,
    limits: { maxInputImages: 0, maxInputVideos: 0, maxInputAudios: 0 },
  },
  {
    id: "seedance-2.0m",
    price: "¥5/次",
    description: "933 不卡人脸，但是限制字数 2000 字。",
    parameterOverrides: {
      minSeconds: 4,
      maxSeconds: 15,
      defaultSeconds: 4,
      resolutions: ["720p"],
      ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    },
    limits: { maxInputImages: 9, maxInputVideos: 3, maxInputAudios: 3 },
  },
  {
    id: "seedance-2.0-pro",
    price: "¥2/次",
    description: "Adobe 线路，933 卡人脸。",
    parameterOverrides: {
      minSeconds: 4,
      maxSeconds: 15,
      defaultSeconds: 4,
      resolutions: ["720p"],
      ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    },
    limits: { maxInputImages: 9, maxInputVideos: 3, maxInputAudios: 3 },
  },
  {
    id: "kling-3.0-omni",
    price: "¥0.1/秒",
    description: "喵呜模型广场的视频模型。",
    parameterOverrides: {
      minSeconds: 5,
      maxSeconds: 15,
      defaultSeconds: 5,
      resolutions: ["720p"],
      ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    },
    limits: { maxInputImages: 3, maxInputVideos: 0, maxInputAudios: 0 },
  },
  {
    id: "wan3.0-video-480p",
    price: "¥0.26/秒",
    description: "通义万相 3.0 480P，2–30 秒，支持首帧图。",
    parameterOverrides: {
      minSeconds: 2,
      maxSeconds: 30,
      defaultSeconds: 2,
      defaultResolution: "480p",
      resolutions: ["480p"],
      ratios: ["9:16", "16:9", "4:3", "3:4", "1:1"],
    },
    limits: { maxInputImages: 10, maxInputVideos: 5, maxInputAudios: 5 },
  },
];

export const MIAOWU_MODELS: readonly ModelDescriptor[] = MARKETPLACE_MODELS.map(
  (model): ModelDescriptor => ({
    id: model.id,
    name: `${model.id}（${model.price}）`,
    description: model.description,
    operations: VIDEO_OPERATIONS,
    inputKinds: [
      "text",
      ...(model.limits.maxInputImages > 0
        ? (["image", "image[]"] as const)
        : []),
      ...(model.limits.maxInputVideos > 0
        ? (["video", "video[]"] as const)
        : []),
      ...(model.limits.maxInputAudios > 0
        ? (["audio", "audio[]"] as const)
        : []),
    ],
    outputKinds: ["video"],
    isDefault: model.id === MIAOWU_DEFAULT_MODEL,
    parameters:
      model.parameterControls === false
        ? []
        : parameters(model.parameterOverrides),
    metadata: {
      modality: "video",
      marketplaceGroup: model.group ?? "default",
      pricingCapturedAt: MIAOWU_CATALOG_CAPTURED_AT,
      supportsFirstLastFrames: model.limits.maxInputImages >= 2,
      remoteMediaUrlsOnly: true,
      clampNumericParameters: true,
      parameterSource: "pricing.video_api",
      ...(model.parameterControls === false
        ? {
            parameterSource: "pricing.model-detail",
            parameterControlsUnavailable: true,
          }
        : {}),
      ...(model.id === "seedance-2.0-mini"
        ? {
            durationMaxByResolution: { "720p": 12 },
          }
        : {}),
    },
    limits: model.limits,
  }),
);

const submitMappings: readonly RestRequestMapping[] = [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  {
    target: "/seconds",
    source: { kind: "request", path: "$.parameters.duration" },
  },
  {
    target: "/ratio",
    source: { kind: "request", path: "$.parameters.aspect_ratio" },
    omitIfUndefined: true,
  },
  {
    target: "/resolution",
    source: { kind: "request", path: "$.parameters.resolution" },
    omitIfUndefined: true,
  },
  {
    target: "/image_urls",
    source: { kind: "assets", assetKind: "image" },
    omitIfEmpty: true,
  },
  {
    target: "/video_urls",
    source: { kind: "assets", assetKind: "video" },
    omitIfEmpty: true,
  },
  {
    target: "/audio_urls",
    source: { kind: "assets", assetKind: "audio" },
    omitIfEmpty: true,
  },
];

export const MIAOWU_CHAT_VIDEO_OVERRIDE: RestModelConnectorOverride = {
  submit: {
    path: "/v1/chat/completions",
    method: "POST",
    bodyMode: "json",
    template: { messages: [{ role: "user", content: "" }], stream: false },
    mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      {
        target: "/messages/0/content",
        source: { kind: "request", path: "$.prompt" },
      },
    ],
  },
  output: {
    path: "$.choices[0].message.content",
    fallbackPaths: ["$.video_url", "$.url", "$.data[0].url"],
    kind: "video",
    defaultMimeType: "video/mp4",
  },
};

const CHAT_VIDEO_MODEL_IDS = [
  "hailuo-3",
  "seedance-2.0-deal",
  "seedance-2.0-min",
  "seedance-2.0-特惠",
] as const;

export const MIAOWU_CONNECTOR: RestConnectorConfig = {
  auth: { type: "bearer" },
  allowedHosts: ["api.miaowuai.store"],
  assetsRequirePublicUrls: true,
  restrictModels: true,
  models: MIAOWU_MODELS,
  modelOverrides: Object.fromEntries(
    CHAT_VIDEO_MODEL_IDS.map((id) => [id, MIAOWU_CHAT_VIDEO_OVERRIDE]),
  ),
  pollIntervalMs: 4_000,
  submit: {
    path: "/v1/videos",
    method: "POST",
    bodyMode: "json",
    mappings: submitMappings,
    response: {
      taskIdPath: "$.id",
      statusPath: "$.status",
      progressPath: "$.progress",
      errorPath: "$.error.message",
    },
  },
  poll: {
    path: "/v1/videos/{taskId}",
    method: "GET",
    bodyMode: "none",
    response: {
      taskIdPath: "$.id",
      statusPath: "$.status",
      progressPath: "$.progress",
      errorPath: "$.error.message",
    },
  },
  statusMap: {
    queued: "queued",
    pending: "queued",
    in_progress: "running",
    running: "running",
    processing: "running",
    completed: "succeeded",
    succeeded: "succeeded",
    failed: "failed",
    cancelled: "cancelled",
    canceled: "cancelled",
  },
  output: {
    path: "$.url",
    fallbackPaths: ["$.data.url", "$.video_url", "$.result_url"],
    kind: "video",
    defaultMimeType: "video/mp4",
  },
};

export function miaowuConnectionConfig(
  modelGroup = MIAOWU_MODEL_GROUP,
  defaultModel = MIAOWU_DEFAULT_MODEL,
  models: readonly ModelDescriptor[] = MIAOWU_MODELS,
) {
  const connector = structuredClone(MIAOWU_CONNECTOR);
  connector.models = models.map((model) => structuredClone(model));
  return {
    preset: MIAOWU_PRESET_ID,
    supplierKey: MIAOWU_SUPPLIER_KEY,
    supplierWebsiteUrl: "https://api.miaowuai.store/pricing",
    usage: "canvas",
    modelGroup,
    baseUrl: MIAOWU_BASE_URL,
    defaultModel,
    connector,
    catalogCapturedAt: MIAOWU_CATALOG_CAPTURED_AT,
  };
}

export function isMiaowuPreset(value: unknown): boolean {
  return value === MIAOWU_PRESET_ID;
}
