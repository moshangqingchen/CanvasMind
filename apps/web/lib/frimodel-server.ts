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
  FRIMODEL_BASE_URL,
  FRIMODEL_MODEL_GROUP,
  FRIMODEL_PRESET_ID,
  friModelConnectionConfig,
  friModelMarketplaceGroup,
} from "./frimodel-presets";

export type FriModelModelScanStatus =
  | "live"
  | "empty"
  | "unauthorized"
  | "unconfigured"
  | "failed";

export interface FriModelKeyScan {
  status: FriModelModelScanStatus;
  checkedAt: string;
  modelIds: string[];
  error?: string;
}

export interface FriModelConnectionScan extends FriModelKeyScan {
  connection?: ProviderConnectionRecord | null;
}

interface OpenAIModelsPayload {
  data?: unknown;
}

function friModelScanFailure(
  status: Exclude<FriModelModelScanStatus, "live" | "empty">,
  error: string,
): FriModelKeyScan {
  return {
    status,
    checkedAt: new Date().toISOString(),
    modelIds: [],
    error,
  };
}

/**
 * Reads the models granted to one exact FriModel key via the free
 * `/models` endpoint of its OpenAI-compatible base URL (which already ends
 * in `/v1`). The key's group is the availability truth: the built-in
 * snapshot may list models the key can no longer see, and the live list may
 * carry ids that have no snapshot price yet. The result is never shared
 * across keys and never falls back to an older inventory.
 */
export async function scanFriModelKeyModels(
  apiKey: string,
  options?: { fetch?: typeof fetch; baseUrl?: string },
): Promise<FriModelKeyScan> {
  const checkedAt = new Date().toISOString();
  const fetchImpl = options?.fetch ?? providerFetch;
  const baseUrl = (options?.baseUrl ?? FRIMODEL_BASE_URL).replace(/\/+$/u, "");
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 || response.status === 403)
      return friModelScanFailure(
        "unauthorized",
        "FriModel 拒绝了当前 API Key，或该 Key 没有模型读取权限",
      );
    if (!response.ok)
      return friModelScanFailure(
        "failed",
        `FriModel 模型扫描失败（HTTP ${response.status}）`,
      );
    const payload = (await response.json()) as OpenAIModelsPayload;
    if (!Array.isArray(payload.data))
      return friModelScanFailure("failed", "FriModel 模型扫描返回了无效数据");
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
    return friModelScanFailure(
      "failed",
      "FriModel 模型扫描网络超时或返回无法解析，请稍后重试",
    );
  }
}

function friModelSnapshotModelIds(config: JsonObject): string[] {
  const groupId =
    typeof config.modelGroup === "string" ? config.modelGroup : "";
  const group = friModelMarketplaceGroup(groupId);
  return group ? [...new Set(group.models.map((model) => model.id))] : [];
}

function friModelConfigForScan(
  latest: ProviderConnectionRecord,
  scan: FriModelKeyScan,
): JsonObject {
  const snapshotIds = friModelSnapshotModelIds(latest.config);
  const scannedSet = new Set(scan.modelIds);
  const snapshotSet = new Set(snapshotIds);
  return {
    ...latest.config,
    modelScanStatus: scan.status,
    modelScanCheckedAt: scan.checkedAt,
    scannedModelIds: [...scan.modelIds],
    unavailableModels: snapshotIds.filter((id) => !scannedSet.has(id)),
    unknownModels: scan.modelIds.filter((id) => !snapshotSet.has(id)),
  };
}

function sameConfigIgnoringCheckedAt(a: JsonObject, b: JsonObject): boolean {
  const left = { ...a };
  const right = { ...b };
  delete left.modelScanCheckedAt;
  delete right.modelScanCheckedAt;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Scans one saved FriModel connection with its own key. Prices stay on the
 * built-in snapshot (the platform exposes no machine-readable pricing) —
 * only availability becomes real-time. On a successful live/empty scan the
 * availability fields are persisted into the connection config, including
 * `unknownModels` for ids without a snapshot price（价格以平台为准）.
 * Failed/unauthorized scans never overwrite the saved key or the last
 * successful scan result.
 */
export async function scanFriModelConnection(
  id: string,
  options?: {
    fetch?: typeof fetch;
    persist?: boolean;
    retryOnConcurrentChange?: boolean;
  },
): Promise<FriModelConnectionScan> {
  const repository = getRepository();
  const connection = await repository.getConnection(id);
  if (!connection || connection.config.preset !== FRIMODEL_PRESET_ID)
    return {
      ...friModelScanFailure("failed", "FriModel 连接不存在"),
      connection,
    };
  if (!connection.encryptedSecret)
    return {
      ...friModelScanFailure(
        "unconfigured",
        "FriModel 连接尚未保存 API Key，请先填写密钥",
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
      ...friModelScanFailure(
        "unconfigured",
        "已保存的 FriModel API Key 无法解密，请重新填写",
      ),
      connection,
    };
  }

  const scan = await scanFriModelKeyModels(apiKey, {
    ...(options?.fetch ? { fetch: options.fetch } : {}),
  });
  const baseResult: FriModelConnectionScan = { ...scan, connection };
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
    return scanFriModelConnection(id, {
      ...options,
      retryOnConcurrentChange: false,
    });
  }
  const scanScope = String(latest.config.modelGroup ?? "");
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
  const config = friModelConfigForScan(latest, scan);
  clearEmptyScanConfirmation(config);
  if (sameConfigIgnoringCheckedAt(config, latest.config))
    return { ...baseResult, connection: latest };
  const saved = await repository.saveConnection({
    id: latest.id,
    name: latest.name,
    provider: latest.provider,
    encryptedSecret: latest.encryptedSecret,
    config,
  });
  return { ...baseResult, connection: saved };
}

/**
 * Refresh preset-managed FriModel connections so existing saved connections
 * receive corrected preset fields without replacing their API keys. Never
 * touches scan fields — those are owned by scanFriModelConnection.
 */
export async function syncFriModelConnection(id: string) {
  const repository = getRepository();
  const connection = await repository.getConnection(id);
  if (!connection || connection.config.preset !== FRIMODEL_PRESET_ID)
    return connection;

  const modelGroup =
    typeof connection.config.modelGroup === "string" &&
    connection.config.modelGroup.trim()
      ? connection.config.modelGroup
      : FRIMODEL_MODEL_GROUP;
  const preset = friModelConnectionConfig(modelGroup) as unknown as JsonObject;
  const currentDefault =
    typeof connection.config.defaultModel === "string" &&
    connection.config.defaultModel.trim()
      ? connection.config.defaultModel
      : "";
  const config: JsonObject = {
    ...connection.config,
    ...preset,
    ...(currentDefault ? { defaultModel: currentDefault } : {}),
  };

  if (JSON.stringify(connection.config) === JSON.stringify(config))
    return connection;

  return repository.saveConnection({
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    encryptedSecret: connection.encryptedSecret,
    config,
  });
}

export async function syncAllFriModelConnections() {
  const repository = getRepository();
  const connections = await repository.listConnections();
  return Promise.all(
    connections
      .filter((connection) => connection.config.preset === FRIMODEL_PRESET_ID)
      .map((connection) => syncFriModelConnection(connection.id)),
  );
}
