import { describe, expect, it, vi } from "vitest";
import { GenericRestAdapter, StaticConnectionResolver } from "@super-canvas/providers";
import {
  CYBERAFEI_API_BASE_URL,
  CYBERAFEI_BASE_URL,
  cyberAfeiCatalogFromPricing,
  cyberAfeiConnectorForModels,
  cyberAfeiDefaultModelForGroup,
  cyberAfeiDocumentedModel,
  loadCyberAfeiCatalog,
  resolveCyberAfeiScannedGroup,
  type PricingPayload,
} from "./cyberafei-catalog";
import { modelPriceAmount } from "@super-canvas/providers/media-billing";
import { modelEstimatedCost } from "./model-display";

it("preserves scanned Afei video structured prices and authenticated SD2 downloads", () => {
  const catalog = cyberAfeiCatalogFromPricing({ group_ratio: { video: .5 }, data: [{ model_name: "video-v1-10s", quota_type: 1, model_price: 1.5, enable_groups: ["video"] }] });
  const resolved = resolveCyberAfeiScannedGroup(catalog, "video", ["video-v1-10s"]);
  expect(resolved.canvasModels[0]?.pricing).toMatchObject({ kind: "per-request", currency: "USD", billingUnit: "request", unitAmount: .75 });
  expect(resolved.canvasModels[0]?.parameters?.find(parameter => parameter.key === "duration")?.options?.map(option => option.value)).toEqual([10]);
  const override = cyberAfeiConnectorForModels(resolved.canvasModels).modelOverrides?.["video-v1-10s"];
  expect(override?.poll?.path).toBe("/v1/video/generations/{taskId}");
  expect(override?.output?.contentFallback?.path).toBe("/v1/videos/{taskId}/content");
  expect(resolved.canvasModels[0]?.name.match(/请求/gu)).toHaveLength(1);
});

