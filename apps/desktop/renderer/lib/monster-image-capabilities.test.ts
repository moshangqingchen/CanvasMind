import { describe, expect, it } from "vitest";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { parametersWithDefaults } from "./model-parameters";
import {
  resolutionTierShortcuts,
  sizeOnTierChange,
} from "../components/node-parameter-fields";
import type { ModelDescriptor } from "@super-canvas/providers";

const model: ModelDescriptor = {
  id: "gpt-image-2.5",
  name: "GPT Image 2.5",
  operations: ["image.generate"],
};
describe("Monster scanned model controls", () => {
  it.each([
    ["B1-GPT生图原生渠道V1", ["1K", "2K", "4K"]],
    ["B2-GPT生图原生渠道V2（推荐）", ["1K", "2K", "4K"]],
    ["B3-GPT生图-特惠渠道", ["1K", "2K"]],
    ["B4-GPT生图原生渠道V3（高质量）", ["1K", "2K", "4K"]],
  ] as const)(
    "repairs a cached model for %s with scoped tiers",
    (modelGroup, tiers) => {
      const connection = {
        provider: "openai",
        config: {
          baseUrl: "https://api.eaheng.com",
          modelGroup,
          supplierKey: "custom-fixture",
          usage: "canvas",
        },
      };
      const result = bindScannedModelProtocols(connection, [model]).models[0]!;
      const descriptor = result.parameters!.find((p) => p.key === "size")!;
      expect(resolutionTierShortcuts(descriptor).map((s) => s.label)).toEqual(
        tiers,
      );
      expect(sizeOnTierChange(descriptor, "768x1360", "2K")).toBe("1536x2720");
      expect(
        parametersWithDefaults(result.parameters!, {
          size: "auto",
          size_tier: "2K",
          quality: "medium",
        }),
      ).toMatchObject({ size: "auto", size_tier: "2K", quality: "medium" });
      expect(result.metadata?.imageCapabilitiesVerifiedAt).toBe("2026-09-20");
      expect(bindScannedModelProtocols(connection, [result]).models).toEqual([
        result,
      ]);
      expect(result.operations).toEqual(["image.generate"]);
    },
  );
  it("does not give another custom supplier the Monster controls", () => {
    const result = bindScannedModelProtocols(
      {
        provider: "openai",
        config: {
          baseUrl: "https://unrelated.example",
          modelGroup: "B1-GPT生图原生渠道V1",
          supplierKey: "custom-fixture",
        },
      },
      [model],
    ).models[0]!;
    expect(result.metadata?.imageCapabilitiesVerifiedAt).toBeUndefined();
    expect(result.parameters).toBeUndefined();
  });
});
