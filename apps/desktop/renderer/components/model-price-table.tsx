import type { ModelDescriptor } from "@super-canvas/providers";
import { modelPickerStructuredPrice, type ModelPickerPriceTier, type ModelPickerStructuredPrice } from "../lib/model-picker-data";
import { modelPriceLayout, modelPricePivotCellMatches } from "../lib/model-price-layout";
import { modelEstimatedQuote } from "../lib/model-display";
import styles from "./model-price-table.module.css";

function Historical({ checkedAt, label = "上次价格" }: { checkedAt?: string; label?: string }) {
  return <span className={styles.chip} title={`采样时间 ${checkedAt ?? "—"}`} aria-label={`${label}，采样时间 ${checkedAt ?? "—"}`}>{label}</span>;
}

function TierAmount({ tier, selected }: { tier: ModelPickerPriceTier; selected: boolean }) {
  const condition = tier.otherwise ? "其余条件" : tier.conditions.length
    ? `${tier.conditionMode === "none" ? "除外：" : ""}${tier.conditions.map(item => `${item.label} ${item.operator === "contains" ? "包含" : "="} ${item.value}`).join(tier.conditionMode === "all" || tier.matching === "unique-dimension" ? " 且 " : " 或 ")}` : tier.label;
  return <><span className={styles.amount} title={condition}>{tier.amount}</span>{selected && <span className={styles.current}>当前参数</span>}
    {tier.historical && <Historical checkedAt={tier.checkedAt} />}
    {!!tier.operations.length && <span className={styles.meta}>{tier.operations.map(operation => <span className={styles.chip} key={operation.value}>{operation.label}</span>)}</span>}
  </>;
}

