import type { ModelDescriptor } from "@super-canvas/providers";
import type {
  AssetView,
  CanvasDocument,
  RunSnapshot,
} from "../components/types";
import {
  canvasRequestUrlPreferLocal,
  canvasRequestUrlsWithFallback,
} from "./asset-download";

const MODEL_LIST_CACHE_TTL_MS = 60_000;
const CANVAS_REQUEST_ATTEMPTS = 3;
const CANVAS_REQUEST_TIMEOUT_MS = 12_000;

interface ModelListCacheEntry {
  items: ModelDescriptor[];
  expiresAt: number;
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

const modelListCache = new Map<string, ModelListCacheEntry>();
const pendingModelRequests = new Map<string, Promise<ModelDescriptor[]>>();

export function getCachedModels(id: string): ModelDescriptor[] | undefined {
  const cached = modelListCache.get(id);
  return cached ? [...cached.items] : undefined;
}

export function invalidateModelCache(id: string): void {
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
  formatVersion: 1;
  enabled: boolean;
  repository: string;
  intervalSeconds: number;
  managerAvailable: boolean;
  currentVersion: string;
  currentNotes?: string;
  currentCommit?: string;
  remoteBranch?: string;
  remoteCommit?: string;
  remoteCommitUrl?: string;
  remoteUpdateAvailable?: boolean;
  remoteSyncState?:
    | "up_to_date"
    | "synced"
    | "available"
    | "blocked_dirty"
    | "blocked"
    | "branch_mismatch"
    | "repository_mismatch"
    | "unavailable"
    | "error";
  remoteSyncError?: string;
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
  progress?: { downloadedBytes: number; totalBytes?: number };
  lastCheckedAt?: string;
  lastSuccessfulCheckAt?: string;
  error?: string;
  deferredVersion?: string;
  updatedAt: string;
}

export async function fetchAppUpdate(): Promise<AppUpdateView> {
  const response = await fetch("/api/app-update", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取应用更新状态");
  return response.json() as Promise<AppUpdateView>;
}

export async function requestAppUpdate(
  action: "check" | "download" | "apply" | "defer",
  version?: string,
): Promise<void> {
  const response = await fetch("/api/app-update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...(version ? { version } : {}) }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error || "更新操作失败");
  }
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

export type CangyuanAvailabilityStatus =
  | "operational"
  | "degraded"
  | "unavailable"
  | "unknown";

export interface CangyuanAvailabilityView {
  name: string;
  category: string;
  latestStatus: CangyuanAvailabilityStatus;
  availability: number | null;
  averageLatencyMs: number | null;
  timeline: unknown[];
}

export interface CangyuanAvailabilitySnapshotView {
  checkedAt: string;
  windowDays: 7 | 15 | 30;
  items: CangyuanAvailabilityView[];
  source: "live" | "cache";
}

export interface AgentChatMessageView {
  role: "user" | "assistant";
  content: string | AgentChatContentPartView[];
}

export type AgentChatContentPartView =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "auto" | "low" | "high" };
    }
  | {
      type: "input_audio";
      input_audio: { data: string; format: "wav" | "mp3" | "m4a" | "webm" };
    };

export interface AgentChatResponseView {
  message: { role: "assistant"; content: string };
  model: string;
  group: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

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
}

export async function fetchProjects(): Promise<ProjectSummaryView[]> {
  const response = await fetch("/api/projects", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as {
    projects?: ProjectSummaryView[];
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? "项目列表读取失败");
  return Array.isArray(payload?.projects) ? payload.projects : [];
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

export async function sendAgentChat(input: {
  canvasId?: string;
  connectionId: string;
  model: string;
  messages: AgentChatMessageView[];
  reasoningEffort?:
    "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  context?: {
    label: string;
    prompt?: string;
    assetKind?: "image" | "video" | "audio";
  };
}): Promise<AgentChatResponseView> {
  const response = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as
    AgentChatResponseView | { error?: string } | null;
  if (!response.ok)
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : "导演台对话调用失败",
    );
  return payload as AgentChatResponseView;
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
  const presignUrls = await canvasRequestUrlsWithFallback(
    "/api/assets/presign",
  );
  const presignBody = JSON.stringify({
    name: file.name,
    mimeType: file.type,
    size: file.size,
  });
  let presign: Response | undefined;
  let presignNetworkError: unknown;
  for (const [index, presignUrl] of presignUrls.entries()) {
    try {
      const sameOrigin = presignUrl.origin === window.location.origin;
      const candidate = await fetch(presignUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: presignBody,
        credentials: sameOrigin ? "same-origin" : "omit",
        mode: sameOrigin ? "same-origin" : "cors",
      });
      presign = candidate;
      const retryableStatus =
        candidate.status === 403 ||
        candidate.status === 404 ||
        candidate.status === 408 ||
        candidate.status === 425 ||
        candidate.status === 429 ||
        candidate.status >= 500;
      if (candidate.ok || !retryableStatus || index === presignUrls.length - 1)
        break;
    } catch (error) {
      presignNetworkError = error;
      if (index === presignUrls.length - 1) break;
    }
  }
  if (!presign) {
    throw new Error(
      presignNetworkError instanceof Error && presignNetworkError.message
        ? `无法连接素材上传服务：${presignNetworkError.message}`
        : "无法连接素材上传服务",
    );
  }
  if (!presign.ok)
    throw new Error(
      (await presign.json().catch(() => null))?.error ??
        `无法准备素材上传 (${presign.status})`,
    );
  const instruction = (await presign.json()) as {
    mode: "proxy" | "direct";
    id?: string;
    storageKey?: string;
    uploadUrl?: string;
    uploadToken?: string;
  };
  if (
    instruction.mode === "direct" &&
    instruction.id &&
    instruction.storageKey &&
    instruction.uploadUrl &&
    instruction.uploadToken
  ) {
    const uploaded = await fetch(instruction.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!uploaded.ok) throw new Error(`对象存储上传失败 (${uploaded.status})`);
    const complete = await fetch("/api/assets/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: instruction.id,
        storageKey: instruction.storageKey,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        uploadToken: instruction.uploadToken,
      }),
    });
    if (!complete.ok)
      throw new Error(
        (await complete.json().catch(() => null))?.error ?? "素材上传确认失败",
      );
    return complete.json() as Promise<AssetView>;
  }
  // Local proxy uploads use the file body directly. This avoids Node's
  // multipart parser incorrectly aborting larger browser files and removes
  // unnecessary multipart encoding work from the local upload path.
  const uploadId = instruction.id ?? crypto.randomUUID();
  const uploadPath = `/api/assets/upload?name=${encodeURIComponent(file.name)}&id=${encodeURIComponent(uploadId)}`;
  const uploadUrls = await canvasRequestUrlsWithFallback(uploadPath);
  let response: Response | undefined;
  let networkError: unknown;
  for (const [index, uploadUrl] of uploadUrls.entries()) {
    try {
      const candidate = await fetch(uploadUrl, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
        credentials:
          uploadUrl.origin === window.location.origin ? "same-origin" : "omit",
        mode:
          uploadUrl.origin === window.location.origin ? "same-origin" : "cors",
      });
      response = candidate;
      const retryableStatus =
        candidate.status === 403 ||
        candidate.status === 404 ||
        candidate.status === 408 ||
        candidate.status === 425 ||
        candidate.status === 429 ||
        candidate.status >= 500;
      if (candidate.ok || !retryableStatus || index === uploadUrls.length - 1)
        break;
    } catch (error) {
      networkError = error;
      if (index === uploadUrls.length - 1) break;
    }
  }
  if (!response) {
    throw new Error(
      networkError instanceof Error && networkError.message
        ? `素材上传连接失败：${networkError.message}`
        : "素材上传连接失败",
    );
  }
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        `素材上传失败 (${response.status})`,
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
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "运行创建失败",
    );
  return response.json() as Promise<RunSnapshot>;
}

