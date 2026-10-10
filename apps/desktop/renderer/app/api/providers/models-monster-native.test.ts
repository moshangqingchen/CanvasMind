import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, fetch: vi.fn(), unexpected: vi.fn() }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../lib/supplier-model-pricing", () => ({ enrichSupplierModelPrices: async (_connection: unknown, models: ModelDescriptor[]) => models }));
vi.mock("../../../lib/supplier-verification", () => ({ enrichVerifiedSupplierModels: async (_id: string, models: ModelDescriptor[]) => models }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()), providerFetch: mocks.fetch }));

import { encryptSecret } from "@super-canvas/providers";
import { createSupplierRecord } from "../../../lib/supplier-service";
import { readProviderModelInventory } from "../../../lib/provider-model-inventory";
import { mikotoNativeImageCatalogUrl, monsterNativeImageCatalogUrl } from "../../../lib/monster-native-image-catalog";

const ids = ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview", "gemini-nano-banana-2.1", "nano-banana-2.1"];
const read = (query = "?refresh=1") => readProviderModelInventory(new Request(`http://localhost/api/providers/c1/models${query}`), { params: Promise.resolve({ id: "c1" }) });
beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.fetch.mockReset();
  mocks.unexpected.mockReset().mockRejectedValue(new Error("Unexpected external network"));
  vi.stubGlobal("fetch", mocks.unexpected);
  process.env.MASTER_KEY = "monster-native-test-master";
});
afterEach(() => { expect(mocks.unexpected).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

async function fixture() {
  const supplier = await createSupplierRecord({ name: "Monster", siteUrl: "https://api.eaheng.com", apiUrl: "https://api.eaheng.com/v1" });
  return mocks.repository.saveConnection({ id: "c1", name: "Monster C1", provider: "openai",
    encryptedSecret: encryptSecret("c1-key", "monster-native-test-master"), config: {
      supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, supplierKey: supplier.supplierKey,
      baseUrl: supplier.apiUrl, modelGroup: "C1-Gemini（香蕉生图）", accountKeyGroup: "C1-Gemini（香蕉生图）", accountKeyGroupId: "11",
      usage: "canvas", customGroup: true, defaultModel: ids[0], modelScanStatus: "live", modelScanComplete: true,
      modelScanCheckedAt: "2026-10-09T00:00:00Z", scannedModelIds: ids.slice(0, 3),
      modelCatalogModels: ids.slice(0, 3).map(id => ({ id, name: id, operations: ["image.generate"] })),
    } });
}

describe("Monster C1 current native inventory", () => {
  it("also persists Mikoto group 28's current native full alias without replacing it with the guide's example ID", async () => {
    const supplier = await createSupplierRecord({ name: "Mikoto", supplierKey: "mikoto", siteUrl: "https://api.mikoto.vip", apiUrl: "https://api.mikoto.vip" });
    await mocks.repository.saveConnection({ id: "c1", name: "Mikoto native alias", provider: "openai",
      encryptedSecret: encryptSecret("c1-key", "monster-native-test-master"), config: { supplierId: supplier.id,
        supplierSourceId: supplier.state!.sourceId, supplierKey: supplier.supplierKey, baseUrl: supplier.apiUrl,
        customGroup: true, modelGroup: "gemini生图", accountKeyGroupId: "28", usage: "canvas" } });
    mocks.fetch.mockImplementation(async (url, init) => {
      if (String(url) === "https://api.mikoto.vip/models") return Response.json({ error: "not found" }, { status: 404 });
      if (String(url) === "https://api.mikoto.vip/v1/models") return Response.json({ data: [{ id: "nano-banana-2.1" }] });
      expect(String(url)).toBe("https://api.mikoto.vip/v1beta/models");
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe("c1-key");
      return Response.json({ models: [{ name: "models/nano-banana-2.1", supportedGenerationMethods: ["generateContent"] }] });
    });
    const response = await read();
    expect(response.status).toBe(200);
    const models = await response.json() as ModelDescriptor[];
    expect(models.map(model => model.id)).toEqual(["nano-banana-2.1"]);
    expect(models[0]?.metadata?.nativeImageCatalogSource).toBe("https://api.mikoto.vip/v1beta/models");
    expect(models[0]?.metadata?.monsterNativeModelName).toBeUndefined();
    expect(models[0]?.parameters?.find(parameter => parameter.key === "image_size")?.options?.map(option => option.value)).toEqual(["1K", "2K", "4K"]);
    expect((await mocks.repository.getConnection("c1"))?.config.scannedModelIds).toEqual(["nano-banana-2.1"]);
    expect(mikotoNativeImageCatalogUrl({ baseUrl: supplier.apiUrl, accountKeyGroupId: "40", modelGroup: "gemini生图" })).toBeUndefined();
  });
  it("merges every native ID through the formal refresh, saves it, and returns it after restart-style cached reads", async () => {
    const prior = await fixture();
    mocks.fetch.mockImplementation(async (url, init) => {
      expect(init.method).toBe("GET");
      if (String(url) === "https://api.eaheng.com/v1/models") {
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer c1-key");
        return Response.json({ data: [...ids.slice(0, 3), "other-key-text-model"].map(id => ({ id })) });
      }
      expect(String(url)).toBe("https://api.eaheng.com/v1beta/models");
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe("c1-key");
      return Response.json({ models: ids.map(id => ({ name: `models/${id}`, supportedGenerationMethods: ["generateContent", "streamGenerateContent"] })) });
    });
    const response = await read();
    expect(response.status).toBe(200);
    const returned = await response.json() as ModelDescriptor[];
    expect(returned.map(model => model.id).sort()).toEqual([...ids, "other-key-text-model"].sort());
    const saved = (await mocks.repository.getConnection("c1"))!;
    expect(saved.config.scannedModelIds).toEqual(expect.arrayContaining(ids));
    expect(saved.config.scannedModelIds).toContain("other-key-text-model");
    expect(saved.config.modelScanComplete).toBe(true);
    expect(saved.encryptedSecret).toBe(prior.encryptedSecret);
    expect(saved.config.defaultModel).toBe(prior.config.defaultModel);
    for (const id of ids) {
      const model = returned.find(model => model.id === id)!;
      expect(model.metadata?.monsterNativeModelName).toBe(`models/${id}`);
      expect(model.operations).toEqual(["image.generate", "image.edit"]);
      expect(model.parameters?.find(parameter => parameter.key === "image_size")?.options?.map(option => option.value)).toEqual(["auto"]);
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    mocks.fetch.mockClear();
    expect((await (await read("?cached=1")).json() as ModelDescriptor[]).map(model => model.id).sort()).toEqual(returned.map(model => model.id).sort());
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps the saved inventory and marks refresh incomplete when its native half fails", async () => {
    const prior = await fixture();
    mocks.fetch.mockImplementation(async url => String(url).endsWith("/v1/models") ? Response.json({ data: [{ id: ids[0] }] }) : Response.json({ error: "native unavailable" }, { status: 503 }));
    const response = await read();
    expect(response.headers.get("X-Model-Scan-Status")).toBe("stale");
    const saved = (await mocks.repository.getConnection("c1"))!;
    expect(saved.config.scannedModelIds).toEqual(prior.config.scannedModelIds);
    expect(saved.config.modelCatalogModels).toEqual(prior.config.modelCatalogModels);
    expect(saved.config.modelScanComplete).toBe(false);
    expect(saved.encryptedSecret).toBe(prior.encryptedSecret);
  });

  it("scopes the extra Key read to this origin and official group identity", () => {
    const config = { baseUrl: "https://api.eaheng.com/v1", modelGroup: "C1-Gemini（香蕉生图）", accountKeyGroupId: "11" };
    expect(monsterNativeImageCatalogUrl(config)).toBe("https://api.eaheng.com/v1beta/models");
    for (const change of [{ accountKeyGroupId: "12" }, { baseUrl: "https://example.com/v1" }, { baseUrl: "https://api.eaheng.com/other" }])
      expect(monsterNativeImageCatalogUrl({ ...config, ...change })).toBeUndefined();
  });
});
