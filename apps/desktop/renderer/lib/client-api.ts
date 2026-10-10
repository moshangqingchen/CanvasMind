import type { ModelDescriptor } from "@super-canvas/providers";
import { tk1688ConnectionWriteConfig } from "./tk1688-connection-write";
import { createSharedRequest } from "./shared-request";
import type { CangyuanAvailabilitySnapshot, CangyuanAvailabilityStatus } from "./cangyuan-availability-types";
export type { CangyuanAvailabilityStatus } from "./cangyuan-availability-types";
import type {
  AssetView,
  CanvasDocument,
  RunSnapshot,
} from "../components/types";
import {
  canvasRequestUrlPreferLocal,
} from "./asset-download";

const MODEL_LIST_CACHE_TTL_MS = 60_000;
const CANVAS_REQUEST_ATTEMPTS = 3;
const CANVAS_REQUEST_TIMEOUT_MS = 12_000;
const RUN_READ_TIMEOUT_MS = 15_000;

interface ModelInventoryStatus {
  scanStatus?: string;
  complete?: boolean;
}
interface ModelListCacheEntry extends ModelInventoryStatus {
  items: ModelDescriptor[];
  expiresAt: number;
}
interface ModelInventoryResponse extends ModelInventoryStatus {
  items: ModelDescriptor[];
}

class ProviderModelsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly scanStatus?: string,
  ) {
    super(message);
    this.name = "ProviderModelsRequestError";
  }
}

const modelEpochs = new Map<string, number>();
const modelListCache = new Map<string, ModelListCacheEntry>();
const pendingModelRequests = new Map<string, Promise<ModelDescriptor[]>>();
const connectionModelVersions = new Map<string, string>();

export function getCachedModels(id: string): ModelDescriptor[] | undefined {
  const cached = modelListCache.get(id);
  return cached ? [...cached.items] : undefined;
}

/** Response provenance for display only; the public model-array API is unchanged. */
export function getCachedModelInventoryStatus(id: string): ModelInventoryStatus | undefined {
  const cached = modelListCache.get(id);
  return cached ? { scanStatus: cached.scanStatus, complete: cached.complete } : undefined;
}

export function invalidateModelCache(id: string): void {
  modelEpochs.set(id, (modelEpochs.get(id) ?? 0) + 1);
  modelListCache.delete(id);
  pendingModelRequests.delete(id);
}

export interface CanvasResponse {
  id: string;
  title: string;
  graph: CanvasDocument;
  revision: number;
}

export class CanvasSaveConflictError extends Error {
  readonly code = "CANVAS_REVISION_CONFLICT";

  constructor(
    readonly currentRevision: number,
    message = "画布已在其他位置更新，请先处理版本冲突",
  ) {
    super(message);
    this.name = "CanvasSaveConflictError";
  }
}

interface CanvasIssuePayload {
  error?: unknown;
  issues?: unknown;
}

export function canvasErrorMessage(
  payload: CanvasIssuePayload | null,
  fallback: string,
): string {
  const base =
    typeof payload?.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : fallback;
  if (!Array.isArray(payload?.issues)) return base;

  const messages = payload.issues
    .map((issue) => {
      if (!issue || typeof issue !== "object" || Array.isArray(issue))
        return null;
      const message = (issue as { message?: unknown }).message;
      return typeof message === "string" && message.trim()
        ? message.trim().slice(0, 240)
        : null;
    })
    .filter((message): message is string => Boolean(message))
    .slice(0, 3);
  if (messages.length === 0) return base;
  const suffix = messages.join("；");
  return `${base}：${suffix}${payload.issues.length > messages.length ? "；…" : ""}`;
}

export interface MaterialDropEventView {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  screenX: number;
  screenY: number;
  previewAvailable: boolean;
  createdAt: string;
}

export interface ImportedMediaSourcesResult {
  assets: AssetView[];
  failures: Array<{ index: number; message: string }>;
}

export interface ProviderConnectionView {
  /** Returned by a Key save; the server owns the ensuing scan and paid probes. */
  verificationScheduled?: boolean;
  id: string;
  name: string;
  provider: string;
  config: Record<string, unknown>;
  apiKeySet: boolean;
  apiKeyUsable?: boolean;
  apiKey: string;
}

export type AppUpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "waiting_for_idle"
  | "applying"
  | "failed";

