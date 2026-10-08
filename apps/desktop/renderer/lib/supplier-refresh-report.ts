import type { SupplierBillingSnapshot } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "./client-api";
import { supplierOwnsConnection, type SupplierRecord } from "./client-suppliers";
import { modelInventoryLastSuccessAt, modelInventoryScanStatus } from "./model-inventory-status";
import { inventoryModels } from "./model-availability";
import { modelPriceSummary } from "./model-display";

export interface SupplierModelChange { id: string; name: string; before: string; after: string }
export interface SupplierConnectionRefreshResult {
  id: string;
  name: string;
  group?: string;
  groupId?: string;
  status: "updated" | "empty" | "failed" | "unconfigured" | "unconfirmed";
  message: string;
  checkedAt?: string;
  lastSuccessAt?: string;
  modelCount: number;
  modelAddedIds: string[];
  modelRemovedModels: Array<{ id: string; name: string }>;
  interfaceChanges: SupplierModelChange[];
  priceChanges: SupplierModelChange[];
  modelIssues?: Array<{ id: string; name: string; message: string }>;
  priceIssues?: Array<{ id: string; name: string; message: string; failed: boolean }>;
}
export interface SupplierRefreshResult {
  id: string;
  name: string;
  status: "updated" | "partial" | "failed";
  message: string;
  checkedAt?: string;
  directory?: { status: "updated" | "failed" | "unconfirmed"; message: string; checkedAt?: string };
  sourceId?: string;
  snapshotOnly?: boolean;
  connections?: SupplierConnectionRefreshResult[];
  groupChanges?: {
    added: Array<{ id: string; label: string }>;
    missing: Array<{ id: string; label: string }>;
    renamed: Array<{ id: string; before: string; after: string }>;
  };
  keySync?: { status: "live" | "partial" | "failed"; message: string; imported: number; preserved: number; skipped: number };
  billing?: SupplierBillingSnapshot;
}

/** Diagnostic text is deliberately projected, never a dump of connection configuration. */
export function safeRefreshMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, "")
    .replace(/\bBearer\s+[^\s,;，；]+/giu, "Bearer [已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, "[密钥已隐藏]")
    .replace(/https?:\/\/[^\s<>]+/giu, "[接口地址已隐藏]")
    .replace(/((?:api[_ -]?key|access[_ -]?token|password|authorization|cookie)\s*[=:]\s*)[^\s,;，；]+/giu, "$1[已隐藏]")
    .slice(0, 1000);
}
const models = (connection?: ProviderConnectionView): ModelDescriptor[] =>
  Array.isArray(connection?.config.modelCatalogModels)
    ? (connection!.config.modelCatalogModels as unknown as ModelDescriptor[]).filter(model => model && typeof model.id === "string") : [];
function interfaceLabel(model: ModelDescriptor): string {
  const metadata = model.metadata;
  const parts = [metadata?.protocol, metadata?.autoInterfacePath,
    ...(Array.isArray(metadata?.endpointTypes) ? metadata.endpointTypes : []),
    ...(model.operations ?? [])].filter((value): value is string => typeof value === "string" && Boolean(value));
  return [...new Set(parts)].sort().join(" · ") || "接口待确认";
}
function priceIdentity(model: ModelDescriptor): string {
  // A later evidence timestamp alone is not a price change.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["checkedAt", "sourceUrl", "lastSuccessAt", "validUntil", "confidence"].includes(key)).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  const fallback = typeof model.metadata?.priceLabel === "string"
    ? model.metadata.priceLabel.replace(/（上次价格）/gu, "") : null;
  return JSON.stringify(canonical(model.pricing ?? fallback));
}
function priceChangeLabel(model: ModelDescriptor): string {
  const pricing = model.pricing;
  if (pricing?.kind === "token" && pricing.tiers?.some(tier => tier.conditions?.length)) return modelPriceSummary(model, {});
  if (pricing?.kind === "token") return [
    pricing.inputPerMillion !== undefined ? `输入 ${pricing.inputPerMillion} ${pricing.currency}/百万 Token` : "",
    pricing.outputPerMillion !== undefined ? `输出 ${pricing.outputPerMillion} ${pricing.currency}/百万 Token` : "",
    pricing.imageOutputPerMillion !== undefined ? `图片输出 ${pricing.imageOutputPerMillion} ${pricing.currency}/百万 Token` : "",
  ].filter(Boolean).join(" · ") || "按用量计费，价格待确认";
  if (pricing?.kind === "tiered" && pricing.tiers?.length) {
    const unit = pricing.billingUnit === "second" ? "秒" : pricing.billingUnit === "request" ? "请求" : "张";
    return pricing.tiers.map(tier => `${tier.label || tier.id}${tier.conditions?.length ? `（${tier.conditions.map(condition => `${condition.parameter}${condition.operator === "contains" ? "包含" : "="}${condition.value}`).join(tier.conditionMode === "any" ? " 或 " : "，")}）` : ""} ${tier.price} ${pricing.currency}/${unit}`).join("；");
  }
  return modelPriceSummary(model, {});
}

