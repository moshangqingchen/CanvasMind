import { expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  modelResolutionFamily,
  modelResolutionPrice,
  parametersForResolutionModelChange,
} from "./model-resolution-family";

const model = (tier: string): ModelDescriptor => ({
  id: `gpt-image-2.5-flare-${tier.toLowerCase()}`,
  name: tier,
  operations: ["image.generate", "image.edit"],
  metadata: {
    supplier: "cangyuan",
    modelGroup: "IMAGE",
    priceLabel: `¥${tier === "4K" ? "0.095" : "0.06"}/张`,
  },
  parameters: [
    {
      key: "size",
      label: "尺寸",
      control: "dimensions",
      default: "auto",
      options: [
        { label: "自动", value: "auto" },
        {
          label: `${tier} 1:1`,
          value: tier === "4K" ? "2880x2880" : "1024x1024",
        },
        {
          label: `${tier} 9:16`,
          value: tier === "4K" ? "2160x3840" : "768x1360",
        },
      ],
    },
  ],
});

it("shows only the same connection's runnable family, with unavailable tiers disabled", () => {
  const current = model("1K"),
    high = model("4K");
  const denied = { ...model("2K"), metadata: { canvasRunnable: false } };
  const otherGroup = {
    ...model("2K"),
    metadata: { modelGroup: "IMAGE-备用分组" },
  };
  const otherFamily = { ...high, id: "gpt-image-2.5-sunburst-2k" };
  expect(
    modelResolutionFamily(
      [current, denied, otherGroup, otherFamily, high],
      current,
    ),
  ).toEqual([
    { tier: "1K", model: current },
    { tier: "2K", model: undefined },
    { tier: "4K", model: high },
  ]);
  expect(modelResolutionFamily([current, otherFamily], current)).toEqual([]);
});

it("keeps shape and automatic behavior while changing fixed billing model", () => {
  expect(
    parametersForResolutionModelChange(model("1K"), model("4K"), {
      size: "768x1360",
      quality: "low",
    }),
  ).toEqual({ size: "2160x3840", size_tier: "4K" });
  expect(
    parametersForResolutionModelChange(model("1K"), model("4K"), {
      size: "auto",
    }),
  ).toEqual({ size: "auto", size_tier: "4K" });
  const next = { ...model("4K"), id: "nano-banana2-4k" };
  expect(
    parametersForResolutionModelChange(model("1K"), next, { size: "768x1360" }),
  ).toBeUndefined();
});

it("preserves a ratio-only model's portrait selection without inventing pixels", () => {
  const ratioModel = (tier: string): ModelDescriptor => ({
    ...model(tier),
    id: `nano-banana2-${tier}`,
    parameters: [
      {
        key: "aspect_ratio",
        label: "比例",
        control: "select",
        options: [
          { label: "自动", value: "auto" },
          { label: "9:16", value: "9:16" },
        ],
      },
    ],
  });
  expect(
    parametersForResolutionModelChange(ratioModel("1k"), ratioModel("4k"), {
      aspect_ratio: "9:16",
    }),
  ).toEqual({ aspect_ratio: "9:16" });
});

it("displays each tier's stated price without treating unknown token billing as free", () => {
  expect(modelResolutionPrice(model("4K"))).toBe("¥0.095/张");
  expect(
    modelResolutionPrice({
      ...model("1K"),
      metadata: {},
      pricing: {
        kind: "per-image",
        unitAmount: 0.08,
        currency: "USD",
        checkedAt: "2026-09-15",
        confidence: "snapshot",
      },
    }),
  ).toBe("$0.08/张");
  expect(modelResolutionPrice({ ...model("1K"), metadata: {} })).toBe(
    "价格以渠道为准",
  );
});
