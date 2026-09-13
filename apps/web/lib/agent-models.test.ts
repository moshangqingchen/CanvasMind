import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
const state = vi.hoisted(() => ({
  repository: null as unknown as MemoryRepository,
}));
vi.mock("./server", () => ({
  get repository() {
    return state.repository;
  },
}));
vi.mock("./cangyuan-catalog", () => ({
  loadCangyuanCatalog: async () => ({ marketplaceGroups: [] }),
}));
import {
  loadAgentModels,
  agentCapabilities,
  resolveAgentModel,
} from "./agent-models";
import { validateManualProviderModels } from "./manual-provider-models";
beforeEach(() => {
  state.repository = new MemoryRepository();
});
async function connection(id: string, extra: Record<string, unknown> = {}) {
  return state.repository.saveConnection({
    id,
    name: "同名站点",
    provider: "rest",
    encryptedSecret: "test-only",
    config: {
      usage: "agent",
      supplierId: id,
      baseUrl: `https://${id}.example.test/v1`,
      modelGroup: "同名组",
      protocol: "chat-completions",
      manualModels: [
        {
          id: "shared-model",
          capability: "chat",
          protocol: "chat-completions",
        },
      ],
      ...extra,
    },
  });
}
describe("agent model routing identity and capabilities", () => {
  it("keeps distinct sites and connection identities even with identical names and models", async () => {
    await connection("one");
    await connection("two");
    const models = await loadAgentModels();
    expect(models).toHaveLength(2);
    expect(new Set(models.map((m) => m.supplierId)).size).toBe(2);
    expect(new Set(models.map((m) => m.connectionId)).size).toBe(2);
  });
  it.each(["empty", "unauthorized"])(
    "does not let a manual model bypass %s",
    async (status) => {
      await connection("one", { modelScanStatus: status, scannedModelIds: [] });
      expect((await loadAgentModels())[0].available).toBe(false);
      await expect(resolveAgentModel("one", "shared-model")).rejects.toThrow();
    },
  );
  it("does not infer image capability from a model name", async () => {
    const c = await connection("one");
    expect(agentCapabilities(c, "gpt-vision-image-max").imageInput).toBe(false);
  });
  it("intersects declared capabilities with the actual protocol serializer", async () => {
    const c = await connection("one", {
      protocol: "anthropic-messages",
      directorCapabilities: {
        imageInput: true,
        audioInput: true,
        videoInput: true,
      },
    });
    const caps = agentCapabilities(c, "model");
    expect(caps.imageInput).toBe(true);
    expect(caps.audioInput).toBe(false);
    expect(caps.videoInput).toBe(false);
  });
  it.each([
    "responses",
    "chat-completions",
    "anthropic-messages",
    "google-generate-content",
    "xai-responses",
    "generic-openai-compatible",
  ])("validates manually configured %s chat models", (protocol) => {
    expect(() =>
      validateManualProviderModels("rest", {
        usage: "agent",
        protocol,
        manualModels: [{ id: "exact-model-id", capability: "chat", protocol }],
      }),
    ).not.toThrow();
  });
});
