import { describe, expect, it } from "vitest";
import { measuredPriceScopeMatches, pricingFromSupplierEvidence } from "./supplier-price-evidence";

describe("exact measured request scope", () => {
  it("matches only explicit equivalent defaults and absent linked media", () => {
    expect(measuredPriceScopeMatches({ prompt: "another prompt", n: 1, mode: "auto", has_reference_image: false,
      has_reference_video: false, has_reference_audio: false }, {}, { n: 1, mode: "auto" })).toBe(true);
    expect(measuredPriceScopeMatches({ n: 1 }, {})).toBe(false);
    expect(measuredPriceScopeMatches({ quality: "auto" }, {})).toBe(false);
  });
  it.each([
    { ratio: "16:9" }, { aspect_ratio: "1:1" }, { mode: "edit" }, { duration: 5 }, { generate_audio: true },
    { reference_images: ["https://media.example/reference.png"] }, { has_reference_image: true },
    { has_reference_audio: true }, { has_reference_video: true }, { fps: 30 }, { native_control: "new" },
  ])("does not extend an empty request observation to %j", values => {
    expect(measuredPriceScopeMatches(values, {})).toBe(false);
  });
  it("compares both directions and nested controls without object-order sensitivity", () => {
    expect(measuredPriceScopeMatches({}, { ratio: "16:9" })).toBe(false);
    expect(measuredPriceScopeMatches({ images: [{ url: "a", weight: 1 }] }, { images: [{ weight: 1, url: "a" }] })).toBe(true);
    expect(measuredPriceScopeMatches({ images: [{ url: "b", weight: 1 }] }, { images: [{ weight: 1, url: "a" }] })).toBe(false);
  });
});

describe("fixed supplier quote evidence", () => {
  it.each([
    ["¥0.2/张", "per-image", "CNY", .2],
    ["0.2 USD/张", "per-image", "USD", .2],
    ["$2/次", "per-request", "USD", 2],
    ["2 RMB/请求", "per-request", "CNY", 2],
    ["¥0/秒", "per-second", "CNY", 0],
  ])("keeps the unit and currency of the complete quote %s", (label, kind, currency, unitAmount) => {
    expect(pricingFromSupplierEvidence(String(label), undefined, "2026-10-09T00:00:00Z"))
      .toMatchObject({ kind, currency, unitAmount, confidence: "exact" });
  });

  it.each([
    "1K ¥0.1/张；4K ¥0.2/张",
    "1K ¥0.1/张",
    "¥0.1/张（low）",
    "¥0.1/张/请求",
    "5秒 ¥2/次",
    "¥2/次（无参考视频）",
    "¥2/次；有声 ¥3/次",
    "¥2/次（最低时长）",
    "¥0.2/秒（720p）",
  ])("does not erase billing conditions from %s", label => {
    expect(pricingFromSupplierEvidence(label, undefined, "2026-10-09T00:00:00Z")).toBeUndefined();
  });
});
