import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, fetch: vi.fn(), unexpected: vi.fn() }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../lib/supplier-model-pricing", () => ({ enrichSupplierModelPrices: async (_connection: unknown, models: ModelDescriptor[]) => models }));
vi.mock("../../../lib/supplier-verification", () => ({ enrichVerifiedSupplierModels: async (_id: string, models: ModelDescriptor[]) => models }));
vi.mock("../../../lib/supplier-document", () => ({ readSupplierDocument: async () => undefined }));
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
  it.each([
    { origin: "https://api.eaheng.com", groupId: "11", group: "C1-Gemini（香蕉生图）", supplierKey: undefined, preset: undefined },
    { origin: "https://api.mikoto.vip", groupId: "28", group: "gemini生图", supplierKey: "mikoto", preset: "mikoto-pro" },
  ])("preserves a legacy agent consumer while saving its same-Key native union: $origin", async ({ origin, groupId, group, supplierKey, preset }) => {
    const supplier = await createSupplierRecord({ name: "Native agent", siteUrl: origin, apiUrl: `${origin}/v1`, supplierKey });
    const prior = await mocks.repository.saveConnection({ id: "c1", name: "Original agent", provider: "rest",
      encryptedSecret: encryptSecret("agent-native-key", "monster-native-test-master"), config: {
        supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, supplierKey: supplier.supplierKey,
        baseUrl: supplier.apiUrl, modelGroup: group, accountKeyGroup: group, accountKeyGroupId: groupId,
        usage: "agent", customGroup: false, protocol: "responses", directorProtocol: "responses",
        ...(preset ? { preset } : {}),
        defaultModel: "gpt-6-astra", allowedModels: ["gpt-6-astra"], modelNames: { "gpt-6-astra": "Agent label" },
      } });
    // A sibling connection has a different Key and extra saved media. It must
    // never participate in this connection's directory union.
    const sibling = await mocks.repository.saveConnection({ id: "sibling", name: "Sibling", provider: "openai",
      encryptedSecret: encryptSecret("sibling-key", "monster-native-test-master"), config: {
        ...prior.config, usage: "canvas", modelCatalogModels: [{ id: "sibling-image", name: "Sibling", operations: ["image.generate"] }],
        scannedModelIds: ["sibling-image"],
      } });
    mocks.fetch.mockImplementation(async (url, init) => {
      expect(init.method).toBe("GET");
      const headers = new Headers(init.headers);
      if (String(url) === `${origin}/v1/models`) {
        expect(headers.get("authorization")).toBe("Bearer agent-native-key");
        expect(headers.get("x-goog-api-key")).toBeNull();
        return Response.json({ data: [{ id: "gpt-6-astra", output_modalities: ["text"] }, { id: ids[0] }] });
      }
      expect(String(url)).toBe(`${origin}/v1beta/models`);
      expect(headers.get("x-goog-api-key")).toBe("agent-native-key");
      expect(headers.get("authorization")).toBeNull();
      return Response.json({ models: [
        { name: `models/${ids[0]}`, supportedGenerationMethods: ["generateContent"] },
        { name: "models/nano-banana-2.1", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-only", supportedGenerationMethods: ["embedContent"] },
      ] });
    });
    const response = await read();
    expect(response.status).toBe(200);
    const returned = await response.json() as ModelDescriptor[];
    expect(returned.map(model => model.id)).toEqual(["gpt-6-astra", ids[0], "nano-banana-2.1"]);
    expect(returned[0]?.name).toBe("Agent label");
    expect(returned[2]?.metadata?.nativeImageCatalogSource).toBe(`${origin}/v1beta/models`);
    const saved = (await mocks.repository.getConnection("c1"))!;
    expect(saved).toMatchObject({ id: prior.id, name: prior.name, provider: prior.provider, encryptedSecret: prior.encryptedSecret,
      config: { supplierId: prior.config.supplierId, supplierSourceId: prior.config.supplierSourceId,
        accountKeyGroupId: groupId, accountKeyGroup: group, modelGroup: group, usage: "agent", customGroup: false,
        protocol: "responses", directorProtocol: "responses", defaultModel: "gpt-6-astra", allowedModels: ["gpt-6-astra"],
        modelScanComplete: true, scannedModelIds: returned.map(model => model.id) } });
    expect(await mocks.repository.getConnection("sibling")).toEqual(sibling);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    mocks.fetch.mockClear();
    const cached = await read("?cached=1");
    expect((await cached.json() as ModelDescriptor[]).map(model => model.id)).toEqual(returned.map(model => model.id));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await mocks.repository.getSupplierVerification(supplier.id)).toBeNull();
  });

  it.each([
    { upstream: 503, response: 502, scanStatus: "failed" },
    { upstream: 403, response: 403, scanStatus: "unauthorized" },
  ])("keeps a legacy agent's last complete union after native HTTP $upstream", async ({ upstream, response: expectedResponse, scanStatus }) => {
    const canvas = await fixture();
    const prior = await mocks.repository.saveConnection({ ...canvas, provider: "rest", config: { ...canvas.config,
      usage: "agent", customGroup: false, defaultModel: "gpt-6-astra", protocol: "responses" } });
    mocks.fetch.mockImplementation(async (url, init) => {
      expect(init.method).toBe("GET");
      return String(url).endsWith("/v1/models")
        ? Response.json({ data: [{ id: ids[0] }] }) : Response.json({ error: "native unavailable" }, { status: upstream });
    });
    const response = await read();
    expect(response.status).toBe(expectedResponse);
    const saved = (await mocks.repository.getConnection("c1"))!;
    expect(saved.config).toMatchObject({ usage: "agent", customGroup: false, defaultModel: "gpt-6-astra",
      protocol: "responses", modelScanComplete: false, modelScanStatus: scanStatus });
    expect(saved.config.scannedModelIds).toEqual(prior.config.scannedModelIds);
    expect(saved.config.modelCatalogModels).toEqual(prior.config.modelCatalogModels);
    expect(saved.encryptedSecret).toBe(prior.encryptedSecret);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("discards an old native directory response after its agent Key changes", async () => {
    const canvas = await fixture();
    await mocks.repository.saveConnection({ ...canvas, provider: "rest", config: { ...canvas.config,
      usage: "agent", customGroup: false, protocol: "responses" } });
    let replacement: Awaited<ReturnType<MemoryRepository["saveConnection"]>>;
    mocks.fetch.mockImplementation(async (url, init) => {
      expect(init.method).toBe("GET");
      if (String(url).endsWith("/v1/models")) return Response.json({ data: [{ id: ids[0] }] });
      expect(String(url)).toBe("https://api.eaheng.com/v1beta/models");
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe("c1-key");
      const current = (await mocks.repository.getConnection("c1"))!;
      replacement = await mocks.repository.saveConnection({ ...current,
        encryptedSecret: encryptSecret("replacement-key", "monster-native-test-master"), config: { ...current.config,
          modelScanRequestId: "replacement-scan", scannedModelIds: ["replacement-text"], modelCatalogModels: [
            { id: "replacement-text", name: "Replacement", operations: [], outputKinds: ["text"] },
          ] } });
      return Response.json({ models: [{ name: "models/nano-banana-2.1", supportedGenerationMethods: ["generateContent"] }] });
    });
    expect((await read()).status).toBe(409);
    expect(await mocks.repository.getConnection("c1")).toEqual(replacement!);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not read a native image directory for a legacy agent in a different official group", async () => {
    const canvas = await fixture();
    await mocks.repository.saveConnection({ ...canvas, provider: "rest", config: { ...canvas.config,
      usage: "agent", customGroup: false, accountKeyGroupId: "12" } });
    mocks.fetch.mockImplementation(async (url, init) => {
      expect(init.method).toBe("GET");
      expect(String(url)).toBe("https://api.eaheng.com/v1/models");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer c1-key");
      return Response.json({ data: [{ id: ids[0] }] });
    });
    const response = await read();
    expect(response.status).toBe(200);
    expect((await response.json() as ModelDescriptor[]).map(model => model.id)).toEqual([ids[0]]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

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
      expect(model.parameters?.find(parameter => parameter.key === "image_size")?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
      expect(model.metadata?.imageUserNativeSizePresetSource).toBe("user-request");
      expect(model.metadata?.resolutionVerification).toBe("user-presets-not-generation-tested");
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
