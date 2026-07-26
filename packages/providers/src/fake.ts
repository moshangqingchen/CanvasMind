import type {
  ModelDescriptor,
  ModelParameterDescriptor,
  NormalizedRequest,
  NormalizedTaskState,
  ProviderAdapter,
  ProviderConnectionResolver,
  ProviderTask,
  RemoteArtifact,
  ValidationIssue,
  ValidationResult,
} from "./contracts.js";
import {
  assertValidResult,
  getProviderTaskId,
  withCanonicalModelFields,
} from "./contracts.js";
import { ProviderHttpError } from "./http.js";

export type FakeScenario =
  | "sync"
  | "async"
  | "fail"
  | "auth_error"
  | "rate_limit"
  | "network_error"
  | "submit_uncertain";

interface FakeTaskRecord {
  connectionId: string;
  polls: number;
  cancelled: boolean;
  request: NormalizedRequest;
  scenario: FakeScenario;
  outputs: RemoteArtifact[];
}

interface FakeResult {
  connectionId: string;
  outputs: RemoteArtifact[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function persistedFakeResult(value: unknown): FakeResult | undefined {
  if (!isRecord(value) || typeof value.connectionId !== "string") {
    return undefined;
  }
  if (!Array.isArray(value.outputs)) return undefined;
  const outputs = value.outputs.filter((output): output is RemoteArtifact => {
    if (!isRecord(output)) return false;
    const kind = output.kind;
    return (
      (kind === "image" || kind === "video") &&
      (typeof output.url === "string" || output.data instanceof Uint8Array)
    );
  });
  return outputs.length === value.outputs.length
    ? { connectionId: value.connectionId, outputs }
    : undefined;
}

export interface FakeProviderOptions {
  pollsBeforeSuccess?: number;
  defaultScenario?: FakeScenario;
  createOutputs?: (request: NormalizedRequest) => readonly RemoteArtifact[];
}

const FAKE_IMAGE_PARAMETERS: readonly ModelParameterDescriptor[] = [
  {
    key: "size",
    label: "尺寸",
    control: "text",
    valueType: "string",
    default: "1024x1024",
    options: [
      { label: "方形 1024 x 1024", value: "1024x1024" },
      { label: "横向 1536 x 1024", value: "1536x1024" },
      { label: "竖向 1024 x 1536", value: "1024x1536" },
    ],
  },
  {
    key: "quality",
    label: "质量",
    control: "select",
    valueType: "string",
    default: "auto",
    options: [
      { label: "自动", value: "auto" },
      { label: "低", value: "low" },
      { label: "中", value: "medium" },
      { label: "高", value: "high" },
    ],
  },
  {
    key: "n",
    label: "数量",
    control: "number",
    valueType: "integer",
    default: 1,
    min: 1,
    max: 10,
    step: 1,
  },
];

const FAKE_VIDEO_PARAMETERS: readonly ModelParameterDescriptor[] = [
  {
    key: "duration",
    label: "时长（秒）",
    control: "number",
    valueType: "integer",
    default: 5,
    min: 2,
    max: 10,
    step: 1,
  },
  {
    key: "ratio",
    label: "画面比例",
    control: "text",
    valueType: "string",
    default: "1280:720",
    options: [
      { label: "横屏 1280:720", value: "1280:720" },
      { label: "竖屏 720:1280", value: "720:1280" },
      { label: "方形 1024:1024", value: "1024:1024" },
    ],
  },
];

const FAKE_MODELS: readonly ModelDescriptor[] = [
  {
    id: "fake-image-v1",
    name: "Fake Image",
    operations: ["image.generate", "image.edit"],
    parameters: FAKE_IMAGE_PARAMETERS,
    isDefault: true,
  },
  {
    id: "fake-video-v1",
    name: "Fake Video",
    operations: ["video.generate", "video.image-to-video"],
    parameters: FAKE_VIDEO_PARAMETERS,
  },
];

function scenarioFrom(
  request: NormalizedRequest,
  fallback: FakeScenario,
): FakeScenario {
  const value = request.metadata?.["fakeScenario"];
  switch (value) {
    case "sync":
    case "async":
    case "fail":
    case "auth_error":
    case "rate_limit":
    case "network_error":
    case "submit_uncertain":
      return value;
    default:
      return fallback;
  }
}

function defaultOutputs(request: NormalizedRequest): RemoteArtifact[] {
  const video = request.operation.startsWith("video.");
  const extension = video ? "mp4" : "png";
  const requestedCount = Number(request.parameters?.["n"] ?? 1);
  const count = Number.isFinite(requestedCount)
    ? Math.min(10, Math.max(1, Math.trunc(requestedCount)))
    : 1;
  const data = video
    ? new TextEncoder().encode("SUPER_CANVAS_FAKE_VIDEO")
    : Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Array.from({ length: count }, (_, index) => ({
    kind: video ? "video" : "image",
    url: `https://example.invalid/fake/${encodeURIComponent(request.idempotencyKey)}-${index + 1}.${extension}`,
    data,
    mimeType: video ? "video/mp4" : "image/png",
    metadata: { fake: true },
  }));
}

export class FakeProviderAdapter implements ProviderAdapter {
  private readonly tasks = new Map<string, FakeTaskRecord>();
  private readonly taskByIdempotencyKey = new Map<string, ProviderTask>();
  private readonly pollsBeforeSuccess: number;
  private readonly defaultScenario: FakeScenario;
  private readonly createOutputs: (
    request: NormalizedRequest,
  ) => readonly RemoteArtifact[];

  public constructor(
    private readonly connections?: ProviderConnectionResolver,
    options: FakeProviderOptions = {},
  ) {
    this.pollsBeforeSuccess = Math.max(1, options.pollsBeforeSuccess ?? 2);
    this.defaultScenario = options.defaultScenario ?? "async";
    this.createOutputs = options.createOutputs ?? defaultOutputs;
  }

  public async testConnection(connectionId: string): Promise<void> {
    if (this.connections) await this.connections.resolve(connectionId);
  }

  public async listModels(connectionId: string): Promise<ModelDescriptor[]> {
    await this.testConnection(connectionId);
    return FAKE_MODELS.map((model) =>
      withCanonicalModelFields({ ...model }, "fake"),
    );
  }

  public async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    if (request.prompt.trim().length === 0) {
      issues.push({
        path: "prompt",
        code: "required",
        message: "A prompt is required",
      });
    }
    if (
      (request.operation === "image.edit" ||
        request.operation === "video.image-to-video") &&
      !(request.assets ?? []).some((asset) => asset.kind === "image")
    ) {
      issues.push({
        path: "assets",
        code: "reference_required",
        message: "This operation requires an input image",
      });
    }
    return { valid: issues.length === 0, issues };
  }

  public async submit(request: NormalizedRequest): Promise<ProviderTask> {
    assertValidResult(await this.validate(request));
    if (this.connections) await this.connections.resolve(request.connectionId);
    const existing = this.taskByIdempotencyKey.get(request.idempotencyKey);
    if (existing) return existing;

    const scenario = scenarioFrom(request, this.defaultScenario);
    if (scenario === "auth_error") {
      throw new ProviderHttpError("Fake authentication failed", {
        kind: "authentication",
        phase: "submit",
        status: 401,
        retryable: false,
        submissionMayHaveOccurred: false,
      });
    }
    if (scenario === "rate_limit") {
      throw new ProviderHttpError("Fake rate limit", {
        kind: "rate_limit",
        phase: "submit",
        status: 429,
        retryable: true,
        submissionMayHaveOccurred: false,
      });
    }
    if (scenario === "network_error" || scenario === "submit_uncertain") {
      throw new ProviderHttpError("Fake transport failure", {
        kind: "network",
        phase: "submit",
        retryable: scenario === "network_error",
        submissionMayHaveOccurred: scenario === "submit_uncertain",
      });
    }

    const providerTaskId = `fake:${request.idempotencyKey}`;
    const outputs = [...this.createOutputs(request)];
    const result: FakeResult = { connectionId: request.connectionId, outputs };
    if (scenario === "sync") {
      const task: ProviderTask = {
        providerTaskId,
        id: providerTaskId,
        status: "succeeded",
        result,
      };
      this.taskByIdempotencyKey.set(request.idempotencyKey, task);
      return task;
    }
    if (scenario === "fail") {
      const task: ProviderTask = {
        providerTaskId,
        id: providerTaskId,
        status: "failed",
        result,
        error: "Intentional fake provider failure",
      };
      this.taskByIdempotencyKey.set(request.idempotencyKey, task);
      return task;
    }
    this.tasks.set(providerTaskId, {
      connectionId: request.connectionId,
      polls: 0,
      cancelled: false,
      request,
      scenario,
      outputs,
    });
    const task: ProviderTask = {
      providerTaskId,
      id: providerTaskId,
      status: "running",
      result,
    };
    this.taskByIdempotencyKey.set(request.idempotencyKey, task);
    return task;
  }

  public async poll(task: ProviderTask): Promise<NormalizedTaskState> {
    const taskId = getProviderTaskId(task);
    const record = this.tasks.get(taskId);
    if (!record) {
      // A worker restart drops the in-memory fake task map. The submitted
      // result is persisted in node_run.input_json, so a restored task can be
      // completed deterministically instead of polling forever until timeout.
      const persisted = persistedFakeResult(task.result);
      if (
        persisted &&
        (task.status === "queued" || task.status === "running")
      ) {
        return {
          providerTaskId: taskId,
          id: task.id ?? taskId,
          status: "succeeded",
          progress: 1,
          result: persisted,
        };
      }
      return { ...task, providerTaskId: taskId, id: task.id ?? taskId };
    }
    if (record.cancelled) {
      return {
        providerTaskId: taskId,
        id: task.id ?? taskId,
        status: "cancelled",
        result: task.result,
      };
    }
    record.polls += 1;
    const done = record.polls >= this.pollsBeforeSuccess;
    const result: FakeResult = {
      connectionId: record.connectionId,
      outputs: record.outputs,
    };
    return {
      providerTaskId: taskId,
      id: task.id ?? taskId,
      status: done ? "succeeded" : "running",
      progress: done ? 1 : record.polls / this.pollsBeforeSuccess,
      result,
    };
  }

  public async cancel(task: ProviderTask): Promise<void> {
    const record = this.tasks.get(getProviderTaskId(task));
    if (record) record.cancelled = true;
  }

  public async extractOutputs(result: unknown): Promise<RemoteArtifact[]> {
    if (!result || typeof result !== "object" || !("outputs" in result))
      return [];
    const outputs = (result as { outputs?: unknown }).outputs;
    if (!Array.isArray(outputs)) return [];
    return outputs.filter((output): output is RemoteArtifact => {
      if (!output || typeof output !== "object") return false;
      const candidate = output as Partial<RemoteArtifact>;
      return (
        (candidate.kind === "image" || candidate.kind === "video") &&
        (typeof candidate.url === "string" ||
          candidate.data instanceof Uint8Array)
      );
    });
  }
}

export const FakeProvider = FakeProviderAdapter;
