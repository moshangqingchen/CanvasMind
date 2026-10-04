import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "./client-api";
import type { SupplierCatalogGroup } from "./client-suppliers";
import { providerConnectionGroup } from "./provider-connection-options";
import { tk1688ModelFamily, tk1688ModelSearchText, type Tk1688DisplayModel } from "./tk1688-model-display";

export type ModelKind = "image" | "video" | "chat";

export function descriptorKinds(model: Pick<ModelDescriptor, "operations" | "metadata">): ModelKind[] {
  const kinds = new Set<ModelKind>();
  for (const operation of model.operations ?? []) {
    if (operation.startsWith("image.")) kinds.add("image");
    if (operation.startsWith("video.")) kinds.add("video");
    if (operation.startsWith("chat.") || operation.startsWith("text.")) kinds.add("chat");
  }
  if (!kinds.size && model.metadata?.tk1688Catalog === true && model.metadata.protocol === "chat-completions") kinds.add("chat");
  return [...kinds];
}

export function matchesModelText(model: Tk1688DisplayModel, query: string): boolean {
  const terms = query.normalize("NFKC").trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const text = tk1688ModelFamily(model) ? tk1688ModelSearchText(model)
    : `${model.id} ${model.name ?? ""}`.normalize("NFKC").toLocaleLowerCase();
  return terms.every(term => text.includes(term));
}

export function groupNameMatches(group: Pick<SupplierCatalogGroup, "id" | "label">, query: string): boolean {
  return matchesModelText({ id: group.id, name: group.label }, query);
}

/** Search the public directory and every saved connection in this exact group. */
export function supplierGroupMatchesQuery(group: SupplierCatalogGroup, connections: readonly ProviderConnectionView[], query: string): boolean {
  if (groupNameMatches(group, query) || group.models.some(model => matchesModelText(model, query))) return true;
  return connections.some(connection => {
    if (providerConnectionGroup(connection) !== group.id && connection.config.accountKeyGroup !== group.id) return false;
    for (const field of ["modelCatalogModels", "manualModels", "modelRemovedModels", "scannedModelIds"]) {
      const values = connection.config[field];
      if (!Array.isArray(values)) continue;
      if (values.some(value => typeof value === "string" ? matchesModelText({ id: value }, query)
        : value && typeof value.id === "string" && matchesModelText(value, query))) return true;
    }
    return false;
  });
}
