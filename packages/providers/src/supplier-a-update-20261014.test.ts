import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { parseSupplierCatalog, parseSupplierPricingChannels } from "./supplier-catalog.js";
import { miaowuCatalogMediaPricing } from "./miaowu-catalog-pricing.js";
import { jiasuCatalogMediaPricing, jiasuCatalogRecord } from "./jiasu-catalog-pricing.js";
import { jiasuVideoModel, jiasuVideoRequestIssues, normalizeJiasuVideoParameters, jiasuVideoTransport } from "./jiasu-video-contract.js";
import { jijiuCatalogMediaPricing } from "./jijiu-catalog-pricing.js";
import { jijiuVideoModel, jijiuVideoRequestIssues, normalizeJijiuVideoParameters, jijiuVideoTransport } from "./jijiu-video-contract.js";
import { modelPriceAmount } from "./media-billing.js";
import { GenericRestAdapter } from "./rest.js";
import { StaticConnectionResolver } from "./credentials.js";
import { secureSkillCatalogPricing } from "./secure-skill-catalog-pricing.js";
import { parseSupplierGroupDetails } from "./supplier-group-details.js";

type Snapshot = { sourceUrl: string; checkedAt: string; sha256: string; group_ratio: Record<string, number>; allModelIds: string[]; data: Record<string, unknown>[] };
const snapshots = JSON.parse(readFileSync(new URL("./fixtures/supplier-a-pricing-20261014.json", import.meta.url), "utf8")) as Record<"miaowu" | "jiasu" | "jijiu", Snapshot>;
const channels = JSON.parse(readFileSync(new URL("./fixtures/supplier-a-channel-20261014.json", import.meta.url), "utf8"));
const row = (supplier: keyof typeof snapshots, id: string) => snapshots[supplier].data.find(value => value.model_name === id)!;
const request = (model: string, parameters: Record<string, unknown> = {}, assets: ProviderAssetInput[] = []): NormalizedRequest => ({
  model, parameters, assets, connectionId: "offline-oct14", operation: "video.generate", prompt: "Offline contract fixture",
});
const image: ProviderAssetInput = { id: "image", kind: "image", mimeType: "image/png", url: "https://media.example/image.png" };
const video: ProviderAssetInput = { id: "video", kind: "video", mimeType: "video/mp4", url: "https://media.example/video.mp4", durationSeconds: 4 };
const audio: ProviderAssetInput = { id: "audio", kind: "audio", mimeType: "audio/mpeg", url: "https://media.example/audio.mp3", durationSeconds: 3 };

