/**
 * Client-safe snapshot of the authenticated We-AI model marketplace.
 *
 * Marketplace visibility and canvas routing are deliberately modelled as two
 * different facts. Prices and multipliers were captured from the marketplace
 * on 2026-08-02. Protocol and parameter capabilities come from the dedicated
 * We-AI image-routing documents. A model being present in the marketplace does
 * not by itself mean that the documented canvas route accepts it.
 */

import {
  weAIModelDescriptors,
  type ModelDescriptor,
  type WeAIGeminiProtocol,
} from "@super-canvas/providers/weai-models";

export const WEAI_BASE_URL = "https://asian-acc.we-token.cc/v1";

export const WEAI_CATALOG_CAPTURED_AT = "实时同步";
export const WEAI_CURRENCY_NOTE = "1 人民币 = 1 美元";
export const WEAI_MARKETPLACE_SOURCE_NOTE =
  "价格随模型扫描从 We-AI 模型广场实时同步；广场接口不可用时读取官方文档，并保留最后一次成功值与更新时间。";
export const WEAI_ROUTE_SOURCE_NOTE =
  "分组与价格以 We-AI 登录模型广场为准；协议、模型 ID 与参数限制以 We-AI 专属生图文档为准，广场可见不等于路由可调用。";

export const WEAI_ADOBE_TOKEN_GROUP = "生图-openai-adobe-token计费";
export const WEAI_GEMINI_GROUP = "gemini香蕉";
export const WEAI_AZURE_OPENAI_GROUP = "AZURE-openai";
export const WEAI_ADOBE_PER_REQUEST_GROUP = "生图-openai-adobe-按次";
/** @deprecated Use WEAI_ADOBE_PER_REQUEST_GROUP. */
export const WEAI_ADOBE_PER_IMAGE_GROUP = WEAI_ADOBE_PER_REQUEST_GROUP;
export const WEAI_CODEX_TOKEN_GROUP = "生图-openai-codex-token计费";
export const WEAI_ADOBE_PER_REQUEST_URL_GROUP =
  "生图-openai-adobe-按次-返回url";

export const WEAI_GROUP_IDS = [
  // Keep the authenticated model-plaza order. The selector in We-AI shows
  // CODEX, Gemini, Azure, Adobe per-request, Adobe token, then the URL route
  // (the text-only and Claude groups are deliberately outside this image-only
  // canvas catalog).
  WEAI_CODEX_TOKEN_GROUP,
  WEAI_GEMINI_GROUP,
  WEAI_AZURE_OPENAI_GROUP,
  WEAI_ADOBE_PER_REQUEST_GROUP,
  WEAI_ADOBE_TOKEN_GROUP,
  WEAI_ADOBE_PER_REQUEST_URL_GROUP,
] as const;

export type WeAiGroupId = (typeof WEAI_GROUP_IDS)[number];
export type WeAiProtocol =
  "openai-images" | "gemini-openai-compatible" | "gemini-generate-content";
export type WeAiBillingMode = "token" | "per-image" | "per-request";
export type WeAiPriceDimension = "quality" | "resolution" | "fixed";
export type WeAiRouteStatus =
  "callable" | "alias" | "marketplace-only" | "route-disabled";

export interface WeAiProtocolOption {
  readonly id: WeAiProtocol;
  readonly label: string;
  readonly description: string;
}

export interface WeAiTokenPricing {
  readonly kind: "token";
  readonly currency: "USD";
  readonly unit: "1M tokens";
  /** Adjusted text/prompt input price per one million tokens. */
  readonly input: number;
  /** Adjusted text output price per one million tokens. */
  readonly output: number;
  /** Adjusted cache-read price per one million tokens. */
  readonly cacheRead: number;
  /** Adjusted image-output price per one million image tokens. */
  readonly imageOutput: number;
}

export interface WeAiPriceTier {
  /** Stable machine-readable tier key. */
  readonly id: string;
  /** Marketplace label, for example 1K, LOW, or HIGH. */
  readonly label: string;
  readonly price: number;
}

/** @deprecated Prefer WeAiPriceTier; retained for callers of the old type. */
export type WeAiPerImagePriceTier = WeAiPriceTier;

export interface WeAiPerImagePricing {
  readonly kind: "per-image";
  readonly currency: "USD";
  readonly unit: "image";
  readonly dimension: "resolution";
  readonly tiers: readonly WeAiPriceTier[];
}

export interface WeAiPerRequestPricing {
  readonly kind: "per-request";
  readonly currency: "USD";
  readonly unit: "request";
  readonly dimension: "quality" | "fixed";
  readonly tiers: readonly WeAiPriceTier[];
  /** Informational sizes supported at the same request price. */
  readonly supportedSizes?: readonly string[];
}

