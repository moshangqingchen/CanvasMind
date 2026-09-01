import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
} from "./contracts.js";

export type { ModelDescriptor } from "./contracts.js";

export const WEAI_ADOBE_TOKEN_MODEL_GROUP = "生图-openai-adobe-token计费";
export const WEAI_GEMINI_MODEL_GROUP = "gemini香蕉";
export const WEAI_AZURE_MODEL_GROUP = "AZURE-openai";
export const WEAI_ADOBE_PER_REQUEST_MODEL_GROUP = "生图-openai-adobe-按次";
export const WEAI_CODEX_TOKEN_MODEL_GROUP = "生图-openai-codex-token计费";
export const WEAI_ADOBE_URL_MODEL_GROUP = "生图-openai-adobe-按次-返回url";

export type WeAIGeminiProtocol =
  "gemini-generate-content" | "gemini-openai-compatible";

const IMAGE_OPERATIONS = ["image.generate", "image.edit"] as const;
const WEAI_GEMINI_DEFAULT_IMAGE_SIZE = "4K";
const WEAI_GEMINI_MAX_INPUT_IMAGES = 14;
export const WEAI_ADOBE_PER_REQUEST_PRICES: Readonly<Record<string, string>> = {
  "gpt-image-2-low": "$0.04",
  "gpt-image-2-medium": "$0.07",
  "gpt-image-2-high": "$0.15",
};

const GEMINI_MODELS = new Set(["gemini-3.1-flash-image", "gemini-3-pro-image"]);

