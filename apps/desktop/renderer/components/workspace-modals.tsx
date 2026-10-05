"use client";
import { useRef, useState } from "react";
import { ArrowLeft, Brush, Film, X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";
import { assetDownloadPath, downloadAssetPreferLocal } from "../lib/asset-download";
import type { AssetView } from "./types";
export { SettingsModal } from "./settings-modal";
export { RunHistoryModal } from "./task-center";
export { GenerationHistoryModal } from "./image-library";

export function AssetPreviewModal({
  asset,
  onClose,
  onBack,
  onEditMask,
}: {
  asset: AssetView | null;
  onClose: () => void;
  onBack?: () => void;
  onEditMask?: (assetId: string) => void;
}) {
  const dialogRef = useDialogFocus(Boolean(asset), onClose);
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
  if (!asset) return null;
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
              <h2>{asset.name}</h2>
            </div>
          </div>
          <div className="modal-head-actions">
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
          onWheel={(event) => {
            if (asset.kind !== "image") return;
            event.preventDefault();
            event.stopPropagation();
            const stage = stageRef.current;
            if (!stage) return;
            const previousZoom = imageZoom;
            const nextZoom = Math.min(
              5,
              Math.max(
                0.25,
                Number(
                  (previousZoom + (event.deltaY < 0 ? 0.15 : -0.15)).toFixed(2),
                ),
              ),
            );
            if (nextZoom === previousZoom) return;
            const bounds = stage.getBoundingClientRect();
            const cursorX = event.clientX - bounds.left;
            const cursorY = event.clientY - bounds.top;
            const contentX = stage.scrollLeft + cursorX;
            const contentY = stage.scrollTop + cursorY;
            setImageZoom(nextZoom);
            window.requestAnimationFrame(() => {
              const scale = nextZoom / previousZoom;
              stage.scrollLeft = contentX * scale - cursorX;
              stage.scrollTop = contentY * scale - cursorY;
            });
          }}
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
          <a
            className="button primary"
            href={url}
            download={asset.name}
            onClick={(event) => {
              event.preventDefault();
              void downloadAssetPreferLocal(asset.id, asset.name);
            }}
          >
            下载原文件
          </a>
        </footer>
      </section>
    </div>
  );
}
