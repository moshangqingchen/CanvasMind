import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type {
  ModelDescriptor, NormalizedRequest, NormalizedTaskState, ProviderAdapter,
  ProviderConnectionResolver, ProviderTask, ProviderTaskStatus, RemoteArtifact,
  ResolvedProviderConnection, ValidationIssue, ValidationResult,
} from "./contracts.js";
import { assertValidResult, getProviderTaskId } from "./contracts.js";
import { imageEditingConnection, imageEditingRequestIssues, imageReferenceAssets } from "./image-editing-capabilities.js";
import {
  configFingerprint, parseCliConnectorConfig, parseCliModelCatalog, validateModelParameters,
  type CliAction, type CliBridgeRequest, type CliConnectorConfig,
} from "./cli-contracts.js";

export const MOCK_CLI_SCRIPT_PATH = fileURLToPath(new URL("../examples/mock-cli.mjs", import.meta.url));
const MAX_PROCESS_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const statuses = new Set<ProviderTaskStatus>(["queued", "running", "succeeded", "failed", "cancelled"]);

export class CliActionRequiredError extends Error {
  public readonly code = "CLI_ACTION_REQUIRED";
  public readonly providerTaskId?: string;
  public constructor(message: string, providerTaskId?: string) {
    super(message);
    this.name = "CliActionRequiredError";
    if (providerTaskId) this.providerTaskId = providerTaskId;
  }
}

export class CliBridgeError extends Error {
  public constructor(public readonly code: string, message: string) { super(message); this.name = "CliBridgeError"; }
}

export interface CliProviderAdapterOptions { jobRoot: string; maxOutputBytes?: number; }
export interface CliConnectionCheck { ready: boolean; loginRequired?: boolean; message?: string; supportsCancel: boolean; }

interface CliTaskEnvelope {
  cli: { connectionId: string; jobKey: string; submittedAt: string; configFingerprint: string; supportsCancel: boolean };
  remote: Record<string, unknown>;
}
interface JobManifest {
  version: 1;
  connectionId: string;
  jobKey: string;
  configFingerprint: string;
  submittedAt: string;
  supportsCancel: boolean;
  phase: "preparing" | "submitting" | "rejected" | "submitted" | "archived";
  trackingStopped?: boolean;
  taskId?: string;
  remote?: Record<string, unknown>;
}

/** Connection + idempotency key are the only job path inputs; remote task ids never become paths. */
export function cliJobKey(connectionId: string, idempotencyKey: string): string {
  return createHash("sha256").update(connectionId).update("\0").update(idempotencyKey).digest("hex");
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Redact diagnostics before they can reach job history or the canvas. */
export function redactCliDiagnostic(message: string, config?: CliConnectorConfig): string {
  let result = message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [已隐藏]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|password|cookie|secret)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[已隐藏]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[已隐藏]@")
    .replace(/\b(?:sk|sess|key)-[a-zA-Z0-9_-]{8,}\b/g, "[已隐藏]");
  for (const value of config?.args ?? []) {
    if (value.length >= 4) result = result.split(value).join("[启动参数已隐藏]");
  }
  return result.slice(0, 600);
}

/** Keep the user's CLI login environment while excluding application secrets and Node preload hooks. */
export function cliProcessEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const filtered = { ...environment };
  for (const key of Object.keys(filtered)) {
    if (/^(?:MASTER_KEY(?:_|$)|SUPERCANVAS_|SUPER_CANVAS_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$|ELECTRON_RUN_AS_NODE$)/i.test(key)) delete filtered[key];
  }
  return filtered;
}

function assertConfigured(config: CliConnectorConfig): void {
  if (!config.executable) throw new CliBridgeError("CLI_UNCONFIGURED", "尚未配置 CLI 程序，请先在个人 AI 网站中接入");
  if (!isAbsolute(config.executable)) throw new CliBridgeError("CLI_INVALID_EXECUTABLE", "CLI 程序必须使用完整绝对路径");
  if (config.cwd && !isAbsolute(config.cwd)) throw new CliBridgeError("CLI_INVALID_CWD", "CLI 工作目录必须使用完整绝对路径");
  if (/\.(cmd|bat|ps1|sh)$/i.test(config.executable)) throw new CliBridgeError("CLI_INVALID_EXECUTABLE", "请填写可执行程序路径，并将脚本路径放入固定启动参数");
}

