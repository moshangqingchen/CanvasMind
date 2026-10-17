import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { withCatalogRepository } from "./catalog-repository-scope";
import {
  collectChentuImageCapabilities, collectChentuPublicCatalog, collectCyberAfeiPublicCatalog, collectGenericKeyInventory,
  collectMiaowuMediaInventory, collectMiaowuPublicCatalog, collectMiaowuSchema, collectNativeKeyInventory,
} from "./provider-inventory-collector";

const now = () => "2026-10-17T08:00:00.000Z";
const apiKey = "fixture-only-key";
const json = (payload: unknown, status = 200) => Response.json(payload, { status });

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unscheduled HTTP is forbidden"); })); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("independent, publication-free inventory sources", () => {
  it.each([
    ["Chentu", "https://tu.988236.xyz/v1"], ["CyberAfei", "https://api.3365api.cn/v1"],
    ["FriModel", "https://api.frimodel.com/v1"], ["Mikoto", "https://api.mikoto.vip"],
    ["Miaowu", "https://api.miaowuai.store"], ["Synora", "https://fixture.synora.invalid/v1"],
  ])("%s Key directory runs without public catalog, pricing, schemas, sync or publication", async (_name, baseUrl) => {
    const repository = new MemoryRepository();
    await repository.saveConnection({ id: "fixture-connection", name: "Fixture", provider: "openai", encryptedSecret: "fixture-ciphertext",
      config: { baseUrl, scannedModelIds: ["saved-old"], defaultModel: "saved-choice" } });
    const before = await repository.getConnection("fixture-connection");
    const save = vi.spyOn(repository, "saveConnection"), settings = vi.spyOn(repository, "setApplicationSetting");
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(`${baseUrl}/models`);
      expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: `Bearer ${apiKey}` } });
      return json({ data: [{ id: "fixture-full-id" }] });
    });
    const result = await withCatalogRepository(repository, () => collectGenericKeyInventory({ baseUrl, apiKey }, { fetch: transport, now }));
    expect(result).toMatchObject({ complete: true, status: "live", checkedAt: now() });
    expect(result.models.map(model => model.id)).toEqual(["fixture-full-id"]);
    expect(save).not.toHaveBeenCalled(); expect(settings).not.toHaveBeenCalled();
    expect(await repository.getConnection("fixture-connection")).toEqual(before);
    expect(transport).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("a 403 that carries INSUFFICIENT_BALANCE is a balance failure, while a plain 403 stays a denial", async () => {
    const baseUrl = "https://balance.fixture.invalid/v1";
    const balance = await collectGenericKeyInventory({ baseUrl, apiKey }, { now,
      fetch: vi.fn<typeof fetch>(async () => json({ error: { code: "INSUFFICIENT_BALANCE", message: "fixture" } }, 403)) });
    expect(balance).toMatchObject({ complete: false, status: "failed", failure: { code: "insufficient_balance", httpStatus: 403 } });
    const denied = await collectGenericKeyInventory({ baseUrl, apiKey }, { now,
      fetch: vi.fn<typeof fetch>(async () => json({ error: { code: "permission_denied" } }, 403)) });
    expect(denied).toMatchObject({ complete: false, status: "unauthorized", failure: { code: "permission_denied", httpStatus: 403 } });
    expect(JSON.stringify([balance, denied])).not.toContain(apiKey);
  });

  it("404 alternatives are one logical list, while a denied alternative is final", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(json({ data: [{ id: "same-source-id" }] }));
    const result = await collectGenericKeyInventory({ baseUrl: "https://fixture.invalid", apiKey }, { fetch: transport, now });
    expect(result).toMatchObject({ status: "live", complete: true });
    expect(result.sourceUrl).toBe("https://fixture.invalid/v1/models");
    expect(result.attemptedUrls).toEqual(["https://fixture.invalid/models", "https://fixture.invalid/v1/models"]);
    expect(transport.mock.calls.map(call => String(call[0]))).toEqual(["https://fixture.invalid/models", "https://fixture.invalid/v1/models"]);
    const denied = vi.fn<typeof fetch>().mockResolvedValue(json({ error: "fixture-secret-body" }, 403));
    const deniedResult = await collectGenericKeyInventory({ baseUrl: "https://fixture.invalid", apiKey }, { fetch: denied, now });
    expect(deniedResult).toMatchObject({ status: "unauthorized", failure: { code: "permission_denied", httpStatus: 403 } });
    expect(denied).toHaveBeenCalledTimes(1); expect(JSON.stringify(deniedResult)).not.toContain("fixture-secret-body");
  });

  it.each(["https://user:secret@fixture.invalid/v1", "https://fixture.invalid/v1?api_key=secret"])("rejects credentials in a base URL without transport or diagnostic leakage", async baseUrl => {
    const transport = vi.fn<typeof fetch>();
    const result = await collectGenericKeyInventory({ baseUrl, apiKey }, { fetch: transport, now });
    expect(result).toMatchObject({ complete: false, attemptedUrls: [] });
    expect(result.sourceUrl).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("secret");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])("HTTP %s never causes a second indeterminate request", async status => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    expect(await collectGenericKeyInventory({ baseUrl: "https://fixture.invalid", apiKey }, { fetch: transport, now })).toMatchObject({ complete: false });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([{ data: [{ id: "known" }], has_more: true }, { data: [{ id: "known" }], total: 2 }, { data: [{ id: "known" }], truncated: true },
    { data: [{ id: "known" }], page: 2, total_pages: 2 }, { data: [{ invalid: "missing-id" }] }, { success: false, data: [] }])
    ("never accepts unfinished or malformed lists as authoritative empty", async payload => {
      const result = await collectGenericKeyInventory({ baseUrl: "https://fixture.invalid/v1", apiKey }, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json(payload)), now });
      expect(result).toMatchObject({ complete: false, status: "failed", models: [] });
    });

  it("generic success survives an independently rejected native list, and native success survives generic failure", async () => {
    const config = { baseUrl: "https://api.eaheng.com/v1", accountKeyGroupId: "11" };
    const transport = vi.fn<typeof fetch>(async url => String(url).includes("v1beta") ? new Response(null, { status: 503 }) : json({ data: [{ id: "generic-id" }] }));
    const [generic, native] = await Promise.all([
      collectGenericKeyInventory({ baseUrl: config.baseUrl, apiKey }, { fetch: transport, now }),
      collectNativeKeyInventory({ config, apiKey }, { fetch: transport, now }),
    ]);
    expect(generic).toMatchObject({ complete: true, status: "live" }); expect(generic.models.map(model => model.id)).toEqual(["generic-id"]);
    expect(native).toMatchObject({ complete: false, status: "failed" });
    const reversed = vi.fn<typeof fetch>(async url => String(url).includes("v1beta") ? json({ models: [{ name: "models/native-full-id", supportedGenerationMethods: ["generateContent"] }] }) : new Response(null, { status: 503 }));
    const [genericFailed, nativeSuccess] = await Promise.all([
      collectGenericKeyInventory({ baseUrl: config.baseUrl, apiKey }, { fetch: reversed, now }), collectNativeKeyInventory({ config, apiKey }, { fetch: reversed, now }),
    ]);
    expect(genericFailed.complete).toBe(false); expect(nativeSuccess.complete).toBe(true);
    expect(nativeSuccess.models.map(model => model.id)).toEqual(["native-full-id"]);
  });

  it("native collection is limited to the exact registered source/group and uses its own credential header", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ models: [{ name: "models/native-id", supportedGenerationMethods: ["generateContent"] }] }));
    const result = await collectNativeKeyInventory({ config: { baseUrl: "https://api.mikoto.vip/v1", accountKeyGroupId: "28" }, apiKey }, { fetch: transport, now });
    expect(result.complete).toBe(true);
    expect(transport).toHaveBeenCalledWith("https://api.mikoto.vip/v1beta/models", expect.objectContaining({ headers: { "x-goog-api-key": apiKey } }));
    expect(await collectNativeKeyInventory({ config: { baseUrl: "https://other.invalid/v1", accountKeyGroupId: "28" }, apiKey }, { fetch: transport, now })).toMatchObject({ complete: false });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([{ next_page_token: "more" }, { truncated: true }, { pagination: { page: 2 } }])("native partial pagination is not a complete list", async envelope => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ ...envelope, models: [{ name: "models/native-id", supportedGenerationMethods: ["generateContent"] }] }));
    const result = await collectNativeKeyInventory({ config: { baseUrl: "https://api.mikoto.vip/v1", accountKeyGroupId: "28" }, apiKey }, { fetch: transport, now });
    expect(result).toMatchObject({ complete: false, models: [], status: "failed", failure: { code: "incomplete_directory" } });
  });

  it("native and Dream parsers do not turn unknown row shapes into an authoritative empty list", async () => {
    const native = await collectNativeKeyInventory({ config: { baseUrl: "https://api.mikoto.vip/v1", accountKeyGroupId: "28" }, apiKey },
      { fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ models: [{ id: "unparsed-native-shape", supportedGenerationMethods: ["generateContent"] }] })), now });
    const media = await collectMiaowuMediaInventory(apiKey, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ name: "unparsed-dream-shape", type: "image" }] })), now });
    for (const result of [native, media]) expect(result).toMatchObject({ status: "failed", complete: false, models: [], failure: { code: "invalid_response" } });
  });

  it("oversized generic model IDs and group names cannot be accepted after the legacy parser truncates them", async () => {
    const long = "x".repeat(300);
    for (const payload of [{ data: [{ id: long }] }, { data: { [long]: {} } }, { data: [{ id: "exact-id", enable_groups: [long] }] },
      { data: [{ id: "exact-id", group: long }] }]) {
      const result = await collectGenericKeyInventory({ baseUrl: "https://fixture.invalid/v1", apiKey }, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json(payload)), now });
      expect(result).toMatchObject({ status: "failed", complete: false, models: [], failure: { code: "incomplete_directory" } });
    }
  });

  it("public long group keys or full IDs are incomplete instead of colliding with another price identity", async () => {
    const long = "g".repeat(300);
    for (const payload of [{ data: [{ model_name: long, enable_groups: ["short-group"] }] },
      { data: [{ model_name: "short-id", enable_groups: [long] }] }, { data: [], group_ratio: { [long]: 2 } }]) {
      expect(await collectChentuPublicCatalog({ fetch: vi.fn<typeof fetch>().mockResolvedValue(json(payload)), now }))
        .toMatchObject({ complete: false, models: [], failure: { code: "incomplete_directory" } });
    }
  });

  it("native IDs are bounded after removing models/ and Dream never accepts a truncated long full ID", async () => {
    const config = { baseUrl: "https://api.mikoto.vip/v1", accountKeyGroupId: "28" };
    const payload = (id: string) => ({ models: [{ name: `models/${id}`, supportedGenerationMethods: ["generateContent"] }] });
    expect(await collectNativeKeyInventory({ config, apiKey }, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json(payload("n".repeat(300)))), now }))
      .toMatchObject({ complete: false, models: [], failure: { code: "incomplete_directory" } });
    expect(await collectNativeKeyInventory({ config, apiKey }, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ models: [
      { id: "ignored-short-id", name: `models/${"n".repeat(300)}`, supportedGenerationMethods: ["generateContent"] },
    ] })), now })).toMatchObject({ complete: false, models: [], failure: { code: "incomplete_directory" } });
    const boundary = await collectNativeKeyInventory({ config, apiKey }, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json(payload("n".repeat(256)))), now });
    expect(boundary.complete).toBe(true); expect(boundary.models[0]?.id).toBe("n".repeat(256));
    expect(await collectMiaowuMediaInventory(apiKey, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ id: "m".repeat(300), type: "image" }] })), now }))
      .toMatchObject({ complete: false, models: [], failure: { code: "incomplete_directory" } });
  });

  it.each([
    ["Chentu", collectChentuPublicCatalog], ["CyberAfei", collectCyberAfeiPublicCatalog], ["Miaowu", collectMiaowuPublicCatalog],
  ] as const)("%s anonymous offer/price source is independent from a denied Key and never receives its secret", async (_name, collectPublic) => {
    const pricing = { data: [{ model_name: "fixture-image-full-id", enable_groups: ["fixture-group"], model_price: 0.2, quota_type: 1 }], group_ratio: { "fixture-group": 1 } };
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.method).toBe("GET");
      if (String(url).endsWith("/api/pricing")) { expect(init?.headers).toBeUndefined(); return json(pricing); }
      return new Response(null, { status: 401 });
    });
    const [key, offers] = await Promise.all([
      collectGenericKeyInventory({ baseUrl: "https://fixture.invalid/v1", apiKey }, { fetch: transport, now }), collectPublic({ fetch: transport, now }),
    ]);
    expect(key).toMatchObject({ complete: false, status: "unauthorized", models: [] });
    expect(offers).toMatchObject({ complete: true, status: "live" });
    expect(offers.models.map(model => model.id)).toContain("fixture-image-full-id");
    expect(offers.groups).toContainEqual({ id: "fixture-group", label: "fixture-group", modelIds: ["fixture-image-full-id"] });
    expect(key.models).toEqual([]);
  });

  it("public price/list failures cannot block Chentu or CyberAfei Key lists", async () => {
    const transport = vi.fn<typeof fetch>(async url => String(url).endsWith("/api/pricing") ? new Response(null, { status: 503 }) : json({ data: [{ id: "key-only-id" }] }));
    for (const [baseUrl, collectPublic] of [["https://tu.988236.xyz/v1", collectChentuPublicCatalog], ["https://api.3365api.cn/v1", collectCyberAfeiPublicCatalog]] as const) {
      const [offers, key] = await Promise.all([collectPublic({ fetch: transport, now }), collectGenericKeyInventory({ baseUrl, apiKey }, { fetch: transport, now })]);
      expect(offers.complete).toBe(false); expect(key.complete).toBe(true); expect(key.models.map(model => model.id)).toEqual(["key-only-id"]);
    }
  });

  it("fresh public reads do not reuse a stale global catalog; unknown full IDs remain offers without Key permission", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{ model_name: "new-opaque-id", enable_groups: ["exact-group"] }] }))
      .mockResolvedValueOnce(json({ data: [] }));
    const result = await collectChentuPublicCatalog({ fetch: transport, now });
    expect(result.complete).toBe(true); expect(result.models.map(model => model.id)).toEqual(["new-opaque-id"]);
    expect(result.models[0]?.metadata?.catalogGroup).toBe("exact-group");
    expect(await collectChentuPublicCatalog({ fetch: transport, now })).toMatchObject({ complete: true, status: "empty", models: [] });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("malformed declared groups do not silently become complete ungrouped public offers", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ model_name: "valid-id", enable_groups: "unparsed-groups" }] }));
    expect(await collectChentuPublicCatalog({ fetch: transport, now })).toMatchObject({ complete: false, failure: { code: "invalid_response" } });
  });

  it("Miaowu public prices retain each exact group's own multiplier", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ model_name: "image-id", enable_groups: ["one", "two"], model_price: 0.2, quota_type: 1 }], group_ratio: { one: 1, two: 2 } }));
    const result = await collectMiaowuPublicCatalog({ fetch: transport, now });
    expect(result.complete).toBe(true);
    expect(result.models.map(model => model.metadata?.pricingGroupRatio)).toEqual([1, 2]);
    expect(result.models.map(model => model.metadata?.catalogGroup)).toEqual(["one", "two"]);
  });

  it.each([["Chentu", collectChentuPublicCatalog], ["CyberAfei", collectCyberAfeiPublicCatalog]] as const)
    ("%s unknown models preserve group identities without borrowing a generic quote across groups", async (_name, collect) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ model_name: "opaque-future-id", enable_groups: ["one", "two"],
        model_price: 7, quota_type: 1, price_label: "$7/request", billing_label: "per-request", pricing: { currency: "USD", amount: 7 },
      }], group_ratio: { one: 1, two: 10 } }));
      const result = await collect({ fetch: transport, now });
      expect(result.complete).toBe(true);
      expect(result.models).toEqual(["one", "two"].map(catalogGroup => ({ id: "opaque-future-id", name: "opaque-future-id", operations: [],
        metadata: { publicCatalogOnly: true, catalogGroup } })));
      expect(result.models.every(model => model.pricing === undefined && !Object.keys(model.metadata ?? {}).some(key => /pric|bill|fx|ratio/iu.test(key)))).toBe(true);
      expect(transport).toHaveBeenCalledTimes(1);
    });

  it("a public generic model without an exact declared group retains no unscoped price metadata", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ model_name: "ungrouped-future-id", price_label: "$7/request", model_price: 7, quota_type: 1 }] }));
    const result = await collectChentuPublicCatalog({ fetch: transport, now });
    expect(result).toMatchObject({ complete: true, models: [{ id: "ungrouped-future-id", name: "ungrouped-future-id", operations: [], metadata: { publicCatalogOnly: true } }] });
    expect(result.models[0]?.pricing).toBeUndefined(); expect(result.models[0]?.metadata?.priceLabel).toBeUndefined();
  });

  it("Chentu size capabilities are collected independently and cannot grant membership", async () => {
    const transport = vi.fn<typeof fetch>(async url => String(url).includes("model-capabilities")
      ? json({ data: [{ model: "fixture-full-model", sizes: [{ value: "auto" }, { value: "1024x1024", ratio: "1:1" }] }] })
      : new Response(null, { status: 503 }));
    const [catalog, key, sizes] = await Promise.all([
      collectChentuPublicCatalog({ fetch: transport, now }), collectGenericKeyInventory({ baseUrl: "https://tu.988236.xyz/v1", apiKey }, { fetch: transport, now }),
      collectChentuImageCapabilities(apiKey, { fetch: transport, now }),
    ]);
    expect(catalog.complete).toBe(false); expect(key.complete).toBe(false);
    expect(sizes).toMatchObject({ complete: true, status: "live", models: [], capabilities: [{ modelId: "fixture-full-model", sizes: [{ value: "auto" }, { value: "1024x1024", ratio: "1:1" }] }] });
  });

  it("unknown size contracts are not accepted as a complete schema", async () => {
    for (const sizes of [[{ value: "auto" }], [{ value: "vendor-default" }], [{ value: "1024x1024" }, { value: "bad" }]]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ model: "same-id", sizes }] }));
      expect(await collectChentuImageCapabilities(apiKey, { fetch: transport, now })).toMatchObject({ complete: false, failure: { code: "invalid_response" } });
    }
  });

  it("Miaowu base, Dream media and per-model schemas produce independent normalized facts", async () => {
    const transport = vi.fn<typeof fetch>(async url => String(url).includes("model_schema") ? new Response(null, { status: 503 }) : String(url).endsWith("model_list")
      ? json({ data: [{ id: "dream-full-id", type: "image" }] }) : json({ data: [{ id: "chat-full-id" }] }));
    const [generic, media, schema] = await Promise.all([
      collectGenericKeyInventory({ baseUrl: "https://api.miaowuai.store", apiKey }, { fetch: transport, now }),
      collectMiaowuMediaInventory(apiKey, { fetch: transport, now }), collectMiaowuSchema("dream-full-id", "image", apiKey, { fetch: transport, now }),
    ]);
    expect(generic).toMatchObject({ complete: true }); expect(generic.models.map(model => model.id)).toEqual(["chat-full-id"]);
    expect(media).toMatchObject({ complete: true }); expect(media.models.map(model => model.id)).toEqual(["dream-full-id"]);
    expect(media.models[0]?.outputKinds).toEqual(["image"]); expect(schema.complete).toBe(false);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("a failed Dream directory cannot prevent the base list, and a truncated Dream list is never accepted", async () => {
    const transport = vi.fn<typeof fetch>(async url => String(url).endsWith("model_list") ? json({ data: [{ id: "dream-id", type: "video" }], has_more: true }) : json({ data: [{ id: "base-id" }] }));
    const [generic, media] = await Promise.all([
      collectGenericKeyInventory({ baseUrl: "https://api.miaowuai.store", apiKey }, { fetch: transport, now }), collectMiaowuMediaInventory(apiKey, { fetch: transport, now }),
    ]);
    expect(generic).toMatchObject({ complete: true }); expect(media).toMatchObject({ complete: false, models: [] });
  });

  it("a schema is validated for its own full model ID and returns only the normalized contract", async () => {
    const array = (maxItems: number) => ({ type: "array", items: { type: "string" }, minItems: 0, maxItems });
    const payload = { id: "fixture-image-id", type: "image", rawNoise: "not retained", request_schema: { properties: { params: { properties: {
      mode: { type: "string", enum: ["text-to-image", "image-to-image"] }, prompt: { type: "string" }, size: { type: "string", enum: ["2K", "4K"] },
      ratio: { type: "string", enum: ["1:1", "16:9"] }, image_urls: array(2), video_urls: array(0), audio_urls: array(0),
    } } } } };
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => json(payload));
    const result = await collectMiaowuSchema("fixture-image-id", "image", apiKey, { fetch: transport, now });
    expect(result).toMatchObject({ status: "live", complete: true, models: [], contract: { resolutions: ["2K", "4K"], maxInputImages: 2 } });
    expect(result.normalizedSchemaSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain("not retained");
    expect(await collectMiaowuSchema("another-full-id", "image", apiKey, { fetch: transport, now })).toMatchObject({ complete: false, failure: { code: "invalid_response" } });
  });
});
