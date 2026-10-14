import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter } from "./openai.js";
import { applySupplierImageConstraints } from "./supplier-image-constraints.js";
import { MIKOTO_GPT_IMAGE_SIZES } from "./mikoto-image-contract.js";

const connection = { id: "mikoto", provider: "openai", baseUrl: "https://api.mikoto.vip/v1", apiKey: "test",
  settings: { supplierKey: "mikoto", modelGroup: "生图（2k4k 高质量）" } };
const request = { connectionId: "mikoto", model: "gpt-image-2", operation: "image.generate" as const,
  prompt: "test", idempotencyKey: "mikoto-doc", parameters: { quality: "high" } };

describe("Mikoto full image detail contract", () => {
  it("uses all eight supplier pixel pairs and the current group quality in cached menus", () => {
    const result = applySupplierImageConstraints({ provider: "openai", config: { baseUrl: connection.baseUrl, ...connection.settings } }, {
      id: "gpt-image-2", name: "gpt-image-2", operations: ["image.generate", "image.edit"],
      parameters: [{ key: "size", label: "size", control: "dimensions", options: [{ label: "2K", value: "2048x2048" }] },
        { key: "quality", label: "quality", control: "select", options: [{ label: "auto", value: "auto" }] }],
    });
    expect(result.parameters?.find(p => p.key === "size")?.options).toEqual(MIKOTO_GPT_IMAGE_SIZES.filter(option => option.value !== "1024x1024"));
    expect(result.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toContain("1440x1440");
    expect(result.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["high"]);
    expect(result.parameters?.find(p => p.key === "response_format")?.options?.map(o => o.value)).toEqual(["url", "b64_json"]);
    expect(result.parameters?.find(p => p.key === "size")).toMatchObject({ step: 1, allowCustomValue: true });
    expect(result.parameters?.find(p => p.key === "size")?.max).toBeUndefined();
    expect(result.parameters?.find(p => p.key === "size")?.min).toBeUndefined();
    const oldRest = applySupplierImageConstraints({ provider: "rest", config: { baseUrl: connection.baseUrl, modelGroup: "生图（2k4k 中质量）" } }, {
      id: "gpt-image-2", name: "gpt-image-2", operations: ["image.generate"],
      parameters: [{ key: "size", label: "size", control: "dimensions", min: 256, max: 3840 },
        { key: "quality", label: "quality", control: "select" }],
    });
    expect(oldRest.parameters?.find(p => p.key === "size")?.min).toBeUndefined();
    expect(oldRest.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["medium"]);
  });
  it.each(["3240x2160", "2160x3240", "3840x1646", "2560x1097", "9:16", "4097x2051", "5:7"])("sends the open size %s and return format unchanged", async size => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: "aGVsbG8=" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
    await adapter.submit({ ...request, parameters: { size, quality: "high", response_format: "b64_json" } });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model: request.model, size, quality: "high", response_format: "b64_json" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("keeps the official 1K group restriction without borrowing GPT Image 2 pixel examples for 2.5", async () => {
    const config = { provider: "openai", config: { baseUrl: connection.baseUrl, modelGroup: "生图（1k）" } };
    const descriptor = { id: "gpt-image-2", name: "gpt-image-2", operations: ["image.generate"] as const,
      parameters: [{ key: "size", label: "size", control: "dimensions" as const }] };
    expect(applySupplierImageConstraints(config, descriptor).parameters?.[0]?.options?.map(o => o.value)).toEqual(["auto", "1024x1024"]);
    const flareSamples = ["auto", "1024x1024", "1360x768", "768x1360", "1184x880", "880x1184", "1248x832", "832x1248", "1136x912", "912x1136", "1552x672", "672x1552"];
    expect(applySupplierImageConstraints(config, { ...descriptor, id: "gpt-image-2.5-flare" }).parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(flareSamples);
    expect(applySupplierImageConstraints(config, { ...descriptor, id: "gpt-image-2.5-sunburst" }).parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(["auto"]);
    const cachedRest = { ...config, provider: "rest" };
    expect(applySupplierImageConstraints(cachedRest, descriptor).parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toContain("3840x2160");
    expect(applySupplierImageConstraints(cachedRest, { ...descriptor, id: "gpt-image-2.5-flare" }).parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toContain("3840x2160");
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ ...connection, settings: { supplierKey: "mikoto", modelGroup: "生图（1k）" } }]));
    expect((await adapter.validate({ ...request, parameters: { size: "2560x1440" } })).issues).toContainEqual(expect.objectContaining({ code: "invalid_group_image_size" }));
  });
  it("restricts both 2.5 complete IDs only in the medium group while preserving the high group's open quality", async () => {
    const descriptor = { id: "gpt-image-2.5-flare", name: "gpt-image-2.5-flare", operations: ["image.generate"] as const };
    const medium = { provider: "openai", config: { baseUrl: connection.baseUrl, modelGroup: "生图（2k4k 中质量）" } };
    const high = { ...medium, config: { ...medium.config, modelGroup: "生图（2k4k 高质量）" } };
    expect(applySupplierImageConstraints(medium, descriptor).parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["medium"]);
    expect(applySupplierImageConstraints(high, descriptor).parameters?.find(p => p.key === "quality")).toMatchObject({ control: "text", valueType: "string" });
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ ...connection, settings: { supplierKey: "mikoto", modelGroup: "生图（2k4k 中质量）" } }]));
    for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])
      expect((await adapter.validate({ ...request, model, parameters: { quality: "high" } })).issues).toContainEqual(expect.objectContaining({ code: "invalid_quality" }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ url: "https://example.test/result.png" }] }));
    await new OpenAIImageAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher }).submit({ ...request,
      model: descriptor.id, parameters: { quality: "supplier-custom-quality" } });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ quality: "supplier-custom-quality" });
  });
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("preserves max and exact user size on the current high group's %s request", async model => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ url: "https://example.test/result.png" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
    const chosen = { ...request, model, parameters: { quality: "max", size: "2880x2880", size_tier: "4K" } };
    expect((await adapter.validate(chosen)).valid).toBe(true);
    await adapter.submit(chosen);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model, quality: "max", size: "2880x2880" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("requires explicit W/H when a %s tier has no supplier pixel mapping", async model => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
    for (const parameters of [{ size_tier: "2K", quality: "max" }, { size_tier: "4K", size: "4K", quality: "max" }])
      expect((await adapter.validate({ ...request, model, parameters })).issues).toContainEqual(expect.objectContaining({ code: "missing_image_dimensions" }));
    expect((await adapter.validate({ ...request, model, parameters: { size_tier: "1K", size: "1024x1024", quality: "max" } })).issues)
      .toContainEqual(expect.objectContaining({ code: "invalid_group_image_size" }));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("expresses %s ratio preferences through exact W/H and blocks conflicts without rewriting", async model => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ url: "https://example.test/result.png" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
    const parameters = Object.freeze({ size_tier: "4K", size: "2051x2049", aspect_ratio: "16:9", quality: "max" });
    const conflict = { ...request, model, parameters };
    expect((await adapter.validate(conflict)).issues).toContainEqual(expect.objectContaining({ code: "aspect_ratio_size_conflict" }));
    await expect(adapter.submit(conflict)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(parameters).toEqual({ size_tier: "4K", size: "2051x2049", aspect_ratio: "16:9", quality: "max" });
    expect((await adapter.validate({ ...request, model, parameters: { size: "3840x2160", ratio: "16:9", aspect_ratio: "1:1", quality: "max" } })).issues)
      .toContainEqual(expect.objectContaining({ code: "parameter_alias_conflict" }));
    await adapter.submit({ ...request, model, parameters: { ...parameters, aspect_ratio: "1:1" } });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ model, size: "2051x2049", quality: "max" });
    expect(body).not.toHaveProperty("size_tier");
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("keeps public edit URLs in order using the documented JSON images objects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ url: "https://example.test/result.png" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
    await adapter.submit({ ...request, operation: "image.edit", parameters: { size: "2560x1440", quality: "high", response_format: "url" },
      assets: ["front", "back"].map(id => ({ id, kind: "image", mimeType: "image/png", url: `https://example.test/${id}.png` })) });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.mikoto.vip/v1/images/edits");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ images: [
      { image_url: "https://example.test/front.png" }, { image_url: "https://example.test/back.png" }], response_format: "url", size: "2560x1440" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects unsupported return formats before submission and keeps foreign routes scoped", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
    expect((await adapter.validate({ ...request, parameters: { response_format: "png" } })).issues).toContainEqual(expect.objectContaining({ code: "invalid_response_format" }));
    expect(fetcher).not.toHaveBeenCalled();
    const other = new OpenAIImageAdapter(new StaticConnectionResolver([{ ...connection, baseUrl: "https://api.openai.com/v1", settings: {} }]), { fetch: fetcher });
    expect((await other.validate({ ...request, parameters: { size: "3240x2160" } })).valid).toBe(false);
  });
});
