import type { ModelDescriptor, ModelParameterDescriptor } from "@super-canvas/providers";

/**
 * FriModel is a New API deployment that exposes image generation through the
 * OpenAI-compatible Images API endpoint. The canvas deliberately asks
 * the gateway for /v1/models with
 * the saved key, instead of carrying a static copy of the model plaza: the
 * key's group is the source of truth for what can actually be called.
 */
export const FRIMODEL_PRESET_ID = "frimodel-openai-images";
export const FRIMODEL_SUPPLIER_KEY = "frimodel";
export const FRIMODEL_BASE_URL = "https://api.frimodel.com/v1";
export const FRIMODEL_DEFAULT_MODEL = "gpt-image-2";
export const FRIMODEL_MODEL_GROUP = "自定义图片模型";
export const FRIMODEL_WEBSITE_URL = "https://platform.frimodel.com/";
export const FRIMODEL_DOCS_URL = "https://ai-doc.apifox.cn";

/**
 * FriModel's documented OpenAI Images edit page applies to GPT Image 2
 * models. Keep this predicate deliberately narrow for UI fallbacks: models
 * outside this family must be confirmed by a separate protocol descriptor
 * before the canvas offers a reference-image edit input.
 */
export function friModelSupportsImageEdit(modelId: string): boolean {
  return /^gpt-image-2(?:-|$)/iu.test(modelId.trim());
}

