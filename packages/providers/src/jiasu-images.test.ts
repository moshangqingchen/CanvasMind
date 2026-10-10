import { describe, expect, it, vi } from "vitest";
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";
import type { ProviderTask } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { OpenAIImageAdapter } from "./openai.js";
import { JiasuImageAdapter, jiasuImageConnector, applyJiasuImageCapabilities, JIASU_IMAGE_MODELS, JIASU_RESOLUTION_IMAGE_MODELS,
  isJiasuImageConnection, jiasuImageQualities, jiasuImageSizes } from "./jiasu-images.js";
import { uploadJiasuMedia } from "./jiasu-media.js";

const baseUrl = "https://ai.jiasuapi.com/v1";
const request: NormalizedRequest = { connectionId: "jiasu", operation: "image.generate", model: "gpt-image-2.5-1k", prompt: "A ceramic cup", idempotencyKey: "only-one-submission" };
const reference = { id: "ref", kind: "image" as const, mimeType: "image/png", url: "https://m.jiasuapi.com/media/reference.png" };
const resolver = (settings: Record<string, unknown> = {}) => new StaticConnectionResolver([{ id: "jiasu", provider: "openai", baseUrl, apiKey: "fixture-key",
  settings: { usage: "canvas", accountKeyGroup: "vip", modelGroup: "vip", scannedModelIds: [...JIASU_IMAGE_MODELS], ...settings } }]);
const queued = () => Response.json({ id: "task_image_1", task_id: "task_image_1", status: "queued" });

