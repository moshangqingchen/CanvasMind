import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
  ValidationIssue,
} from "./contracts.js";
import { imageSizePresetMatchesRatio } from "./image-size-presets.js";

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

const GEMINI_MODELS = new Set([
  "gemini-3.1-flash-image", "gemini-3-pro-image",
  "gemini-3-pro-image-preview", "gemini-3.0-pro-image", "gemini-3.0-pro-image-preview", "gemini-3.1-flash-image-preview",
]);

/** GPT2 guide chapter 6; examples are selectable samples, not a full enum.
 * https://docs.we-ai.cc/guides/image-generation.html (2026-10-10 body SHA f1acf5a70376785b0b257efad0043f71e1f836c52f7f4c75a58dcc2a0105816c).
 */
const WEAI_GPT2_EXAMPLE_SIZES = [
  ["1K · 1:1 · 1024 × 1024", "1024x1024"],
  ["示例 · 1536 × 1024（非 1K 档）", "1536x1024"],
  ["示例 · 1024 × 1536（非 1K 档）", "1024x1536"],
  ["2K · 1:1 · 2048 × 2048", "2048x2048"],
  ["2K · 16:9 · 2048 × 1152", "2048x1152"],
  ["4K · 16:9 · 3840 × 2160", "3840x2160"],
  ["4K · 9:16 · 2160 × 3840", "2160x3840"],
].map(([label, value]) => ({ label: label!, value: value! }));
export function weAIImageDimensionParameters(model: string): ModelParameterDescriptor[] {
  const gpt2 = /^gpt-image-2(?:-(?:low|medium|high))?$/u.test(model);
  return [
    { key: "aspect_ratio", label: "画面比例偏好", control: "text", valueType: "string", default: "auto",
      placeholder: "auto / WIDTH:HEIGHT", description: "应用比例偏好；通过独立 W/H 表达，请求只发送 size。", operations: IMAGE_OPERATIONS },
    { key: "size", label: "输出尺寸（size）", control: "dimensions", valueType: "string", default: "auto", step: gpt2 ? 16 : 1,
      ...(gpt2 ? { min: 16, max: 3840 } : {}),
      options: [{ label: "自动", value: "auto" }, ...(gpt2 ? WEAI_GPT2_EXAMPLE_SIZES : [])],
      description: gpt2 ? "GPT Image 2 指南：16 像素对齐、最长边 3840、比例不超过 3:1、总像素 655360–8294400；所列为文档示例，可输入合法 W/H。"
        : "此完整型号 size 为开放尺寸输入；未套用 GPT Image 2 的像素表、范围或步长。", operations: IMAGE_OPERATIONS },
  ];
}

/** Application preferences are compared to actual size, never invented as wire fields. */
export function imageSizePreferenceIssues(parameters: Readonly<Record<string, unknown>> | undefined): ValidationIssue[] {
  const ratio = [parameters?.aspect_ratio, parameters?.aspectRatio, parameters?.ratio].find(value => value !== undefined && value !== "" && value !== "auto");
  if (ratio === undefined) {
    if (/^[124]k$/iu.test(String(parameters?.size_tier ?? "")) && !/^\d+x\d+$/iu.test(String(parameters?.size ?? "")))
      return [{ path: "parameters.size", code: "image_size_mapping_required", message: "所选档位请填写独立 W/H；档位偏好保留，接口只发送 size 原值。" }];
    return [];
  }
  const match = typeof ratio === "string" ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(ratio.trim()) : null;
  const size = typeof parameters?.size === "string" ? /^(\d+)x(\d+)$/iu.exec(parameters.size.trim()) : null;
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) return [{ path: "parameters.aspect_ratio", code: "invalid_aspect_ratio", message: "请保留比例偏好并填写正数 WIDTH:HEIGHT。" }];
  if (!size || Number(size[1]) <= 0 || Number(size[2]) <= 0) return [{ path: "parameters.size", code: "image_size_mapping_required", message: "当前比例请填写独立 W/H；请求使用 size 原值，比例和档位偏好保留。" }];
  if (!imageSizePresetMatchesRatio(parameters?.size, ratio) && Math.abs(Number(size[1]) / Number(size[2]) / (Number(match[1]) / Number(match[2])) - 1) > 0.005)
    return [{ path: "parameters.aspect_ratio", code: "image_size_ratio_conflict", message: "比例偏好与 W/H 不一致，请确认；原比例、尺寸和档位保留。" }];
  return [];
}

