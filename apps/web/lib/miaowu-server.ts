import {
  getRepository,
  type JsonObject,
  type ProviderConnectionRecord,
} from "@super-canvas/db";
import { decryptSecret, providerFetch } from "@super-canvas/providers";
import { requireServerMasterKey } from "./master-key";
import {
  clearEmptyScanConfirmation,
  pendingEmptyScanConfig,
  shouldConfirmEmptyScan,
} from "./model-scan-confirmation";
import {
  MIAOWU_BASE_URL,
  MIAOWU_PRESET_ID,
  miaowuConnectionConfig,
} from "./miaowu-presets";
import {
  loadMiaowuCatalog,
  miaowuConnectorForModels,
  miaowuDefaultModel,
  miaowuModelsForGroup,
  miaowuUnparameterizedVideoDescriptor,
  type MiaowuCatalogSnapshot,
} from "./miaowu-catalog";

export type MiaowuModelScanStatus =
  "live" | "empty" | "unauthorized" | "unconfigured" | "failed";

export interface MiaowuKeyScan {
  status: MiaowuModelScanStatus;
  checkedAt: string;
  modelIds: string[];
  error?: string;
}

export interface MiaowuConnectionScan extends MiaowuKeyScan {
  connection?: ProviderConnectionRecord | null;
}

function configuredModelIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function savedConnectorModelIds(
  connection: ProviderConnectionRecord,
): string[] {
  const connector = connection.config.connector;
  if (!connector || typeof connector !== "object" || Array.isArray(connector))
    return [];
  const models = (connector as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((model) => {
    if (!model || typeof model !== "object" || Array.isArray(model)) return [];
    const id = (model as Record<string, unknown>).id;
    return typeof id === "string" && id.trim() ? [id.trim()] : [];
  });
}

function miaowuScanFailure(
  status: Exclude<MiaowuModelScanStatus, "live" | "empty">,
  error: string,
): MiaowuKeyScan {
  return {
    status,
    checkedAt: new Date().toISOString(),
    modelIds: [],
    error,
  };
}

/**
 * Reads the models granted to one exact 喵呜 key via the free `/v1/models`
 * endpoint. The key's live list may include vip-only models missing from the
 * public pricing catalog; never falls back to an older inventory.
 */
export async function scanMiaowuKeyModels(
  apiKey: string,
  options?: { fetch?: typeof fetch; baseUrl?: string },
): Promise<MiaowuKeyScan> {
  const fetchImpl = options?.fetch ?? providerFetch;
  const base = (options?.baseUrl ?? MIAOWU_BASE_URL).replace(/\/+$/u, "");
  try {
    const response = await fetchImpl(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const checkedAt = new Date().toISOString();
    if (response.status === 401 || response.status === 403)
      return miaowuScanFailure(
        "unauthorized",
        "喵呜拒绝了当前 API Key（无权限或分组已停用）",
      );
    if (!response.ok)
      return miaowuScanFailure(
        "failed",
        `喵呜模型扫描失败（HTTP ${response.status}），将保留上次成功模型`,
      );
    const payload = (await response.json().catch(() => null)) as {
      data?: unknown;
    } | null;
    if (!payload || !Array.isArray(payload.data))
      return miaowuScanFailure(
        "failed",
        "喵呜模型扫描返回无法解析，将保留上次成功模型",
      );
    const modelIds = [
      ...new Set(
        payload.data.flatMap((item) => {
          const id =
            item && typeof item === "object" && "id" in item
              ? (item as { id?: unknown }).id
              : undefined;
          return typeof id === "string" && id.trim() ? [id.trim()] : [];
        }),
      ),
    ];
    return {
      status: modelIds.length > 0 ? "live" : "empty",
      checkedAt,
      modelIds,
    };
  } catch {
    return miaowuScanFailure(
      "failed",
      "喵呜模型扫描网络超时或不可达，将保留上次成功模型",
    );
  }
}

/**
 * Scans one saved 喵呜 connection and reconciles the connector's model list:
 * Public models the key cannot call are removed from the callable list (kept
 * in `unavailableModels` for display). Key-only ids remain video models, but
 * without invented parameter controls. Failed scans never overwrite the last
 * good connector.
 */
export async function scanMiaowuConnection(
  id: string,
  options?: {
    fetch?: typeof fetch;
    forcePricing?: boolean;
    persist?: boolean;
    retryOnConcurrentChange?: boolean;
  },
): Promise<MiaowuConnectionScan> {
  const repository = getRepository();
  const connection = await repository.getConnection(id);
  if (!connection || connection.config.preset !== MIAOWU_PRESET_ID)
    return { ...miaowuScanFailure("failed", "喵呜连接不存在"), connection };
  if (!connection.encryptedSecret)
    return {
      ...miaowuScanFailure(
        "unconfigured",
        "喵呜连接尚未保存 API Key，请先填写密钥",
      ),
      connection,
    };
  let apiKey: string;
  try {
    apiKey = decryptSecret(
      connection.encryptedSecret,
      requireServerMasterKey(),
    );
  } catch {
    return {
      ...miaowuScanFailure(
        "unconfigured",
        "已保存的喵呜 API Key 无法解密，请重新填写",
      ),
      connection,
    };
  }
  const [catalog, scan] = await Promise.all([
    loadMiaowuCatalog({
      force: options?.forcePricing,
      ...(options?.fetch ? { fetch: options.fetch } : {}),
    }),
    scanMiaowuKeyModels(apiKey, {
      ...(options?.fetch ? { fetch: options.fetch } : {}),
    }),
  ]);
  const baseResult: MiaowuConnectionScan = { ...scan, connection };
  if (
    (scan.status !== "live" && scan.status !== "empty") ||
    options?.persist === false
  )
    return baseResult;

  const scannedSet = new Set(scan.modelIds);
  const configuredGroup =
    typeof connection.config.modelGroup === "string"
      ? connection.config.modelGroup
      : undefined;
  const catalogModels = miaowuModelsForGroup(catalog, configuredGroup);
  const pricedIds = new Set(catalog.models.map((model) => model.id));
  const callable = [
    ...catalogModels.filter((model) => scannedSet.has(model.id)),
    ...scan.modelIds
      .filter((modelId) => !pricedIds.has(modelId))
      .map((modelId) =>
        miaowuUnparameterizedVideoDescriptor(modelId, {
          group: configuredGroup,
          parameterSource: "key-model-scan",
        }),
      ),
  ];
  const latest = await repository.getConnection(id);
  if (
    !latest ||
    latest.updatedAt !== connection.updatedAt ||
    latest.encryptedSecret !== connection.encryptedSecret
  ) {
    if (options?.retryOnConcurrentChange === false) return baseResult;
    return scanMiaowuConnection(id, {
      ...options,
      retryOnConcurrentChange: false,
    });
  }
  const scanScope = String(latest.config.modelGroup ?? MIAOWU_PRESET_ID);
  if (
    scan.status === "empty" &&
    !shouldConfirmEmptyScan(latest.config, scanScope)
  ) {
    const pendingConfig = pendingEmptyScanConfig(
      latest.config,
      scan.checkedAt,
      scanScope,
    );
    const saved = await repository.saveConnection({
      id: latest.id,
      name: latest.name,
      provider: latest.provider,
      encryptedSecret: latest.encryptedSecret,
      config: pendingConfig,
    });
    return { ...baseResult, connection: saved };
  }
  const configuredDefault =
    typeof latest.config.defaultModel === "string"
      ? latest.config.defaultModel
      : undefined;
  const defaultModel = miaowuDefaultModel(callable, configuredDefault);
  const config: JsonObject = {
    ...latest.config,
    ...(miaowuConnectionConfig(
      scanScope,
      defaultModel,
      callable,
    ) as unknown as JsonObject),
    connector: miaowuConnectorForModels(callable) as unknown as JsonObject,
    defaultModel,
    catalogSource: catalog.source,
    catalogCheckedAt: catalog.checkedAt,
    modelScanStatus: scan.status,
    modelScanCheckedAt: scan.checkedAt,
    scannedModelIds: [...scan.modelIds],
    unavailableModels: catalogModels
      .filter((model) => !scannedSet.has(model.id))
      .map((model) => model.id),
    unknownModels: scan.modelIds.filter((modelId) => !pricedIds.has(modelId)),
  };
  clearEmptyScanConfirmation(config);
  if (JSON.stringify(latest.config) === JSON.stringify(config))
    return { ...baseResult, connection: latest };
  const saved = await repository.saveConnection({
    id: latest.id,
    name: latest.name,
    provider: "rest",
    encryptedSecret: latest.encryptedSecret,
    config,
  });
  return { ...baseResult, connection: saved };
}

async function syncMiaowuConnectionFromCatalog(
  connection: ProviderConnectionRecord | null,
  catalog: MiaowuCatalogSnapshot,
) {
  if (!connection || connection.config.preset !== MIAOWU_PRESET_ID)
    return connection;
  const groupId =
    typeof connection.config.modelGroup === "string"
      ? connection.config.modelGroup
      : undefined;
  const catalogModels = miaowuModelsForGroup(catalog, groupId);
  const scanStatus = connection.config.modelScanStatus;
  const authoritativeScan = scanStatus === "live" || scanStatus === "empty";
  const scannedModelIds = authoritativeScan
    ? [
        ...new Set(
          configuredModelIds(connection.config.scannedModelIds).length > 0
            ? configuredModelIds(connection.config.scannedModelIds)
            : savedConnectorModelIds(connection),
        ),
      ]
    : [];
  const scannedSet = new Set(scannedModelIds);
  const catalogIds = new Set(catalog.models.map((model) => model.id));
  const models =
    scanStatus === "empty"
      ? []
      : scanStatus === "live"
        ? [
            ...catalogModels.filter((model) => scannedSet.has(model.id)),
            ...scannedModelIds
              .filter((modelId) => !catalogIds.has(modelId))
              .map((modelId) =>
                miaowuUnparameterizedVideoDescriptor(modelId, {
                  group: groupId,
                  parameterSource: "key-model-scan",
                }),
              ),
          ]
        : catalogModels;
  if (models.length === 0 && !authoritativeScan) return connection;
  const configuredDefault =
    typeof connection.config.defaultModel === "string"
      ? connection.config.defaultModel
      : undefined;
  const defaultModel = miaowuDefaultModel(models, configuredDefault);
  const config: JsonObject = {
    ...connection.config,
    ...(miaowuConnectionConfig(
      groupId,
      defaultModel,
      models,
    ) as unknown as JsonObject),
    connector: miaowuConnectorForModels(models) as unknown as JsonObject,
    defaultModel,
    catalogSource: catalog.source,
    catalogCheckedAt: catalog.checkedAt,
    ...(authoritativeScan
      ? {
          scannedModelIds,
          unavailableModels: catalogModels
            .filter((model) => !scannedSet.has(model.id))
            .map((model) => model.id),
          unknownModels: scannedModelIds.filter(
            (modelId) => !catalog.models.some((model) => model.id === modelId),
          ),
        }
      : {}),
  };
  if (
    connection.provider === "rest" &&
    JSON.stringify(connection.config) === JSON.stringify(config)
  )
    return connection;
  return getRepository().saveConnection({
    id: connection.id,
    name: connection.name,
    provider: "rest",
    encryptedSecret: connection.encryptedSecret,
    config,
  });
}

/**
 * Refresh saved preset-managed connections without replacing their API keys.
 * Loads the live 喵呜 pricing catalog (60s cache, snapshot fallback) and keeps
 * the connector's model list and default model in sync with it.
 */
export async function syncMiaowuConnection(id: string) {
  const repository = getRepository();
  const [connection, catalog] = await Promise.all([
    repository.getConnection(id),
    loadMiaowuCatalog(),
  ]);
  return syncMiaowuConnectionFromCatalog(connection, catalog);
}

export async function syncAllMiaowuConnections() {
  const repository = getRepository();
  const [connections, catalog] = await Promise.all([
    repository.listConnections(),
    loadMiaowuCatalog(),
  ]);
  return Promise.all(
    connections
      .filter((connection) => connection.config.preset === MIAOWU_PRESET_ID)
      .map((connection) =>
        syncMiaowuConnectionFromCatalog(connection, catalog),
      ),
  );
}
