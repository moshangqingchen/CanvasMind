"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Brush, ChevronLeft, ChevronRight, Film, X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";
import { assetDownloadPath, downloadAssetPreferLocal } from "../lib/asset-download";
import { ImageDownloadButton } from "./image-download-button";
import type { AssetView } from "./types";
import { DynamicPanelLoading, WarmPanelBoundary } from "./panel-loading";
import { DeferredPanelContent } from "./deferred-panel-content";
export { SettingsModal } from "./settings-modal";
type RunHistoryProps = ComponentProps<typeof import("./task-center").RunHistoryModal>;
type GenerationHistoryProps = ComponentProps<typeof import("./image-library").GenerationHistoryModal>;
const LoadedRunHistoryModal = dynamic<RunHistoryProps>(
  () => import("./task-center").then(module => module.RunHistoryModal),
  { ssr: false, loading: DynamicPanelLoading },
);
const LoadedGenerationHistoryModal = dynamic<GenerationHistoryProps>(
  () => import("./image-library").then(module => module.GenerationHistoryModal),
  { ssr: false, loading: DynamicPanelLoading },
);

export function RunHistoryModal(props: RunHistoryProps) {
  return <WarmPanelBoundary open={props.open} onClose={props.onClose} title="任务中心" dialogLabel="运行历史">
    <DeferredPanelContent fallback={<DynamicPanelLoading />}>
      <LoadedRunHistoryModal {...props} />
    </DeferredPanelContent>
  </WarmPanelBoundary>;
}

export function GenerationHistoryModal(props: GenerationHistoryProps) {
  return <WarmPanelBoundary open={props.open} onClose={props.onClose} title="素材库" dialogLabel="历史生成">
    <DeferredPanelContent fallback={<DynamicPanelLoading />}>
      <LoadedGenerationHistoryModal {...props} />
    </DeferredPanelContent>
  </WarmPanelBoundary>;
}

