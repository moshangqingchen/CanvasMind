"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, Ref } from "react";
import {
  ArrowLeft,
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleX,
  ImageOff,
  Layers,
  LoaderCircle,
  Move,
  PencilLine,
  RotateCcw,
  Save,
  Star,
} from "lucide-react";
import {
  IMAGE_REVIEW_LABELS,
  IMAGE_REVIEW_NOTE_LIMIT,
  readImageDesignReview,
  type ImageDesignReview,
  type ImageDesignReviewInput,
  type ImageReviewStatus,
} from "@super-canvas/core";
import type { AssetView } from "./types";
import { registerDesktopSave } from "../lib/desktop-client";
import { useDialogFocus } from "./use-dialog-focus";
import styles from "./image-design-compare.module.css";

interface ImageDesignCompareProps {
  ref?: Ref<ImageDesignCompareHandle>;
  assets: AssetView[];
  onClose: () => void;
  onDismiss: () => void;
  onSaveReview: (
    assetId: string,
    input: ImageDesignReviewInput,
  ) => Promise<AssetView>;
  onContinueEditing: (assetId: string) => void;
  onReuseAsset: (assetId: string) => void;
}

export interface ImageDesignCompareHandle {
  requestDismiss: () => void;
}

type Zoom = "fit" | 1 | 1.5 | 2 | 3;
type Pan = { x: number; y: number };
type ReviewDraft = Pick<ImageDesignReview, "status" | "note"> & {
  originalRevision: number;
};
type LeaveAction =
  | { kind: "close" }
  | { kind: "dismiss" }
  | { kind: "edit" | "reuse"; assetId: string };

const STATUS_ICONS = {
  unreviewed: Circle,
  candidate: Star,
  approved: CircleCheck,
  rejected: CircleX,
} as const;

const STATUSES: ImageReviewStatus[] = [
  "unreviewed",
  "candidate",
  "approved",
  "rejected",
];
const ZOOM_OPTIONS: Array<{ value: Zoom; label: string }> = [
  { value: "fit", label: "适合" },
  { value: 1, label: "100%" },
  { value: 1.5, label: "150%" },
  { value: 2, label: "200%" },
  { value: 3, label: "300%" },
];

