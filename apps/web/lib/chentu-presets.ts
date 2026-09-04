/**
 * 辰途 API exposes OpenAI-compatible image endpoints. The marketplace list
 * below is a documentation-backed setup aid only: a saved key is always
 * scanned through /v1/models before the canvas exposes callable models.
 */
export const CHENTU_PRESET_ID = "chentu-openai-images";
export const CHENTU_SUPPLIER_KEY = "chentu";
export const CHENTU_BASE_URL = "https://tu.988236.xyz/v1";
export const CHENTU_DEFAULT_MODEL = "gpt-image-2";
export const CHENTU_MODEL_GROUP = "1k低价生图";
export const CHENTU_WEBSITE_URL = "https://tu.988236.xyz/";
export const CHENTU_DOCS_URL = "https://tu.988236.xyz/docs/";
export const CHENTU_MODEL_STATUS_URL = "https://tu.988236.xyz/model-status/";
export const CHENTU_IMAGE_REQUEST_TIMEOUT_MS = 600_000;

export interface ChentuMarketplaceModel {
  id: string;
  name: string;
  description: string;
  capability: "image";
  priceLabel: string;
  billingLabel: string;
  tags: string[];
  endpointTypes: string[];
  canvasRunnable?: boolean;
  canvasUnavailableReason?: string;
}

export interface ChentuMarketplaceGroup {
  id: string;
  description: string;
  ratio: number;
  canvasSupported: boolean;
  canvasModelCount?: number;
  models: ChentuMarketplaceModel[];
  scanStatus?: "live" | "empty" | "unauthorized" | "unconfigured" | "failed";
  scanCheckedAt?: string;
  scanError?: string;
  scannedModelCount?: number;
}

function imageModel(
  id: string,
  name: string,
  description: string,
  tags: string[],
  priceLabel: string,
): ChentuMarketplaceModel {
  return {
    id,
    name,
    description,
    capability: "image",
    priceLabel,
    billingLabel: "按请求",
    tags,
    endpointTypes: ["OpenAI Images", "异步 Images"],
  };
}

const DOCUMENTED_IMAGE_MODELS = {
  gpt: imageModel(
    "gpt-image-2",
    "GPT Image 2",
    "辰途 GPT Image 2 默认档；支持同步与异步生图、图生图。",
    ["GPT", "图片", "OpenAI Images"],
    "￥ 0.015 / 请求",
  ),
  gpt1k: imageModel(
    "gpt-image-2-1k",
    "GPT Image 2 · 1K",
    "GPT Image 2 的 1K 清晰度档位。",
    ["GPT", "1K", "图片"],
    "￥ 0.022 / 请求",
  ),
  gpt2k: imageModel(
    "gpt-image-2-2k",
    "GPT Image 2 · 2K",
    "GPT Image 2 的 2K 清晰度档位。",
    ["GPT", "2K", "图片"],
    "￥ 0.022 / 请求",
  ),
  gpt4k: imageModel(
    "gpt-image-2-4k",
    "GPT Image 2 · 4K",
    "GPT Image 2 的 4K 清晰度档位；长任务可走异步接口。",
    ["GPT", "4K", "图片"],
    "￥ 0.05 / 请求",
  ),
  gptFree: imageModel(
    "gpt-image-2自由传参",
    "GPT Image 2 · 自由传参",
    "GPT Image 2 自由传参线路；可填写自定义像素尺寸，价格按辰途模型广场为准。",
    ["GPT", "自由传参", "自定义尺寸", "图片"],
    "￥ 0.05 / 请求",
  ),
  flash1k: imageModel(
    "gemini-3.1-flash-image-1k",
    "Gemini 3.1 Flash Image · 1K",
    "Gemini Flash 图片模型的 1K 档位。",
    ["Gemini", "Flash", "1K", "图片"],
    "￥ 0.06 / 请求",
  ),
  flash2k: imageModel(
    "gemini-3.1-flash-image-2k",
    "Gemini 3.1 Flash Image · 2K",
    "Gemini Flash 图片模型的 2K 档位。",
    ["Gemini", "Flash", "2K", "图片"],
    "￥ 0.06 / 请求",
  ),
  flash4k: imageModel(
    "gemini-3.1-flash-image-4k",
    "Gemini 3.1 Flash Image · 4K",
    "Gemini Flash 图片模型的 4K 档位。",
    ["Gemini", "Flash", "4K", "图片"],
    "￥ 0.06 / 请求",
  ),
  pro1k: imageModel(
    "gemini-3-pro-image-1k",
    "Gemini 3 Pro Image · 1K",
    "Gemini Pro 图片模型的 1K 档位。",
    ["Gemini", "Pro", "1K", "图片"],
    "￥ 0.09 / 请求",
  ),
  pro2k: imageModel(
    "gemini-3-pro-image-2k",
    "Gemini 3 Pro Image · 2K",
    "Gemini Pro 图片模型的 2K 档位。",
    ["Gemini", "Pro", "2K", "图片"],
    "￥ 0.09 / 请求",
  ),
  pro4k: imageModel(
    "gemini-3-pro-image-4k",
    "Gemini 3 Pro Image · 4K",
    "Gemini Pro 图片模型的 4K 档位；长任务可走异步接口。",
    ["Gemini", "Pro", "4K", "图片"],
    "￥ 0.09 / 请求",
  ),
};

