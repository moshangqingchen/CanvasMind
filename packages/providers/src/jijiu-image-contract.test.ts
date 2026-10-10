import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import { applyJijiuImageCapabilities, JIJIU_IMAGE_IDS, jijiuGptImageRequestIssues } from "./jijiu-image-contract.js";
import { OpenAIImageAdapter } from "./openai.js";
import { StaticConnectionResolver } from "./credentials.js";
import { resolveModelParameters, validateModelParameters } from "./cli-contracts.js";
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
  it.each(JIJIU_IMAGE_IDS)("keeps %s supplier controls and independently unknown pixel rules", id => {
    const descriptor = applyJijiuImageCapabilities({ provider: "openai", config: configFor(id) }, { id, name: id, operations: ["image.generate"] });
    expect(descriptor.metadata).toMatchObject({ jijiuImageContract: true, imageNativeParameterContract: true, imagePixelBudgetPublished: false, imageOutputEncodingDeclared: false });
    expect(descriptor.parameters?.some(p => ["output_format", "width", "height"].includes(p.key))).toBe(false);
    expect(descriptor.parameters?.some(p => p.key === "quality")).toBe(id === "gpt-image-2-2K/4K");
    expect(descriptor.limits?.maxInputImages).toBeUndefined();
    expect(descriptor.parameters?.[0]?.default).toBe("auto");
  });
  it("restores the high-tier controls from an older cached descriptor without claiming measured pixels", () => {
    const id = "gpt-image-2-2K/4K";
    const stale = { id, name: id, operations: ["image.generate" as const], parameters: [
      { key: "size", label: "输出尺寸", control: "select" as const, valueType: "string" as const, options: [{ value: "auto", label: "自动" }] }],
      metadata: { qualitySupport: "provider-decided", imageQualityNote: "旧质量说明", imageUnsupportedResolutions: ["2K", "4K"],
        imageRequestResolutions: [], imageNativeQualityParameter: "old_quality", fixedQuality: "low", imageOutputDimensions: [{ width: 1024, height: 1024 }] } };
    const descriptor = applyJijiuImageCapabilities({ provider: "openai", config: configFor(id) }, stale);
    expect(descriptor.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(descriptor.parameters?.find(p => p.key === "quality")?.options).toEqual([
      { value: "auto", label: "自动（供应商默认）" }, { value: "high", label: "最高" }]);
    expect(descriptor.metadata).toMatchObject({ imageNativeResolutionParameter: "size", imageNativeQualityParameter: "quality",
      imageSupportedResolutions: ["1K", "2K", "4K"], imageRequestResolutions: ["1K", "2K", "4K"], imagePixelBudgetPublished: false,
      imageTierRequestSource: "user-requested-native-size", imageQualitySource: "openai-compatible-user-request",
      imageAllTierRequestsVerified: false, generationVerified: false });
    expect(descriptor.metadata?.imageNativeTierRequestSamples).toEqual([expect.objectContaining({ operation: "image.generate",
      group: "图片-GPT-image-2-2K/4K", parameters: { size: "4K", quality: "high", n: 1 }, allAspectRatiosVerified: false })]);
    for (const key of ["fixedQuality", "imageQualityNote", "imageOutputDimensions", "imageUnsupportedResolutions"])
      expect(descriptor.metadata?.[key]).toBeUndefined();
    expect(applyJijiuImageCapabilities({ provider: "openai", config: configFor(id) }, descriptor)).toEqual(descriptor);
    const saved = Object.freeze({ size: "4K", quality: "high", n: 1 });
    expect(validateModelParameters(descriptor, saved, "image.generate")).toEqual({ valid: true, issues: [] });
    expect(resolveModelParameters(descriptor, saved, "image.generate")).toEqual({ parameters: saved, removedKeys: [], issues: [] });
  });
  it("publishes the same high-tier controls after a fresh model scan", async () => {
    const id = "gpt-image-2-2K/4K", f = fixture(id, async () => Response.json({ data: [{ id }] }));
    const model = (await f.adapter.listModels("jijiu")).find(item => item.id === id);
    expect(model?.parameters?.find(p => p.key === "size")?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(model?.parameters?.find(p => p.key === "quality")?.options?.map(option => option.value)).toEqual(["auto", "high"]);
    expect(model?.metadata?.qualitySupport).toBe("user-requested");
    expect(f.fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it.each(["1K", "2K", "4K"])("passes the requested %s tier and real high quality through generation and JSON editing", async size => {
    const id = "gpt-image-2-2K/4K";
    for (const operation of ["image.generate", "image.edit"] as const) {
      const f = fixture(id), parameters = Object.freeze({ size, quality: "high", n: 1 });
      const assets = operation === "image.edit" ? [{ id: "reference", kind: "image" as const, url: "https://assets.example/original.png" }] : undefined;
      const input = { ...request(id), operation, parameters, ...(assets ? { assets } : {}) };
      expect(await f.adapter.validate(input)).toEqual({ valid: true, issues: [] });
      await f.adapter.submit(input);
      expect(f.fetch).toHaveBeenCalledOnce();
      const [url, init] = f.fetch.mock.calls[0]!;
      expect(url).toBe(`${baseUrl}/images/${operation === "image.edit" ? "edits" : "generations"}`);
      expect(JSON.parse(String(init?.body))).toEqual({ model: id, prompt: "A cup", size, quality: "high", n: 1,
        ...(assets ? { image: [assets[0]!.url] } : {}) });
      expect(parameters).toEqual({ size, quality: "high", n: 1 });
    }
  });
  it.each(["size", "resolution", "image_size", "imageSize", "size_tier"])("preserves a saved 4K %s alias without downgrading or sending extra fields", async key => {
    const id = "gpt-image-2-2K/4K", f = fixture(id), parameters = Object.freeze({ [key]: "4K", quality: "high" });
    await f.adapter.submit({ ...request(id), parameters });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model: id, prompt: "A cup", n: 1, size: "4K", quality: "high" });
    expect(parameters[key]).toBe("4K");
  });
  it("omits explicit supplier defaults independently for high-tier size and quality", async () => {
    const id = "gpt-image-2-2K/4K";
    for (const [parameters, fields] of [[{ size: "auto", quality: "auto" }, {}], [{ size: "4K", quality: "auto" }, { size: "4K" }],
      [{ size: "auto", quality: "high" }, { quality: "high" }]] as const) {
      const f = fixture(id); await f.adapter.submit({ ...request(id), parameters });
      expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toEqual({ model: id, prompt: "A cup", n: 1, ...fields });
    }
  });
  it("rejects high-tier alias conflicts, invented pixels and unknown max quality before HTTP", async () => {
    const id = "gpt-image-2-2K/4K";
    for (const parameters of [{ size: "4K", resolution: "2K" }, { size: "auto", image_size: "4K" }, { size: "4096x4096" },
      { size: "8K" }, { quality: "max" }, { quality: "最高" }, { size: "4K", width: 4096 }, { size: "4K", ratio: "16:9" }]) {
      const f = fixture(id); expect((await f.adapter.validate({ ...request(id), parameters })).valid).toBe(false);
      await expect(f.adapter.submit({ ...request(id), parameters })).rejects.toThrow(); expect(f.fetch).not.toHaveBeenCalled();
    }
  });
  it.each(["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-sunburst"])("does not extend the high-tier override to low-tier %s", async id => {
    for (const parameters of [{ size: "4K", quality: "high" }, { imageSize: "4K" }, { quality: "high" }]) {
      const f = fixture(id); await expect(f.adapter.submit({ ...request(id), parameters })).rejects.toThrow(); expect(f.fetch).not.toHaveBeenCalled();
    }
  });
  it("keeps the high-tier override scoped to the exact origin, model and permitted Key group", async () => {
    const id = "gpt-image-2-2K/4K", model = { id, name: id, operations: ["image.generate" as const] };
    for (const url of ["https://other.example/v1", "https://newapi.jijiucanvas.com.other.example/v1"])
      expect(applyJijiuImageCapabilities({ provider: "openai", config: { ...configFor(id), baseUrl: url } }, model)).toBe(model);
    expect(applyJijiuImageCapabilities({ provider: "openai", config: configFor(id) }, { ...model, id: `${id}-other` }).metadata).toBeUndefined();
    const fetch = vi.fn<FetchImplementation>();
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "jijiu", provider: "openai", apiKey: "fixture-only", baseUrl,
      settings: { ...configFor(id), accountKeyGroup: "图片-GPT-image-2/2.5-1K", modelGroup: "图片-GPT-image-2/2.5-1K" } }]), { fetch });
    await expect(adapter.submit({ ...request(id), parameters: { size: "4K", quality: "high" } })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
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
