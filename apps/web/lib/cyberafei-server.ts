import {
  getRepository,
  type JsonObject,
  type ProviderConnectionRecord,
} from "@super-canvas/db";
import {
  decryptSecret,
  providerFetch,
  type ModelDescriptor,
} from "@super-canvas/providers";
import { requireServerMasterKey } from "./master-key";
import {
  clearEmptyScanConfirmation,
  pendingEmptyScanConfig,
  shouldConfirmEmptyScan,
} from "./model-scan-confirmation";
import {
  CYBERAFEI_API_BASE_URL,
  CYBERAFEI_BASE_URL,
  CYBERAFEI_PRESET_ID,
  CYBERAFEI_SUPPLIER_KEY,
  cyberAfeiConnectorForGroup,
  cyberAfeiDefaultModelForGroup,
  loadCyberAfeiCatalog,
  resolveCyberAfeiScannedGroup,
  type CyberAfeiMarketplaceGroup,
} from "./cyberafei-catalog";

export type CyberAfeiModelScanStatus =
  "live" | "empty" | "unauthorized" | "unconfigured" | "failed";

export interface CyberAfeiKeyScan {
  status: CyberAfeiModelScanStatus;
  checkedAt: string;
  modelIds: string[];
  error?: string;
}

export interface CyberAfeiConnectionScan extends CyberAfeiKeyScan {
  connection: ProviderConnectionRecord | null;
  marketplaceGroup: CyberAfeiMarketplaceGroup | null;
  canvasModels: ModelDescriptor[];
  canvasDisplayModels: ModelDescriptor[];
  catalogSource: "live" | "unavailable" | "stale" | "fallback";
}

interface OpenAIModelsPayload {
  data?: unknown;
}

function scanFailure(
  status: Exclude<CyberAfeiModelScanStatus, "live" | "empty">,
  error: string,
): CyberAfeiKeyScan {
  return {
    status,
    checkedAt: new Date().toISOString(),
    modelIds: [],
    error,
  };
}

/**
 * Reads the models granted to one exact key. This result is never shared
 * across connections or keys and never falls back to an older inventory.
 */
