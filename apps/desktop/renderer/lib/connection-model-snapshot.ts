import type { ModelDescriptor } from "@super-canvas/providers";
import { modelDescriptorListsEqual } from "./model-parameters";

export interface ConnectionModelSnapshot {
  connectionId: string;
  items: ModelDescriptor[];
  authoritative?: boolean;
  loading?: boolean;
  failed?: boolean;
  displayItems?: ModelDescriptor[];
  scanStatus?: string;
  complete?: boolean;
}

/** Inventory provenance must update React even when the model rows are identical. */
export function settledConnectionModelScan(
  current: ConnectionModelSnapshot,
  connectionId: string,
  items: readonly ModelDescriptor[],
  authoritative: boolean,
  status: { scanStatus?: string; complete?: boolean } = {},
): ConnectionModelSnapshot {
  if (current.connectionId === connectionId &&
      Boolean(current.authoritative) === authoritative &&
      current.loading === false && !current.failed &&
      current.scanStatus === status.scanStatus && current.complete === status.complete &&
      modelDescriptorListsEqual(current.items, items)) return current;
  return { connectionId, items: [...items], authoritative, loading: false,
    scanStatus: status.scanStatus, complete: status.complete };
}

/** A cached model list and a successful complete Key inventory are separate facts. */
export function connectionModelInventoryConfirmed(snapshot: ConnectionModelSnapshot): boolean {
  return Boolean(snapshot.authoritative && !snapshot.loading && !snapshot.failed &&
    ["live", "empty"].includes(snapshot.scanStatus ?? "") && snapshot.complete !== false);
}

/** A pending scan may keep its UI schema without making stale models runnable. */
export function pendingConnectionModelScan(
  current: ConnectionModelSnapshot,
  connectionId: string,
): ConnectionModelSnapshot {
  return {
    connectionId,
    items: [],
    authoritative: true,
    loading: true,
    displayItems:
      current.connectionId === connectionId
        ? connectionModelItemsForDisplay(current)
        : [],
  };
}

/** Only the model/parameter editor uses the previous schema while refreshing. */
export function connectionModelItemsForDisplay(
  snapshot: ConnectionModelSnapshot,
): ModelDescriptor[] {
  return snapshot.loading
    ? snapshot.displayItems ?? snapshot.items
    : snapshot.items;
}
