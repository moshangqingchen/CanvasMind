import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup }));

import { fetchProviderBytes, fetchProviderJson, withProviderSubmissionProgress } from "./http.js";

describe("provider request deadlines and cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dns.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });
  afterEach(() => vi.useRealTimers());

  it.each(["ff02::1", "fec0::1", "::2", "2001:0db8::1"])("rejects a non-public IPv6 provider destination %s", async address => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    await expect(fetchProviderJson(fetch, `http://[${address}]/generate`, { method: "POST" }, { phase: "submit" }))
      .rejects.toMatchObject({ details: { kind: "invalid_request", submissionMayHaveOccurred: false } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a public IPv6 provider endpoint usable", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    await expect(fetchProviderJson(fetch, "https://[2606:4700:4700::1111]/generate", { method: "POST" }, { phase: "submit" }))
      .resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["json", "binary"])("bounds stalled DNS before a %s request is sent", async kind => {
    dns.lookup.mockImplementation(() => new Promise(() => {}));
    const fetch = vi.fn();
    const options = { phase: "submit" as const, timeoutMs: 25 };
    const request = kind === "json"
      ? fetchProviderJson(fetch, "https://provider.example/generate", { method: "POST" }, options)
      : fetchProviderBytes(fetch, "https://provider.example/reference.png", options);
    const result = request.catch(error => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({
      details: { kind: "timeout", retryable: true, submissionMayHaveOccurred: false },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["json", "binary"])("does not resolve DNS for an already cancelled %s request", async kind => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();
    const options = { phase: "submit" as const, signal: controller.signal };
    const request = kind === "json"
      ? fetchProviderJson(fetch, "https://provider.example/generate", {}, options)
      : fetchProviderBytes(fetch, "https://provider.example/reference.png", options);
    await expect(request).rejects.toMatchObject({
      details: { kind: "network", retryable: false, submissionMayHaveOccurred: false },
    });
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a DNS wait immediately and observes a late DNS failure", async () => {
    let failDns!: (error: Error) => void;
    dns.lookup.mockImplementation(() => new Promise((_resolve, reject) => { failDns = reject; }));
    const controller = new AbortController();
    const fetch = vi.fn();
    const result = fetchProviderJson(fetch, "https://provider.example/generate", {},
      { phase: "submit", signal: controller.signal, timeoutMs: 0 }).catch(error => error);
    controller.abort();
    expect(await result).toMatchObject({ details: { retryable: false, submissionMayHaveOccurred: false } });
    failDns(new Error("late resolver error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("counts DNS time against the response deadline", async () => {
    dns.lookup.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve([{ address: "93.184.216.34", family: 4 }]), 20);
    }));
    const fetch = vi.fn(async () => new Promise<Response>(() => {}));
    const result = fetchProviderJson(fetch, "https://provider.example/generate", { method: "POST" },
      { phase: "submit", timeoutMs: 25 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ details: { kind: "timeout", retryable: false, submissionMayHaveOccurred: true } });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["json", "binary"])("cancels a stalled %s response stream at the deadline", async kind => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetch = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); },
      cancel,
    }), { headers: { "content-type": "application/json" } }));
    const options = { phase: "poll" as const, timeoutMs: 25 };
    const request = kind === "json"
      ? fetchProviderJson(fetch, "https://provider.test/result", {}, options)
      : fetchProviderBytes(fetch, "https://provider.test/reference.png", options);
    const result = request.catch(error => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ details: { kind: "timeout", transport: { stage: "reading_body", responseBytes: 8 } } });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("inherits run cancellation while downloading a reference image", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel })));
    const result = withProviderSubmissionProgress(async () => {}, () =>
      fetchProviderBytes(fetch, "https://provider.test/reference.png", { phase: "archive", timeoutMs: 0 }),
      controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toMatchObject({ details: { kind: "network", retryable: false, submissionMayHaveOccurred: false } });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("releases a custom transport response that arrives after cancellation", async () => {
    const controller = new AbortController();
    let deliver!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; }));
    const result = fetchProviderJson(fetch, "https://provider.test/generate", { method: "POST" },
      { phase: "submit", timeoutMs: 0, signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toMatchObject({ details: { retryable: false, submissionMayHaveOccurred: true } });
    const cancel = vi.fn();
    deliver(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reports a binary HTTP error without waiting for a stalled stream cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 503 }));
    await expect(fetchProviderBytes(fetch, "https://provider.test/reference.png", { phase: "archive", timeoutMs: 10 }))
      .rejects.toMatchObject({ details: { kind: "provider", status: 503, retryable: true, submissionMayHaveOccurred: false } });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not submit after cancellation while the waiting progress update is in flight", async () => {
    const controller = new AbortController();
    let releaseProgress!: () => void;
    const progress = vi.fn(() => new Promise<void>(resolve => { releaseProgress = resolve; }));
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const result = withProviderSubmissionProgress(progress, () =>
      fetchProviderJson(fetch, "https://provider.test/generate", { method: "POST" }, { phase: "submit", timeoutMs: 0 }),
      controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(progress).toHaveBeenCalledWith("waiting_provider");
    controller.abort();
    expect(await result).toMatchObject({ details: { kind: "network", retryable: false, submissionMayHaveOccurred: false } });
    releaseProgress();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("expires a stalled waiting progress update before starting a paid request", async () => {
    const fetch = vi.fn();
    const result = withProviderSubmissionProgress(() => new Promise<void>(() => {}), () =>
      fetchProviderJson(fetch, "https://provider.test/generate", { method: "POST" }, { phase: "submit", timeoutMs: 25 }))
      .catch(error => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ details: { kind: "timeout", retryable: true, submissionMayHaveOccurred: false } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["reject", "stall"])("releases the response when the receiving progress update fails: %s", async mode => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel })));
    const result = withProviderSubmissionProgress(async phase => {
      if (phase !== "receiving") return;
      if (mode === "reject") throw new Error("Progress storage unavailable");
      await new Promise<void>(() => {});
    }, () => fetchProviderJson(fetch, "https://provider.test/generate", { method: "POST" }, { phase: "submit", timeoutMs: 25 }))
      .catch(error => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ details: { kind: mode === "reject" ? "network" : "timeout", retryable: false, submissionMayHaveOccurred: true } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
