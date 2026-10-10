import { createHash } from "node:crypto";
import {
  fetchProviderJson,
  type ModelDescriptor,
  type NormalizedRequest,
} from "@super-canvas/providers";
import { inspectImageOutput, imageOutputContractMismatches, downloadRemoteArtifact, cloudSubmissionId, isCloudSubmission, readCloudGenerationConfig, runCloudGeneration, testCloudGeneration, type CloudGenerationConfig } from "@super-canvas/runtime";
import type {
  SupplierRecord,
  SupplierVerificationCase,
  VerificationCharge,
} from "@super-canvas/db";
import { repository, storage, runService } from "./server";
import { desktopLifecycleState } from "./desktop-server";
import { requireServerMasterKey } from "./master-key";
import {
  SupplierVerificationService,
  verificationFingerprint,
  EmptyVerificationImageError,
  shouldAutomaticallyVerifyConnection,
} from "./supplier-verification-service";
import { effectiveImageCapabilities } from "./supplier-capabilities";
import { chargeFromVerificationResponse, chargeFromVerificationUsage } from "./supplier-verification-failure";
import { openSupplierSiteSession } from "./supplier-site-session";

const PROMPT =
  "A refined studio product photograph of a matte blue ceramic vase on a light gray pedestal, soft side lighting, fine surface texture, a small leafy branch. Landscape composition. No text, no watermark. Generate exactly one image.";
const adapter = (test: SupplierVerificationCase) => {
  const result = runService.adapters().get(test.provider);
  if (!result) throw new Error("当前执行协议不可用");
  return result;
};

async function readCharge(
  supplier: SupplierRecord,
  test: SupplierVerificationCase,
): Promise<VerificationCharge | undefined> {
  const returned = chargeFromVerificationResponse(test);
  if (returned) return returned;
  const session = await openSupplierSiteSession(supplier);
  if (!session) return undefined;
  const path =
    session.kind === "newapi"
      ? `/api/log/self/?p=0&page_size=100&type=2&request_id=${encodeURIComponent(test.requestId)}`
      : `/api/v1/usage?page=1&page_size=100&request_id=${encodeURIComponent(test.requestId)}`;
  let url = `${supplier.siteUrl.replace(/\/$/u, "")}${path}`;
  const fetchUsage = (target: string) => fetchProviderJson<Record<string, unknown>>(
    session.fetch, target, { method: "GET" },
    { phase: "connect", timeoutMs: 12000, maxResponseBytes: 1024 * 1024 },
  );
  const payload = await fetchUsage(url).catch(async error => {
    if (session.kind !== "newapi") throw error;
    // NewAPI deployments differ on the trailing slash. Keep redirects disabled
    // and retry only this known, same-site, read-only endpoint.
    url = url.replace("/api/log/self/?", "/api/log/self?");
    return fetchUsage(url);
  });
  return chargeFromVerificationUsage(payload, test, session.kind, url);
}

