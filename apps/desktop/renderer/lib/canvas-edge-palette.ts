import type { CanvasEdge } from "../components/types";

export const EDGE_COLOR_KINDS = ["text", "image", "video", "audio", "asset", "result"] as const;
export type EdgeColorKind = typeof EDGE_COLOR_KINDS[number];
export interface EdgePalettePair { readonly source: EdgeColorKind; readonly target: EdgeColorKind }

const colorKinds: ReadonlySet<string> = new Set(EDGE_COLOR_KINDS);
const emptyPairs: readonly EdgePalettePair[] = [];

export function edgePaletteId(source: EdgeColorKind, target: EdgeColorKind, reversed = false) {
  return `canvas-edge-${source}-${target}${reversed ? "-reverse" : ""}`;
}

/** Presentation colors only. Never invent generic port kinds or rewrite edges. */
export function collectEdgePalettePairs(edges: readonly Pick<CanvasEdge, "data">[]): readonly EdgePalettePair[] {
  const needed = new Set<string>();
  for (const edge of edges) {
    const studio = edge.data?.studio;
    if (!studio || typeof studio !== "object") continue;
    const state = studio as { kind?: unknown; targetKind?: unknown };
    // Match StudioEdgeContent's optional presentation defaults exactly.
    const kind = state.kind ?? "text";
    const targetKind = state.targetKind ?? kind;
    if (typeof kind !== "string" || typeof targetKind !== "string" || kind === targetKind ||
      !colorKinds.has(kind) || !colorKinds.has(targetKind)) continue;
    needed.add(`${kind}:${targetKind}`);
  }
  if (!needed.size) return emptyPairs;
  // Canonical ordering avoids reordering SVG definitions when edges reorder.
  return EDGE_COLOR_KINDS.flatMap(source => EDGE_COLOR_KINDS
    .filter(target => needed.has(`${source}:${target}`))
    .map(target => ({ source, target })));
}
