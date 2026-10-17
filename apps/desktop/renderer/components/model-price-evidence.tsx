import type { ModelDescriptor } from "@super-canvas/providers";
import { modelPriceEvidenceRows } from "../lib/model-price-evidence";
import styles from "./model-picker.module.css";

export function ModelPriceEvidence({ model }: { model?: ModelDescriptor | null }) {
  const rows = modelPriceEvidenceRows(model);
  if (!rows.length) return null;
  return <details className={styles.evidence} aria-label="公布价与实测依据"><summary>公布价、条件与实测记录</summary>
    <p>公布价与原请求实扣分别记录；历史价和不匹配的实测参数不作为本次确定费用。</p>
    <ul>{rows.map((row, index) => <li key={index}>
      <strong>{row.label}</strong><span>{row.amount}</span>
      {row.scope && <small>{row.scope}</small>}
      <small>采样时间 {row.checkedAt ? <time dateTime={row.checkedAt}>{row.checkedAt}</time> : "—"}</small>
      {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer">查看价格来源</a>}
    </li>)}</ul>
  </details>;
}
