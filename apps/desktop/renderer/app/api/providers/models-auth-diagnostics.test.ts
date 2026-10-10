import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository,
  transport: vi.fn(), unexpectedNetwork: vi.fn() }));
vi.mock("@super-canvas/db", async original => ({ ...await original<typeof import("@super-canvas/db")>(),
  getRepository: () => mocks.repository }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../lib/master-key", () => ({ requireServerMasterKey: () => "auth-diagnostic-test-master" }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(),
  providerFetch: mocks.transport }));
// These public price catalogs are independent of the authenticated Key directory.
vi.mock("../../../lib/chentu-catalog", async original => {
  const catalog = await original<typeof import("../../../lib/chentu-catalog")>();
  return { ...catalog, loadChentuCatalog: vi.fn(async () => catalog.chentuCatalogFromPricing({ data: [] })) };
});
vi.mock("../../../lib/miaowu-catalog", async original => {
  const catalog = await original<typeof import("../../../lib/miaowu-catalog")>();
  return { ...catalog, loadMiaowuCatalog: vi.fn(async () => catalog.miaowuCatalogFromPricing({ data: [] })) };
});
vi.mock("../../../lib/cyberafei-catalog", async original => {
  const catalog = await original<typeof import("../../../lib/cyberafei-catalog")>();
  return { ...catalog, loadCyberAfeiCatalog: vi.fn(async () => catalog.cyberAfeiCatalogFromPricing({ data: [] })) };
});
vi.mock("../../../lib/supplier-model-pricing", () => ({
  enrichSupplierModelPrices: async (_connection: unknown, models: readonly unknown[]) => [...models],
}));
vi.mock("../../../lib/supplier-interface-documents", () => ({ readSupplierInterfaceDocuments: vi.fn(async () => []) }));

import { encryptSecret } from "@super-canvas/providers";
import { readProviderModelInventory } from "../../../lib/provider-model-inventory";
import { savedModelAvailabilityError } from "../../../lib/model-availability";

const key = "auth-diagnostic-fixture-key";
const connectionId = "auth-diagnostic-connection";
const cases = [
  { supplierKey: "mikoto", preset: "mikoto-pro", baseUrl: "https://api.mikoto.vip", provider: "weai" },
  { supplierKey: "chentu", preset: "chentu-openai-images", baseUrl: "https://tu.988236.xyz/v1", provider: "openai" },
  { supplierKey: "miaowu", preset: "miaowu-openai-videos", baseUrl: "https://api.miaowuai.store", provider: "rest" },
  { supplierKey: "frimodel", preset: "frimodel-openai-images", baseUrl: "https://api.frimodel.com/v1", provider: "openai" },
  { supplierKey: "cyberafei", preset: "cyberafei-api", baseUrl: "https://api.3365api.cn/v1", provider: "rest" },
];
const read = (query: string) => readProviderModelInventory(new Request(
  `http://localhost/api/providers/${connectionId}/models${query}`,
), { params: Promise.resolve({ id: connectionId }) });

beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.transport.mockReset();
  mocks.unexpectedNetwork.mockReset().mockRejectedValue(new Error("Unexpected external transport"));
  vi.stubGlobal("fetch", mocks.unexpectedNetwork);
});
afterEach(() => {
  try { expect(mocks.unexpectedNetwork).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

describe("dedicated directory denial diagnostics", () => {
  it.each(cases.flatMap(supplier => [401, 403].flatMap(status =>
    [undefined, ...(status === 403 ? ["GROUP_DELETED", "GROUP_DISABLED", "GROUP_NOT_ALLOWED"] : [])]
      .map(upstreamErrorCode => ({ ...supplier, status, upstreamErrorCode })))))(
    "$supplierKey preserves upstream $status/$upstreamErrorCode through refresh, saved state and cache without granting historical models",
    async ({ status, upstreamErrorCode, ...supplier }) => {
      const historicalModels = [{ id: "historical-image", name: "Historical image", operations: ["image.generate"] }];
      const initial = await mocks.repository.saveConnection({ id: connectionId, name: "Fixture", provider: supplier.provider,
        encryptedSecret: encryptSecret(key, "auth-diagnostic-test-master"), config: { ...supplier, modelGroup: "fixture-group", usage: "canvas",
          modelScanStatus: "live", modelScanLastSuccessAt: "2026-10-01T00:00:00Z", modelCatalogModels: historicalModels,
          scannedModelIds: ["historical-image"], manualModels: [{ id: "manual-image", capability: "image", protocol: "openai-images" }] } });
      mocks.transport.mockImplementation(async (url, init) => {
        expect(new URL(String(url)).pathname).toBe("/v1/models");
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
        return Response.json({ error: { code: upstreamErrorCode, message: `private upstream body ${key}` } }, { status });
      });
      const response = await read("?refresh=1");
      const code = status === 403 ? "permission_denied" : "invalid_credentials";
      expect(response.status).toBe(status);
      expect(response.headers.get("X-Model-Scan-Error-Code")).toBe(code);
      expect(response.headers.get("X-Model-Scan-Http-Status")).toBe(String(status));
      expect(response.headers.get("X-Model-Scan-Upstream-Error-Code")).toBe(upstreamErrorCode ?? null);
      const body = await response.json();
      const message = upstreamErrorCode === "GROUP_DELETED" ? "分组已删除"
        : upstreamErrorCode === "GROUP_DISABLED" ? "分组已停用"
          : upstreamErrorCode === "GROUP_NOT_ALLOWED" ? "账号不允许" : status === 403 ? "分组权限" : "鉴权失败";
      expect(body).toEqual({ error: expect.stringContaining(message) });
      expect(JSON.stringify(body)).not.toContain(key);
      expect(mocks.transport).toHaveBeenCalledTimes(1);
      const saved = (await mocks.repository.getConnection(connectionId))!;
      expect(saved.config).toMatchObject({ modelScanStatus: "unauthorized", modelScanErrorCode: code,
        modelScanHttpStatus: status, modelScanUpstreamErrorCode: upstreamErrorCode ?? null,
        modelScanComplete: false, modelScanLastSuccessAt: "2026-10-01T00:00:00Z" });
      expect(saved.config.modelCatalogModels).toEqual(historicalModels);
      expect(saved.encryptedSecret).toBe(initial.encryptedSecret);
      expect(savedModelAvailabilityError(saved.config, "historical-image")).toBeTruthy();
      mocks.transport.mockClear();
      for (const query of ["", "?cached=1"]) {
        const cached = await read(query);
        expect(cached.status).toBe(status);
        expect(cached.headers.get("X-Model-Scan-Error-Code")).toBe(code);
        expect(cached.headers.get("X-Model-Scan-Http-Status")).toBe(String(status));
        expect(cached.headers.get("X-Model-Scan-Upstream-Error-Code")).toBe(upstreamErrorCode ?? null);
        expect(cached.headers.get("X-Model-Scan-Status")).toBe("unauthorized");
        expect(await cached.json()).toEqual(body);
      }
      expect(mocks.transport).not.toHaveBeenCalled();
      expect(await mocks.repository.getConnection(connectionId)).toEqual(saved);
    },
  );

  it.each([
    { evidence: {}, status: 401, code: "invalid_credentials" },
    { evidence: { modelScanErrorCode: "permission_denied" }, status: 403, code: "permission_denied" },
    { evidence: { modelScanHttpStatus: 403, modelScanErrorCode: "invalid_credentials" }, status: 403, code: "permission_denied" },
    { evidence: { modelScanHttpStatus: 401, modelScanErrorCode: "permission_denied" }, status: 401, code: "invalid_credentials" },
  ])("keeps legacy denial closed and prefers recorded HTTP evidence: $evidence", async ({ evidence, status, code }) => {
    const connection = await mocks.repository.saveConnection({ id: connectionId, name: "Legacy denied", provider: "openai",
      encryptedSecret: encryptSecret(key, "auth-diagnostic-test-master"), config: { baseUrl: "https://supplier.example.test/v1",
        modelScanStatus: "unauthorized", modelCatalogModels: [{ id: "historical", name: "Historical", operations: ["image.generate"] }],
        ...evidence } });
    for (const query of ["", "?cached=1"]) {
      const response = await read(query);
      expect(response.status).toBe(status);
      expect(response.headers.get("X-Model-Scan-Error-Code")).toBe(code);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    }
    expect(mocks.transport).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(connectionId)).toEqual(connection);
  });

  it("clears an old group-denial code only after a new complete authenticated directory succeeds", async () => {
    await mocks.repository.saveConnection({ id: connectionId, name: "Recovered fixture", provider: "openai",
      encryptedSecret: encryptSecret(key, "auth-diagnostic-test-master"), config: { baseUrl: "https://supplier.example.test/v1",
        customGroup: true, modelScanStatus: "unauthorized", modelScanErrorCode: "permission_denied", modelScanHttpStatus: 403,
        modelScanUpstreamErrorCode: "GROUP_DISABLED", modelCatalogModels: [] } });
    mocks.transport.mockResolvedValue(Response.json({ data: [{ id: "gpt-image-2" }] }));
    const response = await read("?refresh=1");
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Model-Scan-Upstream-Error-Code")).toBeNull();
    expect(mocks.transport).toHaveBeenCalledTimes(1);
    expect((await mocks.repository.getConnection(connectionId))?.config).toMatchObject({ modelScanStatus: "live",
      modelScanComplete: true, modelScanErrorCode: null, modelScanHttpStatus: null, modelScanUpstreamErrorCode: null });
  });
});
