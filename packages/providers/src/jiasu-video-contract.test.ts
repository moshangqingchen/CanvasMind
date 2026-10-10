import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, NormalizedRequest, ProviderAdapter, ProviderAssetInput, ProviderTask } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { scanProviderModelCatalog } from "./model-catalog.js";
import { isJiasuApiUrl, jiasuVideoModel, jiasuVideoModelIds, jiasuVideoRequestIssues, normalizeJiasuVideoParameters, jiasuVideoTransport } from "./jiasu-video-contract.js";
import { remainingVideoSupplier, remainingVideoModel, restoreRemainingVideoModel } from "./remaining-video-contracts.js";
import { GenericRestAdapter } from "./rest.js";

const image: ProviderAssetInput = { id: "image", kind: "image", mimeType: "image/png", url: "https://media.example/image.png" };
const video: ProviderAssetInput = { id: "video", kind: "video", mimeType: "video/mp4", url: "https://media.example/video.mp4", durationSeconds: 6 };
const audio: ProviderAssetInput = { id: "audio", kind: "audio", mimeType: "audio/mpeg", url: "https://media.example/audio.mp3", durationSeconds: 3 };
const request = (model = "sd-2.0-J2", parameters: Record<string, unknown> = {}, assets: readonly ProviderAssetInput[] = []): NormalizedRequest => ({ model, parameters, assets, connectionId: "isolated-jiasu", prompt: "Ocean sunrise", operation: "video.generate", idempotencyKey: "single-jiasu-submit" });

function fixture(modelId = "sd-2.0-J2", responses: Response[] = [], extra: Record<string, unknown> = {}, modelOverride?: ModelDescriptor) {
  const model = modelOverride ?? remainingVideoModel("jiasu", modelId)!;
  const resolver = new StaticConnectionResolver([{ id: "isolated-jiasu", provider: "openai", apiKey: "isolated-original-key", baseUrl: "https://ai.jiasuapi.com/v1",
    settings: { scannedModelIds: [modelId], modelCatalogModels: [model], modelScanStatus: "live", usage: "canvas", accountKeyGroup: "vip", ...extra } }]);
  const fallback: ProviderAdapter = { testConnection: vi.fn(), listModels: vi.fn(async () => []), validate: vi.fn(async () => ({ valid: true, issues: [] })),
    submit: vi.fn(async () => { throw new Error("unexpected Images submission"); }), poll: vi.fn(async () => { throw new Error("unexpected Images poll"); }), extractOutputs: vi.fn(async () => []) };
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("unexpected network"); });
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  return { adapter: new AutoInterfaceAdapter(resolver, fallback, { fetch: fetcher }), fetcher, fallback, resolver };
}

