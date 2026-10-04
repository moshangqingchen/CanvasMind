import { describe, expect, it, vi } from "vitest";
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { OpenAIImageAdapter } from "./openai.js";
import { applyPdogImageCapabilities, pdogImageOrigin, PDOG_GPT_IMAGE_SIZES } from "./pdog-image.js";
import { applyBananaImageCapabilities, bananaImageRoute } from "./banana-image.js";
import { presentProviderError } from "./error-presentation.js";

const model = "gpt-image-2.5-sunburst";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
const request: NormalizedRequest = { connectionId: "pdog", model, operation: "image.generate", prompt: "a blue vase", idempotencyKey: "one-paid-request",
  parameters: { size: "3840x2160", quality: "high", n: 1, response_format: "url" } };
function fixture(options: { baseUrl?: string; model?: string; settings?: Record<string, unknown>; fetch?: FetchImplementation } = {}) {
  const baseUrl = options.baseUrl ?? "https://ai.whyshy.cn";
  const selected = options.model ?? model;
  const fetch = vi.fn<FetchImplementation>(options.fetch ?? (async () => Response.json({ task_id: "imgtask_one", id: "imgtask_one", status: "processing", poll_url: "/v1/images/tasks/imgtask_one" }, { status: 202 })));
  const resolver = new StaticConnectionResolver([{ id: "pdog", provider: "openai", baseUrl, apiKey: "fixture-key",
    settings: { baseUrl, defaultModel: selected, modelGroup: "生图原生2K4K", scannedModelIds: [selected], ...options.settings } }]);
  return { adapter: createDefaultProviderRegistry(resolver, { fetch }).get("openai"), direct: new OpenAIImageAdapter(resolver, { fetch }), fetch };
}

