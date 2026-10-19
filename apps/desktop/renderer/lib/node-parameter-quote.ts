import type { ModelDescriptor } from "@super-canvas/providers";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";
import { modelEstimatedQuote } from "./model-display";
import { modelPickerPriceSampleAt } from "./model-picker-data";

export interface NodeParameterQuote {
  readonly model: ModelDescriptor | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly estimate: ReturnType<typeof modelEstimatedQuote>;
  readonly displayCost: string;
  readonly unavailableNote?: string;
  readonly priceCheckedAt?: string;
  readonly priceSourceUrl?: string;
}

/** One display projection for the panel's heading, footer and price details.
 * Leave estimate eligibility, billing units and currency to the existing quote.
 */
export function createNodeParameterQuote(
  input: ModelDescriptor | null | undefined,
  parameters: Readonly<Record<string, unknown>>,
): NodeParameterQuote {
  const model = input ? applyUserImageSizePresets(normalizeTk1688CnyModel(input)) : null;
  const estimate = modelEstimatedQuote(model, parameters);
  return {
    model,
    parameters,
    estimate,
    displayCost: estimate?.cost ?? "—",
    ...(!estimate ? { unavailableNote: "当前参数组合暂无法估算，费率与来源详见价格明细。" } : {}),
    priceCheckedAt: modelPickerPriceSampleAt(model),
    priceSourceUrl: model?.pricing?.sourceUrl ?? (typeof model?.metadata?.priceSourceUrl === "string" ? model.metadata.priceSourceUrl : undefined),
  };
}