const CHENTU_IMAGE_GROUP_IDS = new Set([
  "1k低价生图",
  "az兜底渠道1k生图",
  "低价Adobe生图",
  "低价gemni生图",
  "兜底原生生图",
  "image2官key",
  "image2官key生图",
  "测试生图",
]);

function marketplaceGroup(
  id: string,
  ratio: number,
  description: string,
  models: ChentuMarketplaceModel[] = [],
): ChentuMarketplaceGroup {
  return {
    id,
    ratio,
    description,
    canvasSupported: CHENTU_IMAGE_GROUP_IDS.has(id),
    models,
  };
}

/**
 * Captured from 辰途的模型广场分组 on 2026-08-27. Image-model assignments
 * are documentation-backed candidates only; after a Key is saved, /v1/models
 * remains the source of truth for whether an image node may call a model.
 */
export const CHENTU_PLATFORM_GROUPS: readonly ChentuMarketplaceGroup[] = [
  marketplaceGroup("0.04gpt/k12", 0.06, "辰途模型广场分组。"),
  marketplaceGroup("0.08gpt", 0.09, "辰途模型广场分组。"),
  marketplaceGroup("0.13特惠Pro号池", 0.13, "辰途模型广场分组。"),
  marketplaceGroup(
    "1k低价生图",
    0.55,
    "1K 图片分组；连接后实时扫描当前 Key 的图片模型权限。",
    [DOCUMENTED_IMAGE_MODELS.gpt, DOCUMENTED_IMAGE_MODELS.gpt1k],
  ),
  marketplaceGroup("CC-MAX-企业版-CC Test满分", 0.7, "辰途模型广场分组。"),
  marketplaceGroup(
    "az兜底渠道1k生图",
    1.25,
    "Azure 兜底 1K 图片分组；实际可调模型以当前 Key 扫描结果为准。",
    [DOCUMENTED_IMAGE_MODELS.gpt1k],
  ),
  marketplaceGroup("default", 1, "辰途模型广场默认分组。"),
  marketplaceGroup("gemini大语言模型", 0.25, "辰途模型广场分组。"),
  marketplaceGroup("grokheavy号池", 0.13, "辰途模型广场分组。"),
  marketplaceGroup("grok纯享视频", 1, "辰途模型广场分组。"),
  marketplaceGroup(
    "image2官key",
    4.5,
    "GPT Image 2 官方 Key 图片分组；当前广场显示 4K 与自由传参线路，实际权限仍通过 /v1/models 实时扫描。",
    [
      {
        ...DOCUMENTED_IMAGE_MODELS.gpt4k,
        priceLabel: "￥ 0.18 / 请求",
      },
      {
        ...DOCUMENTED_IMAGE_MODELS.gptFree,
        priceLabel: "￥ 0.18 / 请求",
      },
    ],
  ),
  marketplaceGroup(
    "image2官key生图",
    4.5,
    "GPT Image 2 官方 Key 图片分组；当前广场显示 4K 与自由传参线路，实际权限仍通过 /v1/models 实时扫描。",
    [
      {
        ...DOCUMENTED_IMAGE_MODELS.gpt4k,
        priceLabel: "￥ 0.18 / 请求",
      },
      {
        ...DOCUMENTED_IMAGE_MODELS.gptFree,
        priceLabel: "￥ 0.18 / 请求",
      },
    ],
  ),
  marketplaceGroup("klingsd视频", 1, "辰途模型广场分组。"),
  marketplaceGroup("sora，veo，omni视频", 1, "辰途模型广场分组。"),
  marketplaceGroup(
    "低价Adobe生图",
    1.25,
    "Adobe 图片分组；当前 Key 实测可用 1K、2K、4K 与自由传参，最终权限仍通过 /v1/models 实时扫描。",
    [
      DOCUMENTED_IMAGE_MODELS.gpt1k,
      DOCUMENTED_IMAGE_MODELS.gpt2k,
      DOCUMENTED_IMAGE_MODELS.gpt4k,
      DOCUMENTED_IMAGE_MODELS.gptFree,
    ],
  ),
  marketplaceGroup(
    "低价gemni生图",
    1,
    "Gemini 图片分组（名称保持辰途广场原样）；未扫描到的文档模型不会提交。",
    [
      DOCUMENTED_IMAGE_MODELS.flash1k,
      DOCUMENTED_IMAGE_MODELS.flash2k,
      DOCUMENTED_IMAGE_MODELS.flash4k,
      DOCUMENTED_IMAGE_MODELS.pro1k,
      DOCUMENTED_IMAGE_MODELS.pro2k,
    ],
  ),
  marketplaceGroup(
    "兜底原生生图",
    1.75,
    "原生高分图片分组；高分辨率任务可按辰途文档使用异步 Images 接口。",
    [DOCUMENTED_IMAGE_MODELS.gpt4k, DOCUMENTED_IMAGE_MODELS.gptFree],
  ),
  marketplaceGroup("排klingsd视频", 1, "辰途模型广场分组。"),
  marketplaceGroup("无敌稳定Pro", 0.17, "辰途模型广场分组。"),
  marketplaceGroup(
    "测试生图",
    1,
    "辰途模型广场的图片测试分组。",
    [DOCUMENTED_IMAGE_MODELS.pro4k],
  ),
  marketplaceGroup("纯血ccmax", 0.9, "辰途模型广场分组。"),
];