describe("current Cyber Afei conditional ledger prices", () => {
  const group = "图片视频模型综合分组";
  const quotes = [
    { id: "nano-banana-pro", description: "高质量图片生成，支持文生图和参考图。1K/2K 1.125额度/次，4K 1.65额度/次。", unit: "request", amounts: { "1K": 1.125, "2K": 1.125, "4K": 1.65 } },
    { id: "nano-banana2", description: "图片生成，支持文生图和参考图。1K/2K 0.9额度/次，4K 1.5额度/次。", unit: "request", amounts: { "1K": .9, "2K": .9, "4K": 1.5 } },
    { id: "veo3.1", description: "视频生成，支持 720p、1080p、4K。720p 45、1080p 52.5、4K 67.5额度/次。", unit: "request", amounts: { "720p": 45, "1080p": 52.5, "4K": 67.5 } },
    { id: "veo3.1-fast", description: "快速视频生成。720p/1080p 5.625额度/次，4K 15.75额度/次。", unit: "request", amounts: { "720p": 5.625, "1080p": 5.625, "4K": 15.75 } },
    { id: "veo3.1-lite", description: "轻量视频生成。720p 3、1080p 3.75、4K 15额度/次。", unit: "request", amounts: { "720p": 3, "1080p": 3.75, "4K": 15 } },
    { id: "seedance2.0", description: "Seedance 2.0 视频生成，按时长计费。480p 2.025、720p 3.15、1080p 6.375、4K 15额度/秒。", unit: "second", amounts: { "480p": 2.025, "720p": 3.15, "1080p": 6.375, "4K": 15 } },
    { id: "seedance2.5", description: "Seedance 2.5 视频生成，按时长计费。480p 2.625额度/秒，720p 4.725额度/秒。", unit: "second", amounts: { "480p": 2.625, "720p": 4.725 } },
    { id: "minimax-h3", description: "MiniMax H3 视频生成，按时长计费。768p 1.875额度/秒，2K 3额度/秒。", unit: "second", amounts: { "768p": 1.875, "2K": 3 } },
  ] as const;
  it.each(quotes)("uses every exact published resolution rate and the group ratio once for $id", quote => {
    const catalog = cyberAfeiCatalogFromPricing({ group_ratio: { [group]: .5 }, data: [{ model_name: quote.id, description: quote.description,
      quota_type: 1, model_price: Object.values(quote.amounts)[0], enable_groups: [group], supported_endpoint_types: ["openai", "openai-video"] }] });
    const model = catalog.groups[group]?.find(model => model.id === quote.id);
    if (!model) throw new Error(`Expected catalog model ${quote.id}`);
    const pricing = model.pricing!;
    expect(pricing).toMatchObject({ kind: "tiered", currency: "USD", billingUnit: quote.unit, confidence: "exact" });
    expect(pricing.unitAmount).toBeUndefined();
    expect(modelPriceAmount(pricing, {})).toBeUndefined();
    expect(pricing.tiers).toHaveLength(Object.keys(quote.amounts).length);
    for (const [resolution, amount] of Object.entries(quote.amounts)) {
      expect(modelPriceAmount(pricing, { resolution })).toBe(amount * .5);
      expect(modelEstimatedCost(model, { resolution, duration: 10 })).toBe(`${amount * .5 * (quote.unit === "second" ? 10 : 1)} USD`);
      expect(model.metadata?.priceLabel).toContain(`${resolution} $${amount * .5}/${quote.unit === "second" ? "秒" : "请求"}`);
    }
    expect(catalog.marketplaceGroups[0]?.models.find(model => model.id === quote.id)?.priceLabel).toBe(model.metadata?.priceLabel);
  });
  it("does not estimate an unspecified Nano tier or charge it at the lowest headline price", () => {
    const quote = quotes[0];
    const catalog = cyberAfeiCatalogFromPricing({ data: [{ model_name: quote.id, description: quote.description, quota_type: 1, model_price: 1.125,
      enable_groups: [group], supported_endpoint_types: ["image-generation", "openai"] }] });
    const model = catalog.groups[group]?.[0];
    if (!model) throw new Error(`Expected catalog model ${quote.id}`);
    expect(modelEstimatedCost(model, {})).toBeUndefined();
    expect(modelEstimatedCost(model, { image_size: "4K" })).toBe("1.65 USD");
    expect(model.parameters).toEqual([]);
  });
  it("keeps a fixed model ID's own price instead of borrowing another alias's resolution rates", () => {
    const catalog = cyberAfeiCatalogFromPricing({ group_ratio: { [group]: 1 }, data: [
      { model_name: "gemini-3.1-flash-image-preview-2K", model_price: 1, quota_type: 1, enable_groups: [group], supported_endpoint_types: ["openai"] },
      { model_name: "gemini-3.1-flash-image-preview-4K", model_price: 1.5, quota_type: 1, enable_groups: [group], supported_endpoint_types: ["openai"] },
    ] });
    expect(catalog.groups[group]?.map(model => [model.id, model.pricing?.unitAmount])).toEqual([["gemini-3.1-flash-image-preview-2K", 1], ["gemini-3.1-flash-image-preview-4K", 1.5]]);
  });
  it("keeps omni-flash generation and edit quotes conditional on both mode and resolution", () => {
    const catalog = cyberAfeiCatalogFromPricing({ group_ratio: { [group]: .5 }, data: [{ model_name: "omni-flash",
      description: "支持视频生成和编辑。生成：720p 8.25、1080p 15、4K 21额度/次；编辑：720p 10.5、1080p 15、4K 21额度/次。",
      tags: "视频生成,参考图,视频编辑,720p,1080p,4K,按次计费", quota_type: 1, model_price: 8.25,
      enable_groups: [group], supported_endpoint_types: ["openai", "openai-video"] }] });
    expect(catalog.marketplaceGroups[0]?.models[0]).toMatchObject({ id: "omni-flash", capability: "video" });
    expect(resolveCyberAfeiScannedGroup(catalog, group, []).canvasModels).toEqual([]);
    const model = resolveCyberAfeiScannedGroup(catalog, group, ["omni-flash"]).canvasModels[0]!;
    expect(model).toMatchObject({ id: "omni-flash", outputKinds: ["video"], pricing: { kind: "tiered", currency: "USD", billingUnit: "request" },
      metadata: { priceSource: "supplier-catalog", priceConditionsSource: "exact-model-description" } });
    expect(model.pricing?.unitAmount).toBeUndefined();
    expect(model.pricing?.tiers).toHaveLength(6);
    for (const [mode, prices] of Object.entries({ generate: { "720p": 8.25, "1080p": 15, "4K": 21 }, edit: { "720p": 10.5, "1080p": 15, "4K": 21 } })) {
      for (const [resolution, price] of Object.entries(prices)) {
        expect(modelPriceAmount(model.pricing!, { mode, resolution })).toBe(price * .5);
        expect(modelEstimatedCost(model, { mode, resolution, duration: 10 })).toBe(`${price * .5} USD`);
      }
    }
    expect(modelPriceAmount(model.pricing!, {})).toBeUndefined();
    expect(modelPriceAmount(model.pricing!, { resolution: "720p" })).toBeUndefined();
    expect(modelPriceAmount(model.pricing!, { mode: "edit" })).toBeUndefined();
    expect(model.metadata?.priceLabel).toContain("生成 720p $4.125/请求");
    expect(model.metadata?.priceLabel).toContain("编辑 720p $5.25/请求");
    expect(resolveCyberAfeiScannedGroup(catalog, group, ["omni-flash"], { capabilityBlocks: [
      { capability: "video", reason: "group_permission_denied", detectedAt: "2026-10-09" },
    ] }).canvasModels).toEqual([]);
  });
  it("does not replace an incomplete mode quote with the lowest headline price", () => {
    const catalog = cyberAfeiCatalogFromPricing({ data: [{ model_name: "omni-flash", description: "生成：720p 8.25额度/次；编辑：价格未公布。",
      quota_type: 1, model_price: 8.25, enable_groups: [group], supported_endpoint_types: ["openai-video"] }] });
    expect(catalog.groups[group]?.[0]?.pricing).toBeUndefined();
    expect(catalog.groups[group]?.[0]?.metadata?.priceLabel).toBe("生成/编辑计费条件待确认");
  });
});