/** Compact tariff presentation shared by candidates, parameter panels and suppliers. */
export function ModelPriceTable({ model, parameters, data: supplied }: {
  model?: ModelDescriptor | null;
  parameters?: Readonly<Record<string, unknown>>;
  data?: ModelPickerStructuredPrice;
}) {
  const data = supplied ?? modelPickerStructuredPrice(model);
  const selected = parameters ? modelEstimatedQuote(model, parameters) : undefined;
  const selectedIndex = selected?.tierIndex;
  const layout = modelPriceLayout(data.tiers);
  const hasRates = data.fixedAmount !== undefined || data.tokenRates.length > 0 || data.tiers.length > 0;
  const measuredLabel = data.measuredPrices.find(sample => sample.label);
  return <div className={styles.root}>
    <div className={styles.meta}>
      {!measuredLabel && data.operations.map(operation => <span className={styles.chip} key={operation.value}>{operation.label}</span>)}
      {hasRates && !measuredLabel && <span className={styles.muted}>{data.displayCurrency} / {data.unit}</span>}
      {!measuredLabel && data.confidence !== undefined && data.confidence !== "exact" && <span className={styles.chip}>{data.confidence === "estimate" ? "参考" : "目录快照"}</span>}
      {data.historical && data.historical.label !== "部分上次价格" && <Historical {...data.historical} />}
      {data.historical?.label === "部分上次价格" && <span className={styles.chip}>部分上次价格</span>}
    </div>
    {hasRates && !measuredLabel && <>
      {data.fixedAmount !== undefined && <dl className={styles.facts}><div className={styles.fact}><dt>固定价</dt><dd className={styles.amount}>{data.fixedAmount} {data.displayCurrency} / {data.unit}</dd></div></dl>}
      {!!data.tokenRates.length && <div className={styles.scroll}><table className={styles.table} aria-label="Token 单价"><thead><tr><th scope="col">Token</th><th scope="col">{data.displayCurrency} / {data.unit}</th></tr></thead><tbody>
        {data.tokenRates.map(rate => <tr key={rate.label}><th scope="row">{rate.label}</th><td className={styles.amount}>{rate.amount}</td></tr>)}
      </tbody></table></div>}
      {layout.kind === "pivot" ? <>
        {layout.groups.map((group, groupIndex) => <section key={group.key} className={styles.group}>
          {group.label && <h5 className={styles.groupTitle}>{group.label}</h5>}
          <div className={styles.scroll}><table className={styles.table} aria-label={group.label ? `${group.label}价格档位` : "价格档位"}>
            <thead><tr><th scope="col">{layout.rowDimension.label}{layout.columnDimension ? ` / ${layout.columnDimension.label}` : ""}</th>{layout.columns.map(column => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
            <tbody>{group.rows.map((row, rowIndex) => <tr key={row.key}><th scope="row">{row.label}</th>{row.cells.map((tier, index) => {
              const active = !!tier && tier.sourceIndex === selectedIndex && !!selected && modelPricePivotCellMatches(layout, groupIndex, rowIndex, index, selected.parameters);
              return <td key={layout.columns[index]!.key} className={active ? styles.selected : undefined}>
                {tier ? <TierAmount tier={tier} selected={active} /> : "—"}
              </td>;
            })}</tr>)}</tbody>
          </table></div>
        </section>)}
        {layout.hasRemainder && <span className={styles.muted}>“其余”包含该维度未列出的值；各格按原档位顺序取首个匹配价。</span>}
      </> : !!layout.tiers.length && <div className={styles.scroll}><table className={styles.table} aria-label="价格条件列表"><thead><tr><th scope="col">条件</th><th scope="col">金额</th></tr></thead><tbody>
        {layout.tiers.map(tier => <tr key={`${tier.sourceIndex}:${tier.id}`}>
          <th scope="row">
            {tier.conditions.length > 1 && <span className={styles.conditionMode}>{tier.conditionMode === "all" ? "全部满足" : tier.conditionMode === "none" ? "全部除外" : "任一满足"}</span>}
            {tier.conditionMode === "none" && tier.conditions.length === 1 && <span className={styles.conditionMode}>除外</span>}
            <span className={styles.conditions}>{tier.otherwise ? <span className={styles.chip}>其余条件</span> : tier.conditions.length ? tier.conditions.map((condition, index) =>
              <span key={index} className={styles.chip}><span>{condition.label}</span>{" "}<span className={styles.muted}>{condition.operator === "contains" ? "包含" : "="}</span>{" "}<strong>{condition.value}</strong></span>) : <span className={styles.chip}>{tier.label}</span>}</span>
          </th>
          <td className={tier.sourceIndex === selectedIndex ? styles.selected : undefined}><TierAmount tier={tier} selected={tier.sourceIndex === selectedIndex} /></td>
        </tr>)}
      </tbody></table></div>}
    </>}
    {!hasRates && !measuredLabel && <span className={data.prose ? undefined : styles.empty}>{data.prose ?? "—"}</span>}
    {!!data.measuredPrices.length && <section className={styles.group} aria-label="实测价格及参数"><h5 className={styles.groupTitle}>实测价格及参数</h5>
      {data.measuredPrices.map((sample, index) => <div className={styles.sample} key={index}>
        <strong>{sample.label ?? (sample.amount !== undefined ? `${sample.amount} ${sample.currency === "credits" ? "额度" : sample.currency ?? "—"}${sample.unit ? ` / ${sample.unit}` : ""}` : "—")}</strong>
        <dl className={styles.facts}>
          {sample.parameters.map((parameter, parameterIndex) => <div className={styles.fact} key={`${parameter.parameter}:${parameterIndex}`}><dt>{parameter.label}</dt><dd>{parameter.value}</dd></div>)}
          {!sample.parameters.length && <div className={styles.fact}><dt>实测请求参数</dt><dd>{sample.parametersState === "omitted" ? "省略" : "—"}</dd></div>}
          {sample.checkedAt && <div className={styles.fact}><dt>采样时间</dt><dd><time dateTime={sample.checkedAt}>{sample.checkedAt}</time></dd></div>}
        </dl>
      </div>)}
    </section>}
    {(data.timeMultipliers.length > 0 || data.billingIncludesInputDuration) && <dl className={styles.notes}>
      {data.timeMultipliers.map((window, index) => <div className={styles.fact} key={index}><dt>时段倍率</dt><dd><span>上海 {window.weekdaysOnly ? "周一至周五 " : ""}{window.startHour}:00–{window.endHour}:00</span> <strong>×{window.multiplier}</strong></dd></div>)}
      {data.billingIncludesInputDuration && <div className={styles.fact}><dt>计费时长</dt><dd>输入 + 输出视频</dd></div>}
    </dl>}
  </div>;
}
