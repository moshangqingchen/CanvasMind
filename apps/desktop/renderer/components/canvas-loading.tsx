import { Layers3, LoaderCircle } from "lucide-react";
import styles from "./canvas-loading.module.css";

/** Shared by route streaming and the first client-side project read. */
export function CanvasLoading() {
  return (
    <main className={styles.loading} aria-busy="true">
      <div className={styles.status} role="status">
        <span className={styles.icon} aria-hidden="true"><Layers3 size={30} strokeWidth={1.5} /></span>
        <h1>正在打开创作空间</h1>
        <p>准备画布与素材，马上就好。</p>
        <LoaderCircle className={styles.spinner} size={20} aria-hidden="true" />
      </div>
    </main>
  );
}
