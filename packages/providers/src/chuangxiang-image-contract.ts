import type { ModelDescriptor, ProviderOperation } from "./contracts.js";

const DOCS = "https://vapi.chuangxiangai.asia/docs/image";
const GPT_MODEL = /^gpt-image-2(?:\.5-(?:flare|sunburst))?-(1k|2k|4k)$/u;
export const CHUANGXIANG_IMAGE_QUALITIES = ["low", "medium", "high", "xhigh", "max"];
type Connection = { provider: string; config: Readonly<Record<string, unknown>> };

/** Scope the current documented SKU contract to its supplier, group and exact model. */
export function isChuangxiangImageConnection(config: Readonly<Record<string, unknown>> | undefined, model?: string): boolean {
  const selected = model ?? config?.defaultModel;
  if (typeof selected !== "string" || !GPT_MODEL.test(selected) ||
      String(config?.accountKeyGroup ?? config?.modelGroup ?? "") !== "生图" ||
      config?.usage === "agent" || config?.usage === "disabled" || config?.supplierArchived === true) return false;
  try {
    const url = new URL(String(config?.baseUrl ?? ""));
    return url.origin === "https://vapi.chuangxiangai.asia" && !url.username && !url.password &&
      !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

export function chuangxiangRequiresPublicAssets(provider: string, config: Readonly<Record<string, unknown>> | undefined,
  model?: string, operation?: ProviderOperation): boolean {
  return provider === "openai" && operation === "image.edit" && isChuangxiangImageConnection(config, model);
}

export function applyChuangxiangCurrentImageCapabilities(connection: Connection, model: ModelDescriptor): ModelDescriptor {
  if (connection.provider !== "openai" || !isChuangxiangImageConnection(connection.config, model.id) || model.metadata?.canvasRunnable === false) return model;
  const tier = GPT_MODEL.exec(model.id)![1]!.toUpperCase();
  return {
    ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"],
    inputKinds: ["text", "image", "image[]"], outputKinds: ["image"],
    parameters: [
      ...(model.parameters ?? []).filter(parameter => ["size", "aspect_ratio"].includes(parameter.key)),
      { key: "quality", label: "请求质量", control: "select", valueType: "string", default: "max",
        options: [{ value: "auto", label: "自动（省略）" }, ...CHUANGXIANG_IMAGE_QUALITIES.map(value => ({ value, label: value }))],
        description: "创想图片文档声明的质量参数；Image 2.5 的 xhigh/max 使用高质量价，价格以该型号广场为准。" },
      { key: "n", label: "生成张数", control: "number", valueType: "integer", default: 1, min: 1, max: 1 },
    ],
    limits: { ...model.limits, maxInputImages: 9, maxOutputImages: 1 },
    metadata: { ...model.metadata, protocol: "chuangxiang-gpt-images", documentationUrl: DOCS,
      imageSupportedResolutions: [tier], imageUnsupportedResolutions: ["1K", "2K", "4K"].filter(value => value !== tier),
      imageNativeQualityOptions: true, chuangxiangCurrentContractCheckedAt: "2026-10-04" },
  };
}
