import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchImplementation, NormalizedRequest, ProviderTask } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { ProviderHttpError } from "./http.js";
import { OpenAIImageAdapter, WeAIImageAdapter } from "./openai.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

const operations = ["image.generate", "image.edit"] as const;
function fixture(options: {
  operation?: (typeof operations)[number];
  model?: string;
  baseUrl?: string;
  responseAfterMs?: number;
  disconnectAfterMs?: number;
  imageSubmitTimeoutMs?: number | string;
  adapterTimeoutMs?: number;
  defaultTransport?: boolean;
  legacyAdapter?: boolean;
  headers?: Record<string, string>;
} = {}) {
  const fetcher = vi.fn<FetchImplementation>((_url, init) => new Promise((resolve, reject) => {
    const signal = init?.signal;
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      clearTimeout(responseTimer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    const delay = options.responseAfterMs ?? options.disconnectAfterMs;
    if (delay !== undefined) responseTimer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      if (options.disconnectAfterMs !== undefined) {
        reject(Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }));
      } else resolve(Response.json({ data: [{ b64_json: Buffer.from("offline-image").toString("base64") }] }));
    }, delay);
  }));
  if (options.defaultTransport) vi.stubGlobal("fetch", fetcher);
  const Adapter = options.legacyAdapter ? WeAIImageAdapter : OpenAIImageAdapter;
  const adapter = new Adapter(new StaticConnectionResolver([{
    id: "weai-timeout", provider: options.legacyAdapter ? "weai" : "openai", apiKey: "offline-key",
    baseUrl: options.baseUrl ?? "https://asian-acc.we-token.cc/v1",
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    settings: { supplierKey: "weai", modelGroup: "生图-openai-adobe-image2.5专属",
      ...(options.imageSubmitTimeoutMs === undefined ? {} : { imageSubmitTimeoutMs: options.imageSubmitTimeoutMs }) },
  }]), {
    ...(options.defaultTransport ? {} : { fetch: fetcher }),
    ...(options.adapterTimeoutMs === undefined ? {} : { requestTimeoutMs: options.adapterTimeoutMs }),
  });
  const operation = options.operation ?? "image.generate";
  const request: NormalizedRequest = {
    connectionId: "weai-timeout", operation, model: options.model ?? "gpt-image-2.5-sunburst",
    prompt: "Offline delayed response", idempotencyKey: "offline-single-submission",
    parameters: { size: "2880x2880", quality: "max", n: 1 },
    ...(operation === "image.edit" ? { assets: [{ id: "reference", kind: "image" as const,
      mimeType: "image/png", filename: "reference.png", data: new Uint8Array([137, 80, 78, 71]) }] } : {}),
  };
  let result: { task?: ProviderTask; error?: unknown } | undefined;
  const done = adapter.submit(request).then(task => { result = { task }; }, error => { result = { error }; });
  return { adapter, fetcher, done, result: () => result };
}

