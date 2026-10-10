import type { NormalizedRequest, ProviderConnectionResolver, ProviderTask, RemoteArtifact, ValidationResult } from "./contracts.js";
import { assertValidResult } from "./contracts.js";
import { imageEditingConnection, imageEditingRequestIssues } from "./image-editing-capabilities.js";
import { ProviderHttpError } from "./http.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig } from "./rest.js";
import { jiasuImageRequestIssues, normalizeJiasuImageParameters, JIASU_RESOLUTION_IMAGE_MODELS } from "./jiasu-image-contract.js";
import { uploadJiasuMedia } from "./jiasu-media.js";
export * from "./jiasu-image-contract.js";

export function jiasuImageConnector(model: string): RestConnectorConfig {
  const fields = JIASU_RESOLUTION_IMAGE_MODELS.includes(model) ? ["resolution", "ratio", "quality", "n"] : ["size", "quality", "n"];
  const response = { taskIdPath: "$.task_id", taskIdFallbackPaths: ["$.id", "$.data.task_id"], statusPath: "$.status", statusFallbackPaths: ["$.data.status"],
    errorPath: "$.error.message", errorFallbackPaths: ["$.data.fail_reason", "$.message"] };
  return { auth: { type: "bearer" }, allowedHosts: ["ai.jiasuapi.com"],
    submit: { path: "/v1/images/create", method: "POST", bodyMode: "json", idempotent: false,
      mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
        ...fields.map(key => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true })),
        { target: "/images", source: { kind: "assets", assetKind: "image", select: "all" }, omitIfEmpty: true }],
      response },
    poll: { path: "/v1/images/tasks/{taskId}", method: "GET" as const, bodyMode: "none" as const, idempotent: true,
      response: { statusPath: "$.data.status", statusFallbackPaths: ["$.status"], progressPath: "$.data.progress", errorPath: "$.data.fail_reason",
        errorFallbackPaths: ["$.data.error.message", "$.error.message", "$.message"] } },
      statusMap: { NOT_START: "queued" as const, SUBMITTED: "queued" as const, QUEUED: "queued" as const, IN_PROGRESS: "running" as const,
        SUCCESS: "succeeded" as const, FAILURE: "failed" as const, UNKNOWN: "running" as const }, pollIntervalMs: 3000,
    output: { path: "$.data.result_url", fallbackPaths: ["$.result_urls"], kind: "image", urlPath: "$.url", base64Path: "$.b64_json", requireOutput: true },
  };
}
export function isJiasuImageResult(result: unknown): boolean {
  return !!result && typeof result === "object" && "jiasuImage" in result && result.jiasuImage === true;
}

/** Repair only read-side mappings in persisted tasks; retain the original POST and task identity. */
function currentJiasuImageResult(result: unknown): unknown {
  if (!isJiasuImageResult(result)) return result;
  const envelope = result as Record<string, unknown>;
  if (!envelope.config || typeof envelope.config !== "object" || Array.isArray(envelope.config)) return result;
  const current = jiasuImageConnector(typeof envelope.model === "string" ? envelope.model : "");
  return { ...envelope, config: { ...envelope.config, poll: current.poll, output: current.output,
    statusMap: current.statusMap, pollIntervalMs: current.pollIntervalMs } };
}

/** Preserve the selected transport in the task envelope for restart without another POST. */
export class JiasuImageAdapter extends GenericRestAdapter {
  constructor(private readonly jiasuConnections: ProviderConnectionResolver, private readonly jiasuOptions: GenericRestAdapterOptions = {}, model = "gpt-image-2.5-1k") {
    super(jiasuConnections, { ...jiasuOptions, config: jiasuImageConnector(model) });
  }
  override async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const connection = await this.jiasuConnections.resolve(request.connectionId);
    const source = imageEditingConnection(connection);
    const catalog = source.config.modelCatalogModels;
    const current = Array.isArray(catalog) ? catalog.find(model => model?.id === request.model) : undefined;
    const base = await super.validate({ ...request, parameters: normalizeJiasuImageParameters(request.model ?? "", request.parameters, current) });
    const issues = [...base.issues, ...imageEditingRequestIssues(source, request), ...jiasuImageRequestIssues(source, request)];
    return { valid: !issues.length, issues };
  }
  override async submit(request: NormalizedRequest): Promise<ProviderTask> {
    assertValidResult(await this.validate(request));
    const connection = await this.jiasuConnections.resolve(request.connectionId);
    const catalog = imageEditingConnection(connection).config.modelCatalogModels;
    const current = Array.isArray(catalog) ? catalog.find(model => model?.id === request.model) : undefined;
    const assets = request.assets?.length ? await uploadJiasuMedia(connection, request.assets, this.jiasuOptions) : undefined;
    // Select a per-model connector even when this adapter was constructed for recovery.
    const transport = new GenericRestAdapter(this.jiasuConnections, { ...this.jiasuOptions, config: jiasuImageConnector(request.model ?? "") });
    const task = await transport.submit({ ...request, parameters: normalizeJiasuImageParameters(request.model ?? "", request.parameters, current), ...(assets ? { assets } : {}) });
    if (task.providerTaskId.startsWith("rest:sync:") || !task.providerTaskId.trim())
      throw new ProviderHttpError("佳速异步图片响应缺少任务编号；请先核对原请求，避免重复提交", {
        kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true,
      });
    return { ...task, result: { ...(task.result as Record<string, unknown>), jiasuImage: true } };
  }
  override async poll(task: ProviderTask): Promise<ProviderTask> {
    const state = await super.poll({ ...task, result: currentJiasuImageResult(task.result) });
    // The production response is OpenAI-shaped, while the published guide uses code + data.
    const remote = state.result && typeof state.result === "object" && "remote" in state.result ? state.result.remote : undefined;
    if (state.progress === undefined && remote && typeof remote === "object" && "progress" in remote) {
      const progress = typeof remote.progress === "number" ? remote.progress : Number(String(remote.progress).replace(/%$/u, ""));
      if (Number.isFinite(progress)) state.progress = Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress));
    }
    if (state.status === "succeeded" && !(await this.extractOutputs(state.result)).length)
      throw new ProviderHttpError("佳速图片原任务状态 SUCCESS 但没有 result_url；请继续核对原任务，避免重发", {
        kind: "invalid_response", phase: "poll", retryable: true, submissionMayHaveOccurred: true,
      });
    return state;
  }
  override async extractOutputs(result: unknown): Promise<RemoteArtifact[]> {
    return super.extractOutputs(currentJiasuImageResult(result));
  }
}