export async function scanCyberAfeiKeyModels(
  apiKey: string,
  options?: { fetch?: typeof fetch },
): Promise<CyberAfeiKeyScan> {
  const checkedAt = new Date().toISOString();
  const fetchImpl = options?.fetch ?? providerFetch;
  try {
    const response = await fetchImpl(`${CYBERAFEI_BASE_URL}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 || response.status === 403)
      return scanFailure(
        "unauthorized",
        "赛博阿飞拒绝了当前分组 Key，或该 Key 没有模型读取权限",
      );
    if (!response.ok)
      return scanFailure(
        "failed",
        `赛博阿飞模型扫描失败（HTTP ${response.status}）`,
      );
    const payload = (await response.json()) as OpenAIModelsPayload;
    if (!Array.isArray(payload.data))
      return scanFailure("failed", "赛博阿飞模型扫描返回了无效数据");
    const modelIds = [
      ...new Set(
        payload.data.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item))
            return [];
          const id = (item as Record<string, unknown>).id;
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
    return scanFailure(
      "failed",
      "赛博阿飞模型扫描网络超时或返回无法解析，将保留上次成功模型",
    );
  }
}

function configForLiveScan(
  connection: ProviderConnectionRecord,
  group: string,
  scan: CyberAfeiKeyScan,
  marketplaceGroup: CyberAfeiMarketplaceGroup,
  canvasModels: readonly ModelDescriptor[],
  catalogSource: CyberAfeiConnectionScan["catalogSource"],
): JsonObject {
  const previousUsage = connection.config.usage;
  const chatModels = marketplaceGroup.models.filter(
    (model) => model.capability === "chat",
  );
  const useAgent = previousUsage === "agent" && chatModels.length > 0;
  const config: JsonObject = {
    ...connection.config,
    preset: CYBERAFEI_PRESET_ID,
    supplierKey: CYBERAFEI_SUPPLIER_KEY,
    modelGroup: group,
    modelScanStatus: scan.status,
    scannedModelIds: [...scan.modelIds],
    catalogSource,
  };

  if (useAgent) {
    const allowedModels = chatModels.map((model) => model.id);
    const configuredDefault =
      typeof connection.config.defaultModel === "string"
        ? connection.config.defaultModel
        : "";
    config.usage = "agent";
    config.baseUrl = CYBERAFEI_API_BASE_URL;
    config.allowedModels = allowedModels;
    config.defaultModel = allowedModels.includes(configuredDefault)
      ? configuredDefault
      : (allowedModels[0] ?? "");
    delete config.connector;
    delete config.disabledReason;
    delete config.requestTimeoutMs;
    return config;
  }

  if (canvasModels.length > 0) {
    const configuredDefault =
      typeof connection.config.defaultModel === "string"
        ? connection.config.defaultModel
        : "";
    config.usage = "canvas";
    config.baseUrl = CYBERAFEI_BASE_URL;
    config.defaultModel = canvasModels.some(
      (model) => model.id === configuredDefault,
    )
      ? configuredDefault
      : cyberAfeiDefaultModelForGroup(group, canvasModels);
    config.requestTimeoutMs = 300_000;
    config.connector = cyberAfeiConnectorForGroup(
      group,
      canvasModels,
    ) as unknown as JsonObject;
    delete config.allowedModels;
    delete config.disabledReason;
    return config;
  }

  if (previousUsage === "agent" && chatModels.length > 0) {
    const allowedModels = chatModels.map((model) => model.id);
    config.usage = "agent";
    config.baseUrl = CYBERAFEI_API_BASE_URL;
    config.allowedModels = allowedModels;
    config.defaultModel = allowedModels.includes(
      typeof connection.config.defaultModel === "string"
        ? connection.config.defaultModel
        : "",
    )
      ? connection.config.defaultModel
      : (allowedModels[0] ?? "");
    delete config.connector;
    delete config.disabledReason;
    delete config.requestTimeoutMs;
    return config;
  }

  config.usage = "disabled";
  config.baseUrl = CYBERAFEI_BASE_URL;
  config.disabledReason =
    scan.status === "empty"
      ? "当前分组 Key 扫描成功，但没有任何模型权限"
      : scan.modelIds.length > 0
        ? `已扫描到 ${scan.modelIds.length} 个模型，但尚无已验证的画布生成协议`
        : "当前分组未扫描到可运行模型";
  delete config.connector;
  delete config.defaultModel;
  delete config.allowedModels;
  delete config.requestTimeoutMs;
  return config;
}

/**
 * Scans one saved Cyber Afei connection and reconciles its callable connector.
 * Failed/unauthorized scans never overwrite the saved key or last successful
 * connector. A failed scan includes a stale view of the last successful model
 * IDs when available, so a temporary upstream outage cannot make the canvas
 * selector disappear. Successful empty scans remain authoritative.
 */
export async function scanCyberAfeiConnection(
  id: string,
  options?: {
    fetch?: typeof fetch;
    forcePricing?: boolean;
    persist?: boolean;
    retryOnConcurrentChange?: boolean;
  },
): Promise<CyberAfeiConnectionScan> {
  const repository = getRepository();
  const connection = await repository.getConnection(id);
  if (!connection || connection.config.preset !== CYBERAFEI_PRESET_ID) {
    const failed = scanFailure("failed", "赛博阿飞连接不存在");
    return {
      ...failed,
      connection,
      marketplaceGroup: null,
      canvasModels: [],
      canvasDisplayModels: [],
      catalogSource: "unavailable",
    };
  }
  const emptyCatalog = await loadCyberAfeiCatalog({
    force: options?.forcePricing,
    fetch: options?.fetch ?? providerFetch,
  });
  const group =
    typeof connection.config.modelGroup === "string"
      ? connection.config.modelGroup.trim()
      : "";
  if (!group || !connection.encryptedSecret) {
    const failed = scanFailure(
      "unconfigured",
      !group ? "赛博阿飞连接未配置分组" : "赛博阿飞分组尚未保存 API Key",
    );
    return {
      ...failed,
      connection,
      marketplaceGroup: group
        ? resolveCyberAfeiScannedGroup(emptyCatalog, group, []).marketplaceGroup
        : null,
      canvasModels: [],
      canvasDisplayModels: [],
      catalogSource: emptyCatalog.source,
    };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(
      connection.encryptedSecret,
      requireServerMasterKey(),
    );
  } catch {
    const failed = scanFailure(
      "unconfigured",
      "已保存的赛博阿飞分组 Key 无法解密，请重新填写",
    );
    return {
      ...failed,
      connection,
      marketplaceGroup: resolveCyberAfeiScannedGroup(emptyCatalog, group, [])
        .marketplaceGroup,
      canvasModels: [],
      canvasDisplayModels: [],
      catalogSource: emptyCatalog.source,
    };
  }

  const scan = await scanCyberAfeiKeyModels(apiKey, {
    ...(options?.fetch ? { fetch: options.fetch } : {}),
  });
  const resolved = resolveCyberAfeiScannedGroup(
    emptyCatalog,
    group,
    scan.modelIds,
    { capabilityBlocks: connection.config.capabilityBlocks },
  );
  const savedModelIds = Array.isArray(connection.config.scannedModelIds)
    ? connection.config.scannedModelIds.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const staleResolved =
    scan.status === "failed" && savedModelIds.length > 0
      ? resolveCyberAfeiScannedGroup(
          emptyCatalog,
          group,
          savedModelIds,
          { capabilityBlocks: connection.config.capabilityBlocks },
        )
      : null;
  const baseResult: CyberAfeiConnectionScan = {
    ...scan,
    connection,
    marketplaceGroup: staleResolved?.marketplaceGroup ?? resolved.marketplaceGroup,
    canvasModels:
      scan.status === "live" || scan.status === "empty"
        ? resolved.canvasModels
        : (staleResolved?.canvasModels ?? []),
    canvasDisplayModels:
      scan.status === "live" || scan.status === "empty"
        ? resolved.canvasDisplayModels
        : (staleResolved?.canvasDisplayModels ?? []),
    catalogSource: emptyCatalog.source,
  };
  if (
    (scan.status !== "live" && scan.status !== "empty") ||
    options?.persist === false
  )
    return baseResult;

  const latest = await repository.getConnection(id);
  if (
    !latest ||
    latest.updatedAt !== connection.updatedAt ||
    latest.encryptedSecret !== connection.encryptedSecret
  ) {
    if (options?.retryOnConcurrentChange === false) return baseResult;
    return scanCyberAfeiConnection(id, {
      ...options,
      retryOnConcurrentChange: false,
    });
  }
  if (
    scan.status === "empty" &&
    !shouldConfirmEmptyScan(latest.config, group)
  ) {
    const pendingConfig = pendingEmptyScanConfig(
      latest.config,
      scan.checkedAt,
      group,
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
  const config = configForLiveScan(
    latest,
    group,
    scan,
    resolved.marketplaceGroup,
    resolved.canvasModels,
    emptyCatalog.source,
  );
  clearEmptyScanConfirmation(config);
  if (JSON.stringify(config) === JSON.stringify(latest.config))
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

export async function syncCyberAfeiConnection(id: string) {
  const result = await scanCyberAfeiConnection(id);
  return result.connection;
}

export async function syncAllCyberAfeiConnections() {
  const repository = getRepository();
  const connections = await repository.listConnections();
  return Promise.all(
    connections
      .filter((connection) => connection.config.preset === CYBERAFEI_PRESET_ID)
      .map((connection) => syncCyberAfeiConnection(connection.id)),
  );
}
