import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const adapter = {
    listModels: vi.fn(async () => [{ id: "mock-image", name: "Mock image", operations: ["image.generate"] }]),
    validate: vi.fn(async () => ({ valid: true, issues: [] })),
    submit: vi.fn(async () => ({
      providerTaskId: "mock-task",
      status: "succeeded",
      result: { ok: true },
    })),
    extractOutputs: vi.fn(async () => [
      { kind: "image", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    ]),
  };
  const connection = {
    id: "connection-1",
    name: "Mock supplier",
    provider: "mock",
    encryptedSecret: "encrypted",
    config: { defaultModel: "mock-image" },
  };
  const asset = {
    id: "reference-1",
    name: "reference.png",
    kind: "image",
    mimeType: "image/png",
    size: 3,
    storageKey: "assets/reference-1/original.png",
    metadata: {},
    deleted: false,
  };
  const repository = {
    listConnections: vi.fn(async () => [connection]),
    getConnection: vi.fn(async () => connection),
    getAsset: vi.fn(async (id: string) => ({ ...asset, id })),
    saveAsset: vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      createdAt: new Date().toISOString(),
      deleted: false,
    })),
    saveCanvas: vi.fn(),
    createRun: vi.fn(),
  };
  const storage = {
    get: vi.fn(async () => ({ bytes: new Uint8Array([9, 9, 9]), contentType: "image/png" })),
    put: vi.fn(async () => undefined),
  };
  return { adapter, connection, repository, storage };
});

vi.mock("./server", () => ({
  publicAsset: (asset: Record<string, unknown> | null) =>
    asset ? { ...asset, url: `/api/assets/${String(asset.id)}/content` } : null,
  repository: mocks.repository,
  storage: mocks.storage,
  runService: { adapters: () => new Map([["mock", mocks.adapter]]) },
}));

vi.mock("@super-canvas/runtime", () => ({
  artifactDownloadMaxBytes: () => 10_000_000,
  downloadRemoteArtifact: vi.fn(),
}));

import {
  createCorelDirectJob,
  getCorelDirectJob,
} from "./corel-direct";

describe("Corel direct provider bridge", () => {
  it("submits directly to an adapter without creating a canvas or run", async () => {
    const created = await createCorelDirectJob({
      operation: "image.generate",
      prompt: "a blue square",
      connectionId: mocks.connection.id,
      model: "mock-image",
      referenceAssetIds: ["reference-1"],
      parameters: { size: "1024x1024" },
      clientRequestId: "client-1",
    });
    expect(created).toMatchObject({ provider: "mock" });
    expect(["queued", "running"]).toContain(created.status);
    expect(mocks.repository.saveCanvas).not.toHaveBeenCalled();
    expect(mocks.repository.createRun).not.toHaveBeenCalled();
    expect(mocks.adapter.validate).toHaveBeenCalledOnce();
    expect(mocks.adapter.submit).toHaveBeenCalledOnce();

    const jobId = String(created.jobId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const job = await getCorelDirectJob(jobId);
      if (job?.status === "succeeded") {
        expect(job.outputAssets).toEqual([
          expect.objectContaining({
            url: expect.stringMatching(/^\/api\/assets\/[^/]+\/content$/u),
          }),
        ]);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("direct provider job did not finish");
  });
});
