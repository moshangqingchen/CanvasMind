import { randomUUID } from "node:crypto";
import type { AssetRecord, ProviderConnectionRecord } from "@super-canvas/db";
import {
  artifactDownloadMaxBytes,
  downloadRemoteArtifact,
} from "@super-canvas/runtime";
import type {
  NormalizedRequest,
  ProviderAdapter,
  ProviderAssetInput,
  ProviderOperation,
  ProviderTask,
  RemoteArtifact,
} from "@super-canvas/providers";
import { createProviderAssetToken } from "@super-canvas/providers";
import { publicAsset, repository, runService, storage } from "./server";
import type { CorelBridgeRequest, CorelOperation } from "./corel-bridge";

export type CorelDirectJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

interface CorelDirectJob {
  id: string;
  operation: CorelOperation;
  provider: string;
  connectionId: string;
  model?: string;
  prompt: string;
  referenceAssetIds: string[];
  parameters: Record<string, string | number | boolean>;
  clientRequestId: string;
  status: CorelDirectJobStatus;
  createdAt: string;
  updatedAt: string;
  providerTask?: ProviderTask;
  outputAssetIds: string[];
  error?: string;
  cancelRequested: boolean;
}

const jobsKey = "__superCanvasCorelDirectJobs";
type JobStore = Map<string, CorelDirectJob> & {
  byClientRequest?: Map<string, string>;
};

function jobs(): JobStore {
  const scope = globalThis as typeof globalThis & { [jobsKey]?: JobStore };
  if (!scope[jobsKey]) {
    const store = new Map<string, CorelDirectJob>() as JobStore;
    store.byClientRequest = new Map<string, string>();
    scope[jobsKey] = store;
  }
  return scope[jobsKey]!;
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function timestamp(): string {
  return new Date().toISOString();
}

function recordError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.slice(0, 4_096);
}

function connectionIsUsable(connection: ProviderConnectionRecord): boolean {
  return (
    connection.config.usage !== "agent" &&
    (Boolean(connection.encryptedSecret) ||
      (Boolean(connection.config.connector) &&
        typeof connection.config.connector === "object"))
  );
}

function configuredModel(
  connection: ProviderConnectionRecord,
  listed: readonly { id: string; isDefault?: boolean }[],
  requested?: string,
): string | undefined {
  if (requested?.trim()) return requested.trim();
  const configured = connection.config.defaultModel;
  if (typeof configured === "string" && configured.trim())
    return configured.trim();
  return listed.find((model) => model.isDefault)?.id ?? listed[0]?.id;
}

function requiresPublicAssetUrls(connection: ProviderConnectionRecord): boolean {
  const connector = connection.config.connector;
  return (
    Boolean(connector) &&
    typeof connector === "object" &&
    !Array.isArray(connector) &&
    (connector as Record<string, unknown>).assetsRequirePublicUrls === true
  );
}

function providerAssetUrl(assetId: string): string {
  const base = process.env.PUBLIC_BASE_URL;
  const secret = process.env.MASTER_KEY ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : "local-development-master-key");
  if (!base || !secret)
    throw new Error(
      "该供应商的参考素材必须使用公网 URL；请先配置 PUBLIC_BASE_URL 和 MASTER_KEY",
    );
  const url = new URL(`/api/provider-assets/${encodeURIComponent(assetId)}`, base);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("PUBLIC_BASE_URL 必须是 http(s) 地址");
  url.searchParams.set("token", createProviderAssetToken({ assetId, secret }));
  return url.toString();
}

function inputAssetKind(kind: AssetRecord["kind"]): ProviderAssetInput["kind"] {
  return kind === "video" ? "video" : kind === "audio" ? "audio" : "image";
}