describe("October 14 supplier A recorded prices and official group membership", () => {
  it("imports Secure 33's newly listed complete Gemini ID with its own three image tiers", () => {
    const evidence = channels["secure/pricing/channels"];
    const platform = evidence.payload.data[0].platforms[0], group = platform.groups[0];
    expect(group.id).toBe(33);
    const raw = platform.supported_models.find((value: { name: string }) => value.name === "gemini-2.5-flash-image");
    const pricing = secureSkillCatalogPricing(raw, { supplierSiteUrl: "https://token.secure-skill.com", multiplier: group.rate_multiplier, group, checkedAt: evidence.checkedAt })!.pricing;
    expect(pricing.billingUnit).toBe("image");
    for (const resolution of ["1K", "2K", "4K"]) expect(modelPriceAmount(pricing, { resolution })).toBe(.05);
    const parsed = parseSupplierPricingChannels(evidence.payload, undefined, { supplierSiteUrl: "https://token.secure-skill.com" });
    expect(parsed.find(value => value.supplierGroupId === "33")?.models.find(model => model.id === raw.name)?.capability).toBe("image");
  });
  it("retains Secure 55's explicit yuan per-item wording without inventing a per-second quote", () => {
    const raw = channels["secure/groups/available"].payload.data[0];
    expect(raw.id).toBe(55);
    expect(parseSupplierGroupDetails(raw, "key-groups")?.referencePrice).toContain("5.5元一条720p");
  });
  it("reuses pDog's unchanged October 14 exact group/model catalog without granting another group's scope", () => {
    const evidence = channels["pdog/model-plaza"], parsed = parseSupplierCatalog(evidence.payload, { supplierSiteUrl: "https://ai.whyshy.cn" });
    for (const rawGroup of evidence.payload.data.groups) {
      const group = parsed.groups.find(value => value.supplierGroupId === String(rawGroup.id));
      expect(group).toBeDefined();
      expect(group!.models.map(model => model.id).sort()).toEqual(rawGroup.models.map((model: { name: string }) => model.name).sort());
      expect(group!.models.every(model => model.capability === "image")).toBe(true);
    }
  });
  it.each([
    ["dola-seedance-2.0-fast", "request", { "720p": 1.25 }],
    ["dola-seedance-2.5", "request", { "720p": 1.25 }],
    ["doubao-seedance-2.0-mini", "request", { "720p": 1 }],
    ["seedance-2.0", "second", { "480p": .5, "720p": 1 }],
    ["seedance-2.0-fast", "second", { "480p": .2, "720p": .4 }],
    ["seedance-2.5-deal", "request", { "480p": 4, "720p": 6 }],
    ["wan3.0-vedio-deal", "second", { "480p": .1 }],
  ] as const)("preserves Miaowu %s exact units, conditions and the selected group's multiplier", (id, unit, rates) => {
    const raw = row("miaowu", id);
    for (const multiplier of [7, 14]) {
      const pricing = miaowuCatalogMediaPricing(raw, { supplierSiteUrl: "https://api.miaowuai.store", currency: "CNY", multiplier, checkedAt: snapshots.miaowu.checkedAt })!.pricing;
      expect(pricing.billingUnit).toBe(unit);
      for (const [resolution, rate] of Object.entries(rates)) expect(modelPriceAmount(pricing, { resolution })).toBe(rate * multiplier / 7);
      expect(modelPriceAmount(pricing, { resolution: "1080p" })).toBeUndefined();
    }
  });

  it.each(["mjv8.2", "niji7"])("keeps %s only in the currently published default group", id => {
    const parsed = parseSupplierCatalog(snapshots.miaowu, { supplierSiteUrl: "https://api.miaowuai.store", currency: "CNY" });
    expect(parsed.groups.filter(group => group.models.some(model => model.id === id)).map(group => group.id)).toEqual(["default"]);
  });
  it("keeps Seedream outside the removed internal group and distinguishes official removals from historical contracts", () => {
    const parsed = parseSupplierCatalog(snapshots.miaowu, { supplierSiteUrl: "https://api.miaowuai.store", currency: "CNY" });
    expect(parsed.groups.filter(group => group.models.some(model => model.id === "seedream-5-0-pro")).map(group => group.id)).not.toContain("内部");
    expect(snapshots.miaowu.allModelIds).not.toContain("seedance-2.5-pro");
    for (const id of ["sd-2.0-mini-J1", "seedance-2.0-X6", "wan-3.0-特惠", "wan-3.0-特惠-1"]) expect(snapshots.jiasu.allModelIds).not.toContain(id);
    for (const id of ["SD2.0fast稳定900D", "SD2.0mini稳定900B", "稳定seedance-2.5全参D"]) {
      expect(snapshots.jijiu.allModelIds).not.toContain(id);
      expect(jijiuVideoTransport(id).poll?.path).toBe("/v1/videos/{taskId}");
    }
  });

  it.each([
    ["SD2.0满血稳定933-线路三", "视频SD2.0", 3.5], ["SD2.0满血稳定933-线路四", "视频SD2.0", 4.5],
    ["SD2.5特价30-10-10-线路二", "视频SD2.5", 4.5], ["SD2.5特价30-10线路一", "视频SD2.5", 1.5],
    ["SD2.5特价30-10线路二", "视频SD2.5", 1.5], ["SD2.5特价900线路一", "视频SD2.5", 1.2],
  ] as const)("reads Jijiu %s's numeric quote with one actual-group multiplier", (id, group, amount) => {
    for (const multiplier of [1, 2]) {
      const pricing = jijiuCatalogMediaPricing(row("jijiu", id), { supplierSiteUrl: "https://newapi.jijiucanvas.com", group, groupMultiplier: multiplier })!.pricing;
      expect(pricing.billingUnit).toBe("request");
      expect(modelPriceAmount(pricing, { resolution: "720p" })).toBe(amount * multiplier);
    }
    expect(jijiuCatalogMediaPricing(row("jijiu", id), { supplierSiteUrl: "https://newapi.jijiucanvas.com", group: "unrelated", groupMultiplier: 1 })).toBeUndefined();
  });
  it.each([
    ["wan3.0-video-S", "视频WAN3", { "480p": .12, "720p": .23, "1080p": .45 }],
    ["wan3.0-video-prime-S", "视频WAN3", { "480p": .22, "720p": .43, "1080p": .85 }],
    ["满血seedance-2.5全参C", "稳定满血视频模型", { "720p": .4 }],
  ] as const)("reads Jijiu %s per-second prices without borrowing another line", (id, group, rates) => {
    const pricing = jijiuCatalogMediaPricing(row("jijiu", id), { supplierSiteUrl: "https://newapi.jijiucanvas.com", group, groupMultiplier: 1 })!.pricing;
    expect(pricing.billingUnit).toBe("second");
    for (const [resolution, rate] of Object.entries(rates)) expect(modelPriceAmount(pricing, { resolution })).toBe(rate);
  });
});

