import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channel } from "node:diagnostics_channel";

const transport = vi.hoisted(() => ({
  fetch: vi.fn(),
  agents: vi.fn(),
  proxies: vi.fn(),
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: transport.fetch,
    Agent: class extends actual.Agent {
      constructor(options?: ConstructorParameters<typeof actual.Agent>[0]) {
        super(options);
        transport.agents(options);
      }
    },
    ProxyAgent: class extends actual.ProxyAgent {
      constructor(options: ConstructorParameters<typeof actual.ProxyAgent>[0]) {
        super(options);
        transport.proxies(options);
      }
    },
  };
});

import { fetchProviderBytes, fetchProviderJson, fetchWithProviderHttpProxy, providerFetch } from "./http.js";
import { weAIFetch } from "./openai.js";

describe("long provider request transport budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("PROVIDER_HTTP_PROXY", "");
    vi.stubEnv("HTTPS_PROXY", "");
    vi.stubEnv("HTTP_PROXY", "");
    transport.fetch.mockResolvedValue(new Response("{}"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("passes the full explicit budget to undici for direct requests and reuses it", async () => {
    const signal = new AbortController().signal;
    await fetchWithProviderHttpProxy(
      "https://genimage.pro/v1/images/generations",
      { method: "POST", signal, redirect: "error" },
      undefined,
      600_000,
    );
    expect(transport.agents).toHaveBeenCalledWith({
      headersTimeout: 600_000,
      bodyTimeout: 600_000,
      connect: expect.any(Function),
    });
    const firstInit = transport.fetch.mock.calls[0]?.[1];
    expect(firstInit).toMatchObject({ method: "POST", signal, redirect: "error" });
    expect(firstInit.dispatcher).toBeDefined();
    await fetchWithProviderHttpProxy("https://genimage.pro/v1/images/edits", {}, undefined, 600_000);
    expect(transport.fetch.mock.calls[1]?.[1].dispatcher).toBe(firstInit.dispatcher);
    expect(transport.agents).toHaveBeenCalledTimes(1);
  });

  it.each(["PROVIDER_HTTP_PROXY", "HTTPS_PROXY"])(
    "keeps %s and applies the full budget to its CONNECT dispatcher",
    async (variable) => {
      const uri = `http://127.0.0.1:${variable === "HTTPS_PROXY" ? 18091 : 18092}`;
      vi.stubEnv(variable, uri);
      await fetchWithProviderHttpProxy("https://genimage.pro/v1/images/generations", {}, undefined, 600_000);
      expect(transport.proxies).toHaveBeenCalledWith({
        uri,
        headersTimeout: 600_000,
        bodyTimeout: 600_000,
        requestTls: { keepAlive: true, keepAliveInitialDelay: 30_000 },
        proxyTls: { keepAlive: true, keepAliveInitialDelay: 30_000 },
      });
      const longDispatcher = transport.fetch.mock.calls[0]?.[1].dispatcher;
      await fetchWithProviderHttpProxy("https://other-provider.test/v1/models", {});
      expect(transport.proxies).toHaveBeenLastCalledWith({ uri });
      expect(transport.fetch.mock.calls[1]?.[1].dispatcher).not.toBe(longDispatcher);
    },
  );

  it("preserves explicit proxy precedence", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:18093");
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:18094");
    await fetchWithProviderHttpProxy("https://genimage.pro/v1/images/generations", {}, "http://127.0.0.1:18095", 600_000);
    expect(transport.proxies).toHaveBeenCalledWith({
      uri: "http://127.0.0.1:18095",
      headersTimeout: 600_000,
      bodyTimeout: 600_000,
      requestTls: { keepAlive: true, keepAliveInitialDelay: 30_000 },
      proxyTls: { keepAlive: true, keepAliveInitialDelay: 30_000 },
    });
  });

  it.each(["PROVIDER_HTTP_PROXY", "HTTPS_PROXY", "HTTP_PROXY"])(
    "fails before sending when %s is invalid, without falling back or exposing its credentials",
    async variable => {
      vi.stubEnv(variable, "http://proxy-user:private-password@[");
      const error = await fetchProviderJson(providerFetch, "https://supplier.test/v1/images/generations", { method: "POST" },
        { phase: "submit", timeoutMs: 0 }).catch(value => value);
      expect(error).toMatchObject({ message: "Configured provider proxy is invalid; no provider request was sent",
        details: { kind: "invalid_request", phase: "submit", retryable: false, submissionMayHaveOccurred: false,
          transport: { errorCode: "INVALID_PROVIDER_PROXY" } } });
      expect(JSON.stringify(error)).not.toContain("private-password");
      expect(String(error)).not.toContain("proxy-user");
      expect(transport.fetch).not.toHaveBeenCalled();
      expect(transport.agents).not.toHaveBeenCalled();
    },
  );

  it("does not fall through an invalid explicit override to a valid environment proxy", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:18115");
    expect(() => fetchWithProviderHttpProxy("https://supplier.test/generate", { method: "POST" }, "invalid-proxy-value", 0))
      .toThrow("Configured provider proxy is invalid; no provider request was sent");
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(transport.proxies).not.toHaveBeenCalled();
    expect(transport.agents).not.toHaveBeenCalled();
  });

  it("blocks unsupported proxy protocols for binary downloads before direct network selection", async () => {
    vi.stubEnv("HTTPS_PROXY", "ftp://proxy-user:private-password@proxy.test");
    await expect(fetchProviderBytes(providerFetch, "https://supplier.test/image.png", { phase: "archive", timeoutMs: 0 }))
      .rejects.toMatchObject({ details: { kind: "invalid_request", phase: "archive", retryable: false, submissionMayHaveOccurred: false } });
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(transport.agents).not.toHaveBeenCalled();
  });

  it.each(["PROVIDER_HTTP_PROXY", "HTTPS_PROXY", "HTTP_PROXY"])(
    "keeps We-AI image waits unbounded through %s",
    async variable => {
      const uri = `http://127.0.0.1:${18096 + ["PROVIDER_HTTP_PROXY", "HTTPS_PROXY", "HTTP_PROXY"].indexOf(variable)}`;
      vi.stubEnv(variable, uri);
      const signal = new AbortController().signal;
      await fetchProviderJson(weAIFetch, "https://supplier.test/v1/images/generations", { method: "POST", signal }, { phase: "submit", timeoutMs: 0 });
      expect(transport.proxies).toHaveBeenCalledWith({ uri, headersTimeout: 0, bodyTimeout: 0,
        requestTls: { keepAlive: true, keepAliveInitialDelay: 30_000 },
        proxyTls: { keepAlive: true, keepAliveInitialDelay: 30_000 },
      });
      expect(transport.fetch).toHaveBeenCalledTimes(1);
      expect(transport.fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", signal });
    },
  );

  it("keeps default direct requests on the existing dispatcher", async () => {
    const init = { method: "GET" };
    await fetchWithProviderHttpProxy("https://other-provider.test/v1/models", init);
    expect(transport.fetch).toHaveBeenCalledWith("https://other-provider.test/v1/models", init);
    expect(transport.agents).not.toHaveBeenCalled();
    expect(transport.proxies).not.toHaveBeenCalled();
  });

  it("preserves multipart conversion when a long budget is supplied", async () => {
    const form = new FormData();
    form.set("model", "gpt-image-2.5-sunburst");
    form.set("image", new Blob(["reference"], { type: "image/png" }), "reference.png");
    await fetchWithProviderHttpProxy("https://genimage.pro/v1/images/edits", { method: "POST", body: form }, undefined, 600_000);
    const init = transport.fetch.mock.calls[0]?.[1];
    expect(init.body).not.toBe(form);
    expect(init.body.get("model")).toBe("gpt-image-2.5-sunburst");
    expect(init.body.get("image").name).toBe("reference.png");
    expect(init.dispatcher).toBeDefined();
  });

  it("preserves injected global fetch semantics in tests", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const init = { method: "POST" };
    await fetchWithProviderHttpProxy("https://genimage.pro/v1/images/generations", init, undefined, 600_000);
    expect(fetch).toHaveBeenCalledWith("https://genimage.pro/v1/images/generations", init);
    expect(transport.fetch).not.toHaveBeenCalled();
  });

  it("carries an unlimited submit budget through every shared direct fetch", async () => {
    const controller = new AbortController();
    await fetchProviderJson(providerFetch, "https://other-provider.test/generate", {
      method: "POST", signal: controller.signal,
    }, { phase: "submit", timeoutMs: 0 });
    expect(transport.agents).toHaveBeenCalledWith({ headersTimeout: 0, bodyTimeout: 0,
      connect: expect.any(Function),
    });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(transport.fetch.mock.calls[0]?.[1].signal.aborted).toBe(false);
  });

  it("isolates concurrent finite and unlimited proxy transport budgets", async () => {
    const uri = "http://127.0.0.1:18110";
    vi.stubEnv("PROVIDER_HTTP_PROXY", uri);
    transport.fetch.mockImplementation(async () => new Response("{}"));
    await Promise.all([
      fetchProviderJson(providerFetch, "https://one-provider.test/generate", { method: "POST" }, { phase: "submit", timeoutMs: 0 }),
      fetchProviderJson(providerFetch, "https://two-provider.test/task", {}, { phase: "poll", timeoutMs: 41_000 }),
    ]);
    expect(transport.proxies).toHaveBeenCalledWith(expect.objectContaining({ uri, headersTimeout: 0, bodyTimeout: 0 }));
    expect(transport.proxies).toHaveBeenCalledWith(expect.objectContaining({ uri, headersTimeout: 41_000, bodyTimeout: 41_000 }));
    expect(transport.fetch.mock.calls[0]?.[1].dispatcher).not.toBe(transport.fetch.mock.calls[1]?.[1].dispatcher);
    await fetchWithProviderHttpProxy("https://other-provider.test/models");
    expect(transport.proxies).toHaveBeenLastCalledWith({ uri });
  });

  it("passes an unlimited binary download budget to the shared transport", async () => {
    const uri = "http://127.0.0.1:18111";
    vi.stubEnv("PROVIDER_HTTP_PROXY", uri);
    await fetchProviderBytes(providerFetch, "https://other-provider.test/image.png", { phase: "archive", timeoutMs: 0 });
    expect(transport.proxies).toHaveBeenCalledWith(expect.objectContaining({ uri, headersTimeout: 0, bodyTimeout: 0 }));
  });

  it("persists the actual request socket route even when a closed socket has lost its addresses", async () => {
    transport.fetch.mockImplementation(async () => {
      const request = { origin: "https://supplier.test" };
      channel("undici:request:create").publish({ request });
      const socket = { localAddress: "192.168.1.20", remoteAddress: "104.156.154.225", localPort: 51000, remotePort: 443,
        [Symbol.for("super-canvas.provider-route")]: "physical-direct" };
      channel("undici:client:sendHeaders").publish({ request, socket, headers: "authorization: private-token" });
      const dnsRequest = { origin: "https://dns.google" };
      channel("undici:request:create").publish({ request: dnsRequest });
      channel("undici:client:sendHeaders").publish({ request: dnsRequest, socket: { localAddress: "198.18.0.1", remoteAddress: "198.18.0.2" } });
      throw Object.assign(new Error("closed"), { code: "UND_ERR_SOCKET", socket: { bytesWritten: 580, bytesRead: 0 } });
    });
    const error = await fetchProviderJson(providerFetch, "https://supplier.test/generate", { method: "POST" }, { phase: "submit", timeoutMs: 0 }).catch(value => value);
    expect(error.details.transport).toMatchObject({ route: "physical-direct", localAddress: "192.168.1.20", remoteAddress: "104.156.154.225",
      localPort: 51000, remotePort: 443, socketBytesWritten: 580, socketBytesRead: 0 });
    expect(JSON.stringify(error.details.transport)).not.toContain("private-token");
    expect(transport.fetch).toHaveBeenCalledOnce();
  });

  it("isolates route evidence for simultaneous suppliers and reports explicit proxy selection", async () => {
    const requests: Array<{ request: { origin: string }; reject: (error: Error) => void }> = [];
    transport.fetch.mockImplementation(async (url: string) => new Promise((_resolve, reject) => {
      const request = { origin: new URL(url).origin };
      channel("undici:request:create").publish({ request });
      requests.push({ request, reject });
      if (requests.length === 2) queueMicrotask(() => {
        for (const [i, entry] of requests.entries()) {
          channel("undici:client:sendHeaders").publish({ request: entry.request, socket: { localAddress: "192.168.1.20", remoteAddress: i ? "43.154.120.97" : "104.156.154.225",
            [Symbol.for("super-canvas.provider-route")]: "physical-direct" } });
          entry.reject(Object.assign(new Error("closed"), { code: "UND_ERR_SOCKET" }));
        }
      });
    }));
    const jobs = ["first", "second"].map(name => fetchProviderJson(providerFetch, `https://${name}.test/generate`, { method: "POST" },
      { phase: "submit", timeoutMs: 0 }).catch(value => value));
    const [one, two] = await Promise.all(jobs);
    expect(one.details.transport).toMatchObject({ route: "physical-direct", remoteAddress: "104.156.154.225" });
    expect(two.details.transport).toMatchObject({ route: "physical-direct", remoteAddress: "43.154.120.97" });
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:18116");
    transport.fetch.mockRejectedValue(Object.assign(new Error("closed"), { code: "UND_ERR_SOCKET" }));
    const error = await fetchProviderJson(providerFetch, "https://third.test/generate", { method: "POST" }, { phase: "submit", timeoutMs: 0 }).catch(value => value);
    expect(error.details.transport.route).toBe("explicit-proxy");
  });
});
