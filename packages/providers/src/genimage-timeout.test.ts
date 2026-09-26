import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchImplementation, NormalizedRequest, ProviderTask } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { ProviderHttpError, withProviderSubmissionProgress } from "./http.js";
import { OpenAIImageAdapter } from "./openai.js";

// Keep the real HTTP safety/timeout path, but never resolve or contact a live site.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

const operations = ["image.generate", "image.edit"] as const;
const models = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const groups = ["default", "gptResponseBase64", "geminiResponseUrl"];
const generatedBytes = Buffer.from("offline-generated-image");
const outputUrl = "https://assets.example.test/generated.png";

function fixture(options: {
  operation?: (typeof operations)[number];
  model?: string;
  baseUrl?: string;
  settings?: Record<string, unknown>;
  responseAfterMs?: number;
  useDefaultFetch?: boolean;
  signal?: AbortSignal;
} = {}) {
  const operation = options.operation ?? "image.generate";
  const model = options.model ?? "gpt-image-2.5-sunburst";
  const baseUrl = options.baseUrl ?? "https://genimage.pro/v1";
  const fetcher = vi.fn<FetchImplementation>((_url, init) => new Promise((resolve, reject) => {
    const signal = init?.signal;
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (responseTimer !== undefined) clearTimeout(responseTimer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (options.responseAfterMs !== undefined) {
      responseTimer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve(Response.json({ data: [operation === "image.edit"
          ? { b64_json: generatedBytes.toString("base64") }
          : { url: outputUrl }] }));
      }, options.responseAfterMs);
    }
  }));
  if (options.useDefaultFetch) vi.stubGlobal("fetch", fetcher);
  const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{
    id: "offline-genimage-timeout", provider: "openai", apiKey: "offline-test-key", baseUrl,
    settings: { usage: "canvas", modelGroup: "geminiResponseUrl", ...options.settings },
  }]), options.useDefaultFetch ? {} : { fetch: fetcher });
  const image25 = /^gpt-image-2\.5(?:-|$)/u.test(model);
  const request: NormalizedRequest = {
    connectionId: "offline-genimage-timeout", operation, model,
    prompt: "Offline timeout regression", idempotencyKey: "offline-timeout-request",
    parameters: { size: image25 ? "2496x3312" : "1024x1024", quality: image25 ? "max" : "high", n: 1, response_format: "b64_json" },
    ...(operation === "image.edit" ? { assets: [{ id: "reference", kind: "image" as const,
      mimeType: "image/png", filename: "reference.png", data: new Uint8Array([137, 80, 78, 71]) }] } : {}),
  };
  let outcome: { task?: ProviderTask; error?: unknown } | undefined;
  const done = withProviderSubmissionProgress(async () => {}, () => adapter.submit(request), options.signal).then(
    task => { outcome = { task }; },
    error => { outcome = { error }; },
  );
  return { adapter, fetcher, request, done, outcome: () => outcome };
}

async function start(f: ReturnType<typeof fixture>, operation: (typeof operations)[number]) {
  await vi.advanceTimersByTimeAsync(0);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = f.fetcher.mock.calls[0]!;
  expect(String(url)).toMatch(operation === "image.edit" ? /\/images\/edits$/u : /\/images\/generations$/u);
  expect(init?.method).toBe("POST");
  if (operation === "image.edit") {
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init!.body as FormData).get("size")).toBe(f.request.parameters!.size);
    expect((init!.body as FormData).get("quality")).toBe(f.request.parameters!.quality);
  } else {
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: f.request.model, size: f.request.parameters!.size, quality: f.request.parameters!.quality,
    });
  }
  expect(init?.signal?.aborted).toBe(false);
}

