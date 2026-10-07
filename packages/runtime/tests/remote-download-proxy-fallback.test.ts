import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({ http: vi.fn(), https: vi.fn() }));

vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:http")>()),
  request: requests.http,
}));
vi.mock("node:https", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:https")>()),
  request: requests.https,
}));

import { downloadRemoteArtifact } from "../src/remote-download.js";

const outputUrl = "https://cdn.provider.example/output.png?signature=existing";
const publicAddress = { address: "93.184.216.34", family: 4 };
const publicResolver = async () => [publicAddress];

type SystemResponse = {
  status?: number;
  headers?: IncomingMessage["headers"];
  bytes?: Uint8Array;
  error?: Error;
};

let systemResponses: SystemResponse[];
let proxyFetch: ReturnType<typeof vi.fn>;

function errorWithCode(code: string): Error {
  return Object.assign(new Error("Network transport failed"), { code });
}

function fetchError(code: string): Error {
  return new TypeError("fetch failed", {
    cause: new Error("Proxy connection failed", { cause: errorWithCode(code) }),
  });
}

function requestMock(
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
): ClientRequest {
  const request = new EventEmitter();
  Object.assign(request, {
    end() {
      queueMicrotask(() => {
        const next = systemResponses.shift();
        if (!next) {
          request.emit("error", new Error("Unexpected system network request"));
          return;
        }
        if (next.error) {
          request.emit("error", next.error);
          return;
        }
        const response = Object.assign(
          Readable.from([next.bytes ?? Uint8Array.of(4, 5, 6)]),
          {
            statusCode: next.status ?? 200,
            headers: next.headers ?? { "content-type": "image/png" },
          },
        );
        callback(response as IncomingMessage);
      });
    },
  });
  // Surface the same cancellation a real Node request would receive, while
  // keeping every test request local to this mock and out of public networks.
  options.signal?.addEventListener(
    "abort",
    () => request.emit("error", errorWithCode("ABORT_ERR")),
    { once: true },
  );
  return request as ClientRequest;
}

