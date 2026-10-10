import {
  readBoundedModelJson,
  readModelDenialEvidence,
  scanAlternateSupplier,
} from "./supplier-scan-utils";
import { matchesSupplierTemplate } from "./supplier-template-source";
import {
  getRepository,
  type JsonObject,
  type ProviderConnectionRecord,
} from "@super-canvas/db";
import { decryptSecret, providerFetch, preservesMiaowuExplicitVideoContract, isMiaowuLegacyVideoBaseConnector } from "@super-canvas/providers";
import { requireServerMasterKey } from "./master-key";
import { clearEmptyScanConfirmation } from "./model-scan-confirmation";
import { createHash } from "node:crypto";
import type { ModelDescriptor, RestConnectorConfig, RestModelConnectorOverride } from "@super-canvas/providers";
import { remainingVideoModelIds } from "@super-canvas/providers/remaining-video-contracts";
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
import { applyMiaowuVideoSchema, parseMiaowuVideoSchema, type MiaowuVideoSchemaReceipt } from "./miaowu-video-schema";
import { applyMiaowuImageSchema, parseMiaowuImageSchema, type MiaowuImageSchemaReceipt } from "./miaowu-image-schema";

export type MiaowuModelScanStatus =
  "live" | "empty" | "unauthorized" | "unconfigured" | "failed";

export interface MiaowuKeyScan {
  status: MiaowuModelScanStatus;
  checkedAt: string;
  modelIds: string[];
  error?: string;
  /** Actual base-directory response status; Dream has its own scoped status. */
  httpStatus?: number;
  upstreamErrorCode?: string;
  complete?: boolean;
  openaiModelIds?: string[];
  mediaDirectory?: MiaowuMediaDirectory;
  videoSchemas?: Record<string, MiaowuVideoSchemaReceipt>;
  imageSchemas?: Record<string, MiaowuImageSchemaReceipt>;
}

export interface MiaowuMediaDirectory {
  status: "live" | "empty" | "unsupported" | "unauthorized" | "failed" | "not-applicable";
  sourceUrl: string;
  checkedAt: string;
  models: { id: string; kind: "image" | "video" }[];
  httpStatus?: number;
  error?: string;
  stale?: boolean;
  lastSuccessfulCheckedAt?: string;
}

