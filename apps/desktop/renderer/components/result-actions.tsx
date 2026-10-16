"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Brush, CopyPlus, Download, FileText, LoaderCircle, MoreHorizontal, RotateCcw, ScanText, ZoomIn, ZoomOut } from "lucide-react";
import type { CanvasNodeData } from "./types";
import { assetDownloadPath, downloadAssetPreferLocal } from "../lib/asset-download";
import { ImageDownloadButton } from "./image-download-button";
import styles from "./result-feedback.module.css";

export function canReverseResultPrompt(data: Pick<CanvasNodeData, "onPrepareReversePrompt">, hasMedia: boolean) {
  return hasMedia && typeof data.onPrepareReversePrompt === "function";
}

export function ResultActions({ data, filename, prompt, hasMedia, zoom, onZoom }: {
  data: CanvasNodeData;
  filename?: string;
  prompt: string;
  hasMedia: boolean;
  zoom: number;
  onZoom: (value: number) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [reusing, setReusing] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = (restoreFocus = false) => {
    setMoreOpen(false);
    setPromptOpen(false);
    if (restoreFocus) moreButton.current?.focus();
  };
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [moreOpen]);
  useEffect(() => {
    if (moreOpen) host.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [moreOpen]);
  return <div ref={host} className={`generated-result-actions-wrap ${styles.actionsWrap} nodrag nopan nowheel`}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && moreOpen) { event.preventDefault(); close(true); }
    }}>
    <div className={`generated-result-actions ${styles.actions}`} role="toolbar" aria-label="生成结果操作">
      {hasMedia && data.assetKind === "image" && data.assetId ? <button type="button" className={styles.editButton} title="改版：绘制蒙版，局部修改" aria-label="改版：绘制蒙版，局部修改" onClick={() => data.onEditMask?.(data.assetId!)}><Brush size={14} aria-hidden="true" />改版</button> : null}
      {hasMedia && data.assetKind === "image" ? <div className={styles.zoom} role="group" aria-label="图片缩放">
        <button type="button" aria-label="缩小图片" title="缩小图片" disabled={zoom <= 0.5} onClick={() => onZoom(zoom - 0.25)}><ZoomOut size={14} aria-hidden="true" /></button>
        <button type="button" aria-label="还原图片缩放" title="还原图片缩放" disabled={zoom === 1} onClick={() => onZoom(1)}><RotateCcw size={14} aria-hidden="true" /></button>
        <button type="button" aria-label="放大图片" title="放大图片" disabled={zoom >= 3} onClick={() => onZoom(zoom + 0.25)}><ZoomIn size={14} aria-hidden="true" /></button>
      </div> : null}
      {data.assetId && data.assetKind === "image" ? <ImageDownloadButton assetId={data.assetId} filename={filename} className={styles.downloadButton} ariaLabel={`下载 ${data.label}`} onOpenChange={data.onConfigurationOpenChange} /> : data.assetId ? <a href={assetDownloadPath(data.assetId)} download={filename ?? true} aria-label={`下载 ${data.label}`} title="下载结果" onClick={event => { event.preventDefault(); void downloadAssetPreferLocal(data.assetId!, filename); }}><Download size={14} aria-hidden="true" /></a> : null}
      <button ref={moreButton} type="button" aria-label="更多结果操作" title="更多结果操作" aria-haspopup="menu" aria-expanded={moreOpen} aria-controls={moreOpen ? menuId : undefined} onClick={() => moreOpen ? close() : setMoreOpen(true)} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setMoreOpen(true); } }}><MoreHorizontal size={17} aria-hidden="true" /></button>
    </div>
    {moreOpen ? <div id={menuId} className={styles.menu} role="menu" aria-label="更多结果操作" onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
      if (event.key === "Home" || event.key === "End") { event.preventDefault(); items[event.key === "Home" ? 0 : items.length - 1]?.focus(); }
      if (event.key === "Tab") close();
    }}>
      <button type="button" role="menuitem" aria-label={`查看 ${data.label} 原提示词`} aria-expanded={promptOpen} onClick={() => setPromptOpen(value => !value)}><FileText size={14} aria-hidden="true" />原提示词</button>
      <button type="button" role="menuitem" aria-label={`复用 ${data.label} 提示词`} disabled={reusing || !data.onReusePrompt} onClick={async () => {
        setReusing(true);
        try { await data.onReusePrompt?.(); close(); }
        finally { setReusing(false); }
      }}>{reusing ? <LoaderCircle size={14} aria-hidden="true" /> : <CopyPlus size={14} aria-hidden="true" />}复用提示词</button>
      <button type="button" role="menuitem" aria-label={`反推 ${data.label} 提示词`} disabled={!canReverseResultPrompt(data, hasMedia)} onClick={() => { data.onPrepareReversePrompt?.(); close(); }}><ScanText size={14} aria-hidden="true" />反推提示词</button>
      {promptOpen ? <div className={styles.prompt} role="note" aria-label="原提示词">{prompt}</div> : null}
    </div> : null}
  </div>;
}
