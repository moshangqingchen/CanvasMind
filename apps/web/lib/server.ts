import { randomUUID } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "@super-canvas/providers";
import {
  getRepository,
  isRunRecoveryExpired,
  type JsonObject,
  type NodeRunRecord,
  type WorkflowRunRecord,
} from "@super-canvas/db";
import type { RuntimeEvent } from "@super-canvas/runtime";
import { getObjectStorage } from "@super-canvas/storage";
import { getRunService } from "@super-canvas/runtime";
import { requireServerMasterKey, serverMasterKey } from "./master-key";

export const repository = getRepository();
export const storage = getObjectStorage();
serverMasterKey();
export const runService = getRunService();

const inlineRecoveryKey = "__superCanvasInlineRecovery";

function startInlineRecovery(): void {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.RUN_IN_PROCESS === "false" ||
    process.env.REDIS_URL
  )
    return;
  const scope = globalThis as typeof globalThis & {
    [inlineRecoveryKey]?: Promise<void>;
  };
  if (scope[inlineRecoveryKey]) return;
  scope[inlineRecoveryKey] = repository
    .listRecoverableRuns()
    .then(async (runs) => {
      await Promise.all(runs.map((run) => runService.resumeRun(run.id)));
    })
    .catch((error: unknown) => {
      console.error(
        "[super-canvas] unable to recover unfinished runs",
        error instanceof Error ? error.message : String(error),
      );
    });
}

startInlineRecovery();

const MAX_PUBLIC_ERROR_LENGTH = 4_096;
const PUBLIC_TEXT_SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/data:[^,\s;]+;base64,[a-z0-9+/=_-]+/giu, "data:[redacted]"],
  [/\b((?:bearer|basic))\s+[a-z0-9._~+/=-]+/giu, "$1 [redacted]"],
  [
    /((?:authorization|proxy-authorization|x-api-key|api[-_]?key|token|secret|password|credential|signature)\s*[:=]\s*)[^\s,;]+/giu,
    "$1[redacted]",
  ],
];

/**
 * The repository/runtime records intentionally contain recovery material such
 * as providerTask and historical request snapshots. Those fields must stay on
 * the server; this is the only shape exposed by run HTTP/SSE endpoints.
 */
export interface PublicRunSnapshot {
  run: {
    id: string;
    canvasId: string;
    clientRequestId: string;
    scope: WorkflowRunRecord["scope"];
    nodeId: string | null;
    status: WorkflowRunRecord["status"];
    createdAt: string;
    updatedAt: string;
    canResume: boolean;
  };
  nodes: Array<{
    id: string;
    nodeId: string;
    status: NodeRunRecord["status"];
    outputAssetIds: string[];
    errorJson: PublicRunError | null;
    recoveryAction?: "retry" | "resume_poll" | "resume_archive";
    request?: PublicRunRequest;
  }>;
}

export interface PublicRunRequest {
  provider?: string;
  supplier?: string;
  connectionId?: string;
  connectionName?: string;
  modelGroup?: string;
  operation?: string;
  model?: string;
  parameters?: Record<string, string | number | boolean>;
}

export interface PublicRunError {
  message: string;
  type?: string;
  code?: string;
  api?: string;
  statusCode?: number;
  providerMessage?: string;
  docsUrl?: string;
}

function publicError(
  value: JsonObject | null | undefined,
): PublicRunError | null {
  if (!value || typeof value.message !== "string") return null;
  const message = redactPublicText(value.message).slice(
    0,
    MAX_PUBLIC_ERROR_LENGTH,
  );
  if (!message) return null;
  const detail = (key: "type" | "code" | "api") =>
    typeof value[key] === "string"
      ? redactPublicText(value[key]).slice(0, 256)
      : undefined;
  const docsUrl =
    typeof value.docsUrl === "string" &&
    /^https:\/\/(?:platform\.openai\.com|developers\.openai\.com|docs\.dev\.runwayml\.com|docs\.we-ai\.cc)\//u.test(
      value.docsUrl,
    )
      ? value.docsUrl.slice(0, 1_024)
      : undefined;
  const statusCode =
    typeof value.statusCode === "number" &&
    Number.isInteger(value.statusCode) &&
    value.statusCode >= 100 &&
    value.statusCode <= 599
      ? value.statusCode
      : undefined;
  const providerMessage =
    typeof value.providerMessage === "string"
      ? redactPublicText(value.providerMessage).slice(0, 2_048)
      : undefined;
  return {
    message,
    ...(detail("type") ? { type: detail("type") } : {}),
    ...(detail("code") ? { code: detail("code") } : {}),
    ...(detail("api") ? { api: detail("api") } : {}),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(providerMessage ? { providerMessage } : {}),
    ...(docsUrl ? { docsUrl } : {}),
  };
}

