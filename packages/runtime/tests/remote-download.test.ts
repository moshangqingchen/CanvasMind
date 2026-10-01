import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadRemoteArtifact,
  consumeRemoteArtifact,
  isPublicNetworkAddress,
} from "../src/remote-download.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

async function withProductionProxy<T>(
  handle: RequestListener,
  work: () => Promise<T>,
): Promise<T> {
  const server = createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VITEST", "false");
  vi.stubEnv(
    "ARTIFACT_HTTP_PROXY",
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  try {
    return await work();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("remote artifact download", () => {
  it("delivers chunks before the remote response finishes instead of buffering the whole file", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:7897");
    let feed!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        feed = controller;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, { headers: { "content-type": "video/mp4" } }),
        ),
    );
    let received!: () => void;
    const firstChunk = new Promise<void>((resolve) => {
      received = resolve;
    });
    const result = consumeRemoteArtifact(
      "https://cdn.example/output",
      async (chunks, contentType) => {
        let size = 0;
        for await (const chunk of chunks) {
          size += chunk.byteLength;
          received();
        }
        return { size, contentType };
      },
      { resolve: publicResolver },
    );
    feed.enqueue(Uint8Array.of(1, 2));
    await firstChunk;
    feed.enqueue(Uint8Array.of(3));
    feed.close();
    expect(await result).toEqual({ size: 3, contentType: "video/mp4" });
  });

  it("cancels the network stream when its storage consumer fails", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:7897");
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(Uint8Array.of(1));
      },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(
      consumeRemoteArtifact(
        "https://cdn.example/output",
        async (chunks) => {
          for await (const _chunk of chunks) throw new Error("disk full");
        },
        { resolve: publicResolver },
      ),
    ).rejects.toThrow("disk full");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["PROVIDER_HTTP_PROXY", "ARTIFACT_HTTP_PROXY"])(
    "uses %s for Fake-IP outputs without credentials or automatic redirects",
    async (key) => {
      vi.stubEnv(key, "http://127.0.0.1:7897");
      const fetch = vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        }),
      );
      vi.stubGlobal("fetch", fetch);
      const result = await downloadRemoteArtifact(
        "https://cdn.example/output.png",
        {
          resolve: async () => [{ address: "198.18.0.247", family: 4 }],
        },
      );
      expect(result).toEqual({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
      });
      expect(fetch).toHaveBeenCalledWith(
        "https://cdn.example/output.png",
        expect.objectContaining({
          method: "GET",
          redirect: "manual",
          signal: expect.any(AbortSignal),
        }),
      );
      expect(
        new Headers(fetch.mock.calls[0]![1].headers).has("authorization"),
      ).toBe(false);
    },
  );

  it("still rejects private redirects on the proxy path", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:7897");
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://private.example/output" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      downloadRemoteArtifact("https://cdn.example/output", {
        resolve: async (host) =>
          host === "private.example"
            ? [{ address: "10.0.0.1", family: 4 }]
            : publicResolver(),
      }),
    ).rejects.toThrow(/private address/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds streamed proxy responses even without Content-Length", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:7897");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4]))),
    );
    await expect(
      downloadRemoteArtifact("https://cdn.example/output", {
        resolve: publicResolver,
        maxBytes: 3,
      }),
    ).rejects.toThrow(/exceeds 3 bytes/);
  });

  it("stops a stalled proxy response body at the total deadline", async () => {
    vi.stubEnv("PROVIDER_HTTP_PROXY", "http://127.0.0.1:7897");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new ReadableStream())),
    );
    await expect(
      downloadRemoteArtifact("https://cdn.example/output", {
        resolve: publicResolver,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.100.100.200",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => {
      expect(isPublicNetworkAddress(address)).toBe(true);
    },
  );

  it("rejects unsafe protocols, credentials, and private DNS answers", async () => {
    await expect(downloadRemoteArtifact("file:///etc/passwd")).rejects.toThrow(
      /http or https/u,
    );
    await expect(
      downloadRemoteArtifact("https://user:secret@example.com/file"),
    ).rejects.toThrow(/credentials/u);
    await expect(
      downloadRemoteArtifact("http://metadata.example/file", {
        resolve: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
    ).rejects.toThrow(/private address/u);
  });

  it("automatically supports HTTPS hostnames behind Fake-IP DNS without allowing unsafe variants", async () => {
    let pinnedAddress = "";
    const result = await downloadRemoteArtifact(
      "https://cdn.provider.example/output.png",
      {
        resolve: async () => [{ address: "198.18.2.17", family: 4 }],
        transport: async (_url, resolved) => {
          pinnedAddress = resolved.address;
          return {
            status: 200,
            contentType: "image/png",
            bytes: new Uint8Array([1, 2, 3]),
          };
        },
      },
    );
    expect(pinnedAddress).toBe("198.18.2.17");
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));

    const fakeIpResolver = async () => [{ address: "198.18.2.17", family: 4 }];
    await expect(
      downloadRemoteArtifact("http://cdn.provider.example/output.png", {
        resolve: fakeIpResolver,
        resolvePublic: async () => [],
      }),
    ).rejects.toThrow(/public address/u);
    await expect(
      downloadRemoteArtifact("https://198.18.2.17/output.png"),
    ).rejects.toThrow(/private address/u);
    await expect(
      downloadRemoteArtifact("https://cdn.provider.example/output.png", {
        resolve: async () => [
          { address: "198.18.2.17", family: 4 },
          { address: "10.0.0.8", family: 4 },
        ],
      }),
    ).rejects.toThrow(/private address/u);
    await expect(
      downloadRemoteArtifact("https://cdn.provider.example/output.png", {
        resolve: async () => [
          { address: "198.18.2.17", family: 4 },
          { address: "93.184.216.34", family: 4 },
        ],
      }),
    ).rejects.toThrow(/private address/u);
  });

  it("downloads HTTP Fake-IP outputs using an independently verified public destination", async () => {
    const resolvePublic = vi.fn(publicResolver);
    const transport = vi.fn(async () => ({
      status: 200,
      contentType: "image/png",
      bytes: new Uint8Array([4, 5, 6]),
    }));
    const result = await downloadRemoteArtifact(
      "http://cdn.provider.example/output.png?download=1",
      {
        resolve: async () => [{ address: "198.18.2.17", family: 4 }],
        resolvePublic,
        transport,
      },
    );
    expect(resolvePublic).toHaveBeenCalledWith(
      "cdn.provider.example",
      expect.any(AbortSignal),
    );
    expect(transport).toHaveBeenCalledWith(
      new URL("http://cdn.provider.example/output.png?download=1"),
      expect.objectContaining({ address: "93.184.216.34", family: 4 }),
      expect.any(AbortSignal),
      expect.any(Number),
    );
    expect(result).toEqual({
      bytes: new Uint8Array([4, 5, 6]),
      contentType: "image/png",
    });
  });

  it.each(["PROVIDER_HTTP_PROXY", "ARTIFACT_HTTP_PROXY"])(
    "pins the recovered HTTP destination through %s while preserving the original Host",
    async (key) => {
      vi.stubEnv(key, "http://127.0.0.1:7897");
      const fetch = vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await downloadRemoteArtifact(
        "http://cdn.provider.example:8080/output.png?download=1",
        {
          resolve: async () => [{ address: "198.18.2.17", family: 4 }],
          resolvePublic: publicResolver,
        },
      );
      expect(fetch).toHaveBeenCalledWith(
        "http://93.184.216.34:8080/output.png?download=1",
        expect.objectContaining({
          method: "GET",
          redirect: "manual",
          signal: expect.any(AbortSignal),
        }),
      );
      const headers = new Headers(fetch.mock.calls[0]![1].headers);
      expect(headers.get("host")).toBe("cdn.provider.example:8080");
      expect(headers.has("authorization")).toBe(false);
    },
  );

  it.each(
    [
      [],
      [{ address: "10.0.0.8", family: 4 }],
      [{ address: "198.18.2.17", family: 4 }],
      [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    ].map((addresses) => ({ addresses })),
  )(
    "does not download when independent HTTP DNS lacks a fully public answer: %j",
    async ({ addresses }) => {
      const transport = vi.fn();
      await expect(
        downloadRemoteArtifact("http://cdn.provider.example/output.png", {
          resolve: async () => [{ address: "198.18.2.17", family: 4 }],
          resolvePublic: async () => addresses,
          transport,
        }),
      ).rejects.toThrow(/public address/u);
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each(
    [
      [{ address: "10.0.0.8", family: 4 }],
      [
        { address: "198.18.2.17", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ],
      [
        { address: "198.18.2.17", family: 4 },
        { address: "93.184.216.34", family: 4 },
      ],
    ].map((addresses) => ({ addresses })),
  )(
    "does not reinterpret private or mixed HTTP DNS answers as Fake-IP: %j",
    async ({ addresses }) => {
      const resolvePublic = vi.fn(publicResolver);
      const transport = vi.fn();
      await expect(
        downloadRemoteArtifact("http://cdn.provider.example/output.png", {
          resolve: async () => addresses,
          resolvePublic,
          transport,
        }),
      ).rejects.toThrow(/private address/u);
      expect(resolvePublic).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it("continues rejecting HTTP Fake-IP literals without independent DNS", async () => {
    const resolvePublic = vi.fn(publicResolver);
    const transport = vi.fn();
    await expect(
      downloadRemoteArtifact("http://198.18.2.17/output.png", {
        resolvePublic,
        transport,
      }),
    ).rejects.toThrow(/private address/u);
    expect(resolvePublic).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("fails closed when independent HTTP DNS fails or stalls", async () => {
    const transport = vi.fn();
    const resolve = async () => [{ address: "198.18.2.17", family: 4 }];
    await expect(
      downloadRemoteArtifact("http://cdn.provider.example/output.png", {
        resolve,
        resolvePublic: async () => {
          throw new Error("Public DNS unavailable");
        },
        transport,
      }),
    ).rejects.toThrow("Public DNS unavailable");
    await expect(
      downloadRemoteArtifact("http://cdn.provider.example/output.png", {
        resolve,
        resolvePublic: () => new Promise(() => undefined),
        timeoutMs: 10,
        transport,
      }),
    ).rejects.toThrow(/timed out/u);
    expect(transport).not.toHaveBeenCalled();
  });

  it("revalidates independent HTTP DNS after a same-origin redirect", async () => {
    const resolvePublic = vi
      .fn()
      .mockResolvedValueOnce(await publicResolver())
      .mockResolvedValueOnce([{ address: "10.0.0.8", family: 4 }]);
    const transport = vi.fn(async () => ({
      status: 302,
      location: "/next.png",
      bytes: new Uint8Array(),
    }));
    await expect(
      downloadRemoteArtifact("http://cdn.provider.example/output.png", {
        resolve: async () => [{ address: "198.18.2.17", family: 4 }],
        resolvePublic,
        transport,
      }),
    ).rejects.toThrow(/public address/u);
    expect(resolvePublic).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("preserves HTTP Fake-IP public pinning and the virtual Host through the production proxy", async () => {
    const requests: {
      target: string | undefined;
      host: string | undefined;
      credentials: boolean;
    }[] = [];
    await withProductionProxy(
      (request, response) => {
        requests.push({
          target: request.url,
          host: request.headers.host,
          credentials: Boolean(request.headers.authorization),
        });
        response.writeHead(200, { "content-type": "image/png" });
        response.end("image-bytes");
      },
      async () => {
        const result = await downloadRemoteArtifact(
          "http://cdn.provider.example:8080/output.png?download=1",
          {
            resolve: async () => [{ address: "198.18.2.17", family: 4 }],
            resolvePublic: publicResolver,
            timeoutMs: 1000,
          },
        );
        expect(Buffer.from(result.bytes).toString()).toBe("image-bytes");
        expect(requests).toEqual([
          {
            target: "http://93.184.216.34:8080/output.png?download=1",
            host: "cdn.provider.example:8080",
            credentials: false,
          },
        ]);
      },
    );
  });

  it("enforces the byte limit on the real production proxy stream", async () => {
    await withProductionProxy(
      (_request, response) => {
        response.writeHead(200, { "content-type": "image/png" });
        response.end("1234");
      },
      async () => {
        await expect(
          downloadRemoteArtifact("http://cdn.provider.example/output.png", {
            resolve: async () => [{ address: "198.18.2.17", family: 4 }],
            resolvePublic: publicResolver,
            maxBytes: 3,
            timeoutMs: 1000,
          }),
        ).rejects.toThrow(/exceeds 3 bytes/u);
      },
    );
  });

  it("cancels an oversized Content-Length before reading without an unhandled stream error", async () => {
    const unhandled: unknown[] = [];
    const recordUnhandled = (error: Error) => {
      unhandled.push(error);
    };
    process.on("uncaughtException", recordUnhandled);
    try {
      await withProductionProxy(
        (_request, response) => {
          response.writeHead(200, {
            "content-type": "image/png",
            "content-length": "4",
          });
          response.end("1234");
        },
        async () => {
          await expect(
            downloadRemoteArtifact("http://cdn.provider.example/output.png", {
              resolve: async () => [{ address: "198.18.2.17", family: 4 }],
              resolvePublic: publicResolver,
              maxBytes: 3,
              timeoutMs: 1000,
            }),
          ).rejects.toThrow(/exceeds 3 bytes/u);
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(unhandled).toEqual([]);
        },
      );
    } finally {
      process.off("uncaughtException", recordUnhandled);
    }
  });

  it("cancels a stalled real production proxy body at the total deadline", async () => {
    await withProductionProxy(
      (_request, response) => {
        response.writeHead(200, { "content-type": "image/png" });
        response.write("first");
      },
      async () => {
        await expect(
          downloadRemoteArtifact("http://cdn.provider.example/output.png", {
            resolve: async () => [{ address: "198.18.2.17", family: 4 }],
            resolvePublic: publicResolver,
            timeoutMs: 30,
          }),
        ).rejects.toThrow(/timed out/u);
      },
    );
  });

  it("allows HTTPS CDN redirects and revalidates DNS on every hop", async () => {
    const resolutions: string[] = [];
    const requests: string[] = [];
    const result = await downloadRemoteArtifact(
      "https://provider.example/output",
      {
        resolve: async (hostname) => {
          resolutions.push(hostname);
          return hostname === "cdn.provider.example"
            ? [{ address: "1.1.1.1", family: 4 }]
            : publicResolver();
        },
        transport: async (url) => {
          requests.push(url.href);
          return url.hostname === "provider.example"
            ? {
                status: 302,
                location: "https://cdn.provider.example/signed/output.png",
                bytes: new Uint8Array(),
              }
            : {
                status: 200,
                contentType: "image/png",
                bytes: new Uint8Array([4, 5, 6]),
              };
        },
      },
    );

    expect(resolutions).toEqual(["provider.example", "cdn.provider.example"]);
    expect(requests).toEqual([
      "https://provider.example/output",
      "https://cdn.provider.example/signed/output.png",
    ]);
    expect(result.bytes).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("rejects private redirect targets after resolving them", async () => {
    let requests = 0;
    await expect(
      downloadRemoteArtifact("https://provider.example/output", {
        resolve: async (hostname) =>
          hostname === "private.example"
            ? [{ address: "10.0.0.8", family: 4 }]
            : publicResolver(),
        transport: async () => {
          requests += 1;
          return {
            status: 302,
            location: "https://private.example/output",
            bytes: new Uint8Array(),
          };
        },
      }),
    ).rejects.toThrow(/private address/u);
    expect(requests).toBe(1);
  });

  it("rejects HTTPS redirects that downgrade to HTTP", async () => {
    let resolutions = 0;
    await expect(
      downloadRemoteArtifact("https://provider.example/output", {
        resolve: async () => {
          resolutions += 1;
          return publicResolver();
        },
        transport: async () => ({
          status: 302,
          location: "http://cdn.provider.example/output",
          bytes: new Uint8Array(),
        }),
      }),
    ).rejects.toThrow(/must not downgrade HTTPS/u);
    expect(resolutions).toBe(1);
  });

  it("enforces a total timeout and maximum response size", async () => {
    await expect(
      downloadRemoteArtifact("https://provider.example/output", {
        timeoutMs: 5,
        resolve: () => new Promise(() => undefined),
      }),
    ).rejects.toThrow(/timed out/u);

    await expect(
      downloadRemoteArtifact("https://provider.example/output", {
        maxBytes: 3,
        resolve: publicResolver,
        transport: async () => ({
          status: 200,
          bytes: new Uint8Array([1, 2, 3, 4]),
        }),
      }),
    ).rejects.toThrow(/exceeds 3 bytes/u);
  });
});
