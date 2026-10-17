import type { ProviderConnectionRecord, Repository } from "@super-canvas/db";
import { createCatalogPipelineWakeLoop } from "./catalog-pipeline-wake";
import { readCatalogPipelineStatus } from "./catalog-pipeline-diagnostics";
import { catalogMode, CATALOG_MODE_SETTING } from "./supplier-catalog-policy";
import { supportedCatalogConnection } from "./supplier-catalog-upgrade";
import type { CatalogPipelineRunOptions, CatalogPipelineRunResult } from "./catalog-pipeline-service";
import type { CatalogSchedulerClock } from "./catalog-scheduler-store";

/** Round-robin suppliers before entering the bounded backend worker pool. */
export function catalogAutomaticConnectionOrder(rows: readonly ProviderConnectionRecord[]): string[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) { const owner = String(row.config.supplierId ?? `connection:${row.id}`);
    const group = groups.get(owner) ?? []; group.push(row.id); groups.set(owner, group); }
  const ordered: string[] = [];
  while (groups.size) for (const [owner, group] of groups) { ordered.push(group.shift()!); if (!group.length) groups.delete(owner); }
  return ordered;
}

/** A facade owns only a timer and local status. It never scans on GET/hover. */
export function createCatalogAutomaticCheck(options: {
  repository: Repository;
  pipeline: { run(connectionId: string, options: CatalogPipelineRunOptions): Promise<CatalogPipelineRunResult>; close(): void };
  revision: string;
  clock: CatalogSchedulerClock;
  canContinue(): boolean;
  supported?: (row: ProviderConnectionRecord) => boolean;
}) {
  let closed = false, started = false;
  const loop = createCatalogPipelineWakeLoop({ clock: options.clock, canContinue: () => !closed && options.canContinue(),
    connectionIds: async () => {
      if (catalogMode(await options.repository.getApplicationSetting(CATALOG_MODE_SETTING)) === "off") return [];
      const suppliers = new Map((await options.repository.listSuppliers()).map(row => [row.id, row]));
      return catalogAutomaticConnectionOrder((await options.repository.listConnections()).filter(row =>
        (options.supported ?? supportedCatalogConnection)(row) && (typeof row.config.supplierId !== "string" ||
          suppliers.get(row.config.supplierId)?.state?.visibility !== "deleted" && suppliers.has(row.config.supplierId) &&
          (!suppliers.get(row.config.supplierId)?.state || suppliers.get(row.config.supplierId)?.state?.sourceId === row.config.supplierSourceId))));
    }, run: (connectionId, observationCycleId) => options.pipeline.run(connectionId, { observationCycleId, revision: options.revision }),
    close: () => options.pipeline.close() });
  return {
    start() { if (closed || !options.canContinue()) return; started = true; void loop.wake().catch(() => undefined); },
    status(summary = false) { return readCatalogPipelineStatus(options.repository, { revision: options.revision, now: options.clock.now(), summary,
      phase: loop.diagnostics().running ? "running" : started ? "complete" : "idle" }); },
    close() { if (!closed) { closed = true; loop.close(); } },
    settle: () => loop.wake(),
  };
}
