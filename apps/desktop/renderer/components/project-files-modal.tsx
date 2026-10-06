"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownToLine, Check, CheckSquare2, CircleAlert, Film, FolderOpen, ImageOff, LoaderCircle, Maximize2, Music2, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";
import styles from "./project-files-modal.module.css";

export interface ProjectFileItem {
  fileId: string;
  name: string;
  kind: "image" | "video" | "audio";
  mimeType: string;
  size: number;
  modifiedAt: string;
  section: "draft" | "finished";
  subfolder: string;
  contentUrl: string;
  previewUrl: string;
  assetId?: string;
  canDelete: boolean;
}

export interface ProjectFilesModalProps {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onPlaceOnCanvas: (files: ProjectFileItem[]) => Promise<void>;
}

function sizeLabel(value: number): string {
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function messageFor(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function validateFileList(value: unknown, projectId: string): { files: ProjectFileItem[]; ignoredFiles: number } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { files?: unknown }).files)) throw new Error("项目文件列表响应无效，请刷新重试。");
  const response = value as { files: unknown[]; ignoredFiles?: unknown };
  const prefix = `/api/projects/${encodeURIComponent(projectId)}/files/content`;
  const seen = new Set<string>();
  const files = response.files.map(value => {
    if (!value || typeof value !== "object") throw new Error("项目文件信息不完整，请刷新重试。");
    const file = value as ProjectFileItem;
    if (typeof file.fileId !== "string" || !file.fileId || seen.has(file.fileId) || typeof file.name !== "string" ||
        !["image", "video", "audio"].includes(file.kind) || !["draft", "finished"].includes(file.section) ||
        typeof file.mimeType !== "string" || typeof file.modifiedAt !== "string" || typeof file.subfolder !== "string" ||
        !Number.isFinite(file.size) || file.size < 0 || typeof file.canDelete !== "boolean") throw new Error("项目文件信息不完整，请刷新重试。");
    for (const source of [file.contentUrl, file.previewUrl]) {
      if (typeof source !== "string") throw new Error("项目文件预览地址无效，请刷新重试。");
      const url = new URL(source, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname !== prefix || url.searchParams.get("fileId") !== file.fileId) throw new Error("项目文件预览地址不属于当前项目，请刷新重试。");
    }
    seen.add(file.fileId);
    return file;
  });
  return { files, ignoredFiles: typeof response.ignoredFiles === "number" && response.ignoredFiles > 0 ? response.ignoredFiles : 0 };
}

function FileThumbnail({ file, retryVersion }: { file: ProjectFileItem; retryVersion: number }) {
  const [failedVersion, setFailedVersion] = useState<number | null>(null);
  if (file.kind !== "image") {
    const Icon = file.kind === "video" ? Film : Music2;
    return <span className={styles.mediaPlaceholder}><Icon size={35} /><span>{file.kind === "video" ? "视频" : "音频"}</span></span>;
  }
  if (failedVersion === retryVersion) return <span className={styles.thumbnailFailed}><ImageOff size={26} /><span>预览暂不可用</span></span>;
  return <img src={file.previewUrl} alt={file.name} loading="lazy" decoding="async" draggable={false} onError={() => setFailedVersion(retryVersion)} />;
}

