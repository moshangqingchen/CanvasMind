import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { parseSupplierCatalog, scanProviderModelCatalog } from "@super-canvas/providers";
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
vi.mock("./director-connections", () => ({
  resolveDirectorConnection: vi.fn(async (profile) => ({
    id: profile.brainConnectionId, model: profile.brainModelId,
    protocol: profile.config.protocol, reasoningEffort: profile.config.reasoningEffort,
    capabilities: profile.config.directorCapabilities,
  })),
}));
import {
  loadAgentModels,
  agentCapabilities,
  resolveAgentModel,
} from "./agent-models";
import { validateManualProviderModels } from "./manual-provider-models";
import { createAgentModelEvidence } from "./agent-model-capabilities";
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
  it("uses official defaults for every known GPT model in a group without channel effort declarations", async () => {
    const ids = ["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-sol"];
    await connection("stable-pro", { modelGroup: "gpt-pro-[稳定优先]", usage: "canvas", protocol: undefined,
      manualModels: [], modelScanStatus: "live", scannedModelIds: ids, modelCatalogModels: scanProviderModelCatalog(ids.map(id => ({ id }))).models });
    const models = await loadAgentModels();
    expect(models.map(model => model.modelId)).toEqual(ids);
    for (const model of models) {
      expect(model).toMatchObject({ available: true, reasoningSource: "official-model" });
      expect(model.reasoningOptions!.length).toBeGreaterThan(1);
    }
    expect(await resolveAgentModel("stable-pro", "gpt-6-sol", "max"))
      .toMatchObject({ model: "gpt-6-sol", protocol: "openai-responses", reasoningEffort: "max" });
  });

  it("parses saved supplier documentation before official fallback without treating legacy text placeholders as declarations", async () => {
    const model = { ...scanProviderModelCatalog([{ id: "gpt-6-sol" }]).models[0],
      description: "思考强度支持：low、high。", inputKinds: ["text"], metadata: {} };
    await connection("documented", { manualModels: [], modelScanStatus: "live", scannedModelIds: [model.id], modelCatalogModels: [model] });
    const [resolved] = await loadAgentModels();
    expect(resolved).toMatchObject({ reasoningSource: "provider-catalog", imageInputStatus: "assumed" });
    expect(resolved.reasoningOptions?.map(option => option.value)).toEqual(["auto", "low", "high"]);
    expect(resolved.reasoningFallback).toBeUndefined();
    await expect(resolveAgentModel("documented", model.id, "max")).rejects.toThrow("思考强度");
  });

  it("discovers chat models in a mixed canvas Key and retains its dedicated image protocol", async () => {
    const models = scanProviderModelCatalog([
      { id: "chat-new" }, { id: "gpt-image-2" }, { id: "sora-2" },
    ]).models;
    await connection("mixed", { usage: "canvas", protocol: "openai-images", manualModels: [],
      modelScanStatus: "live", scannedModelIds: models.map(model => model.id), modelCatalogModels: models });
    expect(await loadAgentModels()).toMatchObject([{ connectionId: "mixed", modelId: "chat-new", available: true }]);
    expect((await state.repository.getConnection("mixed"))?.config.protocol).toBe("openai-images");
  });

  it("retains separate Key connections within the same supplier and group", async () => {
    await connection("key-a", { supplierId: "shared-supplier" });
    await connection("key-b", { supplierId: "shared-supplier" });
    const models = await loadAgentModels();
    expect(models.map(model => model.connectionId)).toEqual(["key-a", "key-b"]);
    expect(models.every(model => model.supplierId === "shared-supplier" && model.group === "同名组")).toBe(true);
  });

  it("keeps connector templates and invalid defaults unavailable until the current Key returns them", async () => {
    await connection("one", { manualModels: [], defaultModel: "wrong-default", connector: {
      models: [{ id: "template-chat", name: "Template", operations: [], outputKinds: ["text"] }],
    } });
    expect(await loadAgentModels()).toMatchObject([{ modelId: "template-chat", source: "catalog", available: false }]);
    await expect(resolveAgentModel("one", "wrong-default")).rejects.toThrow();
  });

  it.each(["live", "failed"])("does not expand the Key's last inventory with other group hints after a %s scan", async status => {
    await connection("one", { manualModels: [], modelScanStatus: status, scannedModelIds: ["granted-chat"],
      modelCatalogModels: [{ id: "granted-chat", name: "Granted", operations: [], inputKinds: ["text"], outputKinds: ["text"] }],
      allowedModels: ["other-group-chat"], defaultModel: "bad-default" });
    const models = await loadAgentModels();
    expect(models.find(model => model.modelId === "granted-chat")?.available).toBe(true);
    expect(models.find(model => model.modelId === "other-group-chat")?.available).toBe(false);
    await expect(resolveAgentModel("one", "bad-default")).rejects.toThrow();
  });

  it("accepts old live snapshots without scannedModelIds but excludes disabled and archived connections", async () => {
    const saved = [{ id: "saved-chat", name: "Saved", operations: [], inputKinds: ["text"], outputKinds: ["text"] }];
    await connection("live", { manualModels: [], modelScanStatus: "live", modelCatalogModels: saved });
    await connection("disabled", { usage: "disabled" });
    await connection("archived");
    const snapshot = state.repository.exportSnapshot();
    snapshot.connections.find(record => record.id === "archived")!.config.supplierArchived = true;
    state.repository = new MemoryRepository(snapshot);
    expect(await loadAgentModels()).toMatchObject([{ connectionId: "live", modelId: "saved-chat", available: true, imageInputStatus: "assumed" }]);
  });

  it("never routes old supplier sources or old API addresses even if IDs and model names match", async () => {
    for (const id of ["old-source", "old-address", "current"]) await connection(id);
    await state.repository.saveSupplier({ id: "supplier", name: "Supplier", supplierKey: "rest", apiUrl: "https://current.example/v1",
      siteUrl: "https://current.example", kind: "auto", scanStatus: "live", catalog: { groups: [] },
      state: { version: 1, revision: 1, visibility: "visible", sourceId: "current-source", fingerprint: "test", history: [] } });
    const snapshot = state.repository.exportSnapshot();
    for (const record of snapshot.connections) record.config = { ...record.config, supplierId: "supplier",
      supplierSourceId: record.id === "old-source" ? "old-source" : "current-source",
      baseUrl: record.id === "old-address" ? "https://old.example/v1" : "https://current.example/v1" };
    state.repository = new MemoryRepository(snapshot);
    expect((await loadAgentModels()).map(model => model.connectionId)).toEqual(["current"]);
  });

  it("validates reasoning choices server-side for the precise selected model", async () => {
    await connection("one", { manualModels: [], modelScanStatus: "live", scannedModelIds: ["reasoning-model", "plain-model"],
      modelCatalogModels: scanProviderModelCatalog([
        { id: "reasoning-model", reasoning_efforts: ["high", "xhigh"], protocol: "responses" }, { id: "plain-model" },
      ]).models });
    expect(await resolveAgentModel("one", "reasoning-model", "high")).toMatchObject({ id: "one", model: "reasoning-model", reasoningEffort: "high", protocol: "openai-responses" });
    expect(await resolveAgentModel("one", "plain-model", "auto")).toMatchObject({ reasoningEffort: undefined });
    await expect(resolveAgentModel("one", "plain-model", "high")).rejects.toThrow("思考强度");
    await expect(resolveAgentModel("one", "reasoning-model", "ultra")).rejects.toThrow("思考强度");
  });

  it("supplements only the exact supplier/group Key models with marketplace modalities and limits", async () => {
    const catalog = parseSupplierCatalog({ groups: [
      { name: "my-group", models: [
        { id: "shared-chat", input_modalities: ["text", "image", "video", "audio"], max_input_images: 3, max_input_videos: 2, max_input_audios: 1, reasoning_efforts: ["high"], protocol: "gemini" },
        { id: "gpt-not-granted", max_input_images: 9 },
      ] },
      { name: "other-group", models: [{ id: "shared-chat", max_input_images: 99 }] },
    ] });
    await state.repository.saveSupplier({ id: "supplier", name: "Same supplier name", supplierKey: "rest", apiUrl: "https://exact.example/v1", siteUrl: "https://exact.example", kind: "auto", scanStatus: "live", catalog,
      state: { version: 1, revision: 1, visibility: "visible", sourceId: "exact-source", fingerprint: "test", history: [] } });
    await connection("one", { supplierId: "supplier", supplierSourceId: "exact-source", baseUrl: "https://exact.example/v1", modelGroup: "my-group", manualModels: [],
      modelScanStatus: "live", scannedModelIds: ["shared-chat"], modelCatalogModels: scanProviderModelCatalog([{ id: "shared-chat" }]).models });
    await connection("other-supplier", { modelGroup: "my-group", manualModels: [], modelScanStatus: "live", scannedModelIds: ["shared-chat"], modelCatalogModels: scanProviderModelCatalog([{ id: "shared-chat" }]).models });
    const models = await loadAgentModels();
    expect(models.find(model => model.connectionId === "one" && model.modelId === "shared-chat")).toMatchObject({
      available: true, protocol: "google-generate-content", source: "key", capabilities: { imageInput: true, videoInput: true, audioInput: true },
      inputLimits: { maxImages: 3, maxVideos: 2, maxAudios: 1 }, imageInputSource: "provider-catalog",
    });
    expect(models.find(model => model.connectionId === "one" && model.modelId === "gpt-not-granted")?.available).toBe(false);
    expect(models.find(model => model.connectionId === "other-supplier")).toMatchObject({ imageInputStatus: "assumed", inputLimits: {}, capabilities: { audioInput: false, videoInput: false } });
  });

  it("keeps current-Key negative evidence and explicit declarations above marketplace positives", async () => {
    const catalog = parseSupplierCatalog({ groups: [{ name: "group", models: [{ id: "shared-chat", input_modalities: ["text", "image"], max_input_images: 6 }] }] });
    await state.repository.saveSupplier({ id: "supplier", name: "Supplier", supplierKey: "rest", apiUrl: "https://supplier.example/v1", siteUrl: "https://supplier.example", kind: "auto", scanStatus: "live", catalog });
    const c = await connection("one", { supplierId: "supplier", baseUrl: "https://supplier.example/v1", modelGroup: "group", manualModels: [],
      modelScanStatus: "live", scannedModelIds: ["shared-chat"], modelCatalogModels: scanProviderModelCatalog([{ id: "shared-chat", imageInput: false, max_input_images: 0 }]).models });
    expect((await loadAgentModels())[0]).toMatchObject({ imageInputStatus: "unsupported", inputLimits: { maxImages: 0 } });
    const snapshot = state.repository.exportSnapshot();
    snapshot.connections[0].config.modelCatalogModels = scanProviderModelCatalog([{ id: "shared-chat" }]).models;
    snapshot.connections[0].config.agentModelEvidence = { "shared-chat": createAgentModelEvidence(c, { modelId: "shared-chat", capabilities: { imageInput: false } }) };
    state.repository = new MemoryRepository(snapshot);
    expect((await loadAgentModels())[0]).toMatchObject({ imageInputStatus: "unsupported", imageInputSource: "live", capabilities: { imageInput: false } });
  });

  it.each(["empty", "unauthorized"])("never lets documented capabilities unlock a %s Key", async status => {
    const catalog = parseSupplierCatalog({ groups: [{ name: "group", models: [{ id: "gpt-chat", input_modalities: ["text", "image"], max_input_images: 6 }] }] });
    await state.repository.saveSupplier({ id: "supplier", name: "Supplier", supplierKey: "rest", apiUrl: "https://supplier.example/v1", siteUrl: "https://supplier.example", kind: "auto", scanStatus: "live", catalog });
    await connection("one", { supplierId: "supplier", baseUrl: "https://supplier.example/v1", modelGroup: "group", manualModels: [], modelScanStatus: status, scannedModelIds: [], modelCatalogModels: scanProviderModelCatalog([{ id: "gpt-chat" }]).models });
    expect((await loadAgentModels())[0]).toMatchObject({ available: false, imageInputStatus: "supported", inputLimits: { maxImages: 6 } });
    await expect(resolveAgentModel("one", "gpt-chat")).rejects.toThrow();
  });

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
  it("enables unspecified chat vision by the user's default without needing a name hint", async () => {
    const c = await connection("one");
    expect(agentCapabilities(c, "unknown-chat").imageInput).toBe(true);
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
