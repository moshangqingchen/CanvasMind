import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import { parseLangframeCatalog, langframeModelsForKey } from "./langframe-catalog.js";
import { LangframeAdapter } from "./langframe.js";
import { StaticConnectionResolver } from "./credentials.js";
import { modelPriceAmount } from "./media-billing.js";
import type { NormalizedRequest, ProviderAssetInput } from "./contracts.js";

const source = JSON.parse(readFileSync(new URL("./fixtures/langframe-catalog-20261021.json", import.meta.url), "utf8"));
const catalog = parseLangframeCatalog(source.payload, { checkedAt: source.checkedAt, sourceSha256: source.sha256 });
const model = (id: string) => catalog.models.find(m => m.id === id)!;
const input = (id: string, assets?: ProviderAssetInput[], duration?: number): NormalizedRequest => {
  const raw = model(id).metadata!.rawParams as { resolutions: string[]; durations: number[]; ratios: string[] };
  return { connectionId: "offline", model: id, operation: "video.generate", prompt: "offline", idempotencyKey: "offline",
    parameters: { resolution: raw.resolutions[0], ratio: raw.ratios[0], duration: duration ?? raw.durations[0] }, assets };
};
function client() {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ taskId: "saved-task", status: "queued" }))
    .mockResolvedValueOnce(Response.json({ task: { status: "completed", download_url: "https://media.example/original.mp4" } }));
  const adapter = new LangframeAdapter(new StaticConnectionResolver([{ id: "offline", provider: "langframe", baseUrl: "https://vipprompt.cn/v1", apiKey: "offline",
    settings: { scannedModelIds: catalog.models.map(m => m.id), modelCatalogModels: JSON.parse(JSON.stringify(catalog.models)) } }]), { fetch: fetcher });
  return { adapter, fetcher };
}
const asset = (id: string, kind: "image" | "video" | "audio", role: ProviderAssetInput["role"] = "reference"): ProviderAssetInput => ({ id, kind, role,
  mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg", url: `https://media.example/${id}`, durationSeconds: 2 });

describe("Langframe 21 October exact public contracts", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Real network forbidden"); })));
  afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  it("retains both new full call names, category prices and explicit/described material limits", () => {
    expect(catalog.complete).toBe(true);
    expect(catalog.groups).toHaveLength(42);
    for (const [group, id, prices] of [
      ["kling-v4-VIP-支持真人", "kling-v4-VIP-支持真人", { "720P": .399, "1080P": .699 }],
      ["SSD-2.5-M3支持真人满血", "SD-2.5-S支持真人满血", { "480P": .49, "720P": .59, "1080P": 1.399 }],
    ] as const) {
      const selected = langframeModelsForKey(catalog.groups, [group], [id]);
      expect(selected.map(m => m.id)).toEqual([id]);
      for (const [resolution, value] of Object.entries(prices)) expect(modelPriceAmount(selected[0]!.pricing!, { resolution })).toBe(value);
    }
    expect(model("SD-2.5-S支持真人满血").limits).toMatchObject({ maxInputImages: 30, maxInputVideos: 10, maxInputAudios: 10 });
    expect(model("kling-v4-VIP-支持真人").limits).toMatchObject({ maxInputImages: 10, maxInputVideos: 5, maxInputAudios: 3, maxInputAssets: 15 });
  });
  it.each(["SD2.5-X-满参支持人脸", "SD2.5-C-满参支持人脸"])("accepts %s's new 5–30 second selections without rewriting old values", async id => {
    const c = client();
    expect(model(id).parameters?.find(p => p.key === "duration")?.options?.map(o => o.value)).toEqual(Array.from({ length: 26 }, (_, i) => i + 5));
    for (const duration of [5, 9, 10, 30]) expect((await c.adapter.validate(input(id, undefined, duration))).valid).toBe(true);
    const invalid = input(id, undefined, 4), saved = structuredClone(invalid);
    expect((await c.adapter.validate(invalid)).valid).toBe(false);
    expect(invalid).toEqual(saved);
  });
  const formats = [...new Map(catalog.models.filter(m => m.outputKinds?.includes("video")).map(m => [String(m.metadata?.langframeRequestFormat), m])).values()];
  it.each(formats)("submits $id through the universal public route and keeps original typed materials", async m => {
    const c = client();
    const media = m.metadata?.langframeRequestFormat === "image-to-video" ? [asset("image", "image", "firstFrame")]
      : [asset("image", "image"), ...(m.limits?.maxInputVideos === 0 ? [] : [asset("video", "video")]), ...(m.limits?.maxInputAudios === 0 ? [] : [asset("audio", "audio")])];
    const request = input(m.id, media), before = structuredClone(request), task = await c.adapter.submit(request);
    expect(String(c.fetcher.mock.calls[0]![0])).toBe("https://vipprompt.cn/v1/videos");
    const body = JSON.parse(String(c.fetcher.mock.calls[0]![1]!.body));
    expect(body.media).toEqual(media.map(a => ({ type: a.kind === "image" ? "reference_image" : a.kind === "video" ? "reference_video" : "audio", url: a.url })));
    expect(body).not.toHaveProperty("requestFormat");
    expect(body).not.toHaveProperty("faceProcessing");
    expect(request).toEqual(before);
    expect((await c.adapter.poll(task)).status).toBe("succeeded");
    expect(String(c.fetcher.mock.calls[1]![0])).toBe("https://vipprompt.cn/v1/videos/tasks/saved-task");
  });
  it("rejects undeclared frame roles and mixed image-only/combined limits before transport", async () => {
    const c = client(), id = "kling-v4-VIP-支持真人";
    for (const materials of [[asset("first", "image", "firstFrame"), asset("last", "image", "lastFrame")],
      [asset("invalid", "video", "firstFrame")], Array.from({ length: 3 }, (_, i) => asset(`image${i}`, "image")),
      [...Array.from({ length: 10 }, (_, i) => asset(`image${i}`, "image")), ...Array.from({ length: 5 }, (_, i) => asset(`video${i}`, "video")), asset("audio", "audio")]]) {
      const request = input(id, materials), before = structuredClone(request);
      await expect(c.adapter.submit(request)).rejects.toThrow();
      expect(request).toEqual(before);
    }
    expect(c.fetcher).not.toHaveBeenCalled();
  });
});
