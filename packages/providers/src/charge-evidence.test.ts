import { describe, expect, it } from "vitest";
import { extractProviderChargeEvidence } from "./error-presentation.js";

const unknown = { status: "unknown", source: "unconfirmed" };

describe("single-request provider billing evidence", () => {
  it.each([
    undefined, null, {}, { status: 400 }, { task_id: null },
    { price: 0.2, estimated_cost: 0.2, cost: 0.2, actual_cost: 0.2, amount: 0.2, currency: "CNY" },
    { balance_before: 10, balance_after: 9.8, quota: 0, usage: { cost: 0.2, total_tokens: 42 } },
    { account: { charged_amount: 12 }, request: { charge: 1 }, pricing: { charge: 3 } },
    { error: { code: "insufficient_balance", message: "余额不足" } },
    "failed requests are generally not charged",
  ])("does not infer a charge from prices, balances or task failure: %j", value => {
    expect(extractProviderChargeEvidence(value)).toEqual(unknown);
  });

  it.each([
    [{ charged: true }, { status: "charged", source: "provider_response" }],
    [{ billed: true }, { status: "charged", source: "provider_response" }],
    [{ no_charge: true }, { status: "not_charged", source: "provider_response" }],
    [{ charged: false }, { status: "not_charged", source: "provider_response" }],
    [{ billed: "false" }, { status: "not_charged", source: "provider_response" }],
    [{ charged_amount: 0.25 }, { status: "charged", amount: 0.25, source: "provider_response" }],
    [{ charged_amount: 0, currency: "USD" }, { status: "not_charged", amount: 0, currency: "USD", source: "provider_response" }],
    [{ charge: "0.25", currency: "usd" }, { status: "charged", amount: 0.25, currency: "USD", source: "provider_response" }],
    [{ result: { remote: { charge: { status: "charged", amount: "0.25", currency: "USD" } } } }, { status: "charged", amount: 0.25, currency: "USD", source: "provider_response" }],
    [{ billing: { status: "charged", cost: 0.25, currency: "积分" } }, { status: "charged", amount: 0.25, currency: "积分", source: "provider_response" }],
    [{ charged: true, actual_cost: 0.25 }, { status: "charged", amount: 0.25, source: "provider_response" }],
    [{ billing: { actualCost: 0.25, currency: "USD" } }, { status: "charged", amount: 0.25, currency: "USD", source: "provider_response" }],
  ])("keeps explicit per-request evidence and never invents a currency: %j", (value, expected) => {
    expect(extractProviderChargeEvidence(value)).toEqual(expected);
  });

  it("keeps the returned refund amount separately from the original larger charge", () => {
    expect(extractProviderChargeEvidence({
      charged_amount: 0.5, currency: "USD", refund: { status: "refunded", amount: 0.25, currency: "USD" },
    })).toEqual({ status: "refunded", amount: 0.25, currency: "USD", source: "provider_response" });
  });

  it.each([
    { refunded: false, refund_amount: 0.25 },
    { refunded: "false", refunded_amount: 0.25 },
    { refund: { refunded: false, status: "refunded", amount: 0.25 } },
    { refund: { status: "not_charged", amount: 0.25 } },
    { refund: { status: "charged", amount: 0.25 } },
  ])("does not promote contradictory refund evidence to a completed refund: %j", value => {
    expect(extractProviderChargeEvidence(value)).toEqual(unknown);
  });

  it("keeps a confirmed charge when the provider explicitly says its refund was not completed", () => {
    expect(extractProviderChargeEvidence({ charged_amount: 0.5, currency: "USD", refunded: false, refund_amount: 0.25 }))
      .toEqual({ status: "charged", amount: 0.5, currency: "USD", source: "provider_response" });
  });

  it("does not confirm a refund whose nested receipt contradicts the summary", () => {
    for (const refund of [{ status: "pending" }, { status: "processing" }, { refunded: false }]) {
      const receipt = { refund_id: "refund-1", refunded: true, refund: { id: "refund-1", amount: 0.25, ...refund } };
      expect(extractProviderChargeEvidence(receipt)).toEqual(unknown);
      expect(extractProviderChargeEvidence({ ...receipt, charged_amount: 0.5, currency: "USD" }))
        .toEqual({ status: "charged", amount: 0.5, currency: "USD", source: "provider_response" });
    }
  });

  it("keeps the confirmed status without choosing between conflicting currency aliases", () => {
    expect(extractProviderChargeEvidence({ refund: { status: "refunded", amount: 0.25, refund_currency: "USD", refundCurrency: "CNY" } }))
      .toEqual({ status: "refunded", source: "provider_response" });
    expect(extractProviderChargeEvidence({ charged_amount: 0.5, currency: "USD", charge_currency: "CNY" }))
      .toEqual({ status: "charged", source: "provider_response" });
  });

  it("uses the explicit refund currency instead of attaching the original charge currency", () => {
    expect(extractProviderChargeEvidence({ charged_amount: 1, charge_currency: "USD", refund_amount: 0.25, refund_currency: "CNY" }))
      .toEqual({ status: "refunded", amount: 0.25, currency: "CNY", source: "provider_response" });
  });

  it.each([
    { refund: { status: "pending", refund_amount: 0.25 } },
    { billing_status: "pending", charge: 0.25 },
    { charge: { status: "pending", charged_amount: 0 } },
    { charge_status: "pending", charge: 0 },
    { billing: { status: "pending", charged_amount: 0.25 } },
    { chargeStatus: "processing", billed_amount: 0.25 },
    { refund_status: "processing", refundAmount: 0.25 },
    { refund_status: "processing", refund: { status: "refunded", amount: 0.25 } },
    { refund_status: "processing", remote: { refund_amount: 0.25 } },
    { charge: { status: "processing", charged: false } },
    { billing_status: "pending", charge: { status: "charged", amount: 0.25 } },
    { billing: { estimated: true, charge: 0.25 } },
    { charge: { approximate: true, charged_amount: 0.25 } },
    { billing: { is_estimate: true, status: "charged", amount: 0.25 } },
    { billing: { isEstimate: "true", cost: 0.25 } },
    { estimated: true, remote: { charge: { status: "charged", amount: 0.25 } } },
  ])("rejects pending and explicitly estimated accounting across every amount path: %j", value => {
    expect(extractProviderChargeEvidence(value)).toEqual(unknown);
  });

  it("preserves a confirmed original charge while its refund is still pending", () => {
    expect(extractProviderChargeEvidence({ charged_amount: 0.5, currency: "USD", refund: { status: "pending", refund_amount: 0.25 } }))
      .toEqual({ status: "charged", amount: 0.5, currency: "USD", source: "provider_response" });
    expect(extractProviderChargeEvidence({ charged_amount: 0.5, currency: "USD", refund_status: "processing", refund_amount: 0.25 }))
      .toEqual({ status: "charged", amount: 0.5, currency: "USD", source: "provider_response" });
  });

  it("does not confuse a running generation status with a pending billing status", () => {
    expect(extractProviderChargeEvidence({ status: "processing", charged_amount: 0.5, currency: "USD" }))
      .toEqual({ status: "charged", amount: 0.5, currency: "USD", source: "provider_response" });
  });

  it("preserves the explicit quota unit without interpreting a bare quota as a fee", () => {
    expect(extractProviderChargeEvidence({ charge: { status: "charged", amount: 100, currency: "quota" } }))
      .toEqual({ status: "charged", amount: 100, currency: "QUOTA", source: "provider_response" });
    expect(extractProviderChargeEvidence({ quota: 100 })).toEqual(unknown);
  });

  it.each([
    { charged: true, no_charge: true },
    { charged: false, billed: true },
    { charge_status: "charged", billing_status: "not_charged" },
    { charged: false, charged_amount: 0.25 },
    { charged: false, charged_amount: -1 },
    { charged: false, charged_amount: Number.NaN },
    { charged: true, charged_amount: Number.POSITIVE_INFINITY },
    { charge: { status: "pending", amount: 0.25 } },
    { refund: { status: "pending", amount: 0.25 } },
  ])("leaves contradictory or unconfirmed evidence unknown: %j", value => {
    expect(extractProviderChargeEvidence(value)).toEqual(unknown);
  });

  it("keeps a confirmed charge without choosing between contradictory amounts", () => {
    expect(extractProviderChargeEvidence({ charged_amount: 0.25, billing: { status: "charged", amount: 0.5 } }))
      .toEqual({ status: "charged", source: "provider_response" });
  });

  it("does not attach a made-up unit or select an amount across conflicting currencies", () => {
    expect(extractProviderChargeEvidence({ charge: { amount: 1, currency: "USD" }, billing: { status: "charged", amount: 1, currency: "CNY" } }))
      .toEqual({ status: "charged", source: "provider_response" });
  });

  it("bounds cyclic and deeply wrapped payloads", () => {
    const value: Record<string, unknown> = { charged: true };
    value.remote = value;
    expect(extractProviderChargeEvidence(value)).toEqual({ status: "charged", source: "provider_response" });
  });
});
