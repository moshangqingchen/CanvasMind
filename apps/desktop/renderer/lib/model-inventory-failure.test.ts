import { describe, expect, it } from "vitest";
import { ProviderHttpError } from "@super-canvas/providers";
import { assertCompleteModelInventoryPayload, isCompleteModelInventoryResponse, ModelInventoryReadError,
  modelInventoryFailure, modelInventoryFailureConfig, modelInventoryFailureHeaders } from "./model-inventory-failure";

describe("model directory completeness and safe failures", () => {
  it.each([{ code: "INSUFFICIENT_BALANCE", message: "private-token-must-not-echo" },
    { error: { code: "INSUFFICIENT_BALANCE", message: "private-token-must-not-echo" } }])(
    "distinguishes supplier HTTP403 insufficient balance from an invalid Key", responseBody => {
      const error = new ProviderHttpError("Provider returned HTTP 403", { kind: "authentication", phase: "connect", retryable: false,
        submissionMayHaveOccurred: false, status: 403, responseBody });
      const failure = modelInventoryFailure(error);
      expect(failure).toMatchObject({ code: "insufficient_balance", httpStatus: 403 });
      expect(failure.message).toContain("余额不足");
      expect(JSON.stringify(modelInventoryFailureConfig(failure))).not.toContain("private-token");
      expect(modelInventoryFailure(undefined, Response.json([], { status: 502, headers: modelInventoryFailureHeaders(failure) }))).toEqual(failure);
      expect(() => assertCompleteModelInventoryPayload({ ...responseBody, data: [] })).toThrow("余额不足");
    });
  it.each([{ data: [] }, { models: [] }, [], { data: [], models: [{ id: "new" }] },
    { data: [{ id: "model" }], has_more: false }, { models: [{ name: "models/gemini" }] },
    { items: [{ id: "model" }] }, { result: [{ id: "model" }] }, { data: { model: { name: "Model" } } },
    { models: {} }, { data: [{ id: "one" }], models: [{ id: "two" }], total: 2 }])("accepts a confirmed complete model list: %j", payload => {
    expect(() => assertCompleteModelInventoryPayload(payload)).not.toThrow();
  });
  it.each([{}, null, { success: false, data: [] }, { error: { message: "private-token-must-not-echo" }, data: [] },
    { data: [null] }, { data: [{ price: 1 }] }, { data: ["model-id"] }, { data: [{ id: "", name: "ignored-by-parser" }] },
    { data: [{ id: 123, name: "ignored-by-parser" }] }, { data: { model: "ignored-by-parser" } },
    { data: [], models: [{ id: null }] }])("never turns a malformed/error payload into an empty inventory: %j", payload => {
    expect(() => assertCompleteModelInventoryPayload(payload)).toThrow(ModelInventoryReadError);
  });
  it.each([{ has_more: true }, { nextPageToken: "next" }, { next_cursor: "next" }, { pagination: { total: 2 } }, { complete: false }])("rejects incomplete pagination: %j", pagination => {
    try { assertCompleteModelInventoryPayload({ data: [{ id: "one" }], ...pagination }); }
    catch (error) { expect(modelInventoryFailure(error)).toMatchObject({ code: "incomplete_directory", httpStatus: 200 }); return; }
    throw Error("incomplete directory accepted");
  });
  it.each([{ has_more: "true" }, { hasMore: 1 }, { has_more: "1" }, { complete: "false" },
    { complete: 0 }, { meta: { total: "100" } }])("rejects strictly encoded incomplete pagination: %j", pagination => {
    expect(() => assertCompleteModelInventoryPayload({ data: [{ id: "one" }], ...pagination }))
      .toThrow("未完整返回");
  });
  it.each([{ has_more: "false" }, { complete: "true" }, { has_more: "0", total: "1" }])("does not use truthiness for pagination: %j", pagination => {
    expect(() => assertCompleteModelInventoryPayload({ data: [{ id: "one" }], ...pagination })).not.toThrow();
  });
  it("fails closed on malformed pagination values without interpreting them as true", () => {
    expect(() => assertCompleteModelInventoryPayload({ data: [{ id: "one" }], complete: "not-a-boolean", total: "not-a-number" }))
      .toThrow("格式无效");
  });
  it.each([{ code: "401", expected: "invalid_credentials" }, { code: "403", expected: "permission_denied" }])(
    "recognizes HTTP 200 with a strict string error code $code", ({code, expected}) => {
      try { assertCompleteModelInventoryPayload({ code, data: [], message: "private-token-must-not-echo" }); }
      catch (error) { expect(modelInventoryFailure(error)).toMatchObject({ code: expected, httpStatus: 200 }); return; }
      throw Error("error response accepted");
    });
  it.each([{ code: 0 }, { code: "200" }, { code: "success" }, { code: "OK" }])("accepts an explicit successful application code: %j", code => {
    expect(() => assertCompleteModelInventoryPayload({ data: [], ...code })).not.toThrow();
  });
  it.each([{ success: "false" }, { code: "error" }])("rejects application failure without an error object: %j", error => {
    expect(() => assertCompleteModelInventoryPayload({ data: [], ...error })).toThrow("格式无效");
  });
  it.each(["unauthorized", "failed", "stale", "partial", "unconfigured"])("rejects HTTP 200 with %s as a current directory", status => {
    expect(isCompleteModelInventoryResponse(Response.json([], { headers: { "X-Model-Scan-Status": status } }), [])).toBe(false);
  });
  it.each(["saved", "snapshot", "manual"])("does not count %s arrays as newly fetched models", source => {
    expect(isCompleteModelInventoryResponse(Response.json([], { headers: { "X-Model-Scan-Source": source } }), [])).toBe(false);
  });
  it("requires completeness and distinguishes a confirmed empty response", () => {
    expect(isCompleteModelInventoryResponse(Response.json([], { headers: { "X-Model-Scan-Complete": "false" } }), [])).toBe(false);
    expect(isCompleteModelInventoryResponse(Response.json([], { headers: { "X-Model-Scan-Status": "empty" } }), [])).toBe(true);
  });
  it.each([{ status: 401, code: "invalid_credentials" }, { status: 403, code: "permission_denied" },
    { status: 429, code: "rate_limited" }, { status: 502, code: "directory_unavailable" }])("keeps HTTP $status without retaining upstream text", ({status, code}) => {
    const error = new ProviderHttpError("private-token-must-not-echo", { kind: "provider", phase: "connect", retryable: false,
      submissionMayHaveOccurred: false, status, responseBody: { apiKey: "private-token-must-not-echo" } });
    const failure = modelInventoryFailure(error);
    expect(failure).toMatchObject({ code, httpStatus: status });
    expect(JSON.stringify(modelInventoryFailureConfig(failure))).not.toContain("private-token");
    expect(modelInventoryFailure(undefined, Response.json([], { headers: modelInventoryFailureHeaders(failure) }))).toEqual(failure);
  });
  it("does not mistake a local 502 envelope for an upstream HTTP status on a network failure", () => {
    const failure = modelInventoryFailure(new Error("private-cause"));
    const envelope = Response.json({}, { status: 502, headers: modelInventoryFailureHeaders(failure) });
    expect(modelInventoryFailure(undefined, envelope)).toEqual(failure);
    expect(modelInventoryFailureConfig(failure).modelScanHttpStatus).toBeNull();
  });
});
