"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect } from "react";

/**
 * Without this the canvas is a single client component: one render error blanks
 * the page with no way back. The canvas itself is persisted server-side, so
 * "重新加载" is a real recovery and not just a cosmetic retry.
 */
export default function CanvasError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[super-canvas] 画布渲染失败", error);
  }, [error]);

  return (
    <div className="fatal-screen" role="alert">
      <div className="fatal-card">
        <span className="fatal-icon" aria-hidden="true">
          <CircleAlert size={26} />
        </span>
        <h1>画布加载失败</h1>
        <p>
          界面遇到了一个未处理的错误。已保存的画布内容不受影响，可以直接重试。
        </p>
        {error.digest ? (
          <p className="fatal-digest">错误编号：{error.digest}</p>
        ) : null}
        <div className="fatal-actions">
          <button className="button primary" type="button" onClick={reset}>
            <RefreshCw size={15} /> 重试
          </button>
          <button
            className="button"
            type="button"
            onClick={() => window.location.reload()}
          >
            重新加载页面
          </button>
        </div>
      </div>
    </div>
  );
}
