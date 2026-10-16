import { describe, expect, it } from "vitest";
import type { NormalizedRequest } from "./contracts.js";
import { normalizeRemainingVideoParameters, remainingVideoModel, remainingVideoRequestIssues, remainingVideoTransport } from "./remaining-video-contracts.js";

const request = (model: string, parameters: Record<string, unknown>): NormalizedRequest => ({
  connectionId: "secure-wan-offline", operation: "video.generate", prompt: "Offline fixture", model, parameters,
});
const group = { group: "wan3.0视频", officialGroupId: "58" };
const ratios = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

describe("Secure WAN current standard ratio contract", () => {
  it.each(["wan3.0-video", "wan3.0-video-prime"])("exposes every exact ratio and keeps the standard default for %s", model => {
    const descriptor = remainingVideoModel("secure", model, undefined, group)!;
    expect(descriptor.metadata?.videoContractCheckedAt).toBe("2026-10-14");
    expect(descriptor.parameters?.find(parameter => parameter.key === "aspect_ratio")).toMatchObject({
      control: "select", default: "16:9", options: ratios.map(value => ({ label: value, value })),
    });
    expect(normalizeRemainingVideoParameters("secure", request(model, { duration: 6 }), group).ratio).toBe("16:9");
    expect(remainingVideoTransport("secure", model, group)?.submit?.path).toBe("/v1/videos/generations");
    for (const ratio of ratios) for (const alias of ["ratio", "aspect_ratio"]) {
      const input = request(model, { duration: 6, [alias]: ratio });
      expect(remainingVideoRequestIssues("secure", input, group)).toEqual([]);
      expect(normalizeRemainingVideoParameters("secure", input, group)).toMatchObject({ ratio });
    }
  });

  it("retains saved custom ratios and rejects them before submission instead of replacing them", () => {
    for (const ratio of ["2.35:1", "2:1", "0:1", "ADAPTIVE"]) {
      const input = request("wan3.0-video", { duration: 6, aspect_ratio: ratio }), before = structuredClone(input);
      expect(remainingVideoRequestIssues("secure", input, group)).toContainEqual(expect.objectContaining({ path: "parameters.aspect_ratio" }));
      expect(normalizeRemainingVideoParameters("secure", input, group).ratio).toBe(ratio);
      expect(input).toEqual(before);
    }
  });

  it("permits adaptive with a first frame while preserving alias conflicts and unrelated contracts", () => {
    const input = request("wan3.0-video", { duration: 6, ratio: "adaptive" });
    input.assets = [{ id: "first", kind: "image", mimeType: "image/png", role: "firstFrame", url: "https://media.example/first.png" }];
    expect(remainingVideoRequestIssues("secure", input, group)).toEqual([]);
    expect(normalizeRemainingVideoParameters("secure", input, group)).toMatchObject({ ratio: "adaptive", media: [{ type: "first_frame", url: "https://media.example/first.png" }] });
    expect(remainingVideoRequestIssues("secure", request("wan3.0-video", { ratio: "adaptive", aspect_ratio: "16:9" }), group))
      .toContainEqual(expect.objectContaining({ path: "parameters.aspect_ratio", message: "aspect_ratio 与 ratio 不能冲突。" }));
    expect(remainingVideoRequestIssues("secure", request("minimax-h3", { duration: 6, aspect_ratio: "2.35:1" }))).toEqual([]);
  });
});
