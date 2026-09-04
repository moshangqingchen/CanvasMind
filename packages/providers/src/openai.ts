import { Resolver } from "node:dns";
import type { LookupFunction } from "node:net";

import type {
  FetchImplementation,
  ModelDescriptor,
  ModelParameterDescriptor,
  ModelParameterOption,
  NormalizedRequest,
  ProviderAdapter,
  ProviderAssetInput,
  ProviderConnectionResolver,
  ProviderTask,
  RemoteArtifact,
  ResolvedProviderConnection,
  ValidationIssue,
  ValidationResult,
} from "./contracts.js";
import { Agent, Dispatcher1Wrapper } from "undici";
import { assertValidResult, withCanonicalModelFields } from "./contracts.js";
import {
  assetToBlob,
  fetchProviderJson,
  joinUrl,
  mergeHeaders,
  providerFetch,
  requireApiKey,
} from "./http.js";
import {
  WEAI_ADOBE_PER_REQUEST_PRICES,
  weAIModelDescriptors,
} from "./weai-models.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-2";
const FRIMODEL_REQUEST_TIMEOUT_MS = 5 * 60 * 1_000;
const WEAI_DEFAULT_BASE_URL = "https://asian-acc.we-token.cc/v1";
const WEAI_REQUEST_TIMEOUT_MS = 30 * 60 * 1_000;
const WEAI_TCP_KEEPALIVE_INITIAL_DELAY_MS = 30 * 1_000;
const WEAI_DIRECT_LOCAL_ADDRESS =
  process.env["WEAI_DIRECT_LOCAL_ADDRESS"]?.trim() ?? "";
const WEAI_DIRECT_DNS_SERVERS = (
  process.env["WEAI_DIRECT_DNS_SERVERS"] ?? "223.5.5.5,119.29.29.29"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function weAITransportAgent(
  connect?: NonNullable<ConstructorParameters<typeof Agent>[0]>["connect"],
  localAddress?: string,
): Dispatcher1Wrapper {
  return new Dispatcher1Wrapper(
    new Agent({
      headersTimeout: WEAI_REQUEST_TIMEOUT_MS,
      bodyTimeout: WEAI_REQUEST_TIMEOUT_MS,
      ...(connect === undefined ? {} : { connect }),
      ...(localAddress === undefined ? {} : { localAddress }),
    }),
  );
}

function createWeAIDirectDispatcher(): Dispatcher1Wrapper | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(WEAI_DIRECT_LOCAL_ADDRESS))
    return undefined;

  const resolver = new Resolver();
  resolver.setServers(WEAI_DIRECT_DNS_SERVERS);
  resolver.setLocalAddress(WEAI_DIRECT_LOCAL_ADDRESS);
  const lookup: LookupFunction = (hostname, options, callback) => {
    resolver.resolve4(hostname, (error, addresses) => {
      if (error) {
        callback(error, "", 4);
        return;
      }
      if (options.all) {
        callback(
          null,
          addresses.map((address) => ({ address, family: 4 })),
        );
        return;
      }
      const address = addresses[0];
      if (address === undefined) {
        const noAddress = Object.assign(
          new Error(`No direct IPv4 address found for ${hostname}`),
          { code: "ENODATA" },
        );
        callback(noAddress, "", 4);
        return;
      }
      callback(null, address, 4);
    });
  };

  return weAITransportAgent(
    {
      keepAlive: true,
      keepAliveInitialDelay: WEAI_TCP_KEEPALIVE_INITIAL_DELAY_MS,
      lookup,
    },
    WEAI_DIRECT_LOCAL_ADDRESS,
  );
}

const WEAI_TRANSPORT_DISPATCHER = weAITransportAgent({
  keepAlive: true,
  keepAliveInitialDelay: WEAI_TCP_KEEPALIVE_INITIAL_DELAY_MS,
});
const WEAI_DIRECT_TRANSPORT_DISPATCHER = createWeAIDirectDispatcher();

function isWeAITokenEndpoint(
  input: Parameters<FetchImplementation>[0],
): boolean {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return (
      url.hostname === "we-token.cc" ||
      url.hostname.endsWith(".we-token.cc") ||
      url.hostname === "we-ai.cc" ||
      url.hostname.endsWith(".we-ai.cc")
    );
  } catch {
    return false;
  }
}

/**
 * We-AI needs the same long-lived, direct-network transport for its website
 * metadata endpoints as it does for image requests. Keep this exported so the
 * web app can refresh the official pricing catalogue without falling back to
 * the machine-wide proxy path.
 */
export const weAIFetch: FetchImplementation = (input, init) =>
  process.env["PROVIDER_HTTP_PROXY"] ||
  process.env["HTTPS_PROXY"] ||
  process.env["HTTP_PROXY"]
    ? providerFetch(input, init)
    : fetch(
        input,
        {
          ...init,
          dispatcher:
            WEAI_DIRECT_TRANSPORT_DISPATCHER !== undefined &&
            isWeAITokenEndpoint(input)
              ? WEAI_DIRECT_TRANSPORT_DISPATCHER
              : WEAI_TRANSPORT_DISPATCHER,
        } as RequestInit & { dispatcher: Dispatcher1Wrapper },
      );
const IMAGE_JSON_ENVELOPE_BYTES = 2 * 1024 * 1024;
const IMAGE_JSON_BYTES_PER_BASE64_OUTPUT = 48 * 1024 * 1024;
const IMAGE_URL_JSON_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const WEAI_ADOBE_TOKEN_GROUP = "生图-openai-adobe-token计费";
const WEAI_GEMINI_GROUP = "gemini香蕉";
const WEAI_AZURE_GROUP = "AZURE-openai";
const WEAI_ADOBE_PER_REQUEST_GROUP = "生图-openai-adobe-按次";
const WEAI_CODEX_TOKEN_GROUP = "生图-openai-codex-token计费";
const WEAI_ADOBE_PER_REQUEST_URL_GROUP = "生图-openai-adobe-按次-返回url";
const WEAI_GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-image";
const MIKOTO_GEMINI_GROUP = "Gemini 原生图片";
const MIKOTO_GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const WEAI_GEMINI_DEFAULT_IMAGE_SIZE = "4K";
const MIKOTO_GEMINI_DEFAULT_IMAGE_SIZE = "4K";
const WEAI_GEMINI_MAX_INPUT_IMAGES = 14;
const WEAI_GEMINI_MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;

function imageJsonMaxResponseBytes(
  parameters: Readonly<Record<string, unknown>> | undefined,
  returnsUrl: boolean,
  supplierKey?: string,
): number {
  // The 辰途 gateway is documented as URL-capable, but some model groups
  // still return a Base64 payload even when response_format=url is requested.
  // Use the normal Base64 budget for that supplier instead of the smaller URL
  // envelope limit, so successful 4K results are not rejected locally.
  if (returnsUrl && supplierKey !== "chentu")
    return IMAGE_URL_JSON_MAX_RESPONSE_BYTES;
  const requested = parameters?.["n"];
  const count =
    typeof requested === "number" &&
    Number.isSafeInteger(requested) &&
    requested >= 1 &&
    requested <= 10
      ? requested
      : 1;
  return IMAGE_JSON_ENVELOPE_BYTES + IMAGE_JSON_BYTES_PER_BASE64_OUTPUT * count;
}

export type WeAIGeminiProtocol =
  "gemini-generate-content" | "gemini-openai-compatible";

const WEAI_GEMINI_IMAGE_MODELS = new Set([
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
]);
const MIKOTO_GEMINI_IMAGE_MODELS = new Set([
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
]);
const MIKOTO_GEMINI_GROUPS = new Set([
  MIKOTO_GEMINI_GROUP,
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "香蕉2 1k2k",
  "香蕉pro 1k2k",
  "香蕉2",
  "香蕉pro",
  "gemini-2.5-flash-image",
  "香蕉2.5flash无4k",
]);
const MIKOTO_GEMINI_GROUP_MODELS: Readonly<Record<string, readonly string[]>> = {
  [MIKOTO_GEMINI_GROUP]: [
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
  ],
  "gemini-3.1-flash-image-preview": ["gemini-3.1-flash-image-preview"],
  "gemini-3-pro-image-preview": ["gemini-3-pro-image-preview"],
  "香蕉2 1k2k": ["gemini-3.1-flash-image-preview"],
  "香蕉pro 1k2k": ["gemini-3-pro-image-preview"],
  香蕉2: ["gemini-3.1-flash-image-preview"],
  香蕉pro: ["gemini-3-pro-image-preview"],
  "gemini-2.5-flash-image": ["gemini-2.5-flash-image"],
  "香蕉2.5flash无4k": ["gemini-2.5-flash-image"],
};
const MIKOTO_GEMINI_GROUP_SIZES: Readonly<
  Record<string, readonly string[]>
> = {
  [MIKOTO_GEMINI_GROUP]: ["1K", "2K", "4K"],
  "gemini-3.1-flash-image-preview": ["1K", "2K", "4K"],
  "gemini-3-pro-image-preview": ["1K", "2K", "4K"],
  香蕉2: ["1K", "2K"],
  香蕉pro: ["1K", "2K"],
  "香蕉2 1k2k": ["1K", "2K"],
  "香蕉pro 1k2k": ["1K", "2K"],
  "gemini-2.5-flash-image": ["1K", "2K", "4K"],
  "香蕉2.5flash无4k": ["1K", "2K"],
};
const ALL_GEMINI_IMAGE_MODELS = new Set([
  ...WEAI_GEMINI_IMAGE_MODELS,
  ...MIKOTO_GEMINI_IMAGE_MODELS,
]);

const WEAI_GEMINI_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "gemini-3-pro-image-preview": "gemini-3-pro-image",
  "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
};

const WEAI_GROUP_MODELS: Readonly<Record<string, readonly string[]>> = {
  [WEAI_ADOBE_TOKEN_GROUP]: ["gpt-image-2"],
  [WEAI_GEMINI_GROUP]: [...WEAI_GEMINI_IMAGE_MODELS],
  [WEAI_AZURE_GROUP]: ["gpt-image-2"],
  [WEAI_ADOBE_PER_REQUEST_GROUP]: [
    "gpt-image-2-low",
    "gpt-image-2-medium",
    "gpt-image-2-high",
  ],
  [WEAI_CODEX_TOKEN_GROUP]: ["gpt-image-2"],
  [WEAI_ADOBE_PER_REQUEST_URL_GROUP]: ["gpt-image-2"],
  [MIKOTO_GEMINI_GROUP]: [
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
  ],
};

function isGeminiImageModel(model: string): boolean {
  return ALL_GEMINI_IMAGE_MODELS.has(model);
}

function isMikotoGeminiGroup(group: string | undefined): boolean {
  return group !== undefined && MIKOTO_GEMINI_GROUPS.has(group);
}

function mikotoGeminiAllowedSizes(group: string | undefined): ReadonlySet<string> {
  return new Set(
    MIKOTO_GEMINI_GROUP_SIZES[group ?? MIKOTO_GEMINI_GROUP] ?? [
      "1K",
      "2K",
      "4K",
    ],
  );
}

function mikotoGeminiDefaultModel(group: string | undefined): string {
  return MIKOTO_GEMINI_GROUP_MODELS[group ?? MIKOTO_GEMINI_GROUP]?.[0] ??
    MIKOTO_GEMINI_DEFAULT_MODEL;
}

function canonicalWeAIGeminiModel(model: string): string {
  return WEAI_GEMINI_MODEL_ALIASES[model.trim()] ?? model.trim();
}

/**
 * New API gateways frequently label image routes by family rather than with
 * the literal word "image" (for example Nano Banana, FLUX, or Seedream).
 * FriModel is still queried live with the exact saved key; this only decides
 * which returned IDs are appropriate for an image node.
 */
function isFriModelImageCandidate(model: string): boolean {
  return /(?:image|banana|flux|seedream|imagen|dall-e|doubao|hunyuan|qwen[-_]?image|z[-_]?image|stable[-_]?diffusion|sdxl|wanx)/iu.test(
    model,
  );
}

/**
 * FriModel documents the multipart `/v1/images/edits` contract for its GPT
 * Image 2 OpenAI Images models. Other image-looking IDs remain generation
 * candidates until FriModel publishes an edit contract for them.
 */
function friModelSupportsImageEdit(model: string): boolean {
  return /^gpt-image-2(?:-|$)/iu.test(model.trim());
}

function isChentuImageCandidate(model: string): boolean {
  return /(?:image|dall-e|banana|flux|seedream|imagen|doubao|hunyuan|qwen[-_]?image|z[-_]?image|stable[-_]?diffusion|sdxl|wanx)/iu.test(
    model,
  );
}

function usesKeyedLiveImageInventory(supplierKey: string | undefined): boolean {
  return supplierKey === "frimodel" || supplierKey === "chentu";
}

const WEAI_GEMINI_ASPECT_RATIOS = new Set([
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
]);

const MIKOTO_GEMINI_ASPECT_RATIOS = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
]);

const WEAI_GEMINI_NATIVE_IMAGE_SIZES = new Set(["512", "1K", "2K", "4K"]);
const WEAI_GEMINI_COMPAT_IMAGE_SIZES = new Set(["1K", "2K", "4K"]);

type ImageProviderProfile = "openai" | "weai";

interface OpenAIModelList {
  data?: Array<{ id?: unknown }>;
}

interface GeminiModelList {
  models?: Array<{ name?: unknown }>;
  data?: Array<{ id?: unknown }>;
}

interface OpenAIImageData {
  b64_json?: unknown;
  url?: unknown;
  mime_type?: unknown;
  output_format?: unknown;
  revised_prompt?: unknown;
}

interface OpenAIImageResponse {
  created?: unknown;
  data?: OpenAIImageData[];
  output_format?: unknown;
}

interface FriModelChatChoice {
  message?: {
    content?: unknown;
    images?: unknown;
    image_url?: unknown;
  };
  text?: unknown;
}

interface FriModelChatResponse {
  created?: unknown;
  choices?: FriModelChatChoice[];
  data?: OpenAIImageData[];
}

interface GeminiInlineData {
  data?: unknown;
  mimeType?: unknown;
  mime_type?: unknown;
}

interface GeminiPart {
  inlineData?: unknown;
  inline_data?: unknown;
  text?: unknown;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
}

interface OpenAIImageTaskResult {
  response:
    OpenAIImageResponse | GeminiGenerateContentResponse | FriModelChatResponse;
  outputFormat: string;
  protocol?:
    | "openai-images"
    | "frimodel-images"
    | "frimodel-chat-completions"
    | WeAIGeminiProtocol;
}

interface ImageFormatDescriptor {
  format: "png" | "jpeg" | "webp";
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpeg" | "webp";
}

const IMAGE_FORMATS: Readonly<
  Record<ImageFormatDescriptor["format"], ImageFormatDescriptor>
> = {
  png: { format: "png", mimeType: "image/png", extension: "png" },
  jpeg: { format: "jpeg", mimeType: "image/jpeg", extension: "jpeg" },
  webp: { format: "webp", mimeType: "image/webp", extension: "webp" },
};

const SUPPORTED_INPUT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_EDIT_IMAGE_BYTES = 50 * 1024 * 1024;

