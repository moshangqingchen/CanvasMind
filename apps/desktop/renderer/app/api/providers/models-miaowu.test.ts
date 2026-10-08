import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryRepository } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository,
  transport: vi.fn(), documents: vi.fn(), unexpectedNetwork: vi.fn() }));
vi.mock("@super-canvas/db", async original => ({ ...await original<typeof import("@super-canvas/db")>(), getRepository: () => mocks.repository }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../lib/master-key", () => ({ requireServerMasterKey: () => "miaowu-inventory-test-master" }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(), providerFetch: mocks.transport }));
vi.mock("../../../lib/supplier-interface-documents", () => ({ readSupplierInterfaceDocuments: mocks.documents }));
// This regression exercises the real inventory service, Miaowu scanner, public
// media parser and protocol binder. Other suppliers' price discovery is outside
// that boundary; the actual Miaowu parser has already produced these quotes.
vi.mock("../../../lib/supplier-model-pricing", async original => ({ ...await original<typeof import("../../../lib/supplier-model-pricing")>(),
  enrichSupplierModelPrices: async (_connection: unknown, models: readonly ModelDescriptor[]) => [...models] }));
import { encryptSecret } from "@super-canvas/providers";
import { readProviderModelInventory } from "../../../lib/provider-model-inventory";
import { MIAOWU_BASE_URL, MIAOWU_PRESET_ID } from "../../../lib/miaowu-presets";

const publicPricing = JSON.parse(readFileSync(new URL("../../../lib/miaowu-catalog-20261008.fixture.json", import.meta.url), "utf8"));
const directories = JSON.parse(readFileSync(new URL("../../../lib/miaowu-server-20261008.fixture.json", import.meta.url), "utf8"));
const key = "miaowu-inventory-test-key";
const connectionId = "miaowu-inventory";
let dreamStatus = 200;
let genericStatus = 200;
const readInventory = (query = "refresh=1") => readProviderModelInventory(
  new Request(`http://localhost/api/providers/${connectionId}/models${query ? `?${query}` : ""}`), { params: Promise.resolve({ id: connectionId }) });

beforeEach(async () => {
  mocks.repository = new MemoryRepository();
  dreamStatus = 200;
  genericStatus = 200;
  delete (globalThis as Record<string, unknown>).__superCanvasMiaowuCatalog;
  mocks.documents.mockReset().mockResolvedValue([]);
  mocks.unexpectedNetwork.mockReset().mockRejectedValue(new Error("Unexpected real network"));
  vi.stubGlobal("fetch", mocks.unexpectedNetwork);
  mocks.transport.mockReset().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    const request = new URL(String(url));
    expect(request.origin).toBe(MIAOWU_BASE_URL);
    if (request.pathname === "/api/pricing") return Response.json(publicPricing);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${key}`);
    if (request.pathname === "/v1/models") return Response.json({ data: directories.openaiModels }, { status: genericStatus });
    if (request.pathname === "/v1/dream/model_list") return Response.json({ data: directories.dreamModels }, { status: dreamStatus });
    throw new Error("Unapproved test endpoint");
  });
  await mocks.repository.saveConnection({ id: connectionId, provider: "rest", name: "Miaowu isolated inventory",
    encryptedSecret: encryptSecret(key, "miaowu-inventory-test-master"), config: { preset: MIAOWU_PRESET_ID,
      supplierKey: "miaowu", baseUrl: MIAOWU_BASE_URL, modelGroup: "default", accountKeyGroup: "default",
      supplierSourceId: "isolated-source", defaultModel: "sora-2", usage: "canvas" } });
});
afterEach(() => {
  try { expect(mocks.unexpectedNetwork).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); delete (globalThis as Record<string, unknown>).__superCanvasMiaowuCatalog; }
});

describe("Miaowu authenticated union through the shared inventory entry", () => {
  it("persists the complete real 23-ID union with 18 priced native contracts and 5 pending contracts", async () => {
    const response = await readInventory();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Model-Scan-Complete")).toBe("true");
    const models: ModelDescriptor[] = await response.json();
    expect(models).toHaveLength(23);
    expect(models.filter(model => model.pricing)).toHaveLength(18);
    expect(models.find(model => model.id === "dola-seedance-2.5")).toMatchObject({ outputKinds: ["video"],
      pricing: { currency: "CNY", unitAmount: .875 }, metadata: { canvasRunnable: true } });
    expect(models.filter(model => model.metadata?.miaowuVideoContractPending)).toHaveLength(5);
    const saved = (await mocks.repository.getConnection(connectionId))!;
    expect(saved.config).toMatchObject({ modelScanComplete: true, modelScanAttemptStatus: "live", modelScanError: null });
    expect(saved.config.scannedModelIds).toHaveLength(23);
    expect(saved.config.modelCatalogModels).toEqual(models);
    expect(saved.config.modelScanLastSuccessAt).toBe(response.headers.get("X-Model-Scan-Last-Success-At"));
    expect(mocks.transport).toHaveBeenCalledTimes(3);
  });

  it.each([404, 401, 403])("preserves this attempt's generic 15 and partial status when Dream returns HTTP %s", async status => {
    dreamStatus = status;
    const response = await readInventory();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Model-Scan-Status")).toBe("live");
    expect(response.headers.get("X-Model-Scan-Complete")).toBe("false");
    expect(response.headers.get("X-Model-Scan-Error-Code")).toBe("incomplete_directory");
    expect(response.headers.get("X-Model-Scan-Http-Status")).toBe(String(status));
    expect(response.headers.get("X-Model-Scan-Last-Success-At")).toBeNull();
    const models: ModelDescriptor[] = await response.json();
    expect(models).toHaveLength(15);
    expect(models.map(model => model.id).sort()).toEqual(directories.openaiModels.map((model: { id: string }) => model.id).sort());
    expect(models.filter(model => model.pricing)).toHaveLength(10);
    expect(models.some(model => model.id === "dola-seedance-2.5")).toBe(false);
    const saved = (await mocks.repository.getConnection(connectionId))!;
    expect(saved.config).toMatchObject({ modelScanStatus: "live", modelScanAttemptStatus: "failed", modelScanComplete: false,
      modelScanErrorCode: "incomplete_directory", modelScanHttpStatus: status, modelScanLastSuccessAt: null });
    expect(saved.config.modelScanError).toBeTruthy();
    expect(saved.config.modelCatalogModels).toEqual(models);
    expect(saved.config.scannedModelIds).toHaveLength(15);
    expect(mocks.documents).not.toHaveBeenCalled();
  });

  it.each([404, 401])("retains or revokes only Dream-scoped history and keeps cached partial state after HTTP %s", async status => {
    const first = await readInventory();
    expect(first.headers.get("X-Model-Scan-Complete")).toBe("true");
    const lastSuccess = first.headers.get("X-Model-Scan-Last-Success-At");
    dreamStatus = status;
    const response = await readInventory();
    const models: ModelDescriptor[] = await response.json();
    const expectedCount = status === 404 ? 23 : 15;
    expect(models).toHaveLength(expectedCount);
    expect(response.headers.get("X-Model-Scan-Complete")).toBe("false");
    expect(response.headers.get("X-Model-Scan-Last-Success-At")).toBe(lastSuccess);
    const saved = (await mocks.repository.getConnection(connectionId))!;
    expect(saved.config).toMatchObject({ modelScanStatus: "live", modelScanAttemptStatus: "failed", modelScanComplete: false,
      modelScanLastSuccessAt: lastSuccess, modelScanErrorCode: "incomplete_directory" });
    expect(saved.config.scannedModelIds).toHaveLength(expectedCount);
    expect(saved.config.modelCatalogModels).toEqual(models);
    if (status === 404) expect(models.find(model => model.id === "dola-seedance-2.5")?.metadata).toMatchObject({ mediaDirectoryStale: true });
    else expect(models.some(model => model.id === "dola-seedance-2.5")).toBe(false);
    expect(saved.config.modelRemovedModels).toEqual([]);
    const calls = mocks.transport.mock.calls.length;
    for (const query of ["cached=1", ""]) {
      const cached = await readInventory(query);
      expect(cached.headers.get("X-Model-Scan-Complete")).toBe("false");
      expect(cached.headers.get("X-Model-Scan-Last-Success-At")).toBe(lastSuccess);
      const cachedModels: ModelDescriptor[] = await cached.json();
      expect(cachedModels.map(model => model.id)).toEqual(models.map(model => model.id));
    }
    expect(mocks.transport).toHaveBeenCalledTimes(calls);
  });

  it("keeps a generic-directory authentication failure closed even though public quotes are available", async () => {
    genericStatus = 401;
    const response = await readInventory();
    expect(response.status).toBe(401);
    expect(response.headers.get("X-Model-Scan-Complete")).toBe("false");
    expect(response.headers.get("X-Model-Scan-Status")).toBe("unauthorized");
    expect(mocks.transport.mock.calls.some(([url]) => String(url).includes("/v1/dream/"))).toBe(false);
    const saved = (await mocks.repository.getConnection(connectionId))!;
    expect(saved.config.modelScanStatus).toBe("unauthorized");
    expect(saved.config.modelCatalogModels).toBeUndefined();
  });
});
