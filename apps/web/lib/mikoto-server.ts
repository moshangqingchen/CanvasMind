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
  MIKOTO_BASE_URL,
  MIKOTO_PRESET_ID,
  mikotoConnectionConfig,
  mikotoGroup,
  normalizeMikotoGroupId,
} from "./mikoto-presets";

export type MikotoModelScanStatus =
  | "live"
  | "empty"
  | "unauthorized"
  | "unconfigured"
  | "failed";

export interface MikotoKeyScan {
  status: MikotoModelScanStatus;
  checkedAt: string;
  modelIds: string[];
  error?: string;
}

export interface MikotoConnectionScan extends MikotoKeyScan {
  connection?: ProviderConnectionRecord | null;
}

const MIKOTO_SCAN_CACHE_TTL_MS = 60_000;

interface OpenAIModelsPayload {
  data?: unknown;
}

function mikotoScanFailure(
  status: Exclude<MikotoModelScanStatus, "live" | "empty">,
  error: string,
): MikotoKeyScan {
  return {
    status,
    checkedAt: new Date().toISOString(),
    modelIds: [],
    error,
  };
}

/**
 * Reads the models granted to one exact MikotoPro key via the free
 * `/v1/models` endpoint (Bearer auth works for every group, including the
 * Gemini native group). The result is never shared across keys and never
 * falls back to an older inventory; per-group keys only see their own group.
 */
