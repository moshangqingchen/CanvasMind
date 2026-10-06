import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "./client-api";
import type { ConnectionModelSnapshot } from "./connection-model-snapshot";

/** Keep a confirmed selection's badge during a refresh, never authorize execution. */
export function retainedImageModelForDisplay(
  connection: ProviderConnectionView | undefined,
  modelId: string | undefined,
  snapshot: ConnectionModelSnapshot,
): ModelDescriptor | null {
  if (!connection || !modelId || snapshot.connectionId !== connection.id ||
      !(snapshot.loading || snapshot.failed) ||
      !["live", "failed"].includes(String(connection.config.modelScanStatus))) return null;
  const saved = connection.config.modelCatalogModels;
  if (!Array.isArray(saved)) return null;
  return (saved as ModelDescriptor[]).find(model => model?.id === modelId) ?? null;
}
