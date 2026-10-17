import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectGenericSupplierSource, declaredCatalogPriceStates, type GenericSupplierSourceEntry } from "./catalog-generic-source-collector";

const siteUrl = "https://supplier.test/gateway", checkedAt = "2026-10-17T13:00:00.000Z";
const input = (entry: GenericSupplierSourceEntry) => ({ url: `${siteUrl}/api/source`, siteUrl, entry });
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unscheduled network is forbidden"); })); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("one-entry generic supplier collectors", () => {
  it("requires a complete exact-group declaration for explicit price withdrawal, never missing/null token fields", async () => {
    const payload = { data: [
      { model_name: "missing", enable_groups: ["group-a"] },
      { model_name: "null-token-output", enable_groups: ["group-a"], output_price: null, input_price: 1 },
      { model_name: "null-unknown", enable_groups: ["group-a"], price: null },
      { model_name: "withdrawn", enable_groups: ["group-a"], price_published: false },
      { model_name: "no-group", pricing_status: "unpublished" },
      { model_name: "free", enable_groups: ["group-a"], model_price: 0, quota_type: 1 },
    ] };
    expect(declaredCatalogPriceStates(payload)).toEqual([{ modelId: "withdrawn", groupIdentity: "name:group-a", state: "explicit-unpublished" }]);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ...payload, complete: false }));
    const read = await collectGenericSupplierSource(input("pricing"), { fetch, checkedAt });
    expect(read.complete).toBe(false); expect(read.priceStates).toBeUndefined();
  });
  it("keeps complete NewAPI model/group/price facts without rereading status, a site session or another source", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [
      { model_name: "priced-full-id", enable_groups: ["exact-group"], model_price: .2, quota_type: 1 },
      { model_name: "never-priced-full-id", enable_groups: ["exact-group"] },
    ], group_ratio: { "exact-group": 1 } }));
    const read = await collectGenericSupplierSource(input("pricing"), { fetch, checkedAt });
    expect(read).toMatchObject({ complete: true, checkedAt, groups: [{ id: "exact-group", models: [
      { id: "priced-full-id" }, { id: "never-priced-full-id" },
    ] }] });
    expect(read.groups[0]?.models[0]?.priceLabel).toContain("0.2");
    expect(read.models.map(model => model.id)).toEqual(["priced-full-id", "never-priced-full-id"]);
    expect(read.models.every(model => model.operations.length === 0 && model.metadata?.publicCatalogOnly === true)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("preserves stable group identity and normalized group details from a complete plaza including unpriced models", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: { groups: [{ id: 23, name: "exact-group", description: "group description",
      rate_multiplier: 2, models: [{ name: "full-id", capability: "image", pricing: { billing_mode: "per_request", per_request_price: .3 } }, { name: "unpriced-id" }],
    }] } }));
    const read = await collectGenericSupplierSource(input("plaza"), { fetch, checkedAt });
    expect(read.complete).toBe(true);
    expect(read.groups[0]).toMatchObject({ id: "exact-group", supplierGroupId: "23", details: { source: "model-plaza", description: "group description", rateMultiplier: 2 } });
    expect(read.groups[0]?.models.map(model => model.id)).toEqual(["full-id", "unpriced-id"]);
  });

  it.each([
    ["newapi-groups", { success: true, data: { groupA: { desc: "Group A", ratio: 2 } } }, "groupA"],
    ["sub2api-groups", { code: 0, data: [{ id: 45, name: "groupB", description: "Group B", rate_multiplier: 3 }] }, "groupB"],
  ] as const)("%s reads account-selectable groups as group facts, never an authoritative empty Key inventory", async (entry, payload, id) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(payload));
    const result = await collectGenericSupplierSource(input(entry), { fetch, checkedAt });
    expect(result).toMatchObject({ complete: true, models: [], groups: [{ id, models: [] }] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["pricing-channels", "available-channels"] as const)("%s retains each group's own price and model list without merging other account groups", async entry => {
    const payload = { data: [{ name: "channel", description: "channel detail", platforms: [{ platform: "openai", groups: [
      { id: 1, name: "first", rate_multiplier: 1 }, { id: 2, name: "second", rate_multiplier: 2 },
    ], supported_models: [{ name: "channel-full-id", pricing: { billing_mode: "per_request", per_request_price: .4 } }] }] }] };
    const result = await collectGenericSupplierSource(input(entry), { fetch: vi.fn(async () => Response.json(payload)), checkedAt });
    expect(result.complete).toBe(true);
    expect(result.groups.map(group => [group.id, group.supplierGroupId])).toEqual([["first", "1"], ["second", "2"]]);
    expect(result.groups[0]?.models[0]?.priceLabel).toContain("0.4");
    expect(result.groups[1]?.models[0]?.priceLabel).toContain("0.8");
    expect(result.groups[0]?.models[0]?.metadata).toMatchObject({ supplierPriceChannel: "channel", supplierPriceCheckedAt: checkedAt });
  });

  it("status returns only reviewed display dependencies, never unknown fields or a guessed conversion", async () => {
    const result = await collectGenericSupplierSource(input("status"), { fetch: vi.fn(async () => Response.json({ success: true, data: {
      quota_display_type: "CUSTOM", custom_currency_symbol: "¥", custom_currency_exchange_rate: 7, usd_exchange_rate: 6.8,
      quota_per_unit: 500000, unrelatedSecret: "secret", system_name: "Supplier",
    } })), checkedAt });
    expect(result).toEqual({ models: [], groups: [], complete: true, checkedAt, dependencies: {
      quota_display_type: "CUSTOM", custom_currency_symbol: "¥", custom_currency_exchange_rate: 7, usd_exchange_rate: 6.8, quota_per_unit: 500000,
    } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it.each([
    ["pricing", { data: [{ model_name: "visible", enable_groups: ["group"] }], has_more: true }],
    ["plaza", { data: { groups: [{ id: 1, name: "group" }] } }],
    ["plaza", { data: { groups: [{ id: 1, name: "group", models: [{ name: "visible" }], total: 2 }] } }],
    ["newapi-groups", { data: { valid: { desc: "valid" }, invalid: {} } }],
    ["sub2api-groups", { data: [{ id: 1, name: "valid" }, { id: 2 }] }],
    ["pricing-channels", { data: [{ platforms: [{ groups: [{ name: "group" }], supported_models: [{ invalid: "no-model-id" }] }] }] }],
    ["available-channels", { data: [{ platforms: [{ groups: [{ name: "group" }], supported_models: [{ name: "visible" }], has_more: true }] }] }],
    ["pricing", { success: false, data: [] }],
    ["status", { error: "secret", data: {} }],
  ] as const)("%s never calls a partial or malformed source complete", async (entry, payload) => {
    const result = await collectGenericSupplierSource(input(entry), { fetch: vi.fn(async () => Response.json(payload)), checkedAt });
    expect(result.complete).toBe(false);
  });

  it("catches parser group/model and channel slice bounds instead of accepting a silently truncated list", async () => {
    const models = Array.from({ length: 3001 }, (_, index) => ({ model_name: `id-${index}`, enable_groups: ["group"] }));
    expect((await collectGenericSupplierSource(input("pricing"), { fetch: vi.fn(async () => Response.json({ data: models })) })).complete).toBe(false);
    const groups = Array.from({ length: 501 }, (_, index) => ({ id: index, name: `group-${index}` }));
    expect((await collectGenericSupplierSource(input("sub2api-groups"), { fetch: vi.fn(async () => Response.json({ data: groups })) })).complete).toBe(false);
    const channels = Array.from({ length: 501 }, () => ({ platforms: [] }));
    expect((await collectGenericSupplierSource(input("pricing-channels"), { fetch: vi.fn(async () => Response.json({ data: channels })) })).complete).toBe(false);
  });

  it.each(["plaza", "sub2api-groups"] as const)("%s rejects duplicate stable IDs, numeric aliases and exact fallback names before parser Map deduplication", async entry => {
    for (const groups of [
      [{ id: 7, name: "first", rate_multiplier: 1 }, { id: 7, name: "renamed", rate_multiplier: 2 }],
      [{ id: 7, name: "first" }, { id: "007", name: "renamed" }],
      [{ name: "same-name" }, { name: "same-name" }],
    ]) {
      const payload = entry === "plaza" ? { data: { groups: groups.map(group => ({ ...group, models: [] })) } } : { data: groups };
      expect((await collectGenericSupplierSource(input(entry), { fetch: vi.fn(async () => Response.json(payload)) })).complete).toBe(false);
    }
    // Numeric group identity and the name-only group "7" are different scopes.
    const groups = [{ id: 7, name: "numbered", models: [] }, { name: "7", models: [] }];
    const payload = entry === "plaza" ? { data: { groups } } : { data: groups };
    expect((await collectGenericSupplierSource(input(entry), { fetch: vi.fn(async () => Response.json(payload)) })).complete).toBe(true);
  });

  it("NewAPI exact names and one platform's repeated group identities cannot silently collapse into a complete source", async () => {
    expect((await collectGenericSupplierSource(input("newapi-groups"), { fetch: vi.fn(async () => Response.json({ data: {
      group: { desc: "first" }, " group ": { desc: "conflict" },
    } })) })).complete).toBe(false);
    const payload = { data: [{ platforms: [{ groups: [{ id: 1, name: "first" }, { id: "001", name: "second" }], supported_models: [] }] }] };
    expect((await collectGenericSupplierSource(input("pricing-channels"), { fetch: vi.fn(async () => Response.json(payload)) })).complete).toBe(false);
  });

  it("does not retry or fall back after a failed source, and retains no cached result", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response("secret", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    await expect(collectGenericSupplierSource(input("pricing"), { fetch })).rejects.toMatchObject({ code: "directory_unavailable" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await collectGenericSupplierSource(input("pricing"), { fetch })).toMatchObject({ complete: true, groups: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never forwards an account-scoped transport to another host or outside its custom gateway prefix", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const url of ["https://elsewhere.test/api/pricing", "https://supplier.test/api/pricing", "https://user:secret@supplier.test/gateway/api/pricing",
      "https://supplier.test/gateway/api/pricing?token=secret"])
      await expect(collectGenericSupplierSource({ ...input("pricing"), url }, { fetch })).rejects.toMatchObject({ code: "invalid_configuration" });
    expect(fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
