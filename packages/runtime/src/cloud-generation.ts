import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as abortableDelay } from "node:timers/promises";
import { decryptSecret, distinctAssetSources, encryptSecret, fetchProviderJson, MaterialPreparationError, prepareMaterial, ProviderHttpError, providerFetch, verifyReferenceOriginal, withProviderSubmitTransport, type ProviderSubmitTransport, type ProviderSubmissionPhase } from "@super-canvas/providers";

export interface CloudGenerationConfig { endpoint: string; encryptedToken: string }
export interface CloudGenerationView { endpoint: string; tokenConfigured: boolean }
const key = () => process.env.MASTER_KEY || (process.env.NODE_ENV !== "production" ? "local-development-master-key" : "");
const configPath = () => join(dirname(process.env.LOCAL_DATABASE_PATH || join(process.cwd(), "data", "super-canvas.json")), "cloud-generation.json");
export function cloudEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash ||
      !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) || /\.(?:local|localhost|internal)$/i.test(url.hostname))
    throw new Error("请填写云端服务的 HTTPS 域名，不包含路径或端口");
  return url.origin;
}
export async function readCloudGenerationConfig(): Promise<CloudGenerationConfig | null> {
  try {
    const value = JSON.parse(await readFile(configPath(), "utf8")) as CloudGenerationConfig;
    if (!value || typeof value.endpoint !== "string" || typeof value.encryptedToken !== "string" || !value.encryptedToken.trim())
      throw new Error("Invalid cloud configuration");
    return { endpoint: cloudEndpoint(value.endpoint), encryptedToken: value.encryptedToken };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("云端生图配置无法读取，请重新保存");
  }
}
export function publicCloudGenerationConfig(config: CloudGenerationConfig | null): CloudGenerationView {
  return { endpoint: config?.endpoint ?? "", tokenConfigured: Boolean(config?.encryptedToken) };
}
export async function saveCloudGenerationConfig(input: { endpoint: string; token?: string }): Promise<CloudGenerationView> {
  if (!key()) throw new Error("缺少本机凭据加密配置");
  const endpoint = cloudEndpoint(input.endpoint);
  const token = input.token?.trim();
  if (token && (token.length < 32 || token.length > 4096)) throw new Error("请填写至少 32 位的云端服务访问密钥");
  // A complete replacement must also repair malformed old files. Only load
  // the previous configuration when the caller wants to retain its secret.
  const old = token ? null : await readCloudGenerationConfig();
  const encryptedToken = token ? encryptSecret(token, key()) : old?.endpoint === endpoint ? old.encryptedToken : undefined;
  if (!encryptedToken) throw new Error("请填写至少 32 位的云端服务访问密钥");
  const config = { endpoint, encryptedToken };
  await mkdir(dirname(configPath()), { recursive: true });
  const tmp = `${configPath()}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(config), { mode: 0o600 });
  await rename(tmp, configPath());
  return publicCloudGenerationConfig(config);
}
function headers(config: CloudGenerationConfig): HeadersInit {
  if (!key()) throw new Error("无法解密云端服务凭据");
  return { authorization: `Bearer ${decryptSecret(config.encryptedToken, key())}` };
}
export async function testCloudGeneration(config?: CloudGenerationConfig | null) {
  config ??= await readCloudGenerationConfig();
  if (!config) throw new Error("请先配置云端生图服务");
  const response = await providerFetch(`${config.endpoint}/v1/health`, { headers: headers(config), redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`云端服务连接失败（HTTP ${response.status}）`);
  const health = await response.json() as { service?: string; ready?: boolean; storage?: boolean };
  if (health.service !== "super-canvas-generation-v1") throw new Error("该地址不是超级画布云端生图服务");
  if (!health.ready) throw new Error(health.storage === false ? "云端后台已连接，尚未开通或绑定 R2 图片存储" : "云端后台配置尚未完成");
  return { ready: true, message: "云端后台与图片存储已连通，未调用供应商生成" };
}
export const cloudSubmissionId = (idempotencyKey: string) => `cloud:${createHash("sha256").update(`${idempotencyKey}:0`).digest("hex")}`;
export const isCloudSubmission = (id: unknown): boolean => typeof id === "string" && /^cloud:[a-f0-9]{64}$/.test(id);
export async function uploadCloudReferences(config: CloudGenerationConfig, requestKey: string, assets: readonly { id: string; data?: Uint8Array; mimeType?: string }[]): Promise<string[]> {
  const urls = new Map<string, string>();
  const sources = distinctAssetSources(assets.map(asset => ({ ...asset, kind: "image" as const, mimeType: asset.mimeType ?? "" })));
  for (const asset of sources) {
    if (!asset.data?.byteLength || !asset.mimeType?.startsWith("image/")) throw new MaterialPreparationError("read", { detail: "云端参考图缺少本地图片内容" });
    const id = createHash("sha256").update(`${requestKey}:${asset.id}`).digest("hex");
    const response = await prepareMaterial("upload", () => providerFetch(`${config.endpoint}/v1/references/${id}`, { method: "PUT", headers: { ...headers(config), "content-type": asset.mimeType }, body: new Uint8Array(asset.data!), redirect: "error", signal: AbortSignal.timeout(120_000) }));
    if (!response.ok) throw new MaterialPreparationError("upload", { detail: `云端参考图保存失败（HTTP ${response.status}）`, cause: new ProviderHttpError("云端参考图保存失败", {
      kind: "provider", phase: "prepare", status: response.status, retryable: false, submissionMayHaveOccurred: false,
    }) });
    const result = await prepareMaterial("upload", () => response.json()) as { url?: string };
    let url: URL;
    try { url = new URL(result.url ?? ""); } catch { throw new MaterialPreparationError("upload", { detail: "云端参考图地址无效" }); }
    if (url.origin !== config.endpoint) throw new MaterialPreparationError("upload", { detail: "云端参考图地址无效" });
    await verifyReferenceOriginal(url.href, { id: asset.id, mimeType: asset.mimeType, data: asset.data }, 0, { fetch: providerFetch, timeoutMs: 120_000 });
    urls.set(asset.id, url.href);
  }
  return assets.map(asset => urls.get(asset.id)!);
}
export interface CloudTransportOptions {
  fetch?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  /** Persisted before the cloud request can leave this machine. */
  checkpoint: (config: CloudGenerationConfig) => Promise<void>;
  accepted?: () => Promise<void>;
  progress?: (phase: ProviderSubmissionPhase) => Promise<void>;
  /** A restart may query existing jobs, but must never create a missing job. */
  resumeOnly?: boolean;
}
export class CloudGenerationUncertainError extends ProviderHttpError {
  public readonly cloudTaskEvidence: { jobId: string; upstreamTaskId?: string };
  public constructor(message: string, jobId: string, upstreamTaskId?: string) {
    super(message, { kind: "network", phase: "submit", retryable: false, submissionMayHaveOccurred: true });
    this.cloudTaskEvidence = { jobId, ...(upstreamTaskId ? { upstreamTaskId } : {}) };
  }
}
interface CloudJobReadOptions {
  fetch?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  progress?: (phase: ProviderSubmissionPhase) => Promise<void>;
  signal?: AbortSignal;
}
function cloudJobReader(jobId: string, config: CloudGenerationConfig, options: CloudJobReadOptions) {
  const fetchImpl = options.fetch ?? providerFetch, auth = headers(config);
  const target = `${config.endpoint}/v1/jobs/${jobId}`;
  let upstreamTaskId: string | undefined;
  const uncertain = (message: string) => new CloudGenerationUncertainError(message, jobId, upstreamTaskId);
  const requestSignal = (timeoutMs: number) => options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const delay = async (ms: number) => {
    options.signal?.throwIfAborted();
    if (options.delay) await options.delay(ms); else await abortableDelay(ms, undefined, { signal: options.signal });
    options.signal?.throwIfAborted();
  };
  const check = async () => {
    options.signal?.throwIfAborted();
    const response = await fetchImpl(target, { headers: auth, redirect: "error", signal: requestSignal(15_000) });
    if (!response.ok) void response.body?.cancel().catch(() => {});
    if (response.status === 404) return null;
    if (response.status === 410) return { state: "expired", error: "云端保存的 24 小时已到期，请检查本地已下载的素材；不会重新生成" };
    if ([401, 403].includes(response.status)) return { state: "failed", error: "云端服务凭据已失效，请修复连接后取回原任务" };
    if (!response.ok) throw new Error(`Cloud task query HTTP ${response.status}`);
    const value = await response.json() as { state: string; error?: string; phase?: string; upstreamTaskId?: unknown };
    if (typeof value.upstreamTaskId === "string" && value.upstreamTaskId.trim() && value.upstreamTaskId.length <= 1024) upstreamTaskId = value.upstreamTaskId;
    return value;
  };
  const wait = async () => {
    let lastPhase: ProviderSubmissionPhase | undefined;
    const progress = async (phase: ProviderSubmissionPhase) => { if (phase !== lastPhase) { await options.progress?.(phase); lastPhase = phase; } };
    await progress("cloud_queued");
    while (!options.signal?.aborted) {
      let status;
      try { status = await check(); } catch { await delay(3_000); continue; }
      if (!status) throw uncertain("云端原任务已过期或不存在，无法自动重发");
      if (status.state === "running") await progress(status.phase === "generating" ? "generating" : status.phase === "receiving" ? "receiving" : "waiting_provider");
      if (status.state === "received") await progress("cloud_saving");
      if (status.state === "complete") {
        await progress("downloading");
        try {
          const response = await fetchImpl(`${target}/response`, { headers: auth, redirect: "error", signal: requestSignal(120_000) });
          if (response.headers.get("x-supercanvas-response") !== "1") { void response.body?.cancel().catch(() => {}); await delay(3_000); continue; }
          return response;
        } catch { await delay(3_000); continue; }
      }
      if (["uncertain", "failed", "expired"].includes(status.state)) throw uncertain(status.error || "云端与供应商的连接中断，已保留任务，不会自动重新扣费");
      await delay(2_000);
    }
    throw uncertain("本次云端等待已结束，原任务仍可通过任务编号查询");
  };
  return { check, wait, uncertain, target, auth, fetchImpl, requestSignal };
}

/** Read an existing durable cloud identity; no adapter preparation or job PUT can run here. */
export async function queryCloudGeneration(submissionId: string, config: CloudGenerationConfig, options: CloudJobReadOptions = {}): Promise<unknown> {
  if (!isCloudSubmission(submissionId)) throw new Error("原云端任务身份无效，禁止创建新任务");
  const reader = cloudJobReader(submissionId.slice(6), config, options);
  let initial;
  try { initial = await reader.check(); } catch { throw reader.uncertain("云端任务查询暂时失败，原任务编号已保存；恢复时只查询同一任务"); }
  options.signal?.throwIfAborted();
  if (!initial) throw reader.uncertain("云端未找到原任务，为避免重复扣费已停止；请核对后再创建新任务");
  const response = await reader.wait();
  // Reuse the bounded HTTP/JSON decoder and HTTP failure classification. The
  // one-response reader performs no additional network request or supplier call.
  try {
    const body = await fetchProviderJson(async () => response, `${reader.target}/response`, { method: "GET", signal: options.signal },
      { phase: "poll", timeoutMs: 120_000, maxResponseBytes: 96 * 1024 * 1024, idempotent: true });
    const upstream = response.headers.get("x-supercanvas-upstream-task");
    return upstream ? { __superCanvasCloudPoll: decodeURIComponent(upstream), remote: body } : body;
  } catch (error) {
    if (error instanceof ProviderHttpError) { error.details.submissionMayHaveOccurred = true; delete error.details.requestNotSent; }
    throw error;
  }
}

export async function runCloudGeneration<T>(idempotencyKey: string, config: CloudGenerationConfig, work: () => Promise<T>, options: CloudTransportOptions): Promise<T> {
  let index = 0, checkpointed = false;
  const transport: ProviderSubmitTransport = async (url, init, settings) => {
    const signal = init.signal ?? undefined;
    signal?.throwIfAborted();
    const jobId = createHash("sha256").update(`${idempotencyKey}:${index++}`).digest("hex");
    const reader = cloudJobReader(jobId, config, { ...options, signal });
    if (new URL(url).protocol !== "https:") throw new Error("云端生图只支持公网 HTTPS 供应商接口");
    if (!checkpointed) { await options.checkpoint(config); checkpointed = true; }
    let status;
    try { status = await reader.check(); } catch { throw reader.uncertain("云端任务查询暂时失败，原任务编号已保存；恢复时只查询同一任务"); }
    signal?.throwIfAborted();
    if (!status) {
      if (options.resumeOnly) throw reader.uncertain("云端未找到原任务，为避免重复扣费已停止；请核对后再创建新任务");
      const request = new Request(url, { ...init, signal: undefined });
      const manifest = { url, method: request.method, headers: Object.fromEntries(request.headers),
        maxResponseBytes: Math.min(settings.maxResponseBytes ?? 50 * 1024 * 1024, 96 * 1024 * 1024), timeoutMs: 30 * 60_000,
        ...(settings.cloudPolling ? { polling: settings.cloudPolling } : {}) };
      const body = await request.arrayBuffer();
      if (body.byteLength > 64 * 1024 * 1024) throw new Error("云端生图单次请求上限 64 MB，请减少参考图体积");
      signal?.throwIfAborted();
      try {
        const response = await reader.fetchImpl(reader.target, { method: "PUT", headers: { ...reader.auth,
          "content-type": "application/octet-stream", "x-supercanvas-manifest": Buffer.from(JSON.stringify(manifest)).toString("base64") },
          body, redirect: "error", signal: reader.requestSignal(120_000) });
        void response.body?.cancel().catch(() => {});
        if (!response.ok) throw new Error(`Cloud submit HTTP ${response.status}`);
      } catch { throw reader.uncertain("提交到云端后的响应未收到，任务编号已保存；恢复只查询原任务，不重新生成"); }
    }
    await options.accepted?.();
    return reader.wait();
  };
  return withProviderSubmitTransport(transport, work);
}
