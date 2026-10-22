import { createHash } from "node:crypto";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { normalizeSupplierSiteBase, normalizeSupplierUrl } from "@super-canvas/providers";
import { supplierKeyForConnection } from "./supplier-identity";

type ConnectionIdentity = Pick<ProviderConnectionRecord, "provider" | "config">;
const siteAddress = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return "";
  try { return typeof value === "string" ? normalizeSupplierSiteBase(normalizeSupplierUrl(value)) : undefined; }
  catch { return undefined; }
};

export function legacySupplierId(connection: ConnectionIdentity): string {
  const identity = `${supplierKeyForConnection(connection)}|${siteAddress(connection.config.baseUrl) ?? ""}`;
  return `supplier-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function oldBrandedSupplierId(connection: ConnectionIdentity): string {
  return `supplier-${createHash("sha256").update(supplierKeyForConnection(connection)).digest("hex").slice(0, 24)}`;
}

/** Legacy Keys belong only to their exact projected identity, never every account on a site. */
export function supplierOwnsStoredConnection(supplier: SupplierRecord, connection: ConnectionIdentity): boolean {
  if (connection.config.supplierId) return connection.config.supplierId === supplier.id;
  // Empty API addresses retain the provider's explicit default identity. The
  // marketing website is not an API address and cannot replace that identity.
  const address = siteAddress(supplier.apiUrl);
  return address !== undefined && supplier.supplierKey === supplierKeyForConnection(connection) &&
    address === siteAddress(connection.config.baseUrl) &&
    (supplier.id === legacySupplierId(connection) || supplier.id === oldBrandedSupplierId(connection));
}
