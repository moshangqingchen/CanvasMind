import type { ModelDescriptor, ModelParameterDescriptor, ValidationIssue } from "./contracts.js";
import { parseSupplierGroupDetails } from "./supplier-group-details.js";

const DOCS = "https://token.secure-skill.com/docs";
const MODELS = new Set(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
export const SECURE_SKILL_IMAGE_PIXELS = [
  ["1:1", "1024x1024", "2048x2048", "2880x2880"],
  ["3:2", "1536x1024", "2048x1360", "3504x2336"],
  ["2:3", "1024x1536", "1360x2048", "2336x3504"],
  ["4:3", "1024x768", "2048x1536", "3264x2448"],
  ["3:4", "768x1024", "1536x2048", "2448x3264"],
  ["5:4", "1280x1024", "2560x2048", "3200x2560"],
  ["4:5", "1024x1280", "2048x2560", "2560x3200"],
  ["16:9", "1536x864", "2048x1152", "3840x2160"],
  ["9:16", "864x1536", "1152x2048", "2160x3840"],
  ["2:1", "2048x1024", "2688x1344", "3840x1920"],
  ["1:2", "1024x2048", "1344x2688", "1920x3840"],
  ["21:9", "2016x864", "2688x1152", "3840x1648"],
  ["9:21", "864x2016", "1152x2688", "1648x3840"],
] as const;
const TIERS = ["1K", "2K", "4K"];
const QUALITY = ["low", "medium", "high", "xhigh", "max"];
/** Current supplier table describes 1K pixels only; 2K/4K are native tiers. */
export const SECURE_SKILL_IMAGE25_PIXELS = [
  ["1:1", "1024x1024"], ["2:1", "1280x640"], ["3:1", "1440x480"], ["16:9", "1280x720"],
  ["3:2", "1536x1024"], ["4:3", "1024x768"], ["5:4", "1040x832"], ["4:5", "832x1040"],
  ["3:4", "768x1024"], ["2:3", "1024x1536"], ["9:16", "720x1280"], ["1:2", "640x1280"],
  ["1:3", "480x1440"], ["21:9", "1344x576"],
] as const;
export function isSecureSkillGptImage(config: Readonly<Record<string, unknown>>, model: string): boolean {
  if (!MODELS.has(model) || config.manualProtocol === true || config.supplierArchived === true || ["agent", "disabled"].includes(String(config.usage))) return false;
  const selected = Array.isArray(config.modelCatalogModels) ? config.modelCatalogModels.find(row => row && typeof row === "object" && row.id === model) : undefined;
  if (selected?.metadata?.source === "manual" || selected?.metadata?.source === "paid-test" || selected?.metadata?.protocolEvidence === "paid-test") return false;
  try { const url = new URL(String(config.baseUrl ?? "")); return url.origin === "https://token.secure-skill.com" &&
    !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname); } catch { return false; }
}
function highOnly25Group(config: Readonly<Record<string, unknown>>): boolean {
  const stableId = config.accountKeyGroupId;
  return stableId !== undefined && stableId !== null && String(stableId) !== ""
    ? String(stableId) === "62" : String(config.accountKeyGroup ?? config.modelGroup ?? "") === "gpt-image-2.5特价";
}
function preference(params: Readonly<Record<string, unknown>>, keys: string[]): unknown {
  return keys.map(key => params[key]).find(value => value !== undefined && value !== "" && value !== "auto");
}
export function secureSkillImageParameters(model: string, parameters: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const result = { ...parameters };
  const tier = preference(parameters, ["image_size", "imageSize", "size_tier", "resolution"]);
  const ratio = preference(parameters, ["aspect_ratio", "aspectRatio", "ratio"]);
  if (tier !== undefined) result[model === "gpt-image-2" ? "image_size" : "resolution"] = tier;
  if (ratio !== undefined) result.aspect_ratio = ratio;
  if (model === "gpt-image-2") {
    delete result.quality;
    if (result.aspect_ratio === "auto") delete result.aspect_ratio;
  } else {
    // Preserve exact old 1K selections through the new native fields. Other
    // saved pixels need an explicit user choice; never infer 2K/4K pixels.
    const oldSize = SECURE_SKILL_IMAGE25_PIXELS.find(row => row[1] === parameters.size);
    if (oldSize) {
      result.resolution ??= "1K";
      result.aspect_ratio ??= oldSize[0];
    }
    delete result.size;
    delete result.image_size;
  }
  return result;
}
export function secureSkillImageParameterIssues(config: Readonly<Record<string, unknown>>, model: string,
  parameters: Readonly<Record<string, unknown>> = {}): ValidationIssue[] {
  if (!isSecureSkillGptImage(config, model)) return [];
  const issues: ValidationIssue[] = [], params = secureSkillImageParameters(model, parameters);
  const fail = (key: string, message: string) => issues.push({ path: `parameters.${key}`, code: "invalid_parameter", message });
  for (const aliases of [["image_size", "imageSize", "size_tier", "resolution"], ["aspect_ratio", "aspectRatio", "ratio"]]) {
    const selected = aliases.map(key => parameters[key]).filter(value => value !== undefined && value !== "" && value !== "auto");
    if (new Set(selected).size > 1) fail(aliases[0]!, "Secure Skill 已保存的参数别名冲突；原值保留，请明确一个值。");
  }
  const image25 = model !== "gpt-image-2", tierKey = image25 ? "resolution" : "image_size";
  if (params[tierKey] !== undefined && params[tierKey] !== "auto" && !TIERS.includes(String(params[tierKey]))) fail(tierKey, `Secure Skill ${tierKey} 为 1K / 2K / 4K。`);
  if (params.aspect_ratio !== undefined && params.aspect_ratio !== "auto" && !(typeof params.aspect_ratio === "string" && /^[1-9]\d*:[1-9]\d*$/u.test(params.aspect_ratio)))
    fail("aspect_ratio", "Secure Skill aspect_ratio 须为正整数 WIDTH:HEIGHT；原值保留，请修改。");
  const size = parameters.size;
  if (size !== undefined && size !== "" && size !== "auto") {
    const parts = typeof size === "string" ? /^([1-9]\d*)x([1-9]\d*)$/u.exec(size) : null;
    if (!parts || !parts.slice(1).every(value => Number.isSafeInteger(Number(value)))) fail("size", "Secure Skill size 须为正整数 WIDTHxHEIGHT。");
    else if (!image25) {
      const width = Number(parts[1]), height = Number(parts[2]);
      if (Math.min(width, height) < 256 || Math.max(width, height) > 3840 || width % 16 || height % 16)
        fail("size", "Secure Skill GPT Image 2 宽高须为 16 的倍数，最短边至少 256、最长边至多 3840；无额外总像素或 3:1 本地限制。");
    } else {
      const preset = SECURE_SKILL_IMAGE25_PIXELS.find(row => row[1] === size);
      if (!preset) fail("size", "Secure Skill GPT Image 2.5 不接受自定义宽高；原尺寸保留，请将 size 设为 auto 并选择 resolution 与 aspect_ratio。");
      else if (params.resolution !== "1K" || params.aspect_ratio !== preset[0])
        fail("size", "已保存的明确像素与 resolution / aspect_ratio 冲突；原值保留，请明确一个尺寸选择。");
    }
  }
  if (image25 && params.aspect_ratio !== undefined && params.aspect_ratio !== "auto" &&
      !SECURE_SKILL_IMAGE25_PIXELS.some(row => row[0] === params.aspect_ratio))
    fail("aspect_ratio", "请选择当前 Secure Skill GPT Image 2.5 公布的比例，或 auto。");
  if (image25 && params.quality !== undefined && params.quality !== "auto" && !QUALITY.includes(String(params.quality)))
    fail("quality", "Secure Skill GPT Image 2.5 quality 为 low / medium / high / xhigh / max。");
  if (image25 && highOnly25Group(config) && ["xhigh", "max"].includes(String(params.quality)))
    fail("quality", "Secure Skill 分组 62 gpt-image-2.5特价明确最高 high；原质量值保留，请修改。");
  if (params.background !== undefined && !["", "auto", "opaque", "transparent"].includes(String(params.background))) fail("background", "Secure Skill background 为 opaque / transparent 或 auto。");
  if (image25 && params.background === "transparent") fail("background", "Secure Skill GPT Image 2.5 文档明确忽略 background，不提供透明底；当前生成尚未提交。");
  return issues;
}
export function applySecureSkillImageCapabilities(connection: { provider: string; config: Readonly<Record<string, unknown>> }, model: ModelDescriptor): ModelDescriptor {
  if (!["openai", "rest"].includes(connection.provider) || !isSecureSkillGptImage(connection.config, model.id) ||
    !model.operations.includes("image.generate") || model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test") return model;
  const image25 = model.id !== "gpt-image-2", highOnly = image25 && highOnly25Group(connection.config);
  const detailText = [model.metadata?.supplierGroupDescription, model.metadata?.supplierChannelDescription, model.metadata?.supplierGroupResolutionLabel].filter(value => typeof value === "string").join("\n");
  const detail = parseSupplierGroupDetails({ description: detailText }, "key-groups");
  const tiers = image25 ? TIERS : detail?.supportedResolutions?.length ? detail.supportedResolutions : TIERS;
  const options = image25 ? SECURE_SKILL_IMAGE25_PIXELS.map(row => ({ value: row[1], label: `1K · ${row[0]} · ${row[1].replace("x", " × ")}` })) :
    SECURE_SKILL_IMAGE_PIXELS.flatMap(row => TIERS.flatMap((tier, index) => !tiers.includes(tier) ? [] : [{ value: row[index + 1]!, label: `${tier} · ${row[0]} · ${row[index + 1]!.replace("x", " × ")}` }]));
  const parameters: ModelParameterDescriptor[] = [
    ...(!image25 ? [{ key: "size", label: "输出尺寸（size）", control: "dimensions" as const, valueType: "string" as const, default: "auto",
      options: [{ value: "auto", label: "按独立档位与比例（未指定时供应商默认）" }, ...options], allowCustomValue: true, min: 256, max: 3840, step: 16,
      description: "明确 size 按原值发送；auto 省略 size，使用独立 image_size 与 aspect_ratio。两字段均未指定时供应商默认 2K·1:1（2048×2048）。官方十三比例×三档像素表；表外自定义宽高按原值发送。最短256、最长3840、16倍数，无额外总像素/3:1限制。" }] : []),
    ...(image25 ? [{ key: "size", label: "旧尺寸兼容选择", control: "select" as const, valueType: "string" as const, default: "auto", allowCustomValue: false,
      options: [{ value: "auto", label: "使用独立 resolution 与 aspect_ratio" }, ...options],
      description: "当前2.5使用resolution与aspect_ratio，不接受自定义宽高。此控件保留旧尺寸并允许清除；auto使用独立档位与比例，公布的1K像素快捷项映射为对应原生参数，不推算2K/4K像素。" }] : []),
    { key: image25 ? "resolution" : "image_size", label: `分辨率档位（${image25 ? "resolution" : "image_size"}）`, control: "select", valueType: "string", default: tiers.at(-1) ?? "auto", options: [{ value: "auto", label: "供应商默认" }, ...tiers.map(value => ({ value, label: value }))] },
    { key: "aspect_ratio", label: "画面比例（aspect_ratio）", control: "select", valueType: "string", default: "auto", allowCustomValue: !image25,
      options: [{ value: "auto", label: "自动" }, ...(image25 ? SECURE_SKILL_IMAGE25_PIXELS : SECURE_SKILL_IMAGE_PIXELS).map(row => ({ value: row[0], label: row[0] }))] },
    ...(image25 ? [{ key: "quality", label: "质量（quality）", control: "select" as const, valueType: "string" as const, default: highOnly ? "high" : "max", options: (highOnly ? QUALITY.slice(0, 3) : QUALITY).map(value => ({ value, label: value })), description: highOnly ? "当前稳定分组62公告明确最高high；1K/2K/4K同价。" : "官方五档质量；max 是用户最高质量偏好的初选，供应商缺省 high。" }] : []),
    ...(model.parameters ?? []).filter(parameter => !["size", "size_tier", "resolution", "image_size", "aspect_ratio", "quality", ...(image25 ? ["background"] : [])].includes(parameter.key)),
  ];
  const metadata = { ...model.metadata };
  for (const key of ["imageOutputDimensions", "imageCustomDimensionRules", "imageResolutionProfiles", "imageSupportedSizes", "imageFixedResolution", "imageSizeContract", "imageSizeCompleteEnumSource"]) delete metadata[key];
  return { ...model, parameters, limits: { ...model.limits, maxInputImages: 16 }, metadata: { ...metadata, secureSkillImageProtocol: 2, imageNativeParameterContract: true, imageNativeResolutionParameter: image25 ? "resolution" : "image_size",
    imageSupportedResolutions: tiers, imageResolutionTierParameter: image25 ? "resolution" : "image_size", imageNativeQualityOptions: true, documentationUrl: DOCS, imageOutputReferenceDimensions: options,
    imageSizeOptionsCompleteEnum: image25,
    ...(image25 ? { imageSizeCompleteEnumSource: "application-legacy-1K-shortcuts-to-current-supplier-native-fields" } : {}),
    ...(image25 ? { imageQualityOptionsCompleteEnum: true, imageQualityCompleteEnumSource: highOnly ? `${DOCS}#announcement-68-group-62` : `${DOCS}#gpt-image`, imageTransparentBackground: false } : {}),
  } };
}
