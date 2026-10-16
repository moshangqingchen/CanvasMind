import type { PositionedCanvasRect } from "./graph-ui";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
export type NewNodeViewport = Point & Size;

const grid = 8;
const gap = 24;
const snap = (value: number) => Math.round(value / grid) * grid;
const snapBefore = (value: number) => Math.floor(value / grid) * grid;
const snapAfter = (value: number) => Math.ceil(value / grid) * grid;

function inside(point: Point, size: Size, viewport: NewNodeViewport) {
  return point.x >= viewport.x && point.y >= viewport.y &&
    point.x + size.width <= viewport.x + viewport.width &&
    point.y + size.height <= viewport.y + viewport.height;
}

/** Place toolbar/library clicks near the view without changing drop anchors. */
export function newNodePlacement(
  size: Size,
  viewport: NewNodeViewport,
  occupied: readonly PositionedCanvasRect[],
  selectedId?: string | null,
): { position: Point; requiresReveal: boolean } {
  const center = {
    x: snap(viewport.x + (viewport.width - size.width) / 2),
    y: snap(viewport.y + (viewport.height - size.height) / 2),
  };
  const selected = occupied.find(node => node.id === selectedId);
  const beside = selected ? {
    x: snapAfter(selected.position.x + selected.width + gap),
    y: snap(selected.position.y),
  } : null;
  // A distant/stale selection must not pull a newly added card off screen.
  const preferred = beside && inside(beside, size, viewport) ? beside : center;
  const candidates = new Map<string, Point>();
  const add = (x: number, y: number) => {
    const point = { x, y };
    candidates.set(`${x},${y}`, point);
  };
  add(preferred.x, preferred.y);
  add(center.x, center.y);
  const left = snapAfter(viewport.x), top = snapAfter(viewport.y);
  const right = snapBefore(viewport.x + viewport.width - size.width);
  const bottom = snapBefore(viewport.y + viewport.height - size.height);
  for (const x of [left, right]) for (const y of [top, bottom]) add(x, y);
  for (const node of occupied) {
    const beforeX = snapBefore(node.position.x - size.width - gap);
    const afterX = snapAfter(node.position.x + node.width + gap);
    const beforeY = snapBefore(node.position.y - size.height - gap);
    const afterY = snapAfter(node.position.y + node.height + gap);
    for (const x of [beforeX, afterX]) {
      add(x, preferred.y);
      add(x, beforeY);
      add(x, afterY);
      // Clamping the perpendicular axis also finds gaps against view edges.
      add(x, Math.min(Math.max(preferred.y, top), bottom));
    }
    for (const y of [beforeY, afterY]) {
      add(preferred.x, y);
      add(Math.min(Math.max(preferred.x, left), right), y);
    }
  }
  const overlaps = (point: Point) => occupied.some(node =>
    point.x < node.position.x + node.width + gap && point.x + size.width + gap > node.position.x &&
    point.y < node.position.y + node.height + gap && point.y + size.height + gap > node.position.y);
  const distance = (point: Point) => (point.x - preferred.x) ** 2 + (point.y - preferred.y) ** 2;
  const ordered = [...candidates.values()].sort((a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x);
  // Prefer an available visible position even if an offscreen gap is nearer.
  const position = ordered.find(point => inside(point, size, viewport) && !overlaps(point)) ??
    ordered.find(point => !overlaps(point)) ?? center;
  return { position, requiresReveal: !inside(position, size, viewport) };
}
