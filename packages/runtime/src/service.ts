import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { consumeCliArtifact } from "./cli-artifact.js";
import { recordSubmissionPhase } from "./submission-timeline.js";
import { repositoryScheduler, runtimeConcurrency, scheduleReadyNodes, type RuntimeConcurrency, type RuntimeScheduler } from "./scheduler.js";
import { assertDesktopPublicAssets } from "./desktop-preflight.js";
import { localReferenceChannelConfigured, localReferenceUrls } from "./reference-channel.js";
import { cloudSubmissionId, isCloudSubmission, readCloudGenerationConfig, runCloudGeneration, testCloudGeneration, uploadCloudReferences, type CloudGenerationConfig } from "./cloud-generation.js";
import {
  extractPromptAssetIds,
  getEdgeTargetPortId,
  renderPromptParts,
  selectRunNodeIds,
  validateGraph,
  type PromptPart,
  type RunScope,
  type WorkflowGraph,
  type WorkflowNode,
} from "@super-canvas/core";
import type {
  Repository,
  AssetRecord,
  JsonObject,
  NodeRunRecord,
  NodeRunUpdateOptions,
  ProviderConnectionRecord,
  WorkflowRunRecord,
} from "@super-canvas/db";
import { getRepository, isRunRecoveryExpired } from "@super-canvas/db";
import {
  decryptSecret,
  CliProviderAdapter,
  cliJobKey,
  FakeProviderAdapter,
  imageSizeForTier,
  GenericRestAdapter,
  AutoInterfaceAdapter,
  restRequestRequiresPublicAssets,
  secureSkillRequiresPublicAssets,
  bananaImageRoute,
  bananaRequiresPublicAssets,
  normalizeBananaParameters,
  referenceImageHostingEnabled,
  OPENAI_DEFAULT_IMAGE_MODEL,
  OpenAIImageAdapter,
  WEAI_GEMINI_DEFAULT_IMAGE_MODEL,
  WEAI_DEFAULT_IMAGE_MODEL,
  WeAIImageAdapter,
  presentProviderError,
  ProviderHttpError,
  withProviderSubmissionProgress,
  type ProviderSubmissionPhase,
  RunwayAdapter,
  RUNWAY_DEFAULT_VIDEO_MODEL,
  type NormalizedRequest,
  type ProviderAdapter,
  type ProviderAssetInput,
  type ProviderErrorContext,
  type ProviderErrorPresentation,
  type ProviderOperation,
  type ProviderConnectionResolver,
  type ProviderTask,
  type RemoteArtifact,
  type ResolvedProviderConnection,
} from "@super-canvas/providers";
import {
  getObjectStorage,
  getProjectFileStore,
  type ObjectStorage,
  type StoredObjectMetadata,
  type ProjectFileStore,
} from "@super-canvas/storage";
import {
  getEventBus,
  type RuntimeEvent,
  type RuntimeEventBus,
} from "./events.js";
import {
  artifactDownloadMaxBytes,
  downloadRemoteArtifact,
  consumeRemoteArtifact,
} from "./remote-download.js";
import {
  aspectRatioFromPrompt,
  aspectRatioString,
  cyberAfei4KSizeForAspectRatio,
  cyberAfei4KValidSize,
  chentuResolutionTier,
  chentuSizeForResolutionTier,
  customImageSizeForAspectRatio,
  dimensionsFromPrompt,
  friModelSizeForResolutionTier,
  gptImage4KSizeForAspectRatio,
  mikotoSizeForResolutionTier,
  weAiResolutionTier,
  weAiSizeForResolutionTier,
} from "./aspect-ratio.js";

interface NodeData extends Record<string, unknown> {
  provider?: string;
  connectionId?: string;
  model?: string;
  prompt?: PromptPart[] | string;
  parts?: PromptPart[];
  text?: string;
  assetId?: string;
  assetKind?: "image" | "video" | "audio";
  parameters?: Record<string, unknown>;
  fakeScenario?: string;
  __runtimeConnection?: FrozenProviderConnection;
}

interface FrozenProviderConnection {
  id: string;
  name: string;
  provider: string;
  encryptedSecret?: string | null;
  config: JsonObject;
  cloudGeneration?: CloudGenerationConfig;
}

interface OutputValue {
  kind: "text" | "image" | "video" | "audio";
  prompt?: PromptPart[];
  assetIds?: string[];
  assetRoles?: Record<string, "reference" | "firstFrame" | "lastFrame">;
}

type HistoricalInputSnapshot = { value: OutputValue } | { missing: true };

type HistoricalInputs = Record<string, HistoricalInputSnapshot>;

/** Server-only immutable execution input. Never serialize to a browser. */
export interface PreparedRun {
  canvasId: string;
  canvasRevision: number;
  scope: RunScope;
  nodeId?: string;
  nodeIds: string[];
  revisionGraph: JsonObject;
}

export interface RuntimeOptions {
  repository?: Repository;
  storage?: ObjectStorage;
  eventBus?: RuntimeEventBus;
  pollIntervalMs?: number;
  retryBaseDelayMs?: number;
  concurrency?: Partial<RuntimeConcurrency>;
  executionMode?: "inline" | "queue";
  enqueueRun?: (runId: string) => Promise<void>;
  projectFileStore?: ProjectFileStore | null;
  /** Durable task files, adjacent to the desktop profile's object storage. */
  cliJobRoot?: string;
  /** Stop local work without cancelling the durable supplier task. */
  shutdownSignal?: AbortSignal;
}

const WEAI_RUNTIME_MODELS_BY_GROUP: Readonly<
  Record<string, readonly string[]>
> = {
  "生图-openai-adobe-token计费": ["gpt-image-2"],
  gemini香蕉: ["gemini-3.1-flash-image", "gemini-3-pro-image"],
  "AZURE-openai": ["gpt-image-2"],
  "生图-openai-adobe-按次": [
    "gpt-image-2-low",
    "gpt-image-2-medium",
    "gpt-image-2-high",
  ],
  "生图-openai-codex-token计费": ["gpt-image-2"],
  "生图-openai-adobe-按次-返回url": ["gpt-image-2"],
};

const WEAI_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "gemini-3-pro-image-preview": "gemini-3-pro-image",
  "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
};

const WEAI_ADOBE_PER_REQUEST_GROUP = "生图-openai-adobe-按次";
const WEAI_UNKNOWN_MODEL_QUARANTINE_THRESHOLD = 3;

function connectionConfigString(
  config: JsonObject | undefined,
  key: string,
): string | undefined {
  const nested = isRecord(config?.config) ? config.config : undefined;
  return [config?.[key], nested?.[key]]
    .find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    ?.trim();
}

function weAiDefaultModel(group?: string): string {
  if (group === "gemini香蕉") return WEAI_GEMINI_DEFAULT_IMAGE_MODEL;
  if (group === WEAI_ADOBE_PER_REQUEST_GROUP) return "gpt-image-2-low";
  return WEAI_DEFAULT_IMAGE_MODEL;
}

function normalizeWeAiModel(
  group: string | undefined,
  requestedModel: string | undefined,
  parameters?: Readonly<Record<string, unknown>>,
): string {
  const requested = requestedModel?.trim();
  const legacy = requested
    ? /^gpt-image-2(?:-(low|medium|high))?::(?:1k|2k|4k)$/iu.exec(requested)
    : null;

  if (group === WEAI_ADOBE_PER_REQUEST_GROUP) {
    if (requested && WEAI_RUNTIME_MODELS_BY_GROUP[group]?.includes(requested)) {
      return requested;
    }
    const parameterQuality =
      typeof parameters?.quality === "string"
        ? parameters.quality.trim().toLowerCase()
        : undefined;
    const quality =
      legacy?.[1]?.toLowerCase() ??
      (["low", "medium", "high"].includes(parameterQuality ?? "")
        ? parameterQuality
        : "low");
    return `gpt-image-2-${quality}`;
  }

  const withoutLegacyTier = legacy ? "gpt-image-2" : requested;
  const canonical = withoutLegacyTier
    ? (WEAI_MODEL_ALIASES[withoutLegacyTier] ?? withoutLegacyTier)
    : undefined;
  const allowed = group ? WEAI_RUNTIME_MODELS_BY_GROUP[group] : undefined;
  if (canonical && (!allowed || allowed.includes(canonical))) return canonical;
  return weAiDefaultModel(group);
}

function normalizeWeAiParameters(
  parameters: Readonly<Record<string, unknown>> | undefined,
  requestedModel: string | undefined,
  group: string | undefined,
): Record<string, unknown> {
  const normalized = { ...(parameters ?? {}) };
  const legacy = requestedModel
    ? /^gpt-image-2(?:-(?:low|medium|high))?::(1k|2k|4k)$/iu.exec(
        requestedModel.trim(),
      )
    : null;
  if (
    legacy?.[1] &&
    (typeof normalized.size !== "string" ||
      normalized.size.trim().toLowerCase() === "auto")
  ) {
    normalized.size =
      legacy[1].toLowerCase() === "1k"
        ? "1024x1024"
        : legacy[1].toLowerCase() === "2k"
          ? "2048x2048"
          : "2160x2160";
  }
  if (group === WEAI_ADOBE_PER_REQUEST_GROUP) delete normalized.quality;
  return normalized;
}

function normalizeChentuParameters(
  parameters: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const normalized = { ...(parameters ?? {}) };
  // Older canvas snapshots could store the resolution tier in `quality`
  // (for example quality=4K). 辰途 uses `size` for pixels; forwarding that
  // legacy value makes 1K/2K models reject the request upstream.
  if (
    typeof normalized.quality === "string" &&
    /^(?:1k|2k|4k)$/iu.test(normalized.quality.trim())
  )
    delete normalized.quality;
  return normalized;
}

function normalizeRestImageBatchParameter(
  parameters: Readonly<Record<string, unknown>> | undefined,
  model: string | undefined,
  connectionConfig: JsonObject | undefined,
): Record<string, unknown> {
  const normalized = { ...(parameters ?? {}) };
  const connector = isRecord(connectionConfig?.connector)
    ? connectionConfig.connector
    : undefined;
  const models = Array.isArray(connector?.models) ? connector.models : [];
  const descriptor = models.find(
    (candidate) => isRecord(candidate) && candidate.id === model,
  );
  const metadata = isRecord(descriptor?.metadata)
    ? descriptor.metadata
    : undefined;
  const countDescriptor = Array.isArray(descriptor?.parameters)
    ? descriptor.parameters.find(
        (parameter: unknown) =>
          isRecord(parameter) &&
          parameter.key === "n" &&
          (!Array.isArray(parameter.operations) ||
            parameter.operations.some(
              (operation) =>
                operation === "image.generate" || operation === "image.edit",
            )),
      )
    : undefined;
  const maximum = Number(countDescriptor?.max);
  if (
    metadata?.fixedOutputCount === 1 ||
    !countDescriptor ||
    !Number.isFinite(maximum) ||
    maximum <= 1
  ) {
    const requested = Number(normalized.n);
    if (Number.isFinite(requested) && requested <= 1) normalized.n = 1;
    else delete normalized.n;
    return normalized;
  }
  const minimum = Number.isFinite(Number(countDescriptor.min))
    ? Math.ceil(Number(countDescriptor.min))
    : 1;
  const requested = Number(normalized.n);
  const count = Number.isFinite(requested)
    ? Math.trunc(requested)
    : Number(countDescriptor.default ?? minimum);
  normalized.n = Math.min(Math.floor(maximum), Math.max(minimum, count));
  return normalized;
}

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });

/** A read-only poll may finish after local shutdown; it must not mutate a stopped run. */
function abortablePoll<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function inputAssetKind(kind: string): "image" | "video" | "audio" {
  return kind === "video" ? "video" : kind === "audio" ? "audio" : "image";
}
const fakePngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
async function retryOperation<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await delay(400 * 2 ** attempt);
    }
  }
  throw lastError;
}

function shouldRefreshRemoteArtifact(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Provider output download failed with HTTP (?:403|404|410)\b/u.test(
      message,
    ) ||
    /(?:timed out|timeout|aborted|ECONNRESET|EPIPE|socket hang up|network)/iu.test(
      message,
    )
  );
}
const timestamp = () => new Date().toISOString();
const asGraph = (value: JsonObject): WorkflowGraph =>
  value as unknown as WorkflowGraph;
const nodeData = (node: WorkflowNode): NodeData =>
  (node.data ?? {}) as NodeData;
const semanticType = (node: WorkflowNode): string =>
  typeof nodeData(node).nodeType === "string"
    ? String(nodeData(node).nodeType)
    : node.type;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function ratioValue(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/u.exec(
    value.trim(),
  );
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

function configuredImageDescriptor(
  connectionConfig: JsonObject | undefined,
  model: string | undefined,
) {
  const connectorModels =
    isRecord(connectionConfig?.connector) &&
    Array.isArray(connectionConfig.connector.models)
      ? connectionConfig.connector.models
      : [];
  const catalogModels = Array.isArray(connectionConfig?.modelCatalogModels)
    ? connectionConfig.modelCatalogModels
    : [];
  return [...catalogModels, ...connectorModels].find(
    (candidate) => isRecord(candidate) && candidate.id === model,
  );
}

function singleConfiguredSizeTier(descriptor: unknown): string | undefined {
  if (!isRecord(descriptor) || !Array.isArray(descriptor.parameters))
    return undefined;
  const size = descriptor.parameters.find(
    (parameter) => isRecord(parameter) && parameter.key === "size",
  );
  if (!isRecord(size) || !Array.isArray(size.options)) return undefined;
  const tiers = new Set(
    size.options.flatMap((option) => {
      const tier =
        isRecord(option) && typeof option.label === "string"
          ? /^(1K|2K|4K)\b/iu.exec(option.label)?.[1]?.toUpperCase()
          : undefined;
      return tier ? [tier] : [];
    }),
  );
  return tiers.size === 1 ? [...tiers][0] : undefined;
}

/** Resolves model-declared K-size options before using legacy supplier tables. */
function connectorSizeForResolutionTier(
  connectionConfig: JsonObject | undefined,
  model: string | undefined,
  tierValue: unknown,
  aspectRatio?: string,
): string | undefined {
  const tier = weAiResolutionTier(tierValue);
  if (!tier || !model) return undefined;
  const descriptor = configuredImageDescriptor(connectionConfig, model);
  const parameters =
    isRecord(descriptor) && Array.isArray(descriptor.parameters)
      ? descriptor.parameters
      : [];
  const sizeDescriptor = parameters.find(
    (candidate) => isRecord(candidate) && candidate.key === "size",
  );
  const options =
    isRecord(sizeDescriptor) && Array.isArray(sizeDescriptor.options)
      ? sizeDescriptor.options
      : [];
  const supportsCustomDimensions =
    isRecord(sizeDescriptor) && sizeDescriptor.control === "dimensions";
  const candidates = options.flatMap((option) => {
    if (!isRecord(option) || typeof option.value !== "string") return [];
    const label = typeof option.label === "string" ? option.label : "";
    if (!new RegExp(`^${tier}\\b`, "iu").test(label)) return [];
    if (option.value.trim().toLowerCase() === "auto") return [];
    const labelRatio = /(?<!\d)(\d{1,3})\s*[:：/]\s*(\d{1,3})(?!\d)/u.exec(
      label,
    );
    const valueMatch = /^(\d+)x(\d+)$/iu.exec(option.value.trim());
    const ratio = labelRatio
      ? Number(labelRatio[1]) / Number(labelRatio[2])
      : valueMatch
        ? Number(valueMatch[1]) / Number(valueMatch[2])
        : undefined;
    return ratio && Number.isFinite(ratio)
      ? [{ ratio, size: option.value.trim() }]
      : [];
  });
  if (candidates.length === 0) return undefined;
  const requested = ratioValue(aspectRatio);
  if (!requested) return candidates[0]?.size;
  const nearest = candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(Math.log(best.ratio / requested));
    const candidateDistance = Math.abs(Math.log(candidate.ratio / requested));
    return candidateDistance < bestDistance ? candidate : best;
  });
  const nearestDistance = Math.abs(Math.log(nearest.ratio / requested));
  if (!supportsCustomDimensions || nearestDistance <= 1e-6) return nearest.size;

  const descriptorMax =
    isRecord(sizeDescriptor) && typeof sizeDescriptor.max === "number"
      ? sizeDescriptor.max
      : undefined;
  const maxEdge = Math.max(
    16,
    descriptorMax ??
      Math.max(
        ...candidates.map((candidate) => {
          const [width, height] = candidate.size.split("x").map(Number);
          return Math.max(width ?? 0, height ?? 0);
        }),
      ),
  );
  const maxPixels = Math.max(
    ...candidates.map((candidate) => {
      const [width, height] = candidate.size.split("x").map(Number);
      return (width ?? 0) * (height ?? 0);
    }),
  );
  return customImageSizeForAspectRatio(aspectRatio, { maxEdge, maxPixels });
}

