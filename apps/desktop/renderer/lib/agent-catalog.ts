import type { DirectorCatalogCandidate } from "@super-canvas/director";
import { loadDirectorCatalog } from "./director-catalog";
import { repository } from "./server";

export async function loadAgentCatalog(signal?: AbortSignal): Promise<DirectorCatalogCandidate[]> {
  const [catalog, connections] = await Promise.all([
    loadDirectorCatalog(signal),
    repository.listConnections(),
  ]);
  const result: DirectorCatalogCandidate[] = [];
  for (const c of connections) {
    if (c.config.supplierArchived === true || c.config.usage === "disabled")
      continue;
    const status = c.config.modelScanStatus;
    if (status === "unauthorized" || status === "empty") continue;
    const scanned = Array.isArray(c.config.scannedModelIds)
      ? c.config.scannedModelIds
      : undefined;
    // Inventory already merges manual entries and checks supplier source
    // identity. Adding them here would bypass those checks.
    const candidates = catalog.filter((m) => m.connectionId === c.id);
    for (const m of candidates) {
      if (scanned && !scanned.includes(m.model.id))
        continue;
      if (!m.model.operations.length || m.model.metadata?.canvasRunnable === false) continue;
      result.push({
        ...m,
        model: {
          ...m.model,
          isDefault: m.model.isDefault || c.config.defaultModel === m.model.id,
        },
        connectionActive: true,
        credentialUsable: true,
      });
    }
  }
  return result;
}
