import { describe, expect, it } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import {
  ProviderHttpError,
  type ProviderAdapter,
  type ProviderTask,
} from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService } from "../src/service.js";

class MemoryStorage implements ObjectStorage {
  readonly values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.values.set(key, { bytes: new Uint8Array(bytes), contentType });
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
}

class GatedStorage extends MemoryStorage {
  private markPutStarted = () => {};
  private releasePut = () => {};
  readonly putStarted = new Promise<void>((resolve) => {
    this.markPutStarted = resolve;
  });
  private readonly putGate = new Promise<void>((resolve) => {
    this.releasePut = resolve;
  });

  override async put(key: string, bytes: Uint8Array, contentType: string) {
    this.markPutStarted();
    await this.putGate;
    await super.put(key, bytes, contentType);
  }

  release() {
    this.releasePut();
  }
}

class FailingStorage extends MemoryStorage {
  override async put() {
    throw new Error("archive storage unavailable");
  }
}

class RecoverableStorage extends MemoryStorage {
  constructor(private failures = 0) {
    super();
  }

  override async put(key: string, bytes: Uint8Array, contentType: string) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("archive storage temporarily unavailable");
    }
    await super.put(key, bytes, contentType);
  }

  recover() {
    this.failures = 0;
  }
}

const port = (id: string, kind: string, required = false) => ({
  id,
  kind,
  required,
});

function graphNodeData(graph: JsonObject, nodeId: string): JsonObject {
  const nodes = graph["nodes"] as JsonObject[];
  const node = nodes.find((candidate) => candidate["id"] === nodeId);
  if (!node) throw new Error(`Missing test node ${nodeId}`);
  return node["data"] as JsonObject;
}

describe("RunService model freezing", () => {
  const providerCases = [
    {
      provider: "openai",
      nodeType: "image-generation",
      portKind: "image",
      builtInModel: "gpt-image-2",
    },
    {
      provider: "runway",
      nodeType: "video-generation",
      portKind: "video",
      builtInModel: "gen4.5",
    },
  ] as const;

  const graphFor = (
    provider: string,
    nodeType: string,
    connectionId: string,
    portKind: string,
  ): JsonObject => ({
    schemaVersion: 1,
    nodes: [
      {
        id: "generation",
        type: "workflow",
        data: {
          nodeType,
          provider,
          connectionId,
          parts: [{ type: "text", text: "freeze this model" }],
          outputs: [port("output", portKind)],
        },
      },
    ],
    edges: [],
  });

  const createQueuedRun = async (options: {
    provider: string;
    nodeType: string;
    portKind: string;
    connectionId: string;
    config: JsonObject;
    clientRequestId: string;
  }) => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: options.connectionId,
      name: `${options.provider} model freeze`,
      provider: options.provider,
      encryptedSecret: null,
      config: options.config,
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: graphFor(
        options.provider,
        options.nodeType,
        options.connectionId,
        options.portKind,
      ),
    });
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
      executionMode: "queue",
      enqueueRun: async () => {},
    });
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: options.clientRequestId,
      scope: "node",
      nodeId: "generation",
    });
    return { repository, run };
  };

  it.each(providerCases)(
    "freezes the configured default model for $provider runs",
    async ({ provider, nodeType, portKind }) => {
      const connectionId = `${provider}-configured`;
      const configuredModel = `${provider}-custom-model`;
      const { repository, run } = await createQueuedRun({
        provider,
        nodeType,
        portKind,
        connectionId,
        config: { defaultModel: configuredModel },
        clientRequestId: `${provider}-configured-request`,
      });
      const frozen = await repository.getRun(run.id);
      const frozenNodes = frozen?.revisionGraph["nodes"] as JsonObject[];
      const frozenNode = frozenNodes.find(
        (node) => node["id"] === "generation",
      );
      expect((frozenNode?.["data"] as JsonObject | undefined)?.["model"]).toBe(
        configuredModel,
      );

      const beforeGraph = frozen?.revisionGraph;
      await repository.saveConnection({
        id: connectionId,
        name: `${provider} model freeze`,
        provider,
        encryptedSecret: null,
        config: { defaultModel: `${provider}-changed-model` },
      });
      const after = await repository.getRun(run.id);
      expect(after?.revisionGraph).toEqual(beforeGraph);
      const afterNodes = after?.revisionGraph["nodes"] as JsonObject[];
      expect(
        (
          afterNodes.find((node) => node["id"] === "generation")?.["data"] as
            JsonObject | undefined
        )?.["model"],
      ).toBe(configuredModel);
    },
  );

  it.each(providerCases)(
    "freezes the built-in default model for $provider runs",
    async ({ provider, nodeType, portKind, builtInModel }) => {
      const connectionId = `${provider}-built-in`;
      const { repository, run } = await createQueuedRun({
        provider,
        nodeType,
        portKind,
        connectionId,
        config: {},
        clientRequestId: `${provider}-built-in-request`,
      });
      const frozen = await repository.getRun(run.id);
      const frozenNodes = frozen?.revisionGraph["nodes"] as JsonObject[];
      const frozenNode = frozenNodes.find(
        (node) => node["id"] === "generation",
      );
      expect((frozenNode?.["data"] as JsonObject | undefined)?.["model"]).toBe(
        builtInModel,
      );

      const beforeGraph = frozen?.revisionGraph;
      await repository.saveConnection({
        id: connectionId,
        name: `${provider} model freeze`,
        provider,
        encryptedSecret: null,
        config: { defaultModel: `${provider}-later-model` },
      });
      const after = await repository.getRun(run.id);
      expect(after?.revisionGraph).toEqual(beforeGraph);
      const afterNodes = after?.revisionGraph["nodes"] as JsonObject[];
      expect(
        (
          afterNodes.find((node) => node["id"] === "generation")?.["data"] as
            JsonObject | undefined
        )?.["model"],
      ).toBe(builtInModel);
    },
  );
});

