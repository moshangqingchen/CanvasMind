"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  FolderOpen,
  Grid2X2,
  HardDrive,
  ImageIcon,
  Layers3,
  LoaderCircle,
  List,
  MoreHorizontal,
  Pencil,
  PanelsTopLeft,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createProject,
  deleteProject,
  fetchProjects,
  openProjectFolder,
  renameProject,
  type ProjectSummaryView,
} from "../lib/client-api";
import { SettingsModal } from "./workspace-modals";
import { useCanvasMotion, WorkspacePointerTrail } from "./canvas-motion";
import { WorkspaceAura } from "./workspace-aura";
import styles from "./workspace-home.module.css";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "超级画布";
type ProjectDialog =
  | { kind: "create" }
  | { kind: "rename" | "delete"; project: ProjectSummaryView };
type SortOrder = "recent" | "created" | "name";
const VIEW_PREFERENCE_KEY = "supercanvas.workspace-view.v1";
const SORT_PREFERENCE_KEY = "supercanvas.workspace-sort.v1";

function savePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A restricted or full storage area must not prevent changing the view.
  }
}

function projectUrl(id: string) {
  return `/canvas/${encodeURIComponent(id)}`;
}

function nextDesignProjectTitle(label: string, projects: ProjectSummaryView[]) {
  // Built-in task labels contain no reserved filename characters. Account for
  // the trailing dots/spaces that Windows removes from existing project names.
  const titles = new Set(
    projects.map((project) =>
      project.title
        .trim()
        .replace(/[. ]+$/gu, "")
        .normalize("NFC"),
    ),
  );
  let title = label;
  for (let index = 2; titles.has(title); index += 1)
    title = `${label} ${index}`;
  return title;
}

function updatedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "尚未保存"
    : `${date.toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
      })}更新`;
}

function EmptyCover({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`${styles.emptyCover} ${compact ? styles.compactCover : ""}`}
      aria-hidden="true"
    >
      <div className={styles.coverDotGrid} />
      <div className={styles.coverConnector} />
      <div className={styles.coverNode}>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.coverTile}>
        <Sparkles size={compact ? 22 : 30} strokeWidth={1.35} />
      </div>
    </div>
  );
}

function ProjectCover({ project }: { project: ProjectSummaryView }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  return project.previewAssetId && failedId !== project.previewAssetId ? (
    // The existing authenticated preview endpoint serves cached, resized images.
    <img
      className={styles.coverImage}
      src={`/api/assets/${encodeURIComponent(project.previewAssetId)}/preview?size=640`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedId(project.previewAssetId ?? null)}
    />
  ) : (
    <EmptyCover compact />
  );
}

