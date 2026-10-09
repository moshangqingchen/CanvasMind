import { afterEach, beforeEach, expect, it, vi } from "vitest";
const offline = vi.hoisted(() => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]), fetch: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: offline.lookup }));
import {
  createDefaultProviderRegistry, StaticConnectionResolver, MIAOWU_VIDEO_CONTRACT_PENDING_REASON,
  type DocumentedModelInterface, type ModelDescriptor, type NormalizedRequest, type RestConnectorConfig,
} from "@super-canvas/providers";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { discoverSupplierModelInterfaces } from "./supplier-interface-discovery";
import { miaowuCatalogFromPricing, miaowuConnectorForModels, miaowuUnparameterizedVideoDescriptor } from "./miaowu-catalog";
import { MIAOWU_CHAT_VIDEO_OVERRIDE, MIAOWU_CONNECTOR } from "./miaowu-presets";

const ids = ["dreamina-seedance-2.0-fast", "dreamina-seedance-2.0-mini", "seedance-2.0-fast-deal", "seedance-2.5-deal", "video-editing"];
const image = { id: "image", kind: "image" as const, mimeType: "image/png", url: "https://media.example/source.png" };
const videos = [1, 2].map(index => ({ id: `video-${index}`, kind: "video" as const, mimeType: "video/mp4", url: `https://media.example/source-${index}.mp4` }));
beforeEach(() => {
  offline.fetch.mockReset().mockRejectedValue(new Error("Unexpected real network in Miaowu contract regression"));
  vi.stubGlobal("fetch", offline.fetch);
});
afterEach(() => { try { expect(offline.fetch).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });
const raw = (id: string): ModelDescriptor => ({
  ...miaowuUnparameterizedVideoDescriptor(id, { group: "default", parameterSource: "key-model-scan" }),
  pricing: { kind: "per-request", currency: "CNY", unitAmount: 1, confidence: "exact", checkedAt: "2026-10-08T00:00:00Z" },
  metadata: { ...miaowuUnparameterizedVideoDescriptor(id).metadata, canvasRunnable: true },
});

function fixture(models: ModelDescriptor[] = ids.map(raw)) {
  const connector: RestConnectorConfig = { ...structuredClone(MIAOWU_CONNECTOR), models: structuredClone(models),
    modelOverrides: Object.fromEntries(models.map(model => [model.id, structuredClone(MIAOWU_CHAT_VIDEO_OVERRIDE)])) };
  const config: Record<string, unknown> = { preset: "miaowu-openai-videos", supplierKey: "miaowu", baseUrl: "https://api.miaowuai.store",
    usage: "canvas", modelGroup: "default", modelScanStatus: "live", scannedModelIds: models.map(model => model.id),
    modelCatalogModels: models, connector };
  return { provider: "rest", config };
}

function documented(model: ModelDescriptor): DocumentedModelInterface {
  return { sourceUrl: "https://api.miaowuai.store/docs/exact-fixture", model,
    connector: { submit: { method: "POST", path: "/documented-video", bodyMode: "json", mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    ] }, output: { kind: "video", path: "$.video_url" } } };
}