describe("October 14 exact Jijiu material contracts", () => {
  it.each([
    ["SD2.0满血稳定933-线路三", 5, 15, "images", "video_refs", "audio_refs", 9, 3, 3],
    ["SD2.0满血稳定933-线路四", 4, 15, "images", "videos", "audios", 9, 3, 3],
    ["SD2.5特价30-10-10-线路二", 4, 30, "image_urls", "video_urls", "audio_urls", 30, 10, 10],
    ["满血seedance-2.5全参C", 4, 30, "images", "video_refs", "audio_refs", 30, 10, 10],
    ["wan3.0-video-S", 2, 30, "reference_images", "videos", "audios", 10, 5, 5],
    ["wan3.0-video-prime-S", 2, 30, "reference_images", "videos", "audios", 10, 5, 5],
  ] as const)("maps %s fields and rejects material/duration overflow before HTTP", (id, min, max, imageField, videoField, audioField, images, videos, audios) => {
    const model = jijiuVideoModel(id)!;
    expect(model.limits).toMatchObject({ maxInputImages: images, maxInputVideos: videos, maxInputAudios: audios });
    expect(model.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min, max });
    const input = request(id, { duration: min, resolution: "720p" }, [image, video, audio]);
    expect(jijiuVideoRequestIssues(input)).toEqual([]);
    expect(normalizeJijiuVideoParameters(input)).toMatchObject({ [imageField]: [image.url], [videoField]: [video.url], [audioField]: [audio.url] });
    expect(normalizeJijiuVideoParameters(request(id, { [videoField]: [video.url] }))[videoField]).toEqual([video.url]);
    expect(jijiuVideoTransport(id).submit?.bodyMode).toBe("json");
    for (const duration of [min - 1, max + 1]) expect(jijiuVideoRequestIssues(request(id, { duration }))).toContainEqual(expect.objectContaining({ path: "parameters.duration" }));
    for (const [asset, count] of [[image, images], [video, videos], [audio, audios]] as const)
      expect(jijiuVideoRequestIssues(request(id, { duration: min }, Array.from({ length: count + 1 }, () => asset)))).toContainEqual(expect.objectContaining({ path: "assets" }));
    expect(jijiuVideoRequestIssues(request(id, {}, [{ ...image, url: "http://media.example/image.png" }]))).toContainEqual(expect.objectContaining({ path: "assets" }));
  });

  it("removes E video inputs and input-duration billing while preserving saved user values", () => {
    const id = "稳定seedance-2.5全参E";
    const old: ModelDescriptor = { id, name: id, operations: ["video.generate"], metadata: { billingIncludesInputDuration: true, priceContractWarning: "old input plus output quote" } };
    const model = jijiuVideoModel(id, old)!;
    expect(model.limits?.maxInputVideos).toBe(0);
    expect(model.metadata?.billingIncludesInputDuration).toBeUndefined();
    expect(model.metadata?.priceContractWarning).toBeUndefined();
    expect(model.inputKinds).not.toContain("video");
    expect(model.parameters?.find(parameter => parameter.key === "reference_video_seconds")).toBeUndefined();
    for (const input of [request(id, { duration: 5, video_refs: [video.url], reference_video_seconds: 4 }), request(id, { duration: 5 }, [video])]) {
      const before = structuredClone(input);
      expect(jijiuVideoRequestIssues(input)).toContainEqual(expect.objectContaining({ path: "assets" }));
      expect(normalizeJijiuVideoParameters(input)).not.toHaveProperty("video_refs");
      expect(normalizeJijiuVideoParameters(input)).not.toHaveProperty("reference_video_seconds");
      expect(input).toEqual(before);
    }
    expect(jijiuVideoRequestIssues(request(id, { reference_video_seconds: 4 }))).toContainEqual(expect.objectContaining({ path: "parameters.reference_video_seconds" }));
    for (const resolution of ["480p", "720p"]) expect(jijiuVideoRequestIssues(request(id, { duration: 30, resolution }, [image, audio]))).toEqual([]);
  });
  it("retains the 30-10 line one's documented generation limit and separate contradictory billing tiers", () => {
    const model = jijiuVideoModel("SD2.5特价30-10线路一")!;
    expect(model.limits).toMatchObject({ maxInputImages: 30, maxInputVideos: 0, maxInputAudios: 10 });
    expect(model.metadata?.videoContractNote).toContain("价格 schema");
    expect(jijiuVideoRequestIssues(request(model.id, { resolution: "480p" }))).toContainEqual(expect.objectContaining({ path: "parameters.resolution" }));
  });
});

