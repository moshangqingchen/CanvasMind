import { describe, expect, it } from "vitest";
import {
  IMAGE_SIZE_RATIOS,
  imageSizeForTier,
  imageSizeOptions,
} from "./image-size-presets.js";

describe("tiered image dimensions", () => {
  it.each(["1K", "2K", "4K"] as const)(
    "keeps every %s ratio within the pixel and edge limits",
    (tier) => {
      const budget = { "1K": 1048576, "2K": 4194304, "4K": 8294400 }[tier];
      const options = imageSizeOptions([tier]);
      expect(options).toHaveLength(12);
      expect(new Set(options.map((option) => option.value)).size).toBe(12);
      for (const ratio of IMAGE_SIZE_RATIOS) {
        const [width, height] = imageSizeForTier(tier, ratio)
          .split("x")
          .map(Number) as [number, number];
        const [a, b] = ratio.split(":").map(Number) as [number, number];
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
        expect(width * height).toBeLessThanOrEqual(budget);
        expect(width * height).toBeGreaterThanOrEqual(655360);
        expect(Math.abs(width / height / (a / b) - 1)).toBeLessThan(0.025);
      }
    },
  );

  it("retains exact 4K widescreen pixels and limits the verified 2K channel's edges", () => {
    expect(imageSizeForTier("4K", "16:9")).toBe("3840x2160");
    expect(imageSizeForTier("4K", "9:16")).toBe("2160x3840");
    for (const option of imageSizeOptions(["1K", "2K"], 2048).slice(1)) {
      expect(
        Math.max(...String(option.value).split("x").map(Number)),
      ).toBeLessThanOrEqual(2048);
    }
  });
});