function clampPan(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function latestReview(asset: AssetView, saved?: ImageDesignReview) {
  const incoming = readImageDesignReview(asset.metadata);
  return saved && saved.revision > incoming.revision ? saved : incoming;
}

function isDirty(draft: ReviewDraft | undefined, review: ImageDesignReview) {
  return Boolean(
    draft && (draft.status !== review.status || draft.note !== review.note),
  );
}

function ImageViewport({
  asset,
  zoom,
  pan,
  onPan,
  onDimensions,
}: {
  asset: AssetView;
  zoom: Zoom;
  pan: Pan;
  onPan: (pan: Pan) => void;
  onDimensions: (assetId: string, width: number, height: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    pan: Pan;
    overflowX: number;
    overflowY: number;
  } | null>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setFrame({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const loaded = natural.width > 0 && natural.height > 0;
  const scale =
    zoom === "fit"
      ? loaded && frame.width > 0 && frame.height > 0
        ? Math.min(
            Math.max(1, frame.width - 32) / natural.width,
            Math.max(1, frame.height - 32) / natural.height,
            1,
          )
        : 1
      : zoom;
  const width = natural.width * scale;
  const height = natural.height * scale;
  const overflowX = Math.max(0, (width - frame.width) / 2);
  const overflowY = Math.max(0, (height - frame.height) / 2);
  const canPan = loaded && !failed && (overflowX > 0 || overflowY > 0);

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={frameRef}
      className={`${styles.viewport} ${canPan ? styles.pannable : ""} ${dragging ? styles.dragging : ""}`}
      role="group"
      aria-label={`${asset.name}，${zoom === "fit" ? "适合窗口" : `${zoom * 100}% 原图大小`}。放大后可拖动或使用方向键同步查看。`}
      tabIndex={canPan ? 0 : -1}
      onPointerDown={(event) => {
        if (!canPan || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          pan,
          overflowX,
          overflowY,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        onPan({
          x: drag.overflowX
            ? clampPan(drag.pan.x + (event.clientX - drag.x) / drag.overflowX)
            : drag.pan.x,
          y: drag.overflowY
            ? clampPan(drag.pan.y + (event.clientY - drag.y) / drag.overflowY)
            : drag.pan.y,
        });
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={(event) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (!canPan) return;
        const step = event.shiftKey ? 0.3 : 0.08;
        const moves: Record<string, Pan> = {
          ArrowLeft: { x: step, y: 0 },
          ArrowRight: { x: -step, y: 0 },
          ArrowUp: { x: 0, y: step },
          ArrowDown: { x: 0, y: -step },
        };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        event.stopPropagation();
        onPan({
          x: overflowX ? clampPan(pan.x + move.x) : pan.x,
          y: overflowY ? clampPan(pan.y + move.y) : pan.y,
        });
      }}
    >
      {failed ? (
        <div className={styles.previewMessage} role="status">
          <ImageOff size={27} aria-hidden="true" />
          <strong>图片暂时无法加载</strong>
          <span>评审内容仍然可以保存</span>
          <button
            className="button small"
            type="button"
            onClick={() => {
              setFailed(false);
              setNatural({ width: 0, height: 0 });
              setRetry((current) => current + 1);
            }}
          >
            重新加载
          </button>
        </div>
      ) : (
        <>
          {!loaded && (
            <div className={styles.previewMessage} role="status">
              <LoaderCircle
                size={24}
                className={styles.spinner}
                aria-hidden="true"
              />
              <span>正在加载原图…</span>
            </div>
          )}
          <img
            key={retry}
            src={`/api/assets/${encodeURIComponent(asset.id)}/content${retry ? `?reviewRetry=${retry}` : ""}`}
            alt={asset.name}
            draggable={false}
            className={styles.image}
            style={{
              width: loaded ? width : undefined,
              height: loaded ? height : undefined,
              visibility: loaded ? "visible" : "hidden",
              transform: `translate(calc(-50% + ${pan.x * overflowX}px), calc(-50% + ${pan.y * overflowY}px))`,
            }}
            onLoad={(event) => {
              const image = event.currentTarget;
              setNatural({
                width: image.naturalWidth,
                height: image.naturalHeight,
              });
              onDimensions(asset.id, image.naturalWidth, image.naturalHeight);
            }}
            onError={() => setFailed(true)}
          />
        </>
      )}
    </div>
  );
}

export function ImageDesignCompare({
  ref,
  assets,
  onClose,
  onDismiss,
  onSaveReview,
  onContinueEditing,
  onReuseAsset,
}: ImageDesignCompareProps) {
  const id = useId();
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [savedReviews, setSavedReviews] = useState<
    Record<string, ImageDesignReview>
  >({});
  const [dimensions, setDimensions] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [leaveAction, setLeaveAction] = useState<LeaveAction | null>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const images = assets.filter((asset) => asset.kind === "image").slice(0, 4);
  const dirtyCount = images.filter((asset) =>
    isDirty(drafts[asset.id], latestReview(asset, savedReviews[asset.id])),
  ).length;

  const performLeave = useCallback(
    (action: LeaveAction) => {
      if (action.kind === "close") onClose();
      else if (action.kind === "dismiss") onDismiss();
      else if (action.kind === "edit") onContinueEditing(action.assetId);
      else onReuseAsset(action.assetId);
    },
    [onClose, onDismiss, onContinueEditing, onReuseAsset],
  );

  const requestLeave = useCallback(
    (action: LeaveAction) => {
      if (savingRef.current) return;
      if (dirtyCount) setLeaveAction(action);
      else performLeave(action);
    },
    [dirtyCount, performLeave],
  );

  useImperativeHandle(ref, () => ({
    requestDismiss: () => requestLeave({ kind: "dismiss" }),
  }), [requestLeave]);

  const dialogRef = useDialogFocus(true, () => {
    if (leaveAction) setLeaveAction(null);
    else requestLeave({ kind: "close" });
  });

  useEffect(() => {
    if (leaveAction) continueButtonRef.current?.focus({ preventScroll: true });
  }, [leaveAction]);

  useEffect(
    () =>
      registerDesktopSave(async () => {
        if (savingRef.current) {
          throw new Error("图片评审正在保存，请稍候再退出。");
        }
        if (dirtyCount > 0) {
          throw new Error(
            "图片评审有未保存的更改，请先保存，或返回图片列表并选择丢弃更改。",
          );
        }
      }),
    [dirtyCount],
  );

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!savingRef.current && dirtyCount === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  const handleDimensions = useCallback(
    (assetId: string, width: number, height: number) => {
      setDimensions((current) => {
        if (
          current[assetId]?.width === width &&
          current[assetId]?.height === height
        )
          return current;
        return { ...current, [assetId]: { width, height } };
      });
    },
    [],
  );

  function updateDraft(
    asset: AssetView,
    change: Partial<Pick<ReviewDraft, "status" | "note">>,
  ) {
    setDrafts((current) => {
      const review = latestReview(asset, savedReviews[asset.id]);
      const previous = current[asset.id] ?? {
        status: review.status,
        note: review.note,
        originalRevision: review.revision,
      };
      return {
        ...current,
        [asset.id]: {
          ...previous,
          ...change,
        },
      };
    });
  }

  async function saveReview(asset: AssetView) {
    if (savingRef.current) return;
    const review = latestReview(asset, savedReviews[asset.id]);
    const draft = drafts[asset.id];
    if (!draft || !isDirty(draft, review)) return;
    // A fresh submission belongs to the revision the draft began with. After
    // a failed submission, the user can explicitly retry against the refreshed
    // server revision while their local text remains visible for confirmation.
    const expectedRevision = errors[asset.id]
      ? review.revision
      : draft.originalRevision;
    savingRef.current = true;
    setSavingId(asset.id);
    setErrors((current) => ({ ...current, [asset.id]: "" }));
    try {
      const updated = await onSaveReview(asset.id, {
        status: draft.status,
        note: draft.note,
        expectedRevision,
      });
      setSavedReviews((current) => ({
        ...current,
        [asset.id]: readImageDesignReview(updated.metadata),
      }));
      setDrafts((current) => {
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [asset.id]:
          error instanceof Error
            ? error.message
            : "保存失败，草稿已保留，请重试。",
      }));
    } finally {
      savingRef.current = false;
      setSavingId(null);
    }
  }

  return (
    <div ref={(element) => { dialogRef.current = element; }} className={styles.root} aria-busy={Boolean(savingId)} tabIndex={-1}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <button
            className={`button ghost small ${styles.back}`}
            type="button"
            disabled={Boolean(savingId)}
            onClick={() => requestLeave({ kind: "close" })}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            返回图片列表
          </button>
          <div className={styles.titleRow}>
            <h2>{images.length > 1 ? "图片比稿" : "图片评审"}</h2>
            <span className={styles.count}>{images.length} 张图片</span>
          </div>
          <p>查看细节，选定满意的一版，保存下一步的修改意见。</p>
        </div>
        <span className={styles.saveSummary} role="status" aria-live="polite">
          {savingId ? (
            <>
              <LoaderCircle
                size={14}
                className={styles.spinner}
                aria-hidden="true"
              />
              正在保存…
            </>
          ) : dirtyCount ? (
            `${dirtyCount} 张图片有未保存的评审`
          ) : (
            "评审会随图片保留"
          )}
        </span>
      </div>

      {leaveAction && (
        <div className={styles.leavePrompt} role="alert" aria-live="assertive">
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <strong>还有 {dirtyCount} 张图片的评审未保存</strong>
            <span>离开会丢弃这些状态和备注，已保存的评审会保留。</span>
          </div>
          <div className={styles.leaveActions}>
            <button
              className="button small"
              type="button"
              disabled={Boolean(savingId)}
              onClick={() => {
                if (savingRef.current) return;
                const action = leaveAction;
                setLeaveAction(null);
                setDrafts({});
                performLeave(action);
              }}
            >
              丢弃更改并继续
            </button>
            <button
              ref={continueButtonRef}
              className="button primary small"
              type="button"
              onClick={() => setLeaveAction(null)}
            >
              继续编辑评审
            </button>
          </div>
        </div>
      )}

      <div className={styles.toolbar}>
        <div
          className={styles.zoomControls}
          role="group"
          aria-label="统一图片缩放"
        >
          <span className={styles.toolbarLabel}>统一缩放</span>
          {ZOOM_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.zoomButton} ${zoom === option.value ? styles.zoomActive : ""}`}
              aria-pressed={zoom === option.value}
              onClick={() => {
                setZoom(option.value);
                if (option.value === "fit") setPan({ x: 0, y: 0 });
              }}
            >
              {option.label}
            </button>
          ))}
          <button
            className={styles.resetButton}
            type="button"
            title="所有图片居中"
            aria-label="所有图片居中"
            onClick={() => setPan({ x: 0, y: 0 })}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </button>
        </div>
        <span className={styles.panHint}>
          <Move size={13} aria-hidden="true" />
          放大后拖动图片，同步查看细节
        </span>
      </div>

      <div className={styles.scrollArea}>
        <div
          className={`${styles.grid} ${images.length === 1 ? styles.single : ""}`}
          style={{ "--compare-count": images.length || 1 } as CSSProperties}
        >
          {images.map((asset, index) => {
            const review = latestReview(asset, savedReviews[asset.id]);
            const draft = drafts[asset.id];
            const status = draft?.status ?? review.status;
            const StatusIcon = STATUS_ICONS[status];
            const note = draft?.note ?? review.note;
            const dirty = isDirty(draft, review);
            const size = dimensions[asset.id];
            const prefix = `${id}-${index}`;
            const stale =
              dirty && draft && draft.originalRevision !== review.revision;
            return (
              <article
                key={asset.id}
                className={styles.card}
                aria-labelledby={`${prefix}-name`}
                data-asset-id={asset.id}
                data-review-status={status}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.index}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className={styles.assetInfo}>
                    <h3 id={`${prefix}-name`} title={asset.name}>
                      {asset.name}
                    </h3>
                    <span>
                      {size ? `${size.width} × ${size.height} px` : "原始图片"}
                    </span>
                  </div>
                  <span className={styles.statusBadge} data-status={status}>
                    <StatusIcon size={13} aria-hidden="true" />
                    {IMAGE_REVIEW_LABELS[status]}
                  </span>
                </div>
                <ImageViewport
                  asset={asset}
                  zoom={zoom}
                  pan={pan}
                  onPan={setPan}
                  onDimensions={handleDimensions}
                />
                <div className={styles.reviewForm}>
                  <label
                    className={styles.fieldLabel}
                    htmlFor={`${prefix}-status`}
                  >
                    评审状态
                  </label>
                  <select
                    id={`${prefix}-status`}
                    className={styles.statusSelect}
                    value={status}
                    disabled={savingId === asset.id}
                    onChange={(event) =>
                      updateDraft(asset, {
                        status: event.target.value as ImageReviewStatus,
                      })
                    }
                  >
                    {STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {IMAGE_REVIEW_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  <div className={styles.noteLabel}>
                    <label
                      className={styles.fieldLabel}
                      htmlFor={`${prefix}-note`}
                    >
                      评审备注
                    </label>
                    <span id={`${prefix}-limit`}>
                      {note.length}/{IMAGE_REVIEW_NOTE_LIMIT}
                    </span>
                  </div>
                  <textarea
                    id={`${prefix}-note`}
                    className={styles.note}
                    rows={3}
                    maxLength={IMAGE_REVIEW_NOTE_LIMIT}
                    aria-describedby={`${prefix}-limit`}
                    value={note}
                    disabled={savingId === asset.id}
                    placeholder="例如：保留构图，标题放大，商品边缘需要更清楚…"
                    onChange={(event) =>
                      updateDraft(asset, { note: event.target.value })
                    }
                  />
                  {stale && (
                    <p className={styles.staleNote}>
                      评审已在其他位置更新。你的草稿已保留，确认后可再次保存。
                    </p>
                  )}
                  {errors[asset.id] && (
                    <p className={styles.error} role="alert">
                      <CircleAlert size={14} aria-hidden="true" />
                      {errors[asset.id]}
                    </p>
                  )}
                  <div className={styles.saveRow}>
                    <span
                      className={dirty ? styles.unsaved : styles.saved}
                      role="status"
                    >
                      {dirty ? (
                        "有未保存的更改"
                      ) : review.revision > 0 ? (
                        <>
                          <Check size={13} aria-hidden="true" />
                          已保存
                        </>
                      ) : (
                        "尚未评审"
                      )}
                    </span>
                    <button
                      className={`button small ${dirty ? "primary" : ""}`}
                      type="button"
                      disabled={!dirty || Boolean(savingId)}
                      onClick={() => void saveReview(asset)}
                    >
                      {savingId === asset.id ? (
                        <LoaderCircle
                          size={14}
                          className={styles.spinner}
                          aria-hidden="true"
                        />
                      ) : (
                        <Save size={14} aria-hidden="true" />
                      )}
                      {savingId === asset.id
                        ? "保存中…"
                        : errors[asset.id]
                          ? "重试保存"
                          : "保存评审"}
                    </button>
                  </div>
                  <div className={styles.cardActions}>
                    <button
                      className="button small"
                      type="button"
                      disabled={Boolean(savingId)}
                      onClick={() =>
                        requestLeave({ kind: "edit", assetId: asset.id })
                      }
                    >
                      <PencilLine size={14} aria-hidden="true" />
                      从这版继续修改
                    </button>
                    <button
                      className="button ghost small"
                      type="button"
                      disabled={Boolean(savingId)}
                      onClick={() =>
                        requestLeave({ kind: "reuse", assetId: asset.id })
                      }
                    >
                      <Layers size={14} aria-hidden="true" />
                      放入画布
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {images.length === 0 && (
          <p className={styles.empty}>
            暂时没有可评审的图片，请返回列表重新选择。
          </p>
        )}
      </div>
      <div className={styles.footer}>
        <span>100% 按原图像素显示 · 缩放和拖动仅用于查看</span>
        <span>状态和备注需点击「保存评审」</span>
      </div>
    </div>
  );
}
