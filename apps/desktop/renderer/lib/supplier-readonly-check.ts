import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ProviderConnectionRecord, Repository, SupplierRecord } from "@super-canvas/db";
import { collectCatalogReadCycle, type CatalogCollectorDependencies } from "./catalog-read-collector";
import { catalogConnectionScopes } from "./catalog-source-plan";
import { supplierOwnsStoredConnection } from "./supplier-stored-identity";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import type { SupplierReadOnlyCatalogChange, SupplierReadOnlyCheckReport, SupplierReadOnlyConnectionCheck, SupplierReadOnlySource } from "./supplier-readonly-check-contracts";

type ReadRepository = Pick<Repository, "getSupplier" | "listConnections">;
type ReadTransport = Pick<CatalogCollectorDependencies, "apiKey" | "fetchFor">;
export interface SupplierReadOnlyCheckDependencies {
  repository: ReadRepository;
  readers(connection: ProviderConnectionRecord, supplier: SupplierRecord): Promise<ReadTransport>;
  signal?: AbortSignal;
  now?: () => string;
}

export class SupplierReadOnlyCheckError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const validTime = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const modelIds = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.flatMap(row =>
  row && typeof row === "object" && typeof row.id === "string" && row.id.trim() ? [row.id] : []))].sort() : [];
const sourceUrl = (value: string): string => { const url = new URL(value); return `${url.origin}${url.pathname}`; };
const groupIdentity = (group: { id: string; supplierGroupId?: string }) => group.supplierGroupId !== undefined
  ? `site-id:${group.supplierGroupId}` : `name:${group.id}`;
const knownPrice = (value: string | undefined): value is string => Boolean(value?.trim() &&
  !/^(?:—|-|价格未公布|未公布|未知|未获取|待确认)$/u.test(value.trim()));
const apiAddress = (value: unknown): string | undefined => {
  try { return typeof value === "string" ? new URL(value).href.replace(/\/+$/u, "") : undefined; }
  catch { return undefined; }
};
const ownedConnections = (supplier: SupplierRecord, rows: readonly ProviderConnectionRecord[]) => rows.filter(row =>
  supplierOwnsStoredConnection(supplier, row) && row.config.supplierArchived !== true && !["fake", "cli"].includes(row.provider) &&
  (row.config.supplierSourceId && supplier.state ? row.config.supplierSourceId === supplier.state.sourceId
    : !row.config.supplierId || Boolean(apiAddress(supplier.apiUrl)) && apiAddress(row.config.baseUrl) === apiAddress(supplier.apiUrl)))
  .sort((a, b) => a.id.localeCompare(b.id));

/** Raw response bodies never leave the collector. Normalized display fields can
 * still contain a supplier-reflected credential, so scrub those too. */
function safeReport(report: SupplierReadOnlyCheckReport, secrets: ReadonlySet<string>): SupplierReadOnlyCheckReport {
  const clean = (value: unknown): unknown => {
    if (typeof value === "string") {
      let text = value;
      for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join("[密钥已隐藏]");
      return text.replace(/\bBearer\s+[^\s,;，；]+/giu, "Bearer [已隐藏]")
        .replace(/\bsk-[A-Za-z0-9_-]+/gu, "[密钥已隐藏]");
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clean(entry)]));
    return value;
  };
  return clean(report) as SupplierReadOnlyCheckReport;
}

function sourceSummary({ receipt, facts }: CatalogReadObservation): SupplierReadOnlySource {
  return { entryId: receipt.spec.entryId, sourceUrl: sourceUrl(receipt.spec.sourceUrl), role: receipt.spec.role,
    identity: receipt.spec.authScope.kind, status: receipt.status, complete: receipt.complete, checkedAt: receipt.checkedAt,
    ...(receipt.reason ? { reason: receipt.reason } : {}), modelCount: facts.models.length };
}

