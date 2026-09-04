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
  CHENTU_BASE_URL,
  CHENTU_IMAGE_REQUEST_TIMEOUT_MS,
  CHENTU_PRESET_ID,
  CHENTU_SUPPLIER_KEY,
} from "./chentu-presets";
import {
  CHENTU_SITE_URL,
  chentuDefaultModelForLiveGroup,
  chentuVideoConnectorForModels,
  loadChentuCatalog,
  resolveChentuScannedGroup,
  type ChentuMarketplaceGroupLive,
} from "./chentu-catalog";

export type ChentuModelScanStatus =
  | "live"
  | "empty"
  | "unauthorized"
  | "unconfigured"
  | "failed";

export interface ChentuKeyScan {
  status: ChentuModelScanStatus;
  checkedAt: string;
  modelIds: string[];
  error?: string;
}

export interface ChentuConnectionScan extends ChentuKeyScan {
  connection: ProviderConnectionRecord | null;
  marketplaceGroup: ChentuMarketplaceGroupLive | null;
  canvasModels: ModelDescriptor[];
  canvasDisplayModels: ModelDescriptor[];
  catalogSource: "live" | "stale" | "fallback";
}

interface OpenAIModelsPayload {
  data?: unknown;
}

function scanFailure(
  status: Exclude<ChentuModelScanStatus, "live" | "empty">,
  error: string,
): ChentuKeyScan {
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
export async function scanChentuKeyModels(
  apiKey: string,
  options?: { fetch?: typeof fetch },
): Promise<ChentuKeyScan> {
  const checkedAt = new Date().toISOString();
  const fetchImpl = options?.fetch ?? providerFetch;
  try {
    const response = await fetchImpl(`${CHENTU_BASE_URL}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 || response.status === 403) {
      const reason =
        response.status === 401
          ? "API Key 无效、过期或未按 Bearer Token 方式发送"
          : "API Key 已到达辰途，但当前分组未开通 /v1/models 模型读取权限";
      return scanFailure(
        "unauthorized",
        `辰途 /v1/models 返回 HTTP ${response.status}：${reason}`,
      );
    }
    if (!response.ok)
      return scanFailure(
        "failed",
        `辰途模型扫描失败（HTTP ${response.status}）`,
      );
    const payload = (await response.json()) as OpenAIModelsPayload;
    if (!Array.isArray(payload.data))
      return scanFailure("failed", "辰途模型扫描返回了无效数据");
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
      "辰途模型扫描网络超时或返回无法解析，将保留上次成功模型",
    );
  }
}

function hasOperationPrefix(
  model: ModelDescriptor,
  prefix: "image." | "video.",
): boolean {
  return model.operations.some((operation) => operation.startsWith(prefix));
}

/**
 * Reconciles one live scan into a persistable connection config.
 *
 * Image groups keep the existing OpenAI Images path (provider "openai",
 * baseUrl https://tu.988236.xyz/v1, no connector: the OpenAI adapter builds
 * chentu image descriptors from its own keyed live inventory). Video groups
 * switch to the rest OpenAI Videos connector (provider "rest", site origin
 * baseUrl). Groups without runnable canvas models fall back to agent usage
 * (when previously configured for chat) or a disabled state.
 */
function configForLiveScan(
  connection: ProviderConnectionRecord,
  group: string,
  scan: ChentuKeyScan,
  marketplaceGroup: ChentuMarketplaceGroupLive,
  canvasModels: readonly ModelDescriptor[],
  catalogSource: ChentuConnectionScan["catalogSource"],
): { config: JsonObject; provider: string } {
  const previousUsage = connection.config.usage;
  const chatModels = marketplaceGroup.models.filter(
    (model) => model.capability === "chat",
  );
  const config: JsonObject = {
    ...connection.config,
    preset: CHENTU_PRESET_ID,
    supplierKey: CHENTU_SUPPLIER_KEY,
    modelGroup: group,
    modelScanStatus: scan.status,
    scannedModelIds: [...scan.modelIds],
    catalogSource,
  };

  const agentConfig = (): { config: JsonObject; provider: string } => {
    const allowedModels = chatModels.map((model) => model.id);
    const configuredDefault =
      typeof connection.config.defaultModel === "string"
        ? connection.config.defaultModel
        : "";
    config.usage = "agent";
    config.baseUrl = CHENTU_BASE_URL;
    config.allowedModels = allowedModels;
    config.defaultModel = allowedModels.includes(configuredDefault)
      ? configuredDefault
      : (allowedModels[0] ?? "");
    delete config.connector;
    delete config.disabledReason;
    delete config.requestTimeoutMs;
    return { config, provider: "openai" };
  };

  if (previousUsage === "agent" && chatModels.length > 0) return agentConfig();

  const imageModels = canvasModels.filter((model) =>
    hasOperationPrefix(model, "image."),
  );
  const videoModels = canvasModels.filter((model) =>
    hasOperationPrefix(model, "video."),
  );

  if (imageModels.length > 0) {
    const configuredDefault =
      typeof connection.config.defaultModel === "string"
        ? connection.config.defaultModel
        : "";
    config.usage = "canvas";
    config.baseUrl = CHENTU_BASE_URL;
    config.defaultModel = imageModels.some(
      (model) => model.id === configuredDefault,
    )
      ? configuredDefault
      : chentuDefaultModelForLiveGroup(group, imageModels);
    config.requestTimeoutMs = CHENTU_IMAGE_REQUEST_TIMEOUT_MS;
    delete config.connector;
    delete config.allowedModels;
    delete config.disabledReason;
    return { config, provider: "openai" };
  }

  if (videoModels.length > 0) {
    const configuredDefault =
      typeof connection.config.defaultModel === "string"
        ? connection.config.defaultModel
        : "";
    config.usage = "canvas";
    config.baseUrl = CHENTU_SITE_URL;
    config.defaultModel = videoModels.some(
      (model) => model.id === configuredDefault,
    )
      ? configuredDefault
      : (videoModels[0]?.id ?? "");
    config.requestTimeoutMs = 300_000;
    config.connector = chentuVideoConnectorForModels(
      videoModels,
    ) as unknown as JsonObject;
    delete config.allowedModels;
    delete config.disabledReason;
    return { config, provider: "rest" };
  }

  config.usage = "disabled";
  config.baseUrl = CHENTU_BASE_URL;
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
  return { config, provider: connection.provider };
}

/**
 * Scans one saved 辰途 connection and reconciles its callable configuration.
 * Failed/unauthorized scans never overwrite the saved key or last successful
 * configuration. A failed scan includes a stale view of the last successful
 * model IDs when available, so a temporary upstream outage cannot make the
 * canvas selector disappear. Successful empty scans remain authoritative.
 */
export async function scanChentuConnection(
  id: string,
  options?: {
    fetch?: typeof fetch;
    forcePricing?: boolean;
    persist?: boolean;
    retryOnConcurrentChange?: boolean;
  },
): Promise<ChentuConnectionScan> {
  const repository = getRepository();
  const connection = await repository.getConnection(id);
  if (!connection || connection.config.preset !== CHENTU_PRESET_ID) {
    const failed = scanFailure("failed", "辰途连接不存在");
    return {
      ...failed,
      connection,
      marketplaceGroup: null,
      canvasModels: [],
      canvasDisplayModels: [],
      catalogSource: "fallback",
    };
  }
  const catalog = await loadChentuCatalog({
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
      !group ? "辰途连接未配置分组" : "辰途分组尚未保存 API Key",
    );
    return {
      ...failed,
      connection,
      marketplaceGroup: group
        ? resolveChentuScannedGroup(catalog, group, []).marketplaceGroup
        : null,
      canvasModels: [],
      canvasDisplayModels: [],
      catalogSource: catalog.source,
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
      "已保存的辰途分组 Key 无法解密，请重新填写",
    );
    return {
      ...failed,
      connection,
      marketplaceGroup: resolveChentuScannedGroup(catalog, group, [])
        .marketplaceGroup,
      canvasModels: [],
      canvasDisplayModels: [],
      catalogSource: catalog.source,
    };
  }

  const scan = await scanChentuKeyModels(apiKey, {
    ...(options?.fetch ? { fetch: options.fetch } : {}),
  });
  const resolved = resolveChentuScannedGroup(catalog, group, scan.modelIds);
  const savedModelIds = Array.isArray(connection.config.scannedModelIds)
    ? connection.config.scannedModelIds.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const staleResolved =
    scan.status === "failed" && savedModelIds.length > 0
      ? resolveChentuScannedGroup(catalog, group, savedModelIds)
      : null;
  const baseResult: ChentuConnectionScan = {
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
    catalogSource: catalog.source,
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
    return scanChentuConnection(id, {
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
  const next = configForLiveScan(
    latest,
    group,
    scan,
    resolved.marketplaceGroup,
    resolved.canvasModels,
    catalog.source,
  );
  clearEmptyScanConfirmation(next.config);
  if (
    next.provider === latest.provider &&
    JSON.stringify(next.config) === JSON.stringify(latest.config)
  )
    return { ...baseResult, connection: latest };
  const saved = await repository.saveConnection({
    id: latest.id,
    name: latest.name,
    provider: next.provider,
    encryptedSecret: latest.encryptedSecret,
    config: next.config,
  });
  return { ...baseResult, connection: saved };
}

export async function syncChentuConnection(id: string) {
  const result = await scanChentuConnection(id);
  return result.connection;
}

export async function syncAllChentuConnections() {
  const repository = getRepository();
  const connections = await repository.listConnections();
  return Promise.all(
    connections
      .filter((connection) => connection.config.preset === CHENTU_PRESET_ID)
      .map((connection) => syncChentuConnection(connection.id)),
  );
}