/** Exactly one JSON request on stdin and one bounded JSON response on stdout. No shell is involved. */
export async function executeCliBridge(
  config: CliConnectorConfig, request: CliBridgeRequest, maxOutputBytes = MAX_PROCESS_BYTES,
): Promise<Record<string, unknown>> {
  assertConfigured(config);
  const timeoutMs = request.action === "submit" ? config.submitTimeoutMs : config.commandTimeoutMs;
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_PROCESS_BYTES) throw new CliBridgeError("CLI_INPUT_LIMIT", "CLI 请求超出大小限制");
  return await new Promise((fulfill, reject) => {
    const child = spawn(config.executable, config.args, {
      shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: cliProcessEnvironment(), ...(config.cwd ? { cwd: config.cwd } : {}),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const finish = (error?: Error, data?: Record<string, unknown>): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); } else fulfill(data ?? {});
    };
    const timer = setTimeout(() => finish(new CliBridgeError("CLI_TIMEOUT", `CLI ${request.action} 执行超时`)), timeoutMs);
    const consume = (chunk: Buffer, destination: Buffer[]): void => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { finish(new CliBridgeError("CLI_OUTPUT_LIMIT", "CLI 输出超出大小限制")); return; }
      destination.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, stdout));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, stderr));
    child.on("error", (error: NodeJS.ErrnoException) => finish(new CliBridgeError("CLI_PROCESS_ERROR", error.code === "ENOENT" ? "找不到 CLI 程序或工作目录，请检查连接配置" : `CLI 程序无法启动（${error.code ?? "未知错误"}）`)));
    child.stdin.on("error", () => { /* EPIPE is diagnosed by close / error without exposing request data. */ });
    child.on("close", code => {
      if (done) return;
      if (code !== 0) {
        const detail = redactCliDiagnostic(Buffer.concat(stderr).toString("utf8"), config);
        finish(new CliBridgeError("CLI_EXIT", `CLI 异常退出（${code ?? "被终止"}）${detail ? `：${detail}` : ""}`));
        return;
      }
      let response: unknown;
      try { response = JSON.parse(Buffer.concat(stdout).toString("utf8")); }
      catch { finish(new CliBridgeError("CLI_INVALID_JSON", "CLI 必须在标准输出返回单个 JSON 响应；诊断请写入标准错误")); return; }
      if (!record(response) || response.version !== 1 || typeof response.ok !== "boolean") {
        finish(new CliBridgeError("CLI_PROTOCOL", "CLI 响应不符合桥接协议 v1")); return;
      }
      if (!response.ok) {
        const error = record(response.error) ? response.error : {};
        finish(new CliBridgeError(typeof error.code === "string" ? error.code : "CLI_ERROR", redactCliDiagnostic(typeof error.message === "string" ? error.message : "CLI 操作失败", config)));
      } else if (!record(response.data)) finish(new CliBridgeError("CLI_PROTOCOL", "CLI 响应 data 必须是对象"));
      else finish(undefined, response.data);
    });
    child.stdin.end(input + "\n");
  });
}

export class CliProviderAdapter implements ProviderAdapter {
  public readonly jobRoot: string;
  private readonly maxOutputBytes: number;
  public constructor(private readonly connections: ProviderConnectionResolver, options: CliProviderAdapterOptions) {
    this.jobRoot = resolve(options.jobRoot);
    this.maxOutputBytes = options.maxOutputBytes ?? MAX_PROCESS_BYTES;
  }

  private async connection(id: string): Promise<{ connection: ResolvedProviderConnection; config: CliConnectorConfig }> {
    const connection = await this.connections.resolve(id);
    if (connection.provider !== "cli") throw new Error("连接不是个人 AI 网站 CLI");
    return { connection, config: parseCliConnectorConfig(connection.settings?.cli) };
  }

  private call(config: CliConnectorConfig, connectionId: string, action: CliAction, extra: Partial<CliBridgeRequest> = {}): Promise<Record<string, unknown>> {
    return executeCliBridge(config, { version: 1, action, requestId: randomUUID(), context: { connectionId }, ...extra }, this.maxOutputBytes);
  }