export async function scanMikotoKeyModels(
  apiKey: string,
  options?: { fetch?: typeof fetch; baseUrl?: string },
): Promise<MikotoKeyScan> {
  const checkedAt = new Date().toISOString();
  const fetchImpl = options?.fetch ?? providerFetch;
  const baseUrl = (options?.baseUrl ?? MIKOTO_BASE_URL).replace(/\/+$/u, "");
  try {
    const response = await fetchImpl(`${baseUrl}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 || response.status === 403)
      return mikotoScanFailure(
        "unauthorized",
        "MikotoPro 拒绝了当前分组 Key，或该 Key 没有模型读取权限",
      );
    if (!response.ok)
      return mikotoScanFailure(
        "failed",
        `MikotoPro 模型扫描失败（HTTP ${response.status}）`,
      );
    const payload = (await response.json()) as OpenAIModelsPayload;
    if (!Array.isArray(payload.data))
      return mikotoScanFailure("failed", "MikotoPro 模型扫描返回了无效数据");
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
    return mikotoScanFailure(
      "failed",
      "MikotoPro 模型扫描网络超时或返回无法解析，请稍后重试",
    );
  }
}

function mikotoSnapshotModelIds(config: JsonObject): string[] {
  const group = mikotoGroup(config.modelGroup);
  return group ? [...new Set(group.models.map((model) => model.id))] : [];
}

function cachedMikotoScan(
  connection: ProviderConnectionRecord,
): MikotoKeyScan | null {
  const status = connection.config.modelScanStatus;
  const checkedAt = connection.config.modelScanCheckedAt;
  if (
    status !== "live" &&
    status !== "empty" &&
    status !== "unauthorized" &&
    status !== "unconfigured" &&
    status !== "failed"
  )
    return null;
  if (typeof checkedAt !== "string") return null;
  const checkedTime = Date.parse(checkedAt);
  if (!Number.isFinite(checkedTime)) return null;
  if (Date.now() - checkedTime >= MIKOTO_SCAN_CACHE_TTL_MS) return null;
  const rawIds = connection.config.scannedModelIds;
  const modelIds = Array.isArray(rawIds)
    ? rawIds.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
    : [];
  return {
    status,
    checkedAt,
    modelIds: [...new Set(modelIds)],
  };
}

function mikotoConfigForScan(
  latest: ProviderConnectionRecord,
  scan: MikotoKeyScan,
): JsonObject {
  const snapshotIds = mikotoSnapshotModelIds(latest.config);
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
 * Scans one saved MikotoPro connection with its own key. Prices and model
 * parameters stay on the built-in snapshot (the platform exposes no
 * machine-readable pricing) — only availability becomes real-time. On a
 * successful live/empty scan the availability fields are persisted into the
 * connection config; failed/unauthorized scans never overwrite the saved
 * key, connector, or the last successful scan result.
 */
export async function scanMikotoConnection(
  id: string,
  options?: {
    fetch?: typeof fetch;
    persist?: boolean;
    force?: boolean;
    retryOnConcurrentChange?: boolean;
  },
): Promise<MikotoConnectionScan> {
  const repository = getRepository();
  const connection = await repository.getConnection(id);
  if (!connection || connection.config.preset !== MIKOTO_PRESET_ID)
    return {
      ...mikotoScanFailure("failed", "MikotoPro 连接不存在"),
      connection,
    };
  if (!connection.encryptedSecret)
    return {
      ...mikotoScanFailure(
        "unconfigured",
        "MikotoPro 连接尚未保存 API Key，请先填写分组密钥",
      ),
      connection,
    };

  // Normal settings reads are frequent and do not need to hit the upstream
  // inventory endpoint every time. Explicit refreshes and injected test
  // fetchers always bypass this cache.
  if (!options?.force && !options?.fetch) {
    const cached = cachedMikotoScan(connection);
    // A first empty response is only a pending confirmation. Recheck it on
    // the next normal request instead of hiding the second upstream probe
    // behind the regular 60-second scan cache.
    if (cached && !shouldConfirmEmptyScan(connection.config, String(connection.config.modelGroup ?? "")))
      return { ...cached, connection };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(
      connection.encryptedSecret,
      requireServerMasterKey(),
    );
  } catch {
    return {
      ...mikotoScanFailure(
        "unconfigured",
        "已保存的 MikotoPro API Key 无法解密，请重新填写",
      ),
      connection,
    };
  }

  const scan = await scanMikotoKeyModels(apiKey, {
    ...(options?.fetch ? { fetch: options.fetch } : {}),
  });
  const baseResult: MikotoConnectionScan = { ...scan, connection };
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
    return scanMikotoConnection(id, {
      ...options,
      retryOnConcurrentChange: false,
    });
  }
  if (scan.status === "empty" &&
      !shouldConfirmEmptyScan(latest.config, String(latest.config.modelGroup ?? ""))) {
    const pendingConfig = pendingEmptyScanConfig(
      latest.config,
      scan.checkedAt,
      String(latest.config.modelGroup ?? ""),
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
  const config = mikotoConfigForScan(latest, scan);
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
 * Refresh preset-managed MikotoPro connections so existing saved connections
 * receive corrected model parameters without replacing their API keys.
 */
export async function syncMikotoConnection(id: string) {
  const repository = getRepository();
  const connection = await repository.getConnection(id);
  if (!connection || connection.config.preset !== MIKOTO_PRESET_ID)
    return connection;
  const normalizedGroup = normalizeMikotoGroupId(connection.config.modelGroup);
  if (!normalizedGroup) return connection;

  const group = mikotoGroup(normalizedGroup);
  if (!group) return connection;
  const currentDefault =
    typeof connection.config.defaultModel === "string"
      ? connection.config.defaultModel
      : "";
  const defaultModel = group.models.some(
    (model) => model.id === currentDefault,
  )
    ? currentDefault
    : group.defaultModel;
  const currentPreset = mikotoConnectionConfig(group.id);
  const config: JsonObject = {
    ...connection.config,
    ...(currentPreset as unknown as JsonObject),
    defaultModel,
  };

  if (group.provider === "rest") delete config.protocol;
  else delete config.connector;

  if (
    connection.provider === group.provider &&
    JSON.stringify(connection.config) === JSON.stringify(config)
  )
    return connection;

  return repository.saveConnection({
    id: connection.id,
    name: connection.name,
    provider: group.provider,
    encryptedSecret: connection.encryptedSecret,
    config,
  });
}

export async function syncAllMikotoConnections() {
  const repository = getRepository();
  const connections = await repository.listConnections();
  return Promise.all(
    connections
      .filter((connection) => connection.config.preset === MIKOTO_PRESET_ID)
      .map((connection) => syncMikotoConnection(connection.id)),
  );
}
