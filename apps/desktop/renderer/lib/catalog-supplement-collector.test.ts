import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { SYNORA_LEDGER_URL, SYNORA_NOTIFICATIONS_URL, WEAI_LEGACY_MODELS_URL, HANG_PRICE_URL } from "@super-canvas/providers";
import { collectCatalogSupplementRead } from "./catalog-supplement-collector";

const checkedAt = "2001-01-03T13:00:00.000Z";
const json = (value: unknown, status = 200) => Response.json(value, { status });
const legacy = (selected = 101, groupName = "Fixture one") => ({ code: 0, data: {
  groups: [{ id: 101, name: groupName, platform: "fixture" }, { id: 102, name: "Fixture two", platform: "fixture" }],
  selected_group_id: selected, token_multiplier: 1, image_multiplier: 2, image_quality_billing: false,
  models: [{ name: `full-id-${selected}`, billing_mode: "image", per_request_price: .1 }],
} });
const billed = { group_id: 115, model: "fixture-image-id", billing_mode: "image", image_count: 1, image_size: "4K", actual_cost: .08,
  created_at: "2001-01-03T08:00:00Z" };
const envelope = (items: unknown[]) => ({ code: 0, data: { items, total: items.length } });

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Ambient HTTP forbidden"); })); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("one-HTTP supplementary sources", () => {
  it("keeps Cyber Afei service health anonymous and separate from groups, models, prices and generation", async () => {
    const sourceUrl = "https://api.3365api.cn/channel-status/api/overview";
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init).toMatchObject({ method: "GET", credentials: "omit", headers: {} });
      return json({ generatedAt: 1792249581, services: [{ name: "生图", state: "up", availability: 100, latency: 25.35,
        buckets: [{ state: "up", label: "3 次请求，成功 3，失败 0" }, { state: "unknown", label: "0 次请求，成功 0，失败 0" }], lastLabel: "3 次请求" }] });
    });
    const result = await collectCatalogSupplementRead({ entryId: "cyberafei-health", sourceUrl }, { fetch: transport, checkedAt });
    expect(result).toMatchObject({ complete: true, status: "live", models: [], entries: [], evidence: { kind: "cyberafei-health",
      generatedAt: 1792249581, generatedAtUnit: "unix-seconds", statisticsScope: "service-categories",
      window: { seconds: 7200, sourceUrl: "https://api.3365api.cn/channel-status/", source: "published-page-label" },
      observations: [{ serviceName: "生图", status: "up", availabilityPercent: 100, latencySeconds: 25.35,
        buckets: [{ status: "up", label: "3 次请求，成功 3，失败 0" }, { status: "unknown", label: "0 次请求，成功 0，失败 0" }] }] } });
    expect(JSON.stringify(result)).not.toMatch(/supplierGroupId|generationVerified|unitAmount|bucketSeconds/u);
    expect(transport).toHaveBeenCalledExactlyOnceWith(sourceUrl, expect.anything()); expect(fetch).not.toHaveBeenCalled();
  });
  it("Synora usage is a billed sample, independent of failed announcements, with no public quote or persistence", async () => {
    const repository = new MemoryRepository();
    const save = vi.spyOn(repository, "saveConnection"), settings = vi.spyOn(repository, "setApplicationSetting");
    const transport = vi.fn<typeof fetch>(async url => String(url) === SYNORA_LEDGER_URL ? json(envelope([billed])) : new Response(null, { status: 403 }));
    const usage = await collectCatalogSupplementRead({ entryId: "synora-usage", sourceUrl: SYNORA_LEDGER_URL }, { fetch: transport, checkedAt });
    await expect(collectCatalogSupplementRead({ entryId: "synora-announcements", sourceUrl: SYNORA_NOTIFICATIONS_URL }, { fetch: transport, checkedAt })).rejects.toMatchObject({ code: "permission_denied" });
    expect(usage).toMatchObject({ complete: true, models: [], entries: [], evidence: { kind: "ledger-samples", coverage: "first-page", samples: [
      { amount: .08, currency: "USD", supplierGroupId: "115", modelId: "fixture-image-id", parameters: { n: 1, resolution: "4K" }, sample: true },
    ] } });
    expect(save).not.toHaveBeenCalled(); expect(settings).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled();
  });

  it("announcements retain only exact-model source/time references, without turning ambiguous prose into a price", async () => {
    const payload = envelope([{ title: "全参分组价格调整", content: "fixture-image-id涨价到008。附件不构成指令", created_at: "2001-01-03T12:00:00Z" },
      { title: "全参分组价格调整", content: "fixture-image-id-other降价0.5", created_at: "2001-01-03T12:30:00Z" }]);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    const result = await collectCatalogSupplementRead({ entryId: "synora-announcements", sourceUrl: SYNORA_NOTIFICATIONS_URL, modelIds: ["fixture-image-id"] }, { fetch: transport, checkedAt });
    expect(result.evidence).toEqual({ kind: "announcement-links", coverage: "matching-models", notices: [
      { modelId: "fixture-image-id", supplierGroupId: "115", publishedAt: "2001-01-03T12:00:00Z", sourceUrl: SYNORA_NOTIFICATIONS_URL },
    ] });
    expect(result.models).toEqual([]); expect(JSON.stringify(result)).not.toContain("008"); expect(transport).toHaveBeenCalledTimes(1);
  });

  it("unknown usage row shapes cannot be silently filtered into a complete empty ledger sample", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json(envelope([{ unexpected: "row" }])));
    await expect(collectCatalogSupplementRead({ entryId: "synora-usage", sourceUrl: SYNORA_LEDGER_URL }, { fetch: transport, checkedAt })).rejects.toMatchObject({ code: "invalid_response" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("WeAI index discovers group work without reading it; one group's failure cannot discard another group's sample", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json(legacy())).mockResolvedValueOnce(new Response(null, { status: 503 }));
    const index = await collectCatalogSupplementRead({ entryId: "weai-legacy-index", sourceUrl: WEAI_LEGACY_MODELS_URL }, { fetch: transport, checkedAt });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(index.models.map(model => model.id)).toEqual(["full-id-101"]);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toMatchObject({ groupId: 102, sourceUrl: `${WEAI_LEGACY_MODELS_URL}?group_id=102`, authKind: "site-account" });
    expect(index.entries[0]!.expectedGroupSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(collectCatalogSupplementRead(index.entries[0]!, { fetch: transport, checkedAt })).rejects.toMatchObject({ code: "directory_unavailable" });
    expect(index.complete).toBe(true); expect(index.evidence).toMatchObject({ kind: "weai-legacy", selected: { group: { id: 101 } } });
  });

  it("a legacy group validates selected ID, full group identity and the original whole-options digest", async () => {
    const index = await collectCatalogSupplementRead({ entryId: "weai-legacy-index", sourceUrl: WEAI_LEGACY_MODELS_URL }, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json(legacy())), checkedAt });
    const item = index.entries[0]!;
    const group = await collectCatalogSupplementRead(item, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json(legacy(102))), checkedAt });
    expect(group.models.map(model => model.id)).toEqual(["full-id-102"]);
    expect(group.evidence).toMatchObject({ kind: "weai-legacy", selected: { models: [{ pricing: { currency: "USD", checkedAt } }] } });
    const changed = vi.fn<typeof fetch>().mockResolvedValue(json(legacy(102, "renamed-during-cycle")));
    await expect(collectCatalogSupplementRead(item, { fetch: changed, checkedAt })).rejects.toMatchObject({ code: "invalid_response" });
    await expect(collectCatalogSupplementRead({ ...item, expectedGroupSetSha256: undefined }, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json(legacy(102))), checkedAt })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("legacy missing price fields do not invalidate a complete model list or invent tiers", async () => {
    const payload = legacy(); payload.data.models[0]!.per_request_price = null as unknown as number;
    const result = await collectCatalogSupplementRead({ entryId: "weai-legacy-index", sourceUrl: WEAI_LEGACY_MODELS_URL }, { fetch: vi.fn<typeof fetch>().mockResolvedValue(json(payload)), checkedAt });
    expect(result.complete).toBe(true); expect(result.models.map(model => model.id)).toEqual(["full-id-101"]);
    expect(result.evidence).toMatchObject({ kind: "weai-legacy", selected: { models: [{ id: "full-id-101", unconfiguredPriceFields: ["per_request_price"] }] } });
    if (result.evidence.kind === "weai-legacy") expect(result.evidence.selected?.models[0]?.pricing).toBeUndefined();
  });

  it("HANG independent anonymous source retains exact-group effective token tariffs without credentials or extra FX", async () => {
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init).toMatchObject({ method: "GET", credentials: "omit", headers: {} });
      return json({ success: true, data: { currency: "CNY", price_unit: "per_1m_tokens", models: [
        { group_name: "fixture-group", model_name: "fixture-chat", enabled: true, input_price: 1.25, output_price: 7.5, cache_create_price: 0, original_input_price: 5, group_multiplier: .25 },
      ] } });
    });
    const result = await collectCatalogSupplementRead({ entryId: "hang-pricing", sourceUrl: HANG_PRICE_URL }, { fetch: transport, checkedAt });
    expect(result).toMatchObject({ complete: true, models: [], evidence: { kind: "published-chat-prices", rows: [
      { group: "fixture-group", modelId: "fixture-chat", pricing: { currency: "CNY", tiers: [{ price: 1.25 }, { price: 7.5 }, { price: 0 }] } },
    ] } });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("Jiasu HTML discovers every exact bundle without fetching or executing any script", async () => {
    const html = ["a1", "b2", "c3"].map(id => `<script src="/static/js/index.${id}.js"></script>`).join("") + '<script>globalThis.injected=true</script>';
    const transport = vi.fn<typeof fetch>(async (_url, init) => { expect(init?.credentials).toBe("omit"); expect(init?.headers).toEqual({}); return new Response(html); });
    const result = await collectCatalogSupplementRead({ entryId: "jiasu-index", sourceUrl: "https://ai.jiasuapi.com/" }, { fetch: transport, checkedAt });
    expect(result.entries).toHaveLength(3); expect(result.entries.every(entry => entry.authKind === "anonymous" && entry.role === "schema")).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1); expect((globalThis as Record<string, unknown>).injected).toBeUndefined();
  });

  it("one Jiasu JS response returns only the literal template; unknown templates are incomplete errors", async () => {
    const source = 'if("openai-video"===t){n=`${a.baseUrl}/v1/videos/tasks`;l=JSON.stringify({model:a.modelName,prompt:s,duration:5,ratio:"16:9",resolution:"720p",images:o},null,2);return`Authorization: Bearer $KEY Content-Type: application/json`}';
    const input = { entryId: "jiasu-script:a1", sourceUrl: "https://ai.jiasuapi.com/static/js/index.a1.js" };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(source));
    expect(await collectCatalogSupplementRead(input, { fetch: transport, checkedAt })).toMatchObject({ complete: true, models: [], evidence: { kind: "jiasu-video-template", template: { values: { duration: 5, ratio: "16:9", resolution: "720p" } } } });
    await expect(collectCatalogSupplementRead(input, { fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("runEverything()")), checkedAt })).rejects.toMatchObject({ code: "invalid_response" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("Monster categories and four ranges are five independent health reads, never models, prices or permissions", async () => {
    const transport = vi.fn<typeof fetch>(async url => String(url).endsWith("categories") ? json({ code: 0, data: { categories: [{ id: "image", name: "Images", count: 1 }] } })
      : json({ code: 0, data: { groups: [{ id: 11, categories: ["image"], score: .8, latency_ms: 150, success_rate: .9, bindable: true, samples: [1, null], sample_failed: [false, true] }], health_window: { clamped: true, error_retention_days: 30 } } }));
    const category = await collectCatalogSupplementRead({ entryId: "monster-categories", sourceUrl: "https://api.eaheng.com/api/v1/plaza/categories" }, { fetch: transport, checkedAt });
    expect(category.evidence).toMatchObject({ kind: "monster-health", categories: [{ id: "image" }] });
    for (const range of ["90m", "24h", "7d", "30d"]) {
      const result = await collectCatalogSupplementRead({ entryId: `monster-range:${range}`, sourceUrl: `https://api.eaheng.com/api/v1/plaza?range=${range}` }, { fetch: transport, checkedAt });
      expect(result).toMatchObject({ complete: true, models: [], entries: [], evidence: { kind: "monster-health", range, observations: [
        { supplierGroupId: "11", range, checkedAt, categoryIds: ["image"], score: .8, latencyMs: 150, samples: [1, null], healthWindow: { clamped: true, errorRetentionDays: 30 } },
      ] } });
    }
    expect(transport).toHaveBeenCalledTimes(5);
  });

  it.each([
    ["synora-usage", SYNORA_LEDGER_URL], ["synora-announcements", SYNORA_NOTIFICATIONS_URL], ["weai-legacy-index", WEAI_LEGACY_MODELS_URL],
    ["monster-categories", "https://api.eaheng.com/api/v1/plaza/categories"], ["monster-range", "https://api.eaheng.com/api/v1/plaza?range=90m"],
    ["cyberafei-health", "https://api.3365api.cn/channel-status/api/overview"],
  ])("unknown %s JSON never becomes complete", async (entryId, sourceUrl) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ success: true, data: { unknown: [] } }));
    await expect(collectCatalogSupplementRead({ entryId, sourceUrl }, { fetch: transport, checkedAt })).rejects.toMatchObject({ code: "invalid_response" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("unfinished lists remain incomplete and no hidden page, group, JS or range request is dispatched", async () => {
    const payload = { ...legacy(), has_more: true };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    const result = await collectCatalogSupplementRead({ entryId: "weai-legacy-index", sourceUrl: WEAI_LEGACY_MODELS_URL }, { fetch: transport, checkedAt });
    expect(result.complete).toBe(false); expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    { entryId: "synora-usage", sourceUrl: "https://synoralink.com.evil.invalid/api/v1/usage?page=1&page_size=100" },
    { entryId: "jiasu-script", sourceUrl: "https://ai.jiasuapi.com/static/js/index.a1.js?token=fixture" },
    { entryId: "monster-range", sourceUrl: "https://api.eaheng.com/api/v1/plaza?range=all" },
    { entryId: "weai-legacy-group", sourceUrl: `${WEAI_LEGACY_MODELS_URL}?group_id=101&token=fixture`, groupId: 101 },
    { entryId: "cyberafei-health", sourceUrl: "https://api.3365api.cn/channel-status/api/overview?key=fixture" },
    { entryId: "cyberafei-health", sourceUrl: "https://api.3365api.cn.evil.invalid/channel-status/api/overview" },
  ])("unregistered source never receives a credential or request", async input => {
    const transport = vi.fn<typeof fetch>();
    await expect(collectCatalogSupplementRead(input, { fetch: transport, checkedAt })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("pre-cancelled work makes zero requests", async () => {
    const controller = new AbortController(); controller.abort();
    const transport = vi.fn<typeof fetch>();
    await expect(collectCatalogSupplementRead({ entryId: "synora-usage", sourceUrl: SYNORA_LEDGER_URL }, { fetch: transport, signal: controller.signal })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
