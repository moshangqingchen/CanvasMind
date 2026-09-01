import type {
  FetchImplementation,
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
import {
  assetAsUrl,
  fetchProviderJson,
  joinUrl,
  mergeHeaders,
  ProviderHttpError,
  providerFetch,
  requireApiKey,
} from "./http.js";

const DEFAULT_BASE_URL = "https://api.dev.runwayml.com/v1";
const DEFAULT_MODEL = "gen4.5";
const API_VERSION = "2024-11-06";
const SUPPORTED_INPUT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const VIDEO_PARAMETER_DESCRIPTORS: readonly ModelParameterDescriptor[] = [
  {
    key: "duration",
    label: "时长（秒）",
    control: "number",
    valueType: "integer",
    default: 5,
    min: 2,
    max: 10,
    step: 1,
    operations: ["video.generate", "video.image-to-video"],
  },
  {
    key: "ratio",
    label: "画面比例",
    control: "text",
    valueType: "string",
    default: "1280:720",
    placeholder: "1280:720",
    options: [
      { label: "横屏 1280:720", value: "1280:720" },
      { label: "竖屏 720:1280", value: "720:1280" },
      { label: "方形 1024:1024", value: "1024:1024" },
    ],
    operations: ["video.generate", "video.image-to-video"],
  },
];

interface RunwayTaskResponse {
  id?: unknown;
  status?: unknown;
  output?: unknown;
  failure?: unknown;
  failureCode?: unknown;
  progress?: unknown;
  [key: string]: unknown;
}

interface RunwayTaskEnvelope {
  connectionId: string;
  remote: RunwayTaskResponse;
}

const STATIC_MODELS: readonly ModelDescriptor[] = [
  {
    id: DEFAULT_MODEL,
    name: "Gen-4.5",
    operations: ["video.generate", "video.image-to-video"],
    parameters: VIDEO_PARAMETER_DESCRIPTORS,
    isDefault: true,
    limits: { maxInputImages: 1, maxPromptCharacters: 1_000 },
  },
  {
    id: "gen4_turbo",
    name: "Gen-4 Turbo",
    operations: ["video.generate", "video.image-to-video"],
    parameters: VIDEO_PARAMETER_DESCRIPTORS,
    limits: { maxInputImages: 1, maxPromptCharacters: 1_000 },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberParameter(
  parameters: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = parameters?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringParameter(
  parameters: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = parameters?.[key];
  return typeof value === "string" ? value : undefined;
}

function hasAssetContent(asset: {
  readonly url?: string;
  readonly data?: Uint8Array;
}): boolean {
  return (
    (typeof asset.url === "string" && asset.url.trim().length > 0) ||
    (asset.data !== undefined && asset.data.byteLength > 0)
  );
}

function mapStatus(status: unknown): ProviderTask["status"] {
  switch (typeof status === "string" ? status.toUpperCase() : "") {
    case "SUCCEEDED":
    case "SUCCESS":
      return "succeeded";
    case "FAILED":
    case "ERROR":
      return "failed";
    case "CANCELLED":
    case "CANCELED":
      return "cancelled";
    case "RUNNING":
    case "PROCESSING":
      return "running";
    default:
      return "queued";
  }
}

export interface RunwayAdapterOptions {
  fetch?: FetchImplementation;
  requestTimeoutMs?: number;
  apiVersion?: string;
}

export class RunwayAdapter implements ProviderAdapter {
  private readonly fetchImpl: FetchImplementation;
  private readonly requestTimeoutMs: number;
  private readonly apiVersion: string;

  public constructor(
    private readonly connections: ProviderConnectionResolver,
    options: RunwayAdapterOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? providerFetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.apiVersion = options.apiVersion ?? API_VERSION;
  }

  private headers(
    connection: Awaited<ReturnType<ProviderConnectionResolver["resolve"]>>,
  ) {
    return mergeHeaders(connection.headers, {
      Authorization: `Bearer ${requireApiKey(connection)}`,
      "X-Runway-Version": this.apiVersion,
      "Content-Type": "application/json",
    });
  }

  public async testConnection(connectionId: string): Promise<void> {
    const connection = await this.connections.resolve(connectionId);
    await fetchProviderJson<unknown>(
      this.fetchImpl,
      joinUrl(connection.baseUrl ?? DEFAULT_BASE_URL, "/tasks?limit=1"),
      { method: "GET", headers: this.headers(connection) },
      { phase: "connect", timeoutMs: this.requestTimeoutMs },
    );
  }

  public async listModels(connectionId: string): Promise<ModelDescriptor[]> {
    const connection = await this.connections.resolve(connectionId);
    // Runway does not expose a stable model-list endpoint. Keep the list
    // explicit and allow deployments to add models in connection settings.
    const configured = connection.settings?.["models"];
    if (!Array.isArray(configured)) {
      return STATIC_MODELS.map((model) =>
        withCanonicalModelFields({ ...model }, "runway"),
      );
    }
    const custom = configured.flatMap((item): ModelDescriptor[] => {
      if (!isRecord(item) || typeof item.id !== "string") return [];
      const operations: ModelDescriptor["operations"] = Array.isArray(
        item.operations,
      )
        ? item.operations.filter(
            (operation): operation is ModelDescriptor["operations"][number] =>
              operation === "video.generate" ||
              operation === "video.image-to-video",
          )
        : ["video.generate", "video.image-to-video"];
      return [
        {
          id: item.id,
          name: typeof item.name === "string" ? item.name : item.id,
          operations,
          parameters: Array.isArray(item.parameters)
            ? (item.parameters as unknown as ModelParameterDescriptor[])
            : VIDEO_PARAMETER_DESCRIPTORS,
          isDefault:
            item.id ===
            (connection.settings?.["defaultModel"] ?? DEFAULT_MODEL),
        },
      ];
    });
    return custom.length > 0
      ? custom.map((model) => withCanonicalModelFields(model, "runway"))
      : STATIC_MODELS.map((model) =>
          withCanonicalModelFields({ ...model }, "runway"),
        );
  }

  public async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    try {
      const connection = await this.connections.resolve(request.connectionId);
      if (!connection.apiKey) {
        issues.push({
          path: "connection.apiKey",
          code: "missing_credential",
          message: "A Runway API key is required",
        });
      }
    } catch (error) {
      issues.push({
        path: "connectionId",
        code: "unknown_connection",
        message:
          error instanceof Error
            ? error.message
            : "Unknown provider connection",
      });
    }
    if (
      request.operation !== "video.generate" &&
      request.operation !== "video.image-to-video"
    ) {
      issues.push({
        path: "operation",
        code: "unsupported_operation",
        message: "Runway adapter only supports video generation",
      });
    }
    if (request.prompt.trim().length === 0) {
      issues.push({
        path: "prompt",
        code: "required",
        message: "A video prompt is required",
      });
    }
    if (request.prompt.length > 1_000) {
      issues.push({
        path: "prompt",
        code: "too_long",
        message: "Runway prompts must be at most 1,000 characters",
      });
    }
    const assets = request.assets ?? [];
    const images = assets.filter((asset) => asset.kind === "image");
    if (request.operation === "video.generate" && assets.length > 0) {
      issues.push({
        path: "assets",
        code: "assets_not_supported",
        message:
          "Text-to-video does not accept input assets; use image-to-video instead",
      });
    }
    if (request.operation === "video.image-to-video" && images.length === 0) {
      issues.push({
        path: "assets",
        code: "first_frame_required",
        message: "Image-to-video requires a reference image",
      });
    }
    if (assets.length > 1) {
      issues.push({
        path: "assets",
        code: "too_many_images",
        message: "Runway image-to-video accepts one first-frame image",
      });
    }
    const rawDuration = request.parameters?.["duration"];
    if (
      rawDuration !== undefined &&
      (typeof rawDuration !== "number" ||
        !Number.isInteger(rawDuration) ||
        rawDuration < 2 ||
        rawDuration > 10)
    ) {
      issues.push({
        path: "parameters.duration",
        code: "invalid_duration",
        message: "Runway duration must be an integer between 2 and 10 seconds",
      });
    }
    const rawRatio = request.parameters?.["ratio"];
    if (
      rawRatio !== undefined &&
      (typeof rawRatio !== "string" ||
        !/^[1-9]\d*:[1-9]\d*$/u.test(rawRatio.trim()))
    ) {
      issues.push({
        path: "parameters.ratio",
        code: "invalid_ratio",
        message: "Runway ratio must use positive width:height values",
      });
    }
    if (request.model !== undefined && request.model.trim().length === 0) {
      issues.push({
        path: "model",
        code: "invalid_model",
        message: "Runway model must be a non-empty string",
      });
    }
    for (const [index, asset] of assets.entries()) {
      if (asset.kind !== "image") {
        issues.push({
          path: `assets[${index}].kind`,
          code: "unsupported_asset_kind",
          message: "Runway video requests only accept an image input",
        });
        continue;
      }
      const mimeType =
        asset.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!SUPPORTED_INPUT_MIME_TYPES.has(mimeType)) {
        issues.push({
          path: `assets[${index}].mimeType`,
          code: "unsupported_mime_type",
          message: `Unsupported Runway input image MIME type: ${asset.mimeType}`,
        });
      }
      if (asset.role === "lastFrame") {
        issues.push({
          path: `assets[${index}].role`,
          code: "unsupported_asset_role",
          message: "This Runway adapter only supports a first-frame image",
        });
      }
      if (!hasAssetContent(asset)) {
        issues.push({
          path: `assets[${index}]`,
          code: "unresolved_asset",
          message: `Reference image ${asset.id} has no usable URL or bytes`,
        });
      }
    }
    return { valid: issues.length === 0, issues };
  }

  public async submit(request: NormalizedRequest): Promise<ProviderTask> {
    assertValidResult(await this.validate(request));
    const connection = await this.connections.resolve(request.connectionId);
    const model =
      request.model ??
      stringParameter(connection.settings, "defaultModel") ??
      DEFAULT_MODEL;
    const parameters = request.parameters;
    const body: Record<string, unknown> = {
      model,
      promptText: request.prompt,
    };
    const ratio = stringParameter(parameters, "ratio");
    const duration = numberParameter(parameters, "duration");
    if (ratio) body.ratio = ratio;
    if (duration !== undefined) body.duration = duration;

    let endpoint = "/text_to_video";
    if (request.operation === "video.image-to-video") {
      endpoint = "/image_to_video";
      const firstImage = (request.assets ?? []).find(
        (asset) => asset.kind === "image",
      );
      const imageUrl = firstImage ? assetAsUrl(firstImage) : undefined;
      if (imageUrl) body.promptImage = imageUrl;
    }
    const response = await fetchProviderJson<RunwayTaskResponse>(
      this.fetchImpl,
      joinUrl(connection.baseUrl ?? DEFAULT_BASE_URL, endpoint),
      {
        method: "POST",
        headers: this.headers(connection),
        body: JSON.stringify(body),
      },
      {
        phase: "submit",
        timeoutMs: this.requestTimeoutMs,
        // Runway task creation is not assumed idempotent; an ambiguous request
        // is surfaced as needs_attention by the worker instead of re-submitting.
        idempotent: false,
      },
    );
    const providerTaskId =
      typeof response.id === "string" ? response.id : undefined;
    if (!providerTaskId) {
      // A 2xx task-creation response without an ID is ambiguous: Runway may
      // have accepted a paid task even though the client cannot poll it.
      // Surface it as needs_attention through the runtime, never as a retry.
      throw new ProviderHttpError("Runway response did not include a task id", {
        kind: "invalid_response",
        phase: "submit",
        retryable: false,
        submissionMayHaveOccurred: true,
      });
    }
    const status = mapStatus(response.status);
    return {
      providerTaskId,
      id: providerTaskId,
      status: status === "queued" ? "running" : status,
      result: {
        connectionId: request.connectionId,
        remote: response,
      } satisfies RunwayTaskEnvelope,
    };
  }

  public async poll(task: ProviderTask): Promise<NormalizedTaskState> {
    const taskId = getProviderTaskId(task);
    const envelope =
      isRecord(task.result) && typeof task.result.connectionId === "string"
        ? (task.result as unknown as RunwayTaskEnvelope)
        : undefined;
    if (!envelope) throw new Error("Runway task is missing its connection id");
    const connection = await this.connections.resolve(envelope.connectionId);
    const response = await fetchProviderJson<RunwayTaskResponse>(
      this.fetchImpl,
      joinUrl(
        connection.baseUrl ?? DEFAULT_BASE_URL,
        `/tasks/${encodeURIComponent(taskId)}`,
      ),
      { method: "GET", headers: this.headers(connection) },
      { phase: "poll", timeoutMs: this.requestTimeoutMs },
    );
    const status = mapStatus(response.status);
    const state: NormalizedTaskState = {
      providerTaskId: taskId,
      id: task.id ?? taskId,
      status,
      result: {
        connectionId: envelope.connectionId,
        remote: response,
      } satisfies RunwayTaskEnvelope,
    };
    if (
      typeof response.progress === "number" &&
      Number.isFinite(response.progress)
    ) {
      state.progress = Math.max(0, Math.min(1, response.progress));
    }
    if (
      status === "failed" &&
      (response.failure !== undefined || response.failureCode !== undefined)
    ) {
      const failure =
        typeof response.failure === "string"
          ? response.failure
          : "Runway 任务生成失败";
      const failureCode =
        typeof response.failureCode === "string"
          ? response.failureCode.trim()
          : "";
      state.error = failureCode ? `${failure} [${failureCode}]` : failure;
    }
    return state;
  }

  public async cancel(task: ProviderTask): Promise<void> {
    const taskId = getProviderTaskId(task);
    const envelope =
      isRecord(task.result) && typeof task.result.connectionId === "string"
        ? (task.result as unknown as RunwayTaskEnvelope)
        : undefined;
    if (!envelope) throw new Error("Runway task is missing its connection id");
    const connection = await this.connections.resolve(envelope.connectionId);
    await fetchProviderJson<unknown>(
      this.fetchImpl,
      joinUrl(
        connection.baseUrl ?? DEFAULT_BASE_URL,
        `/tasks/${encodeURIComponent(taskId)}`,
      ),
      { method: "DELETE", headers: this.headers(connection) },
      { phase: "cancel", timeoutMs: this.requestTimeoutMs, allowEmpty: true },
    );
  }

  public async extractOutputs(result: unknown): Promise<RemoteArtifact[]> {
    const remote =
      isRecord(result) && isRecord(result.remote) ? result.remote : result;
    if (!isRecord(remote) || !Array.isArray(remote.output)) return [];
    return remote.output.flatMap((item): RemoteArtifact[] => {
      if (typeof item !== "string") return [];
      return [{ kind: "video", url: item, mimeType: "video/mp4" }];
    });
  }
}

export const RUNWAY_DEFAULT_VIDEO_MODEL = DEFAULT_MODEL;
export const RunwayVideoAdapter = RunwayAdapter;