beforeEach(() => {
  systemResponses = [];
  requests.http.mockReset().mockImplementation(requestMock);
  requests.https.mockReset().mockImplementation(requestMock);
  proxyFetch = vi.fn();
  vi.stubGlobal("fetch", proxyFetch);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VITEST", "true");
  vi.stubEnv("ARTIFACT_HTTP_PROXY", "http://127.0.0.1:7897");
  vi.stubEnv("PROVIDER_HTTP_PROXY", "");
  vi.stubEnv("HTTPS_PROXY", "");
  vi.stubEnv("HTTP_PROXY", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("artifact download automatic proxy fallback", () => {
  it("retries an existing output once through the validated system route after a nested proxy refusal", async () => {
    proxyFetch.mockRejectedValue(fetchError("ECONNREFUSED"));
    systemResponses.push({ bytes: Uint8Array.of(1, 2, 3) });

    const result = await downloadRemoteArtifact(outputUrl, {
      resolve: publicResolver,
    });

    expect(result).toEqual({
      bytes: Uint8Array.of(1, 2, 3),
      contentType: "image/png",
    });
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(proxyFetch).toHaveBeenCalledWith(
      outputUrl,
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    expect(requests.https).toHaveBeenCalledTimes(1);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: publicAddress.address,
        family: 4,
        servername: "cdn.provider.example",
        path: "/output.png?signature=existing",
        method: "GET",
        signal: proxyFetch.mock.calls[0]![1].signal,
        headers: expect.objectContaining({ host: "cdn.provider.example" }),
      }),
      expect.any(Function),
    );
    expect(process.env.ARTIFACT_HTTP_PROXY).toBe("http://127.0.0.1:7897");
  });

  it("keeps the configured proxy preferred when it returns a successful response", async () => {
    proxyFetch.mockResolvedValue(
      new Response(Uint8Array.of(7, 8), {
        headers: { "content-type": "image/webp" },
      }),
    );

    expect(
      await downloadRemoteArtifact(outputUrl, { resolve: publicResolver }),
    ).toEqual({ bytes: Uint8Array.of(7, 8), contentType: "image/webp" });
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });

  it.each([
    "ECONNRESET",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EPIPE",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "ENOTFOUND",
    "EAI_AGAIN",
  ])("falls back on pre-response transport code %s", async (code) => {
    proxyFetch.mockRejectedValue(fetchError(code));
    systemResponses.push({});

    await downloadRemoteArtifact(outputUrl, { resolve: publicResolver });

    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.https).toHaveBeenCalledTimes(1);
  });

  it("recognizes aggregate failures only when every underlying error permits fallback", async () => {
    proxyFetch.mockRejectedValue(
      new TypeError("fetch failed", {
        cause: new AggregateError([
          errorWithCode("ECONNREFUSED"),
          errorWithCode("ENETUNREACH"),
        ]),
      }),
    );
    systemResponses.push({});

    await downloadRemoteArtifact(outputUrl, { resolve: publicResolver });

    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.https).toHaveBeenCalledTimes(1);
  });

  it("accepts repeated references to the same transport error in an aggregate", async () => {
    const cause = errorWithCode("ECONNREFUSED");
    proxyFetch.mockRejectedValue(
      new TypeError("fetch failed", {
        cause: new AggregateError([cause, cause]),
      }),
    );
    systemResponses.push({});

    await downloadRemoteArtifact(outputUrl, { resolve: publicResolver });

    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.https).toHaveBeenCalledTimes(1);
  });

  it("rejects an actual cyclic error cause without requesting the system route", async () => {
    const cause = errorWithCode("ECONNREFUSED");
    cause.cause = cause;
    const error = new TypeError("fetch failed", { cause });
    proxyFetch.mockRejectedValue(error);

    await expect(
      downloadRemoteArtifact(outputUrl, { resolve: publicResolver }),
    ).rejects.toBe(error);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });

  it("does not hide a certificate failure mixed with aggregate network errors", async () => {
    const error = new TypeError("fetch failed", {
      cause: new AggregateError([
        errorWithCode("ECONNREFUSED"),
        errorWithCode("CERT_HAS_EXPIRED"),
      ]),
    });
    proxyFetch.mockRejectedValue(error);

    await expect(
      downloadRemoteArtifact(outputUrl, { resolve: publicResolver }),
    ).rejects.toBe(error);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });

  it("tries the configured proxy again on the next download after an earlier fallback", async () => {
    proxyFetch
      .mockRejectedValueOnce(fetchError("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response(Uint8Array.of(8)));
    systemResponses.push({ bytes: Uint8Array.of(7) });

    const first = await downloadRemoteArtifact(outputUrl, {
      resolve: publicResolver,
    });
    const second = await downloadRemoteArtifact(outputUrl, {
      resolve: publicResolver,
    });

    expect(first.bytes).toEqual(Uint8Array.of(7));
    expect(second.bytes).toEqual(Uint8Array.of(8));
    expect(proxyFetch).toHaveBeenCalledTimes(2);
    expect(requests.https).toHaveBeenCalledTimes(1);
    expect(process.env.ARTIFACT_HTTP_PROXY).toBe("http://127.0.0.1:7897");
  });

  it("keeps fallback sticky across HTTPS redirects and validates each new host", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]);
    proxyFetch.mockRejectedValue(fetchError("ECONNREFUSED"));
    systemResponses.push(
      {
        status: 302,
        headers: { location: "https://next.cdn.example/final.png" },
      },
      { bytes: Uint8Array.of(9) },
    );

    const result = await downloadRemoteArtifact(outputUrl, { resolve });

    expect(result.bytes).toEqual(Uint8Array.of(9));
    expect(resolve.mock.calls.map(([hostname]) => hostname)).toEqual([
      "cdn.provider.example",
      "next.cdn.example",
    ]);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.https).toHaveBeenCalledTimes(2);
    expect(requests.https.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        hostname: "1.1.1.1",
        servername: "next.cdn.example",
        path: "/final.png",
        headers: expect.objectContaining({ host: "next.cdn.example" }),
      }),
    );
  });

  it("rejects a private redirect before issuing a second system request", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "10.0.0.8", family: 4 }]);
    proxyFetch.mockRejectedValue(fetchError("ECONNREFUSED"));
    systemResponses.push({
      status: 302,
      headers: { location: "https://private.example/output.png" },
    });

    await expect(
      downloadRemoteArtifact(outputUrl, { resolve }),
    ).rejects.toThrow(/private address/u);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.https).toHaveBeenCalledTimes(1);
  });

  it("uses the independently validated public IP for HTTP Fake-IP fallback", async () => {
    const resolvePublic = vi.fn(publicResolver);
    proxyFetch.mockRejectedValue(fetchError("ECONNREFUSED"));
    systemResponses.push({});

    await downloadRemoteArtifact(
      "http://cdn.provider.example:8080/output.png?signature=existing",
      {
        resolve: async () => [{ address: "198.18.2.17", family: 4 }],
        resolvePublic,
      },
    );

    expect(resolvePublic).toHaveBeenCalledTimes(1);
    expect(requests.http).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: publicAddress.address,
        port: "8080",
        headers: expect.objectContaining({ host: "cdn.provider.example:8080" }),
      }),
      expect.any(Function),
    );
    expect(requests.https).not.toHaveBeenCalled();
  });

  it("surfaces a failed system retry without repeating either route", async () => {
    const systemError = errorWithCode("ENETUNREACH");
    proxyFetch.mockRejectedValue(fetchError("ECONNREFUSED"));
    systemResponses.push({ error: systemError });

    await expect(
      downloadRemoteArtifact(outputUrl, { resolve: publicResolver }),
    ).rejects.toBe(systemError);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.https).toHaveBeenCalledTimes(1);
  });

  it.each([
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "INVALID_PROVIDER_PROXY",
    "ABORT_ERR",
    "UNKNOWN_TRANSPORT_ERROR",
  ])("does not bypass code %s via a system retry", async (code) => {
    const error = fetchError(code);
    proxyFetch.mockRejectedValue(error);

    await expect(
      downloadRemoteArtifact(outputUrl, { resolve: publicResolver }),
    ).rejects.toBe(error);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });

  it("does not infer retry safety from an unclassified fetch error message", async () => {
    const error = new TypeError("fetch failed");
    proxyFetch.mockRejectedValue(error);

    await expect(
      downloadRemoteArtifact(outputUrl, { resolve: publicResolver }),
    ).rejects.toBe(error);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });

  it("rejects an invalid proxy configuration before attempting any request", async () => {
    vi.stubEnv("ARTIFACT_HTTP_PROXY", "invalid-proxy-configuration");

    await expect(
      downloadRemoteArtifact(outputUrl, { resolve: publicResolver }),
    ).rejects.toThrow(/Configured provider proxy is invalid/u);
    expect(proxyFetch).not.toHaveBeenCalled();
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });

  it.each([404, 429, 500, 503])(
    "does not retry an HTTP %s response",
    async (status) => {
      proxyFetch.mockResolvedValue(new Response(null, { status }));

      await expect(
        downloadRemoteArtifact(outputUrl, { resolve: publicResolver }),
      ).rejects.toThrow(`Provider output download failed with HTTP ${status}`);
      expect(proxyFetch).toHaveBeenCalledTimes(1);
      expect(requests.http).not.toHaveBeenCalled();
      expect(requests.https).not.toHaveBeenCalled();
    },
  );

  it("does not retry a declared oversized response", async () => {
    proxyFetch.mockResolvedValue(
      new Response(Uint8Array.of(1, 2, 3, 4), {
        headers: { "content-length": "4" },
      }),
    );

    await expect(
      downloadRemoteArtifact(outputUrl, {
        resolve: publicResolver,
        maxBytes: 3,
      }),
    ).rejects.toThrow(/exceeds 3 bytes/u);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });

  it("does not retry a transport failure after response body consumption has started", async () => {
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        if (chunks === 1) controller.enqueue(Uint8Array.of(1));
        else controller.error(fetchError("ECONNRESET"));
      },
    });
    proxyFetch.mockResolvedValue(new Response(body));

    await expect(
      downloadRemoteArtifact(outputUrl, { resolve: publicResolver }),
    ).rejects.toThrow("fetch failed");
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });

  it("does not begin fallback after the overall deadline aborts the proxy request", async () => {
    proxyFetch.mockImplementation(
      (_url: string, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            "abort",
            () => reject(fetchError("ECONNREFUSED")),
            { once: true },
          );
        }),
    );

    await expect(
      downloadRemoteArtifact(outputUrl, {
        resolve: publicResolver,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/u);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });

  it("does not retry a stalled response body at the overall deadline", async () => {
    proxyFetch.mockResolvedValue(new Response(new ReadableStream()));

    await expect(
      downloadRemoteArtifact(outputUrl, {
        resolve: publicResolver,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/u);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(requests.http).not.toHaveBeenCalled();
    expect(requests.https).not.toHaveBeenCalled();
  });
});
