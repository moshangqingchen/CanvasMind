import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedRequest, ProviderAdapter } from "./contracts.js";
import { parseSupplierCatalog, parseSupplierKeyGroups } from "./supplier-catalog.js";
import { chentuCatalogVideoPricing } from "./catalog-pricing.js";
import { cangyuanCatalogVideoPricing } from "./cangyuan-catalog-video-pricing.js";
import { parseWeAiLegacyGroup } from "./weai-legacy-catalog.js";
import { cangyuanResultRetention } from "./cangyuan-result-retention.js";
import { cangyuanDocumentedImageModel, cangyuanDocumentedImageTransport, cangyuanDocumentedImageIssues } from "./cangyuan-image-contract.js";
import { applyUserImageQualityPresets } from "./user-image-quality-presets.js";
import { CANGYUAN_NO_QUALITY_MODELS } from "./cangyuan-current-restrictions.js";
import { remainingVideoModel, remainingVideoRequestIssues } from "./remaining-video-contracts.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { StaticConnectionResolver } from "./credentials.js";

interface CatalogRow { model_name: string; enable_groups: string[]; model_price?: number; [key: string]: unknown }
interface FixtureSource { url: string; sampledAt: string; sha256: string; body: { data: CatalogRow[]; group_ratio?: Record<string, number> } }
interface FixtureSupplier { name: string; sources: FixtureSource[]; officialChanges: { model: string; type: string; field?: string; before: unknown; after: unknown }[];
  groupChanges: { group: string; field: string; before: unknown; after: unknown }[] }
const fixture = JSON.parse(readFileSync(new URL("./fixtures/supplier-b-catalog-20261014.json", import.meta.url), "utf8")) as { suppliers: FixtureSupplier[] };
const request = (model: string, parameters: Record<string, unknown> = {}): NormalizedRequest => ({ connectionId: "offline", model, operation: "video.generate", prompt: "offline", idempotencyKey: "offline-no-paid", parameters });
const reference = { id: "ref", kind: "image" as const, mimeType: "image/png", url: "https://images.example/original.png" };