export type WeAiModelPricing =
  WeAiTokenPricing | WeAiPerImagePricing | WeAiPerRequestPricing;

export interface WeAiLivePriceTier {
  readonly id: string;
  readonly label: string;
  readonly price: number;
}

export type WeAiLiveModelPricing =
  | {
      readonly kind: "token";
      readonly multiplier: number;
      readonly input?: number;
      readonly output?: number;
      readonly cacheRead?: number;
      readonly imageOutput?: number;
    }
  | {
      readonly kind: "per-image" | "per-request";
      readonly multiplier: number;
      readonly tiers: readonly WeAiLivePriceTier[];
    };

/** Sanitized website-pricing data persisted with one We-AI connection. */
export interface WeAiLiveGroupPricing {
  readonly groupId: string;
  readonly source: "model-plaza" | "official-docs";
  readonly sourceUrl: string;
  readonly checkedAt: string;
  /** True when the model plaza returned the complete group; docs are partial. */
  readonly complete: boolean;
  readonly multiplier: number;
  readonly models: Readonly<Record<string, WeAiLiveModelPricing>>;
}

export interface WeAiModelLimits {
  readonly maxInputImages?: number;
  readonly maxOutputImages?: number;
  readonly supportedInputMimeTypes?: readonly string[];
  readonly notes?: readonly string[];
}

export interface WeAiCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly pricing: WeAiModelPricing;
  /** True only when a dedicated We-AI route document permits canvas calls. */
  readonly canvasCallable: boolean;
  readonly routeStatus: WeAiRouteStatus;
  readonly routeNote: string;
  /** Canonical route model when this marketplace model is a documented alias. */
  readonly aliasFor?: string;
  readonly limits?: WeAiModelLimits;
}

export interface WeAiCatalogGroup {
  readonly id: WeAiGroupId;
  readonly label: string;
  readonly description: string;
  /** Multiplier shown by We-AI. Model prices below already include it. */
  readonly multiplier: number;
  readonly billingMode: WeAiBillingMode;
  readonly billingLabel: string;
  /** Default protocol for a new connection. */
  readonly protocol: WeAiProtocol;
  readonly protocolLabel: string;
  readonly protocols: readonly WeAiProtocolOption[];
  readonly defaultModel: string;
  readonly canvasSupported: boolean;
  readonly canvasSupportNote?: string;
  readonly pricesIncludeMultiplier: true;
  readonly models: readonly WeAiCatalogModel[];
}

const OPENAI_IMAGE_LIMITS: WeAiModelLimits = {
  maxInputImages: 16,
  maxOutputImages: 1,
  supportedInputMimeTypes: ["image/png", "image/jpeg", "image/webp"],
};

const OPENAI_MULTI_OUTPUT_LIMITS: WeAiModelLimits = {
  ...OPENAI_IMAGE_LIMITS,
  maxOutputImages: 10,
};

const ADOBE_FIXED_QUALITY_LIMITS: WeAiModelLimits = {
  ...OPENAI_MULTI_OUTPUT_LIMITS,
  notes: ["画质由模型名固定", "支持 1K、2K、4K，三种尺寸单次价格相同"],
};

const GEMINI_IMAGE_LIMITS: WeAiModelLimits = {
  maxInputImages: 14,
  maxOutputImages: 1,
  supportedInputMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  notes: ["单次固定生成 1 张", "单张参考图解码后不超过 20 MB"],
};

function tokenPricing(
  input: number,
  output: number,
  cacheRead: number,
  imageOutput: number,
): WeAiTokenPricing {
  return {
    kind: "token",
    currency: "USD",
    unit: "1M tokens",
    input,
    output,
    cacheRead,
    imageOutput,
  };
}

function perImagePricing(tiers: readonly WeAiPriceTier[]): WeAiPerImagePricing {
  return {
    kind: "per-image",
    currency: "USD",
    unit: "image",
    dimension: "resolution",
    tiers,
  };
}

function perRequestPricing(
  dimension: "quality" | "fixed",
  tiers: readonly WeAiPriceTier[],
  supportedSizes?: readonly string[],
): WeAiPerRequestPricing {
  return {
    kind: "per-request",
    currency: "USD",
    unit: "request",
    dimension,
    tiers,
    ...(supportedSizes ? { supportedSizes } : {}),
  };
}

function resolutionTiers(
  oneK: number,
  twoK: number,
  fourK: number,
): readonly WeAiPriceTier[] {
  return [
    { id: "1k", label: "1K", price: oneK },
    { id: "2k", label: "2K", price: twoK },
    { id: "4k", label: "4K", price: fourK },
  ];
}

function fixedRequestPrice(price: number): WeAiPerRequestPricing {
  return perRequestPricing(
    "fixed",
    [{ id: "request", label: "单次", price }],
    ["1K", "2K", "4K"],
  );
}

