"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  FolderOpen,
  Grid2X2,
  Layers3,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
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
import styles from "./workspace-home.module.css";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "超级画布";
type ProjectDialog =
  | { kind: "create" }
  | { kind: "rename" | "delete"; project: ProjectSummaryView };
type SortOrder = "recent" | "created" | "name";

function projectUrl(id: string) {
  return `/canvas/${encodeURIComponent(id)}`;
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
  const [title, setTitle] = useState(
    dialog.kind === "create" ? "" : dialog.project.title,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleting = dialog.kind === "delete";
  const heading = deleting
    ? "删除画布"
    : dialog.kind === "rename"
      ? "重命名画布"
      : "创建新画布";
  useEffect(() => {
    const modal = element.current;
    modal?.showModal();
    return () => modal?.close();
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
          if (busy || (!deleting && !title.trim())) return;
          setBusy(true);
          setError(null);
          void onSubmit(title.trim()).catch((reason: unknown) => {
            setError(
              reason instanceof Error ? reason.message : "操作失败，请重试",
            );
            setBusy(false);
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
  const [projects, setProjects] = useState<ProjectSummaryView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SortOrder>("recent");
  const [dialog, setDialog] = useState<ProjectDialog | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
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
    const close = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-project-menu]")
      )
        setMenuId(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuId(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuId]);
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
    <div className={styles.home}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label={`${APP_NAME}首页`}>
          <span className={styles.brandIcon}>
            <Layers3 size={23} />
          </span>
          {APP_NAME}
        </Link>
        <nav className={styles.navigation} aria-label="工作台导航">
          <span aria-current="page">
            <Grid2X2 size={16} />
            我的画布
          </span>
        </nav>
        <button
          className={styles.settingsButton}
          type="button"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={17} />
          <span>供应商与模型</span>
        </button>
      </header>
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="workspace-heading">
          <div className={styles.heroCopy}>
            <h1 id="workspace-heading">你的创作空间</h1>
            <p className={styles.heroDescription}>
              创建画布，或继续最近的作品。
            </p>
            <div className={styles.heroActions}>
              <button
                className={styles.primaryButton}
                onClick={() => setDialog({ kind: "create" })}
              >
                <Plus size={18} />
                创建画布
              </button>
              {recentProject ? (
                <Link
                  className={styles.continueLink}
                  href={projectUrl(recentProject.id)}
                >
                  继续最近创作
                  <ArrowRight size={16} />
                </Link>
              ) : (
                <span className={styles.heroHint}>从一张空白画布开始</span>
              )}
            </div>
          </div>
          <div className={styles.heroVisual}>
            <EmptyCover />
          </div>
        </section>
        <section
          className={styles.projectsSection}
          aria-labelledby="projects-heading"
        >
          <div className={styles.sectionHeading}>
            <div className={styles.sectionTitle}>
              <h2 id="projects-heading">我的画布</h2>
              {projects ? <span>{projects.length}</span> : null}
            </div>
            <div className={styles.listTools}>
              <label className={styles.search}>
                <Search size={17} />
                <input
                  aria-label="搜索画布"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索画布名称…"
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => setQuery("")}
                  >
                    <X size={15} />
                  </button>
                ) : null}
              </label>
              <label className={styles.sort}>
                <ArrowDownWideNarrow size={16} />
                <select
                  aria-label="画布排序"
                  value={order}
                  onChange={(event) =>
                    setOrder(event.target.value as SortOrder)
                  }
                >
                  <option value="recent">最近编辑</option>
                  <option value="created">最新创建</option>
                  <option value="name">名称排序</option>
                </select>
                <ChevronDown size={13} />
              </label>
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
            <div className={styles.grid}>
              {!query.trim() ? (
                <button
                  className={styles.createCard}
                  type="button"
                  onClick={() => setDialog({ kind: "create" })}
                  aria-label="新建空白画布"
                >
                  <span className={styles.createPlus}>
                    <Plus size={28} strokeWidth={1.4} />
                  </span>
                  <strong>新建空白画布</strong>
                <span>添加节点，开始创作</span>
                </button>
              ) : null}
              {visibleProjects.map((project) => (
                <article
                  className={styles.projectCard}
                  key={project.id}
                  aria-label={project.title}
                >
                  <Link
                    className={styles.cardLink}
                    href={projectUrl(project.id)}
                    aria-label={`打开画布 ${project.title}`}
                  >
                    <div className={styles.cover}>
                      <ProjectCover project={project} />
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
                        <span>{project.nodeCount ?? 0} 个节点</span>
                      </div>
                    </div>
                  </Link>
                  <div className={styles.cardMenu} data-project-menu>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`${project.title} 的画布操作`}
                      aria-expanded={menuId === project.id}
                      aria-haspopup="menu"
                      onClick={() =>
                        setMenuId(menuId === project.id ? null : project.id)
                      }
                    >
                      <MoreHorizontal size={20} />
                    </button>
                    {menuId === project.id ? (
                      <div
                        className={styles.dropdown}
                        role="menu"
                        aria-label={`${project.title} 的操作菜单`}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
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
                          onClick={() => {
                            setMenuId(null);
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
                          onClick={() => {
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
              <Layers3 size={25} strokeWidth={1.3} />
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
            </div>
          ) : null}
        </section>
        <footer className={styles.footer}>
          <span>{APP_NAME}</span>
          <span>图片 · 视频 · 文字</span>
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
