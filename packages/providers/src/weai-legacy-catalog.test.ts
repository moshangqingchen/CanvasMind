import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ lookup: vi.fn(async (hostname: string) => {
  if (hostname !== "asian-acc.we-token.cc") throw new Error("Unexpected DNS in legacy catalog test");
  return [{ address: "203.0.113.10", family: 4 }];
}), fetch: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
import { isWeAiLegacyCatalogSource, parseWeAiLegacyGroup, readWeAiLegacyCatalog, WEAI_LEGACY_MODELS_URL, WEAI_LEGACY_ORIGIN } from "./weai-legacy-catalog.js";

interface FixtureGroup { id: number; name: string; platform?: string; rate_multiplier?: number; user_rate_multiplier?: number }
interface FixtureModel extends Record<string, unknown> { name?: string; input_price?: number | null; output_price?: number | null;
  image_tiers?: Record<string, number | null> | null; per_request_price?: number | null; billing_mode?: string; currency?: string; intervals?: unknown[] }
interface FixturePayload { code: number; data: { groups: FixtureGroup[]; models: FixtureModel[]; selected_group_id?: number | null;
  token_multiplier?: number; image_multiplier?: number; image_quality_billing?: boolean; usd_cny_rate?: number } }
const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/weai-legacy-price-20261008.json", import.meta.url), "utf8")) as {
  initial: FixturePayload; groups: Array<{ groupId: number; payload: FixturePayload }>;
};
const checkedAt = "2026-10-08T16:10:51.429Z";
const fresh = (id = 101) => structuredClone(fixture.groups.find(group => group.groupId === id)!.payload);
const responseFor = (url: string | URL | Request) => {
  const id = new URL(String(url)).searchParams.get("group_id");
  return structuredClone(id ? fixture.groups.find(group => group.groupId === Number(id))!.payload : fixture.initial);
};
beforeEach(() => {
  network.fetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP in legacy catalog test"));
  vi.stubGlobal("fetch", network.fetch);
});
afterEach(() => { try { expect(network.fetch).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });

describe("We-AI official legacy group price contract", () => {
  it("decodes the 11 group/54 model sample without assigning the initial three models to other groups", () => {
    const parsed = fixture.groups.map(row => parseWeAiLegacyGroup(row.payload, checkedAt, row.groupId)!);
    expect(parsed.map(row => row.selected!.models.length)).toEqual([3, 8, 8, 6, 3, 13, 4, 1, 1, 5, 2]);
    expect(parsed.reduce((total, row) => total + row.selected!.models.length, 0)).toBe(54);
    const initial = parseWeAiLegacyGroup(fixture.initial, checkedAt)!;
    expect(initial.availableGroups).toHaveLength(11);
    expect(initial.selected!.group.id).toBe(101);
    expect(initial.selected!.models).toHaveLength(3);
    expect(initial.selected!.models[0]!.pricing).toMatchObject({ kind: "token", currency: "USD", inputPerMillion: 3.5,
      outputPerMillion: 7, imageOutputPerMillion: 21, checkedAt, confidence: "exact", sourceUrl: `${WEAI_LEGACY_MODELS_URL}?group_id=101` });
    expect(initial.selected!.models[0]!.pricing!.tiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cache_write_price", price: 0 }), expect.objectContaining({ id: "cache_read_price", price: .875 }),
      expect.objectContaining({ id: "image_input_price", price: 5.6 }),
    ]));
    expect(initial.selected!.models[0]!.priceLabel).toContain("USD 额度");
  });

  it("uses returned token/image multipliers independently once, without another group/user/FX multiplier", () => {
    const payload = fresh();
    payload.data.token_multiplier = .2;
    payload.data.image_multiplier = 3;
    payload.data.groups[0].rate_multiplier = 7;
    payload.data.groups[0].user_rate_multiplier = 4;
    payload.data.usd_cny_rate = 7.2;
    expect(parseWeAiLegacyGroup(payload, checkedAt)!.selected!.models[0]!.pricing).toMatchObject({ inputPerMillion: 1, outputPerMillion: 2, imageOutputPerMillion: 6 });
    const image = fresh(107);
    image.data.token_multiplier = .2;
    image.data.image_multiplier = 3;
    expect(parseWeAiLegacyGroup(image, checkedAt)!.selected!.models[0]!.pricing!.tiers?.map(tier => tier.price)).toEqual([.09, .15, .45]);
  });

  it("retains request quality/resolution tiers, rather than inventing an image or seconds unit", () => {
    const quality = parseWeAiLegacyGroup(fresh(107), checkedAt)!.selected!.models[0]!;
    expect(quality.pricing).toMatchObject({ kind: "per-request", billingUnit: "request", currency: "USD", tiers: [
      { dimension: "quality", value: "low", price: .03 }, { dimension: "quality", value: "medium", price: .05 }, { dimension: "quality", value: "high", price: .15 },
    ] });
    expect(quality.pricing!.unitAmount).toBeUndefined();
    const resolution = parseWeAiLegacyGroup(fresh(104), checkedAt)!.selected!.models[0]!;
    expect(resolution.pricing!.tiers?.map(tier => [tier.dimension, tier.value, tier.price])).toEqual([
      ["resolution", "1K", .06], ["resolution", "2K", .08], ["resolution", "4K", .1],
    ]);
    expect(parseWeAiLegacyGroup(fresh(111), checkedAt)!.selected!.models[0]!.pricing?.unitAmount).toBe(.1);
  });

  it("follows official quality precedence and the declared fallback dimension", () => {
    const payload = fresh(107);
    payload.data.models[0].image_tiers.price_1k = 99;
    expect(parseWeAiLegacyGroup(payload, checkedAt)!.selected!.models[0]!.pricing!.tiers?.map(tier => tier.price)).toEqual([.03, .05, .15]);
    payload.data.models[0].image_tiers = null;
    payload.data.models[0].per_request_price = .2;
    expect(parseWeAiLegacyGroup(payload, checkedAt)!.selected!.models[0]!.pricing!.tiers?.every(tier => tier.dimension === "quality" && tier.price === .2)).toBe(true);
    payload.data.image_quality_billing = false;
    expect(parseWeAiLegacyGroup(payload, checkedAt)!.selected!.models[0]!.pricing!.tiers?.every(tier => tier.dimension === "resolution")).toBe(true);
  });
  it("leaves missing quality tier amounts unconfigured instead of using per_request or resolution prices", () => {
    const payload = fresh(107);
    payload.data.models[0].image_tiers!.price_medium = null;
    payload.data.models[0].image_tiers!.price_2k = 99;
    payload.data.models[0].per_request_price = 99;
    const model = parseWeAiLegacyGroup(payload, checkedAt)!.selected!.models[0]!;
    expect(model.pricing!.tiers?.map(tier => tier.price)).toEqual([.03, .15]);
    expect(model.imageTierPricesComplete).toBe(false);
    expect(model.unconfiguredPriceFields).toEqual(["price_medium"]);
  });

  it.each(["currency", "negative", "unsupported-unit", "extra-intervals"])("retains a listed model without manufacturing a price from %s", kind => {
    const payload = fresh();
    const row = payload.data.models[0];
    if (kind === "currency") row.currency = "CNY";
    if (kind === "negative") row.input_price = -1;
    if (kind === "unsupported-unit") row.billing_mode = "second";
    if (kind === "extra-intervals") row.intervals = [{ price: 1 }];
    expect(parseWeAiLegacyGroup(payload, checkedAt)!.selected!.models[0]!.pricing).toBeUndefined();
    expect(parseWeAiLegacyGroup(payload, checkedAt)!.selected!.models[0]!.id).toBe("gpt-image-2");
  });

  it("keeps configured zero, does not convert null into free, and detects contradictory duplicates", () => {
    const payload = fresh();
    payload.data.models[0].input_price = null;
    const model = parseWeAiLegacyGroup(payload, checkedAt)!.selected!.models[0]!;
    expect(model.pricing!.inputPerMillion).toBeUndefined();
    expect(model.pricing!.tiers!.find(tier => tier.id === "cache_write_price")!.price).toBe(0);
    payload.data.models.push({ ...payload.data.models[0], output_price: .3 });
    expect(parseWeAiLegacyGroup(payload, checkedAt)).toBeUndefined();
  });

  it.each(["failed-envelope", "bad-selected-id", "missing-multiplier", "bad-model", "duplicate-group"])("rejects %s instead of claiming a complete empty catalog", kind => {
    const payload = fresh();
    if (kind === "failed-envelope") payload.code = 401;
    if (kind === "bad-selected-id") payload.data.selected_group_id = 999;
    if (kind === "missing-multiplier") delete payload.data.image_multiplier;
    if (kind === "bad-model") payload.data.models = [{ message: "not models" }];
    if (kind === "duplicate-group") payload.data.groups.push({ ...payload.data.groups[0] });
    expect(parseWeAiLegacyGroup(payload, checkedAt)).toBeUndefined();
  });
  it("accepts only validated empty data and rejects a group response for another ID", () => {
    expect(parseWeAiLegacyGroup({ code: 0, data: { groups: [], models: [], selected_group_id: null } }, checkedAt)).toEqual({ availableGroups: [] });
    expect(parseWeAiLegacyGroup({ code: 0, data: {} }, checkedAt)).toBeUndefined();
    expect(parseWeAiLegacyGroup(fresh(), checkedAt, 102)).toBeUndefined();
  });

  it("reads returned account IDs with two bounded workers and keeps group ownership", async () => {
    let active = 0, peak = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(new URL(String(url)).origin).toBe(WEAI_LEGACY_ORIGIN);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return Response.json(responseFor(url));
    });
    const result = await readWeAiLegacyCatalog(WEAI_LEGACY_ORIGIN, fetcher);
    expect(result).toMatchObject({ complete: true, status: "live", failedGroups: [] });
    expect(result.groups.map(row => [row.group.id, row.models.length])).toEqual(fixture.groups.map(row => [row.groupId, row.payload.data.models.length]));
    expect(fetcher).toHaveBeenCalledTimes(11);
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.checkedAt >= result.groups.at(-1)!.checkedAt).toBe(true);
  });
  it("accepts reordered group options but rejects an actual group identity change", async () => {
    const fetcher = async (url: string | URL | Request) => {
      const payload = responseFor(url);
      if (new URL(String(url)).search) payload.data.groups.reverse();
      return Response.json(payload);
    };
    expect((await readWeAiLegacyCatalog(WEAI_LEGACY_ORIGIN, fetcher)).complete).toBe(true);
    const changed = await readWeAiLegacyCatalog(WEAI_LEGACY_ORIGIN, async url => {
      const payload = responseFor(url);
      if (new URL(String(url)).searchParams.get("group_id") === "104") payload.data.groups.find(group => group.id === 104)!.name = "changed-account-group";
      return Response.json(payload);
    });
    expect(changed.complete).toBe(false);
    expect(changed.failedGroups.map(group => group.groupId)).toEqual([104]);
  });
  it("honors the caller deadline and does not start HTTP reads for remaining group IDs", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (new URL(String(url)).search) {
        controller.abort(new DOMException("Synthetic caller deadline", "AbortError"));
        return new Promise<Response>(() => { /* Provider transport cancellation must stop this wait. */ });
      }
      return Response.json(responseFor(url));
    });
    const result = await readWeAiLegacyCatalog(WEAI_LEGACY_ORIGIN, fetcher, undefined, controller.signal);
    expect(result).toMatchObject({ status: "live", complete: false });
    expect(result.groups.map(group => group.group.id)).toEqual([101]);
    expect(result.failedGroups).toHaveLength(10);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it.each([401, 403, 404, 503, "network", "html", "wrong-group"] as const)("marks a %s group partial while retaining successful groups", async failure => {
    const result = await readWeAiLegacyCatalog(WEAI_LEGACY_ORIGIN, async url => {
      if (new URL(String(url)).searchParams.get("group_id") === "104") {
        if (failure === "network") throw new Error("Synthetic transport failure");
        if (failure === "html") return new Response("<!doctype html><title>SPA</title>", { headers: { "content-type": "text/html" } });
        if (failure === "wrong-group") return Response.json(fresh(101));
        return Response.json({ code: failure }, { status: failure });
      }
      return Response.json(responseFor(url));
    });
    expect(result.complete).toBe(false);
    expect(result.status).toBe("live");
    expect(result.groups).toHaveLength(10);
    expect(result.failedGroups.map(group => group.groupId)).toEqual([104]);
    expect(result.groups.some(group => group.group.id === 104)).toBe(false);
  });
  it.each([401, 403, 404])("does not follow an initial HTTP %s failure with guessed group requests", async status => {
    const fetcher = vi.fn(async () => Response.json({ code: status }, { status }));
    const result = await readWeAiLegacyCatalog(WEAI_LEGACY_ORIGIN, fetcher);
    expect(result.status).toBe(status === 404 ? "failed" : "unauthorized");
    expect(result.complete).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("distinguishes a valid empty directory from SPA and rejects other source origins before any request", async () => {
    const fetcher = vi.fn(async () => Response.json({ code: 0, data: { groups: [], models: [] } }));
    expect(await readWeAiLegacyCatalog(WEAI_LEGACY_ORIGIN, fetcher)).toMatchObject({ status: "empty", complete: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    for (const source of ["https://other.test", `${WEAI_LEGACY_ORIGIN}/proxy`, `${WEAI_LEGACY_ORIGIN}?group_id=1`, "https://user@asian-acc.we-token.cc"]) {
      expect(isWeAiLegacyCatalogSource(source)).toBe(false);
      expect((await readWeAiLegacyCatalog(source, fetcher)).complete).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