const IMAGE_PARAMETER_DESCRIPTORS: readonly ModelParameterDescriptor[] = [
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
      { label: "横向 3:2", value: "3:2" },
      { label: "竖向 2:3", value: "2:3" },
    ],
    description:
      "自动模式优先读取提示词中的比例；提示词没有明确比例时跟随第一张参考图",
    operations: ["image.generate", "image.edit"],
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
    operations: ["image.generate", "image.edit"],
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
    operations: ["image.generate", "image.edit"],
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
    operations: ["image.generate", "image.edit"],
  },
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
    operations: ["image.generate", "image.edit"],
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
    operations: ["image.generate", "image.edit"],
  },
];

/**
 * FriModel's GPT Image guide documents the common 1K/2K/4K sizes below.
 * The four very narrow 1K entries in the published table fall below the
 * documented 655,360-pixel minimum, so they are intentionally omitted from
 * the selectable presets. The request path sends only documented FriModel
 * Images fields, including background and output_format.
 */
const FRIMODEL_GPT_IMAGE_SIZE_OPTIONS: readonly ModelParameterOption[] = [
  { label: "自动（提示词优先，其次参考图）", value: "auto" },
  { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
  { label: "1K · 2:3 · 1024 × 1536", value: "1024x1536" },
  { label: "1K · 3:2 · 1536 × 1024", value: "1536x1024" },
  { label: "1K · 3:4 · 768 × 1024", value: "768x1024" },
  { label: "1K · 4:3 · 1024 × 768", value: "1024x768" },
  { label: "1K · 4:5 · 768 × 960", value: "768x960" },
  { label: "1K · 5:4 · 960 × 768", value: "960x768" },
  { label: "1K · 9:16 · 1088 × 1920", value: "1088x1920" },
  { label: "1K · 16:9 · 1920 × 1088", value: "1920x1088" },
  { label: "1K · 21:9 · 1920 × 816", value: "1920x816" },
  { label: "1K · 9:21 · 816 × 1920", value: "816x1920" },
  { label: "2K · 1:1 · 2048 × 2048", value: "2048x2048" },
  { label: "2K · 2:3 · 2048 × 3072", value: "2048x3072" },
  { label: "2K · 3:2 · 3072 × 2048", value: "3072x2048" },
  { label: "2K · 3:4 · 2048 × 2736", value: "2048x2736" },
  { label: "2K · 4:3 · 2736 × 2048", value: "2736x2048" },
  { label: "2K · 4:5 · 1600 × 2000", value: "1600x2000" },
  { label: "2K · 5:4 · 2000 × 1600", value: "2000x1600" },
  { label: "2K · 9:16 · 1440 × 2560", value: "1440x2560" },
  { label: "2K · 16:9 · 2560 × 1440", value: "2560x1440" },
  { label: "2K · 21:9 · 2560 × 1104", value: "2560x1104" },
  { label: "2K · 9:21 · 1104 × 2560", value: "1104x2560" },
  { label: "4K · 1:1 · 2880 × 2880", value: "2880x2880" },
  { label: "4K · 2:3 · 2352 × 3520", value: "2352x3520" },
  { label: "4K · 3:2 · 3520 × 2352", value: "3520x2352" },
  { label: "4K · 3:4 · 2480 × 3312", value: "2480x3312" },
  { label: "4K · 4:3 · 3312 × 2480", value: "3312x2480" },
  { label: "4K · 4:5 · 2560 × 3200", value: "2560x3200" },
  { label: "4K · 5:4 · 3200 × 2560", value: "3200x2560" },
  { label: "4K · 9:16 · 2160 × 3840", value: "2160x3840" },
  { label: "4K · 16:9 · 3840 × 2160", value: "3840x2160" },
  { label: "4K · 21:9 · 3840 × 1648", value: "3840x1648" },
  { label: "4K · 9:21 · 1648 × 3840", value: "1648x3840" },
];

function friModelImageParameterDescriptors(
  modelId: string,
): readonly ModelParameterDescriptor[] {
  const fixedQuality = /^gpt-image-2-(low|medium|high)$/iu.exec(modelId.trim())?.[1]?.toLowerCase();
  return [
    {
      key: "size",
      label: "输出分辨率（size）",
      control: "dimensions",
      valueType: "string",
      default: "auto",
      min: 16,
      max: 3840,
      step: 16,
      options: FRIMODEL_GPT_IMAGE_SIZE_OPTIONS,
      description:
        "FriModel 官方文档支持 1K、2K、4K 常见尺寸；最长边不超过 3840px，两边需为 16 的倍数。",
      operations: ["image.generate", "image.edit"],
    },
    {
      key: "quality",
      label: "质量（quality）",
      control: "select",
      valueType: "string",
      default: "high",
      options: fixedQuality
        ? [
            {
              label: `${fixedQuality === "low" ? "低" : fixedQuality === "medium" ? "中" : "高"}（${fixedQuality}，模型固定）`,
              value: fixedQuality,
            },
          ]
        : [
            { label: "自动（auto）", value: "auto" },
            { label: "低（low）", value: "low" },
            { label: "中（medium）", value: "medium" },
            { label: "高（high）", value: "high" },
          ],
      description: fixedQuality
        ? `gpt-image-2-${fixedQuality} 是 FriModel 模型广场的固定${fixedQuality.toUpperCase()}质量模型。`
        : "FriModel 图片接口指南支持 auto、low、medium、high；默认使用 high。",
      operations: ["image.generate", "image.edit"],
    },
    {
      key: "background",
      label: "背景模式（background）",
      control: "select",
      valueType: "string",
      default: "auto",
      options: [
        { label: "自动（auto）", value: "auto" },
        { label: "不透明（opaque）", value: "opaque" },
        { label: "透明（transparent）", value: "transparent" },
      ],
      description: "FriModel 图片生成文档支持 auto、opaque、transparent。",
      operations: ["image.generate", "image.edit"],
    },
    {
      key: "output_format",
      label: "输出格式（output_format）",
      control: "select",
      valueType: "string",
      default: "png",
      options: [
        { label: "PNG", value: "png" },
        { label: "JPEG", value: "jpeg" },
        { label: "WebP", value: "webp" },
      ],
      description: "FriModel 图片生成文档支持 png、jpeg、webp；响应通过 b64_json 返回。",
      operations: ["image.generate", "image.edit"],
    },
  ];
}

function friModelPriceLabel(modelId: string, group?: string): string | undefined {
  const id = modelId.trim().toLowerCase();
  if (id === "gpt-image-2-adobe") return "$0.05/图片";
  if (id === "gpt-image-2-high") return "$0.09/请求";
  if (id.includes("gemini") && id.includes("image"))
    return "$0.1/请求";
  if (id === "gpt-image-2-w" || id === "gpt-image-2-wc")
    return "$0.025/请求";
  if (id === "gpt-image-2")
    return group === "gpt_image_adobe" ? "$0.05/图片" : "$0.025/请求";
  return undefined;
}

const CHENTU_GPT_1K_SIZES = [
  "auto",
  "720x1280",
  "1280x720",
  "1024x1024",
  "1024x768",
  "768x1024",
  "1680x720",
  "1824x1024",
  "1024x1824",
  "1344x1024",
  "1024x1344",
  "1536x1024",
  "1024x1536",
  "1792x768",
  "768x1792",
  "1792x1024",
  "1024x1792",
] as const;
const CHENTU_GPT_2K_SIZES = [
  "2048x2048",
  "2048x1360",
  "1360x2048",
  "2048x1152",
  "1152x2048",
  "2048x1536",
  "1536x2048",
  "2048x896",
  "896x2048",
] as const;
const CHENTU_GPT_4K_SIZES = [
  "2880x2880",
  "3520x2336",
  "2336x3520",
  "3840x2160",
  "2160x3840",
  "3312x2480",
  "2480x3312",
  "3840x1648",
  "1648x3840",
] as const;
const CHENTU_GPT_FREE_SIZES = [
  "auto",
  ...CHENTU_GPT_1K_SIZES.slice(1),
  ...CHENTU_GPT_2K_SIZES,
  ...CHENTU_GPT_4K_SIZES,
] as const;
const CHENTU_GEMINI_1K_SIZES = [
  "1024x1024",
  "848x1264",
  "1264x848",
  "896x1200",
  "1200x896",
  "928x1152",
  "1152x928",
  "768x1376",
  "1376x768",
  "1584x672",
] as const;
const CHENTU_GEMINI_2K_SIZES = [
  "2048x2048",
  "1696x2528",
  "2528x1696",
  "1792x2400",
  "2400x1792",
  "1856x2304",
  "2304x1856",
  "1536x2752",
  "2752x1536",
  "3168x1344",
] as const;
const CHENTU_GEMINI_4K_SIZES = [
  "4096x4096",
  "3392x5056",
  "5056x3392",
  "3584x4800",
  "4800x3584",
  "3712x4608",
  "4608x3712",
  "3072x5504",
  "5504x3072",
  "6336x2688",
] as const;

const CHENTU_GPT_1K_RATIOS = [
  "自动",
  "9:16",
  "16:9",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "9:21",
  "7:4",
  "4:7",
] as const;
const CHENTU_GPT_HIGH_RES_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
  "9:21",
] as const;
const CHENTU_GPT_FREE_RATIOS = [
  "自动",
  ...CHENTU_GPT_1K_RATIOS.slice(1),
  ...CHENTU_GPT_HIGH_RES_RATIOS,
  ...CHENTU_GPT_HIGH_RES_RATIOS,
] as const;

type ChentuResolutionTier = "1K" | "2K" | "4K";

function isChentuFlexibleSizeModel(model: string): boolean {
  return /自由传参/iu.test(model);
}

function chentuModelResolutionTier(
  model: string,
): ChentuResolutionTier | undefined {
  if (/^gpt-image-2(?:-1k)?$/u.test(model)) return "1K";
  if (/^gpt-image-2-2k$/u.test(model)) return "2K";
  if (/^gpt-image-2-4k$/u.test(model)) return "4K";
  if (/^gemini-.*-image-1k$/u.test(model)) return "1K";
  if (/^gemini-.*-image-2k$/u.test(model)) return "2K";
  if (/^gemini-.*-image-4k$/u.test(model)) return "4K";
  return undefined;
}
const CHENTU_GEMINI_RATIOS = [
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
] as const;

function chentuAllowedSizes(model: string): readonly string[] {
  if (/^gpt-image-2(?:-1k)?$/u.test(model)) return CHENTU_GPT_1K_SIZES;
  if (model === "gpt-image-2-2k") return CHENTU_GPT_2K_SIZES;
  if (model === "gpt-image-2-4k") return CHENTU_GPT_4K_SIZES;
  if (/^gemini-.*-image-1k$/u.test(model)) return CHENTU_GEMINI_1K_SIZES;
  if (/^gemini-.*-image-2k$/u.test(model)) return CHENTU_GEMINI_2K_SIZES;
  if (/^gemini-.*-image-4k$/u.test(model)) return CHENTU_GEMINI_4K_SIZES;
  return [];
}

function chentuSizeRatios(model: string): readonly string[] {
  if (/^gpt-image-2(?:-1k)?$/u.test(model)) return CHENTU_GPT_1K_RATIOS;
  if (/^gpt-image-2-(?:2k|4k)$/u.test(model)) return CHENTU_GPT_HIGH_RES_RATIOS;
  if (/^gemini-.*-image-(?:1k|2k|4k)$/u.test(model))
    return CHENTU_GEMINI_RATIOS;
  return [];
}

function chentuSizeOptions(model: string) {
  const flexible = isChentuFlexibleSizeModel(model);
  const sizes = flexible ? CHENTU_GPT_FREE_SIZES : chentuAllowedSizes(model);
  const ratios = flexible ? CHENTU_GPT_FREE_RATIOS : chentuSizeRatios(model);
  return sizes.map((value, index) => {
    const ratio = ratios[index];
    const tier = flexible
      ? index === 0
        ? undefined
        : index < CHENTU_GPT_1K_SIZES.length
          ? "1K"
          : index < CHENTU_GPT_1K_SIZES.length + CHENTU_GPT_2K_SIZES.length
            ? "2K"
            : "4K"
      : chentuModelResolutionTier(model);
    return {
      label:
        value === "auto"
          ? "自动（提示词优先，其次参考图）"
          : ratio
            ? `${tier ? `${tier} · ` : ""}${ratio} · ${value.replace("x", " × ")}`
            : value.replace("x", " × "),
      value,
    };
  });
}

function chentuModelPrice(model: string, group?: string): string {
  if (isChentuOfficialModelGroup(group)) return "￥ 0.18 / 请求";
  if (model === "gpt-image-2") return "￥ 0.015 / 请求";
  if (model === "gpt-image-2-1k" || model === "gpt-image-2-2k")
    return "￥ 0.022 / 请求";
  if (model === "gpt-image-2-4k" || model === "gpt-image-2自由传参")
    return "￥ 0.05 / 请求";
  if (/^gemini-3\.1-flash-image-(?:1k|2k|4k)$/u.test(model))
    return "￥ 0.06 / 请求";
  if (/^gemini-3-pro-image-(?:1k|2k|4k)$/u.test(model)) return "￥ 0.09 / 请求";
  return "以辰途模型广场为准";
}

function isChentuGptImageModel(model: string): boolean {
  return /^gpt-image-2(?:-|$)/u.test(model) || model === "gpt-image-2自由传参";
}

function chentuModelDisplayName(model: string): string {
  if (model === "gpt-image-2自由传参") return "GPT Image 2 · 自由传参";
  return model
    .replace(/^gemini-3\.1-flash-image-/u, "Gemini 3.1 Flash Image · ")
    .replace(/^gemini-3-pro-image-/u, "Gemini 3 Pro Image · ")
    .replace(/^gpt-image-2-/u, "GPT Image 2 · ")
    .replace(/^gpt-image-2$/u, "GPT Image 2");
}

function chentuOfficialQuality(_model: string): "standard" {
  // 辰途当前 image2 官 key 文档将 quality 标为 standard 默认值；
  // 省略该字段可让分组按模型档位自行路由，避免旧画布的 high/low 值
  // 把请求送进不兼容的渠道。
  return "standard";
}

