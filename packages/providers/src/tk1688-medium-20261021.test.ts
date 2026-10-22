import { describe, expect, it, vi } from "vitest";
import { parseTk1688Marketplace } from "./tk1688-catalog.js";
import { normalizeTk1688ImageSizeContract, tk1688DescriptionFacts } from "./tk1688-image-size-contract.js";
import { applyUserImageSizePresets } from "./image-size-presets.js";
import { OpenAIImageAdapter } from "./openai.js";
import { StaticConnectionResolver } from "./credentials.js";

// Exact public listing 1998 in https://tk1688.com/market,
// sampled 2026-10-22; raw receipt e766675f027ec170.json. The restriction is
// this merchant's explicit text, not an inference from the AD/Adobe name.
const row = { id: 1998, base_model: "gpt-image-2", alias: "gpt-image-2@s1c581", charge_type: "per_request",
  input_price_usd: .017418, output_price_usd: .017418, description: "生图AD渠道仅支持medium 非超分124k",
  status: "active", supplier_id: 1, channel_no: "ID00581", channel_alive: true };
const parsed = () => parseTk1688Marketplace({ success: true, data: { items: [row] } },
  { success: true, data: { payment_fx_rate_cny_per_usd: 6.8896 } });

describe("词元 explicit medium-only merchant contract", () => {
  it("parses only explicit closed quality wording, including one value without a quality heading", () => {
    expect(tk1688DescriptionFacts(row.description)).toMatchObject({ quality: ["medium"], exclusiveQuality: true });
    expect(tk1688DescriptionFacts("质量仅支持 medium / high")).toMatchObject({ quality: ["medium", "high"], exclusiveQuality: true });
    for (const description of ["Adobe支持原生4K(3840*2160)，不支持N。", "示例 quality: medium", "不只支持medium", "非仅支持medium"])
      expect(tk1688DescriptionFacts(description).exclusiveQuality).toBe(false);
  });

  it("repairs saved exact-SKU controls without expanding quality or restricting a smart route", () => {
    const models = parsed().models, exact = models.find(model => model.id === row.alias)!;
    const old = { ...exact, parameters: exact.parameters?.map(parameter => parameter.key === "quality"
      ? { ...parameter, default: "high", options: ["auto", "low", "medium", "high"].map(value => ({ value, label: value })) } : parameter),
      metadata: { ...exact.metadata, tk1688QualityDeclared: false } };
    const original = structuredClone(old);
    const projected = applyUserImageSizePresets(normalizeTk1688ImageSizeContract(old));
    expect(projected.parameters?.find(parameter => parameter.key === "quality")).toMatchObject({ default: "medium", options: [{ value: "medium", label: "medium" }] });
    expect(projected.metadata).toMatchObject({ tk1688QualityDeclared: true, imageQualityOptionsCompleteEnum: true });
    expect(applyUserImageSizePresets(normalizeTk1688ImageSizeContract(projected))).toEqual(projected);
    expect(old).toEqual(original);
    const revised = applyUserImageSizePresets(normalizeTk1688ImageSizeContract({ ...projected,
      metadata: { ...projected.metadata, supplierChannelDescription: "原生支持124K" } }));
    expect(revised.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toContain("high");
    expect(revised.metadata?.imageQualityOptionsCompleteEnum).not.toBe(true);
    const smart = applyUserImageSizePresets(models.find(model => model.id === row.base_model)!);
    expect(smart.metadata?.imageQualityOptionsCompleteEnum).not.toBe(true);
    expect(smart.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toContain("high");
  });

  it("rejects saved incompatible quality before transport and sends the selected medium unchanged", async () => {
    const model = parsed().models.find(model => model.id === row.alias)!;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "tk-medium", provider: "openai", apiKey: "fixture",
      baseUrl: "https://api.tk1688.com/v1", settings: { modelCatalogModels: [model] } }]), { fetch: fetcher });
    for (const quality of ["auto", "low", "high", "max"]) {
      const parameters = { size: "3840x2160", quality }, original = structuredClone(parameters);
      await expect(adapter.submit({ connectionId: "tk-medium", model: row.alias, operation: "image.generate", prompt: "offline fixture",
        idempotencyKey: "mock-only", parameters })).rejects.toThrow();
      expect(parameters).toEqual(original);
    }
    expect(fetcher).not.toHaveBeenCalled();
    await adapter.submit({ connectionId: "tk-medium", model: row.alias, operation: "image.generate", prompt: "offline fixture",
      idempotencyKey: "mock-only", parameters: { size: "3840x2160", quality: "medium" } });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model: row.alias, size: "3840x2160", quality: "medium" });
  });
});
