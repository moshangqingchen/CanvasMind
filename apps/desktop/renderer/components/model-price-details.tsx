import type { ModelDescriptor } from "@super-canvas/providers";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
import { modelPriceSummary } from "../lib/model-display";
import styles from "./model-picker.module.css";

export function ModelPriceDetails({ model, parameters }: { model?: ModelDescriptor | null; parameters: Record<string, unknown> }) {
  if (model) model = normalizeTk1688CnyModel(model);
  return <div className={`node-config-price-summary ${styles.details}`} aria-label="当前参数价格">
    {model?.metadata?.qualitySupport === "provider-decided" && <span>质量 <strong>由模型决定</strong></span>}
    <span>当前组合价格 <strong>{modelPriceSummary(model ?? undefined, parameters)}</strong></span>
    <details><summary>价格与参数依据</summary>
      <p>{String(model?.metadata?.priceLabel ?? "尚未取得价格")}</p>
      {model?.metadata?.priceSource === "generated-result" && <p>按已生成请求的实际扣费参考；其他尺寸或质量尚无扣费样本。</p>}
      {model?.pricing?.checkedAt && <p>价格资料更新于 {model.pricing.checkedAt}{model.pricing.confidence === "exact" ? "" : "；当前金额为参考值"}</p>}
      {model?.pricing?.sourceUrl && <a href={model.pricing.sourceUrl} target="_blank" rel="noreferrer">查看价格来源</a>}
      {typeof model?.metadata?.supplierGroupResolutionLabel === "string" && <p>{model.metadata.supplierGroupResolutionLabel}</p>}
      {Array.isArray(model?.metadata?.imageCapabilityEvidence) && model.metadata.imageCapabilityEvidence.map((item: { id: string; resolution?: string; quality?: string; status: string; excerpt: string }) =>
        <p key={item.id}>{item.resolution ?? item.quality} · {({ declared: "说明支持", verified: "实测支持", inferred: "由 4K 推断", approximate: "近似档位", assumed: "暂定，待核验", unsupported: "不支持", conflict: "需要核对" } as Record<string, string>)[item.status]}：{item.excerpt}</p>)}
    </details>
  </div>;
}
