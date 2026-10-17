import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";

const forbidden = vi.hoisted(() => ({ repository: vi.fn(), siteSession: vi.fn(), fetch: vi.fn() }));
vi.mock("@super-canvas/db", async original => ({ ...await original<typeof import("@super-canvas/db")>(), getRepository: forbidden.repository }));
vi.mock("./supplier-service", () => ({ getSupplierRecord: forbidden.repository }));
vi.mock("./supplier-site-session", () => ({ openSupplierSiteSession: forbidden.siteSession,
  supplierSiteLoginCacheIdentity: vi.fn() }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(),
  providerFetch: forbidden.fetch, weAIFetch: forbidden.fetch }));

import { collectCangyuanCatalogRead } from "./cangyuan-catalog";
import { collectWeAiPricingRead } from "./weai-pricing-server";
import { collectTk1688CatalogRead } from "./tk1688-catalog";
import { readCatalogLoaderJson, readCatalogLoaderText } from "./catalog-loader-http";

const checkedAt = "2026-10-17T10:20:30.000Z";
const keyModels: ModelDescriptor[] = [{ id: "exact-key-only", name: "Key model", operations: ["image.generate"] }];
const keyRead = async () => structuredClone(keyModels);

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(forbidden)) mock.mockImplementation(() => { throw new Error("Forbidden implicit side effect"); });
});

