import type { ModelDescriptor } from "@super-canvas/providers";
import { getImageEditingCapabilities, type ImageEditingCapabilities, type ImageEditingConnection } from "@super-canvas/providers/image-editing-capabilities";
import { savedModelAvailabilityError } from "./model-availability";

/** Picker badges and editing controls share the current connection's capability boundary. */
export function modelImageCapabilities(
  connection: ImageEditingConnection | null | undefined,
  model: ModelDescriptor,
  parameters: Readonly<Record<string, unknown>> = {},
): ImageEditingCapabilities {
  const none: ImageEditingCapabilities = { transparent: false, mask: null };
  if (!connection || !model.id ||
      !model.operations.some(operation => operation === "image.generate" || operation === "image.edit") ||
      model.metadata?.canvasRunnable === false || model.metadata?.autoInterfaceStatus === "incomplete") return none;
  const config = connection.config;
  if (config.supplierArchived === true || ["agent", "disabled"].includes(String(config.usage)) ||
      (config.accountKeyGroup !== undefined && config.modelGroup !== undefined && config.accountKeyGroup !== config.modelGroup) ||
      savedModelAvailabilityError(config, model.id)) return none;
  const scannedIds = config.scannedModelIds;
  if (Array.isArray(scannedIds) && !scannedIds.includes(model.id)) return none;
  const saved = Array.isArray(config.modelCatalogModels)
    ? (config.modelCatalogModels as ModelDescriptor[]).find(candidate => candidate?.id === model.id) : undefined;
  if (saved?.metadata?.canvasRunnable === false || saved?.metadata?.autoInterfaceStatus === "incomplete") return none;
  // Pending descriptors provide controls while a Key scan runs. A retained
  // successful inventory still proves access if a later refresh has failed.
  if (model.metadata?.pendingLiveScan === true &&
      (!["live", "failed"].includes(String(config.modelScanStatus)) ||
       !(saved || Array.isArray(scannedIds) && scannedIds.includes(model.id)))) return none;
  const defaults = Object.fromEntries((model.parameters ?? [])
    .filter(parameter => parameter.default !== undefined)
    .map(parameter => [parameter.key, parameter.default]));
  const capabilities = getImageEditingCapabilities(connection, model.id, { ...defaults, ...parameters });
  return {
    transparent: capabilities.transparent,
    // General image.edit can mean reference-based generation. Only an exact
    // mask contract qualifies as brush-based local editing.
    mask: model.operations.includes("image.edit") && model.metadata?.supportsImageEdit !== false &&
      saved?.metadata?.supportsImageEdit !== false ? capabilities.mask : null,
  };
}
