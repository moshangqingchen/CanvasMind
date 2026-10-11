import { describe, expect, it, vi } from "vitest";
import type { FetchImplementation, ModelDescriptor, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { OpenAIImageAdapter } from "./openai.js";
import { applyPdogImageCapabilities, pdogImageOrigin, pdogImageSizeForTier, pdogImageQualityOptions, PDOG_GPT_IMAGE_SIZES, PDOG_GEMINI_LEGACY_UNAVAILABLE } from "./pdog-image.js";
import { VERIFIED_TRANSPARENT_IMAGES } from "./transparent-image-evidence.js";
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
  it.each([{ manualProtocol: true }, { metadata: { source: "manual" } }, { metadata: { protocolEvidence: "paid-test" } }, { metadata: { source: "paid-test" } }])("preserves an explicit or measured descriptor: %j", marker => {
    const saved: ModelDescriptor = { id: model, name: "custom", operations: ["image.generate"], parameters: [{ key: "size", label: "custom", control: "text", default: "custom" }], ...(marker.metadata ? { metadata: marker.metadata } : {}) };
    expect(applyPdogImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn", ...(marker.manualProtocol ? { manualProtocol: true } : {}) } }, saved)).toBe(saved);
  });
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

  it.each([{ quality: "ultra" }, { n: 2 }, { size: "0x4096" }, { response_format: "other" }])("rejects unsupported controls before submitting: %j", async invalid => {
    const f = fixture();
    const candidate = { ...request, parameters: { ...request.parameters, ...invalid } };
    expect((await f.adapter.validate(candidate)).valid).toBe(false);
    await expect(f.adapter.submit(candidate)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("lists only source sizes, preserves independent tiers and omits auto optional fields", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, parameters: { size: "auto", quality: "auto", n: 1 } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, n: 1 });
    const descriptor = applyPdogImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, { id: model, name: model, operations: ["image.generate"] });
    expect(descriptor.parameters?.find(p => p.key === "quality")).toMatchObject({ default: "high", options: ["low", "medium", "high"].map(value => ({ value, label: value })) });
    expect(descriptor.metadata).toMatchObject({ qualitySupport: "declared", pdogQualityDocumented: true, pdogQualityVerified: false });
    expect(descriptor.parameters?.find(p => p.key === "size")?.options).toHaveLength(20);
    expect(descriptor.metadata).toMatchObject({ imageNativeParameterContract: true, imageResolutionTierParameter: "size_tier" });
    expect(descriptor.parameters?.find(p => p.key === "size_tier")?.options?.map(o => o.value)).toEqual(["auto", "1K", "2K", "4K"]);
    for (const size of PDOG_GPT_IMAGE_SIZES) expect(descriptor.parameters?.find(p => p.key === "size")?.options).toContainEqual(expect.objectContaining({ value: size.value }));
    expect((await f.adapter.validate({ ...request, parameters: { size: "3200x2560", quality: "high", n: 1 } })).valid).toBe(true);
  });

  it.each(["gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("retains and submits the user's max quality request for %s", async selected => {
    const f = fixture({ model: selected });
    const cached = { id: selected, name: selected, operations: ["image.generate"] as const,
      parameters: [{ key: "quality", label: "质量", control: "select" as const, default: "max", options: [{ value: "max", label: "max" }] }] };
    const descriptor = applyPdogImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, cached);
    expect(descriptor.parameters?.find(parameter => parameter.key === "quality")?.default).toBe("high");
    const oldParameters = { ...request.parameters, quality: "max" };
    await f.adapter.submit({ ...request, model: selected, parameters: oldParameters });
    expect(oldParameters.quality).toBe("max");
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

  it.each(VERIFIED_TRANSPARENT_IMAGES.filter(row => row.hostname === "ai.whyshy.cn"))(
    "reuses accepted max for the exact historical $group / $model, including normal generation and edits", async evidence => {
      const settings = { modelGroup: evidence.group, accountKeyGroup: evidence.group };
      const f = fixture({ model: evidence.model, settings });
      const connection = { provider: "openai", config: { baseUrl: "https://ai.whyshy.cn/v1", ...settings } };
      const descriptor = applyPdogImageCapabilities(connection, { id: evidence.model, name: evidence.model, operations: ["image.generate"] });
      expect(descriptor.parameters?.find(p => p.key === "quality")).toMatchObject({ default: "max", options: ["low", "medium", "high", "max"].map(value => ({ value, label: value })) });
      expect(descriptor.metadata).toMatchObject({ pdogQualityVerified: true, pdogMeasuredQuality: { fullModelId: evidence.model, group: evidence.group, checkedAt: evidence.checkedAt, request: evidence.request } });
      const parameters = { ...evidence.request, background: "opaque" };
      for (const operation of ["image.generate", "image.edit"] as const) {
        await f.adapter.submit({ ...request, model: evidence.model, operation, parameters,
          ...(operation === "image.edit" ? { assets: [{ id: "reference", kind: "image" as const, mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }] } : {}) });
        const body = f.fetch.mock.calls.at(-1)![1]?.body;
        expect(body instanceof FormData ? body.get("quality") : JSON.parse(String(body)).quality).toBe("max");
      }
      expect(parameters).toEqual({ ...evidence.request, background: "opaque" });
      expect(f.fetch).toHaveBeenCalledTimes(2);
      for (const config of [{ ...connection.config, modelGroup: "【生图】image2/2.5-1K", accountKeyGroup: "【生图】image2/2.5-1K" },
        { ...connection.config, modelGroup: evidence.group, accountKeyGroup: "different" },
        { ...connection.config, baseUrl: "https://ai.whyshy.cn/custom" }, { ...connection.config, baseUrl: "https://example.com" },
        { ...connection.config, manualProtocol: true }])
        expect(pdogImageQualityOptions(evidence.model, config)).toEqual(["low", "medium", "high"]);
      expect(pdogImageQualityOptions("gpt-image-2", connection.config)).toEqual(["low", "medium", "high"]);
      const changedGroup = applyPdogImageCapabilities({ ...connection, config: { ...connection.config, modelGroup: "生图1K", accountKeyGroup: "生图1K" } }, descriptor);
      expect(changedGroup.metadata?.pdogMeasuredQuality).toBeUndefined();
      expect(changedGroup.parameters?.find(p => p.key === "quality")?.default).toBe("high");
    },
  );

  it("locks 4K when only the ratio is automatic", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, parameters: { size: "auto", size_tier: "4K", aspect_ratio: "auto", quality: "high", n: 1 } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ size: "2880x2880" });
  });

  it("requires W/H when the selected ratio has no published default 1K pixels", async () => {
    const f = fixture();
    await expect(f.adapter.submit({ ...request, parameters: { size: "auto", aspect_ratio: "16:9", quality: "high", n: 1 } })).rejects.toThrow("填写独立 W/H");
    expect(f.fetch).not.toHaveBeenCalled();
    await f.adapter.submit({ ...request, parameters: { size: "auto", size_tier: "2K", aspect_ratio: "16:9", quality: "high", n: 1 } });
    const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
    expect(body.size).toBe("2048x1152");
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it.each(["1K", "2K", "4K"] as const)("does not invent a %s 5:4 mapping", async tier => {
    expect(pdogImageSizeForTier(tier, "5:4")).toBeUndefined();
    const f = fixture();
    const parameters = { size: "auto", size_tier: tier, aspect_ratio: "5:4", quality: "high" };
    await expect(f.adapter.submit({ ...request, parameters })).rejects.toThrow("填写独立 W/H");
    expect(parameters).toEqual({ size: "auto", size_tier: tier, aspect_ratio: "5:4", quality: "high" });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(["4096x4096", "1001x801", "5000x1000"])("sends open custom size %s without borrowed bounds", async size => {
    const f = fixture();
    await f.adapter.submit({ ...request, parameters: { size, quality: "high", n: 1 } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ size, quality: "high" });
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { size: "2048x896", aspect_ratio: "21:9" },
    { size: "896x2048", aspect_ratio: "9:21" },
  ])("sends PDog's exact rounded official 2K pair unchanged: %j", async published => {
    const f = fixture();
    const parameters = { ...published, size_tier: "2K", quality: "high", n: 1 };
    await f.adapter.submit({ ...request, parameters });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, size: published.size, quality: "high", n: 1 });
    expect(parameters).toEqual({ ...published, size_tier: "2K", quality: "high", n: 1 });
    f.fetch.mockClear();
    const [width, height] = published.size.split("x").map(Number);
    await f.adapter.submit({ ...request, parameters: { width, height, size_tier: "2K", aspect_ratio: published.aspect_ratio, quality: "high", n: 1 } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, size: published.size, quality: "high", n: 1 });
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { size: "2048x896", aspect_ratio: "3:2" },
    { size: "2050x896", aspect_ratio: "21:9" },
  ])("does not generalize the published rounded pair to wrong ratios or custom W/H: %j", async parameters => {
    const f = fixture();
    await expect(f.adapter.submit({ ...request, parameters: { ...parameters, quality: "high", n: 1 } })).rejects.toThrow("比例偏好不同");
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("maps independent W/H and preserves ratio, while rejecting conflicting saved constraints", async () => {
    const f = fixture();
    const parameters = { width: 1001, height: 801, size_tier: "4K", aspect_ratio: "5:4", quality: "high" };
    await f.adapter.submit({ ...request, parameters });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, size: "1001x801", quality: "high", n: 1 });
    expect(parameters).toEqual({ width: 1001, height: 801, size_tier: "4K", aspect_ratio: "5:4", quality: "high" });
    f.fetch.mockClear();
    await expect(f.adapter.submit({ ...request, parameters: { size: "1024x1024", aspect_ratio: "16:9" } })).rejects.toThrow("比例偏好不同");
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("honors an exact group's 1K declaration without borrowing the common guide's 4K", () => {
    const descriptor = applyPdogImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn", modelGroup: "生图1K" } }, { id: model, name: model, operations: ["image.generate"] });
    expect(descriptor.parameters?.find(p => p.key === "size_tier")?.options?.map(o => o.value)).toEqual(["auto", "1K"]);
    expect(descriptor.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(["auto", "1024x1024"]);
    expect(descriptor.metadata?.imageSupportedResolutions).toEqual(["1K"]);
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
    const f = fixture({ model: "gemini-3-pro-image", fetch: async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }) });
    const route = bananaImageRoute({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, "gemini-3-pro-image")!;
    const descriptor = applyBananaImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, { id: "gemini-3-pro-image", name: "gemini-3-pro-image", operations: ["image.generate"] });
    expect(route.ratios).toHaveLength(11);
    expect(descriptor.limits?.maxInputImages).toBeUndefined();
    expect(bananaImageRoute({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, "gemini-3-pro-image-preview")?.unavailableReason).toBeTruthy();
    const task = await f.adapter.submit({ ...request, model: "gemini-3-pro-image", parameters: { image_size: "2K", aspect_ratio: "9:21" } });
    expect(JSON.parse(String(f.fetch.mock.calls.at(-1)![1]?.body)).generationConfig.imageConfig.aspectRatio).toBe("9:21");
    expect(await f.adapter.extractOutputs(task.result)).toHaveLength(1);
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
    const f = fixture({ model: selected, fetch: async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }) });
    await f.adapter.submit({ ...request, model: selected, operation: "image.edit", parameters: { image_size: "2K", aspect_ratio: "1:1" },
      assets: [{ id: "reference", kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }] });
    const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: png } });
    expect(String(f.fetch.mock.calls[0]![0])).not.toContain("/images/");
  });
});

