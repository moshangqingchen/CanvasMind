import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter } from "./openai.js";
import { applySupplierImageConstraints, supplierImageParameterIssues } from "./supplier-image-constraints.js";

const connection = { id: "mikoto-g5", provider: "openai", baseUrl: "https://api.mikoto.vip/v1", apiKey: "isolated-fixture-key",
  settings: { supplierKey: "mikoto", modelGroup: "生图（1k）", accountKeyGroupId: "5" } };
const displayConnection = { provider: connection.provider, config: { baseUrl: connection.baseUrl, ...connection.settings } };
const request = { connectionId: connection.id, operation: "image.generate" as const, prompt: "isolated fixture", idempotencyKey: "mikoto-g5-fixture" };
const models = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];

describe("Mikoto g5 complete 2.5 IDs use open size fields", () => {
  it.each(models)("cleans %s unpublished bounds and makes the actual 1K tier selectable", model => {
    const result = applySupplierImageConstraints(displayConnection, { id: model, name: model, operations: ["image.generate", "image.edit"],
      parameters: [{ key: "size", label: "size", control: "dimensions", min: 256, max: 3840, step: 16 },
        { key: "quality", label: "quality", control: "select", default: "high", options: [{ label: "auto", value: "auto" }, { label: "high", value: "high" }] }] });
    expect(result.parameters?.find(p => p.key === "size")).toMatchObject({ step: 1, allowCustomValue: true });
    expect(result.parameters?.find(p => p.key === "size")?.min).toBeUndefined();
    expect(result.parameters?.find(p => p.key === "size")?.max).toBeUndefined();
    expect(result.parameters?.find(p => p.key === "size_tier")?.options?.map(o => o.value)).toEqual(["1K"]);
    expect(result.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["auto", "high"]);
    expect(result.metadata?.imageResolutionTierParameter).toBe("size_tier");
    expect(result.metadata?.imageSizeOptionsCompleteEnum).toBe(false);
  });
  it.each(models.flatMap(model => ["4097x2051", "3840x1646", "2560x1097"].map(size => ({ model, size }))))(
    "sends $model exact $size without using GPT2 examples as a rejection table", async ({ model, size }) => {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [{ url: "https://example.test/isolated-result.png" }] }));
      const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
      for (const operation of ["image.generate", "image.edit"] as const) {
        const chosen = { ...request, model, operation, parameters: Object.freeze({ size, size_tier: "1K", quality: "high", aspect_ratio: "auto" }),
          ...(operation === "image.edit" ? { assets: [{ id: "fixture", kind: "image" as const, mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }] } : {}) };
        expect((await adapter.validate(chosen)).valid).toBe(true);
        await adapter.submit(chosen);
        const rawBody = fetcher.mock.calls.at(-1)?.[1]?.body;
        const body = rawBody instanceof FormData ? Object.fromEntries(rawBody.entries()) : JSON.parse(String(rawBody));
        expect(body).toMatchObject({ model, size, quality: "high" });
        expect(body).not.toHaveProperty("size_tier");
        expect(body).not.toHaveProperty("aspect_ratio");
        expect(chosen.parameters).toEqual({ size, size_tier: "1K", quality: "high", aspect_ratio: "auto" });
      }
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  it.each(models)("preserves %s auto and blocks an explicit conflicting app ratio before submit", async model => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ url: "https://example.test/isolated-result.png" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([connection]), { fetch: fetcher });
    expect((await adapter.validate({ ...request, model, parameters: { size: "auto", size_tier: "1K", quality: "auto" } })).valid).toBe(true);
    const parameters = Object.freeze({ size: "2051x2049", size_tier: "1K", quality: "high", aspect_ratio: "16:9" });
    expect((await adapter.validate({ ...request, model, parameters })).issues).toContainEqual(expect.objectContaining({ code: "aspect_ratio_size_conflict" }));
    await expect(adapter.submit({ ...request, model, parameters })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(parameters).toEqual({ size: "2051x2049", size_tier: "1K", quality: "high", aspect_ratio: "16:9" });
    expect((await adapter.validate({ ...request, model, parameters: { size: "auto", quality: "high", aspect_ratio: "16:9" } })).issues)
      .toContainEqual(expect.objectContaining({ code: "aspect_ratio_requires_explicit_size" }));
    expect(supplierImageParameterIssues(displayConnection, { ...request, model, parameters: { size: "2051x2049", size_tier: "4K" } }))
      .toContainEqual(expect.objectContaining({ code: "invalid_group_image_size" }));
  });
  it("keeps the GPT2 actual 1K examples and foreign identities separate", () => {
    expect(supplierImageParameterIssues(displayConnection, { ...request, model: "gpt-image-2", parameters: { size: "2560x1440" } }))
      .toContainEqual(expect.objectContaining({ code: "invalid_group_image_size" }));
    const descriptor = { id: models[0]!, name: models[0]!, parameters: [{ key: "size", label: "size", control: "dimensions" as const, min: 256, max: 3840, step: 16 }] };
    for (const source of [
      { ...displayConnection, config: { ...displayConnection.config, baseUrl: "https://other.example/v1" } },
      { ...displayConnection, config: { ...displayConnection.config, modelGroup: "another-group" } },
    ]) expect(applySupplierImageConstraints(source, descriptor)).toBe(descriptor);
  });
});
