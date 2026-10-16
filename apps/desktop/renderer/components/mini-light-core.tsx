import { memo } from "react";
import styles from "./mini-light-core.module.css";

/** The same silver shell / ember identity as the workspace, without a second GPU context. */
export const MiniLightCore = memo(function MiniLightCore({ size = 24, state = "idle" }: {
  size?: number; state?: "idle" | "thinking" | "streaming" | "error";
}) {
  return <i aria-hidden="true" className={styles.core} data-state={state}
    style={{ width: size, height: size }}><i className={styles.shell} /><i className={styles.ember} /></i>;
});
