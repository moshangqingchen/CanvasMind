/** Only the latest successful platform catalog can establish a supplier group. */
export function isScannedSupplierGroup(group?: {
  source?: string;
  status?: string;
}): boolean {
  return group?.source === "catalog" && group.status !== "missing";
}
