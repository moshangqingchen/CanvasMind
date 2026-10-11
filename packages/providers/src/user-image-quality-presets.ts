import type { ModelDescriptor, ModelParameterDescriptor, ModelParameterOption } from "./contracts.js";

const VERSION = "2026-10-11";
const labels: Readonly<Record<string, string>> = { auto: "自动", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高" };

/** Values requested by the user, independently of supplier examples and paid evidence. */
export function userImageQualityValues(modelId: string): readonly string[] {
  if (/^gpt-image-2\.5(?:[-@/]|$)/iu.test(modelId)) return ["auto", "low", "medium", "high", "xhigh", "max"];
  if (/^gpt-image-2(?:\.0)?(?:[-@/]|$)/iu.test(modelId)) return ["auto", "low", "medium", "high"];
  return [];
}

export function userImageQualityOptions(modelId: string): ModelParameterOption[] {
  return userImageQualityValues(modelId).map(value => ({ value, label: `${labels[value]}（${value}）` }));
}

function hasFixedQuality(model: ModelDescriptor, parameter?: ModelParameterDescriptor): boolean {
  const metadata = model.metadata ?? {};
  if (metadata.fixedQuality !== undefined || /-(?:low|medium|high|xhigh|max)(?:@s\d+c\d+)?$/iu.test(model.id) ||
      metadata.imageQualitySource === "key-group" || metadata.imageQualityOptionsCompleteEnum === true) return true;
  const description = String(parameter?.description ?? "");
  return /(?:固定|仅支持|仅接受|仅开放|只能使用|仅能使用|必须使用|只允许).{0,24}(?:low|medium|high|xhigh|max)|(?:low|medium|high|xhigh|max).{0,16}(?:固定|唯一)/iu.test(description) ||
    metadata.imageQualitySource === "official-key-group" && parameter?.options?.length === 1;
}

/** Project user controls without marking them as supplier capability or proof. */
export function applyUserImageQualityPresets(model: ModelDescriptor): ModelDescriptor {
  const values = userImageQualityValues(model.id);
  if (!values.length || !model.operations?.some(operation => operation.startsWith("image."))) return model;
  if (model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test") return model;
  const quality = model.parameters?.find(parameter => parameter.key === "quality");
  if (hasFixedQuality(model, quality)) return model;
  if (quality?.options?.some(option => /^(?:[124]k|web|\d+p)$/iu.test(String(option.value)))) return model;
  if (!quality && !(model.metadata?.protocol === "openai-images" || model.metadata?.imageOpenSizePreferences === true ||
      model.metadata?.pdogImageProtocol === 1 || model.metadata?.cOpenImageContract === 1)) return model;
  if (!quality && (model.metadata?.imageQualitySource === "key-group" || model.metadata?.imageQualityParameterUnsupported === true)) return model;
  const denied = new Set([
    ...(Array.isArray(model.metadata?.imageUnsupportedQualities) ? model.metadata.imageUnsupportedQualities : []),
    ...(Array.isArray(model.metadata?.imageRejectedQualities) ? model.metadata.imageRejectedQualities : []),
  ].map(String));
  const allowed = userImageQualityOptions(model.id).filter(option => !denied.has(String(option.value)));
  if (!allowed.length) return model;
  const source = model.metadata?.imageUserQualityPresets === VERSION
    ? model.metadata.imageUserQualitySourceParameter : quality;
  // Image 2.0's requested highest is high even when an old generic schema had
  // extra values. Saved selections remain untouched; this is the menu default.
  const options = [...allowed, ...(quality?.options ?? []).filter(option =>
    !["auto", "low", "medium", "high", "xhigh", "max"].includes(String(option.value)) && !denied.has(String(option.value)))];
  const next: ModelParameterDescriptor = { ...quality, key: "quality", label: "质量", control: "select", valueType: "string",
    default: allowed.at(-1)!.value, options, ...(quality?.allowCustomValue === true ? { allowCustomValue: true } : {}),
    description: "按用户要求提供质量选项；Image 2.5 最高使用 max，Image 2.0 最高使用 high。实际画质以供应商返回为准。",
    operations: quality?.operations ?? ["image.generate", "image.edit"],
  };
  return { ...model, parameters: quality ? model.parameters!.map(parameter => parameter === quality ? next : parameter) : [...(model.parameters ?? []), next],
    metadata: { ...model.metadata, imageUserQualityPresets: VERSION, imageUserQualityPresetSource: "user-request",
      imageApplicationQualityDefault: next.default, ...(source ? { imageUserQualitySourceParameter: source } : {}) } };
}
