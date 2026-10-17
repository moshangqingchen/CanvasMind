"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Grid2X2,
  Layers3,
  List,
  LoaderCircle,
  MessageCircle,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import {
  createProject,
  deleteProject,
  fetchConnections,
  fetchProjects,
  openProjectFolder,
  renameProject,
  type ProjectSummaryView,
  type ProviderConnectionView,
} from "../lib/client-api";
import { fetchSuppliers, type SupplierRecord } from "../lib/client-suppliers";
import {
  adaptWorkspaceData,
  buildWorkspaceIndex,
  INITIAL_WORKSPACE,
  nextWorkspaceTitle,
  QUICK_STARTS,
  searchWorkspace,
  sortWorkspaceProjects,
  umbrellaCurve,
  WORKSPACE_MODULES,
  workspaceCount,
  workspaceTransition,
  type WorkspaceSearchEntry,
  type WorkspaceSort,
} from "../lib/neural-workspace";
import {
  NEURAL_MODULES,
  neuralCssColor,
  type NeuralModule,
} from "../lib/neural-tokens";
import {
  neuralLayout,
  stepNeuralSpring,
  type NeuralPoint,
} from "../lib/neural-motion";
import {
  modelPickerPriceCompact,
  modelPickerPriceData,
} from "../lib/model-picker-data";
import { saveWorkspaceAgentDraft } from "../lib/workspace-agent-draft";
import { useCanvasMotion } from "./canvas-motion";
import { ThemeControl } from "./theme-control";
import { SettingsModal } from "./settings-modal";
import {
  ProjectActionDialog,
  ProjectCover,
  type ProjectDialog,
} from "./workspace-project-ui";
import styles from "./neural-workspace.module.css";

const NeuralScene = dynamic(
  () => import("./neural-scene").then((module) => module.NeuralScene),
  { ssr: false },
);
const ICONS = {
  canvases: Layers3,
  suppliers: Server,
  accounts: UserRound,
  starts: Sparkles,
};
const VIEW_KEY = "supercanvas.workspace-view.v1",
  SORT_KEY = "supercanvas.workspace-sort.v1";
let sessionEntered = false;
function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session remains usable. */
  }
}
function projectUrl(id: string) {
  return `/canvas/${encodeURIComponent(id)}`;
}
function dateLabel(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
function Bilingual({ label, english }: { label: string; english: string }) {
  return (
    <span className={styles.bilingual}>
      {label}
      <small>{english}</small>
    </span>
  );
}
type SettingsLocation = Omit<
  ComponentProps<typeof SettingsModal>,
  "open" | "onClose"
>;
type Item = { id: string; title: string; detail: string };

/** One-shot procedural film grain; no asset, network access or animated texture. */
function FilmGrain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const pixels = context.createImageData(192, 192);
    let seed = 739;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = Math.imul(seed ^ (seed >>> 13), 1597334677);
      const shade = seed >>> 24;
      pixels.data[i] = shade;
      pixels.data[i + 1] = shade;
      pixels.data[i + 2] = shade;
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
  }, []);
  return (
    <canvas
      ref={ref}
      width={192}
      height={192}
      className={styles.grain}
      aria-hidden="true"
    />
  );
}

