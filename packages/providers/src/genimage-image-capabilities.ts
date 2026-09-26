import type { ModelDescriptor, ModelParameterDescriptor } from "./contracts.js";
import { imageSizeOptions } from "./image-size-presets.js";

const models = new Set(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
const groups = new Set(["default", "gptResponseBase64", "geminiResponseUrl"]);

/** The website's OpenAI tag is generic; these GPT models use Images, not Chat. */
export function isGenimageImageConnection(config: Readonly<Record<string, unknown>>, model: string): boolean {
  if (!models.has(model) || config.usage === "agent" || config.usage === "disabled" || config.supplierArchived === true) return false;
  const group = String(config.modelGroup ?? "");
  if (!groups.has(group) || (config.accountKeyGroup !== undefined && config.accountKeyGroup !== group)) return false;
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    return url.origin === "https://genimage.pro" && /^(?:\/v1)?\/?$/u.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function applyGenimageImageCapabilities(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  model: ModelDescriptor,
): ModelDescriptor {
  if (connection.provider !== "openai" || model.metadata?.canvasRunnable === false ||
    !model.operations.includes("image.generate") || !isGenimageImageConnection(connection.config, model.id)) return model;
  const image25 = model.id !== "gpt-image-2";
  // A max probe is an offered request, not proof that the upstream accepts it.
  // supplier-capabilities expands the other qualities only after a successful probe.
  const quality = image25 ? "max" : "high";
  const parameters: ModelParameterDescriptor[] = [
    { key: "size", label: "输出分辨率", control: "dimensions", valueType: "string", default: "auto",
      min: 16, max: 3840, step: 16, options: imageSizeOptions(["1K", "2K", "4K"]),
      description: "供应商模型广场声明支持 1K、2K、4K；比例为请求预设，未逐项实测。实际像素以返回原图为准。" },
    { key: "quality", label: "质量", control: "select", valueType: "string", default: quality,
      options: [{ value: quality, label: image25 ? "最高（max，待核验）" : "高（high）" }],
      description: "按最高档核验；最高档成功后开放同型号其他质量选项，未实测选项不标记为已验证。" },
    { key: "background", label: "背景", control: "select", valueType: "string", default: "auto",
      options: [{ value: "auto", label: "自动" }, { value: "opaque", label: "不透明" },
        ...(image25 ? [{ value: "transparent", label: "透明（供应商声明）" }] : [])],
      description: image25 ? "供应商声明支持透明背景，尚未实测；透明输出请选择 PNG 或 WebP。" : "供应商明确说明此型号不支持透明背景。" },
    { key: "n", label: "数量", control: "number", valueType: "integer", default: 1, min: 1, max: 10, step: 1,
      description: "接口页面声明范围 1–10；本轮仅请求 1 张，多图数量及计费未验证。" },
    { key: "response_format", label: "返回方式", control: "select", valueType: "string", default: "b64_json",
      options: [{ value: "b64_json", label: "图片数据（Base64）" }, { value: "url", label: "图片链接（URL）" }],
      description: "接口声明的返回格式；分组可能固定返回方式，以实际响应为准。" },
  ];
  return { ...model, description: `${model.description ?? ""} 供应商说明支持 1K 2K 4K。`.trim(),
    parameters: [...parameters, ...(model.parameters ?? []).filter(p => !parameters.some(next => next.key === p.key))],
    metadata: { ...model.metadata, protocol: "openai-images", documentationUrl: "https://genimage.pro/pricing",
      genimageDocumentationCheckedAt: "2026-09-22", imageSupportedResolutions: ["1K", "2K", "4K"],
      imageRequestResolutions: ["1K", "2K", "4K"],
      imageCapabilityNote: "供应商声明 1K/2K/4K；实际尺寸与最高质量尚需以当前分组的核验结果为准。",
      imageBackgroundSupport: image25 ? "declared-transparent" : "opaque-only" },
  };
}
