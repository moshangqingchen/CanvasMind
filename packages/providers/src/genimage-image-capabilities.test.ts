import { describe, expect, it, vi } from "vitest";
import { applyGenimageImageCapabilities } from "./genimage-image-capabilities.js";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter } from "./openai.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import type { ModelDescriptor, NormalizedRequest, RestConnectorConfig } from "./index.js";

const connection = { provider: "openai", config: { baseUrl: "https://genimage.pro/v1", modelGroup: "default", usage: "canvas" } };
const model = { id: "gpt-image-2.5-flare", name: "Flare", operations: ["image.generate"] as const,
  metadata: { priceLabel: "$0.2/请求" } };

describe("Genimage declared image parameters", () => {
  it.each(["default", "gptResponseBase64", "geminiResponseUrl"])("fills %s presets without manufacturing paid evidence", group => {
    const result = applyGenimageImageCapabilities({ ...connection, config: { ...connection.config, modelGroup: group } }, model);
    expect(result.operations).toEqual(["image.generate"]);
    expect(result.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(result.parameters?.find(p => p.key === "size")).toMatchObject({ allowCustomValue: true });
    for (const key of ["min", "max", "step"]) expect(result.parameters?.find(p => p.key === "size")).not.toHaveProperty(key);
    expect(result.parameters?.find(p => p.key === "n")?.max).toBeUndefined();
    expect(result.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["auto", "max"]);
    expect(result.parameters?.find(p => p.key === "quality")).toMatchObject({ control: "text", allowCustomValue: true });
    expect(result.metadata).toMatchObject({ imagePixelBudgetPublished: false, imageApplicationQualityDefault: "max", imageSupplierQualityDefault: null });
    expect(result.metadata?.imageTestedQualities).toBeUndefined();
    expect(result.metadata?.imageCapabilitiesVerifiedAt).toBeUndefined();
    expect(result.metadata?.priceLabel).toBe("$0.2/请求");
  });

  it.each([
    { baseUrl: "https://other.example/v1" }, { baseUrl: "https://genimage.pro.evil.example/v1" },
    { baseUrl: "https://genimage.pro/custom" }, { baseUrl: "https://genimage.pro/v1?route=other" },
    { usage: "agent" }, { usage: "disabled" }, { supplierArchived: true },
    { modelGroup: "image2.5_0.2分组" }, { accountKeyGroup: "geminiResponseUrl" },
  ])("keeps unrelated or mismatched connections intact: %o", patch => {
    expect(applyGenimageImageCapabilities({ ...connection, config: { ...connection.config, ...patch } }, model)).toBe(model);
  });

  it("preserves denied models, Gemini and explicit provider protocols", () => {
    const denied = { ...model, metadata: { canvasRunnable: false } };
    expect(applyGenimageImageCapabilities(connection, denied)).toBe(denied);
    const gemini = { ...model, id: "gemini-3-pro-image-preview" };
    expect(applyGenimageImageCapabilities(connection, gemini)).toBe(gemini);
    expect(applyGenimageImageCapabilities({ ...connection, provider: "rest" }, model)).toBe(model);
  });

  it("keeps GPT Image 2 opaque and high", () => {
    const result = applyGenimageImageCapabilities(connection, { ...model, id: "gpt-image-2" });
    expect(result.parameters?.find(p => p.key === "quality")?.default).toBe("high");
    expect(result.parameters?.find(p => p.key === "background")?.options?.map(o => o.value)).toEqual(["auto", "opaque"]);
  });

  it("scopes the recovered September max original to its historical exact group/model", () => {
    const historical = applyGenimageImageCapabilities({ ...connection, config: { ...connection.config, modelGroup: "geminiResponseUrl" } }, { ...model, id: "gpt-image-2.5-sunburst" });
    expect(historical.metadata?.imageHistoricalRequestSamples).toEqual([expect.objectContaining({ checkedAt: "2026-09-22", group: "geminiResponseUrl",
      currentKeyEntitlement: false, output: expect.objectContaining({ width: 2496, height: 3312, sha256: "05aabb3fcbe4cb87273a2e1d6088866faaeb369e02d3ebf3b39815de67acaf8b" }) })]);
    expect(applyGenimageImageCapabilities(connection, { ...model, id: "gpt-image-2.5-sunburst" }).metadata?.imageHistoricalRequestSamples).toBeUndefined();
    expect(historical.metadata?.imageOutputDimensions).toBeUndefined();
  });

  it("drops inherited unproven pixel presets while keeping historical request evidence", () => {
    const historical = [{ source: "exact-success", group: "default", model: model.id, checkedAt: "2026-09-22" }];
    const result = applyGenimageImageCapabilities(connection, { ...model, metadata: { ...model.metadata,
      imageOutputDimensions: [{ resolution: "4K", aspectRatio: "1:1", width: 4096, height: 4096 }],
      imageOutputReferenceDimensions: [{ width: 3840, height: 2160 }], imageResolutionProfiles: [{ tier: "4K" }],
      imageCustomDimensionRules: { alignment: 16, maximumEdge: 3840 }, imageHistoricalRequestSamples: historical } });
    for (const key of ["imageOutputDimensions", "imageOutputReferenceDimensions", "imageResolutionProfiles", "imageCustomDimensionRules"])
      expect(result.metadata).not.toHaveProperty(key);
    expect(result.metadata?.imageHistoricalRequestSamples).toEqual(historical);
  });

  it.each(["1K", "2K", "4K", "2496x3312", "4097x2049"])("sends the declared tier or saved open size %s without guessed pixels or clamping", async size => {
    const parameters = { size, quality: "max", n: 1, response_format: "b64_json" };
    const before = structuredClone(parameters);
    const fetcher = vi.fn(async () => Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "genimage", provider: "openai", apiKey: "offline-key", baseUrl: connection.config.baseUrl, settings: connection.config }]), { fetch: fetcher });
    const request = { connectionId: "genimage", operation: "image.generate" as const, model: model.id, prompt: "Test", idempotencyKey: "offline-open-size", parameters };
    expect(await adapter.validate(request)).toEqual({ valid: true, issues: [] });
    expect(await adapter.validate({ ...request, model: "gpt-image-2" })).toEqual({ valid: true, issues: [] });
    await adapter.submit(request);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ model: model.id, ...parameters });
    expect(parameters).toEqual(before);
  });

  it("omits automatic quality/size without inferred ratio pixels and preserves documented URL return", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ url: "https://genimage.pro/results/offline.png" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "genimage", provider: "openai", apiKey: "offline-key", baseUrl: connection.config.baseUrl, settings: connection.config }]), { fetch: fetcher });
    const request = { connectionId: "genimage", operation: "image.generate" as const, model: "gpt-image-2", prompt: "Test", idempotencyKey: "offline-auto",
      parameters: { size: "auto", quality: "auto", aspect_ratio: "auto", n: 11, response_format: "url" } };
    expect((await adapter.validate(request)).valid).toBe(true);
    await adapter.submit(request);
    const body = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ n: 11, response_format: "url" });
    for (const key of ["size", "quality", "aspect_ratio"]) expect(body).not.toHaveProperty(key);
    for (const n of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect((await adapter.validate({ ...request, parameters: { ...request.parameters, n } })).issues).toContainEqual(expect.objectContaining({ path: "parameters.n" }));
    const other = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "genimage", provider: "openai", apiKey: "offline-key", baseUrl: "https://other.example/v1", settings: connection.config }]), { fetch: fetcher });
    expect((await other.validate({ ...request, parameters: { size: "4K", quality: "max", n: 11 } })).valid).toBe(false);
  });

  it.each(["aspect_ratio", "aspectRatio", "ratio"])("retains %s and blocks unmapped tiers through automatic selection before any POST", async key => {
    const id = "gpt-image-2.5-sunburst", current = applyGenimageImageCapabilities(connection, { id, name: id, operations: ["image.generate"] });
    const resolver = new StaticConnectionResolver([{ id: "genimage", provider: "openai", apiKey: "offline-key", baseUrl: connection.config.baseUrl,
      settings: { ...connection.config, modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [current] } }]);
    const fetcher = vi.fn(async () => Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const adapter = new AutoInterfaceAdapter(resolver, new OpenAIImageAdapter(resolver, { fetch: fetcher }), { fetch: fetcher });
    const request: NormalizedRequest = { connectionId: "genimage", operation: "image.generate", model: id, prompt: "Test",
      parameters: { size: "4K", quality: "max", [key]: "16:9" } };
    const saved = structuredClone(request.parameters);
    expect((await adapter.validate(request)).issues).toContainEqual(expect.objectContaining({ path: "parameters.size", code: "aspect_ratio_requires_explicit_size" }));
    await expect(adapter.submit(request)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(request.parameters).toEqual(saved);
    const pixels = { ...request, parameters: { ...request.parameters, size: "4096x2304" } };
    expect((await adapter.validate(pixels)).valid).toBe(true);
    await adapter.submit(pixels);
    const wire = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(wire).toMatchObject({ size: "4096x2304", quality: "max" });
    for (const alias of ["aspect_ratio", "aspectRatio", "ratio"]) expect(wire).not.toHaveProperty(alias);
    expect(pixels.parameters).toMatchObject({ [key]: "16:9", size: "4096x2304" });
    expect((await adapter.validate({ ...pixels, parameters: { size: "1024x1024", [key]: "16:9" } })).issues)
      .toContainEqual(expect.objectContaining({ code: "aspect_ratio_size_conflict" }));
    // Tiny reference/rounded differences are a preference comparison, not a supplier size constraint.
    expect((await adapter.validate({ ...pixels, parameters: { size: "2496x3312", [key]: "3:4" } })).valid).toBe(true);
  });

  it("reports conflicting saved ratio aliases and leaves other origins on their existing ratio mapping", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const resolver = new StaticConnectionResolver([{ id: "genimage", provider: "openai", apiKey: "offline-key", baseUrl: connection.config.baseUrl, settings: connection.config }]);
    const adapter = new OpenAIImageAdapter(resolver, { fetch: fetcher });
    const request: NormalizedRequest = { connectionId: "genimage", operation: "image.generate", model: model.id, prompt: "Test",
      parameters: { size: "4096x2304", aspect_ratio: "16:9", ratio: "1:1" } };
    expect((await adapter.validate(request)).issues).toContainEqual(expect.objectContaining({ code: "parameter_alias_conflict" }));
    expect((await adapter.validate({ ...request, parameters: { size: "4096x2304", aspect_ratio: "16:9", ratio: "32:18" } })).valid).toBe(true);
    const otherResolver = new StaticConnectionResolver([{ id: "other", provider: "openai", apiKey: "offline-key", baseUrl: "https://other.example/v1" }]);
    const other = new OpenAIImageAdapter(otherResolver, { fetch: fetcher });
    const result = await other.validate({ ...request, connectionId: "other", model: "gpt-image-1", parameters: { aspect_ratio: "16:9" } });
    expect(result.valid).toBe(true);
    expect(result.issues.some(issue => /aspect_ratio_requires_explicit_size|aspect_ratio_size_conflict/u.test(issue.code))).toBe(false);
  });

  it.each(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("preserves %s wire fields through automatic interface selection and recovery", async id => {
    const current = applyGenimageImageCapabilities(connection, { id, name: id, operations: ["image.generate", "image.edit"] });
    const legacy: RestConnectorConfig = { submit: { path: "/stale/images", method: "POST", bodyMode: "json", mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } } ] },
      output: { kind: "image", path: "$.data", urlPath: "url" }, models: [current] };
    const source = { id: "genimage", provider: "openai", apiKey: "offline-key", baseUrl: connection.config.baseUrl,
      settings: { ...connection.config, modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [current],
        autoModelInterfaces: { [id]: { model: current, connector: legacy } } } };
    const before = structuredClone(source);
    const fetcher = vi.fn(async () => Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const resolver = new StaticConnectionResolver([source]);
    const adapter = new AutoInterfaceAdapter(resolver, new OpenAIImageAdapter(resolver, { fetch: fetcher }), { fetch: fetcher });
    for (const size of ["1K", "2K", "4K", "2496x3312"]) {
      const request: NormalizedRequest = { connectionId: source.id, operation: "image.generate", model: id, prompt: "Test", idempotencyKey: `offline-${size}`,
        parameters: { size, quality: "max", n: 1, response_format: "b64_json" } };
      expect((await adapter.validate(request)).valid).toBe(true);
      const task = await adapter.submit(request);
      const [url, init] = fetcher.mock.calls.at(-1) as unknown as [string, RequestInit];
      expect(url).toBe("https://genimage.pro/v1/images/generations");
      expect(JSON.parse(String(init.body))).toMatchObject({ model: id, ...request.parameters });
      expect(task.result).toMatchObject({ autoInterfaceTransport: "genimage-native-images" });
      const calls = fetcher.mock.calls.length;
      expect((await adapter.poll(task)).status).toBe("succeeded");
      expect(await adapter.extractOutputs(task.result)).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(calls);
    }
    source.settings.scannedModelIds = [];
    expect((await adapter.validate({ connectionId: source.id, operation: "image.generate", model: id, prompt: "Test", parameters: { size: "4K" } })).valid).toBe(false);
    source.settings.scannedModelIds = [id];
    expect(source).toEqual(before);
  });

  it("preserves an explicitly saved manual Genimage interface", async () => {
    const id = "gpt-image-2", current: ModelDescriptor = { id, name: id, operations: ["image.generate"], metadata: { source: "manual" } };
    const connector: RestConnectorConfig = { submit: { path: "/custom/images", method: "POST", bodyMode: "json", mappings: [
      { target: "/size", source: { kind: "request", path: "$.parameters.size" } } ] }, output: { kind: "image", path: "$.data", urlPath: "url" }, models: [current] };
    const resolver = new StaticConnectionResolver([{ id: "genimage", provider: "openai", apiKey: "offline-key", baseUrl: connection.config.baseUrl,
      settings: { ...connection.config, modelCatalogModels: [current], autoModelInterfaces: { [id]: { model: current, connector } } } }]);
    const fetcher = vi.fn(async () => Response.json({ data: [{ url: "https://genimage.pro/manual.png" }] }));
    const adapter = new AutoInterfaceAdapter(resolver, new OpenAIImageAdapter(resolver, { fetch: fetcher }), { fetch: fetcher });
    await adapter.submit({ connectionId: "genimage", operation: "image.generate", model: id, prompt: "Test", parameters: { size: "4K" } });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://genimage.pro/custom/images");
  });

  it("sends 2.5 max and declared transparency through Images while retaining GPT Image 2 limits", async () => {
    const request = { connectionId: "genimage", operation: "image.generate" as const, model: model.id,
      prompt: "Test", idempotencyKey: "genimage-offline-test", parameters: { size: "3840x2160", quality: "max", background: "transparent", n: 1 } };
    const fetcher = vi.fn(async () => Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{
      id: "genimage", provider: "openai", apiKey: "offline-key", baseUrl: connection.config.baseUrl, settings: connection.config,
    }]), { fetch: fetcher });
    await adapter.submit(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://genimage.pro/v1/images/generations");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: model.id, ...request.parameters });
    expect((await adapter.validate({ ...request, model: "gpt-image-2" })).valid).toBe(false);
  });
});