describe("PDog current Key Gemini inventory", () => {
  const selected = "gemini-3.6-flash-image";
  const response = { modelVersion: "upstream-alias", candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] };
  const blocked: ModelDescriptor = { id: selected, name: selected, operations: [], metadata: {
    canvasRunnable: false, canvasUnavailableReason: PDOG_GEMINI_LEGACY_UNAVAILABLE, autoInterfaceStatus: "incomplete", pendingLiveScan: true,
  } };

  it.each(["gemini-3-pro-image", "gemini-3.1-flash-image-preview", selected, "gemini-nano-banana-2.1", "gemini-future-image"])(
    "routes the exact inventory ID %s through the native contract without aliases", async id => {
      const f = fixture({ model: id, fetch: async () => Response.json(response) });
      const task = await f.adapter.submit({ ...request, model: id, parameters: {} });
      expect(String(f.fetch.mock.calls[0]![0])).toBe(`https://ai.whyshy.cn/v1beta/models/${id}:generateContent`);
      expect(new Headers(f.fetch.mock.calls[0]![1]?.headers).get("x-goog-api-key")).toBe("fixture-key");
      const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
      expect(body.contents).toEqual([{ role: "user", parts: [{ text: request.prompt }] }]);
      expect(body.generationConfig.responseModalities).toEqual(["IMAGE"]);
      if (!["gemini-3-pro-image", "gemini-3.1-flash-image-preview"].includes(id))
        expect(body.generationConfig).not.toHaveProperty("imageConfig");
      expect(task.status).toBe("succeeded");
      expect(await f.adapter.extractOutputs(task.result)).toHaveLength(1);
      expect(f.fetch).toHaveBeenCalledOnce();
    },
  );

  it("uses the just-read authenticated catalog instead of stale saved permissions when listing models", async () => {
    const ids = ["gemini-3-pro-image", "gemini-3.1-flash-image-preview", selected, "gemini-nano-banana-2.1"];
    const f = fixture({ model: selected, settings: { scannedModelIds: [], modelScanStatus: "unauthorized" },
      fetch: async () => Response.json({ data: ids.map(id => ({ id })) }) });
    const listed = await f.direct.listModels("pdog");
    expect(listed.map(model => model.id).sort()).toEqual(ids.sort());
    expect(listed.every(model => model.operations.includes("image.generate") && model.operations.includes("image.edit"))).toBe(true);
    expect(listed.every(model => model.metadata?.canvasRunnable !== false && model.metadata?.protocol === "gemini-generate-content")).toBe(true);
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it("repairs the exact stale documentation blocker using current Key evidence", async () => {
    const config = { baseUrl: "https://ai.whyshy.cn", scannedModelIds: [selected], modelScanStatus: "live" };
    const repaired = applyBananaImageCapabilities({ provider: "openai", config }, blocked);
    expect(repaired.operations).toEqual(["image.generate", "image.edit"]);
    expect(repaired.metadata).toMatchObject({ canvasRunnable: true, protocol: "gemini-generate-content" });
    expect(repaired.metadata?.canvasUnavailableReason).toBeUndefined();
    expect(repaired.metadata?.autoInterfaceStatus).toBeUndefined();
    expect(repaired.metadata?.pendingLiveScan).toBeUndefined();
    expect(repaired.parameters?.find(parameter => parameter.key === "image_size")?.default).toBe("auto");
    expect(repaired.limits?.maxInputImages).toBeUndefined();
    const f = fixture({ model: selected, settings: { modelCatalogModels: [blocked] }, fetch: async () => Response.json(response) });
    await f.adapter.submit({ ...request, model: selected, parameters: {} });
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { scannedModelIds: [] },
    { scannedModelIds: ["gemini-3-pro-image"] },
    { scannedModelIds: undefined },
    { modelScanStatus: "unauthorized" },
    { modelScanStatus: "empty" },
    { unavailableModels: [selected] },
    { unavailableModels: [{ id: selected, reason: "403" }] },
    { supplierArchived: true },
    { usage: "disabled" },
    { modelCatalogModels: [{ ...blocked, metadata: { canvasRunnable: false, canvasUnavailableReason: "403 Key 未授权" } }] },
  ])("keeps actual permission failures blocked before any request: %j", async settings => {
    const f = fixture({ model: selected, settings, fetch: async () => Response.json(response) });
    await expect(f.adapter.submit({ ...request, model: selected, parameters: {} })).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("preserves unrelated model rejection reasons and requires inventory evidence before repairing", () => {
    const denied = { ...blocked, metadata: { ...blocked.metadata, canvasUnavailableReason: "401 Key 未授权" } };
    expect(applyBananaImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn", scannedModelIds: [selected] } }, denied)).toBe(denied);
    expect(applyBananaImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn" } }, blocked)).toBe(blocked);
    expect(applyBananaImageCapabilities({ provider: "openai", config: { baseUrl: "https://genimage.pro", scannedModelIds: [selected] } }, blocked)).toBe(blocked);
    expect(bananaImageRoute({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn", scannedModelIds: ["gemini-future-text"] } }, "gemini-future-text")).toBeUndefined();
  });

  it("supports the native protocol on the direct adapter and inlines URL reference bytes", async () => {
    const f = fixture({ model: selected, fetch: async url => String(url) === "https://assets.example/ref.png"
      ? new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } }) : Response.json(response) });
    await f.direct.submit({ ...request, model: selected, operation: "image.edit", parameters: { image_size: "2K", aspect_ratio: "9:21" },
      assets: [{ id: "ref", kind: "image", mimeType: "image/png", url: "https://assets.example/ref.png" }] });
    const post = f.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(post).toHaveLength(1);
    expect(String(post[0]![0])).toBe(`https://ai.whyshy.cn/v1beta/models/${selected}:generateContent`);
    const body = JSON.parse(String(post[0]![1]?.body));
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: png } });
    expect(body.generationConfig.imageConfig).toEqual({ imageSize: "2K", aspectRatio: "9:21" });
    expect(JSON.stringify(body)).not.toContain("file_uri");
  });

  it.each([selected, "gemini-nano-banana-2.1"])("does not report a response without images as success or submit again for %s", async id => {
    const f = fixture({ model: id, fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: "cannot create image" }] } }] }) });
    await expect(f.adapter.submit({ ...request, model: id, parameters: {} })).rejects.toMatchObject({ details: {
      kind: "invalid_response", submissionMayHaveOccurred: true, retryable: false,
    } });
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it.each([401, 403])("preserves upstream HTTP %s without falling back to another generation endpoint", async status => {
    const f = fixture({ model: selected, fetch: async () => Response.json({ error: { message: "Key forbidden" } }, { status }) });
    await expect(f.adapter.submit({ ...request, model: selected, parameters: {} })).rejects.toMatchObject({ details: { status, phase: "submit" } });
    expect(f.fetch).toHaveBeenCalledOnce();
  });
});
