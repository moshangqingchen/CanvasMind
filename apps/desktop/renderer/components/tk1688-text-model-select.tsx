"use client";

import type { StructuredModelPricing } from "@super-canvas/providers";

import {
  groupTk1688Models,
  tk1688ModelFamily,
  tk1688RouteLabel,
  tk1688RouteSummary,
  type Tk1688DisplayModel,
} from "../lib/tk1688-model-display";
import styles from "./tk1688-text-model-select.module.css";

export interface Tk1688TextModel extends Tk1688DisplayModel {
  pricing?: StructuredModelPricing;
  available?: boolean;
  reason?: string;
}

interface Props {
  models: readonly Tk1688TextModel[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
}

function tokenPrice(model: Tk1688TextModel): string {
  const label = model.metadata?.priceLabel;
  if (typeof label === "string" && label.trim()) return label;
  const price = model.pricing;
  if (price?.kind !== "token") return "Token 报价暂未公布";
  const amount = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value)
      ? `${value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} ${price.currency}/1M token`
      : "未公布";
  return `输入 ${amount(price.inputPerMillion)} · 输出 ${amount(price.outputPerMillion)}`;
}

/** The exact provider ID remains the controlled value. Directory updates only
 * change the displayed facts; selecting a family or route is the only mutation. */
export function Tk1688TextModelSelect({
  models,
  value,
  onChange,
  disabled = false,
  loading = false,
  label = "超级导演模型",
}: Props) {
  const inventory: Tk1688TextModel[] = [...models];
  if (value && !inventory.some((model) => model.id === value))
    inventory.push({ id: value, name: value });
  const groups = groupTk1688Models(inventory);
  const groupedIds = new Set(groups.flatMap((group) => group.models.map((model) => model.id)));
  // Old saved descriptors may lack marketplace facts. Keep their exact IDs
  // visible without claiming a model family, route or price we do not know.
  for (const model of inventory) {
    if (!groupedIds.has(model.id))
      groups.push({ id: model.id, models: [model], merchants: [] });
  }
  const current = inventory.find((model) => model.id === value);
  const family = current ? tk1688ModelFamily(current) ?? current.id : "";
  const selectedGroup = groups.find((group) => group.id === family);
  const route = current ? tk1688RouteLabel(current) : undefined;
  const summary = current ? tk1688RouteSummary(current) : undefined;
  const chooseFamily = (id: string) => {
    const group = groups.find((candidate) => candidate.id === id);
    if (!group) return;
    const next = group.smart?.available !== false ? group.smart : undefined;
    const available = next ?? group.models.find((model) => model.available !== false);
    if (available && available.id !== value) onChange(available.id);
  };

  return (
    <div className={styles.root} aria-label={`${label}与线路`}>
      <div className={styles.selectors}>
        <label className={styles.field}>
          <span>模型</span>
          <select
            aria-label={label}
            value={family}
            disabled={disabled || loading || groups.length === 0}
            onChange={(event) => chooseFamily(event.target.value)}
          >
            {!family && <option value="">{loading ? "读取模型…" : "选择模型"}</option>}
            {groups.map((group) => (
              <option
                key={group.id}
                value={group.id}
                disabled={group.models.every((model) => model.available === false)}
              >
                {group.id}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>线路 / 商家</span>
          <select
            aria-label={`${label}线路`}
            value={value}
            disabled={disabled || loading || !selectedGroup}
            onChange={(event) => {
              if (event.target.value !== value) onChange(event.target.value);
            }}
          >
            {!value && <option value="">选择线路</option>}
            {selectedGroup?.models.map((model) => (
              <option key={model.id} value={model.id} disabled={model.available === false}>
                {tk1688RouteLabel(model) ?? "已保存线路"}
                {model.available === false ? ` · ${model.reason ?? "暂不可用"}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {current && (
        <div className={styles.facts}>
          <p className={styles.summary}>
            <strong>{route ?? "已保存线路"}</strong>
            {summary ? ` · ${summary}` : " · 目录未提供商家说明"}
          </p>
          <p className={styles.price} aria-label={`${label}报价`}>{tokenPrice(current)}</p>
          <details className={styles.details}>
            <summary>完整模型 ID</summary>
            <code>{current.id}</code>
          </details>
        </div>
      )}
    </div>
  );
}
