import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
import type { FetchImplementation, ModelDescriptor, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter } from "./openai.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { applyCOpenImageCapabilities, cOpenImageParameterIssues, cOpenImageParameters, cOpenImageRoute } from "./c-open-image-contract.js";
import { applyMonsterImageCapabilities } from "./monster-image-capabilities.js";
import { applyChuangxiangImageCapabilities } from "./chuangxiang-image-capabilities.js";
import { applyGenimageImageCapabilities } from "./genimage-image-capabilities.js";
import { applyBananaImageCapabilities } from "./banana-image-contract.js";
import { applyChuangxiangCurrentImageCapabilities } from "./chuangxiang-image-contract.js";
import { applyChuangxiangMidjourneyCapabilities } from "./chuangxiang-midjourney-contract.js";

const gpt = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const scopes = [
  ...["gpt  pro 0.12", "GPT pro", "GPT pro 企业级稳定"].map(group => ({ baseUrl: "https://pool.chaozhiyuanai.com", modelGroup: group, models: gpt, tiers: [] })),
  { baseUrl: "https://synoralink.com/v1", modelGroup: "adobe中质量生图", accountKeyGroupId: "99", models: [gpt[0]!], tiers: ["4K"] },
  { baseUrl: "https://synoralink.com/v1", modelGroup: "全参生图专线", accountKeyGroupId: "115", models: gpt, tiers: ["4K"] },
  { baseUrl: "https://synoralink.com/v1", modelGroup: "OAI官Key生图", accountKeyGroupId: "119", models: gpt, tiers: [] },
  { baseUrl: "https://api.hangzhale.com", modelGroup: "Image2生图专用分组", accountKeyGroupId: "21", models: [gpt[0]!], tiers: ["4K"] },
  { baseUrl: "https://api.hangzhale.com", modelGroup: "Image - 1k", accountKeyGroupId: "75", models: [...gpt, "gpt-image-2.5"], tiers: ["1K"] },
  { baseUrl: "https://api.eaheng.com", modelGroup: "A2-GPT-Pro正价-0.28倍率", accountKeyGroupId: "6", models: [...gpt, "gpt-image-2.5"], tiers: [] },
  { baseUrl: "https://api.eaheng.com", modelGroup: "GPT生图原生渠道V5", accountKeyGroupId: "24", models: [...gpt, "gpt-image-2.5"], tiers: [] },
  { baseUrl: "https://api.eaheng.com", modelGroup: "B4-GPT生图原生渠道V3（高质量）", accountKeyGroupId: "18", models: ["gpt-image-2.5-flare-high", "gpt-image-2.5-flare-max", "gpt-image-2.5-sunburst-high", "gpt-image-2.5-sunburst-max"], tiers: [] },
  { baseUrl: "https://api.eaheng.com", modelGroup: "A1-GPT-Pro-0.18倍率", accountKeyGroupId: "2", models: [...gpt, "gpt-image-2.5"], tiers: [] },
];
const stale: ModelDescriptor = { id: gpt[0]!, name: gpt[0]!, operations: ["image.generate", "image.edit"],
  parameters: [{ key: "size", label: "old", control: "dimensions", min: 16, max: 3840, step: 16, options: [{ label: "4K · 16:9", value: "3840x2160" }] },
    { key: "background", label: "old", control: "select" }],
  pricing: { kind: "per-request", currency: "USD", unitAmount: .07, checkedAt: "2026-09-20", confidence: "snapshot" },
  metadata: { priceStatus: "partial", priceCheckedAt: "2026-09-20", priceLastAttemptStatus: "failed", imageResolutionProfiles: { "4K": { "16:9": "3840x2160" } } } };