const OPENAI_IMAGES_PROTOCOL: WeAiProtocolOption = {
  id: "openai-images",
  label: "OpenAI Images API",
  description: "使用 /v1/images/generations 与 /v1/images/edits。",
};
const GEMINI_OPENAI_PROTOCOL: WeAiProtocolOption = {
  id: "gemini-openai-compatible",
  label: "OpenAI 兼容 Images API（默认）",
  description:
    "使用 /v1/images/generations 与 /v1/images/edits；按兼容文档传 size、aspectRatio 等参数。",
};
const GEMINI_NATIVE_PROTOCOL: WeAiProtocolOption = {
  id: "gemini-generate-content",
  label: "Google 原生 generateContent API",
  description:
    "使用 /v1beta/models/{model}:generateContent；按原生文档传 generationConfig.imageConfig。",
};
const OPENAI_IMAGE_TAGS = ["生图", "图片编辑", "OpenAI Images"] as const;

const callable = (routeNote: string) => ({
  canvasCallable: true as const,
  routeStatus: "callable" as const,
  routeNote,
});
const marketplaceOnly = (routeNote: string) => ({
  canvasCallable: false as const,
  routeStatus: "marketplace-only" as const,
  routeNote,
});

const WEAI_CATALOG_SOURCE: readonly WeAiCatalogGroup[] = [
  {
    id: WEAI_ADOBE_TOKEN_GROUP,
    label: WEAI_ADOBE_TOKEN_GROUP,
    description: "We-AI Adobe 生图线路，按 Token 用量计费。",
    multiplier: 1,
    billingMode: "token",
    billingLabel: "按 Token 计费",
    protocol: OPENAI_IMAGES_PROTOCOL.id,
    protocolLabel: OPENAI_IMAGES_PROTOCOL.label,
    protocols: [OPENAI_IMAGES_PROTOCOL],
    defaultModel: "gpt-image-2",
    canvasSupported: true,
    pricesIncludeMultiplier: true,
    models: [
      {
        id: "gpt-image-2",
        name: "GPT Image 2",
        description: "Adobe Token 分组的 GPT Image 2 生图与图片编辑模型。",
        tags: OPENAI_IMAGE_TAGS,
        pricing: tokenPricing(5, 10, 1.25, 30),
        ...callable("专属生图路由文档明确允许 Adobe Token 使用 gpt-image-2。"),
        limits: OPENAI_MULTI_OUTPUT_LIMITS,
      },
    ],
  },
  {
    id: WEAI_GEMINI_GROUP,
    label: WEAI_GEMINI_GROUP,
    description: "We-AI Gemini 香蕉生图线路，按输出分辨率逐张计费。",
    multiplier: 1,
    billingMode: "per-image",
    billingLabel: "按张计费",
    protocol: GEMINI_OPENAI_PROTOCOL.id,
    protocolLabel: GEMINI_OPENAI_PROTOCOL.label,
    protocols: [GEMINI_OPENAI_PROTOCOL, GEMINI_NATIVE_PROTOCOL],
    defaultModel: "gemini-3.1-flash-image",
    canvasSupported: true,
    canvasSupportNote:
      "可选 OpenAI 兼容 Images API 或 Google 原生 generateContent API；两套协议不可混用参数。",
    pricesIncludeMultiplier: true,
    models: [
      {
        id: "gemini-3-pro-image",
        name: "Gemini 3 Pro Image",
        description: "Gemini 3 Pro 生图模型，按 1K、2K、4K 输出分辨率计费。",
        tags: ["生图", "Gemini", "Pro"],
        pricing: perImagePricing(resolutionTiers(0.06, 0.08, 0.1)),
        ...callable("专属 Gemini 路由文档明确列出的基础模型。"),
        limits: GEMINI_IMAGE_LIMITS,
      },
      {
        id: "gemini-3-pro-image-preview",
        name: "Gemini 3 Pro Image Preview",
        description: "Gemini 3 Pro Image 的兼容别名；画布会规范化为基础模型。",
        tags: ["生图", "Gemini", "Pro", "Preview", "别名"],
        pricing: perImagePricing(resolutionTiers(0.06, 0.08, 0.1)),
        canvasCallable: false,
        routeStatus: "alias",
        routeNote:
          "专属 Gemini 文档说明 -preview 会作为别名剥除；画布仅暴露并提交基础模型 gemini-3-pro-image。",
        aliasFor: "gemini-3-pro-image",
        limits: GEMINI_IMAGE_LIMITS,
      },
      {
        id: "gemini-3.0-pro-image",
        name: "Gemini 3.0 Pro Image",
        description: "模型广场展示的 Gemini 3.0 Pro 生图模型。",
        tags: ["生图", "Gemini", "Pro", "仅广场"],
        pricing: perImagePricing(resolutionTiers(0.06, 0.08, 0.1)),
        ...marketplaceOnly(
          "当前模型广场可见，但专属 Gemini 路由文档未承诺该模型 ID；不可设为画布默认。",
        ),
        limits: GEMINI_IMAGE_LIMITS,
      },
      {
        id: "gemini-3.0-pro-image-preview",
        name: "Gemini 3.0 Pro Image Preview",
        description: "模型广场展示的 Gemini 3.0 Pro Image 预览模型。",
        tags: ["生图", "Gemini", "Pro", "Preview", "仅广场"],
        pricing: perImagePricing(resolutionTiers(0.06, 0.08, 0.1)),
        ...marketplaceOnly(
          "当前模型广场可见，但专属 Gemini 路由文档未承诺该模型 ID；不可设为画布默认。",
        ),
        limits: GEMINI_IMAGE_LIMITS,
      },
      {
        id: "gemini-3.1-flash-image",
        name: "Gemini 3.1 Flash Image",
        description: "Gemini 3.1 Flash 生图模型，按输出分辨率计费。",
        tags: ["生图", "Gemini", "Flash"],
        pricing: perImagePricing(resolutionTiers(0.04, 0.06, 0.08)),
        ...callable("专属 Gemini 路由文档明确列出的基础模型。"),
        limits: GEMINI_IMAGE_LIMITS,
      },
      {
        id: "gemini-3.1-flash-image-preview",
        name: "Gemini 3.1 Flash Image Preview",
        description:
          "模型广场展示的 Gemini 3.1 Flash Image 预览别名；画布会规范化为基础模型。",
        tags: ["生图", "Gemini", "Flash", "Preview", "别名"],
        pricing: perImagePricing(resolutionTiers(0.04, 0.06, 0.08)),
        canvasCallable: false,
        routeStatus: "alias",
        routeNote:
          "画布不直接提交 Preview ID；保存的旧值会规范化为基础模型 gemini-3.1-flash-image。",
        aliasFor: "gemini-3.1-flash-image",
        limits: GEMINI_IMAGE_LIMITS,
      },
    ],
  },
  {
    id: WEAI_AZURE_OPENAI_GROUP,
    label: WEAI_AZURE_OPENAI_GROUP,
    description: "We-AI Azure OpenAI 生图线路，按 Token 用量计费。",
    multiplier: 3,
    billingMode: "token",
    billingLabel: "按 Token 计费",
    protocol: OPENAI_IMAGES_PROTOCOL.id,
    protocolLabel: OPENAI_IMAGES_PROTOCOL.label,
    protocols: [OPENAI_IMAGES_PROTOCOL],
    defaultModel: "gpt-image-2",
    canvasSupported: true,
    pricesIncludeMultiplier: true,
    models: [
      {
        id: "gpt-image-1",
        name: "GPT Image 1",
        description: "Azure OpenAI 模型广场展示的 GPT Image 1。",
        tags: [...OPENAI_IMAGE_TAGS, "仅广场"],
        pricing: tokenPricing(15, 0, 3.75, 120),
        ...marketplaceOnly(
          "模型广场可见，但当前专属 Azure 生图路由文档只承诺 gpt-image-2。",
        ),
        limits: OPENAI_MULTI_OUTPUT_LIMITS,
      },
      {
        id: "gpt-image-1.5",
        name: "GPT Image 1.5",
        description: "Azure OpenAI 模型广场展示的 GPT Image 1.5。",
        tags: [...OPENAI_IMAGE_TAGS, "仅广场"],
        pricing: tokenPricing(15, 30, 3.75, 96),
        ...marketplaceOnly(
          "模型广场可见，但当前专属 Azure 生图路由文档只承诺 gpt-image-2。",
        ),
        limits: OPENAI_MULTI_OUTPUT_LIMITS,
      },
      {
        id: "gpt-image-2",
        name: "GPT Image 2",
        description: "Azure OpenAI 分组的 GPT Image 2 生图与图片编辑模型。",
        tags: OPENAI_IMAGE_TAGS,
        pricing: tokenPricing(15, 30, 3.75, 90),
        ...callable("当前专属 Azure 生图路由文档明确允许 gpt-image-2。"),
        limits: OPENAI_MULTI_OUTPUT_LIMITS,
      },
    ],
  },
  {
    id: WEAI_ADOBE_PER_REQUEST_GROUP,
    label: WEAI_ADOBE_PER_REQUEST_GROUP,
    description: "We-AI Adobe 生图线路，按一次请求的固定画质模型计费。",
    multiplier: 1,
    billingMode: "per-request",
    billingLabel: "按次计费",
    protocol: OPENAI_IMAGES_PROTOCOL.id,
    protocolLabel: OPENAI_IMAGES_PROTOCOL.label,
    protocols: [OPENAI_IMAGES_PROTOCOL],
    defaultModel: "gpt-image-2-low",
    canvasSupported: true,
    canvasSupportNote:
      "画布只能调用带 -low、-medium、-high 后缀的固定画质模型。",
    pricesIncludeMultiplier: true,
    models: [
      {
        id: "gpt-image-2",
        name: "GPT Image 2",
        description:
          "模型广场展示 LOW、MEDIUM、HIGH 按次价格；但按次专属路由禁止使用普通模型名。",
        tags: [...OPENAI_IMAGE_TAGS, "路由禁用"],
        pricing: perRequestPricing(
          "quality",
          [
            { id: "low", label: "LOW", price: 0.04 },
            { id: "medium", label: "MEDIUM", price: 0.07 },
            { id: "high", label: "HIGH", price: 0.15 },
          ],
          ["1K", "2K", "4K"],
        ),
        canvasCallable: false,
        routeStatus: "route-disabled",
        routeNote:
          "专属 Adobe 按次路由文档明确说明：传普通 gpt-image-2 会报错；这里只保留模型广场价格信息。",
        limits: OPENAI_MULTI_OUTPUT_LIMITS,
      },
      {
        id: "gpt-image-2-low",
        name: "GPT Image 2 LOW",
        description: "固定 LOW 画质；1K、2K、4K 均为 $0.04/次。",
        tags: [...OPENAI_IMAGE_TAGS, "LOW", "1K", "2K", "4K"],
        pricing: fixedRequestPrice(0.04),
        ...callable("专属 Adobe 按次路由文档明确允许该固定画质模型名。"),
        limits: ADOBE_FIXED_QUALITY_LIMITS,
      },
      {
        id: "gpt-image-2-medium",
        name: "GPT Image 2 MEDIUM",
        description: "固定 MEDIUM 画质；1K、2K、4K 均为 $0.07/次。",
        tags: [...OPENAI_IMAGE_TAGS, "MEDIUM", "1K", "2K", "4K"],
        pricing: fixedRequestPrice(0.07),
        ...callable("专属 Adobe 按次路由文档明确允许该固定画质模型名。"),
        limits: ADOBE_FIXED_QUALITY_LIMITS,
      },
      {
        id: "gpt-image-2-high",
        name: "GPT Image 2 HIGH",
        description: "固定 HIGH 画质；1K、2K、4K 均为 $0.15/次。",
        tags: [...OPENAI_IMAGE_TAGS, "HIGH", "1K", "2K", "4K"],
        pricing: fixedRequestPrice(0.15),
        ...callable("专属 Adobe 按次路由文档明确允许该固定画质模型名。"),
        limits: ADOBE_FIXED_QUALITY_LIMITS,
      },
    ],
  },
  {
    id: WEAI_CODEX_TOKEN_GROUP,
    label: WEAI_CODEX_TOKEN_GROUP,
    description: "We-AI CODEX 生图线路，按 Token 用量计费。",
    multiplier: 0.7,
    billingMode: "token",
    billingLabel: "按 Token 计费",
    protocol: OPENAI_IMAGES_PROTOCOL.id,
    protocolLabel: OPENAI_IMAGES_PROTOCOL.label,
    protocols: [OPENAI_IMAGES_PROTOCOL],
    defaultModel: "gpt-image-2",
    canvasSupported: true,
    pricesIncludeMultiplier: true,
    models: [
      {
        id: "gpt-image-1",
        name: "GPT Image 1",
        description: "CODEX Token 模型广场展示的 GPT Image 1。",
        tags: [...OPENAI_IMAGE_TAGS, "仅广场"],
        pricing: tokenPricing(3.5, 0, 0.875, 28),
        ...marketplaceOnly(
          "模型广场可见，但当前专属 CODEX 生图路由文档只承诺 gpt-image-2。",
        ),
        limits: OPENAI_IMAGE_LIMITS,
      },
      {
        id: "gpt-image-1.5",
        name: "GPT Image 1.5",
        description: "CODEX Token 模型广场展示的 GPT Image 1.5。",
        tags: [...OPENAI_IMAGE_TAGS, "仅广场"],
        pricing: tokenPricing(3.5, 7, 0.875, 22.4),
        ...marketplaceOnly(
          "模型广场可见，但当前专属 CODEX 生图路由文档只承诺 gpt-image-2。",
        ),
        limits: OPENAI_IMAGE_LIMITS,
      },
      {
        id: "gpt-image-2",
        name: "GPT Image 2",
        description: "CODEX Token 分组的 GPT Image 2 生图与图片编辑模型。",
        tags: OPENAI_IMAGE_TAGS,
        pricing: tokenPricing(3.5, 7, 0.875, 21),
        ...callable("当前专属 CODEX 生图路由文档明确要求使用 gpt-image-2。"),
        limits: {
          ...OPENAI_IMAGE_LIMITS,
          notes: ["当前 CODEX 专属分组单次仅支持生成 1 张"],
        },
      },
    ],
  },
  {
    id: WEAI_ADOBE_PER_REQUEST_URL_GROUP,
    label: WEAI_ADOBE_PER_REQUEST_URL_GROUP,
    description:
      "We-AI Adobe 按次返回 URL 线路；使用普通 gpt-image-2，并以 URL 返回生成结果。",
    multiplier: 1,
    billingMode: "per-request",
    billingLabel: "按次计费",
    protocol: OPENAI_IMAGES_PROTOCOL.id,
    protocolLabel: "OpenAI Images API（URL 返回）",
    protocols: [OPENAI_IMAGES_PROTOCOL],
    defaultModel: "gpt-image-2",
    canvasSupported: true,
    canvasSupportNote:
      "这是独立的返回 URL 分组，不适用 Adobe 按次分组的后缀模型限制。",
    pricesIncludeMultiplier: true,
    models: [
      {
        id: "gpt-image-2",
        name: "GPT Image 2",
        description:
          "返回 URL 分组的普通 GPT Image 2；LOW、MEDIUM、HIGH 按一次请求计费。",
        tags: [...OPENAI_IMAGE_TAGS, "返回 URL", "1K", "2K", "4K"],
        pricing: perRequestPricing(
          "quality",
          [
            { id: "low", label: "LOW", price: 0.04 },
            { id: "medium", label: "MEDIUM", price: 0.07 },
            { id: "high", label: "HIGH", price: 0.15 },
          ],
          ["1K", "2K", "4K"],
        ),
        ...callable(
          "We-AI 当前独立返回 URL 分组明确提供普通 gpt-image-2；不要与无 URL 的 Adobe 按次线路混用模型名。",
        ),
        limits: OPENAI_MULTI_OUTPUT_LIMITS,
      },
    ],
  },
];

