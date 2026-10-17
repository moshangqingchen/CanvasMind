import { createHash } from "node:crypto";
import { type CatalogPipelineState, type JsonObject, type ProviderConnectionRecord, type Repository } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CatalogInventoryState } from "./catalog-inventory-policy";
import type { CatalogContractState } from "./catalog-contract-policy";
import type { CatalogReadObservation, CatalogReadItemSpec } from "./catalog-read-contracts";
import type { CatalogSchedulerState } from "./catalog-read-scheduler";
import type { CatalogReadTask } from "./catalog-read-task";
import { CATALOG_HISTORY_RETENTION_MS, CATALOG_MODE_SETTING, catalogMode } from "./supplier-catalog-policy";
import { nextCatalogCheckAt, supportedCatalogConnection } from "./supplier-catalog-upgrade";
import type { CatalogChangeRecord, CatalogCheckMode, CatalogConnectionStatus, CatalogFailureReason, CatalogPipelineDiagnostics, CatalogSourceDiagnostic, CatalogUpgradeStatus } from "./supplier-catalog-contracts";

export const CATALOG_PIPELINE_NOTICE_CURSORS = "supplier-catalog-pipeline-notice-cursors:v1";
export interface CatalogPipelineConnectionDiagnostic {
  schemaVersion: 1;
  /** Advance only for meaningful status/attention changes, not sampling time alone. */
  cursor: number;
  checkedAt: string;
  outcome: "complete" | "partial" | "failed" | "pending";
  reason?: CatalogFailureReason;
  manualRequired: boolean;
  retainedPriceModelCount: number;
}
export interface CatalogPipelineChanges {
  schemaVersion: 1;
  cursor: number;
  records: CatalogChangeRecord[];
}
type PipelineSnapshot = { ownerId: string; state: CatalogPipelineState };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const instant = (value: unknown): string | undefined => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
const at = (value: number | undefined): string | null => value !== undefined && Number.isFinite(value) ? new Date(value).toISOString() : null;
const cursor = (value: unknown): number => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
export const catalogPipelineCursorKey = (ownerId: string, entryKey: string): string => `${ownerId}/${entryKey}`;

/** No query, hash, credentials, or raw response reaches diagnostics. */
export function catalogDiagnosticSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    return `${url.origin}${url.pathname}`;
  } catch { return; }
}

/** Descriptors contain parameter names named `key`; only credential fields are removed. */
function safeDescriptor(value: ModelDescriptor): ModelDescriptor {
  const safe = (entry: unknown): unknown => {
    if (typeof entry === "string") return /^(?:https?:)\/\//iu.test(entry) ? catalogDiagnosticSourceUrl(entry) : entry;
    if (Array.isArray(entry)) return entry.map(safe);
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(Object.entries(entry).filter(([key]) => !/^(?:apiKey|api_key|accessToken|refreshToken|authorization|cookie|password|encryptedSecret|secret|credentialEpoch)$/iu.test(key)).map(([key, item]) => [key, safe(item)]));
  };
  return safe(value) as ModelDescriptor;
}

/** Only acknowledges committed cursors; an untrusted client cannot acknowledge future work. */
export function acknowledgeCatalogPipelineCursors(current: unknown, requested: unknown, available: Readonly<Record<string, number>>): Record<string, number> {
  const saved = object(current), input = object(requested), next: Record<string, number> = {};
  for (const [key, maximum] of Object.entries(available)) {
    const old = Math.min(cursor(saved[key]), maximum), wanted = cursor(input[key]);
    next[key] = wanted > old && wanted <= maximum ? wanted : old;
  }
  return next;
}

