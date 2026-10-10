import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, NormalizedRequest, ProviderAdapter, ProviderAssetInput, ProviderTask } from "./contracts.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter } from "./rest.js";
import { scanProviderModelCatalog } from "./model-catalog.js";
import { remainingVideoModel, remainingVideoSupplier } from "./remaining-video-contracts.js";
import { isJijiuApiUrl, jijiuVideoModel, jijiuVideoModelIds, jijiuVideoRequestIssues, jijiuVideoTransport, normalizeJijiuVideoParameters } from "./jijiu-video-contract.js";

const request = (model = "MinimaxH3", parameters: Record<string, unknown> = {}, assets: readonly ProviderAssetInput[] = []): NormalizedRequest => ({ connectionId: "jijiu-offline-fixture", operation: "video.generate", prompt: "Offline contract fixture", idempotencyKey: "single-fixture-request", model, parameters, assets });
const image: ProviderAssetInput = { id: "fixture-image", kind: "image", mimeType: "image/png", url: "https://media.example/ref.png" };
const audio: ProviderAssetInput = { id: "fixture-audio", kind: "audio", mimeType: "audio/mpeg", url: "https://media.example/ref.mp3", durationSeconds: 3 };
const video: ProviderAssetInput = { id: "fixture-video", kind: "video", mimeType: "video/mp4", url: "https://media.example/ref.mp4", durationSeconds: 6 };
function fixture(id = "MinimaxH3", responses: Response[] = [], extra: Record<string, unknown> = {}) {
  const model = jijiuVideoModel(id)!;
  const resolver = new StaticConnectionResolver([{ id: "jijiu-offline-fixture", provider: "openai", apiKey: "fixture-key-only", baseUrl: "https://newapi.jijiucanvas.com/v1",
    settings: { scannedModelIds: [id], modelCatalogModels: [model], modelScanStatus: "live", usage: "canvas", ...extra } }]);
  const fallback: ProviderAdapter = { testConnection: vi.fn(), listModels: vi.fn(async () => []), validate: vi.fn(async () => ({ valid: true, issues: [] })), submit: vi.fn(async () => { throw new Error("unexpected image submit"); }), poll: vi.fn(async () => { throw new Error("unexpected image poll"); }), extractOutputs: vi.fn(async () => []) };
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("unexpected network"); });
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  return { resolver, fetcher, fallback, adapter: new AutoInterfaceAdapter(resolver, fallback, { fetch: fetcher }) };
}

