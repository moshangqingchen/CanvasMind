import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";

const state = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository }));
vi.mock("./server", () => ({ get repository() { return state.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
import { readProviderModelInventory } from "./provider-model-inventory";
import { loadDirectorCatalog } from "./director-catalog";
import { loadAgentCatalog } from "./agent-catalog";
import { loadAgentModelCatalogSnapshot } from "./agent-models";
import { AGENT_UNREAD_CATALOG_MESSAGE } from "./agent-catalog-status";
import { CANGYUAN_AZURE_IMAGE_GROUP } from "./provider-presets";

const network = vi.fn();
beforeEach(() => {
  state.repository = new MemoryRepository();
  network.mockReset().mockRejectedValue(new Error("Assistant catalog must never contact upstream"));
  vi.stubGlobal("fetch", network);
});
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const image: ModelDescriptor = {
  id: "exact/image-id", name: "已保存图片渠道", operations: ["image.generate", "image.edit"], inputKinds: ["text", "image"], outputKinds: ["image"],
  parameters: [{ key: "quality", label: "质量", control: "select", options: [{ value: "high", label: "最高" }], default: "high" }],
  pricing: { kind: "per-image", currency: "CNY", unitAmount: 0.25, billingUnit: "image", confidence: "exact", checkedAt: "2026-10-16",
    sourceUrl: "https://cached.example.test/prices",
    tiers: [{ id: "high", label: "最高质量", price: 0.5, conditions: [{ parameter: "quality", operator: "equals", value: "high" }] }] },
  metadata: { canvasRunnable: true, operationsSource: "declared", inputKindsSource: "declared", outputKindsSource: "declared", priceSource: "manual" },
};
async function fixture(extra: Record<string, unknown> = {}) {
  // A legacy supplier without state used to migrate and save on a cached read.
  await state.repository.saveSupplier({ id: "saved-supplier", name: "缓存供应商", supplierKey: "rest", kind: "auto",
    apiUrl: "https://cached.example.test/v1", siteUrl: "https://cached.example.test", scanStatus: "live", catalog: { groups: [] } });
  return state.repository.saveConnection({ id: "cached-key", provider: "rest", name: "缓存渠道", encryptedSecret: "fixture-only",
    config: { usage: "canvas", supplierId: "saved-supplier", baseUrl: "https://cached.example.test/v1", modelGroup: "已存分组",
      modelScanStatus: "live", scannedModelIds: [image.id], modelCatalogModels: [image],
      connector: { submit: { path: "/v1/images/generations", method: "POST", mappings: [{ target: "model", source: { kind: "request", path: "$.model" } }] }, models: [image] },
      ...extra } });
}
function read(id = "cached-key", query = "cached=1&readonly=1") {
  return readProviderModelInventory(new Request(`http://localhost/api/providers/${id}/models?${query}`), { params: Promise.resolve({ id }) });
}
function watchWrites() {
  return ["saveConnection", "saveSupplier", "commitSupplier", "commitCatalogSnapshot", "setApplicationSetting"]
    .map(name => vi.spyOn(state.repository, name as "saveConnection"));
}

describe("assistant saved catalog boundary", () => {
  it("keeps the complete saved catalog, prices and parameters usable without upstream or repository writes", async () => {
    await fixture();
    const before = state.repository.exportSnapshot();
    const writes = watchWrites();
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Model-Cache-Status")).toBe("saved");
    const models = await response.json() as ModelDescriptor[];
    expect(models).toMatchObject([{ id: image.id, operations: image.operations, parameters: image.parameters, pricing: image.pricing }]);
    expect(await loadDirectorCatalog()).toMatchObject([{ connectionId: "cached-key", model: { id: image.id, pricing: image.pricing } }]);
    expect(await loadAgentCatalog()).toMatchObject([{ connectionId: "cached-key", model: { id: image.id, parameters: image.parameters } }]);
    expect(writes.every(write => write.mock.calls.length === 0)).toBe(true);
    expect(state.repository.exportSnapshot()).toEqual(before);
  });

  it.each(["missing", "unscanned"])("returns unread metadata for a %s directory instead of scanning or treating it as unsupported", async kind => {
    await fixture(kind === "missing" ? { modelCatalogModels: undefined } : { modelScanStatus: "unscanned" });
    const before = state.repository.exportSnapshot();
    const writes = watchWrites();
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(response.headers.get("X-Model-Cache-Status")).toBe("unread");
    expect(response.headers.get("X-Model-Scan-Status")).toBe("unscanned");
    expect(await loadAgentCatalog()).toEqual([]);
    expect((await loadAgentModelCatalogSnapshot()).connections).toEqual([{ connectionId: "cached-key", connectionName: "缓存渠道",
      supplierId: "saved-supplier", supplierName: "缓存供应商", status: "unread" }]);
    expect(writes.every(write => write.mock.calls.length === 0)).toBe(true);
    expect(state.repository.exportSnapshot()).toEqual(before);
  });

  it("keeps native-group reconciliation in memory even if a legacy client also requests refresh", async () => {
    await state.repository.saveSupplier({ id: "native", supplierKey: "cangyuan", name: "原生组", kind: "auto",
      siteUrl: "https://ai.cangyuansuanli.cn", apiUrl: "https://ai.cangyuansuanli.cn", scanStatus: "live", catalog: { groups: [] },
      state: { version: 1, revision: 1, sourceId: "current", fingerprint: "fixture", visibility: "visible", history: [] } });
    const saved = await state.repository.saveConnection({ id: "native-key", provider: "openai", encryptedSecret: "fixture-only", name: "原生缓存",
      config: { usage: "canvas", baseUrl: "https://ai.cangyuansuanli.cn", supplierKey: "cangyuan", supplierId: "native", supplierSourceId: "current",
        accountKeyId: "fixture-key", accountKeyImportedAt: "2026-10-16", accountKeyGroup: CANGYUAN_AZURE_IMAGE_GROUP, modelGroup: CANGYUAN_AZURE_IMAGE_GROUP,
        modelScanStatus: "live", scannedModelIds: ["gpt-image-2-az"], modelCatalogModels: [{ ...image, id: "gpt-image-2-az" }] } });
    const writes = watchWrites();
    const response = await read("native-key", "cached=1&readonly=1&refresh=1");
    expect(response.status).toBe(200);
    expect((await response.json())[0]).toMatchObject({ id: "gpt-image-2-az", operations: ["image.generate", "image.edit"] });
    expect(writes.every(write => write.mock.calls.length === 0)).toBe(true);
    expect(await state.repository.getConnection(saved.id)).toEqual(saved);
  });

  it("does not migrate or save when a malformed cached model cannot be projected", async () => {
    await fixture({ modelCatalogModels: [null] });
    const before = state.repository.exportSnapshot();
    const writes = watchWrites();
    expect((await read()).status).toBe(500);
    expect(writes.every(write => write.mock.calls.length === 0)).toBe(true);
    expect(state.repository.exportSnapshot()).toEqual(before);
  });

  it("reads saved chat model choices without fetching, migrating suppliers or rewriting prices", async () => {
    const chat: ModelDescriptor = { id: "chat/full-model-id", name: "已存对话型号", operations: [], inputKinds: ["text"], outputKinds: ["text"],
      pricing: { kind: "token", currency: "CNY", inputPerMillion: 3, outputPerMillion: 12, confidence: "exact", checkedAt: "2026-10-16" },
      metadata: { catalogCapability: "chat", inputKindsSource: "declared", outputKindsSource: "declared", agentProtocol: "chat-completions" } };
    await fixture({ usage: "agent", modelCatalogModels: [chat], scannedModelIds: [chat.id] });
    const before = state.repository.exportSnapshot();
    const writes = watchWrites();
    expect(await loadAgentModelCatalogSnapshot()).toMatchObject({
      models: [{ modelId: chat.id, connectionId: "cached-key", available: true, pricing: chat.pricing }],
      connections: [{ connectionId: "cached-key", status: "saved" }],
    });
    expect(writes.every(write => write.mock.calls.length === 0)).toBe(true);
    expect(state.repository.exportSnapshot()).toEqual(before);
  });

  it("retains source-identity guards without migrating a legacy supplier to satisfy them", async () => {
    await fixture({ supplierSourceId: "old-source" });
    const before = state.repository.exportSnapshot();
    const writes = watchWrites();
    expect((await read()).status).toBe(409);
    expect(await loadDirectorCatalog()).toEqual([]);
    expect((await loadAgentModelCatalogSnapshot()).models).toEqual([]);
    expect(writes.every(write => write.mock.calls.length === 0)).toBe(true);
    expect(state.repository.exportSnapshot()).toEqual(before);
  });

  it("labels unread model hints as a settings action rather than unsupported capability", async () => {
    await fixture({ modelScanStatus: "unscanned", modelCatalogModels: undefined, scannedModelIds: undefined,
      connector: undefined, defaultModel: "gpt-chat-hint" });
    const snapshot = await loadAgentModelCatalogSnapshot();
    expect(snapshot.models).toMatchObject([{ modelId: "gpt-chat-hint", available: false, reason: AGENT_UNREAD_CATALOG_MESSAGE }]);
    expect(snapshot.connections[0]?.status).toBe("unread");
  });
});