/** Pure projection of committed facts only. No readers, HTTP, saveConnection, or migration writes. */
export function buildCatalogPipelineDiagnostics(snapshots: readonly PipelineSnapshot[], connections: readonly ProviderConnectionRecord[], acknowledged: unknown = {}): CatalogPipelineDiagnostics {
  const result: CatalogPipelineDiagnostics = { diagnostics: [], candidates: [], historyDescriptors: [], contracts: [], noticeCursors: {}, acknowledgedCursors: {} };
  const known = new Set(connections.map(row => row.id)), ack = object(acknowledged);
  for (const { ownerId, state } of snapshots) {
    const scheduler = state.entries["scheduler:v1"] as unknown as CatalogSchedulerState | undefined;
    const specs = new Map<string, CatalogReadItemSpec>();
    for (const [key, value] of Object.entries(state.entries)) {
      if (key.startsWith("task:")) { const spec = (value as unknown as CatalogReadTask).spec; if (spec?.sourceKey) specs.set(spec.sourceKey, spec); }
      else if (key.startsWith("fact:")) { const spec = (value as unknown as CatalogReadObservation).receipt?.spec; if (spec?.sourceKey) specs.set(spec.sourceKey, spec); }
      else if (key.startsWith("diagnostics:") || key.startsWith("changes:")) {
        const connectionId = key.slice(key.indexOf(":") + 1), number = cursor(value.cursor);
        if (known.has(connectionId) && number) {
          const id = catalogPipelineCursorKey(ownerId, key);
          result.noticeCursors[id] = number; result.acknowledgedCursors[id] = Math.min(cursor(ack[id]), number);
        }
      }
    }
    for (const job of Object.values(scheduler?.jobs ?? {})) specs.set(job.sourceKey, job.spec);
    for (const spec of specs.values()) {
      const targets = spec.applyScope.connectionIds.filter(id => known.has(id));
      if (!targets.length) continue;
      const observation = state.entries[`fact:${spec.sourceKey}`] as unknown as CatalogReadObservation | undefined;
      const receipt = observation?.receipt;
      const latest = Object.values(scheduler?.jobs ?? {}).filter(job => job.sourceKey === spec.sourceKey).sort((a, b) => b.order - a.order)[0];
      const source = scheduler?.sources[spec.sourceKey];
      let status: CatalogSourceDiagnostic["status"] = !receipt ? "unread" : receipt.status === "succeeded" ? receipt.complete ? "succeeded" : "partial" : receipt.status;
      if (latest && (!receipt || Math.max(latest.queuedAt, latest.attemptConsumedAt ?? 0) > Date.parse(receipt.checkedAt))) {
        if (latest.status === "running") status = "running";
        else if (latest.status === "unknown") status = "unknown";
        else if (latest.status === "queued" || latest.status === "deferred") status = "deferred";
        else if (!receipt && latest.status === "completed" && latest.resultRef) status = "succeeded";
        else if (!receipt && latest.status === "failed") status = "failed";
      }
      const checkedAt = instant(receipt?.checkedAt) ?? (latest?.completedAt !== undefined ? at(latest.completedAt) : undefined);
      result.diagnostics.push({ sourceKey: spec.sourceKey, supplierId: ownerId, connectionIds: targets,
        entryId: spec.entryId, role: spec.role, identity: spec.authScope.kind,
        ...(spec.applyScope.groupIdentity ? { groupIdentity: spec.applyScope.groupIdentity } : {}),
        ...(catalogDiagnosticSourceUrl(spec.sourceUrl) ? { sourceUrl: catalogDiagnosticSourceUrl(spec.sourceUrl) } : {}), status,
        ...(receipt?.reason ?? latest?.reason ? { reason: receipt?.reason ?? latest?.reason } : {}),
        ...(checkedAt ? { checkedAt } : {}), complete: status === "succeeded" && (receipt?.complete === true || !receipt && !!latest?.resultRef),
        ...(observation ? { modelCount: observation.facts.models.length } : {}), requiredForMembership: spec.requiredForMembership,
        paused: source?.paused === true, nextCheckAt: source?.paused ? null : at(latest && ["queued", "deferred"].includes(latest.status) ? latest.nextAttemptEligibleAt : source?.nextEligibleAt) });
    }
    for (const [key, value] of Object.entries(state.entries)) {
      if (key.startsWith("contracts:") && known.has(key.slice(10))) {
        const contracts = value as unknown as CatalogContractState;
        for (const slot of Object.values(contracts.slots)) result.contracts!.push({ connectionId: key.slice(10), modelId: slot.identity.modelId,
          operation: slot.identity.operation, status: slot.blocked ? "pending" : slot.accepted?.owner && slot.accepted.owner !== "automatic" ? "protected" : "accepted",
          ...(slot.reason ? { reason: slot.reason } : {}), checkedAt: slot.checkedAt,
          ...(catalogDiagnosticSourceUrl(slot.identity.submit) ? { sourceUrl: catalogDiagnosticSourceUrl(slot.identity.submit) } : {}) });
      }
      if (!key.startsWith("membership:")) continue;
      const inventory = value as unknown as CatalogInventoryState;
      if (!known.has(inventory.connectionId)) continue;
      for (const source of Object.values(inventory.sources)) {
        const candidate = source.candidate;
        if (!candidate || source.lastOutcome !== "candidate" || source.lastIdentityEpoch !== state.identityEpoch || inventory.identityEpoch !== state.identityEpoch) continue;
        const laterUnsettled = (state.sources[source.sourceKey]?.lastDispatchedSeq ?? 0) > source.lastDispatchSeq &&
          Object.values(scheduler?.jobs ?? {}).some(job => job.sourceKey === source.sourceKey && job.attemptConsumedAt !== undefined && ["running", "unknown"].includes(job.status));
        if (laterUnsettled) continue;
        const baseline = source.baseline?.modelIds ?? [];
        result.candidates.push({ connectionId: inventory.connectionId, sourceKey: source.sourceKey, candidateVersion: candidate.version,
          baselineCount: baseline.length, candidateCount: candidate.modelIds.length,
          missingCount: baseline.filter(id => !candidate.modelIds.includes(id)).length,
          countedCycles: candidate.countedCycles.length, requiredCycles: 3, checkedAt: candidate.checkedAt });
      }
      for (const model of inventory.historicalModels) result.historyDescriptors.push({ connectionId: inventory.connectionId,
        modelId: model.modelId, descriptor: safeDescriptor(model.descriptor), unavailableAt: model.unavailableAt, sourceKeys: [...model.sourceKeys] });
    }
  }
  result.diagnostics.sort((a, b) => a.supplierId.localeCompare(b.supplierId) || a.role.localeCompare(b.role) || a.entryId.localeCompare(b.entryId));
  return result;
}

