import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import type { ModelDescriptor, NormalizedRequest } from "./contracts.js";
import { CANGYUAN_CURRENT_VIDEO_CONTRACTS } from "./cangyuan-video-contract-data.js";
import { cangyuanVideoModel, cangyuanVideoTransport, normalizeCangyuanVideoParameters, validateCangyuanVideoRequest } from "./cangyuan-video-contract.js";
import { cangyuanCatalogVideoPricing } from "./cangyuan-catalog-video-pricing.js";
import { modelPriceAmount } from "./media-billing.js";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cangyuan-contract-update-20261020.json", import.meta.url), "utf8")) as {
  checkedAt: string; status: { quota_display_type: string; usd_exchange_rate: number };
  schemas: { id: string; checkedAt: string; sha256: string; schema: { status: string; params: { name: string }[] } }[];
  pricingRows: Record<string, unknown>[];
};
const fresh = ["sd8-seedance-2.5-n", "sd15-seedance-2.5-2", "sd16-seedance-2.5-2", "sd17-seedance-2.0-4", "sd17-seedance-2.5-4"];
const latestSchemas = JSON.parse(readFileSync(new URL("./fixtures/cangyuan-contract-update-20261021.json", import.meta.url), "utf8")).schemas as typeof fixture.schemas;
const baseUrl = "https://ai.cangyuansuanli.cn";
const request = (id: string, parameters: Record<string, unknown> = {}): NormalizedRequest => ({ connectionId: "offline", model: id,
  operation: "video.generate", prompt: "offline contract", parameters, idempotencyKey: "offline-contract" });
const descriptor = (id: string): ModelDescriptor => cangyuanVideoModel({ id, name: id, operations: ["video.generate"], metadata: { canvasRunnable: true } });

describe("Cangyuan current exact video additions", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Real network forbidden"); })));
  afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

  it.each(fresh)("roundtrips %s's declared fields, reference roles and original task using mocked transport", async id => {
    const evidence = latestSchemas.find(row => row.id === id) ?? fixture.schemas.find(row => row.id === id)!;
    const model = descriptor(id), contract = CANGYUAN_CURRENT_VIDEO_CONTRACTS[id]!;
    expect(model.metadata).toMatchObject({ videoContractDocumentSha256: evidence.sha256,
      cangyuanVideoContractCheckedAt: evidence.checkedAt, videoContractSourceStatus: "current", supportsFirstLastFrames: false });
    expect(contract.fields).toEqual(evidence.schema.params.map(parameter => parameter.name).filter(name => !["model", "prompt"].includes(name)));
    const duration = model.parameters?.find(parameter => parameter.key === "duration")?.min!;
    const connector: RestConnectorConfig = { auth: { type: "bearer" }, models: [JSON.parse(JSON.stringify(model))], restrictModels: true,
      submit: { path: "/old/images", method: "POST", bodyMode: "json" }, poll: { path: "/old/images/{taskId}", method: "GET", bodyMode: "none" },
      output: { path: "$.old_image", kind: "image" } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "original-task", status: "processing" }))
      .mockResolvedValueOnce(Response.json({ id: "original-task", status: "completed", video_url: "https://media.example/original.mp4" }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "offline", provider: "rest", baseUrl, apiKey: "offline-only",
      settings: { connector } }]), { fetch: fetcher });
    const input = { ...request(id, { duration, aspect_ratio: "5:3", resolution: "720p", ...(contract.fields.includes("generate_audio") ? { generate_audio: false } : {}) }),
      assets: [{ id: "image", kind: "image" as const, role: "reference" as const, mimeType: "image/png", url: "https://media.example/original.png" },
        { id: "video", kind: "video" as const, role: "reference" as const, mimeType: "video/mp4", url: "https://media.example/reference.mp4" },
        { id: "audio", kind: "audio" as const, role: "reference" as const, mimeType: "audio/mpeg", url: "https://media.example/reference.mp3" }] };
    const task = await adapter.submit(input);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(String(fetcher.mock.calls[0]![0])).toBe(`${baseUrl}/v1/videos`);
    expect(body).toMatchObject({ model: id, duration, aspect_ratio: "5:3", resolution: "720p",
      reference_image_urls: [input.assets[0]!.url], reference_videos: [input.assets[1]!.url], reference_audios: [input.assets[2]!.url] });
    expect(Object.keys(body).every(key => ["model", "prompt", ...contract.fields].includes(key))).toBe(true);
    expect((await adapter.poll(task)).status).toBe("succeeded");
    expect(String(fetcher.mock.calls[1]![0])).toBe(`${baseUrl}/v1/videos/original-task`);
    expect(cangyuanVideoTransport(id)?.submit?.path).toBe("/v1/videos");
    expect(input.parameters).toMatchObject({ duration, aspect_ratio: "5:3" });
  });

  it.each(fresh)("checks %s's own duration and counts while retaining open string suggestions", id => {
    const contract = CANGYUAN_CURRENT_VIDEO_CONTRACTS[id]!, duration = contract.parameters.find(parameter => parameter.key === "duration")!;
    expect(validateCangyuanVideoRequest(request(id, { duration: duration.min, aspect_ratio: "5:3" }))).toEqual([]);
    for (const value of [duration.min! - 1, duration.max! + 1, 5.5, "5"])
      expect(validateCangyuanVideoRequest(request(id, { duration: value })).some(issue => issue.path === "parameters.duration")).toBe(true);
    expect(validateCangyuanVideoRequest(request(id, { reference_image_urls: Array.from({ length: contract.references.images! + 1 }, (_, index) => `https://media.example/${index}.png`) }))).not.toEqual([]);
    expect(validateCangyuanVideoRequest(request(id, { last_image_url: "https://media.example/last.png" }))).not.toEqual([]);
  });

  it.each(fresh)("rejects %s's first/last-frame roles without converting them to references", id => {
    for (const role of ["firstFrame", "lastFrame"] as const) {
      const input = { ...request(id), assets: [{ id: "original", kind: "image" as const, role, mimeType: "image/png", url: "https://media.example/original.png" }] };
      const normalized = normalizeCangyuanVideoParameters(input);
      expect(normalized.reference_image_urls).toBeUndefined();
      expect(validateCangyuanVideoRequest(input).some(issue => issue.path === `parameters.${role === "firstFrame" ? "first_image_url" : "last_image_url"}`)).toBe(true);
      expect(input.assets[0]!.role).toBe(role);
    }
  });

  it("retains a deprecated model and any existing Key denial without clearing saved parameters", () => {
    const id = "sd8-seedance-2.5-s", saved = request(id, { duration: 30 });
    expect(descriptor(id).metadata).toMatchObject({ videoContractSourceStatus: "deprecated", canvasRunnable: true });
    expect(cangyuanVideoModel({ id, name: id, operations: ["video.generate"], metadata: { canvasRunnable: false } }).metadata?.canvasRunnable).toBe(false);
    expect(validateCangyuanVideoRequest(saved)).toEqual([]);
    expect(saved.parameters).toEqual({ duration: 30 });
  });
});

