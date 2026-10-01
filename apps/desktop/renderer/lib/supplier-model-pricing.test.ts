import { describe, expect, it, vi } from "vitest";
import type {
  ModelDescriptor,
  SupplierCatalogDiscovery,
} from "@super-canvas/providers";
vi.mock("./supplier-service", () => ({
  getSupplierRecord: vi.fn(async () => null),
}));
vi.mock("./server", () => ({
  repository: { getSupplierVerification: vi.fn(async () => null) },
}));
vi.mock("@super-canvas/providers", async (original) => ({
  ...(await original<typeof import("@super-canvas/providers")>()),
  discoverSupplierCatalog: vi.fn(async () => ({
    kind: "newapi",
    status: "live",
    checkedAt: "now",
    groups: [
      {
        id: "new-group",
        label: "New group",
        source: "catalog",
        models: [{ id: "new-image", priceLabel: "$0.02/张" }],
      },
    ],
  })),
  loginSupplierSite: vi.fn(async () => ({ kind: "newapi", fetch: vi.fn() })),
}));
import { discoverSupplierCatalog, encryptSecret, loginSupplierSite, SupplierLoginError } from "@super-canvas/providers";
import { getSupplierRecord } from "./supplier-service";
import { repository } from "./server";
import { modelPriceSummary } from "./model-display";
import { requireServerMasterKey } from "./master-key";
import {
  applySupplierCatalogPrices,
  enrichSupplierModelPrices,
  measuredPricesFromVerification,
  applyDocumentedModelPrice,
} from "./supplier-model-pricing";
const model: ModelDescriptor = {
  id: "new-image",
  name: "new-image（价格以平台为准）",
  operations: [],
  metadata: { canvasRunnable: false },
};
const catalog: SupplierCatalogDiscovery = {
  kind: "newapi",
  status: "live",
  checkedAt: "now",
  groups: [
    {
      id: "cheap",
      label: "cheap",
      source: "catalog",
      models: [
        { id: "new-image", capability: "image", priceLabel: "$0.02/张" },
      ],
    },
    {
      id: "expensive",
      label: "expensive",
      source: "catalog",
      models: [{ id: "new-image", capability: "image", priceLabel: "$0.2/张" }],
    },
  ],
};

