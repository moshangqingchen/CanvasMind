import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import { discoverSupplierCatalog } from "./supplier-catalog.js";
import { LANGFRAME_CATALOG_URL, isLangframeCatalogSource, langframeImagePresentation, langframeModelDescriptor, langframeModelsForKey, langframePricingParameters, parseLangframeCatalog } from "./langframe-catalog.js";
import { modelPriceAmount } from "./media-billing.js";
import { applyUserImageSizePresets } from "./image-size-presets.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/langframe-catalog-20261018.json", import.meta.url), "utf8")) as {
  checkedAt: string; sha256: string; payload: { ok: boolean; groups: Array<{ name: string; type: string; models: Array<Record<string, unknown>> }> };
};
const options = { checkedAt: fixture.checkedAt, sourceSha256: fixture.sha256 };
const parsed = () => parseLangframeCatalog(fixture.payload, options);
const selected = (name: string) => parsed().models.find(model => model.id === name)!;

describe("狼帧 exact catalog contracts", () => {
  it("keeps all 39 categories and 40 downstream call names without merging reused inner IDs", () => {
    const result = parsed();
    expect(result).toMatchObject({ recognized: true, complete: true });
    expect(result.groups).toHaveLength(39);
    expect(result.groups.reduce((sum, group) => sum + group.models.length, 0)).toBe(47);
    expect(result.models).toHaveLength(40);
    expect(result.models.filter(model => model.outputKinds?.includes("image"))).toHaveLength(12);
    expect(result.models.filter(model => model.outputKinds?.includes("video"))).toHaveLength(27);
    expect(result.groups.every(group => group.supplierGroupId === undefined)).toBe(true);
    expect(result.models.find(model => model.id === "qwen-image-3.0")).toMatchObject({ provider: "langframe", metadata: { langframeInnerModelId: "gpt-image-2" } });
    expect(result.models.some(model => model.id === "gpt-image-2")).toBe(false);
    expect(result.models.find(model => model.id === "11111")?.outputKinds).toEqual(["video"]);
  });

  it("preserves exact per-tier image tariffs rather than amounts embedded in names", () => {
    const model = selected("image-2-4K-0.07积分");
    expect(model.pricing).toMatchObject({ kind: "tiered", currency: "CNY", billingUnit: "image", sourceUrl: LANGFRAME_CATALOG_URL });
    expect(modelPriceAmount(model.pricing!, { resolution: "1K" })).toBe(.08);
    expect(modelPriceAmount(model.pricing!, { resolution: "4K" })).toBe(.1);
    expect(model.metadata?.langframeCatalogConflicts).toHaveLength(1);
    expect(selected("image-2-4K官网/0.15积分").pricing?.tiers?.map(tier => tier.price)).toEqual([.2, .18, .15]);
    expect(selected("nano-banana-2.1").pricing?.tiers?.map(tier => tier.price)).toEqual([.12, .16, .2]);
  });

  it("selects reference-video prices only with an explicit material condition", () => {
    const model = selected("SD-2.5-（官渠）支持真人满血");
    expect(modelPriceAmount(model.pricing!, { resolution: "720P" })).toBeUndefined();
    expect(modelPriceAmount(model.pricing!, langframePricingParameters({ resolution: "720p" }))).toBeUndefined();
    expect(modelPriceAmount(model.pricing!, langframePricingParameters({ resolution: "720p" }, []))).toBe(.79);
    expect(modelPriceAmount(model.pricing!, langframePricingParameters({ resolution: "720p" }, [{ kind: "video" }]))).toBe(.99);
    expect(modelPriceAmount(model.pricing!, langframePricingParameters({ resolution: "1080p" }, [{ kind: "image" }]))).toBe(1.59);
    expect(model.pricing?.billingUnit).toBe("second");
    expect(modelPriceAmount(model.pricing!, langframePricingParameters({ resolution: "720P", has_reference_video: true }))).toBe(.99);
    expect(modelPriceAmount(model.pricing!, langframePricingParameters({ resolution: "720P", hasReferenceVideo: false }))).toBe(.79);
    expect(modelPriceAmount(model.pricing!, langframePricingParameters({ resolution: "720P", hasReferenceVideo: "false" }))).toBeUndefined();
    expect(selected("SD2.0-（官渠）支持真人903").pricing).toMatchObject({ kind: "per-request", unitAmount: 2.9 });
    expect(selected("sd-2.0-C-支持真人933 满血").pricing).toMatchObject({ kind: "per-request", unitAmount: 2.9 });
  });

  it("keeps MTOKEN rates as usage tariffs and does not manufacture per-second totals", () => {
    const model = selected("sd_2.0_fast支持真人官转按MTOKEN用多少算多少");
    expect(model.pricing?.kind).toBe("token");
    expect(model.pricing?.billingUnit).toBeUndefined();
    expect(modelPriceAmount(model.pricing!, { resolution: "720P", duration: 15 })).toBeUndefined();
    expect(modelPriceAmount(model.pricing!, { token_kind: "output", hasReferenceVideo: false })).toBe(30);
    expect(model.metadata?.rawParams).toMatchObject({ mtokenPricing: { method: "seedance20-official-formula-v1", unit: "MTOKEN" } });
    expect(model.metadata?.langframeCatalogConflicts).toHaveLength(1);
  });

  it("preserves per-group chat prices and honors Key filters without choosing a fallback tariff", () => {
    const result = parsed(), chat = result.models.find(model => model.id === "gpt-5.6-sol")!;
    expect(chat.pricing).toBeUndefined();
    expect(chat.metadata?.langframePricing).toBeUndefined();
    expect(chat.metadata?.langframePricingRequiresGroup).toBe(true);
    expect(chat.metadata?.langframeGroupCatalog).toHaveLength(8);
    expect(langframeModelsForKey(result.groups, [], [])).toEqual(result.models);
    const restricted = langframeModelsForKey(result.groups, ["下游分组2", "下游分组1"], ["gpt-5.6-sol"]);
    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.metadata?.langframeGroupCatalog).toMatchObject([{ groupName: "下游分组2" }, { groupName: "下游分组1" }]);
    expect(restricted[0]?.pricing).toBeUndefined();
    const exact = langframeModelsForKey(result.groups, ["下游分组2"], ["gpt-5.6-sol"])[0]!;
    expect(modelPriceAmount(exact.pricing!, { context_tier: "standard", token_kind: "input" })).toBe(.8);
    expect(modelPriceAmount(exact.pricing!, { context_tier: "long_context", token_kind: "input" })).toBe(1.6);
    expect(langframeModelsForKey(result.groups, ["missing"], [])).toEqual([]);
    expect(langframeModelsForKey(result.groups, [], ["gpt-image-2"])).toEqual([]);
  });

  it("restores parameter and pricing contracts after JSON persistence", () => {
    const group = parsed().groups.find(group => group.id === "gpt-image-2.5-flare-1K-2k-4k")!;
    const saved = JSON.parse(JSON.stringify(group.models[0]));
    expect(langframeModelDescriptor(saved)).toEqual(selected("image-2.5-flare-1K-2k-4kMAX品质"));
    expect(langframeModelDescriptor({ id: "qwen-image-3.0", capability: "image", metadata: {} })).toBeUndefined();
    const source = selected("image-2.5-flare-1K");
    expect(source.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["1K"]);
    expect(source.parameters?.find(parameter => parameter.key === "quality")).toMatchObject({ default: "max", allowCustomValue: true });
    expect(source.parameters?.find(parameter => parameter.key === "size")).toMatchObject({ control: "dimensions", allowCustomValue: true });
    expect(source.parameters?.some(parameter => ["background", "output_format", "mask", "output_compression"].includes(parameter.key))).toBe(false);
    expect(selected("image-2-1K 0.04").parameters?.find(parameter => parameter.key === "quality")?.default).toBe("high");
    expect(selected("qwen-image-3.0").parameters?.find(parameter => parameter.key === "quality")?.default).toBeUndefined();
  });

  it("uses declared video enums and material constraints while retaining conflicting descriptions", () => {
    expect(selected("SD2.5-X-满参支持人脸").parameters?.find(parameter => parameter.key === "duration")?.options?.[0]?.value).toBe(8);
    expect(selected("SD2.5-C-满参支持人脸").parameters?.find(parameter => parameter.key === "duration")?.options?.[0]?.value).toBe(5);
    expect(selected("veo-omni-flash").parameters?.find(parameter => parameter.key === "duration")?.options?.map(option => option.value)).toEqual([10]);
    expect(selected("SD-2.5-M2支持真人满血").limits).toMatchObject({ maxInputImages: 30, maxInputVideos: 10, maxInputAudios: 10 });
    expect(selected("sd_2.0mini支持真人903-720P").limits).toMatchObject({ maxInputImages: 9, maxInputVideos: 0, maxInputAudios: 3 });
    expect(selected("MiniMax-H3-768p-c1").limits).toMatchObject({ maxInputImages: 9, maxInputVideos: 0, maxInputAudios: 1, requiresInputImage: true });
    expect(selected("kling-video-v4").limits).toMatchObject({ maxInputImages: 10, maxInputVideos: 5, maxInputAudios: 3, maxInputAssets: 15 });
    expect(selected("veo-3.1-fast").limits?.maxInputImages).toBe(3);
    expect(selected("veo-3.1-lite").limits?.maxInputImages).toBe(2);
  });

  it("projects only each image's official tier/ratio combinations after shared presets, including 1:2 and 2:1", () => {
    const model = langframeImagePresentation(applyUserImageSizePresets(selected("image-2.5-flare-1K-2k-4kMAX品质")));
    const size = model.parameters?.find(parameter => parameter.key === "size")!;
    expect(size.options).toHaveLength(40); // auto + 3 tiers × 13 ratios.
    expect(size.options?.find(option => option.label === "4K · 1:2 · 1920 × 3840")?.value).toBe("1920x3840");
    expect(size.options?.find(option => option.label === "4K · 2:1 · 3840 × 1920")?.value).toBe("3840x1920");
    expect(size.min).toBeUndefined();
    expect(size.max).toBeUndefined();
    expect(size.step).toBeUndefined();
    expect(model.metadata).toMatchObject({ imageResolutionTierParameter: "resolution", imageUserSizePresetSource: "user-request", imageApplicationQualityDefault: "max" });
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["1K", "2K", "4K"]);
    expect(model.parameters?.find(parameter => parameter.key === "quality")).toMatchObject({ default: "max", allowCustomValue: true });
    expect(langframeImagePresentation(applyUserImageSizePresets(model))).toEqual(model);
    const qwen = langframeImagePresentation(applyUserImageSizePresets(selected("qwen-image-3.0")));
    expect(qwen.parameters?.find(parameter => parameter.key === "size")?.options).toHaveLength(6);
    expect(qwen.parameters?.find(parameter => parameter.key === "size")?.options?.filter(option => option.value !== "auto").every(option => option.label.startsWith("2K ·"))).toBe(true);
    expect(qwen.parameters?.find(parameter => parameter.key === "size")?.options?.some(option => /3:2|1:2|2:1/u.test(option.label))).toBe(false);
    expect(langframeImagePresentation(applyUserImageSizePresets(selected("image-2.5-flare-1K"))).parameters?.find(parameter => parameter.key === "resolution")?.options).toEqual([{ value: "1K", label: "1K" }]);
  });

  it("keeps every declared ratio after the API's final shared projection, JSON reload and old 11-ratio snapshots", () => {
    const source = selected("image-2.5-sunburst-1K-2k-4k-MAX品质");
    const projected = langframeImagePresentation(applyUserImageSizePresets(source));
    const saved = JSON.parse(JSON.stringify(projected));
    // Reproduce the installed response: the old shared projection had retained
    // an empty sourceOptions array and rebuilt only its eleven common ratios.
    saved.parameters.find((parameter: { key: string }) => parameter.key === "size").options =
      saved.parameters.find((parameter: { key: string }) => parameter.key === "size").options.filter((option: { label: string }) => !/ · (?:1:2|2:1) · /u.test(option.label));
    saved.metadata.imageUserSizeSourceOptions = [];
    const repaired = applyUserImageSizePresets(saved);
    const size = repaired.parameters?.find(parameter => parameter.key === "size")!;
    expect(size.options).toHaveLength(40);
    for (const tier of ["1K", "2K", "4K"]) for (const ratio of ["1:2", "2:1"])
      expect(size.options?.filter(option => option.label.startsWith(`${tier} · ${ratio} ·`))).toHaveLength(1);
    expect(repaired.metadata?.rawParams).toEqual(source.metadata?.rawParams);
    expect(repaired.metadata?.imageUserSizePresetSource).toBe("user-request");
    expect(repaired.metadata?.imageOutputDimensions).toBeUndefined();
    expect(repaired.metadata?.imageCustomDimensionRules).toBeUndefined();
    expect(applyUserImageSizePresets(JSON.parse(JSON.stringify(repaired)))).toEqual(repaired);
  });

  it("does not restore forbidden Langframe ratio/tier options from old source snapshots", () => {
    const broad = langframeImagePresentation(applyUserImageSizePresets(selected("image-2.5-flare-1K-2k-4kMAX品质")));
    const restricted = selected("qwen-image-3.0");
    const withOldOptions = { ...restricted, metadata: { ...restricted.metadata, imageUserSizePresets: "2026-10-11",
      imageUserSizeSourceOptions: broad.parameters?.find(parameter => parameter.key === "size")?.options } };
    const current = applyUserImageSizePresets(withOldOptions), options = current.parameters?.find(parameter => parameter.key === "size")?.options ?? [];
    expect(options).toHaveLength(6);
    expect(options.filter(option => option.value !== "auto").every(option => option.label.startsWith("2K ·"))).toBe(true);
    expect(options.some(option => / · (?:1:2|2:1|3:2) · /u.test(option.label))).toBe(false);
    const oneK = applyUserImageSizePresets({ ...selected("image-2.5-flare-1K"), metadata: { ...selected("image-2.5-flare-1K").metadata,
      imageUserSizePresets: "2026-10-11", imageUserSizeSourceOptions: broad.parameters?.find(parameter => parameter.key === "size")?.options } });
    expect(oneK.parameters?.find(parameter => parameter.key === "size")?.options).toHaveLength(14);
    expect(oneK.parameters?.find(parameter => parameter.key === "size")?.options?.some(option => /^(?:2K|4K) ·/u.test(option.label))).toBe(false);
  });

  it("keeps raw performance data instead of the site's artificial display floor", () => {
    const model = selected("11111"), raw = fixture.payload.groups.flatMap(group => group.models).find(row => row.name === "11111")!;
    expect(model.metadata?.langframeRuntimeStats).toEqual(raw.runtimeStats);
    expect(model.metadata?.langframeRuntimeStatsSource).toBe("unmodified-api");
    expect(model.metadata?.langframeCatalogCheckedAt).toBe(fixture.checkedAt);
    expect(model.metadata?.langframeCatalogSourceSha256).toBe(fixture.sha256);
    expect(model.metadata?.rawParams).toMatchObject({ requestFormat: "onmi-video" });
  });

  it("does not claim malformed, paginated or nameless catalogs are complete or invent call names from inner IDs", () => {
    expect(parseLangframeCatalog({ ok: false, groups: [] }, options)).toMatchObject({ recognized: false, complete: false });
    expect(parseLangframeCatalog({ ok: true, groups: [{ name: "i", type: "image", models: [{ id: "inner-only" }] }] }, options)).toMatchObject({ recognized: true, complete: false, models: [] });
    expect(parseLangframeCatalog({ ...fixture.payload, has_more: true }, options).complete).toBe(false);
    const clean = parseLangframeCatalog({ ok: true, groups: [{ name: "i", type: "image", models: [{ id: "inner", name: "call", apiKey: "never-retain", cookie: "never-retain" }] }] }, options);
    expect(JSON.stringify(clean)).not.toContain("never-retain");
  });

  it("recognizes only the exact official source", () => {
    expect(isLangframeCatalogSource("https://vipprompt.cn", "https://vipprompt.cn/v1")).toBe(true);
    expect(isLangframeCatalogSource("https://www.vipprompt.cn")).toBe(true);
    for (const source of ["https://vipprompt.cn.evil.test", "https://user@vipprompt.cn", "https://vipprompt.cn/?token=x", "http://vipprompt.cn", "https://viprompt.cn"]) expect(isLangframeCatalogSource(source)).toBe(false);
  });

  it("discovers the public feed with free GET and does not send account tokens or trigger refresh/generation", async () => {
    const calls: string[] = [];
    const result = await discoverSupplierCatalog({ siteUrl: "https://vipprompt.cn", apiUrl: "https://vipprompt.cn", kind: "auto", token: "private-account-token" }, async (url, init) => {
      calls.push(String(url));
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      return Response.json(fixture.payload);
    });
    expect(calls).toEqual([LANGFRAME_CATALOG_URL]);
    expect(result).toMatchObject({ kind: "langframe", status: "live", complete: true, modelListsComplete: true });
    expect(result.groups).toHaveLength(39);
  });

  it("retains the actual www source origin instead of mixing another origin's state", async () => {
    const calls: string[] = [];
    const result = await discoverSupplierCatalog({ siteUrl: "https://www.vipprompt.cn", apiUrl: "https://www.vipprompt.cn", kind: "langframe" }, async url => {
      calls.push(String(url)); return Response.json(fixture.payload);
    });
    expect(calls).toEqual(["https://www.vipprompt.cn/api/relay/groups?stats=1"]);
    expect(result.groups[0]?.models[0]?.metadata).toMatchObject({ langframeCatalogUrl: calls[0], documentationUrl: "https://www.vipprompt.cn/api-docs" });
    expect(langframeModelDescriptor(result.groups[0]!.models[0]!)?.pricing?.sourceUrl).toBe(calls[0]);
  });
});