describe("PDog documented GPT Images contract", () => {
  it.each(["https://ai.whyshy.cn", "https://ai.whyshy.cn/v1/"])("uses the full async path from %s and restores the original task", async baseUrl => {
    let queries = 0;
    const f = fixture({ baseUrl, fetch: async (_url, init) => init?.method === "POST"
      ? Response.json({ task_id: "imgtask_one", status: "processing", poll_url: "https://untrusted.example/task" }, { status: 202 })
      : Response.json(++queries === 1 ? { task_id: "imgtask_one", status: "processing" }
        : { task_id: "imgtask_one", status: "completed", image_url: "https://images.example/result.png", result: { data: [{ url: "https://images.example/result.png" }] } }) });
    let task = await f.adapter.submit(request);
    expect(task).toMatchObject({ providerTaskId: "imgtask_one", status: "running", pollAfterMs: 3000 });
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://ai.whyshy.cn/v1/images/generations/async");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-key");
    expect(JSON.parse(String(init?.body))).toEqual({ model, prompt: request.prompt, size: "3840x2160", quality: "high", n: 1, response_format: "url" });
    task = await f.adapter.poll!(JSON.parse(JSON.stringify(task)));
    expect(task).toMatchObject({ status: "running", pollAfterMs: 5000 });
    task = await f.adapter.poll!(JSON.parse(JSON.stringify(task)));
    expect(task.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(task.result)).toEqual([{ kind: "image", url: "https://images.example/result.png" }]);
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(f.fetch.mock.calls.slice(1).every(([url]) => String(url) === "https://ai.whyshy.cn/v1/images/tasks/imgtask_one")).toBe(true);
  });

  it("accepts the documented id fallback and result.data URL", async () => {
    const f = fixture({ fetch: async (_url, init) => init?.method === "POST" ? Response.json({ id: "imgtask_fallback", status: "processing" }, { status: 202 })
      : Response.json({ id: "imgtask_fallback", status: "completed", result: { data: [{ url: "https://images.example/fallback.png" }] } }) });
    const task = await f.adapter.poll!(await f.adapter.submit(request));
    expect(task.providerTaskId).toBe("imgtask_fallback");
    expect(await f.adapter.extractOutputs(task.result)).toEqual([{ kind: "image", url: "https://images.example/fallback.png" }]);
  });

  it("uses multipart bytes for async edits, including URL-only references", async () => {
    const f = fixture({ fetch: async url => String(url) === "https://assets.example/ref.png" ? new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } })
      : Response.json({ task_id: "imgtask_edit", status: "processing" }, { status: 202 }) });
    await f.adapter.submit({ ...request, operation: "image.edit", assets: [{ id: "ref", kind: "image", mimeType: "image/png", url: "https://assets.example/ref.png" }] });
    const [url, init] = f.fetch.mock.calls.at(-1)!;
    expect(String(url)).toBe("https://ai.whyshy.cn/v1/images/edits/async");
    const form = init?.body as FormData;
    expect(form.get("model")).toBe(model);
    expect(form.get("quality")).toBe("high");
    expect(form.get("n")).toBe("1");
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    expect(Buffer.from(await (form.get("image") as Blob).arrayBuffer())).toEqual(Buffer.from(png, "base64"));
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it.each(["url", "b64_json"])("supports explicit sync mode and %s output without task polling", async format => {
    const f = fixture({ settings: { pdogImageMode: "sync" }, fetch: async () => Response.json({ data: [format === "url" ? { url: "https://images.example/sync.png" } : { b64_json: png }] }) });
    const task = await f.adapter.submit({ ...request, parameters: { ...request.parameters, response_format: format } });
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://ai.whyshy.cn/v1/images/generations");
    expect(task.status).toBe("succeeded");
    const outputs = await f.adapter.extractOutputs(task.result);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject(format === "url" ? { kind: "image", url: "https://images.example/sync.png" } : { kind: "image", data: new Uint8Array(Buffer.from(png, "base64")) });
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it.each([{ quality: "ultra" }, { n: 2 }, { size: "4096x4096" }, { response_format: "other" }])("rejects unsupported controls before submitting: %j", async invalid => {
    const f = fixture();
    const candidate = { ...request, parameters: { ...request.parameters, ...invalid } };
    expect((await f.adapter.validate(candidate)).valid).toBe(false);
    await expect(f.adapter.submit(candidate)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("retains all eleven proportions and omits auto optional fields", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, parameters: { size: "auto", quality: "auto", n: 1 } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, n: 1 });
    const descriptor = applyPdogImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, { id: model, name: model, operations: ["image.generate"] });
    expect(descriptor.parameters?.find(p => p.key === "quality")).toMatchObject({ default: "max", options: ["auto", "low", "medium", "high", "xhigh", "max"].map(value => ({ value, label: value })) });
    expect(descriptor.metadata).toMatchObject({ qualitySupport: "assumed", pdogQualityDocumented: false, pdogQualityVerified: false });
    expect(descriptor.parameters?.find(p => p.key === "size")?.options).toHaveLength(34);
    for (const size of PDOG_GPT_IMAGE_SIZES) expect(descriptor.parameters?.find(p => p.key === "size")?.options).toContainEqual(expect.objectContaining({ value: size.value }));
    expect((await f.adapter.validate({ ...request, parameters: { size: "3200x2560", quality: "high", n: 1 } })).valid).toBe(true);
  });

  it.each(["gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("preserves cached max quality and submits max for %s", async selected => {
    const f = fixture({ model: selected });
    const cached = { id: selected, name: selected, operations: ["image.generate"] as const,
      parameters: [{ key: "quality", label: "质量", control: "select" as const, default: "max", options: [{ value: "max", label: "max" }] }] };
    const descriptor = applyPdogImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, cached);
    expect(descriptor.parameters?.find(parameter => parameter.key === "quality")?.default).toBe("max");
    await f.adapter.submit({ ...request, model: selected, parameters: { ...request.parameters, quality: "max" } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body)).quality).toBe("max");
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it("repairs cached image2.0 max to high and rejects an explicit max request without fetching", async () => {
    const f = fixture({ model: "gpt-image-2" });
    const descriptor = applyPdogImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, {
      id: "gpt-image-2", name: "gpt-image-2", operations: ["image.generate"], parameters: [{ key: "quality", label: "质量", control: "select", default: "max", options: [{ value: "max", label: "max" }] }],
    });
    expect(descriptor.parameters?.find(parameter => parameter.key === "quality")).toMatchObject({ default: "high", options: ["low", "medium", "high"].map(value => ({ value, label: value })) });
    expect(descriptor.metadata).toMatchObject({ qualitySupport: "declared", pdogQualityDocumented: true, pdogQualityVerified: false });
    await expect(f.adapter.submit({ ...request, model: "gpt-image-2", parameters: { ...request.parameters, quality: "max" } })).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
    await f.adapter.submit({ ...request, model: "gpt-image-2", parameters: { ...request.parameters, quality: "high" } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body)).quality).toBe("high");
  });

  it("locks 4K when only the ratio is automatic", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, parameters: { size: "auto", size_tier: "4K", aspect_ratio: "auto", quality: "high", n: 1 } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ size: "2880x2880" });
  });

  it("preserves a ratio resolved by automatic prompt/reference selection without a selected tier", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, parameters: { size: "auto", aspect_ratio: "16:9", quality: "high", n: 1 } });
    const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
    const [width, height] = String(body.size).split("x").map(Number);
    expect(width! / height!).toBeCloseTo(16 / 9, 1);
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it("keeps server failures and unknown submissions without a second generation", async () => {
    const missingId = fixture({ fetch: async () => Response.json({ status: "processing" }, { status: 202 }) });
    await expect(missingId.adapter.submit(request)).rejects.toMatchObject({ details: { kind: "invalid_response", submissionMayHaveOccurred: true, retryable: false } });
    expect(missingId.fetch).toHaveBeenCalledOnce();
    const storageDisabled = fixture({ fetch: async () => Response.json({ error: { code: "NOT_FOUND", message: "Object storage is not configured" } }, { status: 404 }) });
    const storageError = await storageDisabled.adapter.submit(request).catch(error => error);
    expect(storageError).toMatchObject({ details: { status: 404, retryable: false, responseBody: { error: { code: "NOT_FOUND" } } } });
    expect(storageError.message).toContain("未开启对象存储或存储凭证不完整时不会创建任务");
    expect(storageDisabled.fetch).toHaveBeenCalledOnce();
    const balance = fixture({ fetch: async () => Response.json({ error: { code: "INSUFFICIENT_BALANCE", message: "Insufficient balance" } }, { status: 403 }) });
    const balanceError = await balance.adapter.submit(request).catch(error => error);
    expect(balanceError).toMatchObject({ details: { status: 403, responseBody: { error: { code: "INSUFFICIENT_BALANCE" } } } });
    expect(presentProviderError(balanceError, { provider: "openai", supplier: "pdog" })).toMatchObject({ type: "余额不足", code: "INSUFFICIENT_BALANCE" });
    expect(balance.fetch).toHaveBeenCalledOnce();
  });

  it("preserves the failed task error and never manufactures an output", async () => {
    const f = fixture({ fetch: async (_url, init) => init?.method === "POST" ? Response.json({ task_id: "imgtask_failed", status: "processing" }, { status: 202 })
      : Response.json({ task_id: "imgtask_failed", status: "failed", error: { code: "UPSTREAM_ERROR", message: "upstream unavailable" } }) });
    const task = await f.adapter.poll!(await f.adapter.submit(request));
    expect(task).toMatchObject({ status: "failed", error: "upstream unavailable" });
    expect(await f.adapter.extractOutputs(task.result)).toEqual([]);
  });

  it("reads the live keyed catalog at /v1/models and retains only visible model IDs", async () => {
    const f = fixture({ fetch: async () => Response.json({ data: [{ id: "gpt-image-2" }] }) });
    const models = await f.direct.listModels("pdog");
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://ai.whyshy.cn/v1/models");
    expect(models.map(model => model.id)).toEqual(["gpt-image-2"]);
    expect(models[0]?.parameters?.find(parameter => parameter.key === "quality")?.default).toBe("high");
  });

  it("does not override custom paths or other supplier origins", async () => {
    for (const origin of ["http://ai.whyshy.cn", "https://ai.whyshy.cn/custom/v1", "https://ai.whyshy.cn.evil.example", "https://user:secret@ai.whyshy.cn", "https://ai.whyshy.cn/?q=1"])
      expect(pdogImageOrigin(origin)).toBeUndefined();
    const f = fixture({ baseUrl: "https://ai.whyshy.cn/custom/v1", fetch: async () => Response.json({ data: [{ b64_json: png }] }) });
    await f.direct.submit(request);
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://ai.whyshy.cn/custom/v1/images/generations");
  });
});