/** Springs update compositor properties directly; React never renders per frame. */
function SpringInspector({
  motion,
  children,
}: {
  motion: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!motion) {
      node.style.transform = "none";
      return;
    }
    let spring = { value: 60, velocity: 0 },
      last = performance.now(),
      frame = 0;
    const tick = (now: number) => {
      spring = stepNeuralSpring(
        spring,
        0,
        Math.min(0.05, (now - last) / 1000),
        170,
      );
      last = now;
      node.style.transform = `translateX(${spring.value}%)`;
      if (spring.value !== 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [motion]);
  return (
    <aside
      ref={ref}
      className={styles.inspector}
      data-testid="neural-inspector"
      aria-label="条目分析面板"
    >
      {children}
    </aside>
  );
}

export function NeuralWorkspace() {
  const router = useRouter();
  const [state, dispatch] = useReducer(workspaceTransition, INITIAL_WORKSPACE);
  const [projects, setProjects] = useState<ProjectSummaryView[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRecord[] | null>(null);
  const [connections, setConnections] = useState<
    ProviderConnectionView[] | null
  >(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [searchPulse, setSearchPulse] = useState(0);
  const [projectQuery, setProjectQuery] = useState("");
  const [order, setOrder] = useState<WorkspaceSort>("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [dialog, setDialog] = useState<ProjectDialog | null>(null);
  const [settings, setSettings] = useState<SettingsLocation | null>(null);
  const [hovered, setHovered] = useState<NeuralModule | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [departing, setDeparting] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [motion, toggleMotion] = useCanvasMotion();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [entrance, setEntrance] = useState("return");
  const root = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const satellites = useRef(new Map<NeuralModule, HTMLButtonElement>());
  const paths = useRef(new Map<string, SVGPathElement>());
  const rows = useRef(new Map<string, HTMLElement>());
  const ends = useRef(new Map<string, NeuralPoint>());
  const curveOffset = useRef(172);
  const lastPositions = useRef<Record<NeuralModule, NeuralPoint> | null>(null);
  const moduleRef = useRef<NeuralModule | null>(null);
  const version = useRef(0),
    navigating = useRef(false),
    navigationTimer = useRef(0);
  const trigger = useRef<HTMLElement | null>(null);
  const data = useMemo(
    () => adaptWorkspaceData(projects, suppliers, connections),
    [projects, suppliers, connections],
  );
  const index = useMemo(
    () => buildWorkspaceIndex(projects ?? [], data),
    [projects, data],
  );
  const results = useMemo(() => {
    const ranked = searchWorkspace(index, query);
    return NEURAL_MODULES.flatMap((moduleId) =>
      ranked.filter((entry) => entry.module === moduleId),
    );
  }, [index, query]);
  const visibleProjects = useMemo(
    () => sortWorkspaceProjects(projects ?? [], projectQuery, order),
    [projects, projectQuery, order],
  );
  const resultsKey = results.map((r) => r.id).join("\n");
  const matches = useMemo(() => new Set(results.map((r) => r.id)), [results]);
  const entities = useMemo(
    () =>
      index
        .filter((e) => e.kind === "item")
        .map((e) => ({
          id: e.id,
          module: e.module,
          match: searchOpen && (matches.has(e.id) || results.some(result => result.kind === "model" && result.module === e.module && result.itemId === e.itemId)),
        })),
    [index, matches, searchOpen, results],
  );
  const selectedProject =
    state.module === "canvases"
      ? projects?.find((p) => p.id === state.itemId)
      : undefined;
  const selectedSupplier =
    state.module === "suppliers"
      ? data.suppliers.find((s) => s.id === state.itemId)
      : undefined;
  const selectedAccount =
    state.module === "accounts"
      ? data.accounts.find((a) => a.id === state.itemId)
      : undefined;
  const selectedStart =
    state.module === "starts"
      ? QUICK_STARTS.find((s) => s.id === state.itemId)
      : undefined;
  const selectedTitle =
    selectedProject?.title ??
    selectedSupplier?.title ??
    selectedAccount?.title ??
    selectedStart?.title;
  const items: Item[] = useMemo(
    () =>
      state.module === "canvases"
        ? visibleProjects.map((p) => ({
            id: p.id,
            title: p.title,
            detail: `${p.nodeCount === undefined ? "—" : workspaceCount(p.nodeCount)} 节点 NODES · ${dateLabel(p.updatedAt)}`,
          }))
        : state.module === "suppliers"
          ? data.suppliers.map((s) => ({
              id: s.id,
              title: s.title,
              detail: `${s.groups.length} 分组 GROUPS · ${s.groups.reduce((n, g) => n + g.models.length, 0)} 型号 MODELS${s.balance === "—" ? "" : ` · ${s.balance}`}`,
            }))
          : state.module === "accounts"
            ? data.accounts.map((a) => ({
                id: a.id,
                title: a.title,
                detail: `${a.status} · ${a.models.length} 型号 MODELS`,
              }))
            : state.module === "starts"
              ? QUICK_STARTS.map((s) => ({
                  id: s.id,
                  title: s.title,
                  detail: `${s.description} · ${s.english}`,
                }))
              : [],
    [state.module, visibleProjects, data],
  );

  const load = useCallback(async () => {
    const current = ++version.current;
    const reads = await Promise.allSettled([
      fetchProjects(),
      fetchSuppliers(),
      fetchConnections(),
    ]);
    if (current !== version.current) return;
    if (reads[0].status === "fulfilled") setProjects(reads[0].value);
    if (reads[1].status === "fulfilled") setSuppliers(reads[1].value);
    if (reads[2].status === "fulfilled") setConnections(reads[2].value);
    setErrors(
      reads.flatMap((r) =>
        r.status === "rejected"
          ? [r.reason instanceof Error ? r.reason.message : "空间数据读取失败"]
          : [],
      ),
    );
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void load();
      setEntrance(sessionEntered ? "return" : "first");
      sessionEntered = true;
      try {
        const preference = localStorage.getItem(VIEW_KEY),
          sort = localStorage.getItem(SORT_KEY);
        if (preference === "grid" || preference === "list") setView(preference);
        if (sort === "recent" || sort === "created" || sort === "name")
          setOrder(sort);
      } catch {
        /* Keep defaults. */
      }
    });
    const readTheme = () =>
      setTheme(
        document.documentElement.dataset.theme === "light" ? "light" : "dark",
      );
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    window.addEventListener("focus", load);
    const resetDeparture = () => {
      navigating.current = false;
      setDeparting(false);
      setStarting(null);
    };
    window.addEventListener("pageshow", resetDeparture);
    window.addEventListener("popstate", resetDeparture);
    const invalidateRead = () => {
      version.current++;
    };
    return () => {
      cancelAnimationFrame(frame);
      invalidateRead();
      clearTimeout(navigationTimer.current);
      window.removeEventListener("focus", load);
      window.removeEventListener("pageshow", resetDeparture);
      window.removeEventListener("popstate", resetDeparture);
      observer.disconnect();
    };
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setActiveResult(0);
      if (resultsKey) setSearchPulse((p) => p + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [resultsKey]);
  useEffect(() => {
    if (!searchOpen) return;
    document
      .querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeResult, searchOpen]);
  useLayoutEffect(() => {
    moduleRef.current = state.module;
  }, [state.module]);

  const updatePositions = useCallback(
    (positions: Record<NeuralModule, NeuralPoint>) => {
      lastPositions.current = positions;
      for (const moduleId of NEURAL_MODULES) {
        const point = positions[moduleId],
          card = satellites.current.get(moduleId);
        if (card) {
          card.style.left = `${point.x}px`;
          card.style.top = `${point.y}px`;
        }
      }
      const active = moduleRef.current;
      if (active)
        for (const [id, path] of paths.current) {
          const end = ends.current.get(id);
          if (end)
            path.setAttribute(
              "d",
              umbrellaCurve(
                {
                  x: positions[active].x + curveOffset.current,
                  y: positions[active].y,
                },
                end,
              ),
            );
        }
    },
    [],
  );
  const measureCurves = useCallback(() => {
    const bounds = root.current?.getBoundingClientRect();
    if (!bounds) return;
    const active = moduleRef.current;
    const label = active
      ? satellites.current
          .get(active)
          ?.querySelector<HTMLElement>("[data-satellite-card]")
      : null;
    if (label) curveOffset.current = 70 + label.offsetWidth;
    ends.current.clear();
    for (const [id, row] of rows.current) {
      const rect = row.getBoundingClientRect();
      ends.current.set(id, {
        x: rect.left - bounds.left - 14,
        y: rect.top - bounds.top + rect.height / 2,
      });
    }
    updatePositions(
      lastPositions.current ??
        neuralLayout(bounds.width, bounds.height, moduleRef.current).modules,
    );
  }, [updatePositions]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measureCurves);
    const observer = new ResizeObserver(measureCurves);
    if (root.current) observer.observe(root.current);
    if (list.current) observer.observe(list.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [state.module, state.itemId, items, view, measureCurves]);
  const closeSearch = useCallback(() => {
    search.current?.focus();
    setSearchOpen(false);
  }, []);
  const goHome = useCallback(() => {
    setEntrance("return");
    dispatch({ type: "home" });
  }, []);
  const goBack = useCallback(() => {
    setEntrance("return");
    dispatch({ type: "back" });
    requestAnimationFrame(
      () =>
        trigger.current?.isConnected &&
        trigger.current.focus({ preventScroll: true }),
    );
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        settings ||
        dialog
      )
        return;
      const typing = (event.target as HTMLElement)?.closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if (
        ((event.ctrlKey || event.metaKey) &&
          ["k", "f"].includes(event.key.toLowerCase())) ||
        (event.key === "/" &&
          !typing &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey)
      ) {
        event.preventDefault();
        if (state.module === "canvases") {
          const field = root.current?.querySelector<HTMLInputElement>(
            '[aria-label="搜索画布"]',
          );
          field?.focus();
          field?.select();
        } else {
          search.current?.focus();
          search.current?.select();
          setSearchOpen(true);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (searchOpen) closeSearch();
        else goBack();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [dialog, settings, searchOpen, closeSearch, goBack, state.module]);

  const openCanvas = useCallback(
    (id: string, suffix = "") => {
      if (navigating.current) return;
      navigating.current = true;
      setDeparting(true);
      setSearchOpen(false);
      navigationTimer.current = window.setTimeout(
        () => {
          router.push(`${projectUrl(id)}${suffix}`);
          // The router may preserve this component on history traversal.
          navigationTimer.current = window.setTimeout(() => {
            navigating.current = false;
            setDeparting(false);
          }, 800);
        },
        motion ? 700 : 150,
      );
    },
    [router, motion],
  );
  const startTask = async (id: string, draft = "") => {
    if (navigating.current || starting) return;
    if (id === "blank") {
      setDialog({ kind: "create" });
      return;
    }
    navigating.current = true;
    setStarting(id);
    try {
      const currentProjects = await fetchProjects();
      const label =
        id === "chat"
          ? "创作对话"
          : QUICK_STARTS.find((q) => q.id === id)?.title;
      if (!label) throw Error("创作入口不存在");
      const project = await createProject(
        nextWorkspaceTitle(label, currentProjects),
      );
      if (id === "chat" && draft.trim()) {
        try {
          saveWorkspaceAgentDraft(project.id, draft, window.sessionStorage);
        } catch {
          setNotice({
            message: "草稿暂存失败，请在对话中粘贴内容",
            error: true,
          });
        }
      }
      navigating.current = false;
      openCanvas(
        project.id,
        id === "chat" ? "?agent=chat" : `?design=${encodeURIComponent(id)}`,
      );
    } catch (error) {
      navigating.current = false;
      setStarting(null);
      setNotice({
        message: error instanceof Error ? error.message : "项目创建失败",
        error: true,
      });
    }
  };
  const selectItem = (id: string, element?: HTMLElement) => {
    if (!state.module) return;
    trigger.current = element ?? null;
    dispatch({ type: "item", module: state.module, id });
  };
  const selectResult = (entry: WorkspaceSearchEntry) => {
    setSearchOpen(false);
    if (entry.kind === "module")
      dispatch({ type: "module", module: entry.module });
    else dispatch({ type: "item", module: entry.module, id: entry.itemId! });
  };
  const completeAction = async (title: string) => {
    if (!dialog) return;
    if (dialog.kind === "create") {
      const project = await createProject(title);
      setDialog(null);
      openCanvas(project.id);
    } else if (dialog.kind === "rename") {
      const { project } = await renameProject(dialog.project.id, title);
      version.current++;
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
      version.current++;
      setProjects(
        (current) =>
          current?.filter((project) => project.id !== dialog.project.id) ?? [],
      );
      setDialog(null);
      dispatch({ type: "back" });
      setNotice({
        message: result.warning ?? "画布已删除",
        error: Boolean(result.warning),
      });
    }
  };
  const addEntry = () =>
    state.module === "canvases" || state.module === "starts"
      ? setDialog({ kind: "create" })
      : state.module === "suppliers"
        ? setSettings({ initialTab: "suppliers", startAddingSupplier: true })
        : setSettings({ initialTab: "personal-ai", startAddingAccount: true });
  const moduleCount = (module: NeuralModule) =>
    workspaceCount(data.counts[module]);
  const moduleDetail = (module: NeuralModule) =>
    module === "canvases"
      ? `${workspaceCount(data.counts.nodes)} 节点 NODES`
      : module === "suppliers"
        ? `${workspaceCount(data.counts.models)} 可用型号 MODELS`
        : module === "accounts"
          ? `${workspaceCount(data.counts.ready)} 已就绪 READY`
          : "从灵感到作品";

  return (
    <div
      ref={root}
      className={styles.workspace}
      data-testid="neural-workspace"
      data-level={state.level}
      data-module={state.module ?? "hub"}
      data-motion={motion ? "on" : "off"}
      data-entrance={entrance}
      data-departing={departing}
    >
      <NeuralScene
        module={state.module}
        hoveredModule={hovered}
        motion={motion}
        dimmed={Boolean(settings || dialog)}
        theme={theme}
        entities={entities}
        searchPulse={searchPulse}
        departing={departing}
        onPositions={updatePositions}
      />
      <FilmGrain />
      <div className={styles.vignette} aria-hidden="true" />
      <header className={styles.header}>
        <button
          className={styles.brand}
          onClick={goHome}
          aria-label="超级画布首页"
        >
          <span className={styles.brandCore}>
            <Network size={22} strokeWidth={1} />
          </span>
          <span>
            超级画布<small>SUPER CANVAS</small>
          </span>
        </button>
        <nav className={styles.navigation} aria-label="工作台导航">
          {([null, "canvases", "suppliers", "accounts"] as const).map(
            (module) => (
              <button
                key={module ?? "hub"}
                aria-current={state.module === module ? "page" : undefined}
                onClick={() =>
                  module ? dispatch({ type: "module", module }) : goHome()
                }
              >
                <Bilingual
                  label={module ? WORKSPACE_MODULES[module].label : "工作台"}
                  english={
                    module ? WORKSPACE_MODULES[module].english : "WORKSPACE"
                  }
                />
              </button>
            ),
          )}
        </nav>
        <div className={styles.headerActions}>
          <ThemeControl compact />
          <button
            className={styles.iconButton}
            onClick={toggleMotion}
            aria-label={motion ? "暂停动效" : "开启动效"}
            aria-pressed={motion}
            title={motion ? "暂停动效" : "开启动效"}
          >
            {motion ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            className={styles.iconButton}
            data-testid="workspace-settings"
            aria-label="创作设置"
            title="创作设置"
            onClick={() => setSettings({})}
          >
            <Settings2 size={17} />
          </button>
          <button
            className={styles.primaryButton}
            data-testid="new-project"
            onClick={() => setDialog({ kind: "create" })}
            disabled={Boolean(starting) || departing}
          >
            <Plus size={15} />
            <span>新建画布</span>
            <small>NEW</small>
          </button>
        </div>
      </header>
      <main className={styles.main} aria-label="神经网络创作空间">
        {state.level === "hub" ? (
          <div className={styles.introduction}>
            <div className={styles.eyebrow}>
              <span /> PERSONAL CREATIVE NETWORK
            </div>
            <h1>
              你的创作空间<span>，正在连接。</span>
            </h1>
            <p>每一个想法，都有自己的引力。</p>
          </div>
        ) : (
          <nav className={styles.breadcrumb} aria-label="面包屑">
            <button onClick={goBack} aria-label="返回上一层">
              <ArrowLeft size={15} />
            </button>
            <button onClick={goHome}>工作台</button>
            <ChevronRight size={11} />
            <button
              onClick={() =>
                dispatch({ type: "module", module: state.module! })
              }
            >
              {WORKSPACE_MODULES[state.module].label}
            </button>
            {selectedTitle ? (
              <>
                <ChevronRight size={11} />
                <span>{selectedTitle}</span>
              </>
            ) : null}
          </nav>
        )}
        {NEURAL_MODULES.map((module) => {
          const Icon = ICONS[module],
            label = WORKSPACE_MODULES[module];
          return (
            <button
              key={module}
              ref={(node) => {
                if (node) satellites.current.set(module, node);
                else satellites.current.delete(module);
              }}
              className={styles.satellite}
              data-testid={`neural-module-${module}`}
              data-selected={state.module === module}
              data-match={
                searchOpen && results.some((result) => result.module === module)
              }
              data-dimmed={Boolean(
                (state.module && state.module !== module) ||
                (hovered && hovered !== module),
              )}
              style={
                {
                  "--module-color": neuralCssColor(module),
                  left: `${(module === "canvases" ? 0.28 : module === "suppliers" ? 0.71 : module === "accounts" ? 0.77 : 0.24) * 100}%`,
                  top: `${(module === "canvases" ? 0.29 : module === "suppliers" ? 0.27 : module === "accounts" ? 0.56 : 0.57) * 100}%`,
                } as CSSProperties
              }
              aria-label={`${label.label} ${moduleCount(module)}，${moduleDetail(module)}`}
              onPointerEnter={() => setHovered(module)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(module)}
              onBlur={() => setHovered(null)}
              onClick={() => dispatch({ type: "module", module })}
            >
              <span className={styles.satelliteHit} aria-hidden="true" />
              <span className={styles.satelliteCard} data-satellite-card>
                <span className={styles.satelliteMetric}>
                  <Icon size={14} strokeWidth={1.5} />
                  <strong>{moduleCount(module)}</strong>
                  <ArrowRight size={12} />
                </span>
                <Bilingual label={label.label} english={label.english} />
                <span className={styles.satelliteDetail}>
                  {moduleDetail(module)}
                </span>
              </span>
            </button>
          );
        })}
        {state.module ? (
          <>
            <svg
              className={styles.umbrella}
              aria-hidden="true"
              style={
                {
                  "--module-color": neuralCssColor(state.module),
                } as CSSProperties
              }
            >
              <defs>
                <linearGradient id="umbrella-light">
                  <stop stopColor="var(--module-color)" stopOpacity=".14" />
                  <stop
                    offset="1"
                    stopColor="var(--module-color)"
                    stopOpacity=".8"
                  />
                </linearGradient>
              </defs>
              {[...items, { id: "__new", title: "", detail: "" }].map(
                (item, i) => (
                  <g
                    key={`${state.module}:${item.id}`}
                    data-active={
                      state.itemId === item.id || hoveredItem === item.id
                    }
                    style={{ "--curve-delay": `${i * 12}ms` } as CSSProperties}
                  >
                    <path
                      id={`curve-${state.module}-${i}`}
                      ref={(node) => {
                        if (node) paths.current.set(item.id, node);
                        else paths.current.delete(item.id);
                      }}
                      pathLength={1}
                    />
                    <circle r="2.4">
                      <animateMotion
                        dur={`${4 + (i % 4)}s`}
                        repeatCount="indefinite"
                        keyPoints="0;1;0"
                        keyTimes="0;0.5;1"
                        calcMode="linear"
                      >
                        <mpath href={`#curve-${state.module}-${i}`} />
                      </animateMotion>
                    </circle>
                  </g>
                ),
              )}
            </svg>
            <section
              className={styles.moduleList}
              data-inspecting={state.level === "item"}
              aria-label={WORKSPACE_MODULES[state.module].label}
            >
              <div className={styles.moduleHeading}>
                <h2>
                  {state.module === "canvases"
                    ? "我的画布"
                    : WORKSPACE_MODULES[state.module].label}
                  <small>{WORKSPACE_MODULES[state.module].english}</small>
                </h2>
                <span>{items.length.toString().padStart(2, "0")}</span>
              </div>
              {state.module === "canvases" ? (
                <div className={styles.listTools}>
                  <label className={styles.projectSearch}>
                    <Search size={13} />
                    <input
                      aria-label="搜索画布"
                      placeholder="筛选画布…"
                      value={projectQuery}
                      onChange={(e) => setProjectQuery(e.target.value)}
                    />
                    {projectQuery ? (
                      <button
                        aria-label="清空搜索"
                        onClick={() => setProjectQuery("")}
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </label>
                  <label className={styles.sort}>
                    <ArrowDownWideNarrow size={13} />
                    <select
                      aria-label="画布排序"
                      value={order}
                      onChange={(e) => {
                        setOrder(e.target.value as WorkspaceSort);
                        savePreference(SORT_KEY, e.target.value);
                      }}
                    >
                      <option value="recent">最近编辑</option>
                      <option value="created">最新创建</option>
                      <option value="name">名称排序</option>
                    </select>
                  </label>
                  <div
                    className={styles.viewToggle}
                    role="group"
                    aria-label="画布显示方式"
                  >
                    <button
                      aria-label="网格视图"
                      aria-pressed={view === "grid"}
                      onClick={() => {
                        setView("grid");
                        savePreference(VIEW_KEY, "grid");
                      }}
                    >
                      <Grid2X2 size={13} />
                    </button>
                    <button
                      aria-label="列表视图"
                      aria-pressed={view === "list"}
                      onClick={() => {
                        setView("list");
                        savePreference(VIEW_KEY, "list");
                      }}
                    >
                      <List size={14} />
                    </button>
                  </div>
                </div>
              ) : null}
              <div
                ref={list}
                className={styles.items}
                onScroll={measureCurves}
                data-view={state.module === "canvases" ? view : "list"}
              >
                {items.map((item) => (
                  <article
                    key={item.id}
                    aria-label={item.title}
                    className={styles.item}
                    data-selected={state.itemId === item.id}
                    ref={(node) => {
                      if (node) rows.current.set(item.id, node);
                      else rows.current.delete(item.id);
                    }}
                    style={
                      {
                        "--module-color": neuralCssColor(state.module!),
                      } as CSSProperties
                    }
                    onMouseEnter={() => setHoveredItem(item.id)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <button
                      data-testid={`neural-item-${item.id}`}
                      aria-label={`查看${item.title}`}
                      onFocus={() => setHoveredItem(item.id)}
                      onBlur={() => setHoveredItem(null)}
                      onClick={(event) =>
                        selectItem(item.id, event.currentTarget)
                      }
                    >
                      <span className={styles.endpoint} />
                      {state.module === "canvases" && view === "grid" ? (
                        <span className={styles.itemCover}>
                          <ProjectCover
                            project={visibleProjects.find(
                              (p) => p.id === item.id,
                            )!}
                          />
                        </span>
                      ) : null}
                      <span className={styles.itemCopy}>
                        <strong title={item.title}>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <ChevronRight size={13} />
                    </button>
                  </article>
                ))}
                {!items.length ? (
                  <p className={styles.empty}>
                    {state.module === "canvases" && projectQuery
                      ? "没有找到匹配的画布"
                      : `这里还没有${WORKSPACE_MODULES[state.module].label}`}
                    <small>SPACE FOR SOMETHING NEW</small>
                  </p>
                ) : null}
                <div
                  ref={(node) => {
                    if (node) rows.current.set("__new", node);
                    else rows.current.delete("__new");
                  }}
                  className={styles.ghostEntry}
                >
                  <button
                    onClick={addEntry}
                    aria-label={
                      state.module === "suppliers"
                        ? "添加供应商"
                        : state.module === "accounts"
                          ? "连接账号"
                          : "新建空白画布"
                    }
                  >
                    <span>
                      <Plus size={15} />
                    </span>
                    {state.module === "suppliers"
                      ? "添加供应商"
                      : state.module === "accounts"
                        ? "连接账号"
                        : "新建画布"}
                    <small>CREATE A CONNECTION</small>
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : null}
        {state.level === "item" && selectedTitle ? (
          <SpringInspector
            motion={motion}
            key={`${state.module}:${state.itemId}`}
          >
            <header className={styles.inspectorHeader}>
              <Bilingual label="条目分析" english="OVERVIEW" />
              <button
                className={styles.iconButton}
                aria-label="关闭分析面板"
                onClick={goBack}
              >
                <X size={17} />
              </button>
            </header>
            <div className={styles.inspectorBody}>
              <div className={styles.inspectorTitle}>
                <span className={styles.eyebrow}>
                  {WORKSPACE_MODULES[state.module].english}
                </span>
                <h2>{selectedTitle}</h2>
              </div>
              {selectedProject ? (
                <>
                  <div className={styles.cover}>
                    <ProjectCover project={selectedProject} />
                  </div>
                  <section>
                    <h3>
                      <Bilingual label="画布概览" english="CANVAS DETAILS" />
                    </h3>
                    <dl className={styles.statsGrid}>
                      {selectedProject.nodeCount !== undefined ? (
                        <div>
                          <dt>节点 NODES</dt>
                          <dd>{workspaceCount(selectedProject.nodeCount)}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>最近编辑 UPDATED</dt>
                        <dd className={styles.date}>
                          {dateLabel(selectedProject.updatedAt)}
                        </dd>
                      </div>
                      <div>
                        <dt>创建时间 CREATED</dt>
                        <dd className={styles.date}>
                          {dateLabel(selectedProject.createdAt)}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <button
                    className={styles.primaryButton}
                    onClick={() => openCanvas(selectedProject.id)}
                    disabled={departing}
                  >
                    打开画布
                    <ArrowRight size={15} />
                  </button>
                  <div className={styles.inspectorActions}>
                    <button
                      onClick={() =>
                        setDialog({ kind: "rename", project: selectedProject })
                      }
                    >
                      <Pencil size={14} />
                      重命名
                    </button>
                    <button
                      onClick={() =>
                        void openProjectFolder(selectedProject.id).catch(
                          (error) =>
                            setNotice({
                              message:
                                error instanceof Error
                                  ? error.message
                                  : "打开文件夹失败",
                              error: true,
                            }),
                        )
                      }
                    >
                      <FolderOpen size={14} />
                      打开文件夹
                    </button>
                    <button
                      className={styles.dangerText}
                      onClick={() =>
                        setDialog({ kind: "delete", project: selectedProject })
                      }
                    >
                      <Trash2 size={14} />
                      删除画布
                    </button>
                  </div>
                </>
              ) : null}
              {selectedSupplier ? (
                <>
                  <span className={styles.statusChip}>
                    <span />
                    {selectedSupplier.status}
                  </span>
                  {selectedSupplier.balance !== "—" ? (
                    <section className={styles.balance}>
                      <h3>
                        <Bilingual
                          label="已存余额"
                          english="BALANCE SNAPSHOT"
                        />
                      </h3>
                      <strong>{selectedSupplier.balance}</strong>
                    </section>
                  ) : null}
                  <section>
                    <h3>
                      <Bilingual label="分组与型号" english="MODEL DIRECTORY" />
                    </h3>
                    <div className={styles.modelGroups}>
                      {selectedSupplier.groups.map((group) => (
                        <div key={group.id}>
                          <h4>
                            {group.label}
                            <span>{group.models.length}</span>
                          </h4>
                          {group.models.map((model) => (
                            <div
                              key={model.id}
                              className={styles.modelChip}
                              title={modelPickerPriceData(model.descriptor)}
                            >
                              <span>{model.id}</span>
                              <small>
                                {modelPickerPriceCompact(model.descriptor)}
                              </small>
                            </div>
                          ))}
                        </div>
                      ))}
                      {!selectedSupplier.groups.length ? (
                        <p className={styles.muted}>—</p>
                      ) : null}
                    </div>
                  </section>
                  <section>
                    <h3>
                      <Bilingual
                        label="最后保存的刷新"
                        english="LAST SAVED REFRESH"
                      />
                    </h3>
                    <p className={styles.muted}>
                      {dateLabel(selectedSupplier.refreshedAt)}
                    </p>
                  </section>
                  <button
                    className={styles.primaryButton}
                    onClick={() =>
                      setSettings({
                        initialTab: "suppliers",
                        targetSupplierId: selectedSupplier.id,
                      })
                    }
                  >
                    管理连接
                    <ArrowRight size={15} />
                  </button>
                  {selectedSupplier.siteUrl &&
                  /^https?:\/\//iu.test(selectedSupplier.siteUrl) ? (
                    <a
                      className={styles.website}
                      href={selectedSupplier.siteUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开官网
                      <ExternalLink size={13} />
                    </a>
                  ) : null}
                </>
              ) : null}
              {selectedAccount ? (
                <>
                  <span
                    className={styles.statusChip}
                    data-ready={selectedAccount.ready}
                  >
                    <span />
                    {selectedAccount.status}
                  </span>
                  <section>
                    <h3>
                      <Bilingual label="已同步型号" english="SAVED MODELS" />
                    </h3>
                    <div className={styles.modelGroups}>
                      {selectedAccount.models.map((model) => (
                        <div className={styles.modelChip} key={model.id}>
                          <span>{model.id}</span>
                          <small title={modelPickerPriceData(model)}>
                            {modelPickerPriceCompact(model)}
                          </small>
                        </div>
                      ))}
                      {!selectedAccount.models.length ? (
                        <p className={styles.muted}>—</p>
                      ) : null}
                    </div>
                  </section>
                  <button
                    className={styles.primaryButton}
                    onClick={() =>
                      setSettings({
                        initialTab: "personal-ai",
                        targetConnectionId: selectedAccount.id,
                      })
                    }
                  >
                    打开设置
                    <ArrowRight size={15} />
                  </button>
                </>
              ) : null}
              {selectedStart ? (
                <>
                  <div className={styles.startIllustration}>
                    <Sparkles size={45} strokeWidth={0.75} />
                  </div>
                  <section>
                    <h3>
                      <Bilingual label="创作起点" english="START SOMETHING" />
                    </h3>
                    <p className={styles.muted}>{selectedStart.description}</p>
                  </section>
                  <button
                    className={styles.primaryButton}
                    aria-label={selectedStart.title}
                    disabled={Boolean(starting) || departing}
                    onClick={() => void startTask(selectedStart.id)}
                  >
                    {starting ? (
                      <LoaderCircle size={15} className={styles.spinning} />
                    ) : (
                      <Plus size={15} />
                    )}
                    {selectedStart.id === "blank" ? "创建画布" : "开始创作"}
                    <ArrowRight size={15} />
                  </button>
                </>
              ) : null}
            </div>
            <footer className={styles.inspectorFooter}>
              <span />
              YOUR SPACE, YOUR POSSIBILITIES
            </footer>
          </SpringInspector>
        ) : null}
        <div className={styles.dockRegion} data-compact={state.level !== "hub"}>
          {searchOpen && query.trim() ? (
            <section
              className={styles.searchPanel}
              data-testid="graph-results"
              aria-label="图谱检索"
            >
              <header>
                <Bilingual label="图谱检索" english="GRAPH SEARCH" />
                <span aria-live="polite">{results.length} 个结果</span>
                <button
                  className={styles.iconButton}
                  aria-label="关闭检索"
                  onClick={closeSearch}
                >
                  <X size={14} />
                </button>
              </header>
              <div
                className={styles.searchResults}
                id="graph-search-results"
                role="listbox"
                aria-label="检索结果"
              >
                {NEURAL_MODULES.map((module) => {
                  const group = results.filter((r) => r.module === module);
                  return group.length ? (
                    <div
                      key={module}
                      role="group"
                      aria-label={WORKSPACE_MODULES[module].label}
                    >
                      <h3 style={{ color: neuralCssColor(module) }}>
                        <Bilingual
                          label={WORKSPACE_MODULES[module].label}
                          english={WORKSPACE_MODULES[module].english}
                        />
                      </h3>
                      {group.map((result) => (
                        <button
                          key={result.id}
                          id={`search-${index.indexOf(result)}`}
                          role="option"
                          aria-selected={
                            results[activeResult]?.id === result.id
                          }
                          onMouseEnter={() =>
                            setActiveResult(results.indexOf(result))
                          }
                          onClick={() => selectResult(result)}
                        >
                          <span>
                            <strong>{result.title}</strong>
                            <small>{result.detail}</small>
                          </span>
                          <ArrowRight size={13} />
                        </button>
                      ))}
                    </div>
                  ) : null;
                })}
                {!results.length ? (
                  <p className={styles.noResults}>
                    没有找到相关内容。也可以把想法带到创作助手。
                  </p>
                ) : null}
              </div>
              <button
                className={styles.assistantLink}
                disabled={Boolean(starting)}
                onClick={() => void startTask("chat", query)}
              >
                <MessageCircle size={15} />
                <span>
                  交给创作助手<small>草稿预填 · 由你发送</small>
                </span>
                <ArrowRight size={15} />
              </button>
            </section>
          ) : null}
          <div className={styles.dock}>
            <dl className={styles.dockStats} aria-label="工作空间数据">
              {(
                [
                  ["canvases", "画布", "CANVASES"],
                  ["nodes", "节点", "NODES"],
                  ["suppliers", "供应商", "SUPPLIERS"],
                  ["models", "可用型号", "MODELS"],
                ] as const
              ).map(([key, label, english]) => (
                <div
                  key={key}
                  data-workspace-stat={key === "canvases" ? "projects" : key}
                >
                  <dt>
                    <Bilingual label={label} english={english} />
                  </dt>
                  <dd>{workspaceCount(data.counts[key])}</dd>
                </div>
              ))}
            </dl>
            <form
              className={styles.graphSearch}
              onSubmit={(event) => {
                event.preventDefault();
                if (results[activeResult]) selectResult(results[activeResult]);
                else setSearchOpen(true);
              }}
            >
              <Search size={15} />
              <input
                ref={search}
                data-testid="graph-search"
                role="combobox"
                aria-label="搜索创作空间"
                aria-expanded={searchOpen && Boolean(query.trim())}
                aria-controls="graph-search-results"
                aria-autocomplete="list"
                aria-activedescendant={
                  searchOpen && results[activeResult]
                    ? `search-${index.indexOf(results[activeResult])}`
                    : undefined
                }
                placeholder="问问你的创作空间… Ask your studio"
                value={query}
                autoComplete="off"
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229)
                    return;
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setSearchOpen(true);
                    setActiveResult((current) =>
                      results.length
                        ? (current +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            results.length) %
                          results.length
                        : 0,
                    );
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeSearch();
                  }
                }}
              />
              <button type="submit" aria-label="检索创作空间">
                <ArrowRight size={16} />
              </button>
            </form>
          </div>
          <div className={styles.suggestions}>
            {(projects?.length ? ["最近编辑的画布"] : []).map((label) => (
              <button
                key={label}
                onClick={() => {
                  dispatch({ type: "module", module: "canvases" });
                  setOrder("recent");
                  setProjectQuery("");
                }}
              >
                {label}
                <ArrowRight size={10} />
              </button>
            ))}
            {index.some((e) => e.terms?.includes("图片型号")) ? (
              <button
                onClick={() => {
                  setQuery("图片型号");
                  setSearchOpen(true);
                  search.current?.focus();
                }}
              >
                图片型号
                <ArrowRight size={10} />
              </button>
            ) : null}
            {data.accounts.some((a) => !a.ready) ? (
              <button
                onClick={() => {
                  setQuery("未就绪的账号");
                  setSearchOpen(true);
                  search.current?.focus();
                }}
              >
                未就绪的账号
                <ArrowRight size={10} />
              </button>
            ) : null}
            <button
              onClick={() => void startTask("chat")}
              disabled={Boolean(starting)}
            >
              聊聊创作想法
              <ArrowRight size={10} />
            </button>
          </div>
        </div>
        <details className={styles.legend}>
          <summary>
            图谱图例<span>LEGEND</span>
            <Plus size={12} />
          </summary>
          <div>
            {NEURAL_MODULES.map((module) => (
              <p key={module}>
                <i style={{ background: neuralCssColor(module) }} />
                <Bilingual
                  label={WORKSPACE_MODULES[module].label}
                  english={WORKSPACE_MODULES[module].english}
                />
              </p>
            ))}
            <p>
              <span className={styles.legendLine} />
              归属<small>OWNERSHIP</small>
            </p>
            <p>
              <span className={styles.legendReference} />
              引用<small>REFERENCE</small>
            </p>
          </div>
        </details>
        {errors.length ? (
          <div className={styles.readError} role="alert">
            {errors.join("；")}
            <button onClick={() => void load()}>重新加载</button>
          </div>
        ) : null}
      </main>
      <div className={styles.wordmark} aria-hidden="true">
        SUPER<span>CANVAS</span>
      </div>
      <div className={styles.workspaceStatus}>
        <span />
        本地创作空间<small>LOCAL STUDIO</small>
      </div>
      <div className={styles.departureFlash} aria-hidden="true" />
      {notice ? (
        <div
          className={`${styles.toast} ${notice.error ? styles.toastError : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.message}
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
      {settings ? (
        <SettingsModal
          surface="workspace"
          {...settings}
          open
          onClose={() => {
            setSettings(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
