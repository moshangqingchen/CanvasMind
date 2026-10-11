import type { ModelDescriptor, ModelParameterDescriptor } from "./contracts.js";
import { imageSizePresetMatchesRatio } from "./image-size-presets.js";

const models = new Set(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
const groups = new Set(["default", "gptResponseBase64", "geminiResponseUrl"]);

/** The website's OpenAI tag is generic; these GPT models use Images, not Chat. */
export function isGenimageImageConnection(config: Readonly<Record<string, unknown>>, model: string): boolean {
  if (!models.has(model) || config.manualProtocol === true || config.usage === "agent" || config.usage === "disabled" || config.supplierArchived === true) return false;
  const group = String(config.modelGroup ?? "");
  if (!groups.has(group) || (config.accountKeyGroup !== undefined && config.accountKeyGroup !== group)) return false;
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    return url.origin === "https://genimage.pro" && /^(?:\/v1)?\/?$/u.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

/** Exact Genimage Images fields: native strings never become guessed pixels. */
export function genimageImageParameters(parameters: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const keys = ["background", "moderation", "n", "output_compression", "output_format", "quality", "size", "user", "response_format"];
  return Object.fromEntries(keys.flatMap(key => {
    const value = parameters[key];
    if (value === undefined || (["size", "quality", "response_format"].includes(key) && value === "auto")) return [];
    return [[key, value]];
  }));
}

/** Compare an application ratio preference with explicit size; no pixel table is inferred. */
export function genimageImageRatioIssues(parameters: Readonly<Record<string, unknown>> = {}): Array<{ path: string; code: string; message: string }> {
  const values = ["aspect_ratio", "aspectRatio", "ratio"].flatMap(key => {
    const value = parameters[key];
    return value === undefined || value === null || value === "" || value === "auto" ? [] : [{ key, value }];
  });
  if (!values.length) return [];
  const parsed = values.map(({ key, value }) => {
    const parts = typeof value === "string" ? /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/u.exec(value) : null;
    const ratio = parts ? Number(parts[1]) / Number(parts[2]) : Number.NaN;
    return { key, value, ratio };
  });
  const invalid = parsed.find(p => !Number.isFinite(p.ratio) || p.ratio <= 0);
  if (invalid) return [{ path: `parameters.${invalid.key}`, code: "invalid_aspect_ratio", message: "基因形象画面比例偏好须为正数 WIDTH:HEIGHT 或 auto；保留原值，请修改比例或输入 W/H。" }];
  if (parsed.some(p => Math.abs(p.ratio / parsed[0]!.ratio - 1) > 1e-10)) return [{ path: "parameters.aspect_ratio", code: "parameter_alias_conflict", message: "基因形象已保存的 aspect_ratio / aspectRatio / ratio 比例值互相冲突；原值已保留，请明确一个比例。" }];
  const dimensions = typeof parameters.size === "string" ? /^(\d+)x(\d+)$/iu.exec(parameters.size.trim()) : null;
  if (!dimensions || ![dimensions[1], dimensions[2]].every(v => Number.isSafeInteger(Number(v)) && Number(v) > 0)) return [{ path: "parameters.size", code: "aspect_ratio_requires_explicit_size", message: `基因形象比例偏好 ${String(parsed[0]!.value)} 需通过明确 W/H 写入 size；当前 ${String(parameters.size ?? "auto")} 未公布对应比例像素。请输入对应 W/H，原档位和比例已保留。` }];
  const actualRatio = Number(dimensions[1]) / Number(dimensions[2]);
  // A 0.5% display-preference comparison tolerance accepts small rounded/reference
  // pixel differences. This is application mapping, never a supplier size limit.
  if (!imageSizePresetMatchesRatio(parameters.size, parsed[0]!.value) && Math.abs(actualRatio / parsed[0]!.ratio - 1) > 0.005) return [{ path: "parameters.aspect_ratio", code: "aspect_ratio_size_conflict", message: `基因形象 size=${String(parameters.size)} 与比例偏好 ${String(parsed[0]!.value)} 不一致；原值已保留，请修改 W/H 或将比例设为 auto。请求不会猜测或改写像素。` }];
  return [];
}

export function applyGenimageImageCapabilities(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  model: ModelDescriptor,
): ModelDescriptor {
  if (connection.provider !== "openai" || model.metadata?.canvasRunnable === false ||
    model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test" ||
    !model.operations.includes("image.generate") || !isGenimageImageConnection(connection.config, model.id)) return model;
  const image25 = model.id !== "gpt-image-2";
  const metadata = { ...model.metadata };
  // Older snapshots inherited generic presets. They are not current supplier
  // pixel tables. Keep historical request/output evidence separately below.
  for (const key of ["imageOutputDimensions", "imageOutputReferenceDimensions", "imageResolutionProfiles", "imageCustomDimensionRules", "imageFixedResolution", "imageNativeQualityParameter", "imageSupportedSizes"])
    delete metadata[key];
  // These are application/user preferences; the current card supplies no
  // quality enum or default. Keep the wire string open rather than inventing one.
  const quality = image25 ? "max" : "high";
  const parameters: ModelParameterDescriptor[] = [
    { key: "size", label: "输出分辨率", control: "select", valueType: "string", default: "auto", allowCustomValue: true,
      options: [{ value: "auto", label: "自动" }, ...["1K", "2K", "4K"].map(value => ({ value, label: value }))],
      description: "官网完整型号声明 1K、2K、4K；size 按档位或用户输入字符串发送。逐比例像素、自定义范围与步长未公布，W/H 不作跨渠道换算，实际像素以原图为准。" },
    { key: "aspect_ratio", label: "画面比例偏好", control: "select", valueType: "string", default: "auto", allowCustomValue: true,
      options: [{ value: "auto", label: "自动" }],
      description: "应用比例偏好，通过用户明确 W/H 的 size 表达；供应商没有声明独立比例字段或档位比例像素表。已保存值保留，档位与非自动比例同时选择时请输入对应 W/H。" },
    { key: "quality", label: "质量", control: "text", valueType: "string", default: quality, allowCustomValue: true,
      options: [{ value: "auto", label: "自动" }, { value: quality, label: image25 ? "最高（max）" : "高（high）" }],
      description: "max / high 是应用初选及用户偏好；当前官网未公布此完整型号的完整质量枚举或默认值。按输入发送，auto 省略。" },
    { key: "background", label: "背景", control: "select", valueType: "string", default: "auto",
      options: [{ value: "auto", label: "自动" }, { value: "opaque", label: "不透明" },
        ...(image25 ? [{ value: "transparent", label: "透明（供应商声明）" }] : [])],
      description: image25 ? "供应商声明支持透明背景；透明输出请选择 PNG 或 WebP。" : "供应商明确说明此型号不支持透明背景。" },
    { key: "n", label: "数量", control: "number", valueType: "integer", default: 1, min: 1, step: 1,
      description: "应用初选 1。此完整型号的数量上限与多张计价条件未公布；通用适配器数量校验不当作供应商声明。" },
    { key: "response_format", label: "返回方式", control: "select", valueType: "string", default: "b64_json",
      options: [{ value: "b64_json", label: "图片数据（Base64）" }, { value: "url", label: "图片链接（URL）" }],
      description: "接口声明的返回格式；分组可能固定返回方式，以实际响应为准。" },
  ];
  return { ...model, description: model.description?.includes("供应商说明支持 1K 2K 4K。") ? model.description : `${model.description ?? ""} 供应商说明支持 1K 2K 4K。`.trim(),
    parameters: [...parameters, ...(model.parameters ?? []).filter(p => !parameters.some(next => next.key === p.key))],
    metadata: { ...metadata, protocol: "openai-images", documentationUrl: "https://genimage.pro/pricing",
      genimageDocumentationCheckedAt: "2026-10-10", imageSupportedResolutions: ["1K", "2K", "4K"],
      imageRequestResolutions: ["1K", "2K", "4K"],
      imageCapabilityNote: "官网完整型号声明 1K/2K/4K；未公布逐比例像素或自定义宽高限制。",
      imageNativeParameterContract: true, imageNativeResolutionOptions: true, imageNativeResolutionParameter: "size",
      imageNativeQualityOptions: true, imagePixelBudgetPublished: false, imageResolutionMode: "native-variable-pixels",
      genimageNativeSizeOpen: true, imageSizeFieldSource: "openai-images-protocol-and-supplier-model-card",
      imageAspectRatioSource: "application-preference-mapped-to-explicit-size", imageAspectRatioComparisonTolerance: 0.005,
      imageTierSource: "supplier-model-card", imageTierRequestSource: "user-requested-native-size",
      imageApplicationQualityDefault: quality, imageQualitySource: "application-user-preference", imageSupplierQualityDefault: null,
      imageCountConstraintSource: "generic-adapter-not-exact-model-declaration", imageAllTierRequestsVerified: false,
      ...(model.id === "gpt-image-2.5-sunburst" && String(connection.config.modelGroup) === "geminiResponseUrl" ? {
        imageHistoricalRequestSamples: [{ group: "geminiResponseUrl", model: "gpt-image-2.5-sunburst", operation: "image.generate",
          parameters: { quality: "max", size: "2496x3312", n: 1, response_format: "b64_json" },
          checkedAt: "2026-09-22", localRunId: "793adae3-ce7d-4022-8b2c-3b1dfa53c38d", status: "cancelled-with-late-success-response",
          output: { width: 2496, height: 3312, format: "png", bytes: 8889132,
            sha256: "05aabb3fcbe4cb87273a2e1d6088866faaeb369e02d3ebf3b39815de67acaf8b" },
          source: "docs/genimage-verification-2026-09-22.md", currentKeyEntitlement: false }],
      } : {}),
      imageBackgroundSupport: image25 ? "declared-transparent" : "opaque-only" },
  };
}
