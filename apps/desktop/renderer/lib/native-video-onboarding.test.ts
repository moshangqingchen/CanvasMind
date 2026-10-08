import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { discoverSupplierModelInterfaces } from "./supplier-interface-discovery";
import { loadCangyuanCatalog, refreshSavedCangyuanPrices } from "./cangyuan-catalog";
import { modelEstimatedCost } from "./model-display";
import { applySupplierCatalogPrices } from "./supplier-model-pricing";

const cangyuanIds = ["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-5-260628"];
const rawModel = (id: string): ModelDescriptor => ({ id, name: id, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"],
  metadata: { canvasRunnable: true, parameterControlsUnavailable: true, priceLabel: "价格未公布", privatePermission: "keep" } });
const cangyuan = { provider: "openai", config: { supplierKey: "cangyuan", baseUrl: "https://ai.cangyuansuanli.cn", modelGroup: "VIDEO-Seedance官转", accountKeyGroup: "VIDEO-Seedance官转", usage: "canvas", customGroup: true, modelScanStatus: "live", scannedModelIds: cangyuanIds } };
const chuangxiang = { provider: "openai", config: { baseUrl: "https://vapi.chuangxiangai.asia/v1", modelGroup: "视频", modelScanStatus: "live" } };

describe("native video refresh pipeline", () => {
  it.each([
    { label: "Cangyuan", connection: cangyuan, ids: cangyuanIds, doc: "https://ai.cangyuansuanli.cn/docs-static/models/" },
    { label: "Chuangxiang", connection: chuangxiang, ids: ["sd8-seedance-2.5", "mm3-minimax-h3-2k", "kl1-kling-3.0"], doc: "https://vapi.chuangxiangai.asia/docs/video" },
  ])("keeps $label exact contracts through binding, pricing and interface discovery", async ({ connection, ids, doc }) => {
    const original = structuredClone(connection);
    const bound = bindScannedModelProtocols(connection, ids.map(rawModel));
    const read = vi.fn(async () => { throw new Error("Native contracts must not use the generic document compiler"); });
    const result = await discoverSupplierModelInterfaces(connection, bound.models, connection, read);
    expect(read).not.toHaveBeenCalled();
    expect(result.bindings).toEqual({});
    expect(result.models.map(model => model.id)).toEqual(ids);
    for (const model of result.models) {
      expect(model.parameters?.length).toBeGreaterThan(0);
      expect(model.metadata).toMatchObject({ canvasRunnable: true, privatePermission: "keep", priceLabel: "价格未公布" });
      expect(model.metadata?.documentationUrl).toContain(doc);
      expect(model.metadata).not.toHaveProperty("parameterControlsUnavailable");
      expect(model.metadata?.autoInterfaceStatus).not.toBe("incomplete");
      expect(model.outputKinds).toEqual(["video"]);
    }
    expect(connection).toEqual(original);
  });

  it("retains Key denial, unavailable catalogs and declared non-video output in the complete refresh pipeline", async () => {
    for (const connection of [cangyuan, chuangxiang]) {
      const id = connection === cangyuan ? cangyuanIds[0]! : "sd8-seedance-2.5";
      for (const config of [{ modelScanStatus: "unauthorized" }, { scannedModelIds: [] }, { supplierArchived: true }]) {
        const denied = { ...connection, config: { ...connection.config, ...config } };
        const bound = bindScannedModelProtocols(denied, [rawModel(id)]);
        const read = vi.fn(async () => []);
        const result = await discoverSupplierModelInterfaces(denied, bound.models, denied, read);
        expect(result.models[0]?.metadata?.canvasRunnable).toBe(false);
        expect(result.models[0]?.parameters?.length ?? 0).toBe(0);
        expect(result.bindings).toEqual({});
        expect(read).not.toHaveBeenCalled();
      }
      const unavailable: ModelDescriptor = { ...rawModel(id), metadata: { ...rawModel(id).metadata,
        canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "interface unavailable" } };
      const blocked = bindScannedModelProtocols(connection, [unavailable]);
      const unavailableRead = vi.fn(async () => []);
      const blockedDiscovery = await discoverSupplierModelInterfaces(connection, blocked.models, connection, unavailableRead);
      expect(blockedDiscovery.models[0]?.metadata).toMatchObject({ canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "interface unavailable" });
      expect(blockedDiscovery.models[0]?.parameters?.length ?? 0).toBe(0);
      expect(blockedDiscovery.bindings).toEqual({});
      expect(unavailableRead).not.toHaveBeenCalled();
      const model: ModelDescriptor = { ...rawModel(id), operations: [], outputKinds: ["text"],
        metadata: { catalogCapability: "chat", operationsSource: "declared", outputKindsSource: "declared", canvasRunnable: false, canvasUnavailableReason: "403 Key 未开通视频" } };
      const bound = bindScannedModelProtocols(connection, [model]);
      const result = await discoverSupplierModelInterfaces(connection, bound.models, connection, vi.fn(async () => []));
      expect(result.models[0]?.operations).toEqual([]);
      expect(result.models[0]?.outputKinds).toEqual(["text"]);
      expect(result.models[0]?.metadata?.canvasRunnable).toBe(false);
    }
  });

  it("leaves undocumented full IDs visible but unavailable without generic video parameters", () => {
    for (const connection of [cangyuan, chuangxiang]) {
      const id = "future-video-model";
      const result = bindScannedModelProtocols({ ...connection, config: { ...connection.config, scannedModelIds: [id] } }, [rawModel(id)]).models[0]!;
      expect(result.id).toBe(id);
      expect(result.metadata).toMatchObject({ canvasRunnable: false, parameterControlsUnavailable: true });
      expect(result.parameters).toEqual([]);
    }
  });

  it("restores the five exact Chuangxiang video IDs that the generic directory classified as inferred text", async () => {
    const ids = ["niulai-pro", "omni-fast", "omni-fast-no-water", "omni-v2v", "omni-v2v-no-water"];
    const models: ModelDescriptor[] = ids.map(id => ({ id, name: id, operations: [], outputKinds: ["text"], metadata: {
      canvasRunnable: false, canvasUnavailableReason: "尚未验证该模型的画布调用协议", operationsSource: "inferred", outputKindsSource: "inferred",
    } }));
    const connection = { ...chuangxiang, config: { ...chuangxiang.config, scannedModelIds: ids } };
    const bound = bindScannedModelProtocols(connection, models);
    const read = vi.fn(async () => []);
    const result = await discoverSupplierModelInterfaces(connection, bound.models, connection, read);
    expect(read).not.toHaveBeenCalled();
    expect(result.models.map(m => m.id)).toEqual(ids);
    for (const model of result.models) {
      expect(model.metadata?.canvasRunnable).toBe(true);
      expect(model.operations).toContain("video.generate");
      expect(model.outputKinds).toEqual(["video"]);
      expect(model.parameters?.length).toBeGreaterThan(0);
    }
    const declared: ModelDescriptor = { ...models[0]!, operations: [], metadata: { ...models[0]!.metadata, catalogCapability: "chat", operationsSource: "declared", outputKindsSource: "declared" } };
    expect(bindScannedModelProtocols(connection, [declared]).models[0]?.operations).toEqual([]);
    expect(bindScannedModelProtocols(connection, [declared]).models[0]?.outputKinds).toEqual(["text"]);
  });

  it("replaces stale generic bindings with the exact native contract without widening model IDs", async () => {
    const id = cangyuanIds[0]!;
    const connection = { ...cangyuan, config: { ...cangyuan.config, autoModelInterfaces: { [id]: {
      model: rawModel(id), sourceUrl: "https://ai.cangyuansuanli.cn/old.json",
      connector: { submit: { method: "POST", path: "/wrong-generic", bodyMode: "json" }, output: { kind: "video", path: "$.old" } },
    } } } };
    const model = { ...rawModel(id), metadata: { ...rawModel(id).metadata, autoInterfaceStatus: "incomplete", canvasRunnable: false, canvasUnavailableReason: "供应商接口说明待补充" } };
    const result = await discoverSupplierModelInterfaces(connection, [model], connection, vi.fn(async () => []));
    expect(result.bindings).toEqual({});
    expect(result.models.map(m => m.id)).toEqual([id]);
    expect(result.models[0]?.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 4, max: 15, default: 4 });
    expect(result.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(result.models[0]?.metadata?.autoInterfaceStatus).not.toBe("incomplete");
  });
});