/** Only normalized fields are compared; timestamps and incomplete omissions are not changes. */
function catalogChanges(supplier: SupplierRecord, observations: readonly CatalogReadObservation[]): SupplierReadOnlyCatalogChange[] {
  const baseline = Boolean(supplier.scanComplete === true && validTime(supplier.scanLastSuccessAt ?? supplier.scannedAt));
  const oldGroups = new Map<string, SupplierRecord["catalog"]["groups"]>();
  for (const group of supplier.catalog.groups.filter(group => group.source !== "manual" && group.status !== "missing")) {
    const identity = groupIdentity(group); oldGroups.set(identity, [...oldGroups.get(identity) ?? [], group]);
  }
  const changes: SupplierReadOnlyCatalogChange[] = [];
  for (const observation of observations) {
    if (observation.receipt.status !== "succeeded" || !observation.receipt.complete) continue;
    for (const group of observation.facts.supplierGroups ?? []) {
      const identity = groupIdentity(group), matches = oldGroups.get(identity) ?? [];
      const oldGroup = baseline && matches.length === 1 ? matches[0] : undefined;
      const add = (change: Pick<SupplierReadOnlyCatalogChange, "kind" | "after" | "before" | "modelId">) => changes.push({
        groupIdentity: identity, groupName: group.label, sourceUrl: sourceUrl(observation.receipt.spec.sourceUrl),
        checkedAt: observation.receipt.checkedAt, ...change });
      if (!baseline || !matches.length) add({ kind: baseline ? "group-added" : "group-discovered", after: group.label });
      else if (oldGroup && (oldGroup.label !== group.label || oldGroup.id !== group.id))
        add({ kind: "group-renamed", before: oldGroup.label, after: group.label });
      const oldModels = new Map(oldGroup?.models.map(model => [model.id, model]));
      for (const model of group.models) {
        const old = oldModels.get(model.id);
        if (!old) { add({ kind: baseline && oldGroup ? "model-added" : "model-discovered", modelId: model.id, after: model.name ?? model.id }); continue; }
        if (model.name && old.name && model.name !== old.name) add({ kind: "model-name", modelId: model.id, before: old.name, after: model.name });
        if (knownPrice(model.priceLabel) && knownPrice(old.priceLabel) && model.priceLabel !== old.priceLabel)
          add({ kind: "price", modelId: model.id, before: old.priceLabel, after: model.priceLabel });
        const fields = ["protocol", "inputKinds", "outputKinds", "limits"] as const;
        const changed = fields.filter(key => model[key] !== undefined && old[key] !== undefined && !isDeepStrictEqual(model[key], old[key]));
        if (changed.length) add({ kind: "parameters", modelId: model.id,
          before: JSON.stringify(Object.fromEntries(changed.map(key => [key, old[key]]))),
          after: JSON.stringify(Object.fromEntries(changed.map(key => [key, model[key]]))) });
      }
    }
  }
  return [...new Map(changes.map(change => [JSON.stringify([change.groupIdentity, change.modelId, change.kind, change.before, change.after, change.sourceUrl]), change])).values()];
}