export interface AppUpdateView {
  desktop?: boolean;
  formatVersion: 1;
  enabled: boolean;
  repository: string;
  intervalSeconds: number;
  managerAvailable: boolean;
  currentVersion: string;
  currentNotes?: string;
  currentCommit?: string;
  phase: AppUpdatePhase;
  latest?: {
    version: string;
    tag: string;
    commit?: string;
    publishedAt?: string;
    htmlUrl?: string;
    notes?: string;
    assetName?: string;
    assetSize?: number;
  };
  downloadedVersion?: string;
  progress?: {
    downloadedBytes: number;
    totalBytes?: number;
    bytesPerSecond?: number;
    estimatedRemainingSeconds?: number;
  };
  download?: {
    mode: "preparing" | "differential" | "full" | "cached";
    fallback?: boolean;
    reason?: string;
  };
  diagnostic?: {
    stage: "check" | "download" | "verify" | "apply";
    category: "network" | "timeout" | "not-found" | "http" | "cache" | "checksum" | "signature" | "configuration" | "unknown";
    code?: string;
    statusCode?: number;
    retryable?: boolean;
  };
  lastCheckedAt?: string;
  lastSuccessfulCheckAt?: string;
  error?: string;
  deferredVersion?: string;
  updatedAt: string;
}

export async function fetchAppUpdate(): Promise<AppUpdateView> {
  if (typeof window === "undefined" || !window.superCanvasDesktop) throw new Error("请在桌面 App 中检查更新");
  return window.superCanvasDesktop.getUpdate();
}
export async function requestAppUpdate(action: "check" | "download" | "apply" | "defer"): Promise<void> {
  if (typeof window === "undefined" || !window.superCanvasDesktop) throw new Error("请在桌面 App 中更新");
  return window.superCanvasDesktop.update(action);
}

export interface CangyuanMarketplaceModelView {
  id: string;
  name: string;
  description?: string;
  capability: "chat" | "image" | "video" | "other";
  priceLabel: string;
  billingLabel: string;
  tags: string[];
  endpointTypes: string[];
  canvasRunnable?: boolean;
  canvasUnavailableReason?: string;
}

export interface CangyuanMarketplaceGroupView {
  id: string;
  description: string;
  ratio: number;
  canvasSupported: boolean;
  canvasModelCount?: number;
  models: CangyuanMarketplaceModelView[];
  scanStatus?: "live" | "empty" | "unauthorized" | "unconfigured" | "failed";
  scanCheckedAt?: string;
  scanError?: string;
  scannedModelCount?: number;
}

export type CangyuanAvailabilitySnapshotView = CangyuanAvailabilitySnapshot & {
  source: "live" | "cache" | "stale";
};

export interface ProjectChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ProjectSummaryView {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodeCount?: number;
  previewAssetId?: string;
}

export async function fetchProjects(): Promise<ProjectSummaryView[]> {
  const response = await fetch("/api/projects", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as {
    projects?: ProjectSummaryView[];
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? "项目列表读取失败");
  if (!Array.isArray(payload?.projects)) throw new Error("项目列表返回格式无效，请重试");
  return payload.projects;
}

export async function createProject(
  title: string,
): Promise<ProjectSummaryView> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const payload = (await response.json().catch(() => null)) as {
    project?: ProjectSummaryView;
    error?: string;
  } | null;
  if (!response.ok || !payload?.project)
    throw new Error(payload?.error ?? "项目创建失败");
  return payload.project;
}

export interface RenameProjectResult {
  project: ProjectSummaryView;
  revision: number;
  folderRenamed: boolean;
}

export async function renameProject(
  projectId: string,
  title: string,
): Promise<RenameProjectResult> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    project?: ProjectSummaryView;
    revision?: number;
    folderRenamed?: boolean;
    error?: string;
  } | null;
  if (!response.ok || !payload?.project || typeof payload.revision !== "number")
    throw new Error(payload?.error ?? "项目重命名失败");
  return {
    project: payload.project,
    revision: payload.revision,
    folderRenamed: payload.folderRenamed === true,
  };
}

