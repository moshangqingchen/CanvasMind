import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSupplierBilling, readSupplierBilling } from "./supplier-billing-read";
import { billingAmount, billingCompact, billingTodayAmount, billingSourceLabel } from "./supplier-billing-display";
import type { SupplierBillingSnapshot } from "@super-canvas/db";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("supplier account amounts", () => {
  it("converts NewAPI quota only with the site's own divisor", () => {
    expect(parseSupplierBilling("newapi", { data: { quota: "750000", used_quota: 125000, request_count: 12 } }, { data: { quota_per_unit: 500000 } }))
      .toMatchObject({ balance: 1.5, used: .25, todayUsed: undefined, requests: 12, unit: "credits", unitBasis: "site-conversion" });
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
    expect(parseSupplierBilling("newapi", profile, { quota_per_unit: 500000, quota_display_type: "CNY" })).toMatchObject({ balance: 500000, unit: "quota", unitBasis: "raw-quota" });
  });
  it("shows Tk1688 balances and daily consumption in CNY using its official payment FX", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/user/self") return Response.json({ data: { quota: 500000, used_quota: 100000 } });
      if (path === "/api/status") return Response.json({ data: { quota_per_unit: 500000, quota_display_type: "USD",
        payment_fx_rate_cny_per_usd: 6.8896, usd_exchange_rate: 99 } });
      return Response.json({ data: { quota: 125000 } });
    });
    const result = await readSupplierBilling({ siteUrl: "https://tk1688.com", sourceId: "tk", kind: "newapi" }, fetcher);
    expect(result).toMatchObject({ balance: 6.8896, unit: "CNY", status: "live" });
    expect(result.used).toBeCloseTo(1.37792);
    expect(result.todayUsed).toBeCloseTo(1.7224);
    expect(fetcher.mock.calls.every(call => String(call[0]).startsWith("https://tk1688.com/"))).toBe(true);
    const withoutFx = parseSupplierBilling("newapi", { quota: 500000 }, { quota_per_unit: 500000, quota_display_type: "USD", usd_exchange_rate: 7 },
      undefined, { siteUrl: "https://tk1688.com" });
    expect(withoutFx).toMatchObject({ balance: 500000, unit: "quota", unitBasis: "raw-quota" });
  });
  it("reads account actual cost instead of list pages or standard cost", () => {
    expect(parseSupplierBilling("sub2api", { code: 0, data: { balance: "12.35", currency: "USD" } },
      { code: 0, data: { total_actual_cost: 1.2345, total_cost: 99, today_actual_cost: .1, total_requests: 8, items: [{ actual_cost: 999 }] } }))
      .toMatchObject({ balance: 12.35, used: 1.2345, todayUsed: .1, requests: 8, unit: "USD", unitBasis: "declared-currency" });
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

  it.each([
    [{ quota_per_unit: 500000 }, .25, "credits"],
    [{ quota_per_unit: 500000, quota_display_type: "CNY", usd_exchange_rate: 7.2 }, 1.8, "CNY"],
    [{ quota_per_unit: 500000, quota_display_type: "USD" }, .25, "USD"],
    [{ quota_per_unit: 500000, quota_display_type: "CUSTOM", custom_currency_exchange_rate: 10, custom_currency_symbol: "点" }, 2.5, "点"],
    [{ quota_per_unit: 500000, quota_display_type: "TOKENS" }, 125000, "quota"],
    [{}, 125000, "quota"],
  ])("converts daily NewAPI quota with the same site settings %j", (settings, todayUsed, unit) => {
    expect(parseSupplierBilling("newapi", { quota: 1000000, used_quota: 500000 }, settings, { success: true, data: { quota: 125000 } }))
      .toMatchObject({ todayUsed, unit });
  });

  it.each([
    ["Asia/Shanghai", "2026-09-27T04:34:56.789Z", "2026-09-26T16:00:00.000Z"],
    ["America/New_York", "2026-03-08T18:34:56.789Z", "2026-03-08T05:00:00.000Z"],
  ])("reads all account usage since local midnight in %s", async (timeZone, timestamp, midnight) => {
    vi.stubEnv("TZ", timeZone);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(timestamp));
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      const path = new URL(String(url)).pathname;
      if (path === "/site/api/user/self") return Response.json({ success: true, data: { quota: 1000000, used_quota: 500000 } });
      if (path === "/site/api/status") return Response.json({ success: true, data: { quota_per_unit: 500000 } });
      expect(path).toBe("/site/api/log/self/stat");
      return Response.json({ success: true, data: { quota: 0, rpm: 10, tpm: 1000 } });
    });
    const result = await readSupplierBilling({ siteUrl: "https://site.invalid/site", sourceId: "s", kind: "newapi" }, fetcher);
    expect(result).toMatchObject({ balance: 2, used: 1, todayUsed: 0, todayStatus: "live", status: "live",
      todayWindow: { startAt: midnight, endAt: timestamp, timeZone } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const query = new URL(String(fetcher.mock.calls.find(call => String(call[0]).includes("/log/self/stat"))![0])).searchParams;
    expect(Object.fromEntries(query)).toEqual({ type: "2", start_timestamp: String(Date.parse(midnight) / 1000), end_timestamp: String(Math.floor(Date.parse(timestamp) / 1000)) });
    expect(billingTodayAmount(result)).toBe("0 额度");
  });

  it.each([404, 405, 501, 403, 429, 503])("keeps account totals when daily stats return HTTP %s", async status => {
    const result = await readSupplierBilling({ siteUrl: "https://site.invalid", sourceId: "s", kind: "newapi" }, async url => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/user/self") return Response.json({ data: { quota: 1000000, used_quota: 500000 } });
      if (path === "/api/status") return Response.json({ data: { quota_per_unit: 500000 } });
      return Response.json({ message: "private-site-error-secret" }, { status });
    });
    const unsupported = [404, 405, 501].includes(status);
    expect(result).toMatchObject({ status: "partial", balance: 2, used: 1, todayUsed: undefined, todayStatus: unsupported ? "unsupported" : "failed" });
    expect(billingTodayAmount(result)).toBe(unsupported ? "暂不支持" : "未读取");
    expect(JSON.stringify(result)).not.toContain("private-site-error-secret");
  });

  it.each([undefined, null, "", " ", false, "NaN", {}, []])("does not treat missing or invalid daily usage %j as zero", async today_actual_cost => {
    const result = await readSupplierBilling({ siteUrl: "https://site.invalid", sourceId: "s", kind: "sub2api" }, async url =>
      String(url).endsWith("/profile") ? Response.json({ data: { balance: 8 } }) : Response.json({ data: { total_actual_cost: 2, today_actual_cost } }));
    expect(result).toMatchObject({ status: "partial", balance: 8, used: 2, todayStatus: "missing", todayUsed: undefined });
    expect(billingTodayAmount(result)).toBe("未读取");
    expect(parseSupplierBilling("newapi", { quota: 1 }, {}, { data: { quota: today_actual_cost } }).todayUsed).toBeUndefined();
  });

  it("rejects daily application errors while keeping valid account totals", async () => {
    const result = await readSupplierBilling({ siteUrl: "https://site.invalid", sourceId: "s", kind: "newapi" }, async url => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/user/self") return Response.json({ data: { quota: 1000000, used_quota: 500000 } });
      if (path === "/api/status") return Response.json({ data: { quota_per_unit: 500000 } });
      return Response.json({ success: false, message: "secret", data: { quota: 0 } });
    });
    expect(result).toMatchObject({ status: "partial", todayStatus: "failed", todayUsed: undefined, balance: 2 });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("labels retained daily values and yesterday's snapshot as previous data", () => {
    const billing: SupplierBillingSnapshot = { sourceId: "s", status: "live", checkedAt: "2026-09-27T04:00:00Z", lastSuccessAt: "2026-09-27T04:00:00Z", todayUsed: 0, todayStatus: "live", unit: "credits", sourceUrl: "https://site.invalid" };
    const now = new Date(billing.checkedAt);
    expect(billingTodayAmount(billing, now)).toBe("0 额度");
    expect(billingTodayAmount({ ...billing, status: "failed" }, now)).toBe("0 额度（上次）");
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    expect(billingTodayAmount(billing, tomorrow)).toBe("0 额度（上次）");
    expect(billingTodayAmount(undefined, now)).toBe("未读取");
  });

  it("rejects string error codes rather than displaying error-payload zeros", async () => {
    expect(() => parseSupplierBilling("sub2api", { code: "403", data: { balance: 0 } }, {})).toThrow();
    expect(parseSupplierBilling("sub2api", { code: "0", data: { balance: 0 } }, { code: "200", data: { total_actual_cost: 0 } })).toMatchObject({ balance: 0, used: 0 });
    const result = await readSupplierBilling({ siteUrl: "https://site.invalid", sourceId: "s", kind: "sub2api" }, async url =>
      String(url).endsWith("/profile") ? Response.json({ data: { balance: 8 } }) : Response.json({ code: "403", data: { total_actual_cost: 0, today_actual_cost: 0 } }));
    expect(result).toMatchObject({ status: "partial", balance: 8, used: undefined, todayUsed: undefined, todayStatus: "failed" });
  });

  it("never labels unconverted quota as the profile currency or emits an infinite conversion", () => {
    const result = parseSupplierBilling("newapi", { currency: "CNY", quota: 500000, used_quota: 100000 }, { quota_per_unit: 500000, quota_display_type: "CNY" });
    expect(result).toMatchObject({ balance: 500000, used: 100000, unit: "quota", unitBasis: "raw-quota" });
    expect(parseSupplierBilling("newapi", { quota: Number.MAX_VALUE }, { quota_per_unit: 1, quota_display_type: "CNY", usd_exchange_rate: 10 }).balance).toBeUndefined();
  });

  it("keeps different declared account and usage currencies without converting either", async () => {
    const result = await readSupplierBilling({ siteUrl: "https://site.invalid", sourceId: "s", kind: "sub2api" }, async url =>
      String(url).endsWith("/profile") ? Response.json({ data: { balance: 10, currency: "cny" } }) : Response.json({ data: { total_actual_cost: 2, today_actual_cost: .5, currency: "USD" } }));
    expect(result).toMatchObject({ unit: "CNY", balanceUnit: "CNY", usedUnit: "USD", todayUnit: "USD", balance: 10, used: 2,
      sourceUrl: "https://site.invalid/api/v1/user/profile", usedSourceUrl: "https://site.invalid/api/v1/usage/dashboard/stats", todaySourceUrl: "https://site.invalid/api/v1/usage/dashboard/stats" });
    expect(billingCompact(result)).toBe("余额 10 CNY");
    expect(billingTodayAmount(result)).toBe("0.5 USD");
    expect(billingSourceLabel(result)).toBe("来源：site.invalid 供应商后台");
  });

  it("preserves tiny nonzero costs and uses legacy checkedAt to date daily snapshots", () => {
    expect(billingAmount(.000001, "USD")).toBe("0.000001 USD");
    const old: SupplierBillingSnapshot = { sourceId: "s", status: "live", checkedAt: "2026-09-27T04:00:00Z", todayUsed: 1, unit: "USD", sourceUrl: "https://site.invalid/path?private=omit" };
    expect(billingTodayAmount(old, new Date("2026-09-28T04:00:00Z"))).toBe("1 USD（上次）");
    expect(billingSourceLabel(old)).toBe("来源：site.invalid 供应商后台");
    expect(billingSourceLabel({ ...old, sourceUrl: "javascript:private" })).toBeUndefined();
  });
});