/**
 * Keep the canvas catalog in the same order as the authenticated We-AI model
 * plaza.  The source is intentionally kept grouped by implementation details;
 * this export is the single display and selection order used by the app.
 */
export const WEAI_CATALOG: readonly WeAiCatalogGroup[] = WEAI_GROUP_IDS.map(
  (groupId) => {
    const group = WEAI_CATALOG_SOURCE.find(
      (candidate) => candidate.id === groupId,
    );
    if (!group) {
      throw new Error(`Missing We-AI catalog entry for ${groupId}`);
    }
    return group;
  },
);

const WEAI_CATALOG_BY_ID = new Map(
  WEAI_CATALOG.map((group) => [group.id, group] as const),
);

export function isWeAiGroupId(value: string): value is WeAiGroupId {
  return WEAI_CATALOG_BY_ID.has(value as WeAiGroupId);
}

export function weAiCatalogGroup(
  groupId: string,
): WeAiCatalogGroup | undefined {
  return WEAI_CATALOG_BY_ID.get(groupId as WeAiGroupId);
}

export function weAiCatalogModel(
  groupId: string,
  modelId: string,
): WeAiCatalogModel | undefined {
  return weAiCatalogGroup(groupId)?.models.find(
    (model) => model.id === modelId,
  );
}