  public async checkConnection(connectionId: string): Promise<CliConnectionCheck> {
    const { config } = await this.connection(connectionId);
    try {
      const result = await this.call(config, connectionId, "test");
      return {
        ready: result.ready === true,
        ...(result.loginRequired === true ? { loginRequired: true } : {}),
        ...(typeof result.message === "string" ? { message: redactCliDiagnostic(result.message, config) } : {}),
        supportsCancel: result.supportsCancel === true,
      };
    } catch (error) {
      if (error instanceof CliBridgeError && error.code === "LOGIN_REQUIRED") return { ready: false, loginRequired: true, message: error.message, supportsCancel: false };
      throw error;
    }
  }

  public async testConnection(connectionId: string): Promise<void> {
    const check = await this.checkConnection(connectionId);
    if (!check.ready) throw new CliBridgeError(check.loginRequired ? "LOGIN_REQUIRED" : "CLI_NOT_READY", check.message ?? "CLI 尚未就绪，请先在对应网站工具中登录");
  }

  public async describe(connectionId: string): Promise<{ models: ModelDescriptor[]; supportsCancel: boolean }> {
    const { config } = await this.connection(connectionId);
    const response = await this.call(config, connectionId, "describe");
    return { models: parseCliModelCatalog(response.models), supportsCancel: response.supportsCancel === true };
  }

  public async listModels(connectionId: string): Promise<ModelDescriptor[]> {
    const { connection } = await this.connection(connectionId);
    return parseCliModelCatalog(connection.settings?.modelCatalogModels ?? []);
  }

