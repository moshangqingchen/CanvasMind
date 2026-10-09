import { describe, expect, it } from "vitest";
import type { SupplierVerificationCase } from "@super-canvas/db";
import { chargeFromVerificationResponse, chargeFromVerificationUsage, verificationChargeForComparison } from "./supplier-verification-failure";
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
