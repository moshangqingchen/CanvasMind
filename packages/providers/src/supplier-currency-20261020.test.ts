import { describe, expect, it } from "vitest";
import { parseSupplierCatalog } from "./supplier-catalog.js";

const payload = (currency?: string) => ({ success: true, group_ratio: { IMAGE: 2 },
  data: [{ model_name: "gpt-image-2-4k", enable_groups: ["IMAGE"], quota_type: 1, model_price: 0.1,
    ...(currency ? { currency } : {}) }] });

describe("Cangyuan native catalog currency", () => {
  it("keeps independent price reads in yuan and applies the exact group ratio once", () => {
    const parsed = parseSupplierCatalog(payload(), { supplierSiteUrl: "https://ai.cangyuansuanli.cn" });
    expect(parsed.groups[0]?.models[0]?.priceLabel).toBe("¥0.2/请求");
  });

  it("preserves explicit row and caller currency conventions", () => {
    expect(parseSupplierCatalog(payload("USD"), { supplierSiteUrl: "https://ai.cangyuansuanli.cn" })
      .groups[0]?.models[0]?.priceLabel).toBe("$0.2/请求");
    expect(parseSupplierCatalog(payload(), { supplierSiteUrl: "https://ai.cangyuansuanli.cn", currency: "USD", multiplier: 3 })
      .groups[0]?.models[0]?.priceLabel).toBe("$0.6/请求");
  });

  it.each(["https://ai.cangyuansuanli.cn.evil.invalid", "https://supplier.invalid", "https://ai.cangyuansuanli.cn/other"])
    ("does not lend its native convention to %s", supplierSiteUrl => {
      expect(parseSupplierCatalog(payload(), { supplierSiteUrl }).groups[0]?.models[0]?.priceLabel).toBe("$0.2/请求");
    });
});

describe("Chentu native catalog currency", () => {
  it("keeps the same yuan tariff when an independent generic source follows the dedicated collector", () => {
    const source = { supplierSiteUrl: "https://tu.988236.xyz" };
    expect(parseSupplierCatalog(payload(), source).groups[0]?.models[0]?.priceLabel).toBe("¥0.2/请求");
    expect(parseSupplierCatalog(payload("USD"), source).groups[0]?.models[0]?.priceLabel).toBe("$0.2/请求");
    expect(parseSupplierCatalog(payload(), { ...source, currency: "USD" }).groups[0]?.models[0]?.priceLabel).toBe("$0.2/请求");
  });

  it.each(["https://tu.988236.xyz.evil.invalid", "https://tu.988236.xyz/custom", "https://user@tu.988236.xyz"])
    ("does not apply the official currency convention to %s", supplierSiteUrl => {
      expect(parseSupplierCatalog(payload(), { supplierSiteUrl }).groups[0]?.models[0]?.priceLabel).toBe("$0.2/请求");
    });
});
