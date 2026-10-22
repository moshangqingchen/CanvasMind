import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import { langframeModelDescriptor, langframeModelsForKey, parseLangframeCatalog } from "./langframe-catalog.js";
import { LangframeAdapter } from "./langframe.js";
import { StaticConnectionResolver } from "./credentials.js";
import { modelPriceAmount } from "./media-billing.js";
import type { NormalizedRequest, ProviderAssetInput } from "./contracts.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/langframe-catalog-20261020.json", import.meta.url), "utf8"));
const parsed = parseLangframeCatalog(fixture.payload, { checkedAt: fixture.checkedAt, sourceSha256: fixture.sha256 });
const selected = (id: string) => parsed.models.find(model => model.id === id)!;
const freshM = "SD-2.5-M支持真人满血稳定版", freshWan = "wwan3.0-VIP支持真人10-0-5";
const input = (id: string, parameters?: Record<string, unknown>, assets?: ProviderAssetInput[]): NormalizedRequest => ({
  connectionId: "offline", idempotencyKey: "offline-contract", operation: "video.generate", model: id, prompt: "offline contract", parameters, assets,
});
function adapter() {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ taskId: "original-task", status: "queued" }))
    .mockResolvedValueOnce(Response.json({ task: { taskId: "original-task", status: "completed", download_url: "https://media.example/original.mp4" } }));
  return { fetcher, adapter: new LangframeAdapter(new StaticConnectionResolver([{ id: "offline", provider: "langframe", apiKey: "offline-only",
    baseUrl: "https://vipprompt.cn/v1", settings: { scannedModelIds: parsed.models.map(model => model.id), modelCatalogModels: JSON.parse(JSON.stringify(parsed.models)) } }]), { fetch: fetcher }) };
}

describe("Langframe current public category and downstream contracts", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Real network forbidden"); })));
  afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

  it("keeps full new call names, exact category identity, limits and tariffs after saved JSON restoration", () => {
    expect(parsed).toMatchObject({ recognized: true, complete: true });
    expect(parsed.groups).toHaveLength(40);
    const mGroup = parsed.groups.find(group => group.id === "SD-2.5-m支持真人满血")!;
    expect(mGroup.models.map(model => model.id)).toEqual([freshM]);
    expect(langframeModelsForKey(parsed.groups, [mGroup.id], [freshM]).map(model => model.id)).toEqual([freshM]);
    expect(selected(freshM).limits).toMatchObject({ maxInputImages: 30, maxInputVideos: 10, maxInputAudios: 10 });
    expect(selected(freshWan).limits).toMatchObject({ maxInputImages: 10, maxInputVideos: 0, maxInputAudios: 5 });
    for (const [id, resolution, rate] of [[freshM, "480P", .49], [freshM, "720P", .99], [freshM, "1080P", 2.19],
      [freshWan, "480P", .39], [freshWan, "720P", .59], [freshWan, "1080P", 1.19],
      ["kling-video-v4", "720P", .269], ["kling-video-v4", "1080P", .369]] as const) {
      const model = selected(id);
      expect(model.pricing).toMatchObject({ currency: "CNY", billingUnit: "second" });
      expect(modelPriceAmount(model.pricing!, { resolution })).toBe(rate);
    }
    expect(langframeModelDescriptor(JSON.parse(JSON.stringify(mGroup.models[0])))).toEqual(selected(freshM));
  });

  it.each(["SD2.5-X-满参支持人脸", "SD2.5-C-满参支持人脸"])("enforces %s's current ten-second minimum without retaining old source prose", async id => {
    const model = selected(id), duration = model.parameters?.find(parameter => parameter.key === "duration")!;
    expect(duration.options?.map(option => option.value)).toEqual(Array.from({ length: 21 }, (_, index) => index + 10));
    expect(model.metadata?.langframeCatalogConflicts).toContain("描述时长4–30秒，目录枚举10–30秒；保留原文并按显式枚举校验。");
    const f = adapter();
    for (const seconds of [4, 5, 8, 9]) {
      const saved = input(id, { resolution: "720P", duration: seconds }), before = structuredClone(saved);
      expect((await f.adapter.validate(saved)).valid).toBe(false);
      await expect(f.adapter.submit(saved)).rejects.toThrow();
      expect(saved).toEqual(before);
    }
    expect(f.fetcher).not.toHaveBeenCalled();
    expect((await f.adapter.validate(input(id, { resolution: "720P", duration: 10 }))).valid).toBe(true);
  });

  const representative = [...new Map(parsed.models.filter(model => model.outputKinds?.includes("video"))
    .map(model => [String(model.metadata?.langframeRequestFormat), model])).values()];
  it.each(representative)("keeps $id's upstream requestFormat behind the universal public video submit/query contract", async model => {
    const raw = model.metadata!.rawParams as { resolutions: string[]; durations: number[]; ratios: string[] };
    const f = adapter(), assets = model.limits?.requiresInputImage
      ? [{ id: "image", kind: "image" as const, mimeType: "image/png", role: "reference" as const, url: "https://media.example/original.png" }] : undefined;
    const request = input(model.id, { resolution: raw.resolutions[0], duration: raw.durations[0], ratio: raw.ratios[0] }, assets);
    const task = await f.adapter.submit(request);
    expect(String(f.fetcher.mock.calls[0]![0])).toBe("https://vipprompt.cn/v1/videos");
    const body = JSON.parse(String(f.fetcher.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ model: model.id, resolution: raw.resolutions[0], duration: raw.durations[0], ratio: raw.ratios[0] });
    expect(body).not.toHaveProperty("requestFormat");
    expect(body).not.toHaveProperty("faceProcessing");
    expect((await f.adapter.poll(task)).status).toBe("succeeded");
    expect(String(f.fetcher.mock.calls[1]![0])).toBe("https://vipprompt.cn/v1/videos/tasks/original-task");
  });

  it("rejects a video reference in the new WAN zero-video contract before transport", async () => {
    const f = adapter(), request = input(freshWan, { resolution: "720P", duration: 10 }, [{ id: "video", kind: "video", mimeType: "video/mp4", url: "https://media.example/original.mp4" }]);
    expect((await f.adapter.validate(request)).issues.some(issue => issue.message.includes("最多接收 0"))).toBe(true);
    await expect(f.adapter.submit(request)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
