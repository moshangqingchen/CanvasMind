import type { DirectorCatalogCandidate } from "@super-canvas/director";
import type { ModelDescriptor } from "@super-canvas/providers";
import { repository } from "./server";
import { readProviderModelInventory } from "./provider-model-inventory";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
} from "./provider-connection-options";

/** Read the same inventory as the canvas; never submit a paid verification. */
export async function loadDirectorCatalog(signal?: AbortSignal): Promise<DirectorCatalogCandidate[]> {
  signal?.throwIfAborted();
  const connections = (await repository.listConnections()).filter(
    (connection) => connection.config.supplierArchived !== true && connection.config.usage !== "disabled" &&
      !["empty", "unauthorized"].includes(String(connection.config.modelScanStatus)) &&
      connection.provider !== "fake" && (connection.provider === "cli"
        ? (connection.config.cli as { enabled?: boolean } | undefined)?.enabled === true &&
          (connection.config.cliStatus as { state?: string } | undefined)?.state === "ready"
        : Boolean(connection.encryptedSecret)),
  );
  const results: DirectorCatalogCandidate[][] = new Array(connections.length);
  let cursor = 0;
  // Legacy inventories can still require a network read. Bound these reads so
  // opening a large catalog cannot burst every supplier connection at once.
  await Promise.all(Array.from({ length: Math.min(4, connections.length) }, async () => {
    while (cursor < connections.length) {
      signal?.throwIfAborted();
      const index = cursor++;
      const connection = connections[index]!;
      try {
        const response = await readProviderModelInventory(
          new Request(`http://localhost/api/providers/${encodeURIComponent(connection.id)}/models`, { signal }),
          { params: Promise.resolve({ id: connection.id }) },
        );
        signal?.throwIfAborted();
        if (!response.ok) { results[index] = []; continue; }
        const models = await response.json() as ModelDescriptor[];
        const status = response.headers.get("X-Model-Scan-Status") ?? String(connection.config.modelScanStatus ?? "");
        const checkedAt = response.headers.get("X-Model-Scan-Checked-At") ??
          (typeof connection.config.modelScanCheckedAt === "string" ? connection.config.modelScanCheckedAt : undefined);
        const browserView = { ...connection, apiKeySet: true, apiKeyUsable: true, apiKey: "" };
        results[index] = models.flatMap((model) =>
          !model.operations.length || model.metadata?.canvasRunnable === false || model.metadata?.cliMock === true ? [] : [{
            connectionId: connection.id,
            connectionName: connection.name,
            provider: connection.provider,
            supplier: providerConnectionSupplierKey(browserView),
            group: providerConnectionGroup(browserView),
            model,
            ...(model.pricing ? { pricing: model.pricing } : {}),
            ...(checkedAt ? { catalogCheckedAt: checkedAt } : {}),
            authoritative: status === "live",
          }],
        );
      } catch {
        signal?.throwIfAborted();
        // One unavailable supplier must not hide the remaining catalog.
        results[index] = [];
      }
    }
  }));
  return results.flat();
}
