"use client";

import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type KeyboardEventHandler } from "react";
import { virtualWindow } from "../lib/virtual-window";

/** Variable-height list. Measured rows keep their height while outside the window. */
export function VirtualList<T>({ items, itemKey, itemMeasurementKey, renderItem, estimatedHeight = 160, className, label, resetKey, keepMountedKeys, header, footer, scrollRef, onKeyDown }: {
  items: readonly T[];
  itemKey: (item: T) => string;
  /** Separate cached sizes for collapsed/expanded content without remounting editors. */
  itemMeasurementKey?: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  estimatedHeight?: number;
  className?: string;
  label: string;
  resetKey?: string;
  /** Preserve local editor state offscreen without including hidden editors in layout. */
  keepMountedKeys?: ReadonlySet<string>;
  header?: ReactNode;
  footer?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useImperativeHandle(scrollRef, () => root.current!, []);
  const [sizes, setSizes] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const stickToBottom = useRef(false);
  const [view, setView] = useState({ scroll: 0, height: 600 });
  const keys = items.map(itemKey);
  const keySignature = keys.join("\0");
  const sizeKeys = items.map((item, index) => itemMeasurementKey ? JSON.stringify([keys[index], itemMeasurementKey(item)]) : keys[index]!);
  const sizeSignature = sizeKeys.join("\0");
  const offsets = [0];
  for (const key of sizeKeys) offsets.push(offsets.at(-1)! + (sizes.get(key) ?? estimatedHeight));
  const window = virtualWindow(offsets, Math.max(0, view.scroll - headerHeight), view.height);
  const mounted = items.flatMap((item, index) => (index >= window.start && index < window.end) || focusedKey === keys[index] || (keepMountedKeys?.has(keys[index]!) && visited.has(keys[index]!)) ? [{ item, index }] : []);
  useLayoutEffect(() => {
    if (!keepMountedKeys?.size) return;
    const visibleKeys = keySignature.split("\0").slice(window.start, window.end).filter(key => keepMountedKeys.has(key));
    // Retention follows the committed viewport so speculative renders never mount every editor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisited(current => visibleKeys.every(key => current.has(key)) ? current : new Set([...current, ...visibleKeys]));
  }, [keySignature, window.start, window.end, keepMountedKeys]);
  useLayoutEffect(() => {
    const element = root.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [sizes, sizeSignature, headerHeight, view.height]);
  const measureRow = useCallback((key: string, height: number) => {
    if (height > 0) setSizes(current => Math.abs((current.get(key) ?? 0) - height) > 0.5
      ? new Map(current).set(key, height)
      : current);
  }, []);
  const findFocusedRow = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    let row = target.closest<HTMLElement>("[data-virtual-key]");
    // A retained supplier editor can contain another VirtualList. The outer list
    // must pin its own group row, not the nested model row that received focus.
    while (row && row.parentElement?.parentElement !== root.current) {
      row = row.parentElement?.closest<HTMLElement>("[data-virtual-key]") ?? null;
    }
    return row?.dataset.virtualKey ?? null;
  }, []);
  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeaderHeight(element.getBoundingClientRect().height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== element.clientWidth) {
        width = element.clientWidth;
        const measured = new Map<string, number>();
        // Child observers may have delivered their new size earlier in this same
        // resize batch; retain the current mounted measurements after invalidation.
        for (const row of element.querySelectorAll<HTMLElement>(":scope > div > [data-virtual-key]:not([hidden])")) {
          const height = row.getBoundingClientRect().height;
          if (row.dataset.virtualSizeKey && height > 0) measured.set(row.dataset.virtualSizeKey, height);
        }
        setSizes(measured);
      }
      setView(current => current.height === element.clientHeight ? current : { ...current, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    stickToBottom.current = false;
    if (root.current) root.current.scrollTop = 0;
    // Keep the window synchronized with the explicit DOM scroll reset before paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(current => current.scroll ? { ...current, scroll: 0 } : current);
  }, [resetKey]);
  return <div ref={root} className={className} aria-label={label} role="list" tabIndex={0} onKeyDown={onKeyDown}
    onFocusCapture={event => setFocusedKey(findFocusedRow(event.target))}
    onBlurCapture={event => setFocusedKey(findFocusedRow(event.relatedTarget))}
    style={{ overflow: "auto", overflowAnchor: "none", minHeight: 0, flex: 1 }}
    onScroll={event => {
      const scroll = event.currentTarget.scrollTop;
      stickToBottom.current = event.currentTarget.scrollHeight - event.currentTarget.clientHeight - scroll <= 8;
      setView(current => ({ ...current, scroll }));
    }}>
    <div ref={headerRef}>{header}</div>
    <div style={{ position: "relative", paddingTop: window.top, paddingBottom: window.bottom }}>
      {mounted.map(({ item, index }) => <MeasuredRow key={itemKey(item)} rowKey={itemKey(item)} sizeKey={sizeKeys[index]!} measure={measureRow} hidden={(index < window.start || index >= window.end) && focusedKey !== itemKey(item)} pinned={focusedKey === itemKey(item) && (index < window.start || index >= window.end)} top={offsets[index]}>
        {renderItem(item, index)}
      </MeasuredRow>)}
    </div>
    {footer}
  </div>;
}

function MeasuredRow({ children, rowKey, sizeKey, measure, hidden, pinned, top }: { children: ReactNode; rowKey: string; sizeKey: string; measure: (key: string, height: number) => void; hidden: boolean; pinned: boolean; top: number | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || hidden) return;
    const observer = new ResizeObserver(() => measure(sizeKey, element.getBoundingClientRect().height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [sizeKey, measure, hidden]);
  return <div ref={ref} data-virtual-key={rowKey} data-virtual-size-key={sizeKey} role="listitem" hidden={hidden} style={{ display: hidden ? "none" : "flow-root", ...(pinned ? { position: "absolute" as const, top, left: 0, width: "100%" } : {}) }}>{children}</div>;
}
