import { describe, expect, it } from "vitest";
import { appendPriceLabelOnce } from "./model-display";

describe("appendPriceLabelOnce", () => {
  it("does not duplicate a price already embedded in the model name", () => {
    expect(appendPriceLabelOnce("kling-3.0-omni（¥0.1/秒）", "¥0.1/秒")).toBe(
      "kling-3.0-omni（¥0.1/秒）",
    );
  });

  it("adds metadata-only prices", () => {
    expect(appendPriceLabelOnce("kling-3.0-omni", "¥0.1/秒")).toBe(
      "kling-3.0-omni（¥0.1/秒）",
    );
  });

  it("replaces a stale unknown-price placeholder instead of showing both", () => {
    expect(appendPriceLabelOnce("new-image（价格以平台为准）", "¥0.025/张")).toBe("new-image（¥0.025/张）");
  });
});
