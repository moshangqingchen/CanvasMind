import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
import type { ModelDescriptor, NormalizedRequest } from "./contracts.js";
import { applyUserImageQualityPresets } from "./user-image-quality-presets.js";
import { applyUserImageSizePresets } from "./image-size-presets.js";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter, WeAIImageAdapter } from "./openai.js";
import { applyPdogImageCapabilities } from "./pdog-image-contract.js";
import { applyJiasuImageCapabilities } from "./jiasu-image-contract.js";
import { applyChuangxiangCurrentImageCapabilities } from "./chuangxiang-image-contract.js";

const base: ModelDescriptor = { id: "gpt-image-2.5-sunburst", name: "Sunburst", operations: ["image.generate", "image.edit"],
  parameters: [{ key: "quality", label: "质量", control: "select", valueType: "string", default: "high",
    options: ["low", "medium", "high"].map(value => ({ value, label: value })) }], metadata: { pdogQualityVerified: false } };
const quality = (model: ModelDescriptor) => model.parameters?.find(parameter => parameter.key === "quality");

describe("user-requested image highest quality", () => {
  it("restores all quality controls without a size field and keeps source facts separate", () => {
    const projected = applyUserImageSizePresets(base);
    expect(quality(projected)).toMatchObject({ default: "max" });
    expect(quality(projected)?.options?.map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(projected.metadata).toMatchObject({ pdogQualityVerified: false, imageUserQualityPresetSource: "user-request", imageUserQualitySourceParameter: base.parameters![0] });
    expect(applyUserImageQualityPresets(projected)).toEqual(projected);
    expect(quality(base)?.default).toBe("high");
  });

  it("uses high for Image 2.0 even when an old shared schema contains max and xhigh", () => {
    const legacy = { ...base, id: "gpt-image-2", parameters: [{ ...base.parameters![0]!, default: "max", options: ["auto", "low", "medium", "high", "xhigh", "max"].map(value => ({ value, label: value })) }] };
    const projected = applyUserImageQualityPresets(legacy);
    expect(quality(projected)?.default).toBe("high");
    expect(quality(projected)?.options?.map(option => option.value)).toEqual(["auto", "low", "medium", "high"]);
    expect((projected.metadata?.imageUserQualitySourceParameter as Record<string, unknown>).default).toBe("max");
  });

  it("rebuilds pDog source facts before reapplying user quality defaults to a projected cache", () => {
    const cached = applyUserImageSizePresets({ ...base, parameters: [{ ...base.parameters![0]!, description: "old cached quality description" }] });
    const current = applyPdogImageCapabilities({ provider: "openai", config: { baseUrl: "https://ai.whyshy.cn", modelGroup: "生图原生2K4K" } }, cached);
    const projected = applyUserImageSizePresets(current);
    expect(projected.metadata?.imageUserQualitySourceParameter).toEqual(quality(current));
    expect((projected.metadata?.imageUserQualitySourceParameter as Record<string, unknown>).description).not.toBe("old cached quality description");
    expect(quality(projected)?.default).toBe("max");
    expect(applyUserImageSizePresets(projected)).toEqual(projected);
  });

  it("preserves fixed groups, complete enums, measured rejections, manual and native protocols", () => {
    for (const metadata of [{ fixedQuality: "medium" }, { imageQualityOptionsCompleteEnum: true }, { imageQualitySource: "key-group" }, { source: "manual" }, { source: "paid-test" }]) {
      const fixed = { ...base, metadata };
      expect(applyUserImageQualityPresets(fixed)).toBe(fixed);
    }
    const fixed = { ...base, parameters: [{ ...base.parameters![0]!, description: "供应商仅接受 medium/max，省略时默认 medium。" }] };
    expect(applyUserImageQualityPresets(fixed)).toBe(fixed);
    expect(quality(applyUserImageQualityPresets({ ...base, metadata: { imageRejectedQualities: ["max"] } }))?.options?.map(option => option.value)).not.toContain("max");
    expect(applyUserImageQualityPresets({ ...base, parameters: [], metadata: { protocol: "native-chat", qualitySupport: "provider-decided" } }).parameters).toEqual([]);
    expect(quality(applyUserImageQualityPresets({ ...base, parameters: [], metadata: { protocol: "openai-images", qualitySupport: "provider-decided" } }))?.default).toBe("max");
  });

  it("retains Chuangxiang's explicitly closed medium/max quality after repeated final projection", () => {
    const descriptor = applyChuangxiangCurrentImageCapabilities({ provider: "openai", config: {
      baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图",
    } }, { ...base, id: "gpt-image-2.5-sunburst-4k" });
    expect(descriptor.metadata?.imageQualityOptionsCompleteEnum).toBe(true);
    const projected = applyUserImageSizePresets(applyUserImageSizePresets(descriptor));
    expect(quality(projected)?.options?.map(option => option.value)).toEqual(["auto", "medium", "max"]);
    expect(quality(projected)?.default).toBe("max");
  });

  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("submits %s max in the current pDog async group", async model => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ task_id: "offline-one", status: "processing" }, { status: 202 }));
    const settings = { modelGroup: "【生图】image2/2.5-1K2K4K(超分组)", accountKeyGroupId: "14", defaultModel: model, scannedModelIds: [model] };
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "pdog", provider: "openai", baseUrl: "https://ai.whyshy.cn", apiKey: "fixture", settings }]), { fetch: fetcher });
    const descriptor = applyUserImageSizePresets(applyPdogImageCapabilities({ provider: "openai", config: { ...settings, baseUrl: "https://ai.whyshy.cn" } }, { ...base, id: model }));
    expect(quality(descriptor)?.default).toBe("max");
    const request: NormalizedRequest = { connectionId: "pdog", operation: "image.generate", model, prompt: "Vase", idempotencyKey: "offline", parameters: { size: "3840x2160", quality: "max", n: 1 } };
    expect((await adapter.validate(request)).valid).toBe(true);
    await adapter.submit(request);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://ai.whyshy.cn/v1/images/generations/async");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model, size: "3840x2160", quality: "max", n: 1 });
  });

  it("forwards WeAI Image 2.5 max through the selected Images group", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "AQID" }] }));
    const adapter = new WeAIImageAdapter(new StaticConnectionResolver([{ id: "weai", provider: "weai", baseUrl: "https://asian-acc.we-token.cc/v1", apiKey: "fixture",
      settings: { modelGroup: "生图-openai-adobe-image2.5专属", modelCatalogModels: [base] } }]), { fetch: fetcher });
    await adapter.submit({ connectionId: "weai", model: base.id, operation: "image.generate", prompt: "Vase", idempotencyKey: "offline", parameters: { quality: "max", size: "3840x2160", n: 1 } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model: base.id, quality: "max", size: "3840x2160" });
  });

  it.each([["gpt-image-2-4k", "high"], ["gpt-image-2.5-sunburst", "max"]])("forwards explicit %s / %s through Chentu's official group", async (model, quality) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "AQID" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "chentu", provider: "openai", baseUrl: "https://tu.988236.xyz/v1", apiKey: "fixture",
      settings: { supplierKey: "chentu", modelGroup: "image2官key", scannedModelIds: [model] } }]), { fetch: fetcher });
    const request: NormalizedRequest = { connectionId: "chentu", model, operation: "image.generate", prompt: "Vase", idempotencyKey: "offline", parameters: { size: "3840x2160", quality, n: 1 } };
    await adapter.submit(request);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model, quality, size: "3840x2160" });
    await adapter.submit({ ...request, parameters: { ...request.parameters, quality: "standard" } });
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).not.toHaveProperty("quality");
  });

  it.each(["gpt-image-2.5-1k", "gpt-image-2.5-sunburst-1k"])("forwards %s max through Jiasu's native resolution and ratio fields", async model => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "offline-task", task_id: "offline-task", status: "queued" }));
    const config = { baseUrl: "https://ai.jiasuapi.com", modelGroup: "vip", scannedModelIds: [model] };
    const descriptor = applyUserImageSizePresets(applyJiasuImageCapabilities({ provider: "openai", config }, { ...base, id: model }));
    expect(quality(descriptor)?.default).toBe("max");
    const limited = applyUserImageSizePresets(applyJiasuImageCapabilities({ provider: "openai", config: { ...config, scannedModelIds: ["gpt-image-2.5-flare-4k"] } }, { ...base, id: "gpt-image-2.5-flare-4k" }));
    expect(quality(limited)?.default).toBe("medium");
    expect(quality(limited)?.options?.map(option => option.value)).toEqual(["auto", "low", "medium"]);
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "jiasu", provider: "openai", baseUrl: config.baseUrl, apiKey: "fixture", settings: config }]), { fetch: fetcher });
    await adapter.submit({ connectionId: "jiasu", model, operation: "image.generate", prompt: "Vase", idempotencyKey: "offline", parameters: { resolution: "1K", ratio: "16:9", quality: "max", n: 1 } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model, resolution: "1K", ratio: "16:9", quality: "max", n: 1 });
  });

  it.each([
    ["image2.5全参", "gpt-image-2.5-flare", "4K", "3840x2160"],
    ["image2.5全参", "gpt-image-2.5-sunburst", "4K", "3840x2160"],
    ["新渠道image2.5全参", "gpt-image-2.5-flare", "4K", "3840x2160"],
    ["新渠道image2.5全参", "gpt-image-2.5-sunburst", "4K", "3840x2160"],
    ["1k福利生图", "gpt-image-2.5", "1K", "1360x768"],
  ])("maps %s / %s user size and max into the existing Images fields", async (group, model, tier, size) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "AQID" }] }));
    const descriptor: ModelDescriptor = { id: model!, name: model!, operations: ["image.generate", "image.edit"],
      parameters: [{ key: "size", label: "输出尺寸", control: "dimensions", default: "auto", allowCustomValue: true, options: [{ label: "自动", value: "auto" }] },
        { key: "aspect_ratio", label: "比例", control: "text", default: "auto" }],
      metadata: { protocol: "openai-images", imageOpenSizePreferences: true, imageSizeOptionsCompleteEnum: false,
        ...(tier === "1K" ? { imageFixedResolution: "1K", imageSizeContract: "group-1k-only" } : {}) } };
    const settings = { supplierKey: "chentu", modelGroup: group, accountKeyGroup: group, scannedModelIds: [model], modelCatalogModels: [descriptor] };
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "chentu-user", provider: "openai", baseUrl: "https://tu.988236.xyz/v1", apiKey: "fixture", settings }]), { fetch: fetcher });
    const parameters = Object.freeze({ size: "auto", size_tier: tier, aspect_ratio: "16:9", quality: "max", n: 1 });
    const request: NormalizedRequest = { connectionId: "chentu-user", model, operation: "image.generate", prompt: "Vase", idempotencyKey: "offline", parameters };
    expect((await adapter.validate(request)).valid).toBe(true);
    await adapter.submit(request);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ model, size, quality: "max", n: 1 });
    expect(body).not.toHaveProperty("size_tier");
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(parameters.size).toBe("auto");
  });

  it.each([["image2官key", "gpt-image-2-4k"], ["image超分", "gpt-image-2"]])("keeps %s / %s user 4K pixels outside old example tables on the wire", async (group, model) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "AQID" }] }));
    const settings = { supplierKey: "chentu", modelGroup: group, scannedModelIds: [model] };
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "chentu", provider: "openai", baseUrl: "https://tu.988236.xyz/v1", apiKey: "fixture", settings }]), { fetch: fetcher });
    const parameters = Object.freeze({ size: "3200x2560", size_tier: "4K", quality: "high", n: 1 });
    const request: NormalizedRequest = { connectionId: "chentu", model, operation: "image.generate", prompt: "Vase", idempotencyKey: "offline", parameters };
    expect((await adapter.validate(request)).valid).toBe(true);
    await adapter.submit(request);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model, size: "3200x2560", quality: "high", n: 1 });
  });
});
