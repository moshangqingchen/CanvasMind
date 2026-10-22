import { createHash } from "node:crypto";
import type { ModelDescriptor, NormalizedRequest, NormalizedTaskState, ProviderAdapter, ProviderAssetInput, ProviderConnectionResolver, ProviderTask, RemoteArtifact, ResolvedProviderConnection, ValidationIssue, ValidationResult } from "./contracts.js";
import { assertValidResult, getProviderTaskId, withCanonicalModelFields } from "./contracts.js";
import { assertSafeProviderEndpoint, assetToBlob, fetchProviderJson, mergeHeaders, parseDataUrl, providerFetch, ProviderHttpError, providerSubmitTransportActive, requireApiKey } from "./http.js";
import { GenericRestAdapter, type GenericRestAdapterOptions, type RestConnectorConfig } from "./rest.js";
import { distinctAssetSources } from "./asset-preparation-cache.js";
import { MaterialPreparationError } from "./material-preparation.js";

export interface LangframeAdapterOptions extends Omit<GenericRestAdapterOptions, "config"> {
  /** Upload original bytes with the supplier's saved website session, never the SK. */
  uploadReference?: (connectionId: string, asset: ProviderAssetInput) => Promise<string>;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const present = (value: unknown) => value !== undefined && value !== null && value !== "" && value !== "auto";
const imageOperation = (request: NormalizedRequest) => request.operation.startsWith("image.");
const aliases = { resolution: ["resolution", "size_tier", "tier"], aspect_ratio: ["aspect_ratio", "aspectRatio", "ratio"] } as const;
const issue = (path: string, message: string, code = "invalid_parameter"): ValidationIssue => ({ path, code, message });
const aliasPresent = (value: unknown, key: string, image: boolean) => present(value) || key === "aspect_ratio" && !image && value === "auto";

function origin(connection: ResolvedProviderConnection): string {
  const url = new URL(connection.baseUrl || "https://vipprompt.cn");
  if (url.protocol !== "https:" || !["vipprompt.cn", "www.vipprompt.cn"].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname))
    throw new Error("狼帧连接须使用 https://vipprompt.cn 或其 /v1 地址");
  return url.origin;
}

function savedModel(connection: ResolvedProviderConnection, id: string | undefined): ModelDescriptor | undefined {
  const catalog = connection.settings?.modelCatalogModels;
  return Array.isArray(catalog) ? catalog.find((model: ModelDescriptor) => model?.id === id) : undefined;
}

/** Map only supplier-declared fields; tiers never become invented output pixels. */
export function langframeParameters(request: NormalizedRequest): Record<string, unknown> {
  const input = request.parameters ?? {}, image = imageOperation(request), output: Record<string, unknown> = {};
  for (const key of image ? ["n", "size", "quality"] : ["duration"])
    if (present(input[key]) || image && key === "quality" && input[key] === "auto") output[key] = input[key];
  for (const [key, keys] of Object.entries(aliases)) {
    const value = keys.map(key => input[key]).find(value => aliasPresent(value, key, image));
    if (value !== undefined) output[key === "aspect_ratio" && !image ? "ratio" : key] = value;
  }
  if (image) {
    output.n ??= 1;
    if (present(input.width) && present(input.height)) output.size = `${input.width}x${input.height}`;
  }
  return output;
}

