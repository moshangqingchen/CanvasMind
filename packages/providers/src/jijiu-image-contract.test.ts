import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import { applyJijiuImageCapabilities, JIJIU_IMAGE_IDS, jijiuGptImageRequestIssues } from "./jijiu-image-contract.js";
import { OpenAIImageAdapter } from "./openai.js";
import { StaticConnectionResolver } from "./credentials.js";
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";
const baseUrl = "https://newapi.jijiucanvas.com/v1";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
const groupFor = (id: string) => id.startsWith("gemini") ? "图片-香蕉Pro1K/2K/4K" : id.includes("2K/4K") ? "图片-GPT-image-2-2K/4K" : "图片-GPT-image-2/2.5-1K";
const configFor = (id: string) => ({ baseUrl, modelGroup: groupFor(id), accountKeyGroup: groupFor(id), scannedModelIds: [id], usage: "canvas" });
const request = (model: string): NormalizedRequest => ({ connectionId: "jijiu", operation: "image.generate", model, prompt: "A cup", idempotencyKey: "offline" });
function fixture(model: string, implementation?: FetchImplementation) {
  const fetch = vi.fn<FetchImplementation>(implementation ?? (async () => Response.json(model.startsWith("gemini")
    ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }
    : { data: [{ b64_json: png }] })));
  const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "jijiu", provider: "openai", apiKey: "fixture-only", baseUrl, settings: configFor(model) }]), { fetch });
  return { adapter, fetch };
}
describe("Jijiu exact image contract", () => {
  it.each(JIJIU_IMAGE_IDS)("keeps %s supplier controls and unknown pixel/quality rules", id => {
    const descriptor = applyJijiuImageCapabilities({ provider: "openai", config: configFor(id) }, { id, name: id, operations: ["image.generate"] });
    expect(descriptor.metadata).toMatchObject({ jijiuImageContract: true, imageNativeParameterContract: true, imagePixelBudgetPublished: false, imageOutputEncodingDeclared: false });
    expect(descriptor.parameters?.some(p => ["quality", "output_format", "width", "height"].includes(p.key))).toBe(false);
    expect(descriptor.limits?.maxInputImages).toBeUndefined();
    expect(descriptor.parameters?.[0]?.default).toBe("auto");
  });
  it.each(["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-sunburst", "gpt-image-2-2K/4K"])("submits exact %s once, omitting provider defaults and preserving PNG bytes", async id => {
    const f = fixture(id), task = await f.adapter.submit({ ...request(id), parameters: { size: "auto", n: 1 } });
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(f.fetch.mock.calls[0]![0]).toBe(`${baseUrl}/images/generations`);
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model: id, prompt: "A cup", n: 1 });
    expect((await f.adapter.extractOutputs(task.result))[0]).toMatchObject({ kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) });
  });
  it("sends reference URLs through JSON edits without uploading or converting images", async () => {
    const id = "gpt-image-2", f = fixture(id);
    await f.adapter.submit({ ...request(id), operation: "image.edit", assets: [{ id: "ref", kind: "image", mimeType: "image/png", url: "https://assets.example/original.png" }] });
    expect(f.fetch).toHaveBeenCalledOnce();
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(url).toBe(`${baseUrl}/images/edits`);
    expect(JSON.parse(String(init?.body))).toEqual({ model: id, prompt: "A cup", n: 1, image: ["https://assets.example/original.png"] });
  });
  it.each(["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-nano-banana-2.1"])("uses native bearer route for %s with literal supported tier", async id => {
    const f = fixture(id); const task = await f.adapter.submit({ ...request(id), parameters: { image_size: "2K", aspect_ratio: "auto", n: 1 } });
    expect(f.fetch).toHaveBeenCalledOnce();
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(url).toBe(`https://newapi.jijiucanvas.com/v1beta/models/${id}:generateContent`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-only");
    expect(JSON.parse(String(init?.body)).generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { imageSize: "2K" } });
    expect((await f.adapter.extractOutputs(task.result))[0]?.mimeType).toBe("image/png");
  });
  it("blocks unverified saved GPT size/quality and native unsupported or conflicting aliases before HTTP", async () => {
    for (const [id, parameters] of [["gpt-image-2", { size: "4096x4096" }], ["gpt-image-2", { quality: "max" }],
      ["gemini-3-pro-image", { quality: "max" }], ["gemini-3-pro-image", { image_size: "2K", resolution: "4K" }],
      ["gemini-3-pro-image", { ratio: "16:9" }], ["gemini-3-pro-image", { aspect_ratio: "auto", aspectRatio: "16:9" }]] as const) {
      const f = fixture(id); await expect(f.adapter.submit({ ...request(id), parameters })).rejects.toThrow(); expect(f.fetch).not.toHaveBeenCalled();
    }
  });
  it("preserves explicit denial/manual interface and rejects wrong group", () => {
    const id = "gpt-image-2", config = configFor(id);
    for (const metadata of [{ canvasRunnable: false, canvasUnavailableReason: "403 forbidden" }, { source: "manual" }]) {
      const model = { id, name: id, operations: ["image.generate"] as const, metadata };
      expect(applyJijiuImageCapabilities({ provider: "openai", config }, { ...model, operations: [...model.operations] }).metadata).toEqual(metadata);
    }
    expect(jijiuGptImageRequestIssues({ provider: "openai", config: { ...config, modelGroup: "different" } }, request(id))).toContainEqual(expect.objectContaining({ code: "model_group_mismatch" }));
  });
  it.each(["gpt-image-2", "gemini-3-pro-image"])("does not retry or claim successful image when %s returns text/empty data", async id => {
    const f = fixture(id, async () => Response.json({ data: [], candidates: [{ content: { parts: [{ text: "no image" }] } }] }));
    await expect(f.adapter.submit(request(id))).rejects.toMatchObject({ details: { submissionMayHaveOccurred: true, retryable: false } });
    expect(f.fetch).toHaveBeenCalledOnce();
  });
});
