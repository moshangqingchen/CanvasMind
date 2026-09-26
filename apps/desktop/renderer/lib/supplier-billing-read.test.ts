import { describe, expect, it, vi } from "vitest";
import { parseSupplierBilling, readSupplierBilling } from "./supplier-billing-read";
import { billingAmount, billingCompact } from "./supplier-billing-display";

describe("supplier account amounts", () => {
  it("converts NewAPI quota only with the site's own divisor", () => {
    expect(parseSupplierBilling("newapi", { data: { quota: "750000", used_quota: 125000, request_count: 12 } }, { data: { quota_per_unit: 500000 } }))
      .toEqual({ balance: 1.5, used: .25, todayUsed: undefined, requests: 12, unit: "credits" });
    expect(parseSupplierBilling("newapi", { data: { quota: 750000 } }, {})).toMatchObject({ balance: 750000, unit: "quota" });
  });
  it("keeps zero and negative balance but never fabricates missing amounts", () => {
    expect(parseSupplierBilling("sub2api", { data: { balance: 0 } }, { data: { total_actual_cost: "0" } })).toMatchObject({ balance: 0, used: 0 });
    expect(parseSupplierBilling("sub2api", { balance: -2 }, {}).balance).toBe(-2);
    for (const value of [null, "", " ", false, {}, Infinity, "NaN"]) {
      expect(parseSupplierBilling("sub2api", { balance: value }, { total_actual_cost: value })).toMatchObject({ balance: undefined, used: undefined });
    }
    expect(billingAmount(undefined)).toBe("未读取");
    expect(billingAmount(0)).toBe("0 额度");
  });
  it("matches explicit site display currency using only its configured exchange rate", () => {
    const profile = { quota: 500000, used_quota: 100000 };
    expect(parseSupplierBilling("newapi", profile, { quota_per_unit: 500000, quota_display_type: "CNY", usd_exchange_rate: 7.2 })).toMatchObject({ balance: 7.2, used: 1.4400000000000002, unit: "CNY" });
    expect(parseSupplierBilling("newapi", profile, { quota_per_unit: 500000, quota_display_type: "USD", usd_exchange_rate: 7.2 })).toMatchObject({ balance: 1, unit: "USD" });
    expect(parseSupplierBilling("newapi", profile, { quota_per_unit: 500000, quota_display_type: "TOKENS" })).toMatchObject({ balance: 500000, unit: "quota" });
    expect(parseSupplierBilling("newapi", profile, { quota_per_unit: 500000, quota_display_type: "CNY" })).toMatchObject({ balance: 1, unit: "credits" });
  });
  it("reads account actual cost instead of list pages or standard cost", () => {
    expect(parseSupplierBilling("sub2api", { code: 0, data: { balance: "12.35", currency: "USD" } },
      { code: 0, data: { total_actual_cost: 1.2345, total_cost: 99, today_actual_cost: .1, total_requests: 8, items: [{ actual_cost: 999 }] } }))
      .toEqual({ balance: 12.35, used: 1.2345, todayUsed: .1, requests: 8, unit: "USD" });
    expect(parseSupplierBilling("sub2api", { balance: 5 }, {}).unit).toBe("credits");
    expect(() => parseSupplierBilling("newapi", { success: false, data: { quota: 1 } }, {})).toThrow();
    expect(() => parseSupplierBilling("sub2api", { code: 401, data: { balance: 1 } }, {})).toThrow();
  });
  it("keeps partial balance when stats are denied, but rejects a failed profile", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/profile")
      ? Response.json({ code: 0, data: { balance: 12 } }) : Response.json({ code: 403, message: "private-error" }));
    const result = await readSupplierBilling({ siteUrl: "https://site.invalid", sourceId: "source", kind: "sub2api" }, fetcher);
    expect(result).toMatchObject({ status: "partial", balance: 12, used: undefined });
    expect(JSON.stringify(result)).not.toContain("private-error");
    expect(fetcher.mock.calls.map(call => String(call[0])).sort()).toEqual(["https://site.invalid/api/v1/user/profile", "https://site.invalid/api/v1/usage/dashboard/stats"].sort());
    await expect(readSupplierBilling({ siteUrl: "https://site.invalid", sourceId: "s", kind: "newapi" }, async () => Response.json({ success: false }))).rejects.toThrow();
  });
  it("marks raw quota partial and keeps its unit explicit", async () => {
    const result = await readSupplierBilling({ siteUrl: "https://site.invalid", sourceId: "s", kind: "newapi" }, async url =>
      String(url).endsWith("/self") ? Response.json({ data: { quota: 300, used_quota: 200 } }) : new Response("", { status: 503 }));
    expect(result).toMatchObject({ status: "partial", balance: 300, used: 200, unit: "quota" });
    expect(billingCompact({ ...result, status: "failed" })).toBe("余额 300 原始额度（上次）");
  });
});
