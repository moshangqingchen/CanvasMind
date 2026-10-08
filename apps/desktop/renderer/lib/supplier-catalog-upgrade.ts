import { createHash } from "node:crypto";
import type { MemoryRepository, ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";

export const SUPPLIER_CATALOG_REVISION = "2026-10-08-complete-catalog-pricing-v2";
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPGRADED_HOSTS = new Set([
  "ai.cangyuansuanli.cn", "tu.988236.xyz", "api.frimodel.com", "api.mikoto.vip",
  "api.miaowuai.store", "vapi.chuangxiangai.asia", "api.tk1688.com", "tk1688.com", "ai.tk1688.com",
  "pool.chaozhiyuanai.com", "asian-acc.we-token.cc", "video.we-token.cc", "api.3365api.cn",
  "api.eaheng.com", "token.secure-skill.com", "genimage.pro", "api.hangzhale.com", "synoralink.com", "ai.whyshy.cn",
]);
type Repository = Pick<MemoryRepository, "listConnections" | "listSuppliers" | "getConnection" | "saveConnection">;
export interface CatalogUpgradeStatus {
  revision: string;
  phase: "idle" | "running" | "complete";
  total: number;
  refreshed: number;
  unavailable: number;
  failed: number;
  updatedConnectionIds: string[];
}
interface Dependencies {
  repository: Repository;
  readModels: (request: Request, context: { params: Promise<{ id: string }>; supplierRefreshId: string }) => Promise<Response>;
  refreshSupplierCatalog?: (supplier: SupplierRecord) => Promise<boolean>;
  now?: () => number;
  trackWrite?: (work: () => Promise<void>) => Promise<void>;
  canContinue?: () => boolean;
}

function identity(connection: ProviderConnectionRecord): string {
  return createHash("sha256").update(JSON.stringify([
    connection.provider, connection.config.baseUrl, connection.config.modelGroup,
    connection.config.accountKeyGroup, connection.config.usage,
    connection.config.supplierId, connection.config.supplierSourceId, connection.encryptedSecret,
  ])).digest("hex");
}
function currentSupplierSource(connection: ProviderConnectionRecord, suppliers: ReadonlyMap<string, SupplierRecord>): boolean {
  const supplierId = connection.config.supplierId;
  if (typeof supplierId !== "string") return true;
  const supplier = suppliers.get(supplierId);
  return Boolean(supplier && supplier.state?.visibility !== "deleted" &&
    (!supplier.state || connection.config.supplierSourceId === supplier.state.sourceId));
}
function supported(connection: ProviderConnectionRecord): boolean {
  if (!connection.encryptedSecret || connection.provider === "cli" || connection.provider === "fake" ||
    connection.config.usage === "disabled" || connection.config.supplierArchived === true) return false;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    return url.protocol === "https:" && !url.username && !url.password && UPGRADED_HOSTS.has(url.host);
  } catch { return false; }
}

/** One read-only upstream catalog migration per connection identity. It never
 * creates Keys, edits canvases, or schedules capability/generation probes. */
