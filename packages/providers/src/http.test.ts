import { describe, expect, it, vi } from "vitest";

import {
  fetchProviderBytes,
  fetchProviderJson,
  ProviderHttpError,
} from "./http";

describe("provider HTTP submission safety", () => {
  it("distinguishes pre-connect failures from ambiguous disconnects", async () => {
    const dnsFailure = Object.assign(new Error("DNS failed"), {
      code: "ENOTFOUND",
    });
    await expect(
      fetchProviderJson(
        async () => Promise.reject(dnsFailure),
        "https://provider.test/generate",
        { method: "POST" },
        { phase: "submit" },
      ),
    ).rejects.toMatchObject({
      details: { submissionMayHaveOccurred: false, retryable: true },
    });

    const nestedConnectTimeout = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect timed out"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    });
    await expect(
      fetchProviderJson(
        async () => Promise.reject(nestedConnectTimeout),
        "https://provider.test/generate",
        { method: "POST" },
        { phase: "submit" },
      ),
    ).rejects.toMatchObject({
      details: { submissionMayHaveOccurred: false, retryable: true },
    });

    const reset = Object.assign(new Error("socket reset"), {
      code: "ECONNRESET",
    });
    await expect(
      fetchProviderJson(
        async () => Promise.reject(reset),
        "https://provider.test/generate",
        { method: "POST" },
        { phase: "submit" },
      ),
    ).rejects.toMatchObject({
      details: { submissionMayHaveOccurred: true },
    });
  });

  it("treats a lost successful response body as an ambiguous paid submit", async () => {
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => Promise.reject(new Error("stream disconnected")),
    } as unknown as Response;

    try {
      await fetchProviderJson(
        async () => response,
        "https://provider.test/generate",
        { method: "POST" },
        { phase: "submit" },
      );
      throw new Error("Expected fetchProviderJson to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect(error).toMatchObject({
        details: { submissionMayHaveOccurred: true, retryable: false },
      });
    }
  });

  it("blocks local, private, and cloud metadata endpoints before fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const url of [
      "http://127.0.0.1:8080/generate",
      "http://localhost:8080/generate",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]:8080/generate",
      "https://metadata.google.internal/computeMetadata/v1",
    ]) {
      await expect(
        fetchProviderJson(fetchImpl, url, {}, { phase: "connect" }),
      ).rejects.toMatchObject({
        details: {
          kind: "invalid_request",
          retryable: false,
          submissionMayHaveOccurred: false,
        },
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows only an explicitly opted-in exact loopback gateway", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      fetchProviderJson(
        fetchImpl,
        "http://localhost:18082/v1/models",
        {},
        { phase: "connect", allowLoopback: true },
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      fetchProviderJson(
        fetchImpl,
        "http://10.0.0.8/v1/models",
        {},
        { phase: "connect", allowLoopback: true },
      ),
    ).rejects.toMatchObject({ details: { kind: "invalid_request" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps provider.test mocks working and disables redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchProviderJson(
        fetchImpl,
        "https://provider.test/generate",
        { method: "POST", redirect: "follow" },
        { phase: "submit" },
      ),
    ).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://provider.test/generate",
      expect.objectContaining({ redirect: "error", method: "POST" }),
    );
  });

  it("limits JSON and binary response bodies", async () => {
    await expect(
      fetchProviderJson(
        async () =>
          new Response(JSON.stringify({ value: "1234567890" }), {
            headers: { "content-type": "application/json" },
          }),
        "https://provider.test/generate",
        {},
        { phase: "poll", maxResponseBytes: 8 },
      ),
    ).rejects.toMatchObject({ details: { kind: "invalid_response" } });

    await expect(
      fetchProviderBytes(
        async () =>
          new Response(new Uint8Array(32), {
            headers: { "content-type": "image/png" },
          }),
        "https://provider.test/output.png",
        { phase: "archive", maxResponseBytes: 16 },
      ),
    ).rejects.toMatchObject({ details: { kind: "invalid_response" } });
  });
});
