import type { ModelDescriptor, ProviderOperation } from "./contracts.js";
import { modelGenerationMediaKinds } from "./model-media.js";

const MODELS = new Set(["midjourney-1k", "midjourney-2k"]);
const DOCS = "https://vapi.chuangxiangai.asia/docs/image";
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
export const CHUANGXIANG_MIDJOURNEY_REFERENCES = ["image", "style", "edit", "moodboard", "editor"];
// Only edit=4 and editor=1 are supplier limits. Other modes use this adapter bound.
export const CHUANGXIANG_MIDJOURNEY_ADAPTER_REFERENCE_LIMIT = 16;
type Connection = { provider: string; config: Readonly<Record<string, unknown>> };

export function isChuangxiangMidjourneyConnection(config: Readonly<Record<string, unknown>> | undefined, model?: string): boolean {
  if (!config || !MODELS.has(model ?? String(config.defaultModel ?? "")) ||
      String(config.accountKeyGroup ?? config.modelGroup ?? "") !== "生图" ||
      config.supplierArchived === true || ["agent", "disabled"].includes(String(config.usage))) return false;
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    return url.origin === "https://vapi.chuangxiangai.asia" && !url.port && !url.username && !url.password &&
      !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

export function chuangxiangMidjourneyInventoryIssue(config: Readonly<Record<string, unknown>>, model: string): string | undefined {
  if (["empty", "unauthorized"].includes(String(config.modelScanStatus))) return "当前创想 Key 未返回可用型号，请核对分组权限。";
  if (Array.isArray(config.scannedModelIds) && !config.scannedModelIds.includes(model)) return "当前创想 Key 的目录未返回此完整型号。";
  if (Array.isArray(config.unavailableModels) && config.unavailableModels.some(value => value === model ||
      !!value && typeof value === "object" && value.id === model)) return "当前创想分组已记录此型号不可用，请核对 Key 权限。";
}

export function chuangxiangMidjourneyRequiresPublicAssets(provider: string, config: Readonly<Record<string, unknown>> | undefined,
  model?: string, operation?: ProviderOperation): boolean {
  return ["openai", "rest"].includes(provider) && operation === "image.edit" && isChuangxiangMidjourneyConnection(config, model);
}

/** Restore missing protocol metadata for these exact SKUs; keep permissions and declared outputs. */
export function applyChuangxiangMidjourneyCapabilities(connection: Connection, model: ModelDescriptor): ModelDescriptor {
  if (!["openai", "rest"].includes(connection.provider) || !isChuangxiangMidjourneyConnection(connection.config, model.id) ||
      model.outputKinds && model.metadata?.outputKindsSource !== "inferred" && !modelGenerationMediaKinds(model).includes("image")) return model;
  const metadata = { ...model.metadata }, reason = String(metadata.canvasUnavailableReason ?? "");
  const denied = /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(reason);
  if (denied || metadata.canvasRunnable === false && metadata.autoInterfaceStatus !== "incomplete" && !/协议|接口|protocol|adapter/iu.test(reason)) return model;
  const inventoryIssue = chuangxiangMidjourneyInventoryIssue(connection.config, model.id);
  if (inventoryIssue) return { ...model, metadata: { ...metadata, canvasRunnable: false, canvasUnavailableReason: inventoryIssue } };
  delete metadata.canvasUnavailableReason;
  if (metadata.autoInterfaceStatus === "incomplete") delete metadata.autoInterfaceStatus;
  const limits = { ...model.limits, maxOutputImages: 4 };
  delete limits.maxInputImages;
  const tier = model.id.endsWith("2k") ? "2K" : "1K";
  return { ...model, operations: ["image.generate", "image.edit"], capabilities: ["image.generate", "image.edit"],
    inputKinds: ["text", "image", "image[]"], outputKinds: ["image"], limits,
    parameters: [
      { key: "size", label: "画面比例", control: "select", valueType: "string", default: "auto",
        options: [{ value: "auto", label: "自动（不指定比例）" }, ...RATIOS.map(value => ({ value, label: value }))] },
      { key: "speed", label: "生成速度", control: "select", valueType: "string", default: "relax",
        options: [{ value: "relax", label: "Relax" }, { value: "fast", label: "Fast" }] },
      { key: "reference", label: "参考图片模式", control: "select", valueType: "string", default: "auto",
        options: [{ value: "auto", label: "自动（有参考图时使用普通参考）" }, ...CHUANGXIANG_MIDJOURNEY_REFERENCES.map(value => ({ value, label:
          ({ image: "普通参考", style: "风格参考", edit: "图片编辑（最多四张）", moodboard: "情绪板", editor: "局部编辑（一张原图，可加蒙版）" } as Record<string, string>)[value]! }))] },
      { key: "n", label: "生成任务数", control: "number", valueType: "integer", default: 1, min: 1, max: 1,
        description: "一次任务返回四张图片，按一次任务收费。" },
    ], metadata: { ...metadata, canvasRunnable: true, parameterControlsUnavailable: false, protocol: "chuangxiang-midjourney-images",
      documentationUrl: DOCS, fixedOutputCount: 4, fixedRequestCount: 1, imageSupportedResolutions: [tier],
      midjourneyReferenceLimits: { edit: 4, editor: 1 }, midjourneyAdapterReferenceLimit: CHUANGXIANG_MIDJOURNEY_ADAPTER_REFERENCE_LIMIT,
      midjourneyReferenceLimitSource: "mode-specific-official-and-adapter", supportVerification: "official-exact-model-contract" } };
}
