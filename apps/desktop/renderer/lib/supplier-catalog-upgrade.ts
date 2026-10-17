import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { catalogScopeReadsComplete } from "./catalog-scope-cache";
import { setTimeout as yieldBackground } from "node:timers/promises";
import { MemoryRepository, type Repository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { CatalogChangeRecord, CatalogCheckMode, CatalogConnectionStatus, CatalogFailureReason, CatalogUpgradeStatus } from "./supplier-catalog-contracts";
import { CATALOG_CHECK_INTERVAL_MS, CATALOG_HISTORY_RETENTION_MS, CATALOG_MODE_SETTING, catalogChanges,
  catalogMode, classifyCatalogFailure, clearCatalogManualMarker } from "./supplier-catalog-policy";
import { mergeCatalogSnapshotPrices } from "./supplier-catalog-price-merge";
export type { CatalogUpgradeStatus } from "./supplier-catalog-contracts";

export const SUPPLIER_CATALOG_REVISION = "2026-10-10-jijiu-native-tier-parameters-v12";
const PREVIOUS_REVISION = "2026-10-09-full-supplier-recheck-contracts-prices-v11";
const HOSTS = new Set(["ai.cangyuansuanli.cn", "tu.988236.xyz", "api.frimodel.com", "api.mikoto.vip", "api.miaowuai.store",
  "vapi.chuangxiangai.asia", "api.tk1688.com", "tk1688.com", "ai.tk1688.com", "pool.chaozhiyuanai.com", "asian-acc.we-token.cc",
  "us-la.we-token.cc", "sub2api.we-token.cc", "video.we-token.cc", "api.3365api.cn", "api.eaheng.com", "token.secure-skill.com",
  "genimage.pro", "api.hangzhale.com", "synoralink.com", "ai.whyshy.cn", "newapi.jijiucanvas.com", "ai.jiasuapi.com"]);
interface Dependencies {
  repository: Repository;
  refreshCatalog: (connection: ProviderConnectionRecord, supplier: SupplierRecord | undefined, staging: MemoryRepository, refreshId: string) => Promise<{ complete: boolean; status?: number; code?: string }>;
  now?: () => number;
  trackWrite?: (work: () => Promise<void>) => Promise<void>;
  canContinue?: () => boolean;
  /** Emergency rollback may consult newer source eligibility without rewriting
   * connections. Absence preserves the original legacy policy exactly. */
  eligibility?: (row: ProviderConnectionRecord, mode: CatalogCheckMode, now: number) => Promise<CatalogUpgradeEligibility | undefined>;
}
export interface CatalogUpgradeEligibility {
  nextCheckAt: number | null;
  paused?: boolean;
  manualRequired?: boolean;
  pauseReason?: CatalogFailureReason;
  lastAttemptAt?: string;
}
function fingerprint(row: ProviderConnectionRecord): string {
  return createHash("sha256").update(JSON.stringify([row.provider, row.encryptedSecret, row.config.baseUrl, row.config.modelGroup,
    row.config.accountKeyGroup, row.config.accountKeyGroupId, row.config.usage, row.config.supplierId, row.config.supplierSourceId])).digest("hex");
}
function supplierIdentity(row: ProviderConnectionRecord, supplier?: SupplierRecord): string {
  if (supplier) return supplier.id;
  return `legacy:${String(row.config.supplierKey ?? "")}:${new URL(String(row.config.baseUrl)).origin}`;
}
function currentSource(row: ProviderConnectionRecord, suppliers: Map<string, SupplierRecord>): boolean {
  if (typeof row.config.supplierId !== "string") return true;
  const supplier = suppliers.get(row.config.supplierId);
  return Boolean(supplier && supplier.state?.visibility !== "deleted" && (!supplier.state || row.config.supplierSourceId === supplier.state.sourceId));
}
export function supportedCatalogConnection(row: ProviderConnectionRecord): boolean {
  if (!row.encryptedSecret || ["cli", "fake"].includes(row.provider) || row.config.usage === "disabled" || row.config.supplierArchived === true) return false;
  try { const url = new URL(String(row.config.baseUrl ?? "")); return url.protocol === "https:" && !url.username && !url.password && HOSTS.has(url.host); }
  catch { return false; }
}
function revisionAttempted(row: ProviderConnectionRecord): boolean {
  const revision = row.config.catalogCheckAttemptRevision ?? row.config.catalogUpgradeAttemptRevision ?? row.config.catalogUpgradeRevision;
  if (revision === SUPPLIER_CATALOG_REVISION) return true;
  try { return revision === PREVIOUS_REVISION && new URL(String(row.config.baseUrl)).host !== "newapi.jijiucanvas.com"; }
  catch { return false; }
}
function lastAttempt(row: ProviderConnectionRecord): string | undefined {
  const value = row.config.catalogCheckAttemptedAt ?? row.config.catalogUpgradeAttemptedAt;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}
export function nextCatalogCheckAt(row: ProviderConnectionRecord, mode: CatalogCheckMode, now: number): number | null {
  if (mode === "off" || row.config.catalogCheckPaused === true) return null;
  if (mode === "upgrade") return revisionAttempted(row) ? null : now;
  const last = lastAttempt(row);
  return last ? Date.parse(last) + CATALOG_CHECK_INTERVAL_MS : now;
}
function historyOf(row: ProviderConnectionRecord, now: number): CatalogChangeRecord[] {
  return (Array.isArray(row.config.catalogCheckHistory) ? row.config.catalogCheckHistory : [])
    .filter((entry): entry is CatalogChangeRecord => Boolean(entry && typeof entry === "object" && typeof entry.id === "string" &&
      typeof entry.checkedAt === "string" && Array.isArray(entry.changes) && Date.parse(entry.checkedAt) >= now - CATALOG_HISTORY_RETENTION_MS));
}

export class SupplierCatalogUpgrade {
  private pending?: Promise<void>;
  private manualStateChanged = false;
  private state: CatalogUpgradeStatus = { revision: SUPPLIER_CATALOG_REVISION, mode: "daily", phase: "idle", total: 0,
    refreshed: 0, unavailable: 0, failed: 0, retainedPriceModelCount: 0, updatedConnectionIds: [], manualConnectionIds: [], changedConnectionIds: [],
    priceChangedSupplierIds: [], nextCheckAt: null, connections: [], history: [], noticeId: null };
  constructor(private readonly dependencies: Dependencies) {}
  private now(): number { return (this.dependencies.now ?? Date.now)(); }
  private async eligibility(row: ProviderConnectionRecord, mode: CatalogCheckMode, now: number): Promise<CatalogUpgradeEligibility> {
    return await this.dependencies.eligibility?.(row, mode, now) ?? { nextCheckAt: nextCatalogCheckAt(row, mode, now) };
  }
  async setMode(mode: CatalogCheckMode): Promise<void> { await this.dependencies.repository.setApplicationSetting(CATALOG_MODE_SETTING, mode); }
  /** Status and settings hydration never dispatch upstream requests. */
  async status(summary = false): Promise<CatalogUpgradeStatus> {
    const { repository } = this.dependencies, now = this.now();
    const mode = catalogMode(await repository.getApplicationSetting(CATALOG_MODE_SETTING));
    const suppliers = new Map((await repository.listSuppliers()).map(row => [row.id, row]));
    const rows = (await repository.listConnections()).filter(row => supportedCatalogConnection(row) && currentSource(row, suppliers));
    const connections: CatalogConnectionStatus[] = await Promise.all(rows.map(async row => {
      const eligibility = await this.eligibility(row, mode, now), next = mode === "off" ? null : eligibility.nextCheckAt,
        supplier = suppliers.get(String(row.config.supplierId ?? ""));
      return { connectionId: row.id, name: row.name, ...(supplier ? { supplierId: supplier.id, supplierName: supplier.name } : {}),
        manualRequired: eligibility.manualRequired ?? (row.config.catalogCheckManualRequired === true || mode === "off" && !revisionAttempted(row)),
        paused: eligibility.paused ?? row.config.catalogCheckPaused === true,
        ...(eligibility.pauseReason ? { pauseReason: eligibility.pauseReason } : typeof row.config.catalogCheckFailureReason === "string" ? { pauseReason: row.config.catalogCheckFailureReason as CatalogFailureReason } : {}),
        ...(eligibility.lastAttemptAt ?? lastAttempt(row) ? { lastAttemptAt: eligibility.lastAttemptAt ?? lastAttempt(row) } : {}),
        ...(Number.isInteger(row.config.catalogCheckRetainedPriceModelCount) && Number(row.config.catalogCheckRetainedPriceModelCount) > 0
          ? { retainedPriceModelCount: Number(row.config.catalogCheckRetainedPriceModelCount) } : {}),
        nextCheckAt: next === null ? null : new Date(Math.max(now, next)).toISOString() };
    }));
    const upcoming = connections.map(row => row.nextCheckAt).filter((at): at is string => Boolean(at)).sort();
    const history = summary ? [] : rows.flatMap(row => historyOf(row, now)).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
    return structuredClone({ ...this.state, mode, connections, history,
      manualConnectionIds: connections.filter(row => row.manualRequired).map(row => row.connectionId), nextCheckAt: upcoming[0] ?? null });
  }
  start(): void {
    if (this.pending) return;
    this.manualStateChanged = false;
    this.state = { ...this.state, phase: "running", total: 0, refreshed: 0, unavailable: 0, failed: 0, retainedPriceModelCount: 0,
      updatedConnectionIds: [], changedConnectionIds: [], priceChangedSupplierIds: [], noticeId: null };
    const work = () => this.run();
    this.pending = (this.dependencies.trackWrite ? this.dependencies.trackWrite(work) : work())
      .catch(() => { this.state.failed++; })
      .finally(() => { this.state.phase = "complete"; this.pending = undefined; });
  }
  async settle(): Promise<void> { await this.pending; }
  private async failure(row: ProviderConnectionRecord, reason: CatalogFailureReason): Promise<void> {
    const { repository } = this.dependencies, latest = await repository.getConnection(row.id);
    // A foreground refresh/save that won the race is authoritative, including
    // its cleared manual marker. Do not relabel that newer successful record.
    if (!latest || !isDeepStrictEqual(latest, row)) return;
    const terminal = ["authentication", "balance", "unsupported"].includes(reason);
    const streak = terminal ? Number(latest.config.catalogCheckFailureStreak ?? 0) + 1 : 0;
    const changed = latest.config.catalogCheckManualRequired !== true || latest.config.catalogCheckPaused !== (terminal && streak >= 3) || latest.config.catalogCheckFailureReason !== reason;
    await repository.saveConnection({ ...latest, config: { ...latest.config, catalogCheckLastResult: "failed",
      catalogCheckFailureStreak: streak, catalogCheckPaused: terminal && streak >= 3,
      catalogCheckManualRequired: true, catalogCheckFailureReason: reason } }, { expected: latest });
    if (changed) this.manualStateChanged = true;
    this.state.updatedConnectionIds.push(row.id);
    if (terminal) this.state.unavailable++; else this.state.failed++;
  }
  private async run(): Promise<void> {
    const { repository } = this.dependencies;
    const mode = catalogMode(await repository.getApplicationSetting(CATALOG_MODE_SETTING));
    if (mode === "off") return;
    const suppliers = new Map((await repository.listSuppliers()).map(row => [row.id, row]));
    const allConnections = await repository.listConnections();
    const candidates = allConnections.filter(row => supportedCatalogConnection(row) && currentSource(row, suppliers));
    const scheduled = await Promise.all(candidates.map(async row => ({ row, eligibility: await this.eligibility(row, mode, this.now()) })));
    const due = scheduled.filter(({ eligibility }) => eligibility.nextCheckAt !== null && eligibility.nextCheckAt <= this.now()).map(({ row }) => row);
    this.state.total = due.length;
    const refreshId = `catalog-check-${randomUUID()}`;
    for (const candidate of due) {
      if (this.dependencies.canContinue?.() === false || catalogMode(await repository.getApplicationSetting(CATALOG_MODE_SETTING)) === "off") break;
      const original = await repository.getConnection(candidate.id);
      if (!original || fingerprint(original) !== fingerprint(candidate)) continue;
      const currentMode = catalogMode(await repository.getApplicationSetting(CATALOG_MODE_SETTING));
      if (currentMode === "off") break;
      const next = (await this.eligibility(original, currentMode, this.now())).nextCheckAt;
      if (next === null || next > this.now()) continue;
      const attemptedAt = new Date(this.now()).toISOString();
      // Reserve before dispatch: even an interrupted process cannot repeat this
      // cycle. Key/config edits do not create another upgrade attempt.
      const reserved = await repository.saveConnection({ ...original, config: { ...original.config,
        catalogCheckAttemptRevision: SUPPLIER_CATALOG_REVISION, catalogCheckAttemptedAt: attemptedAt, catalogCheckLastResult: "running" } }, { expected: original });
      const supplier = typeof reserved.config.supplierId === "string" ? await repository.getSupplier(reserved.config.supplierId) ?? undefined : undefined;
      if (!isDeepStrictEqual(await repository.getConnection(reserved.id), reserved) ||
        !currentSource(reserved, new Map(supplier ? [[supplier.id, supplier]] : []))) continue;
      // Read only this supplier's records, not every model cache on every Key.
      // A newly added sibling is still detected by commitCatalogSnapshot CAS.
      const affectedBefore = supplier ? (await Promise.all(allConnections.filter(row => row.config.supplierId === supplier.id)
        .map(row => repository.getConnection(row.id)))).filter((row): row is ProviderConnectionRecord => row !== null) : [reserved];
      if (!isDeepStrictEqual(affectedBefore.find(row => row.id === reserved.id), reserved)) continue;
      const staging = new MemoryRepository({ version: 2, suppliers: supplier ? [supplier] : [], connections: affectedBefore,
        canvases: [], revisions: [], assets: [], directorProfiles: [], directorSessions: [], directorMessages: [], directorProposals: [], runs: [], nodeRuns: [], webhookKeys: [] });
      if (catalogMode(await repository.getApplicationSetting(CATALOG_MODE_SETTING)) === "off") break;
      try {
        const result = await this.dependencies.refreshCatalog(reserved, supplier, staging, refreshId);
        if (this.dependencies.canContinue?.() === false || catalogMode(await repository.getApplicationSetting(CATALOG_MODE_SETTING)) === "off") break;
        let staged = await staging.getConnection(reserved.id), stagedSupplier = supplier ? await staging.getSupplier(supplier.id) ?? undefined : undefined;
        if (!result.complete || !staged || supplier && (!stagedSupplier || stagedSupplier.scanComplete !== true || !["live", "empty"].includes(stagedSupplier.scanStatus))) {
          await this.failure(reserved, classifyCatalogFailure(result.status, result.code)); continue;
        }
        if (!Array.isArray(staged.config.modelCatalogModels) || !await catalogScopeReadsComplete(staging)) { await this.failure(reserved, "incomplete"); continue; }
        const stagedRows = await staging.listConnections();
        if (stagedRows.length !== affectedBefore.length || stagedRows.some(row => {
          const expected = affectedBefore.find(before => before.id === row.id);
          return !expected || fingerprint(row) !== fingerprint(expected);
        })) { await this.failure(reserved, "conflict"); continue; }
        const merged = mergeCatalogSnapshotPrices(reserved, staged, supplier, stagedSupplier, attemptedAt);
        staged = merged.connection; stagedSupplier = merged.supplier;
        const changes = catalogChanges(reserved, staged, supplier, stagedSupplier);
        const record: CatalogChangeRecord | undefined = changes.length ? { id: randomUUID(), checkedAt: attemptedAt, connectionId: reserved.id,
          connectionName: reserved.name, ...(supplier ? { supplierId: supplier.id, supplierName: supplier.name } : {}), changes } : undefined;
        const config: ProviderConnectionRecord["config"] = { ...clearCatalogManualMarker(staged.config), catalogCheckLastResult: "success", catalogUpgradeRevision: SUPPLIER_CATALOG_REVISION,
          catalogCheckRetainedPriceModelCount: merged.retainedPriceModelCount,
          catalogCheckHistory: [...historyOf(reserved, this.now()), ...(record ? [record] : [])] };
        if (Object.hasOwn(reserved.config, "defaultModel")) config.defaultModel = reserved.config.defaultModel;
        else delete config.defaultModel;
        // A catalog-only scanner may initialize account/key-sync state in its
        // staging area. Publish directory/scan facts, never those side effects.
        const publishSupplier = supplier && stagedSupplier ? { ...supplier, catalog: stagedSupplier.catalog,
          scanStatus: stagedSupplier.scanStatus, scanComplete: stagedSupplier.scanComplete, scannedAt: stagedSupplier.scannedAt,
          scanLastSuccessAt: stagedSupplier.scanLastSuccessAt, scanError: stagedSupplier.scanError, scanErrorCode: stagedSupplier.scanErrorCode,
          scanRetryable: stagedSupplier.scanRetryable, updatedAt: stagedSupplier.updatedAt,
          ...(supplier.state ? { state: { ...supplier.state, revision: supplier.state.revision + 1 } } : {}) } : undefined;
        const commitMode = await repository.getApplicationSetting(CATALOG_MODE_SETTING);
        if (catalogMode(commitMode) === "off") break;
        await repository.commitCatalogSnapshot({ expectedApplicationSettings: { [CATALOG_MODE_SETTING]: commitMode },
          ...(supplier ? { expectedSupplier: supplier, supplier: publishSupplier } : {}),
          expectedConnections: affectedBefore, connections: [{ ...staged, config }] });
        this.state.refreshed++; this.state.retainedPriceModelCount = (this.state.retainedPriceModelCount ?? 0) + merged.retainedPriceModelCount;
        this.state.updatedConnectionIds.push(reserved.id);
        if (reserved.config.catalogCheckManualRequired === true || reserved.config.catalogCheckPaused === true) this.manualStateChanged = true;
        if (record) {
          this.state.changedConnectionIds.push(reserved.id);
          const supplierId = supplierIdentity(reserved, supplier);
          if (record.changes.some(change => change.kind === "price") && !this.state.priceChangedSupplierIds.includes(supplierId))
            this.state.priceChangedSupplierIds.push(supplierId);
        }
      } catch (error) {
        if (catalogMode(await repository.getApplicationSetting(CATALOG_MODE_SETTING)) === "off") break;
        await this.failure(reserved, error instanceof Error && /改变|冲突|conflict/iu.test(error.message) ? "conflict" : classifyCatalogFailure(undefined, error instanceof Error ? error.name : "network"));
      }
      await yieldBackground(0);
    }
    if (this.state.changedConnectionIds.length || this.manualStateChanged || this.state.retainedPriceModelCount)
      this.state.noticeId = `${SUPPLIER_CATALOG_REVISION}:${this.now()}:${randomUUID()}`;
  }
}