function graph(fakeScenario?: string): JsonObject {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "prompt",
        type: "workflow",
        data: {
          nodeType: "prompt",
          parts: [{ type: "text", text: "cinematic city" }],
          outputs: [port("prompt", "text")],
        },
      },
      {
        id: "image",
        type: "workflow",
        data: {
          nodeType: "image-generation",
          provider: "fake",
          connectionId: "fake-default",
          model: "fake-image-v1",
          fakeScenario,
          inputs: [port("prompt", "text", true)],
          outputs: [port("image", "image")],
        },
      },
      {
        id: "video",
        type: "workflow",
        data: {
          nodeType: "video-generation",
          provider: "fake",
          connectionId: "fake-default",
          model: "fake-video-v1",
          inputs: [port("prompt", "text"), port("firstFrame", "image")],
          outputs: [port("video", "video")],
        },
      },
      {
        id: "preview",
        type: "workflow",
        data: { nodeType: "preview", inputs: [port("video", "video")] },
      },
    ],
    edges: [
      {
        id: "p-i",
        source: "prompt",
        sourceHandle: "prompt",
        target: "image",
        targetHandle: "prompt",
      },
      {
        id: "p-v",
        source: "prompt",
        sourceHandle: "prompt",
        target: "video",
        targetHandle: "prompt",
      },
      {
        id: "i-v",
        source: "image",
        sourceHandle: "image",
        target: "video",
        targetHandle: "firstFrame",
      },
      {
        id: "v-o",
        source: "video",
        sourceHandle: "video",
        target: "preview",
        targetHandle: "video",
      },
    ],
  };
}

function promptAssetGraph(assetId: string): JsonObject {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "asset",
        type: "workflow",
        data: {
          nodeType: "asset-input",
          assetId,
          assetKind: "image",
          mediaAspectRatio: 4 / 3,
          outputs: [port("asset", "image")],
        },
      },
      {
        id: "prompt",
        type: "workflow",
        data: {
          nodeType: "prompt",
          parts: [
            { type: "text", text: "animate this reference" },
            { type: "asset", assetId, role: "firstFrame" },
          ],
          outputs: [port("prompt", "text")],
        },
      },
      {
        id: "image",
        type: "workflow",
        data: {
          nodeType: "image-generation",
          provider: "fake",
          connectionId: "fake-default",
          parameters: { aspect_ratio: "auto" },
          inputs: [
            port("prompt", "text", true),
            port("references", "image[]"),
          ],
          outputs: [port("image", "image")],
        },
      },
      {
        id: "video",
        type: "workflow",
        data: {
          nodeType: "video-generation",
          provider: "fake",
          connectionId: "fake-default",
          inputs: [port("prompt", "text", true), port("firstFrame", "image")],
          outputs: [port("video", "video")],
        },
      },
    ],
    edges: [
      {
        id: "prompt-image",
        source: "prompt",
        sourceHandle: "prompt",
        target: "image",
        targetHandle: "prompt",
      },
      {
        id: "prompt-video",
        source: "prompt",
        sourceHandle: "prompt",
        target: "video",
        targetHandle: "prompt",
      },
      {
        id: "asset-image",
        source: "asset",
        sourceHandle: "asset",
        target: "image",
        targetHandle: "references",
      },
      {
        id: "asset-video",
        source: "asset",
        sourceHandle: "asset",
        target: "video",
        targetHandle: "firstFrame",
      },
    ],
  };
}

function independentBranchesGraph(): JsonObject {
  const promptNode = (id: string) => ({
    id: `prompt-${id}`,
    type: "workflow",
    data: {
      nodeType: "prompt",
      parts: [{ type: "text", text: `branch ${id}` }],
      outputs: [port("prompt", "text")],
    },
  });
  const imageNode = (id: string, fakeScenario: string) => ({
    id: `image-${id}`,
    type: "workflow",
    data: {
      nodeType: "image-generation",
      provider: "fake",
      connectionId: "fake-default",
      fakeScenario,
      inputs: [port("prompt", "text", true)],
      outputs: [port("image", "image")],
    },
  });
  const previewNode = (id: string) => ({
    id: `preview-${id}`,
    type: "workflow",
    data: {
      nodeType: "preview",
      inputs: [port("image", "image", true)],
    },
  });
  const edges = (id: string) => [
    {
      id: `prompt-image-${id}`,
      source: `prompt-${id}`,
      sourceHandle: "prompt",
      target: `image-${id}`,
      targetHandle: "prompt",
    },
    {
      id: `image-preview-${id}`,
      source: `image-${id}`,
      sourceHandle: "image",
      target: `preview-${id}`,
      targetHandle: "image",
    },
  ];
  return {
    schemaVersion: 1,
    nodes: [
      promptNode("a"),
      imageNode("a", "fail"),
      previewNode("a"),
      promptNode("b"),
      imageNode("b", "sync"),
      previewNode("b"),
    ],
    edges: [...edges("a"), ...edges("b")],
  };
}

