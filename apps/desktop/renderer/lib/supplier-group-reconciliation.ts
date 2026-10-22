import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";

type Group = SupplierRecord["catalog"]["groups"][number];

/** A fresh official stable ID can rename an existing group without reading or
 * replacing its Key. Names, ambiguous rows and historical records cannot. */
export function reconcileSupplierGroupNames(supplier: SupplierRecord, connections: ProviderConnectionRecord[],
  incoming: readonly Group[], initialConnections: readonly ProviderConnectionRecord[] = connections): ProviderConnectionRecord[] {
  const fresh = incoming.filter(group => group.supplierGroupId !== undefined && group.source !== "manual" &&
    group.status !== "missing" && group.details?.stale !== true);
  return connections.map(connection => {
    const config = connection.config;
    if (!connection.encryptedSecret || config.usage === "disabled" || config.supplierArchived === true ||
        config.supplierId !== supplier.id || config.supplierSourceId !== supplier.state?.sourceId ||
        config.accountKeyGroupId === undefined) return connection;
    const initial = initialConnections.find(item => item.id === connection.id);
    if (!initial || initial.encryptedSecret !== connection.encryptedSecret || initial.provider !== connection.provider ||
        ["supplierId", "supplierSourceId", "accountKeyId", "accountKeyGroupId", "accountKeyGroup", "modelGroup", "usage"].some(key =>
          initial.config[key] !== config[key])) return connection;
    const candidates = fresh.filter(group => group.supplierGroupId === String(config.accountKeyGroupId));
    if (candidates.length !== 1 || config.accountKeyGroup !== undefined && config.modelGroup !== undefined &&
        config.accountKeyGroup !== config.modelGroup) return connection;
    const name = candidates[0]!.id;
    if (config.accountKeyGroup === name && config.modelGroup === name) return connection;
    return { ...connection, config: { ...config, accountKeyGroup: name, modelGroup: name } };
  });
}