/** Explicit user-triggered read. Its dependency cannot save, migrate, publish or schedule anything. */
export async function checkSupplierReadOnly(id: string, dependencies: SupplierReadOnlyCheckDependencies): Promise<SupplierReadOnlyCheckReport> {
  const supplier = await dependencies.repository.getSupplier(id);
  if (!supplier || supplier.state?.visibility === "deleted") throw new SupplierReadOnlyCheckError("供应商不存在", 404);
  const initialConnections = ownedConnections(supplier, await dependencies.repository.listConnections());
  const now = dependencies.now ?? (() => new Date().toISOString());
  const checkedAt = now(), cycleId = randomUUID();
  // A directory-only account still has useful public/account sources. This is
  // an in-memory read target, never a connection or a Key created in storage.
  const directoryOnly = !initialConnections.length;
  const targets = directoryOnly ? [{ id: `readonly:${supplier.id}`, name: supplier.name, provider: "openai", config: {
    baseUrl: supplier.apiUrl, supplierId: supplier.id, supplierSourceId: supplier.state?.sourceId,
  }, createdAt: checkedAt, updatedAt: checkedAt } as ProviderConnectionRecord] : initialConnections;
  const observations: CatalogReadObservation[] = [], connections: SupplierReadOnlyConnectionCheck[] = [], secrets = new Set<string>();
  // Account data is scoped to this supplier record. At most two Keys are read
  // concurrently, so large accounts do not fan out an unbounded request burst.
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(2, targets.length) }, async () => {
    while (index < targets.length) {
      const connection = targets[index++]!;
      const scopes = catalogConnectionScopes(connection, supplier);
      const readers = await dependencies.readers(connection, supplier);
      if (readers.apiKey) secrets.add(readers.apiKey);
      const collection = await collectCatalogReadCycle(connection, supplier, { ...readers, enabled: true, now,
        signal: dependencies.signal, context: { runId: randomUUID(), observationCycleId: cycleId,
          identityEpoch: scopes.key.credentialEpoch, dispatchSeq: 0 } });
      observations.push(...collection.observations);
      if (directoryOnly) continue;
      const timestamp = connection.config.modelScanLastSuccessAt ?? connection.config.modelScanCheckedAt;
      const hasBaseline = validTime(timestamp) && connection.config.modelScanComplete === true &&
        (Array.isArray(connection.config.modelCatalogModels) || Array.isArray(connection.config.scannedModelIds));
      const oldIds = new Set([...modelIds(connection.config.modelCatalogModels),
        ...(Array.isArray(connection.config.scannedModelIds) ? connection.config.scannedModelIds.filter((id): id is string => typeof id === "string") : [])]);
      const currentIds = modelIds(collection.keyVisibleModels), current = new Set(currentIds);
      connections.push({ connectionId: connection.id, name: connection.name, groupIdentity: scopes.apply.groupIdentity ?? "name:",
        hasBaseline, ...(hasBaseline ? { baselineCheckedAt: timestamp } : {}), membershipComplete: collection.manifest.complete,
        currentModelCount: currentIds.length,
        addedModelIds: hasBaseline ? currentIds.filter(id => !oldIds.has(id)) : [],
        firstDiscoveredModelIds: hasBaseline ? [] : currentIds,
        missingModelIds: hasBaseline && collection.manifest.complete && currentIds.length > 0 ? [...oldIds].filter(id => !current.has(id)).sort() : [],
        sources: collection.observations.map(sourceSummary) });
    }
  }));
  // A late response belongs to its original account and baseline. Reject it if
  // an edit, account switch, scan or Key change happened while reads were in flight.
  const [currentSupplier, currentConnections] = await Promise.all([
    dependencies.repository.getSupplier(id), dependencies.repository.listConnections(),
  ]);
  if (!currentSupplier || !isDeepStrictEqual(currentSupplier, supplier) ||
    !isDeepStrictEqual(ownedConnections(currentSupplier, currentConnections), initialConnections))
    throw new SupplierReadOnlyCheckError("供应商、账号或连接资料已变化，请重新检测", 409);
  const sources = [...new Map(observations.map(observation => [observation.receipt.spec.sourceKey, observation])).values()].map(sourceSummary);
  const successful = sources.filter(source => source.status === "succeeded");
  return safeReport({ supplierId: supplier.id, supplierName: supplier.name, checkedAt, readOnly: true,
    status: !successful.length ? "failed" : sources.every(source => source.status === "succeeded" && source.complete) ? "complete" : "partial",
    connections: connections.sort((a, b) => a.connectionId.localeCompare(b.connectionId)), sources,
    catalogChanges: catalogChanges(supplier, observations), limitations: [
      "本次仅检测已接入的机器可读目录、当前账号/Key 与已发现文档入口；不代表已完整阅读官网所有广场详情、文档、公告和分页。",
      "新增及未返回相对于应用已保存基线；首次发现无法确认供应商何时新增。空目录、读取失败和未完整读取不推断删除。",
      "目录改名、价格及参数差异仅比较同一稳定分组的已知字段；缺失字段、跨型号换组、专属协议及供应商发布时间仍需逐项查证。",
      "结果仅供本次查看，不保存目录、价格、缓存或检测基线，不修改连接或 Key，也不发起收费生成。",
      ...(directoryOnly ? ["此账号没有明确归属的已保存连接，本次仅读取公共及账号资料；不按同域名借用其他个人账号的 Key。"] : []),
    ] }, secrets);
}