export type WeAiResolutionTier = "1k" | "2k" | "4k";

/**
 * Resolves an official We-AI size preset for a legacy resolution tier.
 * A saved aspect ratio wins when a matching preset exists; otherwise the
 * first documented preset in that tier is used.  This avoids silently turning
 * a saved 16:9 4K canvas into a square image during migration.
 */
export function weAiSizePresetForTier(
  model: Pick<ModelDescriptor, "parameters">,
  tier: WeAiResolutionTier,
  aspectRatio?: unknown,
): string | undefined {
  const sizeParameter = model.parameters?.find(
    (parameter) => parameter.key === "size",
  );
  const tierPrefix = tier.toUpperCase();
  const options = (sizeParameter?.options ?? []).filter((option) =>
    option.label.toUpperCase().startsWith(tierPrefix),
  );
  const savedRatio = typeof aspectRatio === "string" ? aspectRatio.trim() : "";
  const matched = savedRatio
    ? options.find((option) => option.label.includes(savedRatio))
    : undefined;
  const value = matched?.value ?? options[0]?.value;
  return typeof value === "string" && value !== "auto" ? value : undefined;
}

export function weAiCallableModels(
  group: WeAiCatalogGroup,
): readonly WeAiCatalogModel[] {
  return group.models.filter((model) => model.canvasCallable);
}