function ProjectFilePreview({ file, onClose }: { file: ProjectFileItem; onClose: () => void }) {
  const dialogRef = useDialogFocus(true, onClose);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const titleId = useId();
  return <div className={`${styles.backdrop} ${styles.previewBackdrop}`} onPointerDown={event => event.stopPropagation()}>
    <section ref={dialogRef} className={styles.previewDialog} role="dialog" aria-modal="true" aria-label="项目文件预览" aria-describedby={titleId} tabIndex={-1} onKeyDown={event => event.stopPropagation()}>
      <header className={styles.previewHeader}><div><span className={styles.eyebrow}>项目文件预览</span><h2 id={titleId} title={file.name}>{file.name}</h2></div><button type="button" className={styles.iconButton} onClick={onClose} aria-label="关闭文件预览"><X size={20} /></button></header>
      <div className={styles.previewStage} data-zoom={zoom}>
        {failed ? <div className={styles.empty}><ImageOff size={36} /><strong>这个文件暂时无法预览</strong><p>文件可能已移动或发生变化，请关闭预览后刷新列表。</p></div>
          : file.kind === "image" ? <img src={file.contentUrl} alt={file.name} draggable={false} onError={() => setFailed(true)} />
          : file.kind === "video" ? <video src={file.contentUrl} controls preload="metadata" onError={() => setFailed(true)} />
          : <div className={styles.audioPreview}><Music2 size={60} /><audio src={file.contentUrl} controls preload="metadata" onError={() => setFailed(true)} /></div>}
      </div>
      <footer className={styles.previewFooter}><span>{sizeLabel(file.size)} · {dateLabel(file.modifiedAt)}</span><div>{file.kind === "image" && !failed && <button type="button" className={styles.secondary} onClick={() => setZoom(value => value === "fit" ? "actual" : "fit")}><Maximize2 size={15} />{zoom === "fit" ? "原始大小" : "适应窗口"}</button>}<a className={styles.download} href={file.contentUrl} download={file.name}><ArrowDownToLine size={15} />下载文件</a></div></footer>
    </section>
  </div>;
}

function DeleteProjectFilesDialog({ files, deleting, onClose, onConfirm }: { files: ProjectFileItem[]; deleting: boolean; onClose: () => void; onConfirm: () => void }) {
  const dialogRef = useDialogFocus(true, () => { if (!deleting) onClose(); });
  const titleId = useId();
  const descriptionId = useId();
  return <div className={`${styles.backdrop} ${styles.confirmBackdrop}`} onPointerDown={event => event.stopPropagation()}>
    <section ref={dialogRef} className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} onKeyDown={event => event.stopPropagation()}>
      <span className={styles.deleteIcon}><Trash2 size={24} /></span><h2 id={titleId}>删除 {files.length} 个项目文件？</h2>
      <p id={descriptionId}>仅删除项目文件夹中的文件，已放入画布的素材保留。删除后无法从此窗口恢复。</p>
      <ul>{files.slice(0, 4).map(file => <li key={file.fileId} title={file.name}>{file.name}</li>)}{files.length > 4 && <li>以及另外 {files.length - 4} 个文件</li>}</ul>
      <footer><button type="button" className={styles.secondary} disabled={deleting} onClick={onClose}>取消</button><button type="button" className={styles.danger} disabled={deleting} onClick={onConfirm}>{deleting ? <LoaderCircle size={16} className={styles.spinning} /> : <Trash2 size={16} />}{deleting ? "正在删除…" : "确认删除"}</button></footer>
    </section>
  </div>;
}

/** Session remounts reset selection and discard in-flight UI responses on project changes. */
export function ProjectFilesModal(props: ProjectFilesModalProps) {
  return props.open ? <ProjectFilesModalSession key={props.projectId} {...props} /> : null;
}

