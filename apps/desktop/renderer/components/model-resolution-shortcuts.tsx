"use client";

import type { ModelDescriptor } from "@super-canvas/providers";
import {
  modelResolutionFamily,
  modelResolutionPrice,
} from "../lib/model-resolution-family";

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
      <label>分辨率与价格</label>
      <div
        className="parameter-dimensions-shortcuts"
        role="group"
        aria-label="切换同渠道型号的分辨率"
      >
        {family.map(({ tier, model }) => {
          const price = model ? modelResolutionPrice(model) : "未提供";
          const currencyNote = "（币种未注明）";
          const unknownCurrency = price.endsWith(currencyNote);
          return (
            <button
              key={tier}
              type="button"
              className="parameter-dimensions-shortcut model-resolution-choice"
              disabled={!model}
              aria-pressed={model?.id === selected?.id}
              title={model ? `${model.id} · ${price}` : "当前分组未提供此档位"}
              onClick={() => model && onChange(model.id)}
            >
              <strong>{tier}</strong>
              <small>
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
              </small>
            </button>
          );
        })}
      </div>
      <span className="field-note">按所选档位切换当前分组的对应型号。</span>
    </div>
  );
}
