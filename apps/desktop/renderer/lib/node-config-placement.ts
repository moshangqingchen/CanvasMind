export interface NodeConfigRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface NodeConfigPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

interface PlacementOptions {
  node: NodeConfigRect;
  viewport: NodeConfigRect;
  obstacles?: readonly NodeConfigRect[];
  zoom: number;
}

type Side = "below" | "above" | "right" | "left";
type Candidate = NodeConfigPlacement & { side: Side };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
const hasArea = (rect: NodeConfigRect) => rect.right > rect.left && rect.bottom > rect.top;
const intersects = (a: NodeConfigRect, b: NodeConfigRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const placementOf = ({ left, top, width, maxHeight }: Candidate): NodeConfigPlacement => ({ left, top, width, maxHeight });

// Keep maximal empty rectangles, not individual grid cells: a toolbar at one
// corner should not needlessly limit the height of a panel beside it.
function availableRects(region: NodeConfigRect, obstacles: readonly NodeConfigRect[]): NodeConfigRect[] {
  let spaces = hasArea(region) ? [region] : [];
  for (const obstacle of obstacles) {
    const split = spaces.flatMap((space) => {
      if (!intersects(space, obstacle)) return [space];
      return [
        { ...space, right: Math.min(space.right, obstacle.left) },
        { ...space, left: Math.max(space.left, obstacle.right) },
        { ...space, bottom: Math.min(space.bottom, obstacle.top) },
        { ...space, top: Math.max(space.top, obstacle.bottom) },
      ].filter(hasArea);
    });
    spaces = split.filter((space, index) => !split.some((other, otherIndex) =>
      otherIndex !== index && other.left <= space.left && other.top <= space.top &&
      other.right >= space.right && other.bottom >= space.bottom &&
      (otherIndex < index || other.left < space.left || other.top < space.top ||
        other.right > space.right || other.bottom > space.bottom),
    ));
  }
  return spaces;
}

/**
 * Position the entire panel outside its node, in screen coordinates. Short
 * spaces reduce maxHeight so the body can scroll; they never move its top back
 * over the node. Callers must account for canvas zoom when applying these sizes.
 */
export function placeNodeConfigPanel({ node, viewport, obstacles = [], zoom }: PlacementOptions): NodeConfigPlacement {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const gap = 10 * scale;
  const desiredHeight = 560 * scale;
  const desiredWidth = Math.max(0, Math.min(node.right - node.left, viewport.right - viewport.left));
  const minimumWidth = Math.min(desiredWidth, 240 * scale);
  const minimumHeight = 120 * scale;
  const compactWidth = Math.min(desiredWidth, 180 * scale);
  const paddedObstacles = obstacles.filter(hasArea).map((rect) => ({
    left: rect.left - 8, top: rect.top - 8, right: rect.right + 8, bottom: rect.bottom + 8,
  }));
  const regions: Array<{ side: Side; rect: NodeConfigRect }> = [
    { side: "below", rect: { ...viewport, top: Math.max(viewport.top, node.bottom + gap) } },
    { side: "above", rect: { ...viewport, bottom: Math.min(viewport.bottom, node.top - gap) } },
    { side: "right", rect: { ...viewport, left: Math.max(viewport.left, node.right + gap) } },
    { side: "left", rect: { ...viewport, right: Math.min(viewport.right, node.left - gap) } },
  ];
  const candidates: Candidate[] = regions.flatMap(({ side, rect }) =>
    availableRects(rect, paddedObstacles).map((space) => {
      const width = Math.min(desiredWidth, space.right - space.left);
      const maxHeight = Math.min(desiredHeight, space.bottom - space.top);
      return {
        side,
        left: side === "right" ? space.left : side === "left" ? space.right - width :
          clamp(node.left, space.left, space.right - width),
        top: side === "below" ? space.top : side === "above" ? space.bottom - maxHeight :
          clamp(node.top, space.top, space.bottom - maxHeight),
        width,
        maxHeight,
      };
    }),
  ).filter((candidate) => candidate.width > 0 && candidate.maxHeight > 0);
  // A wide strip shorter than the header cannot expose any controls. Prefer a
  // narrower readable panel if there is no regular-width space tall enough for
  // the header and at least one row of the scrolling body.
  const usable = candidates.filter((candidate) => candidate.width >= minimumWidth && candidate.maxHeight >= minimumHeight);
  const compact = candidates.filter((candidate) => candidate.width >= compactWidth && candidate.maxHeight >= minimumHeight);
  // A regular-width panel can still expose its 49px sticky header plus a
  // scrollable field in 96 CSS pixels. Prefer the taller regular/compact
  // placements above, but retain this usable short region before going offscreen.
  const short = candidates.filter((candidate) => candidate.width >= minimumWidth && candidate.maxHeight >= 96 * scale);
  const readable = usable.length ? usable : compact.length ? compact : short;
  const proximity = (candidate: Candidate) => Math.abs(candidate.left - node.left) + Math.abs(candidate.top - node.top);
  const compareSize = (a: Candidate, b: Candidate) => b.width * b.maxHeight - a.width * a.maxHeight || proximity(a) - proximity(b);

  // Preserve the familiar below/above order when a complete panel fits. Side
  // placement is useful at large zoom, where neither vertical gap is tall enough.
  for (const side of ["below", "above", "right", "left"] as const) {
    const full = readable.filter((candidate) => candidate.side === side && candidate.maxHeight >= desiredHeight);
    if (full.length) return placementOf(full.sort(compareSize)[0]);
  }
  const best = readable.sort(compareSize)[0];
  if (best) return placementOf(best);

  // A node (or toolbar) can leave only unusable slivers, or fill the viewport.
  // Keep the full panel beyond the node instead of clipping its header and
  // controls into those slivers. Panning/zooming can reveal the intact panel.
  return {
    left: viewport.left,
    top: Math.max(node.bottom + gap, ...paddedObstacles.map((rect) => rect.bottom)),
    width: desiredWidth,
    maxHeight: desiredHeight,
  };
}