function chentuModelDescriptor(
  id: string,
  isDefault: boolean,
  group?: string,
): ModelDescriptor {
  const sizes = chentuAllowedSizes(id);
  const sizeOptions = chentuSizeOptions(id);
  const supportsQuality = isChentuGptImageModel(id);
  const supportsCustomSize = isChentuFlexibleSizeModel(id);
  const officialGroup = isChentuOfficialModelGroup(group);
  const price = chentuModelPrice(id, group);
  const outputFormat = IMAGE_PARAMETER_DESCRIPTORS.find(
    (parameter) => parameter.key === "output_format",
  );
  const quality = IMAGE_PARAMETER_DESCRIPTORS.find(
    (parameter) => parameter.key === "quality",
  );
  const officialQuality = chentuOfficialQuality(id);
  const sizeParameter: ModelParameterDescriptor = supportsCustomSize
    ? {
        key: "size",
        label: "输出分辨率（size）",
        control: "dimensions",
        valueType: "string",
        default: "auto",
        min: 16,
        max: 8192,
        step: 16,
        options: sizeOptions,
        description:
          "自动模式优先读取提示词中的比例，其次参考图；选择 1K、2K 或 4K 后显示对应常用尺寸，也可填写自定义像素尺寸。",
        operations: ["image.generate", "image.edit"],
      }
    : sizes.length > 0 && sizes[0] !== undefined
      ? {
          key: "size",
          label: "精确尺寸（辰途文档）",
          control: "select",
          valueType: "string",
          default: sizes[0],
          options: sizeOptions,
          description:
            "尺寸必须来自该模型的辰途 API 文档；不要按倍率自行换算。",
          operations: ["image.generate", "image.edit"],
        }
      : {
          key: "size",
          label: "自定义尺寸",
          control: "text",
          valueType: "string",
          placeholder: "例如 3360x4480",
          description:
            "可直接填写像素尺寸；提交前请先用实际请求验证该渠道是否接受目标比例。",
          operations: ["image.generate", "image.edit"],
        };
  return {
    id,
    name: `${chentuModelDisplayName(id)}（${price}）`,
    description: supportsCustomSize
      ? `辰途 API 自由传参图片模型；价格 ${price}，可直接填写供应商支持的自定义尺寸。`
      : `辰途 API 图片模型；价格 ${price}。模型权限通过当前 API Key 的 /v1/models 实时扫描，尺寸仅开放官方文档列出的精确值。`,
    operations: ["image.generate", "image.edit"],
    parameters: [
      sizeParameter,
      {
        key: "n",
        label: "生成张数",
        control: "number",
        valueType: "integer",
        default: 1,
        min: 1,
        max: officialGroup ? 10 : 1,
        step: 1,
        description: officialGroup
          ? "image2 官 key 官方文档支持每次生成 1–10 张。"
          : "同步画布任务一次生成 1 张；批量或高分辨率任务请拆分或使用供应商异步接口。",
        operations: ["image.generate", "image.edit"],
      },
      {
        key: "response_format",
        label: "返回方式",
        control: "select",
        valueType: "string",
        default: "url",
        options: [{ label: "URL（推荐，辰途链接有效 2 小时）", value: "url" }],
        operations: ["image.generate", "image.edit"],
      },
      ...(supportsQuality && quality
        ? [
            {
              ...quality,
              ...(officialGroup
                ? {
                    default: officialQuality,
                    options: [
                      {
                        label:
                          officialQuality === "standard"
                            ? "标准（standard）"
                            : `${officialQuality === "high" ? "高" : officialQuality === "medium" ? "中" : "低"}（${officialQuality}，模型档位固定）`,
                        value: officialQuality,
                      },
                    ],
                    description: "image2 官 key 按辰途官方文档使用默认 standard 质量；提交时省略该字段。",
                    operations: ["image.generate"],
                  }
                : {
                    description:
                      "辰途会把 quality 原样转发给 GPT Image 2；实际是否生效以目标模型为准。",
                  }),
            } as ModelParameterDescriptor,
          ]
        : []),
      ...(officialGroup && supportsQuality
        ? [
            {
              key: "style",
              label: "画风（style）",
              control: "select",
              valueType: "string",
              default: "vivid",
              options: [{ label: "鲜明（vivid）", value: "vivid" }],
              description: "image2 官 key 官方文档支持 vivid 画风。",
              operations: ["image.generate"],
            } as ModelParameterDescriptor,
          ]
        : []),
      ...(!officialGroup && outputFormat ? [outputFormat] : []),
    ],
    limits: {
      maxInputImages: 10,
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
    metadata: { supplier: "chentu", liveInventory: true },
    isDefault,
  };
}

const WEAI_IMAGE_PARAMETER_DESCRIPTORS: readonly ModelParameterDescriptor[] = [
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
    operations: ["image.generate", "image.edit"],
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
    operations: ["image.generate", "image.edit"],
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
    description: "当前 CODEX 分组单次仅支持 1 张；批量任务请在画布中拆分",
    operations: ["image.generate", "image.edit"],
  },
];

const WEAI_GEMINI_NATIVE_PARAMETER_DESCRIPTORS: readonly ModelParameterDescriptor[] =
  [
    {
      key: "aspect_ratio",
      label: "画面比例",
      control: "select",
      valueType: "string",
      default: "auto",
      options: [
        { label: "自动", value: "auto" },
        ...[...WEAI_GEMINI_ASPECT_RATIOS].map((value) => ({
          label: value,
          value,
        })),
      ],
      operations: ["image.generate", "image.edit"],
    },
    {
      key: "image_size",
      label: "输出分辨率",
      control: "select",
      valueType: "string",
      default: WEAI_GEMINI_DEFAULT_IMAGE_SIZE,
      options: [
        {
          label: "自动（提示词优先，其次参考图）",
          value: "auto",
        },
        ...[...WEAI_GEMINI_NATIVE_IMAGE_SIZES].map((value) => ({
          label: value === "512" ? "512 px" : value,
          value,
        })),
      ],
      description:
        "自动时不发送固定 imageSize，由模型优先按提示词决定，其次参考图",
      operations: ["image.generate", "image.edit"],
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
      description: "We-AI Gemini 单次固定生成 1 张",
      operations: ["image.generate", "image.edit"],
    },
  ];

const WEAI_GEMINI_COMPAT_PARAMETER_DESCRIPTORS: readonly ModelParameterDescriptor[] =
  [
    WEAI_GEMINI_NATIVE_PARAMETER_DESCRIPTORS[0]!,
    {
      key: "size",
      label: "输出分辨率",
      control: "select",
      valueType: "string",
      default: WEAI_GEMINI_DEFAULT_IMAGE_SIZE,
      options: [
        {
          label: "自动（提示词优先，其次参考图）",
          value: "auto",
        },
        ...[...WEAI_GEMINI_COMPAT_IMAGE_SIZES].map((value) => ({
          label: value,
          value,
        })),
      ],
      description: "自动时不发送固定 size；手动档位支持 1K、2K、4K",
      operations: ["image.generate", "image.edit"],
    },
    WEAI_GEMINI_NATIVE_PARAMETER_DESCRIPTORS[2]!,
  ];

const MIKOTO_GEMINI_PARAMETER_DESCRIPTORS: readonly ModelParameterDescriptor[] =
  [
    {
      key: "aspect_ratio",
      label: "画面比例",
      control: "select",
      valueType: "string",
      default: "auto",
      options: [
        { label: "自动", value: "auto" },
        ...[...MIKOTO_GEMINI_ASPECT_RATIOS].map((value) => ({
          label: value,
          value,
        })),
      ],
      operations: ["image.generate", "image.edit"],
    },
    {
      key: "image_size",
      label: "输出分辨率",
      control: "select",
      valueType: "string",
      default: MIKOTO_GEMINI_DEFAULT_IMAGE_SIZE,
      options: [...WEAI_GEMINI_COMPAT_IMAGE_SIZES].map((value) => ({
        label: value,
        value,
      })),
      description: "MikotoPro 官方文档只支持 1K、2K、4K 档位",
      operations: ["image.generate", "image.edit"],
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
      description: "MikotoPro Gemini 单次固定生成 1 张",
      operations: ["image.generate", "image.edit"],
    },
  ];

const WEAI_OPTIONAL_QUALITY_DESCRIPTOR: ModelParameterDescriptor = {
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
  description: "不设置时不发送 quality，由 We-AI 渠道采用服务端默认值",
  operations: ["image.generate", "image.edit"],
};

const WEAI_RESPONSE_FORMAT_DESCRIPTOR: ModelParameterDescriptor = {
  key: "response_format",
  label: "返回方式",
  control: "select",
  valueType: "string",
  default: "url",
  options: [{ label: "URL（供应商要求，避免大图断线）", value: "url" }],
  description:
    "We-AI 供应商要求 Adobe 按次请求固定发送 response_format: url，避免大体积 Base64 回传时连接中断。",
  operations: ["image.generate", "image.edit"],
};

const WEAI_MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "gpt-image-1": "GPT Image 1",
  "gpt-image-1.5": "GPT Image 1.5",
  "gpt-image-2": "GPT Image 2",
  "gpt-image-2-low": "GPT Image 2 LOW",
  "gpt-image-2-medium": "GPT Image 2 MEDIUM",
  "gpt-image-2-high": "GPT Image 2 HIGH",
  "gemini-3-pro-image": "Gemini 3 Pro Image",
  "gemini-3-pro-image-preview": "Gemini 3 Pro Image Preview（Pro 别名）",
  "gemini-3.1-flash-image": "Gemini 3.1 Flash Image",
};

function weAIModelDisplayName(id: string, group?: string): string {
  const base = WEAI_MODEL_DISPLAY_NAMES[id] ?? id;
  const supportsKResolutionTiers = /^gpt-image-2(?:-|$)/u.test(id);
  const resolutionSuffix = supportsKResolutionTiers ? " · 1K/2K/4K" : "";
  if (group === WEAI_ADOBE_PER_REQUEST_GROUP) {
    const quality = /^gpt-image-2-(low|medium|high)$/u.exec(id)?.[1];
    const price = quality ? WEAI_ADOBE_PER_REQUEST_PRICES[id] : undefined;
    if (price) return `${base}（${price}/次${resolutionSuffix}）`;
  }
  if (group === WEAI_ADOBE_PER_REQUEST_URL_GROUP && id === "gpt-image-2")
    return `${base}（LOW $0.04/次 · MEDIUM $0.07/次 · HIGH $0.15/次${resolutionSuffix} · 返回 URL）`;
  if (group === WEAI_GEMINI_GROUP) {
    const pro = id.includes("pro-image");
    return pro
      ? `${base}（1K $0.06/张 · 2K $0.08/张 · 4K $0.10/张）`
      : `${base}（1K $0.04/张 · 2K $0.06/张 · 4K $0.08/张）`;
  }
  if (isMikotoGeminiGroup(group)) {
    const price =
      group === "gemini-2.5-flash-image" || group === "香蕉2.5flash无4k"
        ? "$0.035"
        : id.includes("pro-image")
          ? "$0.12"
          : "$0.08";
    const sizeLabel = (
      (group ? MIKOTO_GEMINI_GROUP_SIZES[group] : undefined) ?? [
        "1K",
        "2K",
        "4K",
      ]
    ).join("/");
    return `${base}（${sizeLabel} · ${price}/张）`;
  }
  if (group === WEAI_ADOBE_TOKEN_GROUP)
    return `${base}（1× Token${resolutionSuffix}）`;
  if (group === WEAI_AZURE_GROUP)
    return `${base}（3× Token${resolutionSuffix}）`;
  if (group === WEAI_CODEX_TOKEN_GROUP)
    return `${base}（0.7× Token${resolutionSuffix}）`;
  if (isGeminiImageModel(id)) return `${base}（Gemini 原生）`;
  return `${base}（We-AI${resolutionSuffix}）`;
}

function weAIMaxOutputCount(model: string, group?: string): number {
  if (group === WEAI_GEMINI_GROUP || isMikotoGeminiGroup(group) || group === WEAI_CODEX_TOKEN_GROUP)
    return 1;
  if (
    group === WEAI_ADOBE_TOKEN_GROUP ||
    group === WEAI_ADOBE_PER_REQUEST_GROUP ||
    group === WEAI_ADOBE_PER_REQUEST_URL_GROUP ||
    group === WEAI_AZURE_GROUP
  )
    return 10;
  return /^gpt-image-2-(?:low|medium|high)$/u.test(model) ? 10 : 1;
}

function weAIParametersForModel(
  model: string,
  group?: string,
  geminiProtocol: WeAIGeminiProtocol = "gemini-generate-content",
): readonly ModelParameterDescriptor[] {
  if (isMikotoGeminiGroup(group)) {
    const sizes = mikotoGeminiAllowedSizes(group);
    const defaultSize = [...sizes].at(-1);
    return MIKOTO_GEMINI_PARAMETER_DESCRIPTORS.map((parameter) =>
      parameter.key === "image_size"
        ? {
            ...parameter,
            options: [...sizes].map((value) => ({ label: value, value })),
            ...(defaultSize === undefined ? {} : { default: defaultSize }),
          }
        : parameter,
    );
  }
  if (isGeminiImageModel(model))
    return geminiProtocol === "gemini-openai-compatible"
      ? WEAI_GEMINI_COMPAT_PARAMETER_DESCRIPTORS
      : WEAI_GEMINI_NATIVE_PARAMETER_DESCRIPTORS;
  const max = weAIMaxOutputCount(model, group);
  const supportsKResolutionTiers = /^gpt-image-2(?:-|$)/u.test(model);
  const descriptors = WEAI_IMAGE_PARAMETER_DESCRIPTORS.map((descriptor) => {
    if (descriptor.key === "n")
      return {
        ...descriptor,
        max,
        description:
          max === 1
            ? "当前分组单次仅支持 1 张；批量任务请在画布中拆分"
            : "当前分组单次最多生成 10 张",
      };
    if (descriptor.key === "size" && !supportsKResolutionTiers)
      return {
        ...descriptor,
        options: (descriptor.options ?? []).filter((option) =>
          ["auto", "1024x1024", "1536x1024", "1024x1536"].includes(
            String(option.value),
          ),
        ),
        description:
          "作为 Images API 的 size 请求参数发送，不会写进提示词；当前模型使用 OpenAI 官方标准尺寸",
      };
    return descriptor;
  });
  const supportsOptionalQuality =
    group === WEAI_ADOBE_TOKEN_GROUP ||
    group === WEAI_AZURE_GROUP ||
    group === WEAI_ADOBE_PER_REQUEST_URL_GROUP;
  const supportsUrlResponse = group === WEAI_ADOBE_PER_REQUEST_GROUP;
  // Adobe per-request supports response_format: url, but We-AI only documents
  // the standard output_format/output_compression extensions for the other
  // compatible image routes.
  const supportsComplexOutputParameters = supportsOptionalQuality;
  const extensions: ModelParameterDescriptor[] = [
    ...(supportsOptionalQuality ? [WEAI_OPTIONAL_QUALITY_DESCRIPTOR] : []),
    ...(supportsComplexOutputParameters
      ? IMAGE_PARAMETER_DESCRIPTORS.filter((descriptor) =>
          ["output_format", "output_compression"].includes(descriptor.key),
        )
      : []),
    ...(supportsUrlResponse ? [WEAI_RESPONSE_FORMAT_DESCRIPTOR] : []),
  ];
  return descriptors.flatMap((descriptor) =>
    descriptor.key === "n" ? [...extensions, descriptor] : [descriptor],
  );
}

