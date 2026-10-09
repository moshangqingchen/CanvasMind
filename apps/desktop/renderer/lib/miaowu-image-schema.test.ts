import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GenericRestAdapter, StaticConnectionResolver, modelPriceAmount, type ModelDescriptor, type NormalizedRequest } from "@super-canvas/providers";
import { miaowuCatalogFromPricing, miaowuConnectorForModels, miaowuModelsForGroup } from "./miaowu-catalog";
import { applyMiaowuImageSchema, parseMiaowuImageSchema, type MiaowuImageSchemaReceipt } from "./miaowu-image-schema";

const fixture = JSON.parse(readFileSync(new URL("./miaowu-image-20261009.fixture.json", import.meta.url), "utf8"));
const imageIds = Object.keys(fixture.schemas);
function receipt(id: string): MiaowuImageSchemaReceipt {
  return { id, sourceUrl: `https://api.miaowuai.store/v1/dream/model_schema?model=${encodeURIComponent(id)}`,
    checkedAt: fixture.checkedAt, status: "live", contract: parseMiaowuImageSchema(id, fixture.schemas[id]) };
}
const publicModels = () => miaowuModelsForGroup(miaowuCatalogFromPricing(fixture.pricing), "default");
const imageModel = (id = "gpt-image-2.5-flare") => applyMiaowuImageSchema(publicModels().find(model => model.id === id)!, receipt(id));
function adapterFor(model: ModelDescriptor, fetcher: typeof fetch) {
  const connector = miaowuConnectorForModels([model]);
  return new GenericRestAdapter(new StaticConnectionResolver([{ id: "same-key", provider: "rest", baseUrl: "https://api.miaowuai.store", apiKey: "synthetic-key",
    settings: { connector, modelCatalogModels: [model], scannedModelIds: [model.id], modelScanStatus: "live" } }]), { fetch: fetcher });
}

