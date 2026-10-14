import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cangyuanVideoModel, cangyuanVideoTransport, normalizeCangyuanVideoParameters, validateCangyuanVideoRequest } from "./cangyuan-video-contract.js";
import { chentuCatalogVideoPricing } from "./catalog-pricing.js";
import { parseSupplierCatalog } from "./supplier-catalog.js";
import type { NormalizedRequest } from "./contracts.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/supplier-b-video-20261013.json", import.meta.url), "utf8"));
const request = (model: string, parameters: Record<string, unknown> = {}): NormalizedRequest => ({ connectionId: "offline", model, operation: "video.generate", prompt: "海边", idempotencyKey: "offline", parameters });
const models = [
  ["sd16-seedance-2.0", 4, 15, 9, 3, 3], ["sd16-seedance-2.0-fast", 4, 15, 9, 3, 3], ["sd16-seedance-2.0-mini", 4, 15, 9, 3, 3],
  ["sd17-seedance-2.0", 5, 15, 9, 0, 3], ["sd17-seedance-2.0-2", 5, 15, 9, 0, 3], ["sd17-seedance-2.0-3", 5, 15, 9, 0, 0],
  ["sd17-seedance-2.5", 5, 30, 30, 10, 0], ["sd17-seedance-2.5-2", 10, 30, 30, 10, 10], ["sd17-seedance-2.5-3", 30, 30, 9, 0, 0],
  ["gv4-grok-imagine-video-1.5", 6, 15, 7, 0, 0], ["mm4-minimax-h3-2k", 5, 15, 9, 3, 3],
] as const;

describe("October 13 Cangyuan exact-model video contracts", () => {
  it.each(models)("preserves %s bounds, all reference limits and task paths", (id, min, max, images, videos, audios) => {
    const model = cangyuanVideoModel({ id, name: id, operations: ["video.generate"] });
    expect(model.metadata).toMatchObject({ videoReferenceImageLimit: images, videoReferenceVideoLimit: videos, videoReferenceAudioLimit: audios });
    expect(model.parameters?.find(p => p.key === "duration")).toMatchObject({ min, max });
    for (const duration of [min, max]) expect(validateCangyuanVideoRequest(request(id, { duration }))).toEqual([]);
    for (const duration of [min - 1, max + 1, min + .5]) expect(validateCangyuanVideoRequest(request(id, { duration }))).not.toEqual([]);
    expect(cangyuanVideoTransport(id)?.submit?.path).toBe("/v1/videos");
    expect(cangyuanVideoTransport(id)?.poll?.path).toBe("/v1/videos/{taskId}");
    for (const [field, limit] of [["reference_image_urls", images], ["reference_videos", videos], ["reference_audios", audios]] as const) {
      const values = Array.from({ length: limit + 1 }, (_, i) => `https://assets.example/${field}/${i}`);
      expect(validateCangyuanVideoRequest(request(id, { [field]: values }))).not.toEqual([]);
      if (limit) expect(validateCangyuanVideoRequest(request(id, { [field]: values.slice(0, limit) }))).toEqual([]);
    }
  });
  it("keeps explicit plaza exclusions but leaves documented suggestion strings open", () => {
    for (const id of ["sd16-seedance-2.0-fast", "sd16-seedance-2.0-mini"]) {
      for (const resolution of ["1080p", "1080P", "4k", "4K"]) expect(validateCangyuanVideoRequest(request(id, { resolution }))).not.toEqual([]);
      expect(validateCangyuanVideoRequest(request(id, { resolution: "720p", aspect_ratio: "5:4" }))).toEqual([]);
    }
    expect(validateCangyuanVideoRequest(request("sd16-seedance-2.0", { resolution: "4k", duration: 7, generate_audio: false }))).toEqual([]);
    expect(validateCangyuanVideoRequest(request("sd17-seedance-2.0", { resolution: "1080p" }))).not.toEqual([]);
    expect(validateCangyuanVideoRequest(request("mm4-minimax-h3-2k", { resolution: "2K" }))).toEqual([]);
    expect(validateCangyuanVideoRequest(request("mm4-minimax-h3-2k", { resolution: "720p" }))).not.toEqual([]);
  });
  it("keeps the explicit 5/10/15 plaza restriction and exposes its schema conflict", () => {
    const id = "sd17-seedance-2.0-3";
    for (const duration of [5, 10, 15]) expect(validateCangyuanVideoRequest(request(id, { duration }))).toEqual([]);
    const saved = request(id, { duration: 7 });
    expect(validateCangyuanVideoRequest(saved)).not.toEqual([]);
    expect(saved.parameters?.duration).toBe(7);
    expect(cangyuanVideoModel({ id, name: id, operations: ["video.generate"] }).metadata?.videoContractWarnings).toEqual(expect.arrayContaining([expect.stringContaining("5、10、15")]));
  });
  it("sends MM4 URL arrays without borrowing MM3 measured-duration objects", () => {
    const r: NormalizedRequest = { ...request("mm4-minimax-h3-2k", { duration: 5 }), assets: [{ id: "v", kind: "video", mimeType: "video/mp4", url: "https://assets.example/v.mp4" }] };
    expect(normalizeCangyuanVideoParameters(r).reference_videos).toEqual(["https://assets.example/v.mp4"]);
    expect(validateCangyuanVideoRequest(r)).toEqual([]);
    expect(validateCangyuanVideoRequest(request(r.model!, { reference_videos: [{ url: "https://assets.example/v.mp4", duration: 5 }] }))).not.toEqual([]);
  });
  it("validates paired SD16 frames and maps audio aliases without changing saved input", () => {
    const id = "sd16-seedance-2.0", parameters = { seconds: 7, audio: false, first_image_url: "https://assets.example/first.jpg", last_image_url: "https://assets.example/last.jpg", reference_image_urls: ["https://assets.example/ref.jpg"] };
    expect(validateCangyuanVideoRequest(request(id, parameters))).toEqual([]);
    expect(normalizeCangyuanVideoParameters(request(id, parameters))).toMatchObject({ duration: 7, generate_audio: false });
    expect(parameters).toHaveProperty("seconds", 7);
    expect(validateCangyuanVideoRequest(request(id, { first_image_url: parameters.first_image_url }))).not.toEqual([]);
    expect(validateCangyuanVideoRequest(request("sd17-seedance-2.0", { first_image_url: parameters.first_image_url }))).not.toEqual([]);
    for (const target of ["/duration", "/generate_audio", "/first_image_url", "/last_image_url", "/reference_image_urls"]) expect(cangyuanVideoTransport(id)?.submit?.mappings?.some(m => m.target === target)).toBe(true);
  });
});