function promptPartsFromNodeData(data: NodeData): PromptPart[] {
  const value = data.parts ?? data.prompt;
  if (Array.isArray(value)) return value as PromptPart[];
  return [
    {
      type: "text",
      text:
        typeof value === "string"
          ? value
          : typeof data.text === "string"
            ? data.text
            : "",
    },
  ];
}

function hasPromptText(parts: readonly PromptPart[]): boolean {
  return parts.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );
}

function referenceAspectRatio(
  graph: WorkflowGraph,
  assets: readonly ProviderAssetInput[],
): string | undefined {
  const firstImage = assets.find((asset) => asset.kind === "image");
  if (!firstImage) return undefined;
  const source = graph.nodes.find(
    (candidate) => nodeData(candidate).assetId === firstImage.id,
  );
  const ratio = source ? nodeData(source).mediaAspectRatio : undefined;
  return typeof ratio === "number" ? aspectRatioString(ratio) : undefined;
}

function hasInlineGenerationPrompt(node: WorkflowNode | undefined): boolean {
  if (!node) return false;
  const type = semanticType(node);
  return (
    (type === "image-generation" || type === "video-generation") &&
    hasPromptText(promptPartsFromNodeData(nodeData(node)))
  );
}

function outputValueFromUnknown(value: unknown): OutputValue | null {
  if (!isRecord(value)) return null;
  if (value.kind !== "text" && value.kind !== "image" && value.kind !== "video")
    return null;
  const assetIds = Array.isArray(value.assetIds)
    ? value.assetIds.filter((item): item is string => typeof item === "string")
    : undefined;
  const prompt = Array.isArray(value.prompt)
    ? (value.prompt as PromptPart[])
    : undefined;
  const assetRoles: Record<string, "reference" | "firstFrame" | "lastFrame"> =
    {};
  if (isRecord(value.assetRoles)) {
    for (const [assetId, role] of Object.entries(value.assetRoles)) {
      if (
        role === "reference" ||
        role === "firstFrame" ||
        role === "lastFrame"
      ) {
        assetRoles[assetId] = role;
      }
    }
  }
  return {
    kind: value.kind,
    ...(prompt ? { prompt } : {}),
    ...(assetIds ? { assetIds } : {}),
    ...(Object.keys(assetRoles).length > 0 ? { assetRoles } : {}),
  };
}

function historicalInputsFromUnknown(value: unknown): HistoricalInputs | null {
  if (!isRecord(value)) return null;
  const result: HistoricalInputs = {};
  for (const [sourceId, snapshot] of Object.entries(value)) {
    if (!isRecord(snapshot)) continue;
    if (snapshot.missing === true) {
      result[sourceId] = { missing: true };
      continue;
    }
    const output = outputValueFromUnknown(snapshot.value);
    if (output) result[sourceId] = { value: output };
  }
  return result;
}

function storedProviderTask(value: unknown): ProviderTask | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.providerTaskId !== "string" ||
    !["queued", "running", "succeeded", "failed", "cancelled"].includes(
      String(value.status),
    )
  )
    return null;
  const revived = JSON.parse(
    JSON.stringify(value),
    (_key, candidate: unknown) => {
      if (
        isRecord(candidate) &&
        typeof candidate.__superCanvasBytes === "string"
      )
        return new Uint8Array(
          Buffer.from(candidate.__superCanvasBytes, "base64"),
        );
      return candidate;
    },
  );
  return revived as ProviderTask;
}

function providerTaskJson(task: ProviderTask): JsonObject {
  return JSON.parse(
    JSON.stringify(task, (_key, value: unknown) =>
      value instanceof Uint8Array
        ? { __superCanvasBytes: Buffer.from(value).toString("base64") }
        : value,
    ),
  ) as JsonObject;
}

function compactCompletedInput(input: JsonObject): JsonObject {
  // The provider task can contain multi-megabyte base64/byte responses needed
  // only while polling or retrying archival. Once the output is durably
  // archived, the provider task id column and normalized request fields are
  // sufficient for history and audit purposes.
  const { providerTask: _providerTask, ...completed } = input;
  return completed;
}

function cliStopsTracking(task: ProviderTask): boolean {
  return isRecord(task.result) && isRecord(task.result.cli) && task.result.cli.supportsCancel !== true;
}

function cliTiming(config: JsonObject | undefined, key: "pollIntervalMs" | "taskTimeoutMs", fallback: number): number {
  const value = isRecord(config?.cli) ? config.cli[key] : undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function operationFor(
  node: WorkflowNode,
  hasImage: boolean,
): NormalizedRequest["operation"] | null {
  if (semanticType(node) === "image-generation")
    return hasImage ? "image.edit" : "image.generate";
  if (semanticType(node) === "video-generation")
    return hasImage ? "video.image-to-video" : "video.generate";
  return null;
}

const runStatusPriority: Readonly<Record<WorkflowRunRecord["status"], number>> =
  {
    succeeded: 0,
    queued: 0,
    running: 0,
    failed: 1,
    needs_attention: 2,
    cancelled: 3,
  };

function combineRunStatus(
  current: WorkflowRunRecord["status"],
  next: WorkflowRunRecord["status"],
): WorkflowRunRecord["status"] {
  return runStatusPriority[next] > runStatusPriority[current] ? next : current;
}

function masterKeyForRuntime(): string | undefined {
  if (process.env.MASTER_KEY) return process.env.MASTER_KEY;
  return process.env.NODE_ENV === "production"
    ? undefined
    : "local-development-master-key";
}

function freezeConnection(
  record: ProviderConnectionRecord,
): FrozenProviderConnection {
  return {
    id: record.id,
    name: record.name,
    provider: record.provider,
    encryptedSecret: record.encryptedSecret ?? null,
    config: structuredClone(record.config),
  };
}

function frozenConnectionFromUnknown(
  value: unknown,
): FrozenProviderConnection | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.provider !== "string" ||
    !isRecord(value.config) ||
    (value.encryptedSecret !== undefined &&
      value.encryptedSecret !== null &&
      typeof value.encryptedSecret !== "string")
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    provider: value.provider,
    encryptedSecret: value.encryptedSecret ?? null,
    config: structuredClone(value.config),
    ...(isRecord(value.cloudGeneration) && typeof value.cloudGeneration.endpoint === "string" && typeof value.cloudGeneration.encryptedToken === "string"
      ? { cloudGeneration: { endpoint: value.cloudGeneration.endpoint, encryptedToken: value.cloudGeneration.encryptedToken } } : {}),
  };
}

function frozenConnectionsFromGraph(
  graph: WorkflowGraph,
): ReadonlyMap<string, FrozenProviderConnection> {
  const snapshots = new Map<string, FrozenProviderConnection>();
  for (const node of graph.nodes) {
    const snapshot = frozenConnectionFromUnknown(
      nodeData(node).__runtimeConnection,
    );
    if (snapshot) snapshots.set(snapshot.id, snapshot);
  }
  return snapshots;
}

// Multiple API/service instances can share one local repository. Coalesce
// archive-only requests without restarting its cancelled/failed execution.
const runOutputRecoveries = new WeakMap<Repository, Map<string, Promise<WorkflowRunRecord | null>>>();

class RepoConnectionResolver implements ProviderConnectionResolver {
  constructor(
    private readonly repository: Repository,
    private readonly frozenConnections: ReadonlyMap<
      string,
      FrozenProviderConnection
    > = new Map(),
  ) {}

  async resolve(connectionId: string): Promise<ResolvedProviderConnection> {
    if (connectionId === "fake-default")
      return { id: connectionId, provider: "fake", apiKey: "fake" };
    const record =
      this.frozenConnections.get(connectionId) ??
      (await this.repository.getConnection(connectionId));
    if (!record) throw new Error(`找不到供应商连接：${connectionId}`);
    if (
      !this.frozenConnections.has(connectionId) &&
      record.config.supplierArchived === true
    )
      throw new Error("此供应商连接已归档，请重新选择当前连接");
    const encrypted = record.encryptedSecret;
    const masterKey = masterKeyForRuntime();
    if (encrypted && !masterKey) {
      throw new Error(
        "MASTER_KEY is required to decrypt provider credentials in production",
      );
    }
    const apiKey =
      encrypted && masterKey ? decryptSecret(encrypted, masterKey) : undefined;
    return {
      id: record.id,
      provider: record.provider,
      apiKey,
      baseUrl:
        typeof record.config.baseUrl === "string"
          ? record.config.baseUrl
          : undefined,
      headers: record.config.headers as Record<string, string> | undefined,
      settings: record.config,
    };
  }
}

export class RunService {
  readonly repository: Repository;
  readonly storage: ObjectStorage;
  readonly eventBus: RuntimeEventBus;
  private readonly running = new Map<string, Promise<void>>();
  private readonly starting = new Set<string>();
  private readonly scheduler: RuntimeScheduler;
  private readonly nodeConcurrency: number;
  private readonly pollIntervalMs?: number;
  private readonly retryBaseDelayMs: number;
  private readonly executionMode?: "inline" | "queue";
  private readonly enqueueRunOverride?: (runId: string) => Promise<void>;
  private readonly projectFileStore?: ProjectFileStore | null;
  private readonly cliJobRoot: string;
  private readonly shutdownSignal?: AbortSignal;

  constructor(options: RuntimeOptions = {}) {
    this.repository = options.repository ?? getRepository();
    this.storage = options.storage ?? getObjectStorage();
    const concurrency = runtimeConcurrency(options.concurrency);
    this.scheduler = repositoryScheduler(this.repository, concurrency);
    this.nodeConcurrency = concurrency.perRun;
    this.eventBus = options.eventBus ?? getEventBus();
    this.pollIntervalMs = options.pollIntervalMs;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.executionMode = options.executionMode;
    this.enqueueRunOverride = options.enqueueRun;
    this.projectFileStore = options.projectFileStore;
    this.shutdownSignal = options.shutdownSignal;
    this.cliJobRoot = resolve(/* turbopackIgnore: true */ options.cliJobRoot ?? join(/* turbopackIgnore: true */ dirname(resolve(/* turbopackIgnore: true */ process.env.LOCAL_STORAGE_PATH ?? "storage")), "cli-jobs"));
  }

  public adapters(
    resolver: ProviderConnectionResolver = new RepoConnectionResolver(
      this.repository,
    ),
  ): Map<string, ProviderAdapter> {
    const fake = new FakeProviderAdapter(resolver);
    return new Map<string, ProviderAdapter>([
      ["fake", fake],
      ["openai", new AutoInterfaceAdapter(resolver, new OpenAIImageAdapter(resolver))],
      ["weai", new AutoInterfaceAdapter(resolver, new WeAIImageAdapter(resolver))],
      ["runway", new AutoInterfaceAdapter(resolver, new RunwayAdapter(resolver))],
      ["rest", new AutoInterfaceAdapter(resolver, new GenericRestAdapter(resolver))],
      ["cli", new CliProviderAdapter(resolver, { jobRoot: this.cliJobRoot })],
    ]);
  }

  private async configuredModel(
    provider: string,
    connectionId: string,
    nodeType: string,
    explicit?: string,
    parameters?: Readonly<Record<string, unknown>>,
    frozenConnection?: FrozenProviderConnection | null,
  ): Promise<string | undefined> {
    const explicitModel = explicit?.trim();
    if (provider !== "weai" && explicitModel) return explicitModel;
    if (provider === "fake")
      return nodeType === "video-generation"
        ? "fake-video-v1"
        : "fake-image-v1";

    const connection =
      frozenConnection ?? (await this.repository.getConnection(connectionId));
    const config = connection?.config;
    const modelGroup = connectionConfigString(config, "modelGroup");
    const configured = connectionConfigString(config, "defaultModel");
    if (provider === "weai") {
      return normalizeWeAiModel(
        modelGroup,
        explicitModel ?? configured,
        parameters,
      );
    }
    if (configured) return configured;
    if (provider === "openai") return OPENAI_DEFAULT_IMAGE_MODEL;
    if (provider === "runway") return RUNWAY_DEFAULT_VIDEO_MODEL;
    if (provider === "rest") {
      const connector = isRecord(config?.connector) ? config.connector : null;
      const models = Array.isArray(connector?.models) ? connector.models : [];
      const descriptor =
        models.find((model) => isRecord(model) && model.isDefault === true) ??
        models.find((model) => isRecord(model) && typeof model.id === "string");
      if (isRecord(descriptor) && typeof descriptor.id === "string")
        return descriptor.id;
    }
    return undefined;
  }

  private async freezeModels(graph: WorkflowGraph): Promise<WorkflowGraph> {
    const frozen = structuredClone(graph);
    const connections = new Map<
      string,
      Promise<ProviderConnectionRecord | null>
    >();
    await Promise.all(
      frozen.nodes.map(async (node) => {
        const data = nodeData(node);
        // Canvas/project JSON is untrusted. Only this server may mint execution snapshots.
        delete data.__runtimeConnection;
        const type = semanticType(node);
        if (type !== "image-generation" && type !== "video-generation") return;
        const provider =
          typeof data.provider === "string" ? data.provider : "fake";
        const connectionId =
          typeof data.connectionId === "string"
            ? data.connectionId
            : "fake-default";
        let connection: ProviderConnectionRecord | null = null;
        if (connectionId !== "fake-default") {
          let pending = connections.get(connectionId);
          if (!pending) {
            pending = this.repository.getConnection(connectionId);
            connections.set(connectionId, pending);
          }
          connection = await pending;
          if (connection) {
            const supplierId = connection.config.supplierId;
            const supplier = typeof supplierId === "string" ? await this.repository.getSupplier(supplierId) : null;
            const useCloud = type === "image-generation" && supplier?.state?.generationTransport === "cloudflare";
            if (useCloud && !["openai", "weai", "rest"].includes(connection.provider))
              throw new Error("该供应商接口暂不支持云端生图，请取消云端选项后使用本机方式");
            const cloud = useCloud ? await readCloudGenerationConfig() : null;
            if (useCloud) await testCloudGeneration(cloud);
            data.__runtimeConnection = { ...freezeConnection(connection), ...(cloud ? { cloudGeneration: cloud } : {}) };
          }
        }
        if (provider === "cli" && (!connection || connection.provider !== "cli"))
          throw new Error("个人 AI 网站连接不存在，请在设置中重新绑定本机连接");
        const requestedModel =
          typeof data.model === "string" ? data.model : undefined;
        const model = await this.configuredModel(
          provider,
          connectionId,
          type,
          requestedModel,
          data.parameters,
          connection ? freezeConnection(connection) : null,
        );
        if (model) data.model = model;
        if (provider === "weai") {
          data.parameters = normalizeWeAiParameters(
            data.parameters,
            requestedModel,
            connectionConfigString(connection?.config, "modelGroup"),
          );
        }
      }),
    );
    return frozen;
  }

