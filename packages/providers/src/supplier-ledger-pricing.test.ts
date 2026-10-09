import { afterEach, beforeEach, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ fetch: vi.fn(), lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
import { isSynoraLedgerSource, parseSynoraLedgerPrices, readSynoraLedgerPrices, SYNORA_LEDGER_URL, SYNORA_NOTIFICATIONS_URL } from "./supplier-ledger-pricing.js";
beforeEach(() => { network.fetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP")); vi.stubGlobal("fetch", network.fetch); });
afterEach(() => { try { expect(network.fetch).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });
// Synthetic timestamps preserve ordering without retaining account billing times.
const checkedAt = "2001-01-03T13:00:00Z";
const billed = { group_id: 115, model: "gpt-image-2.5-sunburst", billing_mode: "image", image_count: 1, image_size: "4K",
  actual_cost: .08, total_cost: .08, rate_multiplier: 1, created_at: "2001-01-03T16:00:00+08:00" };
const envelope = (...items: unknown[]) => ({ code: 0, data: { items, total: items.length } });
const options = { supplierSiteUrl: "https://synoralink.com", checkedAt };
it("preserves only latest exact group/model/resolution billed samples without multiplying or inferring quality", () => {
  const rows = parseSynoraLedgerPrices(envelope(
    { ...billed, actual_cost: .07, created_at: "2001-01-01T08:00:00Z" }, billed,
    { ...billed, group_id: 99, actual_cost: .06 },
    { ...billed, model: "gpt-image-2.5-flare", actual_cost: .07 },
    { ...billed, image_size: "1K", actual_cost: .03 },
    { ...billed, model: "gpt-image-2.5-sunburst-leo", actual_cost: .09 },
    { ...billed, image_count: 2, actual_cost: .16 }, { ...billed, billing_mode: "token", actual_cost: .1324 },
    { ...billed, group_id: undefined }, { ...billed, model: "" }, { ...billed, image_size: "auto" },
    { ...billed, actual_cost: -.1 }, { ...billed, actual_cost: "0.08" }, { ...billed, currency: "CNY" },
  ), options);
  expect(rows).toHaveLength(5);
  expect(rows.find(row => row.supplierGroupId === "115" && row.modelId === billed.model && row.resolution === "4K"))
    .toEqual({ amount: .08, currency: "USD", unit: "image", checkedAt, observedAt: billed.created_at, sourceUrl: SYNORA_LEDGER_URL,
      supplierGroupId: "115", modelId: billed.model, resolution: "4K", parameters: { n: 1, resolution: "4K" }, sample: true, billingMode: "image" });
  expect(JSON.stringify(rows)).not.toContain("quality");
});
it("retains a later exact price-change notice without deriving an amount from ambiguous 008 or model suffixes", () => {
  const notifications = envelope({ title: "全参分组价格调整", content: "gpt-image-2.5-sunburst这个模型暂时涨价到008", created_at: "2001-01-03T12:00:00Z" },
    { title: "全参分组价格调整", content: "gpt-image-2.5-sunburst-leo涨价到0.5", created_at: "2001-01-03T12:30:00Z" });
  const samples = parseSynoraLedgerPrices(envelope(billed, { ...billed, group_id: 99 }), { ...options, notifications });
  expect(samples[0]).toMatchObject({ amount: .08, notificationAt: "2001-01-03T12:00:00Z", notificationSourceUrl: SYNORA_NOTIFICATIONS_URL });
  expect(samples[1]!.notificationAt).toBeUndefined();
  expect(parseSynoraLedgerPrices(envelope(), { ...options, notifications })).toEqual([]);
});
it.each(["https://synoralink.com.evil.invalid", "http://synoralink.com", "https://user@ synoralink.com", "https://synoralink.com/gateway", "https://synoralink.com/?token=fixture"])
  ("never trusts another source or forwards credentials to %s", async supplierSiteUrl => {
    expect(isSynoraLedgerSource(supplierSiteUrl)).toBe(false);
    expect(parseSynoraLedgerPrices(envelope(billed), { ...options, supplierSiteUrl })).toEqual([]);
    const transport = vi.fn();
    expect(await readSynoraLedgerPrices(supplierSiteUrl, transport, { headers: { authorization: "Bearer fixture" } })).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });
it("bounds the two official GETs and isolates notice failure from successful ledger evidence", async () => {
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe("GET"); expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture");
    return String(url) === SYNORA_LEDGER_URL ? Response.json(envelope(billed)) : Response.json({}, { status: 401 });
  });
  expect(await readSynoraLedgerPrices(options.supplierSiteUrl, transport, { checkedAt, headers: { authorization: "Bearer fixture" } }))
    .toMatchObject([{ amount: .08, supplierGroupId: "115", parameters: { n: 1, resolution: "4K" } }]);
  expect(transport.mock.calls.map(call => String(call[0])).sort()).toEqual([SYNORA_LEDGER_URL, SYNORA_NOTIFICATIONS_URL].sort());
  const failed = vi.fn(async () => Response.json({}, { status: 403 }));
  expect(await readSynoraLedgerPrices(options.supplierSiteUrl, failed, { checkedAt })).toEqual([]);
});