describe("Chentu structured video pricing", () => {
  const options = { supplierSiteUrl: "https://tu.988236.xyz", group: "wan系列视频", multiplier: 1, currency: "CNY", checkedAt: fixture.sampledAt.chentu };
  const wan = fixture.chentu.data.filter((r: {model_name: string}) => r.model_name.startsWith("wan3.0"));
  it.each(wan)("keeps raw dollar conditions without making a CNY quote for $model_name", row => {
    const result = chentuCatalogVideoPricing(row, options)!;
    expect(result.pricing).toBeUndefined();
    expect(result.metadata).toMatchObject({ chentuCurrencyConflict: true, supplierPriceConflict: true, chentuPriceCheckedAt: options.checkedAt, chentuVideoUnitPrices: row.video_unit_prices });
    expect(result.priceLabel).toMatch(/480p\s*\$/iu);
    expect(result.priceLabel).toMatch(/1080p\s*\$/iu);
    expect(result.priceLabel).not.toMatch(/[¥￥]/u);
  });
  it("uses the exact current structured field over stale model_price and applies the group ratio once", () => {
    const row = fixture.chentu.data.find((r: {model_name: string}) => r.model_name === "seedance-933");
    const result = chentuCatalogVideoPricing({ ...row, model_price: 999 }, { ...options, group: row.enable_groups[0], multiplier: .5 })!;
    expect(result.pricing).toMatchObject({ kind: "per-request", currency: "CNY", unitAmount: 1.75, billingUnit: "request" });
    const perSecond = fixture.chentu.data.find((r: {model_name: string}) => r.model_name === "MiniMaxH3-768p");
    expect(chentuCatalogVideoPricing(perSecond, { ...options, group: perSecond.enable_groups[0] })?.pricing).toMatchObject({ kind: "per-second", unitAmount: .051 });
  });
  it("never borrows other host/group declarations or falls back from invalid rates to model_price", () => {
    for (const supplierSiteUrl of ["https://other.example", "https://tu.988236.xyz.evil.example", "https://user@tu.988236.xyz", "https://tu.988236.xyz/gateway"]) expect(chentuCatalogVideoPricing(wan[0], { ...options, supplierSiteUrl })).toBeUndefined();
    expect(chentuCatalogVideoPricing(wan[0], { ...options, group: "other" })).toBeUndefined();
    const result = chentuCatalogVideoPricing({ ...wan[0], video_unit_prices: { per_second: { base: -1 } }, model_price: 1 }, options)!;
    expect(result.pricing).toBeUndefined();
    expect(result.metadata.chentuVideoPricingIncomplete).toBe(true);
  });
  it("carries the raw conflict through generic catalog discovery for all four new IDs", () => {
    const parsed = parseSupplierCatalog(fixture.chentu, { supplierSiteUrl: options.supplierSiteUrl, checkedAt: options.checkedAt, currency: "CNY" });
    const group = parsed.groups.find(g => g.id === options.group)!;
    expect(group.models.map(m => m.id).sort()).toEqual(wan.map((r: {model_name: string}) => r.model_name).sort());
    for (const model of group.models) {
      expect(model.metadata?.chentuCurrencyConflict).toBe(true);
      expect(model.metadata?.officialCatalogPricing).toBeUndefined();
      expect(model.priceLabel).toContain("$");
    }
  });
});
