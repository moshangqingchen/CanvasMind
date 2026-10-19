import { describe, expect, it, vi } from "vitest";
import { probeReferenceOriginal } from "./reference-original-probe.server.js";

const original = { id: "opaque-original", mimeType: "image/png", data: new Uint8Array([1, 2, 3, 255]) };
const url = "https://cdn.test/original.png?signature=private-signature";
const response = (bytes = original.data, mime = "image/png") => new Response(new Uint8Array(bytes), { headers: { "content-type": mime } });

describe("shared original URL verification", () => {
  it("reads the exact HTTPS URL without credentials and compares the complete original", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    expect(await probeReferenceOriginal(url, original, 0, { fetch })).toMatchObject({ code: "ok", actualBytes: 4, expectedBytes: 4, attempts: 1 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual([url, { method: "GET", redirect: "error", signal: expect.any(AbortSignal), cache: "no-store",
      credentials: "omit", referrerPolicy: "no-referrer" }]);
  });
  it.each([
    { response: () => new Response("missing", { status: 404 }), code: "http" },
    { response: () => response(original.data, "text/html"), code: "mime" },
    { response: () => response(original.data, "text/plain"), code: "mime" },
    { response: () => response(new Uint8Array([9, 2, 3, 255])), code: "hash" },
    { response: () => response(new Uint8Array([1, 2, 3])), code: "length" },
    { response: () => new Response(original.data, { headers: { "content-type": "image/png", "content-length": "10" } }), code: "length" },
  ])("rejects $code delivery errors", async sample => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => sample.response());
    expect(await probeReferenceOriginal(url, original, 0, { fetch, attempts: 1, strictMime: false })).toMatchObject({ code: sample.code });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["application/octet-stream", "binary/octet-stream", "image/jpg"])("accepts exact original bytes under %s while keeping private-channel MIME strict", async actualMime => {
    for (const strictMime of [true, false]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => response(original.data, actualMime));
      expect(await probeReferenceOriginal(url, original, 0, { fetch, strictMime })).toMatchObject({ code: strictMime ? "mime" : "ok", actualMime });
    }
    expect(await probeReferenceOriginal(url, original, 0, { fetch: async () => response(new Uint8Array([9, 2, 3, 255]), actualMime), strictMime: false })).toMatchObject({ code: "hash", actualMime });
  });
  it.each(["text/html", "text/plain", "text/xml", "text/css"])("rejects %s before reading a native response body, preserving its actual MIME", async actualMime => {
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-type": actualMime } }));
    expect(await probeReferenceOriginal(url, original, 0, { fetch, attempts: 1, strictMime: false })).toMatchObject({ code: "mime", actualMime });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([
    { bytes: original.data, code: "ok" },
    { bytes: new Uint8Array([9, 2, 3, 255]), code: "hash" },
    { bytes: new Uint8Array([1, 2, 3]), code: "length" },
  ])("checks decompressed stream bytes instead of encoded content-length: $code", async sample => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(sample.bytes, { headers: {
      "content-type": "binary/octet-stream", "content-encoding": "gzip", "content-length": "24",
    } }));
    expect(await probeReferenceOriginal(url, original, 0, { fetch, attempts: 1, strictMime: false })).toMatchObject({
      code: sample.code, actualMime: "binary/octet-stream", actualBytes: sample.bytes.byteLength,
    });
  });
  it("follows five safe HTTPS redirects with no credentials or referrer on any GET", async () => {
    const statuses = [301, 302, 303, 307, 308];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_target, init) => {
      expect(init?.redirect).toBe("manual");
      expect(init?.credentials).toBe("omit"); expect(init?.referrerPolicy).toBe("no-referrer");
      expect([...new Headers(init?.headers)]).toEqual([]);
      const status = statuses.shift();
      return status ? new Response(null, { status, headers: { location: `https://store.test/hop-${statuses.length}`,
        "set-cookie": "fixture-private-cookie=never-forward" } }) : response();
    });
    expect(await probeReferenceOriginal(url, original, 0, { fetch, attempts: 1, followRedirects: true })).toMatchObject({ code: "ok", attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(fetch.mock.calls[5]?.[0]).toBe("https://store.test/hop-0");
  });
  it("resolves a relative redirect without losing the final byte checks", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/original-storage.png" } })).mockResolvedValueOnce(response());
    expect(await probeReferenceOriginal(url, original, 0, { fetch, followRedirects: true })).toMatchObject({ code: "ok" });
    expect(fetch.mock.calls[1]?.[0]).toBe("https://cdn.test/original-storage.png");
  });
  it.each(["http://store.test/original", "https://127.0.0.1/original", "https://[::1]/original", "https://user:secret@store.test/original"])("never fetches an unsafe redirect target %s", async location => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 302, headers: { location } }));
    expect(await probeReferenceOriginal(url, original, 0, { fetch, attempts: 1, followRedirects: true })).not.toMatchObject({ code: "ok" });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("stops after five redirects and keeps private-channel redirect:error", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 302, headers: { location: "https://store.test/again" } }));
    expect(await probeReferenceOriginal(url, original, 0, { fetch, attempts: 1, followRedirects: true })).toMatchObject({ code: "http", httpStatus: 302 });
    expect(fetch).toHaveBeenCalledTimes(6);
    fetch.mockClear();
    expect(await probeReferenceOriginal(url, original, 0, { fetch, attempts: 1, strictMime: true })).toMatchObject({ code: "http", httpStatus: 302 });
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
  it.each(["http://cdn.test/a.png", "https://user:password@cdn.test/a.png", "https://cdn.test/a.png#fragment"])("rejects invalid delivery URL %s before GET", async target => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await probeReferenceOriginal(target, original, 0, { fetch })).toMatchObject({ code: "url", attempts: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a private network destination before GET", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await probeReferenceOriginal("https://127.0.0.1/private", original, 0, { fetch, attempts: 1 })).toMatchObject({ code: "network" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds a stalled body and redacts complete signed URLs from diagnostics", async () => {
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel }), { headers: { "content-type": "image/png" } }));
    const diagnostic = await probeReferenceOriginal(url, original, 0, { fetch, timeoutMs: 10, attempts: 1 });
    expect(diagnostic).toMatchObject({ code: "timeout", actualBytes: 1 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.stringify(diagnostic)).not.toContain("private-signature");
    expect(JSON.stringify(diagnostic)).not.toContain(original.id);
  });
});
