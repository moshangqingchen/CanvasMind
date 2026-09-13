import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { ProviderHttpError } from "@super-canvas/providers";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, fetch: vi.fn() }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; }, jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../lib/master-key", () => ({ requireServerMasterKey: () => "unit-test-key" }));
vi.mock("@super-canvas/providers", async (importOriginal) => ({ ...await importOriginal<typeof import("@super-canvas/providers")>(), fetchProviderJson: mocks.fetch, decryptSecret: () => "unit-test-token" }));
import { GET } from "./[id]/models/route";
beforeEach(async () => {
  mocks.repository = new MemoryRepository(); mocks.fetch.mockReset();
  await mocks.repository.saveConnection({ id: "manual", provider: "openai", name: "Manual", encryptedSecret: "test-encrypted", config: { customGroup: true, modelGroup: "Manual", baseUrl: "https://example.com/v1", usage: "canvas", manualModels: [{ id: "custom-model", capability: "image", protocol: "openai-images" }] } });
});
const read = () => GET(new Request("http://localhost/api/providers/manual/models?refresh=1"), { params: Promise.resolve({ id: "manual" }) });
describe("manual model scan behavior", () => {
  it("never falls back to manual models after an explicit 401", async () => {
    mocks.fetch.mockRejectedValue(new ProviderHttpError("unauthorized", { kind: "authentication", phase: "connect", retryable: false, submissionMayHaveOccurred: false, status: 401 }));
    const response = await read();
    expect(response.status).toBe(401);
    expect(response.headers.get("X-Model-Scan-Status")).toBe("unauthorized");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect((await mocks.repository.getConnection("manual"))?.config.modelScanStatus).toBe("unauthorized");
    mocks.fetch.mockRejectedValue(new ProviderHttpError("not found", { kind: "invalid_request", phase: "connect", retryable: false, submissionMayHaveOccurred: false, status: 404 }));
    expect((await read()).status).toBe(502);
    expect((await mocks.repository.getConnection("manual"))?.config.modelScanStatus).toBe("unauthorized");
  });
  it("keeps independent manual records when a catalog endpoint is missing", async () => {
    mocks.fetch.mockRejectedValue(new ProviderHttpError("not found", { kind: "invalid_request", phase: "connect", retryable: false, submissionMayHaveOccurred: false, status: 404 }));
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Model-Scan-Status")).toBe("stale");
    expect(await response.json()).toMatchObject([{ id: "custom-model", metadata: { source: "manual" } }]);
    expect((await mocks.repository.getConnection("manual"))?.config.manualModels).toHaveLength(1);
  });
  it("uses a declared manual protocol for an authenticated unknown model ID", async () => {
    mocks.fetch.mockResolvedValue({ data: [{ id: "custom-model" }] });
    const response = await read();
    expect(await response.json()).toMatchObject([{ id: "custom-model", operations: ["image.generate", "image.edit"] }]);
    expect((await mocks.repository.getConnection("manual"))?.config.scannedModelIds).toEqual(["custom-model"]);
  });
});