function resumableNodeGraph(): JsonObject {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "image",
        type: "workflow",
        data: {
          nodeType: "image-generation",
          provider: "runway",
          connectionId: "runway-test",
          parts: [{ type: "text", text: "resumable image" }],
          outputs: [port("image", "image")],
        },
      },
    ],
    edges: [],
  };
}

function retryBlockedGraph(): JsonObject {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "prompt",
        type: "workflow",
        data: {
          nodeType: "prompt",
          parts: [{ type: "text", text: "retry this branch" }],
          outputs: [port("prompt", "text")],
        },
      },
      {
        id: "image",
        type: "workflow",
        data: {
          nodeType: "image-generation",
          provider: "runway",
          connectionId: "runway-test",
          inputs: [port("prompt", "text", true)],
          outputs: [port("image", "image")],
        },
      },
      {
        id: "preview",
        type: "workflow",
        data: {
          nodeType: "preview",
          inputs: [port("image", "image", true)],
        },
      },
    ],
    edges: [
      {
        id: "prompt-image",
        source: "prompt",
        sourceHandle: "prompt",
        target: "image",
        targetHandle: "prompt",
      },
      {
        id: "image-preview",
        source: "image",
        sourceHandle: "image",
        target: "preview",
        targetHandle: "image",
      },
    ],
  };
}

function selectedValidationGraph(): JsonObject {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "prompt",
        type: "workflow",
        data: {
          nodeType: "prompt",
          parts: [{ type: "text", text: "valid selected node" }],
          outputs: [port("prompt", "text")],
        },
      },
      {
        id: "disconnected-image",
        type: "workflow",
        data: {
          nodeType: "image-generation",
          provider: "fake",
          inputs: [port("prompt", "text", true)],
          outputs: [port("image", "image")],
        },
      },
    ],
    edges: [],
  };
}

function historicalGenerationDependencyGraph(): JsonObject {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "prompt",
        type: "workflow",
        data: {
          nodeType: "prompt",
          parts: [{ type: "text", text: "animate the generated frame" }],
          outputs: [port("prompt", "text")],
        },
      },
      {
        id: "image",
        type: "workflow",
        data: {
          nodeType: "image-generation",
          provider: "runway",
          connectionId: "runway-test",
          inputs: [port("prompt", "text", true)],
          outputs: [port("image", "image")],
        },
      },
      {
        id: "video",
        type: "workflow",
        data: {
          nodeType: "video-generation",
          provider: "runway",
          connectionId: "runway-test",
          inputs: [
            port("prompt", "text", true),
            port("firstFrame", "image", true),
          ],
          outputs: [port("video", "video")],
        },
      },
      {
        id: "preview",
        type: "workflow",
        data: {
          nodeType: "preview",
          inputs: [port("video", "video", true)],
        },
      },
    ],
    edges: [
      {
        id: "prompt-image",
        source: "prompt",
        sourceHandle: "prompt",
        target: "image",
        targetHandle: "prompt",
      },
      {
        id: "prompt-video",
        source: "prompt",
        sourceHandle: "prompt",
        target: "video",
        targetHandle: "prompt",
      },
      {
        id: "image-video",
        source: "image",
        sourceHandle: "image",
        target: "video",
        targetHandle: "firstFrame",
      },
      {
        id: "video-preview",
        source: "video",
        sourceHandle: "video",
        target: "preview",
        targetHandle: "video",
      },
    ],
  };
}

class AdapterRunService extends RunService {
  constructor(
    private readonly adapter: ProviderAdapter,
    repository: MemoryRepository,
    storage: ObjectStorage,
    executionMode: "inline" | "queue" = "inline",
  ) {
    super({
      repository,
      storage,
      pollIntervalMs: 0,
      retryBaseDelayMs: 1,
      executionMode,
      ...(executionMode === "queue" ? { enqueueRun: async () => {} } : {}),
    });
  }

  override adapters(): Map<string, ProviderAdapter> {
    return new Map([["runway", this.adapter]]);
  }
}

function pollingAdapter(errors: readonly Error[]) {
  let submitCalls = 0;
  let pollCalls = 0;
  const adapter: ProviderAdapter = {
    async testConnection() {},
    async listModels() {
      return [];
    },
    async validate() {
      return { valid: true, issues: [] };
    },
    async submit() {
      submitCalls += 1;
      return { providerTaskId: "unexpected-submit", status: "running" };
    },
    async poll(task) {
      const error = errors[pollCalls];
      pollCalls += 1;
      if (error) throw error;
      return {
        ...task,
        status: "succeeded",
        result: { completed: true },
      };
    },
    async extractOutputs() {
      return [
        {
          kind: "image",
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
        },
      ];
    },
  };
  return {
    adapter,
    calls: () => ({ submit: submitCalls, poll: pollCalls }),
  };
}