export function applyWeAIImageDimensionContract(connection: { provider: string; config: Readonly<Record<string, unknown>> }, model: ModelDescriptor): ModelDescriptor {
  if (!["openai", "weai"].includes(connection.provider) || connection.config.manualProtocol === true ||
      ["agent", "disabled"].includes(String(connection.config.usage)) || connection.config.supplierArchived === true ||
      model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test" ||
      !model.operations.some(operation => operation.startsWith("image."))) return model;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    if (url.protocol !== "https:" || url.hostname !== "asian-acc.we-token.cc" || url.port || url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return model;
  } catch { return model; }
  const stable = connection.config.accountKeyGroupId == null ? undefined : String(connection.config.accountKeyGroupId);
  const names: Record<string, string> = { "6": WEAI_CODEX_TOKEN_MODEL_GROUP, "24": WEAI_ADOBE_TOKEN_MODEL_GROUP,
    "19": WEAI_AZURE_MODEL_GROUP, "23": WEAI_ADOBE_PER_REQUEST_MODEL_GROUP, "30": WEAI_ADOBE_URL_MODEL_GROUP,
    "35": "生图-openai-adobe-image2.5专属", "12": "adobe香蕉", "33": "aistudio香蕉" };
  const selectedGroup = String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "");
  if (stable !== undefined && !Object.hasOwn(names, stable) || connection.provider === "weai" && stable === undefined && !Object.values(names).includes(selectedGroup)) return model;
  const group = stable === undefined ? selectedGroup : names[stable]!;
  const nativeBanana = ["adobe香蕉", "aistudio香蕉"].includes(group) &&
    (GEMINI_MODELS.has(model.id) || group === "aistudio香蕉" && model.id === "gemini-nano-banana-2.1");
  if (nativeBanana) {
    // This supplier's native guide publishes no 512 tier or pixel matrix.
    // Adobe accepts the Pro 3.0 aliases; aistudio does not.
    if (group === "aistudio香蕉" && model.id.includes("3.0-pro")) return model;
    const broad = group === "adobe香蕉" || model.id === "gemini-nano-banana-2.1";
    const ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", ...(broad ? ["1:4", "4:1", "1:8", "8:1"] : [])];
    const currentResolution = model.parameters?.find(parameter => parameter.key === "image_size");
    const dimensions: ModelParameterDescriptor[] = [
      { key: "image_size", label: "输出分辨率", control: "select", valueType: "string", default: currentResolution?.default ?? (group === "adobe香蕉" ? "2K" : "1K"),
        options: [{ value: "auto", label: "自动（省略 imageSize）" }, ...["1K", "2K", "4K"].map(value => ({ value, label: value }))], operations: IMAGE_OPERATIONS,
        description: "供应商原生 generationConfig.imageConfig.imageSize 字段；档位不是固定像素，不借其它供应商的 512 或尺寸表。" },
      { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "auto", options: [{ value: "auto", label: "自动" }, ...ratios.map(value => ({ value, label: value }))], operations: IMAGE_OPERATIONS,
        description: "供应商原生 generationConfig.imageConfig.aspectRatio 字段；按当前官方分组和完整型号的比例列表发送。" },
      { ...GEMINI_COUNT_PARAMETER },
    ];
    return { ...model, parameters: [...dimensions, ...(model.parameters ?? []).filter(parameter => !["size", "size_tier", "resolution", "image_size", "aspect_ratio", "n"].includes(parameter.key))],
      limits: { ...model.limits, maxInputImages: 14, maxOutputImages: 1 },
      metadata: { ...model.metadata, imageNativeParameterContract: true, imageNativeResolutionParameter: "image_size", imageNativeResolutionOptions: true,
        imageSupportedResolutions: ["1K", "2K", "4K"], imageSizeContract: "weai-exact-group-native-gemini", imageSupplierResolutionDefault: group === "adobe香蕉" ? "2K" : "1K",
        imageInputMaxBytes: 20 * 1024 * 1024, imageOutputEncodingContract: "inlineData.mimeType-original", imageContractGroupId: stable ?? null,
        documentationUrl: "https://docs.we-ai.cc/guides/gemini-banana-image.html" } };
  }
  if (!/^gpt-image-(?:1(?:\.5)?|2(?:\.5-(?:flare|sunburst)|-(?:low|medium|high))?)$/u.test(model.id)) return model;
  const dimensions = weAIImageDimensionParameters(model.id);
  const codexQuality = group === WEAI_CODEX_TOKEN_MODEL_GROUP && ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(model.id);
  const quality = model.id.includes("2.5") && (codexQuality || group === "生图-openai-adobe-image2.5专属" || model.parameters?.some(parameter => parameter.key === "quality"))
    ? { key: "quality", label: "请求质量", control: "text" as const, valueType: "string" as const, default: "max", allowCustomValue: true,
        options: [{ value: "auto", label: "自动" }, { value: "max", label: "最高（应用偏好）" }],
        description: "本完整型号未公布完整 quality 枚举；max 为应用最高偏好，已保存原值按质量字段发送。", operations: IMAGE_OPERATIONS }
    : codexQuality ? OPTIONAL_QUALITY : undefined;
  return { ...model, parameters: [...dimensions, ...(quality ? [quality] : []), ...(model.parameters ?? []).filter(parameter => !["size", "aspect_ratio", ...(quality ? ["quality"] : [])].includes(parameter.key))],
    metadata: { ...model.metadata, imageNativeParameterContract: true, imageOpenSizePreferences: true,
      imageSupportedResolutions: /^gpt-image-2(?:-(?:low|medium|high))?$/u.test(model.id) ? ["1K", "2K", "4K"] : [],
      imageContractGroupId: stable ?? null, ...(quality ? { imageNativeQualityOptions: true,
        imageApplicationQualityDefault: quality.default, imageSupplierQualityDefault: null,
        imageQualityFieldSource: "https://docs.we-ai.cc/guides/image-generation-service.html", imageQualityEnumPublished: !model.id.includes("2.5") } : {}),
      documentationUrl: "https://docs.we-ai.cc/guides/image-generation.html", imageSizeContract: "weai-full-model-document-size" } };
}
const IMAGE_PARAMETERS: readonly ModelParameterDescriptor[] = [
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
  const codexQuality = group === WEAI_CODEX_TOKEN_MODEL_GROUP && ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(model);
  const openQuality: ModelParameterDescriptor = { key: "quality", label: "请求质量", control: "text", valueType: "string", default: "max", allowCustomValue: true,
    options: [{ value: "auto", label: "自动" }, { value: "max", label: "最高（应用偏好）" }],
    description: "本完整型号未公布完整 quality 枚举；max 为应用最高偏好，按用户原值发送。", operations: IMAGE_OPERATIONS };
  const supportsUrlResponse = group === WEAI_ADOBE_PER_REQUEST_MODEL_GROUP && model !== "gpt-image-2";
  // Adobe per-request supports response_format: url, but We-AI only documents
  // output_format/output_compression for the other compatible image routes.
  const supportsOutput = supportsQuality;
  return [...weAIImageDimensionParameters(model), ...IMAGE_PARAMETERS].flatMap((parameter) => {
    if (parameter.key !== "n") return [parameter];
    return [
      ...(supportsQuality || codexQuality ? [codexQuality && model.includes("2.5") ? openQuality : OPTIONAL_QUALITY] : []),
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
      imageNativeParameterContract: true,
      imageOpenSizePreferences: !gemini,
      imageSupportedResolutions: gemini || /^gpt-image-2(?:-(?:low|medium|high))?$/u.test(id) ? ["1K", "2K", "4K"] : [],
      documentationUrl: "https://docs.we-ai.cc/guides/image-generation.html",
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