const documentCache = new Map<string, Promise<string | undefined>>();
async function readDocument(_supplier: SupplierRecord, model: ModelDescriptor) {
  const raw = model.metadata?.documentationUrl ?? model.metadata?.docsUrl;
  if (typeof raw !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  // Documentation is descriptive data, never instructions or executable config.
  if (url.protocol !== "https:" || url.username || url.password)
    return undefined;
  if (documentCache.has(url.href)) return documentCache.get(url.href);
  if (documentCache.size >= 24) return undefined;
  const promise = (async () => {
    try {
      // Use the download transport's public-address and redirect checks.
      const response = await downloadRemoteArtifact(url.href, {
        maxBytes: 512 * 1024,
        timeoutMs: 8000,
      });
      const html = new TextDecoder().decode(response.bytes);
      return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
        .replace(/<[^>]+>/gu, " ")
        .replace(/\s+/gu, " ")
        .slice(0, 24000);
    } catch {
      return undefined;
    }
  })();
  documentCache.set(url.href, promise);
  return promise;
}

const GLOBAL = "__superCanvasSupplierVerification";
export function getSupplierVerificationService() {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL]?: SupplierVerificationService;
  };
  return (scope[GLOBAL] ??= new SupplierVerificationService({
    repository,
    fingerprintKey: requireServerMasterKey(),
    models: async (connection) => {
      const { readProviderModelInventory } = await import("./provider-model-inventory");
      const response = await readProviderModelInventory(
        new Request(
          `http://localhost/api/providers/${encodeURIComponent(connection.id)}/models?refresh=1&verificationRaw=1`,
        ),
        { params: Promise.resolve({ id: connection.id }) },
      );
      if (
        !response.ok ||
        ["stale", "failed", "unauthorized"].includes(
          response.headers.get("X-Model-Scan-Status") ?? "",
        )
      )
        throw new Error("模型读取失败");
      return response.json() as Promise<ModelDescriptor[]>;
    },
    document: readDocument,
    canSubmit: () => !desktopLifecycleState().draining,
    validate: async (test) => {
      const supplier = await repository.getSupplier(test.supplierId);
      if (supplier?.state?.generationTransport === "cloudflare") {
        try { await testCloudGeneration(); } catch (error) { return error instanceof Error ? error.message : "云端服务未配置"; }
      }
      const result = await adapter(test).validate({ connectionId: test.connectionId, operation: "image.generate", model: test.modelId, parameters: test.parameters, prompt: PROMPT, idempotencyKey: test.requestId, metadata: { purpose: "supplier-verification" } });
      return result.valid ? undefined : result.issues.map(issue => issue.message).join("；").slice(0, 800);
    },
    submit: async (test, checkpoint) => {
      const request: NormalizedRequest = {
        connectionId: test.connectionId,
        operation: "image.generate",
        model: test.modelId,
        parameters: test.parameters,
        prompt: PROMPT,
        idempotencyKey: test.requestId,
        metadata: { purpose: "supplier-verification" },
      };
      const validation = await adapter(test).validate(request);
      if (!validation.valid) throw new Error("参数无法通过当前适配器校验");
      const supplier = await repository.getSupplier(test.supplierId);
      if (supplier?.state?.generationTransport === "cloudflare") {
        const config = await readCloudGenerationConfig();
        if (!config) throw new Error("云端生图未配置");
        return runCloudGeneration(test.requestId, config, () => adapter(test).submit(request), {
          checkpoint: async config => { await checkpoint?.({ providerTaskId: cloudSubmissionId(test.requestId), status: "running", result: { cloudGeneration: config } }); },
          accepted: async () => { await checkpoint?.({ providerTaskId: cloudSubmissionId(test.requestId), status: "running", result: { cloudGeneration: config, cloudAccepted: true } }); },
        });
      }
      return adapter(test).submit(request);
    },
    poll: async (test, task) => {
      if (isCloudSubmission(task.providerTaskId)) {
        const config = (task.result as { cloudGeneration?: CloudGenerationConfig } | undefined)?.cloudGeneration;
        if (!config) throw new Error("原核验的云端配置缺失，无法取回");
        return runCloudGeneration(test.requestId, config, () => adapter(test).submit({ connectionId: test.connectionId, operation: "image.generate", model: test.modelId,
          parameters: test.parameters, prompt: PROMPT, idempotencyKey: test.requestId, metadata: { purpose: "supplier-verification" } }), { resumeOnly: true, checkpoint: async () => {} });
      }
      const provider = adapter(test);
      if (!provider.poll) throw new Error("该接口不支持查询已有任务");
      return provider.poll(task);
    },
    archive: async (test, task) => {
      const id = createHash("sha256")
        .update(`verification:${test.requestId}`)
        .digest("hex");
      const existing = await repository.getAsset(id);
      if (existing) {
        const stored = await storage.get(existing.storageKey);
        if (stored) {
          const inspected = await inspectImageOutput(stored.bytes);
          const mismatches = imageOutputContractMismatches(inspected, test.parameters);
          const storageKey = `verification/${id}/original.${inspected.extension}`;
          if (existing.storageKey !== storageKey || stored.contentType !== inspected.mimeType) await storage.put(storageKey, stored.bytes, inspected.mimeType);
          await repository.saveAsset({ ...existing, mimeType: inspected.mimeType, storageKey, metadata: { ...existing.metadata, ...inspected.metadata, imageOutputContractMismatches: mismatches } });
          if (mismatches.length) throw new Error(`原始核验图片已保留，但输出不符合请求：${mismatches.join("；")}`);
          return {
            assetId: id,
            width: inspected.metadata.width,
            height: inspected.metadata.height,
          };
        }
      }
      const outputs = await adapter(test).extractOutputs(task.result ?? task);
      const output = outputs.find((item) => item.kind === "image");
      if (!output) throw new EmptyVerificationImageError();
      let bytes = output.data;
      if (!bytes && output.url?.startsWith("data:")) {
        const match = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/iu.exec(
          output.url,
        );
        if (match) bytes = Buffer.from(match[1]!, "base64");
      }
      if (!bytes && output.url)
        bytes = (
          await downloadRemoteArtifact(output.url, {
            maxBytes: 64 * 1024 * 1024,
          })
        ).bytes;
      if (!bytes) throw new Error("图片未能下载");
      const inspected = await inspectImageOutput(bytes);
      const mismatches = imageOutputContractMismatches(inspected, test.parameters);
      const mime = inspected.mimeType;
      const storageKey = `verification/${id}/original.${inspected.extension}`;
      await storage.put(storageKey, bytes, mime);
      await repository.saveAsset({
        id,
        name: `${test.group} · ${test.modelId} · ${test.resolution} 核验`,
        kind: "image",
        mimeType: mime,
        size: bytes.byteLength,
        storageKey,
        metadata: {
          purpose: "supplier-verification",
          requestId: test.requestId,
          supplierId: test.supplierId,
          model: test.modelId,
          parameters: test.parameters,
          ...inspected.metadata,
          imageOutputContractMismatches: mismatches,
          ...(output.mimeType !== undefined ? { providerReportedMimeType: output.mimeType } : {}),
        },
      });
      if (mismatches.length) throw new Error(`原始核验图片已保留，但输出不符合请求：${mismatches.join("；")}`);
      return { assetId: id, width: inspected.metadata.width, height: inspected.metadata.height };
    },
    charge: readCharge,
  }));
}

