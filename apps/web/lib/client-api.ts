import type { ModelDescriptor } from "@super-canvas/providers";
import type {
  AssetView,
  CanvasDocument,
  RunSnapshot,
} from "../components/types";

export interface CanvasResponse {
  id: string;
  title: string;
  graph: CanvasDocument;
  revision: number;
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

export interface ProviderConnectionView {
  id: string;
  name: string;
  provider: string;
  config: Record<string, unknown>;
  apiKeySet: boolean;
  apiKeyUsable?: boolean;
  apiKey: string;
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
}

export interface CangyuanMarketplaceGroupView {
  id: string;
  description: string;
  ratio: number;
  canvasSupported: boolean;
  models: CangyuanMarketplaceModelView[];
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

export async function sendAgentChat(input: {
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

export async function fetchCanvas(): Promise<CanvasResponse> {
  const response = await fetch("/api/canvas", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取画布");
  return response.json() as Promise<CanvasResponse>;
}

export async function saveCanvas(
  canvasId: string,
  graph: CanvasDocument,
  title?: string,
): Promise<CanvasResponse> {
  const response = await fetch(`/api/canvas/${encodeURIComponent(canvasId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graph, title }),
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "画布保存失败",
    );
  return response.json() as Promise<CanvasResponse>;
}

export async function fetchAssets(): Promise<AssetView[]> {
  const response = await fetch("/api/assets", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取素材库");
  return response.json() as Promise<AssetView[]>;
}

export async function fetchMaterialDrops(): Promise<MaterialDropEventView[]> {
  const response = await fetch("/api/integrations/material-drops", {
    cache: "no-store",
  });
  if (!response.ok) return [];
  return response.json() as Promise<MaterialDropEventView[]>;
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
  const presign = await fetch("/api/assets/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type,
      size: file.size,
    }),
  });
  if (!presign.ok)
    throw new Error(
      (await presign.json().catch(() => null))?.error ?? "无法准备素材上传",
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
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/assets/upload", { method: "POST", body });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "素材上传失败",
    );
  return response.json() as Promise<AssetView>;
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

export async function cancelRun(runId: string): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    method: "DELETE",
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "取消运行失败",
    );
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

export async function fetchConnections(): Promise<ProviderConnectionView[]> {
  const response = await fetch("/api/providers", { cache: "no-store" });
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
  return response.json() as Promise<ProviderConnectionView>;
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

export async function fetchModels(id: string): Promise<ModelDescriptor[]> {
  const response = await fetch(
    `/api/providers/${encodeURIComponent(id)}/models`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "无法读取供应商模型",
    );
  return response.json() as Promise<ModelDescriptor[]>;
}

export async function fetchCangyuanCatalog(group: string): Promise<{
  group: string;
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  models: ModelDescriptor[];
}> {
  const response = await fetch(
    `/cangyuan-catalog?group=${encodeURIComponent(group)}`,
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

export async function fetchCangyuanMarketplace(): Promise<{
  checkedAt: string;
  source: "live" | "stale" | "fallback";
  groups: CangyuanMarketplaceGroupView[];
}> {
  const response = await fetch("/cangyuan-catalog", { cache: "no-store" });
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

export async function deleteConnection(id: string): Promise<void> {
  const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("删除供应商连接失败");
}
