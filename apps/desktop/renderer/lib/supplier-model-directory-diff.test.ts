import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "./client-api";
import type { SupplierCatalogModel, SupplierRecord } from "./client-suppliers";
import { modelCanvasUnavailableReason } from "./graph-ui";
import { filterPickerModels } from "./model-picker";
import { modelPriceSummary } from "./model-display";
import { catalogPickerDirectory, supplierCatalogDisplayPrice, supplierModelDirectoryDiff } from "./supplier-model-directory-diff";

const connection = { id: "key", provider: "openai", name: "当前 Key", apiKeySet: true, apiKey: "",
  config: { supplierId: "supplier", supplierSourceId: "source", modelGroup: "group", baseUrl: "https://supplier.invalid" } } as ProviderConnectionView;
const catalogModel = (id: string): SupplierCatalogModel => ({ id, name: id, capability: "video", outputKinds: ["video"], priceLabel: "¥0.62/秒" });
const supplier = (models: SupplierCatalogModel[]): SupplierRecord => ({ id: "supplier", supplierKey: "custom", apiUrl: "https://supplier.invalid",
  state: { sourceId: "source", visibility: "visible" }, scanStatus: "live", catalog: { groups: [{ id: "group", label: "分组", source: "catalog", models }] } } as SupplierRecord);
const keyModels: ModelDescriptor[] = Array.from({ length: 15 }, (_, i) => ({ id: `video-${i}`, name: `视频${i}`, operations: ["video.generate"], outputKinds: ["video"], metadata: { canvasRunnable: true } }));
const publicModels = [...Array.from({ length: 10 }, (_, i) => catalogModel(`video-${i}`)), ...Array.from({ length: 8 }, (_, i) => catalogModel(`official-video-${i}`))];

describe("public media directory differences", () => {
  it("reports public 18, Key 15, intersection 10 and eight public-only rows without changing Key models", () => {
    const before = structuredClone(keyModels);
    const result = catalogPickerDirectory(connection, [supplier(publicModels)], keyModels, "video-generation", true)!;
    expect(result).toMatchObject({ catalogCount: 18, keyCount: 15, sharedCount: 10, keyOnlyIds: ["video-10", "video-11", "video-12", "video-13", "video-14"] });
    expect(result.models).toHaveLength(8);
    expect(result.models.every(model => !model.operations.length && model.metadata?.publicCatalogOnly && modelCanvasUnavailableReason(model) === "官网已列出 · 当前 Key 未返回")).toBe(true);
    expect(result.models[0]?.metadata?.priceLabel).toBe("¥0.62/秒");
    expect(filterPickerModels([...keyModels, ...result.models], "", "all", "runnable", [])).toEqual(keyModels);
    expect(keyModels).toEqual(before);
    const authenticated = [...keyModels, ...result.models.map(model => ({ ...model, operations: ["video.generate" as const] }))];
    expect(catalogPickerDirectory(connection, [supplier(publicModels)], authenticated, "video-generation", true)).toMatchObject({ keyCount: 23, sharedCount: 18, catalogOnlyIds: [], models: [] });
  });

  it("matches exact full IDs once, retaining Key-only models and excluding same-name aliases from the intersection", () => {
    expect(supplierModelDirectoryDiff([{ id: "model" }, { id: "model" }, { id: "model-preview" }], [{ id: "model" }, { id: "model-long" }, { id: "model-long" }]))
      .toEqual({ catalogCount: 2, keyCount: 2, sharedCount: 1, catalogOnlyIds: ["model-long"], keyOnlyIds: ["model-preview"] });
  });

  it("keeps image, video and music output filters separate and excludes understanding and speech", () => {
    const models: SupplierCatalogModel[] = [catalogModel("video"), { id: "image", capability: "image", outputKinds: ["image"] },
      { id: "lyria-3-pro", capability: "music", outputKinds: ["audio"] }, { id: "tts-1", capability: "other", outputKinds: ["audio"] },
      { id: "image-understanding", capability: "image", inputKinds: ["image"], outputKinds: ["text"] }];
    expect(catalogPickerDirectory(connection, [supplier(models)], [], "image-generation", true)?.models.map(model => model.id)).toEqual(["image"]);
    expect(catalogPickerDirectory(connection, [supplier(models)], [], "video-generation", true)?.models.map(model => model.id)).toEqual(["video"]);
    expect(catalogPickerDirectory(connection, [supplier(models)], [], "music-generation", true)?.models.map(model => model.id)).toEqual(["lyria-3-pro"]);
  });

  it("never crosses supplier source or group identity, nor displays deleted or missing public groups", () => {
    const source = supplier(publicModels);
    expect(catalogPickerDirectory({ ...connection, config: { ...connection.config, supplierSourceId: "old" } }, [source], [], "video-generation", true)).toBeUndefined();
    expect(catalogPickerDirectory({ ...connection, config: { ...connection.config, modelGroup: "other" } }, [source], [], "video-generation", true)).toBeUndefined();
    expect(catalogPickerDirectory(connection, [{ ...source, state: { ...source.state!, visibility: "deleted" } }], [], "video-generation", true)).toBeUndefined();
    expect(catalogPickerDirectory(connection, [{ ...source, catalog: { groups: [{ ...source.catalog.groups[0]!, status: "missing" }] } }], [], "video-generation", true)).toBeUndefined();
  });

  it("reports pending Key or stale public records honestly and does not inherit public paid-verification metadata", () => {
    const source = supplier([{ ...catalogModel("video"), metadata: { canvasRunnable: true, imageCapabilitiesVerifiedAt: "untrusted-directory-value" } }]);
    const result = catalogPickerDirectory(connection, [source], [], "video-generation", false, true)!;
    expect(result).toMatchObject({ keyConfirmed: false, catalogStale: true });
    expect(modelCanvasUnavailableReason(result.models[0]!)).toBe("官网已列出 · Key 目录待确认");
    expect(filterPickerModels(result.models, "", "all", "verified", [])).toEqual([]);
    const old = supplier([{ ...catalogModel("video"), metadata: { supplierCatalogModelStale: true, supplierCatalogPriceCheckedAt: "2026-10-07T18:00:00Z",
      secureSkillCatalogPricing: { kind: "per-second", currency: "CNY", billingUnit: "second", unitAmount: .62, checkedAt: "2026-10-07T18:00:00Z", sourceUrl: "https://supplier.invalid/pricing", confidence: "exact" } } }]);
    old.catalog.groups[0]!.details = { stale: true } as NonNullable<typeof old.catalog.groups[number]["details"]>;
    const oldDirectory = catalogPickerDirectory(connection, [old], [], "video-generation", true)!;
    expect(oldDirectory.catalogStale).toBe(true);
    expect(oldDirectory.models[0]?.metadata).toMatchObject({ priceLabel: "¥0.62/秒（上次价格）", priceStatus: "partial", priceCheckedAt: "2026-10-07T18:00:00Z" });
    expect(modelPriceSummary(oldDirectory.models[0], {})).toBe("上次 0.62 CNY / 秒");
    expect(supplierCatalogDisplayPrice({ ...catalogModel("video"), priceLabel: "价格未公布", metadata: { supplierCatalogModelStale: true } })).toBe("价格目录未完整读取");
    expect(supplierCatalogDisplayPrice({ ...catalogModel("video"), metadata: { supplierCatalogModelStale: true } })).toBe("¥0.62/秒（上次价格）");
    expect(supplierCatalogDisplayPrice({ ...catalogModel("video"), priceLabel: "¥0.62/秒（上次价格）", metadata: { supplierCatalogModelStale: true } })).toBe("¥0.62/秒（上次价格）");
  });
});
