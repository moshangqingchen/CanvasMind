import { expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CanvasNode } from "../components/types";
import { designBatchPrice } from "./design-batch-price";

it("prices every selected quality using the declared currency, including true zero", () => {
  const model: ModelDescriptor = {
    id: "image",
    name: "image",
    operations: ["image.generate"],
    pricing: {
      kind: "tiered",
      currency: "CNY",
      checkedAt: "2026-09-27T00:00:00Z",
      confidence: "exact",
      tiers: [
        {
          id: "high",
          dimension: "quality",
          value: "high",
          label: "高",
          price: 0.3,
        },
        {
          id: "low",
          dimension: "quality",
          value: "low",
          label: "低",
          price: 0,
        },
      ],
    },
  };
  const nodes = ["high", "high", "low"].map((quality, index): CanvasNode => ({
    id: String(index),
    position: { x: 0, y: 0 },
    data: {
      label: quality,
      nodeType: "image-generation",
      parameters: { quality, n: 1 },
    },
  }));
  expect(designBatchPrice(model, nodes)).toMatchObject({
    unknown: 0,
    total: 0.6,
    currency: "CNY",
  });
  expect(
    designBatchPrice({ ...model, pricing: undefined }, nodes),
  ).toMatchObject({ unknown: 3, total: 0 });
  expect(
    designBatchPrice(
      { ...model, pricing: { ...model.pricing!, kind: "token" } },
      nodes,
    ).unknown,
  ).toBe(3);
});