describe("Cangyuan native group prices", () => {
  const payload = (groups = ["VIDEO-Seedance官转", "全模型-无claude/gpt"]) => ({
    group_ratio: { "VIDEO-Seedance官转": 0.5, "全模型-无claude/gpt": 2 },
    data: cangyuanIds.map(model_name => ({ model_name, tags: "video", request_unit: "request", billing_mode: "tiered_expr", enable_groups: groups,
      billing_expr: 'param("has_reference_video") ? tier("含参考视频", tok / 1e6 * 10) : tier("无参考视频", tok / 1e6 * 20)' })),
  });
  it("refreshes only the exact native group's token rates and applies its multiplier once", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload(["VIDEO-Seedance官转"])));
    const catalog = await loadCangyuanCatalog({ force: true, fetch: fetcher });
    expect(catalog.source).toBe("live");
    const original = cangyuanIds.map(id => ({ ...rawModel(id), metadata: { ...rawModel(id).metadata, priceSource: "supplier-catalog" }, pricing: { kind: "per-request" as const, unitAmount: 99, currency: "CNY", checkedAt: "old", confidence: "snapshot" as const } }));
    const models = await refreshSavedCangyuanPrices(cangyuan, original);
    expect(models.map(m => m.id)).toEqual(cangyuanIds);
    for (const model of models) {
      expect(model.pricing).toBeUndefined();
      expect(model.metadata?.priceLabel).toBe("含参考视频 ¥5/1M 视频 tokens · 无参考视频 ¥10/1M 视频 tokens");
      expect(model.metadata).toMatchObject({ privatePermission: "keep", cangyuanBillingVersion: 3, priceSource: "billing-expression" });
      expect(modelEstimatedCost(model, { duration: 8 })).toBeUndefined();
    }
    expect(original[0]?.pricing?.unitAmount).toBe(99);
    const generic = applySupplierCatalogPrices(models, "VIDEO-Seedance官转", { kind: "newapi", status: "live", checkedAt: "later", groups: [{
      id: "VIDEO-Seedance官转", label: "VIDEO-Seedance官转", source: "catalog", models: models.map(model => ({ id: model.id, capability: "video", priceLabel: "¥0/次" })),
    }] });
    expect(generic.map(model => model.metadata?.priceLabel)).toEqual(models.map(model => model.metadata?.priceLabel));
    expect(generic.every(model => model.pricing === undefined)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not substitute the all-model quote when the exact native group or model is absent", async () => {
    await loadCangyuanCatalog({ force: true, fetch: vi.fn(async () => Response.json(payload(["全模型-无claude/gpt"]))) });
    const models = [rawModel(cangyuanIds[0]!)];
    expect(await refreshSavedCangyuanPrices(cangyuan, models)).toEqual(models);
    await loadCangyuanCatalog({ force: true, fetch: vi.fn(async () => Response.json(payload())) });
    const unknown = [rawModel("doubao-seedance-future")];
    expect(await refreshSavedCangyuanPrices(cangyuan, unknown)).toEqual(unknown);
  });

  it("never applies the native group's price to another supplier origin or group", async () => {
    const models = [rawModel(cangyuanIds[0]!)];
    expect(await refreshSavedCangyuanPrices({ ...cangyuan, config: { ...cangyuan.config, baseUrl: "https://unrelated.example" } }, models)).toEqual(models);
    expect(await refreshSavedCangyuanPrices({ ...cangyuan, config: { ...cangyuan.config, modelGroup: "VIDEO-Seedance其他" } }, models)).toEqual(models);
  });

  it("preserves manually owned and measured prices while refreshing imported catalog quotes", async () => {
    await loadCangyuanCatalog({ force: true, fetch: vi.fn(async () => Response.json(payload())) });
    const manual = [undefined, "manual", "generated-result"].map(priceSource => ({ ...rawModel(cangyuanIds[0]!),
      pricing: { kind: "per-request" as const, unitAmount: 0.7, currency: "CNY", checkedAt: "manual", confidence: "exact" as const },
      metadata: { ...rawModel(cangyuanIds[0]!).metadata, priceSource, priceLabel: "¥0.7/次" } }));
    expect(await refreshSavedCangyuanPrices(cangyuan, manual)).toEqual(manual);
  });
});
