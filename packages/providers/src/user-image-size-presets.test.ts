import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
import type { ModelDescriptor, NormalizedRequest } from "./contracts";
import { applyUserImageSizePresets, resolveUserImageSizeParameters, userImageSizeOptions } from "./image-size-presets";
import { imageSizePreferenceIssues } from "./weai-models";
import { StaticConnectionResolver } from "./credentials";
import { WeAIImageAdapter } from "./openai";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest";
import { applyChuangxiangCurrentImageCapabilities } from "./chuangxiang-image-contract";
import { ChuangxiangImageAdapter } from "./chuangxiang-images-contract";

const model: ModelDescriptor = { id: "gpt-image-2.5-flare", name: "Flare", operations: ["image.generate", "image.edit"],
  parameters: [{ key: "size", label: "尺寸", control: "dimensions", valueType: "string", step: 1, default: "auto",
    options: [{ value: "auto", label: "自动" }], description: "旧说明：未公布像素，请填写 W/H" }],
  metadata: { imageOpenSizePreferences: true, imageSupportedResolutions: [] } };
const request: NormalizedRequest = { connectionId: "user-presets", model: model.id, operation: "image.generate",
  prompt: "A canvas", idempotencyKey: "offline-user-presets", parameters: { size: "auto", size_tier: "4K", aspect_ratio: "3:2", n: 1 } };