/** Builds an immediate canvas model list from the verified static catalog. */
export function weAiCanvasModelDescriptors(
  groupId: string,
  requestedProtocol?: unknown,
  requestedDefaultModel?: unknown,
  livePricing?: WeAiLiveGroupPricing,
): ModelDescriptor[] {
  const group = weAiCatalogGroup(groupId);
  if (!group) return [];
  const protocol = resolveWeAiProtocol(group, requestedProtocol);
  const defaultModel = resolveWeAiDefaultModel(
    group,
    typeof requestedDefaultModel === "string"
      ? requestedDefaultModel
      : undefined,
  );
  const geminiProtocol: WeAIGeminiProtocol =
    protocol === "gemini-openai-compatible"
      ? "gemini-openai-compatible"
      : "gemini-generate-content";
  return applyWeAiLivePricing(
    weAiCallableModels(group).flatMap((model) =>
      weAIModelDescriptors(
      model.id,
      model.id === defaultModel,
      group.id,
      geminiProtocol,
      ),
    ),
    livePricing,
  );
}

function validLivePrice(value: unknown): value is WeAiLiveModelPricing {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    record.kind === "token" &&
    typeof record.multiplier === "number" &&
    Number.isFinite(record.multiplier)
  )
    return true;
  return (
    (record.kind === "per-image" || record.kind === "per-request") &&
    typeof record.multiplier === "number" &&
    Number.isFinite(record.multiplier) &&
    Array.isArray(record.tiers)
  );
}