  public async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const { connection, config } = await this.connection(request.connectionId);
    const issues: ValidationIssue[] = [];
    issues.push(...imageEditingRequestIssues(imageEditingConnection(connection), request));
    if (!config.enabled) issues.push({ path: "connectionId", code: "disabled", message: "此个人 AI 网站连接已停用" });
    try { assertConfigured(config); } catch (error) { issues.push({ path: "connectionId", code: "unconfigured", message: error instanceof Error ? error.message : "CLI 配置无效" }); }
    const status = connection.settings?.cliStatus;
    if (!record(status) || status.state !== "ready" || status.configFingerprint !== configFingerprint(config))
      issues.push({ path: "connectionId", code: "not_ready", message: "请先检测连接；程序或账号配置变更后需要重新检测" });
    const models = await this.listModels(request.connectionId);
    const model = models.find(candidate => candidate.id === request.model);
    if (!model) issues.push({ path: "model", code: "unknown_model", message: "请先同步模型与参数，再选择有效模型" });
    else {
      if (!model.operations.includes(request.operation)) issues.push({ path: "operation", code: "unsupported_operation", message: "该 CLI 模型不支持当前生成操作" });
      issues.push(...validateModelParameters(model, request.parameters ?? {}, request.operation).issues);
      if (model.limits?.maxPromptCharacters !== undefined && request.prompt.length > model.limits.maxPromptCharacters)
        issues.push({ path: "prompt", code: "too_long", message: "提示词超出模型长度限制" });
      const assets = imageReferenceAssets(request.assets);
      const limits = model.limits;
      for (const [kind, maximum] of [["image", limits?.maxInputImages], ["video", limits?.maxInputVideos], ["audio", limits?.maxInputAudios]] as const) {
        const count = assets.filter(asset => asset.kind === kind).length;
        if (maximum !== undefined && count > maximum) issues.push({ path: "assets", code: "too_many_assets", message: `${kind} 参考素材超过模型限制 ${maximum}` });
        const declaredInputs = model.inputKinds ?? ["text"];
        if (count > 0 && !declaredInputs.includes(kind) && !declaredInputs.includes(`${kind}[]`)) issues.push({ path: "assets", code: "unsupported_asset", message: `此模型未声明支持 ${kind} 素材` });
      }
      if (limits?.maxInputAssets !== undefined && assets.length > limits.maxInputAssets) issues.push({ path: "assets", code: "too_many_assets", message: "参考素材总数超过模型限制" });
      if ((limits?.requiresInputImage || request.operation === "image.edit" || request.operation === "video.image-to-video") && !assets.some(asset => asset.kind === "image")) issues.push({ path: "assets", code: "image_required", message: "此操作需要输入图片" });
      if (limits?.requiresInputVideo && !assets.some(asset => asset.kind === "video")) issues.push({ path: "assets", code: "video_required", message: "此模型需要输入视频" });
      for (const asset of assets) {
        if (limits?.supportedMimeTypes && !limits.supportedMimeTypes.includes(asset.mimeType)) issues.push({ path: "assets", code: "unsupported_mime", message: "素材格式不在模型支持列表中" });
        const declaredRoles = model.metadata?.inputRoles;
        const roles = Array.isArray(declaredRoles) ? declaredRoles : ["reference"];
        if (!roles.includes(asset.role ?? "reference")) issues.push({ path: "assets", code: "unsupported_role", message: `此模型不支持 ${asset.role ?? "reference"} 素材角色` });
      }
    }
    return { valid: !issues.length, issues };
  }

  private jobDirectory(jobKey: string): string {
    if (!/^[a-f0-9]{64}$/.test(jobKey)) throw new CliActionRequiredError("CLI 任务目录标识无效，请检查任务记录");
    return join(this.jobRoot, jobKey);
  }

  private async save(manifest: JobManifest): Promise<void> {
    const directory = this.jobDirectory(manifest.jobKey);
    const temporary = join(directory, `manifest-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(manifest), { mode: 0o600 });
    await rename(temporary, join(directory, "manifest.json"));
  }

  private async read(jobKey: string, connectionId: string): Promise<JobManifest> {
    const directory = this.jobDirectory(jobKey);
    let manifest: unknown;
    try {
      const realRoot = await realpath(this.jobRoot);
      const realDirectory = await realpath(directory);
      if (!inside(realRoot, realDirectory)) throw new Error("outside");
      const manifestPath = await realpath(join(directory, "manifest.json"));
      if (!inside(realDirectory, manifestPath)) throw new Error("outside");
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch { throw new CliActionRequiredError("找不到可信的 CLI 本机任务记录；请检查任务，不能自动重新提交"); }
    if (!record(manifest) || manifest.version !== 1 || manifest.jobKey !== jobKey || manifest.connectionId !== connectionId || typeof manifest.submittedAt !== "string" || typeof manifest.configFingerprint !== "string")
      throw new CliActionRequiredError("CLI 本机任务记录不匹配，不能自动重新提交");
    return manifest as unknown as JobManifest;
  }

  private task(manifest: JobManifest, config?: CliConnectorConfig): ProviderTask {
    if (!manifest.taskId || !manifest.remote) throw new CliActionRequiredError("上次 CLI 提交结果尚不确定，请先在网站中核查，不能自动重新生成", manifest.taskId);
    const status = typeof manifest.remote.status === "string" && statuses.has(manifest.remote.status as ProviderTaskStatus) ? manifest.remote.status as ProviderTaskStatus : "queued";
    const result: CliTaskEnvelope = {
      cli: { connectionId: manifest.connectionId, jobKey: manifest.jobKey, submittedAt: manifest.submittedAt, configFingerprint: manifest.configFingerprint, supportsCancel: manifest.supportsCancel },
      remote: manifest.remote,
    };
    return { id: manifest.taskId, providerTaskId: manifest.taskId, status, result,
      ...(config ? { pollAfterMs: config.pollIntervalMs } : {}),
      ...(typeof manifest.remote.error === "string" ? { error: redactCliDiagnostic(manifest.remote.error, config) } : {}),
    };
  }

  public async restoreTask(connectionId: string, idempotencyKey: string, providerTaskId?: string): Promise<ProviderTask> {
    const manifest = await this.read(cliJobKey(connectionId, idempotencyKey), connectionId);
    if (providerTaskId && manifest.taskId !== providerTaskId) throw new CliActionRequiredError("CLI 任务 ID 与本机记录不匹配", providerTaskId);
    const { config } = await this.connection(connectionId);
    return this.task(manifest, config);
  }

  private async prepareAssets(request: NormalizedRequest, jobDirectory: string): Promise<NonNullable<CliBridgeRequest["request"]>["assets"]> {
    const inputDirectory = join(jobDirectory, "input");
    await mkdir(inputDirectory, { recursive: true });
    const inputs: Array<NonNullable<CliBridgeRequest["request"]>["assets"][number]> = [];
    for (const [index, asset] of (request.assets ?? []).entries()) {
      if (asset.role === "mask") throw new Error("当前 CLI 接口未确认支持蒙版编辑");
      const extension = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/wav": ".wav" } as Record<string, string>)[asset.mimeType] ?? ".bin";
      const path = join(inputDirectory, `${index}${extension}`);
      if (asset.data) {
        if (asset.data.length > MAX_ASSET_BYTES) throw new Error("CLI 输入素材超出大小限制");
        await writeFile(path, asset.data, { mode: 0o600 });
      } else if (asset.url) {
        const url = new URL(asset.url);
        if (!["http:", "https:", "data:"].includes(url.protocol)) throw new Error("CLI 输入素材仅支持 HTTP(S) 地址或已有文件数据");
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok || !response.body) throw new Error("无法准备 CLI 输入素材");
        let bytes = 0;
        const limit = new Transform({ transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          done(bytes > MAX_ASSET_BYTES ? new Error("CLI 输入素材超出大小限制") : null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), limit, createWriteStream(path, { mode: 0o600 }));
      } else throw new Error("CLI 输入素材缺少数据或下载地址");
      inputs.push({ id: asset.id, kind: asset.kind, mimeType: asset.mimeType, path, ...(asset.role ? { role: asset.role } : {}) });
    }
    return inputs;
  }

  public async submit(request: NormalizedRequest): Promise<ProviderTask> {
    const jobKey = cliJobKey(request.connectionId, request.idempotencyKey);
    const directory = this.jobDirectory(jobKey);
    const { connection, config } = await this.connection(request.connectionId);
    await mkdir(this.jobRoot, { recursive: true });
    let retryingRejected = false;
    try {
      await stat(directory);
      const previous = await this.read(jobKey, request.connectionId);
      if (previous.phase !== "rejected") return this.task(previous, config);
      retryingRejected = true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    assertValidResult(await this.validate(request));
    const manifest: JobManifest = {
      version: 1, connectionId: request.connectionId, jobKey, configFingerprint: configFingerprint(config),
      submittedAt: new Date().toISOString(), supportsCancel: record(connection.settings?.cliStatus) && connection.settings.cliStatus.supportsCancel === true,
      phase: "preparing",
    };
    if (retryingRejected) {
      // Only a confirmed rejection can be retried. The filesystem claim also protects
      // callers in independent processes; preparing/submitting are never reclaimed.
      const claim = join(directory, "retry-claim");
      try { await mkdir(claim); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CliActionRequiredError("此 CLI 任务正在重试，请等待现有提交完成");
        throw error;
      }
      try {
        const current = await this.read(jobKey, request.connectionId);
        if (current.phase !== "rejected") return this.task(current, config);
        await this.save(manifest);
      } finally { await rmdir(claim); }
    } else {
      try { await mkdir(directory); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return this.task(await this.read(jobKey, request.connectionId), config);
      }
      await this.save(manifest);
    }
    const outputDirectory = join(directory, "output");
    await mkdir(outputDirectory, { recursive: true });
    const assets = await this.prepareAssets(request, directory);
    manifest.phase = "submitting";
    await this.save(manifest);
    let response: Record<string, unknown>;
    try {
      response = await this.call(config, request.connectionId, "submit", {
        context: { connectionId: request.connectionId, jobDirectory: directory, outputDirectory },
        request: { operation: request.operation, model: request.model!, prompt: request.prompt,
          parameters: request.parameters ?? {}, idempotencyKey: request.idempotencyKey, assets },
      });
      if (typeof response.taskId !== "string" || !response.taskId.trim() || response.taskId.length > 4096)
        throw new Error("CLI submit 没有返回可持久化的 taskId");
      const taskId = response.taskId;
      // Preserve a valid task id even when subsequent status/output metadata is malformed.
      manifest.taskId = taskId;
      manifest.remote = { taskId, status: "queued" };
      manifest.phase = "submitted";
      await this.save(manifest);
      response = this.validateTaskResponse(response, config);
      manifest.remote = response;
      await this.save(manifest);
    } catch (error) {
      if (!manifest.taskId && error instanceof CliBridgeError && ["LOGIN_REQUIRED", "INVALID_PARAMETERS", "CLI_UNCONFIGURED", "CLI_INVALID_EXECUTABLE", "CLI_INVALID_CWD", "CLI_PROCESS_ERROR"].includes(error.code)) {
        manifest.phase = "rejected";
        await this.save(manifest);
        throw error;
      }
      throw new CliActionRequiredError(`CLI 提交结果不确定，请核查网站任务后处理，系统不会自动重新生成。${redactCliDiagnostic(error instanceof Error ? error.message : "提交失败", config)}`, manifest.taskId);
    }
    return this.task(manifest, config);
  }

  private validateTaskResponse(response: Record<string, unknown>, config: CliConnectorConfig, requireStatus = false): Record<string, unknown> {
    if (requireStatus && response.status === undefined) throw new CliBridgeError("CLI_PROTOCOL", "CLI 查询必须返回任务状态");
    if (response.status !== undefined && (typeof response.status !== "string" || !statuses.has(response.status as ProviderTaskStatus))) throw new CliBridgeError("CLI_PROTOCOL", "CLI 任务状态无效");
    if (response.status === "succeeded" && (!Array.isArray(response.outputs) || !response.outputs.length)) throw new CliBridgeError("CLI_PROTOCOL", "CLI 成功任务必须返回输出文件");
    // Never persist arbitrary provider response fields (including command/login snapshots) in canvas task state.
    return {
      ...(typeof response.taskId === "string" ? { taskId: response.taskId } : {}),
      status: response.status ?? "queued",
      ...(typeof response.error === "string" ? { error: redactCliDiagnostic(response.error, config) } : {}),
      ...(typeof response.progress === "number" && Number.isFinite(response.progress) ? { progress: Math.max(0, Math.min(100, response.progress)) } : {}),
      ...(Array.isArray(response.outputs) ? { outputs: response.outputs.map(output => {
        if (!record(output)) throw new CliBridgeError("CLI_PROTOCOL", "CLI 输出描述无效");
        return Object.fromEntries(["kind", "url", "path", "mimeType", "filename"].filter(key => typeof output[key] === "string").map(key => [key, output[key]]));
      }) } : {}),
    };
  }

  private async fromTask(task: ProviderTask): Promise<JobManifest> {
    const result = task.result;
    if (!record(result) || !record(result.cli) || typeof result.cli.connectionId !== "string" || typeof result.cli.jobKey !== "string") throw new CliActionRequiredError("CLI 任务缺少本机恢复信息；不能自动重新提交", getProviderTaskId(task));
    const manifest = await this.read(result.cli.jobKey, result.cli.connectionId);
    if (manifest.taskId !== getProviderTaskId(task)) throw new CliActionRequiredError("CLI 任务 ID 与本机记录不一致", getProviderTaskId(task));
    return manifest;
  }

  public async poll(task: ProviderTask): Promise<NormalizedTaskState> {
    const manifest = await this.fromTask(task);
    const { config } = await this.connection(manifest.connectionId);
    if (manifest.remote && ["succeeded", "failed", "cancelled"].includes(String(manifest.remote.status))) return this.task(manifest, config);
    if (configFingerprint(config) !== manifest.configFingerprint) throw new CliActionRequiredError("CLI 连接配置已变更，请恢复原配置后继续查询已有任务", manifest.taskId);
    const directory = this.jobDirectory(manifest.jobKey);
    const rawResponse = await this.call(config, manifest.connectionId, "poll", {
      taskId: manifest.taskId!, context: { connectionId: manifest.connectionId, jobDirectory: directory, outputDirectory: join(directory, "output") },
    });
    const response = this.validateTaskResponse(rawResponse, config, true);
    if (response.taskId !== undefined && response.taskId !== manifest.taskId) throw new CliActionRequiredError("CLI 查询返回了不同任务 ID", manifest.taskId);
    manifest.remote = response;
    await this.save(manifest);
    return { ...this.task(manifest, config), ...(typeof response.progress === "number" && Number.isFinite(response.progress) ? { progress: Math.max(0, Math.min(100, response.progress)) } : {}) };
  }

  public async cancel(task: ProviderTask): Promise<void> {
    const manifest = await this.fromTask(task);
    if (manifest.remote?.status === "cancelled") return;
    if (manifest.remote?.status === "succeeded" || manifest.remote?.status === "failed")
      throw new CliActionRequiredError("网站任务已经结束，请继续查询以保存其真实结果", manifest.taskId);
    if (manifest.supportsCancel) {
      const { config } = await this.connection(manifest.connectionId);
      if (configFingerprint(config) !== manifest.configFingerprint) throw new CliActionRequiredError("CLI 连接配置已变更，无法取消原任务", manifest.taskId);
      const directory = this.jobDirectory(manifest.jobKey);
      const response = await this.call(config, manifest.connectionId, "cancel", { taskId: manifest.taskId!, context: { connectionId: manifest.connectionId, jobDirectory: directory, outputDirectory: join(directory, "output") } });
      if (response.taskId !== undefined && response.taskId !== manifest.taskId) throw new CliActionRequiredError("CLI 取消响应的任务 ID 不一致，请核查网站任务", manifest.taskId);
      if (response.status === undefined) throw new CliActionRequiredError("CLI 尚未确认网站任务已取消，请继续查询任务状态", manifest.taskId);
      manifest.remote = this.validateTaskResponse(response, config, true);
      await this.save(manifest);
      if (manifest.remote.status !== "cancelled") throw new CliActionRequiredError(manifest.remote.status === "succeeded" ? "网站任务已经完成，结果已保留；请继续查询以归档" : "CLI 尚未确认取消完成，请继续查询网站任务", manifest.taskId);
    }
    else manifest.trackingStopped = true;
    await this.save(manifest);
  }

  private async fromResult(result: unknown): Promise<JobManifest> {
    if (!record(result) || !record(result.cli) || typeof result.cli.connectionId !== "string" || typeof result.cli.jobKey !== "string") throw new CliActionRequiredError("CLI 输出缺少可信的本机任务记录");
    return this.read(result.cli.jobKey, result.cli.connectionId);
  }

  public async extractOutputs(result: unknown): Promise<RemoteArtifact[]> {
    const manifest = await this.fromResult(result);
    const outputs = manifest.remote?.outputs;
    if (!Array.isArray(outputs)) return [];
    const directory = this.jobDirectory(manifest.jobKey);
    const outputRoot = join(directory, "output");
    const artifacts: RemoteArtifact[] = [];
    for (const output of outputs) {
      if (!record(output) || !["image", "video"].includes(String(output.kind)) || (typeof output.url === "string") === (typeof output.path === "string")) throw new Error("CLI 输出格式无效，必须提供且仅提供 url 或 path");
      const artifact: RemoteArtifact = { kind: output.kind as "image" | "video",
        ...(typeof output.mimeType === "string" ? { mimeType: output.mimeType } : {}),
        ...(typeof output.filename === "string" ? { filename: output.filename } : {}),
      };
      if (typeof output.url === "string") {
        const url = new URL(output.url);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("CLI 输出地址必须使用 HTTP(S)");
        artifact.url = output.url;
      } else {
        const candidate = resolve(outputRoot, output.path as string);
        if (!inside(outputRoot, candidate)) throw new Error("CLI 本地输出路径超出本任务输出目录");
        if (manifest.phase !== "archived") {
          const [actualRoot, actualPath, actualDirectory] = await Promise.all([realpath(outputRoot), realpath(candidate), realpath(directory)]);
          if (!inside(actualDirectory, actualRoot) || !inside(actualRoot, actualPath)) throw new Error("CLI 本地输出真实路径超出本任务输出目录");
          if (!(await stat(actualPath)).isFile()) throw new Error("CLI 本地输出必须是普通文件");
          artifact.localFile = { path: actualPath, root: actualRoot };
        } else artifact.localFile = { path: candidate, root: outputRoot };
      }
      artifacts.push(artifact);
    }
    return artifacts;
  }

  public async cleanup(result: unknown): Promise<void> {
    const manifest = await this.fromResult(result);
    const directory = this.jobDirectory(manifest.jobKey);
    // The read above verifies the job's real directory stays within the job root.
    manifest.phase = "archived";
    await this.save(manifest);
    for (const folder of ["input", "output"]) {
      const target = join(/* turbopackIgnore: true */ directory, folder);
      if (!inside(directory, target)) throw new Error("CLI 清理路径越界");
      await rm(target, { recursive: true, force: true });
    }
  }
}
