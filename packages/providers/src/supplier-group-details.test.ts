import { describe, expect, it } from "vitest";
import { parseSupplierGroupDetails, supplierGroupPriceLabel, supplierGroupResolutionLabel } from "./supplier-group-details.js";

describe("supplier group evidence", () => {
  it("reads the saved Secure Skill group wording", () => {
    expect(parseSupplierGroupDetails({ name: "image2.5特价", description: "image2.5特价，0.06一张，124k", rate_multiplier: 1 }, "key-groups"))
      .toMatchObject({ referencePrice: "0.06一张", supportedResolutions: ["1K", "2K", "4K"], rateMultiplier: 1 });
  });
  it.each(["124K", "1/2/4K", "1.2.4k", "1、2、4K", "1K/2K/4K"])("reads a plain %s declaration and a Chinese per-image price", (resolutions) => {
    const description = `image2.5特价，0.06一张 ${resolutions}`;
    const details = parseSupplierGroupDetails({ name: "image2.5特价", description }, "key-groups");
    expect(details).toMatchObject({ referencePrice: description.split("，")[1], supportedResolutions: ["1K", "2K", "4K"] });
    expect(supplierGroupPriceLabel(details)).toBe(`${description.split("，")[1]}（分组说明参考）`);
  });
  it.each(["0.06一张", "0.06元一张", "每张0.06元", "一张0.06", "0.06元/张"])("keeps the declared price wording %s without guessing currency", (referencePrice) => {
    expect(parseSupplierGroupDetails({ description: referencePrice }, "key-groups")?.referencePrice).toBe(referencePrice);
  });
  it("recognizes standalone shared-unit resolutions but preserves exclusions and avoids unrelated numbers", () => {
    expect(parseSupplierGroupDetails({ description: "1,2,4K" }, "key-groups")?.supportedResolutions).toEqual(["1K", "2K", "4K"]);
    expect(parseSupplierGroupDetails({ description: "支持124K，不支持4K" }, "key-groups")).toMatchObject({ supportedResolutions: ["1K", "2K"], unsupportedResolutions: ["4K"] });
    expect(parseSupplierGroupDetails({ description: "不支持124K" }, "key-groups")?.unsupportedResolutions).toEqual(["1K", "2K", "4K"]);
    for (const description of ["支持1.24K", "支持1124K", "4K价格待定", "4K 0.06/张", "充值0.06元一张券"])
      expect(parseSupplierGroupDetails({ description }, "key-groups")?.supportedResolutions).toBeUndefined();
    expect(parseSupplierGroupDetails({ description: "充值0.06元一张券" }, "key-groups")?.referencePrice).toBeUndefined();
  });
  it("keeps the screenshot's price conditions and rejects 4K despite a price field", () => {
    const description = "1张0.015，量大1分，仅支持1K2K，不支持4K。充值1刀1毛";
    const details = parseSupplierGroupDetails({ name: "B3-GPT生图-特惠渠道", description, image_price_1k: 0.15, image_price_2k: 0.15, image_price_4k: 0.15 }, "key-groups");
    expect(details).toMatchObject({ description, referencePrice: "1张0.015；量大1分", supportedResolutions: ["1K", "2K"], unsupportedResolutions: ["4K"], exclusiveResolutions: true });
    expect(details?.imagePrices).toHaveLength(3);
    expect(supplierGroupResolutionLabel(details)).toBe("仅支持 1K / 2K；不支持 4K");
    expect(supplierGroupPriceLabel(details)).toBe("1张0.015；量大1分（分组说明参考）");
  });
  it("extracts concurrency and preserves explicit zero prices without inventing support or exchange rates", () => {
    const details = parseSupplierGroupDetails({ description: "原生6分/张。充值1刀1毛。每账号最大并发50，联系管理调。", image_price_1k: 0, image_price_2k: null, image_price_4k: 0.6, rate_multiplier: 1 }, "key-groups");
    expect(details).toMatchObject({ referencePrice: "原生6分/张", concurrencyLimit: 50, rateMultiplier: 1, imagePrices: [{ resolution: "1K", amount: 0 }, { resolution: "4K", amount: 0.6 }] });
    expect(details?.supportedResolutions).toBeUndefined();
    expect(parseSupplierGroupDetails({ description: "充值1刀1毛，2K价格待定", image_price_1k: "0.5", image_price_4k: -1 }, "key-groups")?.referencePrice).toBeUndefined();
  });
  it("does not treat a 4K price as proof of support or expand a 4K declaration to lower sizes", () => {
    const priced = parseSupplierGroupDetails({ image_price_4k: 0.7 }, "key-groups");
    expect(priced?.supportedResolutions).toBeUndefined();
    expect(supplierGroupPriceLabel(priced)).toBe("4K 0.7（分组后台额度/张）");
    expect(parseSupplierGroupDetails({ description: "原生4K，5分/张" }, "key-groups")).toMatchObject({ supportedResolutions: ["4K"], referencePrice: "5分/张" });
    expect(parseSupplierGroupDetails({ description: "不支持4k，仅支持1k、2k" }, "key-groups")).toMatchObject({ supportedResolutions: ["1K", "2K"], unsupportedResolutions: ["4K"] });
  });
});
