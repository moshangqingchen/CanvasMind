import { describe, expect, it } from "vitest";
import type { SupplierVerificationCase } from "@super-canvas/db";
import { chargeFromVerificationResponse, chargeFromVerificationUsage, verificationChargeForComparison, verificationFailure } from "./supplier-verification-failure";
import { reconcileVerificationCharge } from "./supplier-capabilities";

const testCase = (result?: Record<string, unknown>) => ({ requestId: "request", task: { providerTaskId: "task", result } }) as unknown as SupplierVerificationCase;
const sourceUrl = "https://supplier.example/api/v1/usage";

describe("verification charge evidence", () => {
  it("reads decimal charges from billing even when usage contains only token counts", () => {
    expect(chargeFromVerificationResponse(testCase({ usage: { input_tokens: 100 }, billing: { actual_cost: "0.07", currency: " USD " } })))
      .toMatchObject({ amount: 0.07, currency: "USD", unit: "request", requestId: "request", taskId: "task" });
  });

  it("reads wrapped response costs and preserves an explicit image unit", () => {
    expect(chargeFromVerificationResponse(testCase({ data: { usage: { cost: "7e-2", billing_unit: "image" }, currency: "USD" } })))
      .toMatchObject({ amount: 0.07, currency: "USD", unit: "image" });
  });

  it.each(["", "NaN", "Infinity", "-0.1", "0x10", true])("ignores invalid response amount %s", amount => {
    expect(chargeFromVerificationResponse(testCase({ billing: { actual_cost: amount, currency: "USD" } }))).toBeUndefined();
  });

  it("reads sub2api decimal ledger totals as observed request cost in site credits", () => {
    const payload = { data: { items: [{ request_id: "other", actual_cost: 99 }, { request_id: "request", actual_cost: "0.07", input_tokens: 120 }] } };
    expect(chargeFromVerificationUsage(payload, testCase(), "sub2api", sourceUrl))
      .toMatchObject({ amount: 0.07, currency: "credits", unit: "request", requestId: "request", sourceUrl });
  });

  it("matches task evidence stored as an object and keeps raw quota without guessing a currency", () => {
    expect(chargeFromVerificationUsage({ data: { logs: [{ other: { task_id: "task" }, quota: "35000", currency: "USD" }] } }, testCase(), "newapi", sourceUrl))
      .toMatchObject({ amount: 35000, currency: "quota", unit: "request", taskId: "task" });
    expect(chargeFromVerificationUsage({ items: [{ request_id: "request", actual_cost: "0.07", quota: "35000" }] }, testCase(), "newapi", sourceUrl))
      .toMatchObject({ amount: 35000, currency: "quota", unit: "request" });
  });

  it("accepts a declared image unit but never assumes token totals are fixed per-image prices", () => {
    expect(chargeFromVerificationUsage({ items: [{ other: '{"request_id":"request"}', cost: "0.07", currency: "USD", billing_unit: "per-image" }] }, testCase(), "sub2api", sourceUrl))
      .toMatchObject({ amount: 0.07, currency: "USD", unit: "image" });
    expect(chargeFromVerificationUsage({ items: [{ request_id: "request", cost: 0.07, currency: "USD", unit: "token" }] }, testCase(), "sub2api", sourceUrl)?.unit).toBe("request");
  });

  it("does not use nearby charges, account totals, missing currency or invalid ledger amounts", () => {
    for (const row of [{ request_id: "other", cost: 0.07, currency: "USD" }, { cost: 0.07, currency: "USD" },
      { request_id: "request", cost: 0.07 }, { request_id: "request", cost: -1, currency: "USD" }])
      expect(chargeFromVerificationUsage({ data: { items: [row], total_actual_cost: 5 } }, testCase(), "newapi", sourceUrl)).toBeUndefined();
    expect(chargeFromVerificationUsage({ success: false, items: [{ request_id: "request", cost: 0.07, currency: "USD" }] }, testCase(), "sub2api", sourceUrl)).toBeUndefined();
  });

  it("checks documented image rates against a single-image request total while retaining its observed unit", () => {
    const test = { ...testCase(), parameters: { n: 1 }, expectedCharge: { amount: 0.07, currency: "USD", unit: "image" as const, checkedAt: "now" } };
    const actual = chargeFromVerificationUsage({ items: [{ request_id: "request", actual_cost: "0.14", currency: "USD" }] }, test, "sub2api", sourceUrl)!;
    expect(reconcileVerificationCharge(test.expectedCharge, verificationChargeForComparison(test, actual), test.requestId)).toBe("mismatch");
    expect(reconcileVerificationCharge(test.expectedCharge, verificationChargeForComparison(test, { ...actual, amount: 0.07 }), test.requestId)).toBe("matched");
    expect(actual.unit).toBe("request");
    for (const n of [undefined, 0, 2, "1"]) {
      const unknownCount: SupplierVerificationCase = { ...test, parameters: n === undefined ? {} : { n } };
      expect(reconcileVerificationCharge(test.expectedCharge, verificationChargeForComparison(unknownCount, actual), test.requestId)).toBe("unknown");
    }
    expect(reconcileVerificationCharge(test.expectedCharge, verificationChargeForComparison(test, { ...actual, currency: "credits" }), test.requestId)).toBe("unknown");
    expect(reconcileVerificationCharge(test.expectedCharge, verificationChargeForComparison(test, { ...actual, requestId: "other", taskId: undefined }), test.requestId)).toBe("unknown");
  });
});

