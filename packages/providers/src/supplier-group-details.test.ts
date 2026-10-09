import { describe, expect, it } from "vitest";
import { parseSupplierGroupDetails, supplierGroupModelPriceDetails, supplierGroupMediaPriceDetails, supplierGroupPriceLabel, supplierGroupResolutionLabel, supplierTextMentionsModel } from "./supplier-group-details.js";

describe("supplier group evidence", () => {
  it("preserves Synora's shared screenshot quote for Image 2 and both Image 2.5 variants", () => {
    const details = parseSupplierGroupDetails({ name: "全参生图专线", description: "原生4k，image2和2.5均支持所有参数，0.07/张", rate_multiplier: 1 }, "key-groups")!;
    expect(details).toMatchObject({ referencePrice: "0.07/张", nativeResolutions: ["4K"], supportedResolutions: ["4K"], rateMultiplier: 1 });
    for (const id of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
      const scoped = supplierGroupMediaPriceDetails(supplierGroupModelPriceDetails(details, id), "image", id);
      expect(supplierGroupPriceLabel(scoped)).toBe("0.07/张（分组说明参考）");
      expect(scoped?.imagePrices).toBeUndefined();
    }
  });
  it("retains Mikoto's separate image and per-second video declarations without sharing their rates", () => {
    const details = parseSupplierGroupDetails({ name: "grok heavy", description: "图片 0.02一张\n视频 0.18/s", image_price_1k: .02 }, "key-groups")!;
    expect(details.referencePrice).toBe("图片 0.02一张；视频 0.18/s");
    const image = supplierGroupMediaPriceDetails(details, "image", "grok-imagine-image");
    expect(supplierGroupPriceLabel(image)).toBe("图片 0.02一张（分组说明参考）");
    const video = supplierGroupMediaPriceDetails(details, "video", "grok-imagine-video");
    expect(supplierGroupPriceLabel(video)).toBe("视频 0.18/s（分组说明参考）");
    expect(video?.imagePrices).toBeUndefined();
    expect(supplierGroupMediaPriceDetails(parseSupplierGroupDetails({ description: "生图5分一张" }, "key-groups"), "video", "grok-imagine-video")?.referencePrice).toBeUndefined();
  });
  it("uses only exact model-scoped video quotes when a mixed group does not label its modality", () => {
    const ids = ["grok-imagine-video", "grok-imagine-video-1.5"];
    const details = parseSupplierGroupDetails({ description: `${ids[0]} $0.18/秒\n${ids[1]} $0.3/次\n图片 0.02一张` }, "key-groups")!;
    expect(supplierGroupMediaPriceDetails(supplierGroupModelPriceDetails(details, ids[0]!, ids), "video", ids[0]!)?.referencePrice).toBe(`${ids[0]} $0.18/秒`);
    expect(supplierGroupMediaPriceDetails(supplierGroupModelPriceDetails(details, ids[1]!, ids), "video", ids[1]!)?.referencePrice).toBe(`${ids[1]} $0.3/次`);
    expect(supplierGroupMediaPriceDetails(details, "image", "grok-imagine-image")?.referencePrice).toBe("图片 0.02一张");
  });
  it("distinguishes pDog native 1K from upscaled 2K/4K using the group's explicit wording", () => {
    const details = parseSupplierGroupDetails({ name: "【生图】image2/2.5-1K2K4K(超分组)",
      description: "0.03/张，1K/2K/4K同价，1K为原生，2K4K为超分，比例可自由调整" }, "key-groups");
    expect(details).toMatchObject({ nativeResolutions: ["1K"], upscaledResolutions: ["2K", "4K"] });
    expect(supplierGroupResolutionLabel(details)).toContain("说明原生 1K；说明超分 2K / 4K");
    expect(parseSupplierGroupDetails({ description: "原生4K，0.06/张" }, "key-groups")?.nativeResolutions).toEqual(["4K"]);
    expect(parseSupplierGroupDetails({ description: "支持4K，0.06/张" }, "key-groups")?.nativeResolutions).toBeUndefined();
  });
  it("associates each pDog banana quote with the exact ID following its amount", () => {
    const first = "gemini-3.1-flash-image-preview", second = "gemini-3-pro-image";
    const details = parseSupplierGroupDetails({ description: `香蕉2：0.07/张, ID：${first}\n香蕉pro：0.08/张, ID：${second}`,
      image_price_4k: 0.07 }, "key-groups");
    expect(supplierGroupModelPriceDetails(details, first, [first, second])?.referencePrice).toBe("香蕉2：0.07/张");
    expect(supplierGroupModelPriceDetails(details, second, [first, second])?.referencePrice).toBe("香蕉pro：0.08/张");
    expect(supplierGroupModelPriceDetails(details, second, [first, second])?.imagePrices).toBeUndefined();
  });
  it.each(["\n", "，", ";", " "])("scopes the screenshot's three model prices separated by %j", separator => {
    const quotes = ["image2 0.1一张 能高质量", "image2.5 flare 0.13一张 支持五档质量", "image2.5 sub 0.16一张 支持五档质量"];
    const details = parseSupplierGroupDetails({ description: quotes.join(separator), image_price_2k: 0.1, image_price_4k: 0.1 }, "key-groups")!;
    for (const [index, modelId] of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].entries()) {
      const scoped = supplierGroupModelPriceDetails(details, modelId);
      expect(scoped?.referencePrice).toBe(quotes[index]);
      expect(scoped?.imagePrices).toBeUndefined();
    }
    expect(supplierGroupModelPriceDetails(details, "gpt-image-2.5-sunburst-adobe")?.referencePrice).toBeUndefined();
    expect(supplierGroupModelPriceDetails(details, "gpt-image-2.5")?.referencePrice).toBeUndefined();
    expect(details.imagePrices).toHaveLength(2);
  });
  it("keeps generic prices and scopes a single shared quote to the named models", () => {
    const generic = parseSupplierGroupDetails({ description: "2.0跟2.5都有 0.07一张 只能中质量", image_price_4k: 0.07 }, "key-groups");
    expect(supplierGroupModelPriceDetails(generic, "gpt-image-2.5-sunburst")).toBe(generic);
    const shared = parseSupplierGroupDetails({ description: "gpt-image-2.5-flare 和 gpt-image-2.5-sunburst 每张0.16元，量大另议" }, "key-groups");
    expect(supplierGroupModelPriceDetails(shared, "gpt-image-2.5-flare")?.referencePrice).toBe(shared?.referencePrice);
    expect(supplierGroupModelPriceDetails(shared, "gpt-image-2")?.referencePrice).toBeUndefined();
  });
  it.each(["gpt-image-2.5-sunburst-adobe", "image2.5 sunburst-adobe", "image2.5 sub-adobe"])("captures the full %s declaration without lending its price to the base model", declared => {
    const details = parseSupplierGroupDetails({ description: `${declared} 0.19一张`, image_price_4k: 0.19 }, "key-groups");
    for (const id of ["gpt-image-2.5-sunburst", "gpt-image-2.5"]) {
      expect(supplierGroupModelPriceDetails(details, id)?.referencePrice).toBeUndefined();
      expect(supplierGroupModelPriceDetails(details, id)?.imagePrices).toBeUndefined();
    }
    expect(supplierGroupModelPriceDetails(details, "gpt-image-2.5-sunburst-adobe")?.referencePrice).toBe(`${declared} 0.19一张`);
  });
  it.each([
    ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"],
    ["future-image-v99", "future-image-v99-pro"],
    ["vendor/image.v99", "vendor/image.v99-pro"],
  ])("scopes arbitrary inventory IDs %s and %s without a supplier whitelist", (first, second) => {
    const details = parseSupplierGroupDetails({ description: `${first} 0.065/张\n${second} 0.085/张`, image_price_4k: 0.065 }, "key-groups");
    const ids = [first, second];
    expect(supplierGroupModelPriceDetails(details, first, ids)?.referencePrice).toBe(`${first} 0.065/张`);
    expect(supplierGroupModelPriceDetails(details, second, ids)?.referencePrice).toBe(`${second} 0.085/张`);
    expect(supplierGroupModelPriceDetails(details, second, ids)?.imagePrices).toBeUndefined();
    expect(supplierTextMentionsModel(`${second}：¥0.085/张`, first)).toBe(false);
    expect(supplierTextMentionsModel(`**${first}**：¥0.065/张`, first)).toBe(true);
  });
  it("scopes Mikoto group 28's three exact quotes even when the current Key inventory contains only one model", () => {
    const quotes = ["gemini-3.1-flash-image-preview 0.065/张", "gemini-3-pro-image-preview 0.085/张", "nano-banana-2.1 0.065/张"];
    const details = parseSupplierGroupDetails({ name: "gemini生图", description: [...quotes, "1k2k4k一个价"].join("\n"),
      image_price_1k: .065, image_price_2k: .065, image_price_4k: .065 }, "key-groups")!;
    for (const [index, id] of ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "nano-banana-2.1"].entries()) {
      const scoped = supplierGroupModelPriceDetails(details, id);
      expect(scoped?.referencePrice).toBe(quotes[index]);
      expect(scoped?.imagePrices).toBeUndefined();
      expect(supplierGroupPriceLabel(scoped)).toBe(`${quotes[index]}（分组说明参考）`);
    }
    for (const id of ["gemini-3-pro-image", "nano-banana-2", "nano-banana-2.1-fast"]) {
      expect(supplierGroupModelPriceDetails(details, id)?.referencePrice).toBeUndefined();
      expect(supplierGroupModelPriceDetails(details, id)?.imagePrices).toBeUndefined();
    }
  });
  it.each(["\n", " "])("does not share an explicitly priced full ID missing from the inventory with separator %j", separator => {
    const details = parseSupplierGroupDetails({ description: ["vendor/image.v99：¥0.11/张", "vendor/image.v99-pro：¥0.22/张"].join(separator),
      image_price_4k: .11 }, "key-groups")!;
    expect(supplierGroupModelPriceDetails(details, "vendor/image.v99")?.referencePrice).toBe("vendor/image.v99：¥0.11/张");
    expect(supplierGroupModelPriceDetails(details, "vendor/image.v99-pro")?.referencePrice).toBe("vendor/image.v99-pro：¥0.22/张");
    expect(supplierGroupModelPriceDetails(details, "vendor/image.v99-pro-fast")?.referencePrice).toBeUndefined();
  });
  it("keeps generic wording with unrelated IDs shared when the ID does not directly label the quote", () => {
    const details = parseSupplierGroupDetails({ description: "原生4K，参考文档 https://example.com/new-image-pro，0.07/张，支持所有图像型号", image_price_4k: .07 }, "key-groups");
    expect(supplierGroupModelPriceDetails(details, "gpt-image-2")).toBe(details);
  });
  it("does not lend a numeric resolution suffix declaration to its base model", () => {
    const details = parseSupplierGroupDetails({ description: "gpt-image-2-4k 0.1一张", image_price_4k: 0.1 }, "key-groups");
    expect(supplierGroupModelPriceDetails(details, "gpt-image-2")?.referencePrice).toBeUndefined();
    expect(supplierGroupModelPriceDetails(details, "gpt-image-2-4k")?.referencePrice).toBe("gpt-image-2-4k 0.1一张");
  });
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