describe("Jiasu full-model image contracts", () => {
  it.each(JIASU_IMAGE_MODELS)("submits %s with its exact parameters and polls the original image task", async model => {
    const fetch = vi.fn<FetchImplementation>(async (_url, init) => init?.method === "POST" ? queued() :
      Response.json({ code: "success", data: { task_id: "task_image_1", status: "SUCCESS", progress: "100%", result_url: "https://m.jiasuapi.com/media/result.png" } }));
    const adapter = new JiasuImageAdapter(resolver(), { fetch }, model);
    const task = await adapter.submit({ ...request, model });
    expect(task).toMatchObject({ providerTaskId: "task_image_1", status: "queued", result: { jiasuImage: true } });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://ai.jiasuapi.com/v1/images/create");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-key");
    expect(JSON.parse(String(init?.body))).toEqual(JIASU_RESOLUTION_IMAGE_MODELS.includes(model)
      ? { model, prompt: request.prompt, n: 1, resolution: "1K", ratio: "1:1" }
      : { model, prompt: request.prompt, n: 1, size: jiasuImageSizes(model)[0], quality: model === "gpt-image-2-high" ? "high" : "medium" });
    const restarted = new JiasuImageAdapter(resolver(), { fetch });
    const completed = await restarted.poll(JSON.parse(JSON.stringify(task)));
    expect(String(fetch.mock.calls[1]![0])).toBe("https://ai.jiasuapi.com/v1/images/tasks/task_image_1");
    expect(completed.status).toBe("succeeded");
    expect(await restarted.extractOutputs(completed.result)).toMatchObject([{ kind: "image", url: "https://m.jiasuapi.com/media/result.png" }]);
    expect(fetch.mock.calls.filter(([, call]) => call?.method === "POST")).toHaveLength(1);
  });
  it.each(["direct", "registry"])("routes existing %s entries through the exact supplier contract", async entry => {
    const fetch = vi.fn<FetchImplementation>(async url => String(url).endsWith("/models") ? Response.json({ data: JIASU_IMAGE_MODELS.map(id => ({ id })) }) : queued());
    const connections = resolver({ defaultModel: "gpt-image-2-4k" });
    const adapter = entry === "registry" ? createDefaultProviderRegistry(connections, { fetch }).get("openai") : new OpenAIImageAdapter(connections, { fetch });
    const listed = await adapter.listModels("jiasu");
    expect(listed).toHaveLength(9);
    expect(listed.every(model => model.metadata?.jiasuImageProtocol === 1 && model.operations.includes("image.edit"))).toBe(true);
    await adapter.submit({ ...request, model: "gpt-image-2-4k", operation: "image.edit", assets: [reference], parameters: { size: "4096x2304", quality: "medium", n: 1 } });
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(String(post[0])).toBe("https://ai.jiasuapi.com/v1/images/create");
    expect(JSON.parse(String(post[1]?.body))).toEqual({ model: "gpt-image-2-4k", prompt: request.prompt, size: "4096x2304", quality: "medium", n: 1, images: [reference.url] });
  });
  it("uses native free initialization and storage PUT for local references before one paid submission", async () => {
    const fetch = vi.fn<FetchImplementation>(async (url, init) => {
      if (String(url).endsWith("/media/uploads")) return Response.json({ success: true, data: { items: [{ url: "https://m.jiasuapi.com/media/uploaded.png",
        put: { url: "https://storage.example.com/reference.png?signature=fixture", method: "PUT", headers: { "content-type": "image/png", "x-storage-ticket": "fixture" } } }] } });
      if (init?.method === "PUT") return new Response(null, { status: 200 });
      return queued();
    });
    const adapter = new JiasuImageAdapter(resolver(), { fetch });
    await adapter.submit({ ...request, operation: "image.edit", assets: [{ id: "local", kind: "image", mimeType: "image/png", filename: "image.png", data: new Uint8Array([1, 2, 3]) }] });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(["https://ai.jiasuapi.com/v1/media/uploads", "https://storage.example.com/reference.png?signature=fixture", "https://ai.jiasuapi.com/v1/images/create"]);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ items: [{ name: "image.png", content_type: "image/png", size: 3, kind: "image" }] });
    const putHeaders = new Headers(fetch.mock.calls[1]![1]?.headers);
    expect(putHeaders.get("Authorization")).toBeNull();
    expect(putHeaders.get("x-storage-ticket")).toBe("fixture");
    expect(JSON.parse(String(fetch.mock.calls[2]![1]?.body))).toMatchObject({ images: ["https://m.jiasuapi.com/media/uploaded.png"] });
  });
  it("does not submit generation after a failed storage PUT", async () => {
    const fetch = vi.fn<FetchImplementation>(async (_url, init) => init?.method === "PUT" ? new Response("unavailable", { status: 503 }) :
      Response.json({ success: true, data: { items: [{ url: "https://m.jiasuapi.com/media/new.png", put: { url: "https://storage.example.com/new.png", method: "PUT" } }] } }));
    const adapter = new JiasuImageAdapter(resolver(), { fetch });
    await expect(adapter.submit({ ...request, operation: "image.edit", assets: [{ ...reference, data: new Uint8Array([1]) }] })).rejects.toThrow(/503/u);
    expect(fetch.mock.calls).toHaveLength(2);
  });
  it.each(["NOT_START", "SUBMITTED", "QUEUED", "IN_PROGRESS", "UNKNOWN", "FAILURE"])("maps documented status %s without falling back to another generation request", async status => {
    const fetch = vi.fn<FetchImplementation>(async (_url, init) => init?.method === "POST" ? queued() : Response.json({ code: "success", data: { status, fail_reason: "upstream failure" } }));
    const adapter = new JiasuImageAdapter(resolver(), { fetch });
    const task = await adapter.submit(request);
    const polled = await adapter.poll(task);
    expect(polled.status).toBe(status === "FAILURE" ? "failed" : ["NOT_START", "SUBMITTED", "QUEUED"].includes(status) ? "queued" : "running");
    if (status === "FAILURE") expect(polled.error).toBe("upstream failure");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("rejects missing task IDs and missing completed outputs with no implicit resubmission", async () => {
    const missingId = vi.fn<FetchImplementation>(async () => Response.json({ status: "queued" }));
    await expect(new JiasuImageAdapter(resolver(), { fetch: missingId }).submit(request)).rejects.toMatchObject({ details: { retryable: false, submissionMayHaveOccurred: true } });
    expect(missingId).toHaveBeenCalledOnce();
    const missingOutput = vi.fn<FetchImplementation>(async (_url, init) => init?.method === "POST" ? queued() : Response.json({ code: "success", data: { status: "SUCCESS" } }));
    const adapter = new JiasuImageAdapter(resolver(), { fetch: missingOutput });
    await expect(adapter.poll(await adapter.submit(request))).rejects.toMatchObject({ details: { phase: "poll", retryable: true, submissionMayHaveOccurred: true } });
    expect(missingOutput.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it.each([
    { model: "gpt-image-2.5-1k", parameters: { size: "1K" } },
    { model: "gpt-image-2.5-1k", parameters: { resolution: "4K" } },
    { model: "gpt-image-2.5-1k", parameters: { ratio: "21:9" } },
    { model: "gpt-image-2.5-1k", parameters: { quality: "high" } },
    { model: "gpt-image-2.5-sunburst-1k", parameters: { output_format: "png" } },
    { model: "gpt-image-2-4k", parameters: { quality: "high" } },
    { model: "gpt-image-2-4k", parameters: { size: "3840x2160" } },
    { model: "gpt-image-2-2k", parameters: { resolution: "2K" } },
    { model: "gpt-image-2-high", parameters: { quality: "max" } },
    { model: "gpt-image-2-1k", parameters: { n: 2 } },
    { model: "gpt-image-2.5-1k", parameters: { resolution: "1K", image_size: "4K" } },
    { model: "gpt-image-2.5-1k", parameters: { resolution: "1K", size_tier: "4K" } },
    { model: "gpt-image-2.5-1k", parameters: { ratio: "1:1", aspect_ratio: "9:16" } },
    { model: "gpt-image-2.5-1k", parameters: { ratio: "1:1", aspectRatio: "9:16" } },
    { model: "gpt-image-2.5-1k", parameters: { ratio: "1:1", aspect_ratio: "21:9" } },
    { model: "gpt-image-2.5-1k", parameters: { width: 1024, height: 1024 } },
    { model: "gpt-image-2-4k", parameters: { size: "4096x4096", width: 3840 } },
    { model: "gpt-image-2-1k", parameters: { size: "1024x1024", aspectRatio: "9:16" } },
  ])("validates exact model-card constraints before submit: $model $parameters", async changed => {
    const fetch = vi.fn<FetchImplementation>(async () => queued());
    const adapter = new JiasuImageAdapter(resolver(), { fetch });
    await expect(adapter.submit({ ...request, ...changed })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["aspect_ratio", "aspectRatio"])("preserves a saved legal %s alias in the actual request", async key => {
    const fetch = vi.fn<FetchImplementation>(async () => queued());
    const adapter = new JiasuImageAdapter(resolver(), { fetch });
    await adapter.submit({ ...request, parameters: { image_size: "1k", [key]: "9:16" } });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ model: request.model, prompt: request.prompt, resolution: "1K", ratio: "9:16", n: 1 });
  });
  it.each([{ scannedModelIds: ["gpt-image-2-high"] }, { modelScanStatus: "unauthorized" }, { modelScanStatus: "empty" },
    { usage: "disabled" }, { supplierArchived: true }, { accountKeyGroup: "other" }])("preserves current Key and group permission restrictions", async settings => {
    const fetch = vi.fn<FetchImplementation>(async () => queued());
    await expect(new JiasuImageAdapter(resolver(settings), { fetch }).submit(request)).rejects.toThrow(/权限/u);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts only the actual origin and exact model IDs", () => {
    expect(isJiasuImageConnection({ baseUrl }, "gpt-image-2-4k")).toBe(true);
    for (const url of ["https://ai.jiasuapi.com.example/v1", "https://user@ai.jiasuapi.com/v1", "http://ai.jiasuapi.com", "https://ai.jiasuapi.com/custom"])
      expect(isJiasuImageConnection({ baseUrl: url }, "gpt-image-2-4k")).toBe(false);
    expect(isJiasuImageConnection({ baseUrl }, "gpt-image-2.5")).toBe(false);
    for (const model of JIASU_IMAGE_MODELS) {
      const descriptor = applyJiasuImageCapabilities({ provider: "openai", config: { baseUrl, scannedModelIds: [model] } },
        { id: model, name: model, operations: [], metadata: { canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "供应商接口说明待补充", retained: true } });
      expect(descriptor.metadata).toMatchObject({ canvasRunnable: true, retained: true, jiasuImageProtocol: 1, imageNativeResolutionOptions: true });
      expect(descriptor.metadata).not.toHaveProperty("canvasUnavailableReason");
      expect(descriptor.parameters?.find(item => item.key === "quality")?.options?.map(item => item.value)).toEqual(JIASU_RESOLUTION_IMAGE_MODELS.includes(model) ? ["auto"] : jiasuImageQualities(model));
      expect(jiasuImageConnector(model).submit.path).toBe("/v1/images/create");
    }
  });
  it("does not invent transparency or mask support and respects the exact five-reference cap", async () => {
    const fetch = vi.fn<FetchImplementation>(async () => queued());
    const adapter = new JiasuImageAdapter(resolver(), { fetch });
    await expect(adapter.submit({ ...request, parameters: { background: "transparent" } })).rejects.toThrow(/透明/u);
    await expect(adapter.submit({ ...request, operation: "image.edit", assets: [reference, { ...reference, role: "mask" }] })).rejects.toThrow(/蒙版/u);
    await expect(adapter.submit({ ...request, operation: "image.edit", assets: Array.from({ length: 6 }, (_, index) => ({ ...reference, id: String(index) })) })).rejects.toThrow(/五/u);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { operations: [], outputKinds: ["text"], metadata: { operationsSource: "declared", outputKindsSource: "declared", canvasRunnable: false } },
    { operations: ["image.generate"], outputKinds: ["image"], metadata: { canvasRunnable: false, canvasUnavailableReason: "manual pause" } },
    { operations: ["image.generate"], outputKinds: ["text"], metadata: { outputKindsSource: "declared", canvasRunnable: true } },
  ])("does not restore explicit non-image or manual access exclusions: $metadata", async blocked => {
    const fetch = vi.fn<FetchImplementation>(async () => queued());
    const saved = { id: request.model, name: request.model, ...blocked };
    const adapter = new JiasuImageAdapter(resolver({ modelCatalogModels: [saved] }), { fetch });
    expect((await adapter.validate(request)).valid).toBe(false);
    await expect(adapter.submit(request)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses refreshed full-model size and quality facts for both controls and validation", async () => {
    const model = "gpt-image-2-4k";
    const saved = { id: model, name: model, operations: ["image.generate" as const], metadata: { canvasRunnable: true, jiasuCatalogRecord: {
      apiParameters: [{ name: "size", range: "4096×3072，3072×4096" }, { name: "quality", range: "auto, low", default: "low" }, { name: "n", range: "1", default: "1" }],
    } } };
    const descriptor = applyJiasuImageCapabilities({ provider: "openai", config: { baseUrl, scannedModelIds: [model] } }, saved);
    expect(descriptor.parameters?.find(item => item.key === "size")?.options?.map(item => item.value)).toEqual(["4096x3072", "3072x4096"]);
    expect(descriptor.parameters?.find(item => item.key === "quality")?.options?.map(item => item.value)).toEqual(["auto", "low"]);
    const fetch = vi.fn<FetchImplementation>(async () => queued());
    const adapter = new JiasuImageAdapter(resolver({ modelCatalogModels: [saved] }), { fetch });
    await expect(adapter.submit({ ...request, model, parameters: { size: "4096x4096", quality: "medium" } })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await adapter.submit({ ...request, model });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ model, prompt: request.prompt, size: "4096x3072", quality: "low", n: 1 });
  });
  it("keeps already public media URLs and duration metadata without initializing another upload", async () => {
    const fetch = vi.fn<FetchImplementation>();
    const connection = await resolver().resolve("jiasu");
    const assets = [reference, { id: "video", kind: "video" as const, mimeType: "video/mp4", url: "https://m.jiasuapi.com/media/ref.mp4", durationSeconds: 10 }];
    expect(await uploadJiasuMedia(connection, assets, { fetch })).toEqual(assets);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { shape: "documented success", response: { code: "success", data: { task_id: "task_original", status: "SUCCESS", progress: "100%", result_url: "https://m.jiasuapi.com/media/fixture-completed.png" } }, status: "succeeded", count: 1 },
    { shape: "production completed", response: { id: "task_original", object: "image", model: request.model, status: "completed", progress: 100, result_urls: ["https://m.jiasuapi.com/media/fixture-completed.png", "https://m.jiasuapi.com/media/fixture-second.png"] }, status: "succeeded", count: 2 },
    { shape: "documented failure", response: { code: "success", data: { task_id: "task_original", status: "FAILURE", progress: "100%", fail_reason: "fixture upstream failure" } }, status: "failed", count: 0 },
    { shape: "production failed", response: { id: "task_original", object: "image", model: request.model, status: "failed", progress: 100, result_urls: [], error: { message: "fixture upstream failure", code: "provider_failed" } }, status: "failed", count: 0 },
  ])("repairs persisted legacy task polling for $shape through both entry points without another POST", async example => {
    for (const entry of ["direct", "registry"]) {
      const config = jiasuImageConnector(request.model!);
      // Freeze exactly the old guide-only mappings, as serialized before the real response was discovered.
      config.poll!.response = { statusPath: "$.data.status", progressPath: "$.data.progress", errorPath: "$.data.fail_reason", errorFallbackPaths: ["$.data.error.message", "$.message"] };
      config.output = { path: "$.data.result_url", kind: "image", urlPath: "$.url", requireOutput: true };
      const saved: ProviderTask = { providerTaskId: "task_original", id: "local-retained-task", status: "running", result: {
        connectionId: "jiasu", config, remote: { id: "task_original", status: "queued" }, baseUrl, taskId: "task_original", model: request.model,
        jiasuImage: true, autoInterface: entry === "registry", retainedMetadata: "unchanged",
      } };
      const snapshot = JSON.stringify(saved);
      const fetch = vi.fn<FetchImplementation>(async () => Response.json(example.response));
      const adapter = entry === "registry" ? createDefaultProviderRegistry(resolver(), { fetch }).get("openai") : new OpenAIImageAdapter(resolver(), { fetch });
      const state = await adapter.poll!(JSON.parse(snapshot));
      expect(state).toMatchObject({ providerTaskId: "task_original", id: "local-retained-task", status: example.status, progress: 1 });
      const result = state.result as Record<string, unknown>;
      expect(result).toMatchObject({ taskId: "task_original", model: request.model, baseUrl, retainedMetadata: "unchanged" });
      expect((result.config as ReturnType<typeof jiasuImageConnector>).submit).toEqual(config.submit);
      expect(await adapter.extractOutputs(state.result)).toHaveLength(example.count);
      if (example.status === "failed") expect(state.error).toBe("fixture upstream failure");
      expect(JSON.stringify(saved)).toBe(snapshot);
      expect(fetch).toHaveBeenCalledOnce();
      expect(String(fetch.mock.calls[0]![0])).toBe("https://ai.jiasuapi.com/v1/images/tasks/task_original");
      expect(fetch.mock.calls[0]![1]?.method).toBe("GET");
    }
  });
  it("extracts flattened outputs from a previously saved completed result without submitting or polling", async () => {
    const config = jiasuImageConnector(request.model!);
    config.output = { path: "$.data.result_url", kind: "image", urlPath: "$.url" };
    const fetch = vi.fn<FetchImplementation>();
    const result = { jiasuImage: true, connectionId: "jiasu", baseUrl, model: request.model, taskId: "task_original", status: "succeeded", config,
      remote: { id: "task_original", object: "image", status: "completed", result_urls: ["https://m.jiasuapi.com/media/fixture-completed.png"] } };
    for (const adapter of [new JiasuImageAdapter(resolver(), { fetch }), createDefaultProviderRegistry(resolver(), { fetch }).get("openai")])
      expect(await adapter.extractOutputs(JSON.parse(JSON.stringify({ ...result, autoInterface: true })))).toMatchObject([{ kind: "image", url: "https://m.jiasuapi.com/media/fixture-completed.png" }]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
