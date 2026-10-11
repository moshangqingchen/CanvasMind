import { describe, expect, it } from "vitest";
import { pdogAcceptedImageQualityEvidence } from "./pdog-image-quality-evidence.js";
import { verifiedTransparentImageEvidence } from "./transparent-image-evidence.js";

const group = "【生图】image2/2.5-1K2K4K(超分组)";
const config = { baseUrl: "https://ai.whyshy.cn", accountKeyGroupId: "14", accountKeyGroup: group, modelGroup: group };
const sunburst = "gpt-image-2.5-sunburst";

describe("pDog exact-group historical accepted quality", () => {
  it.each([
    ["gpt-image-2.5", "082", 2160, true],
    ["gpt-image-2.5-flare", "083", 2161, false],
    [sunburst, "084", 2161, false],
  ])("retains the accepted request and separate original output for %s", (model, caseId, height, matched) => {
    const result = pdogAcceptedImageQualityEvidence(config, String(model));
    expect(result).toMatchObject({
      value: "max", source: "historical-accepted-request", checkedAt: "2026-10-05", reviewedAt: "2026-10-11",
      caseId, supplierGroupId: "14", fullModelId: model, operation: "image.generate",
      transport: { kind: "pdog-async", path: "/v1/images/generations/async", method: "POST", bodyMode: "json" },
      request: { quality: "max", size: "3840x2160", n: 1, background: "transparent", output_format: "png" },
      output: { width: 3840, height, hasAlpha: false, transparentPixels: 0, requestedDimensionsMatched: matched },
      billingMatch: "exact-model-group-time-window-and-balance-delta;no-task-id-join",
    });
    expect(result?.output.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifiedTransparentImageEvidence({ provider: "openai", config }, String(model))).toBeUndefined();
  });

  it("uses the verified stable group through a consistent rename but never a conflicting key", () => {
    expect(pdogAcceptedImageQualityEvidence({ ...config, accountKeyGroup: "改名超分", modelGroup: "改名超分" }, sunburst)).toBeDefined();
    expect(pdogAcceptedImageQualityEvidence({ ...config, accountKeyGroupId: 14 }, sunburst)).toBeDefined();
    expect(pdogAcceptedImageQualityEvidence({ baseUrl: config.baseUrl, modelGroup: group }, sunburst)).toBeDefined();
    expect(pdogAcceptedImageQualityEvidence({ ...config, accountKeyGroupId: "5" }, sunburst)).toBeUndefined();
    expect(pdogAcceptedImageQualityEvidence({ ...config, modelGroup: "【生图】image2/2.5-2K4K(原生)" }, sunburst)).toBeUndefined();
    expect(pdogAcceptedImageQualityEvidence({ baseUrl: config.baseUrl, accountKeyGroupId: "4" }, sunburst)).toBeUndefined();
    expect(pdogAcceptedImageQualityEvidence({ baseUrl: config.baseUrl }, sunburst)).toBeUndefined();
  });

  it.each([undefined, "gpt-image-2", "gpt-image-2.5-sunburst-high", "gpt-image-2.5-sunburst-preview", "gemini-3-pro-image"])(
    "does not transfer the sample to full model ID %s", model => {
      expect(pdogAcceptedImageQualityEvidence(config, model)).toBeUndefined();
    });

  it.each([
    "https://other.example", "https://ai.whyshy.cn.example", "http://ai.whyshy.cn", "https://ai.whyshy.cn:8443",
    "https://ai.whyshy.cn/custom", "https://ai.whyshy.cn/?route=other", "https://ai.whyshy.cn/#route", "https://user@ai.whyshy.cn",
  ])("does not transfer evidence to another transport %s", baseUrl => {
    expect(pdogAcceptedImageQualityEvidence({ ...config, baseUrl }, sunburst)).toBeUndefined();
  });

  it.each([{ manualProtocol: true }, { supplierArchived: true }, { usage: "agent" }, { usage: "disabled" }])(
    "does not override a connection exclusion %j", exclusion => {
      expect(pdogAcceptedImageQualityEvidence({ ...config, ...exclusion }, sunburst)).toBeUndefined();
    });

  it.each(["https://ai.whyshy.cn/", "https://ai.whyshy.cn/v1", "https://ai.whyshy.cn/v1/"])(
    "accepts the original ordinary API root %s", baseUrl => {
      expect(pdogAcceptedImageQualityEvidence({ ...config, baseUrl }, sunburst)?.caseId).toBe("084");
    });
});