/** The public plugin freezes this same submit/query contract for interrupted tasks. */
export function langframeConnector(kind: "image" | "video", taskId?: string): RestConnectorConfig {
  const response = { taskIdPath: "$.taskId", taskIdFallbackPaths: ["$.task_id", "$.id", "$.task.taskId", "$.task.task_id", "$.task.id"],
    statusPath: "$.task.status", statusFallbackPaths: ["$.status", "$.task.task_status", "$.task_status", "$.task.state", "$.state"],
    errorPath: "$.task.error.message", errorFallbackPaths: ["$.task.error", "$.error.message", "$.error", "$.message"], progressPath: "$.task.progress" };
  const fields = kind === "image" ? ["n", "size", "quality", "resolution", "aspect_ratio", "image"] : ["resolution", "ratio", "duration", "media"];
  return {
    auth: { type: "bearer" }, allowedHosts: ["vipprompt.cn", "www.vipprompt.cn"],
    submit: { path: kind === "image" ? "/v1/images/generations" : "/v1/videos", method: "POST", bodyMode: "json", idempotent: false,
      headers: { Prefer: "respond-async", ...(taskId ? { "X-LF-Task-ID": taskId } : {}) },
      mappings: [
        { target: "/model", source: { kind: "request", path: "$.model" } },
        { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
        ...fields.map(key => ({ target: `/${key}`, source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true })),
      ], response },
    poll: { path: `/v1/${kind === "image" ? "images" : "videos"}/tasks/{taskId}`, method: "GET", bodyMode: "none", idempotent: true, response },
    pollIntervalMs: kind === "image" ? 5000 : 8000,
    statusMap: { finished: "succeeded", failure: "failed" },
    output: kind === "image" ? { path: "$.task.images", fallbackPaths: ["$.images", "$.task.data", "$.data"], kind: "image", urlPath: "$.url", base64Path: "$.b64_json" }
      : { path: "$.task.download_url", fallbackPaths: ["$.task.video_url", "$.download_url", "$.video_url", "$.downloadUrl", "$.videoUrl"], kind: "video" },
  };
}

function publicUrl(value: unknown, base?: string): string | undefined {
  if (typeof value !== "string" || !value.trim() || /^(?:data|blob|file):/iu.test(value)) return;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch { return; }
}

async function publicReferenceUrl(value: unknown): Promise<string | undefined> {
  const url = publicUrl(value);
  if (!url || new URL(url).protocol !== "https:") return;
  try { await assertSafeProviderEndpoint(url); return url; } catch { return; }
}

function taskStatus(remote: unknown, fallback: ProviderTask["status"]): ProviderTask["status"] {
  if (!record(remote)) return fallback;
  const task = record(remote.task) ? remote.task : remote;
  const raw = String(task.status ?? task.task_status ?? task.state ?? "").toLowerCase().split(":", 1)[0];
  if (["success", "succeeded", "completed", "done", "finished"].includes(raw!)) return "succeeded";
  if (["failure", "failed", "error"].includes(raw!) || remote.ok === false) return "failed";
  if (["cancelled", "canceled"].includes(raw!)) return "cancelled";
  if (["queued", "pending", "submitted"].includes(raw!)) return "queued";
  if (["running", "processing", "in_progress"].includes(raw!)) return "running";
  return fallback;
}

function remoteError(remote: unknown): string | undefined {
  if (!record(remote)) return;
  const task = record(remote.task) ? remote.task : remote;
  const value = task.error ?? remote.error ?? task.message;
  return typeof value === "string" ? value : record(value) && typeof value.message === "string" ? value.message : undefined;
}

export class LangframeAdapter implements ProviderAdapter {
  private readonly fetchImpl;
  constructor(private readonly connections: ProviderConnectionResolver, private readonly options: LangframeAdapterOptions = {}) {
    this.fetchImpl = options.fetch ?? providerFetch;
  }

  async testConnection(connectionId: string): Promise<void> { await this.listModels(connectionId); }

  async listModels(connectionId: string): Promise<ModelDescriptor[]> {
    const connection = await this.connections.resolve(connectionId);
    const data = await fetchProviderJson<unknown>(this.fetchImpl, `${origin(connection)}/v1/models`, {
      method: "GET", headers: mergeHeaders(connection.headers, { Authorization: `Bearer ${requireApiKey(connection)}` }),
    }, { phase: "connect", timeoutMs: this.options.requestTimeoutMs ?? 30_000, idempotent: true });
    if (!record(data) || !Array.isArray(data.data)) throw new Error("狼帧模型目录响应缺少 data 数组");
    return data.data.flatMap(item => {
      if (!record(item) || typeof item.id !== "string" || !item.id.trim()) return [];
      const current = savedModel(connection, item.id);
      // The generic IDs alone do not prove image/video output; discovery supplies that evidence.
      return [withCanonicalModelFields(current ?? { id: item.id, name: item.id, operations: [] }, "langframe")];
    });
  }

  async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const add = (path: string, message: string, code?: string) => issues.push(issue(path, message, code));
    let connection: ResolvedProviderConnection;
    try { connection = await this.connections.resolve(request.connectionId); origin(connection); requireApiKey(connection); }
    catch (error) { return { valid: false, issues: [issue("connection", error instanceof Error ? error.message : "狼帧连接不可用")] }; }
    if (connection.provider !== "langframe") add("connection.provider", "此适配器仅用于狼帧连接");
    if (!["image.generate", "image.edit", "video.generate", "video.image-to-video"].includes(request.operation)) add("operation", "狼帧此接口只接收图片或视频生成请求");
    if (!request.model?.trim()) add("model", "请选择狼帧完整下游型号名称");
    if (!request.prompt.trim()) add("prompt", "请输入创作描述");
    const ids = connection.settings?.scannedModelIds;
    const model = savedModel(connection, request.model), image = imageOperation(request), p = request.parameters ?? {}, parameters = langframeParameters(request);
    if (connection.settings?.supplierArchived === true || ["empty", "unauthorized"].includes(String(connection.settings?.modelScanStatus)) ||
      Array.isArray(ids) && !ids.includes(request.model) || model?.metadata?.canvasRunnable === false) add("model", "当前狼帧 Key 没有此完整型号的可用权限", "unsupported_model");
    if (!model) add("model", "缺少此完整型号的图片/视频目录声明，请先读取狼帧目录", "missing_model_contract");
    if (model && !model.operations.includes(request.operation)) add("operation", "当前完整型号没有声明此生成操作");
    for (const [canonical, keys] of Object.entries(aliases)) {
      const values = keys.map(key => p[key]).filter(value => aliasPresent(value, canonical, image));
      if (values.some(value => value !== values[0])) add(`parameters.${canonical}`, "已保存的同义参数互相冲突，请明确选择；原值保留");
    }
    const accepted = new Set(image ? ["n", "size", "quality", "resolution", "size_tier", "tier", "aspect_ratio", "aspectRatio", "ratio", "width", "height"]
      : ["resolution", "size_tier", "tier", "aspect_ratio", "aspectRatio", "ratio", "duration"]);
    for (const [key, value] of Object.entries(p)) if (present(value) && !accepted.has(key)) add(`parameters.${key}`, `狼帧当前接口资料没有声明 ${key} 字段，不能静默忽略或猜测发送`, "unsupported_parameter");
    const raw = record(model?.metadata?.rawParams) ? model.metadata.rawParams : {};
    for (const [key, value] of Object.entries(parameters)) {
      if (["image", "media"].includes(key)) continue;
      if (key === "n" || key === "duration") {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) add(`parameters.${key}`, `${key} 必须为正整数`);
      } else if (typeof value !== "string") add(`parameters.${key}`, `${key} 必须为字符串`);
    }
    for (const [key, source] of [["resolution", "resolutions"], [image ? "aspect_ratio" : "ratio", "ratios"], ["duration", "durations"]] as const) {
      const allowed = raw[source];
      if ((present(parameters[key]) || key === "ratio" && !image && parameters[key] === "auto") && Array.isArray(allowed) && allowed.length && !allowed.includes(parameters[key])) add(`parameters.${key}`, `此完整型号的 ${key} 只允许 ${allowed.join(" / ")}；原值保留`, "invalid_enum");
    }
    if (image) {
      for (const key of ["n", "width", "height"]) if (p[key] === "auto")
        add(`parameters.${key}`, `${key} 必须为正整数，不能使用字符串 auto；原值保留`);
      if (present(p.width) !== present(p.height)) add("parameters.size", "独立 W/H 必须同时填写");
      if (present(p.width) || present(p.height)) {
        if (![p.width, p.height].every(value => typeof value === "number" && Number.isSafeInteger(value) && value > 0)) add("parameters.size", "W/H 必须为正整数像素；供应商未公布额外范围或步长");
        if (present(p.size) && p.size !== parameters.size) add("parameters.size", "size 与独立 W/H 不一致，请明确尺寸；原值保留");
      }
      if (present(parameters.size) && (typeof parameters.size !== "string" || !/^\d+x\d+$/iu.test(parameters.size) || parameters.size.split(/x/iu).some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 1))) add("parameters.size", "图片 size 请填写明确的 WIDTHxHEIGHT；档位使用 resolution 字段");
    } else {
      if (!present(parameters.resolution)) add("parameters.resolution", "视频接口必须指定此型号支持的分辨率");
      if (!present(parameters.duration)) add("parameters.duration", "视频接口必须指定整数时长");
    }
    const assets = request.assets ?? [], counts = { image: 0, video: 0, audio: 0 };
    for (const asset of assets) {
      counts[asset.kind]++;
      if (asset.role === "mask") add("assets", "狼帧未声明蒙版字段，不能把蒙版当参考图发送", "unsupported_mask");
      if ((asset.role === "firstFrame" || asset.role === "lastFrame") && (image || asset.kind !== "image"))
        add("assets", "首尾帧角色只能用于视频的原始图片素材，不能转换成普通参考素材", "invalid_frame_role");
      if (image && asset.kind !== "image") add("assets", "图片接口只能接收参考图片");
      if (!asset.data?.length && !asset.url) add("assets", "参考素材缺少原始字节或 URL");
      if (!image && !await publicReferenceUrl(asset.url) && !(this.options.uploadReference && (asset.data?.length || asset.url?.startsWith("data:"))))
        add("assets", "视频参考素材需要安全的公开 HTTPS URL 或可通过狼帧站点会话上传的本地字节", "invalid_public_media_url");
    }
    if ((request.operation === "image.edit" || request.operation === "video.image-to-video" || model?.limits?.requiresInputImage) && !counts.image) add("assets", "此操作需要参考图片");
    if (image && counts.image > 1) add("assets", "狼帧目录声明多图参考，但公共 v1 文档与官方插件仅明确 image 为单个 data URL；多图字段映射尚未公布，原素材保留且生成尚未提交", "undeclared_multi_image_transport");
    for (const [kind, maximum] of [["image", model?.limits?.maxInputImages ?? raw.maxImages], ["video", model?.limits?.maxInputVideos ?? raw.maxVideos], ["audio", model?.limits?.maxInputAudios ?? raw.maxAudios]] as const)
      if (typeof maximum === "number" && counts[kind] > maximum) add("assets", `当前完整型号最多接收 ${maximum} 个${kind}素材`);
    const totalMax = model?.limits?.maxInputAssets ?? raw.maxReferences;
    if (typeof totalMax === "number" && assets.length > totalMax) add("assets", `当前完整型号参考素材合计最多 ${totalMax} 个`);
    if (!counts.video && !counts.audio && typeof raw.maxImageOnly === "number" && counts.image > raw.maxImageOnly) add("assets", `此型号仅图片参考时最多 ${raw.maxImageOnly} 张`);
    if (model?.limits?.maxOutputImages !== undefined && Number(parameters.n) > model.limits.maxOutputImages) add("parameters.n", `此型号最多输出 ${model.limits.maxOutputImages} 张`);
    if (model?.limits?.requiresInputVideo && !counts.video) add("assets", "此完整型号需要参考视频");
    for (const [kind, maximum] of [["video", model?.limits?.maxInputVideoDurationSeconds], ["audio", model?.limits?.maxInputAudioDurationSeconds]] as const) {
      const selected = assets.filter(asset => asset.kind === kind);
      if (typeof maximum !== "number" || !selected.length) continue;
      if (selected.some(asset => typeof asset.durationSeconds !== "number" || !Number.isFinite(asset.durationSeconds) || asset.durationSeconds <= 0)) add("assets", `此完整型号限制参考${kind}时长；请提供可读取实际时长的素材`, "unknown_media_duration");
      else if (selected.some(asset => asset.durationSeconds! > maximum)) add("assets", `此完整型号每段参考${kind}最长 ${maximum} 秒`, "media_duration_exceeded");
    }
    if (!image && /参考视频(?:总时长不得|不能)超过输出时长/u.test(String(raw.desc ?? "")) && counts.video) {
      const videos = assets.filter(asset => asset.kind === "video");
      if (videos.some(asset => typeof asset.durationSeconds !== "number" || !Number.isFinite(asset.durationSeconds) || asset.durationSeconds <= 0)) add("assets", "此完整型号需要核对参考视频总时长，请提供可读取实际时长的素材", "unknown_media_duration");
      else if (videos.reduce((sum, asset) => sum + asset.durationSeconds!, 0) > Number(parameters.duration)) add("assets", "此完整型号参考视频总时长不能超过请求输出时长", "reference_video_longer_than_output");
    }
    // The public v1 guide supplies reference_image, but no independent first/last-frame role field.
    if (assets.some(asset => asset.role === "firstFrame" || asset.role === "lastFrame") && !(raw.requestFormat === "image-to-video" && assets.length === 1 && assets[0]?.role === "firstFrame"))
      add("assets", "狼帧此 v1 接口未公布独立首尾帧角色映射，请按普通参考素材提交；不能静默丢失角色", "undeclared_frame_role");
    return { valid: !issues.length, issues };
  }

  private transport(resolver = this.connections, config?: RestConnectorConfig) {
    const { uploadReference: _upload, ...options } = this.options;
    return new GenericRestAdapter(resolver, { ...options, ...(config ? { config } : {}) });
  }

  async submit(request: NormalizedRequest): Promise<ProviderTask> {
    assertValidResult(await this.validate(request));
    const connection = await this.connections.resolve(request.connectionId), image = imageOperation(request), parameters = langframeParameters(request);
    const assets = request.assets ?? [];
    if (image && assets.length) {
      // Official public client.py sends one image as a string. Its website's
      // separate /api/images/tasks accepts arrays, which does not establish an
      // array contract for this public /v1/images/generations endpoint.
      const asset = assets[0]!, blob = await assetToBlob(asset, this.fetchImpl);
      parameters.image = `data:${blob.type || asset.mimeType};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
    } else if (!image && assets.length) {
      const urls = new Map(distinctAssetSources(assets).map(asset => [asset.id, (async () => {
        const url = await publicReferenceUrl(asset.url) ?? (this.options.uploadReference ? await this.options.uploadReference(request.connectionId, asset) : undefined);
        const verified = await publicReferenceUrl(url);
        if (!verified) throw new MaterialPreparationError("verify", { detail: "狼帧素材上传没有返回公开 HTTPS URL" });
        return verified;
      })()]));
      parameters.media = await Promise.all(assets.map(async asset => {
        return { type: asset.kind === "image" ? "reference_image" : asset.kind === "video" ? "reference_video" : "audio", url: await urls.get(asset.id)! };
      }));
    }
    const clientTaskId = `lf-${createHash("sha256").update(`${request.connectionId}\0${request.idempotencyKey}`).digest("hex")}`;
    const config = langframeConnector(image ? "image" : "video", clientTaskId);
    let task: ProviderTask;
    try { task = await this.transport(this.connections, config).submit({ ...request, parameters }); }
    catch (error) {
      // A cloud checkpoint owns its own durable identity. Do not replace it with
      // the native fallback ID after losing the cloud service's acceptance.
      if (providerSubmitTransportActive() || !(error instanceof ProviderHttpError) || !error.details.submissionMayHaveOccurred) throw error;
      // The official plugin lets the caller supply/query this task ID. Keep that receipt
      // after a lost POST response and recover with GET only, never repeat generation.
      task = { providerTaskId: clientTaskId, id: clientTaskId, status: "running", ...(config.pollIntervalMs ? { pollAfterMs: config.pollIntervalMs } : {}),
        result: { connectionId: request.connectionId, baseUrl: origin(connection), config, model: request.model, taskId: clientTaskId,
          remote: error.details.responseBody ?? {}, status: "running", submissionUncertain: true, submissionError: error.message,
          ...(error.details.upstreamRequestEvidence ? { upstreamRequestEvidence: error.details.upstreamRequestEvidence } : {}) } };
    }
    return this.completedTask(request, task);
  }

  async restoreCloudTask(request: NormalizedRequest, response: unknown): Promise<ProviderTask> {
    const config = langframeConnector(imageOperation(request) ? "image" : "video");
    return this.completedTask(request, await this.transport(this.connections, config).restoreCloudTask(request, response));
  }

  private async completedTask(request: NormalizedRequest, original: ProviderTask): Promise<ProviderTask> {
    let task = original;
    const clientTaskId = `lf-${createHash("sha256").update(`${request.connectionId}\0${request.idempotencyKey}`).digest("hex")}`;
    const envelope = record(task.result) ? task.result : {};
    const outputs = await this.extractOutputs({ ...envelope, langframe: true });
    let status = taskStatus(envelope.remote, task.status);
    if (outputs.length && status !== "failed" && status !== "cancelled") status = "succeeded";
    if (task.providerTaskId.startsWith("rest:sync:") && !outputs.length && status !== "failed") {
      task = { ...task, providerTaskId: clientTaskId, id: clientTaskId };
      envelope.taskId = clientTaskId; envelope.submissionUncertain = true; status = "running";
    }
    return { ...task, status, ...(status === "failed" ? { error: remoteError(envelope.remote) ?? "狼帧任务失败" } : {}),
      result: { ...envelope, status, langframe: true } };
  }

  async poll(task: ProviderTask): Promise<NormalizedTaskState> {
    if (!record(task.result) || task.result.langframe !== true || typeof task.result.connectionId !== "string" || typeof task.result.baseUrl !== "string") throw new Error("狼帧任务缺少原始查询身份，不能重新提交");
    if (task.status === "succeeded" || task.status === "failed" || task.status === "cancelled") return task;
    const envelope = task.result;
    const taskId = getProviderTaskId(task);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(taskId) || typeof envelope.taskId === "string" && envelope.taskId !== taskId)
      throw new Error("狼帧原任务编号无效或与保存的身份不一致；禁止查询其他路径或重新生成");
    const kind = record(envelope.config) && record(envelope.config.output) ? envelope.config.output.kind : undefined;
    if (kind !== "image" && kind !== "video") throw new Error("狼帧原任务缺少图片或视频查询合同；禁止重新生成");
    const readContract = langframeConnector(kind);
    const frozenTask = { ...task, result: { ...envelope, config: { ...(envelope.config as Record<string, unknown>),
      poll: readContract.poll, allowedHosts: readContract.allowedHosts, statusMap: readContract.statusMap } } };
    const original = origin({ id: envelope.connectionId as string, provider: "langframe", baseUrl: envelope.baseUrl as string });
    const resolver: ProviderConnectionResolver = { resolve: async id => ({ ...await this.connections.resolve(id), ...(id === envelope.connectionId ? { baseUrl: original } : {}) }) };
    let state: NormalizedTaskState;
    try { state = await this.transport(resolver).poll(frozenTask); }
    catch (error) {
      if (envelope.submissionUncertain && error instanceof ProviderHttpError && error.details.status === 404)
        throw new ProviderHttpError(`狼帧原任务 ${getProviderTaskId(task)} 暂未查询到；仅继续查询原任务，不重新生成`, { ...error.details, retryable: true });
      throw error;
    }
    const result = record(state.result) ? state.result : {}, outputs = await this.extractOutputs(result);
    let status = taskStatus(result.remote, state.status);
    if (outputs.length && status !== "failed" && status !== "cancelled") status = "succeeded";
    if (status === "succeeded" && !outputs.length) throw new ProviderHttpError("狼帧原任务报告完成但没有媒体结果；请继续核对原任务，不重新生成", {
      kind: "invalid_response", phase: "poll", retryable: true, submissionMayHaveOccurred: false, responseBody: result.remote,
    });
    return { ...state, status, ...(status === "failed" ? { error: remoteError(result.remote) ?? state.error ?? "狼帧任务失败" } : {}), result: { ...result, langframe: true, status } };
  }

  async extractOutputs(result: unknown): Promise<RemoteArtifact[]> {
    if (!record(result) || !record(result.config) || !record(result.config.output)) return [];
    const remote = record(result.remote) ? result.remote : {}, task = record(remote.task) ? remote.task : remote;
    const base = typeof result.baseUrl === "string" ? result.baseUrl : undefined;
    if (result.config.output.kind === "video") {
      const url = [task.download_url, task.video_url, task.downloadUrl, task.videoUrl, remote.download_url, remote.video_url, remote.downloadUrl, remote.videoUrl].map(value => publicUrl(value, base)).find(Boolean);
      return url ? [{ kind: "video", url }] : [];
    }
    for (const candidate of [task.images, task.data, remote.images, remote.data]) {
      const values = Array.isArray(candidate) ? candidate : record(candidate) ? candidate.images ?? candidate.data : undefined;
      if (!Array.isArray(values) || !values.length) continue;
      const outputs: RemoteArtifact[] = [];
      for (const value of values) {
        const item: Record<string, unknown> = record(value) ? value : { url: value };
        const urlValue = record(item.image_url) ? item.image_url.url : item.url ?? item.image_url;
        const dataUrl = typeof urlValue === "string" ? parseDataUrl(urlValue) : undefined;
        const encoded = typeof item.b64_json === "string" ? item.b64_json : undefined;
        const inline = encoded?.startsWith("data:") ? parseDataUrl(encoded) : dataUrl;
        if (inline) outputs.push({ kind: "image", data: new Uint8Array(inline.data), mimeType: inline.mimeType });
        else if (encoded && /^[A-Za-z0-9+/\r\n]+={0,2}$/u.test(encoded)) outputs.push({ kind: "image", data: new Uint8Array(Buffer.from(encoded, "base64")), ...(typeof item.mime_type === "string" ? { mimeType: item.mime_type } : {}) });
        else { const url = publicUrl(urlValue, base); if (url) outputs.push({ kind: "image", url, ...(typeof item.mime_type === "string" ? { mimeType: item.mime_type } : {}) }); }
      }
      if (outputs.length) return outputs;
    }
    return [];
  }
}
