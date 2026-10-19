"use client";

import type { ModelDescriptor } from "@super-canvas/providers";
import {
  modelResolutionFamily,
  modelResolutionPrice,
} from "../lib/model-resolution-family";
import { Segmented } from "./ui/Segmented";

export function ModelResolutionShortcuts({
  models,
  selected,
  onChange,
}: {
  models: readonly ModelDescriptor[];
  selected?: ModelDescriptor | null;
  onChange: (modelId: string) => void;
}) {
  const family = modelResolutionFamily(models, selected);
  if (!family.length) return null;
  return (
    <div className="field model-resolution-family">
      <label>型号分辨率与价格</label>
      <Segmented label="切换同渠道型号的分辨率" value={selected?.id ?? ""} className="model-resolution-segmented"
        options={family.map(({ tier, model }) => {
          const price = model ? modelResolutionPrice(model) : "未提供";
          const currencyNote = "（币种未注明）";
          const unknownCurrency = price.endsWith(currencyNote);
          return { value: model?.id ?? `__unavailable_model_${tier}__`, label: tier, disabled: !model,
            title: model ? `${model.id} · ${price}` : "当前分组未提供此档位",
            detail: <>
                {unknownCurrency ? (
                  <>
                    {price.slice(0, -currencyNote.length)}
                    <span className="model-resolution-price-note">
                      {currencyNote}
                    </span>
                  </>
                ) : (
                  price
                )}
              </> };
        })} onChange={modelId => { if (family.some(item => item.model?.id === modelId)) onChange(modelId); }} />
      <span className="field-note">按所选档位切换当前分组的对应型号。</span>
    </div>
  );
}