const PUBLIC_RUN_PARAMETER_KEYS = new Set([
  "size",
  "quality",
  "n",
  "aspect_ratio",
  "aspectRatio",
  "image_size",
  "output_format",
  "duration",
  "resolution",
  "ratio",
  "width",
  "height",
  "fps",
]);

function publicRunRequest(input: JsonObject): PublicRunRequest | null {
  const text = (key: string) => {
    const value = input[key];
    return typeof value === "string"
      ? redactPublicText(value).slice(0, 256)
      : undefined;
  };
  const rawParameters = input.parameters;
  const parameters: Record<string, string | number | boolean> = {};
  if (
    rawParameters &&
    typeof rawParameters === "object" &&
    !Array.isArray(rawParameters)
  ) {
    for (const [key, value] of Object.entries(rawParameters)) {
      if (!PUBLIC_RUN_PARAMETER_KEYS.has(key)) continue;
      if (typeof value === "string") {
        parameters[key] = redactPublicText(value).slice(0, 256);
      } else if (typeof value === "boolean") {
        parameters[key] = value;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        parameters[key] = value;
      }
    }
  }
  const request: PublicRunRequest = {
    ...(text("provider") ? { provider: text("provider") } : {}),
    ...(text("supplier") ? { supplier: text("supplier") } : {}),
    ...(text("connectionId") ? { connectionId: text("connectionId") } : {}),
    ...(text("connectionName")
      ? { connectionName: text("connectionName") }
      : {}),
    ...(text("modelGroup") ? { modelGroup: text("modelGroup") } : {}),
    ...(text("operation") ? { operation: text("operation") } : {}),
    ...(text("model") ? { model: text("model") } : {}),
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
  };
  return Object.keys(request).length > 0 ? request : null;
}

export function nodeRunRecoveryAction(
  node: NodeRunRecord,
): "retry" | "resume_poll" | "resume_archive" | undefined {
  if (node.status === "failed" && !node.providerTaskId) return "retry";
  if (
    !["needs_attention", "archiving"].includes(node.status) ||
    !node.providerTaskId
  )
    return undefined;
  const storedTask = node.inputJson.providerTask;
  const storedStatus =
    storedTask && typeof storedTask === "object" && !Array.isArray(storedTask)
      ? (storedTask as JsonObject).status
      : undefined;
  return storedStatus === "succeeded" ? "resume_archive" : "resume_poll";
}

function canResumeRun(
  run: WorkflowRunRecord,
  nodes: readonly NodeRunRecord[],
): boolean {
  if (isRunRecoveryExpired(run)) return false;
  let resumable = false;
  for (const node of nodes) {
    if (node.status === "needs_attention") {
      if (!node.providerTaskId) return false;
    }
    if (nodeRunRecoveryAction(node)) resumable = true;
  }
  return resumable;
}

export function publicRunSnapshot(
  snapshot: {
    run: WorkflowRunRecord;
    nodes: NodeRunRecord[];
  } | null,
): PublicRunSnapshot | null {
  if (!snapshot) return null;
  return {
    run: {
      id: snapshot.run.id,
      canvasId: snapshot.run.canvasId,
      clientRequestId: snapshot.run.clientRequestId,
      scope: snapshot.run.scope,
      nodeId: snapshot.run.nodeId ?? null,
      status: snapshot.run.status,
      createdAt: snapshot.run.createdAt,
      updatedAt: snapshot.run.updatedAt,
      canResume: canResumeRun(snapshot.run, snapshot.nodes),
    },
    nodes: snapshot.nodes.map((node) => {
      const request = publicRunRequest(node.inputJson);
      const recoveryAction = nodeRunRecoveryAction(node);
      return {
        id: node.id,
        nodeId: node.nodeId,
        status: node.status,
        outputAssetIds: node.outputAssetIds.filter(
          (assetId): assetId is string => typeof assetId === "string",
        ),
        errorJson: publicError(node.errorJson),
        ...(recoveryAction ? { recoveryAction } : {}),
        ...(request ? { request } : {}),
      };
    }),
  };
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string"
    ? redactPublicText(value).slice(0, MAX_PUBLIC_ERROR_LENGTH)
    : undefined;
}

