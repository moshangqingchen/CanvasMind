import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), localFetch: vi.fn(), hasProxy: vi.fn() }));
vi.mock("@super-canvas/providers", async importOriginal => ({ ...await importOriginal<object>(), providerFetch: mocks.fetch, hasProviderHttpProxy: mocks.hasProxy }));
import { verifyProviderAssetToken } from "@super-canvas/providers";
import { LocalReferenceChannelError, localReferenceChannel, localReferenceChannelConfigured, localReferenceUrls } from "../src/reference-channel.js";
let root: string; let path: string;
const fixtureParent = join(realpathSync(fileURLToPath(new URL("../../../", import.meta.url))), ".codex-temp");
const bytes = (text: string) => new TextEncoder().encode(text);
const original = (id: string, text = "original-file") => ({ id, mimeType: "image/png", data: bytes(text) });
const references = [original("reference-1"), original("reference-2", "second-original")];
const pathname = (url: string) => new URL(url).pathname;
const assetResponse = (data: Uint8Array, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(data).buffer, { headers: { "content-type": "image/png", ...headers } });
function routeAssets(reply: (url: string) => Response | Promise<Response>) {
  mocks.fetch.mockImplementation(async (url: string) => pathname(url).endsWith("/_health") ? new Response("desktop-instance") : reply(url));
}
const getUrls = (assets = references) => localReferenceUrls(assets.map(asset => asset.id), assets);

beforeEach(() => {
  mkdirSync(fixtureParent, { recursive: true });
  if (realpathSync(fixtureParent) !== fixtureParent) throw new Error("Channel test directory must stay in the workspace");
  root = mkdtempSync(join(fixtureParent, "supercanvas-channel-test-")); path = join(root, "state.json");
  vi.stubEnv("SUPERCANVAS_DESKTOP", "true"); vi.stubEnv("SUPERCANVAS_REFERENCE_CHANNEL_FILE", path); vi.stubEnv("MASTER_KEY", "isolated-test-key");
  vi.stubEnv("SUPERCANVAS_DESKTOP_TOKEN", "private-desktop-test-token");
  vi.stubGlobal("fetch", mocks.localFetch);
  mocks.fetch.mockReset();
  mocks.localFetch.mockReset(); mocks.hasProxy.mockReset().mockReturnValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  if (dirname(realpathSync(root)) !== fixtureParent) throw new Error("Invalid channel test fixture directory");
  rmSync(root, { recursive: true, force: true }); });
const save = (extra = {}) => writeFileSync(path, JSON.stringify({ enabled: true, ready: true, baseUrl: "https://assets.example.test", updatedAt: Date.now(), instance: "desktop-instance", ...extra }));

