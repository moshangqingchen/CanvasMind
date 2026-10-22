import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import { CANGYUAN_CURRENT_VIDEO_CONTRACTS } from "./cangyuan-video-contract-data.js";
import { cangyuanVideoModel, validateCangyuanVideoRequest } from "./cangyuan-video-contract.js";
import { cangyuanCurrentModel, cangyuanCurrentTransport, cangyuanCurrentRequestIssues } from "./cangyuan-current-models.js";
import { cangyuanCatalogVideoPricing } from "./cangyuan-catalog-video-pricing.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { StaticConnectionResolver } from "./credentials.js";
import { modelPriceAmount, mediaExpressionPricing } from "./media-billing.js";
import type { ModelDescriptor, NormalizedRequest, ProviderAssetInput } from "./contracts.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cangyuan-contract-update-20261021.json", import.meta.url), "utf8"));
const baseUrl = "https://ai.cangyuansuanli.cn";
const video = (id: string, parameters: Record<string, unknown> = {}, assets?: ProviderAssetInput[]): NormalizedRequest => ({ connectionId: "offline", model: id,
  operation: "video.generate", prompt: "offline", parameters, assets, idempotencyKey: "offline" });
const asset = (id: string, role: ProviderAssetInput["role"] = "reference", kind: ProviderAssetInput["kind"] = "image"): ProviderAssetInput => ({ id, role, kind,
  url: `https://media.example/${id}`, mimeType: kind === "image" ? "image/png" : "audio/mpeg", durationSeconds: 2 });
function adapter(model: ModelDescriptor, image = false) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "original-task", status: "queued" }))
    .mockResolvedValueOnce(Response.json(image ? { status: "completed", data: [{ url: "https://media.example/original.png" }] }
      : { status: "completed", video_url: "https://media.example/original.mp4" }));
  const connector: RestConnectorConfig = { auth: { type: "bearer" }, restrictModels: true, models: [JSON.parse(JSON.stringify(model))],
    submit: { path: "/old/generations", method: "POST", bodyMode: "json" }, poll: { path: "/old/{taskId}", method: "GET", bodyMode: "none" },
    ...(image ? { modelOverrides: { [model.id]: cangyuanCurrentTransport(model.id)! } } : {}), output: { path: "$.old", kind: image ? "image" : "video" } };
  return { fetcher, adapter: new GenericRestAdapter(new StaticConnectionResolver([{ id: "offline", provider: "rest", baseUrl, apiKey: "offline", settings: { connector } }]), { fetch: fetcher }) };
}