it("repairs five old pending cache contracts repeatedly without changing exact IDs or prices and submits the real Chat transport", async () => {
  let connection = fixture();
  const original = structuredClone(connection);
  let models: ModelDescriptor[] = (connection.config.modelCatalogModels as ModelDescriptor[]).map(model => ({ ...model, metadata: { ...model.metadata,
    canvasRunnable: false, miaowuVideoContractPending: true, canvasUnavailableReason: MIAOWU_VIDEO_CONTRACT_PENDING_REASON } }));
  for (let pass = 0; pass < 3; pass++) {
    const bound = bindScannedModelProtocols(connection, models);
    expect(bound.models.map(model => model.id)).toEqual(ids);
    for (const model of bound.models) {
      expect(model.metadata).toMatchObject({ canvasRunnable: true, protocol: "openai-chat", generationVerified: false });
      expect(model.metadata?.miaowuVideoContractPending).not.toBe(true);
      expect(model.metadata?.canvasUnavailableReason).toBeUndefined();
      expect(model.parameters).toEqual([]);
      expect(model.pricing).toEqual(original.config.modelCatalogModels instanceof Array
        ? original.config.modelCatalogModels.find((row: ModelDescriptor) => row.id === model.id)?.pricing : undefined);
      expect(model.limits?.maxInputImages).toBeUndefined();
      expect(model.operations).toEqual(model.id === "video-editing" ? ["video.generate"] : ["video.generate", "video.image-to-video"]);
    }
    const read = vi.fn(async () => []);
    const discovered = await discoverSupplierModelInterfaces(connection, bound.models, connection, read);
    expect(discovered.bindings).toEqual({});
    expect(discovered.models.every(model => model.metadata?.canvasRunnable === true)).toBe(true);
    expect(read).not.toHaveBeenCalled();
    models = discovered.models;
    connection = { ...connection, config: { ...connection.config, connector: bound.connector,
      modelProtocolTemplate: bound.templateConnector, modelCatalogModels: models, autoModelInterfaces: discovered.bindings } };
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: `[Video](https://media.example/${body.model}.mp4)` } }] });
    });
    const registry = createDefaultProviderRegistry(new StaticConnectionResolver([{ id: "isolated-miaowu", provider: "rest",
      baseUrl: String(connection.config.baseUrl), apiKey: "synthetic-miaowu-key", settings: connection.config }]), { fetch: fetcher });
    const adapter = await registry.forConnection("isolated-miaowu");
    for (const id of ids) {
      const request: NormalizedRequest = { connectionId: "isolated-miaowu", model: id,
        operation: id === "video-editing" ? "video.generate" : "video.image-to-video",
        idempotencyKey: `isolated-${pass}-${id}`, prompt: "Ocean", parameters: { duration: 8, resolution: "4K", trim: true },
        assets: id === "video-editing" ? videos : [image] };
      expect((await adapter.validate(request)).valid).toBe(true);
      const task = await adapter.submit(request);
      expect(task.status).toBe("succeeded");
      expect(await adapter.extractOutputs(task.result)).toEqual([{ kind: "video", url: `https://media.example/${id}.mp4` }]);
      const [url, init] = fetcher.mock.calls.at(-1)!;
      expect(String(url)).toBe("https://api.miaowuai.store/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-miaowu-key");
      expect(JSON.parse(String(init?.body))).toEqual({ model: id, stream: false, messages: [{ role: "user", content: id === "video-editing"
        ? `Ocean\n参考视频 1: ${videos[0]!.url}\n参考视频 2: ${videos[1]!.url}`
        : [{ type: "text", text: "Ocean" }, { type: "image_url", image_url: { url: image.url, detail: "high" } }] }] });
    }
    expect(fetcher).toHaveBeenCalledTimes(ids.length);
    for (const assets of [[], [{ ...videos[0]!, url: "http://media.example/source.mp4" }]]) {
      const request: NormalizedRequest = { connectionId: "isolated-miaowu", model: "video-editing", operation: "video.generate",
        idempotencyKey: `rejected-edit-${pass}`, prompt: "Ocean", assets };
      expect((await adapter.validate(request)).valid).toBe(false);
      await expect(adapter.submit(request)).rejects.toThrow();
    }
    expect(fetcher).toHaveBeenCalledTimes(ids.length);
  }
  expect(original.config.connector).toMatchObject({ modelOverrides: { [ids[0]!]: MIAOWU_CHAT_VIDEO_OVERRIDE } });
});