/** Rejects malformed saved pricing instead of rendering untrusted config. */
export function readWeAiLivePricing(
  config: Readonly<Record<string, unknown>>,
): WeAiLiveGroupPricing | undefined {
  const value = config.weAiLivePricing;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const groupId = typeof record.groupId === "string" ? record.groupId : "";
  const configuredGroup =
    typeof config.modelGroup === "string" ? config.modelGroup : "";
  if (!groupId || groupId !== configuredGroup) return undefined;
  if (
    record.source !== "model-plaza" &&
    record.source !== "official-docs"
  )
    return undefined;
  if (
    typeof record.sourceUrl !== "string" ||
    typeof record.checkedAt !== "string" ||
    typeof record.complete !== "boolean" ||
    typeof record.multiplier !== "number" ||
    !Number.isFinite(record.multiplier) ||
    !record.models ||
    typeof record.models !== "object" ||
    Array.isArray(record.models)
  )
    return undefined;
  const models = Object.fromEntries(
    Object.entries(record.models as Record<string, unknown>).filter(
      ([id, pricing]) => Boolean(id.trim()) && validLivePrice(pricing),
    ),
  ) as Record<string, WeAiLiveModelPricing>;
  return {
    groupId,
    source: record.source,
    sourceUrl: record.sourceUrl,
    checkedAt: record.checkedAt,
    complete: record.complete,
    multiplier: record.multiplier,
    models,
  };
}

function compactMoney(value: number): string {
  return `$${Number(value.toFixed(6))}`;
}

function livePricingLabel(pricing: WeAiLiveModelPricing): string {
  if (pricing.kind === "token") {
    const details = [
      pricing.input === undefined
        ? undefined
        : `入 ${compactMoney(pricing.input)}/M`,
      pricing.output === undefined
        ? undefined
        : `出 ${compactMoney(pricing.output)}/M`,
      pricing.imageOutput === undefined
        ? undefined
        : `图片 ${compactMoney(pricing.imageOutput)}/M`,
    ].filter(Boolean);
    return `${pricing.multiplier}× Token${details.length ? ` · ${details.join(" · ")}` : ""}`;
  }
  const unit = pricing.kind === "per-image" ? "张" : "次";
  return pricing.tiers
    .map((tier) => {
      const label = tier.id === "request" ? "" : `${tier.label} `;
      return `${label}${compactMoney(tier.price)}/${unit}`;
    })
    .join(" · ");
}

