"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { ModelDescriptor } from "@super-canvas/providers";
import { cleanModelDisplayName, modelPriceSummary } from "../lib/model-display";
import { modelCanvasUnavailableReason } from "../lib/graph-ui";
import { filterPickerModels, MODEL_PICKER_PAGE_SIZE, readRecentModels, RECENT_MODELS_KEY, rememberModel,
  type ModelKindFilter, type ModelStatusFilter } from "../lib/model-picker";
import styles from "./model-picker.module.css";

function ModelIdentity({ model, parameters, price = false, detailsId }: { model: ModelDescriptor; parameters: Record<string, unknown>; price?: boolean; detailsId?: string }) {
  return <span className={styles.identity}>
    <span id={detailsId ? `${detailsId}-name` : undefined} className={styles.name}>{cleanModelDisplayName(model.name, model.metadata?.priceLabel)}</span>
    <span id={detailsId ? `${detailsId}-id` : undefined} className={styles.id} title={model.id}>ID: {model.id}</span>
    {price && <span id={detailsId ? `${detailsId}-price` : undefined} className={styles.price}>{modelPriceSummary(model, parameters)}</span>}
  </span>;
}

export function ModelPicker({ id, label, connectionId, models, value, onChange, parameters = {},
  open: controlledOpen, onOpenChange, maxHeight = 360, anchorKey, loading = false, failed = false, authoritative = true, allowManual = false, badge,
}: {
  id?: string; label: string; connectionId: string; models: readonly ModelDescriptor[]; value: string;
  onChange: (modelId: string) => void; parameters?: Record<string, unknown>; open?: boolean;
  onOpenChange?: (open: boolean) => void; maxHeight?: number; anchorKey?: string; loading?: boolean; failed?: boolean;
  authoritative?: boolean; allowManual?: boolean; badge?: (model: ModelDescriptor) => ReactNode;
}) {
  const generatedId = useId();
  const listId = `${id ?? generatedId}-options`;
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ModelKindFilter>("all");
  const [status, setStatus] = useState<ModelStatusFilter>("all");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = models.find(model => model.id === value);
  const filtered = useMemo(() => filterPickerModels(models, query, kind, status, recentIds), [models, query, kind, status, recentIds]);
  const hasFilters = Boolean(query.trim()) || kind !== "all" || status !== "all";
  const options = useMemo(() => [
    ...(!hasFilters ? [{ id: "", model: undefined as ModelDescriptor | undefined, label: "自动模型", reason: null as string | null }] : []),
    ...filtered.map(model => ({ id: model.id, model, label: cleanModelDisplayName(model.name, model.metadata?.priceLabel), reason: modelCanvasUnavailableReason(model) })),
  ], [filtered, hasFilters]);
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const page = Math.floor(activeIndex / MODEL_PICKER_PAGE_SIZE);
  const pageStart = page * MODEL_PICKER_PAGE_SIZE;
  const visible = options.slice(pageStart, pageStart + MODEL_PICKER_PAGE_SIZE);
  const setOpen = (next: boolean, restoreFocus = false) => {
    setLocalOpen(next);
    onOpenChange?.(next);
    if (!next && restoreFocus) trigger.current?.focus();
    if (next) {
      try { setRecentIds(readRecentModels(localStorage.getItem(RECENT_MODELS_KEY)).find(item => item.connectionId === connectionId)?.modelIds ?? []); } catch { setRecentIds([]); }
      setQuery(""); setKind("all"); setStatus("all");
      const index = models.findIndex(model => model.id === value);
      setActive(index < 0 ? 0 : index + 1);
    }
  };
  const choose = (modelId: string) => {
    if (modelId && connectionId) {
      try { localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(rememberModel(readRecentModels(localStorage.getItem(RECENT_MODELS_KEY)), connectionId, modelId))); } catch { /* Storage can be disabled; choosing a model still works. */ }
    }
    onChange(modelId);
    setOpen(false, true);
  };
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const panel = menu.current;
    // The browser's top layer escapes the node panel's clipping while keeping
    // DOM ancestry, keyboard handling and accessible labels inside that panel.
    if (!panel.matches(":popover-open")) panel.showPopover();
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 12;
      const top = (viewport?.offsetTop ?? 0) + 12;
      const right = left + (viewport?.width ?? window.innerWidth) - 24;
      const bottom = top + (viewport?.height ?? window.innerHeight) - 24;
      const below = bottom - rect.bottom - 4;
      const above = rect.top - top - 4;
      // The inspector's supplier fields must remain clickable while choosing
      // a model. Other picker surfaces can still use the space above them.
      const inInspector = Boolean(host.current?.closest(".node-config-popover"));
      const upwards = !inInspector && below < 220 && above > below;
      const height = Math.min(bottom - top, Math.max(160, Math.min(Math.max(240, maxHeight), upwards ? above : below)));
      const width = Math.min(Math.max(260, rect.width), right - left);
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.left = `${Math.max(left, Math.min(rect.left, right - width))}px`;
      panel.style.top = `${upwards ? Math.max(top, rect.top - Math.min(panel.scrollHeight, height) - 4) : Math.max(top, Math.min(rect.bottom + 4, bottom - height))}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, maxHeight, options.length, anchorKey]);
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
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, page]);
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false, true); return; }
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement && event.target !== trigger.current) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (!open) { setOpen(true); return; }
    if (event.key === "Enter") { const option = options[activeIndex]; if (option && !option.reason) choose(option.id); }
    else setActive(event.key === "Home" ? 0 : event.key === "End" ? Math.max(0, options.length - 1) :
      Math.min(Math.max(0, options.length - 1), Math.max(0, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
  };
  return <div ref={host} className={`node-model-select ${styles.picker}`} data-open={open || undefined} onKeyDown={keyDown}
    onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button id={id} ref={trigger} type="button" className={`node-model-select-trigger ${styles.trigger}`} role="combobox"
      aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-describedby={selected ? `${listId}-selected-name ${listId}-selected-id` : undefined}
      title={selected ? `${cleanModelDisplayName(selected.name, selected.metadata?.priceLabel)} · ${selected.id}` : value || "自动模型"}
      onClick={() => setOpen(!open)}>
      {selected ? <ModelIdentity model={selected} parameters={parameters} detailsId={`${listId}-selected`} /> : <span>{value || "自动模型"}</span>}
      {selected && badge?.(selected)}<ChevronDown size={15} />
    </button>
    {value && !selected && <p className={styles.note} role="status">保留当前模型 {value}：{loading ? "正在扫描模型…" : failed ? "模型扫描失败，暂不可用" : authoritative ? "当前扫描不可用" : "目录未确认"}。请选择后才会更换。</p>}
    {open && <div ref={menu} popover="manual" className={`node-model-select-options ${styles.menu}`}
      style={{ position: "fixed", inset: "auto", margin: 0, display: "flex", maxHeight }}>
      <div className={styles.filters}>
        <input ref={search} role="combobox" aria-label="搜索模型名称或 ID" placeholder="搜索模型名称或 ID" aria-autocomplete="list"
          aria-expanded="true" aria-controls={listId} aria-activedescendant={options.length ? `${listId}-${activeIndex}` : undefined}
          value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} />
        <select aria-label="模型类型筛选" value={kind} onChange={event => { setKind(event.target.value as ModelKindFilter); setActive(0); }}>
          <option value="all">全部类型</option><option value="image">图像</option><option value="video">视频</option>
        </select>
        <select aria-label="模型状态筛选" value={status} onChange={event => { setStatus(event.target.value as ModelStatusFilter); setActive(0); }}>
          <option value="all">全部模型</option><option value="runnable">可运行</option><option value="verified">已实测</option><option value="recent">最近选择</option>
        </select>
      </div>
      <div ref={list} id={listId} className={styles.list} role="listbox" aria-label={`${label} 可选模型`}>
        {visible.map((option, offset) => <button key={option.id} id={`${listId}-${pageStart + offset}`} type="button" role="option"
          aria-label={option.label} aria-selected={value === option.id} aria-disabled={Boolean(option.reason)} aria-setsize={options.length} aria-posinset={pageStart + offset + 1}
          aria-describedby={option.model ? `${listId}-${pageStart + offset}-id ${listId}-${pageStart + offset}-price${option.reason ? ` ${listId}-${pageStart + offset}-reason` : ""}` : undefined}
          className={styles.option} data-index={pageStart + offset} data-active={activeIndex === pageStart + offset || undefined}
          title={option.reason ? `不可运行：${option.reason}` : option.id || "使用连接默认模型"} tabIndex={-1}
          onMouseDown={event => event.preventDefault()} onClick={() => { if (!option.reason) choose(option.id); }}>
          {option.model ? <span className={styles.identity}><ModelIdentity model={option.model} parameters={parameters} detailsId={`${listId}-${pageStart + offset}`} price />{option.reason && <small id={`${listId}-${pageStart + offset}-reason`}>不可运行：{option.reason}</small>}</span> : <span>{option.label}</span>}
          {option.model && badge?.(option.model)}
        </button>)}
        {!options.length && <p className={styles.note}>没有符合筛选条件的模型。可清空搜索或调整筛选。</p>}
      </div>
      <div className={styles.pagination}><span>{options.length ? `${pageStart + 1}–${Math.min(pageStart + MODEL_PICKER_PAGE_SIZE, options.length)} / ${options.length}` : "0 个模型"}</span>
        {options.length > MODEL_PICKER_PAGE_SIZE && <><button type="button" disabled={!page} onClick={() => { setActive(Math.max(0, pageStart - MODEL_PICKER_PAGE_SIZE)); search.current?.focus(); }}>上一页</button><button type="button" disabled={pageStart + MODEL_PICKER_PAGE_SIZE >= options.length} onClick={() => { setActive(pageStart + MODEL_PICKER_PAGE_SIZE); search.current?.focus(); }}>下一页</button></>}
      </div>
      {allowManual && query.trim() && !models.some(model => model.id === query.trim()) && <button className={styles.manual} type="button" onClick={() => choose(query.trim())}>使用手动模型 ID：{query.trim()}</button>}
    </div>}
  </div>;
}