function synchronousAdapter(
  options: { extractError?: Error; onSubmit?: () => void } = {},
): ProviderAdapter {
  return {
    async testConnection() {},
    async listModels() {
      return [];
    },
    async validate() {
      return { valid: true, issues: [] };
    },
    async submit() {
      options.onSubmit?.();
      return {
        providerTaskId: "sync-task",
        status: "succeeded",
        result: { completed: true },
      };
    },
    async extractOutputs() {
      if (options.extractError) throw options.extractError;
      return [
        {
          kind: "image",
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
          url: "https://third-party.example/temporary?secret=value",
        },
      ];
    },
  };
}

function flakySubmitAdapter() {
  let submitCalls = 0;
  const adapter: ProviderAdapter = {
    async testConnection() {},
    async listModels() {
      return [];
    },
    async validate() {
      return { valid: true, issues: [] };
    },
    async submit() {
      submitCalls += 1;
      if (submitCalls === 1) throw new Error("first submit failed");
      return {
        providerTaskId: "retry-task",
        status: "succeeded" as const,
        result: { completed: true },
      };
    },
    async extractOutputs() {
      return [
        {
          kind: "image" as const,
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
        },
      ];
    },
  };
  return { adapter, calls: () => submitCalls };
}

class ThrowingAdapterRunService extends RunService {
  override adapters(): Map<string, ProviderAdapter> {
    throw new Error("adapter registry unavailable");
  }
}

function countingSynchronousAdapter() {
  let submitCalls = 0;
  const submittedOperations: string[] = [];
  const adapter: ProviderAdapter = {
    async testConnection() {},
    async listModels() {
      return [];
    },
    async validate() {
      return { valid: true, issues: [] };
    },
    async submit(request) {
      submitCalls += 1;
      submittedOperations.push(request.operation);
      return {
        providerTaskId: "should-not-submit",
        status: "succeeded",
        result: { completed: true },
      };
    },
    async extractOutputs() {
      return [
        {
          kind: "video",
          data: new Uint8Array([1, 2, 3]),
          mimeType: "video/mp4",
        },
      ];
    },
  };
  return {
    adapter,
    calls: () => ({ submit: submitCalls, operations: submittedOperations }),
  };
}

function cancellationAdapter(cancelError?: Error) {
  let cancelCalls = 0;
  const cancelledTasks: ProviderTask[] = [];
  const adapter: ProviderAdapter = {
    async testConnection() {},
    async listModels() {
      return [];
    },
    async validate() {
      return { valid: true, issues: [] };
    },
    async submit() {
      throw new Error("unexpected submit");
    },
    async cancel(task) {
      cancelCalls += 1;
      cancelledTasks.push(task);
      if (cancelError) throw cancelError;
    },
    async extractOutputs() {
      return [];
    },
  };
  return {
    adapter,
    calls: () => ({ cancel: cancelCalls, tasks: cancelledTasks }),
  };
}

function gatedSubmitAdapter() {
  let releaseSubmit = () => {};
  let markSubmitStarted = () => {};
  let cancelCalls = 0;
  const submitStarted = new Promise<void>((resolve) => {
    markSubmitStarted = resolve;
  });
  const submitGate = new Promise<void>((resolve) => {
    releaseSubmit = resolve;
  });
  const adapter: ProviderAdapter = {
    async testConnection() {},
    async listModels() {
      return [];
    },
    async validate() {
      return { valid: true, issues: [] };
    },
    async submit() {
      markSubmitStarted();
      await submitGate;
      return {
        providerTaskId: "gated-submit-task",
        status: "succeeded",
        result: { completed: true },
      };
    },
    async cancel() {
      cancelCalls += 1;
    },
    async extractOutputs() {
      return [
        {
          kind: "image",
          data: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
        },
      ];
    },
  };
  return {
    adapter,
    submitStarted,
    release: releaseSubmit,
    calls: () => ({ cancel: cancelCalls }),
  };
}

async function seedCancelledProviderRun(
  repository: MemoryRepository,
  canvasId: string,
) {
  const providerTask = {
    providerTaskId: "remote-cancel-task",
    id: "remote-cancel-task",
    status: "running" as const,
    result: {
      connectionId: "runway-test",
      remote: { id: "remote-cancel-task", state: "RUNNING" },
    },
  };
  await repository.createRun({
    id: "cancelled-provider-run",
    canvasId,
    clientRequestId: "cancelled-provider-request",
    scope: "node",
    nodeId: "image",
    status: "cancelled",
    revisionGraph: resumableNodeGraph(),
  });
  await repository.createNodeRun({
    id: "cancelled-provider-node-run",
    workflowRunId: "cancelled-provider-run",
    nodeId: "image",
    status: "cancel_requested",
    attempt: 1,
    providerTaskId: providerTask.providerTaskId,
    inputJson: {
      provider: "runway",
      connectionId: "runway-test",
      providerTask,
    },
    outputAssetIds: [],
    errorJson: null,
  });
  return providerTask;
}

async function seedResumableRun(
  repository: MemoryRepository,
  canvasId: string,
) {
  const revisionGraph = resumableNodeGraph();
  await repository.createRun({
    id: "resumable-run",
    canvasId,
    clientRequestId: "resumable-request",
    scope: "node",
    nodeId: "image",
    status: "running",
    revisionGraph,
  });
  await repository.createNodeRun({
    id: "resumable-node-run",
    workflowRunId: "resumable-run",
    nodeId: "image",
    status: "running",
    attempt: 1,
    providerTaskId: "remote-task-1",
    inputJson: {},
    outputAssetIds: [],
    errorJson: null,
  });
}

