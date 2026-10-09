import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileRepository, MemoryRepository, type JsonObject, type WorkflowRunRecord } from "@super-canvas/db";
import {
  ProviderHttpError,
  fetchProviderJson,
  imageSizeOptions,
  createDefaultProviderRegistry,
  StaticConnectionResolver,
  type ProviderAdapter,
  type ProviderTask,
} from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService, type RuntimeOptions } from "../src/service.js";
import * as remoteDownloads from "../src/remote-download.js";
import * as localMedia from "../src/media-duration.js";

async function testRepository() {
  const repository = new MemoryRepository();
  await repository.saveConnection({
    id: "runway-test",
    name: "Isolated adapter fixture",
    provider: "runway",
    encryptedSecret: null,
    config: {},
  });
  return repository;
}

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
    const repository = await testRepository();
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

function resumableNodeGraph(kind: "image" | "video" = "image"): JsonObject {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "image",
        type: "workflow",
        data: {
          nodeType: `${kind}-generation`,
          provider: "runway",
          connectionId: "runway-test",
          parts: [{ type: "text", text: "resumable image" }],
          outputs: [port(kind, kind)],
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
    options: Pick<RuntimeOptions, "shutdownSignal" | "retryBaseDelayMs" | "pollIntervalMs"> = {},
  ) {
    super({
      repository,
      storage,
      pollIntervalMs: 0,
      retryBaseDelayMs: 1,
      executionMode,
      ...(executionMode === "queue" ? { enqueueRun: async () => {} } : {}),
      ...options,
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
  kind: "image" | "video" = "image",
) {
  const revisionGraph = resumableNodeGraph(kind);
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
  it("passes measured source-video dimensions and duration to validation and submission instead of requested output values", async () => {
    const repository = await testRepository(), storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas(), bytes = new Uint8Array([9, 8, 7]);
    await storage.put("reference-video", bytes, "video/mp4");
    await repository.saveAsset({ id: "reference-video", name: "Reference", kind: "video", mimeType: "video/mp4", size: bytes.length, storageKey: "reference-video", metadata: { width: 4000, height: 3000, durationSeconds: 100 } });
    await repository.saveCanvas({ id: canvas.id, graph: { schemaVersion: 1, nodes: [
      { id: "source", type: "workflow", data: { nodeType: "asset-input", assetId: "reference-video", assetKind: "video", outputs: [port("asset", "video")] } },
      { id: "generation", type: "workflow", data: { nodeType: "video-generation", provider: "runway", connectionId: "runway-test", model: "gen4.5", parts: [{ type: "text", text: "Animate" }], parameters: { duration: 30 }, inputs: [port("reference", "video")], outputs: [port("video", "video")] } },
    ], edges: [{ id: "reference", source: "source", sourceHandle: "asset", target: "generation", targetHandle: "reference" }] } });
    const probe = vi.spyOn(localMedia, "readLocalMediaMetadata").mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 8.5 });
    const adapter = synchronousAdapter(), validate = vi.spyOn(adapter, "validate"), submit = vi.spyOn(adapter, "submit");
    try {
      const service = new AdapterRunService(adapter, repository, storage);
      const run = await service.createRun({ canvasId: canvas.id, scope: "all", clientRequestId: "measured-video-metadata" });
      expect((await waitForRun(service, run.id)).run.status).toBe("succeeded");
      expect(probe).toHaveBeenCalledTimes(1);
      expect(probe).toHaveBeenCalledWith(bytes);
      for (const fn of [validate, submit]) expect(fn.mock.calls[0]?.[0]).toMatchObject({ parameters: { duration: 30 }, assets: [{ id: "reference-video", width: 1920, height: 1080, durationSeconds: 8.5 }] });
    } finally { probe.mockRestore(); }
  });
  it.each(["running", "succeeded"] as const)("recovers an existing %s image task without its lost reference/mask bytes or upload channel", async status => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const revisionGraph = resumableNodeGraph();
    Object.assign(graphNodeData(revisionGraph, "image"), {
      parts: [{ type: "text", text: "original edit" }, { type: "asset", assetId: "lost-reference", role: "reference" }],
      parameters: { maskAssetId: "lost-mask", maskSourceAssetId: "lost-reference" },
    });
    const run = await repository.createRun({ id: "recover-edit", canvasId: canvas.id, clientRequestId: "recover-edit", scope: "node", nodeId: "image", status: "running", revisionGraph });
    const inputJson: JsonObject = { provider: "runway", connectionId: "runway-test", operation: "image.edit", prompt: "original edit", parameters: { quality: "high" },
      assetIds: ["lost-reference", "lost-mask"], inputAssets: [{ id: "lost-reference", role: "reference" }, { id: "lost-mask", role: "mask" }],
      imageMask: { maskAssetId: "lost-mask", maskSourceAssetId: "lost-reference", width: 2, height: 2 },
      providerTask: { providerTaskId: "original-remote", status, result: { completed: status === "succeeded" } } };
    await repository.createNodeRun({ id: "recover-edit-node", workflowRunId: run.id, nodeId: "image", status: status === "succeeded" ? "archiving" : "running",
      attempt: 1, providerTaskId: "original-remote", inputJson, outputAssetIds: [], errorJson: null });
    const provider = pollingAdapter([]);
    const validate = vi.spyOn(provider.adapter, "validate");
    const storage = new MemoryStorage();
    const service = new AdapterRunService(provider.adapter, repository, storage);
    await service.resumeRun(run.id);
    const result = await waitForRun(service, run.id);
    expect(result.run.status).toBe("succeeded");
    expect(provider.calls()).toEqual({ submit: 0, poll: status === "running" ? 1 : 0 });
    expect(validate).not.toHaveBeenCalled();
    expect(result.nodes[0]?.inputJson).toMatchObject({ operation: "image.edit", parameters: inputJson.parameters, assetIds: inputJson.assetIds,
      inputAssets: inputJson.inputAssets, imageMask: inputJson.imageMask });
    expect(result.nodes[0]?.outputAssetIds).toHaveLength(1);
  });

  it.each(["cancel", "shutdown"] as const)("does not submit again after %s during safe-submit backoff", async action => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    let firstAttempt!: () => void;
    const started = new Promise<void>(resolve => { firstAttempt = resolve; });
    const controller = new AbortController();
    let submits = 0;
    const adapter = synchronousAdapter();
    adapter.submit = async () => {
      submits++;
      if (submits === 1) { firstAttempt(); throw new ProviderHttpError("connection not established", { kind: "network", phase: "submit", retryable: true, submissionMayHaveOccurred: false }); }
      return { providerTaskId: "must-not-submit", status: "succeeded", result: {} };
    };
    const service = new AdapterRunService(adapter, repository, new MemoryStorage(), "inline", "runway", { shutdownSignal: controller.signal, retryBaseDelayMs: 120 });
    const run = await service.createRun({ canvasId: canvas.id, scope: "node", nodeId: "image", clientRequestId: `abort-retry-${action}` });
    await started;
    if (action === "cancel") await service.cancelRun(run.id); else controller.abort();
    await new Promise(resolve => setTimeout(resolve, 260));
    expect(submits).toBe(1);
  });

  it("leaves all nodes untouched when recovery is rejected for an uncertain task without an ID", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const run = await repository.createRun({ id: "mixed-recovery", canvasId: canvas.id, clientRequestId: "mixed-recovery", scope: "all", status: "needs_attention", revisionGraph: resumableNodeGraph() });
    const nodes = [];
    for (const [id, providerTaskId] of [["recoverable", "known-task"], ["uncertain", null]] as const) {
      nodes.push(await repository.createNodeRun({ id, workflowRunId: run.id, nodeId: id, status: "needs_attention", attempt: 1, providerTaskId,
        inputJson: { provider: "runway" }, outputAssetIds: [], errorJson: { message: "original diagnostic" } }));
    }
    const provider = pollingAdapter([]);
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await expect(service.retryRun(run.id)).rejects.toThrow("供应商任务 ID");
    expect(await repository.listNodeRuns(run.id)).toEqual(nodes);
    expect(await repository.getRun(run.id)).toEqual(run);
    expect(provider.calls()).toEqual({ submit: 0, poll: 0 });
  });
  it.each([
    { terminal: {}, expected: { status: "charged", amount: 0.25, currency: "USD" } },
    { terminal: { charge: { status: "not_charged" } }, expected: { status: "charged", amount: 0.25, currency: "USD" } },
    { terminal: { charge: { status: "charged", amount: 0.25 } }, expected: { status: "charged", amount: 0.25, currency: "USD" } },
    { terminal: { charge: { status: "charged", amount: 0.5 } }, expected: { status: "charged", amount: 0.25, currency: "USD" } },
    { terminal: { charge: { status: "charged", amount: 0.25, currency: "CNY" } }, expected: { status: "charged", amount: 0.25, currency: "USD" } },
    { terminal: { refund: { status: "refunded", amount: 0.25, currency: "USD" } }, expected: { status: "refunded", amount: 0.25, currency: "USD" } },
  ])("persists task billing evidence across polling and a file repository reload: $expected.status", async ({ terminal, expected }) => {
    const root = await mkdtemp(join(tmpdir(), "super-canvas-failure-evidence-"));
    try {
      const database = join(root, "state.json");
      const repository = new FileRepository(database);
      await repository.saveConnection({ id: "runway-test", name: "Isolated billing fixture", provider: "runway", encryptedSecret: null, config: {} });
      const canvas = await repository.ensureDefaultCanvas();
      await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
      const submit = vi.fn(async (): Promise<ProviderTask> => ({
        providerTaskId: "billed-task", status: "running",
        result: { remote: { charge: { status: "charged", amount: 0.25, currency: "USD" } } },
      }));
      const poll = vi.fn(async (): Promise<ProviderTask> => ({
        providerTaskId: "billed-task", status: "failed", error: "no available accounts",
        result: { remote: terminal },
      }));
      const adapter: ProviderAdapter = {
        async testConnection() {}, async listModels() { return []; },
        async validate() { return { valid: true, issues: [] }; },
        submit, poll, async extractOutputs() { return []; },
      };
      const service = new AdapterRunService(adapter, repository, new MemoryStorage());
      const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "billing-evidence", scope: "node", nodeId: "image" });
      const snapshot = await waitForRun(service, run.id);
      expect(snapshot.nodes[0]?.errorJson).toMatchObject({
        failureCategory: "supplier_capacity", charge: { ...expected, source: "provider_response" },
      });
      const restored = new FileRepository(database);
      expect((await restored.listNodeRuns(run.id))[0]?.errorJson).toEqual(snapshot.nodes[0]?.errorJson);
      expect(submit).toHaveBeenCalledOnce();
      expect(poll).toHaveBeenCalledOnce();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("retains a billing receipt from a running poll when a later status query fails", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const provider = pollingAdapter([]);
    let polls = 0;
    provider.adapter.poll = async (task) => {
      if (++polls === 1) return { ...task, status: "running", result: { remote: { charged_amount: 2, currency: "CNY" } } };
      throw new ProviderHttpError("expired credential", { kind: "authentication", phase: "poll", status: 401, retryable: false, submissionMayHaveOccurred: false });
    };
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await service.resumeRun("resumable-run");
    const snapshot = await waitForRun(service, "resumable-run");
    expect(snapshot.nodes[0]?.errorJson).toMatchObject({
      failureCategory: "authentication", charge: { status: "charged", amount: 2, currency: "CNY", source: "provider_response" },
    });
    expect(provider.calls().submit).toBe(0);
    expect(polls).toBe(2);
  });

  it.each([
    { receipt: {}, responseBody: { charged: false }, expected: { status: "unknown", source: "unconfirmed" } },
    { receipt: { charge: { status: "charged", amount: 0.25, currency: "USD" } }, responseBody: { refund: { status: "refunded", amount: 0.25, currency: "USD" } }, expected: { status: "charged", amount: 0.25, currency: "USD", source: "provider_response" } },
  ])("does not apply a failed status query's own billing to the generation task: $expected.status", async ({ receipt, responseBody, expected }) => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    await repository.updateNodeRun("resumable-node-run", { inputJson: {
      providerTask: { providerTaskId: "remote-task-1", status: "running", result: { remote: receipt } },
    } });
    const provider = pollingAdapter([new ProviderHttpError("status query denied", {
      kind: "authentication", phase: "poll", status: 401, retryable: false, submissionMayHaveOccurred: false, responseBody,
    })]);
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await service.resumeRun("resumable-run");
    const snapshot = await waitForRun(service, "resumable-run");
    expect(snapshot.nodes[0]?.errorJson?.charge).toEqual(expected);
    expect(provider.calls()).toEqual({ submit: 0, poll: 1 });
  });

  it.each(["poll", "restore"] as const)("rejects a different provider task during %s without importing its refund", async phase => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const originalCharge = { status: "charged", amount: 0.25, currency: "USD", source: "provider_response" };
    const wrongTask = { providerTaskId: "another-paid-task", status: "failed" as const, error: "unrelated failure", result: { remote: { refund: { status: "refunded", amount: 5, currency: "CNY" } } } };
    await repository.updateNodeRun("resumable-node-run", { inputJson: {
      providerCharge: originalCharge,
      providerTask: phase === "restore" ? wrongTask : { providerTaskId: "remote-task-1", status: "running", result: { remote: {} } },
    } });
    const provider = pollingAdapter([]);
    const poll = vi.fn(async () => wrongTask);
    provider.adapter.poll = poll;
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await service.resumeRun("resumable-run");
    const snapshot = await waitForRun(service, "resumable-run");
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.providerTaskId).toBe("remote-task-1");
    expect(snapshot.nodes[0]?.errorJson).toMatchObject({ code: "provider_task_mismatch" });
    expect(snapshot.nodes[0]?.errorJson?.charge).not.toMatchObject({ status: "refunded" });
    if (phase === "poll") expect(snapshot.nodes[0]?.errorJson?.charge).toEqual(originalCharge);
    expect(poll).toHaveBeenCalledTimes(phase === "poll" ? 1 : 0);
    expect(provider.calls().submit).toBe(0);
  });

  it.each(["charged", "refunded"] as const)("preserves %s evidence when the provider cancels the task", async status => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: retryBlockedGraph() });
    const provider = pollingAdapter([]);
    provider.adapter.poll = vi.fn(async task => ({ ...task, status: "cancelled", result: {
      remote: { charge: { status, amount: 0.25, currency: "USD" } },
    } }));
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "provider-cancelled", scope: "all" });
    const snapshot = await waitForRun(service, run.id);
    expect(snapshot.run.status).toBe("cancelled");
    expect(Object.fromEntries(snapshot.nodes.map(node => [node.nodeId, node.status]))).toEqual({ prompt: "succeeded", image: "cancelled", preview: "blocked" });
    expect(snapshot.nodes.find(node => node.nodeId === "image")?.errorJson).toMatchObject({
      message: "供应商已取消任务", charge: { status, amount: 0.25, currency: "USD", source: "provider_response" },
    });
    expect(provider.calls().submit).toBe(1);
  });

  it("preserves a generation receipt during cancellation reconciliation", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const task = await seedCancelledProviderRun(repository, canvas.id);
    const charge = { status: "charged", amount: 0.25, currency: "USD", source: "provider_response" };
    await repository.updateNodeRun("cancelled-provider-node-run", { inputJson: {
      provider: "runway", connectionId: "runway-test", providerCharge: charge,
      providerTask: { ...task, result: { ...task.result, remote: { charge } } },
    } });
    const provider = cancellationAdapter();
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await service.reconcileCancellation("cancelled-provider-run");
    const snapshot = await service.getRun("cancelled-provider-run");
    expect(snapshot?.nodes[0]?.status).toBe("cancelled");
    expect(snapshot?.nodes[0]?.errorJson?.charge).toEqual(charge);
    expect(provider.calls().cancel).toBe(1);
  });

  it.each(["image", "video"] as const)("preserves a late %s poll receipt after local cancellation without archiving", async kind => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id, kind);
    const provider = pollingAdapter([]);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const charge = { status: "charged", amount: 4, currency: "USD", source: "provider_response" };
    provider.adapter.poll = vi.fn(async task => {
      started();
      await gate;
      return { ...task, status: "succeeded", result: { remote: { charge } } };
    });
    provider.adapter.cancel = vi.fn(async () => {});
    provider.adapter.extractOutputs = vi.fn(async () => []);
    const storage = new MemoryStorage();
    const service = new AdapterRunService(provider.adapter, repository, storage);
    await service.resumeRun("resumable-run");
    await entered;
    await service.cancelRun("resumable-run");
    // Image cancellation must finish without waiting for the outstanding query.
    if (kind === "image") await vi.waitFor(async () => {
      expect((await repository.getNodeRun("resumable-node-run"))?.status).toBe("cancelled");
    });
    release();
    await vi.waitFor(async () => {
      const node = await repository.getNodeRun("resumable-node-run");
      expect(node?.status).toBe("cancelled");
      expect(node?.inputJson.providerCharge).toEqual(charge);
      expect(node?.inputJson.providerTask).toMatchObject({ providerTaskId: "remote-task-1", status: "succeeded" });
      expect(node?.errorJson?.charge).toEqual(charge);
    });
    expect((await service.getRun("resumable-run"))?.run.status).toBe("cancelled");
    expect(provider.calls().submit).toBe(0);
    expect(provider.adapter.poll).toHaveBeenCalledOnce();
    expect(provider.adapter.extractOutputs).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it("keeps a late refund when cancellation reconciliation finishes from an older task snapshot", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id, "video");
    const originalCharge = { status: "charged", amount: 4, currency: "USD", source: "provider_response" };
    const refund = { ...originalCharge, status: "refunded" };
    await repository.updateNodeRun("resumable-node-run", { inputJson: {
      provider: "runway", connectionId: "runway-test", providerCharge: originalCharge,
    } });
    const provider = pollingAdapter([]);
    let releasePoll!: () => void;
    let pollStarted!: () => void;
    let releaseCancel!: () => void;
    let cancelStarted!: () => void;
    const pollGate = new Promise<void>(resolve => { releasePoll = resolve; });
    const enteredPoll = new Promise<void>(resolve => { pollStarted = resolve; });
    const cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; });
    const enteredCancel = new Promise<void>(resolve => { cancelStarted = resolve; });
    provider.adapter.poll = async task => {
      pollStarted();
      await pollGate;
      return { ...task, status: "cancelled", result: { remote: { charge: refund } } };
    };
    provider.adapter.cancel = vi.fn(async () => {
      cancelStarted();
      await cancelGate;
    });
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await service.resumeRun("resumable-run");
    await enteredPoll;
    await service.cancelRun("resumable-run");
    const reconciliation = service.reconcileCancellation("resumable-run");
    await enteredCancel;
    await repository.updateNodeRun("resumable-node-run", { errorJson: { code: "retained_cancel_detail", message: "原取消详情" } });
    releasePoll();
    try {
      await vi.waitFor(async () => expect((await repository.getNodeRun("resumable-node-run"))?.inputJson.providerCharge).toEqual(refund));
    } finally { releaseCancel(); }
    await reconciliation;
    await vi.waitFor(async () => {
      const node = await repository.getNodeRun("resumable-node-run");
      expect(node?.status).toBe("cancelled");
      expect(node?.inputJson.providerCharge).toEqual(refund);
      expect(node?.inputJson.providerTask).toMatchObject({ status: "cancelled" });
      expect(node?.errorJson).toMatchObject({ code: "retained_cancel_detail", charge: refund });
    });
    expect(provider.calls().submit).toBe(0);
  });

  it("clears the previous remote cancellation error after reconciliation succeeds while keeping its receipt", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const task = await seedCancelledProviderRun(repository, canvas.id);
    const charge = { status: "charged", amount: 4, currency: "USD", source: "provider_response" };
    await repository.updateNodeRun("cancelled-provider-node-run", { inputJson: {
      provider: "runway", connectionId: "runway-test", providerCharge: charge, providerTask: task,
    } });
    const provider = cancellationAdapter();
    provider.adapter.cancel = vi.fn()
      .mockRejectedValueOnce(new Error("provider cancellation unavailable"))
      .mockResolvedValueOnce(undefined);
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await service.reconcileCancellation("cancelled-provider-run");
    expect((await repository.getNodeRun("cancelled-provider-node-run"))?.errorJson?.message).toContain("远端取消暂未完成");
    await service.reconcileCancellation("cancelled-provider-run");
    const node = await repository.getNodeRun("cancelled-provider-node-run");
    expect(node?.status).toBe("cancelled");
    expect(node?.errorJson).toEqual({ message: "运行已取消", charge });
    expect(provider.adapter.cancel).toHaveBeenCalledTimes(2);
  });

  it("replaces an old cancellation error with the confirmed CLI tracking message", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const task = await seedCancelledProviderRun(repository, canvas.id);
    await repository.updateNodeRun("cancelled-provider-node-run", {
      inputJson: { provider: "cli", connectionId: "runway-test",
        providerTask: { ...task, result: { ...task.result, cli: { supportsCancel: false } } } },
      errorJson: { message: "remote cancellation old failure" },
    });
    const provider = cancellationAdapter();
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage(), "inline", "cli");
    await service.reconcileCancellation("cancelled-provider-run");
    const node = await repository.getNodeRun("cancelled-provider-node-run");
    expect(node?.status).toBe("cancelled");
    expect(node?.errorJson).toEqual({ code: "cli_tracking_stopped", message: "已停止跟踪；该网站不支持远端取消，生成可能仍在继续" });
    expect(provider.calls().cancel).toBe(1);
  });

  it.each(["shutdown", "shutdown-then-cancel", "different-task", "newer-receipt"] as const)("guards late image polling after %s", async scenario => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const provider = pollingAdapter([]);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    provider.adapter.poll = async task => {
      started();
      await gate;
      return { ...task, providerTaskId: scenario === "different-task" ? "unrelated-task" : task.providerTaskId,
        status: "cancelled", result: { remote: { charge: { status: "charged", amount: 4, currency: "USD" } } } };
    };
    provider.adapter.cancel = vi.fn(async () => {});
    provider.adapter.extractOutputs = vi.fn(async () => []);
    const shutdown = new AbortController();
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage(), "inline", "runway", { shutdownSignal: shutdown.signal });
    await service.resumeRun("resumable-run");
    await entered;
    if (scenario === "shutdown" || scenario === "shutdown-then-cancel") {
      shutdown.abort();
      if (scenario === "shutdown-then-cancel") {
        await new Promise(resolve => setImmediate(resolve));
        const replacement = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
        await replacement.cancelRun("resumable-run");
        await replacement.reconcileCancellation("resumable-run");
      }
    }
    else {
      await service.cancelRun("resumable-run");
      await vi.waitFor(async () => expect((await repository.getNodeRun("resumable-node-run"))?.status).toBe("cancelled"));
    }
    if (scenario === "newer-receipt") {
      const current = (await repository.getNodeRun("resumable-node-run"))!;
      const refund = { status: "refunded", amount: 4, currency: "USD", source: "provider_response" };
      await repository.updateNodeRun(current.id, {
        inputJson: { ...current.inputJson, providerCharge: refund,
          providerTask: { providerTaskId: "remote-task-1", status: "succeeded", result: { remote: { charge: refund } } } },
        errorJson: { message: "已停止跟踪；退款已确认", code: "newer_cancellation_detail", charge: refund },
      });
    }
    await new Promise(resolve => setImmediate(resolve));
    const before = (await repository.getNodeRun("resumable-node-run"))!;
    release();
    // Drain the resolved query and its receipt callback without waiting on a poll timer.
    await new Promise(resolve => setImmediate(resolve));
    const after = (await repository.getNodeRun("resumable-node-run"))!;
    expect(after.status).toBe(before.status);
    expect(after.inputJson).toEqual(before.inputJson);
    expect(after.errorJson).toEqual(before.errorJson);
    expect(provider.calls().submit).toBe(0);
    expect(provider.adapter.extractOutputs).not.toHaveBeenCalled();
  });

  it("keeps an accepted task's charge when local archival fails and retries only archival", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    const adapter = synchronousAdapter();
    const originalSubmit = adapter.submit.bind(adapter);
    adapter.submit = vi.fn(async (request) => ({ ...await originalSubmit(request), result: { charge: { status: "charged", amount: 3, currency: "CNY" } } }));
    const storage = new RecoverableStorage(3);
    const service = new AdapterRunService(adapter, repository, storage);
    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "archive-billing", scope: "node", nodeId: "image" });
    const snapshot = await waitForRun(service, run.id);
    expect(snapshot.nodes[0]?.errorJson).toMatchObject({
      failureCategory: "local_storage", charge: { status: "charged", amount: 3, currency: "CNY", source: "provider_response" },
    });
    storage.recover();
    await service.retryRun(run.id);
    const recovered = await waitForRun(service, run.id);
    expect(recovered.run.status).toBe("succeeded");
    expect(recovered.nodes[0]?.inputJson.providerCharge).toEqual(snapshot.nodes[0]?.errorJson?.charge);
    expect(recovered.nodes[0]?.inputJson.providerTask).toBeUndefined();
    expect(adapter.submit).toHaveBeenCalledOnce();
  });

  it("keeps concurrent runs of one generation node independent when the newer run finishes first", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    const graphFor = (prompt: string, size: string): JsonObject => ({
      schemaVersion: 1,
      nodes: [{ id: "image", type: "workflow", data: {
        nodeType: "image-generation", provider: "runway", connectionId: "runway-test",
        model: "test-image", parts: [{ type: "text", text: prompt }],
        parameters: { size }, outputs: [port("image", "image")],
      } }],
      edges: [],
    });
    let releaseFirst = () => {};
    const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const submitted: Array<{ prompt: string | undefined; size: unknown; key: string }> = [];
    const adapter: ProviderAdapter = {
      async testConnection() {},
      async listModels() { return []; },
      async validate() { return { valid: true, issues: [] }; },
      async submit(request) {
        submitted.push({ prompt: request.prompt, size: request.parameters?.size, key: request.idempotencyKey });
        if (request.prompt === "first image") await gate;
        return { providerTaskId: request.idempotencyKey, status: "succeeded", result: { completed: true } };
      },
      async extractOutputs() {
        return [{ kind: "image", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }];
      },
    };
    const service = new AdapterRunService(adapter, repository, new MemoryStorage());
    await repository.saveCanvas({ id: canvas.id, graph: graphFor("first image", "1024x1024") });
    const first = await service.createRun({ canvasId: canvas.id, clientRequestId: "parallel-first", scope: "node", nodeId: "image" });
    try {
      await expect.poll(() => submitted.length).toBe(1);
      await repository.saveCanvas({ id: canvas.id, graph: graphFor("second image", "1536x1024") });
      const second = await service.createRun({ canvasId: canvas.id, clientRequestId: "parallel-second", scope: "node", nodeId: "image" });
      const secondResult = await waitForRun(service, second.id);
      expect(secondResult.run.status).toBe("succeeded");
      expect((await service.getRun(first.id))?.run.status).toBe("running");
      expect(submitted.map(({ prompt, size }) => ({ prompt, size }))).toEqual([
        { prompt: "first image", size: "1024x1024" },
        { prompt: "second image", size: "1536x1024" },
      ]);
      expect(new Set(submitted.map(item => item.key)).size).toBe(2);
      releaseFirst();
      const firstResult = await waitForRun(service, first.id);
      expect(firstResult.run.status).toBe("succeeded");
      expect(firstResult.nodes[0]?.outputAssetIds).toHaveLength(1);
      expect(secondResult.nodes[0]?.outputAssetIds).toHaveLength(1);
      expect(firstResult.nodes[0]?.outputAssetIds).not.toEqual(secondResult.nodes[0]?.outputAssetIds);
    } finally {
      releaseFirst();
    }
  });

  it("reports local request validation failures without blaming the supplier", async () => {
    const repository = await testRepository();
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
      failureCategory: "invalid_request",
      charge: { status: "not_charged", source: "not_submitted" },
    });
  });

  it("executes and archives a complete image-to-video graph", async () => {
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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

  it("keeps querying an image task past 240 running responses without resubmitting", async () => {
    const repository = await testRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const provider = pollingAdapter([]);
    const finish = provider.adapter.poll!;
    let polls = 0;
    provider.adapter.poll = async task => ++polls <= 245 ? { ...task, status: "running" } : finish(task);
    const service = new AdapterRunService(provider.adapter, repository, storage);

    await service.resumeRun("resumable-run");
    const snapshot = await waitForRun(service, "resumable-run");

    expect(snapshot.run.status).toBe("succeeded");
    expect(polls).toBe(246);
    expect(provider.calls().submit).toBe(0);
    expect(snapshot.nodes[0]?.providerTaskId).toBe("remote-task-1");
  });

  it("keeps an image task running through more than three transient poll failures", async () => {
    const repository = await testRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const failures = Array.from({ length: 5 }, () => new ProviderHttpError("temporarily unavailable", {
      kind: "provider", phase: "poll", status: 503, retryable: true, submissionMayHaveOccurred: false,
    }));
    const provider = pollingAdapter(failures);
    const service = new AdapterRunService(provider.adapter, repository, storage);
    const statuses: unknown[] = [];
    const unsubscribe = service.subscribe(event => { if (event.type === "node") statuses.push(event.payload.status); });

    await service.resumeRun("resumable-run");
    const snapshot = await waitForRun(service, "resumable-run");
    unsubscribe();

    expect(snapshot.run.status).toBe("succeeded");
    expect(provider.calls()).toEqual({ submit: 0, poll: 6 });
    expect(statuses).not.toContain("needs_attention");
  });

  it("stops persistent image polling promptly when the user cancels during backoff", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const provider = pollingAdapter([]);
    let started!: () => void;
    const polling = new Promise<void>(resolve => { started = resolve; });
    const cancel = vi.fn(async () => {});
    provider.adapter.cancel = cancel;
    provider.adapter.poll = vi.fn(async () => {
      started();
      throw new ProviderHttpError("offline", { kind: "network", phase: "poll", retryable: true, submissionMayHaveOccurred: false });
    });
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage(), "inline", "runway", { retryBaseDelayMs: 60_000 });

    await service.resumeRun("resumable-run");
    await polling;
    await service.cancelRun("resumable-run");
    await expect.poll(async () => (await service.getRun("resumable-run"))?.nodes[0]?.status, { timeout: 2_000 }).toBe("cancelled");

    expect(provider.adapter.poll).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(provider.calls().submit).toBe(0);
  });

  it("propagates user cancellation into a waiting local image submission", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    let requestSignal: AbortSignal | null | undefined;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal;
      started();
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
      });
    });
    const adapter = synchronousAdapter();
    adapter.submit = () => fetchProviderJson(fetch, "https://supplier.example.test/v1/images/generations", {
      method: "POST", body: "{}",
    }, { phase: "submit", timeoutMs: 0 });
    const service = new AdapterRunService(adapter, repository, new MemoryStorage());

    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "cancel-open-submit", scope: "node", nodeId: "image" });
    await waiting;
    await service.cancelRun(run.id);
    await expect.poll(async () => (await service.getRun(run.id))?.nodes[0]?.status, { timeout: 2_000 }).toBe("cancelled");

    expect(requestSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect((await service.getRun(run.id))?.run.status).toBe("cancelled");
  });

  it("preserves the task checkpoint on shutdown and resumes querying after restart", async () => {
    const repository = await testRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const provider = pollingAdapter([]);
    let started!: () => void;
    const polling = new Promise<void>(resolve => { started = resolve; });
    const cancel = vi.fn(async () => {});
    provider.adapter.cancel = cancel;
    provider.adapter.poll = vi.fn(async () => {
      started();
      throw new ProviderHttpError("offline", { kind: "network", phase: "poll", retryable: true, submissionMayHaveOccurred: false });
    });
    const shutdown = new AbortController();
    const first = new AdapterRunService(provider.adapter, repository, storage, "inline", "runway", { shutdownSignal: shutdown.signal, retryBaseDelayMs: 60_000 });

    await first.resumeRun("resumable-run");
    await polling;
    shutdown.abort();
    expect((await first.getRun("resumable-run"))?.nodes[0]).toMatchObject({ status: "running", providerTaskId: "remote-task-1", errorJson: null });

    const resumedProvider = pollingAdapter([]);
    const resumed = new AdapterRunService(resumedProvider.adapter, repository, storage);
    await expect.poll(async () => {
      await resumed.resumeRun("resumable-run");
      return (await resumed.getRun("resumable-run"))?.run.status;
    }, { timeout: 2_000 }).toBe("succeeded");
    expect(cancel).not.toHaveBeenCalled();
    expect(resumedProvider.calls()).toEqual({ submit: 0, poll: 1 });
  });

  it("pauses an image task on a non-retryable authentication failure", async () => {
    const repository = await testRepository();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id);
    const provider = pollingAdapter([new ProviderHttpError("expired credential", {
      kind: "authentication", phase: "poll", status: 401, retryable: false, submissionMayHaveOccurred: false,
    })]);
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await service.resumeRun("resumable-run");
    const snapshot = await waitForRun(service, "resumable-run");
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.providerTaskId).toBe("remote-task-1");
    expect(provider.calls()).toEqual({ submit: 0, poll: 1 });
    expect(snapshot.nodes[0]?.errorJson?.charge).toEqual({ status: "unknown", source: "unconfirmed" });
  });

  it("quarantines a We-AI model only after three consecutive unknown-model rejections", async () => {
    const repository = await testRepository();
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

  it("restores a quarantined We-AI model after revalidation and a successful generation", async () => {
    const repository = await testRepository();
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
    const repository = await testRepository();
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

  it.each([
    { prompt: "生成一张 A4 竖版印刷海报", tier: undefined, expected: "2416x3424" },
    { prompt: "生成一张 9:16 海报", tier: "2K", expected: "1152x2048" },
    { prompt: "生成一张 9:16 海报", tier: "4K", expected: "2160x3840" },
  ])("resolves Cyber Afei automatic size using tier $tier and prompt $prompt", async ({ prompt, tier, expected }) => {
    const repository = await testRepository();
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
        modelCatalogModels: [{ id: "gpt-image-2-4K", parameters: [{ key: "size", control: "dimensions", options: [
          { label: "2K 9:16", value: "1152x2048" }, { label: "4K 9:16", value: "2160x3840" },
        ] }] }],
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
              parts: [{ type: "text", text: prompt }],
              parameters: { size: "auto", quality: "high", n: 1, ...(tier ? { size_tier: tier } : {}) },
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
      size: expected,
      quality: "high",
      n: 1,
    });
    expect(submittedParameters).not.toHaveProperty("aspect_ratio");
  });

  it("uses a multi-digit prompt ratio for Cangyuan nodes saved with size auto", async () => {
    const repository = await testRepository();
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
    const repository = await testRepository();
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
      supplier: "secure-skill",
      model: "gpt-image-2",
      prompt: "生成一张 9:16 竖版海报",
      expected: "2160x3840",
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
      const repository = await testRepository();
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

  it.each([
    {
      supplier: "frimodel",
      provider: "openai",
      prompt: "生成 16:9 海报",
      tier: "4K",
      size: "auto",
      expected: "3840x2160",
    },
    {
      supplier: "custom-verified-images",
      provider: "openai",
      prompt: "生成 16:9 海报",
      tier: "4K",
      size: "auto",
      expected: "",
      twoKOnly: true,
    },
    {
      supplier: "custom-verified-images",
      provider: "openai",
      prompt: "生成 16:9 海报",
      tier: "4K",
      size: "2048x2048",
      expected: "2048x2048",
      twoKOnly: true,
    },
    {
      supplier: "custom-verified-images",
      provider: "openai",
      prompt: "生成 9:16 海报",
      tier: "4K",
      size: "auto",
      expected: "2160x3840",
    },
    {
      supplier: "custom-verified-images",
      provider: "openai",
      prompt: "生成 16:9 海报",
      tier: "2K",
      size: "auto",
      expected: "2720x1536",
    },
    {
      supplier: "custom-verified-images",
      provider: "openai",
      prompt: "生成 9:16 海报",
      tier: "4K",
      size: "2048x2048",
      expected: "2048x2048",
    },
    {
      supplier: "cangyuan",
      provider: "rest",
      prompt: "生成 1:1 海报",
      tier: "4K",
      size: "auto",
      expected: "2880x2880",
      modelId: "gpt-image-2-4k",
    },
    {
      supplier: "mikoto",
      provider: "rest",
      prompt: "生成 9:16 海报",
      tier: "4K",
      size: "auto",
      expected: "2160x3840",
    },
    {
      supplier: "frimodel",
      provider: "openai",
      prompt: "跟随参考图生成海报",
      tier: "2K",
      size: "auto",
      expected: "2352x1776",
    },
    {
      supplier: "frimodel",
      provider: "openai",
      prompt: "生成 9:16 海报",
      tier: "4K",
      size: "3840x2160",
      expected: "3840x2160",
    },
    {
      supplier: "frimodel",
      provider: "openai",
      prompt: "生成 16:9 海报",
      tier: undefined,
      size: "auto",
      expected: "1360x768",
    },
    {
      supplier: "cyberafei",
      provider: "rest",
      prompt: "生成 16:9 海报",
      tier: "2K",
      size: "auto",
      expected: "2048x1152",
    },
    {
      supplier: "cangyuan",
      provider: "rest",
      prompt: "生成 9:16 海报",
      tier: undefined,
      size: "auto",
      expected: "2160x3840",
    },
    {
      supplier: "chentu",
      provider: "openai",
      prompt: "生成 16:9 海报",
      tier: "4K",
      size: "auto",
      expected: "3840x2160",
    },
  ])(
    "resolves verified 2.5 $supplier $tier $size with prompt priority over references",
    async ({ supplier, provider, prompt, tier, size, expected, modelId, twoKOnly }) => {
      const repository = await testRepository();
      const storage = new MemoryStorage();
      const canvas = await repository.ensureDefaultCanvas();
      const model = modelId ?? (
        supplier === "frimodel"
          ? "gpt-image-2.5-flare-adobe"
          : supplier === "cangyuan"
            ? "gpt-image-2.5-flare-4k"
            : supplier === "chentu"
              ? "gpt-image-2.5-flare"
              : "gpt-image-2.5");
      const descriptor = {
        id: model,
        name: model,
        operations: ["image.generate", "image.edit"],
        metadata: {
          ...(supplier === "cangyuan"
            ? {}
            : supplier === "custom-verified-images"
              ? { imageCapabilitiesVerifiedAt: "2026-09-20" }
              : { image25VerifiedAt: "2026-09-10" }),
          supportsImageEdit: true,
        },
        parameters: [
          {
            key: "size",
            control: "dimensions",
            max: supplier === "cyberafei" ? 2048 : 3840,
            options: imageSizeOptions(
              supplier === "cyberafei" || twoKOnly
                ? ["1K", "2K"]
                : supplier === "cangyuan"
                  ? ["4K"]
                  : ["1K", "2K", "4K"],
              supplier === "cyberafei" ? 2048 : 3840,
            ),
          },
        ],
      };
      await repository.saveConnection({
        id: "image25",
        name: "Image 2.5",
        provider,
        encryptedSecret: null,
        config: {
          supplierKey: supplier,
          defaultModel: model,
          ...(provider === "openai"
            ? { modelCatalogModels: [descriptor] }
            : { connector: { models: [descriptor] } }),
        } as unknown as JsonObject,
      });
      await storage.put(
        "reference.png",
        new Uint8Array([1, 2, 3]),
        "image/png",
      );
      await repository.saveAsset({
        id: "reference",
        name: "Landscape reference",
        kind: "image",
        mimeType: "image/png",
        size: 3,
        storageKey: "reference.png",
        metadata: {},
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
                assetId: "reference",
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
                provider,
                connectionId: "image25",
                model,
                parts: [{ type: "text", text: prompt }],
                parameters: {
                  size,
                  ...(tier ? { size_tier: tier } : {}),
                  n: 1,
                },
                inputs: [port("references", "image[]")],
                outputs: [port("image", "image")],
              },
            },
          ],
          edges: [
            {
              id: "reference-edge",
              source: "asset",
              sourceHandle: "asset",
              target: "image",
              targetHandle: "references",
            },
          ],
        },
      });
      let submitted: Readonly<Record<string, unknown>> | undefined;
      const adapter: ProviderAdapter = {
        async testConnection() {},
        async listModels() {
          return [];
        },
        async validate() {
          return { valid: true, issues: [] };
        },
        async submit(request) {
          submitted = request.parameters;
          return {
            providerTaskId: "image25-task",
            status: "succeeded",
            result: {},
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
        clientRequestId: "image25-run",
        scope: "all",
      });
      if (twoKOnly && size === "auto") {
        expect((await waitForRun(service, run.id)).run.status).toBe("failed");
        expect(submitted).toBeUndefined();
        return;
      }
      expect((await waitForRun(service, run.id)).run.status).toBe("succeeded");
      expect(submitted).toMatchObject({ size: expected });
      expect(submitted).not.toHaveProperty("size_tier");
      expect(submitted).not.toHaveProperty("aspect_ratio");
    },
  );

  it("keeps 辰途自由传参 automatic sizing prompt-first and maps the selected K tier", async () => {
    const repository = await testRepository();
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

  it("gives 辰途 image edits local reference bytes without a public server", async () => {
    const previousMasterKey = process.env.MASTER_KEY;
    process.env.MASTER_KEY = "runtime-test-master-key";
    try {
      const repository = await testRepository();
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
      let submittedAssetBytes: Uint8Array | undefined;
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
          submittedAssetBytes = request.assets[0]?.data;
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
      expect(submittedAssetUrl).toBeUndefined();
      expect(submittedAssetBytes).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      if (previousMasterKey === undefined) delete process.env.MASTER_KEY;
      else process.env.MASTER_KEY = previousMasterKey;
    }
  });

  it.each([
    { prompt: "跟随参考图生成海报", expected: "2160x3840" },
    { prompt: "生成 16:9 横图，沿用参考图风格", expected: "3840x2160" },
  ])("preserves generic OpenAI 4K with prompt/reference precedence: $prompt", async ({ prompt, expected }) => {
    const repository = await testRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await storage.put("reference.png", new Uint8Array([1, 2, 3]), "image/png");
    await repository.saveAsset({ id: "reference", name: "比例参考", kind: "image", mimeType: "image/png", size: 3, storageKey: "reference.png", metadata: {} });
    await repository.saveConnection({ id: "generic", name: "generic", provider: "openai", encryptedSecret: null, config: { supplierKey: "secure-skill", defaultModel: "gpt-image-2" } });
    await repository.saveCanvas({ id: canvas.id, graph: { schemaVersion: 1, nodes: [
      { id: "asset", type: "workflow", data: { nodeType: "asset-input", assetId: "reference", assetKind: "image", mediaAspectRatio: 9 / 16, outputs: [port("asset", "image")] } },
      { id: "image", type: "workflow", data: { nodeType: "image-generation", provider: "openai", connectionId: "generic", model: "gpt-image-2", parts: [{ type: "text", text: prompt }], parameters: { size: "auto", size_tier: "4K" }, inputs: [port("references", "image[]")], outputs: [port("image", "image")] } },
    ], edges: [{ id: "ref", source: "asset", sourceHandle: "asset", target: "image", targetHandle: "references" }] } });
    let submitted: Readonly<Record<string, unknown>> | undefined;
    const adapter: ProviderAdapter = {
      async testConnection() {}, async listModels() { return []; }, async validate() { return { valid: true, issues: [] }; },
      async submit(request) { submitted = request.parameters; return { providerTaskId: "test", status: "succeeded", result: {} }; },
      async extractOutputs() { return [{ kind: "image", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }]; },
    };
    const service = new AdapterRunService(adapter, repository, storage, "inline", "openai");
    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "auto-reference", scope: "all" });
    expect((await waitForRun(service, run.id)).run.status).toBe("succeeded");
    expect(submitted).toMatchObject({ size: expected });
    expect(submitted).not.toHaveProperty("size_tier");
  });

  it.each([
    { prompt: "跟随参考图生成海报", ratio: "9:16", size: "4K" },
    { prompt: "生成 16:9 横图，沿用参考图风格", ratio: "16:9", size: "2K" },
  ])("sends saved Banana tiers and connected reference bytes through the native API: $prompt", async ({ prompt, ratio, size }) => {
    const repository = await testRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    const model = "gemini-3-pro-image-preview";
    const bytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=", "base64"));
    await storage.put("banana-ref.png", bytes, "image/png");
    await repository.saveAsset({ id: "banana-ref", name: "参考图", kind: "image", mimeType: "image/png", size: bytes.length, storageKey: "banana-ref.png", metadata: {} });
    const config = { baseUrl: "https://genimage.pro/v1", defaultModel: model, modelCatalogModels: [{ id: model, name: model, operations: ["image.generate"], metadata: { canvasRunnable: true } }] };
    await repository.saveConnection({ id: "banana", name: "Banana", provider: "openai", encryptedSecret: null, config });
    await repository.saveCanvas({ id: canvas.id, graph: { schemaVersion: 1, nodes: [
      { id: "asset", type: "workflow", data: { nodeType: "asset-input", assetId: "banana-ref", assetKind: "image", mediaAspectRatio: 9 / 16, outputs: [port("asset", "image")] } },
      { id: "image", type: "workflow", data: { nodeType: "image-generation", provider: "openai", connectionId: "banana", model, parts: [{ type: "text", text: prompt }], parameters: { size: "auto", size_tier: size, quality: "max" }, inputs: [port("references", "image[]")], outputs: [port("image", "image")] } },
    ], edges: [{ id: "ref", source: "asset", sourceHandle: "asset", target: "image", targetHandle: "references" }] } });
    const fetch = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: "result" }, { inlineData: { mimeType: "image/png", data: Buffer.from(bytes).toString("base64") } }] } }] }));
    const adapter = createDefaultProviderRegistry(new StaticConnectionResolver([{ id: "banana", provider: "openai", baseUrl: config.baseUrl, apiKey: "fixture-key", settings: config }]), { fetch }).get("openai");
    const service = new AdapterRunService(adapter, repository, storage, "inline", "openai");
    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "banana-native-reference", scope: "all" });
    expect((await waitForRun(service, run.id)).run.status).toBe("succeeded");
    expect(fetch).toHaveBeenCalledOnce();
    const call = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toBe(`https://genimage.pro/v1beta/models/${model}:generateContent`);
    const body = JSON.parse(String(call[1].body));
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: ratio, imageSize: size });
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: Buffer.from(bytes).toString("base64") } });
    expect(body).not.toHaveProperty("quality");
  });

  it("uploads a connected image to the Cyber Afei 4K edit route and follows its ratio", async () => {
    const repository = await testRepository();
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

  it("preserves the three-failure pause for video polling", async () => {
    const repository = await testRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await seedResumableRun(repository, canvas.id, "video");
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
      const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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
    const repository = await testRepository();
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

describe("RunService archive-only result recovery", () => {
  const savedSuccess: JsonObject = {
    providerTaskId: "saved-success-task", status: "succeeded",
    result: { completed: true },
  };
  async function seed(repository: MemoryRepository, options: {
    status?: WorkflowRunRecord["status"];
    task?: JsonObject | null;
  } = {}) {
    const status = options.status ?? "cancelled";
    const task = Object.hasOwn(options, "task") ? options.task : savedSuccess;
    const canvas = await repository.ensureDefaultCanvas();
    const run = await repository.createRun({
      id: "archive-only-run", canvasId: canvas.id, clientRequestId: "archive-only-request",
      scope: "all", status,
      revisionGraph: { schemaVersion: 1, nodes: [], edges: [], localRecoveryExpired: true },
    });
    const node = await repository.createNodeRun({
      id: "archive-only-node", workflowRunId: run.id, nodeId: "image", status, attempt: 1,
      providerTaskId: typeof task?.providerTaskId === "string" ? task.providerTaskId : null,
      inputJson: { provider: "runway", connectionId: "deleted-connection", ...(task ? { providerTask: task } : {}) },
      outputAssetIds: [], errorJson: { message: status === "cancelled" ? "运行已取消" : "原始运行错误" },
    });
    const downstream = await repository.createNodeRun({
      id: "archive-only-downstream", workflowRunId: run.id, nodeId: "next-image", status: "blocked", attempt: 0,
      providerTaskId: null, inputJson: {}, outputAssetIds: [], errorJson: null,
    });
    return { run, node, downstream };
  }
  function neverGenerateAdapter(outputs = [{ kind: "image" as const, data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }]) {
    const submit = vi.fn(async (): Promise<ProviderTask> => { throw new Error("Recovery must not submit"); });
    const poll = vi.fn(async (): Promise<ProviderTask> => { throw new Error("Recovery must not poll"); });
    const extractOutputs = vi.fn(async () => outputs);
    const adapter: ProviderAdapter = {
      async testConnection() {}, async listModels() { return []; },
      async validate() { throw new Error("Recovery must not validate a new request"); },
      submit, poll, extractOutputs,
    };
    return { adapter, submit, poll, extractOutputs };
  }

  it("recovers a synchronous success that actually arrives after cancellation and graph compaction", async () => {
    const repository = await testRepository();
    const storage = new MemoryStorage();
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: resumableNodeGraph() });
    const provider = gatedSubmitAdapter();
    const submit = vi.spyOn(provider.adapter, "submit");
    const poll = vi.fn(async (): Promise<ProviderTask> => { throw new Error("Must not poll a completed response"); });
    provider.adapter.poll = poll;
    const service = new AdapterRunService(provider.adapter, repository, storage);
    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: "recover-late-success", scope: "node", nodeId: "image" });
    await provider.submitStarted;
    await service.cancelRun(run.id);
    provider.release();
    await vi.waitFor(async () => expect((await repository.listNodeRuns(run.id))[0]?.status).toBe("cancelled"));
    const snapshot = repository.exportSnapshot();
    snapshot.runs.find(item => item.id === run.id)!.revisionGraph = { schemaVersion: 1, nodes: [], edges: [] };
    const reloaded = new MemoryRepository(snapshot);
    const before = (await reloaded.listNodeRuns(run.id))[0]!;
    expect(before.outputAssetIds).toEqual([]);
    const recovery = new AdapterRunService(provider.adapter, reloaded, storage);
    expect((await recovery.recoverRunOutputs(run.id))?.status).toBe("cancelled");
    const after = (await reloaded.listNodeRuns(run.id))[0]!;
    expect(after.status).toBe("cancelled");
    expect(after.errorJson).toEqual(before.errorJson);
    expect(after.inputJson.providerTask).toEqual(before.inputJson.providerTask);
    expect(after.outputAssetIds).toHaveLength(1);
    expect((await reloaded.getRun(run.id))?.revisionGraph.nodes).toEqual([]);
    expect(await reloaded.listAssets()).toHaveLength(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(poll).not.toHaveBeenCalled();
    expect(provider.calls().cancel).toBe(1);
  });

  it.each(["cancelled", "failed", "needs_attention"] as const)("archives %s results without changing statuses or executing descendants", async status => {
    const repository = await testRepository();
    const { run, node, downstream } = await seed(repository, { status });
    const provider = neverGenerateAdapter();
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    expect(await service.recoverRunOutputs(run.id)).toEqual(run);
    const current = await repository.getNodeRun(node.id);
    expect(current?.status).toBe(node.status);
    expect(current?.errorJson).toEqual(node.errorJson);
    expect(current?.inputJson).toEqual(node.inputJson);
    expect(current?.outputAssetIds).toHaveLength(1);
    expect(await repository.getNodeRun(downstream.id)).toEqual(downstream);
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).not.toHaveBeenCalled();
    expect(provider.extractOutputs).toHaveBeenCalledWith(savedSuccess.result);
  });

  it("coalesces simultaneous service instances and reuses the archived output on later calls", async () => {
    const repository = await testRepository();
    const { run, node } = await seed(repository);
    const storage = new GatedStorage();
    const put = vi.spyOn(storage, "put");
    const provider = neverGenerateAdapter();
    const firstService = new AdapterRunService(provider.adapter, repository, storage);
    const secondService = new AdapterRunService(provider.adapter, repository, storage);
    const first = firstService.recoverRunOutputs(run.id);
    await storage.putStarted;
    const concurrent = secondService.recoverRunOutputs(run.id);
    expect(concurrent).toBe(first);
    await expect(firstService.retryRun(run.id)).rejects.toThrow("正在取回");
    storage.release();
    await Promise.all([first, concurrent]);
    expect(provider.extractOutputs).toHaveBeenCalledTimes(1);
    const completedNode = await repository.getNodeRun(node.id);
    await secondService.recoverRunOutputs(run.id);
    expect(await repository.getNodeRun(node.id)).toEqual(completedNode);
    expect(put).toHaveBeenCalledTimes(1);
    expect(await repository.listAssets()).toHaveLength(1);
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).not.toHaveBeenCalled();
  });

  it("links an already archived original without downloading its now-expired provider URL", async () => {
    const repository = await testRepository();
    const { run, node } = await seed(repository);
    const storage = new MemoryStorage();
    const id = createHash("sha256").update(`${run.id}\0${node.nodeId}\0${0}`).digest("hex");
    const storageKey = `assets/${id}/original.png`;
    await storage.put(storageKey, new Uint8Array([1, 2, 3]), "image/png");
    await repository.saveAsset({ id, name: "Already archived", kind: "image", mimeType: "image/png", size: 3, storageKey,
      metadata: { runId: run.id, nodeId: node.nodeId } });
    const provider = neverGenerateAdapter();
    provider.adapter.extractOutputs = async () => [{ kind: "image", url: "https://expired.example.test/image.png" }];
    const download = vi.spyOn(remoteDownloads, "downloadRemoteArtifact").mockRejectedValue(new Error("Must reuse local original"));
    const put = vi.spyOn(storage, "put");
    try {
      await new AdapterRunService(provider.adapter, repository, storage).recoverRunOutputs(run.id);
      expect((await repository.getNodeRun(node.id))?.outputAssetIds).toEqual([id]);
      expect(download).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    } finally { download.mockRestore(); }
  });

  it("preserves the success snapshot and cancellation diagnostic after an archive error, then retries only archiving", async () => {
    const repository = await testRepository();
    const { run, node } = await seed(repository);
    const storage = new RecoverableStorage(3);
    const provider = neverGenerateAdapter();
    const service = new AdapterRunService(provider.adapter, repository, storage);
    await expect(service.recoverRunOutputs(run.id)).rejects.toThrow("原始结果仍保留");
    expect(await repository.getNodeRun(node.id)).toEqual(node);
    expect(await repository.getRun(run.id)).toEqual(run);
    storage.recover();
    await service.recoverRunOutputs(run.id);
    expect((await repository.getNodeRun(node.id))?.outputAssetIds).toHaveLength(1);
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { providerTaskId: "request-524", status: "running", result: { error: "HTTP 524" } },
    { providerTaskId: "request-524", status: "failed", result: { error: "HTTP 524" } },
    { providerTaskId: "missing-body", status: "succeeded" },
    { providerTaskId: "null-body", status: "succeeded", result: null },
  ])("refuses absent or unconfirmed response evidence: %o", async task => {
    const repository = await testRepository();
    const { run, node } = await seed(repository, { task });
    const provider = neverGenerateAdapter();
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await expect(service.recoverRunOutputs(run.id)).rejects.toThrow("没有已保存的成功结果");
    expect(await repository.getNodeRun(node.id)).toEqual(node);
    expect(provider.extractOutputs).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).not.toHaveBeenCalled();
  });

  it.each([{ outputs: [] }, { outputs: [{ kind: "image" as const, data: new Uint8Array(), mimeType: "image/png" }] }])("refuses empty parsed output instead of fabricating an image", async ({ outputs }) => {
    const repository = await testRepository();
    const { run, node } = await seed(repository);
    const provider = neverGenerateAdapter(outputs);
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await expect(service.recoverRunOutputs(run.id)).rejects.toThrow("没有可归档");
    expect(await repository.getNodeRun(node.id)).toEqual(node);
    expect(await repository.listAssets()).toEqual([]);
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).not.toHaveBeenCalled();
  });

  it.each(["queued", "running", "succeeded"] as const)("rejects run status %s without touching the provider", async status => {
    const repository = await testRepository();
    const { run } = await seed(repository, { status });
    const provider = neverGenerateAdapter();
    const service = new AdapterRunService(provider.adapter, repository, new MemoryStorage());
    await expect(service.recoverRunOutputs(run.id)).rejects.toThrow("仅已取消");
    expect(provider.extractOutputs).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).not.toHaveBeenCalled();
  });
});
