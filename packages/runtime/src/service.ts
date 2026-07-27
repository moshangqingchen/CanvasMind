import { createHash, randomUUID } from "node:crypto";
import {
  extractPromptAssetIds,
  getEdgeTargetPortId,
  renderPromptParts,
  selectRunNodeIds,
  validateGraph,
  type PromptPart,
  type WorkflowGraph,
  type WorkflowNode,
} from "@super-canvas/core";
import type {
  Repository,
  JsonObject,
  NodeRunRecord,
  NodeRunUpdateOptions,
  WorkflowRunRecord,
} from "@super-canvas/db";
import { getRepository } from "@super-canvas/db";
import {
  decryptSecret,
  FakeProviderAdapter,
  GenericRestAdapter,
  OPENAI_DEFAULT_IMAGE_MODEL,
  OpenAIImageAdapter,
  presentProviderError,
  ProviderHttpError,
  RunwayAdapter,
  RUNWAY_DEFAULT_VIDEO_MODEL,
  type NormalizedRequest,
  type ProviderAdapter,
  type ProviderAssetInput,
  type ProviderErrorPresentation,
  type ProviderOperation,
  type ProviderConnectionResolver,
  type ProviderTask,
  type RemoteArtifact,
  type ResolvedProviderConnection,
  StaticConnectionResolver,
} from "@super-canvas/providers";
import { getObjectStorage, type ObjectStorage } from "@super-canvas/storage";
import {
  getEventBus,
  type RuntimeEvent,
  type RuntimeEventBus,
} from "./events.js";
import {
  artifactDownloadMaxBytes,
  downloadRemoteArtifact,
} from "./remote-download.js";
import { aspectRatioFromPrompt, aspectRatioString } from "./aspect-ratio.js";

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
}

interface OutputValue {
  kind: "text" | "image" | "video" | "audio";
  prompt?: PromptPart[];
  assetIds?: string[];
  assetRoles?: Record<string, "reference" | "firstFrame" | "lastFrame">;
}

type HistoricalInputSnapshot = { value: OutputValue } | { missing: true };

type HistoricalInputs = Record<string, HistoricalInputSnapshot>;

interface RuntimeOptions {
  repository?: Repository;
  storage?: ObjectStorage;
  eventBus?: RuntimeEventBus;
  pollIntervalMs?: number;
  retryBaseDelayMs?: number;
  executionMode?: "inline" | "queue";
  enqueueRun?: (runId: string) => Promise<void>;
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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

class RepoConnectionResolver implements ProviderConnectionResolver {
  constructor(private readonly repository: Repository) {}