const FRIMODEL_EDIT_SIZE_OPTIONS = [
  { label: "自动（提示词优先，其次参考图）", value: "auto" },
  { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
  { label: "1K · 2:3 · 1024 × 1536", value: "1024x1536" },
  { label: "1K · 3:2 · 1536 × 1024", value: "1536x1024" },
  { label: "1K · 9:16 · 1088 × 1920", value: "1088x1920" },
  { label: "1K · 16:9 · 1920 × 1088", value: "1920x1088" },
  { label: "2K · 1:1 · 2048 × 2048", value: "2048x2048" },
  { label: "2K · 2:3 · 2048 × 3072", value: "2048x3072" },
  { label: "2K · 3:2 · 3072 × 2048", value: "3072x2048" },
  { label: "2K · 9:16 · 1440 × 2560", value: "1440x2560" },
  { label: "2K · 16:9 · 2560 × 1440", value: "2560x1440" },
  { label: "4K · 1:1 · 2880 × 2880", value: "2880x2880" },
  { label: "4K · 2:3 · 2352 × 3520", value: "2352x3520" },
  { label: "4K · 3:2 · 3520 × 2352", value: "3520x2352" },
  { label: "4K · 9:16 · 2160 × 3840", value: "2160x3840" },
  { label: "4K · 16:9 · 3840 × 2160", value: "3840x2160" },
] as const;

const FRIMODEL_EDIT_PARAMETERS: readonly ModelParameterDescriptor[] = [
  {
    key: "size",
    label: "输出分辨率（size）",
    control: "dimensions",
    valueType: "string",
    default: "auto",
    min: 16,
    max: 3840,
    step: 16,
    options: FRIMODEL_EDIT_SIZE_OPTIONS,
    description:
      "FriModel 图片编辑支持 1K、2K、4K 常用尺寸；自动模式优先提示词比例，其次参考图。",
    operations: ["image.generate", "image.edit"],
  },
  {
    key: "quality",
    label: "质量（quality）",
    control: "select",
    valueType: "string",
    default: "high",
    options: [
      { label: "自动（auto）", value: "auto" },
      { label: "低（low）", value: "low" },
      { label: "中（medium）", value: "medium" },
      { label: "高（high）", value: "high" },
    ],
    description: "FriModel 图片编辑接口支持 auto、low、medium、high。",
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
    description: "FriModel 图片编辑支持 png、jpeg、webp。",
    operations: ["image.generate", "image.edit"],
  },
];

/**
 * A client-safe descriptor used only while a saved FriModel key is being
 * scanned, or when the last scan failed. The authoritative live response
 * replaces it as soon as the key's model list is available.
 */
export function friModelFallbackImageDescriptor(
  modelId: string,
  group?: string,
): ModelDescriptor | undefined {
  const id = modelId.trim();
  if (!id || !friModelSupportsImageEdit(id)) return undefined;
  const fixedQuality = /^gpt-image-2-(low|medium|high)$/iu.exec(id)?.[1]?.toLowerCase();
  return {
    id,
    name: `${id}（FriModel）`,
    description:
      "FriModel OpenAI Images 图片模型；支持 /v1/images/generations 与 /v1/images/edits。",
    operations: ["image.generate", "image.edit"],
    inputKinds: ["text", "image"],
    outputKinds: ["image"],
    parameters: FRIMODEL_EDIT_PARAMETERS.map((parameter) =>
      parameter.key === "quality" && fixedQuality
        ? {
            ...parameter,
            default: fixedQuality,
            options: [
              {
                label: `${fixedQuality === "low" ? "低" : fixedQuality === "medium" ? "中" : "高"}（${fixedQuality}，模型固定）`,
                value: fixedQuality,
              },
            ],
          }
        : parameter,
    ),
    limits: {
      maxInputImages: 10,
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
    metadata: {
      protocol: "frimodel-images",
      liveInventory: true,
      pendingLiveScan: true,
      supportsImageEdit: true,
      referenceEditEndpoint: "/v1/images/edits",
      fixedOutputCount: 1,
      ...(group ? { modelGroup: group } : {}),
    },
  };
}

export interface FriModelMarketplaceModel {
  id: string;
  name: string;
  description?: string;
  capability: "chat" | "image" | "video" | "other";
  priceLabel: string;
  billingLabel: string;
  tags: string[];
  endpointTypes: string[];
  canvasRunnable?: boolean;
  canvasUnavailableReason?: string;
}

export interface FriModelMarketplaceGroup {
  id: string;
  description: string;
  ratio: number;
  canvasSupported: boolean;
  canvasModelCount?: number;
  models: FriModelMarketplaceModel[];
}

function imageModel(
  id: string,
  name: string,
  description: string,
  priceLabel: string,
): FriModelMarketplaceModel {
  return {
    id,
    name,
    description,
    capability: "image",
    priceLabel,
    billingLabel: "按次计费",
    tags: ["图片", "OpenAI Images API"],
    endpointTypes: ["OpenAI Images API（生图）"],
  };
}

/**
 * Captured from the authenticated FriModel token-group selector and model
 * plaza on 2026-08-27. Models are still live-scanned with the group key
 * before the canvas can call them; this list only provides the same grouped
 * setup surface as Cangyuan.
 */
export const FRIMODEL_PLATFORM_GROUPS: readonly FriModelMarketplaceGroup[] = [
  {
    id: "Kling",
    description: "Kling 视频生成分组；当前模型广场未公开可验证的视频请求参数。",
    ratio: 1,
    canvasSupported: false,
    models: [],
  },
  {
    id: "Seedance2.0",
    description:
      "Seedance 2.0（4/9 图、3 视频、3 音频）。当前广场仅公布 Chat 兼容示例，画布暂不自动提交。",
    ratio: 1,
    canvasSupported: false,
    models: [
      {
        id: "Doubao-Seedance-2.0",
        name: "Doubao-Seedance-2.0",
        description: "模型广场标注为视频模型，采用任务 Token 动态计费。",
        capability: "video",
        priceLabel: "任务 Token 动态计费",
        billingLabel: "动态计费",
        tags: ["Seedance2.0", "视频"],
        endpointTypes: ["OpenAI Chat", "视频（待协议验证）"],
      },
    ],
  },
  {
    id: "claude_max",
    description: "Claude Max（仅支持 CLI、Desktop 使用）。",
    ratio: 1.4,
    canvasSupported: false,
    models: [],
  },
  {
    id: "claude_max_外接",
    description: "Claude Max（可 API 使用，平台提示存在提示词注入风险）。",
    ratio: 1.4,
    canvasSupported: false,
    models: [],
  },
  {
    id: "codex_image",
    description: "Codex 图片（仅支持 1K，目前平台标注为 Web 渠道）。",
    ratio: 0.025,
    canvasSupported: true,
    models: [
      imageModel(
        "gpt-image-2",
        "GPT Image 2",
        "Codex 图片分组的 1K 图片生成线路。",
        "$0.025/次",
      ),
    ],
  },
  {
    id: "default",
    description: "Codex 逆向分组。",
    ratio: 0.25,
    canvasSupported: false,
    models: [],
  },
  {
    id: "gemini_image",
    description: "Gemini Adobe 图片（支持 1K、2K、4K、PNG；提示词风控严格）。",
    ratio: 1,
    canvasSupported: true,
    models: [
      imageModel(
        "gemini-3.1-flash-image-preview",
        "Gemini 3.1 Flash Image Preview",
        "Gemini Adobe 图片分组；模型广场标价 $0.1/请求。",
        "$0.1/次",
      ),
    ],
  },
  {
    id: "gemini_pro",
    description: "Gemini Pro 图片（支持 1K、2K、4K；仅 JPG；提示词风控宽松）。",
    ratio: 1,
    canvasSupported: true,
    models: [
      imageModel(
        "gemini-3-pro-image-preview",
        "Gemini 3 Pro Image Preview",
        "Gemini Pro 图片分组；模型广场标价 $0.1/请求。",
        "$0.1/次",
      ),
    ],
  },
  {
    id: "gpt_image_adobe",
    description: "Adobe 图片（支持 1K、2K、4K）。",
    ratio: 1,
    canvasSupported: true,
    models: [
      imageModel(
        "gpt-image-2-adobe",
        "GPT Image 2 Adobe",
        "Adobe 图片线路，模型广场标价 $0.05/图片。",
        "$0.05/张",
      ),
      imageModel(
        "gpt-image-2-high",
        "GPT Image 2 High",
        "Adobe 图片高质量线路，模型广场标价 $0.09/请求。",
        "$0.09/次",
      ),
    ],
  },
  {
    id: "gpt_image_wc",
    description: "Web 图片（超分）。",
    ratio: 0.025,
    canvasSupported: true,
    models: [
      imageModel(
        "gpt-image-2-wc",
        "GPT Image 2 Web 超分",
        "Web 图片超分线路。",
        "$0.025/次",
      ),
      imageModel(
        "gpt-image-2",
        "GPT Image 2",
        "同时在 Codex、Web、Web 超分分组开放的图片模型。",
        "$0.025/次",
      ),
    ],
  },
  {
    id: "gpt_image_web",
    description: "Web 图片（仅支持 1K）。",
    ratio: 0.025,
    canvasSupported: true,
    models: [
      imageModel(
        "gpt-image-2-w",
        "GPT Image 2 Web",
        "Web 图片 1K 线路。",
        "$0.025/次",
      ),
      imageModel(
        "gpt-image-2",
        "GPT Image 2",
        "同时在 Codex、Web、Web 超分分组开放的图片模型。",
        "$0.025/次",
      ),
    ],
  },
  {
    id: "grok",
    description: "Grok 分组；当前模型广场未公开图片或视频的可验证请求参数。",
    ratio: 1,
    canvasSupported: false,
    models: [],
  },
  {
    id: "gpt_image_super",
    description: "组合分组：codex_web 生图组合（1K 生图超级稳定）。",
    ratio: 1,
    canvasSupported: true,
    models: [
      imageModel(
        "gpt-image-2",
        "GPT Image 2",
        "组合分组指定的 1K 稳定生图模型。",
        "$0.025/次",
      ),
    ],
  },
];

export function friModelMarketplaceGroup(
  id: string,
): FriModelMarketplaceGroup | undefined {
  return FRIMODEL_PLATFORM_GROUPS.find((group) => group.id === id);
}

export function isFriModelImageGroup(value: unknown): boolean {
  return (
    typeof value === "string" &&
    friModelMarketplaceGroup(value)?.canvasSupported === true
  );
}

export function friModelDefaultModelForGroup(groupId: string): string {
  return (
    friModelMarketplaceGroup(groupId)?.models[0]?.id ?? FRIMODEL_DEFAULT_MODEL
  );
}

export function friModelConnectionConfig(
  modelGroup = FRIMODEL_MODEL_GROUP,
  defaultModel = friModelDefaultModelForGroup(modelGroup),
) {
  return {
    preset: FRIMODEL_PRESET_ID,
    supplierKey: FRIMODEL_SUPPLIER_KEY,
    supplierWebsiteUrl: FRIMODEL_WEBSITE_URL,
    usage: "canvas",
    modelGroup,
    baseUrl: FRIMODEL_BASE_URL,
    defaultModel,
    // FriModel 4K high-quality edits can legitimately take more than two
    // minutes, especially with several large PNG reference images.
    requestTimeoutMs: 300_000,
  };
}

export function isFriModelPreset(value: unknown): boolean {
  return value === FRIMODEL_PRESET_ID;
}
