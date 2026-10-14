import { describe, expect, it } from "vitest";
import { isTk1688CatalogSource, normalizeTk1688CnyModel, parseTk1688AccountModelIds, parseTk1688Marketplace, tk1688DescriptionFacts } from "./tk1688-catalog.js";
import { applyUserImageSizePresets } from "./image-size-presets.js";

const base = "gpt-image-2.5-sunburst";
const sku = (suffix: string, description: string, extra = {}) => ({ id: 1, base_model: base, alias: `${base}@${suffix}`,
  charge_type: "per_request", input_price_usd: 0.03, output_price_usd: 0, description, status: "active", channel_alive: true, ...extra });
const market = (...items: unknown[]) => ({ success: true, data: { items, total: items.length } });
const status = { success: true, data: { platform_markup_percent: 20, payment_fx_rate_cny_per_usd: 6.8896 } };

describe("词元模型广场 contracts", () => {
  it("preserves exact SKU cache rates through one retail FX conversion and never estimates an unknown usage split", () => {
    const parsed = parseTk1688Marketplace(market({ ...sku("s1c23", "文本渠道"), base_model: "gpt-5.4", alias: "gpt-5.4@s1c23",
      charge_type: "per_token", input_price_usd: 2.5, output_price_usd: 15, cache_read_price_usd: .25, cache_write_price_usd: 0 }), status);
    const exact = parsed.models.find(m => m.id.includes("@"))!;
    expect(exact.pricing?.tiers?.map(t => t.price)).toEqual([17.224, 103.344, 1.7224, 0]);
    expect(exact.pricing?.inputPerMillion).toBeUndefined();
    expect(exact.metadata?.tk1688OriginalPricing).toMatchObject({ currency: "USD", tiers: [{ price: 2.5 }, { price: 15 }, { price: .25 }, { price: 0 }] });
    expect(normalizeTk1688CnyModel(exact)).toEqual(exact);
    expect(parsed.models.find(m => m.id === "gpt-5.4")?.metadata?.priceLabel).toContain("输入 ¥17.224/1M");
    const malformed = parseTk1688Marketplace(market({ ...sku("s1c23", "文本渠道"), base_model: "gpt-5.4", alias: "gpt-5.4@s1c23",
      charge_type: "per_token", cache_read_price_usd: "0.25" }), status).models.find(m => m.id.includes("@"))!;
    expect(malformed.pricing).toBeUndefined();
  });
  it("honors a merchant cache denial without advertising its retained raw cache quotes", () => {
    const item = { ...sku("s1c52", "文本渠道"), base_model: "gpt-6-astra", alias: "gpt-6-astra@s1c52",
      charge_type: "per_token", input_price_usd: 2.5, output_price_usd: 15, cache_read_price_usd: .035714, cache_write_price_usd: .446429 };
    const supported = parseTk1688Marketplace(market({ ...item, cache_unsupported: false }), status).models[1]!;
    expect(supported.pricing?.tiers).toHaveLength(4);
    expect(supported.metadata?.tk1688CacheUnsupported).toBe(false);
    const parsed = parseTk1688Marketplace(market({ ...item, cache_unsupported: true }), status);
    const exact = parsed.models[1]!;
    expect(exact.pricing).toMatchObject({ currency: "CNY", inputPerMillion: 17.224, outputPerMillion: 103.344 });
    expect(exact.pricing?.tiers).toBeUndefined();
    expect(exact.metadata?.priceLabel).not.toContain("缓存");
    expect(exact.metadata).toMatchObject({ tk1688CacheUnsupported: true, tk1688CacheReadPriceUsd: .035714, tk1688CacheWritePriceUsd: .446429 });
    expect(normalizeTk1688CnyModel(exact)).toEqual(exact);
    expect(parsed.models[0]?.metadata?.tk1688CacheUnsupported).toBeUndefined();
    expect(parsed.models[0]?.metadata?.tk1688CacheReadPriceUsd).toBeUndefined();
  });
  it("parses only explicit merchant resolution claims, including compact 124K and denials", () => {
    expect(tk1688DescriptionFacts("原生支持124K").resolutions).toEqual(["1K", "2K", "4K"]);
    expect(tk1688DescriptionFacts("原生/1K /2K").resolutions).toEqual(["1K", "2K"]);
    expect(tk1688DescriptionFacts("生图1K，不支持4K").resolutions).toEqual(["1K"]);
    expect(tk1688DescriptionFacts("搞就完了").resolutions).toEqual([]);
    expect(tk1688DescriptionFacts("支持1000RPM").resolutions).toEqual([]);
  });
  it("keeps Adobe's native 4K example as a reference and honors noN without fixing user pixels", () => {
    const parsed = parseTk1688Marketplace(market(sku("s47c261", "Adobe支持原生4K(3840*2160)，不支持N。")), status);
    const model = parsed.models.find(model => model.id.endsWith("@s47c261"))!;
    expect(model).toMatchObject({ id: `${base}@s47c261`, limits: { maxOutputImages: 1 },
      metadata: { tk1688ReferenceSize: "3840x2160", tk1688SupportedResolutions: ["4K"], tk1688OmitN: true, fixedOutputCount: 1,
        tk1688RetailPriceIncludesMarkup: true, tk1688PlatformMarkupPercent: 20 } });
    expect(model.metadata?.tk1688FixedSize).toBeUndefined();
    expect(model.parameters?.find(parameter => parameter.key === "size")?.control).toBe("dimensions");
    expect(applyUserImageSizePresets(model).metadata?.imageUserSizePresetTiers).toEqual(["1K", "2K", "4K"]);
    expect(model.parameters?.some(parameter => parameter.key === "n")).toBe(false);
    expect(model.pricing).toMatchObject({ kind: "per-request", currency: "CNY", billingUnit: "request", unitAmount: 0.206688 });
    expect(model.metadata?.priceLabel).toBe("¥0.206688/次");
    expect(model.metadata?.tk1688OriginalPricing).toMatchObject({ currency: "USD", unitAmount: 0.03 });
  });
  it.each(["固定3840x2160", "仅支持3840*2160", "尺寸固定为3840 × 2160"])("retains genuinely fixed pixels: %s", description => {
    const model = parseTk1688Marketplace(market(sku("s47c261", description))).models[1]!;
    expect(model.metadata?.tk1688FixedSize).toBe("3840x2160");
    expect(model.parameters?.find(parameter => parameter.key === "size")?.options?.map(option => option.value)).toEqual(["3840x2160"]);
    expect(applyUserImageSizePresets(model).metadata?.imageUserSizePresets).toBeUndefined();
  });
  it.each(["仅支持4K", "源头原生/限4K", "支持4K，不支持1K/2K"])("retains an explicit tier restriction independently of pixels: %s", description => {
    const parsed = parseTk1688Marketplace(market(sku("s47c261", description), sku("s1c23", "支持1K/2K/4K")));
    for (const model of [parsed.models[1]!]) {
      expect(model.metadata?.tk1688FixedSize).toBeUndefined();
      const projected = applyUserImageSizePresets(model);
      expect(projected.metadata?.imageUserSizePresetTiers).toEqual(["4K"]);
      expect(projected.metadata?.imageUserSizeSourceOptions).toEqual([{ value: "auto", label: "自动" }]);
      expect(projected.parameters?.find(parameter => parameter.key === "size")?.options?.every(option => option.value === "auto" || option.label.startsWith("4K ·"))).toBe(true);
      expect(applyUserImageSizePresets(normalizeTk1688CnyModel({ ...projected, metadata: { ...projected.metadata,
        imageUserSizeSourceOptions: [{ value: "auto", label: "自动" }, { value: "1024x1024", label: "默认示例" }] } })))
        .toEqual(applyUserImageSizePresets(normalizeTk1688CnyModel(projected)));
    }
    expect(applyUserImageSizePresets(parsed.models[0]!).metadata?.imageUserSizePresetTiers).toEqual(["1K", "2K", "4K"]);
  });
  it("repairs old inferred fixed-size snapshots idempotently without mutating supplier evidence", () => {
    const model = parseTk1688Marketplace(market(sku("s47c261", "Adobe支持原生4K(3840*2160)，不支持N。"))).models[1]!;
    const legacy = { ...model, parameters: [{ key: "size", label: "size", control: "select" as const, valueType: "string" as const,
      default: "3840x2160", options: [{ value: "3840x2160", label: "原生" }] }], metadata: { ...model.metadata, tk1688FixedSize: "3840x2160" } };
    const repaired = normalizeTk1688CnyModel(legacy);
    expect(repaired.metadata.tk1688FixedSize).toBeUndefined();
    expect(repaired.metadata.tk1688SupportedResolutions).toEqual(["4K"]);
    expect(applyUserImageSizePresets(repaired).metadata?.imageUserSizePresetTiers).toEqual(["1K", "2K", "4K"]);
    expect(normalizeTk1688CnyModel(repaired)).toEqual(repaired);
    expect(legacy.metadata.tk1688FixedSize).toBe("3840x2160");
  });
  it("uses the safe smart-route intersection and never inherits a merchant's fixed pixels", () => {
    const parsed = parseTk1688Marketplace(market(sku("s47c261", "Adobe支持原生4K(3840*2160)，不支持N。"),
      sku("s46c265", "源头原生/限4K")), status);
    const smart = parsed.models.find(model => model.id === base)!;
    expect(smart.metadata).toMatchObject({ tk1688SupportedResolutions: ["4K"], tk1688OmitN: true });
    expect(smart.metadata?.tk1688FixedSize).toBeUndefined();
    expect(smart.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    const conflicting = parseTk1688Marketplace(market(sku("s47c261", "Adobe支持原生4K(3840*2160)，不支持N。"),
      sku("s46c264", "源头原生/1K /2K"), sku("s1c77", "搞就完了"))).models[0]!;
    expect(conflicting.metadata?.tk1688SupportedResolutions).toEqual([]);
    expect(conflicting.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(conflicting.pricing).toBeUndefined();
  });
  it("joins Key-family permissions, authenticated account aliases and live SKUs", () => {
    const other = sku("s1c1", "1K", { base_model: "other-image", alias: "other-image@s1c1" });
    const parsed = parseTk1688Marketplace(market(sku("s1c23", "1K"), sku("s46c264", "1K/2K"),
      sku("s47c261", "4K", { channel_alive: false }), other), status,
    { keyModelIds: [base], accountModelIds: [`${base}@s1c23`, `${base}@s47c261`, "other-image@s1c1"] });
    expect(parsed.models.map(model => model.id)).toEqual([base, `${base}@s1c23`]);
    expect(parsed.excludedModelIds).toContain(`${base}@s47c261`);
    expect(parsed.models[0]?.metadata?.tk1688SupportedResolutions).toEqual(["1K"]);
    expect(parseTk1688Marketplace(market(sku("s1c23", "1K")), status, { keyModelIds: [base], accountModelIds: [] }).models).toEqual([]);
  });
  it("distinguishes shared studio parameters from per-merchant statements", () => {
    const model = parseTk1688Marketplace(market(sku("s1c23", "1K"))).models[1]!;
    expect(model.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["auto", "high", "medium", "low"]);
    expect(model.parameters?.find(parameter => parameter.key === "n")?.max).toBe(4);
    expect(model.parameters?.find(parameter => parameter.key === "response_format")?.options?.map(option => option.value)).toEqual(["url", "b64_json"]);
    expect(model.metadata).toMatchObject({ tk1688QualityDeclared: false, tk1688QualitySource: "official-image-station-common" });
  });
  it("carries text modalities, context/output limits and retail token prices from the market", () => {
    const model = parseTk1688Marketplace(market({ ...sku("s1c23", "文本渠道"), base_model: "chat-pro", alias: "chat-pro@s1c23",
      charge_type: "per_token", modalities: ["text", "image", "pdf"], context_tokens: 1050000, max_output_tokens: 128000,
      input_price_usd: 0.9, output_price_usd: 5 }), status).models[1]!;
    expect(model).toMatchObject({ operations: [], inputKinds: ["text", "image"], outputKinds: ["text"], pricing: { kind: "token", currency: "CNY", inputPerMillion: 6.20064, outputPerMillion: 34.448 },
      metadata: { agentCapabilities: { imageInput: true }, tk1688ContextTokens: 1050000, tk1688MaxOutputTokens: 128000, tk1688Modalities: ["text", "image", "pdf"] } });
    expect(model.outputKinds).not.toContain("pdf");
    expect(model.inputKinds).not.toContain("pdf");
  });
  it("retains exact-SKU raw modality additions and removals without granting a smart route one merchant's PDF claim", () => {
    const item = { ...sku("s26c421", "文本渠道"), base_model: "gemini-3-flash", alias: "gemini-3-flash@s26c421", charge_type: "per_token" };
    const before = parseTk1688Marketplace(market({ ...item, modalities: ["text", "image", "video", "audio"] }), status);
    const after = parseTk1688Marketplace(market({ ...item, modalities: ["text", "image", "video", "audio", "pdf"] }), status);
    expect(before.models[1]?.metadata?.tk1688Modalities).toEqual(["text", "image", "video", "audio"]);
    expect(after.models[1]?.metadata?.tk1688Modalities).toEqual(["text", "image", "video", "audio", "pdf"]);
    expect(after.models[1]?.inputKinds).toEqual(before.models[1]?.inputKinds);
    expect(after.models[0]?.metadata?.tk1688Modalities).toBeUndefined();
  });
  it("uses the current official FX for smart price ranges without applying markup twice", () => {
    const parsed = parseTk1688Marketplace(market(sku("s1c1", "1K"), sku("s2c2", "1K", { input_price_usd: 0.05 })), status,
      { checkedAt: "2026-10-06T00:00:00Z" });
    expect(parsed.models[0]?.metadata?.priceLabel).toBe("¥0.206688–¥0.34448/次（自动路由，实际价格由商家决定）");
    expect(parsed.models[1]?.metadata).toMatchObject({ tk1688FxRateSourceUrl: "https://tk1688.com/api/status", tk1688FxRateCheckedAt: "2026-10-06T00:00:00Z" });
  });
  it.each([undefined, 0, -1, Infinity, "6.8896"])("never presents USD or a zero substitute when the official FX is invalid: %s", fx => {
    const parsed = parseTk1688Marketplace(market(sku("s1c1", "1K")), { success: true, data: { payment_fx_rate_cny_per_usd: fx } });
    for (const model of parsed.models) {
      expect(model.pricing).toBeUndefined();
      expect(model.metadata?.priceLabel).toBe("人民币价格暂不可用（汇率未读取）");
    }
  });
  it("repairs saved USD quotes once, preserves the raw price and leaves other providers intact", () => {
    const legacy = { metadata: { tk1688Catalog: true, tk1688FxRate: 6.8896, priceLabel: "$0.03/次（¥0.206688/次）" },
      pricing: { kind: "per-request" as const, currency: "USD", unitAmount: .03, checkedAt: "then", confidence: "snapshot" as const } };
    const converted = normalizeTk1688CnyModel(legacy);
    expect(converted).toMatchObject({ pricing: { currency: "CNY", unitAmount: .206688 }, metadata: { priceLabel: "¥0.206688/次" } });
    expect(normalizeTk1688CnyModel(converted)).toEqual(converted);
    const other = { ...legacy, metadata: { ...legacy.metadata, tk1688Catalog: false } };
    expect(normalizeTk1688CnyModel(other)).toBe(other);
    expect(normalizeTk1688CnyModel({ metadata: { tk1688Catalog: true, tk1688FxRate: 7, priceLabel: "$0.01–$0.05/次（自动路由）" } }).metadata.priceLabel)
      .toBe("¥0.07–¥0.35/次（自动路由）");
  });
  it("does not label partial listings complete or accept unrelated supplier hosts", () => {
    expect(parseTk1688Marketplace({ success: true, data: { items: [], total: 10 } }).complete).toBe(false);
    expect(parseTk1688Marketplace({ success: false, data: { items: [] } }).complete).toBe(false);
    expect(isTk1688CatalogSource("https://tk1688.com", "https://api.tk1688.com/v1")).toBe(true);
    expect(isTk1688CatalogSource("https://evil.tk1688.com", "https://api.tk1688.com/v1")).toBe(false);
    expect(isTk1688CatalogSource("https://tk1688.com", "https://api.other.example/v1")).toBe(false);
    expect(parseTk1688AccountModelIds({ success: true, data: ["a@s1c1", "a@s1c1"] })).toEqual(["a@s1c1"]);
    expect(parseTk1688AccountModelIds({ success: true, data: ["", "a"] })).toBeUndefined();
  });
});
