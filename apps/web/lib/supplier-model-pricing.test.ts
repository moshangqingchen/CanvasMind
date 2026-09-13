import { describe, expect, it, vi } from "vitest";
import type {
  ModelDescriptor,
  SupplierCatalogDiscovery,
} from "@super-canvas/providers";
vi.mock("./supplier-service", () => ({
  getSupplierRecord: vi.fn(async () => null),
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
}));
import { discoverSupplierCatalog } from "@super-canvas/providers";
import {
  applySupplierCatalogPrices,
  enrichSupplierModelPrices,
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
});
