import type { CatalogUpgradeStatus } from "../../lib/supplier-catalog-contracts";

/** Complete saved status for UI fixtures that never refresh supplier data. */
export function idleCatalogCheckFixture(overrides: Partial<CatalogUpgradeStatus> = {}): CatalogUpgradeStatus {
  return {
    revision: "isolated-saved-catalog", mode: "off", phase: "complete", total: 0,
    refreshed: 0, unavailable: 0, failed: 0, updatedConnectionIds: [],
    manualConnectionIds: [], changedConnectionIds: [], priceChangedSupplierIds: [],
    nextCheckAt: null, connections: [], history: [], noticeId: null,
    ...overrides,
  };
}
