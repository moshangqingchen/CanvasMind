import type { ProviderConnectionView } from "./client-api";
import { CHENTU_PRESET_ID } from "./chentu-presets";
import { FRIMODEL_PRESET_ID } from "./frimodel-presets";

/** A read-only account label does not convert a manual connector into a scanned account. */
export function requiresAuthoritativeModelScan(
  connection: Pick<ProviderConnectionView, "provider" | "config" | "supplierIdentityProjected">,
  hasVerifiedWeAiModels = false,
): boolean {
  return connection.provider === "cli" ||
    Boolean(connection.config.supplierId && connection.supplierIdentityProjected !== true) ||
    hasVerifiedWeAiModels || connection.config.preset === "cyberafei-api" ||
    connection.config.preset === CHENTU_PRESET_ID || connection.config.preset === FRIMODEL_PRESET_ID;
}
