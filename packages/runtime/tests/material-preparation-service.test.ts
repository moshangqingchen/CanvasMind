import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { MaterialPreparationError, ProviderHttpError, uploadJiasuMedia, uploadTemporaryReferenceImages,
  type ProviderAdapter, type FetchImplementation } from "@super-canvas/providers";
import type { ObjectStorage } from "@super-canvas/storage";
import { RunService } from "../src/service.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.1", family: 4 }]) }));

const asset = { id: "original", kind: "image" as const, mimeType: "image/png", data: new Uint8Array([1, 2, 3]) };
const storage: ObjectStorage = { get: async () => null, put: async () => { throw Error("No result archiving in failure fixtures"); } };
class IsolatedService extends RunService {
  constructor(repository: MemoryRepository, private readonly adapter: ProviderAdapter) {
    super({ repository, storage, pollIntervalMs: 0, retryBaseDelayMs: 1 });
  }
  override adapters() { return new Map([["fake", this.adapter]]); }
}
async function fixture(adapter: ProviderAdapter) {
  const repository = new MemoryRepository();
  await repository.saveCanvas({ id: "canvas", title: "Offline preparation", graph: { schemaVersion: 1, nodes: [{
    id: "image", type: "workflow", data: { nodeType: "image-generation", provider: "fake", connectionId: "fake-default",
      parts: [{ type: "text", text: "Original reference fixture" }], outputs: [{ id: "image", kind: "image" }] },
  }], edges: [] } });
  const service = new IsolatedService(repository, adapter);
  const run = await service.createRun({ canvasId: "canvas", clientRequestId: "only-one", scope: "node", nodeId: "image" });
  let snapshot: Awaited<ReturnType<RunService["getRun"]>>;
  await vi.waitFor(async () => {
    snapshot = await service.getRun(run.id);
    expect(["failed", "needs_attention"]).toContain(snapshot?.run.status);
  }, { timeout: 4000 });
  return { repository, service, snapshot: snapshot! };
}
const baseAdapter = (): ProviderAdapter => ({ testConnection: async () => {}, listModels: async () => [],
  validate: async () => ({ valid: true, issues: [] }), submit: async () => { throw Error("unused"); }, extractOutputs: async () => [] });

describe("material preparation generation scope", () => {
  it.each(["initialize", "upload", "hosting"] as const)("records %s failure as no generation submitted without retry", async stage => {
    let paidPosts = 0;
    const fetch = vi.fn<FetchImplementation>(async (_url, init) => {
      if (stage !== "upload" || init?.method === "PUT") throw new DOMException("fixture timeout", "TimeoutError");
      return Response.json({ success: true, data: { items: [{ url: "https://cdn.test/a.png", put: { url: "https://storage.test/a", method: "PUT" } }] } });
    });
    const adapter = baseAdapter();
    adapter.submit = vi.fn(async () => {
      if (stage === "hosting") await uploadTemporaryReferenceImages([asset], fetch);
      else await uploadJiasuMedia({ id: "fixture", provider: "rest", baseUrl: "https://ai.jiasuapi.com/v1", apiKey: "offline-fixture" }, [asset], { fetch });
      paidPosts++;
      return { providerTaskId: "must-not-submit", status: "running" };
    });
    const { snapshot } = await fixture(adapter);
    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.nodes[0]).toMatchObject({ status: "failed", providerTaskId: null, errorJson: {
      code: "MATERIAL_PREPARATION_FAILED", phase: "prepare", message: expect.stringContaining("素材准备失败，尚未提交生成"),
      charge: { status: "not_charged", source: "not_submitted" }, submissionMayHaveOccurred: false,
    } });
    expect(adapter.submit).toHaveBeenCalledOnce();
    expect(paidPosts).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(stage === "upload" ? 2 : 1);
  });

  it("never changes an accepted task's later preparation failure into no charge or a new submit", async () => {
    const adapter = baseAdapter();
    adapter.submit = vi.fn(async () => ({ providerTaskId: "original-paid-task", status: "running" as const,
      result: { charge: { status: "charged", amount: 0.25, currency: "USD" } } }));
    adapter.poll = vi.fn(async () => { throw new MaterialPreparationError("read", { cause: new ProviderHttpError("free read failed", {
      kind: "network", phase: "prepare", retryable: false, submissionMayHaveOccurred: false,
    }) }); });
    const { snapshot } = await fixture(adapter);
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0]).toMatchObject({ providerTaskId: "original-paid-task", errorJson: {
      submissionMayHaveOccurred: true, charge: { status: "charged", amount: 0.25, currency: "USD" },
    } });
    expect(snapshot.nodes[0]?.errorJson?.message).not.toContain("尚未提交生成");
    expect(adapter.submit).toHaveBeenCalledOnce();
  });
});
