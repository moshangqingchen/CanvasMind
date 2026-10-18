import { Fragment } from "react";
import type { ModelDescriptor } from "@super-canvas/providers";
import { modelPickerPriceCompact } from "../lib/model-picker-data";
import { compactPriceParts } from "../lib/model-price-compact-layout";
import styles from "./model-price-compact.module.css";

/** Amount/unit, tier count and provenance each stay intact when a quote wraps. */
export function ModelPriceCompact({ model, label }: { model?: ModelDescriptor | null; label?: string }) {
  const quote = label ?? modelPickerPriceCompact(model);
  return <span className={styles.root} data-price-compact="" title={quote}>
    {/* An inline-block drops its own leading space, so keep that gap outside it. */}
    {compactPriceParts(quote).map((part, index) => <Fragment key={index}>{/^\s/u.test(part) ? " " : ""}<span className={styles.part} data-price-part="" title={part.trim()}>{part.trimStart()}</span></Fragment>)}
  </span>;
}