export class SupplierCatalogUpgrade {
  private pending?: Promise<void>;
  private state: CatalogUpgradeStatus = { revision: SUPPLIER_CATALOG_REVISION, phase: "idle",
    total: 0, refreshed: 0, unavailable: 0, failed: 0, updatedConnectionIds: [] };
  constructor(private readonly dependencies: Dependencies) {}
  status(): CatalogUpgradeStatus { return { ...this.state, updatedConnectionIds: [...this.state.updatedConnectionIds] }; }
  start(): void {
    if (this.pending) return;
    this.state = { revision: SUPPLIER_CATALOG_REVISION, phase: "running", total: 0,
      refreshed: 0, unavailable: 0, failed: 0, updatedConnectionIds: [] };
    const work = () => this.run();
    this.pending = (this.dependencies.trackWrite ? this.dependencies.trackWrite(work) : work())
      .catch(() => { this.state.failed++; })
      .finally(() => { this.state.phase = "complete"; this.pending = undefined; });
  }
  async settle(): Promise<void> { await this.pending; }
  private async run(): Promise<void> {
    const { repository } = this.dependencies;
    const now = (this.dependencies.now ?? Date.now)();
    const suppliers = new Map((await repository.listSuppliers()).map(supplier => [supplier.id, supplier]));
    const connections = (await repository.listConnections()).filter(connection => {
      if (!supported(connection)) return false;
      if (!currentSupplierSource(connection, suppliers)) return false;
      const fingerprint = identity(connection);
      if (connection.config.catalogUpgradeRevision === SUPPLIER_CATALOG_REVISION &&
        connection.config.catalogUpgradeIdentity === fingerprint) return false;
      const attempted = Date.parse(String(connection.config.catalogUpgradeAttemptedAt ?? ""));
      return connection.config.catalogUpgradeAttemptRevision !== SUPPLIER_CATALOG_REVISION ||
        connection.config.catalogUpgradeIdentity !== fingerprint || !Number.isFinite(attempted) || now - attempted >= RETRY_INTERVAL_MS;
    });
    this.state.total = connections.length;
    // Connections from the same supplier share pricing/document refresh caches.
    const refreshId = `catalog-upgrade-${SUPPLIER_CATALOG_REVISION}-${now}`;
    const catalogReads = new Map<string, Promise<boolean>>();
    const ensureCatalog = (supplier: SupplierRecord | undefined): Promise<boolean> => {
      if (!supplier || !this.dependencies.refreshSupplierCatalog) return Promise.resolve(true);
      const key = `${supplier.id}:${supplier.state?.sourceId ?? "legacy"}`;
      let read = catalogReads.get(key);
      if (!read) {
        read = Promise.resolve().then(() => this.dependencies.refreshSupplierCatalog!(supplier)).catch(() => false);
        catalogReads.set(key, read);
      }
      return read;
    };
    let index = 0;
    const worker = async () => {
      while (index < connections.length) {
        if (this.dependencies.canContinue?.() === false) return;
        const connection = connections[index++]!;
        const fingerprint = identity(connection);
        const current = await repository.getConnection(connection.id);
        if (!current || !supported(current) || identity(current) !== fingerprint) continue;
        const currentSources = new Map((await repository.listSuppliers()).map(supplier => [supplier.id, supplier]));
        if (!currentSupplierSource(current, currentSources)) continue;
        if (this.dependencies.canContinue?.() === false) return;
        // Persist public/account group prices before connection refreshes so
        // subsequent cached picker reads see the same directory revision.
        const catalogComplete = await ensureCatalog(currentSources.get(String(current.config.supplierId ?? "")));
        if (this.dependencies.canContinue?.() === false) return;
        const afterCatalog = await repository.getConnection(connection.id);
        const afterCatalogSources = new Map((await repository.listSuppliers()).map(supplier => [supplier.id, supplier]));
        if (!afterCatalog || !supported(afterCatalog) || identity(afterCatalog) !== fingerprint ||
          !currentSupplierSource(afterCatalog, afterCatalogSources)) continue;
        let complete = false;
        try {
          const response = await this.dependencies.readModels(new Request(
            `http://localhost/api/providers/${encodeURIComponent(connection.id)}/models?refresh=1`,
          ), { params: Promise.resolve({ id: connection.id }), supplierRefreshId: refreshId });
          const scanStatus = response.headers.get("X-Model-Scan-Status");
          complete = catalogComplete && response.ok && response.headers.get("X-Model-Scan-Complete") === "true" &&
            (scanStatus === "live" || scanStatus === "empty");
          if (complete) this.state.refreshed++;
          else if (response.status === 401 || response.status === 403 || scanStatus === "unauthorized") this.state.unavailable++;
          else this.state.failed++;
        } catch { this.state.failed++; }
        const latest = await repository.getConnection(connection.id);
        // A concurrent Key/source edit invalidates both results and retry bookkeeping.
        if (!latest || !supported(latest) || identity(latest) !== fingerprint) continue;
        const latestSources = new Map((await repository.listSuppliers()).map(supplier => [supplier.id, supplier]));
        if (!currentSupplierSource(latest, latestSources)) continue;
        try {
          const config: ProviderConnectionRecord["config"] = { ...latest.config,
            catalogUpgradeIdentity: fingerprint,
            catalogUpgradeAttemptRevision: SUPPLIER_CATALOG_REVISION,
            catalogUpgradeAttemptedAt: new Date((this.dependencies.now ?? Date.now)()).toISOString(),
          };
          if (complete) config.catalogUpgradeRevision = SUPPLIER_CATALOG_REVISION;
          else delete config.catalogUpgradeRevision;
          await repository.saveConnection({ ...latest, config }, { expected: latest });
          this.state.updatedConnectionIds.push(connection.id);
        } catch { /* Newer settings are authoritative; a later launch retries. */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, connections.length) }, worker));
  }
}
