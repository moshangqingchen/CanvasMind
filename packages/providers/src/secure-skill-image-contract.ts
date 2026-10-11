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
export function isSecureSkillGptImage(config: Readonly<Record<string, unknown>>, model: string): boolean {
  if (!MODELS.has(model) || config.manualProtocol === true || config.supplierArchived === true || ["agent", "disabled"].includes(String(config.usage))) return false;
  const selected = Array.isArray(config.modelCatalogModels) ? config.modelCatalogModels.find(row => row && typeof row === "object" && row.id === model) : undefined;
  if (selected?.metadata?.source === "manual" || selected?.metadata?.source === "paid-test" || selected?.metadata?.protocolEvidence === "paid-test") return false;
  try { const url = new URL(String(config.baseUrl ?? "")); return url.origin === "https://token.secure-skill.com" &&
    !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname); } catch { return false; }
}
function alternate25TierGroup(config: Readonly<Record<string, unknown>>): boolean {
  const stableId = config.accountKeyGroupId;
  return stableId !== undefined && stableId !== null && String(stableId) !== ""
    ? String(stableId) === "49" : String(config.accountKeyGroup ?? config.modelGroup ?? "") === "image2.5特价";
}
function preference(params: Readonly<Record<string, unknown>>, keys: string[]): unknown {
  return keys.map(key => params[key]).find(value => value !== undefined && value !== "" && value !== "auto");
}
export function secureSkillImageParameters(model: string, parameters: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const result = { ...parameters };
  const tier = preference(parameters, ["image_size", "imageSize", "size_tier", "resolution"]);
  const ratio = preference(parameters, ["aspect_ratio", "aspectRatio", "ratio"]);
  if (tier !== undefined) result.image_size = tier;
  if (ratio !== undefined) result.aspect_ratio = ratio;
  if (model === "gpt-image-2") delete result.quality;
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
  if (params.image_size !== undefined && !TIERS.includes(String(params.image_size))) fail("image_size", "Secure Skill image_size 为 1K / 2K / 4K。");
  if (params.aspect_ratio !== undefined && !(typeof params.aspect_ratio === "string" && /^[1-9]\d*:[1-9]\d*$/u.test(params.aspect_ratio)))
    fail("aspect_ratio", "Secure Skill aspect_ratio 须为正整数 WIDTH:HEIGHT；原值保留，请修改。");
  const size = params.size;
  const image25 = model !== "gpt-image-2";
  // The dedicated current group 49 declaration is separate from group 44's
  // closed 1K route. Do not turn its tier announcement into borrowed pixels.
  const alternateGroup = alternate25TierGroup(config);
  if (size !== undefined && size !== "" && size !== "auto") {
    const parts = typeof size === "string" ? /^([1-9]\d*)x([1-9]\d*)$/u.exec(size) : null;
    if (!parts || !parts.slice(1).every(value => Number.isSafeInteger(Number(value)))) fail("size", "Secure Skill size 须为正整数 WIDTHxHEIGHT。");
    else if (!image25) {
      const width = Number(parts[1]), height = Number(parts[2]);
      if (Math.min(width, height) < 256 || Math.max(width, height) > 3840 || width % 16 || height % 16)
        fail("size", "Secure Skill GPT Image 2 宽高须为 16 的倍数，最短边至少 256、最长边至多 3840；无额外总像素或 3:1 本地限制。");
    } else if (!alternateGroup && !["1024x1024", "1536x1024", "1024x1536"].includes(String(size)))
      fail("size", "Secure Skill GPT Image 2.5 当前接口仅有 1024x1024 / 1536x1024 / 1024x1536；旧值保留，请重新选择。");
  }
  if (image25 && !alternateGroup && (params.image_size !== undefined && params.image_size !== "1K" ||
      params.aspect_ratio !== undefined && !["1:1", "3:2", "2:3"].includes(String(params.aspect_ratio))))
    fail("image_size", "Secure Skill GPT Image 2.5 此当前分组仅 1K 的 1:1 / 3:2 / 2:3。");
  if (image25 && params.quality !== undefined && params.quality !== "auto" && !QUALITY.includes(String(params.quality)))
    fail("quality", "Secure Skill GPT Image 2.5 quality 为 low / medium / high / xhigh / max。");
  if (params.background !== undefined && !["", "auto", "opaque", "transparent"].includes(String(params.background))) fail("background", "Secure Skill background 为 opaque / transparent 或 auto。");
  return issues;
}
export function applySecureSkillImageCapabilities(connection: { provider: string; config: Readonly<Record<string, unknown>> }, model: ModelDescriptor): ModelDescriptor {
  if (!["openai", "rest"].includes(connection.provider) || !isSecureSkillGptImage(connection.config, model.id) ||
    !model.operations.includes("image.generate") || model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test") return model;
  const image25 = model.id !== "gpt-image-2", alternateGroup = alternate25TierGroup(connection.config);
  const detailText = [model.metadata?.supplierGroupDescription, model.metadata?.supplierChannelDescription, model.metadata?.supplierGroupResolutionLabel].filter(value => typeof value === "string").join("\n");
  const detail = parseSupplierGroupDetails({ description: detailText }, "key-groups");
  const tiers = image25 && !alternateGroup ? ["1K"] : detail?.supportedResolutions?.length ? detail.supportedResolutions : TIERS;
  const options = image25 ? SECURE_SKILL_IMAGE_PIXELS.slice(0, 3).map(row => ({ value: row[1], label: `1K · ${row[0]} · ${row[1].replace("x", " × ")}` })) :
    SECURE_SKILL_IMAGE_PIXELS.flatMap(row => TIERS.flatMap((tier, index) => !tiers.includes(tier) ? [] : [{ value: row[index + 1]!, label: `${tier} · ${row[0]} · ${row[index + 1]!.replace("x", " × ")}` }]));
  const parameters: ModelParameterDescriptor[] = [
    { key: "size", label: "输出尺寸（size）", control: image25 && !alternateGroup ? "select" : "dimensions", valueType: "string", default: image25 ? "1024x1024" : "auto",
      options: image25 ? options : [{ value: "auto", label: "按独立档位与比例（未指定时供应商默认）" }, ...options], allowCustomValue: !image25 || alternateGroup,
      ...(!image25 ? { min: 256, max: 3840, step: 16 } : {}), description: image25 ? "本型号当前公共文档为三种 1K 像素；其他官方分组的档位声明独立保存，不生成更高档像素。" : "明确 size 按原值发送；auto 省略 size，使用独立 image_size 与 aspect_ratio。两字段均未指定时供应商默认 2K·1:1（2048×2048）。官方十三比例×三档像素表；表外自定义宽高按原值发送。最短256、最长3840、16倍数，无额外总像素/3:1限制。" },
    { key: "image_size", label: "分辨率档位（image_size）", control: "select", valueType: "string", default: tiers.at(-1) ?? "auto", options: [{ value: "auto", label: "供应商默认" }, ...tiers.map(value => ({ value, label: value }))] },
    { key: "aspect_ratio", label: "画面比例（aspect_ratio）", control: "select", valueType: "string", default: "auto", allowCustomValue: !image25 || alternateGroup,
      options: [{ value: "auto", label: "自动" }, ...(image25 && !alternateGroup ? SECURE_SKILL_IMAGE_PIXELS.slice(0, 3) : SECURE_SKILL_IMAGE_PIXELS).map(row => ({ value: row[0], label: row[0] }))] },
    ...(image25 ? [{ key: "quality", label: "质量（quality）", control: "select" as const, valueType: "string" as const, default: "max", options: QUALITY.map(value => ({ value, label: value })), description: "官方五档质量；max 是用户最高质量偏好的初选，供应商缺省 high。" }] : []),
    ...(model.parameters ?? []).filter(parameter => !["size", "size_tier", "resolution", "image_size", "aspect_ratio", "quality"].includes(parameter.key)),
  ];
  const metadata = { ...model.metadata };
  for (const key of ["imageOutputDimensions", "imageCustomDimensionRules", "imageResolutionProfiles", "imageSupportedSizes", "imageFixedResolution"]) delete metadata[key];
  return { ...model, parameters, metadata: { ...metadata, secureSkillImageProtocol: 1, imageNativeParameterContract: true, imageNativeResolutionParameter: "image_size",
    imageSupportedResolutions: tiers, imageResolutionTierParameter: "image_size", imageNativeQualityOptions: true, documentationUrl: DOCS, imageOutputReferenceDimensions: options,
    imageSizeOptionsCompleteEnum: image25 && !alternateGroup,
    ...(image25 && !alternateGroup ? { imageSizeCompleteEnumSource: `${DOCS}#gpt-image` } : {}),
  } };
}