describe("exact Miaowu image schemas", () => {
  it("connects the current 21 exact public IDs and applies all seven own image contracts and already-converted prices", () => {
    const catalog = publicModels();
    expect(catalog).toHaveLength(21);
    expect(catalog.filter(model => model.outputKinds?.includes("image"))).toHaveLength(7);
    expect(catalog.filter(model => model.outputKinds?.includes("video"))).toHaveLength(14);
    const connector = miaowuConnectorForModels(catalog);
    for (const model of catalog) expect(connector.modelOverrides?.[model.id]?.submit?.path ?? connector.submit.path)
      .toBe(model.outputKinds?.includes("image") ? "/v1/images" : "/v1/videos");
    for (const id of imageIds) {
      const source = fixture.schemas[id], fields = source.request_schema.properties.params.properties;
      const model = imageModel(id);
      expect(model.metadata).toMatchObject({ parameterSource: "dream.image_schema", imageSchemaStatus: "live", canvasRunnable: true,
        fixedOutputCount: 1, operationsSource: "declared", outputKindsSource: "declared" });
      expect(model.operations).toEqual(["image.generate", "image.edit"]);
      expect(model.parameters?.map(parameter => parameter.key)).toEqual(["resolution", "aspect_ratio"]);
      expect(model.parameters?.find(row => row.key === "resolution")?.options?.map(option => option.value)).toEqual(fields.size.enum);
      expect(model.parameters?.find(row => row.key === "aspect_ratio")?.options?.map(option => option.value)).toEqual(fields.ratio.enum);
      expect(model.limits).toMatchObject({ maxInputImages: 5, maxInputVideos: 0, maxInputAudios: 0, maxOutputImages: 1 });
      for (const rule of source.pricing_display.groups.default.rules) {
        expect(modelPriceAmount(model.pricing!, { resolution: rule.size })).toBe(rule.price);
      }
      expect(model.pricing?.sourceUrl).toBe(receipt(id).sourceUrl);
    }
    expect(imageModel("gpt-image-2.5-sunburs").id).toBe("gpt-image-2.5-sunburs");
    expect(imageModel("gpt-image-2.5-flare").metadata?.priceLabel).toBe("¥0.04–0.2/次");
    expect(modelPriceAmount(imageModel("GPT-image-2").pricing!, { resolution: "1080p" })).toBe(.05);
  });

  it("does not borrow an image tariff from another group or infer undeclared pricing conditions", () => {
    const id = "gpt-image-2.5-flare", original = publicModels().find(model => model.id === id)!;
    const otherGroup = { ...original, metadata: { ...original.metadata, marketplaceGroup: "another-group" } };
    expect(applyMiaowuImageSchema(otherGroup, receipt(id)).pricing).toEqual(otherGroup.pricing);
    for (const edit of [
      (payload: typeof fixture.schemas[string]) => payload.pricing_display.groups.default.rules.pop(),
      (payload: typeof fixture.schemas[string]) => payload.pricing_display.groups.default.rules[0].quality = "high",
      (payload: typeof fixture.schemas[string]) => payload.pricing_display.groups.default.rules[0].price = "0.04",
    ]) {
      const payload = structuredClone(fixture.schemas[id]); edit(payload);
      const contract = parseMiaowuImageSchema(id, payload);
      expect(contract.pricingDisplay).toBeUndefined();
      expect(applyMiaowuImageSchema(original, { ...receipt(id), contract }).pricing).toEqual(original.pricing);
    }
    const placeholder = { ...original, name: "Flare（价格以平台为准）", pricing: undefined };
    expect(applyMiaowuImageSchema(placeholder, receipt(id))).toMatchObject({ name: "Flare（¥0.04–0.2/次）",
      pricing: { currency: "CNY", billingUnit: "request" } });
  });

  it("rejects mismatched IDs, unsupported media/modes, undeclared fields and unimplemented joint constraints", () => {
    const id = "GPT-image-2", source = fixture.schemas[id];
    expect(() => parseMiaowuImageSchema("gpt-image-2", source)).toThrow("同一完整图片型号");
    for (const edit of [
      (payload: typeof source) => payload.type = "video",
      (payload: typeof source) => payload.request_schema.properties.params.properties.seed = { type: "number" },
      (payload: typeof source) => payload.request_schema.properties.params.properties.mode.enum = ["multi-ref-to-video"],
      (payload: typeof source) => payload.request_schema.properties.params.properties.video_urls.maxItems = 1,
      (payload: typeof source) => payload.request_schema.properties.params.properties.image_urls.minItems = 2,
      (payload: typeof source) => payload.request_schema.properties.params.properties.prompt.maxLength = 0,
      (payload: typeof source) => payload.request_schema.properties.params.allOf = [{ properties: { ratio: { const: "1:1" } } }],
    ]) {
      const payload = structuredClone(source); edit(payload);
      expect(() => parseMiaowuImageSchema(id, payload)).toThrow();
    }
  });

  it("preserves explicit manual/paid/denied contracts and cannot use unauthorized or cross-source schema as permission", () => {
    const model = publicModels().find(model => model.id === "GPT-image-2")!;
    for (const metadata of [{ source: "manual" }, { protocolEvidence: "paid-test" }, { canvasRunnable: false, canvasUnavailableReason: "403 权限不足" }]) {
      const protectedModel = { ...model, metadata: { ...model.metadata, ...metadata } };
      expect(applyMiaowuImageSchema(protectedModel, receipt(model.id))).toBe(protectedModel);
    }
    expect(applyMiaowuImageSchema(model, { ...receipt(model.id), sourceUrl: "https://different.example/schema" })).toBe(model);
    expect(applyMiaowuImageSchema(model, receipt("gpt-image-2.5-flare"))).toBe(model);
    const pending = { ...model, parameters: [], metadata: { ...model.metadata, canvasRunnable: false, canvasUnavailableReason: "媒体目录列出此型号，但当前分组尚未提供其参数合同" } };
    expect(applyMiaowuImageSchema(pending, { ...receipt(model.id), status: "unauthorized", stale: true }).metadata?.canvasRunnable).toBe(false);
    expect(applyMiaowuImageSchema(pending, { ...receipt(model.id), status: "failed", stale: true }).metadata?.canvasRunnable).toBe(true);
  });

  it("enforces declared operations when the source exposes one generation mode only", () => {
    const id = "GPT-image-2", source = structuredClone(fixture.schemas[id]);
    source.request_schema.properties.params.properties.mode.enum = ["text-to-image"];
    const original = publicModels().find(model => model.id === id)!;
    expect(applyMiaowuImageSchema(original, { ...receipt(id), contract: parseMiaowuImageSchema(id, source) })).toMatchObject({
      operations: ["image.generate"], inputKinds: ["text"], limits: { maxInputImages: 0 } });
    source.request_schema.properties.params.properties.mode.enum = ["image-to-image"];
    expect(applyMiaowuImageSchema(original, { ...receipt(id), contract: parseMiaowuImageSchema(id, source) })).toMatchObject({
      operations: ["image.edit"], limits: { requiresInputImage: true } });
  });

  it("rejects illegal image schema inputs before any paid POST and allows the internal n=1 without sending it", async () => {
    const id = "gpt-image-2.5-flare", source = structuredClone(fixture.schemas[id]);
    source.request_schema.properties.params.properties.prompt.maxLength = 3;
    const model = applyMiaowuImageSchema(publicModels().find(model => model.id === id)!, { ...receipt(id), contract: parseMiaowuImageSchema(id, source) });
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "one", status: "queued" }));
    const adapter = adapterFor(model, fetcher);
    const request: NormalizedRequest = { connectionId: "same-key", idempotencyKey: "isolated", model: id, operation: "image.generate", prompt: "🌊🌊🌊",
      parameters: { resolution: "4K", aspect_ratio: "16:9", n: 1 } };
    expect((await adapter.validate(request)).valid).toBe(true);
    for (const invalid of [
      { ...request, prompt: "🌊🌊🌊🌊" },
      { ...request, parameters: { ...request.parameters, resolution: "8K" } },
      { ...request, parameters: { ...request.parameters, aspect_ratio: "21:9" } },
      { ...request, parameters: { ...request.parameters, n: 2 } },
      { ...request, parameters: { ...request.parameters, size: "1024x1024" } },
      { ...request, parameters: { ...request.parameters, seed: 42 } },
      { ...request, assets: Array.from({ length: 6 }, (_, index) => ({ id: String(index), kind: "image" as const, mimeType: "image/png", url: `https://media.example/${index}.png` })) },
      { ...request, assets: [{ id: "video", kind: "video" as const, mimeType: "video/mp4", url: "https://media.example/reference.mp4" }] },
    ]) {
      expect((await adapter.validate(invalid)).valid).toBe(false);
      await expect(adapter.submit(invalid)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
    await adapter.submit(request);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: request.prompt, resolution: "4K", ratio: "16:9" });
  });

  it.each(imageIds)("submits/polls/downloads %s via the documented asynchronous image contract", async id => {
    const model = imageModel(id);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "image_one", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "image_one", status: "completed" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
    const adapter = adapterFor(model, fetcher);
    const task = await adapter.submit({ connectionId: "same-key", idempotencyKey: "isolated", model: id, operation: "image.edit", prompt: "海面",
      parameters: { resolution: model.parameters![0]!.default, aspect_ratio: model.parameters![1]!.default, n: 1 },
      assets: [{ id: "reference", kind: "image", mimeType: "image/png", url: "https://media.example/reference.png" }] });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.miaowuai.store/v1/images");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: "海面",
      resolution: model.parameters![0]!.default, ratio: model.parameters![1]!.default, image_urls: ["https://media.example/reference.png"] });
    await expect(adapter.extractOutputs(task.result)).resolves.toEqual([]);
    const completed = await adapter.poll(task);
    expect(completed.status).toBe("succeeded");
    await expect(adapter.extractOutputs(completed.result)).resolves.toEqual([{ kind: "image", data: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png" }]);
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.miaowuai.store/v1/images/image_one");
    expect(fetcher.mock.calls[2]?.[0]).toBe("https://api.miaowuai.store/v1/images/image_one/content");
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("GET");
    expect(fetcher.mock.calls[2]?.[1]?.method).toBe("GET");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get("authorization")).toBe("Bearer synthetic-key");
    expect(JSON.stringify({ task, completed })).not.toContain("synthetic-key");
  });
});