function officialMiaowuBase(base: string): boolean {
  try {
    const url = new URL(base);
    return url.origin === MIAOWU_BASE_URL && !url.username && !url.password && !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

async function scanMiaowuMediaDirectory(apiKey: string, fetchImpl: typeof fetch): Promise<MiaowuMediaDirectory> {
  const sourceUrl = `${MIAOWU_BASE_URL}/v1/dream/model_list`;
  const result: MiaowuMediaDirectory = { status: "failed", sourceUrl, checkedAt: new Date().toISOString(), models: [] };
  try {
    const response = await fetchImpl(sourceUrl, { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    result.httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      result.checkedAt = new Date().toISOString();
      result.status = response.status === 404 ? "unsupported" : [401, 403].includes(response.status) ? "unauthorized" : "failed";
      result.error = response.status === 404 ? "喵呜媒体目录接口当前返回 HTTP 404，保留同一密钥已有媒体目录"
        : `喵呜媒体目录检查失败（HTTP ${response.status}）`;
      return result;
    }
    const payload = await readBoundedModelJson(response) as { data?: unknown } | null;
    if (!payload || !Array.isArray(payload.data)) throw new Error("Invalid media inventory");
    const byId = new Map<string, "image" | "video">();
    for (const item of payload.data) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (id && (record.type === "image" || record.type === "video")) byId.set(id, record.type);
    }
    if (payload.data.length && !byId.size) throw new Error("Missing declared media types");
    result.models = [...byId].map(([id, kind]) => ({ id, kind }));
    result.status = result.models.length ? "live" : "empty";
    result.checkedAt = new Date().toISOString();
    return result;
  } catch {
    result.checkedAt = new Date().toISOString();
    result.error = "喵呜媒体目录网络失败或响应无法解析，保留同一密钥已有媒体目录";
    return result;
  }
}

const credentialFingerprint = (connection: ProviderConnectionRecord) => createHash("sha256").update(connection.encryptedSecret ?? "").digest("hex");
/** The display group may differ from the group actually assigned to the Key. */
function accountModelGroup(connection: ProviderConnectionRecord): string | undefined {
  const assigned = connection.config.accountKeyGroup;
  if (typeof assigned === "string" && assigned.trim()) return assigned;
  const display = connection.config.modelGroup;
  return typeof display === "string" && display.trim() ? display : undefined;
}
function schemaGroupIdentity(connection: ProviderConnectionRecord): string {
  const id = String(connection.config.accountKeyGroupId ?? "");
  return /^[1-9][0-9]*$/u.test(id) ? `id:${id}` : `name:${String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "")}`;
}

async function scanMiaowuSchemas<T>(apiKey: string, directory: MiaowuMediaDirectory, fetchImpl: typeof fetch,
  kind: "image" | "video", parse: (id: string, payload: unknown) => T): Promise<Record<string, Omit<MiaowuVideoSchemaReceipt, "contract"> & { contract?: T }>> {
  const ids = directory.status === "live" ? directory.models.filter(model => model.kind === kind).map(model => model.id) : [];
  const receipts: Record<string, Omit<MiaowuVideoSchemaReceipt, "contract"> & { contract?: T }> = Object.create(null);
  let next = 0;
  // Image and video queues run together; two workers each bound the total to four.
  await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++]!, sourceUrl = `${MIAOWU_BASE_URL}/v1/dream/model_schema?model=${encodeURIComponent(id)}`;
      const receipt: Omit<MiaowuVideoSchemaReceipt, "contract"> & { contract?: T } = { id, sourceUrl, checkedAt: new Date().toISOString(), status: "failed" };
      try {
        const response = await fetchImpl(sourceUrl, { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        receipt.httpStatus = response.status;
        if (!response.ok) {
          await response.body?.cancel();
          receipt.status = response.status === 404 ? "unsupported" : [401, 403].includes(response.status) ? "unauthorized" : "failed";
          receipt.error = `喵呜 ${id} 免费参数 schema 返回 HTTP ${response.status}，保留同一身份已有参数`;
        } else {
          const payload = await readBoundedModelJson(response);
          receipt.contract = parse(id, payload);
          receipt.normalizedSchemaSha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
          receipt.status = "live";
        }
      } catch (error) { receipt.error = error instanceof Error && /schema/u.test(error.message) ? error.message : `喵呜 ${id} 免费参数 schema 网络失败或无法解析，保留同一身份已有参数`; }
      receipt.checkedAt = new Date().toISOString();
      receipts[id] = receipt;
    }
  }));
  return receipts;
}

/** Schema fallback never crosses a credential, supplier source or official group. */
function sameSchemaScope(connection: ProviderConnectionRecord): boolean {
  return connection.config.miaowuSchemaCredentialFingerprint === credentialFingerprint(connection) &&
    connection.config.miaowuSchemaSupplierSourceId === (connection.config.supplierSourceId ?? null) &&
    connection.config.miaowuSchemaGroupIdentity === schemaGroupIdentity(connection);
}
function cachedSchemasForConnection(connection: ProviderConnectionRecord): Record<string, MiaowuVideoSchemaReceipt> | undefined {
  return sameSchemaScope(connection) ? connection.config.miaowuVideoSchemas as unknown as Record<string, MiaowuVideoSchemaReceipt> | undefined : undefined;
}
function cachedImageSchemasForConnection(connection: ProviderConnectionRecord): Record<string, MiaowuImageSchemaReceipt> | undefined {
  return sameSchemaScope(connection) ? connection.config.miaowuImageSchemas as unknown as Record<string, MiaowuImageSchemaReceipt> | undefined : undefined;
}
function schemasForConnection(scan: MiaowuKeyScan, connection: ProviderConnectionRecord): Record<string, MiaowuVideoSchemaReceipt> {
  const current = { ...scan.videoSchemas }, previous = cachedSchemasForConnection(connection);
  const visible = new Set(scan.mediaDirectory?.models.filter(model => model.kind === "video").map(model => model.id) ?? []);
  for (const id of visible) {
    const old = previous?.[id], fresh = current[id];
    if (!old?.contract || old.id !== id || old.sourceUrl !== `${MIAOWU_BASE_URL}/v1/dream/model_schema?model=${encodeURIComponent(id)}` || fresh?.status === "live" || fresh?.status === "unauthorized") continue;
    current[id] = { ...(fresh ?? { id, sourceUrl: old.sourceUrl, checkedAt: scan.checkedAt, status: "failed" as const, error: "本轮媒体目录未取得新 schema，保留同一身份的上次参数" }),
      contract: old.contract, normalizedSchemaSha256: old.normalizedSchemaSha256, stale: true, lastSuccessfulCheckedAt: old.lastSuccessfulCheckedAt ?? old.checkedAt };
  }
  return current;
}
function imageSchemasForConnection(scan: MiaowuKeyScan, connection: ProviderConnectionRecord): Record<string, MiaowuImageSchemaReceipt> {
  const current = { ...scan.imageSchemas }, previous = cachedImageSchemasForConnection(connection);
  const visible = new Set(scan.mediaDirectory?.models.filter(model => model.kind === "image").map(model => model.id) ?? []);
  for (const id of visible) {
    const old = previous?.[id], fresh = current[id];
    if (!old?.contract || old.id !== id || old.sourceUrl !== `${MIAOWU_BASE_URL}/v1/dream/model_schema?model=${encodeURIComponent(id)}` || fresh?.status === "live" || fresh?.status === "unauthorized") continue;
    current[id] = { ...(fresh ?? { id, sourceUrl: old.sourceUrl, checkedAt: scan.checkedAt, status: "failed" as const, error: "本轮媒体目录未取得新 schema，保留同一身份的上次参数" }),
      contract: old.contract, normalizedSchemaSha256: old.normalizedSchemaSha256, stale: true, lastSuccessfulCheckedAt: old.lastSuccessfulCheckedAt ?? old.checkedAt };
  }
  return current;
}

