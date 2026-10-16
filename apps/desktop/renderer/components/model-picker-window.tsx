"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import styles from "./model-picker.module.css";

type Row = { id: string; model?: unknown };
export type ModelListMeasurements = {
  width: number;
  viewportHeight: number;
  heights: ReadonlyMap<string, number>;
};
type ModelListProps<T extends Row> = {
  rows: readonly T[];
  pageStart: number;
  activeIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  id: string;
  label: string;
  emptyMessage: string;
  measurements: RefObject<ModelListMeasurements>;
  renderRow: (row: T, index: number, style: CSSProperties) => ReactNode;
};
const normalRowStyle: CSSProperties = {};

export function WindowedModelList<T extends Row>(props: ModelListProps<T>) {
  return props.rows.length <= 12 ? <NormalModelList {...props} /> : <VirtualModelList {...props} />;
}

/** Small menus already have bounded DOM. Native flow avoids measuring every
 * row and committing a second render before their first interaction. */
function NormalModelList<T extends Row>({ rows, pageStart, activeIndex, listRef, id, label, emptyMessage, renderRow }: ModelListProps<T>) {
  useLayoutEffect(() => {
    const host = listRef.current;
    if (!host) return;
    let active = true;
    // The parent opens and positions the top-layer popover in its layout effect.
    // Reveal the active row after that work, when its scroll viewport is real.
    queueMicrotask(() => {
      if (!active || !host.isConnected) return;
      host.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
      host.dispatchEvent(new Event("canvas-model-list-size"));
    });
    return () => { active = false; };
  }, [activeIndex, listRef, pageStart, rows]);

  return <div ref={listRef} id={id} className={styles.list} role="listbox" aria-label={label}>
    {rows.map((row, index) => renderRow(row, pageStart + index, normalRowStyle))}
    {!rows.length && <p className={styles.note}>{emptyMessage}</p>}
  </div>;
}

/** Variable-height rows retain a complete accessible option identity while only
 * the viewport, three nearby rows and the keyboard-active row are mounted. */
function VirtualModelList<T extends Row>({ rows, pageStart, activeIndex, listRef, id, label, emptyMessage, measurements, renderRow }: ModelListProps<T>) {
  // Reopening the same picker can start with its last geometry. These are only
  // estimates: every mounted row is still observed, including changed prices.
  const [initialMeasurements] = useState(() => measurements.current);
  const [viewport, setViewport] = useState({ top: 0, height: initialMeasurements.viewportHeight });
  const [heights, setHeights] = useState(initialMeasurements.heights);
  const measuredHeights = useRef(heights);
  const width = useRef(initialMeasurements.width);
  const scrollFrame = useRef(0);
  const revealActive = useRef(true);
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows) result.push(result[result.length - 1]! + (heights.get(row.id) ?? (row.model ? 64 : 44)));
    return result;
  }, [rows, heights]);
  const totalHeight = offsets[offsets.length - 1] ?? 0;
  let first = 0;
  while (first < rows.length && offsets[first + 1]! < viewport.top) first++;
  let last = first;
  while (last < rows.length && offsets[last]! < viewport.top + viewport.height) last++;
  const start = Math.max(0, first - 3);
  const end = Math.min(rows.length, last + 3);
  const activeLocal = activeIndex - pageStart;
  const indices = Array.from({ length: end - start }, (_, index) => start + index);
  // Keep aria-activedescendant valid even while the user scrolls away from it.
  if (activeLocal >= 0 && activeLocal < rows.length && !indices.includes(activeLocal)) indices.push(activeLocal);
  indices.sort((left, right) => left - right);
  const observedRows = indices.join(",");

  useLayoutEffect(() => {
    const host = listRef.current;
    if (!host) return;
    const observer = new ResizeObserver(entries => {
      const rowMeasurements: Array<[string, number]> = [];
      let resetWidth = false;
      let viewportHeight = measurements.current.viewportHeight;
      for (const entry of entries) {
        if (entry.target === host) {
          const nextWidth = entry.contentRect.width;
          resetWidth = width.current > 0 && Math.abs(width.current - nextWidth) > 1;
          width.current = nextWidth;
          const height = entry.contentRect.height;
          viewportHeight = height;
          setViewport(previous => Math.abs(previous.top - host.scrollTop) > .5 || Math.abs(previous.height - height) > .5
            ? { top: host.scrollTop, height } : previous);
        } else {
          const index = Number((entry.target as HTMLElement).dataset.index) - pageStart;
          const row = rows[index];
          const height = entry.borderBoxSize[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
          if (row && height > 0) rowMeasurements.push([row.id, height]);
        }
      }
      if (resetWidth || rowMeasurements.length) {
        const next = resetWidth ? new Map<string, number>() : new Map(measuredHeights.current);
        let changed = resetWidth && measuredHeights.current.size > 0;
        for (const [key, height] of rowMeasurements) {
          if (Math.abs((next.get(key) ?? 0) - height) > .5) { next.set(key, height); changed = true; }
        }
        if (changed) {
          measuredHeights.current = next;
          setHeights(next);
        }
      }
      // Keep only sizes in the picker instance, never row/model/price data.
      measurements.current = { width: width.current, viewportHeight, heights: measuredHeights.current };
    });
    observer.observe(host);
    for (const option of host.querySelectorAll<HTMLElement>('[role="option"]')) observer.observe(option);
    return () => observer.disconnect();
  }, [listRef, measurements, observedRows, pageStart, rows]);

  useLayoutEffect(() => { revealActive.current = true; }, [activeIndex, pageStart]);
  useLayoutEffect(() => {
    const host = listRef.current;
    if (!host) return;
    if (revealActive.current) host.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
    // The top-layer menu can remeasure its intrinsic height without rerendering
    // its filters or model identities when new row measurements arrive.
    host.dispatchEvent(new Event("canvas-model-list-size"));
    // Positioning can shrink the scroll viewport after the first reveal. Its
    // ResizeObserver pass must reveal again even when cached row sizes match.
  }, [activeIndex, listRef, observedRows, totalHeight, viewport.height]);
  useEffect(() => () => window.cancelAnimationFrame(scrollFrame.current), []);

  return <div ref={listRef} id={id} className={styles.list} role="listbox" aria-label={label}
    onWheel={() => { revealActive.current = false; }}
    onPointerDown={() => { revealActive.current = false; }}
    onScroll={event => {
      if (scrollFrame.current) return;
      const host = event.currentTarget;
      scrollFrame.current = window.requestAnimationFrame(() => {
        scrollFrame.current = 0;
        setViewport(previous => previous.top === host.scrollTop ? previous : { ...previous, top: host.scrollTop });
      });
    }}>
    <div className={styles.window} style={{ height: totalHeight }} data-virtual-model-list="" role="presentation">
      {indices.map(index => renderRow(rows[index]!, pageStart + index, { position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${offsets[index]}px)` }))}
      {!rows.length && <p className={styles.note}>{emptyMessage}</p>}
    </div>
  </div>;
}