describe("2026-10-14 supplier B official inventory changes", () => {
  for (const supplier of fixture.suppliers) for (const change of supplier.groupChanges) {
    it(`${supplier.name} applies the exact current group change ${change.field}`, () => {
      const source = supplier.sources.find(source => source.url.endsWith("/api/user/self/groups"))!;
      const groups = parseSupplierKeyGroups(source.body, "newapi", { supplierSiteUrl: new URL(source.url).origin })!;
      const group = groups.find(group => group.id === change.group);
      if (change.after === null) expect(group).toBeUndefined();
      else {
        expect(group?.id).toBe(change.group);
        if (change.field.endsWith("/ratio")) expect(group?.details?.rateMultiplier).toBe(change.after);
        if (change.field.endsWith("/desc")) expect(group?.details?.description).toBe(change.after);
        if (change.after && typeof change.after === "object" && "ratio" in change.after)
          expect(group?.details?.rateMultiplier).toBe(change.after.ratio);
      }
    });
  }
  for (const supplier of fixture.suppliers) {
    const source = supplier.sources.find(source => source.url.endsWith("/api/pricing"));
    if (!source) continue;
    const catalog = parseSupplierCatalog(source.body, { supplierSiteUrl: new URL(source.url).origin, checkedAt: source.sampledAt, currency: "CNY" });
    const ids = [...new Set(supplier.officialChanges.map(change => change.model))];
    it.each(ids)(`${supplier.name} keeps the exact current group membership for %s`, id => {
      const row = source.body.data.find(row => row.model_name === id);
      const actual = catalog.groups.filter(group => group.models.some(model => model.id === id)).map(group => group.id).sort();
      expect(actual).toEqual([...(row?.enable_groups ?? [])].sort());
      for (const group of catalog.groups) for (const model of group.models.filter(model => model.id === id)) {
        expect(model.metadata?.officialCatalogSourceUrl ?? model.metadata?.sourceUrl ?? source.url).toBeTruthy();
        if (/^(?:wan3|rh-minimaxh3|sd1[67]-|gv4-|mm4-)/u.test(id)) expect(model.capability).toBe("video");
      }
    });
  }
  it("keeps We-AI 22's new Claude token prices on that stable group only", () => {
    const source = fixture.suppliers.find(s => s.name === "We-AI")!.sources[0]!;
    const result = parseWeAiLegacyGroup(source.body, source.sampledAt, 22)!.selected!;
    expect(result.models.map(model => model.id)).not.toContain("claude-haiku-4-5");
    const factor = result.tokenMultiplier;
    expect(result.models.find(model => model.id === "claude-haiku-5-5")?.pricing).toMatchObject({ kind: "token", currency: "USD", outputPerMillion: .5 * factor });
    expect(result.models.find(model => model.id === "claude-haiku-5-5")?.pricing?.inputPerMillion).toBeCloseTo(.1 * factor);
    expect(result.models.find(model => model.id === "claude-sonnet-5-5")?.pricing).toMatchObject({ kind: "token", currency: "USD", inputPerMillion: 2 * factor, outputPerMillion: 10 * factor });
    expect(parseWeAiLegacyGroup(source.body, source.sampledAt, 19)).toBeUndefined();
  });
  it.each([
    ["FriModel", "azure_gpt", 2.2], ["FriModel", "openai_official_外接2", 3.2],
    ["赛博阿飞 API", "超级福利gpt", .3], ["沧元算力", "LLM-Gemini-anti", .42], ["辰途 API", "ad高质量image2", 1.5],
  ] as const)("reads %s %s's account multiplier without changing its stable identity", (supplier, id, ratio) => {
    const source = fixture.suppliers.find(s => s.name === supplier)!.sources.find(s => s.url.endsWith("/api/user/self/groups"))!;
    const parsed = parseSupplierKeyGroups(source.body, "newapi", { supplierSiteUrl: new URL(source.url).origin });
    expect(parsed?.find(group => group.id === id)?.details?.rateMultiplier).toBe(ratio);
  });
  it.each(["MiniMaxH3-480p", "MiniMaxH3-768p", "wan3.0-image", "wan3.0-image-prime", "wan3.0-video", "wan3.0-video-prime"])("does not reinterpret %s's published dollars as CNY", id => {
    const source = fixture.suppliers.find(s => s.name === "辰途 API")!.sources.find(s => s.url.endsWith("/api/pricing"))!;
    const row = source.body.data.find(row => row.model_name === id)!;
    const result = chentuCatalogVideoPricing(row, { supplierSiteUrl: "https://tu.988236.xyz", group: row.enable_groups[0]!, multiplier: 1, currency: "CNY", checkedAt: source.sampledAt })!;
    expect(result.pricing).toBeUndefined();
    expect(result.metadata.chentuCurrencyConflict).toBe(true);
    expect(result.priceLabel).toContain("$");
    expect(result.priceLabel).not.toMatch(/[¥￥]/u);
  });
  it("uses seedance2.5-2's current per-request amount once, independently of duration", () => {
    const source = fixture.suppliers.find(s => s.name === "辰途 API")!.sources.find(s => s.url.endsWith("/api/pricing"))!;
    const row = source.body.data.find(row => row.model_name === "seedance2.5-2")!;
    expect(chentuCatalogVideoPricing(row, { supplierSiteUrl: "https://tu.988236.xyz", group: row.enable_groups[0]!, multiplier: .5, currency: "CNY", checkedAt: source.sampledAt })?.pricing)
      .toMatchObject({ kind: "per-request", unitAmount: 3.5, billingUnit: "request" });
  });
  it.each([
    ["sd10-seedance-2.5", 2.9], ["sd8-seedance-2.5-s", 7.5], ["gv4-grok-imagine-video-1.5", 1.2], ["mm4-minimax-h3-2k", 1.9],
    ["sd17-seedance-2.0", 3.75], ["sd17-seedance-2.0-2", 4.5], ["sd17-seedance-2.0-3", 2.9],
    ["sd17-seedance-2.5", 7.5], ["sd17-seedance-2.5-2", 7.5], ["sd17-seedance-2.5-3", 2.9],
  ] as const)("keeps Cangyuan %s's current amount as a request price", (id, price) => {
    const source = fixture.suppliers.find(s => s.name === "沧元算力")!.sources.find(s => s.url.endsWith("/api/pricing"))!;
    const row = source.body.data.find(row => row.model_name === id)!;
    const options = { supplierSiteUrl: "https://ai.cangyuansuanli.cn", group: "VIDEO", multiplier: .5, currency: "CNY", checkedAt: source.sampledAt };
    expect(cangyuanCatalogVideoPricing(row, options)?.pricing).toMatchObject({ kind: "per-request", billingUnit: "request", unitAmount: price * .5 });
    const parsed = parseSupplierCatalog({ ...source.body, group_ratio: { ...source.body.group_ratio, VIDEO: .5 } },
      { supplierSiteUrl: options.supplierSiteUrl, currency: options.currency, checkedAt: options.checkedAt });
    const integrated = parsed.groups.find(group => group.id === "VIDEO")!.models.find(model => model.id === id)!;
    expect(integrated.metadata?.officialCatalogPricing).toMatchObject({ kind: "per-request", billingUnit: "request", unitAmount: price * .5 });
    expect(integrated.metadata?.officialCatalogPriceGroupVerified).toBe(true);
    expect(integrated.priceLabel).toBe(`¥${price * .5}/次`);
    expect(cangyuanCatalogVideoPricing(row, { ...options, group: "IMAGE" })).toBeUndefined();
    expect(cangyuanCatalogVideoPricing(row, { ...options, supplierSiteUrl: "https://other.example" })).toBeUndefined();
  });
  it.each(["sd16-seedance-2.0", "sd16-seedance-2.0-fast", "sd16-seedance-2.0-mini"])("preserves %s's conflicting billing expression instead of guessing a price", id => {
    const source = fixture.suppliers.find(s => s.name === "沧元算力")!.sources.find(s => s.url.endsWith("/api/pricing"))!;
    const row = source.body.data.find(row => row.model_name === id)!;
    const quote = cangyuanCatalogVideoPricing(row, { supplierSiteUrl: "https://ai.cangyuansuanli.cn", group: "VIDEO", multiplier: 1, currency: "CNY", checkedAt: source.sampledAt })!;
    expect(quote.pricing).toBeUndefined();
    expect(quote.metadata.supplierPriceConflict).toBe(true);
    expect(quote.metadata.cangyuanRawVideoPricing).toMatchObject({ billing_expr: row.billing_expr, model_price: row.model_price, billing_capability: "image" });
    const parsed = parseSupplierCatalog(source.body, { supplierSiteUrl: "https://ai.cangyuansuanli.cn", currency: "CNY", checkedAt: source.sampledAt });
    const integrated = parsed.groups.find(group => group.id === "VIDEO")!.models.find(model => model.id === id)!;
    expect(integrated.metadata).not.toHaveProperty("officialCatalogPricing");
    expect(integrated.metadata?.supplierPriceConflict).toBe(true);
    expect(integrated.priceLabel).toBe("—");
  });
});

