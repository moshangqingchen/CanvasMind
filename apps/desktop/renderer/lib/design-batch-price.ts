import type { ModelDescriptor } from "@super-canvas/providers";
import { modelPriceAmount } from "@super-canvas/providers/media-billing";
import { evaluateImageParameters } from "@super-canvas/providers/image-parameter-contract";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
import type { CanvasNode } from "../components/types";
import { modelPriceSummary } from "./model-display";

export function designBatchPrice(
  model: ModelDescriptor,
  nodes: readonly CanvasNode[],
) {
  model = applyUserImageSizePresets(normalizeTk1688CnyModel(model));
  const pricing = model.pricing;
  let total = 0;
  let unknown = 0;
  const rows = nodes
    .filter((node) => node.data.nodeType === "image-generation")
    .map((node) => {
      const parameters = node.data.parameters ?? {};
      const evaluated = evaluateImageParameters(model, parameters);
      const amount =
        pricing &&
        ["per-image", "per-request", "tiered"].includes(pricing.kind) &&
        pricing.billingUnit !== "second" &&
        model.metadata?.priceSource !== "generated-result"
          ? modelPriceAmount(pricing, evaluated.pricingParameters)
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
