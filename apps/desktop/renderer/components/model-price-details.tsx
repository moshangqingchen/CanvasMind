import type { ModelDescriptor } from "@super-canvas/providers";
import { normalizeTk1688CnyModel } from "@super-canvas/providers/tk1688-catalog";
import { modelEstimatedCost, modelPriceSummary } from "../lib/model-display";
import styles from "./model-picker.module.css";

export function ModelPriceDetails({ model, parameters }: { model?: ModelDescriptor | null; parameters: Record<string, unknown> }) {
  if (model) model = normalizeTk1688CnyModel(model);
  const estimate = modelEstimatedCost(model, parameters);
  const priceCheckedAt = model?.pricing?.checkedAt ?? (typeof model?.metadata?.priceCheckedAt === "string" ? model.metadata.priceCheckedAt : undefined);
  const priceSourceUrl = model?.pricing?.sourceUrl ?? (typeof model?.metadata?.priceSourceUrl === "string" ? model.metadata.priceSourceUrl : undefined);
  const limits = model?.limits;
  const inputNotes = [
    limits?.maxInputImages !== undefined && `图片最多 ${limits.maxInputImages} 张`,
    limits?.maxInputVideos !== undefined && `视频最多 ${limits.maxInputVideos} 段`,
    limits?.maxInputAudios !== undefined && `音频最多 ${limits.maxInputAudios} 段`,
    limits?.maxInputAssets !== undefined && `素材合计最多 ${limits.maxInputAssets} 个`,
    limits?.maxInputVideoDurationSeconds !== undefined && `每段视频不超过 ${limits.maxInputVideoDurationSeconds} 秒`,
    limits?.maxTotalInputVideoDurationSeconds !== undefined && `视频总时长不超过 ${limits.maxTotalInputVideoDurationSeconds} 秒`,
    limits?.maxInputAudioDurationSeconds !== undefined && `每段音频不超过 ${limits.maxInputAudioDurationSeconds} 秒`,
    model?.metadata?.supportsFirstLastFrames === false && "不支持首尾帧",
    model?.metadata?.supportsFirstLastFrames === true && (model.metadata.allowFrameMediaMix === true ? "支持首尾帧与参考素材组合" : "首尾帧与参考素材分别使用"),
    limits?.requiresInputVideo && "必须提供参考视频",
    model?.metadata?.requiresImageWithAudio === true && "参考音频须搭配参考图片",
  ].filter(Boolean);
  return <div className={`node-config-price-summary ${styles.details}`} aria-label="当前参数价格">
    {model?.metadata?.qualitySupport === "provider-decided" && <span>质量 <strong>由模型决定</strong></span>}
    <span>当前组合价格 <strong>{modelPriceSummary(model ?? undefined, parameters)}</strong></span>
    {estimate && <span>本次预计费用 <strong>{estimate}</strong></span>}
    {inputNotes.length > 0 && <details><summary>参考素材与限制</summary><p>{inputNotes.join(" · ")}</p></details>}
    <details><summary>价格与参数依据</summary>
      <p>{String(model?.metadata?.priceLabel ?? "尚未取得价格")}</p>
      {typeof model?.metadata?.priceUnavailableReason === "string" && <p>{model.metadata.priceUnavailableReason}</p>}
      {typeof model?.metadata?.priceContractWarning === "string" && <p>{model.metadata.priceContractWarning}</p>}
      {estimate && <p>按当前参数与数量估算，最终费用以供应商实际扣费为准。</p>}
      {model?.metadata?.priceSource === "generated-result" && <p>按已生成请求的实际扣费参考；其他尺寸或质量尚无扣费样本。</p>}
      {priceCheckedAt && <p>价格资料更新于 {priceCheckedAt}{model?.pricing && model.pricing.confidence !== "exact" ? "；当前金额为参考值" : ""}</p>}
      {priceSourceUrl && <a href={priceSourceUrl} target="_blank" rel="noreferrer">查看价格来源</a>}
      {typeof model?.metadata?.supplierGroupResolutionLabel === "string" && <p>{model.metadata.supplierGroupResolutionLabel}</p>}
      {Array.isArray(model?.metadata?.imageCapabilityEvidence) && model.metadata.imageCapabilityEvidence.map((item: { id: string; resolution?: string; quality?: string; status: string; excerpt: string }) =>
        <p key={item.id}>{item.resolution ?? item.quality} · {({ declared: "说明支持", verified: "实测支持", inferred: "由 4K 推断", approximate: "近似档位", assumed: "暂定，待核验", unsupported: "不支持", conflict: "需要核对" } as Record<string, string>)[item.status]}：{item.excerpt}</p>)}
    </details>
  </div>;
}
