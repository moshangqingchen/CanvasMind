import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { remainingVideoModel, remainingVideoRequestIssues, remainingVideoTransport, isRemainingVideoModel } from "./remaining-video-contracts.js";
import { jijiuVideoBillingSeconds, jijiuVideoModel, jijiuVideoRequestIssues, normalizeJijiuVideoParameters } from "./jijiu-video-contract.js";
import { jiasuVideoModel, jiasuVideoRequestIssues } from "./jiasu-video-contract.js";
import { parseSupplierCatalog } from "./supplier-catalog.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/supplier-a-update-20261021.json", import.meta.url), "utf8"));
const request = (model: string, parameters: Record<string, unknown>, assets: ProviderAssetInput[] = []): NormalizedRequest => ({ connectionId: "test", model, parameters, assets,
  operation: assets.length ? "video.image-to-video" : "video.generate", prompt: "Offline contract", idempotencyKey: "offline-once" });
const video: ProviderAssetInput = { id: "video", kind: "video", mimeType: "video/mp4", url: "https://media.example/original.mp4", durationSeconds: 5 };
const image: ProviderAssetInput = { id: "image", kind: "image", mimeType: "image/png", url: "https://media.example/original.png" };

describe("current Secure61 Kling contract", () => {
  const id = "kling-video-v4", context = { baseUrl: "https://token.secure-skill.com/v1", group: id, officialGroupId: "61" };
  it("does not lend the contract to another source, group or manual binding", () => {
    expect(isRemainingVideoModel("secure", id, context)).toBe(true);
    for (const bad of [{ ...context, officialGroupId: "60" }, { ...context, officialGroupId: undefined }, { ...context, baseUrl: "https://other.example" }, { ...context, manualProtocol: true }])
      expect(remainingVideoTransport("secure", id, bad)).toBeUndefined();
    const model = remainingVideoModel("secure", id, undefined, context)!;
    expect(model.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 1, required: true });
    expect(model.parameters?.find(p => p.key === "duration")).not.toHaveProperty("default");
  });
  it("restores an old missing-contract descriptor through the real OpenAI registry and recovers the same task", async () => {
    const old: ModelDescriptor = { id, name: id, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"],
      metadata: { canvasRunnable: false, canvasUnavailableReason: "当前分组列出此型号，但尚未提供其参数与调用合同" } };
    const resolver = new StaticConnectionResolver([{ id: "test", provider: "openai", baseUrl: context.baseUrl, apiKey: "offline-key", settings: {
      accountKeyGroupId: "61", accountKeyGroup: id, modelGroup: id, usage: "canvas", modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [old], autoModelInterfaces: {},
    } }]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "same-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "same-task", status: "completed", video_url: "https://result.example/original.mp4" }));
    const registry = () => createDefaultProviderRegistry(resolver, { fetch: fetcher }).get("openai");
    const input = request(id, { duration: 5, resolution: "1080p", aspect_ratio: "3:2" }, [image, video]);
    const before = structuredClone(input);
    expect(await registry().validate(input)).toEqual({ valid: true, issues: [] });
    expect(fetcher).not.toHaveBeenCalled();
    const task = await registry().submit(input);
    expect(fetcher.mock.calls[0]![0]).toBe("https://token.secure-skill.com/v1/videos");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ model: id, prompt: input.prompt, duration: 5, resolution: "1080p", ratio: "3:2",
      media: [{ type: "reference_image", url: image.url }, { type: "reference_video", url: video.url }] });
    const done = await registry().poll(JSON.parse(JSON.stringify(task)));
    expect(done.status).toBe("succeeded");
    expect(await registry().extractOutputs(done.result)).toMatchObject([{ kind: "video", url: "https://result.example/original.mp4" }]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(input).toEqual(before);
    for (const parameters of [{}, { duration: 0 }, { duration: 1.5 }, { duration: 5, resolution: "4k" }, { duration: 5, stream: true }])
      expect(remainingVideoRequestIssues("secure", request(id, parameters), context).length).toBeGreaterThan(0);
  });
});

