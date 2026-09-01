import type { DirectorCatalogCandidate } from "@super-canvas/director";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { repository, runService } from "./server";
import { loadCangyuanCatalog } from "./cangyuan-catalog";
import { scanCyberAfeiConnection } from "./cyberafei-server";
import { scanChentuConnection } from "./chentu-server";
import { scanMiaowuConnection } from "./miaowu-server";
import { scanMikotoConnection } from "./mikoto-server";
import { scanFriModelConnection } from "./frimodel-server";
import { CHENTU_PRESET_ID } from "./chentu-presets";
import { MIAOWU_PRESET_ID } from "./miaowu-presets";
import { FRIMODEL_PRESET_ID, friModelMarketplaceGroup } from "./frimodel-presets";
import { MIKOTO_PRESET_ID, mikotoGroup } from "./mikoto-presets";
import {
  CANGYUAN_IMAGE_PRESET_ID,
  normalizeCangyuanImageGroup,
} from "./provider-presets";
import { CYBERAFEI_PRESET_ID } from "./cyberafei-catalog";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
} from "./provider-connection-options";
import {
  weAiCanvasModelDescriptorsFromSavedScan,
} from "./weai-catalog";

function descriptorsFromConnector(connection: ProviderConnectionRecord): ModelDescriptor[] {
  const connector = connection.config.connector;
  if (!connector || typeof connector !== "object" || Array.isArray(connector)) return [];
  const models = (connector as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const model = value as ModelDescriptor;
    return typeof model.id === "string" && Array.isArray(model.operations)
      ? [structuredClone(model)]
      : [];
  });
}

async function genericModels(connection: ProviderConnectionRecord): Promise<ModelDescriptor[]> {
  const adapter = runService.adapters().get(connection.provider);
  if (!adapter) return descriptorsFromConnector(connection);
  try {
    return await adapter.listModels(connection.id);
  } catch {
    return descriptorsFromConnector(connection);
  }
}

async function modelsForConnection(connection: ProviderConnectionRecord): Promise<{
  models: ModelDescriptor[];
  authoritative: boolean;
  checkedAt?: string;
}> {
  const preset = connection.config.preset;
  if (preset === CANGYUAN_IMAGE_PRESET_ID) {
    const catalog = await loadCangyuanCatalog();
    const group = normalizeCangyuanImageGroup(connection.config.modelGroup);
    return {
      models: group ? catalog.groups[group] : [],
      authoritative: catalog.source === "live",
      checkedAt: catalog.checkedAt,
    };
  }
  if (preset === CYBERAFEI_PRESET_ID) {
    const scan = await scanCyberAfeiConnection(connection.id, { persist: false });
    return {
      models: scan.canvasModels,
      authoritative: scan.status === "live" && scan.catalogSource === "live",
      checkedAt: scan.checkedAt,
    };
  }
  if (preset === CHENTU_PRESET_ID) {
    const scan = await scanChentuConnection(connection.id, { persist: false });
    return {
      models: scan.canvasModels,
      authoritative: scan.status === "live" && scan.catalogSource === "live",
      checkedAt: scan.checkedAt,
    };
  }
  if (preset === MIAOWU_PRESET_ID) {
    const scan = await scanMiaowuConnection(connection.id, { persist: false });
    const latest = scan.connection ?? connection;
    const allowed = new Set(scan.modelIds);
    return {
      models: descriptorsFromConnector(latest).filter((model) => allowed.has(model.id)),
      authoritative: scan.status === "live",
      checkedAt: scan.checkedAt,
    };
  }
  if (preset === MIKOTO_PRESET_ID) {
    const scan = await scanMikotoConnection(connection.id, { persist: false });
    const allowed = new Set(scan.modelIds);
    const models = mikotoGroup(connection.config.modelGroup)?.models ?? [];
    return {
      models: models.filter((model) => allowed.has(model.id)).map((model) => structuredClone(model)),
      authoritative: scan.status === "live",
      checkedAt: scan.checkedAt,
    };
  }
  if (preset === FRIMODEL_PRESET_ID) {
    const scan = await scanFriModelConnection(connection.id, { persist: false });
    const allowed = new Set(scan.modelIds);
    const models = friModelMarketplaceGroup(String(connection.config.modelGroup ?? ""))?.models ?? [];
    return {
      models: models
        .filter((model) => allowed.has(model.id))
        .map((model) => ({
          id: model.id,
          name: model.name,
          description: model.description,
          operations: model.capability === "image" ? ["image.generate", "image.edit"] : [],
          metadata: { priceLabel: model.priceLabel },
        } as ModelDescriptor)),
      authoritative: scan.status === "live",
      checkedAt: scan.checkedAt,
    };
  }
  if (connection.provider === "weai") {
    const models = weAiCanvasModelDescriptorsFromSavedScan(connection.config);
    return {
      models: models ?? [],
      authoritative: connection.config.modelScanStatus === "live",
      checkedAt:
        typeof connection.config.modelScanCheckedAt === "string"
          ? connection.config.modelScanCheckedAt
          : undefined,
    };
  }
  const models = await genericModels(connection);
  return {
    models,
    authoritative: connection.config.modelScanStatus === "live",
    checkedAt:
      typeof connection.config.modelScanCheckedAt === "string"
        ? connection.config.modelScanCheckedAt
        : undefined,
  };
}

export async function loadDirectorCatalog(): Promise<DirectorCatalogCandidate[]> {
  const connections = await repository.listConnections();
  const canvasConnections = connections.filter(
    (connection) =>
      connection.config.usage !== "agent" &&
      connection.config.usage !== "disabled" &&
      connection.provider !== "fake" &&
      Boolean(connection.encryptedSecret),
  );
  const results = await Promise.allSettled(
    canvasConnections.map(async (connection) => ({
      connection,
      result: await modelsForConnection(connection),
    })),
  );
  return results.flatMap((entry): DirectorCatalogCandidate[] => {
    if (entry.status !== "fulfilled") return [];
    const { connection, result } = entry.value;
    const browserView = {
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      config: connection.config,
      apiKeySet: true,
      apiKeyUsable: true,
      apiKey: "",
    };
    return result.models.flatMap((model) =>
      model.operations.length === 0
        ? []
        : [{
            connectionId: connection.id,
            connectionName: connection.name,
            provider: connection.provider,
            supplier: providerConnectionSupplierKey(browserView),
            group: providerConnectionGroup(browserView),
            model,
            ...(model.pricing ? { pricing: model.pricing } : {}),
            ...(result.checkedAt ? { catalogCheckedAt: result.checkedAt } : {}),
            authoritative: result.authoritative,
          }],
    );
  });
}
