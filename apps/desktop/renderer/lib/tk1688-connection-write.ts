import { isTk1688ApiUrl } from "@super-canvas/providers/tk1688-model-policy";

/** These inventories belong to the server. Reposting hundreds of merchant
 * descriptors would exceed the settings payload bound; the save route retains
 * them for an unchanged connection and invalidates them when its Key changes.
 */
export function tk1688ConnectionWriteConfig(id: string | undefined, config: Record<string, unknown>) {
  if (!id || !config.supplierId || !isTk1688ApiUrl(String(config.baseUrl ?? ""))) return config;
  const result = { ...config };
  for (const field of ["modelCatalogModels", "modelScanGroups", "autoModelInterfaces", "unknownModels", "unavailableModels", "modelProtocolTemplate"])
    delete result[field];
  return result;
}