describe("current Jijiu exact lines and input duration billing", () => {
  it.each(["SD2.0满血稳定933-线路二", "稳定seedance-2.5全参D"])("maps measured references for %s and rejects duration-free URLs before POST", async id => {
    const group = id.startsWith("SD2.0") ? "视频SD2.0" : "稳定满血视频模型";
    const input = request(id, { duration: 5, resolution: "1080p", aspect_ratio: "9:16" }, [image, video]), before = structuredClone(input);
    expect(jijiuVideoRequestIssues(input)).toEqual([]);
    const normalized = normalizeJijiuVideoParameters(input), field = id.startsWith("SD2.0") ? "videos" : "video_refs";
    expect(normalized[field]).toEqual([{ url: video.url, durationMs: 5000 }]);
    expect(normalizeJijiuVideoParameters({ ...input, parameters: { ...input.parameters, [field]: [{ url: video.url, durationMs: 5000 }] } })[field]).toEqual([{ url: video.url, durationMs: 5000 }]);
    expect(jijiuVideoBillingSeconds(id, normalized)).toBe(10);
    expect(jijiuVideoBillingSeconds(id, { duration: 5, [field]: [video.url] })).toBeUndefined();
    expect(jijiuVideoBillingSeconds(id, { duration: 5, has_reference_video: false })).toBe(5);
    const resolver = new StaticConnectionResolver([{ id: "test", provider: "openai", baseUrl: "https://newapi.jijiucanvas.com/v1", apiKey: "offline-key", settings: {
      accountKeyGroup: group, modelGroup: group, usage: "canvas", modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [jijiuVideoModel(id, undefined, group)!],
    } }]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "jijiu-task", status: "queued" }));
    await createDefaultProviderRegistry(resolver, { fetch: fetcher }).get("openai").submit(input);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(body[field]).toEqual([{ url: video.url, durationMs: 5000 }]);
    expect(body).not.toHaveProperty("reference_video_seconds");
    expect(input).toEqual(before);
    const invalid = request(id, { duration: 5, [field]: [video.url] });
    expect(jijiuVideoRequestIssues(invalid)).toContainEqual(expect.objectContaining({ path: "assets" }));
  });
  it("keeps line5 reference-only and validates its distinct ratios and legal bounds", () => {
    const id = "SD2.0特价933-线路五";
    expect(jijiuVideoModel(id)?.operations).toEqual(["video.image-to-video"]);
    expect(jijiuVideoRequestIssues(request(id, { duration: 4, resolution: "720p", aspect_ratio: "21:9" }, [image]))).toEqual([]);
    expect(jijiuVideoRequestIssues(request(id, { duration: 4 }))).toContainEqual(expect.objectContaining({ path: "assets" }));
    expect(jijiuVideoModel("SD2.0满血稳定933-线路六")?.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 5, max: 15 });
    expect(jijiuVideoRequestIssues(request("稳定seedance-2.5全参D", { duration: 5, aspect_ratio: "1:1" }))).toContainEqual(expect.objectContaining({ path: "parameters.aspect_ratio" }));
  });
  it("reads the exact new expression prices without lending another line or multiplying per-item charges", () => {
    const groups = parseSupplierCatalog({ data: fixture.jijiu.data, group_ratio: { "视频SD2.0": 1, "稳定满血视频模型": 1 } }, { supplierSiteUrl: "https://newapi.jijiucanvas.com", checkedAt: fixture.jijiu.checkedAt }).groups;
    const models = groups.flatMap(g => g.models);
    expect(models.find(m => m.id === "SD2.0特价933-线路五")?.priceLabel).toContain("¥1.3/请求");
    expect(models.find(m => m.id === "SD2.0满血稳定933-线路二")?.priceLabel).toContain("4K ¥2/秒");
    expect(models.find(m => m.id === "稳定seedance-2.5全参D")?.priceLabel).toContain("1080p ¥1.19/秒");
  });
});

describe("Jiasu current exact live model facts", () => {
  function modelFor(id: string): ModelDescriptor { const row = fixture.jiasu.data.find((r: { model_name: string }) => r.model_name === id); return jiasuVideoModel(id, { id, name: id, operations: ["video.generate"],
    metadata: { jiasuCatalogRecord: { description: row.description, apiParameters: JSON.parse(row.api_parameters), supportedEndpointTypes: row.supported_endpoint_types } } }, "vip")!; }
  it("uses exact current model bounds and keeps contradictory prose visible", () => {
    const h3 = modelFor("minimax-h3"), j3 = modelFor("sd-2.5-J3-doubao");
    expect(h3.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 5, max: 30, default: 30 });
    expect(h3.parameters?.find(p => p.key === "resolution")?.options).toEqual([{ value: "768p", label: "768p" }]);
    expect(j3.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 4, max: 30 });
    expect(jiasuVideoRequestIssues(request(j3.id, { duration: 31 }), j3).some(i => i.path === "parameters.duration")).toBe(true);
    expect(jiasuVideoRequestIssues(request(j3.id, { duration: 5, resolution: "1080p" }, [video]), j3).some(i => i.path === "assets")).toBe(true);
    expect(modelFor("sd-2.5-j2-V2").parameters?.find(p => p.key === "duration")).toMatchObject({ min: 5, max: 30 });
    const mini = modelFor("sd-2.0-mini-503-J3");
    expect(jiasuVideoRequestIssues(request(mini.id, { resolution: "480p" }), mini).some(i => i.path === "parameters.resolution")).toBe(true);
  });
  it.each([["sd-2.5-J3-doubao", "1080p"], ["sd-2.5-j2-V2", "720p"], ["minimax-h3", "768p"]])("submits %s through the unchanged same-Key JSON task chain", async (id, resolution) => {
    const model = modelFor(id!), resolver = new StaticConnectionResolver([{ id: "test", provider: "openai", baseUrl: "https://ai.jiasuapi.com/v1", apiKey: "offline-key", settings: {
      accountKeyGroup: "vip", modelGroup: "vip", usage: "canvas", modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [model],
    } }]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "same-jiasu-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "same-jiasu-task", status: "completed", result_urls: ["https://result.example/original.mp4"] }));
    const registry = () => createDefaultProviderRegistry(resolver, { fetch: fetcher }).get("openai");
    const input = request(id!, { duration: 15, resolution: resolution!, aspect_ratio: "9:16" }, [image]), before = structuredClone(input);
    expect(await registry().validate(input)).toEqual({ valid: true, issues: [] });
    expect(fetcher).not.toHaveBeenCalled();
    const task = await registry().submit(input);
    expect(fetcher.mock.calls[0]![0]).toBe("https://ai.jiasuapi.com/v1/video/generations");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model: id, duration: 15, resolution, ratio: "9:16", images: [image.url] });
    const done = await registry().poll(JSON.parse(JSON.stringify(task)));
    expect(done.status).toBe("succeeded");
    expect(await registry().extractOutputs(done.result)).toMatchObject([{ kind: "video", url: "https://result.example/original.mp4" }]);
    expect(fetcher.mock.calls[1]![0]).toBe("https://ai.jiasuapi.com/v1/videos/tasks/same-jiasu-task");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(input).toEqual(before);
  });
});