export async function fetchRun(runId: string): Promise<RunSnapshot> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("无法读取运行状态");
  return response.json() as Promise<RunSnapshot>;
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
  const query = new URLSearchParams({ canvasId });
  if (runIds.length > 0) query.set("runIds", runIds.join(","));
  if (clientRequestIds.length > 0)
    query.set("clientRequestIds", clientRequestIds.join(","));
  const response = await fetch(`/api/runs?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("无法读取当前运行状态");
  return response.json() as Promise<RunSnapshot[]>;
}

export async function fetchConnections(): Promise<ProviderConnectionView[]> {
  const response = await fetch(`/api/providers?fresh=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("无法读取供应商连接");
  return response.json() as Promise<ProviderConnectionView[]>;
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
    body: JSON.stringify(input),
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "供应商连接保存失败",
    );
  const saved = (await response.json()) as ProviderConnectionView;
  invalidateModelCache(saved.id);
  return saved;
}

export async function testConnection(id: string): Promise<string> {
  const response = await fetch(
    `/api/providers/${encodeURIComponent(id)}/test`,
    { method: "POST" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "连接测试失败",
    );
  const result = (await response.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  return typeof result?.message === "string" ? result.message : "连接测试成功";
}

async function fetchModelsUncached(
  id: string,
  refresh = false,
  clearUnavailable = false,
): Promise<ModelDescriptor[]> {
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
  return response.json() as Promise<ModelDescriptor[]>;
}

function cacheModels(id: string, items: readonly ModelDescriptor[]) {
  modelListCache.set(id, {
    items: [...items],
    expiresAt: Date.now() + MODEL_LIST_CACHE_TTL_MS,
  });
  return [...items];
}

export async function fetchModels(id: string): Promise<ModelDescriptor[]> {
  const cached = modelListCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return [...cached.items];

  const pending = pendingModelRequests.get(id);
  if (pending) return pending;

  const request = fetchModelsUncached(id).then((items) => {
    return cacheModels(id, items);
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
  const request = fetchModelsUncached(
    id,
    true,
    options?.clearUnavailable === true,
  )
    .then((items) => cacheModels(id, items))
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
        status === undefined ||
        status === 408 ||
        status === 425 ||
        status === 429 ||
        status >= 500 ||
        scanStatus === "failed";
      if (retryable && previous && previous.length > 0)
        return cacheModels(id, previous);
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

export async function fetchCangyuanCatalog(
  group: string,
  options?: { refresh?: boolean },
): Promise<{
  group: string;
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  models: ModelDescriptor[];
}> {
  const response = await fetch(
    `/cangyuan-catalog?group=${encodeURIComponent(group)}${options?.refresh ? "&refresh=1" : ""}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        "无法读取沧元模型广场",
    );
  return response.json() as Promise<{
    group: string;
    checkedAt: string;
    source: "live" | "stale" | "fallback";
    models: ModelDescriptor[];
  }>;
}

export async function fetchCangyuanMarketplace(options?: {
  refresh?: boolean;
}): Promise<{
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  groups: CangyuanMarketplaceGroupView[];
}> {
  const response = await fetch(
    `/cangyuan-catalog${options?.refresh ? "?refresh=1" : ""}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        "无法读取沧元供应商分组",
    );
  return response.json() as Promise<{
    checkedAt: string;
    source: "live" | "stale" | "fallback";
    groups: CangyuanMarketplaceGroupView[];
  }>;
}

export async function fetchCangyuanAvailability(
  connectionId: string,
  options?: {
    windowDays?: 7 | 15 | 30;
    name?: string;
    category?: "text" | "image" | "video" | "audio";
    latestStatus?: CangyuanAvailabilityStatus;
  },
): Promise<CangyuanAvailabilitySnapshotView> {
  const query = new URLSearchParams({
    window_days: String(options?.windowDays ?? 7),
  });
  if (options?.name?.trim()) query.set("name", options.name.trim());
  if (options?.category) query.set("category", options.category);
  if (options?.latestStatus)
    query.set("latest_status", options.latestStatus);
  const response = await fetch(
    `/api/providers/${encodeURIComponent(connectionId)}/availability?${query.toString()}`,
    { cache: "no-store" },
  );
  const payload = (await response.json().catch(() => null)) as
    | (Partial<CangyuanAvailabilitySnapshotView> & { error?: string })
    | null;
  if (!response.ok)
    throw new Error(payload?.error ?? "沧元可用性状态读取失败");
  return payload as CangyuanAvailabilitySnapshotView;
}

export async function fetchMiaowuCatalog(
  group: string,
  options?: { refresh?: boolean },
): Promise<{
  group: string;
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  models: ModelDescriptor[];
}> {
  const response = await fetch(
    `/miaowu-catalog?group=${encodeURIComponent(group)}${options?.refresh ? "&refresh=1" : ""}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        "无法读取喵呜模型分组",
    );
  return response.json() as Promise<{
    group: string;
    checkedAt: string;
    source: "live" | "stale" | "fallback";
    models: ModelDescriptor[];
  }>;
}

export async function fetchMiaowuMarketplace(options?: {
  refresh?: boolean;
}): Promise<{
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  groups: CangyuanMarketplaceGroupView[];
}> {
  const response = await fetch(
    `/miaowu-catalog${options?.refresh ? "?refresh=1" : ""}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        "无法读取喵呜供应商分组",
    );
  return response.json() as Promise<{
    checkedAt: string;
    source: "live" | "stale" | "fallback";
    groups: CangyuanMarketplaceGroupView[];
  }>;
}

export async function fetchCyberAfeiCatalog(group: string): Promise<{
  group: string;
  checkedAt: string;
  source: "live" | "unavailable" | "stale" | "fallback";
  scanStatus?: CangyuanMarketplaceGroupView["scanStatus"];
  scanError?: string;
  scannedModelCount?: number;
  models: ModelDescriptor[];
  inventoryModels?: CangyuanMarketplaceModelView[];
}> {
  const response = await fetch(
    `/cyberafei-catalog?group=${encodeURIComponent(group)}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        "无法读取赛博阿飞模型广场",
    );
  return response.json() as Promise<{
    group: string;
    checkedAt: string;
    source: "live" | "unavailable" | "stale" | "fallback";
    scanStatus?: CangyuanMarketplaceGroupView["scanStatus"];
    scanError?: string;
    scannedModelCount?: number;
    models: ModelDescriptor[];
    inventoryModels?: CangyuanMarketplaceModelView[];
  }>;
}

export async function fetchCyberAfeiMarketplace(options?: {
  refresh?: boolean;
}): Promise<{
  checkedAt: string;
  source: "live" | "unavailable" | "stale" | "fallback";
  groups: CangyuanMarketplaceGroupView[];
}> {
  const response = await fetch(
    `/cyberafei-catalog${options?.refresh ? "?refresh=1" : ""}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        "无法读取赛博阿飞供应商分组",
    );
  return response.json() as Promise<{
    checkedAt: string;
    source: "live" | "unavailable" | "stale" | "fallback";
    groups: CangyuanMarketplaceGroupView[];
  }>;
}

export async function fetchChentuCatalog(group: string): Promise<{
  group: string;
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  scanStatus?: CangyuanMarketplaceGroupView["scanStatus"];
  scanError?: string;
  scannedModelCount?: number;
  models: ModelDescriptor[];
  inventoryModels?: CangyuanMarketplaceModelView[];
}> {
  const response = await fetch(
    `/chentu-catalog?group=${encodeURIComponent(group)}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        "无法读取辰途模型广场",
    );
  return response.json() as Promise<{
    group: string;
    checkedAt: string;
    source: "live" | "stale" | "fallback";
    scanStatus?: CangyuanMarketplaceGroupView["scanStatus"];
    scanError?: string;
    scannedModelCount?: number;
    models: ModelDescriptor[];
    inventoryModels?: CangyuanMarketplaceModelView[];
  }>;
}

export async function fetchChentuMarketplace(options?: {
  refresh?: boolean;
}): Promise<{
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  groups: CangyuanMarketplaceGroupView[];
}> {
  const response = await fetch(
    `/chentu-catalog${options?.refresh ? "?refresh=1" : ""}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        "无法读取辰途供应商分组",
    );
  return response.json() as Promise<{
    checkedAt: string;
    source: "live" | "stale" | "fallback";
    groups: CangyuanMarketplaceGroupView[];
  }>;
}

export async function deleteConnection(id: string): Promise<void> {
  const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("删除供应商连接失败");
}
