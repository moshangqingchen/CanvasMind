"use client";

import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ImageEditingCapabilities } from "@super-canvas/providers/image-editing-capabilities";
import { cleanModelDisplayName } from "../lib/model-display";
import { modelCanvasUnavailableReason } from "../lib/graph-ui";
import { displayPickerModels, filterPickerModels, MODEL_PICKER_PAGE_SIZE, readRecentModels, RECENT_MODELS_KEY, rememberModel,
  type ModelKindFilter, type ModelStatusFilter } from "../lib/model-picker";
import styles from "./model-picker.module.css";
import { groupTk1688Models, tk1688ModelFamily, tk1688RouteLabel, tk1688RouteSummary } from "../lib/tk1688-model-display";
import type { CatalogPickerDirectory } from "../lib/supplier-model-directory-diff";
import { modelPickerDirectoryFact, modelPickerPriceCompact, modelPickerStructuredPrice, modelPriceHasDetails } from "../lib/model-picker-data";
import { imageTransparencyEvidenceNote } from "../lib/image-transparency-presentation";
import { WindowedModelList, type ModelListMeasurements } from "./model-picker-window";
import { ModelPriceTable } from "./model-price-table";
import { ModelPriceCompact } from "./model-price-compact";
import { DirectoryComparisonStats } from "./information-layout";

type PickerOption = { id: string; model?: ModelDescriptor; label: string; reason: string | null; family?: string; merchants?: number };

const ModelIdentity = memo(function ModelIdentity({ model, capabilities, price = false, detailsId, route = false, keyConfirmed = false, inlineChevron = false }: { model: ModelDescriptor; capabilities?: ImageEditingCapabilities; price?: boolean; detailsId?: string; route?: boolean; keyConfirmed?: boolean; inlineChevron?: boolean }) {
  const family = tk1688ModelFamily(model);
  const directory = modelPickerDirectoryFact(model, keyConfirmed);
  const compactPrice = useMemo(() => price ? modelPickerPriceCompact(model) : undefined, [price, model]);
  return <span className={styles.identity}>
    <span className={styles.heading}>
      <span className={inlineChevron ? styles.nameWithChevron : undefined}>
        <span id={detailsId ? `${detailsId}-name` : undefined} className={styles.name}>{family ? route ? tk1688RouteLabel(model) : family : cleanModelDisplayName(model.name, model.metadata?.priceLabel)}</span>
        {inlineChevron && <ChevronDown size={15} aria-hidden="true" />}
      </span>
      {(capabilities?.transparent || capabilities?.mask) && <span id={detailsId ? `${detailsId}-capabilities` : undefined} className={styles.capabilities}>
        {capabilities.transparent && <span className={`${styles.capability} ${styles.transparent}`} title={imageTransparencyEvidenceNote(capabilities.transparency) ?? "支持透明 PNG 输出"}>可透明</span>}
        {capabilities.mask && <span className={`${styles.capability} ${styles.editable}`} title="支持涂抹蒙版、局部修改">可编辑</span>}
      </span>}
    </span>
    {family && !route && <span id={detailsId ? `${detailsId}-route` : undefined} className={styles.route}>{tk1688RouteLabel(model)}</span>}
    <span id={detailsId ? `${detailsId}-id` : undefined} className={styles.id} title={model.id}>ID: {model.id}</span>
    {route && <span id={detailsId ? `${detailsId}-summary` : undefined} className={styles.summary}>{tk1688RouteSummary(model)}</span>}
    {price && <span id={detailsId ? `${detailsId}-price` : undefined} className={styles.price}><ModelPriceCompact label={compactPrice} /></span>}
    {directory && <span id={detailsId ? `${detailsId}-directory` : undefined} className={styles.summary}>{directory}</span>}
  </span>;
});

