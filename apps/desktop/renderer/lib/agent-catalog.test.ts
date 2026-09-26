import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ catalog: vi.fn(), connections: vi.fn() }));
vi.mock("./director-catalog", () => ({ loadDirectorCatalog: mocks.catalog }));
vi.mock("./server", () => ({ repository: { listConnections: mocks.connections } }));
import { loadAgentCatalog } from "./agent-catalog";

beforeEach(() => { vi.clearAllMocks(); });
describe("agent canvas inventory", () => {
  it("does not restore a manual generation model rejected by shared source validation", async () => {
    mocks.catalog.mockResolvedValue([]);
    mocks.connections.mockResolvedValue([{ id: "old-source", provider: "openai", encryptedSecret: "key", config: {
      usage: "agent", manualModels: [{ id: "gpt-image-2", capability: "image", protocol: "openai-images" }],
    } }]);
    expect(await loadAgentCatalog()).toEqual([]);
  });
  it("retains verified local CLI generation and models sharing an agent Key", async () => {
    const model = { id: "image", operations: ["image.generate"], metadata: {} };
    mocks.catalog.mockResolvedValue([
      { connectionId: "cli", model }, { connectionId: "mixed", model },
    ]);
    mocks.connections.mockResolvedValue([
      { id: "cli", provider: "cli", encryptedSecret: null, config: {} },
      { id: "mixed", provider: "rest", encryptedSecret: "key", config: { usage: "agent", defaultModel: "image" } },
    ]);
    const result = await loadAgentCatalog();
    expect(result.map(candidate => candidate.connectionId)).toEqual(["cli", "mixed"]);
    expect(result[1]?.model.isDefault).toBe(true);
  });
  it("preserves the last authenticated allowlist after a failed refresh", async () => {
    mocks.catalog.mockResolvedValue([{ connectionId: "key", model: { id: "ungranted", operations: ["image.generate"] } }]);
    mocks.connections.mockResolvedValue([{ id: "key", config: { modelScanStatus: "failed", scannedModelIds: ["granted"] } }]);
    expect(await loadAgentCatalog()).toEqual([]);
  });
});