describe("2026-10-14 Cangyuan explicit quality and result retention", () => {
  it.each(CANGYUAN_NO_QUALITY_MODELS)("rejects obsolete quality on %s without changing saved choices", id => {
    const current = applyUserImageQualityPresets(cangyuanDocumentedImageModel({ id, name: id, operations: ["image.generate"] }));
    expect(current.parameters?.some(parameter => parameter.key === "quality")).toBe(false);
    expect(current.metadata?.imageQualityParameterUnsupported).toBe(true);
    expect(cangyuanDocumentedImageTransport(id)?.submit?.mappings?.some(mapping => mapping.target === "/quality")).toBe(false);
    const saved = { ...request(id, { size: "3840x2160", quality: "max" }), operation: "image.generate" as const };
    expect(cangyuanDocumentedImageIssues(saved)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.quality" })]));
    expect(saved.parameters?.quality).toBe("max");
  });
  it.each(["gpt-image-2.5-x", "gpt-image-2.5-flare-4k", "gpt-image-2.5-sunburst-az"])("keeps the highest applicable quality for independent SKU %s", id => {
    const model = cangyuanDocumentedImageModel({ id, name: id, operations: ["image.generate"] });
    expect(model.parameters?.find(parameter => parameter.key === "quality")?.options?.some(option => option.value === "max")).toBe(true);
    expect(model.metadata?.imageQualityParameterUnsupported).not.toBe(true);
  });
  it("records distinct completion-relative retention without declaring links expired", () => {
    for (const base of ["https://ai.cangyuansuanli.cn", "https://direct-api.cangyuansuanli.cn/v1", "http://direct-api.cangyuansuanli.cn"]) {
      expect(cangyuanResultRetention(base, "image")).toMatchObject({ seconds: 7200, startsAt: "generation-completed" });
      expect(cangyuanResultRetention(base, "video")).toMatchObject({ seconds: 86400, startsAt: "generation-completed" });
      expect(cangyuanResultRetention(base, "video")).not.toHaveProperty("expiresAt");
    }
    for (const base of ["https://other.example", "https://ai.cangyuansuanli.cn.evil.example", "https://user:pass@ai.cangyuansuanli.cn"]) expect(cangyuanResultRetention(base, "video")).toBeUndefined();
    expect(cangyuanResultRetention("https://ai.cangyuansuanli.cn", "audio")).toBeUndefined();
  });
});

const newChentu = [
  ["minimax_h3-768p", 4, 15, "768p"], ["minimax_h3-1080p", 4, 15, "1080p"],
  ["rh-minimaxh3-overseas", 1, undefined, "720p"], ["rh-minimaxh3-pro-overseas", 1, undefined, "720p"],
  ["wan3.0-image", 1, undefined, "720P"], ["wan3.0-image-prime", 1, undefined, "720P"],
  ["wan3.0-video", 1, undefined, "720P"], ["wan3.0-video-prime", 1, undefined, "720P"],
] as const;
describe("2026-10-14 Chentu exact IDs and original-task result chain", () => {
  it.each(newChentu)("submits and polls %s with documented image fields", async (id, min, max, resolution) => {
    const model = remainingVideoModel("chentu", id)!;
    expect(model.parameters?.find(parameter => parameter.key === "duration")?.min).toBe(min);
    expect(model.parameters?.find(parameter => parameter.key === "duration")?.max).toBe(max);
    const input = { ...request(id, { duration: 7, aspect_ratio: "4:3", resolution }), operation: "video.image-to-video" as const, assets: [reference] };
    expect(remainingVideoRequestIssues("chentu", input)).toEqual([]);
    const fallback = { testConnection: vi.fn(), listModels: vi.fn(), validate: vi.fn(), submit: vi.fn(), poll: vi.fn(), extractOutputs: vi.fn() } as unknown as ProviderAdapter;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ task_id: "original-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "original-task", status: "succeeded", data: { download_url: "https://tu.988236.xyz/generated/videos/original.mp4" } }));
    const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "offline", provider: "openai", baseUrl: "https://tu.988236.xyz", apiKey: "offline-test-key",
      settings: { modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [model] } }]), fallback, { fetch: fetcher });
    const task = await adapter.submit(input);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ model: id, duration: 7, ratio: "4:3", resolution, images: [reference.url] });
    const done = await adapter.poll(task);
    expect(String(fetcher.mock.calls[1]![0])).toBe("https://tu.988236.xyz/v1/videos/original-task");
    expect((await adapter.extractOutputs(done.result))[0]?.url).toBe("https://tu.988236.xyz/generated/videos/original.mp4");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fallback.submit).not.toHaveBeenCalled();
    expect(model.metadata?.generationVerified).toBe(false);
  });
  it.each([
    ["seedance-933", 4, 15, 9], ["seedance2.0-933-V", 5, 15, 9], ["seedance2.5", 5, 30, 30], ["seedance2.5-2", 4, 30, 30],
    ["grok-imagine-video-1.5（按次）", 3, 15, 7],
  ] as const)("enforces %s's declared range without replacing saved values", (id, min, max, images) => {
    const model = remainingVideoModel("chentu", id)!;
    expect(model.limits?.maxInputImages).toBe(images);
    for (const duration of [min, max]) expect(remainingVideoRequestIssues("chentu", request(id, { duration }))).toEqual([]);
    const saved = request(id, { duration: max + 1 });
    expect(remainingVideoRequestIssues("chentu", saved)).not.toEqual([]);
    expect(saved.parameters?.duration).toBe(max + 1);
  });
  it("preserves fixed 30 seconds, short overseas retention and specific missing-field facts", () => {
    expect(remainingVideoRequestIssues("chentu", request("seedance2.5-1", { duration: 29 }))).not.toEqual([]);
    expect(remainingVideoRequestIssues("chentu", request("seedance2.5-1", { duration: 30 }))).toEqual([]);
    expect(remainingVideoModel("chentu", "rh-minimaxh3-overseas")?.metadata?.resultRetention).toMatchObject({ seconds: 900, startsAt: "generation-completed" });
    const input = { ...request("seedance-933", { duration: 7 }), assets: [{ ...reference, kind: "audio" as const, mimeType: "audio/mp3" }] };
    expect(remainingVideoRequestIssues("chentu", input).map(issue => issue.message).join(" ")).toContain("实际请求字段尚未公布");
    expect(remainingVideoModel("chentu", "seedance-933")?.metadata?.supplierDeclaredReferenceLimits).toEqual({ images: 9, videos: 0, audios: 3 });
  });
  it.each(["minimax_h3-768p", "minimax_h3-1080p"])("does not infer %s's reference-count limits from the unexplained 933 abbreviation", id => {
    const model = remainingVideoModel("chentu", id)!;
    expect(model.limits?.maxInputImages).toBeUndefined();
    expect(model.metadata?.supplierDeclaredReferenceLimits).toBeUndefined();
    expect(model.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 4, max: 15 });
    expect(remainingVideoRequestIssues("chentu", { ...request(id, { duration: 7 }), assets: Array.from({ length: 10 }, (_, index) => ({ ...reference, id: `ref-${index}` })) })).toEqual([]);
  });
  it.each([
    ["MiniMaxH3-480p", "audio"], ["MiniMaxH3-768p", "audio"],
    ["minimax_h3-768p", "video"], ["minimax_h3-768p", "audio"],
    ["minimax_h3-1080p", "video"], ["minimax_h3-1080p", "audio"],
    ["rh-minimaxh3-overseas", "audio"], ["rh-minimaxh3-pro-overseas", "audio"],
    ["wan3.0-image", "audio"], ["wan3.0-image-prime", "audio"],
    ["wan3.0-video", "video"], ["wan3.0-video", "audio"],
    ["wan3.0-video-prime", "video"], ["wan3.0-video-prime", "audio"],
    ["seedance-933", "audio"], ["seedance2.0-933-V", "video"], ["seedance2.0-933-V", "audio"],
    ["seedance2.5", "video"], ["seedance2.5", "audio"], ["seedance2.5-1", "video"],
    ["seedance2.5-1", "audio"], ["seedance2.5-2", "video"], ["seedance2.5-2", "audio"],
  ] as const)("preserves %s's %s reference and identifies the missing wire field before submission", (id, kind) => {
    const input = { ...request(id), assets: [reference, { ...reference, id: "original-media", kind, mimeType: kind === "audio" ? "audio/mpeg" : "video/mp4" }] };
    const original = structuredClone(input);
    expect(remainingVideoRequestIssues("chentu", input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "assets", message: expect.stringContaining("实际请求字段尚未公布") }),
    ]));
    expect(remainingVideoModel("chentu", id)?.metadata?.missingReferenceWireFields).toContain(kind);
    expect(input).toEqual(original);
  });
});
