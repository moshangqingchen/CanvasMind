import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository,
  models: [] as ModelDescriptor[], list: vi.fn(), transport: vi.fn(), unexpectedNetwork: vi.fn() }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../lib/master-key", () => ({ requireServerMasterKey: () => "selection-test-master" }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(), providerFetch: mocks.transport }));
vi.mock("@super-canvas/runtime", async original => ({ ...await original<typeof import("@super-canvas/runtime")>(),
  getRunService: () => ({ adapters: () => new Map(["openai", "weai"].map(provider => [provider, { listModels: mocks.list }])) }) }));
vi.mock("../../../lib/supplier-model-pricing", () => ({ enrichSupplierModelPrices: async (_connection: unknown, models: readonly ModelDescriptor[]) => [...models] }));
vi.mock("../../../lib/supplier-interface-documents", () => ({ readSupplierInterfaceDocuments: vi.fn(async () => []) }));
vi.mock("../../../lib/agent-model-discovery", () => ({ discoverAgentModelCapabilities: async (_connection: unknown, models: readonly ModelDescriptor[]) => [...models] }));
vi.mock("../../../lib/weai-pricing-server", () => ({ liveWeAiPricingForGroup: async () => undefined }));
vi.mock("../../../lib/supplier-verification", () => ({ enrichVerifiedSupplierModels: async (_id: string, models: readonly ModelDescriptor[]) => [...models] }));

import { encryptSecret } from "@super-canvas/providers";
import { readProviderModelInventory } from "../../../lib/provider-model-inventory";
import { savedModelAvailabilityError } from "../../../lib/model-availability";

const id = "selection-preservation";
const read = (query: string, automatic = false) => readProviderModelInventory(new Request(`http://localhost/api/providers/${id}/models${query}`),
  { params: Promise.resolve({ id }), ...(automatic ? { supplierRefreshId: "automatic-account-refresh" } : {}) });
const current: ModelDescriptor = { id: "gpt-image-2", name: "Current image", operations: ["image.generate", "image.edit"], outputKinds: ["image"],
  metadata: { canvasRunnable: true, protocol: "openai-images" } };