it("builds the declared five Chat overrides while retaining six native video_api contracts and other descriptors", () => {
  const knownIds = ["seedance-2.0-mini-deal", "sora-2", "minimax-h3", "wan3.0-video", "minimax-h3-max", "seedance-2.0-deal"];
  const known = miaowuCatalogFromPricing({ group_ratio: { default: 1 }, data: knownIds.map(model_name => ({
    model_name, model_price: 0.1, enable_groups: ["default"], video_api: { seconds_min: 5, seconds_max: 15,
      sizes: ["720p"], ratios: ["16:9"], images_max: 1, pricing: { unit: "per_call" } },
  })) }).models;
  const other = raw("seedance-2.0-mx");
  const models = [...known, ...ids.map(raw), other];
  const before = structuredClone(models);
  const connector = miaowuConnectorForModels(models);
  expect(models).toEqual(before);
  for (const id of ids) {
    expect(connector.modelOverrides?.[id]?.submit?.path).toBe("/v1/chat/completions");
    expect(connector.modelOverrides?.[id]?.output).toMatchObject({ kind: "video", format: "openai-chat-videos", requireOutput: true });
    expect(connector.models?.find(model => model.id === id)?.metadata).toMatchObject({ canvasRunnable: true, protocol: "openai-chat", generationVerified: false });
    expect(connector.models?.find(model => model.id === id)?.metadata?.miaowuVideoContractPending).not.toBe(true);
    expect(connector.models?.find(model => model.id === id)?.pricing).toEqual(before.find(model => model.id === id)?.pricing);
  }
  for (const id of knownIds) {
    const model = connector.models!.find(model => model.id === id)!;
    expect(model.metadata?.parameterSource).toBe("pricing.video_api");
    expect(model.metadata?.canvasRunnable).not.toBe(false);
    expect(model.parameters?.length).toBeGreaterThan(0);
    expect(model.pricing).toEqual(known.find(row => row.id === id)?.pricing);
  }
  expect(connector.modelOverrides?.[other.id]?.submit?.path).toBe("/v1/chat/completions");
});

