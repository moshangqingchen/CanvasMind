import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { supplierGroupPriceLabel, supplierGroupResolutionLabel } from "@super-canvas/providers/supplier-group-details";
import { modelPickerPriceData } from "./model-picker-data";
import { catalogGroupIdentity, catalogPriceDescriptor } from "./supplier-catalog-price-merge";
import type { CatalogChange, CatalogCheckMode, CatalogFailureReason } from "./supplier-catalog-contracts";

export const CATALOG_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_HISTORY_RETENTION_MS = 30 * CATALOG_CHECK_INTERVAL_MS;
export const CATALOG_MODE_SETTING = "supplierCatalogCheckMode";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sampleField = /(?:checkedAt|observedAt|scannedAt|updatedAt|createdAt|sampledAt|lastSuccessAt|timestamp|sourceUrl)$/iu;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sampleField.test(key) && !["confidence", "source"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
}
function priceValue(value: unknown): unknown {
  const row = object(value), metadata = object(row.metadata);
  const label = row.priceLabel ?? metadata.priceLabel;
  return canonical({ pricing: structuredPrice(row), priceLabel: typeof label === "string" ? label.replace(/（上次价格）$/u, "") : label,
    ...Object.fromEntries(Object.entries(metadata).filter(([key]) =>
      ["billingIncludesInputDuration", "billingExpression", "priceExpression", "priceConditions", "measuredPrice"].includes(key))) });
}
function structuredPrice(row: Record<string, unknown>): unknown {
  const metadata = object(row.metadata);
  return row.pricing ?? metadata.secureSkillCatalogPricing ?? metadata.chuangxiangCatalogPricing ?? metadata.tk1688Pricing ??
    metadata.weaiLegacyPricing ?? metadata.sub2apiPlazaPricing ?? metadata.miaowuCatalogPricing ?? metadata.hangCatalogPricing ?? metadata.officialCatalogPricing;
}
function priceText(value: unknown): string {
  return modelPickerPriceData(catalogPriceDescriptor(value));
}
const parameterFields = ["key", "label", "control", "valueType", "default", "min", "max", "step", "options", "allowCustomValue", "operations", "required", "visibleWhen", "constraints"];
const modelFieldLabels: Record<string, string> = { name: "名称", provider: "提供方", capability: "目录分类", protocol: "接口协议", operations: "操作", capabilities: "能力", inputKinds: "输入素材类型", outputKinds: "输出类型", parameters: "参数", limits: "素材与输入限制", isDefault: "目录默认型号", canvasRunnable: "可用于画布", agentCapabilities: "已记录的助手能力", reasoningOptions: "已记录的思考档位" };
const factLabels: Record<string, string> = { key: "字段", label: "名称", control: "控件", valueType: "类型", default: "默认值", min: "最小值", max: "最大值", step: "步长", options: "可选值", value: "值", allowCustomValue: "允许自定义", operations: "适用操作", required: "必填", visibleWhen: "显示条件", constraints: "条件限制", when: "条件", parameter: "字段", values: "取值" };
function stringSet(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string"))].sort();
}
/** Compare declared descriptor/catalog fields and explicitly stored eligibility.
 * Price, provenance, sampling and free-form descriptions are handled separately
 * or ignored; no capability is inferred from a name or descriptive text. */