describe("dedicated catalog reads remain independent from exact-Key inventory", () => {
  it("Cangyuan keeps the fresh pricing list after homepage/docs fail, without a fallback or a Key grant", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async input => String(input).endsWith("/api/pricing")
      ? Response.json({ data: [{ model_name: "gpt-image-2", model_price: .017, enable_groups: ["IMAGE"] }] })
      : new Response("private upstream response", { status: 503 }));
    const reads = await Promise.allSettled([collectCangyuanCatalogRead("homepage", { fetch, checkedAt }),
      collectCangyuanCatalogRead("documentation", { fetch, checkedAt }), collectCangyuanCatalogRead("pricing", { fetch, checkedAt }), keyRead()]);
    expect(reads.map(read => read.status)).toEqual(["rejected", "rejected", "fulfilled", "fulfilled"]);
    expect(reads[2].status === "fulfilled" && reads[2].value).toMatchObject({ complete: true, checkedAt,
      catalogOffers: [{ groupId: "IMAGE", modelId: "gpt-image-2" }], snapshot: { source: "live", checkedAt } });
    expect(reads[3].status === "fulfilled" && reads[3].value).toEqual(keyModels);
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const mock of Object.values(forbidden)) expect(mock).not.toHaveBeenCalled();
  });

  it("Cangyuan reports unfinished pagination and accepts a complete unpriced or empty list without seeded fallback models", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [
      { model_name: "unpriced-full-model-id", enable_groups: ["unpriced-group"] }], has_more: true }));
    const read = await collectCangyuanCatalogRead("pricing", { fetch, checkedAt });
    expect(read).toMatchObject({ complete: false, catalogOffers: [{ groupId: "unpriced-group", modelId: "unpriced-full-model-id" }] });
    const empty = await collectCangyuanCatalogRead("pricing", { fetch: vi.fn(async () => Response.json({ data: [] })), checkedAt });
    expect(empty).toMatchObject({ complete: true, catalogOffers: [], snapshot: { marketplaceGroups: [] } });
  });

  it("We-AI website pricing failure never requests the guide or blocks a successful Key inventory", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("secret upstream body", { status: 401 }));
    const reads = await Promise.allSettled([collectWeAiPricingRead("model-plaza", {
      baseUrl: "https://asian-acc.we-token.cc/v1", fetch, checkedAt }), keyRead()]);
    expect(reads[0].status).toBe("rejected");
    expect(reads[1].status === "fulfilled" && reads[1].value).toEqual(keyModels);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://asian-acc.we-token.cc/api/v1/model-plaza");
    expect(String(reads[0].status === "rejected" && reads[0].reason)).not.toContain("secret");
    for (const mock of Object.values(forbidden)) expect(mock).not.toHaveBeenCalled();
  });

  it("We-AI keeps actual unpriced offer IDs and never treats price-derived quality aliases as model-list evidence", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: { groups: [{
      id: "adobe", name: "生图-openai-adobe-按次", rate_multiplier: 1, models: [
        { name: "gpt-image-2", pricing: { billing_mode: "per_request", intervals: [{ tier_label: "HIGH", per_request_price: .15 }] } },
        { name: "unpriced-full-model-id" },
      ],
    }] } }));
    const read = await collectWeAiPricingRead("model-plaza", { baseUrl: "https://asian-acc.we-token.cc/v1", fetch, checkedAt });
    expect(read.complete).toBe(true);
    expect(read.catalogOffers.map(offer => offer.modelId)).toEqual(["gpt-image-2", "unpriced-full-model-id"]);
    expect(read.catalogOffers.map(offer => offer.modelId)).not.toContain("gpt-image-2-high");
    expect(Object.keys(read.groups[0]?.models ?? {})).toContain("gpt-image-2-high");
    const incomplete = await collectWeAiPricingRead("model-plaza", { baseUrl: "https://asian-acc.we-token.cc/v1",
      fetch: vi.fn(async () => Response.json({ data: { groups: [], has_more: true } })), checkedAt });
    expect(incomplete.complete).toBe(false);
  });

  it("We-AI guides have partial price coverage and cannot borrow the official-site price for another origin", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("2. ADOBE 渠道 gpt-image-2-high 1 毛 5 / 次 Token 计费：1 倍率 3. AZ 渠道 倍率 3x"));
    const read = await collectWeAiPricingRead("official-docs", { baseUrl: "https://asian-acc.we-token.cc/v1", fetch, checkedAt });
    expect(read).toMatchObject({ complete: true, coverage: "partial", catalogOffers: [] });
    expect(read.groups.every(group => group.complete === false)).toBe(true);
    fetch.mockClear();
    await expect(collectWeAiPricingRead("official-docs", { baseUrl: "https://other.example/v1", fetch })).rejects.toThrow("其他站点");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Tk1688 market/status/account reads never depend on a site-session opener or widen the exact-Key result", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async input => String(input).includes("marketplace")
      ? Response.json({ success: true, data: { items: [{ base_model: "public-only", alias: "public-only@s1c1",
        description: "4K", charge_type: "per_request", input_price_usd: .03, status: "active", channel_alive: true }], total: 1 } })
      : new Response("unavailable", { status: 503 }));
    const reads = await Promise.allSettled([collectTk1688CatalogRead("marketplace", { fetch, checkedAt }),
      collectTk1688CatalogRead("status", { fetch, checkedAt }), collectTk1688CatalogRead("account-models", { fetch, checkedAt }), keyRead()]);
    expect(reads.map(read => read.status)).toEqual(["fulfilled", "rejected", "rejected", "fulfilled"]);
    expect(reads[0].status === "fulfilled" && reads[0].value).toMatchObject({ complete: true,
      catalogOffers: [{ modelId: "public-only@s1c1", baseModelId: "public-only", active: true }] });
    expect(reads[3].status === "fulfilled" && reads[3].value).toEqual(keyModels);
    for (const mock of Object.values(forbidden)) expect(mock).not.toHaveBeenCalled();
  });

  it("Tk1688 returns account-only IDs separately and rejects unfinished account pages; no read is cached", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ success: true, data: ["account-only"] }))
      .mockResolvedValueOnce(Response.json({ success: true, data: ["account-only"], has_more: true }));
    expect(await collectTk1688CatalogRead("account-models", { fetch, checkedAt })).toMatchObject({ complete: true, accountVisibleModelIds: ["account-only"] });
    expect(await collectTk1688CatalogRead("account-models", { fetch, checkedAt })).toMatchObject({ complete: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(keyModels.map(model => model.id)).toEqual(["exact-key-only"]);
  });
});

describe("bounded one-request catalog transport", () => {
  it("caps actual streamed bytes and malformed declared lengths, without retaining a raw response or retrying", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new Uint8Array(32)));
    await expect(readCatalogLoaderText("https://example.invalid/read", { fetch }, 8)).rejects.toMatchObject({ code: "incomplete_directory" });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(readCatalogLoaderText("https://example.invalid/read", {
      fetch: vi.fn(async () => new Response("x", { headers: { "content-length": "unknown" } })),
    })).rejects.toMatchObject({ code: "incomplete_directory" });
  });

  it("does not dispatch an aborted request and sanitizes malformed JSON", async () => {
    const controller = new AbortController(); controller.abort();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{secret invalid json"));
    await expect(readCatalogLoaderJson("https://example.invalid/read", { fetch, signal: controller.signal })).rejects.toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    await expect(readCatalogLoaderJson("https://example.invalid/read", { fetch })).rejects.toMatchObject({ code: "invalid_response" });
  });
});