export async function fetchProjectChat(
  projectId: string,
): Promise<ProjectChatMessageView[]> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/chat`,
    { cache: "no-store" },
  );
  const payload = (await response.json().catch(() => null)) as {
    messages?: ProjectChatMessageView[];
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? "项目对话读取失败");
  return Array.isArray(payload?.messages) ? payload.messages : [];
}

export async function clearProjectChat(projectId: string): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/chat`,
    { method: "DELETE" },
  );
  if (!response.ok)
    throw new Error(
      ((await response.json().catch(() => null)) as { error?: string } | null)
        ?.error ?? "项目对话清理失败",
    );
}

export async function cleanupProjectDraft(projectId: string): Promise<{
  deleted: number;
  failed: Array<{ path: string; message: string }>;
}> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/cleanup`,
    { method: "POST" },
  );
  const payload = (await response.json().catch(() => null)) as {
    deleted?: number;
    failed?: Array<{ path: string; message: string }>;
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? "项目草稿清理失败");
  return {
    deleted: typeof payload?.deleted === "number" ? payload.deleted : 0,
    failed: Array.isArray(payload?.failed) ? payload.failed : [],
  };
}

export async function openProjectFolder(projectId: string): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/open-folder`,
    { method: "POST" },
  );
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    opened?: boolean;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? "项目文件夹打开失败");
  if (payload?.opened === false)
    throw new Error(payload.error ?? "当前环境不支持自动打开项目文件夹");
}

export async function deleteProject(projectId: string): Promise<{
  nextProjectId: string | null;
  folderDeleted: boolean;
  warning?: string;
}> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "DELETE",
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    nextProjectId?: string | null;
    folderDeleted?: boolean;
    warning?: string;
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? "项目删除失败");
  return {
    nextProjectId:
      typeof payload?.nextProjectId === "string" ? payload.nextProjectId : null,
    folderDeleted: payload?.folderDeleted === true,
    ...(payload?.warning ? { warning: payload.warning } : {}),
  };
}

function retryableCanvasStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

interface CanvasJsonResult<T> {
  response: Response;
  payload: T | null;
}

async function readCanvasJson<T>(
  response: Response,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => {
        onTimeout();
        reject(new Error("画布响应读取超时"));
      },
      Math.max(0, timeoutMs),
    );
  });
  try {
    // AbortSignal is the first line of defence for native fetch. The explicit
    // race is the final guard for custom transports whose body reader ignores
    // an aborted signal and would otherwise keep initialization pending.
    const body = await Promise.race([
      Promise.resolve().then(() => response.text()),
      deadline,
    ]);
    if (!body) return null;
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function fetchCanvasJsonWithRetry<T>(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<CanvasJsonResult<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < CANVAS_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const deadlineAt = Date.now() + CANVAS_REQUEST_TIMEOUT_MS;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const requestDeadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("画布请求超时"));
      }, CANVAS_REQUEST_TIMEOUT_MS);
    });
    try {
      const response = await Promise.race([
        fetch(input, {
          ...init,
          signal: controller.signal,
        }),
        requestDeadline,
      ]);
      const finalAttempt = attempt === CANVAS_REQUEST_ATTEMPTS - 1;
      if (
        response.ok ||
        !retryableCanvasStatus(response.status) ||
        finalAttempt
      ) {
        // Keep the same deadline active while consuming the body. Returning a
        // Response here and clearing the timer first can leave response.json()
        // pending forever behind the canvas loading screen.
        return {
          response,
          payload: await readCanvasJson(
            response,
            Math.max(0, deadlineAt - Date.now()),
            () => controller.abort(),
          ),
        };
      }
      // Release a retryable response before opening another connection.
      void response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    if (attempt < CANVAS_REQUEST_ATTEMPTS - 1)
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("画布服务暂时不可用");
}

