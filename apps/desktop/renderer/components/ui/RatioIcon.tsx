import styles from "./parameter-ui.module.css";

/** Decorative ratio silhouette; it never derives or writes output dimensions. */
export function RatioIcon({ ratio, className = "" }: { ratio: string; className?: string }) {
  const match = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  const aspect = match && Number(match[1]) > 0 && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : 1;
  const width = aspect >= 1 ? 18 : Math.max(4, 18 * aspect);
  const height = aspect <= 1 ? 18 : Math.max(4, 18 / aspect);
  return <svg className={`${styles.ratioIcon} ${className}`} width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
    <rect x={(22 - width) / 2} y={(22 - height) / 2} width={width} height={height} rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
  </svg>;
}