beforeEach(() => {
  mocks.repository = new MemoryRepository(); mocks.models = [structuredClone(current)];
  mocks.list.mockReset().mockImplementation(async () => structuredClone(mocks.models));
  mocks.transport.mockReset().mockImplementation(async (url, init) => {
    expect(new URL(String(url)).pathname).toBe("/v1/models"); expect(init?.method).toBe("GET");
    return Response.json({ data: mocks.models.map(model => ({ id: model.id, operations: model.operations, output_modalities: model.outputKinds ?? ["text"] })) });
  });
  mocks.unexpectedNetwork.mockReset().mockRejectedValue(new Error("No real network or paid run may execute"));
  vi.stubGlobal("fetch", mocks.unexpectedNetwork);
});
afterEach(() => { expect(mocks.unexpectedNetwork).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

async function fixture(kind: "adapter" | "custom" | "weai" | "agent", selected: unknown) {
  return mocks.repository.saveConnection({ id, name: "Saved user choice", provider: kind === "weai" ? "weai" : "openai",
    encryptedSecret: encryptSecret("selection-fixture-key", "selection-test-master"), config: {
      baseUrl: "https://selection.test/v1", supplierKey: "selection-fixture", usage: kind === "agent" ? "agent" : "canvas", defaultModel: selected as string,
      ...(kind === "custom" ? { customGroup: true } : {}), modelGroup: "saved-group", accountKeyGroup: "saved-group",
      modelScanStatus: "failed", modelScanComplete: false, modelScanLastSuccessAt: "2026-10-01T00:00:00Z",
      modelCatalogModels: [current], scannedModelIds: [current.id], savedUserValues: { duration: 19, resolution: "720p" },
    } });
}

describe("refresh preserves an existing model selection independently of availability", () => {
  it.each(["adapter", "custom", "weai", "agent"] as const)("keeps the absent %s selection through automatic/manual scans, confirmation-only updates and repository reload", async kind => {
    const selected = kind === "agent" ? "codex-auto-review" : "SD2.5特价30-10-10-线路一";
    const original = await fixture(kind, selected);
    let confirmedModels: unknown;
    for (const automatic of [true, false]) {
      const response = await read("?refresh=1", automatic);
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Model-Scan-Complete")).toBe("true");
      const saved = (await mocks.repository.getConnection(id))!;
      expect(saved.config.defaultModel).toBe(selected);
      expect(saved.config.modelScanStatus).toBe("live"); expect(saved.config.modelScanComplete).toBe(true);
      if (automatic) confirmedModels = structuredClone(saved.config.modelCatalogModels);
      else expect(saved.config.modelCatalogModels).toEqual(confirmedModels);
      expect(saved.config.savedUserValues).toEqual(original.config.savedUserValues);
      if (kind !== "agent") expect(savedModelAvailabilityError(saved.config)).toContain("已不在");
      // Reopening only the persisted connection simulates cache hydration after
      // restart, with no in-memory scan result supplying a replacement choice.
      const reloaded = new MemoryRepository(); await reloaded.saveConnection(structuredClone(saved)); mocks.repository = reloaded;
      const cached = await read("?cached=1"); expect(cached.status).toBe(200);
      expect((await mocks.repository.getConnection(id))?.config.defaultModel).toBe(selected);
      if (automatic) await mocks.repository.saveConnection({ ...saved, config: { ...saved.config, modelScanComplete: false, modelScanStatus: "failed" } });
    }
  });

  it("retains a present but denied model instead of selecting a runnable sibling", async () => {
    const selected = "saved-denied-model";
    mocks.models.push({ id: selected, name: selected, operations: [], metadata: { canvasRunnable: false, canvasUnavailableReason: "上游权限禁止" } });
    await fixture("adapter", selected);
    expect((await read("?refresh=1")).status).toBe(200);
    const saved = (await mocks.repository.getConnection(id))!;
    expect(saved.config.defaultModel).toBe(selected);
    expect(savedModelAvailabilityError(saved.config)).toContain("当前不可用于画布");
  });

  it.each(["adapter", "custom", "weai"] as const)("selects an available current model only for an empty %s connection", async kind => {
    await fixture(kind, "");
    expect((await read("?refresh=1")).status).toBe(200);
    expect((await mocks.repository.getConnection(id))?.config.defaultModel).toBe(current.id);
  });

  it("chooses a text model for a new agent connection while retaining the complete mixed Key directory", async () => {
    mocks.models.push({ id: "gpt-5.6", name: "Text", operations: [], outputKinds: ["text"] });
    await fixture("agent", "");
    expect((await read("?refresh=1")).status).toBe(200);
    const saved = (await mocks.repository.getConnection(id))!;
    expect(saved.config.defaultModel).toBe("gpt-5.6");
    expect(saved.config.scannedModelIds).toEqual(["gpt-image-2", "gpt-5.6"]);
  });

  it("retains an old selection on a complete empty directory and still blocks submitting it", async () => {
    await fixture("adapter", "retained-empty-directory-model"); mocks.models = [];
    expect((await read("?refresh=1")).status).toBe(200);
    const saved = (await mocks.repository.getConnection(id))!;
    expect(saved.config.defaultModel).toBe("retained-empty-directory-model");
    expect(saved.config.modelScanStatus).toBe("empty");
    expect(savedModelAvailabilityError(saved.config)).toContain("列表为空");
  });

  it("preserves the exact saved string and keeps authentication denial on submit/cache reads", async () => {
    await fixture("custom", " original-user-value ");
    mocks.transport.mockResolvedValue(Response.json({ error: { message: "invalid credentials" } }, { status: 401 }));
    expect((await read("?refresh=1")).status).toBe(401);
    const saved = (await mocks.repository.getConnection(id))!;
    expect(saved.config.defaultModel).toBe(" original-user-value ");
    expect(savedModelAvailabilityError(saved.config)).toContain("鉴权失败");
    expect((await read("?cached=1")).status).toBe(401);
    expect((await mocks.repository.getConnection(id))?.config.defaultModel).toBe(" original-user-value ");
  });
});
