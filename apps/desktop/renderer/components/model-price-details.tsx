import type { ModelDescriptor } from "@super-canvas/providers";
import { chuangxiangRejectedRequestFeeNotice } from "@super-canvas/providers/chuangxiang-catalog-pricing";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";
import { modelEstimatedCost } from "../lib/model-display";
import { modelPickerPriceSampleAt } from "../lib/model-picker-data";
import styles from "./model-picker.module.css";
import priceStyles from "./model-price-table.module.css";
import { ModelPriceEvidence } from "./model-price-evidence";
import { ModelPriceTable } from "./model-price-table";

export function ModelPriceDetails({ model, parameters }: { model?: ModelDescriptor | null; parameters: Record<string, unknown> }) {
  if (model) model = applyUserImageSizePresets(normalizeTk1688CnyModel(model));
  const estimate = modelEstimatedCost(model, parameters);
  const priceCheckedAt = modelPickerPriceSampleAt(model);
  const priceSourceUrl = model?.pricing?.sourceUrl ?? (typeof model?.metadata?.priceSourceUrl === "string" ? model.metadata.priceSourceUrl : undefined);
  const announcedFee = model?.metadata?.chuangxiangRejectedRequestFeeNotice;
  const feeRecord = announcedFee && typeof announcedFee === "object" && !Array.isArray(announcedFee)
    ? announcedFee as Record<string, unknown> : undefined;
  const feeNotice = feeRecord?.announcementId === 38 && typeof feeRecord.supplierSiteUrl === "string"
    ? chuangxiangRejectedRequestFeeNotice(feeRecord.supplierSiteUrl, model?.id ?? "") : undefined;
  return <div className={`node-config-price-summary ${styles.details}`} aria-label="当前参数价格">
    <section className={priceStyles.quote} aria-label="型号报价"><h4 className={priceStyles.quoteTitle}>型号报价</h4>
      <ModelPriceTable model={model} parameters={parameters} />
    </section>
    {estimate && <span className={priceStyles.estimate}>本次预计费用 <strong>{estimate}</strong></span>}
    <ModelPriceEvidence model={model} />
    <details><summary>价格与参数依据</summary>
      {estimate && <p>按当前参数与数量估算，最终费用以供应商实际扣费为准。</p>}
      {model?.metadata?.priceSource === "generated-result" && <p>来源：已生成请求的实际扣费与对应参数。</p>}
      {priceCheckedAt && <dl className={priceStyles.facts}><div className={priceStyles.fact}><dt>价格资料更新于</dt><dd><time dateTime={priceCheckedAt}>{priceCheckedAt}</time></dd></div>
        {model?.pricing && model.pricing.confidence !== "exact" && <div className={priceStyles.fact}><dt>当前金额</dt><dd>参考值</dd></div>}
      </dl>}
      {priceSourceUrl && <a href={priceSourceUrl} target="_blank" rel="noreferrer">查看价格来源</a>}
      {feeNotice && <p aria-label="供应商条件收费公告">{feeNotice.text}<br />
        公告发布于 <time dateTime={feeNotice.publishedAt}>{feeNotice.publishedAt}</time>；采样于 <time dateTime={feeNotice.sampledAt}>{feeNotice.sampledAt}</time>。{" "}
        <a href={feeNotice.sourceUrl} target="_blank" rel="noreferrer">查看公告 38</a>
      </p>}
      {typeof model?.metadata?.supplierGroupResolutionLabel === "string" && <p>{model.metadata.supplierGroupResolutionLabel}</p>}
    </details>
  </div>;
}