describe("user-requested image size presets", () => {
  it("restores the screenshot's 4K pixels and all three tiers without replacing supplier evidence", () => {
    const projected = applyUserImageSizePresets(model);
    const size = projected.parameters![0]!;
    expect(size.options?.filter(option => option.label.startsWith("4K")).map(option => option.value)).toEqual([
      "2880x2880", "3840x2160", "2160x3840", "3312x2480", "2480x3312", "3520x2336", "2336x3520", "3216x2576", "2576x3216", "3840x1648", "1648x3840",
    ]);
    expect(projected.metadata).toMatchObject({ imageSupportedResolutions: [], imageUserSizePresetSource: "user-request", imageUserSizePresetTiers: ["1K", "2K", "4K"] });
    expect(size.description).not.toContain("请填写");
    expect(projected.metadata?.imageUserSizeSourceDescription).toContain("请填写");
    expect(applyUserImageSizePresets(projected)).toEqual(projected);
    expect(model.parameters![0]!.options).toHaveLength(1);
  });

  it("respects an existing supplier tier/ratio map, explicit banned tiers, bounds and complete enums", () => {
    const documented = { ...model, parameters: [{ ...model.parameters![0]!, min: 16, max: 3840, step: 16,
      options: [{ value: "2048x1152", label: "2K · 16:9 · 2048 × 1152" }] }],
      metadata: { imageSupportedResolutions: ["1K"], imageUnsupportedResolutions: ["4K"] } };
    const size = applyUserImageSizePresets(documented).parameters![0]!;
    expect(size.options?.find(option => option.label.startsWith("2K · 16:9"))?.value).toBe("2048x1152");
    expect(size.options?.some(option => option.label.startsWith("4K"))).toBe(false);
    expect(size).toMatchObject({ min: 16, max: 3840, step: 16 });
    const fixed = { ...model, metadata: { imageSizeOptionsCompleteEnum: true } };
    expect(applyUserImageSizePresets(fixed)).toBe(fixed);
    const native = { ...model, parameters: [{ ...model.parameters![0]!, control: "select" as const, options: [{ value: "2K", label: "2K" }] }] };
    expect(applyUserImageSizePresets(native).parameters?.find(parameter => parameter.key === "size")).toBe(native.parameters[0]);
  });

  it("adds dimensions to an open native size field while preserving its original tier values", () => {
    const mixed = { ...model, parameters: [{ ...model.parameters![0]!, control: "select" as const, allowCustomValue: true,
      options: [{ value: "auto", label: "自动" }, ...["1K", "2K", "4K"].map(value => ({ value, label: value }))] }] };
    const projected = applyUserImageSizePresets(mixed);
    expect(projected.parameters![0]!.control).toBe("dimensions");
    expect(projected.parameters![0]!.options?.map(option => option.value)).toEqual(expect.arrayContaining(["1K", "2K", "4K", "2880x2880", "3520x2336"]));
    expect(resolveUserImageSizeParameters(mixed, request.parameters).size).toBe("3520x2336");
    expect(resolveUserImageSizeParameters(mixed, { size: "4K" }).size).toBe("4K");
    expect(resolveUserImageSizeParameters(model, { aspect_ratio: "16:9", tier: "4k" })).toEqual({ aspect_ratio: "16:9", tier: "4k" });
  });

  it("does not treat an old select widget as a supplier's complete pixel enum", () => {
    const old = { ...model, parameters: [{ ...model.parameters![0]!, control: "select" as const,
      options: [{ value: "1024x1024", label: "1K · 1:1 · 1024 × 1024" }] }] };
    const projected = applyUserImageSizePresets(old);
    expect(projected.parameters?.[0]?.control).toBe("dimensions");
    expect(projected.parameters?.[0]?.options?.map(option => option.value)).toContain("3840x2160");
    const closed = { ...old, metadata: { ...old.metadata, imageSizeOptionsCompleteEnum: true } };
    expect(applyUserImageSizePresets(closed).parameters?.[0]).toBe(closed.parameters[0]);
  });

  it.each(["1K", "2K", "4K"] as const)("adds %s pixels to Chuangxiang's explicitly open ratio/size field and sends the chosen pixels", async tier => {
    const config = { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图" };
    const id = `gpt-image-2-${tier.toLowerCase()}`;
    const source = applyChuangxiangCurrentImageCapabilities({ provider: "openai", config }, { id, name: id, operations: ["image.generate"] });
    const projected = applyUserImageSizePresets(source);
    const size = projected.parameters!.find(parameter => parameter.key === "size")!;
    expect(projected.metadata?.imageUserSizePresetTiers).toEqual([tier]);
    expect(size.options?.filter(option => option.label.startsWith(`${tier} ·`))).toHaveLength(11);
    expect(size.options?.map(option => option.value)).toContain("16:9");
    expect(resolveUserImageSizeParameters(projected, { size: "16:9" })).toEqual({ size: "16:9" });
    const parameters = resolveUserImageSizeParameters(projected, { size: "auto", size_tier: tier, aspect_ratio: "5:4", quality: "high" });
    const selected = size.options!.find(option => option.label.startsWith(`${tier} · 5:4 ·`))!;
    expect(parameters.size).toBe(selected.value);
    const fetcher = vi.fn(async () => Response.json({ data: [{ b64_json: "AQID" }] }));
    const adapter = new ChuangxiangImageAdapter(new StaticConnectionResolver([{ id: request.connectionId, provider: "openai", baseUrl: config.baseUrl,
      apiKey: "fixture", settings: config }]), { fetch: fetcher });
    await adapter.submit({ ...request, model: id, parameters });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model: id, size: selected.value, quality: "high" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).not.toHaveProperty("size_tier");
    const nativeRatio = { ...source, parameters: [{ ...source.parameters![0]!, control: "select" as const, allowCustomValue: false }] };
    expect(applyUserImageSizePresets(nativeRatio).metadata?.imageUserSizePresets).toBeUndefined();
  });

  it("resolves selected tier and nominal ratio while preserving explicit pixels and all saved preferences", () => {
    expect(resolveUserImageSizeParameters(model, request.parameters)).toEqual({ ...request.parameters, size: "3520x2336" });
    expect(resolveUserImageSizeParameters(model, { size: "auto", size_tier: "4K" }, "9:16").size).toBe("2160x3840");
    const explicit = { ...request.parameters, size: "2000x1200" };
    expect(resolveUserImageSizeParameters(model, explicit)).toEqual(explicit);
    for (const option of userImageSizeOptions().filter(option => option.value !== "auto"))
      expect(imageSizePreferenceIssues({ size: option.value, aspect_ratio: option.label.split(" · ")[1] })).toEqual([]);
    expect(imageSizePreferenceIssues({ size: "1024x1024", aspect_ratio: "16:9" })).not.toEqual([]);
  });

  it("validates and submits WeAI auto + 4K selection as the same concrete size without extra wire fields", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), { headers: { "content-type": "application/json" } }));
    const adapter = new WeAIImageAdapter(new StaticConnectionResolver([{ id: request.connectionId, provider: "weai", apiKey: "fixture",
      baseUrl: "https://asian-acc.we-token.cc/v1", settings: { modelGroup: "生图-openai-adobe-image2.5专属", modelCatalogModels: [model] } }]), { fetch: fetcher });
    expect(await adapter.validate(request)).toMatchObject({ valid: true });
    await adapter.submit(request);
    expect(fetcher).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.size).toBe("3520x2336");
    expect(body.size_tier).toBeUndefined();
    expect(body.aspect_ratio).toBeUndefined();
    expect(request.parameters?.size).toBe("auto");
  });

  it("maps REST auto + tier into its existing size field", async () => {
    const connector: RestConnectorConfig = { auth: { type: "none" }, models: [model], allowedHosts: ["provider.test"],
      submit: { path: "/generate", method: "POST", bodyMode: "json", mappings: [{ target: "/size", source: { kind: "request", path: "$.parameters.size" } }],
        response: { taskIdPath: "$.id" } }, poll: { path: "/task/{taskId}", method: "GET", bodyMode: "none" },
      output: { path: "$.outputs", kind: "image", urlPath: "$.url" } };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "one" }), { headers: { "content-type": "application/json" } }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: request.connectionId, provider: "rest", baseUrl: "https://provider.test",
      settings: { connector, modelCatalogModels: [model] } }]), { fetch: fetcher });
    await adapter.submit(request);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ size: "3520x2336" });
  });
});