async function waitForRun(service: RunService, runId: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const snapshot = await service.getRun(runId);
    if (
      snapshot &&
      ["succeeded", "failed", "cancelled", "needs_attention"].includes(
        snapshot.run.status,
      )
    )
      return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("run timeout");
}

describe("RunService", () => {
  it("executes and archives a complete image-to-video graph", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: graph() });
    const service = new RunService({ repository, storage });
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "complete-1",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);
    expect(snapshot.run.status).toBe("succeeded");
    expect(snapshot.nodes.map((node) => node.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    const assets = await repository.listAssets();
    expect(assets.map((asset) => asset.kind).sort()).toEqual([
      "image",
      "video",
    ]);
    expect(storage.values.size).toBe(2);
    const image = assets.find((asset) => asset.kind === "image");
    const archivedImage = image ? await storage.get(image.storageKey) : null;
    expect(Array.from(archivedImage?.bytes.slice(0, 8) ?? [])).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("deduplicates a repeated client request", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: graph() });
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
    });
    const first = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "same-request",
      scope: "node",
      nodeId: "prompt",
    });
    const second = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "same-request",
      scope: "node",
      nodeId: "prompt",
    });
    expect(second.id).toBe(first.id);
  });

  it("records an unexpected execution failure as needs_attention", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({
      id: canvas.id,
      graph: selectedValidationGraph(),
    });
    const service = new ThrowingAdapterRunService({
      repository,
      storage: new MemoryStorage(),
    });

    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "unexpected-execution-failure",
      scope: "node",
      nodeId: "prompt",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.errorJson?.message).toContain(
      "adapter registry unavailable",
    );
  });

  it("moves an uncertain provider submission to needs_attention", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({
      id: canvas.id,
      graph: graph("submit_uncertain"),
    });
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
    });
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "uncertain-1",
      scope: "downstream",
      nodeId: "image",
    });
    const snapshot = await waitForRun(service, run.id);
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.status).toBe("needs_attention");
    await expect(service.retryRun(run.id)).rejects.toThrow("ID");
  });

  it("does not archive or resubmit completed nodes during recovery", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: graph() });
    const firstService = new RunService({ repository, storage });
    const run = await firstService.createRun({
      canvasId: canvas.id,
      clientRequestId: "recover-1",
      scope: "all",
    });
    await waitForRun(firstService, run.id);
    const before = (await repository.listAssets()).length;
    await repository.updateRun(run.id, { status: "running" });
    const recoveredService = new RunService({ repository, storage });
    recoveredService.resumeRun(run.id);
    const recovered = await waitForRun(recoveredService, run.id);
    expect(recovered.run.status).toBe("succeeded");
    expect((await repository.listAssets()).length).toBe(before);
  });

  it("uses image operations when the only image is referenced by the prompt", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await storage.put(
      "assets/reference/original.png",
      new Uint8Array([1, 2, 3]),
      "image/png",
    );
    await repository.saveAsset({
      id: "reference-image",
      name: "Reference image",
      kind: "image",
      mimeType: "image/png",
      size: 3,
      storageKey: "assets/reference/original.png",
      metadata: {},
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: promptAssetGraph("reference-image"),
    });
    const service = new RunService({
      repository,
      storage,
      pollIntervalMs: 0,
    });
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "prompt-assets",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);
    expect(snapshot.run.status).toBe("succeeded");
    const byNodeId = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
    expect(byNodeId.get("image")?.inputJson["operation"]).toBe("image.edit");
    expect(byNodeId.get("video")?.inputJson["operation"]).toBe(
      "video.image-to-video",
    );
    expect(byNodeId.get("image")?.inputJson["prompt"]).toBe(
      "animate this reference [参考素材 1]",
    );
    expect(byNodeId.get("image")?.inputJson["parameters"]).toMatchObject({
      aspect_ratio: "4:3",
    });
    expect(byNodeId.get("video")?.inputJson["prompt"]).toBe(
      "animate this reference [参考素材 1]",
    );
  });

  it("does not overwrite canvas edits made while a frozen revision is running", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: graph() });
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
      pollIntervalMs: 20,
    });
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "preserve-live-edit",
      scope: "all",
    });
    const editedGraph = graph() as JsonObject & {
      viewport?: { x: number; y: number; zoom: number };
    };
    editedGraph.viewport = { x: 321, y: 123, zoom: 0.75 };
    const edited = await repository.saveCanvas({
      id: canvas.id,
      graph: editedGraph,
      reason: "autosave",
    });
    await waitForRun(service, run.id);
    const current = await repository.getCanvas(canvas.id);
    expect(current?.graph).toEqual(editedGraph);
    expect(current?.revision).toBe(edited.revision);
  });

  it("continues independent branches and blocks only failed dependencies", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({
      id: canvas.id,
      graph: independentBranchesGraph(),
    });
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
      pollIntervalMs: 0,
    });
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "independent-branches",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);
    const statuses = Object.fromEntries(
      snapshot.nodes.map((node) => [node.nodeId, node.status]),
    );
    expect(snapshot.run.status).toBe("failed");
    expect(statuses).toMatchObject({
      "prompt-a": "succeeded",
      "image-a": "failed",
      "preview-a": "blocked",
      "prompt-b": "succeeded",
      "image-b": "succeeded",
      "preview-b": "succeeded",
    });
    expect((await repository.listAssets()).map((asset) => asset.kind)).toEqual([
      "image",
    ]);
  });

  it("retries safe polling errors without resubmitting an existing task", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const networkError = new ProviderHttpError("temporary network error", {
      kind: "network",
      phase: "poll",
      retryable: true,
      submissionMayHaveOccurred: false,
    });
    const rateLimitError = new ProviderHttpError("temporary rate limit", {
      kind: "rate_limit",
      phase: "poll",
      status: 429,
      retryable: true,
      submissionMayHaveOccurred: false,
    });
    const provider = pollingAdapter([networkError, rateLimitError]);
    const service = new AdapterRunService(
      provider.adapter,
      repository,
      storage,
    );
    service.resumeRun("resumable-run");
    const snapshot = await waitForRun(service, "resumable-run");
    expect(snapshot.run.status).toBe("succeeded");
    expect(provider.calls()).toEqual({ submit: 0, poll: 3 });
  });

  it("moves an indeterminate task to needs_attention after three poll failures", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const unavailable = () =>
      new ProviderHttpError("provider unavailable", {
        kind: "provider",
        phase: "poll",
        status: 503,
        retryable: true,
        submissionMayHaveOccurred: false,
      });
    const provider = pollingAdapter([
      unavailable(),
      unavailable(),
      unavailable(),
    ]);
    const service = new AdapterRunService(
      provider.adapter,
      repository,
      storage,
    );
    service.resumeRun("resumable-run");
    const snapshot = await waitForRun(service, "resumable-run");
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.providerTaskId).toBe("remote-task-1");
    expect(provider.calls()).toEqual({ submit: 0, poll: 3 });

    await service.retryRun("resumable-run");
    const recovered = await waitForRun(service, "resumable-run");
    expect(recovered.run.status).toBe("succeeded");
    expect(recovered.nodes[0]?.status).toBe("succeeded");
    expect(provider.calls()).toEqual({ submit: 0, poll: 4 });
  });

  it("reuses the latest successful upstream output from node runs", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: graph() });
    const service = new RunService({
      repository,
      storage,
      pollIntervalMs: 0,
    });
    const first = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "historical-source-first",
      scope: "all",
    });
    const firstSnapshot = await waitForRun(service, first.id);
    const imageOutput = firstSnapshot.nodes.find(
      (node) => node.nodeId === "image",
    )?.outputAssetIds[0];
    expect(imageOutput).toBeTruthy();

    const second = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "historical-source-second",
      scope: "node",
      nodeId: "video",
    });
    const secondSnapshot = await waitForRun(service, second.id);
    expect(secondSnapshot.run.status).toBe("succeeded");
    expect(secondSnapshot.nodes).toHaveLength(1);
    expect(secondSnapshot.nodes[0]?.inputJson["assetIds"]).toContain(
      imageOutput,
    );
  });

  it("freezes historical upstream inputs when a queued run is created", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({
      id: canvas.id,
      graph: historicalGenerationDependencyGraph(),
    });
    const provider = synchronousAdapter();
    const service = new AdapterRunService(provider, repository, storage);

    const first = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "freeze-input-first",
      scope: "node",
      nodeId: "image",
    });
    const firstSnapshot = await waitForRun(service, first.id);
    const firstAssetId = firstSnapshot.nodes[0]?.outputAssetIds[0];
    expect(firstAssetId).toBeTruthy();

    const queued = new AdapterRunService(
      provider,
      repository,
      storage,
      "queue",
    );
    const downstream = await queued.createRun({
      canvasId: canvas.id,
      clientRequestId: "freeze-input-downstream",
      scope: "node",
      nodeId: "video",
    });
    const queuedNode = (await repository.listNodeRuns(downstream.id))[0];
    expect(
      (queuedNode?.inputJson.historicalInputs as JsonObject)?.image,
    ).toMatchObject({ value: { assetIds: [firstAssetId] } });

    const second = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "freeze-input-second",
      scope: "node",
      nodeId: "image",
    });
    await waitForRun(service, second.id);

    await queued.resumeRun(downstream.id);
    const downstreamSnapshot = await waitForRun(queued, downstream.id);
    expect(downstreamSnapshot.run.status).toBe("succeeded");
    expect(downstreamSnapshot.nodes[0]?.inputJson.assetIds).toContain(
      firstAssetId,
    );
  });

  it.each(["node", "downstream"] as const)(
    "blocks a %s run before provider submission when an excluded generation has no successful output",
    async (scope) => {
      const repository = new MemoryRepository();
      const canvas = await repository.ensureDefaultCanvas();
      await repository.saveCanvas({
        id: canvas.id,
        graph: historicalGenerationDependencyGraph(),
      });
      const provider = countingSynchronousAdapter();
      const service = new AdapterRunService(
        provider.adapter,
        repository,
        new MemoryStorage(),
      );
      const run = await service.createRun({
        canvasId: canvas.id,
        clientRequestId: `missing-historical-${scope}`,
        scope,
        nodeId: "video",
      });
      const snapshot = await waitForRun(service, run.id);
      const video = snapshot.nodes.find((node) => node.nodeId === "video");

      expect(snapshot.run.status).toBe("failed");
      expect(video?.status).toBe("failed");
      expect(provider.calls()).toEqual({ submit: 0, operations: [] });
    },
  );

  it("requires attention when output extraction fails after provider success", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    const service = new AdapterRunService(
      synchronousAdapter({ extractError: new Error("malformed output") }),
      repository,
      new MemoryStorage(),
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "extract-after-provider-success",
      scope: "node",
      nodeId: "image",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.providerTaskId).toBe("sync-task");
  });

  it("requires attention when archiving fails after provider success", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    const service = new AdapterRunService(
      synchronousAdapter(),
      repository,
      new FailingStorage(),
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "archive-after-provider-success",
      scope: "node",
      nodeId: "image",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.providerTaskId).toBe("sync-task");
  });

  it("retries archiving without submitting a second provider task", async () => {
    const repository = new MemoryRepository();
    const storage = new RecoverableStorage(3);
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    let submitCalls = 0;
    const service = new AdapterRunService(
      synchronousAdapter({ onSubmit: () => (submitCalls += 1) }),
      repository,
      storage,
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "retry-archive",
      scope: "node",
      nodeId: "image",
    });
    const first = await waitForRun(service, run.id);
    expect(first.run.status).toBe("needs_attention");
    expect(first.nodes[0]?.providerTaskId).toBe("sync-task");
    expect(submitCalls).toBe(1);

    storage.recover();
    await service.retryRun(run.id);
    const recovered = await waitForRun(service, run.id);
    expect(recovered.run.status).toBe("succeeded");
    expect(recovered.nodes[0]?.status).toBe("succeeded");
    expect(submitCalls).toBe(1);
    expect(await repository.listAssets()).toHaveLength(1);
  });

  it("requeues blocked descendants when retrying a failed upstream node", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({
      id: canvas.id,
      graph: retryBlockedGraph(),
    });
    const provider = flakySubmitAdapter();
    const service = new AdapterRunService(
      provider.adapter,
      repository,
      new MemoryStorage(),
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "retry-blocked-descendants",
      scope: "all",
    });
    const first = await waitForRun(service, run.id);
    expect(first.run.status).toBe("failed");
    expect(
      Object.fromEntries(first.nodes.map((node) => [node.nodeId, node.status])),
    ).toMatchObject({ image: "failed", preview: "blocked" });

    await service.retryRun(run.id);
    const recovered = await waitForRun(service, run.id);
    expect(recovered.run.status).toBe("succeeded");
    expect(
      Object.fromEntries(
        recovered.nodes.map((node) => [node.nodeId, node.status]),
      ),
    ).toMatchObject({ image: "succeeded", preview: "succeeded" });
    expect(provider.calls()).toBe(2);
  });

  it("repairs missing node runs and retries scheduling for an existing queued run", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const frozenGraph = selectedValidationGraph();
    await repository.createRun({
      id: "queued-run",
      canvasId: canvas.id,
      clientRequestId: "queued-request",
      scope: "node",
      nodeId: "prompt",
      status: "queued",
      revisionGraph: frozenGraph,
    });
    let enqueueAttempts = 0;
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
      executionMode: "queue",
      enqueueRun: async () => {
        enqueueAttempts += 1;
        if (enqueueAttempts === 1) throw new Error("queue unavailable");
      },
    });
    await expect(
      service.createRun({
        canvasId: canvas.id,
        clientRequestId: "queued-request",
        scope: "all",
      }),
    ).rejects.toThrow("queue unavailable");
    await expect(
      service.createRun({
        canvasId: canvas.id,
        clientRequestId: "queued-request",
        scope: "all",
      }),
    ).resolves.toMatchObject({ id: "queued-run", scope: "node" });
    expect(enqueueAttempts).toBe(2);
    await expect(repository.listNodeRuns("queued-run")).resolves.toHaveLength(
      1,
    );
  });

  it("validates required inputs only for nodes in the selected run scope", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({
      id: canvas.id,
      graph: selectedValidationGraph(),
    });
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
      executionMode: "queue",
      enqueueRun: async () => {},
    });
    await expect(
      service.createRun({
        canvasId: canvas.id,
        clientRequestId: "valid-selected",
        scope: "node",
        nodeId: "prompt",
      }),
    ).resolves.toMatchObject({ status: "queued" });
    await expect(
      service.createRun({
        canvasId: canvas.id,
        clientRequestId: "invalid-selected",
        scope: "node",
        nodeId: "disconnected-image",
      }),
    ).rejects.toThrow(/Required input prompt/u);
  });

  it("accepts an inline prompt on a legacy required prompt port and prefers parts over prompt", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const workflow = selectedValidationGraph();
    const imageData = graphNodeData(workflow, "disconnected-image");
    imageData["parts"] = [{ type: "text", text: "edited inline prompt" }];
    imageData["prompt"] = [{ type: "text", text: "stale legacy prompt" }];
    await repository.saveCanvas({ id: canvas.id, graph: workflow });
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
      pollIntervalMs: 0,
    });

    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "legacy-required-inline-prompt",
      scope: "node",
      nodeId: "disconnected-image",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("succeeded");
    expect(snapshot.nodes[0]?.inputJson["prompt"]).toBe("edited inline prompt");
  });

  it.each([
    {
      name: "uses non-empty inline text before an upstream prompt",
      inlineText: "inline generation prompt",
      expected: "inline generation prompt",
    },
    {
      name: "falls back to the upstream prompt when inline text is blank",
      inlineText: "   ",
      expected: "cinematic city",
    },
  ])("$name", async ({ inlineText, expected }) => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const workflow = graph();
    const imageData = graphNodeData(workflow, "image");
    imageData["parts"] = [{ type: "text", text: inlineText }];
    imageData["prompt"] = [{ type: "text", text: "stale legacy prompt" }];
    await repository.saveCanvas({ id: canvas.id, graph: workflow });
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
      pollIntervalMs: 0,
    });

    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: `inline-priority-${expected}`,
      scope: "node",
      nodeId: "image",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("succeeded");
    expect(snapshot.nodes[0]?.inputJson["prompt"]).toBe(expected);
  });

  it("cancels archiving nodes and never overwrites the terminal run status", async () => {
    const repository = new MemoryRepository();
    const storage = new GatedStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    const service = new AdapterRunService(
      synchronousAdapter(),
      repository,
      storage,
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "cancel-archiving",
      scope: "node",
      nodeId: "image",
    });
    await storage.putStarted;
    const cancelled = await service.cancelRun(run.id);
    expect(cancelled?.status).toBe("cancelled");
    expect((await service.getRun(run.id))?.nodes[0]?.status).toBe(
      "cancel_requested",
    );
    storage.release();

    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const snapshot = await service.getRun(run.id);
      if (snapshot?.nodes[0]?.status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const snapshot = await service.getRun(run.id);
    expect(snapshot?.run.status).toBe("cancelled");
    expect(snapshot?.nodes[0]?.status).toBe("cancelled");
    const archived = await repository.listAssets();
    expect(archived[0]?.metadata).not.toHaveProperty("sourceUrl");
    await expect(service.cancelRun(run.id)).rejects.toThrow(/terminal run/u);
  });

  it("persists a provider task that returns after cancellation without reviving the node", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    const provider = gatedSubmitAdapter();
    const service = new AdapterRunService(
      provider.adapter,
      repository,
      new MemoryStorage(),
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "cancel-during-submit",
      scope: "node",
      nodeId: "image",
    });

    await provider.submitStarted;
    await service.cancelRun(run.id);
    provider.release();

    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const snapshot = await service.getRun(run.id);
      if (snapshot?.nodes[0]?.status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const snapshot = await service.getRun(run.id);
    expect(snapshot?.run.status).toBe("cancelled");
    expect(snapshot?.nodes[0]).toMatchObject({
      status: "cancelled",
      providerTaskId: "gated-submit-task",
    });
    expect(provider.calls().cancel).toBe(1);
  });

  it("reconciles a persisted provider task after the run is cancelled", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const providerTask = await seedCancelledProviderRun(repository, canvas.id);
    const provider = cancellationAdapter();
    const service = new AdapterRunService(
      provider.adapter,
      repository,
      new MemoryStorage(),
    );

    await service.reconcileCancellation("cancelled-provider-run");

    const snapshot = await service.getRun("cancelled-provider-run");
    expect(provider.calls()).toEqual({ cancel: 1, tasks: [providerTask] });
    expect(snapshot?.run.status).toBe("cancelled");
    expect(snapshot?.nodes[0]?.status).toBe("cancelled");
    expect(snapshot?.nodes[0]?.errorJson).toBeNull();
  });

  it("keeps cancellation pending and records an adapter cancellation error", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const providerTask = await seedCancelledProviderRun(repository, canvas.id);
    const provider = cancellationAdapter(
      new Error("provider cancellation unavailable"),
    );
    const service = new AdapterRunService(
      provider.adapter,
      repository,
      new MemoryStorage(),
    );

    await service.reconcileCancellation("cancelled-provider-run");

    const snapshot = await service.getRun("cancelled-provider-run");
    expect(provider.calls()).toEqual({ cancel: 1, tasks: [providerTask] });
    expect(snapshot?.run.status).toBe("cancelled");
    expect(snapshot?.nodes[0]?.status).toBe("cancel_requested");
    expect(snapshot?.nodes[0]?.errorJson).toEqual({
      message: "远端取消暂未完成：provider cancellation unavailable",
    });
  });

  it("replays local archiving with a deterministic asset identity", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    const firstService = new AdapterRunService(
      synchronousAdapter(),
      repository,
      storage,
    );
    const run = await firstService.createRun({
      canvasId: canvas.id,
      clientRequestId: "archive-replay",
      scope: "node",
      nodeId: "image",
    });
    const first = await waitForRun(firstService, run.id);
    const firstAssetId = first.nodes[0]?.outputAssetIds[0];
    expect(firstAssetId).toBeTruthy();

    await repository.updateRun(run.id, { status: "running" });
    await repository.updateNodeRun(first.nodes[0]!.id, {
      status: "archiving",
      outputAssetIds: [],
    });
    const recoveredService = new AdapterRunService(
      synchronousAdapter(),
      repository,
      storage,
    );
    recoveredService.resumeRun(run.id);
    const replayed = await waitForRun(recoveredService, run.id);
    expect(replayed.run.status).toBe("succeeded");
    expect(replayed.nodes[0]?.outputAssetIds).toEqual([firstAssetId]);
    expect(await repository.listAssets()).toHaveLength(1);
  });
});