function modelFacts(value: unknown): Record<string, unknown> {
  const row = object(value), metadata = object(row.metadata);
  return canonical({ name: typeof row.name === "string" ? row.name : row.id, provider: row.provider,
    capability: row.capability, protocol: row.protocol ?? metadata.protocol,
    operations: stringSet(row.operations), capabilities: stringSet(row.capabilities),
    inputKinds: stringSet(row.inputKinds), outputKinds: stringSet(row.outputKinds), limits: object(row.limits),
    isDefault: typeof row.isDefault === "boolean" ? row.isDefault : undefined,
    canvasRunnable: typeof metadata.canvasRunnable === "boolean" ? metadata.canvasRunnable : undefined, agentCapabilities: object(metadata.agentCapabilities),
    reasoningOptions: Array.isArray(metadata.reasoningOptions) ? metadata.reasoningOptions : [],
    parameters: (Array.isArray(row.parameters) ? row.parameters : []).map(parameter => {
      const field = object(parameter);
      return Object.fromEntries(parameterFields.filter(key => field[key] !== undefined).map(key => [key, field[key]]));
    }).sort((a, b) => String(a.key).localeCompare(String(b.key))) }) as Record<string, unknown>;
}
function factText(value: unknown): string {
  if (value === undefined || value === null || Array.isArray(value) && !value.length) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(factText).join(" / ");
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${factLabels[key] ?? key}：${factText(item)}`).join("，") || "—";
  return String(value);
}
export function catalogChanges(before: ProviderConnectionRecord, after: ProviderConnectionRecord,
  oldSupplier?: SupplierRecord, newSupplier?: SupplierRecord): CatalogChange[] {
  const changes: CatalogChange[] = [];
  const compareModels = (oldModels: unknown[], newModels: unknown[], groupId?: string) => {
    const old = new Map(oldModels.map(model => [String(object(model).id), model]));
    const next = new Map(newModels.map(model => [String(object(model).id), model]));
    for (const [modelId, model] of next) {
      if (!old.has(modelId)) changes.push({ kind: "model-added", modelId, groupId, after: priceText(model) });
      else {
        const previous = old.get(modelId);
        if (JSON.stringify(priceValue(previous)) !== JSON.stringify(priceValue(model)))
          changes.push({ kind: "price", modelId, groupId, before: priceText(previous), after: priceText(model) });
        const oldFacts = modelFacts(previous), nextFacts = modelFacts(model);
        const fields = Object.keys(nextFacts).filter(key => JSON.stringify(oldFacts[key]) !== JSON.stringify(nextFacts[key]));
        if (fields.length) changes.push({ kind: "model-changed", modelId, groupId,
          before: fields.map(key => `${modelFieldLabels[key]}：${factText(oldFacts[key])}`).join("；"),
          after: fields.map(key => `${modelFieldLabels[key]}：${factText(nextFacts[key])}`).join("；") });
      }
    }
    for (const [modelId, model] of old) if (!next.has(modelId)) changes.push({ kind: "model-removed", modelId, groupId, before: priceText(model) });
  };
  compareModels(Array.isArray(before.config.modelCatalogModels) ? before.config.modelCatalogModels : [],
    Array.isArray(after.config.modelCatalogModels) ? after.config.modelCatalogModels : []);
  if (oldSupplier && newSupplier) {
    const groupValue = (group: SupplierRecord["catalog"]["groups"][number]) => canonical({ id: group.id, label: group.label,
      referencePrice: group.details?.referencePrice, imagePrices: group.details?.imagePrices,
      rateMultiplier: group.details?.rateMultiplier, imageRateMultiplier: group.details?.imageRateMultiplier,
      concurrencyLimit: group.details?.concurrencyLimit, rpmLimit: group.details?.rpmLimit });
    const groupPrice = (group: SupplierRecord["catalog"]["groups"][number]) => canonical({ referencePrice: group.details?.referencePrice,
      imagePrices: group.details?.imagePrices, rateMultiplier: group.details?.rateMultiplier, imageRateMultiplier: group.details?.imageRateMultiplier });
    const groupPriceText = (group: SupplierRecord["catalog"]["groups"][number]) => {
      const details = group.details;
      return [supplierGroupPriceLabel(details ? { ...details, imagePrices: undefined } : undefined),
        supplierGroupPriceLabel(details ? { source: details.source, imagePrices: details.imagePrices } : undefined),
        supplierGroupResolutionLabel(details),
        details?.rateMultiplier !== undefined ? `后台倍率：${details.rateMultiplier}×` : "",
        details?.imageRateMultiplier !== undefined ? `图片倍率：${details.imageRateMultiplier}×` : ""].filter(Boolean).join(" · ") || "—";
    };
    const groupText = (group: SupplierRecord["catalog"]["groups"][number]) =>
      [`${group.label}（${group.id}）`, groupPriceText(group),
        group.details?.concurrencyLimit !== undefined ? `并发上限：${group.details.concurrencyLimit}` : "",
        group.details?.rpmLimit !== undefined ? `每分钟请求上限：${group.details.rpmLimit}` : ""].filter(Boolean).join(" · ");
    const old = new Map(oldSupplier.catalog.groups.map(group => [catalogGroupIdentity(group), group]));
    const next = new Map(newSupplier.catalog.groups.map(group => [catalogGroupIdentity(group), group]));
    for (const [key, group] of next) {
      const previous = old.get(key);
      if (!previous) changes.push({ kind: "group-added", groupId: group.id, after: group.label });
      else {
        // An absent supplementary group quote is not evidence that its price
        // became zero/unknown. This comparison-only view never enters saved
        // groups, where it could accidentally price a newly discovered model.
        const compared: typeof group = { ...group, details: group.details ? { ...group.details } : previous.details ? { source: previous.details.source } : undefined };
        if (compared.details && previous.details) for (const field of ["referencePrice", "imagePrices", "rateMultiplier", "imageRateMultiplier"] as const)
          if (compared.details[field] === undefined && previous.details[field] !== undefined)
            Object.assign(compared.details, { [field]: previous.details[field] });
        if (JSON.stringify(groupPrice(previous)) !== JSON.stringify(groupPrice(compared)))
          changes.push({ kind: "price", groupId: group.id, before: groupPriceText(previous), after: groupPriceText(compared) });
        if (JSON.stringify(groupValue(previous)) !== JSON.stringify(groupValue(compared)))
          changes.push({ kind: "group-changed", groupId: group.id, before: groupText(previous), after: groupText(compared) });
        compareModels(previous.models, group.models, group.id);
      }
    }
    for (const [key, group] of old) if (!next.has(key)) changes.push({ kind: "group-removed", groupId: group.id, before: group.label });
  }
  return changes;
}
export function classifyCatalogFailure(status?: number, code?: unknown): CatalogFailureReason {
  const text = String(code ?? "").toLowerCase();
  if (/balance|quota|credit|余额|额度/u.test(text) || status === 402) return "balance";
  if (status === 401 || status === 403 || /credential|unauthor|permission|authentication|token/u.test(text)) return "authentication";
  if (/unsupported|not.support|不支持/u.test(text) || status === 404 || status === 405) return "unsupported";
  if (/network|timeout|abort|fetch|网络/u.test(text)) return "network";
  if (/incomplete|invalid.response/u.test(text)) return "incomplete";
  return "upstream";
}
export function catalogMode(value: unknown): CatalogCheckMode {
  return value === "off" || value === "upgrade" ? value : "daily";
}
export function clearCatalogManualMarker(config: ProviderConnectionRecord["config"]): ProviderConnectionRecord["config"] {
  return { ...config, catalogCheckManualRequired: false, catalogCheckPaused: false,
    catalogCheckFailureStreak: 0, catalogCheckFailureReason: null };
}