describe("PDog documented Gemini native contract", () => {
  it("keeps the configured model IDs and all eleven proportions without declaring a site reference limit", async () => {
    const f = fixture({ model: "gemini-3-pro-image", fetch: async () => Response.json({ candidates: [] }) });
    const route = bananaImageRoute({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, "gemini-3-pro-image")!;
    const descriptor = applyBananaImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, { id: "gemini-3-pro-image", name: "gemini-3-pro-image", operations: ["image.generate"] });
    expect(route.ratios).toHaveLength(11);
    expect(descriptor.limits?.maxInputImages).toBeUndefined();
    expect(bananaImageRoute({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, "gemini-3-pro-image-preview")?.unavailableReason).toBeTruthy();
    const task = await f.adapter.submit({ ...request, model: "gemini-3-pro-image", parameters: { image_size: "2K", aspect_ratio: "9:21" } });
    expect(JSON.parse(String(f.fetch.mock.calls.at(-1)![1]?.body)).generationConfig.imageConfig.aspectRatio).toBe("9:21");
    expect(await f.adapter.extractOutputs(task.result)).toEqual([]);
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each(["gemini-3-pro-image", "gemini-3.1-flash-image-preview"])("uses Google's header and native request fields for %s", async selected => {
    const f = fixture({ model: selected, fetch: async () => Response.json({ modelVersion: "nano-banana2", candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }) });
    const task = await f.adapter.submit({ ...request, model: selected, parameters: { image_size: "4K", aspect_ratio: "16:9", quality: "max" } });
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe(`https://ai.whyshy.cn/v1beta/models/${selected}:generateContent`);
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("fixture-key");
    expect(JSON.parse(String(init?.body))).toEqual({ contents: [{ role: "user", parts: [{ text: request.prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" } } });
    expect(task.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(task.result)).toEqual([expect.objectContaining({ kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) })]);
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it("inlines actual reference bytes for Gemini edits", async () => {
    const selected = "gemini-3-pro-image";
    const f = fixture({ model: selected, fetch: async () => Response.json({ candidates: [] }) });
    await f.adapter.submit({ ...request, model: selected, operation: "image.edit", parameters: { image_size: "2K", aspect_ratio: "1:1" },
      assets: [{ id: "reference", kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }] });
    const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: png } });
    expect(String(f.fetch.mock.calls[0]![0])).not.toContain("/images/");
  });
});