  /**
   * Capture outputs from nodes outside the selected subgraph at run creation
   * time. A queued run must never start using a newer upstream generation that
   * happened after the run was created.
   */
  private async freezeHistoricalInputs(
    graph: WorkflowGraph,
    canvasId: string,
    selected: Set<string>,
  ): Promise<Map<string, JsonObject>> {
    const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
    const byTarget = new Map<string, JsonObject>();
    const sourceCache = new Map<string, OutputValue | null>();

    const resolveSource = async (
      sourceId: string,
    ): Promise<OutputValue | null> => {
      if (sourceCache.has(sourceId)) return sourceCache.get(sourceId) ?? null;
      const sourceNode = nodeMap.get(sourceId);
      if (!sourceNode) {
        sourceCache.set(sourceId, null);
        return null;
      }
      const type = semanticType(sourceNode);
      let output: OutputValue | null = null;
      if (type === "prompt") {
        const data = nodeData(sourceNode);
        const prompt: PromptPart[] = Array.isArray(data.parts)
          ? (data.parts as PromptPart[])
          : Array.isArray(data.prompt)
            ? (data.prompt as PromptPart[])
            : [
                {
                  type: "text",
                  text: typeof data.text === "string" ? data.text : "",
                },
              ];
        output = { kind: "text", prompt };
      } else if (type === "asset-input") {
        const assetId = nodeData(sourceNode).assetId;
        const asset =
          typeof assetId === "string"
            ? await this.repository.getAsset(assetId)
            : null;
        output = asset
          ? {
              kind: inputAssetKind(asset.kind),
              assetIds: [asset.id],
            }
          : null;
      } else {
        const latest = await this.repository.findLatestSucceededNodeRun(
          canvasId,
          sourceId,
        );
        output = latest ? await this.completedOutput(sourceNode, latest) : null;
        if (output && (!output.assetIds || output.assetIds.length === 0))
          output = null;
      }
      sourceCache.set(sourceId, output);
      return output;
    };

    for (const nodeId of selected) {
      const snapshots: HistoricalInputs = {};
      for (const edge of graph.edges) {
        if (edge.target !== nodeId || selected.has(edge.source)) continue;
        const output = await resolveSource(edge.source);
        snapshots[edge.source] = output
          ? { value: structuredClone(output) }
          : { missing: true };
      }
      byTarget.set(nodeId, snapshots as JsonObject);
    }
    return byTarget;
  }