describe("local reference channel", () => {
  it("keeps an offline configured channel distinct from opting out", async () => {
    save({ ready: false });
    expect(localReferenceChannelConfigured()).toBe(true);
    await expect(getUrls()).rejects.toThrow("当前生成尚未提交");
    expect(mocks.fetch).not.toHaveBeenCalled();
    save({ enabled: false }); expect(localReferenceChannelConfigured()).toBe(false);
  });
  it("rejects disabled, stale, non-HTTPS or unready channels", () => {
    for (const extra of [{ enabled: false }, { ready: false }, { updatedAt: Date.now() - 100_000 }, { baseUrl: "http://assets.example.test" }]) { save(extra); expect(localReferenceChannel()).toBeNull(); }
  });
  it("returns only the same one-hour URLs whose complete original bytes were read, preserving order", async () => {
    save();
    routeAssets(url => {
      const asset = references.find(item => pathname(url).endsWith(`/${item.id}`))!;
      return assetResponse(asset.data, { "content-type": "IMAGE/PNG; charset=binary", "content-length": String(asset.data.length) });
    });
    const urls = await getUrls();
    expect(urls).toHaveLength(2);
    // Original files are probed concurrently; their verification may start in
    // either order. The returned URLs below must still match input role order.
    expect(mocks.fetch.mock.calls.slice(1).map(call => call[0]).sort()).toEqual([...urls].sort());
    for (let index = 0; index < urls.length; index++) {
      const url = new URL(urls[index]!);
      expect(url.pathname).toBe(`/api/provider-assets/${references[index]!.id}`);
      const token = url.searchParams.get("token")!;
      expect(verifyProviderAssetToken({ token, assetId: references[index]!.id, secret: "isolated-test-key" })).toBe(true);
      expect(Number(token.split(".")[0]) - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(3599);
    }
    expect(pathname(mocks.fetch.mock.calls[0]![0])).toBe("/api/provider-assets/_health");
    for (const [, options] of mocks.fetch.mock.calls) {
      expect(options).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
      expect(options.headers).toBeUndefined();
    }
  });
  it("fails closed if the tunnel points at an old instance", async () => {
    save(); mocks.fetch.mockResolvedValue(new Response("old-instance"));
    const error = await getUrls().catch(error => error) as LocalReferenceChannelError;
    expect(error.message).toContain("当前生成尚未提交");
    expect(error.diagnostics).toMatchObject([{ assetIndex: 0, code: "length", attempts: 1, durationMs: expect.any(Number) }]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("reuses one verified original URL for repeated role entries", async () => {
    save(); routeAssets(() => assetResponse(references[0]!.data));
    const urls = await getUrls([references[0]!, references[0]!]);
    expect(urls).toHaveLength(2); expect(urls[0]).toBe(urls[1]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2); // one health GET and one original GET
    expect(mocks.fetch.mock.calls[1]![0]).toBe(urls[0]);
  });
  it("checks every requested original, with at most two concurrent full streaming reads", async () => {
    save();
    const assets = Array.from({ length: 4 }, (_, index) => original(`reference-${index}`, `original-${index}`));
    let active = 0; let peak = 0;
    routeAssets(url => {
      const asset = assets.find(item => pathname(url).endsWith(`/${item.id}`))!;
      active++; peak = Math.max(peak, active);
      return new Response(new ReadableStream<Uint8Array>({ async start(controller) {
        await new Promise(resolve => setTimeout(resolve, 5)); controller.enqueue(asset.data.slice(0, 3));
        await new Promise(resolve => setTimeout(resolve, 5)); controller.enqueue(asset.data.slice(3)); active--; controller.close();
      } }), { headers: { "content-type": asset.mimeType } });
    });
    const urls = await getUrls(assets);
    expect(urls).toHaveLength(4); expect(peak).toBe(2); expect(active).toBe(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
  });
  it.each([
    ["http", () => new Response("denied", { status: 403 })],
    ["http", () => new Response("part", { status: 206, headers: { "content-type": "image/png", "content-range": "bytes 0-3/30" } })],
    ["mime", () => new Response("login or firewall page", { headers: { "content-type": "text/html" } })],
    ["length", () => assetResponse(bytes("short"))],
    ["length", () => assetResponse(references[0]!.data, { "content-length": "1" })],
    ["length", () => assetResponse(bytes("original-file-extra"))],
    ["hash", () => assetResponse(bytes("corrupt!-file"))],
  ])("blocks %s failures even when the instance health probe succeeds", async (code, response) => {
    save(); routeAssets(() => response());
    const error = await getUrls([references[0]!]).catch(error => error) as LocalReferenceChannelError;
    expect(error).toBeInstanceOf(LocalReferenceChannelError);
    expect(error).toMatchObject({ source: "local_validation", code: "LOCAL_REFERENCE_ASSET_PREFLIGHT_FAILED", diagnostics: [{ code, assetIndex: 1, attempts: 1 }] });
    expect(error.message).toContain("当前生成尚未提交");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects a missing original instead of accepting a URL-only health check", async () => {
    save(); routeAssets(() => assetResponse(bytes("anything")));
    const error = await localReferenceUrls(["missing"], []).catch(error => error) as LocalReferenceChannelError;
    expect(error.diagnostics).toMatchObject([{ code: "missing_original", attempts: 0 }]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("retries only a failed free GET and verifies the exact same URL", async () => {
    save(); let attempts = 0;
    routeAssets(() => {
      if (++attempts === 1) throw new Error("connection was interrupted");
      return assetResponse(references[0]!.data);
    });
    const urls = await getUrls([references[0]!]);
    expect(attempts).toBe(2);
    expect(mocks.fetch.mock.calls.slice(1).map(call => call[0])).toEqual([urls[0], urls[0]]);
  });
  it("retries transient HTTP failures but never regenerates the signature", async () => {
    save(); let attempts = 0;
    routeAssets(() => ++attempts === 1 ? new Response("Cloudflare origin timeout", { status: 522 }) : assetResponse(references[0]!.data));
    await getUrls([references[0]!]); expect(attempts).toBe(2);
    expect(mocks.fetch.mock.calls[1]![0]).toBe(mocks.fetch.mock.calls[2]![0]);
  });
  it("bounds interrupted reads to two attempts and never exposes URLs, tokens or raw exception text", async () => {
    save(); const secretId = "private-filename-token";
    routeAssets(url => new Response(new ReadableStream({ start(controller) { controller.error(new Error(`secret failure ${url}`)); } }),
      { headers: { "content-type": "image/png" } }));
    const error = await getUrls([original(secretId)]).catch(error => error) as LocalReferenceChannelError;
    expect(error.diagnostics).toMatchObject([{ assetIndex: 1, code: "network", attempts: 2, durationMs: expect.any(Number) }]);
    expect(error.diagnostics[0]!.durationMs).toBeGreaterThanOrEqual(200);
    const exposed = error.message + JSON.stringify(error);
    for (const value of [secretId, "https://", "token=", "isolated-test-key", "secret failure"]) expect(exposed).not.toContain(value);
    expect(error.diagnostics[0]!.assetReference).toMatch(/^[a-f0-9]{12}$/u);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it("applies an asset timeout through the full body read", async () => {
    save(); const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const controllers: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      if (milliseconds !== 60_000) return originalTimeout(milliseconds);
      const controller = new AbortController(); controllers.push(controller); return controller.signal;
    });
    const cancel = vi.fn();
    routeAssets(() => new Response(new ReadableStream({
      // Expire only once the reader requests body bytes, not while DNS or the
      // event loop happens to be slow. A zero buffer prevents eager pulls.
      pull() { controllers.at(-1)!.abort(); }, cancel,
    }, { highWaterMark: 0 }), { headers: { "content-type": "image/png" } }));
    const error = await getUrls([references[0]!]).catch(error => error) as LocalReferenceChannelError;
    expect(error.diagnostics).toMatchObject([{ code: "timeout", attempts: 2 }]);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(controllers).toHaveLength(2);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it("retains diagnostics for every asset, including successful peers", async () => {
    save(); routeAssets(url => pathname(url).endsWith("/reference-1") ? assetResponse(references[0]!.data) : new Response("denied", { status: 401 }));
    const error = await getUrls().catch(error => error) as LocalReferenceChannelError;
    expect(error.diagnostics).toMatchObject([{ assetIndex: 1, code: "ok" }, { assetIndex: 2, code: "http", httpStatus: 401 }]);
    expect(error.message).toContain("第 2 项素材");
  });
});

describe("desktop public-reference probe relay", () => {
  const serveRelay = (reply: (url: string) => Response | Promise<Response>) => {
    mocks.localFetch.mockImplementation(async (url: string) => pathname(url).endsWith("/_health") ? new Response("desktop-instance") : reply(url));
  };

  it("authenticates health and all four original GETs on loopback, returning the exact HTTPS signatures in order", async () => {
    save({ desktopPublicProbe: true });
    const assets = Array.from({ length: 4 }, (_, index) => original(`reference-${index}`, `original-${index}`));
    serveRelay(url => assetResponse(assets.find(asset => pathname(url).endsWith(`/${asset.id}`))!.data));
    const urls = await getUrls(assets);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.localFetch).toHaveBeenCalledTimes(5);
    expect(pathname(mocks.localFetch.mock.calls[0]![0])).toBe("/api/reference-channel-probe/_health");
    expect(urls.map(pathname)).toEqual(assets.map(asset => `/api/provider-assets/${asset.id}`));
    expect(mocks.localFetch.mock.calls.slice(1).map(([url]) => pathname(url)).sort())
      .toEqual(assets.map(asset => `/api/reference-channel-probe/${asset.id}`).sort());
    for (let index = 0; index < mocks.localFetch.mock.calls.length; index++) {
      const [rawUrl, init] = mocks.localFetch.mock.calls[index]!;
      const relay = new URL(rawUrl);
      expect(relay.origin).toBe("http://127.0.0.1:3210");
      expect(relay.searchParams.size).toBe(1);
      expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store",
        headers: { "x-supercanvas-desktop-token": "private-desktop-test-token" } });
      expect(Object.keys(init.headers)).toEqual(["x-supercanvas-desktop-token"]);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const assetId = relay.pathname.split("/").at(-1)!;
      const token = relay.searchParams.get("token")!;
      expect(verifyProviderAssetToken({ token, assetId, secret: "isolated-test-key" })).toBe(true);
      if (index > 0) {
        const submitted = new URL(urls[assets.findIndex(asset => asset.id === assetId)]!);
        expect(submitted.origin).toBe("https://assets.example.test");
        expect(submitted.pathname).toBe(`/api/provider-assets/${assetId}`);
        expect(submitted.search).toBe(relay.search);
        expect(submitted.href).not.toContain("private-desktop-test-token");
        expect(Number(token.split(".")[0]) - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(3599);
      }
    }
  });

  it.each([undefined, false])("preserves the original provider transport for legacy state desktopPublicProbe=%s", async desktopPublicProbe => {
    save({ desktopPublicProbe }); vi.stubEnv("SUPERCANVAS_DESKTOP_TOKEN", "");
    routeAssets(() => assetResponse(references[0]!.data));
    await getUrls([references[0]!]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.localFetch).not.toHaveBeenCalled();
    expect(mocks.hasProxy).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.every(([url]) => new URL(url).origin === "https://assets.example.test")).toBe(true);
  });

  it("keeps an explicitly configured provider proxy authoritative, without needing relay credentials", async () => {
    save({ desktopPublicProbe: true }); mocks.hasProxy.mockReturnValue(true);
    vi.stubEnv("SUPERCANVAS_DESKTOP_TOKEN", "");
    routeAssets(() => assetResponse(references[0]!.data));
    const urls = await getUrls([references[0]!]);
    expect(mocks.hasProxy).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1]![0]).toBe(urls[0]);
    expect(mocks.localFetch).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.every(([, init]) => init.headers === undefined)).toBe(true);
  });

  it("fails locally when the advertised relay lacks its private credential, without falling back", async () => {
    save({ desktopPublicProbe: true }); vi.stubEnv("SUPERCANVAS_DESKTOP_TOKEN", "");
    const error = await getUrls().catch(error => error) as LocalReferenceChannelError;
    expect(error).toBeInstanceOf(LocalReferenceChannelError);
    expect(error.message).toContain("桌面私有鉴权凭据缺失");
    expect(error.source).toBe("local_validation");
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.localFetch).not.toHaveBeenCalled();
  });

  it("does not use the relay to bypass an invalid explicit proxy", async () => {
    save({ desktopPublicProbe: true }); mocks.hasProxy.mockImplementation(() => { throw new Error("proxy credentials must stay private"); });
    const error = await getUrls().catch(error => error) as LocalReferenceChannelError;
    expect(error.message).toContain("供应商 HTTP 代理无效");
    expect(error.message).not.toContain("credentials");
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.localFetch).not.toHaveBeenCalled();
  });

  it("fails closed when the relay refuses the authenticated health check", async () => {
    save({ desktopPublicProbe: true }); mocks.localFetch.mockResolvedValue(new Response("denied", { status: 403 }));
    const error = await getUrls().catch(error => error) as LocalReferenceChannelError;
    expect(error.diagnostics).toMatchObject([{ assetIndex: 0, code: "http", httpStatus: 403, attempts: 1 }]);
    expect(mocks.localFetch).toHaveBeenCalledTimes(1); expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("retries a relay network failure on the same private URL only and redacts its credentials", async () => {
    save({ desktopPublicProbe: true });
    mocks.localFetch.mockImplementation(async (url: string, init: RequestInit) => {
      throw new Error(`failed ${url} ${JSON.stringify(init.headers)}`);
    });
    const error = await getUrls().catch(error => error) as LocalReferenceChannelError;
    expect(error.diagnostics).toMatchObject([{ assetIndex: 0, code: "network", attempts: 2 }]);
    expect(mocks.localFetch).toHaveBeenCalledTimes(2);
    expect(mocks.localFetch.mock.calls[0]![0]).toBe(mocks.localFetch.mock.calls[1]![0]);
    expect(mocks.fetch).not.toHaveBeenCalled();
    const exposed = error.message + JSON.stringify(error);
    for (const privateValue of ["token=", "private-desktop-test-token", "isolated-test-key", "127.0.0.1", "https://"]) expect(exposed).not.toContain(privateValue);
  });

  it("does not bypass a relay asset failure after the real public health check succeeds", async () => {
    save({ desktopPublicProbe: true });
    serveRelay(url => pathname(url).endsWith("/reference-1") ? assetResponse(references[0]!.data) : new Response("not available", { status: 503 }));
    const error = await getUrls().catch(error => error) as LocalReferenceChannelError;
    expect(error.diagnostics).toMatchObject([{ assetIndex: 1, code: "ok" }, { assetIndex: 2, code: "http", httpStatus: 503, attempts: 2 }]);
    expect(mocks.localFetch).toHaveBeenCalledTimes(4);
    const failedCalls = mocks.localFetch.mock.calls.filter(([url]) => pathname(url).endsWith("/reference-2"));
    expect(failedCalls).toHaveLength(2); expect(failedCalls[0]![0]).toBe(failedCalls[1]![0]);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(error.message).toContain("当前生成尚未提交");
  });

  it("still rejects same-length corruption returned through the relay", async () => {
    save({ desktopPublicProbe: true }); serveRelay(() => assetResponse(bytes("corrupt!-file")));
    const error = await getUrls([references[0]!]).catch(error => error) as LocalReferenceChannelError;
    expect(error.diagnostics).toMatchObject([{ assetIndex: 1, code: "hash", attempts: 1, actualBytes: references[0]!.data.byteLength }]);
    expect(mocks.localFetch).toHaveBeenCalledTimes(2); expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