describe("universal supplier price lookup", () => {
  it("reinterprets cached group descriptions with compact resolutions and Chinese price units", () => {
    const image: ModelDescriptor = { ...model, id: "gpt-image-2.5-all", operations: ["image.generate"], metadata: { priceLabel: "价格未公布", priceSource: "supplier-catalog" } };
    const group = { id: "image2.5特价", label: "image2.5特价", source: "catalog" as const, models: [], details: { source: "key-groups" as const, description: "image2.5特价，0.06一张 124K" } };
    const result = applySupplierCatalogPrices([image], group.id, { ...catalog, groups: [group] })[0]!;
    expect(result.metadata).toMatchObject({ priceLabel: "0.06一张 124K（分组说明参考）", priceSource: "supplier-group", priceStatus: "available", supplierGroupResolutionLabel: "说明支持 1K / 2K / 4K" });
    expect(result.pricing).toBeUndefined(); // The supplier's wording does not specify a currency.
    for (const size_tier of ["1K", "2K", "4K"])
      expect(modelPriceSummary(result, { size_tier, quality: "high" })).toBe("0.06一张 124K（分组说明参考）");
    expect(applySupplierCatalogPrices([image], group.id, { ...catalog, groups: [{ ...group, details: { ...group.details, stale: true } }] })[0]?.metadata?.priceStatus).toBe("unpublished");
    expect(group.details).not.toHaveProperty("referencePrice");
  });
  it("reads scoped documentation before measured fallback and retains conditional wording", () => {
    const missing = {...model, metadata:{priceLabel:"价格未公布"}};
    expect(applyDocumentedModelPrice(missing, "new-image：¥0.16/张", "https://example.com/docs").pricing?.unitAmount).toBe(0.16);
    expect(applyDocumentedModelPrice(missing, "other-image：¥0.99/张", "https://example.com/docs").pricing).toBeUndefined();
    const tiered = applyDocumentedModelPrice(missing, "new-image：4K max ¥0.3/张，high ¥0.1/张", "https://example.com/docs");
    expect(tiered.pricing).toBeUndefined();
    expect(tiered.metadata?.priceLabel).toContain("4K max");
  });
  it("fills an unpublished price from a successful exact charge and keeps published prices first", async () => {
    const image: ModelDescriptor = { ...model, operations: ["image.generate"] };
    const supplier = { id: "supplier", apiUrl: "https://price-evidence.example/v1", siteUrl: "https://price-evidence.example", state: { sourceId: "source" },
      catalog: { groups: [{ id: "images", label: "images", models: [] }] }, kind: "newapi", scanStatus: "live", scannedAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z" };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    vi.mocked(repository.getSupplierVerification).mockResolvedValue({ sourceId: "source", cases: [{ sourceId: "source", status: "succeeded", requestId: "request", group: "images", modelId: image.id, resolution: "4K", quality: "max",
      actualCharge: { amount: 0.4, currency: "CNY", unit: "image", requestId: "request", checkedAt: "2026-09-23T00:00:00.000Z" } }] } as unknown as Awaited<ReturnType<typeof repository.getSupplierVerification>>);
    const connection = { config: { supplierId: "supplier", supplierSourceId: "source", baseUrl: supplier.apiUrl, modelGroup: "images" } };
    const result = await enrichSupplierModelPrices(connection, [image], false, false);
    expect(result[0]?.metadata).toMatchObject({ priceLabel: "¥0.4/张（生成实测） · 4K / max", priceSource: "generated-result" });
    expect(result[0]?.pricing).toBeUndefined();
    vi.mocked(getSupplierRecord).mockResolvedValue({ ...supplier, catalog: { groups: [{ id: "images", label: "images", models: [{ id: image.id, capability: "image", priceLabel: "¥0.2/张" }] }] } } as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const published = await enrichSupplierModelPrices(connection, result, false, false);
    expect(published[0]?.metadata).toMatchObject({ priceLabel: "¥0.2/张", priceSource: "supplier-catalog" });
    const wrongSource = await enrichSupplierModelPrices({ config: { ...connection.config, baseUrl: "https://other-price-evidence.example/v1" } }, [image], false, false);
    expect(wrongSource[0]?.metadata?.priceSource).toBeUndefined();
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
    vi.mocked(repository.getSupplierVerification).mockResolvedValue(null);
  });

  it("uses the latest exact generation charge as the final pricing evidence", () => {
    const prices = measuredPricesFromVerification({
      cases: [
        {
          group: "cheap",
          modelId: "new-image",
          status: "succeeded",
          requestId: "old-request",
          updatedAt: "2026-09-20T00:00:00.000Z",
          actualCharge: {
            amount: 0.11,
            currency: "USD",
            unit: "image",
            checkedAt: "2026-09-20T00:00:00.000Z",
            requestId: "old-request",
          },
        },
        {
          group: "cheap",
          modelId: "new-image",
          status: "succeeded",
          requestId: "new-request",
          resolution: "4K",
          quality: "max",
          parameters: { size: "3840x2160", quality: "max", n: 1 },
          updatedAt: "2026-09-21T00:00:00.000Z",
          actualCharge: {
            amount: 0.12,
            currency: "USD",
            unit: "image",
            checkedAt: "2026-09-21T00:00:00.000Z",
            requestId: "new-request",
          },
        },
        {
          group: "cheap",
          modelId: "text-model",
          status: "succeeded",
          requestId: "text-request",
          actualCharge: {
            amount: 9,
            currency: "USD",
            unit: "request",
            requestId: "text-request",
          },
        },
      ],
    });
    expect(prices.get("cheap\u0000new-image")).toMatchObject({
      label: "$0.12/张（生成实测） · 4K / max",
      amount: 0.12,
      currency: "USD",
      unit: "image",
      resolution: "4K",
      quality: "max",
      parameters: { size: "3840x2160", quality: "max", n: 1 },
    });
    expect(prices.has("cheap\u0000text-model")).toBe(true);
    expect(measuredPricesFromVerification({ cases: [{ group: "cheap", modelId: "bad", actualCharge: { amount: -1, currency: "USD", unit: "image" } }] })).toEqual(new Map());
    expect(measuredPricesFromVerification({ sourceId: "new", cases: [{ sourceId: "old", status: "succeeded", requestId: "request", group: "cheap", modelId: "old-image", actualCharge: { requestId: "request", amount: 0.12, currency: "USD", unit: "image" } }] })).toEqual(new Map());
    expect(measuredPricesFromVerification({ cases: [{ status: "succeeded", requestId: "request", group: "cheap", modelId: "unmatched", actualCharge: { requestId: "other", amount: 0.12, currency: "USD", unit: "image" } }] })).toEqual(new Map());
  });

  it("uses group prices only as image references and keeps explicit model prices first", () => {
    const image = { ...model, id: "gpt-image-2", operations: ["image.generate"] as const };
    const groups = [{id:"images", label:"Images", source:"catalog" as const, models:[], details:{source:"key-groups" as const, description:"1张0.015，仅支持1K2K，不支持4K", referencePrice:"1张0.015", supportedResolutions:["1K","2K"], unsupportedResolutions:["4K"],exclusiveResolutions:true}}];
    const result = applySupplierCatalogPrices([image, model], "images", { ...catalog, groups });
    expect(result[0]?.metadata).toMatchObject({ priceLabel:"1张0.015（分组说明参考）", priceSource:"supplier-group", supplierGroupResolutionLabel:"仅支持 1K / 2K；不支持 4K" });
    expect(result[0]?.parameters).toEqual(image.parameters);
    expect(result[1]?.metadata?.priceLabel).toBe("1张0.015（分组说明参考）"); // Image ID is sufficient even before protocol adaptation.
    expect(applySupplierCatalogPrices([{ ...model, id:"chat-model" }], "images", { ...catalog, groups })[0]?.metadata?.priceLabel).toBe("价格未公布");
    expect(applySupplierCatalogPrices([image], "other", { ...catalog, groups })[0]?.metadata?.priceLabel).toBe("价格未公布");
    const explicit = { ...groups[0]!, models:[{id:image.id, capability:"image" as const,priceLabel:"$0.3/张"}] };
    expect(applySupplierCatalogPrices([image], "images", { ...catalog, groups:[explicit] })[0]?.metadata?.priceLabel).toBe("$0.3/张");
    const failed = applySupplierCatalogPrices(result, "images", { ...catalog, groups:[],status:"failed" });
    expect(failed[0]?.metadata).toMatchObject({priceLabel:"1张0.015（分组说明参考）（上次价格）",supplierGroupInfoStale:true});
    const cleared = applySupplierCatalogPrices(result, "images", { ...catalog, groups: [{...groups[0]!,details:undefined}] });
    expect(cleared[0]?.metadata?.priceLabel).toBe("价格未公布");
    expect(cleared[0]?.metadata?.supplierGroupResolutionLabel).toBeUndefined();
  });
  it("joins exact group/model IDs without granting model availability", () => {
    const priced = applySupplierCatalogPrices(
      [model, { ...model, id: "NEW-image" }],
      "cheap",
      catalog,
    );
    expect(priced[0]?.metadata).toMatchObject({
      priceLabel: "$0.02/张",
      canvasRunnable: false,
    });
    expect(priced[1]?.metadata?.priceLabel).toBe("价格未公布");
    expect(
      applySupplierCatalogPrices([model], "expensive", catalog)[0]?.metadata
        ?.priceLabel,
    ).toBe("$0.2/张");
    expect(
      applySupplierCatalogPrices([model], "missing", catalog)[0]?.metadata
        ?.priceLabel,
    ).toBe("价格未公布");
  });
  it("updates previously discovered prices and labels cached prices on failure", () => {
    const old = applySupplierCatalogPrices([model], "expensive", catalog);
    expect(
      applySupplierCatalogPrices(old, "cheap", catalog)[0]?.metadata
        ?.priceLabel,
    ).toBe("$0.02/张");
    const failed = applySupplierCatalogPrices(old, "cheap", {
      ...catalog,
      groups: [],
      status: "failed",
    });
    expect(failed[0]?.metadata).toMatchObject({
      priceLabel: "$0.2/张（上次价格）",
      priceStatus: "failed",
    });
    expect(
      applySupplierCatalogPrices([model], "cheap", {
        ...catalog,
        groups: [],
        status: "unauthorized",
      })[0]?.metadata?.priceLabel,
    ).toBe("价格需登录查询");
  });
  it("clears an unknown-price snapshot label after a login-gated lookup", () => {
    const result = applySupplierCatalogPrices([{ ...model, name: "new-image（价格以平台为准·快照）" }], "cheap", { ...catalog, status: "unauthorized", groups: [] });
    expect(result[0]?.name).toBe("new-image");
    expect(result[0]?.metadata?.priceLabel).toBe("价格需登录查询");
  });
  it("preserves a supplier adapter's own structured currency and price", () => {
    const known: ModelDescriptor = {
      ...model,
      pricing: {
        kind: "per-image",
        currency: "CNY",
        unitAmount: 0.025,
        checkedAt: "now",
        confidence: "exact",
      },
    };
    expect(applySupplierCatalogPrices([known], "cheap", catalog)[0]).toBe(
      known,
    );
  });
  it("queries the marketplace automatically for a new supplier and newly added model", async () => {
    const connection = {
      config: {
        baseUrl: "https://brand-new.example/v1",
        modelGroup: "new-group",
      },
    };
    const enriched = await enrichSupplierModelPrices(connection, [model], true);
    expect(discoverSupplierCatalog).toHaveBeenCalledWith(
      {
        siteUrl: "https://brand-new.example",
        apiUrl: "https://brand-new.example/v1",
        kind: "auto",
      },
      expect.any(Function),
    );
    expect(enriched[0]?.metadata?.priceLabel).toBe("$0.02/张");
    expect(enriched[0]?.name).toBe("new-image");
  });
  it("isolates price sessions and cache entries after token, user ID and authentication mode change", async () => {
    const siteUrl = "https://token-price-cache.invalid", apiUrl = `${siteUrl}/v1`;
    const encrypted = (secret: string) => encryptSecret(secret, requireServerMasterKey());
    const token = encrypted("fixture-price-token");
    const state = { version: 1, revision: 1, visibility: "visible", sourceId: "token-price-source", fingerprint: "fp", history: [],
      siteLogin: { authMode: "access-token", siteUrl, encryptedAccessToken: token, userId: "42" } };
    const supplier = { id: "token-price", apiUrl, siteUrl, state, catalog: { groups: [] }, kind: "newapi", scanStatus: "unscanned", updatedAt: "now" };
    const use = (login: Record<string, unknown>) => vi.mocked(getSupplierRecord).mockResolvedValue({ ...supplier, state: { ...state, siteLogin: login } } as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const connection = { config: { supplierId: supplier.id, supplierSourceId: state.sourceId, baseUrl: apiUrl, modelGroup: "new-group" } };
    vi.mocked(loginSupplierSite).mockClear();
    use(state.siteLogin);
    await enrichSupplierModelPrices(connection, [model], false, true);
    await enrichSupplierModelPrices(connection, [model], false, true);
    expect(loginSupplierSite).toHaveBeenCalledTimes(1);
    expect(loginSupplierSite).toHaveBeenLastCalledWith({ siteUrl, kind: "newapi", credentials: { accessToken: "fixture-price-token", userId: "42" } });
    use({ ...state.siteLogin, userId: "43" });
    await enrichSupplierModelPrices(connection, [model], false, true);
    expect(loginSupplierSite).toHaveBeenCalledTimes(2);
    use({ ...state.siteLogin, encryptedAccessToken: encrypted("replacement-price-token") });
    await enrichSupplierModelPrices(connection, [model], false, true);
    expect(loginSupplierSite).toHaveBeenCalledTimes(3);
    use({ authMode: "password", siteUrl, username: "account", encryptedPassword: encrypted("fixture-price-password") });
    await enrichSupplierModelPrices(connection, [model], false, true);
    expect(loginSupplierSite).toHaveBeenCalledTimes(4);
    expect(loginSupplierSite).toHaveBeenLastCalledWith({ siteUrl, kind: "newapi", credentials: { username: "account", password: "fixture-price-password" } });
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
  });
  it("reports a token session network failure as failed pricing rather than expired authentication", async () => {
    const siteUrl = "https://token-price-network.invalid", apiUrl = `${siteUrl}/v1`;
    const supplier = { id: "token-network", apiUrl, siteUrl, kind: "newapi", catalog: { groups: [] }, updatedAt: "now", scanStatus: "unscanned",
      state: { sourceId: "network-source", siteLogin: { authMode: "access-token", siteUrl, encryptedAccessToken: encryptSecret("fixture-network-token", requireServerMasterKey()) } } };
    vi.mocked(getSupplierRecord).mockResolvedValue(supplier as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    vi.mocked(loginSupplierSite).mockRejectedValueOnce(new SupplierLoginError("temporary network error", 502, "network"));
    const result = await enrichSupplierModelPrices({ config: { supplierId: supplier.id, supplierSourceId: "network-source", baseUrl: apiUrl } }, [model], false, true);
    expect(result[0]?.metadata?.priceLabel).toBe("价格查询失败");
    expect(result[0]?.metadata?.priceStatus).toBe("failed");
    vi.mocked(getSupplierRecord).mockResolvedValue(null);
  });
});