describe("C exact official groups preserve open image inputs without borrowed pixel matrices", () => {
  it.each([...gpt, "gpt-image-2.5"])("sends current stable Monster 2's complete %s image fields without borrowing B-group measurements", async model => {
    const config = scopes.at(-1)!, quality = model.includes("2.5") ? "max" : "high";
    const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const resolver = new StaticConnectionResolver([{ id: "monster2", provider: "openai", apiKey: "fixture", baseUrl: config.baseUrl,
      settings: { ...config, accountKeyId: "1957", scannedModelIds: [model] } }]);
    const adapter = new OpenAIImageAdapter(resolver, { fetch });
    const parameters = { size: "3840x2160", quality, n: 1 }, snapshot = structuredClone(parameters);
    await adapter.submit({ connectionId: "monster2", operation: "image.generate", model, prompt: "fixture", idempotencyKey: "mock-only", parameters });
    expect(parameters).toEqual(snapshot);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]![0])).toBe("https://api.eaheng.com/v1/images/generations");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ model, ...parameters });
    const descriptor = applyCOpenImageCapabilities({ provider: "openai", config }, { ...stale, id: model });
    expect(descriptor.metadata?.imagePixelBudgetPublished).toBe(false);
    expect(descriptor.metadata?.imageMeasuredAdditionalFields).toBeUndefined();
    expect(descriptor.parameters?.find(p => p.key === "quality")?.default).toBe(quality);
    expect(descriptor.parameters?.find(p => p.key === "n")).toMatchObject({ default: 1, min: 1, step: 1 });
    expect(descriptor.parameters?.find(p => p.key === "n")?.max).toBeUndefined();
    expect(descriptor.metadata).toMatchObject({ imageAdditionalFieldContract: "not-declared-in-exact-supplier-material",
      imageCountFieldSource: "existing-application-images-protocol", imageSupplierOutputCountDefault: null });
    expect(descriptor.parameters?.some(p => p.key === "output_format")).toBe(false);
    expect(cOpenImageParameterIssues(config, model, { ...parameters, output_format: "png" })).toContainEqual(
      expect.objectContaining({ path: "parameters.output_format", code: "missing_exact_field_contract" }));
    expect(cOpenImageParameters(config, model, { ...parameters, output_format: "png" })).not.toHaveProperty("output_format");
  });
  it("limits the new Monster 2 correction to its identity and preserves other Monster groups' existing extra fields", () => {
    const parameters = { size: "3840x2160", quality: "max", n: 1, output_format: "png", background: "transparent" };
    for (const config of scopes.filter(scope => scope.baseUrl === "https://api.eaheng.com" && scope.accountKeyGroupId !== "2")) {
      const model = config.models[0]!;
      expect(cOpenImageParameters(config, model, parameters)).toMatchObject({ output_format: "png", background: "transparent", n: 1 });
      expect(cOpenImageParameterIssues(config, model, { ...parameters, quality: cOpenImageRoute(config, model)?.quality ?? "max" })).toEqual([]);
    }
    const zhiyuan = applyCOpenImageCapabilities({ provider: "openai", config: scopes[0]! }, stale);
    expect(zhiyuan.parameters?.find(p => p.key === "n")).toMatchObject({ control: "number", default: 1 });
    expect(cOpenImageParameters(scopes[0]!, gpt[0]!, { size: "3840x2160", quality: "high", n: 1 })).toEqual({ size: "3840x2160", quality: "high", n: 1 });
  });
  it("covers all current exact group/full-ID rows and separates actual group tiers from request pixels", () => {
    let count = 0;
    for (const config of scopes) for (const id of config.models) {
      count++;
      const original = { ...stale, id }, before = structuredClone(original);
      const model = applyCOpenImageCapabilities({ provider: "openai", config }, original);
      expect(original).toEqual(before);
      expect(model.pricing).toEqual(stale.pricing);
      expect(model.metadata).toMatchObject({ imageOpenSizePreferences: true, imageNativeParameterContract: true,
        imagePixelBudgetPublished: false, imageSupportedResolutions: config.tiers, priceStatus: "partial", priceCheckedAt: "2026-09-20" });
      expect(model.metadata?.imageResolutionProfiles).toBeUndefined();
      expect(model.parameters?.find(p => p.key === "size")).toMatchObject({ allowCustomValue: true, options: [{ value: "auto", label: "自动（省略 size）" }] });
      for (const field of ["min", "max", "step"] as const) expect(model.parameters?.find(p => p.key === "size")?.[field]).toBeUndefined();
      expect(model.parameters?.find(p => p.key === "size_tier")?.options?.slice(1).map(o => o.value) ?? []).toEqual(config.tiers);
      expect(applyCOpenImageCapabilities({ provider: "openai", config }, model)).toEqual(model);
    }
    expect(count).toBe(37);
  });

  it("uses stable identity when present and does not apply same-name unrelated groups or origins", () => {
    for (const config of scopes) {
      expect(cOpenImageRoute({ ...config, accountKeyGroupId: "999" }, config.models[0]!)).toBeUndefined();
      for (const override of [{ baseUrl: "https://pool.chaozhiyuanai.com.example" }, { manualProtocol: true }, { usage: "agent" }, { supplierArchived: true }])
        expect(cOpenImageRoute({ ...config, ...override }, config.models[0]!)).toBeUndefined();
    }
    expect(cOpenImageRoute(scopes[0]!, "gpt-image-2-4k")).toBeUndefined();
  });

  it("keeps explicit ratio/tier inputs and requires W/H rather than omitting or guessing them", () => {
    const config = scopes[4]!;
    for (const alias of ["aspect_ratio", "aspectRatio", "ratio"]) {
      const params = { size: "auto", size_tier: "4K", [alias]: "16:9", quality: "max" }, before = structuredClone(params);
      expect(cOpenImageParameterIssues(config, gpt[1]!, params)).toContainEqual(expect.objectContaining({ code: "aspect_ratio_requires_explicit_size" }));
      expect(params).toEqual(before);
      expect(cOpenImageParameterIssues(config, gpt[1]!, { ...params, size: "4096x2304" })).toEqual([]);
      expect(cOpenImageParameters(config, gpt[1]!, { ...params, size: "4096x2304" })).toEqual({ size: "4096x2304", quality: "max" });
    }
    expect(cOpenImageParameterIssues(config, gpt[1]!, { size: "2497x3313", quality: "provider-custom" })).toEqual([]);
  });

  it("retains Synora linked Images fields and enforces only the exact medium group condition", () => {
    const params = { size: "2497x3313", quality: "auto", n: 1, response_format: "b64_json", background: "transparent", output_format: "png" };
    expect(cOpenImageParameters(scopes[3]!, gpt[0]!, params)).toEqual({ ...params, quality: "medium" });
    expect(cOpenImageParameterIssues(scopes[3]!, gpt[0]!, { ...params, quality: "high" })).toContainEqual(expect.objectContaining({ path: "parameters.quality", code: "invalid_quality" }));
    expect(cOpenImageParameterIssues(scopes[0]!, gpt[0]!, params)).toContainEqual(expect.objectContaining({ path: "parameters.background", code: "missing_exact_field_contract" }));
    expect(applyCOpenImageCapabilities({ provider: "openai", config: scopes[0]! }, stale).parameters?.some(p => p.key === "background")).toBe(false);
  });

  it("reuses only Hang75's exact original generated transparent PNG fields, keeping other operations and extras scoped", () => {
    const config = scopes[7]!, parameters = { size: "1024x1024", quality: "high", n: 1, background: "transparent", output_format: "png" };
    for (const id of config.models) {
      const input = structuredClone(parameters);
      expect(cOpenImageParameterIssues(config, id, parameters, "image.generate")).toEqual([]);
      expect(cOpenImageParameters(config, id, parameters, "image.generate")).toEqual(parameters);
      expect(parameters).toEqual(input);
      const model = applyCOpenImageCapabilities({ provider: "openai", config }, { ...stale, id });
      expect(model.parameters?.find(p => p.key === "background")?.operations).toEqual(["image.generate"]);
      expect(model.metadata?.imageMeasuredAdditionalFields).toMatchObject({ checkedAt: "2026-10-07", background: "transparent", output_format: "png" });
      expect(cOpenImageParameterIssues(config, id, parameters, "image.edit")).toContainEqual(expect.objectContaining({ path: "parameters.background", code: "missing_exact_field_contract" }));
      expect(cOpenImageParameterIssues(config, id, { ...parameters, output_compression: 70 })).toContainEqual(expect.objectContaining({ path: "parameters.output_compression", code: "missing_exact_field_contract" }));
      expect(cOpenImageParameterIssues(config, id, { ...parameters, output_format: "jpeg" })).toContainEqual(expect.objectContaining({ path: "parameters.output_format", code: "missing_exact_field_contract" }));
    }
    const otherStableGroup = { ...config, accountKeyGroupId: "21" };
    expect(cOpenImageParameterIssues(otherStableGroup, "gpt-image-2", parameters)).toContainEqual(expect.objectContaining({ path: "parameters.background", code: "missing_exact_field_contract" }));
    expect(applyCOpenImageCapabilities({ provider: "openai", config: otherStableGroup }, stale).metadata?.imageMeasuredAdditionalFields).toBeUndefined();
    expect(cOpenImageParameters({ ...config, baseUrl: "https://pool.chaozhiyuanai.com", accountKeyGroupId: undefined, modelGroup: "GPT pro" }, "gpt-image-2", parameters)).not.toHaveProperty("background");
  });

  it.each(["direct", "automatic old binding"])("passes original odd/large W/H and open quality on the %s wire", async mode => {
    const config = scopes[4]!, model = gpt[1]!;
    const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/unchanged.png" }] }));
    const resolver = new StaticConnectionResolver([{ id: "c", provider: "openai", apiKey: "fixture", baseUrl: config.baseUrl,
      settings: { ...config, scannedModelIds: [model], modelCatalogModels: [{ ...stale, id: model }], autoModelInterfaces: {
        [model]: { model: { ...stale, id: model }, connector: { submit: { path: "/old", method: "POST", bodyTemplate: { model: "{{model}}", prompt: "{{prompt}}" } }, output: { kind: "image", urlsPath: "data[*].url" } } } } } }]);
    const base = new OpenAIImageAdapter(resolver, { fetch });
    const adapter = mode === "direct" ? base : new AutoInterfaceAdapter(resolver, base, { fetch });
    const request: NormalizedRequest = { connectionId: "c", operation: "image.generate", model, prompt: "fixture", idempotencyKey: "mock-only",
      parameters: { size: "4097x2101", quality: "supplier-extra-quality", n: 1, response_format: "url" } };
    const snapshot = structuredClone(request.parameters);
    const task = await adapter.submit(request);
    expect(request.parameters).toEqual(snapshot);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]![0])).toBe("https://synoralink.com/v1/images/generations");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ ...request.parameters, model });
    expect(await adapter.extractOutputs(task.result)).toMatchObject([{ url: "https://assets.example/unchanged.png" }]);
    await adapter.submit({ ...request, parameters: { size: "auto", size_tier: "4K", ratio: "16:9" } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toMatchObject({ model, size: "3840x2160" });
  });

  it("preserves explicit manual/paid model contracts for all six precise capability builders", () => {
    const builders = [
      { apply: applyCOpenImageCapabilities, config: scopes[0]!, id: "gpt-image-2" },
      { apply: applyMonsterImageCapabilities, config: { baseUrl: "https://api.eaheng.com", modelGroup: "B1" }, id: "gpt-image-2" },
      { apply: applyChuangxiangImageCapabilities, config: { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图" }, id: "gpt-image-2" },
      { apply: applyGenimageImageCapabilities, config: { baseUrl: "https://genimage.pro", modelGroup: "default" }, id: "gpt-image-2" },
      { apply: applyBananaImageCapabilities, config: { baseUrl: "https://genimage.pro", modelGroup: "default" }, id: "gemini-3.1-flash-image-preview" },
      { apply: applyChuangxiangCurrentImageCapabilities, config: { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图" }, id: "gpt-image-2-4k" },
      { apply: applyChuangxiangMidjourneyCapabilities, config: { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图" }, id: "midjourney-2k" },
    ];
    for (const b of builders) for (const marker of [{ source: "manual" }, { source: "paid-test" }, { protocolEvidence: "paid-test" }]) {
      const model = { ...stale, id: b.id, metadata: { ...stale.metadata, ...marker } };
      expect(b.apply({ provider: "openai", config: b.config }, model)).toBe(model);
    }
  });
});
