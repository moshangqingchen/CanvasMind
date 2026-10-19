import { Fragment } from "react";
import { compactPriceParts } from "../lib/model-price-compact-layout";
import styles from "./node-parameter-rate.module.css";

/** Only visual boundaries: retain the complete quote and its qualifications. */
export function NodeParameterRate({ label }: { label: string }) {
  const quote = label || "—";
  return <strong className={styles.rate} data-testid="param-panel-unit-price" title={quote} aria-label={quote}>
    {compactPriceParts(quote).map((part, index) => {
      const separator = part.indexOf(" / ");
      return <Fragment key={index}>{/^\s/u.test(part) ? " " : ""}<span className={styles.part}>
        {separator < 0 ? part.trimStart() : <>{part.slice(0, separator).trimStart()}<span className={styles.unit}>{part.slice(separator)}</span></>}
      </span></Fragment>;
    })}
  </strong>;
}