function preserveFailedMediaDirectory(scan: MiaowuKeyScan, connection: ProviderConnectionRecord): MiaowuKeyScan {
  const current = scan.mediaDirectory;
  const previous = connection.config.miaowuMediaDirectory as unknown as MiaowuMediaDirectory | undefined;
  if (!current || !["failed", "unsupported"].includes(current.status) ||
    connection.config.miaowuDirectoryCredentialFingerprint !== credentialFingerprint(connection) ||
    connection.config.miaowuDirectoryGroup !== (connection.config.accountKeyGroup ?? connection.config.modelGroup) ||
    connection.config.miaowuDirectorySupplierSourceId !== (connection.config.supplierSourceId ?? null) ||
    !previous || previous.sourceUrl !== current.sourceUrl || !Array.isArray(previous.models)) return scan;
  const models = previous.models.filter(model => typeof model.id === "string" && (model.kind === "image" || model.kind === "video"));
  const modelIds = [...new Set([...scan.modelIds, ...models.map(model => model.id)])];
  return { ...scan, status: modelIds.length ? "live" : "empty", modelIds,
    mediaDirectory: { ...current, models, stale: true, lastSuccessfulCheckedAt: previous.lastSuccessfulCheckedAt ?? previous.checkedAt } };
}

function modelsFromScannedDirectories(catalogModels: ModelDescriptor[], scan: MiaowuKeyScan, group: string | undefined): ModelDescriptor[] {
  const scannedSet = new Set(scan.modelIds);
  const groupCatalogIds = new Set(catalogModels.map(model => model.id));
  const openaiIds = new Set(scan.openaiModelIds ?? scan.modelIds);
  const mediaModels = new Map(scan.mediaDirectory?.models.map(model => [model.id, model.kind]) ?? []);
  const models = [...catalogModels.filter(model => scannedSet.has(model.id)), ...scan.modelIds.filter(id => !groupCatalogIds.has(id)).map(id => {
    const descriptor = miaowuUnparameterizedVideoDescriptor(id, { group, parameterSource: "key-model-scan" });
    const model = { ...descriptor, metadata: { ...descriptor.metadata, canvasRunnable: false,
      canvasUnavailableReason: "当前分组列出此型号，但尚未提供其参数与调用合同" } };
    const mediaKind = mediaModels.get(id);
    return mediaKind ? { ...model, description: `喵呜${mediaKind === "image" ? "图片" : "视频"}型号；当前分组的参数与调用合同待确认。`,
      operations: mediaKind === "image" ? ["image.generate"] as const : model.operations,
      outputKinds: [mediaKind], metadata: { ...model.metadata, modality: mediaKind, outputKindsSource: "declared",
        catalogCapability: mediaKind, canvasRunnable: false,
        canvasUnavailableReason: "媒体目录列出此型号，但当前分组尚未提供其参数合同" } } : model;
  })];
  return models.map(model => applyMiaowuImageSchema(applyMiaowuVideoSchema({ ...model, metadata: { ...model.metadata,
    modelDirectorySources: [...(openaiIds.has(model.id) ? ["openai-key-models"] : []), ...(mediaModels.has(model.id) ? ["authenticated-dream-media-directory"] : [])],
    ...(mediaModels.has(model.id) ? { mediaDirectoryStatus: scan.mediaDirectory!.status,
      mediaDirectoryCheckedAt: scan.mediaDirectory!.checkedAt, mediaDirectoryStale: scan.mediaDirectory!.stale === true } : {}),
  } }, scan.videoSchemas?.[model.id]), scan.imageSchemas?.[model.id]));
}

