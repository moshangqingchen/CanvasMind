import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchProviderBytes,
  fetchProviderJson,
  providerFetch,
  ProviderHttpError,
  withProviderSubmissionProgress,
} from "./http";

describe("provider HTTP submission safety", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("treats failed network discovery as pre-submission rather than an ambiguous paid request", async () => {
    const cause = Object.assign(new Error("discovery failed before HTTP bytes"), { code: "PROVIDER_NETWORK_DISCOVERY_FAILED" });
    const error = await fetchProviderJson(async () => { throw new TypeError("fetch failed", { cause }); },
      "https://provider.test/generate", { method: "POST" }, { phase: "submit", timeoutMs: 0 }).catch(value => value as ProviderHttpError);
    expect(error.details).toMatchObject({ kind: "network", retryable: true, submissionMayHaveOccurred: false });
  });

  it("waits beyond every prior generation deadline when timeoutMs is zero and still cancels", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true }));
    });
    let settled = false;
    const request = fetchProviderJson(fetchImpl, "https://provider.test/generate", { method: "POST", signal: controller.signal }, { phase: "submit", timeoutMs: 0 });
    const result = request.then(value => { settled = true; return value; }, error => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(settled).toBe(false);
    expect(requestSignal?.aborted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(result).resolves.toMatchObject({ message: "Provider request was cancelled", details: { retryable: false, submissionMayHaveOccurred: true } });
  });

  it("retains bounded transport evidence for a socket loss without copying sensitive fields", async () => {
    const socketFailure = Object.assign(new Error("do not copy bearer token"), {
      code: "UND_ERR_SOCKET",
      socket: { bytesRead: 0, bytesWritten: 418, localAddress: "192.168.1.20", remoteAddress: "104.156.154.225",
        localPort: 50001, remotePort: 443, authorization: "secret" },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed", { cause: socketFailure }));
    const error = await fetchProviderJson(fetchImpl, "https://provider.test/generate", { method: "POST" }, { phase: "submit", timeoutMs: 0 }).catch(value => value as ProviderHttpError);
    expect(error.details.transport).toEqual({ elapsedMs: expect.any(Number), stage: "awaiting_headers", responseBytes: 0,
      errorCode: "UND_ERR_SOCKET", socketBytesRead: 0, socketBytesWritten: 418,
      localAddress: "192.168.1.20", remoteAddress: "104.156.154.225", localPort: 50001, remotePort: 443 });
    expect(JSON.stringify(error.details.transport)).not.toContain("secret");
    expect(error.details).toMatchObject({ retryable: false, submissionMayHaveOccurred: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("only accepts literal IP addresses and bounded ports in socket diagnostics", async () => {
    const socketFailure = Object.assign(new Error("closed"), { code: "UND_ERR_SOCKET",
      socket: { localAddress: "authorization: secret", remoteAddress: "https://secret@provider.test", localPort: -1, remotePort: 70_000 } });
    const error = await fetchProviderJson(async () => { throw socketFailure; }, "https://provider.test/generate", { method: "POST" },
      { phase: "submit", timeoutMs: 0 }).catch(value => value as ProviderHttpError);
    expect(error.details.transport).toEqual({ elapsedMs: expect.any(Number), stage: "awaiting_headers", responseBytes: 0, errorCode: "UND_ERR_SOCKET" });
    expect(JSON.stringify(error.details.transport)).not.toContain("secret");
  });

  it("records the bytes received before a successful response body is interrupted", async () => {
    let pulls = 0;
    const error = await fetchProviderJson(async () => new Response(new ReadableStream({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('{"data":'));
        else controller.error(Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" }));
      },
    }), { headers: { "content-type": "application/json" } }), "https://provider.test/generate", { method: "POST" }, { phase: "submit", timeoutMs: 0 }).catch(value => value as ProviderHttpError);
    expect(error.details.transport).toMatchObject({ stage: "reading_body", responseBytes: 8, errorCode: "UND_ERR_SOCKET" });
    expect(error.details).toMatchObject({ status: 200, retryable: false, submissionMayHaveOccurred: true });
  });

  it("supports explicit cancellation while an unlimited binary download is waiting", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return new Response("image");
    });
    await expect(fetchProviderBytes(fetchImpl, "https://provider.test/output.png", { phase: "archive", timeoutMs: 0, signal: controller.signal }))
      .rejects.toMatchObject({ message: "Asset download was cancelled", details: { retryable: false, submissionMayHaveOccurred: false } });
  });

  it("receives delayed headers and body over a real production socket with one submission", async () => {
    let submissions = 0;
    const server = createServer((request, response) => {
      submissions++;
      request.resume();
      request.on("end", () => {
        setTimeout(() => {
          response.writeHead(200, { "content-type": "application/json" });
          response.write('{"data":');
          setTimeout(() => response.end('["complete"]}'), 50);
        }, 50);
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VITEST", "");
    for (const name of ["PROVIDER_HTTP_PROXY", "HTTPS_PROXY", "HTTP_PROXY"]) vi.stubEnv(name, "");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP test server");
      await expect(fetchProviderJson(providerFetch, `http://127.0.0.1:${address.port}/generate`, { method: "POST", body: "{}" },
        { phase: "submit", timeoutMs: 0, allowLoopback: true })).resolves.toEqual({ data: ["complete"] });
      expect(submissions).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it("reports waiting before a synchronous response and receiving only on HTTP success", async () => {
    const progress = vi.fn(async () => {});
    const request = withProviderSubmissionProgress(progress, () => fetchProviderJson(async () => {
      expect(progress.mock.calls).toEqual([["waiting_provider"]]);
      return Response.json({ data: [] });
    }, "https://provider.test/generate", { method: "POST" }, { phase: "submit" }));
    await request;
    expect(progress.mock.calls).toEqual([["waiting_provider"], ["receiving"]]);
    progress.mockClear();
    await expect(withProviderSubmissionProgress(progress, () => fetchProviderJson(async () => Response.json({ error: "rejected" }, { status: 401 }), "https://provider.test/generate", { method: "POST" }, { phase: "submit" }))).rejects.toMatchObject({ details: { status: 401 } });
    expect(progress.mock.calls).toEqual([["waiting_provider"]]);
    progress.mockClear();
    await withProviderSubmissionProgress(progress, () => fetchProviderJson(async () => Response.json({}), "https://provider.test/models", {}, { phase: "connect" }));
    expect(progress).not.toHaveBeenCalled();
  });
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

  it.each([
    "http://[::ffff:127.0.0.1]/generate",
    "http://[::ffff:a00:1]/generate",
    "http://[0:0:0:0:0:ffff:a9fe:a9fe]/generate",
    "http://[::ffff:c0a8:1]/generate",
  ])("blocks IPv4-mapped private endpoints: %s", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await expect(fetchProviderJson(fetchImpl, url, {}, { phase: "submit", allowLoopback: true }))
      .rejects.toMatchObject({ details: { kind: "invalid_request", submissionMayHaveOccurred: false } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not submit a request that the caller has already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await expect(fetchProviderJson(fetchImpl, "https://provider.test/generate", {
      method: "POST", signal: controller.signal,
    }, { phase: "submit" })).rejects.toMatchObject({
      details: { retryable: false, submissionMayHaveOccurred: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation without retrying an ambiguous submit", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      controller.abort();
      if (init?.signal?.aborted) throw init.signal.reason;
      return Response.json({ ok: true });
    });
    await expect(fetchProviderJson(fetchImpl, "https://provider.test/generate", {
      method: "POST", signal: controller.signal,
    }, { phase: "submit" })).rejects.toMatchObject({
      message: "Provider request was cancelled",
      details: { kind: "network", retryable: false, submissionMayHaveOccurred: true },
    });
  });

  it("classifies a timeout while reading the response body as a timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
        },
      }), { headers: { "content-type": "application/json" } }),
    );
    await expect(fetchProviderJson(fetchImpl, "https://provider.test/generate", {
      method: "POST",
    }, { phase: "submit", timeoutMs: 10 })).rejects.toMatchObject({
      details: { kind: "timeout", retryable: false, submissionMayHaveOccurred: true },
    });
  });

  it.each(["submit", "poll", "connect"] as const)(
    "preserves HTTP 524 diagnostics and submission safety during %s",
    async (phase) => {
      const responseBody = "<html>Cloudflare: A timeout occurred</html>";
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(responseBody, {
          status: 524,
          headers: { "content-type": "text/html" },
        }),
      );
      await expect(fetchProviderJson(
        fetchImpl,
        "https://provider.test/generate",
        { method: phase === "submit" ? "POST" : "GET" },
        { phase },
      )).rejects.toMatchObject({
        message: "Provider returned HTTP 524",
        details: {
          kind: "provider",
          status: 524,
          responseBody,
          retryable: phase !== "submit",
          submissionMayHaveOccurred: phase === "submit",
        },
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it("cancels an oversized declared response body and does not retry the download", async () => {
    const cancel = vi.fn();
    await expect(fetchProviderBytes(async () => new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": "32" },
    }), "https://provider.test/output.png", { phase: "archive", maxResponseBytes: 16 }))
      .rejects.toMatchObject({ details: { kind: "invalid_response", retryable: false } });
    expect(cancel).toHaveBeenCalledOnce();
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

  it("preserves multipart bodies when the production undici transport is used", async () => {
    let receivedContentType = "";
    let receivedBody = "";
    const server = createServer((request, response) => {
      receivedContentType = request.headers["content-type"] ?? "";
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const previousNodeEnv = process.env["NODE_ENV"];
    const previousVitest = process.env["VITEST"];
    process.env["NODE_ENV"] = "production";
    delete process.env["VITEST"];

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the multipart test server to have a TCP address");
      }

      const form = new FormData();
      form.set("model", "gpt-image-2");
      form.set("prompt", "reference image test");
      form.append(
        "image",
        new Blob([new Uint8Array([0, 1, 2, 3])], { type: "image/png" }),
        "reference.png",
      );

      const response = await providerFetch(
        `http://127.0.0.1:${address.port}/v1/images/edits`,
        { method: "POST", body: form },
      );

      expect(response.status).toBe(200);
      expect(receivedContentType).toMatch(/^multipart\/form-data; boundary=/);
      expect(receivedBody).toContain('name="model"');
      expect(receivedBody).toContain("gpt-image-2");
      expect(receivedBody).toContain('name="prompt"');
      expect(receivedBody).toContain('name="image"; filename="reference.png"');
      expect(receivedBody).not.toContain("[object FormData]");
    } finally {
      if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previousNodeEnv;
      if (previousVitest === undefined) delete process.env["VITEST"];
      else process.env["VITEST"] = previousVitest;

      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
