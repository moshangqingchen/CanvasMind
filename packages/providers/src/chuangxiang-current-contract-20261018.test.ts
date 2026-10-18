import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { StaticConnectionResolver } from "./credentials.js";
import type { ModelDescriptor, NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { chuangxiangVideoModel, normalizeChuangxiangVideoParameters, isChuangxiangVideoConnection } from "./chuangxiang-video-contract.js";
import { chuangxiangCatalogPricing } from "./chuangxiang-catalog-pricing.js";
import { resolveImageModelContract } from "./image-model-contract.js";
import { OpenAIImageAdapter } from "./openai.js";

// Captured official model capability response and exact new plaza rows, rather
// than expectations generated from the implementation's capability table.
const captured = JSON.parse(fs.readFileSync(new URL("./fixtures/chuangxiang-video-contract-20261018.json", import.meta.url), "utf8"));
type Native = { id: string; duration_seconds: { min: number; max: number }; supported_resolutions: string[]; max_images_per_prompt: number; max_videos_per_prompt?: number; max_audios_per_prompt?: number };
const native: Native[] = captured.models;
const newIds: string[] = captured.newModels.map((m: { name: string }) => m.name);
const config = { baseUrl: "https://vapi.chuangxiangai.asia", accountKeyGroup: "视频", accountKeyGroupId: "27", usage: "canvas", modelScanStatus: "live" };
const asset = (kind: "image" | "video" | "audio", role?: "reference" | "firstFrame" | "lastFrame"): ProviderAssetInput => ({
  id: `${kind}-${role ?? "ref"}`, kind, mimeType: `${kind}/${kind === "image" ? "png" : kind === "video" ? "mp4" : "mpeg"}`,
  url: `https://assets.example/${kind}-${role ?? "ref"}`, ...(role ? { role } : {}), durationSeconds: 1,
});
function request(id: string, parameters: Record<string, unknown> = {}, assets: readonly ProviderAssetInput[] = []): NormalizedRequest {
  return { connectionId: "cx-current", model: id, operation: "video.generate", prompt: "Offline mock only", parameters, assets, idempotencyKey: "mock-single-submit" };
}
function fixture(id: string, responses: Response[] = [], overrides: Record<string, unknown> = {}) {
  const descriptor = chuangxiangVideoModel(id, { id, name: id, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"], metadata: { canvasRunnable: true } });
  const fetcher = vi.fn<typeof fetch>(async () => { throw Error("Unexpected mocked HTTP"); });
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  const resolver = new StaticConnectionResolver([{ id: "cx-current", provider: "openai", baseUrl: config.baseUrl, apiKey: "mock-original-key",
    settings: { ...config, scannedModelIds: [id], modelCatalogModels: [descriptor], ...overrides } }]);
  const fallback = new OpenAIImageAdapter(resolver, { fetch: fetcher });
  return { adapter: new AutoInterfaceAdapter(resolver, fallback, { fetch: fetcher }), fetcher, descriptor };
}

describe("Creative exact current video contracts", () => {
  it.each(native)("enforces official bounds and resolution for $id through the full adapter", async n => {
    const f = fixture(n.id), refs = n.id.startsWith("omni-v2v") ? [asset("video")] : [];
    const base = request(n.id, { duration: n.duration_seconds.min, resolution: n.supported_resolutions[0], n: 1 }, refs);
    expect(await f.adapter.validate(base)).toEqual({ valid: true, issues: [] });
    for (const duration of [n.duration_seconds.min - 1, n.duration_seconds.max + 1, 1.5, -1]) {
      const input = { ...base, parameters: { ...base.parameters, duration } };
      expect((await f.adapter.validate(input)).issues).toContainEqual(expect.objectContaining({ path: "parameters.duration" }));
      expect(input.parameters.duration).toBe(duration);
    }
    expect((await f.adapter.validate({ ...base, parameters: { ...base.parameters, resolution: "unpublished" } })).issues)
      .toContainEqual(expect.objectContaining({ path: "parameters.resolution" }));
    const d = f.descriptor;
    expect(d.limits).toMatchObject({ maxInputVideos: n.max_videos_per_prompt ?? 0, maxInputAudios: n.max_audios_per_prompt ?? 0 });
    expect(d.metadata).toMatchObject({ videoMinDuration: n.duration_seconds.min, videoMaxDuration: n.duration_seconds.max, videoSupportedResolutions: n.supported_resolutions });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each(newIds)("submits and resumes the exact new $id without an Images fallback", async id => {
    const n = native.find(m => m.id === id)!;
    const f = fixture(id, [Response.json({ id: "original-task", status: "queued" }, { headers: { "x-request-id": "header-is-not-task" } }),
      Response.json({ status: "completed", metadata: { url: "/v1/videos/original-task/content" } }),
      new Response(new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112]), { headers: { "content-type": "video/mp4" } })]);
    const input = { ...request(id, { duration: n.duration_seconds.min, resolution: n.supported_resolutions[0], aspect_ratio: "16:9", n: 1 }, [asset("image")]), operation: "video.image-to-video" as const };
    const task = await f.adapter.submit(input);
    expect(task.providerTaskId).toBe("original-task");
    expect(task.pollAfterMs).toBe(10000);
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(String(url)).toBe(`${config.baseUrl}/v1/videos/generations`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer mock-original-key");
    expect(JSON.parse(String(init?.body))).toEqual({ model: id, prompt: input.prompt, ...input.parameters, reference_image_urls: [asset("image").url] });
    const state = await f.adapter.poll(JSON.parse(JSON.stringify(task)));
    expect(state.status).toBe("succeeded");
    expect(String(f.fetcher.mock.calls[1]![0])).toBe(`${config.baseUrl}/v1/videos/generations/original-task`);
    const output = await f.adapter.extractOutputs(state.result);
    expect(output).toMatchObject([{ kind: "video", mimeType: "video/mp4", data: expect.any(Uint8Array) }]);
    expect(String(f.fetcher.mock.calls[2]![0])).toBe(`${config.baseUrl}/v1/videos/original-task/content`);
    expect(new Headers(f.fetcher.mock.calls[2]![1]?.headers).get("authorization")).toBe("Bearer mock-original-key");
    expect(f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("keeps SD16 paired frames compatible with references, while SD17 excludes frames and enforces its discrete seconds", async () => {
    const refs = [asset("image", "firstFrame"), asset("image", "lastFrame"), asset("image"), asset("video"), asset("audio")];
    const f = fixture("sd16-seedance-2.0", [Response.json({ task_id: "one", status: "processing" })]);
    await f.adapter.submit(request("sd16-seedance-2.0", { duration: 10, resolution: "4k" }, refs));
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body))).toMatchObject({ first_image_url: refs[0]!.url, last_image_url: refs[1]!.url,
      reference_image_urls: [refs[2]!.url], reference_videos: [refs[3]!.url], reference_audios: [refs[4]!.url] });
    expect((await f.adapter.validate(request("sd16-seedance-2.0", { duration: 10 }, [refs[0]!]))).valid).toBe(false);
    const sd17 = fixture("sd17-seedance-2.0-3");
    for (const duration of [6, 9, 11, 14]) expect((await sd17.adapter.validate(request("sd17-seedance-2.0-3", { duration }))).valid).toBe(false);
    for (const duration of [5, 10, 15]) expect((await sd17.adapter.validate(request("sd17-seedance-2.0-3", { duration }))).valid).toBe(true);
    expect((await sd17.adapter.validate(request("sd17-seedance-2.0-3", { duration: 10 }, refs))).valid).toBe(false);
    expect(sd17.fetcher).not.toHaveBeenCalled();
  });

  it("distinguishes MM4 URL strings from MM3 timed video objects and enforces the new exact reference limits", async () => {
    const f = fixture("mm4-minimax-h3-2k", [Response.json({ request_id: "mm4", status: "pending" })]);
    await f.adapter.submit(request("mm4-minimax-h3-2k", { duration: 5, resolution: "2k" }, [asset("video"), asset("audio")]));
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body))).toMatchObject({ reference_videos: [asset("video").url] });
    expect((await f.adapter.validate(request("mm4-minimax-h3-2k", { duration: 5, reference_videos: [{ url: asset("video").url, duration: 1 }] }))).valid).toBe(false);
    const mm3 = normalizeChuangxiangVideoParameters(request("mm3-minimax-h3-2k", { duration: 15 }, [asset("video")]));
    expect(mm3.reference_videos).toEqual([{ url: asset("video").url, duration: 1 }]);
    for (const id of newIds) {
      const n = native.find(n => n.id === id)!, f = fixture(id);
      for (const [key, limit] of [["reference_image_urls", n.max_images_per_prompt], ["reference_videos", n.max_videos_per_prompt ?? 0], ["reference_audios", n.max_audios_per_prompt ?? 0]] as const)
        expect((await f.adapter.validate(request(id, { duration: n.duration_seconds.min, [key]: Array.from({ length: limit + 1 }, (_, i) => `https://assets.example/${i}`) }))).valid).toBe(false);
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  });

  it("requires actual same-group membership and never silently normalizes invalid saved choices", async () => {
    const id = "sd17-seedance-2.5-3", input = request(id, { duration: 29, resolution: "1080p" });
    const f = fixture(id);
    expect((await f.adapter.validate(input)).valid).toBe(false);
    expect(normalizeChuangxiangVideoParameters(input)).toMatchObject({ duration: 29, resolution: "1080p" });
    for (const changed of [{ scannedModelIds: [] }, { accountKeyGroupId: "43" }, { usage: "disabled" }]) {
      const other = fixture(id, [], changed);
      expect((await other.adapter.validate(request(id, { duration: 30, resolution: "720p" }))).valid).toBe(false);
      expect(other.fetcher).not.toHaveBeenCalled();
    }
    expect(isChuangxiangVideoConnection({ ...config, baseUrl: "https://other.example" }, id)).toBe(false);
    expect(isChuangxiangVideoConnection(config, "sd17-seedance-2.5-unknown")).toBe(false);
  });

  it.each(captured.newModels)("retains the current per-task resolution price exactly once for $name", row => {
    const priced = chuangxiangCatalogPricing(row, captured.sources.plaza.sampledAt)!;
    expect(priced.pricing).toMatchObject({ kind: "per-request", billingUnit: "request", currency: "CNY" });
    for (const [resolution, raw] of Object.entries(row.video_pricing.prices))
      expect(priced.pricing.tiers?.find(t => t.id === resolution)?.price).toBeCloseTo(Number(raw) * row.effective_rate_multiplier);
    const model = chuangxiangVideoModel(row.name, { id: row.name, name: row.name, operations: ["video.generate"], pricing: priced.pricing });
    expect(model.pricing).toEqual(priced.pricing); // no duration multiplication or second group multiplier
  });
});

describe("Creative GPT2 declared quality survives common presets", () => {
  it.each(["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k"])("retains all five supplier values and max for %s", id => {
    const connection = { provider: "openai", config: { baseUrl: config.baseUrl, accountKeyGroup: "生图", accountKeyGroupId: "43", usage: "canvas" } };
    const saved: ModelDescriptor = { id, name: id, operations: ["image.generate", "image.edit"], parameters: [{ key: "quality", label: "old", control: "select", default: "high", options: ["auto", "low", "medium", "high"].map(value => ({ value, label: value })) }] };
    const model = resolveImageModelContract(connection, saved), quality = model.parameters?.find(p => p.key === "quality");
    expect(quality?.options?.map(o => o.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(quality?.default).toBe("max");
    expect(saved.parameters?.[0]?.default).toBe("high");
    expect(saved.parameters?.[0]?.options).toHaveLength(4);
    const unrelated = resolveImageModelContract({ ...connection, config: { ...connection.config, baseUrl: "https://other.example" } }, saved);
    expect(unrelated.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["auto", "low", "medium", "high"]);
  });

  it.each(["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k", "midjourney-1k", "midjourney-2k"])("keeps the already-supported URL mask outside reference images for %s", async id => {
    for (const maskSource of ["asset", "parameter"]) {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://assets.example/generated.png" }] }));
      const resolver = new StaticConnectionResolver([{ id: "cx-mask", provider: "openai", baseUrl: config.baseUrl, apiKey: "offline-image-key",
        settings: { accountKeyGroup: "生图", accountKeyGroupId: "43", usage: "canvas", scannedModelIds: [id], modelScanStatus: "live",
          modelCatalogModels: [{ id, name: id, operations: ["image.generate", "image.edit"], metadata: { canvasRunnable: true } }] } }]);
      const adapter = new AutoInterfaceAdapter(resolver, new OpenAIImageAdapter(resolver, { fetch: fetcher }), { fetch: fetcher });
      const original = asset("image"), mask = { ...asset("image"), id: "mask", role: "mask" as const, url: "https://assets.example/mask.png", mimeType: "image/png" };
      const parameters = { ...(id.startsWith("midjourney-") ? { reference: "editor" } : { quality: "xhigh" }), ...(maskSource === "parameter" ? { mask: mask.url } : {}) };
      await adapter.submit({ connectionId: "cx-mask", model: id, operation: "image.edit", prompt: "Offline mask contract", parameters,
        assets: maskSource === "asset" ? [original, mask] : [original], idempotencyKey: "offline-mask-once" });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(String(fetcher.mock.calls[0]![0])).toBe(`${config.baseUrl}/v1/images/edits`);
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
      expect(body).toMatchObject({ model: id, images: [original.url], mask: mask.url });
      if (id.startsWith("gpt-")) expect(body.quality).toBe("xhigh");
    }
  });
});