export async function fetchCanvas(canvasId?: string): Promise<CanvasResponse> {
  const { response, payload } = await fetchCanvasJsonWithRetry<CanvasResponse>(
    canvasId ? `/api/canvas/${encodeURIComponent(canvasId)}` : "/api/canvas",
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("无法读取画布");
  if (!payload) throw new Error("画布响应无效，请重新加载页面");
  return payload;
}

export async function saveCanvas(
  canvasId: string,
  graph: CanvasDocument,
  title?: string,
  expectedRevision?: number,
): Promise<CanvasResponse> {
  const { response, payload } = await fetchCanvasJsonWithRetry<
    Partial<CanvasResponse> & {
      error?: unknown;
      code?: unknown;
      currentRevision?: unknown;
      issues?: unknown;
    }
  >(`/api/canvas/${encodeURIComponent(canvasId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graph, title, expectedRevision }),
  });
  if (!response.ok) {
    if (
      response.status === 409 &&
      payload?.code === "CANVAS_REVISION_CONFLICT" &&
      typeof payload.currentRevision === "number" &&
      Number.isSafeInteger(payload.currentRevision) &&
      payload.currentRevision >= 0
    ) {
      throw new CanvasSaveConflictError(
        payload.currentRevision,
        typeof payload.error === "string" ? payload.error : undefined,
      );
    }
    throw new Error(canvasErrorMessage(payload, "画布保存失败"));
  }
  if (!payload?.id || !payload.graph || typeof payload.revision !== "number")
    throw new Error("画布保存响应无效");
  return payload as CanvasResponse;
}

export async function fetchAssets(): Promise<AssetView[]> {
  const response = await fetch("/api/assets", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取素材库");
  return response.json() as Promise<AssetView[]>;
}

export async function fetchAsset(assetId: string, signal?: AbortSignal): Promise<AssetView> {
  const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  });
  if (response.status === 404) throw new Error("素材不存在，无法打开原图");
  if (!response.ok) throw new Error("素材读取失败，请再次双击重试");
  const asset = await response.json() as AssetView & { deleted?: boolean };
  if (asset?.deleted) throw new Error("素材不存在，无法打开原图");
  if (asset?.id !== assetId || !asset.kind || !asset.metadata)
    throw new Error("素材信息无效，请再次双击重试");
  return asset;
}

export interface DeleteAssetsResult {
  deletedIds: string[];
  failedIds: string[];
}

const DELETE_ASSETS_BATCH_SIZE = 500;

async function deleteAssetsBatch(
  assetIds: readonly string[],
): Promise<DeleteAssetsResult> {
  try {
    const response = await fetch("/api/assets/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetIds }),
    });
    if (!response.ok) return { deletedIds: [], failedIds: [...assetIds] };
    const payload = (await response.json()) as Partial<DeleteAssetsResult>;
    return {
      deletedIds: Array.isArray(payload.deletedIds) ? payload.deletedIds : [],
      failedIds: Array.isArray(payload.failedIds)
        ? payload.failedIds
        : [...assetIds],
    };
  } catch {
    return { deletedIds: [], failedIds: [...assetIds] };
  }
}

export async function deleteAssets(
  assetIds: readonly string[],
): Promise<DeleteAssetsResult> {
  const uniqueAssetIds = Array.from(new Set(assetIds));
  if (uniqueAssetIds.length === 0) return { deletedIds: [], failedIds: [] };

  const deletedIds: string[] = [];
  const failedIds: string[] = [];
  for (
    let start = 0;
    start < uniqueAssetIds.length;
    start += DELETE_ASSETS_BATCH_SIZE
  ) {
    const result = await deleteAssetsBatch(
      uniqueAssetIds.slice(start, start + DELETE_ASSETS_BATCH_SIZE),
    );
    deletedIds.push(...result.deletedIds);
    failedIds.push(...result.failedIds);
  }
  return { deletedIds, failedIds };
}

export async function fetchMaterialDrops(): Promise<MaterialDropEventView[]> {
  const response = await fetch("/api/integrations/material-drops", {
    cache: "no-store",
  });
  if (!response.ok) return [];
  return response.json() as Promise<MaterialDropEventView[]>;
}

export async function archiveProjectAssets(
  projectId: string,
  assetIds: readonly string[],
): Promise<void> {
  if (!projectId || assetIds.length === 0) return;
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/archive`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetIds }),
    },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "素材归档失败",
    );
}

export async function claimMaterialDrop(id: string): Promise<AssetView> {
  const response = await fetch("/api/integrations/material-drops", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "素材拖入失败",
    );
  return response.json() as Promise<AssetView>;
}

