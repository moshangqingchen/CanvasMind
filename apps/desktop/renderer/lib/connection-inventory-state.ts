import type { JsonObject, ProviderConnectionRecord } from "@super-canvas/db";

// Inventory observations belong to one account, credential, group and protocol.
// A settings save may retain server evidence, but cannot supply new evidence.
const inventoryFields = [
  "modelScanStatus", "modelScanAttemptStatus", "modelScanComplete",
  "modelScanCheckedAt", "modelScanLastSuccessAt", "modelScanError",
  "modelScanErrorCode", "modelScanUpstreamErrorCode", "modelScanHttpStatus",
  "modelScanRequestId", "scannedModelIds", "modelScanGroups", "modelCatalogModels",
  "modelCatalogSource", "weAiLivePricing", "modelProtocolTemplate", "autoModelInterfaces",
  "unknownModels", "unavailableModels", "catalogCheckedAt", "catalogSource",
  "modelAddedIds", "modelRemovedModels", "emptyScanConfirmations", "emptyScanScope",
] as const;

const identityFields = [
  "supplierId", "supplierSourceId", "baseUrl", "modelGroup", "accountKeyGroup",
  "accountKeyGroupId", "accountKeyId", "protocol", "directorProtocol", "usage",
  "preset", "customGroup",
] as const;

export function resetConnectionInventory(config: JsonObject): JsonObject {
  const next = { ...config };
  for (const field of inventoryFields) delete next[field];
  return { ...next, modelScanStatus: "unscanned", modelScanComplete: false, modelCatalogSource: "unverified" };
}

export function reconcileConnectionInventory(
  config: JsonObject,
  existing: ProviderConnectionRecord | null,
  provider: string,
  credentialsChanged: boolean,
): { config: JsonObject; identityChanged: boolean } {
  const identityChanged = credentialsChanged || !existing || existing.provider !== provider ||
    identityFields.some(field => config[field] !== existing.config[field]);
  if (identityChanged) return { config: resetConnectionInventory(config), identityChanged };
  const next = { ...config };
  for (const field of inventoryFields) {
    if (existing.config[field] !== undefined) next[field] = existing.config[field];
    else delete next[field];
  }
  return { config: next, identityChanged };
}
