import type { ProviderConnectionRecord } from "@super-canvas/db";
import { cangyuanImageConnectionConfig, CANGYUAN_AZURE_IMAGE_GROUP } from "./provider-presets";
import { matchesSupplierTemplate } from "./supplier-template-source";

const azureModels = new Set(["gpt-image-2-az", "gpt-image-2.5-flare-az", "gpt-image-2.5-sunburst-az"]);

/** Repair only the automatically imported native group that previously missed its preset. */
export function reconcileCangyuanNativeGroupConnection(connection: ProviderConnectionRecord): ProviderConnectionRecord {
  const c = connection.config;
  if (connection.provider !== "openai" || c.supplierKey !== "cangyuan" || !matchesSupplierTemplate(connection) ||
      !c.supplierId || !c.supplierSourceId || !c.accountKeyId || !c.accountKeyImportedAt || !connection.encryptedSecret ||
      c.accountKeyGroup !== CANGYUAN_AZURE_IMAGE_GROUP || c.modelGroup !== CANGYUAN_AZURE_IMAGE_GROUP ||
      !["live", "failed"].includes(String(c.modelScanStatus)) || !Array.isArray(c.scannedModelIds) ||
      !c.scannedModelIds.length || !c.scannedModelIds.every(id => typeof id === "string" && azureModels.has(id)) ||
      c.supplierArchived === true || c.usage !== "canvas" || c.manualProtocol === true || c.autoProtocol === false ||
      c.connector !== undefined || c.preset !== undefined || c.protocol !== undefined || c.modelInterfaces !== undefined ||
      Array.isArray(c.manualModels) && c.manualModels.length > 0) return connection;
  const config: ProviderConnectionRecord["config"] = { ...c, ...cangyuanImageConnectionConfig(CANGYUAN_AZURE_IMAGE_GROUP),
    baseUrl: c.baseUrl, ...(typeof c.defaultModel === "string" && c.defaultModel ? { defaultModel: c.defaultModel } : {}),
    customGroup: false } as unknown as ProviderConnectionRecord["config"];
  // Generic auto-discovery on the old OpenAI adapter must not override the
  // exact native JSON submit/poll contract. Explicit manual interfaces above
  // remain untouched; other discovered models retain their own bindings.
  if (c.autoModelInterfaces && typeof c.autoModelInterfaces === "object" && !Array.isArray(c.autoModelInterfaces))
    config.autoModelInterfaces = Object.fromEntries(Object.entries(c.autoModelInterfaces).filter(([id]) => !azureModels.has(id)));
  return { ...connection, provider: "rest", config: config as ProviderConnectionRecord["config"] };
}