function weAIModelDescriptor(
  id: string,
  isDefault: boolean,
  group?: string,
  geminiProtocol: WeAIGeminiProtocol = "gemini-generate-content",
): ModelDescriptor {
  const isGemini = isGeminiImageModel(id);
  const quality = /^gpt-image-2-(low|medium|high)$/u.exec(id)?.[1];
  const supportsKResolutionTiers = /^gpt-image-2(?:-|$)/u.test(id);
  const maxOutputCount = weAIMaxOutputCount(id, group);
  const descriptor: ModelDescriptor = {
    id,
    name: weAIModelDisplayName(id, group),
    description: isGemini
      ? isMikotoGeminiGroup(group)
        ? `MikotoPro Gemini 原生 generateContent 生图模型；当前分组支持 ${(
            (group ? MIKOTO_GEMINI_GROUP_SIZES[group] : undefined) ?? [
              "1K",
              "2K",
              "4K",
            ]
          ).join("、")} 和官方文档画面比例`
        : geminiProtocol === "gemini-openai-compatible"
          ? "We-AI Gemini OpenAI 兼容 Images API 生图模型；价格按 1K、2K、4K 档位计算"
          : "We-AI Gemini 原生 generateContent 生图模型；价格按 1K、2K、4K 档位计算"
      : quality
        ? `We-AI Adobe 按次模型；${quality.toUpperCase()} 画质固定，支持 1K、2K、4K 输出`
        : group === WEAI_ADOBE_PER_REQUEST_URL_GROUP
          ? "We-AI Adobe 独立按次 URL 线路；通过 quality 选择 LOW、MEDIUM、HIGH，支持 1K、2K、4K 输出"
          : supportsKResolutionTiers
            ? "We-AI 图片模型；支持文档列出的 1K、2K、4K 常用尺寸与自定义精确尺寸"
            : "We-AI 图片模型；使用 OpenAI 官方标准输出尺寸",
    operations: ["image.generate", "image.edit"],
    parameters: weAIParametersForModel(id, group, geminiProtocol),
    isDefault,
    limits: {
      ...(isGemini
        ? isMikotoGeminiGroup(group)
          ? {}
          : { maxInputImages: WEAI_GEMINI_MAX_INPUT_IMAGES }
        : { maxInputImages: 16 }),
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
    metadata: {
      ...(maxOutputCount === 1 ? { fixedOutputCount: 1 } : {}),
      ...(quality ? { fixedQuality: quality } : {}),
      ...(isGemini
        ? {
            protocol: geminiProtocol,
            ...(WEAI_GEMINI_MODEL_ALIASES[id]
              ? { aliasFor: WEAI_GEMINI_MODEL_ALIASES[id] }
              : {}),
          }
        : {}),
      ...(group ? { modelGroup: group } : {}),
    },
  };
  return descriptor;
}

function friModelModelDescriptor(
  id: string,
  isDefault: boolean,
  group?: string,
): ModelDescriptor {
  const priceLabel = friModelPriceLabel(id, group);
  const supportsImageEdit = friModelSupportsImageEdit(id);
  return {
    id,
    name: `${id}（FriModel）`,
    description:
      supportsImageEdit
        ? "FriModel 官方文档中的 OpenAI Images 图片模型；支持 /v1/images/generations 与 /v1/images/edits，返回 data[0].b64_json。"
        : "FriModel OpenAI Images 图片模型；当前仅确认 /v1/images/generations 生图协议。",
    operations: supportsImageEdit
      ? ["image.generate", "image.edit"]
      : ["image.generate"],
    inputKinds: supportsImageEdit ? ["text", "image"] : ["text"],
    outputKinds: ["image"],
    parameters: friModelImageParameterDescriptors(id),
    isDefault,
    limits: {
      ...(supportsImageEdit ? { maxInputImages: 10 } : {}),
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
    metadata: {
      protocol: "frimodel-images",
      liveInventory: true,
      supportsImageEdit,
      ...(supportsImageEdit
        ? { referenceEditEndpoint: "/v1/images/edits" }
        : {}),
      // FriModel image groups currently return one image per request. An
      // OpenAI-compatible `n` value may be accepted but is not materialized
      // as multiple outputs, so the canvas must keep this model single-output.
      fixedOutputCount: 1,
      ...(priceLabel ? { priceLabel } : {}),
      ...(group ? { modelGroup: group } : {}),
    },
  };
}

function gptImage2SizeIssue(value: string): string | undefined {
  if (value === "auto") return undefined;
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (!match) return "must be auto or WIDTHxHEIGHT";
  const width = Number(match[1]);
  const height = Number(match[2]);
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const pixels = width * height;
  if (width % 16 !== 0 || height % 16 !== 0)
    return "edges must be multiples of 16 pixels";
  if (longEdge > 3840) return "maximum edge length is 3840 pixels";
  if (longEdge / shortEdge > 3) return "edge ratio cannot exceed 3:1";
  if (pixels < 655_360 || pixels > 8_294_400)
    return "total pixels must be between 655360 and 8294400";
  return undefined;
}

const IMAGE_MODELS: readonly ModelDescriptor[] = [
  {
    id: DEFAULT_MODEL,
    name: "GPT Image 2",
    operations: ["image.generate", "image.edit"],
    parameters: IMAGE_PARAMETER_DESCRIPTORS,
    isDefault: true,
    limits: {
      maxInputImages: 16,
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
  },
  {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5",
    operations: ["image.generate", "image.edit"],
    parameters: IMAGE_PARAMETER_DESCRIPTORS,
  },
  {
    id: "gpt-image-1",
    name: "GPT Image 1",
    operations: ["image.generate", "image.edit"],
    parameters: IMAGE_PARAMETER_DESCRIPTORS,
  },
];

function aspectRatioValue(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/iu.exec(
    value.trim(),
  );
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

function chentuResolutionTier(
  value: unknown,
): ChentuResolutionTier | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized === "1K" || normalized === "2K" || normalized === "4K"
    ? normalized
    : undefined;
}

function chentuResolutionCandidates(tier: ChentuResolutionTier) {
  const sizes =
    tier === "1K"
      ? CHENTU_GPT_1K_SIZES.slice(1)
      : tier === "2K"
        ? CHENTU_GPT_2K_SIZES
        : CHENTU_GPT_4K_SIZES;
  const ratios =
    tier === "1K" ? CHENTU_GPT_1K_RATIOS.slice(1) : CHENTU_GPT_HIGH_RES_RATIOS;
  return sizes.flatMap((size, index) => {
    const ratio = aspectRatioValue(ratios[index]);
    return ratio === undefined ? [] : [{ ratio, size }];
  });
}

function chentuSizeForResolutionTier(
  tierValue: unknown,
  aspectRatio?: unknown,
): string | undefined {
  const tier = chentuResolutionTier(tierValue);
  if (!tier) return undefined;
  const candidates = chentuResolutionCandidates(tier);
  if (candidates.length === 0) return undefined;
  const requested = aspectRatioValue(aspectRatio);
  if (!requested)
    return (
      candidates.find((candidate) => candidate.ratio === 1)?.size ??
      candidates[0]?.size
    );
  return candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(Math.log(best.ratio / requested));
    const candidateDistance = Math.abs(Math.log(candidate.ratio / requested));
    return candidateDistance < bestDistance ? candidate : best;
  }).size;
}

function sizeFromAspectRatio(
  value: unknown,
  model: string,
): string | undefined {
  if (value === "auto") return "auto";
  const ratio = aspectRatioValue(value);
  if (!ratio) return undefined;

  if (!/^gpt-image-2(?:-|$)/u.test(model)) {
    if (ratio > 1.1) return "1536x1024";
    if (ratio < 0.9) return "1024x1536";
    return "1024x1024";
  }

  // GPT Image 2 accepts flexible dimensions. Keep the result near one
  // megapixel, align both edges to 16 px, and honor its 3:1 ratio limit.
  const boundedRatio = Math.min(3, Math.max(1 / 3, ratio));
  const targetPixels = 1024 * 1024;
  const width = Math.max(
    16,
    Math.round(Math.sqrt(targetPixels * boundedRatio) / 16) * 16,
  );
  const height = Math.max(
    16,
    Math.round(Math.sqrt(targetPixels / boundedRatio) / 16) * 16,
  );
  return `${width}x${height}`;
}

const OPENAI_IMAGE_PARAMETER_KEYS = [
  "background",
  "moderation",
  "n",
  "output_compression",
  "output_format",
  "quality",
  "size",
  "user",
] as const;

type OpenAIImageParameterKey = (typeof OPENAI_IMAGE_PARAMETER_KEYS)[number];
type WeAIImageParameterKey = OpenAIImageParameterKey | "response_format" | "style";
const FRIMODEL_IMAGE_PARAMETER_KEYS = [
  "size",
  "quality",
  "background",
  "output_format",
] as const;
type FriModelImageParameterKey = (typeof FRIMODEL_IMAGE_PARAMETER_KEYS)[number];
const CHENTU_IMAGE_PARAMETER_KEYS: readonly WeAIImageParameterKey[] = [
  ...OPENAI_IMAGE_PARAMETER_KEYS,
  "response_format",
];
const CHENTU_OFFICIAL_IMAGE_PARAMETER_KEYS: readonly WeAIImageParameterKey[] = [
  "n",
  "size",
  "response_format",
  "quality",
  "style",
];

function isChentuOfficialModelGroup(group: string | undefined): boolean {
  return group === "image2官key" || group === "image2官key生图";
}

function chentuImageParameterKeys(
  model: string,
  group?: string,
): readonly WeAIImageParameterKey[] {
  const keys = isChentuOfficialModelGroup(group)
    ? CHENTU_OFFICIAL_IMAGE_PARAMETER_KEYS
    : CHENTU_IMAGE_PARAMETER_KEYS;
  return isChentuGptImageModel(model)
    ? keys
    : keys.filter((key) => key !== "quality");
}

function weAIImageParameterKeys(
  group?: string,
): readonly WeAIImageParameterKey[] {
  if (group === WEAI_CODEX_TOKEN_GROUP) return ["n", "size"];
  if (group === WEAI_ADOBE_PER_REQUEST_GROUP)
    return ["n", "size", "response_format"];
  if (group === WEAI_ADOBE_TOKEN_GROUP || group === WEAI_AZURE_GROUP)
    return OPENAI_IMAGE_PARAMETER_KEYS;
  if (group === WEAI_ADOBE_PER_REQUEST_URL_GROUP)
    return ["n", "quality", "size"];
  return ["n", "size"];
}

function friModelImageParameters(
  parameters: Readonly<Record<string, unknown>> | undefined,
  model?: string,
): Record<string, unknown> {
  const result = Object.fromEntries(
    FRIMODEL_IMAGE_PARAMETER_KEYS.flatMap((key) => {
      const value = parameters?.[key];
      return value === undefined || key === "size"
        ? []
        : [[key, value]];
    }),
  );
  const rawSize = parameters?.["size"];
  const sizeTier =
    typeof parameters?.["size_tier"] === "string"
      ? parameters["size_tier"].trim().toUpperCase()
      : "";
  const normalizedModel = model?.trim().toLowerCase() ?? "";
  const isGptImage2 = normalizedModel.startsWith("gpt-image-2");
  if (typeof rawSize === "string" && rawSize.trim().toLowerCase() !== "auto") {
    result.size = rawSize.trim();
  } else if (isGptImage2 && ["1K", "2K", "4K"].includes(sizeTier)) {
    const tierSize = FRIMODEL_GPT_IMAGE_SIZE_OPTIONS.find((option) =>
      String(option.label).toUpperCase().startsWith(sizeTier),
    )?.value;
    if (tierSize && tierSize !== "auto") result.size = tierSize;
  }
  // FriModel follows the OpenAI Images API documented in its guide. It
  // returns Base64 in data[0].b64_json, so response_format is intentionally
  // omitted even when older canvas snapshots still contain that field.
  if (typeof result.quality === "string") {
    const quality = result.quality.trim().toLowerCase();
    // Older canvas snapshots used the non-documentary `hd` label. Keep those
    // snapshots runnable while sending the documented `high` value upstream.
    result.quality =
      quality === "hd"
        ? "high"
        : quality === "standard"
          ? "auto"
          : quality;
  }
  const fixedQuality = /^gpt-image-2-(low|medium|high)$/iu.exec(
    model?.trim() ?? "",
  )?.[1]?.toLowerCase();
  if (fixedQuality) result.quality = fixedQuality;
  return result;
}

function imageParameters(
  parameters: Readonly<Record<string, unknown>> | undefined,
  model: string,
  profile: ImageProviderProfile,
  group?: string,
  supplierKey?: string,
) {
  if (supplierKey === "frimodel")
    return friModelImageParameters(parameters, model);
  const sourceParameters = parameters ?? {};
  const permitted =
    profile === "weai"
      ? weAIImageParameterKeys(group)
      : supplierKey === "chentu"
        ? chentuImageParameterKeys(model, group)
        : OPENAI_IMAGE_PARAMETER_KEYS;
  const selectedChentuTier =
    supplierKey === "chentu" && isChentuFlexibleSizeModel(model)
      ? chentuResolutionTier(sourceParameters["size_tier"])
      : undefined;
  const rawSize = sourceParameters["size"];
  const chentuPromptAutomatic =
    supplierKey === "chentu" &&
    isChentuFlexibleSizeModel(model) &&
    selectedChentuTier === undefined &&
    (rawSize === undefined ||
      (typeof rawSize === "string" && rawSize.trim().toLowerCase() === "auto"));
  const outputFormat =
    imageFormat(sourceParameters["output_format"])?.format ?? "png";
  const result = Object.fromEntries(
    permitted.flatMap((key) => {
      if (
        supplierKey === "chentu" &&
        key === "quality" &&
        typeof sourceParameters[key] === "string" &&
        /^(?:1k|2k|4k)$/iu.test(sourceParameters[key].trim())
      )
        return [];
      if (
        (key === "size" && chentuPromptAutomatic) ||
      sourceParameters[key] === undefined ||
        (key === "response_format" && sourceParameters[key] === "auto") ||
        (key === "output_compression" &&
          outputFormat !== "jpeg" &&
          outputFormat !== "webp")
      )
        return [];
      return [[key, sourceParameters[key]]];
    }),
  );
  if (isChentuOfficialModelGroup(group)) {
    // The official route documents standard as the default. Omit quality so
    // the distributor can select the correct channel for the model's tier.
    delete result.quality;
    if (result.style === undefined) result.style = "vivid";
    if (result.n === undefined) result.n = 1;
  }
  if (
    selectedChentuTier &&
    (result.size === undefined ||
      (typeof result.size === "string" &&
        result.size.trim().toLowerCase() === "auto"))
  ) {
    const tierSize = chentuSizeForResolutionTier(
      selectedChentuTier,
      sourceParameters["aspect_ratio"],
    );
    if (tierSize) result.size = tierSize;
  } else if (!chentuPromptAutomatic && result.size === undefined) {
    const inferredSize = sizeFromAspectRatio(sourceParameters["aspect_ratio"], model);
    if (inferredSize) result.size = inferredSize;
  }
  // We-AI's Adobe per-request route can close the connection while returning
  // large Base64 payloads. The supplier requires this group to request URL
  // output. Treat the legacy `auto` value and missing values as URL too so
  // saved canvases are migrated at execution time without another paid retry.
  if (profile === "weai" && group === WEAI_ADOBE_PER_REQUEST_GROUP)
    result.response_format = "url";
  if (profile === "weai" && group === WEAI_ADOBE_PER_REQUEST_URL_GROUP)
    result.response_format = "url";
  if (supplierKey === "chentu" && result.response_format === undefined)
    result.response_format = "url";
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringSetting(
  settings: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = settings?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function configuredDefaultModel(
  connection: ResolvedProviderConnection,
  fallback: string,
): string {
  const direct = stringSetting(connection.settings, "defaultModel");
  const nestedConfig = connection.settings?.["config"];
  const nested = isRecord(nestedConfig)
    ? stringSetting(nestedConfig, "defaultModel")
    : undefined;
  return direct ?? nested ?? fallback;
}

function configuredModelGroup(
  connection: ResolvedProviderConnection,
): string | undefined {
  const direct = stringSetting(connection.settings, "modelGroup");
  const nestedConfig = connection.settings?.["config"];
  const nested = isRecord(nestedConfig)
    ? stringSetting(nestedConfig, "modelGroup")
    : undefined;
  return direct ?? nested;
}

function configuredSupplierKey(
  connection: ResolvedProviderConnection,
): string | undefined {
  const direct = stringSetting(connection.settings, "supplierKey");
  const nestedConfig = connection.settings?.["config"];
  const nested = isRecord(nestedConfig)
    ? stringSetting(nestedConfig, "supplierKey")
    : undefined;
  return direct ?? nested;
}

function configuredGeminiProtocol(
  connection: ResolvedProviderConnection,
): WeAIGeminiProtocol {
  const direct = stringSetting(connection.settings, "protocol");
  const nestedConfig = connection.settings?.["config"];
  const nested = isRecord(nestedConfig)
    ? stringSetting(nestedConfig, "protocol")
    : undefined;
  const protocol = direct ?? nested;
  return protocol === "gemini-openai-compatible"
    ? protocol
    : "gemini-generate-content";
}

function allowedWeAIModels(
  connection: ResolvedProviderConnection,
): readonly string[] | undefined {
  const group = configuredModelGroup(connection);
  if (group && isMikotoGeminiGroup(group))
    return MIKOTO_GEMINI_GROUP_MODELS[group];
  return group ? WEAI_GROUP_MODELS[group] : undefined;
}

function unavailableWeAIModels(
  connection: ResolvedProviderConnection,
): ReadonlySet<string> {
  const nestedConfig = connection.settings?.["config"];
  const configured =
    connection.settings?.["unavailableModels"] ??
    (isRecord(nestedConfig) ? nestedConfig["unavailableModels"] : undefined);
  if (!Array.isArray(configured)) return new Set();
  return new Set(
    configured.flatMap((value) => {
      if (typeof value === "string" && value.trim()) return [value.trim()];
      if (!isRecord(value)) return [];
      const id = value["id"];
      return typeof id === "string" && id.trim() ? [id.trim()] : [];
    }),
  );
}

function configuredImageModel(
  connection: ResolvedProviderConnection,
  fallback: string,
  profile: ImageProviderProfile,
): string {
  const profileFallback =
    profile === "weai" && configuredModelGroup(connection) === WEAI_GEMINI_GROUP
      ? WEAI_GEMINI_DEFAULT_MODEL
      : configuredSupplierKey(connection) === "mikoto" &&
          isMikotoGeminiGroup(configuredModelGroup(connection))
        ? mikotoGeminiDefaultModel(configuredModelGroup(connection))
        : fallback;
  return configuredDefaultModel(connection, profileFallback);
}

function isWeAIGeminiConnection(
  connection: ResolvedProviderConnection,
): boolean {
  return (
    configuredModelGroup(connection) === WEAI_GEMINI_GROUP ||
    (configuredSupplierKey(connection) === "mikoto" &&
      isMikotoGeminiGroup(configuredModelGroup(connection)))
  );
}

function configuredRequestTimeout(
  connection: ResolvedProviderConnection,
  fallback: number,
): number {
  const direct = connection.settings?.["requestTimeoutMs"];
  const value =
    typeof direct === "number"
      ? direct
      : typeof direct === "string"
        ? Number(direct)
        : Number.NaN;
  return Number.isSafeInteger(value) &&
    value >= 1_000 &&
    value <= 30 * 60 * 1_000
    ? value
    : fallback;
}

function configuredBaseUrl(
  connection: ResolvedProviderConnection,
  fallback: string,
  profile: ImageProviderProfile,
): string {
  const value = connection.baseUrl?.trim() || fallback;
  if (profile !== "weai") return value;
  try {
    const parsed = new URL(value);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      parsed.pathname = "/v1";
      return parsed.href.replace(/\/$/u, "");
    }
  } catch {
    // fetchProviderJson will surface a safe invalid-URL error.
  }
  return value;
}

/**
 * We-AI exposes Gemini through Google's generateContent route. Existing
 * connections often store the OpenAI-compatible `/v1` base URL, so strip only
 * that terminal version segment before adding `/v1beta`.
 */
function configuredGeminiBaseUrl(
  connection: ResolvedProviderConnection,
  fallback: string,
): string {
  const value = configuredBaseUrl(connection, fallback, "weai");
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/u, "");
    const prefix = pathname.replace(/\/v1(?:beta)?$/iu, "");
    parsed.pathname = `${prefix}/v1beta` || "/v1beta";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href.replace(/\/+$/u, "");
  } catch {
    return (
      value.replace(/\/v1(?:beta)?\/?$/iu, "").replace(/\/+$/u, "") + "/v1beta"
    );
  }
}

