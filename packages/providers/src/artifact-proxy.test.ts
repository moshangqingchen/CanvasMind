import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchWithPinnedProviderHttpProxy } from "./http.js";

async function startProxy(handle: RequestListener) {
  const server = createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("production pinned HTTP artifact proxy transport", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "false");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends the public IP request target and original virtual Host through real Undici", async () => {
    const requests: {
      target: string | undefined;
      host: string | undefined;
      credentials: boolean;
      encoding: string | undefined;
    }[] = [];
    const proxy = await startProxy((request, response) => {
      requests.push({
        target: request.url,
        host: request.headers.host,
        credentials: Boolean(
          request.headers.authorization ||
          request.headers["proxy-authorization"],
        ),
        encoding: request.headers["accept-encoding"],
      });
      response.writeHead(200, { "content-type": "image/png" });
      response.end("image-bytes");
    });
    try {
      const response = await fetchWithPinnedProviderHttpProxy(
        "http://93.184.216.34:8080/output.png?download=1",
        {
          host: "cdn.provider.example:8080",
          signal: AbortSignal.timeout(1000),
          proxyOverride: proxy.url,
        },
      );
      expect(await response.text()).toBe("image-bytes");
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(requests).toEqual([
        {
          target: "http://93.184.216.34:8080/output.png?download=1",
          host: "cdn.provider.example:8080",
          credentials: false,
          encoding: "identity",
        },
      ]);
    } finally {
      await proxy.close();
    }
  });

  it("rejects encoded bytes when a proxy ignores the identity encoding request", async () => {
    let encoding: string | undefined;
    const proxy = await startProxy((request, response) => {
      encoding = request.headers["accept-encoding"];
      response.writeHead(200, {
        "content-type": "image/png",
        "content-encoding": "gzip",
      });
      response.end(gzipSync("image-bytes"));
    });
    try {
      await expect(
        fetchWithPinnedProviderHttpProxy("http://93.184.216.34/output.png", {
          host: "cdn.provider.example",
          signal: AbortSignal.timeout(1000),
          proxyOverride: proxy.url,
        }),
      ).rejects.toThrow("Content-Encoding must be identity");
      expect(encoding).toBe("identity");
    } finally {
      await proxy.close();
    }
  });

  it("returns redirects for runtime validation instead of following them", async () => {
    let requests = 0;
    const proxy = await startProxy((_request, response) => {
      requests += 1;
      response.writeHead(302, { location: "http://169.254.169.254/private" });
      response.end();
    });
    try {
      const response = await fetchWithPinnedProviderHttpProxy(
        "http://93.184.216.34/output.png",
        {
          host: "cdn.provider.example",
          signal: AbortSignal.timeout(1000),
          proxyOverride: proxy.url,
        },
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "http://169.254.169.254/private",
      );
      await response.body?.cancel();
      expect(requests).toBe(1);
    } finally {
      await proxy.close();
    }
  });

  it("returns a gzip redirect for runtime validation without following or treating its body as an artifact", async () => {
    let requests = 0;
    const proxy = await startProxy((_request, response) => {
      requests += 1;
      response.writeHead(302, {
        location: "/next.png",
        "content-encoding": "gzip",
      });
      response.end(gzipSync("redirect-body"));
    });
    try {
      const response = await fetchWithPinnedProviderHttpProxy(
        "http://93.184.216.34/output.png",
        {
          host: "cdn.provider.example",
          signal: AbortSignal.timeout(1000),
          proxyOverride: proxy.url,
        },
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/next.png");
      await response.body?.cancel();
      expect(requests).toBe(1);
    } finally {
      await proxy.close();
    }
  });

  it("streams the first chunk and cancels a stalled body through the supplied signal", async () => {
    const proxy = await startProxy((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.write("first");
    });
    const controller = new AbortController();
    try {
      const response = await fetchWithPinnedProviderHttpProxy(
        "http://93.184.216.34/output.png",
        {
          host: "cdn.provider.example",
          signal: controller.signal,
          proxyOverride: proxy.url,
        },
      );
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(
        "first",
      );
      controller.abort();
      await expect(reader.read()).rejects.toThrow();
      reader.releaseLock();
    } finally {
      controller.abort();
      await proxy.close();
    }
  });

  it("represents a bodyless response without constructing an invalid Response", async () => {
    const proxy = await startProxy((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    try {
      const response = await fetchWithPinnedProviderHttpProxy(
        "http://93.184.216.34/output.png",
        {
          host: "cdn.provider.example",
          signal: AbortSignal.timeout(1000),
          proxyOverride: proxy.url,
        },
      );
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
    } finally {
      await proxy.close();
    }
  });
});
