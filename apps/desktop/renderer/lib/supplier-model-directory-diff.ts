import type { ModelDescriptor } from "@super-canvas/providers";
import { modelSupportsGenerationMedia } from "@super-canvas/providers/model-media";
import type { ProviderConnectionView } from "./client-api";
import { supplierOwnsConnection, type SupplierCatalogModel, type SupplierRecord } from "./client-suppliers";
import { providerConnectionGroup } from "./provider-connection-options";
import type { GenerationNodeType } from "./graph-ui";
import { displayPriceLabel } from "./model-display";

export const CATALOG_ONLY_MODEL_REASON = "官网已列出 · 当前 Key 未返回";
export const CATALOG_UNCONFIRMED_MODEL_REASON = "官网已列出 · Key 目录待确认";

export interface SupplierModelDirectoryDiff {
  catalogCount: number;
  keyCount: number;
  sharedCount: number;
  catalogOnlyIds: string[];
  keyOnlyIds: string[];
}
export function supplierModelDirectoryDiff(keyModels: readonly { id: string }[], catalogModels: readonly { id: string }[]): SupplierModelDirectoryDiff {
  const key = new Set(keyModels.map(model => model.id));
  const catalog = new Set(catalogModels.map(model => model.id));
  return { catalogCount: catalog.size, keyCount: key.size,
    sharedCount: [...catalog].filter(id => key.has(id)).length,
    catalogOnlyIds: [...catalog].filter(id => !key.has(id)), keyOnlyIds: [...key].filter(id => !catalog.has(id)) };
}

export interface CatalogPickerDirectory extends SupplierModelDirectoryDiff {
  models: ModelDescriptor[];
  keyConfirmed: boolean;
  catalogStale: boolean;
}

export function supplierCatalogDisplayPrice(model: SupplierCatalogModel): string {
  const old = model.metadata?.supplierCatalogModelStale === true;
  const label = displayPriceLabel(model.priceLabel, old ? "partial" : model.metadata?.priceStatus);
  return old && typeof model.priceLabel === "string" && model.priceLabel.trim() && model.priceLabel.trim() !== "价格未公布"
    ? `${label.replace(/（上次价格）$/u, "")}（上次价格）` : label;
}

function displayDescriptor(model: SupplierCatalogModel, keyConfirmed: boolean): ModelDescriptor {
  const metadata = model.metadata ?? {};
  const previousPrice = metadata.supplierCatalogModelStale === true;
  return { id: model.id, name: model.name || model.id, operations: [], parameters: [],
    inputKinds: model.inputKinds, outputKinds: model.outputKinds, limits: model.limits,
    pricing: (metadata.secureSkillCatalogPricing ?? metadata.chuangxiangCatalogPricing ?? metadata.tk1688Pricing) as ModelDescriptor["pricing"],
    metadata: { ...metadata, catalogCapability: model.capability,
      ...((model.priceLabel || previousPrice) ? { priceLabel: supplierCatalogDisplayPrice(model) } : {}),
      ...(previousPrice ? { priceStatus: "partial", priceCheckedAt: metadata.supplierCatalogPriceCheckedAt } : {}),
      canvasRunnable: false, canvasUnavailableReason: keyConfirmed ? CATALOG_ONLY_MODEL_REASON : CATALOG_UNCONFIRMED_MODEL_REASON,
      publicCatalogOnly: true, parameterControlsUnavailable: true, imageCapabilitiesVerifiedAt: undefined } };
}

/** A display sidecar only. Public rows never become runtime options or Key permissions. */
export function catalogPickerDirectory(connection: ProviderConnectionView | undefined, suppliers: readonly SupplierRecord[],
  keyModels: readonly ModelDescriptor[], nodeType: GenerationNodeType | null, keyConfirmed: boolean,
  catalogReadFailed = false): CatalogPickerDirectory | undefined {
  if (!connection || !nodeType || connection.provider === "fake" || connection.provider === "cli") return undefined;
  const supplier = suppliers.find(item => item.state?.visibility !== "deleted" && supplierOwnsConnection(item, connection));
  if (!supplier) return undefined;
  const groupId = providerConnectionGroup(connection);
  const group = supplier.catalog.groups.find(item => item.id === groupId) ??
    supplier.catalog.groups.find(item => item.id === connection.config.accountKeyGroup);
  if (!group || group.source === "manual" || group.status === "missing") return undefined;
  const kind = nodeType === "image-generation" ? "image" : nodeType === "video-generation" ? "video" : "music";
  const catalog = group.models.map(model => displayDescriptor(model, keyConfirmed)).filter(model => modelSupportsGenerationMedia(model, kind));
  const key = keyModels.filter(model => modelSupportsGenerationMedia(model, kind));
  const diff = supplierModelDirectoryDiff(key, catalog);
  const missing = new Set(diff.catalogOnlyIds);
  return { ...diff, models: catalog.filter(model => missing.has(model.id)), keyConfirmed,
    catalogStale: catalogReadFailed || !["live", "empty"].includes(supplier.scanStatus) || supplier.scanComplete === false ||
      group.details?.stale === true };
}
