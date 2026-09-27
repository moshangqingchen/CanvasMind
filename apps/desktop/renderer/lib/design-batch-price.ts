import type { ModelDescriptor } from "@super-canvas/providers";
import { modelPriceAmount } from "@super-canvas/providers/media-billing";
import type { CanvasNode } from "../components/types";
import { modelPriceSummary } from "./model-display";

export function designBatchPrice(
  model: ModelDescriptor,
  nodes: readonly CanvasNode[],
) {
  const pricing = model.pricing;
  let total = 0;
  let unknown = 0;
  const rows = nodes
    .filter((node) => node.data.nodeType === "image-generation")
    .map((node) => {
      const parameters = node.data.parameters ?? {};
      const defaults = Object.fromEntries(
        (model.parameters ?? [])
          .filter((p) => p.default !== undefined)
          .map((p) => [p.key, p.default]),
      );
      const tier =
        String(
          parameters.size_tier ??
            parameters.resolution ??
            parameters.image_size ??
            "",
        ).toUpperCase() ||
        model.parameters
          ?.find((p) => p.key === "size")
          ?.options?.find((option) => option.value === parameters.size)
          ?.label.match(/\b[124]K\b/iu)?.[0]
          ?.toUpperCase();
      const amount =
        pricing &&
        ["per-image", "per-request", "tiered"].includes(pricing.kind) &&
        pricing.billingUnit !== "second" &&
        model.metadata?.priceSource !== "generated-result"
          ? modelPriceAmount(pricing, {
              ...defaults,
              ...parameters,
              resolution:
                parameters.resolution ?? (tier || defaults.resolution),
            })
          : undefined;
      if (amount === undefined || !Number.isFinite(amount) || amount < 0)
        unknown++;
      else total += amount; // Each design node submits exactly one image.
      return {
        label: node.data.label,
        price: modelPriceSummary(model, parameters),
      };
    });
  return {
    rows,
    unknown,
    total: Number(total.toPrecision(12)),
    currency: pricing?.currency,
    checkedAt: pricing?.checkedAt,
  };
}