it("preserves custom routes, exact saved bindings, manual or paid evidence and reopens only its own resolved pending marker", async () => {
  const id = ids[0]!;
  const initial = raw(id);
  const emptyOverride = fixture([initial]);
  (emptyOverride.config.connector as RestConnectorConfig).operationOverrides = {};
  expect(bindScannedModelProtocols(emptyOverride, [initial]).models[0]?.metadata?.canvasRunnable).toBe(true);
  expect((emptyOverride.config.connector as RestConnectorConfig).operationOverrides).toEqual({});
  for (const proof of [{ source: "manual" }, { protocolEvidence: "paid-test" }, { parameterSource: "pricing.video_api" }]) {
    const model = { ...initial, metadata: { ...initial.metadata, ...proof } };
    expect(bindScannedModelProtocols(fixture([model]), [model]).models[0]?.metadata?.canvasRunnable).toBe(true);
  }
  for (const customization of ["model-endpoint", "base-endpoint", "mapping", "output"] as const) {
    const connection = fixture([initial]);
    const connector = connection.config.connector as RestConnectorConfig;
    if (customization === "model-endpoint") connector.modelOverrides![id]!.submit!.path = "/my-verified-video";
    if (customization === "base-endpoint") {
      connector.modelOverrides = {}; connector.submit.path = "/my-verified-video";
    }
    if (customization === "mapping") connector.modelOverrides![id]!.submit!.mappings = [
      { target: "/content", source: { kind: "request", path: "$.prompt" } },
    ];
    if (customization === "output") connector.modelOverrides![id]!.output!.path = "$.custom.video";
    const before = structuredClone(connector.modelOverrides?.[id]);
    const bound = bindScannedModelProtocols(connection, [initial]);
    expect(bound.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(bound.connector?.modelOverrides?.[id]).toEqual(before);
  }
  const connection = fixture([initial]);
  const pending = { ...initial, metadata: { ...initial.metadata, canvasRunnable: false, miaowuVideoContractPending: true,
    canvasUnavailableReason: MIAOWU_VIDEO_CONTRACT_PENDING_REASON } };
  const binding = documented(initial);
  connection.config.autoModelInterfaces = { [id]: binding };
  expect(bindScannedModelProtocols(connection, [pending]).models[0]?.metadata?.canvasRunnable).toBe(true);
  const incomplete = { ...pending, metadata: { ...pending.metadata, autoInterfaceStatus: "incomplete" } };
  expect(bindScannedModelProtocols(connection, [incomplete]).models[0]?.metadata?.canvasRunnable).toBe(false);
  const generateOnly = documented({ ...initial, operations: ["video.generate"] });
  connection.config.autoModelInterfaces = { [id]: generateOnly };
  const narrowed = bindScannedModelProtocols(connection, [pending]);
  expect(narrowed.models[0]?.metadata?.canvasRunnable).toBe(true);
  expect(narrowed.models[0]?.operations).toEqual(["video.generate"]);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ video_url: "https://media.example/verified.mp4" }));
  const settings = { ...connection.config, connector: narrowed.connector, modelCatalogModels: narrowed.models };
  const registry = createDefaultProviderRegistry(new StaticConnectionResolver([{ id: "documented-miaowu", provider: "rest",
    baseUrl: String(connection.config.baseUrl), apiKey: "synthetic-miaowu-key", settings }]), { fetch: fetcher });
  const adapter = await registry.forConnection("documented-miaowu");
  const input: NormalizedRequest = { connectionId: "documented-miaowu", model: id, operation: "video.generate",
    idempotencyKey: "documented-miaowu", prompt: "Ocean", parameters: {}, assets: [] };
  expect((await adapter.validate(input)).valid).toBe(true);
  await adapter.submit(input);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.miaowuai.store/documented-video");
  const unsupported = { ...input, operation: "video.image-to-video" as const };
  expect((await adapter.validate(unsupported)).valid).toBe(false);
  await expect(adapter.submit(unsupported)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const deniedBinding = { ...pending, metadata: { ...pending.metadata, canvasRunnable: false, canvasUnavailableReason: "401 unauthorized" } };
  expect(bindScannedModelProtocols(connection, [deniedBinding]).models[0]?.metadata?.canvasRunnable).toBe(false);
  expect(bindScannedModelProtocols(connection, [deniedBinding]).models[0]?.metadata?.canvasUnavailableReason).toBe("401 unauthorized");
  const incompletePartial = { ...pending, metadata: { ...pending.metadata, autoInterfaceStatus: "incomplete" } };
  expect(bindScannedModelProtocols(connection, [incompletePartial]).models[0]?.metadata?.canvasRunnable).toBe(false);
  delete connection.config.autoModelInterfaces;
  const custom = connection.config.connector as RestConnectorConfig;
  custom.modelOverrides![id]!.submit!.path = "/my-verified-video";
  const reopened = bindScannedModelProtocols(connection, [pending]).models[0]!;
  expect(reopened.metadata?.canvasRunnable).toBe(true);
  expect(reopened.metadata?.miaowuVideoContractPending).toBeUndefined();
});

it("retains existing denials and leaves other suppliers, groups and same-ID image or mixed output unchanged", () => {
  const id = ids[0]!;
  const denied = { ...raw(id), metadata: { ...raw(id).metadata, canvasRunnable: false, canvasUnavailableReason: "403 Key 未开通视频" } };
  expect(bindScannedModelProtocols(fixture([denied]), [denied]).models[0]?.metadata?.canvasUnavailableReason).toBe("403 Key 未开通视频");
  expect(miaowuConnectorForModels([denied]).models?.[0]?.metadata?.canvasUnavailableReason).toBe("403 Key 未开通视频");
  for (const change of [{ baseUrl: "https://another-supplier.invalid" }, { modelGroup: "vip" }, { preset: "custom" }]) {
    const model = raw(id), connection = fixture([model]);
    connection.config = { ...connection.config, ...change };
    expect(bindScannedModelProtocols(connection, [model]).models[0]?.metadata?.canvasRunnable).toBe(true);
  }
  for (const model of [
    { ...raw(id), operations: ["image.generate"] as const, outputKinds: ["image"] as const },
    { ...raw(id), operations: ["image.generate", "video.generate"] as const, outputKinds: ["image", "video"] as const },
  ]) {
    const connection = fixture([model]);
    expect(bindScannedModelProtocols(connection, [model]).models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(miaowuConnectorForModels([model]).models?.[0]?.metadata?.canvasRunnable).toBe(true);
  }
});
