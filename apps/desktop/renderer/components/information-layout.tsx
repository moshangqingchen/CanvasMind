import type { ReactNode } from "react";
import "./information-layout.css";

export interface InformationItem {
  label: string;
  value: ReactNode;
  /** Keep protocol words whole; endpoint paths may wrap only after slashes. */
  identifier?: "token" | "path";
}

export function InformationIdentifier({ value, kind = "token" }: { value: string; kind?: "token" | "path" }) {
  return <code className={`information-identifier${kind === "path" ? " information-identifier-path" : ""}`} title={value}>
    {kind === "path" ? value.split("/").map((segment, index, segments) => <span className="information-identifier-segment" key={index}>
      {segment}{index < segments.length - 1 ? "/" : ""}
    </span>) : value}
  </code>;
}

export function InformationGrid({ items, label }: { items: readonly InformationItem[]; label?: string }) {
  return <dl className="information-grid" aria-label={label}>
    {items.map((item, index) => <div className={item.identifier ? "information-identifier-row" : undefined} key={`${item.label}:${index}`}>
      <dt>{item.label}</dt><dd>{item.identifier && typeof item.value === "string" ? <InformationIdentifier value={item.value} kind={item.identifier} /> : item.value ?? "—"}</dd>
    </div>)}
  </dl>;
}

export function InformationChips({ values }: { values: readonly ReactNode[] }) {
  return <span className="information-chips">{values.map((value, index) => <span key={index}>{value}</span>)}</span>;
}

export function DirectoryComparisonStats({ catalog, keyCount, shared, catalogOnly }: {
  catalog: number | string;
  keyCount: number | string;
  shared: number | string;
  catalogOnly: number | string;
}) {
  return <dl className="directory-comparison-stats" aria-label="官网与 Key 目录对照">
    {[{ label: "官网目录", value: catalog }, { label: "Key", value: keyCount }, { label: "双方", value: shared },
      { label: "官网额外", value: catalogOnly, note: "仅目录" }].map(item => <div key={item.label}>
      <dt>{item.label}</dt>{" "}<dd>{item.value}</dd>{item.note && <small>（{item.note}）</small>}
    </div>)}
  </dl>;
}