function configuredGeminiOpenAIBaseUrl(
  connection: ResolvedProviderConnection,
  fallback: string,
): string {
  const value = configuredBaseUrl(connection, fallback, "weai");
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/u, "");
    const prefix = pathname.replace(/\/v1(?:beta)?$/iu, "");
    parsed.pathname = `${prefix}/v1` || "/v1";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href.replace(/\/+$/u, "");
  } catch {
    return (
      value.replace(/\/v1(?:beta)?\/?$/iu, "").replace(/\/+$/u, "") + "/v1"
    );
  }
}

function geminiModelsUrl(
  connection: ResolvedProviderConnection,
  fallback: string,
): string {
  return `${configuredGeminiBaseUrl(connection, fallback)}/models`;
}

function geminiGenerateContentUrl(
  connection: ResolvedProviderConnection,
  fallback: string,
  model: string,
): string {
  return `${geminiModelsUrl(connection, fallback)}/${encodeURIComponent(model)}:generateContent`;
}

function geminiOpenAIUrl(
  connection: ResolvedProviderConnection,
  fallback: string,
  path: string,
): string {
  return joinUrl(configuredGeminiOpenAIBaseUrl(connection, fallback), path);
}

function normalizeGeminiImageSize(
  value: unknown,
  allow512: boolean,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  const allowed = allow512
    ? WEAI_GEMINI_NATIVE_IMAGE_SIZES
    : WEAI_GEMINI_COMPAT_IMAGE_SIZES;
  return allowed.has(normalized) ? normalized : undefined;
}

function geminiImageSize(
  parameters: Readonly<Record<string, unknown>> | undefined,
  allow512 = true,
  fallback?: string,
): string | undefined {
  const value = parameters?.["image_size"] ?? parameters?.["imageSize"];
  const normalized = normalizeGeminiImageSize(value, allow512);
  if (normalized) return normalized;
  if (typeof value === "string" && value.trim().toLowerCase() === "auto")
    return undefined;
  const legacySize = parameters?.["size"];
  if (
    typeof legacySize === "string" &&
    legacySize.trim().toLowerCase() === "auto"
  )
    return undefined;
  const normalizedLegacy = normalizeGeminiImageSize(legacySize, allow512);
  if (normalizedLegacy) return normalizedLegacy;
  return fallback;
}

function geminiAspectRatio(
  parameters: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const value = parameters?.["aspect_ratio"] ?? parameters?.["aspectRatio"];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized !== "" && normalized.toLowerCase() !== "auto"
    ? normalized
    : undefined;
}

function geminiGenerationConfig(
  parameters: Readonly<Record<string, unknown>> | undefined,
  options: {
    readonly allow512?: boolean;
    readonly defaultImageSize?: string;
    readonly includeText?: boolean;
  } = {},
): Record<string, unknown> {
  const imageConfig: Record<string, string> = {};
  const imageSize = geminiImageSize(
    parameters,
    options.allow512 ?? true,
    options.defaultImageSize,
  );
  if (imageSize) imageConfig.imageSize = imageSize;
  const aspect = geminiAspectRatio(parameters);
  if (aspect) imageConfig.aspectRatio = aspect;
  return {
    responseModalities: options.includeText ? ["TEXT", "IMAGE"] : ["IMAGE"],
    ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
  };
}

function geminiOpenAIParameters(
  parameters: Readonly<Record<string, unknown>> | undefined,
  fallback = WEAI_GEMINI_DEFAULT_IMAGE_SIZE,
): Record<string, string> {
  const aspectRatio = geminiAspectRatio(parameters);
  const imageSize = geminiImageSize(parameters, false, fallback);
  return {
    ...(imageSize ? { size: imageSize } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    response_format: "url",
  };
}

function allowLoopbackGateway(connection: ResolvedProviderConnection): boolean {
  return connection.settings?.["allowLocalhost"] === true;
}

function imageFormat(value: unknown): ImageFormatDescriptor | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^image\//u, "")
    .replace(/^\./u, "");
  if (normalized === "jpg") return IMAGE_FORMATS.jpeg;
  if (normalized === "png" || normalized === "jpeg" || normalized === "webp") {
    return IMAGE_FORMATS[normalized];
  }
  return undefined;
}

function imageFormatFromBytes(
  data: Uint8Array,
): ImageFormatDescriptor | undefined {
  if (
    data.byteLength >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return IMAGE_FORMATS.png;
  }
  if (
    data.byteLength >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return IMAGE_FORMATS.jpeg;
  }
  if (
    data.byteLength >= 12 &&
    Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return IMAGE_FORMATS.webp;
  }
  return undefined;
}

function imageFormatFromUrl(value: string): ImageFormatDescriptor | undefined {
  const dataMime = /^data:([^;,]+)/iu.exec(value)?.[1];
  if (dataMime) return imageFormat(dataMime);
  try {
    const pathname = new URL(value).pathname;
    return imageFormat(/\.([^.\/]+)$/u.exec(pathname)?.[1]);
  } catch {
    return undefined;
  }
}

function decodeImageBase64(value: string): {
  data: Uint8Array;
  format?: ImageFormatDescriptor;
} {
  const dataUrl = /^data:([^;,]+);base64,(.*)$/isu.exec(value.trim());
  if (dataUrl) {
    const format = imageFormat(dataUrl[1]);
    return {
      data: new Uint8Array(Buffer.from(dataUrl[2] ?? "", "base64")),
      ...(format ? { format } : {}),
    };
  }
  return { data: new Uint8Array(Buffer.from(value, "base64")) };
}

function filenameFor(
  index: number,
  original: string | undefined,
  mimeType: string,
): string {
  if (original && original.trim().length > 0) return original;
  const extension = imageFormat(mimeType)?.extension ?? "png";
  return `reference-${index + 1}.${extension}`;
}

function hasAssetContent(asset: {
  readonly url?: string;
  readonly data?: Uint8Array;
}): boolean {
  return (
    (typeof asset.url === "string" && asset.url.trim().length > 0) ||
    (asset.data !== undefined && asset.data.byteLength > 0)
  );
}

async function geminiInlineImageParts(
  assets: readonly ProviderAssetInput[],
  fetchImpl: FetchImplementation,
  maxBytes?: number,
): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
  const parts: Array<{
    inlineData: { mimeType: string; data: string };
  }> = [];
  for (const asset of assets) {
    const blob = await assetToBlob(asset, fetchImpl);
    if (maxBytes !== undefined && blob.size > maxBytes) {
      throw new Error(
        `We-AI Gemini reference images must not exceed ${maxBytes} bytes`,
      );
    }
    const mimeType =
      blob.type.split(";", 1)[0]?.trim().toLowerCase() ||
      asset.mimeType.split(";", 1)[0]?.trim().toLowerCase() ||
      "image/png";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    parts.push({
      inlineData: {
        mimeType,
        data: Buffer.from(bytes).toString("base64"),
      },
    });
  }
  return parts;
}

function geminiInlineDataPart(part: unknown): GeminiInlineData | undefined {
  if (!isRecord(part)) return undefined;
  const inline = part.inlineData ?? part.inline_data;
  return isRecord(inline) ? (inline as GeminiInlineData) : undefined;
}

function extractGeminiOutputs(
  response: GeminiGenerateContentResponse,
  profile: ImageProviderProfile,
): RemoteArtifact[] {
  const outputs: RemoteArtifact[] = [];
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = geminiInlineDataPart(part);
      if (!inline || typeof inline.data !== "string") continue;
      const rawMime =
        (typeof inline.mimeType === "string" && inline.mimeType) ||
        (typeof inline.mime_type === "string" && inline.mime_type) ||
        undefined;
      if (rawMime && !rawMime.toLowerCase().startsWith("image/")) continue;
      const decoded = decodeImageBase64(inline.data);
      if (decoded.data.byteLength === 0) continue;
      const format =
        imageFormatFromBytes(decoded.data) ??
        decoded.format ??
        imageFormat(rawMime) ??
        IMAGE_FORMATS.png;
      const index = outputs.length + 1;
      outputs.push({
        kind: "image",
        data: decoded.data,
        mimeType: format.mimeType,
        filename: `${profile}-${index}.${format.extension}`,
      });
    }
  }
  if (outputs.length > 0) return outputs;

  const seenUrls = new Set<string>();
  const markdownImagePattern = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/giu;
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text !== "string") continue;
      for (const match of part.text.matchAll(markdownImagePattern)) {
        const url = match[1];
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        outputs.push({ kind: "image", url });
      }
    }
  }
  return outputs;
}

function looksLikeBase64Image(value: string): boolean {
  const compact = value.replace(/\s+/gu, "");
  return (
    compact.length >= 128 &&
    compact.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/u.test(compact)
  );
}

function friModelImageValue(
  value: string,
  profile: ImageProviderProfile,
  index: number,
  mimeType?: unknown,
  outputFormat?: unknown,
): RemoteArtifact | undefined {
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;

  const markdownImagePattern = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/giu;
  const markdown = markdownImagePattern.exec(normalized)?.[1];
  if (markdown) {
    return friModelImageValue(markdown, profile, index, mimeType, outputFormat);
  }

  const dataUrl = /^data:([^;,]+);base64,(.*)$/isu.exec(normalized);
  if (dataUrl || looksLikeBase64Image(normalized)) {
    const decoded = decodeImageBase64(normalized);
    if (decoded.data.byteLength === 0) return undefined;
    const format =
      imageFormatFromBytes(decoded.data) ??
      decoded.format ??
      imageFormat(mimeType) ??
      imageFormat(outputFormat) ??
      IMAGE_FORMATS.png;
    return {
      kind: "image",
      data: decoded.data,
      mimeType: format.mimeType,
      filename: `${profile}-${index}.${format.extension}`,
    };
  }

  if (/^https?:\/\//iu.test(normalized)) {
    const format = imageFormatFromUrl(normalized) ?? imageFormat(mimeType);
    return {
      kind: "image",
      url: normalized,
      ...(format
        ? {
            mimeType: format.mimeType,
            filename: `${profile}-${index}.${format.extension}`,
          }
        : {}),
    };
  }
  return undefined;
}

function friModelBase64Artifact(
  value: string,
  profile: ImageProviderProfile,
  index: number,
  mimeType?: unknown,
  outputFormat?: unknown,
): RemoteArtifact | undefined {
  const decoded = decodeImageBase64(value);
  if (decoded.data.byteLength === 0) return undefined;
  const format =
    imageFormatFromBytes(decoded.data) ??
    decoded.format ??
    imageFormat(mimeType) ??
    imageFormat(outputFormat) ??
    IMAGE_FORMATS.png;
  return {
    kind: "image",
    data: decoded.data,
    mimeType: format.mimeType,
    filename: `${profile}-${index}.${format.extension}`,
  };
}