describe("Jiasu exact video supplier contract", () => {
  it("scopes the transport to the documented origin and API prefix", () => {
    expect(remainingVideoSupplier("https://ai.jiasuapi.com/v1")).toBe("jiasu");
    for (const value of ["https://other.example/v1", "https://ai.jiasuapi.com/proxy/v1", "http://ai.jiasuapi.com/v1", "https://ai.jiasuapi.com/v1?key=secret", "https://user@ai.jiasuapi.com/v1"]) expect(isJiasuApiUrl(value)).toBe(false);
  });

  it("classifies every published complete video ID, including short aliases, without borrowing another supplier", () => {
    const ids = jiasuVideoModelIds();
    expect(ids).toHaveLength(27);
    const scan = scanProviderModelCatalog({ data: ids.map(id => ({ id })) }, { baseUrl: "https://ai.jiasuapi.com/v1", modelGroup: "vip" });
    expect(scan.models.every(model => model.outputKinds?.includes("video") && model.metadata?.canvasRunnable === true)).toBe(true);
    expect(scanProviderModelCatalog({ data: [{ id: "sd-2.0-J2" }] }, { baseUrl: "https://other.example/v1" }).models[0]?.operations).toEqual([]);
  });

  it("keeps exact model limits and conditional 720p mini duration", () => {
    const mini = jiasuVideoModel("sd-2.0-mini-J1")!;
    expect(mini.limits).toMatchObject({ maxInputImages: 9, maxInputVideos: 0, maxInputAudios: 3 });
    expect(mini.parameters?.find(parameter => parameter.key === "duration")?.default).toBe(12);
    expect(jiasuVideoRequestIssues(request(mini.id, { duration: 15, resolution: "720p" }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    expect(jiasuVideoRequestIssues(request(mini.id, { duration: 15, resolution: "480p" }))).toEqual([]);
    expect(jiasuVideoRequestIssues(request(mini.id, {}, [video]))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "assets" })]));
    expect(jiasuVideoRequestIssues(request("sd-2.5-J2", { duration: 30, resolution: "720p" }))).toEqual([]);
    expect(jiasuVideoRequestIssues(request("wan3", { duration: 14 }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
  });

  it("lets current exact catalog declarations replace the capture and leaves unknown ranges optional", () => {
    const model: ModelDescriptor = { id: "new-jiasu-video", name: "new", operations: [], metadata: { jiasuCatalogRecord: { supportedEndpointTypes: ["openai-video"], description: "最多 2图 0视频 0音频", apiParameters: [{ name: "duration", type: "integer", required: true, default: "8", range: "6-10" }, { name: "resolution", range: "1080p", default: "1080p" }] } } };
    expect(jiasuVideoModel(model.id, model)?.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ default: 8, min: 6, max: 10 });
    expect(normalizeJiasuVideoParameters(request(model.id), model)).toEqual({ duration: 8, ratio: "16:9", resolution: "1080p" });
    const unknown = jiasuVideoModel("sd-2.0-fast-803-J3")!;
    expect(unknown.parameters?.find(parameter => parameter.key === "duration")?.default).toBeUndefined();
    expect(normalizeJiasuVideoParameters(request(unknown.id))).toEqual({ ratio: "16:9" });
    expect(jiasuVideoModel("gpt-image-2-1k")).toBeUndefined();
  });

  it("uses exact vip response evidence for generation without treating billing enums as supported resolutions", async () => {
    for (const id of ["doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"]) {
      const model = jiasuVideoModel(id, undefined, "vip")!;
      expect(model.parameters?.find(parameter => parameter.key === "resolution")).toMatchObject({ default: "720p", options: [{ label: "720p", value: "720p" }] });
      expect(model.metadata?.jiasuResolutionEvidence).toMatchObject({ sourceUrl: "https://ai.jiasuapi.com", group: "vip", modelId: id, phase: "submit", httpStatus: 400, message: "分辨率仅支持 720p" });
      expect(normalizeJiasuVideoParameters(request(id), model)).toEqual({ ratio: "16:9", resolution: "720p" });
      const f = fixture(id);
      expect(await f.adapter.validate(request(id))).toEqual({ valid: true, issues: [] });
      for (const resolution of ["480p", "1080p"]) {
        const input = request(id, { resolution });
        expect((await f.adapter.validate(input)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.resolution", message: expect.stringContaining("仅支持 720p") })]));
        await expect(f.adapter.submit(input)).rejects.toThrow("仅支持 720p");
      }
      expect(f.fetcher).not.toHaveBeenCalled();
      const submitted = fixture(id, [Response.json({ id: "task_exact_vip_resolution", status: "queued" })]);
      await submitted.adapter.submit(request(id));
      expect(JSON.parse(String(submitted.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: "Ocean sunrise", ratio: "16:9", resolution: "720p" });
      expect(submitted.fetcher).toHaveBeenCalledTimes(1);
      const anotherGroup = jiasuVideoModel(id, model, "another-group")!;
      expect(anotherGroup.parameters?.find(parameter => parameter.key === "resolution")?.options).toEqual([]);
      expect(anotherGroup.metadata?.jiasuResolutionEvidence).toBeUndefined();
    }
    expect(jiasuVideoModel("doubao-seedance-2-0-fast-260128", undefined, "vip")?.metadata?.jiasuResolutionEvidence).toBeUndefined();
  });

  it("preserves unconfirmed saved values but rejects them before either adapter can send a request", async () => {
    const id = "seedance2.5-全参真人", model = jiasuVideoModel(id, undefined, "vip")!;
    expect(model.metadata).toMatchObject({ durationRangeUnverified: true, resolutionRangeUnverified: true });
    const duration = model.parameters?.find(parameter => parameter.key === "duration");
    expect(duration).toMatchObject({ control: "number", valueType: "integer" });
    expect(duration).not.toHaveProperty("min");
    expect(duration).not.toHaveProperty("max");
    expect(duration).not.toHaveProperty("default");
    expect(model.parameters?.find(parameter => parameter.key === "resolution")).toMatchObject({ control: "select", options: [] });
    const f = fixture(id, [], { modelGroup: "vip", connector: { ...jiasuVideoTransport(), models: [model], restrictModels: true } }, model);
    const direct = new GenericRestAdapter(f.resolver, { fetch: f.fetcher });
    for (const adapter of [f.adapter, direct]) {
      for (const parameters of [{ duration: 35, resolution: "720p" }, { seconds: 38, resolution: "1080p" }]) {
        const input = request(id, parameters), before = structuredClone(input);
        expect(normalizeJiasuVideoParameters(input, model)).toMatchObject({ duration: parameters.duration ?? parameters.seconds, resolution: parameters.resolution });
        const result = await adapter.validate(input);
        expect(result.issues).toEqual(expect.arrayContaining([
          expect.objectContaining({ path: "parameters.duration", message: expect.stringContaining("恢复供应商默认") }),
          expect.objectContaining({ path: "parameters.resolution", message: expect.stringContaining("恢复供应商默认") }),
        ]));
        await expect(adapter.submit(input)).rejects.toThrow("恢复供应商默认");
        expect(input).toEqual(before);
      }
      expect(await adapter.validate(request(id))).toEqual({ valid: true, issues: [] });
    }
    expect(normalizeJiasuVideoParameters(request(id), model)).toEqual({ ratio: "16:9" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("rebuilds range provenance from current exact declarations and retains only legal defaults", () => {
    const id = "seedance2.5-全参真人";
    const current: ModelDescriptor = { id, name: id, operations: [], metadata: {
      durationRangeUnverified: true, resolutionRangeUnverified: true, priceLabel: "¥1.1/请求",
      jiasuCatalogRecord: { apiParameters: [{ name: "duration", range: "6-10", default: "38" }, { name: "resolution", range: "1080p", default: "1080p" }] },
    } };
    const refreshed = jiasuVideoModel(id, current)!;
    expect(refreshed.metadata).not.toHaveProperty("durationRangeUnverified");
    expect(refreshed.metadata).not.toHaveProperty("resolutionRangeUnverified");
    expect(refreshed.metadata?.priceLabel).toBe("¥1.1/请求");
    expect(refreshed.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 6, max: 10 });
    expect(refreshed.parameters?.find(parameter => parameter.key === "duration")).not.toHaveProperty("default");
    expect(jiasuVideoRequestIssues(request(id, { duration: 8, resolution: "1080p" }), refreshed)).toEqual([]);
    expect(jiasuVideoRequestIssues(request(id, { duration: 38 }), refreshed)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    const sparse = jiasuVideoModel(id, { ...refreshed, metadata: { ...refreshed.metadata, jiasuCatalogRecord: { apiParameters: [] } } })!;
    expect(sparse.metadata).toMatchObject({ durationRangeUnverified: true, resolutionRangeUnverified: true });
    expect(sparse.metadata).not.toHaveProperty("videoParameterConfirmedDefaults");
    expect(sparse.parameters?.find(parameter => parameter.key === "duration")).not.toHaveProperty("max");
  });

  it("accepts exact duration enums and published defaults without inventing missing ranges", () => {
    const id = "seedance2.5-全参真人";
    const current = (apiParameters: Record<string, unknown>[]): ModelDescriptor => ({ id, name: id, operations: [], metadata: { jiasuCatalogRecord: { apiParameters } } });
    const enumerated = jiasuVideoModel(id, current([{ name: "duration", range: "5, 10, 15", default: "10" }]))!;
    expect(enumerated.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ control: "select", default: 10, options: [{ label: "5 秒", value: 5 }, { label: "10 秒", value: 10 }, { label: "15 秒", value: 15 }] });
    expect(enumerated.metadata).not.toHaveProperty("durationRangeUnverified");
    expect(jiasuVideoRequestIssues(request(id, { duration: 6 }), enumerated)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    const defaults = jiasuVideoModel(id, current([{ name: "duration", default: "8" }, { name: "resolution", default: "1080p" }]))!;
    expect(defaults.metadata).toMatchObject({ durationRangeUnverified: true, resolutionRangeUnverified: true, videoParameterConfirmedDefaults: { duration: 8, resolution: "1080p" } });
    expect(defaults.parameters?.find(parameter => parameter.key === "resolution")?.options).toEqual([{ label: "1080p（供应商默认）", value: "1080p" }]);
    expect(normalizeJiasuVideoParameters(request(id), defaults)).toEqual({ duration: 8, ratio: "16:9", resolution: "1080p" });
    expect(jiasuVideoRequestIssues(request(id), defaults)).toEqual([]);
    expect(jiasuVideoRequestIssues(request(id, { duration: 9, resolution: "720p" }), defaults)).toHaveLength(2);
  });

  it("uses proven defaults through actual adapters while blocking every other unknown-range value offline", async () => {
    const id = "seedance2.5-全参真人";
    const model = jiasuVideoModel(id, { id, name: id, operations: [], metadata: {
      jiasuCatalogRecord: { apiParameters: [{ name: "duration", default: "8" }, { name: "resolution", default: "1080p" }] },
    } }, "vip")!;
    for (const direct of [false, true]) {
      const f = fixture(id, [Response.json({ id: "offline_confirmed_default", status: "queued" })],
        { modelGroup: "vip", connector: { ...jiasuVideoTransport(), models: [model], restrictModels: true } }, model);
      const adapter = direct ? new GenericRestAdapter(f.resolver, { fetch: f.fetcher }) : f.adapter;
      for (const parameters of [{}, { duration: 8, resolution: "1080p" }, { seconds: 8, resolution: "1080p" }])
        expect(await adapter.validate(request(id, parameters))).toEqual({ valid: true, issues: [] });
      for (const parameters of [{ duration: 38 }, { resolution: "720p" }]) {
        expect((await adapter.validate(request(id, parameters))).valid).toBe(false);
        await expect(adapter.submit(request(id, parameters))).rejects.toThrow("恢复供应商默认");
      }
      expect(f.fetcher).not.toHaveBeenCalled();
      await adapter.submit(request(id));
      expect(f.fetcher).toHaveBeenCalledOnce();
      expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ duration: 8, resolution: "1080p" });
    }
    const refreshed = jiasuVideoModel(id, { ...model, metadata: { ...model.metadata, jiasuCatalogRecord: { apiParameters: [] } } }, "vip")!;
    expect(refreshed.metadata).not.toHaveProperty("videoParameterConfirmedDefaults");
    expect(normalizeJiasuVideoParameters(request(id), refreshed)).toEqual({ ratio: "16:9" });
    expect(jiasuVideoRequestIssues(request(id, { duration: 8, resolution: "1080p" }), refreshed)).toHaveLength(2);
  });

  it("blocks observed sd-2.5-J2 480p failure in vip while retaining official ranges and prices", async () => {
    const original = jiasuVideoModel("sd-2.5-J2")!;
    const officialPrice = { tiers: [{ resolution: "480p", price: "0.4" }, { resolution: "720p", price: "0.65" }, { resolution: "1080p", price: "1.1" }] };
    const supplied = { ...original, metadata: { ...original.metadata, officialCatalogPricing: officialPrice, jiasuCatalogRecord: { apiParameters: [{ name: "resolution", range: "480p, 720p, 1080p", default: "720p" }] } } };
    const model = jiasuVideoModel(original.id, supplied, "vip")!;
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["720p", "1080p"]);
    expect(model.metadata?.jiasuDeclaredResolutions).toEqual(["480p", "720p", "1080p"]);
    expect(model.metadata?.officialCatalogPricing).toEqual(officialPrice);
    expect(model.metadata?.jiasuCatalogRecord).toEqual(supplied.metadata.jiasuCatalogRecord);
    expect(model.metadata?.jiasuResolutionEvidence).toMatchObject({ group: "vip", phase: "poll", rejectedResolutions: ["480p"], message: "resolution 480P is not supported for this video model" });
    const transport = jiasuVideoTransport(), f = fixture(original.id, [], { modelGroup: "vip", connector: { ...transport, models: [supplied], restrictModels: true } }, supplied);
    const direct = new GenericRestAdapter(f.resolver, { fetch: f.fetcher });
    for (const adapter of [f.adapter, direct]) {
      const bad = request(original.id, { duration: 5, resolution: "480p" });
      expect((await adapter.validate(bad)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.resolution", message: expect.stringContaining("480p 任务实际失败") })]));
      await expect(adapter.submit(bad)).rejects.toThrow("480p 任务实际失败");
      for (const resolution of ["720p", "1080p"]) expect((await adapter.validate(request(original.id, { duration: 5, resolution }))).valid).toBe(true);
    }
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(normalizeJiasuVideoParameters(request(original.id, { resolution: "480p" }), model).resolution).toBe("480p");
    expect(jiasuVideoModel(original.id, model, "another-group")?.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["480p", "720p", "1080p"]);
    expect(jiasuVideoModel("sd-2.0-mini-J1", undefined, "vip")?.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toContain("480p");
  });

  it("encodes named references and images[].type frames without deprecated top-level fields", () => {
    const p = normalizeJiasuVideoParameters(request("sd-2.0-J2", { images: [{ url: "https://media.example/person.png", name: "角色一" }] }, [image, { ...image, id: "first", role: "firstFrame", url: "https://media.example/first.png" }, { ...image, id: "last", role: "lastFrame", url: "https://media.example/last.png" }, video, audio]));
    expect(p.images).toEqual([{ url: "https://media.example/person.png", name: "角色一" }, image.url, { url: "https://media.example/first.png", type: "first_frame" }, { url: "https://media.example/last.png", type: "end_frame" }]);
    expect(p.videos).toEqual([video.url]);
    expect(p.audios).toEqual([audio.url]);
    expect(p).not.toHaveProperty("first_frame");
    expect(jiasuVideoRequestIssues(request("sd-2.0-J2", { first_frame: image.url }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.first_frame" })]));
  });

  it("counts mixed materials with all native arrays and validates malformed public URLs", () => {
    const materials = [{ type: "image", url: "https://media.example/m.png", name: "风景" }];
    expect(jiasuVideoRequestIssues(request("grok-1.5", { materials, images: Array.from({ length: 7 }, () => image.url) }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "assets" })]));
    expect(jiasuVideoRequestIssues(request("sd-2.0-J2", { materials: [{ type: "video", url: "https://127.0.0.1/private" }] }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.materials" })]));
    expect(jiasuVideoRequestIssues(request("sd-2.0-J2", { images: image.url }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.images" })]));
  });

  it("rejects first/end frame audio combinations before submission, including mixed materials", async () => {
    const cases = [
      request("sd-2.0-J2", { images: [{ url: image.url, type: "first_frame" }], audios: [audio.url] }),
      request("sd-2.0-J2", { images: [{ url: image.url, type: "end_frame" }], materials: [{ type: "audio", url: audio.url }] }),
      request("sd-2.0-J2", {}, [{ ...image, role: "firstFrame" }, audio]),
    ];
    for (const input of cases) {
      const f = fixture(input.model);
      expect((await f.adapter.validate(input)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("首尾帧生成不能同时使用参考音频") })]));
      await expect(f.adapter.submit(input)).rejects.toThrow("首尾帧生成不能同时使用参考音频");
      expect(f.fetcher).not.toHaveBeenCalled();
    }
    const f = fixture();
    expect(await f.adapter.validate(request("sd-2.0-J2", {}, [image, video, audio]))).toEqual({ valid: true, issues: [] });
    expect(await f.adapter.validate(request("sd-2.0-J2", {}, [
      { ...image, role: "firstFrame", url: "https://media.example/first.png" },
      { ...image, role: "lastFrame", url: "https://media.example/last.png" }, image, video,
    ]))).toEqual({ valid: true, issues: [] });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("enforces documented face modes and requires a mode when enabled before submission", async () => {
    for (const face of [{ enabled: true }, { enabled: true, mode: "unknown" }, { enabled: false, mode: "unknown" }]) {
      const f = fixture();
      const input = request("sd-2.0-J2", { face });
      expect((await f.adapter.validate(input)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.face.mode" })]));
      await expect(f.adapter.submit(input)).rejects.toThrow(/light|heavy/u);
      expect(f.fetcher).not.toHaveBeenCalled();
    }
    const f = fixture();
    for (const face of [{ enabled: true, mode: "light" }, { enabled: true, mode: "heavy" }, { enabled: false }])
      expect(await f.adapter.validate(request("sd-2.0-J2", { face }))).toEqual({ valid: true, issues: [] });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("uses minimax-h3's exact catalog ranges separately from the dedicated fixed-duration model", () => {
    expect(normalizeJiasuVideoParameters(request("minimax-h3", {}, [video]))).toEqual({ duration: 15, ratio: "16:9", resolution: "2k", videos: [{ url: video.url, duration_seconds: 6 }] });
    expect(jiasuVideoModel("minimax-h3")?.limits?.maxInputAssets).toBe(10);
    expect(jiasuVideoModel("minimax-h3")?.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ default: 15, min: 4, max: 15 });
    expect(jiasuVideoRequestIssues(request("minimax-h3", { duration: 4, aspect_ratio: "3:4", videos: [video.url] }))).toEqual([]);
    const special = "minimax-h3-933-2k-支持真人";
    expect(normalizeJiasuVideoParameters(request(special, {}, [video]))).toMatchObject({ duration: 15, resolution: "2k", videos: [{ url: video.url, duration_seconds: 6 }] });
    expect(jiasuVideoRequestIssues(request(special, { videos: [{ url: video.url, duration_seconds: 16 }] }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "assets" })]));
  });

  it("submits once with the original Key, restores the saved task and extracts every result_urls video", async () => {
    const f = fixture("sd-2.0-J2", [Response.json({ id: "task_jiasu_original", status: "queued", progress: 0 }), Response.json({ id: "task_jiasu_original", status: "unknown" }), Response.json({ id: "task_jiasu_original", status: "completed", progress: 100, result_urls: ["https://m.jiasuapi.com/result-1.mp4", "https://m.jiasuapi.com/result-2.mp4"] })]);
    const input = request("sd-2.0-J2", { duration: 5, aspect_ratio: "9:16", resolution: "720p" }, [image, video, audio]);
    expect(await f.adapter.validate(input)).toEqual({ valid: true, issues: [] });
    const task = await f.adapter.submit(input);
    expect(task.providerTaskId).toBe("task_jiasu_original");
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://ai.jiasuapi.com/v1/video/generations");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: input.model, prompt: input.prompt, duration: 5, ratio: "9:16", resolution: "720p", images: [image.url], videos: [video.url], audios: [audio.url] });
    const restored = JSON.parse(JSON.stringify(task)) as ProviderTask;
    expect((await f.adapter.poll(restored)).status).toBe("running");
    const state = await f.adapter.poll(restored);
    expect(state.status).toBe("succeeded");
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://ai.jiasuapi.com/v1/videos/tasks/task_jiasu_original");
    expect(await f.adapter.extractOutputs(state.result)).toEqual([{ kind: "video", url: "https://m.jiasuapi.com/result-1.mp4", mimeType: "video/mp4" }, { kind: "video", url: "https://m.jiasuapi.com/result-2.mp4", mimeType: "video/mp4" }]);
    expect(f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    for (const [, init] of f.fetcher.mock.calls) expect(new Headers(init?.headers).get("authorization")).toBe("Bearer isolated-original-key");
    expect(f.fallback.submit).not.toHaveBeenCalled();
  });

  it.each([{ modelScanStatus: "unauthorized" }, { supplierArchived: true }, { scannedModelIds: [] }, { usage: "disabled" }, { usage: "agent" }])("preserves real inventory restrictions %j", async extra => {
    const f = fixture("sd-2.0-J2", [], extra);
    expect((await f.adapter.validate(request())).valid).toBe(false);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("blocks mismatched Key/model groups through both automatic and direct REST paths before upload or generation", async () => {
    const model = jiasuVideoModel("sd-2.0-J2")!, transport = jiasuVideoTransport();
    const conflict = { accountKeyGroup: "vip", modelGroup: "different-group", connector: { ...transport, models: [model], restrictModels: true } };
    const f = fixture(model.id, [], conflict);
    expect((await f.adapter.validate(request())).issues).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("分组不一致") })]));
    await expect(f.adapter.submit(request())).rejects.toThrow("分组不一致");
    const direct = new GenericRestAdapter(f.resolver, { fetch: f.fetcher });
    expect((await direct.validate(request())).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "model_group_mismatch" })]));
    await expect(direct.submit(request())).rejects.toThrow("分组不一致");
    const old = { ...model, metadata: { ...model.metadata, canvasRunnable: false, canvasUnavailableReason: "视频调用协议待供应商文档确认" } };
    expect(restoreRemainingVideoModel("jiasu", model.id, old, { ...conflict, scannedModelIds: [model.id] })).toBeUndefined();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("uploads local image, video and audio through free supplier tickets before a single paid submission", async () => {
    const local = [image, video, audio].map(asset => ({ ...asset, url: undefined, data: new Uint8Array([1, 2, 3]) })) as unknown as ProviderAssetInput[];
    const urls = ["image", "video", "audio"].map(kind => `https://m.jiasuapi.com/local-${kind}`);
    const f = fixture("sd-2.0-J2", [Response.json({ success: true, data: { items: urls.map((url, index) => ({ url, put: { url: `https://storage.example/asset-${index}?signature=isolated`, method: "PUT", headers: { "Content-Type": local[index]!.mimeType } } })) } }),
      new Response(null, { status: 204 }), new Response(null, { status: 204 }), new Response(null, { status: 204 }), Response.json({ id: "local_task_original", status: "queued" })]);
    expect((await f.adapter.validate(request("sd-2.0-J2", {}, local))).valid).toBe(true);
    const task = await f.adapter.submit(request("sd-2.0-J2", {}, local));
    expect(task.providerTaskId).toBe("local_task_original");
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://ai.jiasuapi.com/v1/media/uploads");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body)).items.map((item: { kind: string }) => item.kind)).toEqual(["image", "video", "audio"]);
    for (const [, init] of f.fetcher.mock.calls.slice(1, 4)) {
      expect(init?.method).toBe("PUT");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    }
    expect(f.fetcher.mock.calls[4]?.[0]).toBe("https://ai.jiasuapi.com/v1/video/generations");
    expect(JSON.parse(String(f.fetcher.mock.calls[4]?.[1]?.body))).toMatchObject({ images: [urls[0]], videos: [urls[1]], audios: [urls[2]] });
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/video/generations"))).toHaveLength(1);
  });

  it("stops before generation if a free supplier media upload fails", async () => {
    const local = [{ ...video, url: undefined, data: new Uint8Array([1]) }] as unknown as ProviderAssetInput[];
    const f = fixture("sd-2.0-J2", [Response.json({ success: false, message: "specific upload failure" })]);
    await expect(f.adapter.submit(request("sd-2.0-J2", {}, local))).rejects.toThrow("生成尚未提交");
    expect(f.fetcher.mock.calls).toHaveLength(1);
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://ai.jiasuapi.com/v1/media/uploads");
  });

  it("repairs old inferred missing-protocol flags only for the same visible Key and preserves declared text-only exclusions", async () => {
    const old: ModelDescriptor = { id: "sd-2.0-J2", name: "old", operations: [], outputKinds: ["text"], metadata: { operationsSource: "inferred", outputKindsSource: "inferred", canvasRunnable: false, canvasUnavailableReason: "尚未验证该模型的画布调用协议" } };
    const repaired = fixture(old.id, [], {}, old);
    expect((await repaired.adapter.validate(request(old.id))).valid).toBe(true);
    const denied = fixture(old.id, [], {}, { ...old, metadata: { ...old.metadata, canvasUnavailableReason: "403 此分组无权限" } });
    expect((await denied.adapter.validate(request(old.id))).valid).toBe(false);
    const explicitText = fixture(old.id, [], {}, { ...old, metadata: { ...old.metadata, outputKindsSource: "declared" } });
    expect((await explicitText.adapter.validate(request(old.id))).valid).toBe(false);
    const manual = fixture(old.id, [], {}, { ...old, metadata: { ...old.metadata, source: "manual" } });
    expect((await manual.adapter.validate(request(old.id))).valid).toBe(false);
  });

  it("preserves failure diagnostics and never re-submits a missing or ambiguous task", async () => {
    const f = fixture("sd-2.0-J2", [Response.json({ id: "failure_original", status: "queued" }), Response.json({ status: "failed", error: { message: "specific upstream failure" } })]);
    const task = await f.adapter.submit(request());
    expect(await f.adapter.poll(task)).toMatchObject({ status: "failed", error: "specific upstream failure" });
    const missing = fixture("sd-2.0-J2", [Response.json({ status: "queued" })]);
    await expect(missing.adapter.submit(request())).rejects.toThrow("未返回视频任务 ID");
    expect(missing.fetcher).toHaveBeenCalledTimes(1);
    const empty = fixture("sd-2.0-J2", [Response.json({ id: "empty_original", status: "completed", result_urls: [] })]);
    await expect(empty.adapter.submit(request())).rejects.toThrow("没有视频");
    expect(empty.fetcher).toHaveBeenCalledTimes(1);
  });
});