const IMAGE_PARAMETERS: readonly ModelParameterDescriptor[] = [
  {
    key: "aspect_ratio",
    label: "画面比例",
    control: "select",
    valueType: "string",
    default: "auto",
    options: [
      { label: "自动（优先提示词，其次参考图）", value: "auto" },
      { label: "方形 1:1", value: "1:1" },
      { label: "横向 16:9", value: "16:9" },
      { label: "竖向 9:16", value: "9:16" },
      { label: "横向 4:3", value: "4:3" },
      { label: "竖向 3:4", value: "3:4" },
      { label: "横向 3:2", value: "3:2" },
      { label: "竖向 2:3", value: "2:3" },
    ],
    description: "自动模式优先读取提示词中的比例；未指定时跟随第一张参考图",
    operations: IMAGE_OPERATIONS,
  },
  {
    key: "size",
    label: "输出分辨率（size）",
    control: "dimensions",
    valueType: "string",
    default: "auto",
    min: 16,
    max: 3840,
    step: 16,
    options: [
      { label: "自动（提示词优先，其次参考图）", value: "auto" },
      { label: "1K 方图 · 1024 × 1024", value: "1024x1024" },
      {
        label: "常用横图 · 1536 × 1024（非 1K 档）",
        value: "1536x1024",
      },
      {
        label: "常用竖图 · 1024 × 1536（非 1K 档）",
        value: "1024x1536",
      },
      { label: "2K 方图 · 2048 × 2048", value: "2048x2048" },
      { label: "2K 横图 16:9 · 2048 × 1152", value: "2048x1152" },
      { label: "4K 方图 1:1 · 2160 × 2160", value: "2160x2160" },
      { label: "4K 横图 16:9 · 3840 × 2160", value: "3840x2160" },
      { label: "4K 竖图 9:16 · 2160 × 3840", value: "2160x3840" },
      { label: "4K 横图 4:3 · 2880 × 2160", value: "2880x2160" },
      { label: "4K 竖图 3:4 · 2160 × 2880", value: "2160x2880" },
      { label: "4K 横图 3:2 · 3264 × 2176", value: "3264x2176" },
      { label: "4K 竖图 2:3 · 2176 × 3264", value: "2176x3264" },
      { label: "4K 超宽 21:9 · 3840 × 1648", value: "3840x1648" },
    ],
    description:
      "自动模式由模型优先按提示词决定尺寸，其次参考图；手动选择时作为 Images API 的 size 参数发送",
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

const GEMINI_RATIOS: readonly ModelParameterOption[] = [
  { label: "自动", value: "auto" },
  ...[
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
    "1:8",
    "8:1",
    "1:4",
    "4:1",
  ].map((value) => ({ label: value, value })),
];

const GEMINI_RATIO_PARAMETER: ModelParameterDescriptor = {
  key: "aspect_ratio",
  label: "画面比例",
  control: "select",
  valueType: "string",
  default: "auto",
  options: GEMINI_RATIOS,
  operations: IMAGE_OPERATIONS,
};

const GEMINI_COUNT_PARAMETER: ModelParameterDescriptor = {
  key: "n",
  label: "生成张数",
  control: "number",
  valueType: "integer",
  default: 1,
  min: 1,
  max: 1,
  step: 1,
  description: "We-AI Gemini 单次固定生成 1 张",
  operations: IMAGE_OPERATIONS,
};

const OPTIONAL_QUALITY: ModelParameterDescriptor = {
  key: "quality",
  label: "质量（quality，可选）",
  control: "select",
  valueType: "string",
  default: "high",
  options: [
    { label: "自动", value: "auto" },
    { label: "低", value: "low" },
    { label: "中", value: "medium" },
    { label: "高", value: "high" },
  ],
  operations: IMAGE_OPERATIONS,
};

const RESPONSE_FORMAT: ModelParameterDescriptor = {
  key: "response_format",
  label: "返回方式",
  control: "select",
  valueType: "string",
  default: "url",
  options: [{ label: "URL（供应商要求，避免大图断线）", value: "url" }],
  description:
    "We-AI 供应商要求 Adobe 按次请求固定发送 response_format: url，避免大体积 Base64 回传时连接中断。",
  operations: IMAGE_OPERATIONS,
};

const OUTPUT_PARAMETERS: readonly ModelParameterDescriptor[] = [
  {
    key: "output_format",
    label: "格式",
    control: "select",
    valueType: "string",
    default: "png",
    options: [
      { label: "PNG", value: "png" },
      { label: "JPEG", value: "jpeg" },
      { label: "WebP", value: "webp" },
    ],
    operations: IMAGE_OPERATIONS,
  },
  {
    key: "output_compression",
    label: "压缩率",
    control: "number",
    valueType: "integer",
    min: 0,
    max: 100,
    step: 1,
    placeholder: "100",
    description: "仅 JPEG 与 WebP 使用",
    operations: IMAGE_OPERATIONS,
  },
];

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "gpt-image-1": "GPT Image 1",
  "gpt-image-1.5": "GPT Image 1.5",
  "gpt-image-2": "GPT Image 2",
  "gpt-image-2-low": "GPT Image 2 LOW",
  "gpt-image-2-medium": "GPT Image 2 MEDIUM",
  "gpt-image-2-high": "GPT Image 2 HIGH",
  "gemini-3-pro-image": "Gemini 3 Pro Image",
  "gemini-3.1-flash-image": "Gemini 3.1 Flash Image",
};

function isGeminiModel(model: string): boolean {
  return GEMINI_MODELS.has(model);
}

function maxOutputCount(model: string, group?: string): number {
  if (
    group === WEAI_GEMINI_MODEL_GROUP ||
    group === WEAI_CODEX_TOKEN_MODEL_GROUP
  )
    return 1;
  if (
    group === WEAI_ADOBE_TOKEN_MODEL_GROUP ||
    group === WEAI_ADOBE_PER_REQUEST_MODEL_GROUP ||
    group === WEAI_ADOBE_URL_MODEL_GROUP ||
    group === WEAI_AZURE_MODEL_GROUP
  )
    return 10;
  return /^gpt-image-2-(?:low|medium|high)$/u.test(model) ? 10 : 1;
}

function modelName(id: string, group?: string): string {
  const base = DISPLAY_NAMES[id] ?? id;
  const kSuffix = /^gpt-image-2(?:-|$)/u.test(id) ? " · 1K/2K/4K" : "";
  if (group === WEAI_ADOBE_PER_REQUEST_MODEL_GROUP) {
    const price = WEAI_ADOBE_PER_REQUEST_PRICES[id];
    if (price) return `${base}（${price}/次${kSuffix}）`;
  }
  if (group === WEAI_ADOBE_URL_MODEL_GROUP && id === "gpt-image-2")
    return `${base}（LOW $0.04/次 · MEDIUM $0.07/次 · HIGH $0.15/次${kSuffix} · 返回 URL）`;
  if (group === WEAI_GEMINI_MODEL_GROUP) {
    return id.includes("pro-image")
      ? `${base}（1K $0.06/张 · 2K $0.08/张 · 4K $0.10/张）`
      : `${base}（1K $0.04/张 · 2K $0.06/张 · 4K $0.08/张）`;
  }
  if (group === WEAI_ADOBE_TOKEN_MODEL_GROUP)
    return `${base}（1× Token${kSuffix}）`;
  if (group === WEAI_AZURE_MODEL_GROUP) return `${base}（3× Token${kSuffix}）`;
  if (group === WEAI_CODEX_TOKEN_MODEL_GROUP)
    return `${base}（0.7× Token${kSuffix}）`;
  return `${base}（We-AI${kSuffix}）`;
}

function parametersForModel(
  model: string,
  group?: string,
  protocol: WeAIGeminiProtocol = "gemini-generate-content",
): readonly ModelParameterDescriptor[] {
  if (isGeminiModel(model)) {
    return [
      GEMINI_RATIO_PARAMETER,
      {
        key: protocol === "gemini-openai-compatible" ? "size" : "image_size",
        label: "输出分辨率",
        control: "select",
        valueType: "string",
        default: WEAI_GEMINI_DEFAULT_IMAGE_SIZE,
        options: [
          {
            label: "自动（提示词优先，其次参考图）",
            value: "auto",
          },
          ...(protocol === "gemini-generate-content"
            ? [{ label: "512 px", value: "512" }]
            : []),
          ...["1K", "2K", "4K"].map((value) => ({ label: value, value })),
        ],
        description:
          "自动时不发送固定分辨率，由模型优先按提示词决定，其次参考图",
        operations: IMAGE_OPERATIONS,
      },
      GEMINI_COUNT_PARAMETER,
    ];
  }
  const max = maxOutputCount(model, group);
  const supportsQuality =
    group === WEAI_ADOBE_TOKEN_MODEL_GROUP ||
    group === WEAI_AZURE_MODEL_GROUP ||
    group === WEAI_ADOBE_URL_MODEL_GROUP;
  const supportsUrlResponse = group === WEAI_ADOBE_PER_REQUEST_MODEL_GROUP;
  // Adobe per-request supports response_format: url, but We-AI only documents
  // output_format/output_compression for the other compatible image routes.
  const supportsOutput = supportsQuality;
  return IMAGE_PARAMETERS.flatMap((parameter) => {
    if (parameter.key !== "n") return [parameter];
    return [
      ...(supportsQuality ? [OPTIONAL_QUALITY] : []),
      ...(supportsOutput ? OUTPUT_PARAMETERS : []),
      ...(supportsUrlResponse ? [RESPONSE_FORMAT] : []),
      {
        ...parameter,
        max,
        description:
          max === 1
            ? "当前分组单次仅支持 1 张；批量任务请在画布中拆分"
            : "当前分组单次最多生成 10 张",
      },
    ];
  });
}

function baseDescriptor(
  id: string,
  isDefault: boolean,
  group?: string,
  protocol: WeAIGeminiProtocol = "gemini-generate-content",
): ModelDescriptor {
  const quality = /^gpt-image-2-(low|medium|high)$/u.exec(id)?.[1];
  const gemini = isGeminiModel(id);
  const max = maxOutputCount(id, group);
  return {
    id,
    name: modelName(id, group),
    description: gemini
      ? "We-AI Gemini 生图模型；价格按 1K、2K、4K 档位计算"
      : quality
        ? `We-AI Adobe 按次模型；${quality.toUpperCase()} 画质固定，支持 1K、2K、4K 输出`
        : "We-AI 图片模型；支持文档列出的常用尺寸与自定义精确尺寸",
    operations: IMAGE_OPERATIONS,
    parameters: parametersForModel(id, group, protocol),
    isDefault,
    limits: {
      maxInputImages: gemini ? WEAI_GEMINI_MAX_INPUT_IMAGES : 16,
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
    metadata: {
      ...(max === 1 ? { fixedOutputCount: 1 } : {}),
      ...(quality ? { fixedQuality: quality } : {}),
      ...(gemini ? { protocol } : {}),
      ...(group ? { modelGroup: group } : {}),
    },
  };
}

export function weAIModelDescriptors(
  id: string,
  isDefault: boolean,
  group?: string,
  protocol: WeAIGeminiProtocol = "gemini-generate-content",
): ModelDescriptor[] {
  return [baseDescriptor(id, isDefault, group, protocol)];
}