function ProjectActionDialog({
  dialog,
  onClose,
  onSubmit,
}: {
  dialog: ProjectDialog;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(
    dialog.kind === "create" ? "" : dialog.project.title,
  );
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const deleting = dialog.kind === "delete";
  const heading = deleting
    ? "删除画布"
    : dialog.kind === "rename"
      ? "重命名画布"
      : "创建新画布";
  useEffect(() => {
    const modal = element.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    modal?.showModal();
    titleInput.current?.focus({ preventScroll: true });
    return () => {
      modal?.close();
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={element}
      className={styles.dialog}
      aria-labelledby="project-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (submitting.current || (!deleting && !title.trim())) return;
          submitting.current = true;
          setBusy(true);
          setError(null);
          void onSubmit(title.trim()).catch((reason: unknown) => {
            setError(
              reason instanceof Error ? reason.message : "操作失败，请重试",
            );
            setBusy(false);
            submitting.current = false;
          });
        }}
      >
        <div className={styles.dialogHeading}>
          <span className={styles.dialogIcon}>
            {deleting ? <Trash2 size={22} /> : <Layers3 size={22} />}
          </span>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="关闭弹窗"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="project-dialog-title">{heading}</h2>
        <p>
          {deleting
            ? `将删除「${dialog.project.title}」及其项目文件夹，此操作无法撤销。`
            : dialog.kind === "rename"
              ? "修改名称后，项目文件夹将同步更新。"
              : "输入画布名称，创建后即可添加节点。"}
        </p>
        {!deleting ? (
          <label className={styles.dialogLabel}>
            画布名称
            <input
              ref={titleInput}
              autoFocus
              value={title}
              maxLength={160}
              required
              placeholder="例如：秋日品牌视觉"
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <p className={styles.dialogError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.dialogFooter}>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className={deleting ? styles.dangerButton : styles.primaryButton}
            type="submit"
            disabled={busy || (!deleting && !title.trim())}
          >
            {busy ? (
              <LoaderCircle size={16} className={styles.spinning} />
            ) : null}
            {busy
              ? "正在处理…"
              : deleting
                ? "确认删除"
                : dialog.kind === "rename"
                  ? "保存名称"
                  : "创建并打开"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function WorkspaceHome() {
  const router = useRouter();
  const homeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeMenuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuFocusIndex = useRef(0);
  const [projects, setProjects] = useState<ProjectSummaryView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SortOrder>("recent");
  const [dialog, setDialog] = useState<ProjectDialog | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startingDesignKind, setStartingDesignKind] = useState<string | null>(
    null,
  );
  const startingDesign = startingDesignKind !== null;
  const startingDesignRef = useRef(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  useEffect(() => {
    try {
      const savedView = window.localStorage.getItem(VIEW_PREFERENCE_KEY);
      const savedOrder = window.localStorage.getItem(SORT_PREFERENCE_KEY);
      // Read browser-only preferences after hydration to keep server markup stable.
      /* eslint-disable react-hooks/set-state-in-effect */
      if (savedView === "grid" || savedView === "list") setView(savedView);
      if (
        savedOrder === "recent" ||
        savedOrder === "created" ||
        savedOrder === "name"
      )
        setOrder(savedOrder);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // Defaults remain usable when local storage is unavailable.
    }
  }, []);
  const [motionEnabled, toggleMotion] = useCanvasMotion();
  const pointerEffectsEnabled =
    motionEnabled && !settingsOpen && !dialog && !menuId;
  const [notice, setNotice] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "k" &&
        !settingsOpen &&
        !dialog
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [dialog, settingsOpen]);
  const loadVersion = useRef(0);
  const reload = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const next = await fetchProjects();
      if (version !== loadVersion.current) return;
      setProjects(next);
      setLoadError(null);
    } catch (error) {
      if (version === loadVersion.current)
        setLoadError(
          error instanceof Error ? error.message : "画布列表读取失败",
        );
    }
  }, []);
  useEffect(() => {
    // Initial discovery synchronizes the workspace with its persisted projects.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    window.addEventListener("focus", reload);
    return () => {
      loadVersion.current += 1;
      window.removeEventListener("focus", reload);
    };
  }, [reload]);
  useEffect(() => {
    if (!menuId) return;
    const items =
      activeMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      );
    items?.[menuFocusIndex.current < 0 ? items.length - 1 : 0]?.focus();
    const close = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-project-menu]")
      )
        setMenuId(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuId(null);
        menuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuId]);
  useEffect(() => {
    const home = homeRef.current;
    if (!home || !pointerEffectsEnabled) return;
    let frame = 0;
    let hoveredCard: HTMLElement | null = null;
    let latest: PointerEvent | null = null;
    const reset = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      latest = null;
      home.style.removeProperty("--pointer-visible");
      hoveredCard?.style.removeProperty("--card-active");
      hoveredCard = null;
    };
    const paint = () => {
      frame = 0;
      if (!latest) return;
      home.style.setProperty("--pointer-x", `${latest.clientX}px`);
      home.style.setProperty("--pointer-y", `${latest.clientY}px`);
      home.style.setProperty("--pointer-visible", "1");
      const target = latest.target instanceof Element ? latest.target : null;
      const card =
        target?.closest<HTMLElement>("[data-workspace-card]") ?? null;
      if (hoveredCard !== card)
        hoveredCard?.style.removeProperty("--card-active");
      hoveredCard = card;
      if (card) {
        const bounds = card.getBoundingClientRect();
        card.style.setProperty("--card-x", `${latest.clientX - bounds.left}px`);
        card.style.setProperty("--card-y", `${latest.clientY - bounds.top}px`);
        card.style.setProperty("--card-active", "1");
      }
    };
    const move = (event: PointerEvent) => {
      if (
        event.pointerType !== "mouse" ||
        event.buttons ||
        document.hidden ||
        document.activeElement?.matches(
          "input, textarea, select, [contenteditable='true']",
        )
      ) {
        reset();
        return;
      }
      latest = event;
      if (!frame) frame = window.requestAnimationFrame(paint);
    };
    home.addEventListener("pointermove", move, { passive: true });
    home.addEventListener("pointerleave", reset);
    home.addEventListener("pointerdown", reset);
    home.addEventListener("focusin", reset);
    home.addEventListener("scroll", reset, { passive: true });
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      reset();
      home.removeEventListener("pointermove", move);
      home.removeEventListener("pointerleave", reset);
      home.removeEventListener("pointerdown", reset);
      home.removeEventListener("focusin", reset);
      home.removeEventListener("scroll", reset);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [pointerEffectsEnabled]);
  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (projects ?? [])
      .filter((project) => project.title.toLocaleLowerCase().includes(needle))
      .sort((a, b) =>
        order === "name"
          ? a.title.localeCompare(b.title, "zh-CN")
          : (order === "created"
              ? b.createdAt.localeCompare(a.createdAt)
              : b.updatedAt.localeCompare(a.updatedAt)) ||
            a.id.localeCompare(b.id),
      );
  }, [projects, query, order]);
  const recentProject = projects?.reduce<ProjectSummaryView | undefined>(
    (recent, project) =>
      !recent || project.updatedAt > recent.updatedAt ? project : recent,
    undefined,
  );
  const completeAction = async (title: string) => {
    if (!dialog) return;
    if (dialog.kind === "create") {
      const project = await createProject(title);
      setDialog(null);
      router.push(projectUrl(project.id));
    } else if (dialog.kind === "rename") {
      const { project } = await renameProject(dialog.project.id, title);
      // A focus-triggered read started before this mutation may still be in flight.
      loadVersion.current += 1;
      setProjects(
        (current) =>
          current?.map((item) =>
            item.id === project.id
              ? {
                  ...item,
                  ...project,
                  previewAssetId: project.previewAssetId ?? item.previewAssetId,
                }
              : item,
          ) ?? [],
      );
      setDialog(null);
      setNotice({ message: "画布已重命名" });
    } else {
      const result = await deleteProject(dialog.project.id);
      loadVersion.current += 1;
      setProjects(
        (current) =>
          current?.filter((project) => project.id !== dialog.project.id) ?? [],
      );
      setDialog(null);
      setNotice({
        message: result.warning ?? "画布已删除",
        error: Boolean(result.warning),
      });
    }
  };
  return (
    <div
      ref={homeRef}
      className={styles.home}
      data-motion={motionEnabled ? "on" : "off"}
    >
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.pointerGlow} aria-hidden="true" />
      <WorkspacePointerTrail
        enabled={pointerEffectsEnabled}
        className={styles.pointerTrail}
      />
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label={`${APP_NAME}首页`}>
          <span className={styles.brandIcon}>
            <Layers3 size={23} />
          </span>
          <span className={styles.brandText}>
            <strong>{APP_NAME}</strong>
            <span>SUPER CANVAS</span>
          </span>
        </Link>
        <nav className={styles.navigation} aria-label="工作台导航">
          <span aria-current="page">
            <Grid2X2 size={16} />
            创作空间
          </span>
        </nav>
        <div className={styles.headerActions}>
          <span className={styles.localBadge}>
            <span />
            本地工作空间
          </span>
          <button
            className={styles.motionButton}
            type="button"
            aria-label={motionEnabled ? "暂停动效" : "开启动效"}
            aria-pressed={motionEnabled}
            title={
              motionEnabled
                ? "暂停流光与粒子动效"
                : "开启动效（遵循系统减少动态效果设置）"
            }
            onClick={toggleMotion}
          >
            {motionEnabled ? <Pause size={14} /> : <Play size={14} />}
            <span>动效</span>
          </button>
          <button
            className={styles.settingsButton}
            type="button"
            aria-label="供应商与模型"
            title="供应商与模型"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={17} />
            <span>供应商与模型</span>
          </button>
        </div>
      </header>
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="workspace-heading">
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>
              <Sparkles size={13} />
              <span>灵感无界 · 创作不止</span>
              <span className={styles.eyebrowLine} />
            </div>
            <h1 id="workspace-heading">
              让灵感，
              <br />
              <span>自由生长。</span>
            </h1>
            <p className={styles.heroDescription}>
              连接文字、图像与视频，让每一个想象成为作品。
            </p>
            <div className={styles.heroActions}>
              <button
                className={styles.primaryButton}
                disabled={startingDesign}
                onClick={() => setDialog({ kind: "create" })}
              >
                <Plus size={18} />
                创建画布
                <ArrowUpRight size={16} className={styles.buttonArrow} />
              </button>
              {recentProject ? (
                <Link
                  className={styles.continueLink}
                  href={projectUrl(recentProject.id)}
                  title={`继续编辑「${recentProject.title}」`}
                >
                  <span className={styles.recentHeading}>
                    继续最近创作
                    <ArrowRight size={14} />
                  </span>
                  <strong title={recentProject.title}>
                    {recentProject.title}
                  </strong>
                </Link>
              ) : (
                <span className={styles.heroHint}>从一张空白画布开始</span>
              )}
            </div>
            <div className={styles.quickDesigns} aria-label="按设计任务开始">
              {(
                [
                  ["event-poster", "做活动海报", "从主题到完整视觉", ImageIcon],
                  [
                    "revise",
                    "修改客户原图",
                    "保留原图，精准调整",
                    WandSparkles,
                  ],
                  [
                    "event-material",
                    "制作多尺寸物料",
                    "一套设计，多种规格",
                    PanelsTopLeft,
                  ],
                ] as const
              ).map(([kind, label, description, Icon]) => (
                <button
                  type="button"
                  key={kind}
                  data-task={kind}
                  title={description}
                  aria-busy={startingDesignKind === kind}
                  disabled={startingDesign}
                  onClick={async () => {
                    if (startingDesignRef.current) return;
                    startingDesignRef.current = true;
                    setStartingDesignKind(kind);
                    try {
                      const currentProjects = await fetchProjects();
                      const project = await createProject(
                        nextDesignProjectTitle(label, currentProjects),
                      );
                      router.push(`${projectUrl(project.id)}?design=${kind}`);
                    } catch (error) {
                      setNotice({
                        message:
                          error instanceof Error
                            ? error.message
                            : "项目创建失败",
                        error: true,
                      });
                      startingDesignRef.current = false;
                      setStartingDesignKind(null);
                    }
                  }}
                >
                  <span className={styles.quickDesignIcon} aria-hidden="true">
                    {startingDesignKind === kind ? (
                      <LoaderCircle size={16} className={styles.spinning} />
                    ) : (
                      <Icon size={16} strokeWidth={1.7} />
                    )}
                  </span>
                  <span className={styles.quickDesignCopy}>
                    <strong>{label}</strong>
                    <span aria-hidden="true">{description}</span>
                  </span>
                  <ArrowUpRight size={13} className={styles.quickDesignArrow} />
                </button>
              ))}
            </div>
          </div>
          <div className={styles.heroVisual}>
            <WorkspaceAura
              paused={!motionEnabled || settingsOpen || Boolean(dialog)}
            />
          </div>
        </section>
        <section
          className={styles.projectsSection}
          aria-labelledby="projects-heading"
        >
          <div className={styles.sectionHeading}>
            <div className={styles.sectionHeadingCopy}>
              <div className={styles.sectionTitle}>
                <h2 id="projects-heading">我的画布</h2>
                {projects ? <span>{projects.length}</span> : null}
              </div>
              <p aria-live="polite" aria-atomic="true">
                {query.trim()
                  ? `找到 ${visibleProjects.length} 张画布`
                  : projects?.length
                    ? `共 ${projects.length} 张画布 · 点击作品继续编辑`
                    : "新建画布，开始你的第一个项目"}
              </p>
            </div>
            <div className={styles.listTools}>
              <label className={styles.search} title="搜索画布 · Ctrl / ⌘ K">
                <Search size={17} />
                <input
                  ref={searchRef}
                  aria-label="搜索画布"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索画布名称…"
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                  >
                    <X size={15} />
                  </button>
                ) : (
                  <kbd aria-hidden="true">Ctrl K</kbd>
                )}
              </label>
              <label className={styles.sort}>
                <ArrowDownWideNarrow size={16} />
                <select
                  aria-label="画布排序"
                  value={order}
                  onChange={(event) => {
                    setOrder(event.target.value as SortOrder);
                    savePreference(SORT_PREFERENCE_KEY, event.target.value);
                  }}
                >
                  <option value="recent">最近编辑</option>
                  <option value="created">最新创建</option>
                  <option value="name">名称排序</option>
                </select>
                <ChevronDown size={13} />
              </label>
              <div
                className={styles.viewToggle}
                role="group"
                aria-label="画布显示方式"
              >
                <button
                  type="button"
                  aria-label="网格视图"
                  aria-pressed={view === "grid"}
                  onClick={() => {
                    setView("grid");
                    savePreference(VIEW_PREFERENCE_KEY, "grid");
                  }}
                >
                  <Grid2X2 size={16} />
                </button>
                <button
                  type="button"
                  aria-label="列表视图"
                  aria-pressed={view === "list"}
                  onClick={() => {
                    setView("list");
                    savePreference(VIEW_PREFERENCE_KEY, "list");
                  }}
                >
                  <List size={17} />
                </button>
              </div>
            </div>
          </div>
          {loadError ? (
            <div className={styles.loadError} role="alert">
              <span>{loadError}</span>
              <button
                className={styles.secondaryButton}
                onClick={() => void reload()}
              >
                重新加载
              </button>
            </div>
          ) : null}
          {!projects && !loadError ? (
            <div className={styles.loading} role="status">
              <LoaderCircle size={22} className={styles.spinning} />
              正在读取你的画布…
            </div>
          ) : null}
          {projects ? (
            <div
              className={`${styles.grid} ${view === "list" ? styles.listView : ""}`}
            >
              {!projects.length && !query.trim() ? (
                <button
                  className={styles.createCard}
                  data-workspace-card
                  type="button"
                  disabled={startingDesign}
                  onClick={() => setDialog({ kind: "create" })}
                  aria-label="新建空白画布"
                >
                  <span className={styles.createCardEyebrow}>空白项目</span>
                  <span className={styles.createPlus}>
                    <Plus size={28} strokeWidth={1.4} />
                  </span>
                  <strong>新建空白画布</strong>
                  <span className={styles.createDescription}>
                    一张空白画布，无限创作可能
                  </span>
                  <span className={styles.createCardArrow}>
                    <ArrowUpRight size={17} />
                  </span>
                </button>
              ) : null}
              {visibleProjects.map((project) => (
                <article
                  className={styles.projectCard}
                  data-workspace-card
                  key={project.id}
                  aria-label={project.title}
                  data-menu-open={menuId === project.id}
                >
                  <Link
                    className={styles.cardLink}
                    href={projectUrl(project.id)}
                    aria-label={`打开画布 ${project.title}`}
                  >
                    <div className={styles.cover}>
                      <ProjectCover project={project} />
                      <span className={styles.coverLabel}>
                        <Layers3 size={11} />
                        {project.id === recentProject?.id
                          ? "最近编辑"
                          : "创意工作流"}
                      </span>
                      <span className={styles.openBadge}>
                        打开画布 <ArrowRight size={14} />
                      </span>
                    </div>
                    <div className={styles.cardInfo}>
                      <h3 title={project.title}>{project.title}</h3>
                      <div className={styles.cardMeta}>
                        <span>
                          <Clock3 size={12} />
                          {updatedLabel(project.updatedAt)}
                        </span>
                        <span className={styles.nodeCount}>
                          <Layers3 size={12} />
                          {project.nodeCount ?? 0} 个节点
                        </span>
                      </div>
                    </div>
                  </Link>
                  <div
                    className={styles.cardMenu}
                    data-project-menu
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        setMenuId((current) =>
                          current === project.id ? null : current,
                        );
                    }}
                  >
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`${project.title} 的画布操作`}
                      aria-expanded={menuId === project.id}
                      aria-haspopup="menu"
                      aria-controls={
                        menuId === project.id
                          ? `project-menu-${project.id}`
                          : undefined
                      }
                      onClick={(event) => {
                        menuTriggerRef.current = event.currentTarget;
                        menuFocusIndex.current = 0;
                        setMenuId(menuId === project.id ? null : project.id);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key !== "ArrowDown" &&
                          event.key !== "ArrowUp"
                        )
                          return;
                        event.preventDefault();
                        menuTriggerRef.current = event.currentTarget;
                        menuFocusIndex.current =
                          event.key === "ArrowUp" ? -1 : 0;
                        if (menuId === project.id) {
                          const items =
                            activeMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                              '[role="menuitem"]',
                            );
                          items?.[
                            menuFocusIndex.current < 0 ? items.length - 1 : 0
                          ]?.focus();
                        }
                        setMenuId(project.id);
                      }}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                    {menuId === project.id ? (
                      <div
                        ref={activeMenuRef}
                        id={`project-menu-${project.id}`}
                        className={styles.dropdown}
                        role="menu"
                        aria-label={`${project.title} 的操作菜单`}
                        onKeyDown={(event) => {
                          if (
                            !["ArrowDown", "ArrowUp", "Home", "End"].includes(
                              event.key,
                            )
                          )
                            return;
                          event.preventDefault();
                          const items = Array.from(
                            event.currentTarget.querySelectorAll<HTMLButtonElement>(
                              '[role="menuitem"]',
                            ),
                          );
                          const current = items.indexOf(
                            document.activeElement as HTMLButtonElement,
                          );
                          const next =
                            event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? items.length - 1
                                : (current +
                                    (event.key === "ArrowDown" ? 1 : -1) +
                                    items.length) %
                                  items.length;
                          items[next]?.focus();
                        }}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          tabIndex={-1}
                          onClick={() => {
                            menuTriggerRef.current?.focus();
                            setMenuId(null);
                            setDialog({ kind: "rename", project });
                          }}
                        >
                          <Pencil size={15} />
                          重命名
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          tabIndex={-1}
                          onClick={() => {
                            setMenuId(null);
                            menuTriggerRef.current?.focus();
                            void openProjectFolder(project.id)
                              .then(() =>
                                setNotice({ message: "已打开项目文件夹" }),
                              )
                              .catch((error: unknown) =>
                                setNotice({
                                  message:
                                    error instanceof Error
                                      ? error.message
                                      : "无法打开项目文件夹",
                                  error: true,
                                }),
                              );
                          }}
                        >
                          <FolderOpen size={15} />
                          打开文件夹
                        </button>
                        <button
                          type="button"
                          className={styles.deleteAction}
                          role="menuitem"
                          tabIndex={-1}
                          onClick={() => {
                            menuTriggerRef.current?.focus();
                            setMenuId(null);
                            setDialog({ kind: "delete", project });
                          }}
                        >
                          <Trash2 size={15} />
                          删除画布
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {projects && visibleProjects.length === 0 ? (
            <div className={styles.emptyList}>
              <span className={styles.emptyIcon}>
                {query.trim() ? (
                  <Search size={24} strokeWidth={1.5} />
                ) : (
                  <Layers3 size={24} strokeWidth={1.5} />
                )}
              </span>
              <h3>
                {query.trim()
                  ? "没有找到匹配的画布"
                  : "你的创作空间，已准备就绪"}
              </h3>
              <p>
                {query.trim()
                  ? "试试其他名称，或清空搜索查看全部画布。"
                  : "点击「创建画布」，添加图片、视频或文本节点。"}
              </p>
              {query.trim() ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  查看全部画布 <ArrowRight size={14} />
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
        <footer className={styles.footer}>
          <span className={styles.footerBrand}>
            <Layers3 size={14} />
            SUPER CANVAS<span>你的创作，持续生长</span>
          </span>
          <span className={styles.footerStorage}>
            <HardDrive size={13} />
            作品保存在本机
            <span className={styles.footerDot} />
            本地创作工作空间
          </span>
        </footer>
      </main>
      {notice ? (
        <div
          className={`${styles.notice} ${notice.error ? styles.noticeError : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {!notice.error ? <Check size={17} /> : null}
          <span>{notice.message}</span>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
      {dialog ? (
        <ProjectActionDialog
          key={`${dialog.kind}-${dialog.kind === "create" ? "new" : dialog.project.id}`}
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSubmit={completeAction}
        />
      ) : null}
      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          void reload();
        }}
      />
    </div>
  );
}
