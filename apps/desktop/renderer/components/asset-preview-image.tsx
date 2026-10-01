"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";
import styles from "./asset-preview-image.module.css";

interface OriginalResource {
  references: number;
  controller: AbortController;
  promise: Promise<string>;
  objectUrl?: string;
  disposeTimer?: ReturnType<typeof setTimeout>;
}

// The canvas and reference strip can show the same image. Share one fallback
// download and Blob URL while either is mounted, even though /content is no-store.
const originals = new Map<string, OriginalResource>();

function acquireOriginal(assetId: string) {
  let resource = originals.get(assetId);
  if (!resource) {
    const controller = new AbortController();
    const created: OriginalResource = {
      references: 0,
      controller,
      promise: Promise.resolve(""),
    };
    created.promise = (async () => {
      const response = await fetch(
        `/api/assets/${encodeURIComponent(assetId)}/content`,
        {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30_000),
          ]),
        },
      );
      if (
        !response.ok ||
        !response.headers.get("content-type")?.startsWith("image/")
      ) {
        throw new Error("Original image is unavailable");
      }
      const blob = await response.blob();
      if (!blob.size || controller.signal.aborted)
        throw new Error("Original image is empty or cancelled");
      created.objectUrl = URL.createObjectURL(blob);
      return created.objectUrl;
    })();
    resource = created;
    originals.set(assetId, resource);
  }
  if (resource.disposeTimer) clearTimeout(resource.disposeTimer);
  resource.references += 1;
  const leased = resource;
  let released = false;
  return {
    promise: leased.promise,
    release() {
      if (released) return;
      released = true;
      leased.references -= 1;
      if (leased.references !== 0) return;
      // Let synchronous remounts reuse the request, then release large image
      // buffers immediately when no displayed image still needs them.
      leased.disposeTimer = setTimeout(() => {
        if (leased.references !== 0) return;
        leased.controller.abort();
        if (leased.objectUrl) URL.revokeObjectURL(leased.objectUrl);
        if (originals.get(assetId) === leased) originals.delete(assetId);
      }, 0);
    },
  };
}

interface AssetPreviewImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "onError" | "alt"
> {
  assetId?: string;
  src: string;
  alt: string;
  compact?: boolean;
  failureHint?: string;
}

export function AssetPreviewImage(props: AssetPreviewImageProps) {
  // A preview size change must keep this asset's original fallback and lease.
  // A different asset (or an untracked source) starts with fresh preview state.
  const resourceKey = props.assetId ? `asset:${props.assetId}` : `source:${props.src}`;
  return <AssetPreviewImageResource key={resourceKey} {...props} />;
}

function AssetPreviewImageResource({
  assetId,
  src,
  alt,
  compact = false,
  failureHint = "文件可能不完整，请重新导入原图",
  ...imageProps
}: AssetPreviewImageProps) {
  const [state, setState] = useState<
    "preview" | "loading-original" | "original" | "failed"
  >("preview");
  const [originalUrl, setOriginalUrl] = useState("");
  const attemptedOriginal = useRef(false);
  const alive = useRef(true);
  const releaseOriginal = useRef<(() => void) | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      releaseOriginal.current?.();
      releaseOriginal.current = null;
    };
  }, []);

  function handleError() {
    if (!assetId || attemptedOriginal.current) {
      setState("failed");
      return;
    }
    attemptedOriginal.current = true;
    setState("loading-original");
    const lease = acquireOriginal(assetId);
    releaseOriginal.current = lease.release;
    void lease.promise
      .then((url) => {
        if (!alive.current) return;
        setOriginalUrl(url);
        setState("original");
      })
      .catch(() => {
        if (alive.current) setState("failed");
      });
  }

  if (state === "failed") {
    return (
      <div
        className={`${styles.message} ${styles.failure} ${compact ? styles.compact : ""}`}
        data-asset-preview-state="failed"
        role="img"
        aria-label={`图片加载失败：${alt}。${failureHint}。`}
        title={`图片加载失败：${alt}。${failureHint}。`}
      >
        <ImageOff size={compact ? 14 : 23} aria-hidden="true" />
        <strong>{compact ? "加载失败" : "图片加载失败"}</strong>
        {!compact && <span>{failureHint}</span>}
      </div>
    );
  }
  if (state === "loading-original") {
    return (
      <div
        className={`${styles.message} ${compact ? styles.compact : ""}`}
        data-asset-preview-state="loading-original"
        role="status"
        aria-label="正在尝试读取原图"
        title="缩略图加载失败，正在尝试读取原图"
      >
        <LoaderCircle
          size={compact ? 14 : 20}
          className={styles.spin}
          aria-hidden="true"
        />
        {!compact && <span>正在尝试读取原图…</span>}
      </div>
    );
  }
  return (
    <img
      {...imageProps}
      src={state === "original" ? originalUrl : src}
      alt={alt}
      data-asset-preview-state={state}
      onError={handleError}
    />
  );
}
