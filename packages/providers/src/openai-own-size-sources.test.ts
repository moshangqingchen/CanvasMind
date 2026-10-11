import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter, WeAIImageAdapter } from "./openai.js";

function fixture(supplierKey: string, baseUrl: string, modelGroup: string, model: string) {
  const fetch = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ url: "https://assets.example/original.png" }] }));
  const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "mock", provider: "openai", apiKey: "fixture-key", baseUrl,
    settings: { supplierKey, modelGroup, scannedModelIds: [model] } }]), { fetch });
  const request: NormalizedRequest = { connectionId: "mock", operation: "image.generate", model, prompt: "fixture", idempotencyKey: "mock-no-network" };
  return { adapter, fetch, request };
}

describe("OpenAI-compatible size rules stay within each actual source", () => {
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