async function start(f: ReturnType<typeof fixture>) {
  await vi.advanceTimersByTimeAsync(0);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const name of ["PROVIDER_HTTP_PROXY", "HTTPS_PROXY", "HTTP_PROXY"]) vi.stubEnv(name, "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected live fetch"); }));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(operations)("We-AI OpenAI-compatible %s waiting", operation => {
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("receives %s after 143 seconds without resubmission", async model => {
    const f = fixture({ operation, model, responseAfterMs: 143_000 });
    await start(f);
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(new Headers(init?.headers).get("accept-encoding")).toBe("identity");
    expect(String(url)).toMatch(operation === "image.edit" ? /\/images\/edits$/u : /\/images\/generations$/u);
    if (operation === "image.edit") {
      expect((init!.body as FormData).get("quality")).toBe("max");
      expect((init!.body as FormData).get("size")).toBe("2880x2880");
      expect((init!.body as FormData).get("response_format")).toBe("url");
    } else expect(JSON.parse(String(init?.body))).toMatchObject({ model, quality: "max", size: "2880x2880", response_format: "url" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.result()).toBeUndefined();
    expect(init?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(23_000);
    await f.done;
    expect(f.result()?.task?.status).toBe("succeeded");
    const outputs = await f.adapter.extractOutputs(f.result()!.task!.result);
    expect(Buffer.from(outputs[0]!.data!).toString()).toBe("offline-image");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the real transport selection and receives a response after six minutes", async () => {
    const f = fixture({ operation, defaultTransport: true, responseAfterMs: 360_000 });
    await start(f);
    expect(new Headers(f.fetcher.mock.calls[0]?.[1]?.headers).get("accept-encoding")).toBe("identity");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.result()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    await f.done;
    expect(f.result()?.task?.status).toBe("succeeded");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("waits for and extracts the entire large image body after headers have arrived", async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0xa5);
    const json = JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] });
    const encoder = new TextEncoder();
    const f = fixture({ operation });
    f.fetcher.mockImplementationOnce(async () => new Response(new ReadableStream({
      start(controller) {
        // A JSON whitespace heartbeat is not a complete image result.
        controller.enqueue(encoder.encode("\n"));
        setTimeout(() => controller.enqueue(encoder.encode(json.slice(0, json.length / 2))), 143_000);
        setTimeout(() => {
          controller.enqueue(encoder.encode(json.slice(json.length / 2)));
          controller.close();
        }, 144_000);
      },
    }), { headers: { "content-type": "application/json" } }));
    await start(f);
    await vi.advanceTimersByTimeAsync(143_000);
    expect(f.result()).toBeUndefined();
    expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await f.done;
    expect(f.result()?.task?.status).toBe("succeeded");
    const outputs = await f.adapter.extractOutputs(f.result()!.task!.result);
    expect(Buffer.from(outputs[0]!.data!).equals(bytes)).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps waiting past thirty minutes and receives the original response without retry", async () => {
    const f = fixture({ operation, responseAfterMs: 7_200_000 });
    await start(f);
    await vi.advanceTimersByTimeAsync(1_799_999);
    expect(f.result()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.result()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_400_000);
    await f.done;
    expect(f.result()?.task?.status).toBe("succeeded");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not pretend a closed socket can still deliver a response or resubmit it", async () => {
    const f = fixture({ operation, disconnectAfterMs: 110_000 });
    await start(f);
    await vi.advanceTimersByTimeAsync(110_000);
    await f.done;
    expect(f.result()?.error).toMatchObject({ details: { kind: "network", submissionMayHaveOccurred: true, retryable: false } });
    expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it.each([
  { imageSubmitTimeoutMs: 45_000, deadline: 45_000 },
  { imageSubmitTimeoutMs: "180000", deadline: 180_000 },
  { adapterTimeoutMs: 90_000, deadline: 90_000 },
])("preserves explicitly configured deadlines: %o", async ({ deadline, ...options }) => {
  const f = fixture(options);
  await start(f);
  await vi.advanceTimersByTimeAsync(deadline - 1);
  expect(f.result()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  await f.done;
  expect(f.result()?.error).toMatchObject({ details: { kind: "timeout" } });
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});

it.each(["https://other-provider.example/v1", "https://we-token.cc.evil.example/v1"])("waits for other suppliers without applying We-AI payload rules: %s", async baseUrl => {
  const f = fixture({ baseUrl, responseAfterMs: 360_000 });
  await start(f);
  expect(new Headers(f.fetcher.mock.calls[0]?.[1]?.headers).has("accept-encoding")).toBe(false);
  expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).not.toHaveProperty("response_format");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.result()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(240_000);
  await f.done;
  expect(f.result()?.task?.status).toBe("succeeded");
});

it("preserves waiting through the older We-AI adapter", async () => {
  const f = fixture({ legacyAdapter: true, model: "gpt-image-2", responseAfterMs: 143_000 });
  await start(f);
  expect(new Headers(f.fetcher.mock.calls[0]?.[1]?.headers).get("accept-encoding")).toBe("identity");
  await vi.advanceTimersByTimeAsync(143_000);
  await f.done;
  expect(f.result()?.task?.status).toBe("succeeded");
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  "https://we-token.cc/v1",
  "https://sub2api.we-token.cc/v1",
  "https://us-la.we-token.cc/v1",
  "https://we-ai.cc/v1",
  "https://api.we-ai.cc/v1",
])("disables compression for compatible image groups at %s, preserving other headers", async baseUrl => {
  const f = fixture({ baseUrl, responseAfterMs: 1, headers: {
    "accept-encoding": "gzip, br", "x-custom-routing": "keep-routing",
  } });
  await start(f);
  const headers = new Headers(f.fetcher.mock.calls[0]?.[1]?.headers);
  expect(headers.get("accept-encoding")).toBe("identity");
  expect(headers.get("x-custom-routing")).toBe("keep-routing");
  expect(headers.get("authorization")).toBe("Bearer offline-key");
  expect(headers.get("idempotency-key")).toBe("offline-single-submission");
  await vi.advanceTimersByTimeAsync(1);
  await f.done;
  expect(f.result()?.task?.status).toBe("succeeded");
});

it("preserves explicit compression headers for another provider", async () => {
  const f = fixture({ baseUrl: "https://other-provider.example/v1", responseAfterMs: 1,
    headers: { "Accept-Encoding": "gzip" } });
  await start(f);
  expect(new Headers(f.fetcher.mock.calls[0]?.[1]?.headers).get("accept-encoding")).toBe("gzip");
  await vi.advanceTimersByTimeAsync(1);
  await f.done;
  expect(f.result()?.task?.status).toBe("succeeded");
});
