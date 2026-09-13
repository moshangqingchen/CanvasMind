import type { DirectorCatalogCandidate } from "@super-canvas/director";
import { loadDirectorCatalog } from "./director-catalog";
import { manualProviderModelDescriptors } from "./manual-provider-models";
import { repository } from "./server";

export async function loadAgentCatalog(): Promise<DirectorCatalogCandidate[]> {
  const [catalog, connections] = await Promise.all([
    loadDirectorCatalog(),
    repository.listConnections(),
  ]);
  const result: DirectorCatalogCandidate[] = [];
  for (const c of connections) {
    if (
      c.config.usage === "agent" ||
      c.config.supplierArchived === true || c.config.usage === "disabled" ||
      !c.encryptedSecret
    )
      continue;
    const status = c.config.modelScanStatus;
    if (status === "unauthorized" || status === "empty") continue;
    const scanned = Array.isArray(c.config.scannedModelIds)
      ? c.config.scannedModelIds
      : undefined;
    const candidates = catalog.filter((m) => m.connectionId === c.id);
    for (const m of manualProviderModelDescriptors(c))
      if (!candidates.some((v) => v.model.id === m.id))
        candidates.push({
          connectionId: c.id,
          connectionName: c.name,
          provider: c.provider,
          supplier: String(
            c.config.supplierId ?? c.config.supplierKey ?? c.provider,
          ),
          group: String(c.config.modelGroup ?? ""),
          model: m,
          authoritative: true,
        });
    for (const m of candidates) {
      if (status === "live" && scanned && !scanned.includes(m.model.id))
        continue;
      if (m.model.metadata?.canvasRunnable === false) continue;
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