  private async ensureNodeRuns(run: WorkflowRunRecord): Promise<void> {
    if (run.status !== "queued" && run.status !== "running") return;
    const graph = asGraph(run.revisionGraph);
    const nodeIds = selectRunNodeIds(
      graph,
      run.scope,
      run.nodeId ?? undefined,
      run.nodeIds ?? undefined,
    );
    const selected = new Set(nodeIds);
    const existingNodeRuns = await this.repository.listNodeRuns(run.id);
    const existingByNodeId = new Map(
      existingNodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]),
    );
    const preparedInputs = run.revisionGraph.__preparedHistoricalInputs;
    const historicalInputs = isRecord(preparedInputs)
      ? new Map(
          Object.entries(preparedInputs).map(([id, value]) => [
            id,
            isRecord(value) ? value : {},
          ]),
        )
      : await this.freezeHistoricalInputs(graph, run.canvasId, selected);
    for (const id of nodeIds) {
      const existing = existingByNodeId.get(id);
      const snapshot = historicalInputs.get(id) ?? {};
      const approvalPolicy =
        run.scope === "selection"
          ? { paidRetryPolicy: "approval-required" }
          : {};
      if (existing) {
        // Preserve provider/task fields on retries while filling snapshots for
        // runs created by older versions of the service.
        if (
          existing.inputJson.historicalInputs === undefined ||
          (run.scope === "selection" &&
            existing.inputJson.paidRetryPolicy !== "approval-required")
        ) {
          await this.repository.updateNodeRun(existing.id, {
            inputJson: {
              ...existing.inputJson,
              historicalInputs: snapshot,
              ...approvalPolicy,
            },
          });
        }
      } else {
        await this.repository.createNodeRun({
          id: randomUUID(),
          workflowRunId: run.id,
          nodeId: id,
          status: "queued",
          attempt: 0,
          providerTaskId: null,
          inputJson: { historicalInputs: snapshot, ...approvalPolicy },
          outputAssetIds: [],
          errorJson: null,
        });
      }
    }
  }

  async prepareRun(input: {
    canvasId: string;
    scope: RunScope;
    nodeId?: string;
    nodeIds?: readonly string[];
  }): Promise<PreparedRun> {
    const canvas = await this.repository.getCanvas(input.canvasId);
    if (!canvas) throw new Error("Canvas not found");
    const graph = await this.freezeModels(asGraph(canvas.graph));
    const validation = validateGraph(graph, {
      checkPorts: true,
      checkRequiredInputs: false,
    });
    if (!validation.valid)
      throw new Error(
        validation.errors.map((error) => error.message).join("; "),
      );
    const nodeIds = selectRunNodeIds(
      graph,
      input.scope,
      input.nodeId,
      input.nodeIds,
    );
    const selected = new Set(nodeIds);
    assertDesktopPublicAssets(graph, selected);
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const missingRequiredInputs = validateGraph(graph, {
      checkPorts: true,
      checkRequiredInputs: true,
    }).errors.filter(
      (error) =>
        error.code === "missing_required_input" &&
        error.nodeId !== undefined &&
        selected.has(error.nodeId) &&
        !(
          error.portId === "prompt" &&
          hasInlineGenerationPrompt(nodeById.get(error.nodeId))
        ),
    );
    if (missingRequiredInputs.length > 0) {
      throw new Error(
        missingRequiredInputs.map((error) => error.message).join("; "),
      );
    }
    const historicalInputs = await this.freezeHistoricalInputs(
      graph,
      input.canvasId,
      selected,
    );
    for (const [nodeId, inputs] of historicalInputs) {
      for (const [sourceId, snapshot] of Object.entries(inputs)) {
        if (
          snapshot &&
          typeof snapshot === "object" &&
          !Array.isArray(snapshot) &&
          "missing" in snapshot &&
          snapshot.missing === true
        )
          throw new Error(
            `节点 ${nodeId} 的上游 ${sourceId} 没有可用成果，请先生成上游或连接有效素材`,
          );
      }
    }
    return {
      canvasId: canvas.id,
      canvasRevision: canvas.revision,
      scope: input.scope,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      nodeIds: [...nodeIds],
      revisionGraph: {
        ...graph,
        __preparedHistoricalInputs: Object.fromEntries(historicalInputs),
      } as unknown as JsonObject,
    };
  }

  async createRunFromPrepared(
    prepared: PreparedRun,
    clientRequestId: string,
  ): Promise<WorkflowRunRecord> {
    let run = await this.repository.getRunByClientRequest(
      prepared.canvasId,
      clientRequestId,
    );
    if (!run) {
      assertDesktopPublicAssets(asGraph(prepared.revisionGraph), new Set(prepared.nodeIds));
      run = await this.repository.createRun({
        id: randomUUID(),
        canvasId: prepared.canvasId,
        clientRequestId,
        scope: prepared.scope,
        nodeId: prepared.nodeId ?? null,
        nodeIds: prepared.scope === "selection" ? [...prepared.nodeIds] : null,
        status: "queued",
        revisionGraph: structuredClone(prepared.revisionGraph),
      });
    }
    if (run.status !== "queued" && run.status !== "running") return run;
    await this.ensureNodeRuns(run);
    this.publish({
      type: "run",
      runId: run.id,
      payload: { status: run.status, nodeIds: prepared.nodeIds },
    });
    await this.scheduleRun(run.id);
    return run;
  }

  async createRun(input: {
    canvasId: string;
    clientRequestId: string;
    scope: RunScope;
    nodeId?: string;
    nodeIds?: readonly string[];
  }): Promise<WorkflowRunRecord> {
    let run = await this.repository.getRunByClientRequest(
      input.canvasId,
      input.clientRequestId,
    );
    if (!run) {
      const canvas = await this.repository.getCanvas(input.canvasId);
      if (!canvas) throw new Error("Canvas not found");
      const graph = await this.freezeModels(asGraph(canvas.graph));
      const validation = validateGraph(graph, {
        checkPorts: true,
        checkRequiredInputs: false,
      });
      if (!validation.valid)
        throw new Error(
          validation.errors.map((error) => error.message).join("; "),
        );
      const nodeIds = selectRunNodeIds(
        graph,
        input.scope,
        input.nodeId,
        input.nodeIds,
      );
      const selected = new Set(nodeIds);
      assertDesktopPublicAssets(graph, selected);
      const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
      const missingRequiredInputs = validateGraph(graph, {
        checkPorts: true,
        checkRequiredInputs: true,
      }).errors.filter(
        (error) =>
          error.code === "missing_required_input" &&
          error.nodeId !== undefined &&
          selected.has(error.nodeId) &&
          !(
            error.portId === "prompt" &&
            hasInlineGenerationPrompt(nodeById.get(error.nodeId))
          ),
      );
      if (missingRequiredInputs.length > 0) {
        throw new Error(
          missingRequiredInputs.map((error) => error.message).join("; "),
        );
      }
      run = await this.repository.createRun({
        id: randomUUID(),
        canvasId: input.canvasId,
        clientRequestId: input.clientRequestId,
        scope: input.scope,
        nodeId: input.nodeId ?? null,
        nodeIds: input.scope === "selection" ? [...nodeIds] : null,
        status: "queued",
        revisionGraph: graph as unknown as JsonObject,
      });
    }

    if (run.status !== "queued" && run.status !== "running") return run;
    const nodeIds = selectRunNodeIds(
      asGraph(run.revisionGraph),
      run.scope,
      run.nodeId ?? undefined,
      run.nodeIds ?? undefined,
    );
    await this.ensureNodeRuns(run);
    this.publish({
      type: "run",
      runId: run.id,
      payload: { status: run.status, nodeIds },
    });
    await this.scheduleRun(run.id);
    return run;
  }

  private async scheduleRun(runId: string): Promise<void> {
    if (this.executionMode === "queue" && this.enqueueRunOverride) {
      await this.enqueueRunOverride(runId);
      return;
    }
    await this.resumeRun(runId);
  }

  private startExecution(runId: string): void {
    if (this.shutdownSignal?.aborted) return;
    const admission = this.scheduler.beginRun(runId);
    if (!admission) return;
    const signal = this.shutdownSignal
      ? AbortSignal.any([admission.signal, this.shutdownSignal]) : admission.signal;
    const execution = this.execute(runId, signal).finally(admission.dispose);
    this.running.set(runId, execution);
    void execution.then(
      () => this.running.delete(runId),
      () => this.running.delete(runId),
    );
  }

  public async resumeRun(runId: string): Promise<void> {
    if (this.running.has(runId) || this.starting.has(runId)) return;
    this.starting.add(runId);
    try {
      const run = await this.repository.getRun(runId);
      if (!run || (run.status !== "queued" && run.status !== "running")) return;
      await this.ensureNodeRuns(run);
      if (!this.running.has(runId)) this.startExecution(runId);
    } finally {
      this.starting.delete(runId);
    }
  }

  public async reconcileCancellation(runId: string): Promise<void> {
    const run = await this.repository.getRun(runId);
    if (!run || run.status !== "cancelled") return;
    const graph = asGraph(run.revisionGraph);
    const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
    const adapters = this.adapters(
      new RepoConnectionResolver(
        this.repository,
        frozenConnectionsFromGraph(graph),
      ),
    );
    const nodeRuns = await this.repository.listNodeRuns(runId);
    for (const nodeRun of nodeRuns) {
      if (nodeRun.status !== "cancel_requested") continue;
      try {
        if (isCloudSubmission(nodeRun.providerTaskId)) {
          await this.repository.updateNodeRun(nodeRun.id, {
            status: "cancelled", errorJson: { code: "cloud_tracking_stopped", message: "已停止本机跟踪；云端可能仍在生成并保存原任务结果" },
          });
          continue;
        }
        if (!nodeRun.providerTaskId) {
          await this.repository.updateNodeRun(nodeRun.id, {
            errorJson: {
              message:
                "取消请求待人工确认：供应商任务 ID 未成功持久化，无法发送远端取消",
            },
          });
          continue;
        }
        const node = nodeMap.get(nodeRun.nodeId);
        const data = node ? nodeData(node) : {};
        const provider =
          typeof nodeRun.inputJson.provider === "string"
            ? nodeRun.inputJson.provider
            : typeof data.provider === "string"
              ? data.provider
              : "fake";
        const connectionId =
          typeof nodeRun.inputJson.connectionId === "string"
            ? nodeRun.inputJson.connectionId
            : typeof data.connectionId === "string"
              ? data.connectionId
              : "fake-default";
        const adapter = adapters.get(provider);
        if (!adapter) throw new Error(`未安装供应商适配器: ${provider}`);
        const task =
          storedProviderTask(nodeRun.inputJson.providerTask) ??
          (await this.restoreProviderTask(
            provider,
            connectionId,
            nodeRun.providerTaskId,
            { adapter, idempotencyKey: `${runId}:${nodeRun.id}` },
          ));
        await adapter.cancel?.(task);
        await this.repository.updateNodeRun(nodeRun.id, {
          status: "cancelled",
          errorJson: provider === "cli" && cliStopsTracking(task)
            ? { code: "cli_tracking_stopped", message: "已停止跟踪；该网站不支持远端取消，生成可能仍在继续" }
            : null,
        });
        this.publish({
          type: "node",
          runId,
          nodeRunId: nodeRun.id,
          payload: { nodeId: nodeRun.nodeId, status: "cancelled" },
        });
      } catch (error) {
        const provider = nodeRun.inputJson.provider;
        const connectionId = nodeRun.inputJson.connectionId;
        const adapter = adapters.get("cli");
        // Cancellation can race a completed website task. Preserve that response for archive-only recovery.
        if (provider === "cli" && typeof connectionId === "string" && adapter instanceof CliProviderAdapter) {
          try {
            const task = await adapter.restoreTask(connectionId, `${runId}:${nodeRun.id}`, nodeRun.providerTaskId ?? undefined);
            if (task.status === "succeeded") {
              await this.repository.updateNodeRun(nodeRun.id, {
                status: "cancelled",
                inputJson: { ...nodeRun.inputJson, providerTask: providerTaskJson(task) },
                errorJson: { code: "cli_completed_after_cancel", message: "已停止跟踪；网站任务已经完成，可取回已有结果" },
              });
              this.publish({ type: "node", runId, nodeRunId: nodeRun.id, payload: { nodeId: nodeRun.nodeId, status: "cancelled" } });
              continue;
            }
          } catch { /* Keep cancellation pending when the local task cannot be restored. */ }
        }
        await this.repository.updateNodeRun(nodeRun.id, {
          errorJson: {
            message: `远端取消暂未完成：${error instanceof Error ? error.message : String(error)}`,
          },
        });
      }
    }
  }

  /** Resume a failed or indeterminate run without creating a new provider task. */
  public async retryRun(runId: string): Promise<WorkflowRunRecord | null> {
    if (runOutputRecoveries.get(this.repository)?.has(runId))
      throw new Error("正在取回已有结果，请等待归档完成");
    const run = await this.repository.getRun(runId);
    if (!run) return null;
    if (!["failed", "needs_attention"].includes(run.status)) {
      throw new Error(`运行状态 ${run.status} 不支持恢复`);
    }
    if (isRunRecoveryExpired(run)) {
      throw new Error(
        "该运行已超过本地恢复历史保留上限；错误记录仍保留，请从当前画布重新运行",
      );
    }

    const nodeRuns = await this.repository.listNodeRuns(runId);
    if (
      run.scope === "selection" &&
      nodeRuns.some(
        (nodeRun) => nodeRun.status === "failed" && !nodeRun.providerTaskId,
      )
    ) {
      throw new Error(
        "导演方案的付费调用失败后必须重新报价并确认，不能直接重试",
      );
    }
    const retryNodeIds = new Set<string>();
    for (let nodeRun of nodeRuns) {
      if (
        nodeRun.status === "needs_attention" ||
        (run.status === "needs_attention" && nodeRun.status === "archiving")
      ) {
        if (!nodeRun.providerTaskId && nodeRun.inputJson.provider === "cli") {
          const adapters = this.adapters(new RepoConnectionResolver(this.repository, frozenConnectionsFromGraph(asGraph(run.revisionGraph))));
          nodeRun = await this.recoverCliSubmission(runId, nodeRun, adapters.get("cli")) ?? nodeRun;
        }
        if (!nodeRun.providerTaskId) {
          throw new Error(
            `节点 ${nodeRun.nodeId} 没有可恢复的供应商任务 ID；请人工核对后新建运行`,
          );
        }
        const savedTask = storedProviderTask(nodeRun.inputJson.providerTask);
        await this.repository.updateNodeRun(nodeRun.id, {
          status: savedTask?.status === "succeeded" ? "archiving" : "running",
          errorJson: null,
        });
        retryNodeIds.add(nodeRun.nodeId);
      } else if (nodeRun.status === "failed" && !nodeRun.providerTaskId) {
        await this.repository.updateNodeRun(nodeRun.id, {
          status: "queued",
          errorJson: null,
        });
        retryNodeIds.add(nodeRun.nodeId);
      }
    }
    if (retryNodeIds.size === 0)
      throw new Error("没有可恢复的节点；请人工核对供应商任务");

    const graph = asGraph(run.revisionGraph);
    const descendants = new Set(retryNodeIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const edge of graph.edges) {
        if (descendants.has(edge.source) && !descendants.has(edge.target)) {
          descendants.add(edge.target);
          expanded = true;
        }
      }
    }
    for (const nodeRun of nodeRuns) {
      if (
        descendants.has(nodeRun.nodeId) &&
        ["blocked", "failed"].includes(nodeRun.status) &&
        !nodeRun.providerTaskId
      ) {
        await this.repository.updateNodeRun(nodeRun.id, {
          status: "queued",
          errorJson: null,
        });
      }
    }

    const queued = await this.repository.transitionRunStatus(
      runId,
      ["failed", "needs_attention"],
      "queued",
    );
    if (!queued) throw new Error("运行状态已被其他 Worker 修改，请刷新后重试");
    this.publish({ type: "run", runId, payload: { status: "queued" } });
    await this.scheduleRun(runId);
    return queued;
  }

  /** Archive a stored successful response without submitting, polling, or resuming the graph. */
  public recoverRunOutputs(runId: string): Promise<WorkflowRunRecord | null> {
    let recoveries = runOutputRecoveries.get(this.repository);
    if (!recoveries) {
      recoveries = new Map();
      runOutputRecoveries.set(this.repository, recoveries);
    }
    const existing = recoveries.get(runId);
    if (existing) return existing;
    const recovery = this.recoverStoredRunOutputs(runId).finally(() => {
      recoveries.delete(runId);
    });
    recoveries.set(runId, recovery);
    return recovery;
  }

  private async recoverStoredRunOutputs(runId: string): Promise<WorkflowRunRecord | null> {
    const run = await this.repository.getRun(runId);
    if (!run) return null;
    const isTerminal = (status: WorkflowRunRecord["status"]) =>
      status === "cancelled" || status === "failed" || status === "needs_attention";
    if (!isTerminal(run.status))
      throw new Error("仅已取消、失败或待处理的运行可取回已有结果");
    const candidates = (await this.repository.listNodeRuns(runId)).flatMap(node => {
      const task = storedProviderTask(node.inputJson.providerTask);
      return task?.status === "succeeded" && task.providerTaskId.trim() && task.result != null
        ? [{ node, task }] : [];
    });
    if (!candidates.length)
      throw new Error("没有已保存的成功结果可取回；超时或 524 记录不能重新生成或推测恢复");
    // A compacted cancelled graph is deliberately unnecessary. Result parsing
    // uses the saved response and provider recorded on the node itself.
    const adapters = this.adapters();
    for (const { node, task } of candidates) {
      if (node.providerTaskId && node.providerTaskId !== task.providerTaskId)
        throw new Error(`节点 ${node.nodeId} 的已存结果与任务 ID 不匹配`);
      const provider = node.inputJson.provider;
      const adapter = typeof provider === "string" ? adapters.get(provider) : undefined;
      if (!adapter) throw new Error(`节点 ${node.nodeId} 缺少可解析已有结果的供应商协议`);
      let artifacts: RemoteArtifact[];
      try {
        artifacts = await adapter.extractOutputs(task.result);
      } catch (error) {
        throw new Error("已有结果解析失败，原始结果仍保留，可修复后再次取回", { cause: error });
      }
      if (!artifacts.length || artifacts.some(artifact =>
        !artifact.data?.byteLength && !artifact.localFile && !(typeof artifact.url === "string" && artifact.url.trim())))
        throw new Error(`节点 ${node.nodeId} 的已存响应没有可归档的图片或视频；未重新生成`);
      const ids: string[] = [];
      for (const [index, artifact] of artifacts.entries()) {
        const latestRun = await this.repository.getRun(runId);
        if (!latestRun || !isTerminal(latestRun.status))
          throw new Error("运行状态已变化，已停止取回；已存结果仍保留");
        const id = createHash("sha256").update(`${runId}\0${node.nodeId}\0${index}`).digest("hex");
        const asset = await this.repository.getAsset(id);
        if (asset) {
          if (asset.metadata.runId !== runId || asset.metadata.nodeId !== node.nodeId)
            throw new Error("已有输出资产与运行不匹配，已停止取回");
          if (await this.hasValidArchivedObject(asset)) {
            await this.archiveProjectAsset(asset, runId);
            ids.push(id);
            continue;
          }
        }
        try {
          ids.push(await this.archiveArtifact(artifact, runId, node.nodeId, index));
        } catch (error) {
          throw new Error("已有结果归档失败，原始结果仍保留，可再次取回；未重新生成", { cause: error });
        }
      }
      const latestRun = await this.repository.getRun(runId);
      if (!latestRun || !isTerminal(latestRun.status))
        throw new Error("运行状态已变化，原始结果与已归档文件仍保留");
      const outputAssetIds = [...new Set([...node.outputAssetIds, ...ids])];
      await adapter.cleanup?.(task.result);
      if (outputAssetIds.length === node.outputAssetIds.length &&
        outputAssetIds.every((id, index) => id === node.outputAssetIds[index])) continue;
      // Preserve cancellation/failure and its original diagnostic. In particular,
      // do not remove the response snapshot or enqueue any descendant nodes.
      const updated = await this.repository.updateNodeRun(node.id, { outputAssetIds }, {
        expectedStatus: node.status, expectedUpdatedAt: node.updatedAt,
      });
      if (!updated) throw new Error("节点记录已变化，已归档文件仍保留，请刷新后再次取回");
      this.publish({ type: "node", runId, nodeRunId: node.id, payload: {
        nodeId: node.nodeId, status: updated.status, recovered: true,
        output: { kind: artifacts[0]!.kind, assetIds: outputAssetIds },
      } });
    }
    return this.repository.getRun(runId);
  }

  async cancelRun(runId: string): Promise<WorkflowRunRecord | null> {
    const current = await this.repository.getRun(runId);
    if (!current) return null;
    const nodeRuns = await this.repository.listNodeRuns(runId);
    const cliAttention = current.status === "needs_attention" && nodeRuns.some(node =>
      node.status === "needs_attention" && node.inputJson.provider === "cli");
    if (
      ["succeeded", "failed", "cancelled", "needs_attention"].includes(
        current.status,
      ) && !cliAttention
    ) {
      throw new Error(`Cannot cancel terminal run in status ${current.status}`);
    }
    const run = await this.repository.transitionRunStatus(
      runId,
      cliAttention ? ["queued", "running", "needs_attention"] : ["queued", "running"],
      "cancelled",
    );
    if (!run) {
      const latest = await this.repository.getRun(runId);
      throw new Error(
        `Cannot cancel run in status ${latest?.status ?? "missing"}`,
      );
    }
    this.scheduler.cancelRun(runId);
    await Promise.all(
      nodeRuns
        .filter((node) =>
          [
            "queued",
            "submitting",
            "running",
            "archiving",
            "cancel_requested",
          ].includes(node.status) || (cliAttention && node.status === "needs_attention" && node.inputJson.provider === "cli"),
        )
        .map((node) => {
          const stopsUnknownCli = node.inputJson.provider === "cli" && !node.providerTaskId && node.status === "needs_attention";
          return this.repository.updateNodeRun(node.id, {
            status: node.status === "queued" || stopsUnknownCli ? "cancelled" : "cancel_requested",
            ...(stopsUnknownCli ? { errorJson: { code: "cli_tracking_stopped", message: "已停止跟踪；提交结果未知，请在网站核对生成任务" } } : {}),
          });
        }),
    );
    this.publish({ type: "run", runId, payload: { status: "cancelled" } });
    return run;
  }

  async getRun(
    runId: string,
  ): Promise<{ run: WorkflowRunRecord; nodes: NodeRunRecord[] } | null> {
    const run = await this.repository.getRun(runId);
    return run
      ? { run, nodes: await this.repository.listNodeRuns(runId) }
      : null;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    return this.eventBus.subscribe(listener);
  }

  private publish(event: Omit<import("./events.js").RuntimeEvent, "at">): void {
    this.eventBus.publish({ ...event, at: timestamp() });
  }

  private async updateNodeRunOrCancel(
    runId: string,
    nodeRunId: string,
    patch: Partial<Omit<NodeRunRecord, "id" | "createdAt" | "updatedAt">>,
    options: NodeRunUpdateOptions = {},
  ): Promise<NodeRunRecord> {
    const updated = await this.repository.updateNodeRun(
      nodeRunId,
      patch,
      options,
    );
    if (updated) return updated;

    const [run, current] = await Promise.all([
      this.repository.getRun(runId),
      this.repository.getNodeRun(nodeRunId),
    ]);
    if (
      run?.status === "cancelled" ||
      current?.status === "cancel_requested" ||
      current?.status === "cancelled"
    ) {
      throw new CancelledError("运行已取消");
    }
    throw new NeedsAttentionError("节点状态已被其他执行器修改；本次执行已停止");
  }

  private async completedOutput(
    node: WorkflowNode,
    nodeRun: NodeRunRecord,
  ): Promise<OutputValue> {
    const data = nodeData(node);
    if (semanticType(node) === "prompt") {
      const prompt: PromptPart[] = Array.isArray(data.parts)
        ? (data.parts as PromptPart[])
        : Array.isArray(data.prompt)
          ? (data.prompt as PromptPart[])
          : [
              {
                type: "text",
                text: typeof data.text === "string" ? data.text : "",
              },
            ];
      return { kind: "text", prompt };
    }
    if (
      semanticType(node) === "asset-input" &&
      typeof data.assetId === "string"
    ) {
      const asset = await this.repository.getAsset(data.assetId);
      return {
        kind: asset?.kind === "video" ? "video" : "image",
        assetIds: [data.assetId],
      };
    }
    return {
      kind: semanticType(node) === "video-generation" ? "video" : "image",
      assetIds: nodeRun.outputAssetIds,
    };
  }

  /**
   * Keep unexpected repository/provider failures from leaving a run in
   * `running` forever.  Node-level failures are handled by executeInternal;
   * this boundary is for failures that happen before/after that loop (for
   * example a malformed frozen graph or a database error during finalization).
   */
  private async execute(runId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.executeInternal(runId, signal);
    } catch (error) {
      if (this.shutdownSignal?.aborted) return;
      await this.handleExecutionFailure(runId, error);
    }
  }

  private async handleExecutionFailure(
    runId: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    let current: WorkflowRunRecord | null;
    try {
      current = await this.repository.getRun(runId);
    } catch {
      // There is no reliable state transition to make while the repository is
      // unavailable. The queue/worker will retry the opaque run id later.
      return;
    }
    if (!current) return;

    // Cancellation wins over an execution error. In particular, do not turn
    // a remote-cancel failure into a failed/needs_attention run here.
    if (current.status === "cancelled") {
      this.publish({
        type: "run",
        runId,
        payload: { status: "cancelled" },
      });
      return;
    }
    if (
      current.status === "succeeded" ||
      current.status === "failed" ||
      current.status === "needs_attention"
    ) {
      return;
    }

    let transitioned: WorkflowRunRecord | null = null;
    try {
      transitioned = await this.repository.transitionRunStatus(
        runId,
        ["queued", "running"],
        "needs_attention",
      );
    } catch {
      // A concurrent cancellation/finalization may have won the race. Read
      // the authoritative state below and avoid writing a second transition.
    }

    let latest = transitioned;
    try {
      latest ??= await this.repository.getRun(runId);
    } catch {
      latest = null;
    }
    if (!latest || latest.status === "cancelled") {
      if (latest?.status === "cancelled") {
        this.publish({
          type: "run",
          runId,
          payload: { status: "cancelled" },
        });
      }
      return;
    }
    if (latest.status !== "needs_attention") return;

    try {
      const nodeRuns = await this.repository.listNodeRuns(runId);
      for (const nodeRun of nodeRuns) {
        if (
          !["queued", "submitting", "running", "archiving"].includes(
            nodeRun.status,
          )
        ) {
          continue;
        }
        const updated = await this.repository.updateNodeRun(nodeRun.id, {
          status: "needs_attention",
          errorJson: { message },
        });
        if (updated) {
          this.publish({
            type: "node",
            runId,
            nodeRunId: nodeRun.id,
            payload: {
              nodeId: nodeRun.nodeId,
              status: "needs_attention",
              error: message,
            },
          });
        }
      }
    } catch {
      // The run status is already durable. A later retry/reconciliation can
      // repair individual node rows if the node update itself failed.
    }
    this.publish({
      type: "run",
      runId,
      payload: { status: "needs_attention", error: message },
    });
  }

  private async executeInternal(runId: string, signal: AbortSignal): Promise<void> {
    const run = await this.repository.transitionRunStatus(
      runId,
      ["queued", "running"],
      "running",
    );
    if (!run) return;
    this.publish({ type: "run", runId, payload: { status: "running" } });
    const graph = asGraph(run.revisionGraph);
    const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
    const nodeRuns = await this.repository.listNodeRuns(runId);
    const orderedNodeIds = selectRunNodeIds(
      graph,
      run.scope,
      run.nodeId ?? undefined,
      run.nodeIds ?? undefined,
    );
    const nodeRunByNodeId = new Map(
      nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]),
    );
    const selected = new Set(nodeRuns.map((node) => node.nodeId));
    const outputs = new Map<string, OutputValue>();
    const statuses = new Map(
      nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun.status]),
    );
    const adapters = this.adapters(
      new RepoConnectionResolver(
        this.repository,
        frozenConnectionsFromGraph(graph),
      ),
    );
    let overall: WorkflowRunRecord["status"] = "succeeded";

    for (const nodeRun of nodeRuns) {
      const node = nodeMap.get(nodeRun.nodeId);
      if (node && nodeRun.status === "succeeded") {
        outputs.set(node.id, await this.completedOutput(node, nodeRun));
      }
    }

    const historicalSourceIds = new Set(
      graph.edges
        .filter(
          (edge) => selected.has(edge.target) && !selected.has(edge.source),
        )
        .map((edge) => edge.source),
    );
    const missingHistoricalSourceIds = new Set<string>();
    const snapshottedSourceIds = new Set<string>();
    // New runs carry immutable historical inputs on each node_run. Loading
    // them first prevents a newer upstream success from changing this run's
    // request. Older rows without the field use the compatibility lookup below.
    for (const nodeRun of nodeRuns) {
      const snapshots = historicalInputsFromUnknown(
        nodeRun.inputJson.historicalInputs,
      );
      if (!snapshots) continue;
      for (const [sourceId, snapshot] of Object.entries(snapshots)) {
        snapshottedSourceIds.add(sourceId);
        if ("missing" in snapshot) {
          missingHistoricalSourceIds.add(sourceId);
        } else {
          outputs.set(sourceId, structuredClone(snapshot.value));
        }
      }
    }
    await Promise.all(
      [...historicalSourceIds]
        .filter((sourceId) => !snapshottedSourceIds.has(sourceId))
        .map(async (sourceId) => {
          const sourceNode = nodeMap.get(sourceId);
          if (
            !sourceNode ||
            semanticType(sourceNode) === "prompt" ||
            semanticType(sourceNode) === "asset-input"
          ) {
            return;
          }
          const latest = await this.repository.findLatestSucceededNodeRun(
            run.canvasId,
            sourceId,
          );
          if (latest) {
            outputs.set(
              sourceId,
              await this.completedOutput(sourceNode, latest),
            );
          } else {
            missingHistoricalSourceIds.add(sourceId);
          }
        }),
    );

    let executionLost = false;
    const executeScheduledNode = async (nodeId: string): Promise<boolean> => {
      if (executionLost) return false;
      const persistedRun = await this.repository.getRun(runId);
      if (persistedRun?.status === "cancelled") {
        overall = "cancelled";
        return false;
      }
      const node = nodeMap.get(nodeId);
      let nodeRun = nodeRunByNodeId.get(nodeId);
      if (!node || !nodeRun) return true;
      if (nodeRun.status === "succeeded") return true;
      if (
        nodeRun.status === "failed" ||
        nodeRun.status === "needs_attention" ||
        nodeRun.status === "cancelled" ||
        nodeRun.status === "blocked"
      ) {
        const existingOutcome =
          nodeRun.status === "needs_attention"
            ? "needs_attention"
            : nodeRun.status === "cancelled"
              ? "cancelled"
              : "failed";
        overall = combineRunStatus(overall, existingOutcome);
        return true;
      }

      const missingHistoricalDependencies = graph.edges
        .filter(
          (edge) =>
            edge.target === nodeId &&
            missingHistoricalSourceIds.has(edge.source),
        )
        .map((edge) => edge.source);
      if (missingHistoricalDependencies.length > 0) {
        const message = `以下节点没有可用的历史成功输出：${missingHistoricalDependencies.join(", ")}`;
        await this.repository.updateNodeRun(nodeRun.id, {
          status: "failed",
          errorJson: { message },
        });
        statuses.set(nodeId, "failed");
        overall = combineRunStatus(overall, "failed");
        this.publish({
          type: "node",
          runId,
          nodeRunId: nodeRun.id,
          payload: { nodeId, status: "failed", error: message },
        });
        return true;
      }

      const unavailableDependencies = graph.edges
        .filter((edge) => edge.target === nodeId && selected.has(edge.source))
        .map((edge) => ({
          nodeId: edge.source,
          status: statuses.get(edge.source),
        }))
        .filter((dependency) => dependency.status !== "succeeded");
      if (unavailableDependencies.length > 0) {
        const dependencyOutcome = unavailableDependencies.some(
          (dependency) => dependency.status === "needs_attention",
        )
          ? "needs_attention"
          : unavailableDependencies.some(
                (dependency) => dependency.status === "cancelled",
              )
            ? "cancelled"
            : "failed";
        const message = `以下上游节点不可用，当前节点已阻塞：${unavailableDependencies
          .map(
            (dependency) =>
              `${dependency.nodeId} (${dependency.status ?? "missing"})`,
          )
          .join(", ")}`;
        await this.repository.updateNodeRun(nodeRun.id, {
          status: "blocked",
          errorJson: { message },
        });
        statuses.set(nodeId, "blocked");
        overall = combineRunStatus(overall, dependencyOutcome);
        this.publish({
          type: "node",
          runId,
          nodeRunId: nodeRun.id,
          payload: { nodeId, status: "blocked", error: message },
        });
        return true;
      }
      try {
        if (nodeRun.status === "submitting" && !nodeRun.providerTaskId) {
          nodeRun = await this.recoverCliSubmission(runId, nodeRun, adapters.get("cli")) ?? nodeRun;
          if (!nodeRun.providerTaskId)
            throw new NeedsAttentionError(
              "供应商提交结果未知；为避免重复扣费，任务已暂停等待人工确认",
            );
        }
        const claimed = await this.repository.updateNodeRun(
          nodeRun.id,
          {
            status: nodeRun.status === "archiving" ? "archiving" : "running",
            attempt: nodeRun.providerTaskId
              ? nodeRun.attempt
              : nodeRun.attempt + 1,
          },
          { expectedUpdatedAt: nodeRun.updatedAt },
        );
        if (!claimed) {
          const [latestRun, latestNode] = await Promise.all([
            this.repository.getRun(runId),
            this.repository.getNodeRun(nodeRun.id),
          ]);
          if (
            latestRun?.status === "cancelled" ||
            latestNode?.status === "cancel_requested" ||
            latestNode?.status === "cancelled"
          ) {
            overall = "cancelled";
            statuses.set(nodeId, "cancelled");
          }
          // Another executor or cancellation changed this row after our
          // snapshot. It now owns the node; do not submit the provider twice.
          executionLost = true;
          return false;
        }
        this.publish({
          type: "node",
          runId,
          nodeRunId: nodeRun.id,
          payload: { nodeId, status: claimed.status },
        });
        const output = await this.executeNode(
          node,
          graph,
          outputs,
          selected,
          adapters,
          runId,
          claimed,
          signal,
        );
        const currentRun = await this.repository.getRun(runId);
        if (currentRun?.status === "cancelled") {
          throw new CancelledError("运行已取消");
        }
        const completedNode = await this.repository.getNodeRun(nodeRun.id);
        await this.restoreSuccessfulProviderModel(
          completedNode ?? claimed,
        ).catch(() => undefined);
        await this.updateNodeRunOrCancel(runId, nodeRun.id, {
          status: "succeeded",
          outputAssetIds: output.assetIds ?? [],
          inputJson: compactCompletedInput(
            completedNode?.inputJson ?? claimed.inputJson,
          ),
        });
        outputs.set(nodeId, output);
        statuses.set(nodeId, "succeeded");
        this.publish({
          type: "node",
          runId,
          nodeRunId: nodeRun.id,
          payload: { nodeId, status: "succeeded", output },
        });
      } catch (error) {
        const [authoritativeRun, authoritativeNode] = await Promise.all([
          this.repository.getRun(runId),
          this.repository.getNodeRun(nodeRun.id),
        ]);
        if (this.shutdownSignal?.aborted && authoritativeRun?.status !== "cancelled" &&
            authoritativeNode?.status !== "cancel_requested" && authoritativeNode?.status !== "cancelled") {
          // Keep the task ID and running/archiving checkpoint available to the
          // next process. Shutdown is not a provider failure or user cancel.
          executionLost = true;
          return false;
        }
        await this.quarantineUnknownProviderModel(
          error,
          authoritativeNode ?? nodeRun,
        ).catch(() => undefined);
        await this.recordCyberAfeiCapabilityDenial(
          error,
          authoritativeNode ?? nodeRun,
        ).catch(() => undefined);
        const cancellationWon =
          authoritativeRun?.status === "cancelled" ||
          authoritativeNode?.status === "cancel_requested" ||
          authoritativeNode?.status === "cancelled";
        if (cancellationWon && authoritativeNode?.inputJson.provider === "cli" && authoritativeNode.status === "cancel_requested") {
          // Keep an acknowledged-but-pending remote cancellation eligible for reconciliation.
          // In particular, the generic catch below must not turn it into a confirmed cancellation.
          await this.reconcileCancellation(runId);
          const reconciled = await this.repository.getNodeRun(nodeRun.id);
          if (reconciled) {
            overall = "cancelled";
            statuses.set(nodeId, reconciled.status);
            this.publish({ type: "node", runId, nodeRunId: nodeRun.id, payload: { nodeId, status: reconciled.status } });
            return false;
          }
        }
        const nodeOutcome: WorkflowRunRecord["status"] =
          cancellationWon || error instanceof CancelledError
            ? "cancelled"
            : error instanceof NeedsAttentionError
              ? "needs_attention"
              : "failed";
        overall = combineRunStatus(overall, nodeOutcome);
        const providerFailure = providerFailureFor(
          error,
          node,
          authoritativeNode ?? nodeRun,
        );
        const cancelledTask = storedProviderTask(authoritativeNode?.inputJson.providerTask);
        const stoppedCliTracking = nodeOutcome === "cancelled" &&
          authoritativeNode?.inputJson.provider === "cli" && cancelledTask && cliStopsTracking(cancelledTask);
        const message = stoppedCliTracking
          ? "已停止跟踪；该网站不支持远端取消，生成可能仍在继续"
          : providerFailure?.message ?? (error instanceof Error ? error.message : String(error));
        const nodeStatus =
          nodeOutcome === "cancelled"
            ? "cancelled"
            : nodeOutcome === "needs_attention"
              ? "needs_attention"
              : "failed";
        const persistedFailure = await this.repository.updateNodeRun(
          nodeRun.id,
          {
            status: nodeStatus,
            errorJson: providerFailure
              ? { ...providerFailure }
              : {
                  message,
                  ...(error instanceof NeedsAttentionError && error.code
                    ? { code: error.code }
                    : {}),
                },
          },
        );
        const effectiveStatus =
          persistedFailure?.status ?? authoritativeNode?.status ?? nodeStatus;
        statuses.set(nodeId, effectiveStatus);
        this.publish({
          type: "node",
          runId,
          nodeRunId: nodeRun.id,
          payload: { nodeId, status: effectiveStatus, error: message },
        });
        if (nodeOutcome === "cancelled") return false;
      }
      return true;
    };
    const dependencies = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const inputs = dependencies.get(edge.target) ?? [];
      inputs.push(edge.source);
      dependencies.set(edge.target, inputs);
    }
    const stopAdmission = new AbortController();
    const admissionSignal = AbortSignal.any([signal, stopAdmission.signal]);
    const completed = await scheduleReadyNodes(orderedNodeIds, dependencies, this.nodeConcurrency, async (nodeId) => {
      const node = nodeMap.get(nodeId);
      const record = nodeRunByNodeId.get(nodeId);
      const data = node ? nodeData(node) : {};
      const generation = node && !["prompt", "asset-input", "preview"].includes(semanticType(node));
      const provider = generation
        ? (typeof record?.inputJson.provider === "string" ? record.inputJson.provider : data.provider ?? "fake")
        : undefined;
      const connection = generation
        ? (typeof record?.inputJson.connectionId === "string" ? record.inputJson.connectionId : data.connectionId ?? "fake-default")
        : undefined;
      // Claim only after admission; queued cancellation is checked inside the callback.
      try {
        return await this.scheduler.withCapacity({ provider, connection, ...(provider === "cli" ? { connectionLimit: 1 } : {}) }, async () => {
          try {
            const proceed = await executeScheduledNode(nodeId);
            if (!proceed) { executionLost = true; stopAdmission.abort(); }
            return proceed;
          } catch (error) {
            executionLost = true;
            stopAdmission.abort();
            throw error;
          }
        }, admissionSignal);
      } catch (error) {
        if (admissionSignal.aborted && error === admissionSignal.reason) return false;
        throw error;
      }
    });
    if (!completed) return;

    // The repository has no compare-and-swap node patch. Keep outputs in
    // node_run/assets instead of writing a frozen revision over live edits.
    const finalized = await this.repository.transitionRunStatus(
      runId,
      ["queued", "running"],
      overall,
    );
    const finalStatus =
      finalized?.status ??
      (await this.repository.getRun(runId))?.status ??
      overall;
    this.publish({ type: "run", runId, payload: { status: finalStatus } });
  }

  private incoming(
    graph: WorkflowGraph,
    nodeId: string,
    selected: Set<string>,
    outputs: Map<string, OutputValue>,
  ): OutputValue[] {
    return graph.edges
      .filter((edge) => edge.target === nodeId)
      .flatMap((edge) => {
        const targetHandle = getEdgeTargetPortId(edge);
        const addRole = (value: OutputValue): OutputValue => {
          const role =
            targetHandle === "firstFrame" || targetHandle === "lastFrame"
              ? targetHandle
              : "reference";
          if (!value.assetIds || value.assetIds.length === 0) return value;
          return {
            ...value,
            assetRoles: {
              ...value.assetRoles,
              ...Object.fromEntries(
                value.assetIds.map((assetId) => [assetId, role]),
              ),
            },
          };
        };
        const current = outputs.get(edge.source);
        if (current) return [addRole(current)];
        if (selected.has(edge.source)) return [];
        const sourceNode = graph.nodes.find((node) => node.id === edge.source);
        if (sourceNode && semanticType(sourceNode) === "prompt") {
          const sourceData = nodeData(sourceNode);
          const prompt = Array.isArray(sourceData.parts)
            ? (sourceData.parts as PromptPart[])
            : Array.isArray(sourceData.prompt)
              ? (sourceData.prompt as PromptPart[])
              : [
                  {
                    type: "text" as const,
                    text:
                      typeof sourceData.text === "string"
                        ? sourceData.text
                        : "",
                  },
                ];
          return [{ kind: "text", prompt }];
        }
        if (
          sourceNode &&
          semanticType(sourceNode) === "asset-input" &&
          typeof nodeData(sourceNode).assetId === "string"
        ) {
          const kind = inputAssetKind(String(nodeData(sourceNode).assetKind));
          return [
            addRole({
              kind,
              assetIds: [String(nodeData(sourceNode).assetId)],
            }),
          ];
        }
        return [];
      });
  }

  private async restoreProviderTask(
    provider: string,
    connectionId: string,
    providerTaskId: string,
    cliRecovery?: { adapter: ProviderAdapter; idempotencyKey: string },
  ): Promise<ProviderTask> {
    if (provider === "cli") {
      if (cliRecovery?.adapter instanceof CliProviderAdapter) {
        try {
          return await cliRecovery.adapter.restoreTask(connectionId, cliRecovery.idempotencyKey, providerTaskId);
        } catch (error) {
          throw new NeedsAttentionError("无法恢复 CLI 任务：本机任务记录缺失或不匹配，请人工核对网站任务", { cause: error });
        }
      }
      throw new NeedsAttentionError("CLI 任务缺少可恢复的本机任务记录；禁止自动重新生成");
    }
    if (provider === "runway") {
      return {
        providerTaskId,
        status: "running",
        result: { connectionId, remote: { id: providerTaskId } },
      };
    }
    if (provider === "rest") {
      const connection = await this.repository.getConnection(connectionId);
      const config = connection?.config.connector;
      if (!config || typeof config !== "object") {
        throw new NeedsAttentionError(
          "无法恢复 REST 任务：连接配置已缺失或发生变化",
        );
      }
      return {
        providerTaskId,
        status: "running",
        ...(typeof (config as Record<string, unknown>).pollIntervalMs ===
        "number"
          ? {
              pollAfterMs: (config as Record<string, unknown>)
                .pollIntervalMs as number,
            }
          : {}),
        result: { connectionId, config, remote: {} },
      };
    }
    throw new NeedsAttentionError(
      `供应商 ${provider} 不支持在进程重启后恢复异步任务`,
    );
  }

  private async quarantineUnknownProviderModel(
    error: unknown,
    nodeRun: NodeRunRecord,
  ): Promise<void> {
    if (nodeRun.inputJson.provider !== "weai") return;
    const connectionId = nodeRun.inputJson.connectionId;
    const requestedModel = nodeRun.inputJson.model;
    if (typeof connectionId !== "string" || typeof requestedModel !== "string")
      return;
    const rejectedModel = unknownModelFromProviderError(error);
    if (rejectedModel !== requestedModel) return;

    const connection = await this.repository.getConnection(connectionId);
    if (
      !connection ||
      connection.config.supplierArchived === true ||
      connection.provider !== "weai"
    )
      return;
    const detectedAt = new Date().toISOString();
    const configuredFailures = connection.config.modelAvailabilityFailures;
    const existingFailures = Array.isArray(configuredFailures)
      ? configuredFailures.filter((value): value is JsonObject =>
          isRecord(value),
        )
      : [];
    const previousFailure = existingFailures.find(
      (value) =>
        value.id === requestedModel && value.reason === "unknown_model",
    );
    const previousCount =
      typeof previousFailure?.consecutiveFailures === "number" &&
      Number.isSafeInteger(previousFailure.consecutiveFailures) &&
      previousFailure.consecutiveFailures > 0
        ? previousFailure.consecutiveFailures
        : 0;
    const consecutiveFailures = previousCount + 1;
    const modelAvailabilityFailures: JsonObject[] = [
      ...existingFailures.filter((value) => value.id !== requestedModel),
      {
        id: requestedModel,
        reason: "unknown_model",
        consecutiveFailures,
        firstDetectedAt:
          typeof previousFailure?.firstDetectedAt === "string"
            ? previousFailure.firstDetectedAt
            : detectedAt,
        lastDetectedAt: detectedAt,
      },
    ];
    const nextConfig: JsonObject = {
      ...connection.config,
      modelAvailabilityFailures,
    };

    // A single route miss is not authoritative for We-AI. The authenticated
    // model plaza and /models endpoint can still list the model while one
    // generation gateway temporarily returns "Unknown model". Only hide it
    // after three consecutive generation rejections; any successful call
    // below restores it immediately.
    if (consecutiveFailures < WEAI_UNKNOWN_MODEL_QUARANTINE_THRESHOLD) {
      await this.repository.saveConnection({
        id: connection.id,
        name: connection.name,
        provider: connection.provider,
        encryptedSecret: connection.encryptedSecret,
        config: nextConfig,
      });
      return;
    }

    const configuredUnavailable = connection.config.unavailableModels;
    const existingUnavailable = Array.isArray(configuredUnavailable)
      ? configuredUnavailable.filter((value): value is JsonObject =>
          isRecord(value),
        )
      : [];
    const unavailableModels: JsonObject[] = [
      ...existingUnavailable.filter((value) => value.id !== requestedModel),
      {
        id: requestedModel,
        reason: "unknown_model",
        consecutiveFailures,
        detectedAt,
      },
    ];
    const scannedModelIds = Array.isArray(connection.config.scannedModelIds)
      ? connection.config.scannedModelIds.flatMap((value) =>
          typeof value === "string" &&
          value.trim() &&
          value.trim() !== requestedModel
            ? [value.trim()]
            : [],
        )
      : null;
    await this.repository.saveConnection({
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      encryptedSecret: connection.encryptedSecret,
      config: {
        ...nextConfig,
        unavailableModels,
        ...(scannedModelIds
          ? {
              scannedModelIds,
              modelScanStatus: scannedModelIds.length > 0 ? "live" : "empty",
            }
          : {}),
      },
    });
  }

  private async restoreSuccessfulProviderModel(
    nodeRun: NodeRunRecord,
  ): Promise<void> {
    if (nodeRun.inputJson.provider !== "weai") return;
    const connectionId = nodeRun.inputJson.connectionId;
    const model = nodeRun.inputJson.model;
    if (typeof connectionId !== "string" || typeof model !== "string") return;

    const connection = await this.repository.getConnection(connectionId);
    if (
      !connection ||
      connection.config.supplierArchived === true ||
      connection.provider !== "weai"
    )
      return;
    const nextConfig: JsonObject = { ...connection.config };
    let changed = false;

    for (const field of [
      "modelAvailabilityFailures",
      "unavailableModels",
    ] as const) {
      const configured = connection.config[field];
      if (!Array.isArray(configured)) continue;
      const retained = configured.filter(
        (value) => !isRecord(value) || value.id !== model,
      );
      if (retained.length === configured.length) continue;
      changed = true;
      if (retained.length > 0) nextConfig[field] = retained;
      else delete nextConfig[field];
    }

    if (Array.isArray(connection.config.scannedModelIds)) {
      const scannedModelIds = [
        ...new Set([
          ...connection.config.scannedModelIds.flatMap((value) =>
            typeof value === "string" && value.trim() ? [value.trim()] : [],
          ),
          model,
        ]),
      ];
      if (
        scannedModelIds.length !== connection.config.scannedModelIds.length ||
        !connection.config.scannedModelIds.includes(model)
      ) {
        nextConfig.scannedModelIds = scannedModelIds;
        nextConfig.modelScanStatus = "live";
        changed = true;
      }
    }

    if (!changed) return;
    await this.repository.saveConnection({
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      encryptedSecret: connection.encryptedSecret,
      config: nextConfig,
    });
  }

  private async recordCyberAfeiCapabilityDenial(
    error: unknown,
    nodeRun: NodeRunRecord,
  ): Promise<void> {
    if (nodeRun.inputJson.supplier !== "cyberafei") return;
    const connectionId = nodeRun.inputJson.connectionId;
    const requestedModel = nodeRun.inputJson.model;
    const operation = nodeRun.inputJson.operation;
    if (
      typeof connectionId !== "string" ||
      typeof requestedModel !== "string" ||
      typeof operation !== "string"
    )
      return;
    const capability = operation.startsWith("image.")
      ? "image"
      : operation.startsWith("video.")
        ? "video"
        : null;
    if (!capability) return;
    const providerMessage = cyberAfeiCapabilityDenialFromProviderError(
      error,
      capability,
    );
    if (!providerMessage) return;

    const connection = await this.repository.getConnection(connectionId);
    if (
      !connection ||
      connection.config.supplierArchived === true ||
      connection.provider !== "rest" ||
      connection.config.preset !== "cyberafei-api"
    )
      return;
    const configured = connection.config.capabilityBlocks;
    const existing = Array.isArray(configured)
      ? configured.filter((value): value is JsonObject => isRecord(value))
      : [];
    const capabilityBlocks: JsonObject[] = [
      ...existing.filter((value) => value.capability !== capability),
      {
        capability,
        reason: "group_permission_denied",
        detectedAt: new Date().toISOString(),
        providerMessage,
        model: requestedModel,
      },
    ];
    await this.repository.saveConnection({
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      encryptedSecret: connection.encryptedSecret,
      config: { ...connection.config, capabilityBlocks },
    });
  }

  private async submitWithRetry(
    adapter: ProviderAdapter,
    request: NormalizedRequest,
    nodeRun: NodeRunRecord,
  ): Promise<ProviderTask> {
    const maximumAttempts =
      nodeRun.inputJson.provider === "cli" || adapter instanceof CliProviderAdapter ||
      nodeRun.inputJson.paidRetryPolicy === "approval-required" ? 1 : 3;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        return await adapter.submit(request);
      } catch (error) {
        if (error instanceof ProviderHttpError) {
          if (error.details.submissionMayHaveOccurred) {
            throw new NeedsAttentionError(error.message, { cause: error });
          }
          if (!error.details.retryable || attempt === maximumAttempts)
            throw error;
          await this.repository.updateNodeRun(nodeRun.id, {
            attempt: nodeRun.attempt + attempt,
          });
          await delay(this.retryBaseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }
    }
    throw new Error("供应商提交重试耗尽");
  }

  /** Restart only cloud lookups for interrupted jobs, never new paid submissions. */
  public async resumeInterruptedCloudRuns(): Promise<void> {
    for (const run of await this.repository.listRunsByStatus(["needs_attention"])) {
      if (Date.now() - Date.parse(run.updatedAt) > 26 * 60 * 60_000) continue;
      const nodes = await this.repository.listNodeRuns(run.id);
      const waiting = nodes.filter(node => node.status === "needs_attention");
      if (waiting.length && waiting.every(node => isCloudSubmission(node.providerTaskId))) {
        await this.retryRun(run.id).catch(() => {});
      }
    }
  }

  /** Recover the manifest/DB checkpoint gap without ever invoking submit again. */
  private async recoverCliSubmission(runId: string, node: NodeRunRecord, adapter: ProviderAdapter | undefined): Promise<NodeRunRecord | null> {
    if (node.inputJson.provider !== "cli" || typeof node.inputJson.connectionId !== "string" || !(adapter instanceof CliProviderAdapter)) return null;
    let task: ProviderTask;
    try {
      task = await adapter.restoreTask(node.inputJson.connectionId, `${runId}:${node.id}`);
    } catch { return null; }
    return this.repository.updateNodeRun(node.id, {
      providerTaskId: task.providerTaskId,
      inputJson: { ...node.inputJson, providerTask: providerTaskJson(task) },
    }, { expectedUpdatedAt: node.updatedAt });
  }

  /** A remote CLI job still occupies its account after local polling has paused. */
  private async assertCliConnectionAvailable(connectionId: string, nodeRunId: string): Promise<void> {
    const runs = await this.repository.listRunsByStatus(["queued", "running", "needs_attention"]);
    for (const run of runs) {
      for (const node of await this.repository.listNodeRuns(run.id)) {
        if (node.id === nodeRunId || node.inputJson.provider !== "cli" || node.inputJson.connectionId !== connectionId ||
          node.errorJson?.code === "cli_connection_busy" || !["submitting", "running", "needs_attention"].includes(node.status)) continue;
        const task = storedProviderTask(node.inputJson.providerTask);
        if (task && ["succeeded", "failed", "cancelled"].includes(task.status)) continue;
        // Also retain the reservation when submit may have happened without returning an id.
        throw new NeedsAttentionError("该个人 AI 网站账号仍有未确认结束的任务，请先处理原任务或在网站核对后停止跟踪", { code: "cli_connection_busy" });
      }
    }
  }

  private async pollWithRetry(
    adapter: ProviderAdapter,
    state: ProviderTask,
    options: { persistent?: boolean; signal?: AbortSignal; beforePoll?: () => Promise<void> } = {},
  ): Promise<ProviderTask> {
    if (!adapter.poll)
      throw new NeedsAttentionError(
        "供应商任务仍在运行，但 Adapter 未提供轮询能力",
      );

    for (let attempt = 1; options.persistent || attempt <= 3; attempt += 1) {
      try {
        options.signal?.throwIfAborted();
        await options.beforePoll?.();
        options.signal?.throwIfAborted();
        return options.persistent
          ? await abortablePoll(adapter.poll(state), options.signal)
          : await adapter.poll(state);
      } catch (error) {
        if (options.signal?.aborted || error instanceof CancelledError) throw error;
        const details =
          error instanceof ProviderHttpError ? error.details : undefined;
        const explicitlyRetryable =
          details?.phase === "poll" &&
          details.retryable &&
          (details.kind === "network" ||
            details.kind === "timeout" ||
            details.kind === "rate_limit" ||
            (details.status !== undefined && details.status >= 500));

        if (explicitlyRetryable && (options.persistent || attempt < 3)) {
          await delay(Math.min(30_000, this.retryBaseDelayMs * 2 ** Math.min(attempt - 1, 16)), options.signal);
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new NeedsAttentionError(
          explicitlyRetryable
            ? `供应商任务状态查询连续 3 次失败：${message}`
            : `无法确定供应商任务状态：${message}`,
          { cause: error },
        );
      }
    }

    throw new NeedsAttentionError("无法确定供应商任务状态");
  }

  private async executeNode(
    node: WorkflowNode,
    graph: WorkflowGraph,
    outputs: Map<string, OutputValue>,
    selected: Set<string>,
    adapters: Map<string, ProviderAdapter>,
    runId: string,
    nodeRun: NodeRunRecord,
    signal: AbortSignal,
  ): Promise<OutputValue> {
    const nodeRunId = nodeRun.id;
    const data = nodeData(node);
    if (semanticType(node) === "asset-input") {
      if (!data.assetId || typeof data.assetId !== "string")
        throw new Error("素材节点尚未选择素材");
      const asset = await this.repository.getAsset(data.assetId);
      if (!asset) throw new Error("素材不存在或已删除");
      return {
        kind: inputAssetKind(asset.kind),
        assetIds: [asset.id],
      };
    }
    if (semanticType(node) === "prompt") {
      const parts = promptPartsFromNodeData(data);
      if (!hasPromptText(parts)) throw new Error("Prompt 不能为空");
      return { kind: "text", prompt: parts };
    }
    const values = this.incoming(graph, node.id, selected, outputs);
    if (semanticType(node) === "preview") {
      const ids = values.flatMap((value) => value.assetIds ?? []);
      if (ids.length === 0) throw new Error("预览节点没有可展示的输出");
      return { kind: "image", assetIds: ids };
    }
    const connectedPrompts = values
      .filter((value) => value.kind === "text" && value.prompt)
      .flatMap((value, index) => [
        ...(index > 0 ? [{ type: "text" as const, text: " " }] : []),
        ...(value.prompt ?? []),
      ]);
    const inlineParts = promptPartsFromNodeData(data);
    const hasInlineText = hasPromptText(inlineParts);
    const parts: PromptPart[] =
      hasInlineText || connectedPrompts.length === 0
        ? inlineParts
        : connectedPrompts;
    const promptAssetIds = extractPromptAssetIds(parts);
    const assetIds = [
      ...new Set([
        ...values.flatMap((value) => value.assetIds ?? []),
        ...promptAssetIds,
      ]),
    ];
    const assets: ProviderAssetInput[] = [];
    const resumingCli = (nodeRun.inputJson.provider ?? data.provider) === "cli" && Boolean(nodeRun.providerTaskId);
    const connectedRoles = new Map<
      string,
      "reference" | "firstFrame" | "lastFrame"
    >();
    for (const value of values) {
      for (const [assetId, role] of Object.entries(value.assetRoles ?? {}))
        connectedRoles.set(assetId, role);
    }
    for (const assetId of resumingCli ? [] : assetIds) {
      const asset = await this.repository.getAsset(assetId);
      if (!asset) throw new Error(`素材 ${assetId} 不存在`);
      const stored = await this.storage.get(asset.storageKey);
      if (!stored) throw new Error(`素材 ${assetId} 的存储文件不存在`);
      const referencedPart = parts.find(
        (part): part is Extract<PromptPart, { type: "asset" }> =>
          part.type === "asset" && part.assetId === asset.id,
      );
      const role =
        referencedPart?.role ?? connectedRoles.get(asset.id) ?? "reference";
      assets.push({
        id: asset.id,
        kind: inputAssetKind(asset.kind),
        mimeType: asset.mimeType,
        data: stored.bytes,
        role,
        filename: asset.name,
      });
    }
    const providerName =
      typeof nodeRun.inputJson.provider === "string"
        ? nodeRun.inputJson.provider
        : typeof data.provider === "string"
          ? data.provider
          : "fake";
    const adapter = adapters.get(providerName);
    if (!adapter) throw new Error(`未安装供应商适配器: ${providerName}`);
    const connectionId =
      typeof nodeRun.inputJson.connectionId === "string"
        ? nodeRun.inputJson.connectionId
        : typeof data.connectionId === "string"
          ? data.connectionId
          : "fake-default";
    const frozenConnection = frozenConnectionFromUnknown(
      data.__runtimeConnection,
    );
    const connectionRecord =
      connectionId === "fake-default"
        ? null
        : (frozenConnection ??
          (await this.repository.getConnection(connectionId)));
    const connectionConfig = connectionRecord?.config;
    const modelGroup = connectionConfigString(connectionConfig, "modelGroup");
    const connectionName = connectionRecord?.name.trim() || undefined;
    const configuredSupplier = connectionRecord?.config.supplierKey;
    const supplier =
      typeof configuredSupplier === "string" && configuredSupplier.trim()
        ? configuredSupplier.trim()
        : providerName;
    const configuredSupplierWebsite =
      connectionRecord?.config.supplierWebsiteUrl;
    const supplierWebsiteUrl =
      typeof configuredSupplierWebsite === "string" &&
      configuredSupplierWebsite.startsWith("https://")
        ? configuredSupplierWebsite
        : undefined;
    const requestedModel =
      typeof nodeRun.inputJson.model === "string"
        ? nodeRun.inputJson.model
        : typeof data.model === "string"
          ? data.model
          : undefined;
    const rawParameters =
      (data.parameters as Record<string, unknown> | undefined) ?? {};
    const model = await this.configuredModel(
      providerName,
      connectionId,
      semanticType(node),
      requestedModel,
      rawParameters,
      frozenConnection,
    );
    const isCyberAfeiFlexible4K =
      supplier === "cyberafei" &&
      (model === "gpt-image-2-4K" || model === "gpt-image-4K");
    const isCangyuanGptImage4K =
      /^gpt-image-2-4k$/iu.test(model ?? "") &&
      (supplier === "cangyuan" ||
        connectionConfigString(connectionConfig, "preset") ===
          "cangyuan-gpt-image-2" ||
        /cangyuansuanli\.cn/iu.test(
          connectionConfigString(connectionConfig, "baseUrl") ?? "",
        ));
    const storedOperation = nodeRun.inputJson.operation;
    const operation = resumingCli && typeof storedOperation === "string" &&
      ["image.generate", "image.edit", "video.generate", "video.image-to-video"].includes(storedOperation)
      ? storedOperation as NormalizedRequest["operation"]
      : operationFor(node, values.some((value) => value.kind === "image") || assets.some((asset) => asset.kind === "image"));
    if (!operation) throw new Error(`不支持的节点类型: ${semanticType(node)}`);
    if (assets.length > 0 &&
        ((providerName === "rest" && restRequestRequiresPublicAssets(connectionConfig?.connector, model, operation)) ||
          secureSkillRequiresPublicAssets(providerName, connectionConfig, model, operation) ||
          bananaRequiresPublicAssets(providerName, connectionConfig, model))) {
      if (frozenConnection?.cloudGeneration) {
        const savedUrls = nodeRun.inputJson.cloudReferenceUrls;
        const urls = Array.isArray(savedUrls) && savedUrls.length === assets.length && savedUrls.every(value => typeof value === "string")
          ? savedUrls as string[]
          : isCloudSubmission(nodeRun.providerTaskId)
            ? assets.map(() => `${frozenConnection.cloudGeneration!.endpoint}/expired-reference`)
            : await uploadCloudReferences(frozenConnection.cloudGeneration, `${runId}:${nodeRunId}`, assets);
        nodeRun.inputJson.cloudReferenceUrls = urls;
        assets.forEach((asset, index) => { asset.url = urls[index]!; });
      } else if (localReferenceChannelConfigured()) {
        const urls = await localReferenceUrls(assets.map(asset => asset.id));
        assets.forEach((asset, index) => { asset.url = urls[index]!; });
      } else if (!referenceImageHostingEnabled(connectionConfig)) {
        throw new Error("该模型需要参考图链接，请在设置的“素材通道”中连接本机通道，或选择支持直接上传素材的模型");
      }
    }
    const providerErrorContext: ProviderErrorContext = {
      provider: providerName,
      operation,
      supplier,
      ...(supplierWebsiteUrl ? { supplierWebsiteUrl } : {}),
    };
    let parameters =
      providerName === "weai"
        ? normalizeWeAiParameters(rawParameters, requestedModel, modelGroup)
        : providerName !== "cli" && supplier === "chentu"
          ? normalizeChentuParameters(rawParameters)
          : { ...rawParameters };
    const bananaRoute = model && connectionConfig
      ? bananaImageRoute({ provider: providerName, config: connectionConfig }, model) : undefined;
    if (bananaRoute) parameters = normalizeBananaParameters(bananaRoute, parameters);
    if (providerName === "rest" && semanticType(node) === "image-generation") {
      parameters = normalizeRestImageBatchParameter(
        parameters,
        model,
        connectionConfig,
      );
    }
    const prompt = resumingCli && typeof nodeRun.inputJson.prompt === "string" ? nodeRun.inputJson.prompt : renderPromptParts(parts, {
      resolveAsset: (id) => {
        const index = assets.findIndex((asset) => asset.id === id);
        return index < 0 ? "" : `[参考素材 ${index + 1}]`;
      },
      unresolvedAsset: "empty",
    });
    if (providerName !== "cli" && semanticType(node) === "image-generation") {
      const imageDescriptor = configuredImageDescriptor(
        connectionConfig,
        model,
      );
      const verifiedImageSizes =
        isRecord(imageDescriptor?.metadata) &&
        (imageDescriptor.metadata.image25VerifiedAt !== undefined ||
          imageDescriptor.metadata.imageCapabilitiesVerifiedAt !== undefined);
      const selectedWeAiTier =
        providerName === "weai"
          ? weAiResolutionTier(parameters.size_tier)
          : undefined;
      const isChentuFlexibleSizeModel =
        supplier === "chentu" &&
        typeof model === "string" &&
        /自由传参/iu.test(model);
      const selectedChentuTier = isChentuFlexibleSizeModel
        ? chentuResolutionTier(parameters.size_tier)
        : undefined;
      const selectedFriModelTier =
        supplier === "frimodel"
          ? weAiResolutionTier(parameters.size_tier)
          : undefined;
      const selectedMikotoTier =
        supplier === "mikoto"
          ? weAiResolutionTier(parameters.size_tier)
          : undefined;
      const selectedOpenAiTier = providerName === "openai" && /^gpt-image/iu.test(model ?? "")
        ? weAiResolutionTier(parameters.size_tier) : undefined;
      const selectedConnectorTier =
        providerName === "rest" && (supplier !== "cyberafei" || verifiedImageSizes)
          ? weAiResolutionTier(parameters.size_tier)
          : undefined;
      const selectedResolutionTier =
        selectedWeAiTier ??
        selectedChentuTier ??
        selectedFriModelTier ??
        selectedMikotoTier ??
        selectedConnectorTier ??
        selectedOpenAiTier ??
        (verifiedImageSizes
          ? weAiResolutionTier(parameters.size_tier)
          : undefined) ??
        (parameters.size === "auto"
          ? singleConfiguredSizeTier(imageDescriptor)
          : undefined) ??
        (verifiedImageSizes && parameters.size === "auto" ? "1K" : undefined);
      const autoAspectKey =
        parameters.aspect_ratio === "auto"
          ? "aspect_ratio"
          : parameters.size === "auto"
            ? "size"
            : undefined;
      if (isRecord(imageDescriptor?.metadata) &&
          imageDescriptor.metadata.imageCapabilitiesVerifiedAt !== undefined &&
          selectedResolutionTier &&
          (parameters.size === undefined || parameters.size === "auto") &&
          !connectorSizeForResolutionTier(connectionConfig, model, selectedResolutionTier)) {
        throw new ProviderTaskFailedError(
          `该模型尚未验证 ${selectedResolutionTier}，请选择已提供的分辨率档位`,
          providerErrorContext,
        );
      }
      const inferredRatio =
        autoAspectKey || selectedResolutionTier
          ? (aspectRatioFromPrompt(prompt) ??
            referenceAspectRatio(graph, assets))
          : undefined;
      if (isCangyuanGptImage4K && !singleConfiguredSizeTier(imageDescriptor)) {
        // The Cangyuan 4K SKU accepts ratios, but an explicit 4K canvas is
        // required when automatic sizing is selected. Keep a user-entered
        // WxH size untouched; otherwise resolve the selected/prompt ratio to
        // the corresponding documented 4K dimensions.
        const explicitSize =
          typeof parameters.size === "string" &&
          /^\d+x\d+$/iu.test(parameters.size.trim())
            ? parameters.size.trim()
            : undefined;
        const selectedRatio =
          parameters.aspect_ratio === "auto" || parameters.size === "auto"
            ? inferredRatio
            : typeof parameters.aspect_ratio === "string"
              ? parameters.aspect_ratio
              : inferredRatio;
        parameters.size =
          explicitSize ?? gptImage4KSizeForAspectRatio(selectedRatio);
        delete parameters.aspect_ratio;
      } else if (
        isCyberAfeiFlexible4K &&
        (parameters.size === undefined || parameters.size === "auto")
      ) {
        // Cyber Afei's paid GPT Image 4K aliases require explicit pixels even
        // when the saved canvas only retained an aspect-ratio control.
        const explicit = dimensionsFromPrompt(prompt);
        const explicitParts = explicit?.split("x").map(Number);
        const explicitAllowed =
          explicitParts?.length === 2 &&
          explicitParts.every(
            (edge) => Number.isInteger(edge) && edge >= 16 && edge <= 4961,
          ) &&
          Math.max(...explicitParts) / Math.min(...explicitParts) <= 3;
        const selectedRatio =
          parameters.aspect_ratio === "auto"
            ? inferredRatio
            : typeof parameters.aspect_ratio === "string"
              ? parameters.aspect_ratio
              : inferredRatio;
        const selectedTierSize = connectorSizeForResolutionTier(
          connectionConfig, model, parameters.size_tier, selectedRatio,
        );
        const automaticSize = explicitAllowed
          ? explicit
          : selectedTierSize ?? (selectedRatio
            ? cyberAfei4KSizeForAspectRatio(selectedRatio)
            : undefined);
        if (automaticSize) parameters.size = automaticSize;
        else delete parameters.size;
        delete parameters.aspect_ratio;
      } else if (
        selectedResolutionTier &&
        (parameters.size === undefined || parameters.size === "auto")
      ) {
        const connectorSize = connectorSizeForResolutionTier(
          connectionConfig,
          model,
          selectedResolutionTier,
          inferredRatio,
        );
        parameters.size =
          connectorSize ??
          (selectedWeAiTier
            ? weAiSizeForResolutionTier(selectedWeAiTier, inferredRatio)
            : selectedChentuTier
              ? chentuSizeForResolutionTier(selectedChentuTier, inferredRatio)
              : selectedFriModelTier
                ? friModelSizeForResolutionTier(
                    selectedFriModelTier,
                    inferredRatio,
                  )
                : selectedMikotoTier
                  ? mikotoSizeForResolutionTier(
                      selectedMikotoTier,
                      inferredRatio,
                    )
                  : selectedOpenAiTier
                    ? imageSizeForTier(selectedOpenAiTier, inferredRatio)
                    : undefined);
        delete parameters.aspect_ratio;
      } else if (autoAspectKey) {
        const resolvedRatio = inferredRatio;
        if (isChentuFlexibleSizeModel && !selectedChentuTier) {
          // The free-parameter 辰途 route can choose its own dimensions from
          // the prompt. Do not turn automatic mode into a fixed 1K size.
          delete parameters.size;
          delete parameters.aspect_ratio;
        } else if (resolvedRatio) {
          if (
            autoAspectKey === "size" &&
            (providerName === "openai" || providerName === "weai")
          ) {
            // Older saved OpenAI nodes used size=auto. Preserve the same
            // prompt/reference precedence through the adapter's ratio mapping
            // instead of sending an invalid value such as size="16:9".
            delete parameters.size;
            parameters.aspect_ratio = resolvedRatio;
          } else {
            parameters[autoAspectKey] = resolvedRatio;
            if (
              autoAspectKey === "aspect_ratio" &&
              parameters.size === "auto" &&
              (providerName === "openai" || providerName === "weai")
            ) {
              delete parameters.size;
            }
          }
        } else delete parameters[autoAspectKey];
      }
      delete parameters.size_tier;
      if (
        isCyberAfeiFlexible4K &&
        typeof parameters.size === "string" &&
        parameters.size !== "auto"
      ) {
        const normalizedSize = cyberAfei4KValidSize(parameters.size);
        if (!normalizedSize)
          throw new ProviderTaskFailedError(
            "目标尺寸不符合 GPT Image 2 要求：宽高比不能超过 3:1，且尺寸必须能按 16 像素对齐。",
            providerErrorContext,
          );
        parameters.size = normalizedSize;
      }
    }
    const request: NormalizedRequest = {
      connectionId,
      operation,
      model,
      prompt,
      assets,
      parameters: resumingCli && isRecord(nodeRun.inputJson.parameters) ? nodeRun.inputJson.parameters : parameters,
      idempotencyKey: `${runId}:${nodeRunId}`,
      metadata: { fakeScenario: data.fakeScenario },
    };
    // Querying/archiving an existing CLI task must not depend on still having its original input files.
    const validation = resumingCli ? { valid: true, issues: [] } : await adapter.validate(request);
    if (!validation.valid)
      throw new ProviderRequestValidationError(
        validation.issues,
        providerErrorContext,
      );
    if (providerName === "cli" && !nodeRun.providerTaskId)
      await this.assertCliConnectionAvailable(connectionId, nodeRunId);
    const inputJson: JsonObject = {
      ...nodeRun.inputJson,
      provider: providerName,
      supplier,
      ...(supplierWebsiteUrl ? { supplierWebsiteUrl } : {}),
      connectionId,
      ...(connectionName ? { connectionName } : {}),
      ...(modelGroup ? { modelGroup } : {}),
      operation,
      model: request.model ?? null,
      prompt: request.prompt,
      assetIds: resumingCli ? nodeRun.inputJson.assetIds ?? assetIds : assetIds,
      inputAssets: resumingCli ? nodeRun.inputJson.inputAssets ?? [] : assets.map((asset) => ({
        id: asset.id,
        name: asset.filename ?? asset.id,
        kind: asset.kind,
        role: asset.role ?? "reference",
      })),
      parameters: request.parameters ?? {},
      ...(providerName === "cli" ? {
        cliDeadlineAt: typeof nodeRun.inputJson.cliDeadlineAt === "number"
          ? nodeRun.inputJson.cliDeadlineAt
          : Date.now() + cliTiming(connectionConfig, "taskTimeoutMs", 7_200_000),
      } : {}),
    };
    const savedTask = storedProviderTask(nodeRun.inputJson.providerTask);
    const submissionProgress = async (phase: ProviderSubmissionPhase) => {
      if (inputJson.submissionPhase === phase) return;
      recordSubmissionPhase(inputJson, phase);
      const status = inputJson.cloudAccepted === true || phase === "generating" ? "running" : "submitting";
      await this.updateNodeRunOrCancel(runId, nodeRunId, { status, inputJson });
      this.publish({ type: "node", runId, nodeRunId, payload: { nodeId: node.id, status } });
    };
    await this.updateNodeRunOrCancel(runId, nodeRunId, {
      status:
        nodeRun.status === "archiving" || savedTask?.status === "succeeded"
          ? "archiving"
          : nodeRun.providerTaskId
            ? "running"
            : "submitting",
      inputJson,
    });
    let task: ProviderTask;
    if (nodeRun.providerTaskId && !isCloudSubmission(nodeRun.providerTaskId)) {
      task =
        savedTask ??
        (await this.restoreProviderTask(
          providerName,
          connectionId,
          nodeRun.providerTaskId,
          { adapter, idempotencyKey: request.idempotencyKey },
        ));
    } else {
      try {
        const cloud = isRecord(inputJson.cloudGeneration) ? inputJson.cloudGeneration : frozenConnection?.cloudGeneration;
        if ((isCloudSubmission(nodeRun.providerTaskId) || cloud) && operation.startsWith("image.")) {
          if (!isRecord(cloud) || typeof cloud.endpoint !== "string" || typeof cloud.encryptedToken !== "string")
            throw new NeedsAttentionError("原任务的云端连接配置缺失，已停止，不能回退本机重复生成");
          task = await runCloudGeneration(request.idempotencyKey, cloud as unknown as CloudGenerationConfig,
            () => adapter.submit(request), {
              resumeOnly: isCloudSubmission(nodeRun.providerTaskId),
              checkpoint: async config => {
                inputJson.cloudGeneration = config as unknown as JsonObject;
                await this.updateNodeRunOrCancel(runId, nodeRunId, {
                  status: "submitting", providerTaskId: cloudSubmissionId(request.idempotencyKey), inputJson,
                });
              },
              accepted: async () => {
                inputJson.cloudAccepted = true;
                await this.updateNodeRunOrCancel(runId, nodeRunId, { status: "running", inputJson });
              },
              progress: submissionProgress,
            });
        } else task = await withProviderSubmissionProgress(submissionProgress, () => this.submitWithRetry(adapter, request, nodeRun), signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          (error instanceof ProviderHttpError && error.details.submissionMayHaveOccurred) ||
          (isRecord(error) && error.code === "CLI_ACTION_REQUIRED") ||
          message.includes("uncertain") ||
          data.fakeScenario === "submit_uncertain"
        ) {
          if (isRecord(error) && typeof error.providerTaskId === "string")
            await this.repository.updateNodeRun(nodeRunId, { providerTaskId: error.providerTaskId });
          throw new NeedsAttentionError(message, { ...(providerName === "cli" ? { code: "cli_submit_uncertain" } : {}), cause: error });
        }
        throw error;
      }
    }
    recordSubmissionPhase(inputJson, task.status === "running" || task.status === "queued" ? "generating" : "downloading");
    const taskSnapshot = {
      ...inputJson,
      providerTask: providerTaskJson(task),
    };
    const persistedTask = await this.repository.updateNodeRun(nodeRunId, {
      status: task.status === "succeeded" ? "archiving" : "running",
      providerTaskId: inputJson.cloudGeneration ? cloudSubmissionId(request.idempotencyKey) : task.providerTaskId,
      inputJson: taskSnapshot,
    });
    if (!persistedTask) {
      // Cancellation may win immediately after a paid submission. Preserve
      // the remote task id without changing the cancellation status so the
      // reconciler can keep sending provider cancellation requests.
      await this.repository.updateNodeRun(nodeRunId, {
        providerTaskId: task.providerTaskId,
        inputJson: taskSnapshot,
      });
      const [cancelledRun, cancelledNode] = await Promise.all([
        this.repository.getRun(runId),
        this.repository.getNodeRun(nodeRunId),
      ]);
      if (
        cancelledRun?.status === "cancelled" ||
        cancelledNode?.status === "cancel_requested" ||
        cancelledNode?.status === "cancelled"
      ) {
        try {
          await adapter.cancel?.(task);
        } catch {
          // The durable cancel_requested row will be retried by reconciliation.
        }
        throw new CancelledError("运行已取消");
      }
      throw new NeedsAttentionError(
        "供应商任务已创建，但节点状态发生并发变化；已停止自动执行",
      );
    }
    let state = task;
    const persistentImagePolling = operation.startsWith("image.") && providerName !== "cli";
    const assertPollingActive = async () => {
      const current = await this.repository.getRun(runId);
      if (current?.status === "cancelled") throw new CancelledError("运行已取消");
      signal.throwIfAborted();
    };
    const cliDeadline = providerName === "cli" ? Number(inputJson.cliDeadlineAt) : undefined;
    for (
      let attempt = 0;
      (providerName === "cli" || persistentImagePolling || attempt < 240) &&
      (state.status === "running" || state.status === "queued");
      attempt += 1
    ) {
      const persistedRun = await this.repository.getRun(runId);
      if (persistedRun?.status === "cancelled") {
        await adapter.cancel?.(state);
        throw new CancelledError(providerName === "cli" && cliStopsTracking(state)
          ? "已停止跟踪；该网站不支持远端取消，生成可能仍在继续" : "运行已取消");
      }
      // A manual/restart recovery may query an expired task once, but never extends its deadline.
      if (cliDeadline !== undefined && Date.now() >= cliDeadline && (attempt > 0 || !nodeRun.providerTaskId)) break;
      const interval = this.pollIntervalMs ??
          (providerName === "cli" ? cliTiming(connectionConfig, "pollIntervalMs", 10_000) : undefined) ??
          state.pollAfterMs ??
          (providerName === "fake" ? 250 : 1_500);
      if (persistentImagePolling) {
        try {
          await delay(interval, signal);
          await assertPollingActive();
          state = await this.pollWithRetry(adapter, state, {
            persistent: true, signal, beforePoll: assertPollingActive,
          });
        } catch (error) {
          if (error instanceof CancelledError || signal.aborted) {
            const current = await this.repository.getRun(runId);
            if (current?.status === "cancelled") {
              await adapter.cancel?.(state);
              throw new CancelledError("运行已取消");
            }
          }
          throw error;
        }
      } else {
        await delay(cliDeadline === undefined ? interval : Math.max(0, Math.min(interval, cliDeadline - Date.now())));
        state = await this.pollWithRetry(adapter, state);
      }
      // The provider task id is durably stored immediately after submission.
      // Avoid rewriting the entire local JSON database for every 1.5-second
      // running poll; only terminal provider state needs another checkpoint.
      if (state.status !== "running" && state.status !== "queued") {
        try {
          await this.updateNodeRunOrCancel(runId, nodeRunId, {
            status: state.status === "succeeded" ? "archiving" : "running",
            inputJson: { ...inputJson, providerTask: providerTaskJson(state) },
          });
        } catch (error) {
          if (error instanceof CancelledError) {
            try {
              await adapter.cancel?.(state);
            } catch {
              // Cancellation reconciliation owns subsequent retries.
            }
          }
          throw error;
        }
      }
    }
    if (state.status === "cancelled")
      throw new CancelledError("供应商已取消任务");
    if (state.status === "failed")
      throw new ProviderTaskFailedError(state.error ?? "供应商生成失败", {
        ...providerErrorContext,
      });
    if (state.status === "running" || state.status === "queued")
      throw new NeedsAttentionError(
        "供应商任务轮询超时；已保留远端任务 ID，禁止自动重新提交",
      );
    if (state.status !== "succeeded")
      throw new NeedsAttentionError(
        `无法识别供应商任务状态：${String(state.status)}`,
      );
    await this.updateNodeRunOrCancel(runId, nodeRunId, {
      status: "archiving",
      inputJson: { ...inputJson, providerTask: providerTaskJson(state) },
    });
    let artifacts: RemoteArtifact[];
    try {
      artifacts = await adapter.extractOutputs(state.result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NeedsAttentionError(
        `供应商任务已完成，但结果解析失败：${message}`,
        { code: "artifact_extract_failed", cause: error },
      );
    }
    if (artifacts.length === 0)
      throw new NeedsAttentionError(
        "供应商任务已完成，但没有返回可归档的结果",
        {
          code: "artifact_output_missing",
        },
      );
    const archiveArtifacts = async (
      candidates: readonly RemoteArtifact[],
    ): Promise<string[]> => {
      const archivedIds: string[] = [];
      for (const [index, artifact] of candidates.entries()) {
        archivedIds.push(
          await this.archiveArtifact(artifact, runId, node.id, index),
        );
      }
      await adapter.cleanup?.(state.result);
      return archivedIds;
    };
    let ids: string[];
    try {
      ids = await archiveArtifacts(artifacts);
    } catch (error) {
      // Result URLs can expire or their CDN connection can stall between the
      // provider's succeeded state and local archival. Re-polling the existing
      // provider task may return a fresh route and never creates or charges for
      // a second generation task.
      if (shouldRefreshRemoteArtifact(error) && adapter.poll) {
        try {
          const refreshed = await retryOperation(() => adapter.poll!(state));
          if (refreshed.status === "succeeded") {
            state = refreshed;
            await this.updateNodeRunOrCancel(runId, nodeRunId, {
              status: "archiving",
              inputJson: {
                ...inputJson,
                providerTask: providerTaskJson(refreshed),
              },
            });
            const refreshedArtifacts = await adapter.extractOutputs(
              refreshed.result,
            );
            if (refreshedArtifacts.length > 0) {
              ids = await archiveArtifacts(refreshedArtifacts);
              return {
                kind: operation.startsWith("video") ? "video" : "image",
                assetIds: ids,
              };
            }
          }
        } catch {
          // Preserve the original archive error below. It identifies the phase
          // that needs attention more accurately than a refresh failure.
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new NeedsAttentionError(
        `供应商任务已完成，但输出归档失败：${message}`,
        { code: "artifact_archive_failed", cause: error },
      );
    }
    return {
      kind: operation.startsWith("video") ? "video" : "image",
      assetIds: ids,
    };
  }

  private async hasValidArchivedObject(asset: AssetRecord): Promise<boolean> {
    if (asset.deleted) return false;
    const stored = this.storage.head
      ? await this.storage.head(asset.storageKey)
      : await this.storage.get(asset.storageKey).then((value) => value && ({
          size: value.bytes.byteLength, contentType: value.contentType,
          etag: createHash("sha256").update(value.bytes).digest("hex"),
        }));
    return Boolean(stored && stored.size === asset.size && stored.size > 0 &&
      (!asset.metadata.etag || stored.etag === asset.metadata.etag) &&
      (!stored.contentType || stored.contentType === asset.mimeType));
  }

  private async archiveProjectAsset(asset: AssetRecord, runId: string, bytes?: Uint8Array): Promise<void> {
    if (!this.projectFileStore || asset.kind === "text") return;
    try {
      const run = await this.repository.getRun(runId);
      const canvas = run ? await this.repository.getCanvas(run.canvasId) : null;
      if (!canvas) return;
      const storage = this.storage;
      // Defer opening/reading the object: an existing project file consumes nothing.
      const projectBytes = bytes ?? storage.stream?.(asset.storageKey) ?? (async function* () {
        const stored = await storage.get(asset.storageKey);
        if (!stored) throw new Error("Archived asset is missing from storage");
        yield stored.bytes;
      })();
      await this.projectFileStore.archiveDraft({
        projectName: canvas.title, assetId: asset.id, name: asset.name,
        mimeType: asset.mimeType, kind: asset.kind, bytes: projectBytes, source: "generated",
      });
    } catch (error) {
      // Keep the durable original available; later output recovery repairs this mirror.
      console.error("[super-canvas] unable to archive generated asset",
        error instanceof Error ? error.message : String(error));
    }
  }

  private async archiveArtifact(
    artifact: RemoteArtifact,
    runId: string,
    nodeId: string,
    outputIndex: number,
  ): Promise<string> {
    // Providers currently type outputs as image/video, but the asset pipeline
    // also accepts audio artifacts from compatible adapters.
    const artifactKind = (artifact as { kind: "image" | "video" | "audio" })
      .kind;
    const id = createHash("sha256")
      .update(`${runId}\0${nodeId}\0${outputIndex}`)
      .digest("hex");
    const existing = await this.repository.getAsset(id);
    if (existing && !existing.deleted && existing.metadata.archiveComplete === true &&
        existing.metadata.runId === runId && existing.metadata.nodeId === nodeId &&
        existing.metadata.outputIndex === outputIndex) {
      if (await this.hasValidArchivedObject(existing)) {
        await this.archiveProjectAsset(existing, runId);
        return id;
      }
    }
    const localExtension = artifact.localFile && artifact.mimeType
      ? ({ "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[artifact.mimeType]
      : undefined;
    const extension = localExtension ?? (artifactKind === "video" ? "mp4" : artifactKind === "audio" ? "mp3" : "png");
    const storageKey = `assets/${id}/original.${extension}`;
    let persisted: StoredObjectMetadata | undefined;
    let bytes = artifact.data;
    const maxBytes = artifactDownloadMaxBytes();
    let mime =
      artifact.mimeType ??
      (artifactKind === "video"
        ? "video/mp4"
        : artifactKind === "audio"
          ? "audio/mpeg"
          : "image/png");
    if (artifact.localFile) {
      const node = (await this.repository.listNodeRuns(runId)).find(value => value.nodeId === nodeId);
      if (!node || node.inputJson.provider !== "cli" || typeof node.inputJson.connectionId !== "string")
        throw new Error("本地输出仅允许已绑定任务的 CLI 连接归档");
      const expectedRoot = join(this.cliJobRoot, cliJobKey(node.inputJson.connectionId, `${runId}:${node.id}`), "output");
      await consumeCliArtifact(artifact.localFile, expectedRoot, maxBytes, async chunks => {
        if (this.storage.putStream) {
          persisted = await this.storage.putStream(storageKey, chunks, mime);
        } else {
          const parts: Uint8Array[] = [];
          for await (const chunk of chunks) parts.push(chunk);
          bytes = Buffer.concat(parts);
        }
      });
    }
    if (!bytes && artifact.url?.startsWith("data:")) {
      const match = artifact.url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      if (match) {
        mime = match[1] ?? mime;
        bytes = match[2]
          ? Buffer.from(match[3]!, "base64")
          : Buffer.from(decodeURIComponent(match[3]!));
      }
    }
    if (!bytes && artifact.url) {
      if (this.storage.putStream) {
        persisted = await retryOperation(() => consumeRemoteArtifact(artifact.url!, async (chunks, contentType) => {
          mime = contentType ?? mime;
          return this.storage.putStream!(storageKey, chunks, mime);
        }, { maxBytes }));
      } else {
        const downloaded = await retryOperation(() => downloadRemoteArtifact(artifact.url!, { maxBytes }));
        bytes = downloaded.bytes;
        mime = downloaded.contentType ?? mime;
      }
    }
    if (!bytes && !persisted && artifact.metadata?.fake === true) {
      bytes =
        artifactKind === "image"
          ? new Uint8Array(fakePngBytes)
          : artifactKind === "video"
            ? new TextEncoder().encode("SUPER_CANVAS_FAKE_VIDEO")
            : new TextEncoder().encode("SUPER_CANVAS_FAKE_AUDIO");
    }
    const size = bytes?.byteLength ?? persisted?.size;
    if (size === undefined)
      throw new Error("Provider output did not include bytes or a downloadable URL");
    if (size > maxBytes) throw new Error(`Provider output exceeds ${maxBytes} bytes`);
    const kindLabel =
      artifactKind === "video"
        ? "视频"
        : artifactKind === "audio"
          ? "音频"
          : "图片";
    const assetName = `${kindLabel} ${new Date().toLocaleString("zh-CN")}`;
    if (!persisted) await retryOperation(() => this.storage.put(storageKey, bytes!, mime));
    const etag = persisted?.etag ?? (bytes ? createHash("sha256").update(bytes).digest("hex") : undefined);
    const originRun = await this.repository.getRun(runId);
    const originNode = Array.isArray(originRun?.revisionGraph.nodes)
      ? originRun.revisionGraph.nodes.find(value => isRecord(value) && value.id === nodeId) : undefined;
    const originData = isRecord(originNode) && isRecord(originNode.data) ? originNode.data : {};
    const archivedAsset = await this.repository.saveAsset({
      id,
      name: assetName,
      kind: artifactKind,
      mimeType: mime,
      size,
      storageKey,
      metadata: {
        ...(etag ? { etag } : {}),
        runId,
        nodeId,
        outputIndex,
        ...(originRun ? { canvasId: originRun.canvasId } : {}),
        ...(typeof originData.designSourceAssetId === "string" ? { designSourceAssetId: originData.designSourceAssetId } : {}),
        ...(typeof originData.label === "string" ? { designNodeLabel: originData.label } : {}),
        archiveComplete: true,
        fake: Boolean(artifact.url?.includes("example.invalid")),
      },
    });
    await this.archiveProjectAsset(archivedAsset, runId, bytes);
    this.publish({
      type: "asset",
      runId,
      payload: { assetId: id, kind: artifact.kind },
    });
    return id;
  }
}

function unknownModelFromProviderError(error: unknown): string | undefined {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6; depth += 1) {
    if (current instanceof ProviderHttpError) {
      if (current.details.status !== 400) return undefined;
      const body = current.details.responseBody;
      const text =
        typeof body === "string"
          ? body
          : body === undefined
            ? ""
            : JSON.stringify(body);
      return /Unknown model:\s*([A-Za-z0-9._:-]+)/iu.exec(text)?.[1];
    }
    if (typeof current !== "object" || current === null || seen.has(current))
      return undefined;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function cyberAfeiCapabilityDenialFromProviderError(
  error: unknown,
  capability: "image" | "video",
): string | undefined {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6; depth += 1) {
    if (current instanceof ProviderHttpError) {
      if (current.details.status !== 403) return undefined;
      const body = current.details.responseBody;
      const text =
        typeof body === "string"
          ? body
          : body === undefined
            ? ""
            : JSON.stringify(body);
      const pattern =
        capability === "image"
          ? /Image generation is not enabled for this group/iu
          : /Video generation is not enabled for this group/iu;
      return pattern.exec(text)?.[0];
    }
    if (typeof current !== "object" || current === null || seen.has(current))
      return undefined;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function providerFailureFor(
  error: unknown,
  node: WorkflowNode,
  nodeRun: NodeRunRecord,
): ProviderErrorPresentation | undefined {
  if (error instanceof ProviderRequestValidationError)
    return error.presentation;
  if (error instanceof ProviderTaskFailedError) return error.presentation;
  const source =
    error instanceof NeedsAttentionError && error.cause !== undefined
      ? error.cause
      : error;
  if (!(source instanceof ProviderHttpError)) return undefined;
  const data = nodeData(node);
  const provider =
    typeof nodeRun.inputJson.provider === "string"
      ? nodeRun.inputJson.provider
      : typeof data.provider === "string"
        ? data.provider
        : "fake";
  const rawOperation = nodeRun.inputJson.operation;
  const operation =
    rawOperation === "image.generate" ||
    rawOperation === "image.edit" ||
    rawOperation === "video.generate" ||
    rawOperation === "video.image-to-video"
      ? (rawOperation as ProviderOperation)
      : undefined;
  const supplier =
    typeof nodeRun.inputJson.supplier === "string"
      ? nodeRun.inputJson.supplier
      : undefined;
  const supplierWebsiteUrl =
    typeof nodeRun.inputJson.supplierWebsiteUrl === "string"
      ? nodeRun.inputJson.supplierWebsiteUrl
      : undefined;
  return presentProviderError(source, {
    provider,
    ...(operation ? { operation } : {}),
    ...(supplier ? { supplier } : {}),
    ...(supplierWebsiteUrl ? { supplierWebsiteUrl } : {}),
  });
}

class ProviderRequestValidationError extends Error {
  public readonly presentation: ProviderErrorPresentation;

  public constructor(
    issues: readonly { code?: string; message: string }[],
    context: ProviderErrorContext,
  ) {
    const detail =
      issues
        .map((issue) => issue.message)
        .filter(Boolean)
        .join("; ") || "请求参数不符合模型要求";
    const base = presentProviderError(detail, context);
    const presentation: ProviderErrorPresentation = {
      ...base,
      message: `请求未提交：${detail}`,
      type: "请求参数错误",
      code: issues[0]?.code || "invalid_request",
      providerMessage: detail,
    };
    super(presentation.message);
    this.name = "ProviderRequestValidationError";
    this.presentation = presentation;
  }
}

class ProviderTaskFailedError extends Error {
  public readonly presentation: ProviderErrorPresentation;

  public constructor(rawError: unknown, context: ProviderErrorContext) {
    const presentation = presentProviderError(rawError, context);
    super(presentation.message);
    this.name = "ProviderTaskFailedError";
    this.presentation = presentation;
  }
}

class NeedsAttentionError extends Error {
  public readonly code?: string;

  public constructor(
    message: string,
    options?: ErrorOptions & { code?: string },
  ) {
    super(message, options);
    this.name = "NeedsAttentionError";
    this.code = options?.code;
  }
}
class CancelledError extends Error {}

const globalKey = "__superCanvasRunService";
export function getRunService(options: RuntimeOptions = {}): RunService {
  const scope = globalThis as typeof globalThis & { [globalKey]?: RunService };
  scope[globalKey] ??= new RunService({
    ...options,
    projectFileStore: options.projectFileStore ?? getProjectFileStore(),
  });
  return scope[globalKey];
}