describe("Cangyuan exact 21 October schema updates", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Real network forbidden"); })));
  afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  it("retains all 42 exact documents and their per-field descriptions without granting inventory access", () => {
    expect(fixture.schemas).toHaveLength(42);
    for (const row of fixture.schemas) {
      const contract = CANGYUAN_CURRENT_VIDEO_CONTRACTS[row.id]!;
      expect(contract.sourceSha256).toBe(row.sha256);
      expect(contract.checkedAt).toBe(row.checkedAt);
      for (const p of contract.parameters) {
        const documented = row.schema.params.find((raw: { name: string }) => raw.name === p.key);
        // Native face_mode is separately declared in the existing common media guide.
        if (documented) expect(p.description).toBe(documented.description);
      }
      const m = cangyuanVideoModel({ id: row.id, name: row.id, operations: [], metadata: { canvasRunnable: false } });
      expect(m.metadata?.canvasRunnable).toBe(false);
      if (contract.frames) expect(m.metadata?.videoFrameInputDescription).toBe(contract.frameDescription);
    }
  });
  it.each(["omni-fast", "omni-fast-no-water"])("exposes %s's fixed approximate ten-second output and rejects stale saved durations", async id => {
    const m = cangyuanVideoModel({ id, name: id, operations: [] });
    expect(m.parameters?.find(p => p.key === "duration")).toMatchObject({ default: 10, min: 10, max: 10, options: [{ label: "10 秒", value: 10 }] });
    expect(m.metadata?.approximateVideoDurationSeconds).toBe(10);
    const c = adapter(m), invalid = video(id, { duration: 9 }), before = structuredClone(invalid);
    await expect(c.adapter.submit(invalid)).rejects.toThrow();
    expect(invalid).toEqual(before);
    const task = await c.adapter.submit(video(id, { duration: 10 }));
    expect(JSON.parse(String(c.fetcher.mock.calls[0]![1]!.body))).toMatchObject({ model: id, duration: 10 });
    expect((await c.adapter.poll(task)).status).toBe("succeeded");
    expect(String(c.fetcher.mock.calls[1]![0])).toBe(`${baseUrl}/v1/videos/original-task`);
  });
  it("keeps SD8 resolution suggestions open, selects 480p by default, and quotes its generation unit once", () => {
    const id = "sd8-seedance-2.5-n", m = cangyuanVideoModel({ id, name: id, operations: [] });
    expect(m.parameters?.find(p => p.key === "resolution")).toMatchObject({ default: "480p", allowCustomValue: true,
      options: [{ label: "480p", value: "480p" }, { label: "720p", value: "720p" }, { label: "1080p", value: "1080p" }] });
    expect(validateCangyuanVideoRequest(video(id, { resolution: "provider-open-value", duration: 30 }))).toEqual([]);
    const row = fixture.pricingRows.find((row: { model_name: string }) => row.model_name === id);
    const quote = cangyuanCatalogVideoPricing(row, { supplierSiteUrl: baseUrl, group: "VIDEO", multiplier: 1, checkedAt: fixture.checkedAt })!;
    expect(quote.pricing).toMatchObject({ currency: "CNY", billingUnit: "request" });
    for (const [resolution, price] of [["480p", 9], ["720p", 11.25], ["1080p", 20.25]] as const)
      expect(modelPriceAmount(quote.pricing!, { resolution, duration: 30 })).toBe(price);
  });
  it.each(["sd12-seedance-2.0", "sd12-seedance-2.0-fast", "sd12-seedance-2.0-mini"])("rejects %s's frame/audio mixture while retaining permitted ordinary image references", id => {
    const first = asset("first", "firstFrame"), reference = asset("reference");
    expect(validateCangyuanVideoRequest(video(id, {}, [first, reference]))).toEqual([]);
    expect(validateCangyuanVideoRequest(video(id, {}, [first, asset("sound", "reference", "audio")])).some(i => i.message.includes("参考音频"))).toBe(true);
  });
  it("accepts HappyHouse single first frame and rejects role loss, duplicate frames and conflicting explicit fields", async () => {
    const id = "happyhouse-1.0", first = asset("first", "firstFrame");
    expect(validateCangyuanVideoRequest(video(id, {}, [first]))).toEqual([]);
    const c = adapter(cangyuanVideoModel({ id, name: id, operations: [] }));
    for (const request of [video(id, {}, [first, asset("second", "firstFrame")]), video(id, {}, [asset("mask", "mask")]),
      video(id, { first_image_url: "https://media.example/different" }, [first]), video(id, {}, [asset("sound", "firstFrame", "audio")])]) {
      const before = structuredClone(request);
      await expect(c.adapter.submit(request)).rejects.toThrow();
      expect(request).toEqual(before);
    }
    expect(c.fetcher).not.toHaveBeenCalled();
  });
  it.each(["sd5-seedance-2.0", "sd5-seedance-2.0-fast"])("sends %s's zero seed and explicit false audio without dropping them", async id => {
    const c = adapter(cangyuanVideoModel({ id, name: id, operations: [] }));
    await c.adapter.submit(video(id, { duration: 5, seed: 0, generate_audio: false }));
    expect(JSON.parse(String(c.fetcher.mock.calls[0]![1]!.body))).toMatchObject({ seed: 0, generate_audio: false });
  });
  it.each(["flux-3-image", "flux-3-klein"])("submits and polls %s generation/edit with exact tier, original references and native fields", async id => {
    const m = cangyuanCurrentModel({ id, name: id, operations: [] });
    expect(m.operations).toEqual(["image.generate", "image.edit"]);
    expect(m.limits).toMatchObject({ maxInputImages: 10, maxOutputImages: 1 });
    expect(m.metadata).toMatchObject({ imageNativeResolutionParameter: "resolution", imageCustomPixels: false });
    const expected = id === "flux-3-image" ? ["768sq", "1K", "1.5K", "2K", "4K"] : ["1K", "2K", "4K"];
    expect(m.parameters?.find(p => p.key === "resolution")?.options?.map(o => o.value)).toEqual(expected);
    expect(m.parameters?.find(p => p.key === "aspect_ratio")?.default).toBe(id === "flux-3-image" ? "auto" : "1:1");
    for (const edit of [false, true]) {
      const c = adapter(m, true), references = [asset("original-alpha.png"), asset("second.webp")];
      const parameters = { resolution: "4K", aspect_ratio: "auto", n: 1, ...(id === "flux-3-klein" ? { output_format: "webp", enable_prompt_expansion: false, seed: "0" } : {}) };
      const request: NormalizedRequest = { connectionId: "offline", operation: edit ? "image.edit" : "image.generate", model: id, prompt: "offline", parameters,
        ...(edit ? { assets: references } : {}), idempotencyKey: "offline" };
      const before = structuredClone(request), task = await c.adapter.submit(request);
      const route = edit ? "edits" : "generations", body = JSON.parse(String(c.fetcher.mock.calls[0]![1]!.body));
      expect(String(c.fetcher.mock.calls[0]![0])).toBe(`${baseUrl}/v1/images/${route}`);
      expect(body).toMatchObject({ resolution: "4K", size: "auto", n: 1 });
      expect(body).not.toHaveProperty("aspect_ratio");
      if (edit) expect(body.images).toEqual(references.map(a => a.url));
      if (id === "flux-3-klein") expect(body).toMatchObject({ output_format: "webp", enable_prompt_expansion: false, seed: "0" });
      expect(request).toEqual(before);
      expect((await c.adapter.poll(task)).status).toBe("succeeded");
      expect(String(c.fetcher.mock.calls[1]![0])).toBe(`${baseUrl}/v1/images/${route}/original-task`);
    }
    const row = fixture.pricingRows.find((r: { model_name: string }) => r.model_name === id);
    const quote = mediaExpressionPricing(row.billing_expr, { currency: "CNY", multiplier: 1, checkedAt: fixture.checkedAt, sourceUrl: `${baseUrl}/api/pricing`, unit: "image" })!;
    expect(modelPriceAmount(quote, { resolution: "4K", n: 1 })).toBe(id === "flux-3-image" ? 8.498 : .56875);
    for (const parameters of [{ n: 2 }, { width: 4096, height: 4096 }, { background: "transparent" }, { quality: "max" }])
      expect(cangyuanCurrentRequestIssues({ connectionId: "offline", operation: "image.generate", model: id, prompt: "offline", parameters, idempotencyKey: "offline" }, baseUrl)).not.toEqual([]);
  });
});