describe("Cangyuan published current request and second tariffs", () => {
  const options = { supplierSiteUrl: baseUrl, group: "VIDEO", currency: fixture.status.quota_display_type, multiplier: 1, checkedAt: fixture.checkedAt };
  it.each([
    ["sd16-seedance-2.5-2", "720p", 8.1, "request"], ["sd11-seedance-2.5", "1080p", 29, "request"],
    ["sd11-seedance-2.0", "720p", 9.6, "request"], ["sd11-seedance-2.0-fast", "480p", 3.5, "request"],
    ["sd11-seedance-2.0-mini", "720p", 4.7, "request"], ["mm2-minimax-h3", "2K", 14, "request"],
    ["mm2-minimax-h3-max", "768P", 8.9, "request"], ["wan4-wan3.0", "1080P", 20.7, "request"],
    ["kl1-kling-3.0", "1080p", 6.1, "request"], ["sd17-seedance-2.0-4", "720p", .46, "second"],
    ["sd17-seedance-2.5-4", "1080p", 2, "second"],
  ] as const)("prices %s by %s with the exact declared unit", (id, resolution, rate, unit) => {
    const row = fixture.pricingRows.find(row => row.model_name === id)!;
    const quote = cangyuanCatalogVideoPricing(row, options)!;
    expect(quote.pricing).toMatchObject({ currency: "CNY", billingUnit: unit });
    expect(modelPriceAmount(quote.pricing!, { resolution, duration: 30 })).toBe(rate);
    const half = cangyuanCatalogVideoPricing(row, { ...options, multiplier: .5 })!;
    expect(modelPriceAmount(half.pricing!, { resolution })).toBe(rate * .5);
    expect(cangyuanCatalogVideoPricing(row, { ...options, group: "IMAGE" })).toBeUndefined();
    expect(cangyuanCatalogVideoPricing(row, { ...options, supplierSiteUrl: "https://other.example" })).toBeUndefined();
    expect(cangyuanCatalogVideoPricing({ ...row, billing_capability: "image" }, options)).toBeUndefined();
    expect(cangyuanCatalogVideoPricing({ ...row, billing_expr: String(row.billing_expr) + ";unsafe()" }, options)).toBeUndefined();
  });
});