export async function discardMaterialDrop(id: string): Promise<void> {
  await fetch("/api/integrations/material-drops", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function uploadAsset(file: File): Promise<AssetView> {
  const id = crypto.randomUUID();
  const url = await canvasRequestUrlPreferLocal(
    `/api/assets/upload?name=${encodeURIComponent(file.name)}&id=${id}`,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
      credentials: "same-origin",
      mode: "same-origin",
    });
  } catch (error) {
    throw new Error(error instanceof Error && error.message
      ? `素材上传连接失败：${error.message}` : "素材上传连接失败");
  }
  if (!response.ok) throw new Error(
    (await response.json().catch(() => null))?.error ?? `素材上传失败 (${response.status})`,
  );
  return response.json() as Promise<AssetView>;
}

/**
 * Imports URLs and WeChat cache paths through the local canvas service. This
 * is the fallback for desktop drags that do not expose a browser-readable
 * File, and for CDN URLs blocked by browser CORS.
 */
export async function importDroppedMediaSources(
  sources: readonly string[],
): Promise<ImportedMediaSourcesResult> {
  const requestUrl = await canvasRequestUrlPreferLocal(
    "/api/assets/import-source",
  );
  const sameOrigin = requestUrl.origin === window.location.origin;
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources }),
    credentials: sameOrigin ? "same-origin" : "omit",
    mode: sameOrigin ? "same-origin" : "cors",
  });
  const payload = (await response.json().catch(() => null)) as
    (Partial<ImportedMediaSourcesResult> & { error?: string }) | null;
  if (!response.ok && response.status !== 422)
    throw new Error(payload?.error ?? "无法下载拖入的素材");
  return {
    assets: Array.isArray(payload?.assets) ? payload.assets : [],
    failures: Array.isArray(payload?.failures) ? payload.failures : [],
  };
}

export async function createRun(input: {
  canvasId: string;
  clientRequestId: string;
  scope: "node" | "downstream" | "all";
  nodeId?: string;
}): Promise<RunSnapshot> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const message = (await response.json().catch(() => null))?.error ?? "运行创建失败";
    if (response.status >= 500 || response.status === 408) throw new TypeError(message);
    throw new Error(message);
  }
  try { return await response.json() as RunSnapshot; }
  catch { throw new TypeError("任务提交响应不完整，请核对原任务"); }
}