export function AssetPreviewModal({
  asset,
  onClose,
  onBack,
  onEditMask,
  returnFocus,
  orderedAssets,
  onSelectAsset,
}: {
  asset: AssetView | null;
  onClose: () => void;
  onBack?: () => void;
  onEditMask?: (assetId: string) => void;
  returnFocus?: HTMLElement | null;
  orderedAssets?: readonly AssetView[];
  onSelectAsset?: (asset: AssetView) => void;
}) {
  const dialogRef = useDialogFocus(Boolean(asset), onClose, returnFocus);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageDragging, setImageDragging] = useState(false);
  const [viewAssetId, setViewAssetId] = useState(asset?.id);
  // Reset image-local state before the new image paints, while retaining the
  // dialog element and its focus for consecutive keyboard navigation.
  if (viewAssetId !== asset?.id) {
    setViewAssetId(asset?.id);
    setImageZoom(1);
    setImageDragging(false);
  }
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const pointer = imageDragRef.current?.pointerId;
    if (pointer !== undefined && stage?.hasPointerCapture(pointer)) stage.releasePointerCapture(pointer);
    imageDragRef.current = null;
    if (stage) { stage.scrollLeft = 0; stage.scrollTop = 0; }
  }, [asset?.id]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || asset?.kind !== "image") return;
    let wheelFrame = 0;
    let currentZoom = 1;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const previousZoom = currentZoom;
      const nextZoom = Math.min(5, Math.max(0.25,
        Number((previousZoom + (event.deltaY < 0 ? 0.15 : -0.15)).toFixed(2)),
      ));
      if (nextZoom === previousZoom) return;
      const bounds = stage.getBoundingClientRect();
      const cursorX = event.clientX - bounds.left;
      const cursorY = event.clientY - bounds.top;
      const contentX = stage.scrollLeft + cursorX;
      const contentY = stage.scrollTop + cursorY;
      currentZoom = nextZoom;
      setImageZoom(nextZoom);
      window.cancelAnimationFrame(wheelFrame);
      wheelFrame = window.requestAnimationFrame(() => {
        const scale = nextZoom / previousZoom;
        stage.scrollLeft = contentX * scale - cursorX;
        stage.scrollTop = contentY * scale - cursorY;
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => { stage.removeEventListener("wheel", onWheel); window.cancelAnimationFrame(wheelFrame); };
  }, [asset?.id, asset?.kind]);
  if (!asset) return null;
  const index = orderedAssets?.findIndex(item => item.id === asset.id) ?? -1;
  const previous = index > 0 ? orderedAssets?.[index - 1] : undefined;
  const next = index >= 0 ? orderedAssets?.[index + 1] : undefined;
  const url = assetDownloadPath(asset.id);
  const stopImageDrag = (pointerId: number, releaseCapture = true) => {
    const stage = stageRef.current;
    if (imageDragRef.current?.pointerId !== pointerId) return;
    imageDragRef.current = null;
    setImageDragging(false);
    if (releaseCapture && stage?.hasPointerCapture(pointerId))
      stage.releasePointerCapture(pointerId);
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal-window asset-modal"
        role="dialog"
        aria-modal="true"
        aria-label="素材预览"
        tabIndex={-1}
        onKeyDown={event => {
          if (!onSelectAsset || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target as HTMLElement).closest("input,textarea,video,audio,[contenteditable=true]")) return;
          const target = event.key === "ArrowLeft" ? previous : event.key === "ArrowRight" ? next : undefined;
          if (target) { event.preventDefault(); event.stopPropagation(); onSelectAsset(target); }
        }}
      >
        <header className="modal-head">
          <div className="asset-modal-heading">
            {onBack ? (
              <button
                className="icon-button asset-back-button"
                type="button"
                onClick={onBack}
                aria-label="返回历史生成"
                title="返回历史生成"
              >
                <ArrowLeft size={17} />
              </button>
            ) : null}
            <div>
              <span className="eyebrow">素材预览</span>
              <h2 title={asset.name}>{asset.name}</h2>
            </div>
          </div>
          <div className="modal-head-actions">
            {onSelectAsset && orderedAssets && orderedAssets.length > 1 ? <>
              <button className="icon-button" type="button" disabled={!previous} onClick={() => previous && onSelectAsset(previous)} aria-label="上一素材" title="上一素材（←）"><ChevronLeft size={17} /></button>
              <span className="asset-zoom-level">{index + 1} / {orderedAssets.length}</span>
              <button className="icon-button" type="button" disabled={!next} onClick={() => next && onSelectAsset(next)} aria-label="下一素材" title="下一素材（→）"><ChevronRight size={17} /></button>
            </> : null}
            {asset.kind === "image" && onEditMask && <button className="button small" type="button"
              onClick={() => onEditMask(asset.id)}><Brush size={15} /> 绘制蒙版</button>}
            {asset.kind === "image" ? (
              <span className="asset-zoom-level">
                {Math.round(imageZoom * 100)}%
              </span>
            ) : null}
            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="关闭"
              title="关闭（Esc）"
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div
          ref={stageRef}
          className={`asset-stage ${asset.kind === "image" ? "image-zoom-stage" : ""} ${asset.kind === "image" && imageZoom > 1 ? "can-pan" : ""} ${imageDragging ? "is-dragging" : ""}`}
          onPointerDown={(event) => {
            if (asset.kind !== "image" || imageZoom <= 1 || event.button !== 0)
              return;
            const stage = stageRef.current;
            if (!stage) return;
            event.preventDefault();
            event.stopPropagation();
            stage.setPointerCapture(event.pointerId);
            imageDragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              scrollLeft: stage.scrollLeft,
              scrollTop: stage.scrollTop,
            };
            setImageDragging(true);
          }}
          onPointerMove={(event) => {
            const drag = imageDragRef.current;
            const stage = stageRef.current;
            if (!drag || !stage || drag.pointerId !== event.pointerId) return;
            event.preventDefault();
            stage.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
            stage.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
          }}
          onPointerUp={(event) => stopImageDrag(event.pointerId)}
          onPointerCancel={(event) => stopImageDrag(event.pointerId)}
          onLostPointerCapture={(event) =>
            stopImageDrag(event.pointerId, false)
          }
        >
          {asset.kind === "video" && asset.metadata.fake !== true ? (
            <video src={url} controls preload="metadata" />
          ) : asset.kind === "video" ? (
            <div className="fake-video-stage">
              <Film size={42} />
              <strong>Fake Provider 视频结果</strong>
              <span>接入 Runway 或 REST 视频 API 后将在这里播放真实视频。</span>
            </div>
          ) : asset.kind === "audio" ? (
            <audio src={url} controls preload="metadata" />
          ) : (
            <div
              className={`asset-image-canvas ${imageZoom > 1 ? "is-zoomed" : ""}`}
              style={{
                width: `${imageZoom * 100}%`,
                height: `${imageZoom * 100}%`,
              }}
            >
              <img src={url} alt={asset.name} draggable={false} />
            </div>
          )}
        </div>
        <footer className="asset-footer">
          <span>
            {asset.mimeType} · {Math.max(1, Math.round(asset.size / 1024))} KB
          </span>
          {asset.kind === "image" ? (
            <ImageDownloadButton key={asset.id} assetId={asset.id} filename={asset.name} className="button primary" label="下载图片" />
          ) : <a
            className="button primary"
            href={url}
            download={asset.name}
            onClick={(event) => {
              event.preventDefault();
              void downloadAssetPreferLocal(asset.id, asset.name);
            }}
          >
            下载原文件
          </a>}
        </footer>
      </section>
    </div>
  );
}