describe("current official Cyber Afei image endpoints", () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
  const bytes = new Uint8Array(Buffer.from(png, "base64"));
  const dataUri = `data:image/png;base64,${png}`;
  const chatIds = ["gemini-3.1-flash-image-preview-2K", "gemini-3.1-flash-image-preview-4K", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5"];
  function fixture(id: string, reply: unknown = { choices: [{ message: { content: `![result](${dataUri})` } }] }) {
    const model = cyberAfeiDocumentedModel(id)!;
    const connector = cyberAfeiConnectorForModels([model]);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(reply));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "afei", provider: "rest", baseUrl: CYBERAFEI_BASE_URL, apiKey: "fixture-key",
      settings: { connector, scannedModelIds: [id] } }]), { fetch: fetcher });
    return { model, connector, fetcher, adapter };
  }
  const request = (model: string) => ({ connectionId: "afei", model, operation: "image.generate" as const, prompt: "blue vase", idempotencyKey: "one" });

  it.each(chatIds)("uses the exact ID %s in a minimal chat image request and accepts image content", async id => {
    const f = fixture(id);
    expect(f.model.parameters).toEqual([]);
    expect(f.model.metadata).toMatchObject({ cyberAfeiImageEndpoint: "openai", protocolEvidence: "official-endpoint-catalog-and-standard-protocol" });
    const task = await f.adapter.submit({ ...request(id), parameters: { size: "4K", quality: "max", n: 2 } });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls[0]?.[0]).toBe(`${CYBERAFEI_BASE_URL}/v1/chat/completions`);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, stream: false, messages: [{ role: "user", content: "blue vase" }] });
    expect(await f.adapter.extractOutputs(task.result)).toEqual([{ kind: "image", mimeType: "image/png", data: bytes }]);
  });

  it.each(["nano-banana-pro", "nano-banana2"])("uses only model/prompt on Images generation and standard chat references for %s", async id => {
    const f = fixture(id, { data: [{ b64_json: png }] });
    await f.adapter.submit(request(id));
    expect(f.fetcher.mock.calls[0]?.[0]).toBe(`${CYBERAFEI_BASE_URL}/v1/images/generations`);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: "blue vase" });
    f.fetcher.mockClear().mockResolvedValueOnce(Response.json({ choices: [{ message: { images: [{ image_url: { url: dataUri } }] } }] }));
    const task = await f.adapter.submit({ ...request(id), operation: "image.edit", assets: [{ id: "ref", kind: "image", mimeType: "image/png", data: bytes }] });
    expect(f.fetcher.mock.calls[0]?.[0]).toBe(`${CYBERAFEI_BASE_URL}/v1/chat/completions`);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, stream: false,
      messages: [{ role: "user", content: [{ type: "text", text: "blue vase" }, { type: "image_url", image_url: { url: dataUri, detail: "auto" } }] }] });
    expect(await f.adapter.extractOutputs(task.result)).toHaveLength(1);
    expect(f.model.metadata?.referenceImageLimitSource).toBe("adapter");
  });

  it("uses Gemini's header and actual reference bytes for the current bare flash-image ID", async () => {
    const id = "gemini-3.1-flash-image";
    const f = fixture(id, { candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: png } }] } }] });
    expect(f.model.parameters?.find(parameter => parameter.key === "imageSize")?.default).toBe("auto");
    const task = await f.adapter.submit({ ...request(id), operation: "image.edit", parameters: { imageSize: "2K", aspectRatio: "16:9" },
      assets: [{ id: "ref-1", kind: "image", mimeType: "image/png", data: bytes }, { id: "ref-2", kind: "image", mimeType: "image/png", data: bytes }] });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls[0]?.[0]).toBe(`${CYBERAFEI_BASE_URL}/v1beta/models/${id}:generateContent`);
    expect(new Headers(f.fetcher.mock.calls[0]?.[1]?.headers).get("x-goog-api-key")).toBe("fixture-key");
    const body = JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body));
    expect(body.contents[0].parts).toEqual([{ text: "blue vase" }, ...[1, 2].map(() => ({ inlineData: { mimeType: "image/png", data: png } }))]);
    expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { imageSize: "2K", aspectRatio: "16:9" } });
    expect(await f.adapter.extractOutputs(task.result)).toHaveLength(1);
  });

  it("accepts future exact image-family IDs only with official endpoint declarations and current Key visibility", () => {
    const id = "gemini-future-image";
    expect(cyberAfeiDocumentedModel(id)).toBeNull();
    expect(cyberAfeiDocumentedModel(id, { endpointTypes: ["unknown"] })).toBeNull();
    expect(cyberAfeiDocumentedModel("gemini-future-text", { endpointTypes: ["gemini"] })).toBeNull();
    const catalog = cyberAfeiCatalogFromPricing({ data: [{ model_name: id, supported_endpoint_types: ["gemini"], enable_groups: ["current"] }] });
    expect(resolveCyberAfeiScannedGroup(catalog, "current", []).canvasModels).toEqual([]);
    const models = resolveCyberAfeiScannedGroup(catalog, "current", [id]).canvasModels;
    expect(models[0]?.id).toBe(id);
    expect(cyberAfeiConnectorForModels(models).modelOverrides?.[id]?.submit?.path).toBe(`/v1beta/models/${id}:generateContent`);
    expect(resolveCyberAfeiScannedGroup(catalog, "current", [id], { capabilityBlocks: [{ capability: "image", reason: "group_permission_denied", detectedAt: "2026-10-09" }] }).canvasModels).toEqual([]);
  });

  it("blocks models outside the connector inventory and enforces only the declared adapter reference limit", async () => {
    const id = chatIds[0]!;
    const f = fixture(id);
    await expect(f.adapter.submit(request("gpt-image-2.5-sunburst"))).rejects.toThrow();
    await expect(f.adapter.submit({ ...request(id), operation: "image.edit", assets: Array.from({ length: 17 }, (_, index) => ({ id: `ref-${index}`, kind: "image" as const, mimeType: "image/png", data: bytes })) })).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each(["gpt-image-2.5-flare", "nano-banana-pro", "gemini-3.1-flash-image"])("rejects empty paid responses without submitting twice for %s", async id => {
    const f = fixture(id, { choices: [{ message: { content: "Unable to generate image" } }], candidates: [], data: [] });
    await expect(f.adapter.submit(request(id))).rejects.toMatchObject({ details: { kind: "invalid_response", retryable: false, submissionMayHaveOccurred: true } });
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
});

describe("current Cyber Afei video endpoint declarations", () => {
  it.each([
    { id: "provider-movie-2027", endpoints: ["openai-video"], description: "供应商当前视频生成型号", path: "/v1/videos", bodyMode: "multipart" },
    { id: "veo-next-v2", endpoints: ["openai"], description: "当前视频生成型号", path: "/v1/chat/completions", bodyMode: "json" },
  ])("connects an exact future directory ID $id only through its declared endpoint", row => {
    const group = "current";
    const catalog = cyberAfeiCatalogFromPricing({ data: [{ model_name: row.id, description: row.description,
      supported_endpoint_types: row.endpoints, enable_groups: [group] }] });
    expect(resolveCyberAfeiScannedGroup(catalog, group, []).canvasModels).toEqual([]);
    const resolved = resolveCyberAfeiScannedGroup(catalog, group, [row.id]);
    expect(resolved.canvasModels[0]).toMatchObject({ id: row.id, outputKinds: ["video"] });
    const transport = cyberAfeiConnectorForModels(resolved.canvasModels).modelOverrides?.[row.id];
    if (!transport) throw new Error(`Expected connector transport for ${row.id}`);
    expect(transport.submit).toMatchObject({ path: row.path, bodyMode: row.bodyMode });
    expect(transport.submit?.mappings).toContainEqual(expect.objectContaining({ target: "/model", source: { kind: "request", path: "$.model" } }));
    expect(resolveCyberAfeiScannedGroup(catalog, group, [row.id], { capabilityBlocks: [{ capability: "video", reason: "group_permission_denied", detectedAt: "2026-10-09" }] }).canvasModels).toEqual([]);
  });
  it("does not grant video generation to a text model or an unknown media endpoint", () => {
    const catalog = cyberAfeiCatalogFromPricing({ data: [
      { model_name: "gpt-future-text", supported_endpoint_types: ["openai"], enable_groups: ["current"] },
      { model_name: "veo-next-v2", supported_endpoint_types: ["unknown-video"], enable_groups: ["current"] },
    ] });
    expect(resolveCyberAfeiScannedGroup(catalog, "current", ["gpt-future-text", "veo-next-v2"]).canvasModels).toEqual([]);
  });
});

it("does not promote a token placeholder price to a free per-request price", () => {
  const catalog = cyberAfeiCatalogFromPricing({ data: [{ model_name: "video-v1-5s", quota_type: 0, model_price: 0, model_ratio: 1, completion_ratio: 2, enable_groups: ["video"] }] });
  expect(catalog.groups.video?.[0]?.pricing?.kind).not.toBe("per-request");
});

it("shows the exact declared ya-sd25-30s video without token fees or a guessed executable connector", () => {
  const id = "ya-sd25-30s", group = "special";
  const catalog = cyberAfeiCatalogFromPricing({ group_ratio: { [group]: 1 }, usable_group: { [group]: "视频特价，0.3/秒" },
    data: [{ model_name: id, quota_type: 0, model_price: 0, model_ratio: 37.5, completion_ratio: 1, enable_groups: [group], supported_endpoint_types: ["openai"] }] });
  expect(catalog.marketplaceGroups[0]?.models[0]).toMatchObject({ id, capability: "video", priceLabel: "价格条件待确认", billingLabel: "计费条件待确认" });
  const resolved = resolveCyberAfeiScannedGroup(catalog, group, [id]);
  expect(resolved.canvasModels).toEqual([]);
  const pending = resolved.canvasDisplayModels[0]!;
  expect(pending).toMatchObject({ id, metadata: { canvasRunnable: false, cyberAfeiCatalogPricingIncomplete: true, priceStatus: "unconfirmed", priceLabel: "价格条件待确认" } });
  expect(pending.pricing).toBeUndefined();
  expect(pending.parameters).toBeUndefined();
  const connector = cyberAfeiConnectorForModels(resolved.canvasModels);
  expect(connector.models?.some(model => model.id === id)).toBe(false);
  expect(connector.modelOverrides?.[id]).toBeUndefined();
});

describe("cyberafei catalog", () => {
  it.each(["gpt-image-4K", "gpt-image-2-4K"])("offers documented 2K requests on %s as well as 4K", (id) => {
    const catalog = cyberAfeiCatalogFromPricing({ data: [{ model_name: id, model_price: 0.35, quota_type: 1, enable_groups: ["image-2稳定生图"], supported_endpoint_types: ["openai"] }] });
    const model = catalog.groups["image-2稳定生图"]?.find(m => m.id === id);
    expect(model?.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(expect.arrayContaining(["2048x1152", "1152x2048", "3840x2160"]));
  });
  const imageGroup = "image-2稳定生图";
  const videoGroup = "特价seedance2.0";
  const compositeGroup = "图片视频模型综合分组";
  const payload: PricingPayload = {
    data: [
      {
        model_name: "gpt-image-2",
        model_price: 0.15,
        quota_type: 1,
        enable_groups: [imageGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gpt-image-4K",
        model_price: 0.35,
        quota_type: 1,
        enable_groups: [imageGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gpt-image-2-2K",
        model_price: 0.35,
        quota_type: 1,
        enable_groups: [imageGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gpt-image-2-4K",
        model_price: 0.35,
        quota_type: 1,
        enable_groups: [imageGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "video-v1-10s",
        model_price: 1.5,
        quota_type: 1,
        enable_groups: [videoGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "firefly-video-v2",
        video_api: { pricing: { unit: "per_second" } },
        model_price: 20,
        quota_type: 1,
        enable_groups: [videoGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-preview",
        model_price: 0.3,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gemini-3-pro-image-preview",
        model_price: 0.975,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["gemini", "openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-1k",
        model_price: 0.3,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["gemini", "openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-2k",
        model_price: 0.4,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["gemini", "openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-4k",
        model_price: 0.5,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["gemini", "openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-preview-2K",
        model_price: 1,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gemini-3.1-flash-image-preview-4K",
        model_price: 1.5,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-video-1.5-720p",
        model_price: 8.5,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-video-1.5",
        model_price: 8.5,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-无限",
        model_price: 1,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-image",
        model_price: 0.3,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "grok-imagine-image-quality",
        model_price: 0.8,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "nano-banana-pro",
        model_price: 0.975,
        quota_type: 1,
        enable_groups: [compositeGroup],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "gpt-image-2",
        model_price: 0.15,
        quota_type: 1,
        enable_groups: ["gpt5.6-破甲版"],
        supported_endpoint_types: ["openai"],
      },
    ],
    group_ratio: {
      [imageGroup]: 1,
      [videoGroup]: 1,
      [compositeGroup]: 1,
      "gpt5.6-破甲版": 1,
    },
    usable_group: {
      [imageGroup]: "稳定生图",
      [videoGroup]: "SD2 视频",
      [compositeGroup]: "图片视频综合分组",
      "gpt5.6-破甲版": "GPT 文本分组",
    },
  };

  it("uses structured per-second pricing units when a catalog provides them", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const model = catalog.marketplaceGroups
      .find((group) => group.id === videoGroup)
      ?.models.find((item) => item.id === "firefly-video-v2");
    expect(model).toMatchObject({
      priceLabel: "$20 / 秒",
      billingLabel: "按秒计费",
    });
  });

  it("keeps a successful empty pricing response live without fallback models", () => {
    const catalog = cyberAfeiCatalogFromPricing({
      data: [],
      group_ratio: {},
      usable_group: {},
    });

    expect(catalog).toMatchObject({
      source: "live",
      groups: {},
      marketplaceGroups: [],
    });
  });

  it("uses keyed scan IDs as the sole visibility source", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const first = resolveCyberAfeiScannedGroup(catalog, compositeGroup, [
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-image-preview-2K",
      "gemini-3.1-flash-image-preview-4K",
      "grok-imagine-image",
      "grok-imagine-video",
      "kling-3.0",
      "gpt-image-2-2K",
      "scan-only-image",
      "grok-imagine-image",
      "  ",
    ]);

    expect(first.marketplaceGroup.models.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-image-preview-2K",
      "gemini-3.1-flash-image-preview-4K",
      "grok-imagine-image",
      "grok-imagine-video",
      "kling-3.0",
      "gpt-image-2-2K",
      "scan-only-image",
    ]);
    expect(first.canvasModels.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-image-preview-2K",
      "gemini-3.1-flash-image-preview-4K",
      "grok-imagine-image",
      "grok-imagine-video",
      "kling-3.0",
      "gpt-image-2-2K",
    ]);
    expect(first.canvasDisplayModels.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-image-preview-2K",
      "gemini-3.1-flash-image-preview-4K",
      "grok-imagine-image",
      "grok-imagine-video",
      "kling-3.0",
      "gpt-image-2-2K",
      "scan-only-image",
    ]);
    expect(
      first.canvasDisplayModels.find(
        (model) => model.id === "gemini-3.1-flash-image-preview-2K",
      ),
    ).toMatchObject({
      metadata: {
        canvasRunnable: true,
        protocol: "openai-chat-images",
      },
    });
    expect(
      first.canvasDisplayModels.find((model) => model.id === "kling-3.0"),
    ).toMatchObject({
      operations: ["video.generate", "video.image-to-video"],
      metadata: { canvasRunnable: true, catalogCapability: "video", protocol: "openai-chat" },
    });
    expect(
      first.marketplaceGroup.models.find(
        (model) => model.id === "grok-imagine-image",
      ),
    ).toMatchObject({ priceLabel: "$0.30 / 请求", capability: "image" });
    expect(
      first.marketplaceGroup.models.find(
        (model) => model.id === "gpt-image-2-2K",
      ),
    ).toMatchObject({ priceLabel: "价格以平台为准", capability: "image" });
    expect(
      first.marketplaceGroup.models.find(
        (model) => model.id === "scan-only-image",
      ),
    ).toMatchObject({ priceLabel: "价格以平台为准" });
    expect(first.marketplaceGroup).toMatchObject({
      canvasSupported: true,
      canvasModelCount: 7,
    });

    const afterRemoval = resolveCyberAfeiScannedGroup(catalog, compositeGroup, [
      "grok-imagine-image",
    ]);
    expect(
      afterRemoval.marketplaceGroup.models.map((model) => model.id),
    ).toEqual(["grok-imagine-image"]);
    expect(afterRemoval.canvasModels.map((model) => model.id)).toEqual([
      "grok-imagine-image",
    ]);

    const empty = resolveCyberAfeiScannedGroup(catalog, compositeGroup, []);
    expect(empty.marketplaceGroup.models).toEqual([]);
    expect(empty.canvasModels).toEqual([]);
    expect(empty.canvasDisplayModels).toEqual([]);
    expect(empty.marketplaceGroup).toMatchObject({
      canvasSupported: false,
      canvasModelCount: 0,
    });
  });

  it("keeps scanned models visible but removes a capability denied by the group", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const resolved = resolveCyberAfeiScannedGroup(
      catalog,
      "gpt5.6-破甲版",
      ["gpt-image-2"],
      {
        capabilityBlocks: [
          {
            capability: "image",
            reason: "group_permission_denied",
            detectedAt: "2026-08-03T03:20:15.860Z",
            providerMessage: "Image generation is not enabled for this group",
            model: "gpt-image-2",
          },
        ],
      },
    );

    expect(resolved.canvasModels).toEqual([]);
    expect(resolved.canvasDisplayModels).toMatchObject([
      {
        id: "gpt-image-2",
        metadata: {
          canvasRunnable: false,
          canvasUnavailableReason: "当前分组未开通图片生成（已确认上游 403）",
        },
      },
    ]);
    expect(resolved.marketplaceGroup).toMatchObject({
      canvasSupported: false,
      canvasModelCount: 0,
      models: [
        {
          id: "gpt-image-2",
          canvasRunnable: false,
          canvasUnavailableReason: "当前分组未开通图片生成（已确认上游 403）",
        },
      ],
    });
  });

  it("returns an unavailable empty catalog on pricing failure instead of stale models", async () => {
    const liveFetch = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const failedFetch = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    ) as unknown as typeof fetch;

    const live = await loadCyberAfeiCatalog({ force: true, fetch: liveFetch });
    expect(live.source).toBe("live");
    expect(live.marketplaceGroups.length).toBeGreaterThan(0);

    const unavailable = await loadCyberAfeiCatalog({
      force: true,
      fetch: failedFetch,
    });
    expect(unavailable).toMatchObject({
      source: "unavailable",
      groups: {},
      marketplaceGroups: [],
    });
  });

  it("publishes only models with a verified canvas protocol in each marketplace group", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);

    expect(catalog.source).toBe("live");
    expect(catalog.groups[imageGroup]?.map((model) => model.id)).toEqual([
      "gpt-image-2",
      "gpt-image-4K",
      "gpt-image-2-2K",
      "gpt-image-2-4K",
    ]);
    expect(catalog.groups[videoGroup]?.map((model) => model.id)).toEqual([
      "video-v1-10s",
    ]);
    expect(catalog.groups[compositeGroup]?.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-1k",
      "gemini-3.1-flash-image-2k",
      "gemini-3.1-flash-image-4k",
      "gemini-3.1-flash-image-preview-2K",
      "gemini-3.1-flash-image-preview-4K",
      "grok-imagine-video-1.5-720p",
      "grok-imagine-video-1.5",
      "grok-imagine-无限",
      "grok-imagine-image",
      "grok-imagine-image-quality",
      "nano-banana-pro",
    ]);
    expect(
      catalog.groups[compositeGroup]?.map((model) => model.id),
    ).toEqual(
      expect.arrayContaining([
        "gemini-3.1-flash-image-preview-2K",
        "gemini-3.1-flash-image-preview-4K",
        "nano-banana-pro",
      ]),
    );
    expect(catalog.groups["gpt5.6-破甲版"]?.map((model) => model.id)).toEqual([
      "gpt-image-2",
    ]);

    expect(
      catalog.marketplaceGroups.find((group) => group.id === imageGroup),
    ).toMatchObject({ canvasSupported: true, canvasModelCount: 4 });
    expect(
      catalog.marketplaceGroups.find((group) => group.id === compositeGroup),
    ).toMatchObject({ canvasSupported: true, canvasModelCount: 13 });
    expect(
      catalog.marketplaceGroups.find((group) => group.id === "gpt5.6-破甲版"),
    ).toMatchObject({ canvasSupported: true, canvasModelCount: 1 });
    expect(
      catalog.marketplaceGroups
        .find((group) => group.id === imageGroup)
        ?.models.map((model) => model.id),
    ).toEqual([
      "gpt-image-2",
      "gpt-image-2-2K",
      "gpt-image-2-4K",
      "gpt-image-4K",
    ]);
    expect(
      catalog.marketplaceGroups
        .find((group) => group.id === compositeGroup)
        ?.models.find((model) => model.id === "nano-banana-pro"),
    ).toMatchObject({ priceLabel: "$0.975 / 请求", endpointTypes: ["openai"] });
    expect(
      catalog.marketplaceGroups
        .find((group) => group.id === compositeGroup)
        ?.models.find((model) => model.id === "grok-imagine-无限"),
    ).toMatchObject({ capability: "image", priceLabel: "$1 / 请求" });
  });

  it("uses the official Image-2 and Gemini size parameters", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const image4K = catalog.groups[imageGroup]?.find(
      (model) => model.id === "gpt-image-4K",
    );
    const imageSize = image4K?.parameters?.find(
      (parameter) => parameter.key === "size",
    );

    expect(image4K?.name).toBe("gpt-image-4K · $0.35 / 请求");
    expect(imageSize).toMatchObject({
      control: "dimensions",
      default: "3840x2160",
      min: 16,
      max: 3840,
      step: 16,
    });
    expect(imageSize?.options).toHaveLength(22);
    expect(imageSize?.options).toEqual(
      expect.arrayContaining([
        { label: "自动（提示词优先，其次参考图）", value: "auto" },
        {
          label: "纸张 3:4 自定义 · 2096×2800（16 像素对齐）",
          value: "2096x2800",
        },
        {
          label: "纸张 A4/A3 竖版·接口上限 · 2416×3424（按最大像素约束校正）",
          value: "2416x3424",
        },
      ]),
    );
    expect(image4K?.metadata).toMatchObject({
      documentedOutputSizes: [
        "2160x2160",
        "3840x2160",
        "2160x3840",
        "2880x2160",
        "2160x2880",
        "3248x2160",
        "2160x3248",
        "3840x1648",
      ],
      observedOutputSizes: {
        "2160x2160": "2160x2160",
        "3840x2160": "3840x2160",
        "2160x3840": "2160x3840",
        "2880x2160": "2880x2160",
        "2160x2880": "1086x1448",
        "3240x2160": "1536x1024",
        "2160x3240": "2160x3248",
        "3840x1646": "3840x1648",
        "2100x2970": "2096x2976",
        "2480x3508": "2416x3424",
        "3508x4961": "2416x3424",
        "3840x2715": "3424x2416",
      },
      unconfirmedSizes: ["2715x3840"],
      sizeBehavior: "provider-may-normalize",
    });
    expect(image4K?.metadata).not.toHaveProperty("fixedOutputSize");
    expect(
      image4K?.parameters?.find((parameter) => parameter.key === "quality")
        ?.options,
    ).toEqual([
      { label: "自动", value: "auto" },
      { label: "低", value: "low" },
      { label: "中", value: "medium" },
      { label: "高", value: "high" },
    ]);
    const image2K = catalog.groups[imageGroup]?.find(
      (model) => model.id === "gpt-image-2-2K",
    );
    expect(image2K).toMatchObject({
      metadata: {
        defaultOutputSize: "2048x1152",
        unconfirmedSizes: ["2048x2048"],
        observedOutputSizes: {
          "2048x1152": "2048x1152",
          "1152x2048": "1152x2048",
          "2048x1536": "2048x1536",
          "1536x2048": "1536x2048",
          "2048x1360": "2048x1360",
          "1360x2048": "1360x2048",
          "2688x1152": "2688x1152",
        },
      },
    });
    expect(image2K?.metadata).not.toHaveProperty("fixedOutputSize");
    expect(
      image2K?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({
      control: "select",
      default: "2048x1152",
      options: [
        {
          label: "2K 1:1 · 2048×2048（本次网络异常，未确认）",
          value: "2048x2048",
        },
        { label: "2K 16:9 · 2048×1152（实测精确）", value: "2048x1152" },
        { label: "2K 9:16 · 1152×2048（实测精确）", value: "1152x2048" },
        { label: "2K 4:3 · 2048×1536（实测精确）", value: "2048x1536" },
        { label: "2K 3:4 · 1536×2048（实测精确）", value: "1536x2048" },
        { label: "2K 3:2 · 2048×1360（实测精确）", value: "2048x1360" },
        { label: "2K 2:3 · 1360×2048（实测精确）", value: "1360x2048" },
        { label: "2K 21:9 · 2688×1152（实测精确）", value: "2688x1152" },
      ],
    });
    const image2Alias4K = catalog.groups[imageGroup]?.find(
      (model) => model.id === "gpt-image-2-4K",
    );
    expect(
      image2Alias4K?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({
      control: "dimensions",
      default: "3840x2160",
      min: 16,
      max: 3840,
      step: 16,
    });
    expect(
      image2Alias4K?.parameters?.find((parameter) => parameter.key === "size")
        ?.options,
    ).toHaveLength(22);
    expect(
      image2Alias4K?.parameters?.find((parameter) => parameter.key === "size")
        ?.options,
    ).toEqual(
      expect.arrayContaining([
        { label: "自动（提示词优先，其次参考图）", value: "auto" },
        {
          label: "纸张 A 系列自定义 · 2096×2976（16 像素对齐）",
          value: "2096x2976",
        },
        {
          label: "纸张 A4/A3 竖版·接口上限 · 2416×3424（按最大像素约束校正）",
          value: "2416x3424",
        },
      ]),
    );
    expect(image2Alias4K?.metadata).toMatchObject({
      defaultOutputSize: "3840x2160",
      referenceEditEndpoint: "/v1/images/edits",
      referenceEditVerifiedAt: "2026-08-04",
      observedOutputSizes: {
        "2160x2880": "2160x2880",
        "3240x2160": "3248x2160",
        "2100x2800": "2096x2800",
        "2100x2970": "2096x2976",
        "2480x3508": "2416x3424",
        "3508x4961": "2416x3424",
        "2715x3840": "1054x1492",
        "3840x2715": "3424x2416",
      },
    });
    expect(image2Alias4K).toMatchObject({
      operations: ["image.generate", "image.edit"],
      limits: { maxInputImages: 16 },
    });
    expect(image2Alias4K?.metadata).not.toHaveProperty("fixedOutputSize");
    const regularImage2 = catalog.groups[imageGroup]?.find(
      (model) => model.id === "gpt-image-2",
    );
    expect(
      regularImage2?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({
      control: "dimensions",
      default: "1024x1024",
    });
    expect(
      regularImage2?.parameters?.find((parameter) => parameter.key === "size")
        ?.options,
    ).toHaveLength(17);
    expect(regularImage2?.metadata).toMatchObject({
      unconfirmedSizes: ["2160x2160"],
      observedOutputSizes: {
        "2048x2048": "1254x1254",
        "3840x2160": "1672x941",
      },
    });

    const flash = catalog.groups[compositeGroup]?.find(
      (model) => model.id === "gemini-3.1-flash-image-preview",
    );
    const ratios = flash?.parameters?.find(
      (parameter) => parameter.key === "aspectRatio",
    );
    expect(ratios?.default).toBe("auto");
    expect(ratios?.options).toHaveLength(15);
    expect(ratios?.options).toEqual(
      expect.arrayContaining([
        { label: "自动（图生图时跟随参考图）", value: "auto" },
        {
          label: "16:9 · 1K / 2K / 4K：1376×768 / 2752×1536 / 5504×3072",
          value: "16:9",
        },
        {
          label: "8:1 · 1K / 2K / 4K：2928×352 / 5856×704 / 11712×1408",
          value: "8:1",
        },
      ]),
    );
    expect(
      flash?.parameters?.find((parameter) => parameter.key === "imageSize"),
    ).toMatchObject({
      default: "4K",
      options: [
        { label: "自动（默认 4K）", value: "auto" },
        { label: "1K", value: "1K" },
        { label: "2K", value: "2K" },
        { label: "4K", value: "4K" },
      ],
    });

    const fixed4K = catalog.groups[compositeGroup]?.find(
      (model) => model.id === "gemini-3.1-flash-image-4k",
    );
    expect(fixed4K).toMatchObject({
      operations: ["image.generate"],
      metadata: {
        protocol: "gemini-native",
        fixedImageSize: "4K",
        sizeBehavior: "fixed-tier",
      },
      limits: { maxInputImages: 0 },
    });
    expect(
      fixed4K?.parameters?.find((parameter) => parameter.key === "imageSize"),
    ).toMatchObject({
      default: "4K",
      options: [{ label: "4K（型号固定）", value: "4K" }],
    });
    expect(
      fixed4K?.parameters?.find((parameter) => parameter.key === "aspectRatio")
        ?.options,
    ).toEqual(
      expect.arrayContaining([
        { label: "16:9 · 4K：5504×3072", value: "16:9" },
      ]),
    );

    const grokUnlimited = catalog.groups[compositeGroup]?.find(
      (model) => model.id === "grok-imagine-无限",
    );
    expect(
      grokUnlimited?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({ control: "dimensions", default: "1024x1024" });
    expect(
      catalog.groups[compositeGroup]?.find(
        (model) => model.id === "grok-imagine-image-quality",
      )?.parameters,
    ).toEqual([]);
    expect(
      catalog.groups[compositeGroup]?.find(
        (model) => model.id === "grok-imagine-image",
      )?.parameters,
    ).toEqual([]);
  });

  it("builds the documented endpoints and request mappings", () => {
    const catalog = cyberAfeiCatalogFromPricing(payload);
    const imageModels = catalog.groups[imageGroup] ?? [];
    const videoModels = catalog.groups[videoGroup] ?? [];
    const compositeModels = catalog.groups[compositeGroup] ?? [];
    const connector = cyberAfeiConnectorForModels([
      ...imageModels,
      ...videoModels,
      ...compositeModels,
    ]);

    expect(CYBERAFEI_BASE_URL).toBe("https://api.3365api.cn");
    expect(CYBERAFEI_API_BASE_URL).toBe("https://api.3365api.cn/v1");
    expect(connector.submit.path).toBe("/v1/images/generations");
    expect(connector.modelOverrides?.["video-v1-10s"]?.submit?.path).toBe(
      "/v1/video/generations",
    );
    expect(
      connector.modelOverrides?.["video-v1-10s"]?.poll?.response
        ?.statusFallbackPaths,
    ).toEqual(["$.data.status"]);
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-preview"]?.submit
        ?.path,
    ).toBe("/v1beta/models/gemini-3.1-flash-image-preview:generateContent");
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-preview"]?.submit
        ?.template,
    ).toMatchObject({ generationConfig: { responseModalities: ["IMAGE"] } });
    expect(
      connector.modelOverrides?.[
        "gemini-3.1-flash-image-preview"
      ]?.submit?.mappings?.filter((mapping) =>
        mapping.target.startsWith("/generationConfig/imageConfig/"),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "/generationConfig/imageConfig/aspectRatio",
          omitValues: ["auto"],
        }),
        expect.objectContaining({
          target: "/generationConfig/imageConfig/imageSize",
          omitValues: ["auto"],
        }),
      ]),
    );
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-preview"]?.output
        ?.base64FallbackPaths,
    ).toEqual(["inlineData.data", "text"]);
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-4k"]?.submit?.path,
    ).toBe("/v1beta/models/gemini-3.1-flash-image-4k:generateContent");
    expect(
      connector.modelOverrides?.["gemini-3.1-flash-image-4k"]?.submit?.template,
    ).toMatchObject({
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { imageSize: "4K" },
      },
    });
    expect(
      connector.modelOverrides?.[
        "gemini-3.1-flash-image-4k"
      ]?.submit?.mappings?.some(
        (mapping) =>
          mapping.target === "/generationConfig/imageConfig/imageSize",
      ),
    ).toBe(false);
    expect(
      connector.modelOverrides?.["grok-imagine-无限"]?.submit?.mappings?.map(
        (mapping) => mapping.target,
      ),
    ).toEqual(["/model", "/prompt", "/size"]);
    expect(
      connector.modelOverrides?.[
        "grok-imagine-image-quality"
      ]?.submit?.mappings?.map((mapping) => mapping.target),
    ).toEqual(["/model", "/prompt"]);
    expect(
      connector.modelOverrides?.["grok-imagine-image"]?.submit?.mappings?.map(
        (mapping) => mapping.target,
      ),
    ).toEqual(["/model", "/prompt"]);
    expect(
      connector.modelOverrides?.["grok-imagine-video-1.5-720p"],
    ).toMatchObject({
      submit: { path: "/v1/videos/generations" },
      poll: { path: "/v1/videos/{taskId}" },
    });
    expect(
      connector.modelOverrides?.["gpt-image-2-4K"]?.operationOverrides?.[
        "image.edit"
      ]?.submit,
    ).toMatchObject({
      path: "/v1/images/edits",
      method: "POST",
      bodyMode: "multipart",
    });
    expect(
      connector.modelOverrides?.["gpt-image-2-4K"]?.operationOverrides?.[
        "image.edit"
      ]?.submit?.mappings?.map((mapping) => mapping.target),
    ).toEqual([
      "/model",
      "/prompt",
      "/size",
      "/quality",
      "/n",
      "/response_format",
      "/image[]",
    ]);
    expect(
      connector.modelOverrides?.["gpt-image-2-4K"]?.operationOverrides?.[
        "image.edit"
      ]?.submit?.mappings?.find(
        (mapping) => mapping.target === "/response_format",
      )?.source,
    ).toEqual({ kind: "literal", value: "url" });
    expect(
      connector.modelOverrides?.["gpt-image-2-4K"]?.operationOverrides?.[
        "image.edit"
      ]?.submit?.mappings?.at(-1)?.source,
    ).toMatchObject({ kind: "assets", assetKind: "image", select: "all" });
    expect(connector.models?.map((model) => model.id)).toEqual(
      expect.arrayContaining(["gpt-image-2-2K", "gpt-image-2-4K"]),
    );
    expect(cyberAfeiDefaultModelForGroup(compositeGroup, compositeModels)).toBe(
      "gemini-3.1-flash-image-preview",
    );
    expect(cyberAfeiDefaultModelForGroup(imageGroup, imageModels)).toBe(
      "gpt-image-4K",
    );
  });
});