function collectFriModelImageValues(
  value: unknown,
  profile: ImageProviderProfile,
  outputFormat: unknown,
  outputs: RemoteArtifact[],
  seen: Set<string>,
  seenObjects: Set<object>,
): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        collectFriModelImageValues(
          parsed,
          profile,
          outputFormat,
          outputs,
          seen,
          seenObjects,
        );
        if (outputs.length > 0) return;
      } catch {
        // Treat non-JSON text as a normal response body below.
      }
    }
    const markdownPattern = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/giu;
    const candidates = [...value.matchAll(markdownPattern)].map(
      (match) => match[1],
    );
    if (candidates.length === 0 && /https?:\/\//iu.test(value)) {
      for (const match of value.matchAll(/https?:\/\/[^\s<>"')]+/giu)) {
        if (match[0]) candidates.push(match[0]);
      }
    }
    if (candidates.length === 0) candidates.push(value);
    for (const candidate of candidates) {
      if (!candidate) continue;
      const artifact = friModelImageValue(
        candidate,
        profile,
        outputs.length + 1,
        undefined,
        outputFormat,
      );
      if (!artifact) continue;
      const identity =
        artifact.url ??
        (artifact.data
          ? `data:${artifact.mimeType ?? "image/png"}:${Buffer.from(artifact.data).toString("base64")}`
          : "");
      if (identity.length === 0 || seen.has(identity)) continue;
      seen.add(identity);
      outputs.push(artifact);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value)
      collectFriModelImageValues(
        item,
        profile,
        outputFormat,
        outputs,
        seen,
        seenObjects,
      );
    return;
  }
  if (!isRecord(value)) return;
  if (seenObjects.has(value)) return;
  seenObjects.add(value);

  const mimeType = value.mime_type ?? value.mimeType;
  const directImageUrl = value.image_url ?? value.imageUrl;
  if (typeof directImageUrl === "string")
    collectFriModelImageValues(
      directImageUrl,
      profile,
      outputFormat,
      outputs,
      seen,
      seenObjects,
    );
  else if (isRecord(directImageUrl))
    collectFriModelImageValues(
      { ...directImageUrl, mimeType },
      profile,
      outputFormat,
      outputs,
      seen,
      seenObjects,
    );

  for (const key of [
    "content",
    "text",
    "images",
    "image",
    "url",
    "b64_json",
    "data",
    "output",
    "result",
  ]) {
    const nested = value[key];
    if (nested === undefined) continue;
    if (typeof nested === "string") {
      if (key !== "b64_json") {
        collectFriModelImageValues(
          nested,
          profile,
          outputFormat,
          outputs,
          seen,
          seenObjects,
        );
        continue;
      }
      const artifact = friModelBase64Artifact(
        nested,
        profile,
        outputs.length + 1,
        mimeType,
        outputFormat,
      );
      if (artifact) {
        const identity =
          artifact.url ??
          (artifact.data
            ? `data:${artifact.mimeType ?? "image/png"}:${Buffer.from(artifact.data).toString("base64")}`
            : "");
        if (identity.length > 0 && !seen.has(identity)) {
          seen.add(identity);
          outputs.push(artifact);
        }
      }
    } else {
      collectFriModelImageValues(
        nested,
        profile,
        outputFormat,
        outputs,
        seen,
        seenObjects,
      );
    }
  }
}

function extractFriModelOutputs(
  response: FriModelChatResponse,
  profile: ImageProviderProfile,
  outputFormat?: unknown,
): RemoteArtifact[] {
  const outputs: RemoteArtifact[] = [];
  const seen = new Set<string>();
  const seenObjects = new Set<object>();
  for (const choice of response.choices ?? []) {
    collectFriModelImageValues(
      choice.message,
      profile,
      outputFormat,
      outputs,
      seen,
      seenObjects,
    );
    collectFriModelImageValues(
      choice.text,
      profile,
      outputFormat,
      outputs,
      seen,
      seenObjects,
    );
  }
  if (outputs.length > 0) return outputs;

  for (const [index, item] of (response.data ?? []).entries()) {
    const artifact =
      typeof item.b64_json === "string"
        ? friModelBase64Artifact(
            item.b64_json,
            profile,
            index + 1,
            item.mime_type,
            item.output_format ?? outputFormat,
          )
        : typeof item.url === "string"
          ? friModelImageValue(
              item.url,
              profile,
              index + 1,
              item.mime_type,
              item.output_format ?? outputFormat,
            )
          : undefined;
    if (artifact) outputs.push(artifact);
  }
  return outputs;
}

export interface OpenAIImageAdapterOptions {
  fetch?: FetchImplementation;
  defaultModel?: string;
  requestTimeoutMs?: number;
  profile?: ImageProviderProfile;
}

export class OpenAIImageAdapter implements ProviderAdapter {
  private readonly fetchImpl: FetchImplementation;
  private readonly defaultModel: string;
  private readonly requestTimeoutMs: number;
  private readonly profile: ImageProviderProfile;
  private readonly defaultBaseUrl: string;

  public constructor(
    private readonly connections: ProviderConnectionResolver,
    options: OpenAIImageAdapterOptions = {},
  ) {
    this.profile = options.profile ?? "openai";
    this.fetchImpl =
      options.fetch ?? (this.profile === "weai" ? weAIFetch : providerFetch);
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.defaultBaseUrl =
      this.profile === "weai" ? WEAI_DEFAULT_BASE_URL : DEFAULT_BASE_URL;
    this.requestTimeoutMs =
      options.requestTimeoutMs ??
      (this.profile === "weai" ? WEAI_REQUEST_TIMEOUT_MS : 120_000);
  }

  public async testConnection(connectionId: string): Promise<void> {
    const connection = await this.connections.resolve(connectionId);
    const apiKey = requireApiKey(connection);
    const useGemini =
      this.profile === "weai" && isWeAIGeminiConnection(connection);
    const supplierKey = configuredSupplierKey(connection);
    const geminiProtocol = useGemini
      ? configuredGeminiProtocol(connection)
      : undefined;
    const headers = mergeHeaders(
      connection.headers,
      useGemini && supplierKey === "mikoto"
        ? { "x-goog-api-key": apiKey }
        : { Authorization: `Bearer ${apiKey}` },
    );
    await fetchProviderJson<OpenAIModelList | GeminiModelList>(
      this.fetchImpl,
      useGemini
        ? geminiProtocol === "gemini-openai-compatible"
          ? geminiOpenAIUrl(connection, this.defaultBaseUrl, "/models")
          : geminiModelsUrl(connection, this.defaultBaseUrl)
        : joinUrl(
            configuredBaseUrl(connection, this.defaultBaseUrl, this.profile),
            "/models",
          ),
      { method: "GET", headers },
      {
        phase: "connect",
        timeoutMs:
          this.profile === "weai"
            ? Math.min(
                configuredRequestTimeout(connection, this.requestTimeoutMs),
                30_000,
              )
            : configuredRequestTimeout(connection, this.requestTimeoutMs),
        allowLoopback: allowLoopbackGateway(connection),
      },
    );
  }

