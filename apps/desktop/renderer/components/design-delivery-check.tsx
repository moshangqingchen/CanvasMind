"use client";
import { useRef, useState } from "react";
import { readImageDesignReview } from "@super-canvas/core";
import type { AssetView } from "./types";
import type { ProjectResult } from "../lib/project-results";
import { downloadBlob } from "../lib/blob-download";
import {
  createDesignDelivery,
  DELIVERY_CHECKS,
  type DeliveryCheck,
} from "../lib/design-delivery";

export function DesignDeliveryCheck({
  asset,
  context,
  dimensions,
  sourceReady,
}: {
  asset: AssetView;
  context?: ProjectResult;
  dimensions: { width: number; height: number } | null;
  sourceReady: boolean;
}) {
  const [checks, setChecks] = useState<DeliveryCheck[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const approved = readImageDesignReview(asset.metadata).status === "approved";
  return (
    <details className="library-delivery">
      <summary>交付检查与导出</summary>
      <p>对照原要求与原图完成核对，导出原始成图和交付记录。</p>
      <p>
        实际尺寸：
        {dimensions
          ? `${dimensions.width} × ${dimensions.height} px`
          : "正在读取或暂不可用"}
      </p>
      {DELIVERY_CHECKS.map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={checks.includes(key)}
            disabled={busy}
            onChange={(event) =>
              setChecks((current) =>
                event.target.checked
                  ? [...current, key]
                  : current.filter((value) => value !== key),
              )
            }
          />
          {label}
        </label>
      ))}
      {!approved && <p>请先在评审中选择「定稿」并保存。</p>}
      {!sourceReady && <p>等待完整需求读取成功后可导出。</p>}
      <button
        type="button"
        className="button primary"
        disabled={
          busy ||
          !approved ||
          !dimensions ||
          !sourceReady ||
          checks.length !== DELIVERY_CHECKS.length
        }
        onClick={async () => {
          if (busyRef.current || !dimensions) return;
          busyRef.current = true;
          setBusy(true);
          setMessage("");
          try {
            const blob = await createDesignDelivery({
              asset,
              context,
              dimensions,
              checks,
            });
            downloadBlob(blob, `定稿交付-${asset.id}.zip`);
            setMessage("已导出原始成图与交付检查记录");
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "导出失败，请重试",
            );
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? "正在打包…" : "导出定稿交付包"}
      </button>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