function expectAmbiguousTimeout(f: ReturnType<typeof fixture>) {
  expect(f.outcome()?.error).toBeInstanceOf(ProviderHttpError);
  expect(f.outcome()?.error).toMatchObject({
    message: "Provider request timed out",
    details: { kind: "timeout", phase: "submit", retryable: false, submissionMayHaveOccurred: true },
  });
  expect(f.outcome()?.task).toBeUndefined();
  expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected fetch in offline timeout test"); }));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(operations)("Genimage %s submission timeout", operation => {
  it.each(models.flatMap(model => groups.map(modelGroup => ({ model, modelGroup }))))(
    "receives and extracts a 121-second response for $model / $modelGroup",
    async ({ model, modelGroup }) => {
      const f = fixture({ operation, model, settings: { modelGroup, accountKeyGroup: modelGroup }, responseAfterMs: 121_000 });
      await start(f, operation);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(f.outcome()).toBeUndefined();
      expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      await f.done;
      expect(f.outcome()?.error).toBeUndefined();
      expect(f.outcome()?.task?.status).toBe("succeeded");
      const outputs = await f.adapter.extractOutputs(f.outcome()?.task?.result);
      expect(outputs).toHaveLength(1);
      if (operation === "image.edit") expect(Buffer.from(outputs[0]!.data!)).toEqual(generatedBytes);
      else expect(outputs[0]?.url).toBe(outputUrl);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("waits beyond the former 600-second deadline for the original response", async () => {
    const f = fixture({ operation, responseAfterMs: 7_200_000 });
    await start(f, operation);
    await vi.advanceTimersByTimeAsync(599_999);
    expect(f.outcome()).toBeUndefined();
    expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.outcome()).toBeUndefined();
    expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(6_600_000);
    await f.done;
    expect(f.outcome()?.error).toBeUndefined();
    expect(f.outcome()?.task?.status).toBe("succeeded");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the default provider transport wrapper for a 121-second response", async () => {
    const f = fixture({ operation, useDefaultFetch: true, responseAfterMs: 121_000 });
    await start(f, operation);
    await vi.advanceTimersByTimeAsync(121_000);
    await f.done;
    expect(f.outcome()?.error).toBeUndefined();
    expect(f.outcome()?.task?.status).toBe("succeeded");
    const outputs = await f.adapter.extractOutputs(f.outcome()?.task?.result);
    expect(outputs).toHaveLength(1);
    if (operation === "image.edit") expect(Buffer.from(outputs[0]!.data!)).toEqual(generatedBytes);
    else expect(outputs[0]?.url).toBe(outputUrl);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the default provider transport wrapper beyond the former 600-second deadline", async () => {
    const f = fixture({ operation, useDefaultFetch: true, responseAfterMs: 1_801_000 });
    await start(f, operation);
    await vi.advanceTimersByTimeAsync(599_999);
    expect(f.outcome()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.outcome()).toBeUndefined();
    expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_201_000);
    await f.done;
    expect(f.outcome()?.error).toBeUndefined();
    expect(f.outcome()?.task?.status).toBe("succeeded");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an unlimited generation only when explicitly requested and never repeats its POST", async () => {
    const controller = new AbortController();
    const f = fixture({ operation, signal: controller.signal });
    await start(f, operation);
    await vi.advanceTimersByTimeAsync(7_200_000);
    expect(f.outcome()).toBeUndefined();
    expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    controller.abort();
    await f.done;
    expect(f.outcome()?.error).toMatchObject({ message: "Provider request was cancelled",
      details: { kind: "network", phase: "submit", retryable: false, submissionMayHaveOccurred: true } });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([45_000, "180000"])("retains an explicit imageSubmitTimeoutMs=%s override", async imageSubmitTimeoutMs => {
    const f = fixture({ operation, settings: { imageSubmitTimeoutMs } });
    await start(f, operation);
    await vi.advanceTimersByTimeAsync(Number(imageSubmitTimeoutMs) - 1);
    expect(f.outcome()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await f.done;
    expectAmbiguousTimeout(f);
  });

  it.each([300_000, 600_000])("does not inherit the legacy metadata requestTimeoutMs=%s for image generation", async requestTimeoutMs => {
    const f = fixture({ operation, settings: { requestTimeoutMs }, responseAfterMs: 601_000 });
    await start(f, operation);
    await vi.advanceTimersByTimeAsync(requestTimeoutMs);
    expect(f.outcome()).toBeUndefined();
    expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(601_000 - requestTimeoutMs);
    await f.done;
    expect(f.outcome()?.task?.status).toBe("succeeded");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { baseUrl: "https://another-provider.example/v1" },
    { baseUrl: "https://genimage.pro.evil.example/v1" },
    { baseUrl: "https://genimage.pro/custom/v1" },
    { settings: { modelGroup: "other-group" } },
    { settings: { accountKeyGroup: "default" } },
    { model: "gpt-image-1" },
  ])("waits for generation across suppliers, model groups and model names: %o", async patch => {
    const f = fixture({ operation, ...patch, responseAfterMs: 601_000 });
    await start(f, operation);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(f.outcome()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.outcome()).toBeUndefined();
    expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(481_000);
    await f.done;
    expect(f.outcome()?.error).toBeUndefined();
    expect(f.outcome()?.task?.status).toBe("succeeded");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("keeps model metadata requests bounded while image generation waits without a deadline", async () => {
  const fetcher = vi.fn<FetchImplementation>((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{
    id: "offline-genimage-metadata", provider: "openai", apiKey: "offline-test-key", baseUrl: "https://genimage.pro/v1",
  }]), { fetch: fetcher });
  let error: unknown;
  const done = adapter.listModels("offline-genimage-metadata").catch(value => { error = value; });
  await vi.advanceTimersByTimeAsync(119_999);
  expect(error).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://genimage.pro/v1/models");
  expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(error).toMatchObject({ details: { kind: "timeout", phase: "connect", submissionMayHaveOccurred: false } });
  expect(vi.getTimerCount()).toBe(0);
});