  public async listModels(connectionId: string): Promise<ModelDescriptor[]> {
    const connection = await this.connections.resolve(connectionId);
    const apiKey = requireApiKey(connection);
    const configuredDefault = configuredImageModel(
      connection,
      this.defaultModel,
      this.profile,
    );
    const useGemini =
      this.profile === "weai" && isWeAIGeminiConnection(connection);
    const supplierKey = configuredSupplierKey(connection);
    const defaultModel =
      useGemini && supplierKey !== "mikoto"
        ? canonicalWeAIGeminiModel(configuredDefault)
        : configuredDefault;
    const geminiProtocol = useGemini
      ? configuredGeminiProtocol(connection)
      : undefined;
    if (
      useGemini &&
      supplierKey === "mikoto" &&
      isMikotoGeminiGroup(configuredModelGroup(connection))
    ) {
      const modelGroup = configuredModelGroup(connection);
      return (allowedWeAIModels(connection) ?? []).map((id) =>
        withCanonicalModelFields(
          weAIModelDescriptor(
            id,
            id === defaultModel,
            modelGroup,
            "gemini-generate-content",
          ),
          "weai",
        ),
      );
    }
    const headers = mergeHeaders(
      connection.headers,
      useGemini && configuredSupplierKey(connection) === "mikoto"
        ? { "x-goog-api-key": apiKey }
        : { Authorization: `Bearer ${apiKey}` },
    );
    const response = await fetchProviderJson<OpenAIModelList | GeminiModelList>(
      this.fetchImpl,
      useGemini
        ? geminiProtocol === "gemini-openai-compatible"
          ? geminiOpenAIUrl(connection, this.defaultBaseUrl, "/models")
          : geminiModelsUrl(connection, this.defaultBaseUrl)
        : joinUrl(
            configuredBaseUrl(connection, this.defaultBaseUrl, this.profile),
            "/models",
          ),
      { method: "GET", headers },
      {
        phase: "connect",
        timeoutMs:
          this.profile === "weai"
            ? Math.min(
                configuredRequestTimeout(connection, this.requestTimeoutMs),
                30_000,
              )
            : configuredRequestTimeout(connection, this.requestTimeoutMs),
        allowLoopback: allowLoopbackGateway(connection),
      },
    );
    const geminiResponse = response as GeminiModelList;
    const remoteIds = useGemini
      ? [
          ...(geminiResponse.models ?? []).map((model) => model.name),
          ...(geminiResponse.data ?? []).map((model) => model.id),
        ]
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.replace(/^models\//u, ""))
      : ((response as OpenAIModelList).data ?? [])
          .map((model) => model.id)
          .filter((id): id is string => typeof id === "string");
    const availableIds = new Set(
      remoteIds
        .map((id) =>
          useGemini && supplierKey !== "mikoto"
            ? canonicalWeAIGeminiModel(id)
            : id,
        )
        .filter((id) =>
          this.profile === "openai" && supplierKey === "frimodel"
            ? isFriModelImageCandidate(id)
            : this.profile === "openai" && supplierKey === "chentu"
              ? isChentuImageCandidate(id)
              : id.includes("image"),
        ),
    );
    const allowed =
      this.profile === "weai" ? allowedWeAIModels(connection) : undefined;
    const unavailable =
      this.profile === "weai"
        ? unavailableWeAIModels(connection)
        : new Set<string>();
    const modelGroup =
      this.profile === "weai" || supplierKey === "chentu"
        ? configuredModelGroup(connection)
        : undefined;
    const ids = new Set(
      [...availableIds].filter(
        (id) => (!allowed || allowed.includes(id)) && !unavailable.has(id),
      ),
    );
    // Other OpenAI-compatible services have historically needed the entered
    // default preserved even when /models is incomplete. Keyed marketplace
    // suppliers keep their live inventory authoritative: do not expose a
    // stale default once their /models response is available.
    if (
      this.profile !== "weai" &&
      !(usesKeyedLiveImageInventory(supplierKey) && remoteIds.length > 0)
    )
      ids.add(defaultModel);
    const orderedIds =
      modelGroup === WEAI_ADOBE_PER_REQUEST_GROUP
        ? (WEAI_GROUP_MODELS[WEAI_ADOBE_PER_REQUEST_GROUP] ?? []).filter((id) =>
            ids.has(id),
          )
        : [...ids].sort();
    const effectiveDefaultModel = orderedIds.includes(defaultModel)
      ? defaultModel
      : orderedIds[0];
    return orderedIds.flatMap((id) => {
      if (this.profile === "weai")
        return weAIModelDescriptors(
          id,
          id === effectiveDefaultModel,
          modelGroup,
          geminiProtocol,
        ).map((model) => withCanonicalModelFields(model, "weai"));
      if (supplierKey === "frimodel")
        return [
          withCanonicalModelFields(
            friModelModelDescriptor(
              id,
              id === effectiveDefaultModel,
              modelGroup,
            ),
            "openai",
          ),
        ];
      if (supplierKey === "chentu")
        return [
          withCanonicalModelFields(
            chentuModelDescriptor(
              id,
              id === effectiveDefaultModel,
              modelGroup,
            ),
            "openai",
          ),
        ];
      const known = IMAGE_MODELS.find((model) => model.id === id);
      if (known)
        return [
          withCanonicalModelFields(
            { ...known, isDefault: id === effectiveDefaultModel },
            "openai",
          ),
        ];
      return [
        withCanonicalModelFields(
          {
            id,
            name: id,
            operations: ["image.generate", "image.edit"],
            parameters: IMAGE_PARAMETER_DESCRIPTORS,
            isDefault: id === effectiveDefaultModel,
          },
          "openai",
        ),
      ];
    });
  }

  public async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    let resolvedConnection: ResolvedProviderConnection | undefined;
    try {
      const connection = await this.connections.resolve(request.connectionId);
      resolvedConnection = connection;
      if (!connection.apiKey) {
        issues.push({
          path: "connection.apiKey",
          code: "missing_credential",
          message:
            this.profile === "weai"
              ? "A We-AI API key is required"
              : "An OpenAI API key is required",
        });
      }
    } catch (error) {
      issues.push({
        path: "connectionId",
        code: "unknown_connection",
        message:
          error instanceof Error
            ? error.message
            : "Unknown provider connection",
      });
    }
    if (
      request.operation !== "image.generate" &&
      request.operation !== "image.edit"
    ) {
      issues.push({
        path: "operation",
        code: "unsupported_operation",
        message:
          "OpenAI image adapter only supports image generation and editing",
      });
    }
    if (request.prompt.trim().length === 0) {
      issues.push({
        path: "prompt",
        code: "required",
        message: "An image prompt is required",
      });
    }
    const requestedModel =
      request.model ??
      (resolvedConnection
        ? configuredImageModel(
            resolvedConnection,
            this.defaultModel,
            this.profile,
          )
        : this.defaultModel);
    const resolvedModelGroup =
      this.profile === "weai" && resolvedConnection
        ? configuredModelGroup(resolvedConnection)
        : undefined;
    const useGemini =
      this.profile === "weai" &&
      resolvedConnection !== undefined &&
      isWeAIGeminiConnection(resolvedConnection);
    const resolvedSupplierKey = resolvedConnection
      ? configuredSupplierKey(resolvedConnection)
      : undefined;
    const isChentuOfficial =
      resolvedSupplierKey === "chentu" &&
      isChentuOfficialModelGroup(
        resolvedConnection ? configuredModelGroup(resolvedConnection) : undefined,
      );
    const isFriModel =
      this.profile === "openai" && resolvedSupplierKey === "frimodel";
    const resolvedModel =
      useGemini && resolvedSupplierKey !== "mikoto"
        ? canonicalWeAIGeminiModel(requestedModel)
        : requestedModel;
    if (
      resolvedSupplierKey === "frimodel" &&
      request.operation === "image.edit" &&
      !friModelSupportsImageEdit(resolvedModel)
    ) {
      issues.push({
        path: "operation",
        code: "unsupported_operation",
        message:
          "FriModel 当前仅确认 GPT Image 2 模型支持 /v1/images/edits 图片编辑",
      });
    }
    const geminiProtocol =
      useGemini && resolvedConnection
        ? configuredGeminiProtocol(resolvedConnection)
        : undefined;
    const supportedGeminiModels =
      resolvedSupplierKey === "mikoto"
        ? MIKOTO_GEMINI_IMAGE_MODELS
        : WEAI_GEMINI_IMAGE_MODELS;
    if (useGemini && !supportedGeminiModels.has(resolvedModel)) {
      issues.push({
        path: "model",
        code: "unsupported_model",
        message: `We-AI Gemini does not support image model ${resolvedModel}`,
      });
    }
    // FriModel uses the same Images API generation and multipart edit routes.
    if (this.profile === "weai" && resolvedConnection) {
      const allowed = allowedWeAIModels(resolvedConnection);
      if (allowed && !allowed.includes(resolvedModel)) {
        issues.push({
          path: "model",
          code: "model_group_mismatch",
          message: `We-AI ${resolvedModelGroup} 分组不支持模型 ${resolvedModel}`,
        });
      }
      if (unavailableWeAIModels(resolvedConnection).has(resolvedModel)) {
        issues.push({
          path: "model",
          code: "model_unavailable",
          message: `We-AI ${resolvedModel} was rejected as an unknown model by the upstream route`,
        });
      }
    }
    const permittedParameters: ReadonlySet<string> =
      this.profile === "weai"
        ? new Set<WeAIImageParameterKey>(
            weAIImageParameterKeys(resolvedModelGroup),
          )
        : isFriModel
          ? new Set<FriModelImageParameterKey>(FRIMODEL_IMAGE_PARAMETER_KEYS)
          : new Set<WeAIImageParameterKey>(
              resolvedSupplierKey === "chentu"
                ? chentuImageParameterKeys(
                    resolvedModel,
                    resolvedConnection
                      ? configuredModelGroup(resolvedConnection)
                      : undefined,
                  )
                : OPENAI_IMAGE_PARAMETER_KEYS,
            );
    const assets = request.assets ?? [];
    const images = assets.filter((asset) => asset.kind === "image");
    if (request.operation === "image.generate" && assets.length > 0) {
      issues.push({
        path: "assets",
        code: "assets_not_supported",
        message:
          "Image generation does not accept reference assets; use image editing instead",
      });
    }
    if (request.operation === "image.edit" && images.length === 0) {
      issues.push({
        path: "assets",
        code: "reference_required",
        message: "Image editing requires at least one reference image",
      });
    }
    const maxInputImages = useGemini
      ? resolvedSupplierKey === "mikoto"
        ? undefined
        : WEAI_GEMINI_MAX_INPUT_IMAGES
      : resolvedSupplierKey === "chentu"
        ? 10
        : isFriModel
          ? 10
          : 16;
    if (maxInputImages !== undefined && images.length > maxInputImages) {
      issues.push({
        path: "assets",
        code: "too_many_images",
        message: useGemini
          ? `We-AI Gemini image editing accepts at most ${WEAI_GEMINI_MAX_INPUT_IMAGES} reference images`
          : resolvedSupplierKey === "chentu"
            ? "辰途 API 图片编辑最多接受 10 张参考图"
            : isFriModel
              ? "FriModel 图片编辑最多接受 10 张参考图"
              : "OpenAI image editing accepts at most 16 reference images",
      });
    }
    for (const [index, asset] of assets.entries()) {
      if (asset.kind !== "image") {
        issues.push({
          path: `assets[${index}].kind`,
          code: "unsupported_asset_kind",
          message: "OpenAI image requests only accept image assets",
        });
        continue;
      }
      const mimeType =
        asset.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!SUPPORTED_INPUT_MIME_TYPES.has(mimeType)) {
        issues.push({
          path: `assets[${index}].mimeType`,
          code: "unsupported_mime_type",
          message: `Unsupported OpenAI reference image MIME type: ${asset.mimeType}`,
        });
      }
      if (!hasAssetContent(asset)) {
        issues.push({
          path: `assets[${index}]`,
          code: "unresolved_asset",
          message: `Reference image ${asset.id} has no usable content`,
        });
      }
      const maxImageBytes = useGemini
        ? resolvedSupplierKey === "mikoto"
          ? undefined
          : WEAI_GEMINI_MAX_INPUT_IMAGE_BYTES
        : resolvedSupplierKey === "chentu"
          ? 10 * 1024 * 1024
          : MAX_EDIT_IMAGE_BYTES;
      if (
        maxImageBytes !== undefined &&
        asset.data &&
        asset.data.byteLength > maxImageBytes
      ) {
        issues.push({
          path: `assets[${index}].data`,
          code: "image_too_large",
          message: useGemini
            ? "We-AI Gemini reference images must not exceed 20 MB"
            : resolvedSupplierKey === "chentu"
              ? "辰途 API 单张参考图不得超过 10 MiB"
              : "OpenAI reference images must not exceed 50 MB",
        });
      }
    }
    const outputFormat = request.parameters?.["output_format"];
    if (
      permittedParameters.has("output_format") &&
      outputFormat !== undefined &&
      imageFormat(outputFormat) === undefined
    ) {
      issues.push({
        path: "parameters.output_format",
        code: "invalid_output_format",
        message: "OpenAI output_format must be png, jpeg, or webp",
      });
    }
    const outputCompression = request.parameters?.["output_compression"];
    if (
      permittedParameters.has("output_compression") &&
      outputCompression !== undefined &&
      (typeof outputCompression !== "number" ||
        !Number.isInteger(outputCompression) ||
        outputCompression < 0 ||
        outputCompression > 100)
    ) {
      issues.push({
        path: "parameters.output_compression",
        code: "invalid_output_compression",
        message:
          "OpenAI output_compression must be an integer between 0 and 100",
      });
    }
    const responseFormat = request.parameters?.["response_format"];
    if (
      permittedParameters.has("response_format") &&
      responseFormat !== undefined &&
      (typeof responseFormat !== "string" ||
        !(resolvedSupplierKey === "chentu"
          ? (isChentuOfficial
              ? ["url"].includes(responseFormat)
              : ["url", "b64_json"].includes(responseFormat))
          : isFriModel
            ? ["url"].includes(responseFormat)
            : ["auto", "url"].includes(responseFormat)))
    ) {
      issues.push({
        path: "parameters.response_format",
        code: "invalid_response_format",
          message:
            resolvedSupplierKey === "chentu"
            ? isChentuOfficial
              ? "辰途 image2 官 key response_format 仅支持 url"
              : "辰途 API response_format 必须是 url 或 b64_json"
            : isFriModel
              ? "FriModel response_format 必须是 url"
              : "We-AI Adobe response_format must be auto or url",
      });
    }
    const background = request.parameters?.["background"];
    if (
      permittedParameters.has("background") &&
      background !== undefined &&
      (typeof background !== "string" ||
        !["auto", "opaque", "transparent"].includes(background))
    )
      issues.push({
        path: "parameters.background",
        code: "invalid_background",
        message: "OpenAI background must be auto, opaque, or transparent",
      });
    const count = request.parameters?.["n"];
    const maxCount =
      this.profile === "weai"
        ? weAIMaxOutputCount(resolvedModel, resolvedModelGroup)
        : resolvedSupplierKey === "chentu"
          ? isChentuOfficialModelGroup(
              resolvedConnection
                ? configuredModelGroup(resolvedConnection)
                : undefined,
          )
            ? 10
            : 1
          : resolvedSupplierKey === "frimodel"
            ? 1
            : 10;
    if (
      count !== undefined &&
      (typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > maxCount)
    ) {
      issues.push({
        path: "parameters.n",
        code: "invalid_count",
        message:
          this.profile === "weai"
            ? `We-AI ${resolvedModel} n must be an integer between 1 and ${maxCount}`
            : resolvedSupplierKey === "chentu"
              ? isChentuOfficialModelGroup(
                  resolvedConnection
                    ? configuredModelGroup(resolvedConnection)
                    : undefined,
                )
                ? "辰途 image2 官 key n 必须为 1–10"
                : "辰途 API 画布同步任务 n 必须为 1"
              : resolvedSupplierKey === "frimodel"
                ? "FriModel 图片接口单次仅支持生成 1 张"
                : "OpenAI n must be an integer between 1 and 10",
      });
    }
    for (const key of ["size", "quality", "style"] as const) {
      if (!permittedParameters.has(key)) continue;
      const value = request.parameters?.[key];
      if (
        value !== undefined &&
        (typeof value !== "string" || value.trim().length === 0)
      ) {
        issues.push({
          path: `parameters.${key}`,
          code: "invalid_parameter",
          message: `OpenAI ${key} must be a non-empty string`,
        });
      }
      if (
        isChentuOfficial &&
        key === "style" &&
        typeof value === "string" &&
        value.trim().toLowerCase() !== "vivid"
      ) {
        issues.push({
          path: "parameters.style",
          code: "invalid_style",
          message: "辰途 image2 官 key style 仅支持 vivid",
        });
      }
    }
    if (resolvedSupplierKey === "chentu") {
      const size = request.parameters?.["size"];
      const allowedSizes = chentuAllowedSizes(resolvedModel);
      if (
        typeof size === "string" &&
        allowedSizes.length > 0 &&
        !allowedSizes.includes(size.trim())
      )
        issues.push({
          path: "parameters.size",
          code: "invalid_image_size",
          message: `辰途 API ${resolvedModel} size 必须使用该模型文档中的精确尺寸`,
        });
    }
    const aspectRatio = request.parameters?.["aspect_ratio"];
    if (useGemini) {
      const allowedAspectRatios =
        resolvedSupplierKey === "mikoto"
          ? MIKOTO_GEMINI_ASPECT_RATIOS
          : WEAI_GEMINI_ASPECT_RATIOS;
      const normalizedAspect =
        typeof aspectRatio === "string" ? aspectRatio.trim() : aspectRatio;
      if (
        aspectRatio !== undefined &&
        normalizedAspect !== "auto" &&
        (typeof normalizedAspect !== "string" ||
          !allowedAspectRatios.has(normalizedAspect))
      )
        issues.push({
          path: "parameters.aspect_ratio",
          code: "invalid_aspect_ratio",
          message: `We-AI Gemini aspect_ratio must be one of: ${[
            ...allowedAspectRatios,
          ].join(", ")}`,
        });
      const imageSizeValue =
        geminiProtocol === "gemini-openai-compatible"
          ? (request.parameters?.["size"] ??
            request.parameters?.["image_size"] ??
            request.parameters?.["imageSize"])
          : (request.parameters?.["image_size"] ??
            request.parameters?.["imageSize"] ??
            request.parameters?.["size"]);
      const allow512 =
        resolvedSupplierKey !== "mikoto" &&
        geminiProtocol !== "gemini-openai-compatible";
      const mikotoAllowedSizes =
        resolvedSupplierKey === "mikoto"
          ? mikotoGeminiAllowedSizes(resolvedModelGroup)
          : undefined;
      if (
        imageSizeValue !== undefined &&
        !(
          resolvedSupplierKey !== "mikoto" &&
          typeof imageSizeValue === "string" &&
          imageSizeValue.trim().toLowerCase() === "auto"
        ) &&
        (normalizeGeminiImageSize(imageSizeValue, allow512) === undefined ||
          (mikotoAllowedSizes &&
            typeof imageSizeValue === "string" &&
            !mikotoAllowedSizes.has(imageSizeValue.trim().toUpperCase())))
      )
        issues.push({
          path:
            geminiProtocol === "gemini-openai-compatible"
              ? "parameters.size"
              : "parameters.image_size",
          code: "invalid_image_size",
          message:
            resolvedSupplierKey === "mikoto"
              ? `MikotoPro Gemini ${resolvedModelGroup ?? "当前"} 分组 image_size 必须是 ${(mikotoAllowedSizes ? [...mikotoAllowedSizes] : ["1K", "2K", "4K"]).join(", ")}`
              : geminiProtocol === "gemini-openai-compatible"
                ? "We-AI Gemini compatible size must be auto, 1K, 2K, or 4K"
                : "We-AI Gemini image_size must be auto, 512, 1K, 2K, or 4K",
        });
    } else if (
      aspectRatio !== undefined &&
      aspectRatio !== "auto" &&
      aspectRatioValue(aspectRatio) === undefined
    )
      issues.push({
        path: "parameters.aspect_ratio",
        code: "invalid_aspect_ratio",
        message: "OpenAI aspect_ratio must be auto or WIDTH:HEIGHT",
      });
    if (/^gpt-image-2(?:-|$)/u.test(resolvedModel)) {
      const size = request.parameters?.["size"];
      if (typeof size === "string") {
        const reason = gptImage2SizeIssue(size.trim());
        if (reason)
          issues.push({
            path: "parameters.size",
            code: "invalid_size",
            message: `OpenAI gpt-image-2 size ${reason}`,
          });
      }
      const quality = request.parameters?.["quality"];
      if (
        !isFriModel &&
        permittedParameters.has("quality") &&
        quality !== undefined &&
        !(
          resolvedSupplierKey === "chentu" &&
          typeof quality === "string" &&
          /^(?:1k|2k|4k)$/iu.test(quality.trim())
        ) &&
        (typeof quality !== "string" ||
          !((resolvedSupplierKey === "chentu" &&
          isChentuOfficialModelGroup(
            resolvedConnection
              ? configuredModelGroup(resolvedConnection)
              : undefined,
          ))
            ? [
                chentuOfficialQuality(resolvedModel),
                "standard",
                "auto",
                "low",
                "medium",
                "high",
              ].includes(quality.trim().toLowerCase())
            : ["auto", "low", "medium", "high"].includes(quality)))
      )
        issues.push({
          path: "parameters.quality",
          code: "invalid_quality",
          message: "GPT Image 2 quality must be auto, low, medium, or high",
        });
      if (permittedParameters.has("background") && background === "transparent")
        issues.push({
          path: "parameters.background",
          code: "unsupported_background",
          message:
            "OpenAI gpt-image-2 does not support transparent backgrounds",
        });
    }
    if (isFriModel) {
      const quality = request.parameters?.["quality"];
      if (
        quality !== undefined &&
        (typeof quality !== "string" ||
          ![
            "auto",
            "low",
            "medium",
            "high",
            // Legacy canvas values; friModelImageParameters normalizes them.
            "standard",
            "hd",
          ].includes(quality.trim().toLowerCase()))
      )
        issues.push({
          path: "parameters.quality",
          code: "invalid_quality",
          message:
            "FriModel quality must be auto, low, medium, or high",
        });
      const style = request.parameters?.["style"];
      if (
        style !== undefined &&
        (typeof style !== "string" ||
          !["vivid", "natural"].includes(style.trim().toLowerCase()))
      )
        issues.push({
          path: "parameters.style",
          code: "invalid_style",
          message: "FriModel style must be vivid or natural",
        });
    }
    const moderation = request.parameters?.["moderation"];
    if (
      permittedParameters.has("moderation") &&
      moderation !== undefined &&
      (typeof moderation !== "string" || !["auto", "low"].includes(moderation))
    )
      issues.push({
        path: "parameters.moderation",
        code: "invalid_moderation",
        message: "OpenAI moderation must be auto or low",
      });
    if (request.model !== undefined && request.model.trim().length === 0) {
      issues.push({
        path: "model",
        code: "invalid_model",
        message: "OpenAI model must be a non-empty string",
      });
    }
    return { valid: issues.length === 0, issues };
  }

  public async submit(request: NormalizedRequest): Promise<ProviderTask> {
    assertValidResult(await this.validate(request));
    const connection = await this.connections.resolve(request.connectionId);
    const apiKey = requireApiKey(connection);
    const supplierKey = configuredSupplierKey(connection);
    const baseUrl = configuredBaseUrl(
      connection,
      this.defaultBaseUrl,
      this.profile,
    );
    const requestTimeoutMs = configuredRequestTimeout(
      connection,
      supplierKey === "frimodel"
        ? FRIMODEL_REQUEST_TIMEOUT_MS
        : this.requestTimeoutMs,
    );
    const selectedModel =
      request.model ??
      configuredImageModel(connection, this.defaultModel, this.profile);
    const modelGroup =
      this.profile === "weai" || supplierKey === "chentu"
        ? configuredModelGroup(connection)
        : undefined;
    const useFriModel = this.profile === "openai" && supplierKey === "frimodel";
    const useGemini =
      this.profile === "weai" && isWeAIGeminiConnection(connection);
    const model =
      useGemini && supplierKey !== "mikoto"
        ? canonicalWeAIGeminiModel(selectedModel)
        : selectedModel;
    const effectiveParameters = request.parameters;
    const geminiProtocol = useGemini
      ? configuredGeminiProtocol(connection)
      : undefined;
    const returnsUrl =
      (useGemini && geminiProtocol === "gemini-openai-compatible") ||
      modelGroup === WEAI_ADOBE_PER_REQUEST_GROUP ||
      modelGroup === WEAI_ADOBE_PER_REQUEST_URL_GROUP ||
      supplierKey === "chentu" ||
      effectiveParameters?.["response_format"] === "url";
    const maxResponseBytes = imageJsonMaxResponseBytes(
      effectiveParameters,
      returnsUrl,
      supplierKey,
    );
    const acceptsOutputFormat =
      (useFriModel || this.profile !== "weai") ||
      (!useGemini &&
        weAIImageParameterKeys(modelGroup).includes("output_format"));
    const requestedOutputFormat = acceptsOutputFormat
      ? (imageFormat(effectiveParameters?.["output_format"]) ??
        IMAGE_FORMATS.png)
      : IMAGE_FORMATS.png;
    const commonHeaders = mergeHeaders(connection.headers, {
      ...(useGemini && supplierKey === "mikoto"
        ? { "x-goog-api-key": apiKey }
        : { Authorization: `Bearer ${apiKey}` }),
      // We-AI returns generated images as large b64_json payloads. Its
      // compression path can close the connection before Undici finishes
      // reading that response; requesting the identity representation keeps
      // the long-lived image response intact.
      ...(this.profile === "weai" ? { "Accept-Encoding": "identity" } : {}),
      "Idempotency-Key": request.idempotencyKey,
    });
    let response:
      | OpenAIImageResponse
      | GeminiGenerateContentResponse
      | FriModelChatResponse;
    let protocol: OpenAIImageTaskResult["protocol"] = "openai-images";

    if (useFriModel) {
      if (request.operation === "image.generate") {
        commonHeaders.set("content-type", "application/json");
        response = await fetchProviderJson<OpenAIImageResponse>(
          this.fetchImpl,
          joinUrl(baseUrl, "/images/generations"),
          {
            method: "POST",
            headers: commonHeaders,
            body: JSON.stringify({
              model,
              prompt: request.prompt,
              ...friModelImageParameters(effectiveParameters, model),
            }),
          },
          {
            phase: "submit",
            timeoutMs: requestTimeoutMs,
            maxResponseBytes,
            idempotent: false,
            allowLoopback: allowLoopbackGateway(connection),
          },
        );
      } else {
        // FriModel follows the standard OpenAI Images edit contract: send
        // reference files as multipart `image` fields to /images/edits.
        commonHeaders.delete("content-type");
        const form = new FormData();
        form.set("model", model);
        form.set("prompt", request.prompt);
        for (const [key, value] of Object.entries(
          friModelImageParameters(effectiveParameters, model),
        )) {
          form.set(key, String(value));
        }
        const images = (request.assets ?? []).filter(
          (asset) => asset.kind === "image",
        );
        for (const [index, image] of images.entries()) {
          const blob = await assetToBlob(image, this.fetchImpl);
          form.append(
            images.length === 1 ? "image" : "image[]",
            blob,
            filenameFor(index, image.filename, image.mimeType),
          );
        }
        response = await fetchProviderJson<OpenAIImageResponse>(
          this.fetchImpl,
          joinUrl(baseUrl, "/images/edits"),
          { method: "POST", headers: commonHeaders, body: form },
          {
            phase: "submit",
            timeoutMs: requestTimeoutMs,
            maxResponseBytes,
            idempotent: false,
            allowLoopback: allowLoopbackGateway(connection),
          },
        );
      }
      protocol = "frimodel-images";
    } else if (useGemini && geminiProtocol === "gemini-generate-content") {
      commonHeaders.set("content-type", "application/json");
      const images = (request.assets ?? []).filter(
        (asset) => asset.kind === "image",
      );
      const inlineParts = await geminiInlineImageParts(
        images,
        this.fetchImpl,
        supplierKey === "mikoto"
          ? undefined
          : WEAI_GEMINI_MAX_INPUT_IMAGE_BYTES,
      );
      response = await fetchProviderJson<GeminiGenerateContentResponse>(
        this.fetchImpl,
        geminiGenerateContentUrl(connection, this.defaultBaseUrl, model),
        {
          method: "POST",
          headers: commonHeaders,
          body: JSON.stringify({
            contents: [
              {
                ...(supplierKey === "mikoto" ? { role: "user" } : {}),
                parts: [{ text: request.prompt }, ...inlineParts],
              },
            ],
            generationConfig: geminiGenerationConfig(effectiveParameters, {
              allow512: supplierKey !== "mikoto",
              defaultImageSize:
                supplierKey === "mikoto"
                  ? [...mikotoGeminiAllowedSizes(modelGroup)].at(-1) ??
                    MIKOTO_GEMINI_DEFAULT_IMAGE_SIZE
                  : WEAI_GEMINI_DEFAULT_IMAGE_SIZE,
              includeText: supplierKey === "mikoto",
            }),
          }),
        },
        {
          phase: "submit",
          timeoutMs: requestTimeoutMs,
          maxResponseBytes,
          idempotent: false,
          allowLoopback: allowLoopbackGateway(connection),
        },
      );
      protocol = "gemini-generate-content";
    } else if (useGemini && geminiProtocol === "gemini-openai-compatible") {
      const images = (request.assets ?? []).filter(
        (asset) => asset.kind === "image",
      );
      const endpoint =
        request.operation === "image.edit"
          ? "/images/edits"
          : "/images/generations";
      const compatibleParameters = geminiOpenAIParameters(
        effectiveParameters,
        supplierKey === "mikoto"
          ? [...mikotoGeminiAllowedSizes(modelGroup)].at(-1) ??
            MIKOTO_GEMINI_DEFAULT_IMAGE_SIZE
          : WEAI_GEMINI_DEFAULT_IMAGE_SIZE,
      );
      const urlOnlyEdit =
        request.operation === "image.edit" &&
        images.length > 0 &&
        images.every(
          (image) =>
            image.data === undefined &&
            typeof image.url === "string" &&
            image.url.trim().length > 0,
        );

      if (request.operation === "image.generate" || urlOnlyEdit) {
        commonHeaders.set("content-type", "application/json");
        response = await fetchProviderJson<OpenAIImageResponse>(
          this.fetchImpl,
          geminiOpenAIUrl(connection, this.defaultBaseUrl, endpoint),
          {
            method: "POST",
            headers: commonHeaders,
            body: JSON.stringify({
              model,
              prompt: request.prompt,
              ...(urlOnlyEdit
                ? {
                    images: images.map((image) => ({
                      image_url: image.url!.trim(),
                    })),
                  }
                : {}),
              ...compatibleParameters,
            }),
          },
          {
            phase: "submit",
            timeoutMs: requestTimeoutMs,
            maxResponseBytes,
            idempotent: false,
            allowLoopback: allowLoopbackGateway(connection),
          },
        );
      } else {
        commonHeaders.delete("content-type");
        const form = new FormData();
        form.set("model", model);
        form.set("prompt", request.prompt);
        for (const [key, value] of Object.entries(compatibleParameters))
          form.set(key, value);
        for (const [index, image] of images.entries()) {
          const blob = await assetToBlob(image, this.fetchImpl);
          if (blob.size > WEAI_GEMINI_MAX_INPUT_IMAGE_BYTES) {
            throw new Error(
              `We-AI Gemini reference images must not exceed ${WEAI_GEMINI_MAX_INPUT_IMAGE_BYTES} bytes`,
            );
          }
          form.append(
            images.length === 1 ? "image" : "image[]",
            blob,
            filenameFor(index, image.filename, image.mimeType),
          );
        }
        response = await fetchProviderJson<OpenAIImageResponse>(
          this.fetchImpl,
          geminiOpenAIUrl(connection, this.defaultBaseUrl, endpoint),
          { method: "POST", headers: commonHeaders, body: form },
          {
            phase: "submit",
            timeoutMs: requestTimeoutMs,
            maxResponseBytes,
            idempotent: false,
            allowLoopback: allowLoopbackGateway(connection),
          },
        );
      }
      protocol = "gemini-openai-compatible";
    } else if (supplierKey === "chentu" && request.operation === "image.edit") {
      // 辰途低价 Adobe 路由实际要求 multipart 的 `image` 字段。即使
      // 运行时同时附带了本地素材的签名 URL，也必须优先上传真实字节；
      // 该路由会忽略只提供 `image_url` 的请求并返回 "image is required"。
      // 只有调用方确实没有图片字节、仅有远程 URL 时才使用 image_url。
      commonHeaders.delete("content-type");
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", request.prompt);
      for (const [key, value] of Object.entries(
        imageParameters(
          effectiveParameters,
          model,
          this.profile,
          modelGroup,
          supplierKey,
        ),
      )) {
        form.set(key, String(value));
      }
      const images = (request.assets ?? []).filter(
        (asset) => asset.kind === "image",
      );
      for (const [index, image] of images.entries()) {
        const imageUrl =
          image.data === undefined &&
          typeof image.url === "string" &&
          /^https?:\/\//iu.test(image.url.trim())
            ? image.url.trim()
            : undefined;
        if (imageUrl !== undefined) {
          // The Chentu contract names this field `image_url` (not
          // `image_url[]`); repeated fields are accepted for multi-image edits.
          form.append("image_url", imageUrl);
          continue;
        }
        const blob = await assetToBlob(image, this.fetchImpl);
        form.append(
          images.length === 1 ? "image" : "image[]",
          blob,
          filenameFor(index, image.filename, image.mimeType),
        );
      }
      response = await fetchProviderJson<OpenAIImageResponse>(
        this.fetchImpl,
        joinUrl(baseUrl, "/images/edits"),
        { method: "POST", headers: commonHeaders, body: form },
        {
          phase: "submit",
          timeoutMs: requestTimeoutMs,
          maxResponseBytes,
          idempotent: false,
          allowLoopback: allowLoopbackGateway(connection),
        },
      );
    } else if (request.operation === "image.edit") {
      // A connection may carry a default JSON Content-Type. FormData needs
      // fetch to provide the multipart boundary instead.
      commonHeaders.delete("content-type");
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", request.prompt);
      for (const [key, value] of Object.entries(
        imageParameters(
          effectiveParameters,
          model,
          this.profile,
          modelGroup,
          supplierKey,
        ),
      )) {
        form.set(key, String(value));
      }
      const images = (request.assets ?? []).filter(
        (asset) => asset.kind === "image",
      );
      for (const [index, image] of images.entries()) {
        const blob = await assetToBlob(image, this.fetchImpl);
        const field = images.length === 1 ? "image" : "image[]";
        form.append(
          field,
          blob,
          filenameFor(index, image.filename, image.mimeType),
        );
      }
      response = await fetchProviderJson<OpenAIImageResponse>(
        this.fetchImpl,
        joinUrl(baseUrl, "/images/edits"),
        { method: "POST", headers: commonHeaders, body: form },
        {
          phase: "submit",
          timeoutMs: requestTimeoutMs,
          maxResponseBytes,
          // The header lets a provider implement deduplication, but OpenAI's
          // image endpoint does not provide a documented replay guarantee.
          // Treat a lost response as ambiguous rather than auto-resubmitting.
          idempotent: false,
          allowLoopback: allowLoopbackGateway(connection),
        },
      );
    } else {
      commonHeaders.set("content-type", "application/json");
      response = await fetchProviderJson<OpenAIImageResponse>(
        this.fetchImpl,
        joinUrl(baseUrl, "/images/generations"),
        {
          method: "POST",
          headers: commonHeaders,
          body: JSON.stringify({
            model,
            prompt: request.prompt,
            ...imageParameters(
              effectiveParameters,
              model,
              this.profile,
              modelGroup,
              supplierKey,
            ),
          }),
        },
        {
          phase: "submit",
          timeoutMs: requestTimeoutMs,
          maxResponseBytes,
          idempotent: false,
          allowLoopback: allowLoopbackGateway(connection),
        },
      );
    }

    const taskPrefix = this.profile === "weai" ? "weai" : "openai";
    return {
      providerTaskId: `${taskPrefix}:${request.idempotencyKey}`,
      id: `${taskPrefix}:${request.idempotencyKey}`,
      status: "succeeded",
      result: {
        response,
        outputFormat: requestedOutputFormat.format,
        protocol,
      } satisfies OpenAIImageTaskResult,
    };
  }

  public async extractOutputs(result: unknown): Promise<RemoteArtifact[]> {
    if (!result || typeof result !== "object") return [];
    const envelope =
      isRecord(result) && isRecord(result.response)
        ? (result as unknown as OpenAIImageTaskResult)
        : undefined;
    const response = envelope?.response ?? result;
    if (
      envelope?.protocol === "gemini-generate-content" ||
      (isRecord(response) && Array.isArray(response.candidates))
    ) {
      return extractGeminiOutputs(
        response as GeminiGenerateContentResponse,
        this.profile,
      );
    }
    if (
      envelope?.protocol === "frimodel-chat-completions" ||
      (isRecord(response) && Array.isArray(response.choices))
    ) {
      return extractFriModelOutputs(
        response as FriModelChatResponse,
        this.profile,
        envelope?.outputFormat,
      );
    }
    const openAIResponse = response as OpenAIImageResponse;
    if (!Array.isArray(openAIResponse.data)) return [];
    return openAIResponse.data.flatMap((item, index): RemoteArtifact[] => {
      if (typeof item.b64_json === "string") {
        const decoded = decodeImageBase64(item.b64_json);
        const data = decoded.data;
        const format =
          imageFormatFromBytes(data) ??
          decoded.format ??
          imageFormat(item.mime_type) ??
          imageFormat(item.output_format) ??
          imageFormat(openAIResponse.output_format) ??
          imageFormat(envelope?.outputFormat) ??
          IMAGE_FORMATS.png;
        return [
          {
            kind: "image" as const,
            data,
            mimeType: format.mimeType,
            filename: `${this.profile}-${index + 1}.${format.extension}`,
          },
        ];
      }
      if (typeof item.url === "string") {
        const format =
          imageFormatFromUrl(item.url) ??
          imageFormat(item.mime_type) ??
          imageFormat(item.output_format) ??
          imageFormat(openAIResponse.output_format) ??
          imageFormat(envelope?.outputFormat);
        return [
          {
            kind: "image" as const,
            url: item.url,
            ...(format
              ? {
                  mimeType: format.mimeType,
                  filename: `${this.profile}-${index + 1}.${format.extension}`,
                }
              : {}),
          },
        ];
      }
      return [];
    });
  }
}

export const OPENAI_DEFAULT_IMAGE_MODEL = DEFAULT_MODEL;
export const WEAI_DEFAULT_IMAGE_MODEL = DEFAULT_MODEL;
export const WEAI_GEMINI_DEFAULT_IMAGE_MODEL = WEAI_GEMINI_DEFAULT_MODEL;
export const WEAI_DEFAULT_IMAGE_BASE_URL = WEAI_DEFAULT_BASE_URL;
export const WEAI_IMAGE_REQUEST_TIMEOUT_MS = WEAI_REQUEST_TIMEOUT_MS;

export type WeAIImageAdapterOptions = Omit<
  OpenAIImageAdapterOptions,
  "profile"
>;

export class WeAIImageAdapter extends OpenAIImageAdapter {
  public constructor(
    connections: ProviderConnectionResolver,
    options: WeAIImageAdapterOptions = {},
  ) {
    super(connections, {
      ...options,
      profile: "weai",
      requestTimeoutMs: options.requestTimeoutMs ?? WEAI_REQUEST_TIMEOUT_MS,
    });
  }
}

export const OpenAIAdapter = OpenAIImageAdapter;
