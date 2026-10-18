import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import {
  GenericRestAdapter, ProviderHttpError, StaticConnectionResolver, fetchProviderJson,
  type ProviderAdapter, type RestConnectorConfig,
} from "@super-canvas/providers";
import type { ObjectStorage } from "@super-canvas/storage";
import { RunService } from "../src/service.js";
import { validPngBytes } from "./fixtures/image-bytes.js";

const storage: ObjectStorage = { async put() {}, async get() { return null; } };
const contract: RestConnectorConfig = {
  auth: { type: "none" }, allowedHosts: ["provider.test"],
  submit: { path: "/generate", method: "POST", bodyMode: "json", template: {}, idempotent: false,
    response: { taskIdPath: "$.id", statusPath: "$.status" } },
  poll: { path: "/jobs/{taskId}", method: "GET", bodyMode: "none", response: { statusPath: "$.status" } },
  output: { kind: "video", path: "$.url", requireOutput: true, contentFallback: { path: "/jobs/{taskId}/content" } },
};

class AdapterRunService extends RunService {
  constructor(repository: MemoryRepository, private readonly adapter: ProviderAdapter) {
    super({ repository, storage, retryBaseDelayMs: 1, pollIntervalMs: 0 });
  }
  override adapters() { return new Map([["rest", this.adapter]]); }
}

async function createFixture(adapter: ProviderAdapter, video = true) {
  const repository = new MemoryRepository();
  await repository.saveConnection({ id: "fixture", provider: "rest", name: "isolated billing fixture", encryptedSecret: null, config: {} });
  const canvas = await repository.ensureDefaultCanvas();
  await repository.saveCanvas({ id: canvas.id, graph: { schemaVersion: 1, nodes: [{ id: "generation", type: "workflow", data: {
    nodeType: video ? "video-generation" : "image-generation", provider: "rest", connectionId: "fixture", model: "fixture-model",
    parts: [{ type: "text", text: "isolated fixture" }], outputs: [{ id: "output", kind: video ? "video" : "image" }],
  } }], edges: [] } });
  const service = new AdapterRunService(repository, adapter);
  const run = await service.createRun({ canvasId: canvas.id, scope: "node", nodeId: "generation", clientRequestId: "billing-fixture" });
  await expect.poll(async () => (await service.getRun(run.id))?.run.status).toMatch(/^(succeeded|failed|needs_attention)$/u);
  return (await service.getRun(run.id))!;
}

function synchronousAdapter(submit: ProviderAdapter["submit"]): ProviderAdapter {
  return {
    async testConnection() {}, async listModels() { return []; }, async validate() { return { valid: true, issues: [] }; }, submit,
    async extractOutputs() { return [{ kind: "image", data: new Uint8Array(validPngBytes), mimeType: "image/png" }]; },
  };
}

describe("P0 paid submission safety", () => {
  it.each(["503", "timeout"] as const)("does not repeat an accepted POST after content fallback %s", async failure => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "paid-1", status: "succeeded" }));
    if (failure === "503") fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    else fetcher.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([
      { id: "fixture", provider: "rest", baseUrl: "https://provider.test" },
    ]), { config: contract, fetch: fetcher, requestTimeoutMs: 20 });
    const submit = vi.spyOn(adapter, "submit");
    const snapshot = await createFixture(adapter);
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]).toMatchObject({ status: "needs_attention", providerTaskId: "paid-1", errorJson: {
      phase: "archive", submissionMayHaveOccurred: true,
    } });
    expect(submit).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("protects against post-response errors even when an adapter incorrectly marks them safe", async () => {
    const submit = vi.fn<ProviderAdapter["submit"]>().mockRejectedValue(new ProviderHttpError("download unavailable", {
      kind: "provider", phase: "archive", status: 503, retryable: true,
      submissionMayHaveOccurred: false, requestNotSent: true, providerTaskId: "paid-other-adapter",
    }));
    const snapshot = await createFixture(synchronousAdapter(submit));
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]?.providerTaskId).toBe("paid-other-adapter");
    expect(submit).toHaveBeenCalledOnce();
  });

  it.each([
    { status: undefined, requestNotSent: undefined },
    { status: 429, requestNotSent: undefined },
    { status: 429, requestNotSent: true as const },
  ])("does not retry an unproven or contradicted unsent claim ($status, $requestNotSent)", async ({ status, requestNotSent }) => {
    const submit = vi.fn<ProviderAdapter["submit"]>().mockRejectedValue(new ProviderHttpError("not proven unsent", {
      kind: "network", phase: "submit", retryable: true, submissionMayHaveOccurred: false,
      ...(status ? { status } : {}), ...(requestNotSent ? { requestNotSent } : {}),
    }));
    expect((await createFixture(synchronousAdapter(submit))).run.status).toBe("failed");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("still retries a genuine connection failure before the paid request is sent", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }))
      .mockResolvedValueOnce(Response.json({ id: "accepted-once" }));
    const submit = vi.fn<ProviderAdapter["submit"]>(async () => {
      const response = await fetchProviderJson<{ id: string }>(fetcher, "https://provider.test/generate",
        { method: "POST", body: "{}" }, { phase: "submit", idempotent: false });
      return { providerTaskId: response.id, status: "succeeded", result: {} };
    });
    const snapshot = await createFixture(synchronousAdapter(submit), false);
    expect(snapshot.run.status).toBe("succeeded");
    expect(snapshot.nodes[0]).toMatchObject({ attempt: 2, providerTaskId: "accepted-once" });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