describe("Jijiu exact official video contracts (offline only)", () => {
  it("only identifies the precise origin and approved API root", () => {
    expect(remainingVideoSupplier("https://newapi.jijiucanvas.com/v1")).toBe("jijiu");
    for (const url of ["http://newapi.jijiucanvas.com/v1", "https://newapi.jijiucanvas.com/proxy/v1", "https://newapi.jijiucanvas.com/v1?x=1", "https://user@newapi.jijiucanvas.com", "https://newapi.jijiucanvas.com.example/v1", "https://ai.jiasuapi.com/v1"]) expect(isJijiuApiUrl(url)).toBe(false);
    expect(jijiuVideoModel("minimax-h3")).toBeUndefined();
    expect(jijiuVideoModel("gpt-image-2")).toBeUndefined();
  });

  it("discovers all 18 current complete IDs even with only chat endpoint labels", () => {
    const ids = jijiuVideoModelIds(); expect(ids).toHaveLength(18);
    const scan = scanProviderModelCatalog({ data: ids.map(id => ({ id, supported_endpoint_types: ["openai"] })) }, { baseUrl: "https://newapi.jijiucanvas.com/v1" });
    expect(scan.models).toHaveLength(18);
    expect(scan.models.every(m => m.outputKinds?.includes("video") && m.metadata?.canvasRunnable === true)).toBe(true);
    expect(scanProviderModelCatalog({ data: [{ id: "SD2.5特价30-10-10-线路一" }] }, { baseUrl: "https://other.example/v1" }).models[0]?.metadata?.jijiuVideoContract).toBeUndefined();
  });

  it.each(jijiuVideoModelIds())("submits the exact model %s and its legal bounds without real network", async id => {
    const model = remainingVideoModel("jijiu", id)!, duration = model.parameters!.find(p => p.key === "duration")!;
    const values = [...new Set([duration.min!, duration.max!])];
    for (const value of values) {
      const f = fixture(id, [Response.json({ id: "task_fixture", status: "queued" })]);
      expect((await f.adapter.validate(request(id, { duration: value }))).issues).toEqual([]);
      await f.adapter.submit(request(id, { duration: value }));
      expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://newapi.jijiucanvas.com/v1/videos");
      expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: "Offline contract fixture", seconds: value });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(f.fallback.submit).not.toHaveBeenCalled();
    }
    const f = fixture(id);
    for (const value of [duration.min! - 1, duration.max! + 1, 1.5]) {
      expect((await f.adapter.validate(request(id, { duration: value }))).valid).toBe(false);
      await expect(f.adapter.submit(request(id, { duration: value }))).rejects.toThrow();
    }
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("keeps the fixed-30 line distinct from 4–30, enforces 4–29 and the 480p mini cap", () => {
    expect(jijiuVideoModel("SD2.5特价30-10-10-线路一")?.parameters?.find(p => p.key === "duration")).toMatchObject({ control: "select", default: 30, options: [{ label: "30 秒", value: 30 }] });
    expect(normalizeJijiuVideoParameters(request("SD2.5特价30-10-10-线路一"))).toEqual({ seconds: 30 });
    expect(jijiuVideoModel("SD2.5特价30-10-10-线路二")?.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 4, max: 30 });
    expect(jijiuVideoModel("稳定seedance-2.5参图参音F")?.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 4, max: 29 });
    expect(jijiuVideoModel("SD2.0mini稳定903C")?.parameters?.find(p => p.key === "resolution")?.options).toEqual([{ label: "480p", value: "480p" }]);
    expect(jijiuVideoModel("SD2.0mini稳定903C")?.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 4, max: 10 });
    expect(jijiuVideoRequestIssues(request("SD2.0mini稳定903C", { duration: 12, resolution: "720p" }))).toHaveLength(2);
    expect(jijiuVideoModel("SD2.5特价30-10-10-线路一")?.metadata?.durationRangeSource).toBeUndefined();
  });

  it.each(["SD2.0mini稳定900B", "MinimaxH3特价版"])("keeps unknown wire resolution for %s as supplier default", async id => {
    const model = jijiuVideoModel(id)!; expect(model.metadata?.resolutionRangeUnverified).toBe(true);
    expect(model.parameters?.find(p => p.key === "resolution")).toMatchObject({ options: [] });
    expect(normalizeJijiuVideoParameters(request(id))).not.toHaveProperty("resolution");
    const f = fixture(id);
    expect((await f.adapter.validate(request(id))).valid).toBe(true);
    await expect(f.adapter.submit(request(id, { resolution: "720p" }))).rejects.toThrow("供应商默认");
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("never claims animated 1080p or upscaled output as native resolution", async () => {
    const f = fixture("Minimax漫剧优化版");
    await expect(f.adapter.submit(request("Minimax漫剧优化版", { resolution: "1080p" }))).rejects.toThrow("分辨率");
    expect(jijiuVideoModel("MinimaxH3")?.parameters?.find(p => p.key === "resolution")?.options?.map(o => o.value)).toEqual(["480p", "768p", "1080p", "2k-upscale", "4k-upscale"]);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("maps reference aliases and explicit frame roles without borrowed Jiasu fields", async () => {
    const f = fixture("MinimaxH3", [Response.json({ id: "task_frames", status: "queued" })]);
    const input = request("MinimaxH3", { duration: 5, ratio: "9:16", resolution: "768p", reference_image_urls: ["https://media.example/other.png"], seed: 42, watermark: false, prompt_optimizer: true }, [{ ...image, role: "firstFrame" }, { ...image, role: "lastFrame", url: "https://media.example/end.png" }, video, audio]);
    await f.adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ seconds: 5, aspect_ratio: "9:16", resolution: "768p", images: ["https://media.example/other.png"], first_frame_image: image.url, last_frame_image: "https://media.example/end.png", reference_videos: [video.url], reference_audios: [audio.url], seed: 42, watermark: false, prompt_optimizer: true });
    expect(normalizeJijiuVideoParameters(input)).not.toHaveProperty("duration");
  });

  it("offers official aspect-ratio examples without declaring a default or a closed selector", () => {
    const model = jijiuVideoModel("SD2.5特价30-10线路一"), ratio = model?.parameters?.find(p => p.key === "aspect_ratio");
    expect(ratio).toMatchObject({ control: "text", valueType: "string", placeholder: "供应商默认（留空）" });
    expect(ratio).not.toHaveProperty("default");
    expect(ratio).not.toHaveProperty("options");
    expect(model?.metadata?.videoAspectRatioPresets).toEqual([{ label: "16:9（横屏）", value: "16:9" }, { label: "9:16（竖屏）", value: "9:16" }, { label: "1:1（方形）", value: "1:1" }]);
  });

  it.each(["16:9", "9:16", "1:1", "21:9", "2.39:1", "", undefined])("preserves ratio %j through automatic and direct REST requests without real network", async ratio => {
    const id = "SD2.5特价30-10线路一", model = jijiuVideoModel(id)!;
    for (const direct of [false, true]) {
      const f = fixture(id, [Response.json({ id: "task_ratio_fixture", status: "queued" })], {
        accountKeyGroup: "视频SD.2.5", modelGroup: "视频SD.2.5", connector: { ...jijiuVideoTransport(), models: [model], restrictModels: true },
      });
      const adapter = direct ? new GenericRestAdapter(f.resolver, { fetch: f.fetcher }) : f.adapter;
      const input = request(id, { duration: 30, resolution: "720p", ...(ratio === undefined ? {} : { aspect_ratio: ratio }) });
      const original = structuredClone(input);
      expect(await adapter.validate(input)).toEqual({ valid: true, issues: [] });
      await adapter.submit(input);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://newapi.jijiucanvas.com/v1/videos");
      expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: "Offline contract fixture", seconds: 30, resolution: "720p",
        ...(ratio ? { aspect_ratio: ratio } : {}) });
      expect(input).toEqual(original);
    }
  });

  it("keeps a saved custom ratio alias and rejects nonpositive ratios before HTTP", async () => {
    const id = "SD2.5特价30-10线路一";
    const f = fixture(id, [Response.json({ id: "task_custom_ratio", status: "queued" })]);
    const input = request(id, { duration: 30, ratio: "21:9" });
    await f.adapter.submit(input);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ aspect_ratio: "21:9" });
    expect(input.parameters).toEqual({ duration: 30, ratio: "21:9" });
    for (const ratio of ["0:9", "16:0", "-1:1", "widescreen"]) {
      const denied = fixture(id);
      await expect(denied.adapter.submit(request(id, { duration: 30, aspect_ratio: ratio }))).rejects.toThrow();
      expect(denied.fetcher).not.toHaveBeenCalled();
    }
  });

  it("blocks unsupported media, duplicate frames, private URLs and conflicting aliases before HTTP", async () => {
    const bad = [request("SD2.5特价30-10-10-线路一", {}, [video]), request("SD2.0mini稳定900B", {}, [audio]), request("MinimaxH3", { seconds: 5, duration: 6 }), request("MinimaxH3", { ratio: "1:1", aspect_ratio: "9:16" }), request("MinimaxH3", { images: ["http://127.0.0.1/secret"] }), request("MinimaxH3", {}, [{ ...image, role: "firstFrame" }, { ...image, role: "firstFrame" }]), request("MinimaxH3", { size: "1280x720" })];
    for (const input of bad) { const f = fixture(input.model!); await expect(f.adapter.submit(input)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled(); }
    const maxImages = Array.from({ length: 10 }, (_, i) => ({ ...image, id: `fixture-${i}`, url: `https://media.example/${i}.png` }));
    expect(jijiuVideoRequestIssues(request("MinimaxH3", {}, maxImages))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "assets" })]));
  });

  it("checks WAN measured reference durations and output combined cap", async () => {
    const id = "wan3.0-video";
    expect(jijiuVideoRequestIssues(request(id, { duration: 24 }, [video]))).toEqual([]);
    const cases = [request(id, { duration: 25 }, [video]), request(id, { duration: 5 }, [{ ...video, durationSeconds: 16 }]), request(id, {}, [video]), request(id, { duration: 5, reference_videos: [video.url] }), request(id, { duration: 5 }, [{ ...video, durationSeconds: undefined }])];
    for (const input of cases) { const f = fixture(id); await expect(f.adapter.submit(input)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled(); }
    for (const model of [id, "wan3.0-video-prime", "稳定seedance-2.5全参E"]) expect(jijiuVideoModel(model)?.metadata?.billingIncludesInputDuration).toBe(true);
    expect(jijiuVideoModel("稳定seedance-2.5参图参音F")?.parameters?.find(p => p.key === "resolution")?.options).toEqual([{ label: "720p", value: "720p" }]);
  });

  it.each([false, true])("restores queued tasks and downloads authenticated content, artifact URL present=%s", async artifact => {
    const contentUrl = "https://newapi.jijiucanvas.com/v1/tasks/task_fixture/artifacts/video/content?access=fixture-ticket";
    const f = fixture("MinimaxH3", [Response.json({ id: "task_fixture", status: "queued" }), Response.json({ id: "task_fixture", status: "unknown" }), Response.json({ id: "task_fixture", status: "completed", ...(artifact ? { content_url: contentUrl } : {}) }), new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "video/mp4" } })]);
    const task = JSON.parse(JSON.stringify(await f.adapter.submit(request()))) as ProviderTask;
    expect(task.providerTaskId).toBe("task_fixture"); expect((await f.adapter.poll(task)).status).toBe("running");
    const state = await f.adapter.poll(task); expect(state.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(state.result)).toEqual([{ kind: "video", data: new Uint8Array([1, 2, 3, 4]), mimeType: "video/mp4" }]);
    expect(f.fetcher.mock.calls[1]?.[0]).toBe("https://newapi.jijiucanvas.com/v1/videos/task_fixture");
    expect(f.fetcher.mock.calls[3]?.[0]).toBe(artifact ? contentUrl : "https://newapi.jijiucanvas.com/v1/videos/task_fixture/content");
    expect(f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    for (const [, init] of f.fetcher.mock.calls) expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-key-only");
  });

  it("retains upstream failure without retrying creation", async () => {
    const f = fixture("MinimaxH3", [Response.json({ id: "task_failed", status: "queued" }), Response.json({ id: "task_failed", status: "failed", error: { message: "fixture upstream unavailable" } })]);
    const task = await f.adapter.submit(request()); expect(await f.adapter.poll(task)).toMatchObject({ status: "failed", error: "fixture upstream unavailable" }); expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([{ scannedModelIds: [] }, { modelScanStatus: "unauthorized" }, { supplierArchived: true }, { usage: "agent" }, { usage: "disabled" }, { accountKeyGroup: "视频SD2.0" }])("retains inventory and group restrictions %j", async extra => {
    const f = fixture("MinimaxH3", [], extra); await expect(f.adapter.submit(request())).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("uses the same validation in direct REST and leaves explicit manual contracts alone", async () => {
    const model = jijiuVideoModel("SD2.0mini稳定903C")!, transport = jijiuVideoTransport();
    const f = fixture(model.id, [], { connector: { ...transport, models: [model], restrictModels: true } });
    const direct = new GenericRestAdapter(f.resolver, { fetch: f.fetcher });
    await expect(direct.submit(request(model.id, { duration: 15, resolution: "720p" }))).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
    for (const metadata of [{ source: "manual" }, { source: "paid-test" }, { protocolEvidence: "paid-test" }]) {
      const manual: ModelDescriptor = { ...model, metadata }; expect(jijiuVideoModel(manual.id, manual)).toBeUndefined();
    }
  });

  it("does not overwrite the exact group's unavailable state while repairing an inferred protocol", async () => {
    const scan = scanProviderModelCatalog({ data: [{ id: "MinimaxH3" }] }, { baseUrl: "https://newapi.jijiucanvas.com/v1", modelGroup: "视频SD2.0" });
    expect(scan.models[0]?.metadata).toMatchObject({ canvasRunnable: false, jijiuGroupUnavailable: true });
    const current = jijiuVideoModel("MinimaxH3", scan.models[0], "视频-MnimaxH3");
    expect(current?.metadata?.jijiuGroupUnavailable).toBe(false);
    const transport = jijiuVideoTransport(), model = jijiuVideoModel("MinimaxH3")!;
    const f = fixture("MinimaxH3", [], { accountKeyGroup: "视频-MnimaxH3", modelGroup: "视频SD2.0", connector: { ...transport, models: [model], restrictModels: true } });
    await expect(f.adapter.submit(request())).rejects.toThrow("分组不一致");
    await expect(new GenericRestAdapter(f.resolver, { fetch: f.fetcher }).submit(request())).rejects.toThrow("分组不一致");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
