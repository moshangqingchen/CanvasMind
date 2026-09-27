"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ImageIcon,
  Search,
  X,
  Pin,
  Star,
  Trash2,
  Columns2,
  Maximize2,
  ArrowRight,
  Save,
} from "lucide-react";
import {
  IMAGE_REVIEW_LABELS,
  IMAGE_REVIEW_NOTE_LIMIT,
  readImageDesignReview,
  type ImageDesignReviewInput,
  type ImageReviewStatus,
} from "@super-canvas/core";
import type { AssetView } from "./types";
import type { DeleteAssetsResult } from "../lib/client-api";
import { filterDesignImages } from "../lib/image-design";
import { imageResultVersions, type ProjectResult } from "../lib/project-results";
import { DesignDeliveryCheck } from "./design-delivery-check";
import { ImageDesignCompare, type ImageDesignCompareHandle } from "./image-design-compare";
import { useDialogFocus } from "./use-dialog-focus";
import { registerDesktopSave } from "../lib/desktop-client";
import {
  intersectingSelectionIds,
  selectionRectBetween,
  type SelectionRect,
} from "../lib/generation-history";
import { ReadableName } from "./result-information";
import "./image-library.css";

type Props = {
  canvasId: string | null;
  open: boolean;
  onClose: () => void;
  assets: AssetView[];
  onPreview: (asset: AssetView) => void;
  onReuseAsset: (id: string, offset?: number) => void;
  onDropAsset: (id: string, position: { x: number; y: number }) => void;
  onDeleteAssets: (ids: string[]) => Promise<DeleteAssetsResult>;
  onSaveReview: (
    id: string,
    input: ImageDesignReviewInput,
  ) => Promise<AssetView>;
  onContinueEditing: (id: string) => void;
};
type Draft = ImageDesignReviewInput;
const ROW = 322;
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "—";