/** One bounded read; the caller owns polling and no generation request is retried. */
async function readRunJson<T>(url: string, fallback: string, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let response: Response | undefined;
  let rejectStopped!: (reason: unknown) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const cancelBody = () => {
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
  };
  const stop = (reason: unknown) => {
    rejectStopped(reason);
    controller.abort(reason);
    cancelBody();
  };
  const onAbort = () => stop(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => stop(new Error("运行状态读取超时，请稍后重试")), RUN_READ_TIMEOUT_MS);
  const request = async () => {
    response = await fetch(url, { cache: "no-store", signal: controller.signal });
    // A custom transport may deliver headers even after cancellation.
    if (controller.signal.aborted) {
      cancelBody();
      controller.signal.throwIfAborted();
    }
    if (!response.ok) {
      cancelBody();
      throw new Error(fallback);
    }
    return response.json() as Promise<T>;
  };
  try {
    // Keep the deadline through JSON consumption, including transports that
    // do not reject their body reader when its request signal is aborted.
    return await Promise.race([request(), stopped]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchRun(
  runId: string,
  options: { details?: boolean; signal?: AbortSignal } = {},
): Promise<RunSnapshot> {
  return readRunJson(`/api/runs/${encodeURIComponent(runId)}${options.details ? "?details=1" : ""}`,
    "无法读取运行状态", options.signal);
}

export async function resumeRun(runId: string): Promise<RunSnapshot> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    method: "POST",
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "运行恢复失败",
    );
  return response.json() as Promise<RunSnapshot>;
}

export async function recoverRunOutputs(runId: string): Promise<RunSnapshot> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/recover-outputs`, {
    method: "POST",
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "取回已有图片失败",
    );
  return response.json() as Promise<RunSnapshot>;
}

export async function fetchRuns(canvasId: string): Promise<RunSnapshot[]> {
  const response = await fetch(
    `/api/runs?canvasId=${encodeURIComponent(canvasId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("无法读取运行历史");
  return response.json() as Promise<RunSnapshot[]>;
}

export async function fetchVisibleRuns(
  canvasId: string,
  runIds: readonly string[],
  clientRequestIds: readonly string[],
): Promise<RunSnapshot[]> {
  // Match the API's per-field limit. A run can appear once per generated
  // image, so deduplication must happen before constructing the query.
  const uniqueRunIds = [...new Set(runIds)];
  const uniqueRequestIds = [...new Set(clientRequestIds)];
  const batchSize = 50;
  const batchCount = Math.ceil(Math.max(uniqueRunIds.length, uniqueRequestIds.length) / batchSize);
  const snapshots = new Map<string, RunSnapshot>();
  for (let start = 0; start < batchCount; start += 4) {
    const batches = await Promise.all(
      Array.from({ length: Math.min(4, batchCount - start) }, async (_, offset) => {
        const from = (start + offset) * batchSize;
        const query = new URLSearchParams({ canvasId });
        const runs = uniqueRunIds.slice(from, from + batchSize);
        const requests = uniqueRequestIds.slice(from, from + batchSize);
        if (runs.length) query.set("runIds", runs.join(","));
        if (requests.length) query.set("clientRequestIds", requests.join(","));
        return readRunJson<RunSnapshot[]>(`/api/runs?${query.toString()}`, "无法读取当前运行状态");
      }),
    );
    for (const snapshot of batches.flat()) {
      const previous = snapshots.get(snapshot.run.id);
      if (!previous || (snapshot.run.updatedAt ?? snapshot.run.createdAt) >=
        (previous.run.updatedAt ?? previous.run.createdAt)) {
        snapshots.set(snapshot.run.id, snapshot);
      }
    }
  }
  // Reconciliation must see a complete response, never a successful subset
  // of batches. Newest first matches the run-history API and its consumers.
  return [...snapshots.values()].sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
}

const connectionRequests = createSharedRequest(async (): Promise<ProviderConnectionView[]> => {
  const response = await fetch(`/api/providers?fresh=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("无法读取供应商连接");
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("供应商连接返回格式无效，请重试");
  return payload as ProviderConnectionView[];
});

export function invalidateConnections(): void {
  connectionRequests.invalidate();
}

export function fetchConnections(): Promise<ProviderConnectionView[]> {
  // Reconcile only the shared reader's accepted result. A late pre-mutation
  // response must not invalidate a newer scan's model cache or pending request.
  return connectionRequests.read().then((connections) => {
    const present = new Set<string>();
    for (const connection of connections) {
      present.add(connection.id);
      const config = connection.config ?? {};
      const version = JSON.stringify([connection.provider, connection.apiKeySet, connection.apiKeyUsable,
        ...["baseUrl", "protocol", "preset", "supplierId", "supplierSourceId", "supplierArchived",
          "accountKeyId", "accountKeyGroupId", "accountKeyGroup", "modelGroup", "usage",
          "modelScanRequestId", "modelScanCheckedAt", "modelScanLastSuccessAt", "modelScanStatus",
          "modelScanAttemptStatus", "modelScanComplete", "scannedModelIds", "modelCatalogModels"].map(field => config[field])]);
      if (connectionModelVersions.get(connection.id) !== version &&
          (connectionModelVersions.has(connection.id) || modelListCache.has(connection.id) || pendingModelRequests.has(connection.id)))
        invalidateModelCache(connection.id);
      connectionModelVersions.set(connection.id, version);
    }
    for (const id of connectionModelVersions.keys()) {
      if (present.has(id)) continue;
      invalidateModelCache(id);
      connectionModelVersions.delete(id);
    }
    return connections;
  });
}

export async function saveConnection(input: {
  id?: string;
  name: string;
  provider: string;
  apiKey?: string;
  config: Record<string, unknown>;
}): Promise<ProviderConnectionView> {
  const response = await fetch("/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, config: tk1688ConnectionWriteConfig(input.id, input.config) }),
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "供应商连接保存失败",
    );
  const saved = (await response.json()) as ProviderConnectionView;
  invalidateConnections();
  invalidateModelCache(saved.id);
  return saved;
}

export async function saveReferenceImageHosting(id: string, enabled: boolean): Promise<ProviderConnectionView> {
  const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ referenceImageHosting: enabled ? "litterbox-24h" : "disabled" }),
  });
  if (!response.ok)
    throw new Error((await response.json().catch(() => null))?.error ?? "参考图链接设置保存失败");
  invalidateConnections();
  return response.json() as Promise<ProviderConnectionView>;
}

export interface ProviderConnectionTestResult {
  message: string;
  models: ModelDescriptor[];
  status?: string;
  checkedAt?: string;
  lastSuccessAt?: string;
  source?: string;
}

/** Preserve authentication and retry status while remaining compatible with Error callers. */
export class ProviderConnectionTestError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly scanStatus?: string) {
    super(message);
    this.name = "ProviderConnectionTestError";
  }
}

/** Reuse this exact scan in settings instead of issuing a second model refresh. */
export async function testConnectionDetails(id: string): Promise<ProviderConnectionTestResult> {
  const epoch = modelEpochs.get(id) ?? 0;
  const response = await fetch(
    `/api/providers/${encodeURIComponent(id)}/test`,
    { method: "POST" },
  );
  const payload: unknown = await response.json().catch(() => null);
  if ((modelEpochs.get(id) ?? 0) !== epoch)
    throw new ProviderConnectionTestError("连接已改变，请重新测试", 409);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error : "连接测试失败";
    throw new ProviderConnectionTestError(message, response.status,
      response.headers.get("X-Model-Scan-Status") ?? undefined);
  }
  const result = payload as Record<string, unknown> | null;
  if (!result || !Array.isArray(result.models))
    throw new ProviderConnectionTestError("连接测试返回了无效模型列表，请重试", response.status);
  if (["stale", "failed", "unauthorized"].includes(String(result.status)))
    throw new ProviderConnectionTestError("本次连接测试未完成，已有模型与配置已保留，请稍后重试",
      response.status, String(result.status));
  invalidateModelCache(id);
  return {
    message: typeof result.message === "string" ? result.message : "连接测试成功",
    models: result.models as ModelDescriptor[],
    ...Object.fromEntries(["status", "checkedAt", "lastSuccessAt", "source"]
      .filter(key => typeof result[key] === "string").map(key => [key, result[key]])),
  };
}

/** Compatibility for callers that only display the test message. */
export async function testConnection(id: string): Promise<string> {
  return (await testConnectionDetails(id)).message;
}

async function fetchModelsUncached(
  id: string,
  refresh = false,
  clearUnavailable = false,
): Promise<ModelInventoryResponse> {
  const query = new URLSearchParams({ fresh: String(Date.now()) });
  if (refresh) query.set("refresh", "1");
  if (clearUnavailable) query.set("clearUnavailable", "1");
  const response = await fetch(
    `/api/providers/${encodeURIComponent(id)}/models?${query.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    throw new ProviderModelsRequestError(
      typeof payload?.error === "string" ? payload.error : "无法读取供应商模型",
      response.status,
      response.headers.get("X-Model-Scan-Status") ?? undefined,
    );
  }
  const status = response.headers.get("X-Model-Scan-Status") ?? "";
  const complete = response.headers.get("X-Model-Scan-Complete");
  return { items: await response.json() as ModelDescriptor[],
    ...(["live", "empty", "stale", "failed", "unauthorized", "unscanned", "partial"].includes(status) ? { scanStatus: status } : {}),
    ...(complete === "true" || complete === "false" ? { complete: complete === "true" } : {}) };
}

function cacheModels(id: string, items: readonly ModelDescriptor[], status: ModelInventoryStatus = {}) {
  modelListCache.set(id, {
    items: [...items],
    expiresAt: Date.now() + MODEL_LIST_CACHE_TTL_MS,
    scanStatus: status.scanStatus,
    complete: status.complete,
  });
  return [...items];
}

export async function fetchModels(id: string): Promise<ModelDescriptor[]> {
  const cached = modelListCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return [...cached.items];

  const pending = pendingModelRequests.get(id);
  if (pending) return pending;

  const epoch = modelEpochs.get(id) ?? 0;
  const request = fetchModelsUncached(id).then((result) => {
    if ((modelEpochs.get(id) ?? 0) !== epoch) throw new ProviderModelsRequestError("连接已改变，请重新读取模型", 409);
    return cacheModels(id, result.items, result);
  });
  pendingModelRequests.set(id, request);
  try {
    return await request;
  } finally {
    if (pendingModelRequests.get(id) === request)
      pendingModelRequests.delete(id);
  }
}

/** Performs one explicit upstream refresh; transient failures keep the snapshot. */
export async function refreshModels(
  id: string,
  options?: { clearUnavailable?: boolean },
): Promise<ModelDescriptor[]> {
  const previous = getCachedModels(id);
  invalidateModelCache(id);
  const epoch = modelEpochs.get(id);
  const request = fetchModelsUncached(
    id,
    true,
    options?.clearUnavailable === true,
  )
    .then((result) => { if (modelEpochs.get(id) !== epoch) throw new ProviderModelsRequestError("连接已改变，请重新读取模型", 409); return cacheModels(id, result.items, result); })
    .catch((error: unknown) => {
      // A refresh is advisory. Keep the last successful inventory during
      // transient network/5xx failures so an otherwise usable canvas does not
      // lose its model selector. Authentication failures must remain hard
      // failures so a revoked key is never used silently.
      const status =
        error instanceof ProviderModelsRequestError ? error.status : undefined;
      const scanStatus =
        error instanceof ProviderModelsRequestError
          ? error.scanStatus
          : undefined;
      const retryable =
        status !== 401 &&
        status !== 403 &&
        (status === undefined ||
          status === 408 ||
          status === 425 ||
          status === 429 ||
          status >= 500 ||
          scanStatus === "failed");
      if (modelEpochs.get(id) === epoch && retryable && previous && previous.length > 0)
        return cacheModels(id, previous, { scanStatus: "stale", complete: false });
      throw error;
    });
  pendingModelRequests.set(id, request);
  try {
    return await request;
  } finally {
    if (pendingModelRequests.get(id) === request)
      pendingModelRequests.delete(id);
  }
}

const availabilityCache = new Map<
  string,
  { expiresAt: number; snapshot: CangyuanAvailabilitySnapshotView }
>();
const pendingAvailability = new Map<
  string,
  Promise<CangyuanAvailabilitySnapshotView>
>();

/** Share polling between nodes and menus; the server also applies account-wide throttling. */
export async function fetchCangyuanAvailability(
  connectionId: string,
  options?: {
    name?: string;
    category?: "text" | "image" | "video" | "audio";
    latestStatus?: CangyuanAvailabilityStatus;
  },
): Promise<CangyuanAvailabilitySnapshotView> {
  const query = new URLSearchParams();
  if (options?.name?.trim()) query.set("name", options.name.trim());
  if (options?.category) query.set("category", options.category);
  if (options?.latestStatus) query.set("latest_status", options.latestStatus);
  const suffix = query.size ? `?${query.toString()}` : "";
  const epoch = modelEpochs.get(connectionId) ?? 0;
  const key = `${connectionId}:${epoch}:${suffix}`;
  const cached = availabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now())
    return {
      ...cached.snapshot,
      source: cached.snapshot.ready ? "cache" : cached.snapshot.source,
    };
  const pending = pendingAvailability.get(key);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(
      `/api/providers/${encodeURIComponent(connectionId)}/availability${suffix}`,
      { cache: "no-store" },
    );
    const payload = (await response.json().catch(() => null)) as
      (Partial<CangyuanAvailabilitySnapshotView> & { error?: string }) | null;
    if (!response.ok)
      throw new Error(payload?.error ?? "沧元渠道可用性状态读取失败");
    if (
      !payload ||
      typeof payload.ready !== "boolean" ||
      typeof payload.enabled !== "boolean" ||
      typeof payload.checkedAt !== "string" ||
      !Array.isArray(payload.items) ||
      !["live", "cache", "stale"].includes(String(payload.source))
    )
      throw new Error("沧元渠道可用性返回格式不完整");
    const snapshot = payload as CangyuanAvailabilitySnapshotView;
    if ((modelEpochs.get(connectionId) ?? 0) !== epoch)
      throw new ProviderModelsRequestError("连接已改变，请重新读取渠道状态", 409);
    // Bound memory when connection credentials are repeatedly changed.
    if (availabilityCache.size >= 128)
      availabilityCache.delete(availabilityCache.keys().next().value!);
    availabilityCache.set(key, { expiresAt: Date.now() + 30_000, snapshot });
    return snapshot;
  })();
  pendingAvailability.set(key, request);
  try {
    return await request;
  } finally {
    pendingAvailability.delete(key);
  }
}

export async function deleteConnection(id: string): Promise<void> {
  const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("删除供应商连接失败");
  invalidateConnections();
  invalidateModelCache(id);
}