export function ModelPicker({ id, label, connectionId, models, value, onChange, capabilities = {},
  open: controlledOpen, onOpenChange, anchorKey, loading = false, failed = false, authoritative = true, allowManual = false, badge, catalogDirectory, allowAutomatic = true, preferSidePlacement = false, inlineChevron = false,
}: {
  id?: string; label: string; connectionId: string; models: readonly ModelDescriptor[]; value: string;
  onChange: (modelId: string) => void; open?: boolean;
  onOpenChange?: (open: boolean) => void; anchorKey?: string; loading?: boolean; failed?: boolean;
  authoritative?: boolean; allowManual?: boolean; badge?: (model: ModelDescriptor) => ReactNode;
  capabilities?: Readonly<Record<string, ImageEditingCapabilities>>;
  catalogDirectory?: CatalogPickerDirectory;
  allowAutomatic?: boolean;
  /** Keep this inspector's other controls reachable when the model is first. */
  preferSidePlacement?: boolean;
  /** Keep the selected name and its chevron together inside one trigger. */
  inlineChevron?: boolean;
}) {
  const generatedId = useId();
  const listId = `${id ?? generatedId}-options`;
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ModelKindFilter>("all");
  const [status, setStatus] = useState<ModelStatusFilter>("all");
  const [family, setFamily] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listMeasurements = useRef<ModelListMeasurements>({ width: 0, viewportHeight: 480, heights: new Map() });
  const menu = useRef<HTMLDivElement>(null);
  const selected = models.find(model => model.id === value);
  // A closed trigger only needs the selected model. Defer catalog-wide display,
  // grouping and filtering work until its menu is actually requested.
  const displayModels = useMemo(() => open ? displayPickerModels(models, catalogDirectory?.models) : [], [open, models, catalogDirectory?.models]);
  const filtered = useMemo(() => open ? filterPickerModels(displayModels, query, kind, status, recentIds) : [], [open, displayModels, query, kind, status, recentIds]);
  const grouped = useMemo(() => open && displayModels.some(model => tk1688ModelFamily(model)), [open, displayModels]);
  const hasFilters = Boolean(query.trim()) || kind !== "all" || status !== "all";
  const options = useMemo<PickerOption[]>(() => {
    if (!open) return [];
    const automatic: PickerOption[] = allowAutomatic && !hasFilters && !family ? [{ id: "", label: "自动模型", reason: null }] : [];
    if (!grouped) return [...automatic, ...filtered.map(model => ({ id: model.id, model,
      label: cleanModelDisplayName(model.name, model.metadata?.priceLabel), reason: modelCanvasUnavailableReason(model) }))];
    if (family) return groupTk1688Models(filtered).find(group => group.id === family)?.models.map(model => ({
      id: model.id, model, label: tk1688RouteLabel(model)!, reason: modelCanvasUnavailableReason(model),
    })) ?? [];
    return [...automatic, ...groupTk1688Models(filtered).map(group => ({ id: `family:${group.id}`, family: group.id,
      label: group.id, merchants: group.merchants.length, reason: null })),
      ...filtered.filter(model => !tk1688ModelFamily(model)).map(model => ({ id: model.id, model,
        label: cleanModelDisplayName(model.name, model.metadata?.priceLabel), reason: modelCanvasUnavailableReason(model) }))];
  }, [open, filtered, hasFilters, family, grouped, allowAutomatic]);
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const page = Math.floor(activeIndex / MODEL_PICKER_PAGE_SIZE);
  const pageStart = page * MODEL_PICKER_PAGE_SIZE;
  const visible = useMemo(() => options.slice(pageStart, pageStart + MODEL_PICKER_PAGE_SIZE), [options, pageStart]);
  // Resolve this once per page, rather than recomputing tariffs in every row
  // on hover. Reserve the same menu geometry for single-price candidates too.
  const pageHasPriceDetails = useMemo(() => visible.some(option => option.model && modelPriceHasDetails(modelPickerStructuredPrice(option.model))), [visible]);
  const previewModel = options[activeIndex]?.model;
  const previewPrice = useMemo(() => modelPickerStructuredPrice(previewModel), [previewModel]);
  const showPricePreview = Boolean(previewModel && modelPriceHasDetails(previewPrice));
  const setOpen = (next: boolean, restoreFocus = false) => {
    setLocalOpen(next);
    onOpenChange?.(next);
    if (!next && restoreFocus) trigger.current?.focus();
    if (next) {
      try { setRecentIds(readRecentModels(localStorage.getItem(RECENT_MODELS_KEY)).find(item => item.connectionId === connectionId)?.modelIds ?? []); } catch { setRecentIds([]); }
      setQuery(""); setKind("all"); setStatus("all"); setFamily(null);
      // This click still sees the closed render. Resolve the same display list
      // here so the current row/family is active on the very first open.
      const openingModels = open ? displayModels : displayPickerModels(models, catalogDirectory?.models);
      const openingGrouped = open ? grouped : openingModels.some(model => tk1688ModelFamily(model));
      const index = openingModels.findIndex(model => model.id === value);
      if (openingGrouped && index >= 0) {
        const groups = groupTk1688Models(openingModels);
        const selectedFamily = selected && tk1688ModelFamily(selected);
        const groupedIndex = selectedFamily ? groups.findIndex(group => group.id === selectedFamily)
          : groups.length + openingModels.filter(model => !tk1688ModelFamily(model)).findIndex(model => model.id === value);
        setActive(groupedIndex + (allowAutomatic ? 1 : 0));
      } else setActive(index < 0 ? 0 : index + (allowAutomatic ? 1 : 0));
    }
  };
  const choose = (modelId: string) => {
    if (modelId && !models.some(model => model.id === modelId) && displayModels.some(model => model.id === modelId && model.metadata?.publicCatalogOnly === true)) return;
    if (modelId && connectionId) {
      try { localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(rememberModel(readRecentModels(localStorage.getItem(RECENT_MODELS_KEY)), connectionId, modelId))); } catch { /* Storage can be disabled; choosing a model still works. */ }
    }
    onChange(modelId);
    setOpen(false, true);
  };
  const activate = (option: typeof options[number]) => {
    if (option.family) {
      const routes = groupTk1688Models(filtered).find(group => group.id === option.family)?.models ?? [];
      setFamily(option.family); setActive(Math.max(0, routes.findIndex(model => model.id === value)));
    }
    else if (!option.reason) choose(option.id);
  };
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const panel = menu.current;
    // The browser's top layer escapes the node panel's clipping while keeping
    // DOM ancestry, keyboard handling and accessible labels inside that panel.
    if (!panel.matches(":popover-open")) panel.showPopover();
    const position = () => {
      const listScrollTop = list.current?.scrollTop ?? 0;
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const visualLeft = viewport?.offsetLeft ?? 0;
      const visualTop = viewport?.offsetTop ?? 0;
      const inspectorElement = host.current?.closest(".node-config-popover");
      const canvas = inspectorElement?.closest(".canvas-wrap")?.getBoundingClientRect();
      const rail = inspectorElement?.closest(".canvas-editor")?.querySelector(".editor-rail")?.getBoundingClientRect();
      // Top-layer menus must respect the same canvas tools as their inspector,
      // including when a window resize moves the inspector to the node's side.
      const left = Math.max(visualLeft + 12, canvas ? canvas.left + 8 : -Infinity,
        rail && rail.width > 0 && rail.height > 0 ? rail.right + 8 : -Infinity);
      const top = Math.max(visualTop + 12, canvas ? canvas.top + 8 : -Infinity);
      const right = Math.min(visualLeft + (viewport?.width ?? window.innerWidth) - 12,
        canvas ? canvas.right - 8 : Infinity);
      const bottom = Math.min(visualTop + (viewport?.height ?? window.innerHeight) - 12,
        canvas ? canvas.bottom - 8 : Infinity);
      if (right <= left || bottom <= top) return;
      const gap = 8;
      const viewportHeight = bottom - top;
      // A stable preview viewport lets neighboring multi-tier candidates share
      // the same list geometry, independent of their tariff table's row count.
      const previewHeight = Math.min(220, Math.max(64, viewportHeight * .28));
      panel.style.setProperty("--price-preview-height", `${previewHeight}px`);
      const below = Math.max(0, bottom - rect.bottom - gap);
      const above = Math.max(0, rect.top - top - gap);
      const inspector = inspectorElement?.getBoundingClientRect();
      let width = Math.min(Math.max(360, rect.width), right - left);
      const measureHeight = () => {
        // Measure at the final width, including rows hidden by list scrolling.
        // Short catalogs expand completely; only the viewport limits long ones.
        panel.style.width = `${width}px`;
        panel.style.height = "auto";
        // Clear the previous placement's cap before measuring. Flex shrink can
        // otherwise hide part of the new preview from the intrinsic height,
        // leaving a short catalog clipped even with ample viewport space.
        panel.style.maxHeight = `${viewportHeight}px`;
        const preview = panel.querySelector<HTMLElement>("[data-price-preview]");
        return Math.min(viewportHeight, panel.offsetHeight + Math.max(0, panel.scrollHeight - panel.clientHeight)
          + (list.current ? list.current.scrollHeight - list.current.clientHeight : 0)
          + (preview ? Math.max(0, previewHeight - preview.offsetHeight) : pageHasPriceDetails ? previewHeight + 8 : 0));
      };
      let height = measureHeight();
      let x = Math.max(left, Math.min(rect.left, right - width));
      let y = rect.bottom + gap;
      const rightSpace = inspector ? right - inspector.right - gap : 0;
      const leftSpace = inspector ? inspector.left - left - gap : 0;
      const sideSpace = Math.max(rightSpace, leftSpace);
      if (inspector && (preferSidePlacement || below < height) && sideSpace >= 280) {
        // Beside the inspector, the full viewport height is available and the
        // inspector's other controls remain directly clickable.
        width = Math.min(width, sideSpace);
        height = measureHeight();
        x = rightSpace >= leftSpace ? inspector.right + gap : inspector.left - gap - width;
        y = Math.max(top, Math.min(rect.top, bottom - height));
      } else if (!inspector && below < height && above > below) {
        height = Math.min(height, above);
        y = rect.top - gap - height;
      } else {
        // Reserve the filters/footer plus at least one complete option when
        // the viewport is too narrow to place the menu beside the inspector.
        const rows = list.current;
        const rowHeight = Math.max(44, ...Array.from(rows?.querySelectorAll('[role="option"]') ?? [], row => row.getBoundingClientRect().height));
        const chromeHeight = panel.offsetHeight + Math.max(0, panel.scrollHeight - panel.clientHeight) - (rows?.clientHeight ?? 0);
        const minimumHeight = Math.min(height, Math.max(160, chromeHeight + rowHeight));
        y = Math.max(top, Math.min(y, bottom - minimumHeight));
        height = Math.min(height, bottom - y);
      }
      panel.style.maxHeight = `${height}px`;
      // Hiding the preview for a single quote must not move the candidate
      // underneath the pointer, including menus placed above their trigger.
      panel.style.height = pageHasPriceDetails ? `${height}px` : "auto";
      panel.style.left = `${Math.max(left, Math.min(x, right - width))}px`;
      panel.style.top = `${y}px`;
      // Intrinsic measurement briefly expands the list and can clamp its
      // scrollTop to zero. Keep the keyboard/user's position when it shrinks.
      if (list.current) list.current.scrollTop = listScrollTop;
    };
    position();
    const inspector = host.current?.closest(".node-config-popover");
    inspector?.addEventListener("canvas-node-config-position", position);
    inspector?.addEventListener("animationend", position);
    const rows = list.current;
    rows?.addEventListener("canvas-model-list-size", position);
    const repositionAfterScroll = (event: Event) => {
      // Scrolling the windowed list changes neither its anchor nor the menu's
      // available viewport. Avoid synchronously measuring the whole popover.
      if (event.target instanceof Node && panel.contains(event.target)) return;
      position();
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", repositionAfterScroll, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      inspector?.removeEventListener("canvas-node-config-position", position);
      inspector?.removeEventListener("animationend", position);
      rows?.removeEventListener("canvas-model-list-size", position);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", repositionAfterScroll, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, options, page, anchorKey, showPricePreview, pageHasPriceDetails, preferSidePlacement]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) {
        setLocalOpen(false); onOpenChange?.(false);
      }
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, onOpenChange]);
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false, true); return; }
    if (event.target instanceof Element && event.target.closest("[data-price-preview]")) return;
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement && event.target !== trigger.current) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (!open) { setOpen(true); return; }
    if (event.key === "Enter") { const option = options[activeIndex]; if (option) activate(option); }
    else setActive(event.key === "Home" ? 0 : event.key === "End" ? Math.max(0, options.length - 1) :
      Math.min(Math.max(0, options.length - 1), Math.max(0, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
  };
  return <div ref={host} className={`node-model-select ${styles.picker}`} data-open={open || undefined} onKeyDown={keyDown}
    onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button id={id} ref={trigger} type="button" className={`node-model-select-trigger ${styles.trigger}`} role="combobox"
      aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-describedby={selected ? `${listId}-selected-name ${listId}-selected-id${tk1688ModelFamily(selected) ? ` ${listId}-selected-route` : ""}${capabilities[selected.id]?.transparent || capabilities[selected.id]?.mask ? ` ${listId}-selected-capabilities` : ""}` : undefined}
      title={selected ? `${cleanModelDisplayName(selected.name, selected.metadata?.priceLabel)} · ${selected.id}` : value || "自动模型"}
      onClick={() => setOpen(!open)}>
      {selected ? <ModelIdentity model={selected} capabilities={capabilities[selected.id]} detailsId={`${listId}-selected`} inlineChevron={inlineChevron} /> : <span className={inlineChevron ? styles.nameWithChevron : undefined}>{value || "自动模型"}{inlineChevron && <ChevronDown size={15} aria-hidden="true" />}</span>}
      {selected && badge?.(selected)}{!inlineChevron && <ChevronDown size={15} aria-hidden="true" />}
    </button>
    {value && !selected && <p className={styles.note} role="status">保留当前模型 {value}：{loading ? "正在扫描模型…" : failed ? "本次模型扫描失败" : authoritative ? "本次目录返回：0 条匹配" : "本次目录响应：—"}。请选择后才会更换。</p>}
    {open && <div ref={menu} popover="manual" className={`node-model-select-options ${styles.menu}`}
      style={{ position: "fixed", inset: "auto", margin: 0, display: "flex" }}>
      {grouped && <div className={styles.routingHeading}>
        {family ? <><button type="button" onClick={() => { setFamily(null); setQuery(""); setActive(0); search.current?.focus(); }}>返回模型</button><strong>{family}</strong></>
          : <span>先选模型，再选自动路由或商家渠道</span>}
      </div>}
      <div className={styles.filters}>
        <input ref={search} role="combobox" aria-label="搜索模型名称或 ID" placeholder={grouped ? "搜索模型、商家、4K 或超分说明" : "搜索模型名称或 ID"} aria-autocomplete="list"
          aria-expanded="true" aria-controls={listId} aria-activedescendant={options.length ? `${listId}-${activeIndex}` : undefined}
          value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} />
        <select aria-label="模型类型筛选" value={kind} onChange={event => { setKind(event.target.value as ModelKindFilter); setActive(0); }}>
          <option value="all">全部类型</option><option value="image">图像</option><option value="video">视频</option><option value="music">音乐</option>
        </select>
        <select aria-label="模型状态筛选" value={status} onChange={event => { setStatus(event.target.value as ModelStatusFilter); setActive(0); }}>
          <option value="all">全部模型</option><option value="runnable">可运行</option><option value="verified">已实测</option><option value="recent">最近选择</option>
        </select>
      </div>
      {catalogDirectory && <div className={styles.directorySummary} role="status">
        <DirectoryComparisonStats catalog={catalogDirectory.catalogCount} keyCount={catalogDirectory.keyConfirmed ? catalogDirectory.keyCount : "—"}
          shared={catalogDirectory.keyConfirmed ? catalogDirectory.sharedCount : "—"} catalogOnly={catalogDirectory.keyConfirmed ? catalogDirectory.catalogOnlyIds.length : "—"} />
        {catalogDirectory.catalogStale && <span>官网目录为上次记录</span>}
      </div>}
      <WindowedModelList rows={visible} pageStart={pageStart} activeIndex={activeIndex} listRef={list} measurements={listMeasurements} id={listId} label={`${label} 可选模型`}
        emptyMessage={`没有符合筛选条件的${family ? "线路" : "模型"}。可清空搜索或调整筛选。`}
        renderRow={(option, index, style) => <button key={option.id} id={`${listId}-${index}`} style={style} type="button" role="option"
          aria-label={option.label} aria-selected={option.family ? tk1688ModelFamily(selected ?? { id: value }) === option.family : value === option.id} aria-disabled={Boolean(option.reason)} aria-setsize={options.length} aria-posinset={index + 1}
          aria-describedby={option.model ? `${listId}-${index}-id ${listId}-${index}-price${family ? ` ${listId}-${index}-summary` : ""}${option.model.metadata?.publicCatalogOnly === true ? ` ${listId}-${index}-directory` : ""}${capabilities[option.model.id]?.transparent || capabilities[option.model.id]?.mask ? ` ${listId}-${index}-capabilities` : ""}` : undefined}
          className={styles.option} data-index={index} data-active={activeIndex === index || undefined} data-catalog-only={option.model?.metadata?.publicCatalogOnly === true || undefined}
          title={option.family ? "查看此模型的自动路由与商家渠道" : option.id || "使用连接默认模型"} tabIndex={-1}
          onMouseDown={event => event.preventDefault()} onPointerMove={() => { if (activeIndex !== index) setActive(index); }} onClick={() => activate(option)}>
          {option.family ? <span className={styles.identity}><strong>{option.label}</strong><span className={styles.summary}>{option.merchants} 条商家渠道 · 查看线路与报价</span></span>
            : option.model ? <ModelIdentity model={option.model} capabilities={capabilities[option.model.id]} detailsId={`${listId}-${index}`} price route={Boolean(family)} keyConfirmed={catalogDirectory?.keyConfirmed} /> : <span>{option.label}</span>}
          {option.model && badge?.(option.model)}
          {(option.family ? tk1688ModelFamily(selected ?? { id: value }) === option.family : value === option.id) && <Check className={styles.currentCheck} size={14} aria-hidden="true" />}
        </button>} />
      {showPricePreview && <section className={styles.pricePreview} data-price-preview="" aria-label="价格明细" aria-describedby={`${listId}-preview-model`}>
        <div className={styles.previewHeading}><strong>价格明细</strong><span id={`${listId}-preview-model`} title={previewModel!.id}>{previewModel!.id}</span></div>
        <div className={styles.previewScroll} tabIndex={0} aria-label="滚动价格明细"><ModelPriceTable model={previewModel} data={previewPrice} /></div>
      </section>}
      <div className={styles.pagination}><span>{options.length ? `${pageStart + 1}–${Math.min(pageStart + MODEL_PICKER_PAGE_SIZE, options.length)} / ${options.length}${grouped ? family ? " 条线路" : " 个模型选项" : ""}` : "0 个模型"}</span>
        {options.length > MODEL_PICKER_PAGE_SIZE && <><button type="button" disabled={!page} onClick={() => { setActive(Math.max(0, pageStart - MODEL_PICKER_PAGE_SIZE)); search.current?.focus(); }}>上一页</button><button type="button" disabled={pageStart + MODEL_PICKER_PAGE_SIZE >= options.length} onClick={() => { setActive(pageStart + MODEL_PICKER_PAGE_SIZE); search.current?.focus(); }}>下一页</button></>}
      </div>
      {allowManual && !grouped && query.trim() && !displayModels.some(model => model.id === query.trim()) && <button className={styles.manual} type="button" onClick={() => choose(query.trim())}>使用手动模型 ID：{query.trim()}</button>}
    </div>}
  </div>;
}
