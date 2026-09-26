import { create } from "zustand";
import type { CanvasDrawingStroke, CanvasEdge, CanvasNode } from "./types";

type ValueOrUpdater<T> = T | ((current: T) => T);

function resolveValue<T>(next: ValueOrUpdater<T>, current: T): T {
  return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}

interface CanvasStore {
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  drawings: CanvasDrawingStroke[];
  selectedId: string | null;
  viewport: { x: number; y: number; zoom: number };
  setTitle: (next: ValueOrUpdater<string>) => void;
  setNodes: (next: ValueOrUpdater<CanvasNode[]>) => void;
  setEdges: (next: ValueOrUpdater<CanvasEdge[]>) => void;
  setDrawings: (next: ValueOrUpdater<CanvasDrawingStroke[]>) => void;
  setSelectedId: (next: ValueOrUpdater<string | null>) => void;
  setViewport: (
    next: ValueOrUpdater<{ x: number; y: number; zoom: number }>,
  ) => void;
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "超级画布",
  nodes: [],
  edges: [],
  drawings: [],
  selectedId: null,
  viewport: { x: 0, y: 0, zoom: 0.85 },
  setTitle: (next) =>
    set((state) => ({ title: resolveValue(next, state.title) })),
  setNodes: (next) =>
    set((state) => ({ nodes: resolveValue(next, state.nodes) })),
  setEdges: (next) =>
    set((state) => ({ edges: resolveValue(next, state.edges) })),
  setDrawings: (next) =>
    set((state) => ({ drawings: resolveValue(next, state.drawings) })),
  setSelectedId: (next) =>
    set((state) => ({ selectedId: resolveValue(next, state.selectedId) })),
  setViewport: (next) =>
    set((state) => ({ viewport: resolveValue(next, state.viewport) })),
}));