  async resolve(connectionId: string): Promise<ResolvedProviderConnection> {
    if (connectionId === "fake-default")
      return { id: connectionId, provider: "fake", apiKey: "fake" };
    const record = await this.repository.getConnection(connectionId);
    if (!record) throw new Error(`找不到供应商连接：${connectionId}`);
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
  private readonly cancelled = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly starting = new Set<string>();
  private readonly pollIntervalMs?: number;
  private readonly retryBaseDelayMs: number;
  private readonly executionMode?: "inline" | "queue";
  private readonly enqueueRunOverride?: (runId: string) => Promise<void>;

  constructor(options: RuntimeOptions = {}) {
    this.repository = options.repository ?? getRepository();
    this.storage = options.storage ?? getObjectStorage();
    this.eventBus = options.eventBus ?? getEventBus();
    this.pollIntervalMs = options.pollIntervalMs;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.executionMode = options.executionMode;
    this.enqueueRunOverride = options.enqueueRun;
  }

  public adapters(): Map<string, ProviderAdapter> {
    const resolver = new RepoConnectionResolver(this.repository);
    const fake = new FakeProviderAdapter(resolver);
    return new Map<string, ProviderAdapter>([
      ["fake", fake],
      ["openai", new OpenAIImageAdapter(resolver)],
      ["runway", new RunwayAdapter(resolver)],
      ["rest", new GenericRestAdapter(resolver)],
    ]);
  }

  private async configuredModel(
    provider: string,
    connectionId: string,
    nodeType: string,
    explicit?: string,
  ): Promise<string | undefined> {
    if (explicit?.trim()) return explicit.trim();
    if (provider === "fake")
      return nodeType === "video-generation"
        ? "fake-video-v1"
        : "fake-image-v1";

    const connection = await this.repository.getConnection(connectionId);
    const config = connection?.config;
    const nested = isRecord(config?.config) ? config.config : undefined;
    const configured = [config?.defaultModel, nested?.defaultModel].find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
    if (configured) return configured.trim();
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
    await Promise.all(
      frozen.nodes.map(async (node) => {
        const data = nodeData(node);
        const type = semanticType(node);
        if (type !== "image-generation" && type !== "video-generation") return;
        const provider =
          typeof data.provider === "string" ? data.provider : "fake";
        const connectionId =
          typeof data.connectionId === "string"
            ? data.connectionId
            : "fake-default";
        const model = await this.configuredModel(
          provider,
          connectionId,
          type,
          typeof data.model === "string" ? data.model : undefined,
        );
        if (model) data.model = model;
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
    const nodeIds = selectRunNodeIds(graph, run.scope, run.nodeId ?? undefined);
    const selected = new Set(nodeIds);
    const existingNodeRuns = await this.repository.listNodeRuns(run.id);
    const existingByNodeId = new Map(
      existingNodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]),
    );
    const historicalInputs = await this.freezeHistoricalInputs(
      graph,
      run.canvasId,
      selected,
    );
    for (const id of nodeIds) {
      const existing = existingByNodeId.get(id);
      const snapshot = historicalInputs.get(id) ?? {};
      if (existing) {
        // Preserve provider/task fields on retries while filling snapshots for
        // runs created by older versions of the service.
        if (existing.inputJson.historicalInputs === undefined) {
          await this.repository.updateNodeRun(existing.id, {
            inputJson: { ...existing.inputJson, historicalInputs: snapshot },
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
          inputJson: { historicalInputs: snapshot },
          outputAssetIds: [],
          errorJson: null,
        });
      }
    }
  }

  async createRun(input: {
    canvasId: string;
    clientRequestId: string;
    scope: "node" | "downstream" | "all";
    nodeId?: string;
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
      const nodeIds = selectRunNodeIds(graph, input.scope, input.nodeId);
      const selected = new Set(nodeIds);
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
        status: "queued",
        revisionGraph: graph as unknown as JsonObject,
      });
    }

    if (run.status !== "queued" && run.status !== "running") return run;
    const nodeIds = selectRunNodeIds(
      asGraph(run.revisionGraph),
      run.scope,
      run.nodeId ?? undefined,
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
    const inline =
      this.executionMode === "inline" ||
      (this.executionMode === undefined &&
        (process.env.RUN_IN_PROCESS !== "false" || !process.env.REDIS_URL));
    if (inline) {
      await this.resumeRun(runId);
      return;
    }
    await (this.enqueueRunOverride ?? ((id) => this.enqueue(id)))(runId);
  }

  private startExecution(runId: string): void {
    const execution = this.execute(runId);
    this.running.set(runId, execution);
    void execution.then(
      () => this.running.delete(runId),
      () => this.running.delete(runId),
    );
  }

  private async enqueue(runId: string): Promise<void> {
    const { Queue } = await import("bullmq");
    const connection = { url: process.env.REDIS_URL };
    const queue = new Queue("super-canvas-runs", { connection });
    try {
      const existing = await queue.getJob(runId);
      if (existing) {
        const state = await existing.getState();
        if (state === "failed" || state === "completed") {
          await existing.retry(state, {
            resetAttemptsMade: true,
            resetAttemptsStarted: true,
          });
          return;
        }
        if (state !== "unknown") return;
        await existing.remove();
      }
      const nodeRuns = await this.repository.listNodeRuns(runId);
      const nodeRunId = nodeRuns[0]?.id;
      if (!nodeRunId) throw new Error(`Run ${runId} has no node runs`);
      await queue.add(
        "run",
        { nodeRunId },
        {
          jobId: runId,
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
    } finally {
      await queue.close();
    }
  }

  public async enqueueRunJob(runId: string): Promise<void> {
    await this.enqueue(runId);
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
    const adapters = this.adapters();
    const nodeRuns = await this.repository.listNodeRuns(runId);
    for (const nodeRun of nodeRuns) {
      if (nodeRun.status !== "cancel_requested") continue;
      try {
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
          ));
        await adapter.cancel?.(task);
        await this.repository.updateNodeRun(nodeRun.id, {
          status: "cancelled",
          errorJson: null,
        });
        this.publish({
          type: "node",
          runId,
          nodeRunId: nodeRun.id,
          payload: { nodeId: nodeRun.nodeId, status: "cancelled" },
        });
      } catch (error) {
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
    const run = await this.repository.getRun(runId);
    if (!run) return null;
    if (!["failed", "needs_attention"].includes(run.status)) {
      throw new Error(`运行状态 ${run.status} 不支持恢复`);
    }

    const nodeRuns = await this.repository.listNodeRuns(runId);
    const retryNodeIds = new Set<string>();
    for (const nodeRun of nodeRuns) {
      if (nodeRun.status === "needs_attention") {
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

    this.cancelled.delete(runId);
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

  async cancelRun(runId: string): Promise<WorkflowRunRecord | null> {
    const current = await this.repository.getRun(runId);
    if (!current) return null;
    if (
      ["succeeded", "failed", "cancelled", "needs_attention"].includes(
        current.status,
      )
    ) {
      throw new Error(`Cannot cancel terminal run in status ${current.status}`);
    }
    const run = await this.repository.transitionRunStatus(
      runId,
      ["queued", "running"],
      "cancelled",
    );
    if (!run) {
      const latest = await this.repository.getRun(runId);
      throw new Error(
        `Cannot cancel run in status ${latest?.status ?? "missing"}`,
      );
    }
    this.cancelled.add(runId);
    const nodeRuns = await this.repository.listNodeRuns(runId);
    await Promise.all(
      nodeRuns
        .filter((node) =>
          [
            "queued",
            "submitting",
            "running",
            "archiving",
            "cancel_requested",
          ].includes(node.status),
        )
        .map((node) =>
          this.repository.updateNodeRun(node.id, {
            status: node.status === "queued" ? "cancelled" : "cancel_requested",
          }),
        ),
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
  private async execute(runId: string): Promise<void> {
    try {
      await this.executeInternal(runId);
    } catch (error) {
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

  private async executeInternal(runId: string): Promise<void> {
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
    );
    const nodeRunByNodeId = new Map(
      nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]),
    );
    const selected = new Set(nodeRuns.map((node) => node.nodeId));
    const outputs = new Map<string, OutputValue>();
    const statuses = new Map(
      nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun.status]),
    );
    const adapters = this.adapters();
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

    for (const nodeId of orderedNodeIds) {
      const persistedRun = await this.repository.getRun(runId);
      if (this.cancelled.has(runId) || persistedRun?.status === "cancelled") {
        overall = "cancelled";
        break;
      }
      const node = nodeMap.get(nodeId);
      const nodeRun = nodeRunByNodeId.get(nodeId);
      if (!node || !nodeRun) continue;
      if (nodeRun.status === "succeeded") continue;
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
        continue;
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
        continue;
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
        continue;
      }
      try {
        if (nodeRun.status === "submitting" && !nodeRun.providerTaskId) {
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
          return;
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
        );
        const currentRun = await this.repository.getRun(runId);
        if (currentRun?.status === "cancelled") {
          throw new CancelledError("运行已取消");
        }
        await this.updateNodeRunOrCancel(runId, nodeRun.id, {
          status: "succeeded",
          outputAssetIds: output.assetIds ?? [],
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
        const cancellationWon =
          authoritativeRun?.status === "cancelled" ||
          authoritativeNode?.status === "cancel_requested" ||
          authoritativeNode?.status === "cancelled";
        const nodeOutcome: WorkflowRunRecord["status"] =
          cancellationWon || error instanceof CancelledError
            ? "cancelled"
            : error instanceof NeedsAttentionError
              ? "needs_attention"
              : "failed";
        overall = combineRunStatus(overall, nodeOutcome);
        const providerFailure = providerFailureFor(error, node, nodeRun);
        const message =
          providerFailure?.message ??
          (error instanceof Error ? error.message : String(error));
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
            errorJson: providerFailure ? { ...providerFailure } : { message },
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
        if (nodeOutcome === "cancelled") break;
      }
    }

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
  ): Promise<ProviderTask> {
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

  private async submitWithRetry(
    adapter: ProviderAdapter,
    request: NormalizedRequest,
    nodeRun: NodeRunRecord,
  ): Promise<ProviderTask> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await adapter.submit(request);
      } catch (error) {
        if (error instanceof ProviderHttpError) {
          if (error.details.submissionMayHaveOccurred) {
            throw new NeedsAttentionError(error.message, { cause: error });
          }
          if (!error.details.retryable || attempt === 3) throw error;
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

  private async pollWithRetry(
    adapter: ProviderAdapter,
    state: ProviderTask,
  ): Promise<ProviderTask> {
    if (!adapter.poll)
      throw new NeedsAttentionError(
        "供应商任务仍在运行，但 Adapter 未提供轮询能力",
      );

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await adapter.poll(state);
      } catch (error) {
        const details =
          error instanceof ProviderHttpError ? error.details : undefined;
        const explicitlyRetryable =
          details?.phase === "poll" &&
          details.retryable &&
          (details.kind === "network" ||
            details.kind === "timeout" ||
            details.kind === "rate_limit" ||
            (details.status !== undefined && details.status >= 500));

        if (explicitlyRetryable && attempt < 3) {
          await delay(this.retryBaseDelayMs * 2 ** (attempt - 1));
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
    const connectedRoles = new Map<
      string,
      "reference" | "firstFrame" | "lastFrame"
    >();
    for (const value of values) {
      for (const [assetId, role] of Object.entries(value.assetRoles ?? {}))
        connectedRoles.set(assetId, role);
    }
    for (const assetId of assetIds) {
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
    const operation = operationFor(
      node,
      values.some((value) => value.kind === "image") ||
        assets.some((asset) => asset.kind === "image"),
    );
    if (!operation) throw new Error(`不支持的节点类型: ${semanticType(node)}`);
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
    const model = await this.configuredModel(
      providerName,
      connectionId,
      semanticType(node),
      typeof nodeRun.inputJson.model === "string"
        ? nodeRun.inputJson.model
        : typeof data.model === "string"
          ? data.model
          : undefined,
    );
    const parameters = {
      ...((data.parameters as Record<string, unknown> | undefined) ?? {}),
    };
    const prompt = renderPromptParts(parts, {
      resolveAsset: (id) => {
        const index = assets.findIndex((asset) => asset.id === id);
        return index < 0 ? "" : `[参考素材 ${index + 1}]`;
      },
      unresolvedAsset: "empty",
    });
    if (semanticType(node) === "image-generation") {
      const autoAspectKey =
        parameters.aspect_ratio === "auto"
          ? "aspect_ratio"
          : parameters.size === "auto"
            ? "size"
            : undefined;
      if (autoAspectKey) {
        const inferredRatio =
          aspectRatioFromPrompt(prompt) ?? referenceAspectRatio(graph, assets);
        if (inferredRatio) parameters[autoAspectKey] = inferredRatio;
        else delete parameters[autoAspectKey];
      }
    }
    const request: NormalizedRequest = {
      connectionId,
      operation,
      model,
      prompt,
      assets,
      parameters,
      idempotencyKey: `${runId}:${nodeRunId}`,
      metadata: { fakeScenario: data.fakeScenario },
    };
    const validation = await adapter.validate(request);
    if (!validation.valid)
      throw new ProviderTaskFailedError(
        validation.issues.map((issue) => issue.message).join("; "),
        { provider: providerName, operation },
      );
    const inputJson: JsonObject = {
      ...nodeRun.inputJson,
      provider: providerName,
      connectionId,
      operation,
      model: request.model ?? null,
      prompt: request.prompt,
      assetIds,
      parameters: request.parameters ?? {},
    };
    const savedTask = storedProviderTask(nodeRun.inputJson.providerTask);
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
    if (nodeRun.providerTaskId) {
      task =
        savedTask ??
        (await this.restoreProviderTask(
          providerName,
          connectionId,
          nodeRun.providerTaskId,
        ));
    } else {
      try {
        task = await this.submitWithRetry(adapter, request, nodeRun);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("uncertain") ||
          data.fakeScenario === "submit_uncertain"
        )
          throw new NeedsAttentionError(message);
        throw error;
      }
    }
    const taskSnapshot = {
      ...inputJson,
      providerTask: providerTaskJson(task),
    };
    const persistedTask = await this.repository.updateNodeRun(nodeRunId, {
      status: task.status === "succeeded" ? "archiving" : "running",
      providerTaskId: task.providerTaskId,
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
    for (
      let attempt = 0;
      attempt < 240 &&
      (state.status === "running" || state.status === "queued");
      attempt += 1
    ) {
      if (this.cancelled.has(runId)) {
        await adapter.cancel?.(state);
        throw new CancelledError("运行已取消");
      }
      const persistedRun = await this.repository.getRun(runId);
      if (persistedRun?.status === "cancelled") {
        await adapter.cancel?.(state);
        throw new CancelledError("运行已取消");
      }
      await delay(
        this.pollIntervalMs ??
          state.pollAfterMs ??
          (providerName === "fake" ? 250 : 1_500),
      );
      state = await this.pollWithRetry(adapter, state);
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
    if (state.status === "cancelled")
      throw new CancelledError("供应商已取消任务");
    if (state.status === "failed")
      throw new ProviderTaskFailedError(state.error ?? "供应商生成失败", {
        provider: providerName,
        operation,
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
      );
    }
    if (artifacts.length === 0)
      throw new NeedsAttentionError("供应商任务已完成，但没有返回可归档的结果");
    const ids: string[] = [];
    try {
      for (const [index, artifact] of artifacts.entries())
        ids.push(await this.archiveArtifact(artifact, runId, node.id, index));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NeedsAttentionError(
        `供应商任务已完成，但输出归档失败：${message}`,
      );
    }
    return {
      kind: operation.startsWith("video") ? "video" : "image",
      assetIds: ids,
    };
  }

  private async archiveArtifact(
    artifact: RemoteArtifact,
    runId: string,
    nodeId: string,
    outputIndex: number,
  ): Promise<string> {
    let bytes = artifact.data;
    const maxBytes = artifactDownloadMaxBytes();
    let mime =
      artifact.mimeType ??
      (artifact.kind === "video" ? "video/mp4" : "image/png");
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
      const downloaded = await retryOperation(() =>
        downloadRemoteArtifact(artifact.url!, { maxBytes }),
      );
      bytes = downloaded.bytes;
      mime = downloaded.contentType ?? mime;
    }
    if (!bytes && artifact.metadata?.fake === true) {
      bytes =
        artifact.kind === "image"
          ? new Uint8Array(fakePngBytes)
          : new TextEncoder().encode("SUPER_CANVAS_FAKE_VIDEO");
    }
    if (!bytes)
      throw new Error(
        "Provider output did not include bytes or a downloadable URL",
      );
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Provider output exceeds ${maxBytes} bytes`);
    }
    const id = createHash("sha256")
      .update(`${runId}\0${nodeId}\0${outputIndex}`)
      .digest("hex");
    const extension = artifact.kind === "video" ? "mp4" : "png";
    const storageKey = `assets/${id}/original.${extension}`;
    await retryOperation(() => this.storage.put(storageKey, bytes!, mime));
    await this.repository.saveAsset({
      id,
      name: `${artifact.kind === "video" ? "视频" : "图片"} ${new Date().toLocaleString("zh-CN")}`,
      kind: artifact.kind,
      mimeType: mime,
      size: bytes.byteLength,
      storageKey,
      metadata: {
        runId,
        nodeId,
        fake: Boolean(artifact.url?.includes("example.invalid")),
      },
    });
    this.publish({
      type: "asset",
      runId,
      payload: { assetId: id, kind: artifact.kind },
    });
    return id;
  }
}

function providerFailureFor(
  error: unknown,
  node: WorkflowNode,
  nodeRun: NodeRunRecord,
): ProviderErrorPresentation | undefined {
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
  return presentProviderError(source, {
    provider,
    ...(operation ? { operation } : {}),
  });
}

class ProviderTaskFailedError extends Error {
  public readonly presentation: ProviderErrorPresentation;

  public constructor(
    rawError: unknown,
    context: { provider: string; operation?: ProviderOperation },
  ) {
    const presentation = presentProviderError(rawError, context);
    super(presentation.message);
    this.name = "ProviderTaskFailedError";
    this.presentation = presentation;
  }
}

class NeedsAttentionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
class CancelledError extends Error {}

const globalKey = "__superCanvasRunService";
export function getRunService(): RunService {
  const scope = globalThis as typeof globalThis & { [globalKey]?: RunService };
  scope[globalKey] ??= new RunService();
  return scope[globalKey];
}