export interface ReadCatalogPipelineStatusOptions {
  revision: string;
  now: number;
  phase?: CatalogUpgradeStatus["phase"];
  summary?: boolean;
}
/** Local status hydration is deliberately separate from service.run(). */
export async function readCatalogPipelineStatus(repository: Repository, options: ReadCatalogPipelineStatusOptions): Promise<CatalogUpgradeStatus> {
  const [suppliers, allConnections, setting, acknowledged] = await Promise.all([repository.listSuppliers(), repository.listConnections(),
    repository.getApplicationSetting(CATALOG_MODE_SETTING), repository.getApplicationSetting(CATALOG_PIPELINE_NOTICE_CURSORS)]);
  const mode: CatalogCheckMode = catalogMode(setting), supplierMap = new Map(suppliers.map(row => [row.id, row]));
  const connections = allConnections.filter(row => supportedCatalogConnection(row) && row.config.supplierArchived !== true &&
    (typeof row.config.supplierId !== "string" || supplierMap.has(row.config.supplierId) && supplierMap.get(row.config.supplierId)?.state?.visibility !== "deleted" &&
      (!supplierMap.get(row.config.supplierId)?.state || supplierMap.get(row.config.supplierId)?.state?.sourceId === row.config.supplierSourceId)));
  const ownerIds = [...new Set(connections.map(row => typeof row.config.supplierId === "string" ? row.config.supplierId : `connection:${row.id}`))];
  const snapshots: PipelineSnapshot[] = [];
  for (const ownerId of ownerIds) {
    // Polling must not clone descriptors, compiled source documents or tariff
    // history. The scheduler contains enough committed state for due/pause and
    // in-flight status; the expanded settings view requests its fact details.
    const value = await repository.getCatalogPipelineState(ownerId, ["scheduler:v1"], options.summary
      ? ["task:", "diagnostics:", "changes:"]
      : ["task:", "diagnostics:", "changes:", "membership:", "contracts:", "fact:"]);
    if (value?.schemaVersion === 1 && value.supplierId === ownerId && object(value.entries) === value.entries) snapshots.push({ ownerId, state: value });
  }
  const pipeline = buildCatalogPipelineDiagnostics(snapshots, connections, acknowledged);
  const byOwner = new Map(snapshots.map(row => [row.ownerId, row.state]));
  if (mode === "upgrade") for (const source of pipeline.diagnostics) {
    const scheduler = byOwner.get(source.supplierId)?.entries["scheduler:v1"] as unknown as CatalogSchedulerState | undefined;
    const unfinished = Object.values(scheduler?.jobs ?? {}).some(job => job.sourceKey === source.sourceKey && job.attemptConsumedAt === undefined && ["queued", "deferred"].includes(job.status));
    if (!unfinished && scheduler?.sources[source.sourceKey]?.lastAttemptRevision === options.revision) source.nextCheckAt = null;
  }
  const diagnostics = new Map<string, CatalogPipelineConnectionDiagnostic>();
  const changes: CatalogChangeRecord[] = [], changedIds = new Set<string>(), priceSuppliers = new Set<string>();
  for (const connection of connections) {
    const ownerId = typeof connection.config.supplierId === "string" ? connection.config.supplierId : `connection:${connection.id}`;
    const state = byOwner.get(ownerId), diagnostic = state?.entries[`diagnostics:${connection.id}`] as unknown as CatalogPipelineConnectionDiagnostic | undefined;
    if (diagnostic?.schemaVersion === 1) diagnostics.set(connection.id, diagnostic);
    const entryKey = `changes:${connection.id}`, entry = state?.entries[entryKey] as unknown as CatalogPipelineChanges | undefined;
    const legacyRecords = Array.isArray(connection.config.catalogCheckHistory) ? connection.config.catalogCheckHistory as unknown as CatalogChangeRecord[] : [];
    const freshRecords = (entry?.schemaVersion === 1 && Array.isArray(entry.records) ? entry.records : []).filter(record => record && typeof record.id === "string" && instant(record.checkedAt) &&
      Date.parse(record.checkedAt) >= options.now - CATALOG_HISTORY_RETENTION_MS && Array.isArray(record.changes));
    const records = [...new Map([...legacyRecords, ...freshRecords].filter(record => record && typeof record.id === "string" && instant(record.checkedAt) &&
      Date.parse(record.checkedAt) >= options.now - CATALOG_HISTORY_RETENTION_MS && Array.isArray(record.changes)).map(record => [record.id, record])).values()];
    changes.push(...records);
    const key = catalogPipelineCursorKey(ownerId, entryKey);
    if (entry && cursor(entry.cursor) > (pipeline.acknowledgedCursors[key] ?? 0) && freshRecords.length) {
      changedIds.add(connection.id);
      if (freshRecords.some(record => record.changes.some(change => change.kind === "price"))) priceSuppliers.add(ownerId);
    }
  }
  const connectionStatus: CatalogConnectionStatus[] = connections.map(connection => {
    const diagnostic = diagnostics.get(connection.id), sources = pipeline.diagnostics.filter(row => row.connectionIds.includes(connection.id));
    const schedulerPaused = sources.length > 0 && sources.filter(row => row.requiredForMembership).length > 0 && sources.filter(row => row.requiredForMembership).every(row => row.paused);
    const nextTimes = sources.filter(row => !row.paused).map(row => row.nextCheckAt).filter((value): value is string => Boolean(value));
    const supplier = supplierMap.get(String(connection.config.supplierId)), legacyNext = nextCatalogCheckAt(connection, mode, options.now);
    const nextCheckAt = mode === "off" || schedulerPaused ? null : sources.length ? nextTimes.sort()[0] ?? null : at(legacyNext ?? undefined);
    return { connectionId: connection.id, name: connection.name, ...(supplier ? { supplierId: supplier.id, supplierName: supplier.name } : {}),
      manualRequired: diagnostic?.manualRequired ?? connection.config.catalogCheckManualRequired === true, paused: schedulerPaused || connection.config.catalogCheckPaused === true,
      ...(diagnostic?.reason ? { pauseReason: diagnostic.reason } : typeof connection.config.catalogCheckFailureReason === "string" ? { pauseReason: connection.config.catalogCheckFailureReason as CatalogFailureReason } : {}),
      ...(diagnostic?.checkedAt ? { lastAttemptAt: diagnostic.checkedAt } : typeof connection.config.catalogCheckAttemptedAt === "string" ? { lastAttemptAt: connection.config.catalogCheckAttemptedAt } : {}),
      retainedPriceModelCount: diagnostic?.retainedPriceModelCount ?? 0, nextCheckAt };
  });
  const pendingCursors = Object.entries(pipeline.noticeCursors).filter(([key, value]) => value > (pipeline.acknowledgedCursors[key] ?? 0)).sort(([a], [b]) => a.localeCompare(b));
  const running = pipeline.diagnostics.some(row => row.status === "running");
  return { revision: options.revision, mode, phase: options.phase ?? (running ? "running" : snapshots.length ? "complete" : "idle"), total: connections.length,
    refreshed: [...diagnostics.values()].filter(row => row.outcome === "complete" || row.outcome === "partial").length,
    unavailable: 0, failed: [...diagnostics.values()].filter(row => row.outcome === "failed").length,
    updatedConnectionIds: [...diagnostics.keys()], manualConnectionIds: connectionStatus.filter(row => row.manualRequired).map(row => row.connectionId),
    retainedPriceModelCount: connectionStatus.reduce((sum, row) => sum + (row.retainedPriceModelCount ?? 0), 0),
    changedConnectionIds: [...changedIds], priceChangedSupplierIds: [...priceSuppliers],
    nextCheckAt: connectionStatus.map(row => row.nextCheckAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    connections: connectionStatus, history: options.summary ? [] : changes.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)),
    noticeId: pendingCursors.length ? createHash("sha256").update(JSON.stringify(pendingCursors)).digest("hex") : null,
    pipeline: options.summary ? { ...pipeline, diagnostics: [], candidates: [], historyDescriptors: [], contracts: [] } : pipeline };
}

export const catalogPipelineCursorSetting = (value: Record<string, number>): JsonObject => value;
