import type { ModelDescriptor } from "@super-canvas/providers";
import { selectModelQuote, catalogRequestBillingCount } from "@super-canvas/providers/media-billing";
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
      const quote = selectModelQuote(model, evaluated.pricingParameters, { operation: "image.generate" });
      const managed = model.metadata?.catalogPriceEvidence && typeof model.metadata.catalogPriceEvidence === "object" &&
        (model.metadata.catalogPriceEvidence as { schemaVersion?: unknown }).schemaVersion === 1;
      const count = managed && (pricing?.billingUnit === "request" || pricing?.kind === "per-request")
        ? catalogRequestBillingCount(model, parameters) : 1;
      const amount =
        quote.estimatePricing &&
        ["per-image", "per-request", "tiered"].includes(quote.estimatePricing.kind) &&
        quote.estimatePricing.billingUnit !== "second"
          ? quote.amount
          : undefined;
      if (amount === undefined || count === undefined || !Number.isFinite(amount) || amount < 0)
        unknown++;
      else total += amount * count;
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