describe("verification failure identity and balance evidence", () => {
  const failure = (status: number, responseBody?: unknown, message = "request rejected") => verificationFailure(
    Object.assign(new Error(message), { details: { status, responseBody } }),
  );

  it.each([11.5, 17.5])("does not block a valid Key for the Jiasu HTTP403 precharge threshold %s", precharge => {
    expect(failure(403, JSON.stringify({ error: {
      code: "insufficient_user_quota", message: `当前剩余额度: ¥9.98，本次请求预扣额度: ¥${precharge}`,
    } }))).toMatchObject({ balance: true, authentication: false, unavailable: false, definiteReason: "账户余额不足", terminal: true, free: false });
  });

  it.each([
    { error: { code: "insufficient_balance", message: "payment rejected" } },
    { data: { error: { code: "insufficient_quota", message: "payment rejected" } } },
    { message: "当前账户余额不足，请充值后重试" },
    "Insufficient user quota before submission",
  ])("recognizes explicit account quota or balance evidence without inferring a free request", body => {
    expect(failure(403, body)).toMatchObject({ balance: true, authentication: false, definiteReason: "账户余额不足", free: false });
  });

  it.each([401, 403])("retains genuine HTTP%s authentication failures", status => {
    expect(failure(status)).toMatchObject({ balance: false, authentication: true, definiteReason: "鉴权失败，请检查当前分组 Key" });
  });

  it.each([
    { code: "AUTH_INSUFFICIENT_PRIVILEGE", message: "权限不足，请充值升级分组" },
    { error: { code: "permission_denied", message: "Permission denied; contact billing" } },
    { message: "无此权限，请充值升级" },
  ])("does not turn a permission denial into a balance diagnosis", body => {
    expect(failure(403, body)).toMatchObject({ balance: false, authentication: true, definiteReason: "鉴权失败，请检查当前分组 Key" });
  });

  it.each([
    { error: { code: "insufficient_quota", message: "上游账号余额不足，请联系供应商" } },
    { error: { message: "Upstream account balance is insufficient" } },
    { error: { message: "No available accounts for this group" } },
  ])("does not request account recharge or invalidate a Key for upstream pool failures", body => {
    expect(failure(403, body)).toMatchObject({ unavailable: true, balance: false, authentication: false, definiteReason: undefined });
  });

  it("preserves HTTP402 account balance handling and explicit no-charge evidence", () => {
    expect(failure(402, { error: { charged: false } })).toMatchObject({ balance: true, authentication: false, free: true, definiteReason: "账户余额不足" });
    expect(failure(504)).toMatchObject({ balance: false, authentication: false, terminal: false });
  });
});