/** Applies sanitized live price labels without changing callable model IDs. */
export function applyWeAiLivePricing(
  items: readonly ModelDescriptor[],
  pricing: WeAiLiveGroupPricing | undefined,
): ModelDescriptor[] {
  if (!pricing) return [...items];
  return items.map((model) => {
    const live = pricing.models[model.id];
    if (!live) return model;
    const baseName = model.name.replace(/\s*（.*$/u, "");
    const sizeSuffix = /^gpt-image-2(?:-|$)/u.test(model.id)
      ? " · 1K/2K/4K"
      : "";
    const sourceLabel =
      pricing.source === "model-plaza" ? "We-AI 模型广场" : "We-AI 官方文档";
    return {
      ...model,
      pricing: {
        kind: live.kind,
        currency: "USD",
        ...(live.kind === "token"
          ? {
              inputPerMillion: live.input,
              outputPerMillion: live.output,
              imageOutputPerMillion: live.imageOutput,
            }
          : {
              tiers: live.tiers.map((tier) => ({
                ...tier,
                dimension: tier.id === "request" ? "fixed" : "quality",
                value: tier.id,
              })),
            }),
        sourceUrl: pricing.sourceUrl,
        checkedAt: pricing.checkedAt,
        confidence: pricing.source === "model-plaza" ? "exact" : "snapshot",
      },
      name: `${baseName}（${livePricingLabel(live)}${sizeSuffix}）`,
      description: `${model.description ?? ""} 价格来自${sourceLabel}，更新于 ${pricing.checkedAt}。`.trim(),
      metadata: {
        ...model.metadata,
        pricingSource: pricing.source,
        pricingSourceUrl: pricing.sourceUrl,
        pricingCheckedAt: pricing.checkedAt,
        pricingComplete: pricing.complete,
        priceLabel: livePricingLabel(live),
        pricingLabel: livePricingLabel(live),
      },
    };
  });
}

export interface WeAiSavedModelScan {
  readonly status: "live" | "empty";
  readonly checkedAt?: string;
  readonly modelIds: readonly string[];
}

/**
 * Reads the last successful keyed model scan stored on a We-AI connection.
 * An explicit empty scan is authoritative; a missing/failed scan returns null
 * so the caller can perform the one required live refresh.
 */
export function readWeAiSavedModelScan(
  config: Readonly<Record<string, unknown>>,
): WeAiSavedModelScan | null {
  const status = config.modelScanStatus;
  if (status !== "live" && status !== "empty") return null;
  if (!Array.isArray(config.scannedModelIds)) return null;
  const modelIds = [
    ...new Set(
      config.scannedModelIds.flatMap((value) =>
        typeof value === "string" && value.trim() ? [value.trim()] : [],
      ),
    ),
  ];
  return {
    status,
    modelIds,
    ...(typeof config.modelScanCheckedAt === "string" &&
    config.modelScanCheckedAt.trim()
      ? { checkedAt: config.modelScanCheckedAt }
      : {}),
  };
}

function unavailableModelIds(
  config: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  if (!Array.isArray(config.unavailableModels)) return new Set();
  return new Set(
    config.unavailableModels.flatMap((value) => {
      if (typeof value === "string" && value.trim()) return [value.trim()];
      if (!value || typeof value !== "object" || Array.isArray(value))
        return [];
      const id = (value as Record<string, unknown>).id;
      return typeof id === "string" && id.trim() ? [id.trim()] : [];
    }),
  );
}

/** Builds the immediately usable canvas list from the saved keyed scan. */
export function weAiCanvasModelDescriptorsFromSavedScan(
  config: Readonly<Record<string, unknown>>,
): ModelDescriptor[] | null {
  const scan = readWeAiSavedModelScan(config);
  if (!scan) return null;
  const group =
    typeof config.modelGroup === "string" ? config.modelGroup.trim() : "";
  const allowed = new Set(scan.modelIds);
  const unavailable = unavailableModelIds(config);
  const items = weAiCanvasModelDescriptors(
    group,
    config.protocol,
    config.defaultModel,
    readWeAiLivePricing(config),
  ).filter((model) => allowed.has(model.id) && !unavailable.has(model.id));
  const effectiveDefault =
    items.find((model) => model.isDefault)?.id ?? items[0]?.id;
  return items.map((model) => ({
    ...model,
    isDefault: model.id === effectiveDefault,
  }));
}

/** Returns a requested model only when the route allows it, otherwise the safe group default. */
export function resolveWeAiDefaultModel(
  group: WeAiCatalogGroup,
  requestedModel?: string | null,
): string {
  const requested = requestedModel?.trim();
  const requestedEntry = requested
    ? group.models.find((model) => model.id === requested)
    : undefined;
  if (requestedEntry?.aliasFor) {
    const canonical = group.models.find(
      (model) => model.id === requestedEntry.aliasFor && model.canvasCallable,
    );
    if (canonical) return canonical.id;
  }
  if (
    requested &&
    group.models.some((model) => model.id === requested && model.canvasCallable)
  ) {
    return requested;
  }
  const configuredDefault = group.models.find(
    (model) => model.id === group.defaultModel && model.canvasCallable,
  );
  return configuredDefault?.id ?? weAiCallableModels(group)[0]?.id ?? "";
}

/** Keeps an existing supported protocol, while new/invalid connections use the group default. */
export function resolveWeAiProtocol(
  group: WeAiCatalogGroup,
  requestedProtocol?: unknown,
): WeAiProtocol {
  return typeof requestedProtocol === "string" &&
    group.protocols.some((protocol) => protocol.id === requestedProtocol)
    ? (requestedProtocol as WeAiProtocol)
    : group.protocol;
}
