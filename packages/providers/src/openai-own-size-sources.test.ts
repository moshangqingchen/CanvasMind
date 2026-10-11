import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
import type { FetchImplementation, ModelDescriptor, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter, WeAIImageAdapter } from "./openai.js";
import { applySupplierImageConstraints } from "./supplier-image-constraints.js";

function fixture(supplierKey: string, baseUrl: string, modelGroup: string, model: string, modelCatalogModels?: ModelDescriptor[]) {
  const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/original.png" }] }));
  const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "mock", provider: "openai", apiKey: "fixture-key", baseUrl,
    settings: { supplierKey, modelGroup, scannedModelIds: [model], ...(modelCatalogModels ? { modelCatalogModels } : {}) } }]), { fetch });
  const request: NormalizedRequest = { connectionId: "mock", operation: "image.generate", model, prompt: "fixture", idempotencyKey: "mock-no-network" };
  return { adapter, fetch, request };
}

describe("OpenAI-compatible size rules stay within each actual source", () => {
  it.each(["codex_image", "gpt_image_web"].flatMap(group => ["gpt-image-2-w", "gpt-image-2.5"].map(model => [group, model])))
    ("sends selected 1K pixels and custom W/H for Fri %s / %s while rejecting higher tiers before fetch", async (group, model) => {
      const f = fixture("frimodel", "https://platform.frimodel.com/v1", group!, model!, [
        { id: model!, name: model!, operations: ["image.generate", "image.edit"], parameters: [{ key: "size", label: "旧尺寸", control: "dimensions" }] },
      ]);
      const quality = model === "gpt-image-2.5" ? "max" : "high";
      for (const size of ["1360x768", "2497x3313", "8193x2305"]) {
        const parameters = { size, size_tier: "1K", quality }, before = structuredClone(parameters);
        await f.adapter.submit({ ...f.request, parameters });
        const body = JSON.parse(String(f.fetch.mock.calls.at(-1)![1]?.body));
        expect(body).toMatchObject({ model, size, quality });
        for (const key of ["size_tier", "image_size", "resolution", "aspect_ratio"]) expect(body).not.toHaveProperty(key);
        expect(parameters).toEqual(before);
      }
      await f.adapter.submit({ ...f.request, parameters: { size: "auto", size_tier: "1K", aspect_ratio: "16:9", quality } });
      expect(JSON.parse(String(f.fetch.mock.calls.at(-1)![1]?.body))).toMatchObject({ size: "1920x1088", quality });
      expect(f.fetch).toHaveBeenCalledTimes(4);
      for (const parameters of [{ size: "3840x2160" }, { size: "2048x2048" }, { size: "1024x1024", size_tier: "2K" },
        { size: "auto", size_tier: "4K", aspect_ratio: "16:9" }, { size: "1024x1024", resolution: "4K" }, { size: "1024x1024", image_size: "2K" }]) {
        await expect(f.adapter.submit({ ...f.request, parameters })).rejects.toThrow(/1K/u);
      }
      expect(f.fetch).toHaveBeenCalledTimes(4);
      if (model === "gpt-image-2-w") {
        await f.adapter.submit({ ...f.request, operation: "image.edit", parameters: { size: "1360x768", size_tier: "1K", quality },
          assets: [{ id: "fixture-image", kind: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }] });
        const form = f.fetch.mock.calls.at(-1)![1]?.body as FormData;
        expect(form.get("size")).toBe("1360x768"); expect(form.get("quality")).toBe(quality);
        expect(form.has("size_tier")).toBe(false);
      }
      const source = { provider: "openai", config: { baseUrl: "https://platform.frimodel.com/v1", modelGroup: group } };
      const examples = applySupplierImageConstraints(source, { id: model!, name: model!, operations: ["image.generate"] })
        .parameters!.find(parameter => parameter.key === "size")!.options!.filter(option => option.value !== "auto");
      expect(examples).toHaveLength(11);
      for (const example of examples) {
        await f.adapter.submit({ ...f.request, parameters: { size: example.value, size_tier: "1K", aspect_ratio: example.label.split(" · ")[1], quality } });
        const body = JSON.parse(String(f.fetch.mock.calls.at(-1)![1]?.body));
        expect(body).toMatchObject({ size: example.value, quality });
        expect(body).not.toHaveProperty("aspect_ratio");
      }
      const beforeConflict = f.fetch.mock.calls.length;
      await expect(f.adapter.submit({ ...f.request, parameters: { size: "1920x1088", aspect_ratio: "1:1" } })).rejects.toThrow(/不一致/u);
      expect(f.fetch).toHaveBeenCalledTimes(beforeConflict);
    });
  it.each(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("preserves CODEX %s's actual quality and size on generation and edit wires", async model => {
    const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const adapter = new WeAIImageAdapter(new StaticConnectionResolver([{ id: "codex", provider: "weai", apiKey: "fixture-key",
      baseUrl: "https://asian-acc.we-token.cc/v1", settings: { accountKeyGroupId: "6", modelGroup: "生图-openai-codex-token计费", scannedModelIds: [model] } }]), { fetch });
    const parameters = { n: 1, size: model === "gpt-image-2" ? "1024x1024" : "2497x3313", quality: model === "gpt-image-2" ? "high" : "supplier-quality-original" };
    const before = structuredClone(parameters), request: NormalizedRequest = { connectionId: "codex", operation: "image.generate", model,
      prompt: "mock-only", idempotencyKey: "source-only", parameters };
    await adapter.submit(request);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ ...parameters, model });
    const reference = { id: "fixture-image", kind: "image" as const, mimeType: "image/png", data: new Uint8Array([1, 2, 3]) };
    await adapter.submit({ ...request, operation: "image.edit", assets: [reference] });
    const form = fetch.mock.calls[1]![1]?.body as FormData;
    expect(form.get("size")).toBe(parameters.size); expect(form.get("quality")).toBe(parameters.quality);
    expect(parameters).toEqual(before);
    await expect(adapter.submit({ ...request, operation: "image.edit", assets: [reference, { ...reference, id: "fixture-mask", role: "mask" }] })).rejects.toThrow(/蒙版/u);
    expect(fetch).toHaveBeenCalledTimes(2);
    await adapter.submit({ ...request, parameters: { ...parameters, size: "auto", size_tier: "4K", aspect_ratio: "16:9" } });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetch.mock.calls[2]![1]?.body))).toMatchObject({ size: "3840x2160", quality: parameters.quality });
  });
  it("maps all eight additional Fri own-table entries by exact tier AND ratio", async () => {
    for (const [tier, ratio, size] of [
      ["2K", "1:2", "1024x2048"], ["2K", "2:1", "2048x1024"], ["2K", "1:3", "672x2016"], ["2K", "3:1", "2016x672"],
      ["4K", "1:2", "1920x3840"], ["4K", "2:1", "3840x1920"], ["4K", "1:3", "1280x3840"], ["4K", "3:1", "3840x1280"],
    ]) {
      const f = fixture("frimodel", "https://api.frimodel.com/v1", "gpt", "gpt-image-2");
      const parameters = { size: "auto", size_tier: tier, aspect_ratio: ratio, quality: "high" }, before = structuredClone(parameters);
      await f.adapter.submit({ ...f.request, parameters });
      expect(parameters).toEqual(before);
      expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ size, quality: "high" });
      expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).not.toHaveProperty("aspect_ratio");
    }
  });

  it("requires explicit W/H for a missing own-table combination instead of picking square", async () => {
    const f = fixture("frimodel", "https://api.frimodel.com/v1", "gpt", "gpt-image-2");
    await expect(f.adapter.submit({ ...f.request, parameters: { size: "auto", size_tier: "1K", ratio: "1:2" } })).rejects.toThrow(/W\/H/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("honors the own table's rounded nominal ratio while preserving raw pixels", async () => {
    const f = fixture("frimodel", "https://api.frimodel.com/v1", "gpt", "gpt-image-2");
    await f.adapter.submit({ ...f.request, parameters: { size: "1920x1088", aspect_ratio: "16:9" } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ size: "1920x1088" });
    await expect(f.adapter.submit({ ...f.request, parameters: { size: "1024x1024", ratio: "16:9" } })).rejects.toThrow(/不一致/u);
    await expect(f.adapter.submit({ ...f.request, parameters: { size: "1024x2048", size_tier: "1K", ratio: "1:2" } })).rejects.toThrow(/另一档位/u);
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each(["低价Adobe生图", "兜底原生生图", "image2.5全参"])("preserves Chentu free Images strings in %s without deriving sibling pixels", async group => {
    const f = fixture("chentu", "https://tu.988236.xyz/v1", group, "gpt-image-2自由传参");
    await f.adapter.submit({ ...f.request, parameters: { size: "8193x2305", quality: "high" } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ size: "8193x2305" });
    await expect(f.adapter.submit({ ...f.request, parameters: { size: "auto", size_tier: "4K", ratio: "16:9" } })).rejects.toThrow(/W\/H/u);
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it.each(["gpt-image-2-adobe", "gpt-image-2-az", "gpt-image-2-w", "gpt-image-2-wc", "gpt-image-2-o", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])(
    "keeps Fri %s open input sizes separate from the GPT2 own pixel table", async model => {
      const f = fixture("frimodel", "https://api.frimodel.com/v1", "gpt", model);
      await f.adapter.submit({ ...f.request, parameters: { size: "4097x2101", quality: "high" } });
      expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ size: "4097x2101", quality: "high" });
      await expect(f.adapter.submit({ ...f.request, parameters: { size: "auto", size_tier: "4K", aspect_ratio: "16:9" } })).rejects.toThrow(/W\/H/u);
      expect(f.fetch).toHaveBeenCalledOnce();
    });

  it.each(["grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-image-2.0福利"])(
    "preserves Chentu %s application tiers while requiring the actual unavailable schema before mapping", async model => {
      const f = fixture("chentu", "https://tu.988236.xyz/v1", "grok生图", model);
      for (const params of [{ size_tier: "1K" }, { size: "1024x1024" }, { ratio: "16:9" }]) {
        const copy = structuredClone(params);
        await expect(f.adapter.submit({ ...f.request, parameters: params })).rejects.toThrow(/\/v1\/images\/models.*404/u);
        expect(params).toEqual(copy);
      }
      expect(f.fetch).not.toHaveBeenCalled();
    });
});
