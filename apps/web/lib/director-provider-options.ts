import type { ModelDescriptor } from "@super-canvas/providers";

import type {
  CangyuanMarketplaceGroupView,
  ProviderConnectionView,
} from "./client-api";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionUsage,
} from "./provider-connection-options";

export type DirectorMarketplaceGroups = Readonly<
  Record<string, readonly CangyuanMarketplaceGroupView[]>
>;

export interface DirectorModelInventory {
  readonly models: readonly ModelDescriptor[];
  /** A catalog or allow-list defines the exact models belonging to the group. */
  readonly scoped: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function configuredStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim()] : [],
  );
}

function configuredDescriptors(value: unknown): ModelDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    if (!id) return [];
    return [
      {
        ...(record as unknown as ModelDescriptor),
        id,
        name:
          typeof record?.name === "string" && record.name.trim()
            ? record.name.trim()
            : id,
        operations: Array.isArray(record?.operations)
          ? (record.operations as ModelDescriptor["operations"])
          : [],
      },
    ];
  });
}

function mergeModelDescriptors(
  groups: readonly (readonly ModelDescriptor[])[],
): ModelDescriptor[] {
  const order: string[] = [];
  const byId = new Map<string, ModelDescriptor>();
  for (const group of groups) {
    for (const model of group) {
      const id = model.id.trim();
      if (!id) continue;
      if (!byId.has(id)) order.push(id);
      const previous = byId.get(id);
      byId.set(id, {
        ...(previous ?? {}),
        ...model,
        id,
        name: model.name?.trim() || previous?.name || id,
        operations: model.operations ?? previous?.operations ?? [],
      });
    }
  }
  return order.flatMap((id) => {
    const model = byId.get(id);
    return model ? [model] : [];
  });
}

function idDescriptors(ids: readonly string[]): ModelDescriptor[] {
  return ids.map((id) => ({ id, name: id, operations: [] }));
}

function marketplaceModels(
  connection: ProviderConnectionView,
  groups: DirectorMarketplaceGroups,
): ModelDescriptor[] {
  const supplier = providerConnectionSupplierKey(connection);
  const groupId = providerConnectionGroup(connection);
  const group = groups[supplier]?.find((item) => item.id === groupId);
  return (group?.models ?? [])
    .filter((model) => model.capability === "chat")
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description,
      operations: [],
      provider: "openai",
      // Marketplace chat entries only prove text support. Vision/audio/video
      // inputs are added only when the provider model descriptor declares them.
      inputKinds: ["text"],
      outputKinds: ["text"],
      isDefault: model.id === connection.config.defaultModel,
    }));
}

export function directorBrainConnections(
  connections: readonly ProviderConnectionView[],
): ProviderConnectionView[] {
  return connections
    .map((connection, index) => ({ connection, index }))
    .filter(({ connection }) => {
      if (providerConnectionUsage(connection) === "disabled") return false;
      if (!connection.apiKeySet) return false;
      const identity =
        `${connection.name} ${connection.provider} ${providerConnectionSupplierKey(connection)}`.toLowerCase();
      return !identity.includes("tavily") && connection.provider !== "fake";
    })
    .sort((left, right) => {
      const score = (connection: ProviderConnectionView) =>
        (providerConnectionUsage(connection) === "agent" ? 4 : 0) +
        (connection.apiKeyUsable ? 2 : 0);
      return (
        score(right.connection) - score(left.connection) ||
        left.index - right.index
      );
    })
    .map(({ connection }) => connection);
}

export function directorConfiguredModelInventory(
  connection: ProviderConnectionView | undefined,
  groups: DirectorMarketplaceGroups = {},
): DirectorModelInventory {
  if (!connection) return { models: [], scoped: false };
  const marketplace = marketplaceModels(connection, groups);
  const allowed = configuredStrings(connection.config.allowedModels);
  const connector = asRecord(connection.config.connector);
  const descriptors = [
    ...configuredDescriptors(connection.config.modelCatalogModels),
    ...configuredDescriptors(connection.config.models),
    ...configuredDescriptors(connector?.models),
  ];
  const configuredIds = [
    ...allowed,
    ...configuredStrings(connection.config.scannedModelIds),
  ];
  const defaultModel =
    typeof connection.config.defaultModel === "string" &&
    connection.config.defaultModel.trim()
      ? [connection.config.defaultModel.trim()]
      : [];
  return {
    models: mergeModelDescriptors([
      marketplace,
      descriptors,
      idDescriptors(configuredIds),
      idDescriptors(defaultModel),
    ]),
    scoped: marketplace.length > 0 || allowed.length > 0,
  };
}

export function mergeDirectorModelInventory(
  configured: DirectorModelInventory,
  fetched: readonly ModelDescriptor[],
): ModelDescriptor[] {
  if (!configured.scoped)
    return mergeModelDescriptors([configured.models, fetched]);
  const configuredIds = new Set(configured.models.map((model) => model.id));
  return mergeModelDescriptors([
    configured.models,
    fetched.filter((model) => configuredIds.has(model.id)),
  ]);
}

/** Keep a saved model visible while a provider's live model directory is unavailable. */
export function ensureDirectorModel(
  inventory: DirectorModelInventory,
  preferred?: string,
): DirectorModelInventory {
  const id = preferred?.trim();
  if (!id || inventory.models.some((model) => model.id === id)) return inventory;
  return {
    ...inventory,
    models: [...inventory.models, { id, name: id, operations: [] }],
  };
}

export function directorModelSupportsText(model: ModelDescriptor): boolean {
  if (model.outputKinds?.includes("text")) return true;
  if (model.outputKinds && model.outputKinds.length > 0) return false;
  if (
    model.operations.some(
      (operation) =>
        operation.startsWith("image.") || operation.startsWith("video."),
    )
  )
    return false;
  return model.operations.length === 0;
}

export function preferredDirectorModelId(
  models: readonly ModelDescriptor[],
  preferred?: string,
): string {
  if (
    preferred &&
    models.some(
      (model) => model.id === preferred && directorModelSupportsText(model),
    )
  )
    return preferred;
  return models.find(directorModelSupportsText)?.id ?? "";
}

export function findProviderGroupConnection(
  connections: readonly ProviderConnectionView[],
  supplier: string,
  group: string,
  preferredUsage?: "canvas" | "agent" | "disabled",
): ProviderConnectionView | undefined {
  const matches = connections.filter(
    (connection) =>
      providerConnectionSupplierKey(connection) === supplier &&
      providerConnectionGroup(connection) === group,
  );
  return [...matches].sort((left, right) => {
    const score = (connection: ProviderConnectionView) =>
      (connection.apiKeyUsable ? 8 : 0) +
      (connection.apiKeySet ? 4 : 0) +
      (preferredUsage && providerConnectionUsage(connection) === preferredUsage
        ? 2
        : 0) +
      (providerConnectionUsage(connection) === "agent" ? 1 : 0);
    return score(right) - score(left);
  })[0];
}