export async function enrichVerifiedSupplierModels(
  connectionId: string,
  models: ModelDescriptor[],
) {
  const connection = await repository.getConnection(connectionId);
  if (!connection || typeof connection.config.supplierId !== "string")
    return models;
  const supplier = await repository.getSupplier(connection.config.supplierId);
  if (!supplier) return models;
  const record = await repository.getSupplierVerification(supplier.id);
  return models.map((model) =>
    model.operations.some((op) => op.startsWith("image."))
      ? effectiveImageCapabilities({
          supplier,
          connection,
          model,
          fingerprint: verificationFingerprint(connection, requireServerMasterKey(), model.id),
          tests: record?.cases,
          priorEvidence: record?.evidence,
        }).model
      : model,
  );
}

/** Call only after a user-authorized write/scan, never during GET or a build. */
const pendingPlans = new Map<string, { promise: Promise<void>; again: boolean }>();
function automaticVerificationEnabled() {
  return process.env.NODE_ENV !== "test" && !process.env.VITEST
    && process.env.NEXT_PHASE !== "phase-production-build" && process.env.SUPPLIER_AUTO_VERIFY !== "off";
}
export async function scheduleSupplierVerification(id: string) {
  if (!automaticVerificationEnabled()) return;
  const pending = pendingPlans.get(id);
  if (pending) { pending.again = true; return pending.promise; }
  const service = getSupplierVerificationService();
  const entry = { promise: Promise.resolve(), again: false };
  entry.promise = (async () => {
    do {
      entry.again = false;
      const requested = (await repository.listConnections()).filter(connection => connection.config.supplierId === id
        && connection.config.supplierVerificationRequestId && shouldAutomaticallyVerifyConnection(null, connection));
      const record = requested.length
        ? await service.plan(id, false, { onboarding: true })
        : await service.plan(id);
      for (const original of requested) {
        // A failed free lookup remains pending for the next app launch.
        if (!record || record.skipped.some(item => item.connectionId === original.id && !item.modelId)) continue;
        const latest = await repository.getConnection(original.id);
        if (!latest || latest.config.supplierVerificationRequestId !== original.config.supplierVerificationRequestId) continue;
        const config = { ...latest.config };
        delete config.supplierVerificationRequestId;
        await repository.saveConnection({ ...latest, config }, { expected: latest }).catch(() => { /* Retry a pending marker on the next launch. */ });
      }
    } while (entry.again);
    void service.kick().catch(() => console.error("[supplier-verification] 核验队列暂停，请查看核验记录"));
  })().finally(() => { pendingPlans.delete(id); });
  pendingPlans.set(id, entry);
  return entry.promise;
}

/** Resume only saved onboarding requests and existing queues, never create a new audit on startup. */
export async function resumeSupplierVerification() {
  if (!automaticVerificationEnabled()) return;
  const service = getSupplierVerificationService();
  void service.kick().catch(() => console.error("[supplier-verification] 已保存的核验任务需要处理"));
  const suppliers = new Set((await repository.listConnections()).filter(connection => connection.config.supplierVerificationRequestId
    && shouldAutomaticallyVerifyConnection(null, connection)).map(connection => String(connection.config.supplierId)));
  for (const id of suppliers) await scheduleSupplierVerification(id);
}
