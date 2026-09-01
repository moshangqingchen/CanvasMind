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

class WriteThenFailStorage extends MemoryStorage {
  constructor(private failures = 0) {
    super();
  }

  override async put(key: string, bytes: Uint8Array, contentType: string) {
    await super.put(key, bytes, contentType);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("archive acknowledgement temporarily unavailable");
    }
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

  it("freezes the Gemini default for a We-AI banana group", async () => {
    const { repository, run } = await createQueuedRun({
      provider: "weai",
      nodeType: "image-generation",
      portKind: "image",
      connectionId: "weai-gemini-built-in",
      config: { modelGroup: "gemini香蕉" },
      clientRequestId: "weai-gemini-built-in-request",
    });
    const frozen = await repository.getRun(run.id);
    expect(graphNodeData(frozen!.revisionGraph, "generation")["model"]).toBe(
      "gemini-3.1-flash-image",
    );
  });

  it.each([
    {
      name: "migrates the obsolete Adobe per-request plain model",
      connectionId: "weai-adobe-per-request-obsolete",
      config: {
        modelGroup: "生图-openai-adobe-按次",
        defaultModel: "gpt-image-2",
      },
      expected: "gpt-image-2-low",
    },
    {
      name: "keeps a valid Adobe fixed-quality model",
      connectionId: "weai-adobe-per-request-high",
      config: {
        modelGroup: "生图-openai-adobe-按次",
        defaultModel: "gpt-image-2-high",
      },
      expected: "gpt-image-2-high",
    },
    {
      name: "does not freeze a marketplace-only CODEX model",
      connectionId: "weai-codex-marketplace-only",
      config: {
        modelGroup: "生图-openai-codex-token计费",
        defaultModel: "gpt-image-1.5",
      },
      expected: "gpt-image-2",
    },
  ])("$name", async ({ connectionId, config, expected }) => {
    const { repository, run } = await createQueuedRun({
      provider: "weai",
      nodeType: "image-generation",
      portKind: "image",
      connectionId,
      config,
      clientRequestId: `${connectionId}-request`,
    });
    const frozen = await repository.getRun(run.id);
    expect(graphNodeData(frozen!.revisionGraph, "generation")["model"]).toBe(
      expected,
    );
  });
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
          inputs: [port("prompt", "text", true), port("references", "image[]")],
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
    private readonly providerName = "runway",
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
    return new Map([[this.providerName, this.adapter]]);
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
  it("reports local request validation failures without blaming the supplier", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: graph() });
    let submitCalls = 0;
    const adapter: ProviderAdapter = {
      async testConnection() {},
      async listModels() {
        return [];
      },
      async validate() {
        return {
          valid: false,
          issues: [
            {
              code: "unsupported_operation",
              path: "operation",
              message: "GPT Image 2 does not support image.edit",
            },
          ],
        };
      },
      async submit() {
        submitCalls += 1;
        throw new Error("submit must not be called");
      },
      async extractOutputs() {
        return [];
      },
    };
    const service = new AdapterRunService(
      adapter,
      repository,
      new MemoryStorage(),
      "inline",
      "fake",
    );

    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "local-validation-error",
      scope: "node",
      nodeId: "image",
    });
    const snapshot = await waitForRun(service, run.id);
    const imageRun = snapshot.nodes.find((node) => node.nodeId === "image");

    expect(submitCalls).toBe(0);
    expect(imageRun?.status).toBe("failed");
    expect(imageRun?.errorJson).toMatchObject({
      message: "请求未提交：GPT Image 2 does not support image.edit",
      type: "请求参数错误",
      code: "unsupported_operation",
    });
  });

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
    expect(
      snapshot.nodes.every(
        (node) => node.inputJson["providerTask"] === undefined,
      ),
    ).toBe(true);
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

  it("refuses recovery after the local snapshot retention limit", async () => {
    const repository = new MemoryRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const run = await repository.createRun({
      id: "expired-recovery-run",
      canvasId: canvas.id,
      clientRequestId: "expired-recovery-request",
      scope: "all",
      status: "failed",
      revisionGraph: {
        schemaVersion: 1,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        localRecoveryExpired: true,
      },
    });
    const service = new RunService({
      repository,
      storage: new MemoryStorage(),
    });

    await expect(service.retryRun(run.id)).rejects.toThrow("恢复历史保留上限");
    await expect(repository.getRun(run.id)).resolves.toMatchObject({
      status: "failed",
    });
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

  it("quarantines a We-AI model only after three consecutive unknown-model rejections", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "weai-azure",
      name: "We-AI Azure",
      provider: "weai",
      encryptedSecret: null,
      config: {
        modelGroup: "AZURE-openai",
        defaultModel: "gpt-image-2",
        modelScanStatus: "live",
        scannedModelIds: ["gpt-image-2"],
      },
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: "image",
            type: "workflow",
            data: {
              nodeType: "image-generation",
              provider: "weai",
              connectionId: "weai-azure",
              model: "gpt-image-2",
              parts: [{ type: "text", text: "A test image" }],
              outputs: [port("image", "image")],
            },
          },
        ],
        edges: [],
      },
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
        throw new ProviderHttpError("unknown model", {
          kind: "invalid_request",
          phase: "submit",
          status: 400,
          retryable: false,
          submissionMayHaveOccurred: false,
          responseBody: {
            error: { message: "Unknown model: gpt-image-2 (request id: test)" },
          },
        });
      },
      async extractOutputs() {
        return [];
      },
    };
    const service = new AdapterRunService(
      adapter,
      repository,
      storage,
      "inline",
      "weai",
    );
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const run = await service.createRun({
        canvasId: canvas.id,
        clientRequestId: `weai-unknown-model-${attempt}`,
        scope: "all",
      });
      const snapshot = await waitForRun(service, run.id);
      expect(snapshot.run.status).toBe("failed");
      const config = (await repository.getConnection("weai-azure"))?.config;
      expect(config).toMatchObject({
        modelAvailabilityFailures: [
          {
            id: "gpt-image-2",
            reason: "unknown_model",
            consecutiveFailures: attempt,
          },
        ],
      });
      if (attempt < 3) {
        expect(config?.unavailableModels).toBeUndefined();
        expect(config?.scannedModelIds).toEqual(["gpt-image-2"]);
        expect(config?.modelScanStatus).toBe("live");
      }
    }
    expect(
      (await repository.getConnection("weai-azure"))?.config,
    ).toMatchObject({
      unavailableModels: [
        {
          id: "gpt-image-2",
          reason: "unknown_model",
          consecutiveFailures: 3,
        },
      ],
      modelScanStatus: "empty",
      scannedModelIds: [],
    });
  });

  it("restores a quarantined We-AI model after a successful generation", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "weai-azure",
      name: "We-AI Azure",
      provider: "weai",
      encryptedSecret: null,
      config: {
        modelGroup: "AZURE-openai",
        defaultModel: "gpt-image-2",
        modelScanStatus: "empty",
        scannedModelIds: [],
        modelAvailabilityFailures: [
          {
            id: "gpt-image-2",
            reason: "unknown_model",
            consecutiveFailures: 3,
          },
        ],
        unavailableModels: [
          {
            id: "gpt-image-2",
            reason: "unknown_model",
            consecutiveFailures: 3,
          },
        ],
      },
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: "image",
            type: "workflow",
            data: {
              nodeType: "image-generation",
              provider: "weai",
              connectionId: "weai-azure",
              model: "gpt-image-2",
              parts: [{ type: "text", text: "A test image" }],
              outputs: [port("image", "image")],
            },
          },
        ],
        edges: [],
      },
    });
    const service = new AdapterRunService(
      synchronousAdapter(),
      repository,
      storage,
      "inline",
      "weai",
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "weai-success-restores-model",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("succeeded");
    expect(
      (await repository.getConnection("weai-azure"))?.config,
    ).toMatchObject({
      modelScanStatus: "live",
      scannedModelIds: ["gpt-image-2"],
    });
    expect(
      (await repository.getConnection("weai-azure"))?.config
        .modelAvailabilityFailures,
    ).toBeUndefined();
    expect(
      (await repository.getConnection("weai-azure"))?.config.unavailableModels,
    ).toBeUndefined();
  });

  it("records a Cyber Afei group image permission denial", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "cyberafei-gpt56",
      name: "赛博阿飞 gpt5.6-破甲版",
      provider: "rest",
      encryptedSecret: null,
      config: {
        preset: "cyberafei-api",
        supplierKey: "cyberafei",
        modelGroup: "gpt5.6-破甲版",
        defaultModel: "gpt-image-2",
      },
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: "image",
            type: "workflow",
            data: {
              nodeType: "image-generation",
              provider: "rest",
              connectionId: "cyberafei-gpt56",
              model: "gpt-image-2",
              parts: [{ type: "text", text: "A test image" }],
              outputs: [port("image", "image")],
            },
          },
        ],
        edges: [],
      },
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
        throw new ProviderHttpError("group permission denied", {
          kind: "authentication",
          phase: "submit",
          status: 403,
          retryable: false,
          submissionMayHaveOccurred: false,
          responseBody: {
            error: {
              message: "Image generation is not enabled for this group",
            },
          },
        });
      },
      async extractOutputs() {
        return [];
      },
    };
    const service = new AdapterRunService(
      adapter,
      repository,
      storage,
      "inline",
      "rest",
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "cyberafei-group-permission",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);
    expect(snapshot.run.status).toBe("failed");
    expect(
      (await repository.getConnection("cyberafei-gpt56"))?.config,
    ).toMatchObject({
      capabilityBlocks: [
        {
          capability: "image",
          reason: "group_permission_denied",
          providerMessage: "Image generation is not enabled for this group",
          model: "gpt-image-2",
        },
      ],
    });
  });

  it("resolves Cyber Afei 4K automatic size from the prompt before submit", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "cyberafei-4k-auto",
      name: "Cyber Afei 4K auto",
      provider: "rest",
      encryptedSecret: null,
      config: {
        preset: "cyberafei-api",
        supplierKey: "cyberafei",
        modelGroup: "image-2",
        defaultModel: "gpt-image-2-4K",
      },
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: "image",
            type: "workflow",
            data: {
              nodeType: "image-generation",
              provider: "rest",
              connectionId: "cyberafei-4k-auto",
              model: "gpt-image-2-4K",
              parts: [{ type: "text", text: "生成一张 A4 竖版印刷海报" }],
              parameters: { size: "auto", quality: "high", n: 1 },
              outputs: [port("image", "image")],
            },
          },
        ],
        edges: [],
      },
    });
    let submittedParameters: Readonly<Record<string, unknown>> | undefined;
    const adapter: ProviderAdapter = {
      async testConnection() {},
      async listModels() {
        return [];
      },
      async validate() {
        return { valid: true, issues: [] };
      },
      async submit(request) {
        submittedParameters = request.parameters;
        return {
          providerTaskId: "cyberafei-4k-auto-task",
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
    const service = new AdapterRunService(
      adapter,
      repository,
      storage,
      "inline",
      "rest",
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "cyberafei-4k-auto-size",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("succeeded");
    expect(submittedParameters).toMatchObject({
      size: "2416x3424",
      quality: "high",
      n: 1,
    });
    expect(submittedParameters).not.toHaveProperty("aspect_ratio");
  });

  it("uses a multi-digit prompt ratio for Cangyuan nodes saved with size auto", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "cangyuan-4k-auto",
      name: "Cangyuan 4K auto",
      provider: "rest",
      encryptedSecret: null,
      config: {
        preset: "cangyuan-gpt-image-2",
        supplierKey: "cangyuan",
        modelGroup: "IMAGE",
        defaultModel: "gpt-image-2-4k",
      },
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: "image",
            type: "workflow",
            data: {
              nodeType: "image-generation",
              provider: "rest",
              connectionId: "cangyuan-4k-auto",
              model: "gpt-image-2-4k",
              parts: [{ type: "text", text: "宣传单尺寸比例 1175:1310" }],
              parameters: { size: "auto", quality: "high", n: 1 },
              outputs: [port("image", "image")],
            },
          },
        ],
        edges: [],
      },
    });
    let submittedParameters: Readonly<Record<string, unknown>> | undefined;
    const adapter: ProviderAdapter = {
      async testConnection() {},
      async listModels() {
        return [];
      },
      async validate() {
        return { valid: true, issues: [] };
      },
      async submit(request) {
        submittedParameters = request.parameters;
        return {
          providerTaskId: "cangyuan-4k-auto-task",
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
    const service = new AdapterRunService(
      adapter,
      repository,
      storage,
      "inline",
      "rest",
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "cangyuan-4k-auto-prompt-ratio",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("succeeded");
    expect(submittedParameters).toMatchObject({
      size: "2720x3040",
      quality: "high",
      n: 1,
    });
    expect(submittedParameters).not.toHaveProperty("aspect_ratio");
  });

  it("keeps We-AI automatic sizing inside the selected 4K tier", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "weai-4k-auto",
      name: "We-AI 4K auto",
      provider: "weai",
      encryptedSecret: null,
      config: {
        supplierKey: "weai",
        modelGroup: "生图-openai-adobe-按次",
        defaultModel: "gpt-image-2-high",
      },
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: "image",
            type: "workflow",
            data: {
              nodeType: "image-generation",
              provider: "weai",
              connectionId: "weai-4k-auto",
              model: "gpt-image-2-high",
              parts: [{ type: "text", text: "生成一张 9:16 竖版印刷海报" }],
              parameters: {
                size: "auto",
                size_tier: "4K",
                n: 1,
              },
              outputs: [port("image", "image")],
            },
          },
        ],
        edges: [],
      },
    });
    let submittedParameters: Readonly<Record<string, unknown>> | undefined;
    const adapter: ProviderAdapter = {
      async testConnection() {},
      async listModels() {
        return [];
      },
      async validate() {
        return { valid: true, issues: [] };
      },
      async submit(request) {
        submittedParameters = request.parameters;
        return {
          providerTaskId: "weai-4k-auto-task",
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
    const service = new AdapterRunService(
      adapter,
      repository,
      storage,
      "inline",
      "weai",
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "weai-4k-auto-size",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("succeeded");
    expect(submittedParameters).toMatchObject({
      size: "2160x3840",
      n: 1,
    });
    expect(submittedParameters).not.toHaveProperty("size_tier");
    expect(submittedParameters).not.toHaveProperty("aspect_ratio");
  });

  it.each([
    {
      provider: "openai",
      supplier: "frimodel",
      model: "gpt-image-2",
      prompt: "生成一张 16:9 横版海报",
      expected: "3840x2160",
      connector: undefined,
    },
    {
      provider: "openai",
      supplier: "frimodel",
      model: "gpt-image-2",
      prompt: "按照尺寸比例 1175:1310 生成宣传单",
      expected: "2720x3040",
      connector: undefined,
    },
    {
      provider: "rest",
      supplier: "mikoto",
      model: "gpt-image-2",
      prompt: "生成一张 2:3 竖版海报",
      expected: "2160x3240",
      connector: undefined,
    },
    {
      provider: "rest",
      supplier: "mikoto",
      model: "gpt-image-2",
      prompt: "按照尺寸比例 1175:1310 生成宣传单",
      expected: "2720x3040",
      connector: undefined,
    },
    {
      provider: "weai",
      supplier: "weai",
      model: "gpt-image-2-high",
      prompt: "按照尺寸比例 1175:1310 生成宣传单",
      expected: "2720x3040",
      connector: undefined,
    },
    {
      provider: "rest",
      supplier: "custom-rest",
      model: "custom-image-4k",
      prompt: "生成一张 9:16 竖版海报",
      expected: "2160x3840",
      connector: {
        models: [
          {
            id: "custom-image-4k",
            name: "Custom Image 4K",
            operations: ["image.generate"],
            parameters: [
              {
                key: "size",
                label: "输出尺寸",
                control: "dimensions",
                default: "auto",
                options: [
                  { label: "自动", value: "auto" },
                  { label: "4K · 1:1", value: "2880x2880" },
                  { label: "4K · 9:16", value: "2160x3840" },
                ],
              },
              {
                key: "n",
                label: "生成张数",
                control: "number",
                valueType: "integer",
                default: 1,
                min: 1,
                max: 1,
              },
            ],
          },
        ],
      },
    },
    {
      provider: "rest",
      supplier: "custom-rest",
      model: "custom-image-4k",
      prompt: "按照尺寸比例 1175:1310 生成宣传单",
      expected: "2720x3040",
      connector: {
        models: [
          {
            id: "custom-image-4k",
            name: "Custom Image 4K",
            operations: ["image.generate"],
            parameters: [
              {
                key: "size",
                label: "输出尺寸",
                control: "dimensions",
                default: "auto",
                min: 16,
                max: 3840,
                step: 16,
                options: [
                  { label: "自动", value: "auto" },
                  { label: "4K · 1:1", value: "2880x2880" },
                  { label: "4K · 9:16", value: "2160x3840" },
                ],
              },
              {
                key: "n",
                label: "生成张数",
                control: "number",
                valueType: "integer",
                default: 1,
                min: 1,
                max: 1,
              },
            ],
          },
        ],
      },
    },
  ])(
    "maps $supplier automatic 4K dimensions before submit",
    async ({ provider, supplier, model, prompt, expected, connector }) => {
      const repository = new MemoryRepository();
      const storage = new MemoryStorage();
      const canvas = await repository.ensureDefaultCanvas();
      const connectionId = `${supplier}-4k-tier`;
      await repository.saveConnection({
        id: connectionId,
        name: `${supplier} 4K tier`,
        provider,
        encryptedSecret: null,
        config: {
          supplierKey: supplier,
          defaultModel: model,
          ...(connector ? { connector } : {}),
        },
      });
      await repository.saveCanvas({
        id: canvas.id,
        graph: {
          schemaVersion: 1,
          nodes: [
            {
              id: "image",
              type: "workflow",
              data: {
                nodeType: "image-generation",
                provider,
                connectionId,
                model,
                parts: [{ type: "text", text: prompt }],
                parameters: {
                  size: "auto",
                  size_tier: "4K",
                  n: 1,
                },
                outputs: [port("image", "image")],
              },
            },
          ],
          edges: [],
        },
      });
      let submittedParameters: Readonly<Record<string, unknown>> | undefined;
      const adapter: ProviderAdapter = {
        async testConnection() {},
        async listModels() {
          return [];
        },
        async validate() {
          return { valid: true, issues: [] };
        },
        async submit(request) {
          submittedParameters = request.parameters;
          return {
            providerTaskId: `${supplier}-4k-tier-task`,
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
      const service = new AdapterRunService(
        adapter,
        repository,
        storage,
        "inline",
        provider,
      );
      const run = await service.createRun({
        canvasId: canvas.id,
        clientRequestId: `${supplier}-4k-tier-run`,
        scope: "all",
      });
      const snapshot = await waitForRun(service, run.id);
      expect(snapshot.run.status).toBe("succeeded");
      expect(submittedParameters).toMatchObject({ size: expected, n: 1 });
      expect(submittedParameters).not.toHaveProperty("size_tier");
      expect(submittedParameters).not.toHaveProperty("aspect_ratio");
    },
  );

  it("keeps 辰途自由传参 automatic sizing prompt-first and maps the selected K tier", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "chentu-free-auto",
      name: "辰途自由传参",
      provider: "openai",
      encryptedSecret: null,
      config: {
        supplierKey: "chentu",
        defaultModel: "gpt-image-2自由传参",
      },
    });

    const saveGraph = async (
      parameters: JsonObject,
      prompt = "生成一张 3:4 竖版海报",
    ) => {
      await repository.saveCanvas({
        id: canvas.id,
        graph: {
          schemaVersion: 1,
          nodes: [
            {
              id: "image",
              type: "workflow",
              data: {
                nodeType: "image-generation",
                provider: "openai",
                connectionId: "chentu-free-auto",
                model: "gpt-image-2自由传参",
                parts: [{ type: "text", text: prompt }],
                parameters,
                outputs: [port("image", "image")],
              },
            },
          ],
          edges: [],
        },
      });
    };

    let submittedParameters: Readonly<Record<string, unknown>> | undefined;
    const adapter: ProviderAdapter = {
      async testConnection() {},
      async listModels() {
        return [];
      },
      async validate() {
        return { valid: true, issues: [] };
      },
      async submit(request) {
        submittedParameters = request.parameters;
        return {
          providerTaskId: "chentu-free-auto-task",
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
    const service = new AdapterRunService(
      adapter,
      repository,
      storage,
      "inline",
      "openai",
    );

    await saveGraph({ size: "auto", quality: "high" });
    const autoRun = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "chentu-free-prompt-auto",
      scope: "all",
    });
    const autoSnapshot = await waitForRun(service, autoRun.id);
    expect(autoSnapshot.run.status).toBe("succeeded");
    expect(submittedParameters).toMatchObject({ quality: "high" });
    expect(submittedParameters).not.toHaveProperty("size");
    expect(submittedParameters).not.toHaveProperty("size_tier");

    await saveGraph({ size: "auto", size_tier: "4K", quality: "high" });
    const tierRun = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "chentu-free-4k-tier",
      scope: "all",
    });
    const tierSnapshot = await waitForRun(service, tierRun.id);
    expect(tierSnapshot.run.status).toBe("succeeded");
    expect(submittedParameters).toMatchObject({
      size: "2480x3312",
      quality: "high",
    });
    expect(submittedParameters).not.toHaveProperty("size_tier");
    expect(submittedParameters).not.toHaveProperty("aspect_ratio");

    await saveGraph(
      { size: "auto", size_tier: "4K", quality: "high" },
      "按照尺寸比例 1175:1310 制作宣传单",
    );
    const customRatioRun = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "chentu-free-custom-prompt-ratio",
      scope: "all",
    });
    const customRatioSnapshot = await waitForRun(service, customRatioRun.id);
    expect(customRatioSnapshot.run.status).toBe("succeeded");
    expect(submittedParameters).toMatchObject({
      size: "2720x3040",
      quality: "high",
    });
    expect(submittedParameters).not.toHaveProperty("size_tier");
    expect(submittedParameters).not.toHaveProperty("aspect_ratio");

    await saveGraph({ size: "1024x1024", quality: "4K" });
    const legacyQualityRun = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "chentu-legacy-quality-tier",
      scope: "all",
    });
    const legacyQualitySnapshot = await waitForRun(
      service,
      legacyQualityRun.id,
    );
    expect(legacyQualitySnapshot.run.status).toBe("succeeded");
    expect(submittedParameters).toMatchObject({ size: "1024x1024" });
    expect(submittedParameters).not.toHaveProperty("quality");
  });

  it("gives 辰途 image edits a signed public reference URL", async () => {
    const previousBaseUrl = process.env.PUBLIC_BASE_URL;
    const previousMasterKey = process.env.MASTER_KEY;
    process.env.PUBLIC_BASE_URL = "https://canvas.example.test";
    process.env.MASTER_KEY = "runtime-test-master-key";
    try {
      const repository = new MemoryRepository();
      const storage = new MemoryStorage();
      const canvas = await repository.ensureDefaultCanvas();
      await storage.put(
        "assets/chentu-reference/original.png",
        new Uint8Array([1, 2, 3]),
        "image/png",
      );
      await repository.saveAsset({
        id: "chentu-reference-image",
        name: "辰途参考图",
        kind: "image",
        mimeType: "image/png",
        size: 3,
        storageKey: "assets/chentu-reference/original.png",
        metadata: {},
      });
      await repository.saveConnection({
        id: "chentu-reference",
        name: "辰途参考图测试",
        provider: "openai",
        encryptedSecret: null,
        config: {
          supplierKey: "chentu",
          defaultModel: "gpt-image-2自由传参",
        },
      });
      await repository.saveCanvas({
        id: canvas.id,
        graph: {
          schemaVersion: 1,
          nodes: [
            {
              id: "asset",
              type: "workflow",
              data: {
                nodeType: "asset-input",
                assetId: "chentu-reference-image",
                assetKind: "image",
                outputs: [port("asset", "image")],
              },
            },
            {
              id: "image",
              type: "workflow",
              data: {
                nodeType: "image-generation",
                provider: "openai",
                connectionId: "chentu-reference",
                model: "gpt-image-2自由传参",
                parts: [{ type: "text", text: "保留主体并替换背景" }],
                parameters: { size: "1024x1024", quality: "high" },
                inputs: [port("references", "image[]")],
                outputs: [port("image", "image")],
              },
            },
          ],
          edges: [
            {
              id: "asset-image",
              source: "asset",
              sourceHandle: "asset",
              target: "image",
              targetHandle: "references",
            },
          ],
        },
      });
      let submittedAssetUrl: string | undefined;
      const adapter: ProviderAdapter = {
        async testConnection() {},
        async listModels() {
          return [];
        },
        async validate() {
          return { valid: true, issues: [] };
        },
        async submit(request) {
          submittedAssetUrl = request.assets[0]?.url;
          return {
            providerTaskId: "chentu-reference-task",
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
      const service = new AdapterRunService(
        adapter,
        repository,
        storage,
        "inline",
        "openai",
      );
      const run = await service.createRun({
        canvasId: canvas.id,
        clientRequestId: "chentu-reference-url",
        scope: "all",
      });
      const snapshot = await waitForRun(service, run.id);
      expect(snapshot.run.status).toBe("succeeded");
      expect(submittedAssetUrl).toMatch(
        /^https:\/\/canvas\.example\.test\/api\/provider-assets\/chentu-reference-image\?token=/u,
      );
    } finally {
      if (previousBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = previousBaseUrl;
      if (previousMasterKey === undefined) delete process.env.MASTER_KEY;
      else process.env.MASTER_KEY = previousMasterKey;
    }
  });

  it("uploads a connected image to the Cyber Afei 4K edit route and follows its ratio", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await storage.put(
      "assets/cyberafei-ratio/original.png",
      new Uint8Array([1, 2, 3]),
      "image/png",
    );
    await repository.saveAsset({
      id: "cyberafei-ratio-image",
      name: "Cyber Afei ratio guide",
      kind: "image",
      mimeType: "image/png",
      size: 3,
      storageKey: "assets/cyberafei-ratio/original.png",
      metadata: {},
    });
    await repository.saveConnection({
      id: "cyberafei-4k-reference-auto",
      name: "Cyber Afei 4K reference auto",
      provider: "rest",
      encryptedSecret: null,
      config: {
        preset: "cyberafei-api",
        supplierKey: "cyberafei",
        modelGroup: "image-2",
        defaultModel: "gpt-image-4K",
      },
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: "asset",
            type: "workflow",
            data: {
              nodeType: "asset-input",
              assetId: "cyberafei-ratio-image",
              assetKind: "image",
              mediaAspectRatio: 4 / 3,
              outputs: [port("asset", "image")],
            },
          },
          {
            id: "image",
            type: "workflow",
            data: {
              nodeType: "image-generation",
              provider: "rest",
              connectionId: "cyberafei-4k-reference-auto",
              model: "gpt-image-4K",
              parts: [{ type: "text", text: "跟随参考图比例生成海报" }],
              parameters: { size: "auto", quality: "high", n: 1 },
              inputs: [port("references", "image[]")],
              outputs: [port("image", "image")],
            },
          },
        ],
        edges: [
          {
            id: "asset-image",
            source: "asset",
            sourceHandle: "asset",
            target: "image",
            targetHandle: "references",
          },
        ],
      },
    });
    let submitted:
      | {
          operation: string;
          parameters?: Readonly<Record<string, unknown>>;
          assetCount: number;
        }
      | undefined;
    const adapter: ProviderAdapter = {
      async testConnection() {},
      async listModels() {
        return [];
      },
      async validate() {
        return { valid: true, issues: [] };
      },
      async submit(request) {
        submitted = {
          operation: request.operation,
          parameters: request.parameters,
          assetCount: request.assets.length,
        };
        return {
          providerTaskId: "cyberafei-reference-auto-task",
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
    const service = new AdapterRunService(
      adapter,
      repository,
      storage,
      "inline",
      "rest",
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "cyberafei-4k-reference-auto-size",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("succeeded");
    expect(submitted).toMatchObject({
      operation: "image.edit",
      parameters: { size: "2880x2160" },
      assetCount: 1,
    });
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

  it("repairs an interrupted recovery left in archiving state", async () => {
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
      clientRequestId: "retry-interrupted-archive",
      scope: "node",
      nodeId: "image",
    });
    const first = await waitForRun(service, run.id);
    expect(first.run.status).toBe("needs_attention");
    await repository.updateNodeRun(first.nodes[0]!.id, {
      status: "archiving",
    });

    storage.recover();
    await service.retryRun(run.id);
    const recovered = await waitForRun(service, run.id);
    expect(recovered.run.status).toBe("succeeded");
    expect(recovered.nodes[0]?.status).toBe("succeeded");
    expect(submitCalls).toBe(1);
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

  it("freezes and restores only explicitly selected nodes", async () => {
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

    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "selection-only",
      scope: "selection",
      nodeIds: ["prompt"],
    });

    expect(run).toMatchObject({
      scope: "selection",
      nodeId: null,
      nodeIds: ["prompt"],
    });
    await expect(repository.listNodeRuns(run.id)).resolves.toEqual([
      expect.objectContaining({ nodeId: "prompt", status: "queued" }),
    ]);

    const resumed = new RunService({
      repository,
      storage: new MemoryStorage(),
      executionMode: "queue",
      enqueueRun: async () => {},
    });
    await expect(
      resumed.createRun({
        canvasId: canvas.id,
        clientRequestId: "selection-only",
        scope: "all",
      }),
    ).resolves.toMatchObject({
      id: run.id,
      scope: "selection",
      nodeIds: ["prompt"],
    });
    await expect(repository.listNodeRuns(run.id)).resolves.toHaveLength(1);
  });

  it("never resubmits an approval-backed selection run without a new approval", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
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
        throw new ProviderHttpError("temporary provider failure", {
          kind: "provider",
          phase: "submit",
          status: 503,
          retryable: true,
          submissionMayHaveOccurred: false,
        });
      },
      async extractOutputs() {
        return [];
      },
    };
    const service = new AdapterRunService(adapter, repository, storage);
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "director-selection-no-paid-retry",
      scope: "selection",
      nodeIds: ["image"],
    });
    const failed = await waitForRun(service, run.id);

    expect(failed.run.status).toBe("failed");
    expect(failed.nodes[0]?.inputJson.paidRetryPolicy).toBe(
      "approval-required",
    );
    expect(submitCalls).toBe(1);
    await expect(service.retryRun(run.id)).rejects.toThrow(
      "必须重新报价并确认",
    );
    expect(submitCalls).toBe(1);
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
    const storage = new WriteThenFailStorage(3);
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    let submitCalls = 0;
    const firstService = new AdapterRunService(
      synchronousAdapter({ onSubmit: () => (submitCalls += 1) }),
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
    expect(first.run.status).toBe("needs_attention");
    expect(first.nodes[0]?.inputJson["providerTask"]).toBeDefined();
    expect(submitCalls).toBe(1);
    const firstStorageKey = [...storage.values.keys()][0];
    expect(firstStorageKey).toBeTruthy();

    storage.recover();
    const recoveredService = new AdapterRunService(
      synchronousAdapter({ onSubmit: () => (submitCalls += 1) }),
      repository,
      storage,
    );
    await recoveredService.retryRun(run.id);
    const replayed = await waitForRun(recoveredService, run.id);
    expect(replayed.run.status).toBe("succeeded");
    expect(replayed.nodes[0]?.inputJson["providerTask"]).toBeUndefined();
    expect(submitCalls).toBe(1);
    const assets = await repository.listAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0]?.storageKey).toBe(firstStorageKey);
    expect(replayed.nodes[0]?.outputAssetIds).toEqual([assets[0]?.id]);
    expect([...storage.values.keys()]).toEqual([firstStorageKey]);
  });

  it("drops stale REST image batch counts for fixed-output models", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "rest-single-image",
      name: "REST single image",
      provider: "rest",
      encryptedSecret: null,
      config: {
        connector: {
          models: [
            {
              id: "single-image",
              name: "Single image",
              operations: ["image.generate"],
              metadata: { fixedOutputCount: 1 },
              parameters: [
                {
                  key: "n",
                  label: "数量",
                  control: "number",
                  valueType: "integer",
                  min: 1,
                  max: 1,
                  default: 1,
                },
              ],
            },
          ],
        },
        defaultModel: "single-image",
      },
    });
    await repository.saveCanvas({
      id: canvas.id,
      graph: {
        schemaVersion: 1,
        nodes: [
          {
            id: "image",
            type: "workflow",
            data: {
              nodeType: "image-generation",
              provider: "rest",
              connectionId: "rest-single-image",
              model: "single-image",
              parts: [{ type: "text", text: "single output" }],
              parameters: { n: 3 },
              outputs: [port("image", "image")],
            },
          },
        ],
        edges: [],
      },
    });
    let submittedParameters: Readonly<Record<string, unknown>> | undefined;
    const adapter: ProviderAdapter = {
      async testConnection() {},
      async listModels() {
        return [];
      },
      async validate() {
        return { valid: true, issues: [] };
      },
      async submit(request) {
        submittedParameters = request.parameters;
        return {
          providerTaskId: "rest-single-image-task",
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
    const service = new AdapterRunService(
      adapter,
      repository,
      storage,
      "inline",
      "rest",
    );
    const run = await service.createRun({
      canvasId: canvas.id,
      clientRequestId: "rest-single-image-stale-count",
      scope: "all",
    });
    const snapshot = await waitForRun(service, run.id);

    expect(snapshot.run.status).toBe("succeeded");
    expect(submittedParameters).not.toHaveProperty("n");
  });
});
