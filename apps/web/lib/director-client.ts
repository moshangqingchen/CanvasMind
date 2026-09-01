import type {
  DirectorGraphPatch,
  DirectorModelCapabilities,
  DirectorProtocol,
} from "@super-canvas/director";

import type {
  DirectorApproveResult,
  DirectorConversation,
  DirectorPublicProfile,
  DirectorPublicProposal,
  DirectorTurnEvent,
} from "./director-contracts";

export interface DirectorTurnInput {
  readonly canvasId: string;
  readonly sessionId?: string;
  readonly message: string;
  readonly attachmentAssetIds?: readonly string[];
  readonly viewport?: {
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
  };
  readonly context?: {
    readonly label: string;
    readonly prompt?: string;
    readonly assetKind?: "image" | "video" | "audio";
  };
}

export interface DirectorProposalCandidateInput {
  readonly version: number;
  readonly callId: string;
  readonly connectionId: string;
  readonly modelId: string;
}

export class DirectorRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = "DirectorRequestError";
  }
}

interface ErrorPayload {
  readonly error?: unknown;
  readonly message?: unknown;
  readonly code?: unknown;
  readonly currentRevision?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

async function requestError(response: Response): Promise<DirectorRequestError> {
  const payload = (await response
    .json()
    .catch(() => null)) as ErrorPayload | null;
  const message =
    typeof payload?.error === "string"
      ? payload.error
      : typeof payload?.message === "string"
        ? payload.message
        : `超级导演请求失败 (${response.status})`;
  return new DirectorRequestError(
    message,
    response.status,
    typeof payload?.code === "string" ? payload.code : undefined,
    typeof payload?.currentRevision === "number"
      ? payload.currentRevision
      : undefined,
  );
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw await requestError(response);
  return response.json() as Promise<T>;
}

function unwrap<T>(value: unknown, key: string): T {
  const record = asRecord(value);
  return ((record && key in record ? record[key] : value) ?? null) as T;
}

export async function fetchDirectorProfile(): Promise<DirectorPublicProfile> {
  const payload = await jsonRequest<unknown>("/api/director/profile");
  return unwrap<DirectorPublicProfile>(payload, "profile");
}

export interface DirectorProfileInput {
  readonly brainConnectionId: string;
  readonly brainModelId: string;
  readonly protocol?: DirectorProtocol;
  readonly capabilities?: DirectorModelCapabilities;
  readonly researchConnectionId?: string | null;
  readonly reasoningEffort?: string | null;
}

/** Saves director routing only. Provider connections and their secrets are untouched. */
export async function saveDirectorProfile(
  input: DirectorProfileInput,
): Promise<DirectorPublicProfile> {
  const payload = await jsonRequest<unknown>("/api/director/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return unwrap<DirectorPublicProfile>(payload, "profile");
}

export async function fetchDirectorConversation(
  canvasId: string,
  sessionId?: string,
): Promise<DirectorConversation | null> {
  const query = new URLSearchParams({ canvasId });
  if (sessionId) query.set("sessionId", sessionId);
  const payload = await jsonRequest<unknown>(
    `/api/director/sessions?${query.toString()}`,
  );
  if (payload === null) return null;
  if (Array.isArray(payload))
    return (payload[0] as DirectorConversation | undefined) ?? null;
  const record = asRecord(payload);
  if (Array.isArray(record?.conversations))
    return (
      (record.conversations[0] as DirectorConversation | undefined) ?? null
    );
  return unwrap<DirectorConversation | null>(payload, "conversation");
}

export async function fetchDirectorConversations(
  canvasId: string,
): Promise<DirectorConversation[]> {
  const payload = await jsonRequest<unknown>(
    `/api/director/sessions?canvasId=${encodeURIComponent(canvasId)}`,
  );
  const record = asRecord(payload);
  if (Array.isArray(record?.conversations))
    return record.conversations as DirectorConversation[];
  const conversation = unwrap<DirectorConversation | null>(payload, "conversation");
  return conversation ? [conversation] : [];
}

export async function createDirectorConversation(
  canvasId: string,
): Promise<DirectorConversation> {
  const payload = await jsonRequest<unknown>("/api/director/sessions", {
    method: "POST",
    body: JSON.stringify({ canvasId }),
  });
  return unwrap<DirectorConversation>(payload, "conversation");
}

function parseSseBlock(block: string): DirectorTurnEvent | null {
  const data = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  return JSON.parse(data) as DirectorTurnEvent;
}

/** Streams one director turn and emits validated-by-server public events. */
export async function streamDirectorTurn(
  input: DirectorTurnInput,
  onEvent: (event: DirectorTurnEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/director/turn", {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("无法连接超级导演接口，请检查服务是否运行或网络连接");
  }
  if (!response.ok) throw await requestError(response);
  if (!response.body) throw new Error("超级导演未返回事件流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/gu, "\n");
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) onEvent(event);
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    if (event) onEvent(event);
  }
}

export async function selectDirectorProposalCandidate(
  proposalId: string,
  input: DirectorProposalCandidateInput,
): Promise<DirectorPublicProposal> {
  const payload = await jsonRequest<unknown>(
    `/api/director/proposals/${encodeURIComponent(proposalId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return unwrap<DirectorPublicProposal>(payload, "proposal");
}

export async function approveDirectorProposal(
  proposalId: string,
  input: { readonly version: number; readonly canvasRevision: number },
): Promise<DirectorApproveResult> {
  const payload = await jsonRequest<unknown>(
    `/api/director/proposals/${encodeURIComponent(proposalId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return unwrap<DirectorApproveResult>(payload, "result");
}

export async function cancelDirectorProposal(
  proposalId: string,
  version: number,
): Promise<DirectorPublicProposal> {
  const payload = await jsonRequest<unknown>(
    `/api/director/proposals/${encodeURIComponent(proposalId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ version }),
    },
  );
  return unwrap<DirectorPublicProposal>(payload, "proposal");
}

export type DirectorPreviewPatch = DirectorGraphPatch | null;
