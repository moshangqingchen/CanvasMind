import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { chuangxiangVideoModel } from "@super-canvas/providers/chuangxiang-video-contract";
import { remainingVideoModel } from "@super-canvas/providers/remaining-video-contracts";
import { modelEstimatedCost } from "./model-display";

function model(id: string): ModelDescriptor {
  return chuangxiangVideoModel(id, { id, name: id, operations: ["video.generate"], pricing: {
    kind: "per-second", currency: "CNY", billingUnit: "second", checkedAt: "2026-10-22T04:13:15.022Z", confidence: "exact",
    tiers: [{ id: "720p", label: "720p", dimension: "resolution", value: "720p", price: .4 }],
  } });
}

describe("exact input/output video billing projections", () => {
  it("uses WAN's fixed eight-second automatic tariff and full quantity", () => {
    const selected = model("wan3.0-image-720p"), input = { duration: -1, n: 3, resolution: "720p" };
    expect(modelEstimatedCost(selected, input)).toBe("9.6 CNY");
    expect(input.duration).toBe(-1);
    expect(modelEstimatedCost(selected, { duration_seconds: -1, count: 3, resolution: "720p" })).toBe("9.6 CNY");
    expect(modelEstimatedCost(selected, { duration: 3, n: 3, resolution: "720p" })).toBeUndefined();
    expect(modelEstimatedCost(selected, { duration: -1, n: 1001, resolution: "720p" })).toBeUndefined();
    expect(modelEstimatedCost(selected, { duration: -1, seconds: 8, resolution: "720p" })).toBeUndefined();
  });

  it("adds each actual WAN reference video's seconds once across aliases and preserves the user's inputs", () => {
    const selected = model("wan3.0-video-prime-720p"), input = { duration: -1, n: 2, resolution: "720p", has_reference_video: true,
      video_references: [{ url: "https://media.example/a", duration: 3 }, { url: "https://media.example/b", seconds: 5 }],
      video_urls: [{ url: "https://media.example/a", duration: 3 }] };
    const before = structuredClone(input);
    expect(modelEstimatedCost(selected, input)).toBe("12.8 CNY"); // (8 + 3 + 5) × 2 × .4
    expect(input).toEqual(before);
    expect(modelEstimatedCost(selected, { duration: 8, resolution: "720p", has_reference_video: true })).toBeUndefined();
    expect(modelEstimatedCost(selected, { duration: 8, resolution: "720p" })).toBeUndefined();
    expect(modelEstimatedCost(selected, { duration: 8, resolution: "720p", has_reference_video: false })).toBe("3.2 CNY");
    expect(modelEstimatedCost(selected, { ...input, video_urls: [{ url: "https://media.example/a", duration: 4 }] })).toBeUndefined();
    expect(modelEstimatedCost(selected, { ...input, video_references: [{ url: "https://media.example/a" }], video_urls: [] })).toBeUndefined();
  });

  it.each([["SD2.0满血稳定933-线路二", "视频SD2.0"], ["稳定seedance-2.5全参D", "稳定满血视频模型"]])("uses measured millisecond reference objects for exact Jijiu %s", (id, group) => {
    const selected = remainingVideoModel("jijiu", id, { id, name: id, operations: ["video.generate"], pricing: {
      kind: "per-second", billingUnit: "second", currency: "CNY", unitAmount: 2, confidence: "exact", checkedAt: "2026-10-21",
    } }, { group })!;
    const input = { duration: 5, resolution: "720p", has_reference_video: true, videos: [
      { url: "https://media.example/a", durationMs: 2000 }, { url: "https://media.example/b", durationMs: 3000 },
    ], video_refs: [{ url: "https://media.example/a", durationMs: 2000 }] };
    expect(modelEstimatedCost(selected, input)).toBe("20 CNY");
    expect(modelEstimatedCost(selected, { duration: 5, resolution: "720p", has_reference_video: true })).toBeUndefined();
    expect(modelEstimatedCost(selected, { ...input, video_refs: [{ url: "https://media.example/a", durationMs: 4000 }] })).toBeUndefined();
  });

  it("does not fabricate a reference-video surcharge when the supplier has not published its algorithm", () => {
    const selected: ModelDescriptor = { id: "wan2.7-i2v", name: "WAN", operations: ["video.generate"],
      pricing: { kind: "per-second", unitAmount: .5, currency: "CNY", confidence: "exact", checkedAt: "2026-10-21" },
      metadata: { referenceVideoPricingUnpublished: true } };
    expect(modelEstimatedCost(selected, { duration: 8, has_reference_video: true })).toBeUndefined();
    expect(modelEstimatedCost(selected, { duration: 8 })).toBeUndefined();
    expect(modelEstimatedCost(selected, { duration: 8, has_reference_video: false })).toBe("4 CNY");
  });
});