async function loadAssets(
  connection: ProviderConnectionRecord,
  ids: readonly string[],
): Promise<ProviderAssetInput[]> {
  const result: ProviderAssetInput[] = [];
  for (const id of ids) {
    const asset = await repository.getAsset(id);
    if (!asset || asset.deleted)
      throw new Error(`参考素材不存在或已删除：${id}`);
    const stored = await storage.get(asset.storageKey);
    if (!stored) throw new Error(`参考素材文件不存在：${id}`);
    const input: ProviderAssetInput = {
      id: asset.id,
      kind: inputAssetKind(asset.kind),
      mimeType: asset.mimeType || stored.contentType || "image/png",
      filename: asset.name,
      role: "reference",
      data: stored.bytes,
    };
    if (requiresPublicAssetUrls(connection)) input.url = providerAssetUrl(asset.id);
    result.push(input);
  }
  return result;
}

async function publicJob(job: CorelDirectJob): Promise<Record<string, unknown>> {
  return {
    jobId: job.id,
    operation: job.operation,
    status: job.status,
    provider: job.provider,
    ...(job.model ? { model: job.model } : {}),
    outputAssets: await Promise.all(job.outputAssetIds.map(publicAssetForId)),
    ...(job.error ? { error: job.error } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function publicAssetForId(id: string) {
  return publicAsset(await repository.getAsset(id));
}

async function archiveArtifact(
  artifact: RemoteArtifact,
  job: CorelDirectJob,
  outputIndex: number,
): Promise<string> {
  const kind = artifact.kind;
  let bytes = artifact.data;
  let mime = artifact.mimeType ?? (kind === "video" ? "video/mp4" : "image/png");
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
    const downloaded = await downloadRemoteArtifact(artifact.url, {
      maxBytes: artifactDownloadMaxBytes(),
    });
    bytes = downloaded.bytes;
    mime = downloaded.contentType ?? mime;
  }
  if (!bytes) throw new Error("供应商结果没有可下载的图片数据");
  if (bytes.byteLength > artifactDownloadMaxBytes())
    throw new Error("供应商结果超过允许的文件大小");

  const id = randomUUID();
  const extension = kind === "video" ? "mp4" : mime.includes("jpeg") ? "jpg" : "png";
  const storageKey = `assets/${id}/original.${extension}`;
  await storage.put(storageKey, bytes, mime);
  await repository.saveAsset({
    id,
    name: artifact.filename || `Corel 供应商结果 ${outputIndex + 1}`,
    kind,
    mimeType: mime,
    size: bytes.byteLength,
    storageKey,
    metadata: {
      source: "corel-direct-provider",
      corelBridgeJobId: job.id,
      provider: job.provider,
      connectionId: job.connectionId,
      operation: job.operation,
    },
  });
  return id;
}

function adapterFor(provider: string): ProviderAdapter {
  const adapter = runService.adapters().get(provider);
  if (!adapter) throw new Error(`未安装供应商适配器：${provider}`);
  return adapter;
}

async function execute(job: CorelDirectJob, adapter: ProviderAdapter, assets: ProviderAssetInput[]) {
  job.status = "running";
  job.updatedAt = timestamp();
  const request: NormalizedRequest = {
    connectionId: job.connectionId,
    operation: job.operation as ProviderOperation,
    prompt: job.prompt,
    model: job.model,
    assets,
    parameters: job.parameters,
    idempotencyKey: `corel:${job.id}:${job.clientRequestId}`,
    metadata: { source: "corel-direct" },
  };
  try {
    if (job.cancelRequested) throw new Error("任务已取消");
    const validation = await adapter.validate(request);
    if (!validation.valid)
      throw new Error(validation.issues.map((issue) => issue.message).join("；"));
    let task = await adapter.submit(request);
    job.providerTask = task;
    job.updatedAt = timestamp();
    let pollCount = 0;
    while (task.status === "queued" || task.status === "running") {
      if (pollCount++ >= 240)
        throw new Error("供应商任务轮询超时，已停止等待");
      if (job.cancelRequested) {
        await adapter.cancel?.(task);
        job.status = "cancelled";
        job.updatedAt = timestamp();
        return;
      }
      if (!adapter.poll) throw new Error("供应商任务仍在运行，但未提供轮询能力");
      await delay(task.pollAfterMs ?? (job.provider === "fake" ? 250 : 1_500));
      task = await adapter.poll(task);
      job.providerTask = task;
      job.updatedAt = timestamp();
    }
    if (task.status === "cancelled") {
      job.status = "cancelled";
      job.updatedAt = timestamp();
      return;
    }
    if (task.status === "failed") throw new Error(task.error || "供应商任务失败");
    if (task.status !== "succeeded") throw new Error(`无法识别供应商任务状态：${task.status}`);
    if (job.cancelRequested) {
      job.status = "cancelled";
      job.updatedAt = timestamp();
      return;
    }
    const artifacts = await adapter.extractOutputs(task.result);
    if (artifacts.length === 0) throw new Error("供应商成功但没有返回图片结果");
    for (const [index, artifact] of artifacts.entries())
      job.outputAssetIds.push(await archiveArtifact(artifact, job, index));
    job.status = "succeeded";
    job.updatedAt = timestamp();
  } catch (error) {
    if (job.cancelRequested) {
      job.status = "cancelled";
    } else {
      job.status = "failed";
      job.error = recordError(error);
    }
    job.updatedAt = timestamp();
  }
}

export async function createCorelDirectJob(
  input: CorelBridgeRequest,
): Promise<Record<string, unknown>> {
  if (input.operation !== "image.generate" && input.operation !== "image.edit")
    throw new Error("该操作尚未接入供应商直连适配器");
  const connections = (await repository.listConnections()).filter(connectionIsUsable);
  const connection = input.connectionId
    ? await repository.getConnection(input.connectionId)
    : connections[0];
  if (!connection || !connectionIsUsable(connection))
    throw new Error("没有可用的供应商连接，请先在超级画布中配置供应商");
  const clientRequestId = input.clientRequestId ?? randomUUID();
  const existingId = jobs().byClientRequest?.get(
    `${connection.id}:${clientRequestId}`,
  );
  if (existingId) {
    const existing = jobs().get(existingId);
    if (existing) return publicJob(existing);
  }
  const adapter = adapterFor(connection.provider);
  const listed = await adapter.listModels(connection.id).catch(() => []);
  const model = configuredModel(connection, listed, input.model);
  const assets = await loadAssets(connection, input.referenceAssetIds ?? []);
  const now = timestamp();
  const job: CorelDirectJob = {
    id: randomUUID(),
    operation: input.operation,
    provider: connection.provider,
    connectionId: connection.id,
    ...(model ? { model } : {}),
    prompt: input.prompt ?? "",
    referenceAssetIds: [...(input.referenceAssetIds ?? [])],
    parameters: { ...(input.parameters ?? {}) },
    clientRequestId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    outputAssetIds: [],
    cancelRequested: false,
  };
  jobs().set(job.id, job);
  jobs().byClientRequest?.set(`${connection.id}:${clientRequestId}`, job.id);
  void execute(job, adapter, assets);
  return publicJob(job);
}

export async function getCorelDirectJob(
  id: string,
): Promise<Record<string, unknown> | null> {
  const job = jobs().get(id);
  return job ? publicJob(job) : null;
}

export async function cancelCorelDirectJob(
  id: string,
): Promise<Record<string, unknown> | null> {
  const job = jobs().get(id);
  if (!job) return null;
  if (job.status === "queued" || job.status === "running") {
    job.cancelRequested = true;
    if (job.providerTask) {
      try {
        await adapterFor(job.provider).cancel?.(job.providerTask);
      } catch {
        // The background execution will mark the task cancelled as soon as it polls.
      }
    }
    job.status = "cancelled";
    job.updatedAt = timestamp();
  }
  return publicJob(job);
}
