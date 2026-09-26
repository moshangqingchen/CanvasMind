"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: it replaces the root layout, so it cannot rely on
 * globals.css being applied and ships its own minimal styling.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[super-canvas] 应用崩溃", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0d12",
          color: "#edf2ff",
          fontFamily: 'Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif',
        }}
      >
        <main
          style={{
            maxWidth: 440,
            padding: 32,
            borderRadius: 18,
            border: "1px solid #2a3345",
            background: "#121621",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: "0 0 10px", fontSize: 19 }}>超级画布无法启动</h1>
          <p style={{ margin: "0 0 20px", color: "#8e9ab2", lineHeight: 1.7 }}>
            应用在初始化阶段崩溃了。画布数据保存在服务端，重试通常即可恢复。
          </p>
          {error.digest ? (
            <p style={{ margin: "0 0 18px", color: "#8e9ab2", fontSize: 12 }}>
              错误编号：{error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: 0,
              background: "linear-gradient(135deg, #a796ff, #56dfbd)",
              color: "#0b0d12",
              fontWeight: 650,
              cursor: "pointer",
            }}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