/** Refresh automatic contracts without discarding a saved exact alias contract. */
function refreshedMiaowuConnector(connection: ProviderConnectionRecord, models: readonly ModelDescriptor[]): RestConnectorConfig {
  const aliases = new Set(remainingVideoModelIds("miaowu"));
  const previous = connection.config.connector as unknown as RestConnectorConfig | undefined;
  const previousModels = Array.isArray(connection.config.modelCatalogModels)
    ? connection.config.modelCatalogModels as unknown as ModelDescriptor[] : previous?.models ?? [];
  const protectedModels = new Map<string, ModelDescriptor>();
  for (const model of models) {
    const saved = previousModels.find(row => row && row.id === model.id && Array.isArray(row.operations));
    if (!aliases.has(model.id) && saved?.metadata?.source !== "manual") continue;
    if (!saved || saved.metadata?.marketplaceGroup && saved.metadata.marketplaceGroup !== model.metadata?.marketplaceGroup) continue;
    const denied = saved.metadata?.canvasRunnable === false && /401|403|权限|未开通|拒绝|下架|停用|unauthorized|forbidden/iu.test(String(saved.metadata.canvasUnavailableReason ?? ""));
    if (denied || saved.metadata?.source === "manual" || preservesMiaowuExplicitVideoContract(connection.config, saved) ||
        saved.operations.some(operation => preservesMiaowuExplicitVideoContract(connection.config, saved, operation)))
      protectedModels.set(model.id, { ...structuredClone(saved), metadata: { ...model.metadata, ...saved.metadata,
        modelDirectorySources: model.metadata?.modelDirectorySources } });
  }
  const connector = miaowuConnectorForModels(models.map(model => protectedModels.get(model.id) ?? model));
  connector.models = connector.models?.map(model => protectedModels.get(model.id) ?? model);
  const overrides = { ...connector.modelOverrides };
  for (const [id, model] of protectedModels) {
    const saved = previous?.modelOverrides?.[id];
    if (saved) overrides[id] = structuredClone(saved);
    else if (previous && !isMiaowuLegacyVideoBaseConnector(previous)) {
      overrides[id] = structuredClone(Object.fromEntries(["auth", "submit", "poll", "cancel", "output", "statusMap", "pollIntervalMs"]
        .flatMap(key => previous[key as keyof RestConnectorConfig] === undefined ? [] : [[key, previous[key as keyof RestConnectorConfig]]]))) as RestModelConnectorOverride;
    } else delete overrides[id];
    const operationOverrides = Object.fromEntries(model.operations.flatMap(operation => {
      const route = previous?.operationOverrides?.[operation];
      return route && operation.startsWith("video.") ? [[operation, structuredClone(route)]] : [];
    }));
    if (Object.keys(operationOverrides).length) overrides[id] = { ...overrides[id], operationOverrides: { ...operationOverrides, ...overrides[id]?.operationOverrides } };
  }
  connector.modelOverrides = overrides;
  return connector;
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
  evidence?: { httpStatus: number; upstreamErrorCode?: string },
): MiaowuKeyScan {
  return {
    status,
    checkedAt: new Date().toISOString(),
    modelIds: [],
    error,
    ...evidence,
  };
}

/**
 * Reads the models granted to one exact 喵呜 key via the free `/v1/models`
 * endpoint plus the same Key's authenticated Dream media directory. The chat
 * compatible directory alone does not enumerate every native media model.
 */