/** Compare this attempt's successful inventories; cumulative removed-model history is not a diff. */
export function buildSupplierRefreshResult(
  before: SupplierRecord,
  after: SupplierRecord,
  priorConnections: readonly ProviderConnectionView[],
  finalConnections: readonly ProviderConnectionView[],
  checkedAt = new Date().toISOString(),
  options: { snapshotOnly?: boolean } = {},
): SupplierRefreshResult {
  const sameSource = !before.state?.sourceId || before.state.sourceId === after.state?.sourceId;
  // scanId changes at request start, so it cannot prove a superseding scan completed.
  const directoryFresh = options.snapshotOnly || Boolean(after.scannedAt && after.scannedAt !== before.scannedAt);
  const directoryOk = sameSource && directoryFresh && ["live", "empty"].includes(after.scanStatus);
  const oldGroups = new Map(before.catalog.groups.filter(group => group.source !== "manual" && group.status !== "missing").map(group => [group.id, group]));
  const newGroups = after.catalog.groups.filter(group => group.source !== "manual" && group.status !== "missing");
  const currentIds = new Set(newGroups.map(group => group.id));
  const groupChanges: NonNullable<SupplierRefreshResult["groupChanges"]> = {
    added: [], missing: [], renamed: [],
  };
  if (directoryOk && !options.snapshotOnly) {
    groupChanges.added = newGroups.filter(group => !oldGroups.has(group.id)).map(({ id, label }) => ({ id, label }));
    if (after.scanComplete === true) groupChanges.missing = [...oldGroups.values()]
      .filter(group => !currentIds.has(group.id)).map(({ id, label }) => ({ id, label }));
    groupChanges.renamed = newGroups.filter(group => oldGroups.has(group.id) && oldGroups.get(group.id)!.label !== group.label)
      .map(group => ({ id: group.id, before: oldGroups.get(group.id)!.label, after: group.label }));
  }
  const prior = new Map(priorConnections.filter(connection => supplierOwnsConnection(before, connection)).map(connection => [connection.id, connection]));
  const owned = finalConnections.filter(connection => supplierOwnsConnection(after, connection));
  const connections: SupplierConnectionRefreshResult[] = owned.map(connection => {
    const old = prior.get(connection.id);
    const groupId = String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "default");
    const group = after.catalog.groups.find(item => item.id === groupId)?.label ?? groupId;
    const scanStatus = modelInventoryScanStatus(connection.config);
    const fresh = sameSource && (options.snapshotOnly || Boolean(connection.config.modelScanCheckedAt &&
      connection.config.modelScanCheckedAt !== old?.config.modelScanCheckedAt));
    const confirmed = connection.apiKeySet && fresh && ["live", "empty"].includes(scanStatus);
    const status: SupplierConnectionRefreshResult["status"] = !connection.apiKeySet ? "unconfigured" :
      !fresh ? "unconfirmed" : confirmed ? (scanStatus === "empty" ? "empty" : "updated") :
        ["unauthorized", "stale", "failed"].includes(scanStatus) ? "failed" : "unconfirmed";
    const actualModels = models(connection);
    const oldModels = new Map(models(old).map(model => [model.id, model]));
    const oldInventory = new Map([...inventoryModels(old?.config.scannedModelIds &&
      Array.isArray(old.config.scannedModelIds) ? old.config.scannedModelIds.map(id => ({ id, name: id })) : []),
      ...inventoryModels(old?.config.modelCatalogModels)].map(model => [model.id, model]));
    const currentIds = new Set(actualModels.map(model => model.id));
    const changesAllowed = confirmed && !options.snapshotOnly;
    const fallback = status === "unconfigured" ? "尚未配置分组 API Key，请配置后读取模型。" :
      status === "empty" ? "本次请求成功，供应商返回空模型列表。" : status === "updated" ? "本次已读取分组可用模型与接口资料。" :
        scanStatus === "unauthorized" ? "分组 Key 鉴权失败，请检查有效期和分组权限。" :
          status === "unconfirmed" ? "本次尚未获得新的确认结果，保留已有模型与配置。" : "模型读取失败，保留上次成功结果；请检查网络或供应商接口。";
    const httpStatus = connection.config.modelScanHttpStatus;
    const message = safeRefreshMessage(status === "failed" ? connection.config.modelScanError : undefined, fallback);
    return {
      id: connection.id, name: connection.name, group, groupId, status,
      message: status === "failed" && typeof httpStatus === "number" && httpStatus >= 400 && httpStatus <= 599
        ? `${message}（HTTP ${httpStatus}）` : message,
      checkedAt: typeof connection.config.modelScanCheckedAt === "string" ? connection.config.modelScanCheckedAt : undefined,
      lastSuccessAt: modelInventoryLastSuccessAt(connection.config), modelCount: actualModels.length,
      modelAddedIds: changesAllowed ? actualModels.filter(model => !oldInventory.has(model.id)).map(model => model.id) : [],
      modelRemovedModels: changesAllowed && connection.config.modelScanComplete !== false ? [...oldInventory.values()].filter(model => !currentIds.has(model.id)) : [],
      interfaceChanges: changesAllowed ? actualModels.flatMap(model => {
        const old = oldModels.get(model.id);
        const previous = old ? interfaceLabel(old) : "尚未发现";
        const next = interfaceLabel(model);
        return previous !== next ? [{ id: model.id, name: model.name ?? model.id, before: previous, after: next }] : [];
      }) : [],
      modelIssues: actualModels.flatMap(model => model.metadata?.canvasRunnable === false || model.metadata?.autoInterfaceStatus === "incomplete"
        ? [{ id: model.id, name: model.name ?? model.id, message: safeRefreshMessage(model.metadata?.canvasUnavailableReason, "此模型的调用接口尚未确认，请查看模型说明。") }] : []),
      priceIssues: actualModels.flatMap(model => {
        const status = String(model.metadata?.priceStatus ?? "");
        if (!["failed", "unauthorized", "partial", "unpublished"].includes(status)) return [];
        const reason = status === "unauthorized" ? "价格读取缺少站点权限" : status === "partial" ? "价格目录未完整读取" : status === "failed" ? "本次价格读取失败" : "供应商未公布价格";
        return [{ id: model.id, name: model.name ?? model.id, failed: status !== "unpublished",
          message: `${reason}；${safeRefreshMessage(model.metadata?.priceLabel, "价格待确认")}` }];
      }),
      priceChanges: changesAllowed ? actualModels.flatMap(model => {
        const old = oldModels.get(model.id);
        if (!old || priceIdentity(old) === priceIdentity(model)) return [];
        return [{ id: model.id, name: model.name ?? model.id, before: priceChangeLabel(old), after: priceChangeLabel(model) }];
      }) : [],
    };
  });
  // Directory-only groups also need an actionable row instead of disappearing from the report.
  for (const group of after.catalog.groups.filter(group => group.status !== "missing")) {
    if (!connections.some(connection => connection.groupId === group.id)) connections.push({
      id: `group:${group.id}`, name: group.label, group: group.label, groupId: group.id, status: "unconfigured",
      message: "已发现分组，尚未配置对应 API Key。", modelCount: 0, modelAddedIds: [], modelRemovedModels: [], interfaceChanges: [], priceChanges: [],
    });
  }
  const keyed = owned.filter(connection => connection.apiKeySet);
  const confirmed = connections.filter(connection => ["updated", "empty"].includes(connection.status)).length;
  const pending = connections.filter(connection => !["updated", "empty"].includes(connection.status)).length;
  const sync = after.state?.keySync;
  const syncFresh = sync && (options.snapshotOnly || sync.checkedAt !== before.state?.keySync?.checkedAt);
  const keySync = syncFresh ? { status: sync.status, imported: sync.imported, preserved: sync.preserved, skipped: sync.skipped,
    message: safeRefreshMessage(sync.error, `补充 ${sync.imported} 个 Key，保留 ${sync.preserved} 个已有 Key，跳过 ${sync.skipped} 项。`) } : undefined;
  const billing = after.state?.billing?.sourceId === after.state?.sourceId ? after.state?.billing : undefined;
  const interfacePending = connections.some(connection => connection.modelIssues?.length);
  const priceReadFailed = connections.some(connection => ["updated", "empty"].includes(connection.status) && connection.priceIssues?.some(issue => issue.failed));
  const billingIncomplete = options.snapshotOnly && billing && (["failed", "partial"].includes(billing.status) || billing.todayStatus === "failed");
  const incomplete = !directoryOk || after.scanComplete === false || Boolean(after.scanError) || pending > 0 || interfacePending || priceReadFailed || billingIncomplete ||
    (syncFresh && sync.status !== "live");
  const added = connections.reduce((sum, item) => sum + item.modelAddedIds.length, 0);
  const removed = connections.reduce((sum, item) => sum + item.modelRemovedModels.length, 0);
  return {
    id: after.id, name: after.name, checkedAt, sourceId: after.state?.sourceId, snapshotOnly: options.snapshotOnly === true,
    status: incomplete ? (confirmed || directoryOk ? "partial" : "failed") : "updated",
    message: `${directoryOk ? `分组新增 ${groupChanges.added.length}、未再返回 ${groupChanges.missing.length}、更名 ${groupChanges.renamed.length}` : "目录未确认，保留原分组"}；Key 已确认 ${confirmed}/${keyed.length}；模型新增 ${added}、未再返回 ${removed}${pending ? `；${pending} 项待处理` : ""}${interfacePending ? "；部分接口待确认" : ""}${priceReadFailed ? "；部分价格未读取" : ""}`,
    directory: { status: directoryOk ? "updated" : ["failed", "unauthorized"].includes(after.scanStatus) ? "failed" : "unconfirmed",
      message: safeRefreshMessage(after.scanError, directoryOk ? after.scanComplete === true ? "已读取完整目录，可核对新增、更名和未再返回的分组。" : "目录已读取；分组完整性尚未确认，保留未返回的历史分组。" : "目录读取未完成，保留上次结果。"), checkedAt: after.scannedAt },
    connections, groupChanges, keySync, billing,
  };
}

/** Display saved status without inventing changes when no before/after baseline exists. */
export function supplierRefreshStatus(supplier: SupplierRecord, connections: readonly ProviderConnectionView[]): SupplierRefreshResult {
  return buildSupplierRefreshResult(supplier, supplier, connections, connections,
    supplier.scannedAt ?? supplier.updatedAt, { snapshotOnly: true });
}
