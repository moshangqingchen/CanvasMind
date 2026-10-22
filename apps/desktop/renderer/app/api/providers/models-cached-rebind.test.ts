import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { remainingVideoModel, type ModelDescriptor, type RestConnectorConfig } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, prices: vi.fn(), network: vi.fn() }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../lib/supplier-model-pricing", () => ({ enrichSupplierModelPrices: mocks.prices }));
vi.mock("../../../lib/supplier-verification", () => ({ enrichVerifiedSupplierModels: async (_id: string, models: ModelDescriptor[]) => models }));

import { readProviderModelInventory } from "../../../lib/provider-model-inventory";
import { bindScannedModelProtocols } from "../../../lib/scanned-model-protocols";
import { MIAOWU_CHAT_VIDEO_OVERRIDE, MIAOWU_MODELS, miaowuConnectionConfig } from "../../../lib/miaowu-presets";

const id = "cached-transport-repair";
const modelId = "seedance-2.0-deal";
const read = (query = "") => readProviderModelInventory(new Request(`http://localhost/api/providers/${id}/models${query}`),
  { params: Promise.resolve({ id }) });

beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.prices.mockReset().mockImplementation(async (_connection: unknown, models: ModelDescriptor[]) => models);
  mocks.network.mockReset().mockRejectedValue(new Error("Cache repair must not contact upstream"));
  vi.stubGlobal("fetch", mocks.network);
});
afterEach(() => { expect(mocks.network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture(changed: "connector" | "modelProtocolTemplate" = "connector") {
  const model = structuredClone(MIAOWU_MODELS.find(row => row.id === modelId)!);
  let connection = await mocks.repository.saveConnection({ id, provider: "rest", name: "Miaowu cached transport", config: {
    ...miaowuConnectionConfig("default", modelId, [model]), modelScanStatus: "live", scannedModelIds: [modelId],
    modelScanRequestId: "current-request", modelScanCheckedAt: "2026-10-09T00:00:00Z", modelScanComplete: true,
    modelCatalogModels: [model],
  } });
  // Produce a current snapshot through the real binder, then restore an older
  // connector inventory while retaining the current displayed descriptors.
  for (let pass = 0; pass < 3; pass++) {
    const bound = bindScannedModelProtocols(connection, connection.config.modelCatalogModels as unknown as ModelDescriptor[]);
    connection = await mocks.repository.saveConnection({ ...connection, config: { ...connection.config,
      modelCatalogModels: bound.models as never, connector: bound.connector as never, modelProtocolTemplate: bound.templateConnector as never } });
  }
  const stable = connection;
  const config = { ...stable.config };
  for (const key of [changed]) {
    const connector = config[key] as unknown as RestConnectorConfig;
    config[key] = { ...connector, models: [] } as never;
  }
  const original = await mocks.repository.saveConnection({ ...stable, config });
  const rebound = bindScannedModelProtocols(original, original.config.modelCatalogModels as unknown as ModelDescriptor[]);
  expect(rebound.models).toEqual(original.config.modelCatalogModels);
  expect(rebound.models[0]?.metadata?.canvasRunnable).toBe(true);
  return { original, rebound };
}

describe("cached protocol repair persistence", () => {
  it.each(["dreamina-seedance-2-0-fast", "dreamina-seedance-2-0-mini"])("returns the complete Secure60 %s menu contract on repeated readonly reads without saving", async modelId => {
    const baseUrl = "https://token.secure-skill.com/v1";
    const current = remainingVideoModel("secure", modelId, undefined, { baseUrl, officialGroupId: "60" })!;
    const priceLabel = modelId.endsWith("fast") ? "480p ¥22.2/1M tokens；含参考视频 ¥13.2/1M tokens" : "480p ¥11.5/1M tokens；含参考视频 ¥7/1M tokens";
    const model = { ...current, metadata: { ...current.metadata, canvasRunnable: true, priceLabel,
      operationsSource: "declared", outputKindsSource: "declared" } };
    const original = await mocks.repository.saveConnection({ id, provider: "openai", name: "Secure60 exact mapped Key", encryptedSecret: "fixture-ciphertext", config: {
      baseUrl, supplierKey: "4stoken", accountKeyGroup: "海外sd-fast/mini", modelGroup: "海外sd-fast/mini", accountKeyGroupId: "60", accountKeyId: "fixture-existing-key",
      usage: "canvas", modelScanStatus: "live", modelScanComplete: true, scannedModelIds: [modelId], modelCatalogModels: [model] as never,
      userParameters: { duration: 12, resolution: "1080p", generate_audio: true },
    } });
    const save = vi.spyOn(mocks.repository, "saveConnection");
    for (let pass = 0; pass < 2; pass++) {
      const response = await read("?cached=1&readonly=1");
      expect(response.status).toBe(200);
      const models = await response.json() as ModelDescriptor[];
      expect(models).toHaveLength(1);
      expect(models[0]?.metadata).toMatchObject({ canvasRunnable: true, priceLabel, parameterSource: "supplier-documented-contract", videoMinDuration: 1, videoMaxDuration: 15 });
      expect(models[0]?.parameters?.map(parameter => parameter.key)).toEqual(expect.arrayContaining(["duration", "aspect_ratio", "resolution", "generate_audio", "watermark", "seed", "return_last_frame"]));
      expect(models[0]?.operations).toEqual(["video.generate", "video.image-to-video"]);
    }
    expect(save).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(id)).toEqual(original);
  });

  it("keeps Secure61's directory-only Kling entry blocked on readonly reads", async () => {
    const model: ModelDescriptor = { id: "kling-video-v4", name: "kling-video-v4", operations: ["video.generate", "video.image-to-video"], inputKinds: ["text", "image"], outputKinds: ["video"], parameters: [],
      metadata: { canvasRunnable: false, canvasUnavailableReason: "当前分组列出此型号，但尚未提供其参数与调用合同", priceLabel: "720p ¥0.35/秒 · 1080p ¥0.45/秒" } };
    const original = await mocks.repository.saveConnection({ id, provider: "openai", name: "Secure61 catalog", config: {
      baseUrl: "https://token.secure-skill.com/v1", supplierKey: "4stoken", accountKeyGroupId: "61", accountKeyGroup: "kling-video-v4", usage: "canvas",
      modelScanStatus: "live", scannedModelIds: [model.id], modelCatalogModels: [model] as never,
    } });
    const save = vi.spyOn(mocks.repository, "saveConnection");
    const response = await read("?cached=1&readonly=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ id: model.id, parameters: [], metadata: { canvasRunnable: false, priceLabel: model.metadata?.priceLabel } }]);
    expect(save).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(id)).toEqual(original);
  });

  async function nativeMiaowuFixture() {
    const model = structuredClone(MIAOWU_MODELS.find(row => row.id === modelId)!);
    model.metadata = { ...model.metadata, canvasRunnable: true, parameterSource: "dream.video_schema", videoSchemaStatus: "live", videoSchemaStale: false };
    const config = miaowuConnectionConfig("default", modelId, [model]);
    const connector = structuredClone(config.connector as unknown as RestConnectorConfig);
    connector.modelOverrides = { ...connector.modelOverrides, [modelId]: structuredClone(MIAOWU_CHAT_VIDEO_OVERRIDE) };
    return mocks.repository.saveConnection({ id, provider: "rest", name: "Native schema with legacy transport", config: {
      ...config, connector: connector as never, modelProtocolTemplate: structuredClone(connector) as never,
      modelCatalogModels: [model] as never, modelScanStatus: "live", scannedModelIds: [modelId], modelScanComplete: true,
    } });
  }

  it("removes a legacy Chat override from both saved transports once the exact native schema is known", async () => {
    await nativeMiaowuFixture();
    expect((await read()).status).toBe(200);
    const saved = (await mocks.repository.getConnection(id))!;
    for (const key of ["connector", "modelProtocolTemplate"]) {
      const connector = saved.config[key] as unknown as RestConnectorConfig;
      expect(connector.modelOverrides?.[modelId]).toBeUndefined();
      expect(connector.submit.path).toBe("/v1/videos");
      expect(connector.poll?.path).toBe("/v1/videos/{taskId}");
    }
    const save = vi.spyOn(mocks.repository, "saveConnection");
    expect((await read()).status).toBe(200);
    expect(save).not.toHaveBeenCalled();
  });

  it("does not resurrect an old Chat override when a fresh connector intentionally uses the native base", async () => {
    const previous = await nativeMiaowuFixture();
    const current = structuredClone(previous);
    const connector = current.config.connector as unknown as RestConnectorConfig;
    const overrides = { ...connector.modelOverrides };
    delete overrides[modelId];
    connector.modelOverrides = overrides;
    const result = bindScannedModelProtocols(current, current.config.modelCatalogModels as unknown as ModelDescriptor[], previous);
    expect(result.connector?.modelOverrides?.[modelId]).toBeUndefined();
    expect(result.templateConnector?.modelOverrides?.[modelId]).toBeUndefined();
  });

  it.each(["manual", "paid", "custom", "denied", "stale", "other-group"])("preserves a %s contract when considering legacy override removal", async kind => {
    const connection = await nativeMiaowuFixture();
    const model = (connection.config.modelCatalogModels as unknown as ModelDescriptor[])[0]!;
    if (kind === "manual") model.metadata = { ...model.metadata, source: "manual" };
    if (kind === "paid") model.metadata = { ...model.metadata, protocolEvidence: "paid-test" };
    if (kind === "denied") model.metadata = { ...model.metadata, canvasRunnable: false, canvasUnavailableReason: "上游 403 权限未开通" };
    if (kind === "stale") model.metadata = { ...model.metadata, videoSchemaStale: true };
    if (kind === "other-group") connection.config.accountKeyGroup = "vip";
    const connector = connection.config.connector as unknown as RestConnectorConfig;
    if (kind === "custom") connector.modelOverrides![modelId]!.submit!.path = "/custom/video/chat";
    const override = structuredClone(connector.modelOverrides![modelId]);
    const result = bindScannedModelProtocols(connection, [model]);
    if (kind === "denied") expect(result.models[0]?.metadata).toMatchObject({ canvasRunnable: false, canvasUnavailableReason: "上游 403 权限未开通" });
    else expect(result.connector?.modelOverrides?.[modelId]).toEqual(override);
  });

  it.each(["manual", "paid"])("preserves %s evidence stored only in the current connector", async kind => {
    const previous = await nativeMiaowuFixture();
    const current = structuredClone(previous);
    const connector = current.config.connector as unknown as RestConnectorConfig;
    const model = connector.models!.find(row => row.id === modelId)!;
    model.metadata = { ...model.metadata, ...(kind === "manual" ? { source: "manual" } : { protocolEvidence: "paid-test" }) };
    const result = bindScannedModelProtocols(current, current.config.modelCatalogModels as unknown as ModelDescriptor[], previous);
    expect(result.connector?.modelOverrides?.[modelId]).toEqual(MIAOWU_CHAT_VIDEO_OVERRIDE);
  });

  it.each(["connector", "modelProtocolTemplate"] as const)("persists a %s-only repair with unchanged models and does not write again", async changed => {
    const { original, rebound } = await fixture(changed);
    const save = vi.spyOn(mocks.repository, "saveConnection");
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rebound.models);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toEqual({ expected: original });
    const saved = (await mocks.repository.getConnection(id))!;
    expect(saved.config.connector).toEqual(rebound.connector);
    expect(saved.config.modelProtocolTemplate).toEqual(rebound.templateConnector);
    expect(saved.config.modelCatalogModels).toEqual(original.config.modelCatalogModels);
    expect(saved.config.scannedModelIds).toEqual([modelId]);
    expect(saved.config.modelScanCheckedAt).toBe(original.config.modelScanCheckedAt);
    expect(saved.config.modelScanRequestId).toBe("current-request");
    expect((saved.config.connector as unknown as RestConnectorConfig).models?.map(model => model.id)).toEqual([modelId]);
    save.mockClear();
    expect((await read()).status).toBe(200);
    expect(save).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(id)).toEqual(saved);
  });

  it("keeps an explicit cached=1 read non-writing even when a transport repair is needed", async () => {
    const { original, rebound } = await fixture();
    const save = vi.spyOn(mocks.repository, "saveConnection");
    const response = await read("?cached=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rebound.models);
    expect(save).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(id)).toEqual(original);
  });

  it.each(["replace", "delete"] as const)("discards a delayed repair after concurrent connection %s", async action => {
    const { original } = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    mocks.prices.mockImplementationOnce(async (_connection: unknown, models: ModelDescriptor[]) => { entered(); await pending; return models; });
    const responsePromise = read();
    await started;
    const current = action === "replace" ? await mocks.repository.saveConnection({ ...original, name: "New user choice",
      config: { ...original.config, modelScanRequestId: "newer-request", customUserChoice: true } }, { expected: original }) : null;
    if (action === "delete") await mocks.repository.deleteConnection(id);
    const save = vi.spyOn(mocks.repository, "saveConnection");
    release();
    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toEqual({ expected: original });
    expect(await mocks.repository.getConnection(id)).toEqual(current);
  });
});
