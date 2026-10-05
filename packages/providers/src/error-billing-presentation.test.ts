import { describe, expect, it, vi } from "vitest";
import { presentProviderError } from "./error-presentation.js";
import { fetchProviderJson, hasProviderHttpProxy, ProviderHttpError, withProviderSubmissionProgress } from "./http.js";

const context = { provider: "rest" };
const unconfirmed = { status: "unknown", source: "unconfirmed" };
const transportError = (code: string, overrides: Partial<ProviderHttpError["details"]> = {}) => new ProviderHttpError("Provider network request failed", {
  kind: "network", phase: "submit", retryable: false, submissionMayHaveOccurred: false,
  cause: Object.assign(new Error("connection failed"), { code }), ...overrides,
});

describe("failure ownership and billing presentation", () => {
  it.each(["EACCES", "EPERM", "ENETDOWN", "ENETUNREACH", "EADDRNOTAVAIL"])("identifies confirmed pre-send local connection failure %s", code => {
    expect(presentProviderError(transportError(code, { requestNotSent: true }), context)).toMatchObject({
      failureCategory: "local_network", charge: { status: "not_charged", source: "not_submitted" },
    });
  });

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "PROVIDER_NETWORK_DISCOVERY_FAILED"])("does not blame the local machine for pre-send error %s", code => {
    expect(presentProviderError(transportError(code), context)).toMatchObject({
      failureCategory: "network", charge: { status: "not_charged", source: "not_submitted" },
    });
  });

  it("does not use a local-looking code as proof after an ambiguous submission", () => {
    expect(presentProviderError(transportError("EACCES", { submissionMayHaveOccurred: true }), context)).toMatchObject({
      failureCategory: "network", charge: unconfirmed,
    });
  });

  it.each(["poll", "archive", "cancel"] as const)("does not label an existing task free after a %s network failure", phase => {
    expect(presentProviderError(transportError("ENOTFOUND", { phase, requestNotSent: true }), context).charge).toEqual(unconfirmed);
  });

  it.each([400, 401, 402, 429, 500])("does not infer no charge from HTTP %i, missing task id or a quote", status => {
    const error = new ProviderHttpError(`Provider returned HTTP ${status}`, {
      kind: "provider", phase: "submit", status, retryable: false, submissionMayHaveOccurred: false,
      responseBody: { task_id: null, price: 0.25, balance: 12 },
    });
    expect(presentProviderError(error, context).charge).toEqual(unconfirmed);
  });

  it.each([
    ["No available compatible accounts", 401], ["no_available_accounts", 429],
    ["上游账号余额不足", 403], ["system under load", 503],
  ])("recognizes supplier capacity before authentication or customer balance: %s", (message, status) => {
    const error = new ProviderHttpError(`Provider returned HTTP ${status}`, {
      kind: "authentication", phase: "submit", status: Number(status), retryable: false, submissionMayHaveOccurred: true,
      responseBody: { message },
    });
    const presentation = presentProviderError(error, context);
    expect(presentation.failureCategory).toBe("supplier_capacity");
    expect(presentation.charge).toEqual(unconfirmed);
    expect(presentation.actionLabel).toBeUndefined();
  });

  it("distinguishes customer balance, key permissions, rate limits and moderation", () => {
    for (const [code, category] of [["INSUFFICIENT_BALANCE", "insufficient_balance"], ["invalid_api_key", "authentication"], ["rate_limit_exceeded", "rate_limit"], ["content_policy_violation", "content_policy"]]) {
      expect(presentProviderError({ code, message: code }, context).failureCategory).toBe(category);
    }
  });

  it("preserves a provider's explicit per-request fee on a failed task", () => {
    const error = new ProviderHttpError("Provider returned HTTP 503", {
      kind: "provider", phase: "poll", status: 503, retryable: false, submissionMayHaveOccurred: false,
      responseBody: { error: { message: "No available accounts" }, charge: { status: "charged", amount: 0.25, currency: "USD" } },
    });
    expect(presentProviderError(error, context)).toMatchObject({ failureCategory: "supplier_capacity", charge: { status: "charged", amount: 0.25, currency: "USD", source: "provider_response" } });
  });

  it("provides explicit no-charge evidence when local validation stops the actual request", async () => {
    const fetch = vi.fn();
    const error = await fetchProviderJson(fetch, "http://127.0.0.1/generate", { method: "POST" }, { phase: "submit" }).catch(value => value);
    expect(error.details.requestNotSent).toBe(true);
    expect(presentProviderError(error, context)).toMatchObject({ failureCategory: "invalid_request", charge: { status: "not_charged", source: "not_submitted" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["ENOTFOUND", "ECONNREFUSED"])("does not erase an accepted submission when receiving-progress persistence fails with %s", async code => {
    const fetch = vi.fn(async () => Response.json({ id: "accepted-task" }));
    const error = await withProviderSubmissionProgress(async phase => {
      if (phase === "receiving") throw Object.assign(new Error("progress persistence connection failed"), { code });
    }, () => fetchProviderJson(fetch, "https://provider.test/generate", { method: "POST" }, { phase: "submit" })).catch(value => value);
    expect(error.details.submissionMayHaveOccurred).toBe(true);
    expect(error.details.requestNotSent).toBeUndefined();
    expect(error.details.retryable).toBe(false);
    expect(presentProviderError(error, context).charge).toEqual(unconfirmed);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not reuse pre-send details from a progress callback after submission was accepted", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "accepted-task" }));
    const error = await withProviderSubmissionProgress(async phase => {
      if (phase === "receiving") throw transportError("ENOTFOUND", { requestNotSent: true });
    }, () => fetchProviderJson(fetch, "https://provider.test/generate", { method: "POST" }, { phase: "submit" })).catch(value => value);
    expect(error.details.submissionMayHaveOccurred).toBe(true);
    expect(error.details.requestNotSent).toBeUndefined();
    expect(error.details.retryable).toBe(false);
    expect(presentProviderError(error, context).charge).toEqual(unconfirmed);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not erase an accepted submission when receiving-progress detects an invalid proxy", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "accepted-task" }));
    const error = await withProviderSubmissionProgress(async phase => {
      if (phase === "receiving") hasProviderHttpProxy("invalid-proxy-url");
    }, () => fetchProviderJson(fetch, "https://provider.test/generate", { method: "POST" }, { phase: "submit" })).catch(value => value);
    expect(error.details.submissionMayHaveOccurred).toBe(true);
    expect(error.details.requestNotSent).toBeUndefined();
    expect(error.details.retryable).toBe(false);
    expect(presentProviderError(error, context).charge).toEqual(unconfirmed);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps discovery-error wording consistent with an answered request and an existing task query", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "accepted-task" }));
    const error = await withProviderSubmissionProgress(async phase => {
      if (phase === "receiving") throw Object.assign(new Error("progress persistence failed"), { code: "PROVIDER_NETWORK_DISCOVERY_FAILED" });
    }, () => fetchProviderJson(fetch, "https://provider.test/generate", { method: "POST" }, { phase: "submit" })).catch(value => value);
    const presentation = presentProviderError(error, context);
    expect(presentation).toMatchObject({ submissionMayHaveOccurred: true, retryable: false, charge: unconfirmed });
    expect(presentation.message).toContain("不要重复提交");
    expect(presentation.message).not.toMatch(/尚未向供应商提交请求|检查网络后重试/);
    const polling = presentProviderError(transportError("PROVIDER_NETWORK_DISCOVERY_FAILED", { phase: "poll", requestNotSent: true }), context);
    expect(polling.message).toContain("原任务");
    expect(polling.message).not.toMatch(/尚未向供应商提交请求|检查网络后重试/);
  });

  it("labels a disk failure separately without assuming the generation was free", () => {
    expect(presentProviderError(Object.assign(new Error("disk full"), { code: "ENOSPC" }), context))
      .toMatchObject({ failureCategory: "local_storage", charge: unconfirmed });
  });

  it("does not encourage another paid submission after an ambiguous timeout", () => {
    const error = new ProviderHttpError("Provider request timed out", { kind: "timeout", phase: "submit", retryable: false, submissionMayHaveOccurred: true });
    const presentation = presentProviderError(error, context);
    expect(presentation.failureCategory).toBe("network");
    expect(presentation.charge).toEqual(unconfirmed);
    expect(presentation.message).toContain("不要重复提交");
  });

  it("keeps missing failure ownership and charge evidence explicitly unknown", () => {
    expect(presentProviderError(new Error("unexpected failure"), context))
      .toMatchObject({ failureCategory: "unknown", charge: unconfirmed });
  });
});