describe("October 14 Jiasu compatible protocol and complete IDs", () => {
  it.each(["ov-Seedance 2.0-720p-nsp-gz-15s", "seedance2.5-xing特惠"])("keeps %s open fields, user duration fallback and a missing price", id => {
    const raw = row("jiasu", id), model = jiasuVideoModel(id, { id, name: id, operations: [], metadata: { jiasuCatalogRecord: jiasuCatalogRecord(raw) } }, "vip")!;
    expect(model.operations).toContain("video.generate");
    expect(model.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 1, max: id.includes("2.0") ? 15 : 30 });
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.allowCustomValue).toBe(true);
    expect(model.metadata?.generationVerified).toBe(false);
    expect(jiasuCatalogMediaPricing(raw, { supplierSiteUrl: "https://ai.jiasuapi.com", group: "vip", groupMultiplier: 1, currency: "CNY" })).toBeUndefined();
  });
  it("keeps J3's per-item 0.6 rate, five images, three audios and twelve-second ceiling", () => {
    const id = "sd-2.0-mini-503-J3", raw = row("jiasu", id), model = jiasuVideoModel(id)!;
    expect(model.limits).toMatchObject({ maxInputImages: 5, maxInputAudios: 3 });
    expect(model.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 1, max: 12 });
    expect(jiasuVideoRequestIssues(request(id, { duration: 13 }))).toContainEqual(expect.objectContaining({ path: "parameters.duration" }));
    expect(jiasuVideoRequestIssues(request(id, {}, Array.from({ length: 6 }, (_, index) => ({ ...image, id: `image-${index}`, url: `https://media.example/image-${index}.png` }))))).toContainEqual(expect.objectContaining({ path: "assets" }));
    expect(jiasuVideoRequestIssues(request(id, {}, Array.from({ length: 6 }, () => image)))).toEqual([]);
    const pricing = jiasuCatalogMediaPricing(raw, { supplierSiteUrl: "https://ai.jiasuapi.com", group: "vip", groupMultiplier: 1, currency: "CNY" })!.pricing;
    expect(pricing.billingUnit).toBe("request");
    expect(modelPriceAmount(pricing, { resolution: "720p" })).toBe(.6);
  });
  it("sends pixel size independently, preserves aliases and polls result_urls without retired content endpoint", async () => {
    const id = "seedance2.5-xing特惠", model = jiasuVideoModel(id)!, input = request(id, { seconds: 12, size: "1344x768", resolution: "720p", aspect_ratio: "16:9" });
    const before = structuredClone(input);
    expect(jiasuVideoRequestIssues(input, model, "vip")).toEqual([]);
    expect(normalizeJiasuVideoParameters(input, model, "vip")).toMatchObject({ duration: 12, size: "1344x768", resolution: "720p" });
    const override = jiasuVideoTransport(model);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "original-jiasu-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "original-jiasu-task", status: "completed", result_urls: ["https://media.example/result.mp4"] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: input.connectionId, provider: "rest", baseUrl: "https://ai.jiasuapi.com", apiKey: "synthetic-fixture",
      settings: { accountKeyGroup: "vip", modelGroup: "vip", connector: { ...override, models: [model] }, scannedModelIds: [id], modelCatalogModels: [model], modelScanStatus: "live" } }]), { fetch: fetcher });
    const task = await adapter.submit(input), finished = await adapter.poll(task);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model: id, duration: 12, size: "1344x768", resolution: "720p" });
    expect(String(fetcher.mock.calls[1]![0])).toContain("/v1/videos/tasks/original-jiasu-task");
    expect(await adapter.extractOutputs(finished.result)).toMatchObject([{ kind: "video", url: "https://media.example/result.mp4" }]);
    expect(override.output?.contentFallback).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(input).toEqual(before);
    expect(jiasuVideoRequestIssues(request(id, { seconds: 12, duration: 13 }))).toContainEqual(expect.objectContaining({ path: "parameters.duration" }));
    expect(jiasuVideoRequestIssues(request(id, { size: "720p" }))).toContainEqual(expect.objectContaining({ path: "parameters.size" }));
  });
});