function ImageDetails({
  asset,
  draft,
  onDraft,
  onSave,
  busy,
  message,
  onClose,
  onPreview,
  onReuse,
  onEdit,
  onCompare,
  onReload,
  onRebase,
  context: summaryContext,
  versions,
  onSelectVersion,
}: {
  asset: AssetView;
  draft?: Draft;
  onDraft: (draft: Draft) => void;
  onSave: () => void;
  busy: boolean;
  message: string;
  onClose: () => void;
  onPreview: () => void;
  onReuse: () => void;
  onEdit: () => void;
  onCompare: () => void;
  onReload: () => void;
  onRebase: () => void;
  context?: ProjectResult;
  versions: AssetView[];
  onSelectVersion: (id: string) => void;
}) {
  const review = readImageDesignReview(asset.metadata);
  const [fullContext, setFullContext] = useState<ProjectResult>();
  const [contextError, setContextError] = useState("");
  const context = fullContext ?? summaryContext;
  const contextCanvasId = summaryContext?.canvasId;
  useEffect(() => {
    if (!contextCanvasId) return;
    const controller = new AbortController();
    void fetch(`/api/projects/${encodeURIComponent(contextCanvasId)}/results?assetId=${encodeURIComponent(asset.id)}`, {signal: controller.signal, cache: "no-store"})
      .then(async response => {
        if (!response.ok) throw new Error("暂时无法读取这版的完整要求，请重新打开详情");
        const entries: ProjectResult[] = await response.json();
        const source = entries.find(entry => entry.assetId === asset.id);
        if (!source) throw new Error("这版来源暂不可用，请重新打开详情");
        if (!controller.signal.aborted) { setFullContext(source); setContextError(""); }
      }).catch((error: unknown) => { if (!controller.signal.aborted) setContextError(error instanceof Error ? error.message : "读取来源失败"); });
    return () => controller.abort();
  }, [asset.id, contextCanvasId]);
  const value = draft ?? {
    status: review.status,
    note: review.note,
    expectedRevision: review.revision,
  };
  const [dimensions, setDimensions] = useState("正在读取…");
  const [actualDimensions, setActualDimensions] = useState<{width: number; height: number} | null>(null);
  const [copied, setCopied] = useState(false);
  const [provenance, setProvenance] = useState<Record<string, unknown>>({});
  const m = { ...asset.metadata, ...provenance };
  const conflict = Boolean(draft && draft.expectedRevision !== review.revision);
  const parameters = (
    m.parameters && typeof m.parameters === "object" ? m.parameters : {}
  ) as Record<string, unknown>;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/assets/${encodeURIComponent(asset.id)}?dimensions=1`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setDimensions(
          data.actualDimensions
            ? `${data.actualDimensions.width} × ${data.actualDimensions.height}`
            : "暂无尺寸信息",
        );
        setProvenance(data.provenance ?? {});
        setActualDimensions(data.actualDimensions ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDimensions("暂时无法读取");
      });
    return () => controller.abort();
  }, [asset.id]);
  return (
    <aside className="library-inspector" aria-label="作品详情">
      <header>
        <strong>作品详情</strong>
        <button
          className="icon-button"
          aria-label="收起作品详情"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="library-inspector-content">
      <DesignDeliveryCheck key={`${asset.id}:${review.revision}`} asset={asset} context={context} dimensions={actualDimensions} sourceReady={!summaryContext || Boolean(fullContext)} />
      {contextError && <p role="alert" className="library-feedback">{contextError}</p>}
      {context && (
        <div className="library-project-context">
          <strong>{context.label}</strong>
          {versions.length > 1 && <nav aria-label="作品版本" className="library-versions">
            {versions.map((version, index) => <button type="button" key={version.id}
              aria-pressed={version.id === asset.id} onClick={() => onSelectVersion(version.id)}>
              第 {index + 1} 版 · {IMAGE_REVIEW_LABELS[readImageDesignReview(version.metadata).status]}
            </button>)}
          </nav>}
          {context.sourceAssetId && <p>基于原图继续修改</p>}
          {context.instruction && <details><summary>这版的生成 / 修改要求</summary><p className="library-brief-text">{context.instruction}</p></details>}
          {context.requirements && <details><summary>客户需求与品牌要求</summary><p className="library-brief-text">{context.requirements}</p></details>}
        </div>
      )}

        <button
          className="library-detail-preview"
          onClick={onPreview}
          title="打开大图预览"
        >
          <img src={`/api/assets/${asset.id}/preview?size=320`} alt="" />
          <Maximize2 size={16} />
        </button>
        <button className="library-text-button" onClick={onCompare}>
          <Columns2 size={14} />
          放大评审
        </button>
        <h3>
          <ReadableName text={asset.name} />
        </h3>
        <p className="library-muted">
          {new Date(asset.createdAt).toLocaleString("zh-CN")}
        </p>
        <label className="library-field">
          评审状态
          <select
            aria-label="评审状态"
            value={value.status}
            disabled={busy}
            onChange={(event) =>
              onDraft({
                ...value,
                status: event.target.value as ImageReviewStatus,
              })
            }
          >
            {Object.entries(IMAGE_REVIEW_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <dl className="library-metadata">
          <dt>模型</dt>
          <dd title={text(m.model)}>{text(m.model)}</dd>
          <dt>实际尺寸</dt>
          <dd>{dimensions}</dd>
          <dt>分辨率</dt>
          <dd>{text(parameters.resolution ?? parameters.size)}</dd>
          <dt>比例</dt>
          <dd>{text(parameters.aspect_ratio ?? parameters.aspectRatio)}</dd>
          <dt>质量</dt>
          <dd>{text(parameters.quality)}</dd>
        </dl>
        <details className="library-source">
          <summary>来源与参数</summary>
          <dl className="library-metadata">
            <dt>供应商</dt>
            <dd>{text(m.supplier ?? m.provider)}</dd>
            <dt>分组</dt>
            <dd>{text(m.group ?? m.connectionName)}</dd>
          </dl>
          <pre>{JSON.stringify(parameters, null, 2)}</pre>
          {typeof m.runId === "string" && (
            <button
              className="button small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(m.runId as string);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "已复制任务编号" : "复制任务编号"}
            </button>
          )}
        </details>
        <label className="library-field">
          提示词
          <p className="library-prompt">{text(m.promptText ?? m.prompt)}</p>
        </label>
        <label className="library-field">
          评审备注
          <textarea
            aria-label="评审备注"
            value={value.note}
            maxLength={IMAGE_REVIEW_NOTE_LIMIT}
            disabled={busy}
            rows={4}
            placeholder="记录这张图需要调整的地方"
            onChange={(event) =>
              onDraft({ ...value, note: event.target.value })
            }
          />
        </label>
        {conflict && (
          <div className="library-feedback" role="alert">
            <p>这张图片的评审已在其他窗口更新。你的草稿已保留。</p>
            <button className="button small" disabled={busy} onClick={onReload}>
              载入最新评审
            </button>
            <button className="button small" disabled={busy} onClick={onRebase}>
              保留草稿，采用最新版本
            </button>
          </div>
        )}
        {draft && (
          <button className="button" disabled={busy} onClick={onSave}>
            <Save size={14} />
            {busy ? "正在保存…" : "保存评审"}
          </button>
        )}
        {message && (
          <p role="status" className="library-feedback">
            {message}
          </p>
        )}
      </div>
      <footer>
        <button className="button primary" onClick={onReuse}>
          <Pin size={15} />
          放入画布
        </button>
        <button className="button" onClick={onEdit}>
          继续创作
          <ArrowRight size={15} />
        </button>
      </footer>
    </aside>
  );
}

export function GenerationHistoryModal(props: Props) {
  const {
    canvasId,
    open,
    assets,
    onClose,
    onPreview,
    onReuseAsset,
    onDropAsset,
    onDeleteAssets,
    onSaveReview,
    onContinueEditing,
  } = props;
  const [scope, setScope] = useState<"project" | "all">(canvasId ? "project" : "all");
  const [results, setResults] = useState<ProjectResult[] | null>(null);
  const [resultsError, setResultsError] = useState("");
  const [resultsRevision, setResultsRevision] = useState(0);
  useEffect(() => {
    if (!open || !canvasId) return;
    const controller = new AbortController();
    void fetch(`/api/projects/${encodeURIComponent(canvasId)}/results`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("项目成果读取失败，请重试");
        const data: unknown = await response.json();
        if (!Array.isArray(data)) throw new Error("项目成果响应无效，请重试");
        if (!controller.signal.aborted) { setResults(data as ProjectResult[]); setResultsError(""); }
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setResultsError(error instanceof Error ? error.message : "项目成果读取失败");
      });
    return () => controller.abort();
  }, [open, canvasId, resultsRevision]);
  const resultById = useMemo(() => new Map((results ?? []).map(result => [result.assetId, result])), [results]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ImageReviewStatus | "all">("all");
  const [tab, setTab] = useState<"all" | "starred" | "review">("all");
  const [oldest, setOldest] = useState(false);
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const compareRef = useRef<ImageDesignCompareHandle>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const [viewport, setViewport] = useState({
    width: 900,
    height: 600,
    scroll: 0,
  });
  const [selectionBox, setSelectionBox] = useState<SelectionRect | null>(null);
  const selection = useRef<{
    x: number;
    y: number;
    base: Set<string>;
    items: Array<{ id: string; rect: SelectionRect }>;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressedClick = useRef(false);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const all = useMemo(
    () =>
      assets.filter(
        (asset) =>
          asset.kind === "image" &&
          (typeof asset.metadata.runId === "string" || readImageDesignReview(asset.metadata).revision > 0) &&
          asset.metadata.purpose !== "supplier-verification",
      ),
    [assets],
  );
  const images = useMemo(
    () =>
      filterDesignImages(all.filter(asset => scope === "all" || resultById.has(asset.id)), query, filter)
        .filter((asset) =>
          tab === "starred"
            ? starred.has(asset.id)
            : tab === "review"
              ? readImageDesignReview(asset.metadata).status === "unreviewed"
              : true,
        )
        .sort(
          (a, b) => (oldest ? 1 : -1) * a.createdAt.localeCompare(b.createdAt),
        ),
    [all, query, filter, tab, starred, oldest, scope, resultById],
  );
  const selectedImages = images.filter((asset) => selected.has(asset.id));
  const selectedIds = new Set(selectedImages.map((asset) => asset.id));
  const detail = images.find((asset) => asset.id === focused);
  const cols = Math.max(
    viewport.width < 520 ? 2 : 1,
    Math.floor((viewport.width - 40 + 16) / 226),
  );
  const rows = Math.ceil(images.length / cols);
  const firstRow = Math.max(0, Math.floor(viewport.scroll / ROW) - 1);
  const lastRow = Math.min(
    rows,
    Math.ceil((viewport.scroll + viewport.height) / ROW) + 1,
  );
  const visible = images.slice(firstRow * cols, lastRow * cols);
  const dirty = Object.keys(drafts).filter((id) => {
    const asset = assets.find((asset) => asset.id === id);
    if (!asset) return false;
    const review = readImageDesignReview(asset.metadata);
    return (
      drafts[id]?.status !== review.status || drafts[id]?.note !== review.note
    );
  });
  const leave = (action: () => void) => {
    if (savingRef.current) return;
    if (dirty.length) setPendingLeave(() => action);
    else action();
  };
  const close = () => {
    if (!deleting && !saving) leave(onClose);
  };
  const dialogRef = useDialogFocus(open && !compareIds.length, () =>
    pendingLeave ? setPendingLeave(null) : close(),
  );
  useEffect(() => {
    try {
      setStarred(
        new Set(
          JSON.parse(
            localStorage.getItem("super-canvas:starred-images") ?? "[]",
          ),
        ),
      );
    } catch {
      /* empty library */
    }
  }, []);
  const detailOpen = Boolean(detail);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!open || !element || compareIds.length) return;
    element.scrollTop = savedScroll.current;
    const measure = () =>
      setViewport({
        width: element.clientWidth,
        height: element.clientHeight,
        scroll: element.scrollTop,
      });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [open, detailOpen, compareIds.length]);
  async function saveReview(id: string) {
    if (savingRef.current) return false;
    const draft = drafts[id];
    if (!draft) return true;
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await onSaveReview(id, draft);
      setDrafts((current) => {
        const next = { ...current };
        if (current[id] === draft) delete next[id];
        else if (current[id]) next[id] = { ...current[id], expectedRevision: readImageDesignReview(updated.metadata).revision };
        return next;
      });
      setMessages((current) => ({ ...current, [id]: "评审已保存" }));
      return true;
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [id]:
          error instanceof Error
            ? error.message
            : "保存失败，草稿仍保留，请重试",
      }));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!open) return;
    const save = async () => {
      if (savingRef.current) throw new Error("图片评审正在保存，请稍候再退出");
      for (const id of dirty)
        if (!(await saveReview(id)))
          throw new Error("评审保存失败，草稿已保留");
    };
    const unregister = registerDesktopSave(save);
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s" &&
        !event.isComposing &&
        !compareIds.length
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!saving) void save().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      unregister();
      window.removeEventListener("keydown", onKey, true);
    };
  });
  function resetScroll() {
    savedScroll.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setViewport((current) => ({ ...current, scroll: 0 }));
    setConfirmDelete(false);
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(
        [...current].filter((id) => images.some((asset) => asset.id === id)),
      );
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmDelete(false);
  }
  function favorite(id: string) {
    setStarred((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(
          "super-canvas:starred-images",
          JSON.stringify([...next]),
        );
      } catch {
        setMessage("收藏暂时无法保存到本机");
      }
      return next;
    });
  }
  async function remove() {
    if (deleting || !selectedIds.size) return;
    setDeleting(true);
    try {
      const result = await onDeleteAssets([...selectedIds]);
      setSelected(new Set(result.failedIds));
      setMessage(
        result.failedIds.length
          ? `已删除 ${result.deletedIds.length} 张，${result.failedIds.length} 张删除失败`
          : `已删除 ${result.deletedIds.length} 张图片`,
      );
      setConfirmDelete(false);
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([id]) => !result.deletedIds.includes(id),
          ),
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败，请重试");
    } finally {
      setDeleting(false);
    }
  }
  if (!open) return null;
  return (
    <div
      className={`modal-backdrop generation-history-backdrop ${dragging ? "asset-dragging" : ""}`}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (compareIds.length) compareRef.current?.requestDismiss();
        else close();
      }}
    >
      <section
        ref={dialogRef}
        className={`modal-window generation-history-modal image-library ${detail ? "has-inspector" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="历史生成"
        tabIndex={-1}
      >
        {compareIds.length ? (
          <ImageDesignCompare
            ref={compareRef}
            assets={all.filter((asset) => compareIds.includes(asset.id))}
            onClose={() => setCompareIds([])}
            onDismiss={() => {
              setCompareIds([]);
              close();
            }}
            onSaveReview={onSaveReview}
            onContinueEditing={onContinueEditing}
            onReuseAsset={onReuseAsset}
          />
        ) : (
          <>
            <header className="library-header">
              <div className="library-title">
                <ImageIcon size={23} />
                <h2>{scope === "project" ? "项目成果" : "图片库"}</h2>
                <span>{images.length} 张</span>
              </div>
              <nav className="library-tabs" aria-label="图片分类">
                {(
                  [
                    ["all", "全部"],
                    ["starred", "已收藏"],
                    ["review", "待评审"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={tab === key}
                    onClick={() => {
                      setTab(key);
                      resetScroll();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <label className="library-search">
                <Search size={16} />
                <input
                  aria-label="搜索图片名称或评审备注"
                  placeholder="搜索作品、备注…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    resetScroll();
                  }}
                />
              </label>
              <button
                className="icon-button"
                onClick={close}
                aria-label="关闭历史生成"
              >
                <X size={19} />
              </button>
            </header>
            <div className="library-body">
              <div className="library-browser">
                <div className="library-filter-row">
                  <select aria-label="作品范围" value={scope} onChange={event => {
                    const nextScope = event.target.value as typeof scope;
                    leave(() => { setScope(nextScope); setSelected(new Set()); setFocused(null); resetScroll(); });
                  }}>
                    <option value="project" disabled={!canvasId}>当前项目</option>
                    <option value="all">全部项目</option>
                  </select>
                  <span>{images.length} 张作品</span>
                  <select
                    aria-label="筛选评审状态"
                    value={filter}
                    onChange={(event) => {
                      setFilter(event.target.value as typeof filter);
                      resetScroll();
                    }}
                  >
                    <option value="all">全部状态</option>
                    {Object.entries(IMAGE_REVIEW_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span className="library-spacer" />
                  <button
                    className="library-text-button"
                    onClick={() => {
                      setOldest(!oldest);
                      resetScroll();
                    }}
                  >
                    {oldest ? "最早生成" : "最新生成"}
                  </button>
                  <button
                    className="library-text-button"
                    onClick={() =>
                      setSelected(new Set(images.map((asset) => asset.id)))
                    }
                  >
                    全选
                  </button>
                </div>
                {scope === "project" && resultsError && <div role="alert" className="library-feedback">{resultsError}
                  <button type="button" className="button small" onClick={() => setResultsRevision(value => value + 1)}>重新读取项目成果</button>
                </div>}
                {scope === "project" && results === null && !resultsError && <p role="status">正在读取项目成果…</p>}
                <div
                  className="library-scroll"
                  ref={scrollRef}
                  onScroll={(event) => {
                    savedScroll.current = event.currentTarget.scrollTop;
                    setViewport((current) => ({
                      ...current,
                      scroll: savedScroll.current,
                    }));
                    selection.current = null;
                    setSelectionBox(null);
                  }}
                >
                  {!images.length ? (
                    <div className="empty-state generation-history-empty">
                      <ImageIcon size={30} />
                      <strong>
                        {all.length ? "没有符合条件的作品" : "还没有生成过图片"}
                      </strong>
                      <span>生成的图片会自动保存在这里</span>
                    </div>
                  ) : (
                    <div
                      className="generation-history-grid library-grid"
                      style={{
                        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                        paddingTop: firstRow * ROW + 4,
                        paddingBottom: Math.max(0, rows - lastRow) * ROW + 100,
                      }}
                      onPointerDown={(event) => {
                        if (
                          event.button ||
                          event.target !== event.currentTarget
                        )
                          return;
                        selection.current = {
                          x: event.clientX,
                          y: event.clientY,
                          base:
                            event.ctrlKey || event.metaKey
                              ? new Set(selectedIds)
                              : new Set(),
                          items: [...cardRefs.current].map(([id, card]) => ({
                            id,
                            rect: card.getBoundingClientRect(),
                          })),
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const start = selection.current;
                        if (!start) return;
                        const rect = selectionRectBetween(start, {
                          x: event.clientX,
                          y: event.clientY,
                        });
                        setSelectionBox(rect);
                        setSelected(
                          new Set([
                            ...start.base,
                            ...intersectingSelectionIds(rect, start.items),
                          ]),
                        );
                      }}
                      onPointerUp={() => {
                        selection.current = null;
                        setSelectionBox(null);
                      }}
                      onPointerCancel={() => {
                        selection.current = null;
                        setSelectionBox(null);
                      }}
                    >
                      {visible.map((asset) => {
                        const review = readImageDesignReview(asset.metadata);
                        return (
                          <article
                            key={asset.id}
                            ref={(element) => {
                              if (element)
                                cardRefs.current.set(asset.id, element);
                              else cardRefs.current.delete(asset.id);
                            }}
                            className={`generation-history-card library-card ${selectedIds.has(asset.id) ? "is-selected" : ""} ${focused === asset.id ? "is-focused" : ""}`}
                          >
                            <button
                              className="generation-history-select"
                              role="checkbox"
                              aria-checked={selectedIds.has(asset.id)}
                              aria-label={`${selectedIds.has(asset.id) ? "取消选择" : "选择"} ${asset.name}`}
                              onClick={() => toggle(asset.id)}
                            >
                              {selectedIds.has(asset.id) && <Check size={14} />}
                            </button>
                            <button
                              className="library-favorite"
                              aria-label={`${starred.has(asset.id) ? "取消收藏" : "收藏"} ${asset.name}`}
                              aria-pressed={starred.has(asset.id)}
                              onClick={() => favorite(asset.id)}
                            >
                              <Star
                                size={15}
                                fill={
                                  starred.has(asset.id)
                                    ? "currentColor"
                                    : "none"
                                }
                              />
                            </button>
                            <button
                              className="generation-history-preview"
                              aria-label={`查看详情 ${asset.name}`}
                              onClick={(event) => {
                                if (suppressedClick.current) {
                                  suppressedClick.current = false;
                                  return;
                                }
                                if (
                                  event.ctrlKey ||
                                  event.metaKey ||
                                  event.shiftKey ||
                                  selectedIds.size
                                )
                                  toggle(asset.id);
                                else setFocused(asset.id);
                              }}
                              onDoubleClick={() => onPreview(asset)}
                              onKeyDown={(event) => {
                                if (event.code === "Space") {
                                  event.preventDefault();
                                  onPreview(asset);
                                }
                              }}
                              onPointerDown={(event) => {
                                if (
                                  event.button ||
                                  event.ctrlKey ||
                                  event.metaKey ||
                                  event.shiftKey ||
                                  selectedIds.size
                                )
                                  return;
                                drag.current = {
                                  id: asset.id,
                                  x: event.clientX,
                                  y: event.clientY,
                                  moved: false,
                                };
                                event.currentTarget.setPointerCapture(
                                  event.pointerId,
                                );
                              }}
                              onPointerMove={(event) => {
                                const start = drag.current;
                                if (
                                  start &&
                                  Math.hypot(
                                    event.clientX - start.x,
                                    event.clientY - start.y,
                                  ) > 7
                                ) {
                                  start.moved = true;
                                  setDragging(true);
                                }
                              }}
                              onPointerUp={(event) => {
                                if (drag.current?.moved) {
                                  suppressedClick.current = true;
                                  leave(() =>
                                    onDropAsset(asset.id, {
                                      x: event.clientX,
                                      y: event.clientY,
                                    }),
                                  );
                                }
                                drag.current = null;
                                setDragging(false);
                              }}
                              onPointerCancel={() => {
                                drag.current = null;
                                setDragging(false);
                              }}
                            >
                              <img
                                src={`/api/assets/${encodeURIComponent(asset.id)}/preview?size=640`}
                                alt={asset.name}
                                loading="lazy"
                                decoding="async"
                                draggable={false}
                              />
                            </button>
                            <footer>
                              <strong>
                                <ReadableName text={asset.name} />
                              </strong>
                              <small>
                                <time>
                                  {new Date(asset.createdAt).toLocaleString(
                                    "zh-CN",
                                    {
                                      month: "numeric",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )}
                                </time>
                                <span
                                  className="library-status"
                                  data-status={review.status}
                                >
                                  {IMAGE_REVIEW_LABELS[review.status]}
                                </span>
                              </small>
                            </footer>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
                {message && (
                  <div
                    role="status"
                    className="library-feedback library-message"
                  >
                    {message}
                  </div>
                )}
                {selectedIds.size > 0 && (
                  <div className="generation-history-toolbar library-bulk">
                    <strong>已选 {selectedIds.size} 张</strong>
                    {confirmDelete ? (
                      <>
                        <span>确认永久删除 {selectedIds.size} 张？</span>
                        <button
                          className="button danger small"
                          disabled={deleting}
                          onClick={() => void remove()}
                        >
                          {deleting ? "正在删除…" : "确认删除"}
                        </button>
                        <button
                          className="button small"
                          onClick={() => setConfirmDelete(false)}
                        >
                          返回
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="button small"
                          disabled={
                            selectedIds.size < 2 || selectedIds.size > 4
                          }
                          onClick={() =>
                            leave(() => setCompareIds([...selectedIds]))
                          }
                        >
                          <Columns2 size={14} />
                          并排比稿
                        </button>
                        <button
                          className="button small"
                          onClick={() =>
                            leave(() => {
                              selectedImages.forEach((asset, index) =>
                                onReuseAsset(asset.id, index),
                              );
                            })
                          }
                        >
                          <Pin size={14} />
                          放入画布
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label="删除所选"
                          onClick={() => setConfirmDelete(true)}
                        >
                          <Trash2 size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="取消选择"
                          onClick={() => setSelected(new Set())}
                        >
                          <X size={15} />
                        </button>
                      </>
                    )}
                  </div>
                )}
                <div className="library-key-hint">
                  空格预览 · Shift / Ctrl 多选 · 拖动图片放入画布
                </div>
              </div>
              {detail && (
                <ImageDetails
                  key={detail.id}
                  asset={detail}
                  context={resultById.get(detail.id)}
                  versions={imageResultVersions(detail.id, all, results ?? [])}
                  onSelectVersion={id => leave(() => setFocused(id))}
                  draft={drafts[detail.id]}
                  onDraft={(draft) =>
                    setDrafts((current) => ({ ...current, [detail.id]: draft }))
                  }
                  onSave={() => void saveReview(detail.id)}
                  busy={saving}
                  message={messages[detail.id] ?? ""}
                  onClose={() => setFocused(null)}
                  onPreview={() => onPreview(detail)}
                  onReuse={() => leave(() => onReuseAsset(detail.id))}
                  onEdit={() => leave(() => onContinueEditing(detail.id))}
                  onCompare={() => leave(() => setCompareIds([detail.id]))}
                  onReload={() =>
                    setDrafts((current) => {
                      const next = { ...current };
                      delete next[detail.id];
                      return next;
                    })
                  }
                  onRebase={() =>
                    setDrafts((current) => ({
                      ...current,
                      [detail.id]: {
                        ...current[detail.id]!,
                        expectedRevision: readImageDesignReview(detail.metadata)
                          .revision,
                      },
                    }))
                  }
                />
              )}
            </div>
          </>
        )}
        {selectionBox && (
          <div
            className="generation-history-selection-box"
            style={{
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.right - selectionBox.left,
              height: selectionBox.bottom - selectionBox.top,
            }}
          />
        )}
        {pendingLeave && (
          <div
            className="library-leave"
            role="alertdialog"
            aria-label="保存评审草稿"
          >
            <strong>还有未保存的评审</strong>
            <p>保存后继续，或保留在当前图片库中。</p>
            <button
              className="button primary"
              disabled={saving}
              onClick={async () => {
                for (const id of dirty) if (!(await saveReview(id))) return;
                const action = pendingLeave;
                setPendingLeave(null);
                action();
              }}
            >
              保存并继续
            </button>
            <button className="button" onClick={() => setPendingLeave(null)}>
              继续编辑
            </button>
            <button
              className="button ghost"
              disabled={saving}
              onClick={() => {
                setDrafts({});
                const action = pendingLeave;
                setPendingLeave(null);
                action();
              }}
            >
              放弃草稿并继续
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
