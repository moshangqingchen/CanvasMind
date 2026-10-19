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
    expect(fetch.mock.calls[0]).toEqual([url, { method: "GET", redirect: "error", signal: expect.any(AbortSignal), cache: "no-store" }]);
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
  it("accepts octet-stream only with matching length and SHA-256, keeping private-channel MIME strict", async () => {
    for (const strictMime of [true, false]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => response(original.data, "application/octet-stream"));
      expect(await probeReferenceOriginal(url, original, 0, { fetch, strictMime })).toMatchObject({ code: strictMime ? "mime" : "ok" });
    }
    expect(await probeReferenceOriginal(url, original, 0, { fetch: async () => response(new Uint8Array([9, 2, 3, 255]), "application/octet-stream"), strictMime: false })).toMatchObject({ code: "hash" });
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