function redactPublicText(value: string): string {
  return PUBLIC_TEXT_SECRET_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

/** Keep SSE payloads useful to the UI without forwarding arbitrary provider data. */
export function publicRuntimeEvent(
  event: RuntimeEvent,
): Record<string, unknown> {
  const payload = event.payload ?? {};
  let safePayload: Record<string, unknown>;
  if (event.type === "run") {
    safePayload = {
      ...(boundedString(payload.status)
        ? { status: boundedString(payload.status) }
        : {}),
      ...(Array.isArray(payload.nodeIds)
        ? {
            nodeIds: payload.nodeIds.filter(
              (nodeId): nodeId is string => typeof nodeId === "string",
            ),
          }
        : {}),
      ...(boundedString(payload.error)
        ? { error: boundedString(payload.error) }
        : {}),
    };
  } else if (event.type === "node") {
    safePayload = {
      ...(boundedString(payload.nodeId)
        ? { nodeId: boundedString(payload.nodeId) }
        : {}),
      ...(boundedString(payload.status)
        ? { status: boundedString(payload.status) }
        : {}),
      ...(boundedString(payload.error)
        ? { error: boundedString(payload.error) }
        : {}),
      ...(typeof payload.output === "object" && payload.output !== null
        ? {
            output: {
              kind:
                typeof (payload.output as Record<string, unknown>).kind ===
                "string"
                  ? (payload.output as Record<string, unknown>).kind
                  : undefined,
              assetIds: Array.isArray(
                (payload.output as Record<string, unknown>).assetIds,
              )
                ? (
                    (payload.output as Record<string, unknown>)
                      .assetIds as unknown[]
                  ).filter(
                    (assetId): assetId is string => typeof assetId === "string",
                  )
                : [],
            },
          }
        : {}),
    };
  } else {
    safePayload = {
      ...(boundedString(payload.assetId)
        ? { assetId: boundedString(payload.assetId) }
        : {}),
      ...(boundedString(payload.kind)
        ? { kind: boundedString(payload.kind) }
        : {}),
    };
  }
  return {
    type: event.type,
    ...(event.runId ? { runId: event.runId } : {}),
    ...(event.nodeRunId ? { nodeRunId: event.nodeRunId } : {}),
    at: event.at,
    payload: safePayload,
  };
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function safeJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function publicAsset(
  asset: Awaited<ReturnType<typeof repository.getAsset>>,
) {
  if (!asset) return null;
  return {
    ...asset,
    url: `/api/assets/${encodeURIComponent(asset.id)}/content`,
  };
}

export async function saveProviderConnection(input: {
  id?: string;
  name: string;
  provider: string;
  apiKey?: string;
  config?: JsonObject;
}) {
  const id = input.id ?? randomUUID();
  const existing = await repository.getConnection(id);
  const masterKey = requireServerMasterKey();
  const encryptedSecret = input.apiKey
    ? encryptSecret(input.apiKey, masterKey)
    : (existing?.encryptedSecret ?? null);
  return repository.saveConnection({
    id,
    name: input.name,
    provider: input.provider,
    encryptedSecret,
    config: input.config ?? existing?.config ?? {},
  });
}

const sensitiveHeaderName =
  /(?:authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie|token|secret|signature|credential)/iu;

const sensitiveConfigKey =
  /^(?:api[-_]?key|access[-_]?token|token|secret|password|credential|private[-_]?key)$/iu;

function configForBrowser(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value))
    return value.map((item) => configForBrowser(item, parentKey));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      (parentKey.toLowerCase() === "headers" &&
        sensitiveHeaderName.test(key)) ||
      sensitiveConfigKey.test(key)
        ? "********"
        : configForBrowser(item, key),
    ]),
  );
}

export function maskConnection(
  record: Awaited<ReturnType<typeof repository.getConnection>>,
) {
  if (!record) return null;
  let apiKeyUsable = false;
  if (record.encryptedSecret) {
    try {
      apiKeyUsable = Boolean(
        decryptSecret(record.encryptedSecret, requireServerMasterKey()),
      );
    } catch {
      apiKeyUsable = false;
    }
  }
  return {
    id: record.id,
    name: record.name,
    provider: record.provider,
    config: configForBrowser(record.config),
    apiKeySet: Boolean(record.encryptedSecret),
    apiKeyUsable,
    apiKey: record.encryptedSecret ? maskSecret("configured") : "",
  };
}