function ProjectFilesModalSession({ projectId, projectName, onClose, onPlaceOnCanvas }: ProjectFilesModalProps) {
  const [files, setFiles] = useState<ProjectFileItem[]>([]);
  const [ignoredFiles, setIgnoredFiles] = useState(0);
  const [section, setSection] = useState<"draft" | "finished">("finished");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(60);
  const [loading, setLoading] = useState(true);
  const [thumbnailRetryVersion, setThumbnailRetryVersion] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"delete" | "insert" | null>(null);
  const [preview, setPreview] = useState<ProjectFileItem | null>(null);
  const [deleteFiles, setDeleteFiles] = useState<ProjectFileItem[] | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(false);
  const listRequest = useRef<AbortController | null>(null);
  const deleteRequest = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const requestClose = () => { if (!busyRef.current) onClose(); };
  const dialogRef = useDialogFocus(true, requestClose);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const reason = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "";
        throw new Error(reason || "项目文件读取失败，请稍后刷新重试。");
      }
      const result = validateFileList(payload, projectId);
      if (!alive.current || controller.signal.aborted || listRequest.current !== controller) return;
      setFiles(result.files);
      setIgnoredFiles(result.ignoredFiles);
      // Refresh retries failed previews without remounting images that already
      // loaded successfully, or discarding the current file selection.
      setThumbnailRetryVersion(version => version + 1);
      const knownIds = new Set(result.files.map(file => file.fileId));
      setSelected(current => new Set([...current].filter(id => knownIds.has(id))));
      setLimit(60);
    } catch (reason) {
      if (alive.current && !controller.signal.aborted && listRequest.current === controller) setLoadError(messageFor(reason, "项目文件读取失败，请刷新重试。"));
    } finally {
      if (alive.current && listRequest.current === controller) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    alive.current = true;
    // Strict Mode's probe must not create a second filesystem scan.
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void refresh(); });
    return () => {
      controller.abort();
      alive.current = false;
      listRequest.current?.abort();
      deleteRequest.current?.abort();
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return files.filter(file => file.section === section && (!needle || `${file.name} ${file.subfolder}`.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name, "zh-CN"));
  }, [files, query, section]);
  const selectedFiles = filtered.filter(file => selected.has(file.fileId));
  const deletable = selectedFiles.filter(file => file.canDelete);
  const allSelected = filtered.length > 0 && selectedFiles.length === filtered.length;
  const disabled = loading || busy !== null;

  function selectAll() {
    if (disabled) return;
    setSelected(allSelected ? new Set() : new Set(filtered.map(file => file.fileId)));
  }

  function changeQuery(value: string) {
    setQuery(value); setSelected(new Set()); setLimit(60); setNotice("");
    scrollRef.current?.scrollTo(0, 0);
  }

  function changeSection(value: "draft" | "finished") {
    if (disabled) return;
    setSection(value); setQuery(""); setSelected(new Set()); setLimit(60); setActionError(""); setNotice("");
    scrollRef.current?.scrollTo(0, 0);
  }

  async function placeFiles(items: ProjectFileItem[]) {
    if (busyRef.current || loading || items.length === 0) return;
    busyRef.current = true;
    setBusy("insert"); setActionError(""); setNotice("");
    try {
      await onPlaceOnCanvas(items);
      if (alive.current) setNotice(`已将 ${items.length} 个文件放入画布。`);
    } catch (reason) {
      if (alive.current) setActionError(messageFor(reason, "放入画布失败，请重试。"));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function confirmDelete() {
    const items = deleteFiles;
    if (!items?.length || busyRef.current) return;
    busyRef.current = true;
    setBusy("delete"); setActionError(""); setNotice("");
    const controller = new AbortController();
    deleteRequest.current = controller;
    const deleted = new Set<string>();
    const failed = new Map<string, string>();
    let uncertain = "";
    try {
      // The scoped endpoint accepts at most 100 files. A later batch failure
      // must not resurrect files whose deletion was already acknowledged.
      for (let offset = 0; offset < items.length; offset += 100) {
        if (controller.signal.aborted || !alive.current) return;
        const batch = items.slice(offset, offset + 100);
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/delete`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileIds: batch.map(file => file.fileId) }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
        });
        const result: unknown = await response.json();
        // A fully rejected batch returns 409 with per-file failure details.
        if (!response.ok && response.status !== 409) throw new Error("未能确认本批次删除结果，请刷新列表后核对。");
        if (!result || typeof result !== "object" || !Array.isArray((result as { deletedIds?: unknown }).deletedIds) || !Array.isArray((result as { failed?: unknown }).failed)) throw new Error("删除响应不完整，请刷新列表后核对。");
        if (!alive.current || controller.signal.aborted) return;
        const data = result as { deletedIds: unknown[]; failed: Array<{ fileId?: unknown; message?: unknown }> };
        for (const failure of data.failed) {
          if (typeof failure?.fileId === "string" && batch.some(file => file.fileId === failure.fileId)) failed.set(failure.fileId, typeof failure.message === "string" ? failure.message : "删除失败，请刷新后重试");
        }
        for (const file of batch) if (data.deletedIds.includes(file.fileId) && !failed.has(file.fileId)) deleted.add(file.fileId);
      }
    } catch (reason) {
      uncertain = messageFor(reason, "未能确认删除结果，请刷新列表后核对。");
    } finally {
      busyRef.current = false;
      deleteRequest.current = null;
      if (alive.current && !controller.signal.aborted) {
        const remaining = items.filter(file => !deleted.has(file.fileId));
        setFiles(current => current.filter(file => !deleted.has(file.fileId)));
        const attemptedIds = new Set(items.map(file => file.fileId));
        setSelected(current => new Set([
          ...[...current].filter(id => !attemptedIds.has(id)),
          ...remaining.map(file => file.fileId),
        ]));
        if (deleted.size) setNotice(`已删除 ${deleted.size} 个项目文件，画布素材已保留。`);
        if (remaining.length) setActionError(`${remaining.length} 个文件未确认删除：${remaining.slice(0, 3).map(file => `${file.name}（${failed.get(file.fileId) ?? (uncertain || "结果未确认，请刷新后核对")}）`).join("；")}${remaining.length > 3 ? "；其余文件仍保持选中。" : ""}`);
        setBusy(null); setDeleteFiles(null);
      }
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(<>
    <div className={styles.backdrop} onPointerDown={event => event.stopPropagation()}>
      <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}
        onKeyDown={event => {
          event.stopPropagation();
          if (disabled || event.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(event.target.tagName)) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selectAll(); }
          if (event.key === "Delete" && deletable.length) { event.preventDefault(); setDeleteFiles(deletable); }
        }}>
        <header className={styles.header}>
          <div className={styles.heading}><span className={styles.folderIcon}><FolderOpen size={25} /></span><div><span className={styles.eyebrow}>PROJECT FILES</span><h2 id={titleId}>项目文件</h2><p title={projectName}>{projectName}</p></div></div>
          <div className={styles.headerActions}><button type="button" className={styles.secondary} disabled={disabled} onClick={() => { setActionError(""); setNotice(""); void refresh(); }}><RefreshCw size={15} className={loading ? styles.spinning : undefined} />刷新</button><button type="button" className={styles.iconButton} disabled={Boolean(busy)} onClick={requestClose} aria-label="关闭项目文件"><X size={21} /></button></div>
        </header>
        <div className={styles.navigation}>
          <div className={styles.tabs} role="tablist" aria-label="项目文件分类">
            <button type="button" role="tab" aria-selected={section === "finished"} disabled={disabled} onClick={() => changeSection("finished")}>成品<span>{files.filter(file => file.section === "finished").length}</span></button>
            <button type="button" role="tab" aria-selected={section === "draft"} disabled={disabled} onClick={() => changeSection("draft")}>草稿<span>{files.filter(file => file.section === "draft").length}</span></button>
          </div>
          <label className={styles.search}><Search size={16} /><input type="search" placeholder="搜索文件名称" aria-label="搜索项目文件" value={query} disabled={Boolean(busy)} onChange={event => changeQuery(event.target.value)} /></label>
        </div>
        <p className={styles.description} id={descriptionId}>当前项目文件夹中的图片、视频和音频，按修改时间排列。{ignoredFiles > 0 && <span> 另有 {ignoredFiles} 个非媒体文件未显示。</span>}</p>
        <div className={styles.selectionBar}>
          <label><input type="checkbox" checked={allSelected} ref={element => { if (element) element.indeterminate = selectedFiles.length > 0 && !allSelected; }} disabled={disabled || filtered.length === 0} onChange={selectAll} aria-label={query ? "全选搜索结果" : "全选当前分类文件"} /><span>{query ? "全选搜索结果" : "全选当前分类"}</span></label>
          <span className={styles.count}>{selectedFiles.length ? `已选 ${selectedFiles.length} 项` : `共 ${filtered.length} 项`}</span>
          {selectedFiles.length > 0 && <button type="button" className={styles.textButton} disabled={disabled} onClick={() => setSelected(new Set())}>取消选择</button>}
          <div className={styles.bulkActions}><button type="button" className={styles.deleteButton} disabled={disabled || deletable.length === 0} onClick={() => setDeleteFiles(deletable)}><Trash2 size={14} />删除所选{deletable.length > 0 ? ` (${deletable.length})` : ""}</button><button type="button" className={styles.primary} disabled={disabled || selectedFiles.length === 0} onClick={() => void placeFiles(selectedFiles)}>{busy === "insert" ? <LoaderCircle size={15} className={styles.spinning} /> : <Plus size={16} />}放入画布{selectedFiles.length > 0 ? ` (${selectedFiles.length})` : ""}</button></div>
        </div>
        {(loadError || actionError) && <div className={styles.error} role="alert"><CircleAlert size={16} /><span>{actionError || loadError}</span>{loadError && <button type="button" className={styles.textButton} disabled={disabled} onClick={() => void refresh()}>重试</button>}</div>}
        {notice && <div className={styles.notice} role="status"><Check size={15} />{notice}</div>}
        <div className={styles.content} ref={scrollRef} aria-busy={loading}>
          {loading && files.length === 0 ? <div className={styles.empty}><LoaderCircle size={31} className={styles.spinning} /><strong>正在读取项目文件…</strong><p>图片将直接展开，无需逐层打开文件夹。</p></div>
            : filtered.length === 0 ? <div className={styles.empty}>{query ? <Search size={38} /> : <FolderOpen size={42} />}<strong>{loadError ? "暂时无法读取文件" : query ? "没有找到匹配的文件" : section === "finished" ? "还没有成品文件" : "还没有草稿媒体"}</strong><p>{loadError ? "请点击刷新重试。" : query ? "换个关键词，或清除搜索条件。" : section === "finished" ? "放入项目成品文件夹的图片、视频和音频会显示在这里。" : "草稿目录中的媒体会显示在这里，画布 JSON 文件不会当作图片展示。"}</p>{query && <button type="button" className={styles.secondary} onClick={() => changeQuery("")}>清除搜索</button>}</div>
            : <><div className={styles.grid} aria-label={`${section === "finished" ? "成品" : "草稿"}文件列表`}>
              {filtered.slice(0, limit).map(file => <article key={file.fileId} className={styles.card} data-selected={selected.has(file.fileId)} data-file-id={file.fileId}>
                <div className={styles.thumbnail}><button type="button" className={styles.previewButton} disabled={disabled} onClick={() => setPreview(file)} aria-label={`预览 ${file.name}`}><FileThumbnail file={file} retryVersion={thumbnailRetryVersion} /><span className={styles.previewHint}><Maximize2 size={16} />预览</span></button>
                  <label className={styles.selectFile} title={selected.has(file.fileId) ? "取消选择" : "选择文件"}><input type="checkbox" aria-label={`选择 ${file.name}`} checked={selected.has(file.fileId)} disabled={disabled} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(file.fileId)) next.delete(file.fileId); else next.add(file.fileId); return next; })} /><span><Check size={13} /></span></label>
                  <span className={styles.fileType}>{file.kind === "image" ? "图片" : file.kind === "video" ? "视频" : "音频"}</span>
                </div>
                <div className={styles.cardInfo}><h3 title={file.name}>{file.name}</h3><p title={file.subfolder || undefined}><span>{sizeLabel(file.size)}</span><span>{dateLabel(file.modifiedAt)}</span></p></div>
                <div className={styles.cardActions}><button type="button" disabled={disabled} onClick={() => void placeFiles([file])} aria-label={`将 ${file.name} 放入画布`}><Plus size={13} />放入画布</button><button type="button" disabled={disabled || !file.canDelete} onClick={() => setDeleteFiles([file])} aria-label={`删除 ${file.name}`} title={file.canDelete ? "仅删除项目文件夹中的副本" : "此文件暂不可删除"}><Trash2 size={14} /></button></div>
              </article>)}
            </div>{filtered.length > limit && <div className={styles.loadMore}><button type="button" className={styles.secondary} disabled={disabled} onClick={() => setLimit(value => value + 60)}>显示更多 · 还有 {filtered.length - limit} 项</button></div>}</>}
        </div>
        <footer className={styles.footer}><span><CheckSquare2 size={14} />可多选文件，再批量放入画布或删除。</span><small>删除项目副本，不影响画布素材。</small></footer>
      </section>
    </div>
    {preview && <ProjectFilePreview key={preview.fileId} file={preview} onClose={() => setPreview(null)} />}
    {deleteFiles && <DeleteProjectFilesDialog files={deleteFiles} deleting={busy === "delete"} onClose={() => { if (!busyRef.current) setDeleteFiles(null); }} onConfirm={() => void confirmDelete()} />}
  </>, document.body);
}
