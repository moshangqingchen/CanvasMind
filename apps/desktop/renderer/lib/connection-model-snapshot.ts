import type { ModelDescriptor } from "@super-canvas/providers";

export interface ConnectionModelSnapshot {
  connectionId: string;
  items: ModelDescriptor[];
  authoritative?: boolean;
  loading?: boolean;
  displayItems?: ModelDescriptor[];
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