export function chentuMarketplaceGroup(
  id: string,
): ChentuMarketplaceGroup | undefined {
  return CHENTU_PLATFORM_GROUPS.find((group) => group.id === id);
}

export function isChentuImageGroup(
  value: unknown,
): value is string {
  return typeof value === "string" && CHENTU_IMAGE_GROUP_IDS.has(value);
}

/**
 * 辰途模型广场曾使用不带“生图”后缀的旧分组名；两者都走官方 GPT
 * Image 路由和参数约束，保留旧名兼容已保存的连接。
 */
export function isChentuOfficialImageGroup(value: unknown): boolean {
  return value === "image2官key" || value === "image2官key生图";
}

export function chentuDefaultModelForGroup(
  groupId: string,
): string {
  return (
    chentuMarketplaceGroup(groupId)?.models[0]?.id ?? CHENTU_DEFAULT_MODEL
  );
}

export function chentuConnectionConfig(
  modelGroup = CHENTU_MODEL_GROUP,
  defaultModel = chentuDefaultModelForGroup(modelGroup),
) {
  return {
    preset: CHENTU_PRESET_ID,
    supplierKey: CHENTU_SUPPLIER_KEY,
    supplierWebsiteUrl: CHENTU_WEBSITE_URL,
    usage: "canvas",
    modelGroup,
    baseUrl: CHENTU_BASE_URL,
    defaultModel,
    requestTimeoutMs: CHENTU_IMAGE_REQUEST_TIMEOUT_MS,
  };
}

export function isChentuPreset(value: unknown): boolean {
  return value === CHENTU_PRESET_ID;
}