export async function scanMiaowuKeyModels(
  apiKey: string,
  options?: { fetch?: typeof fetch; baseUrl?: string },
): Promise<MiaowuKeyScan> {
  const fetchImpl = options?.fetch ?? providerFetch;
  const base = (options?.baseUrl ?? MIAOWU_BASE_URL).replace(/\/+$/u, "");
  try {
    const response = await fetchImpl(
      `${base.replace(/\/v1$/u, "")}/v1/models`,
      {
        method: "GET",
        redirect: "error",
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const checkedAt = new Date().toISOString();
    if (response.status === 401 || response.status === 403)
      return miaowuScanFailure(
        "unauthorized",
        "喵呜拒绝了当前 API Key（无权限或分组已停用）",
        await readModelDenialEvidence(response),
      );
    if (!response.ok)
      return miaowuScanFailure(
        "failed",
        `喵呜模型扫描失败（HTTP ${response.status}），将保留上次成功模型`,
      );
    const payload = (await readBoundedModelJson(response).catch(
      () => null,
    )) as {
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
    const baseScan: MiaowuKeyScan = {
      status: modelIds.length > 0 ? "live" : "empty",
      checkedAt,
      modelIds,
      openaiModelIds: [...modelIds],
    };
    if (!officialMiaowuBase(base)) return { ...baseScan, complete: true };
    const mediaDirectory = await scanMiaowuMediaDirectory(apiKey, fetchImpl);
    const [videoSchemas, imageSchemas] = await Promise.all([
      scanMiaowuSchemas(apiKey, mediaDirectory, fetchImpl, "video", parseMiaowuVideoSchema),
      scanMiaowuSchemas(apiKey, mediaDirectory, fetchImpl, "image", parseMiaowuImageSchema),
    ]);
    const combined = [...new Set([...modelIds, ...mediaDirectory.models.map(model => model.id)])];
    return { ...baseScan, checkedAt: mediaDirectory.checkedAt, status: combined.length ? "live" : "empty", modelIds: combined,
      complete: mediaDirectory.status === "live" || mediaDirectory.status === "empty", mediaDirectory, videoSchemas, imageSchemas,
      ...(mediaDirectory.error ? { error: mediaDirectory.error } : {}) };
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
  if (
    !connection ||
    connection.config.supplierArchived === true ||
    connection.config.preset !== MIAOWU_PRESET_ID
  )
    return { ...miaowuScanFailure("failed", "喵呜连接不存在"), connection };
  if (!matchesSupplierTemplate(connection))
    return scanAlternateSupplier(connection, options);
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
  const [catalog, freshScan] = await Promise.all([
    loadMiaowuCatalog({
      force: options?.forcePricing,
      ...(options?.fetch ? { fetch: options.fetch } : {}),
    }),
    scanMiaowuKeyModels(apiKey, {
      baseUrl:
        typeof connection.config.baseUrl === "string"
          ? connection.config.baseUrl
          : undefined,
      ...(options?.fetch ? { fetch: options.fetch } : {}),
    }),
  ]);
  const directoryScan = preserveFailedMediaDirectory(freshScan, connection);
  const scan = { ...directoryScan, videoSchemas: schemasForConnection(directoryScan, connection),
    imageSchemas: imageSchemasForConnection(directoryScan, connection) };
  const baseResult: MiaowuConnectionScan = { ...scan, connection };
  if (scan.status !== "live" && scan.status !== "empty")
    return baseResult;

  const scannedSet = new Set(scan.modelIds);
  const configuredGroup = accountModelGroup(connection);
  const catalogModels = miaowuModelsForGroup(catalog, configuredGroup);
  const pricedIds = new Set(catalog.models.map((model) => model.id));
  const callable = modelsFromScannedDirectories(catalogModels, scan, configuredGroup);
  const latest = await repository.getConnection(id);
  if (
    !latest ||
    latest.updatedAt !== connection.updatedAt ||
    latest.encryptedSecret !== connection.encryptedSecret
  ) {
    return baseResult;
  }
  const scanScope = String(latest.config.modelGroup ?? MIAOWU_PRESET_ID);

  const configuredDefault =
    typeof latest.config.defaultModel === "string"
      ? latest.config.defaultModel
      : undefined;
  const connector = refreshedMiaowuConnector(latest, callable);
  const connectedModels = connector.models ?? [];
  const defaultModel = miaowuDefaultModel(connectedModels, configuredDefault);
  const config: JsonObject = {
    ...latest.config,
    ...(miaowuConnectionConfig(
      scanScope,
      defaultModel,
      connectedModels,
    ) as unknown as JsonObject),
    connector: connector as unknown as JsonObject,
    modelCatalogModels: connectedModels as unknown as JsonObject[],
    defaultModel,
    catalogSource: catalog.source,
    catalogCheckedAt: catalog.checkedAt,
    modelScanStatus: scan.status,
    modelScanCheckedAt: scan.checkedAt,
    modelScanComplete: scan.complete ?? true,
    modelScanError: scan.error ?? null,
    miaowuVideoSchemas: scan.videoSchemas as unknown as JsonObject,
    miaowuImageSchemas: scan.imageSchemas as unknown as JsonObject,
    miaowuSchemaCredentialFingerprint: credentialFingerprint(latest),
    miaowuSchemaSupplierSourceId: latest.config.supplierSourceId ?? null,
    miaowuSchemaGroupIdentity: schemaGroupIdentity(latest),
    ...(scan.mediaDirectory ? { miaowuMediaDirectory: scan.mediaDirectory as unknown as JsonObject,
      miaowuOpenaiModelIds: scan.openaiModelIds ?? [], miaowuDirectoryCredentialFingerprint: credentialFingerprint(latest),
      miaowuDirectorySupplierSourceId: latest.config.supplierSourceId ?? null,
      miaowuDirectoryGroup: latest.config.accountKeyGroup ?? scanScope } : {}),
    scannedModelIds: [...scan.modelIds],
    unavailableModels: catalogModels
      .filter((model) => !scannedSet.has(model.id))
      .map((model) => model.id),
    unknownModels: scan.modelIds.filter((modelId) => !pricedIds.has(modelId)),
  };
  clearEmptyScanConfirmation(config);
  if (JSON.stringify(latest.config) === JSON.stringify(config))
    return { ...baseResult, connection: latest };
  // A non-persisting read still returns this scan's contracts and prices. The
  // API must not label an old connector with the fresh directory's provenance.
  if (options?.persist === false)
    return { ...baseResult, connection: { ...latest, config } };
  const saved = await repository.saveConnection(
    {
      id: latest.id,
      name: latest.name,
      provider: "rest",
      encryptedSecret: latest.encryptedSecret,
      config,
    },
    { expected: latest },
  );
  return { ...baseResult, connection: saved };
}

async function syncMiaowuConnectionFromCatalog(
  connection: ProviderConnectionRecord | null,
  catalog: MiaowuCatalogSnapshot,
) {
  if (
    !connection ||
    connection.config.supplierArchived === true ||
    connection.config.preset !== MIAOWU_PRESET_ID
  )
    return connection;
  const displayGroupId =
    typeof connection.config.modelGroup === "string"
      ? connection.config.modelGroup
      : undefined;
  const groupId = accountModelGroup(connection);
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
  const models =
    scanStatus === "empty"
      ? []
      : scanStatus === "live"
        ? modelsFromScannedDirectories(catalogModels, { status: "live", checkedAt: String(connection.config.modelScanCheckedAt ?? ""), modelIds: scannedModelIds,
            ...(Array.isArray(connection.config.miaowuOpenaiModelIds) ? { openaiModelIds: configuredModelIds(connection.config.miaowuOpenaiModelIds) } : {}),
            ...(connection.config.miaowuMediaDirectory ? { mediaDirectory: connection.config.miaowuMediaDirectory as unknown as MiaowuMediaDirectory } : {}),
            videoSchemas: cachedSchemasForConnection(connection), imageSchemas: cachedImageSchemasForConnection(connection) }, groupId)
        : catalogModels;
  if (models.length === 0 && !authoritativeScan) return connection;
  const configuredDefault =
    typeof connection.config.defaultModel === "string"
      ? connection.config.defaultModel
      : undefined;
  const connector = refreshedMiaowuConnector(connection, models);
  const connectedModels = connector.models ?? [];
  const defaultModel = miaowuDefaultModel(connectedModels, configuredDefault);
  const config: JsonObject = {
    ...connection.config,
    ...(miaowuConnectionConfig(
      displayGroupId,
      defaultModel,
      connectedModels,
    ) as unknown as JsonObject),
    connector: connector as unknown as JsonObject,
    modelCatalogModels: connectedModels as unknown as JsonObject[],
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
  return getRepository().saveConnection(
    {
      id: connection.id,
      name: connection.name,
      provider: "rest",
      encryptedSecret: connection.encryptedSecret,
      config,
    },
    { expected: connection },
  );
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
