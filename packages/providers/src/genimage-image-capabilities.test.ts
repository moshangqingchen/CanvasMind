import { describe, expect, it, vi } from "vitest";
import { applyGenimageImageCapabilities } from "./genimage-image-capabilities.js";
import { StaticConnectionResolver } from "./credentials.js";
import { OpenAIImageAdapter } from "./openai.js";

const connection = { provider: "openai", config: { baseUrl: "https://genimage.pro/v1", modelGroup: "default", usage: "canvas" } };
const model = { id: "gpt-image-2.5-flare", name: "Flare", operations: ["image.generate"] as const,
  metadata: { priceLabel: "$0.2/请求" } };

describe("Genimage declared image parameters", () => {
  it.each(["default", "gptResponseBase64", "geminiResponseUrl"])("fills %s presets without manufacturing paid evidence", group => {
    const result = applyGenimageImageCapabilities({ ...connection, config: { ...connection.config, modelGroup: group } }, model);
    expect(result.operations).toEqual(["image.generate"]);
    expect(result.parameters?.find(p => p.key === "size")?.options).toHaveLength(34);
    expect(result.parameters?.find(p => p.key === "size")?.options?.some(o => o.value === "2160x3840")).toBe(true);
    expect(result.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["max"]);
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
